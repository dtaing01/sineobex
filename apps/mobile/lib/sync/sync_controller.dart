import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../api/generated/api.dart';
import '../auth/session_controller.dart';
import '../security/secure_store.dart';
import 'clock.dart';
import 'device_identity.dart';
import 'local_db.dart';
import 'local_store.dart';
import 'sync_engine.dart';

/// What the sync screens show. No patient details: counts, states and times only.
@immutable
class SyncSnapshot {
  const SyncSnapshot({
    this.open = false,
    this.unsynced = const UnsyncedSummary({}, null),
    this.attention = const [],
    this.held = 0,
    this.inReview = 0,
    this.clock = const ClockStatus(ClockState.unverified, null),
    this.syncing = false,
    this.offline = false,
    this.lastSyncedAt,
    this.nextAttempt,
    this.elsewhere = 0,
  });

  /// A team's database is open (the app is unlocked with a team chosen).
  final bool open;
  final UnsyncedSummary unsynced;
  final List<OutboxEntry> attention;
  final int held;
  final int inReview;
  final ClockStatus clock;
  final bool syncing;
  final bool offline;
  final DateTime? lastSyncedAt;
  final DateTime? nextAttempt;

  /// Unsynced changes in this person's other team databases on the phone, which sync only when
  /// that team is open. Null when one of them couldn't be read.
  final int? elsewhere;
}

/// Opens the person's encrypted database while the app is unlocked, keeps it syncing, and acts on
/// what the server says about the phone (module 9).
///
/// The database closes when the app locks, so the key leaves memory with the lock. A remote wipe
/// or removal from the team is acted on only after the server confirms it to this phone's device
/// key; a refused sign-in alone never deletes anything.
class SyncController extends ChangeNotifier implements LocalData {
  SyncController({
    required this.session,
    required this.databaseDirectory,
    required this.deviceStore,
    required this.teamApi,
    required this.deviceApi,
    required this.boot,
    required this.platform,
    required this.appVersion,
    this.autoSync = true,
    this.interval = const Duration(seconds: 20),
    DateTime Function()? now,
    this.monotonic,
  }) : _now = now ?? DateTime.now {
    session.addListener(_onSession);
  }

  final SessionController session;

  /// Where the databases live (application support, excluded from backups).
  final Future<String> Function() databaseDirectory;
  final SecureStore deviceStore;

  /// The API as the signed-in person in [teamId].
  final SineobexApi Function(String teamId) teamApi;

  /// The API without a sign-in, for requests signed with the device key.
  final SineobexApi deviceApi;
  final BootClock boot;
  final RegisterDevicePlatform platform;
  final String appVersion;
  final bool autoSync;
  final Duration interval;
  final DateTime Function() _now;

  /// For the clock check between syncs (tests drive it; the app uses a Stopwatch).
  final Duration Function()? monotonic;

  LocalDatabase? _db;
  LocalStore? _store;
  SyncEngine? _engine;
  ClockSync? _clock;
  String? _userId;
  String? _teamId;
  Timer? _timer;
  bool _syncing = false;
  bool _offline = false;
  DateTime? _lastSyncedAt;
  Future<void>? _opening;
  int? _elsewhere = 0;

  LocalStore? get store => _store;
  SyncEngine? get engine => _engine;

  SyncSnapshot get snapshot {
    final store = _store;
    if (store == null) return const SyncSnapshot();
    return SyncSnapshot(
      open: true,
      unsynced: store.unsynced(),
      attention: store.needsAttention(),
      held: store.heldCount(),
      inReview: store.inReviewCount(),
      clock: _clock?.status ?? const ClockStatus(ClockState.unverified, null),
      syncing: _syncing,
      offline: _offline,
      lastSyncedAt: _lastSyncedAt,
      nextAttempt: _engine?.nextAttempt,
      elsewhere: _elsewhere,
    );
  }

  void _onSession() {
    final s = session.state;
    final key = session.databaseKey;
    if (s is Unlocked && key != null) {
      _deviceTimer?.cancel();
      _deviceTimer = null;
      if (autoSync && !_swept) {
        _swept = true;
        _sweeping = _sweepDropped(s.user, key).catchError((Object _) {});
      }
      final teamId = s.user.teamId;
      if (teamId == null) return _close();
      if (_userId == s.user.userId && _teamId == teamId && _db != null) return;
      _close();
      _opening = _open(s.user.userId, teamId, key);
    } else {
      _swept = false;
      _close();
      if (!autoSync || s is Starting) return;
      // Every lock, wrong PIN and sign-out asks again, and so does a timer while nobody is
      // signed in: a lost phone may sit at the lock screen with the app open for days.
      _deviceTimer ??= Timer.periodic(deviceCheckInterval, (_) => unawaited(checkDevices()));
      unawaited(checkDevices());
    }
  }

  /// How often a locked or signed-out phone asks whether it must wipe.
  static const deviceCheckInterval = Duration(minutes: 5);
  Timer? _deviceTimer;
  Future<void>? _checking;
  Future<void>? _sweeping;

  /// This unlock's sweep of dropped teams has started. (A flag, not the key: the key must leave
  /// memory with the lock.)
  bool _swept = false;

  /// Asks, with each team's device key, whether an admin asked to wipe this phone's data, for
  /// every database on the phone that isn't open: the locked person's (including teams no longer
  /// in their profile) and data kept by people who signed out. Deleting the files needs no key;
  /// handing unsynced work to quarantine does, so that waits for an unlock ([_sweepDropped]).
  /// Runs one check at a time; the returned future completes when it is done.
  Future<void> checkDevices() => _checking ??= (() {
    checksStarted++;
    // Bounded, so one answer that never finishes can't block every later check.
    return _checkDevices().timeout(checkTimeout).catchError((Object _) {}).whenComplete(() => _checking = null);
  })();

  static const checkTimeout = Duration(minutes: 2);

  /// How many device checks have started (tests use it to see that a lock asks by itself).
  @visibleForTesting
  int checksStarted = 0;

  Future<void> _checkDevices() async {
    final dir = await databaseDirectory();
    final s = session.state;
    final locked = s is Locked ? s.user : null;
    final open = s is Unlocked ? s.user.userId : null;
    final users = {...await session.keptUsers(), ?locked?.userId}..remove(open);
    for (final userId in users) {
      final device = DeviceIdentity(store: deviceStore, userId: userId);
      var wiped = 0;
      for (final path in LocalDatabase.filesForUser(dir, userId)) {
        final teamId = LocalDatabase.teamOf(path);
        final deviceId = await device.existingDeviceId(teamId);
        // A device ID made offline was never registered: the server can't know it or order its wipe.
        if (deviceId == null || !await device.isRegistered(teamId)) continue;
        final requests = DeviceRequests(api: deviceApi, device: device, now: _now);
        final DeviceStatusResult status;
        try {
          status = await requests.status(deviceId);
        } on Exception {
          continue; // This file stays as it is; the others are still checked.
        }
        if (!_wipeOrdered(status.status)) continue;
        // The person may have unlocked meanwhile and opened this very file.
        if (_db?.path == path) continue;
        LocalDatabase.deleteFiles(path);
        try {
          await requests.confirmWiped(deviceId);
        } on Exception {
          // Shown as "wipe requested" until the phone reaches the server again.
        }
        await device.forgetTeam(teamId);
        await session.dropTeam(teamId, userId: userId);
        wiped++;
      }
      if (wiped == 0 || LocalDatabase.filesForUser(dir, userId).isNotEmpty) continue;
      final now = session.state;
      if (now is Locked && now.user.userId == userId) {
        await session.endAfterWipe('An administrator erased Sineobex data on this phone.');
      } else {
        await session.forgetKeptUser(userId);
      }
    }
  }

  /// Only an explicit order deletes anything. A status this app version doesn't know keeps the
  /// data: a newer server's new state must never read as "wipe".
  static bool _wipeOrdered(DeviceStatus status) => status == DeviceStatus.wipeRequested || status == DeviceStatus.wiped;

  /// Teams that dropped out of the person's profile (removed or suspended while the phone was
  /// away) can't be opened from the team picker, so their databases are dealt with at unlock:
  /// wiped on an admin's order, or, when the person's access ended, handed to quarantine and then
  /// wiped, as an open team would be.
  Future<void> _sweepDropped(LocalUser user, Uint8List key) async {
    final dir = await databaseDirectory();
    final device = DeviceIdentity(store: deviceStore, userId: user.userId);
    for (final path in LocalDatabase.filesForUser(dir, user.userId)) {
      final teamId = LocalDatabase.teamOf(path);
      if (user.teams.any((t) => t.id == teamId)) continue;
      final deviceId = await device.existingDeviceId(teamId);
      if (deviceId == null || !await device.isRegistered(teamId)) continue;
      final DeviceStatusResult status;
      try {
        status = await DeviceRequests(api: deviceApi, device: device, now: _now).status(deviceId);
      } on Exception {
        continue;
      }
      if (!identical(session.databaseKey, key)) return; // Locked meanwhile: the next unlock tries again.
      if (_wipeOrdered(status.status)) {
        await _wipeFile(path, device, deviceId, teamId);
      } else if (status.status == DeviceStatus.active && status.access == DeviceStatusResultAccess.removed) {
        final db = LocalDatabase.open(path, key);
        final clock = ClockSync(boot: boot, references: DatabaseClockReferences(db), wallNow: _now);
        final store = LocalStore(db, userId: user.userId, stamp: clock.stamp, now: _now)
          ..freeze('Your access to this team ended.');
        final engine = SyncEngine(
          store: store,
          api: deviceApi,
          device: device,
          clock: clock,
          teamId: teamId,
          platform: platform,
          appVersion: appVersion,
          now: _now,
        );
        var handedOver = false;
        try {
          handedOver = _covers(await engine.uploadToQuarantine(), store);
        } on Exception {
          // Tried again at the next unlock.
        } finally {
          db.close();
        }
        if (handedOver) await _wipeFile(path, device, deviceId, teamId);
      }
    }
    final open = _store;
    if (identical(session.databaseKey, key) && open != null) {
      _elsewhere = _count(LocalDatabase.filesForUser(dir, user.userId).where((f) => f != open.path), key);
      notifyListeners();
    }
  }

  Future<void> _wipeFile(String path, DeviceIdentity device, String deviceId, String teamId) async {
    LocalDatabase.deleteFiles(path);
    try {
      await DeviceRequests(api: deviceApi, device: device, now: _now).confirmWiped(deviceId);
    } on Exception {
      // The admin page still shows "wipe requested"; the data is gone either way.
    }
    await device.forgetTeam(teamId);
  }

  /// The server holds every unconfirmed change in [store] (that it could read at all).
  static bool _covers(Set<String>? held, LocalStore store) =>
      (held ?? const <String>{}).containsAll(store.handOverIds());

  /// Waits for the database the current session opened, and for the unlock's sweep of teams no
  /// longer in the profile (tests use this).
  Future<void> ready() async {
    await _opening;
    await _sweeping;
  }

  /// Bumped by every open and close: an open that a newer one or a close overtook while it
  /// waited stops, so no second connection (with the key) or timer outlives the lock.
  int _openToken = 0;

  Future<void> _open(String userId, String teamId, Uint8List key) async {
    final token = ++_openToken;
    final dir = await databaseDirectory();
    Directory(dir).createSync(recursive: true);
    final booted = await boot.read();
    if (token != _openToken) return;
    // The session may have locked or changed team while we waited. From the open to `_db = db`
    // nothing awaits, so no device check can delete this file while it is open.
    final s = session.state;
    if (s is! Unlocked || s.user.userId != userId || s.user.teamId != teamId || !identical(session.databaseKey, key)) {
      return;
    }
    final db = LocalDatabase.open(LocalDatabase.fileFor(dir, userId, teamId), key);
    final others = LocalDatabase.filesForUser(dir, userId).where((f) => f != db.path).toList();
    if (booted != null) _shareClockReference(db, others, key, booted.bootId);
    final clock = ClockSync(boot: boot, references: DatabaseClockReferences(db), wallNow: _now, monotonic: monotonic);
    final store = LocalStore(
      db,
      userId: userId,
      stamp: clock.stamp,
      chartingPaused: () => clock.status.paused,
      now: _now,
    );
    _db = db;
    _clock = clock;
    _store = store;
    _userId = userId;
    _teamId = teamId;
    _elsewhere = _count(others, key);
    _engine = SyncEngine(
      store: store,
      api: teamApi(teamId),
      device: DeviceIdentity(store: deviceStore, userId: userId),
      clock: clock,
      teamId: teamId,
      platform: platform,
      appVersion: appVersion,
      now: _now,
      random: Random.secure(),
    );
    await clock.check();
    if (token != _openToken) return;
    notifyListeners();
    if (autoSync) {
      _timer?.cancel();
      _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
      unawaited(syncNow());
    }
  }

  /// Gives [db] the newest clock reference any of this person's databases measured since boot.
  static void _shareClockReference(LocalDatabase db, List<String> others, Uint8List key, String bootId) {
    final mine = DatabaseClockReferences(db);
    final theirs = <String?>[];
    for (final path in others) {
      try {
        final other = LocalDatabase.open(path, key);
        try {
          theirs.add(DatabaseClockReferences(other).readClockReference());
        } finally {
          other.close();
        }
      } catch (_) {
        // Unreadable: its unsynced count says so; the clock just doesn't use it.
      }
    }
    final current = mine.readClockReference();
    final best = DatabaseClockReferences.newest([current, ...theirs], bootId);
    if (best != null && best != current) mine.writeClockReference(best);
  }

  void _close() {
    _openToken++;
    _timer?.cancel();
    _timer = null;
    _db?.close();
    _db = null;
    _store = null;
    _engine = null;
    _clock = null;
    _userId = null;
    _teamId = null;
    _opening = null;
    _elsewhere = 0;
    notifyListeners();
  }

  Future<void> _tick() async {
    await _clock?.check();
    final store = _store;
    if (store != null && store.sendable(limit: 1).isNotEmpty) await syncNow(force: false);
    notifyListeners();
  }

  /// Rechecks the clock when the app comes back to the foreground. [fresh] ("Check again") asks
  /// the server for its time first, so a clock the person just fixed is seen right away.
  Future<ClockStatus?> checkClock({bool fresh = false}) async {
    final engine = _engine;
    final status = fresh && engine != null ? await engine.refreshClock() : await _clock?.check();
    notifyListeners();
    return status;
  }

  /// The app went to the background (see [ClockSync.suspend]).
  void suspendClock() => _clock?.suspend();

  /// The person's choice on a conflict card, sent at once. False when the card was out of date
  /// (a newer conflict arrived for the field); the screen redraws with the current values.
  Future<bool> resolveConflict(String changeId, {required bool keepMine}) async {
    final store = _store;
    if (store == null) return false;
    final done = store.resolveConflict(changeId, keepMine: keepMine);
    notifyListeners();
    if (done) await syncNow();
    return done;
  }

  /// Sends what is waiting. [force] ignores the backoff ("Sync now", the sign-out progress).
  Future<SyncOutcome?> syncNow({bool force = true}) async {
    final engine = _engine;
    if (engine == null || _syncing) return null;
    _syncing = true;
    notifyListeners();
    SyncOutcome outcome;
    try {
      outcome = await engine.syncAll(force: force);
    } finally {
      _syncing = false;
    }
    _offline = outcome is SyncOffline;
    if (outcome is SyncDone) {
      _lastSyncedAt = _now();
      // The server took a push, so access is back (a removal undone before the hand-over ended).
      if (identical(engine, _engine)) engine.store.unfreeze();
    }
    if (identical(engine, _engine)) {
      switch (outcome) {
        case SyncWipeRequested():
          await _wipeTeam(engine, 'An administrator erased this team’s data on this phone.');
        case SyncAccessLost():
          await _checkAccess(engine);
        default:
          break;
      }
    }
    notifyListeners();
    return outcome;
  }

  /// The server refused the sign-in. Ask with the device key what happened before acting.
  ///
  /// Every await here can outlast the team being open (the app locks, or the person switches
  /// team), so each step checks [engine] is still the open one before acting on its database.
  Future<void> _checkAccess(SyncEngine engine) async {
    final DeviceStatusResult? status;
    try {
      status = await _signedEngine(engine).signedStatus();
    } on Exception {
      return; // Offline or unknown: keep everything and try again later.
    }
    if (status == null || !identical(engine, _engine)) return;
    if (_wipeOrdered(status.status)) {
      await _wipeTeam(engine, 'An administrator erased this team’s data on this phone.');
    } else if (status.status == DeviceStatus.active && status.access == DeviceStatusResultAccess.removed) {
      // Hand over what never synced, so no care record is lost, then wipe. Nothing new may be
      // written from now on: a change saved during the upload would miss it and be wiped.
      engine.store.freeze('Your access to this team ended. Saved records are being sent to a Program Admin.');
      final Set<String>? held;
      try {
        held = await _signedEngine(engine).uploadToQuarantine();
      } on Exception {
        return; // Tried again at the next sync.
      }
      if (!identical(engine, _engine)) return; // Closed mid-upload: the next open starts over.
      // Without a device key nothing can be handed over, so unsynced work stays (encrypted).
      if (!_covers(held, engine.store)) return;
      await _wipeTeam(
        engine,
        'Your access to this team ended. Records that hadn’t synced were sent to a Program Admin to review.',
      );
    }
  }

  /// The same engine, talking to the API without a sign-in (device-key requests).
  SyncEngine _signedEngine(SyncEngine e) => SyncEngine(
    store: e.store,
    api: deviceApi,
    device: e.device,
    clock: e.clock,
    teamId: e.teamId,
    platform: platform,
    appVersion: appVersion,
    now: _now,
  );

  /// Remote wipe: the one time unconfirmed data is deleted (module 9), and only on the server's
  /// word to this device key. The wipe is confirmed to the server when it can be reached.
  ///
  /// Everything comes from [engine], never from what is open now: the person may have switched
  /// team while the device-key requests were in flight, and the open team is not the one wiped.
  Future<void> _wipeTeam(SyncEngine engine, String notice) async {
    final userId = engine.store.userId;
    final teamId = engine.teamId;
    final path = engine.store.path;
    if (_db?.path == path) _close();
    LocalDatabase.deleteFiles(path);
    final deviceId = await engine.device.existingDeviceId(teamId);
    if (deviceId != null) {
      try {
        await _signedEngine(engine).confirmWiped(deviceId);
      } on Exception {
        // The admin page still shows "wipe requested"; the data is gone either way.
      }
    }
    await engine.device.forgetTeam(teamId);
    final user = switch (session.state) {
      Unlocked(:final user) || Locked(:final user) => user,
      _ => null,
    };
    if (user == null || user.userId != userId) return;
    if (user.teams.every((t) => t.id == teamId)) {
      await session.endAfterWipe(notice);
    } else {
      await session.dropTeam(teamId, userId: userId);
    }
  }

  /// Deletes every database this user has here (sign-out with nothing pending, wrong-PIN wipe).
  /// An open database is closed first.
  Future<void> eraseUser(String userId) async {
    if (_userId == userId) _close();
    final dir = await databaseDirectory();
    for (final path in LocalDatabase.filesForUser(dir, userId)) {
      LocalDatabase.deleteFiles(path);
    }
  }

  @override
  Future<bool> hasAny(String userId) async => LocalDatabase.filesForUser(await databaseDirectory(), userId).isNotEmpty;

  @override
  Future<int?> unsynced(String userId, Uint8List key) async =>
      _count(LocalDatabase.filesForUser(await databaseDirectory(), userId), key);

  @override
  Future<void> erase(String userId) => eraseUser(userId);

  /// Unsynced changes across [paths]; null if any of them can't be read with [key].
  int? _count(Iterable<String> paths, Uint8List key) {
    var total = 0;
    for (final path in paths) {
      final open = _store;
      if (open != null && open.path == path) {
        total += open.unsynced().total;
        continue;
      }
      try {
        final db = LocalDatabase.open(path, key);
        try {
          total += LocalStore.unsyncedIn(db);
        } finally {
          db.close();
        }
      } catch (_) {
        return null;
      }
    }
    return total;
  }

  @override
  void dispose() {
    _deviceTimer?.cancel();
    session.removeListener(_onSession);
    _close();
    super.dispose();
  }
}
