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
}

/// Opens the person's encrypted database while the app is unlocked, keeps it syncing, and acts on
/// what the server says about the phone (module 9).
///
/// The database closes when the app locks, so the key leaves memory with the lock. A remote wipe
/// or removal from the team is acted on only after the server confirms it to this phone's device
/// key; a refused sign-in alone never deletes anything.
class SyncController extends ChangeNotifier {
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
    );
  }

  void _onSession() {
    final s = session.state;
    final key = session.databaseKey;
    if (s is Unlocked && s.user.teamId != null && key != null) {
      if (_userId == s.user.userId && _teamId == s.user.teamId && _db != null) return;
      _close();
      _opening = _open(s.user.userId, s.user.teamId!, key);
    } else {
      _close();
      if (s is Locked && autoSync && !identical(s.user, _checkedWhileLocked)) {
        _checkedWhileLocked = s.user;
        unawaited(checkWhileLocked(s.user).catchError((Object _) {}));
      }
    }
  }

  LocalUser? _checkedWhileLocked;

  /// A lost phone may never be unlocked again, so while it sits at the lock screen it asks, with
  /// its device key, whether an admin asked to wipe it. Deleting the files needs no key. (Handing
  /// unsynced work to quarantine does, so that waits for an unlock.)
  Future<void> checkWhileLocked(LocalUser user) async {
    final dir = await databaseDirectory();
    final device = DeviceIdentity(store: deviceStore, userId: user.userId);
    var wiped = 0;
    for (final team in user.teams) {
      final deviceId = await device.existingDeviceId(team.id);
      if (deviceId == null) continue;
      final requests = DeviceRequests(api: deviceApi, device: device, now: _now);
      final status = await requests.status(deviceId);
      if (status.status == DeviceStatus.active) continue;
      LocalDatabase.deleteFiles(LocalDatabase.fileFor(dir, user.userId, team.id));
      try {
        await requests.confirmWiped(deviceId);
      } on Exception {
        // Shown as "wipe requested" until the phone reaches the server again.
      }
      await device.forgetTeam(team.id);
      await session.dropTeam(team.id);
      wiped++;
    }
    if (wiped > 0 && LocalDatabase.filesForUser(dir, user.userId).isEmpty) {
      await session.endAfterWipe('An administrator erased Sineobex data on this phone.');
    }
  }

  /// Waits for the database the current session opened (tests and the first screen use this).
  Future<void> ready() => _opening ?? Future.value();

  Future<void> _open(String userId, String teamId, Uint8List key) async {
    final dir = await databaseDirectory();
    Directory(dir).createSync(recursive: true);
    // The session may have locked while we waited.
    if (session.state is! Unlocked || session.databaseKey == null) return;
    final db = LocalDatabase.open(LocalDatabase.fileFor(dir, userId, teamId), key);
    final clock = ClockSync(boot: boot, references: DatabaseClockReferences(db), wallNow: _now);
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
    notifyListeners();
    if (autoSync) {
      _timer = Timer.periodic(interval, (_) => unawaited(_tick()));
      unawaited(syncNow());
    }
  }

  void _close() {
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
    notifyListeners();
  }

  Future<void> _tick() async {
    await _clock?.check();
    final store = _store;
    if (store != null && store.sendable(limit: 1).isNotEmpty) await syncNow(force: false);
    notifyListeners();
  }

  /// Rechecks the clock ("Check again", and when the app comes back to the foreground).
  Future<ClockStatus?> checkClock() async {
    final status = await _clock?.check();
    notifyListeners();
    return status;
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
    if (outcome is SyncDone) _lastSyncedAt = _now();
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
  Future<void> _checkAccess(SyncEngine engine) async {
    final DeviceStatusResult? status;
    try {
      status = await _signedEngine(engine).signedStatus();
    } on Exception {
      return; // Offline or unknown: keep everything and try again later.
    }
    if (status == null) return;
    if (status.status != DeviceStatus.active) {
      await _wipeTeam(engine, 'An administrator erased this team’s data on this phone.');
    } else if (status.access == DeviceStatusResultAccess.removed) {
      // Hand over what never synced, so no care record is lost, then wipe.
      final handedOver = await _signedEngine(engine).uploadToQuarantine().catchError((Object _) => false);
      if (handedOver) {
        await _wipeTeam(
          engine,
          'Your access to this team ended. Records that hadn’t synced were sent to a Program Admin to review.',
        );
      }
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
  Future<void> _wipeTeam(SyncEngine engine, String notice) async {
    final userId = _userId;
    final teamId = _teamId;
    if (userId == null || teamId == null) return;
    final deviceId = await engine.device.existingDeviceId(teamId);
    final path = _db?.path;
    _close();
    if (path != null) LocalDatabase.deleteFiles(path);
    if (deviceId != null) {
      try {
        await _signedEngine(engine).confirmWiped(deviceId);
      } on Exception {
        // The admin page still shows "wipe requested"; the data is gone either way.
      }
    }
    await engine.device.forgetTeam(teamId);
    final s = session.state;
    final otherTeams = s is Unlocked ? s.user.teams.where((t) => t.id != teamId).toList() : const <TeamRef>[];
    if (otherTeams.isEmpty) {
      await session.endAfterWipe(notice);
    } else {
      await session.dropTeam(teamId);
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
  void dispose() {
    session.removeListener(_onSession);
    _close();
    super.dispose();
  }
}
