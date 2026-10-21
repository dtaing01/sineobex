import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/device_identity.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../auth/fakes.dart';
import 'fake_server.dart';
import 'phone_harness.dart';

/// The controller with its automatic checks on, as on a real phone: remote wipe while locked or
/// signed out, teams that dropped out of the profile, and the clock across teams. (Second review.)
void main() {
  const pin = '482913';
  final userId = demoUser().userId;
  late Directory dir;
  late FakeSyncServer server;
  late MemorySecureStore store;
  late _HeldStore vaultStore;
  late KeyVault vault;
  late FakeBootClock boot;
  late SessionController session;
  late SyncController sync;
  late DateTime wall;
  var profileTeams = <String>['team-0'];

  LocalUser me() {
    final all = demoUser(teams: 2);
    return LocalUser(
      userId: all.userId,
      email: all.email,
      displayName: all.displayName,
      teams: all.teams.where((t) => profileTeams.contains(t.id)).toList(),
    );
  }

  /// A fresh app process on the same phone: the keystore and the files stay.
  Future<void> launch() async {
    session = SessionController(
      auth: FakeAuth(),
      vault: vault,
      store: store,
      fetchMe: (_) async => me(),
      localData: DeferredLocalData(() => sync),
    );
    sync = SyncController(
      session: session,
      databaseDirectory: () async => dir.path,
      deviceStore: store,
      teamApi: (teamId) => SineobexApi(server.transportFor(userId, teamId)),
      deviceApi: SineobexApi(server.transportFor('', '')),
      boot: boot,
      platform: RegisterDevicePlatform.android,
      appVersion: '0.2.0-test',
      interval: const Duration(hours: 1),
      now: () => wall,
      monotonic: () => boot.elapsed,
    );
    await session.start();
    // Opening the app asks by itself, signed out or locked.
    expect(sync.checksStarted, 1);
    await sync.checkDevices();
  }

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('controller');
    wall = DateTime.utc(2026, 10, 20, 15);
    profileTeams = ['team-0'];
    server = FakeSyncServer(now: () => wall);
    store = MemorySecureStore();
    vaultStore = _HeldStore(store);
    vault = KeyVault(store: vaultStore, biometricStore: MemorySecureStore(), pbkdf2Iterations: 1000);
    boot = FakeBootClock();
    await launch();
  });
  tearDown(() {
    sync.dispose();
    dir.deleteSync(recursive: true);
  });

  /// Waits for the open, the unlock sweep and the first sync to finish.
  Future<void> idle() async {
    await sync.ready();
    for (var i = 0; i < 400 && sync.snapshot.syncing; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  Future<void> signIn() async {
    await session.signIn('clinician@example.com', validPassword);
    await session.verifyCode(validCode);
    if (session.state is NeedsPin) {
      await session.setPin(pin);
    } else {
      await sync.checkDevices();
      await session.unlockWithPin(pin);
    }
    await idle();
  }

  Future<void> openTeam(String teamId) async {
    await session.selectTeam(teamId);
    await idle();
  }

  Future<void> lock() async {
    final before = sync.checksStarted;
    await session.lock();
    expect(sync.checksStarted, greaterThan(before), reason: 'every lock asks by itself');
    await sync.checkDevices();
  }

  bool teamFile(String teamId) => File(LocalDatabase.fileFor(dir.path, userId, teamId)).existsSync();
  String deviceOf(String teamId) => server.devices.entries.firstWhere((d) => d.value.teamId == teamId).key;

  test('a locked phone asks on every lock whether to wipe, and wipes when told', () async {
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    await lock();
    expect(teamFile('team-0'), isTrue);
    await session.unlockWithPin(pin);
    await idle();
    // Before: only the first lock of an app process asked.
    server.devices[deviceOf('team-0')]!.status = 'wipe_requested';
    await lock();
    expect(teamFile('team-0'), isFalse);
    expect(session.state, isA<SignedOut>());
    expect(server.devices[deviceOf('team-0')]!.status, 'wiped');
  });

  test('data kept by a sign-out at the lock screen can still be wiped, after a restart too', () async {
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    await lock();
    final before = sync.checksStarted;
    await session.signOut();
    expect(sync.checksStarted, greaterThan(before), reason: 'signing out asks by itself');
    await sync.checkDevices();
    expect(teamFile('team-0'), isTrue);
    expect(await session.keptUsers(), [userId]);

    server.devices[deviceOf('team-0')]!.status = 'wipe_requested';
    sync.dispose();
    await launch();
    expect(session.state, isA<SignedOut>());
    expect(teamFile('team-0'), isFalse);
    expect(await session.keptUsers(), isEmpty);
    expect(await vault.hasVault(userId), isFalse);
    expect(server.devices[deviceOf('team-0')]!.status, 'wiped');
  });

  test('a status this app version doesn’t know never deletes anything', () async {
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    server.devices[deviceOf('team-0')]!.status = 'suspended';
    final outcome = await sync.syncNow();
    expect((outcome! as SyncFailed).code, 'device_status_unknown');
    expect(sync.store!.unsynced().total, 1);
    await lock();
    expect(teamFile('team-0'), isTrue);
  });

  test('a team that dropped out of the profile hands its unsynced work to quarantine at unlock', () async {
    profileTeams = ['team-0', 'team-1'];
    await signIn();
    await openTeam('team-1');
    server.offline = true;
    sync.store!.createEncounter(kind: 'medical');
    final waiting = sync.store!.outbox().single.changeId;
    await openTeam('team-0');
    await session.signOut(keepUnsynced: true);
    server.offline = false;
    // Removed from team 1 while signed out: it is gone from /v1/me and the team picker.
    server.removedFromTeam.add('$userId/team-1');
    profileTeams = ['team-0'];
    await signIn();
    expect(server.quarantine.keys, [waiting]);
    expect(teamFile('team-1'), isFalse);
    expect(teamFile('team-0'), isTrue);
    expect(server.devices[deviceOf('team-1')]!.status, 'wiped');
    expect(sync.snapshot.elsewhere, 0);
  });

  test('a clock another team found to be off pauses charting in this team too', () async {
    profileTeams = ['team-0', 'team-1'];
    await signIn();
    await openTeam('team-0');
    expect(sync.snapshot.clock.state.name, 'verified');
    wall = wall.subtract(const Duration(hours: 2));
    await sync.checkClock();
    expect(sync.snapshot.clock.paused, isTrue);
    server.offline = true;
    await openTeam('team-1');
    expect(sync.snapshot.clock.paused, isTrue);
    expect(() => sync.store!.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
  });

  // ---- third review ----

  for (final (moment, heldKey) in [('checking the PIN', 'dbkey.pin'), ('finishing the unlock', 'bio.enabled')]) {
    test('a wipe that lands while the person is $moment stops the unlock', () async {
      await signIn();
      sync.store!.createEncounter(kind: 'medical');
      await lock();
      server.devices[deviceOf('team-0')]!.status = 'wipe_requested';
      // The unlock is waiting on the keystore when the wipe lands.
      vaultStore
        ..heldKey = heldKey
        ..hold = Completer<void>();
      final unlocking = session.unlockWithPin(pin);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      await sync.checkDevices();
      expect(session.state, isA<SignedOut>());
      vaultStore.hold!.complete();
      await unlocking;
      expect(session.state, isA<SignedOut>());
      expect(session.databaseKey, isNull);
      await sync.ready();
      expect(sync.store, isNull);
      expect(LocalDatabase.filesForUser(dir.path, userId), isEmpty);
    });
  }

  test('a wipe that lands while signing in again leaves no sign-in behind for the wiped person', () async {
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    await lock();
    await session.signOut();
    server.devices[deviceOf('team-0')]!.status = 'wipe_requested';
    // Signing in again on this phone asks for the same PIN; the wipe lands during it.
    await session.signIn('clinician@example.com', validPassword);
    await session.verifyCode(validCode);
    vaultStore.hold = Completer<void>();
    final unlocking = session.unlockWithPin(pin);
    await Future<void>.delayed(const Duration(milliseconds: 50));
    await sync.checkDevices();
    vaultStore.hold!.complete();
    await unlocking;
    expect(session.state, isA<SignedOut>());
    expect(await store.read('u:$userId:refresh'), isNull);
    expect(await store.read('current.user'), isNull);
  });

  test('a device the server can’t answer for doesn’t stop the rest of the check', () async {
    profileTeams = ['team-0', 'team-1'];
    server.offline = true;
    await signIn();
    // Team 0 was first opened offline: its device ID was never registered.
    await openTeam('team-0');
    sync.store!.createEncounter(kind: 'medical');
    server.offline = false;
    await openTeam('team-1');
    server.devices[deviceOf('team-1')]!.status = 'wipe_requested';
    var statusCalls = 0;
    server.onRequest = (path) {
      if (path.endsWith('/status')) statusCalls++;
    };
    await lock();
    expect(teamFile('team-1'), isFalse);
    expect(teamFile('team-0'), isTrue);
    expect(statusCalls, 1, reason: 'the unregistered device is not asked about');
  });

  test('a failed status request skips only its own team', () async {
    profileTeams = ['team-0', 'team-1'];
    await signIn();
    await openTeam('team-0');
    await openTeam('team-1');
    sync.store!.createEncounter(kind: 'medical');
    final failing = deviceOf('team-0');
    server.devices[deviceOf('team-1')]!.status = 'wipe_requested';
    server.onRequest = (path) {
      if (path.contains(failing)) throw const NetworkException('timeout');
    };
    await lock();
    expect(teamFile('team-1'), isFalse);
    expect(teamFile('team-0'), isTrue);
  });

  test('dropping a team acts only for the person it was meant for', () async {
    profileTeams = ['team-0', 'team-1'];
    await signIn();
    await openTeam('team-0');
    await session.dropTeam('team-0', userId: 'someone-else');
    expect((session.state as Unlocked).user.teams.map((t) => t.id), ['team-0', 'team-1']);
    expect(sync.store, isNotNull);
  });

  test('a hand-over that couldn’t finish stops freezing charting once sync works again', () async {
    await signIn();
    server.removedFromTeam.add('$userId/team-0');
    server.onRequest = (path) {
      if (path.endsWith('/quarantine')) throw const NetworkException('offline');
    };
    sync.store!.createEncounter(kind: 'medical');
    await sync.syncNow();
    expect(() => sync.store!.createEncounter(kind: 'medical'), throwsA(isA<ChartingPaused>()));
    // Removed by mistake, and added back.
    server.removedFromTeam.clear();
    server.onRequest = null;
    expect(await sync.syncNow(), isA<SyncDone>());
    sync.store!.createEncounter(kind: 'medical');
  });

  test('a removal keeps changes the server couldn’t read on the phone, locked, and says so', () async {
    // Review finding: the hand-over left them out and the wipe then deleted them, while the notice
    // said every unsynced record had been sent.
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    sync.store!.createEncounter(kind: 'non_medical');
    final unreadable = sync.store!.outbox().last;
    server.malformed.add(unreadable.changeId);
    await sync.syncNow();
    expect(sync.store!.entry(unreadable.changeId)!.state, ChangeState.rejected);
    server.malformed.clear();
    sync.store!.createEncounter(kind: 'medical');
    server.removedFromTeam.add('$userId/team-0');
    await sync.syncNow();
    // Both readable encounters reach the Program Admin; the unreadable one can't.
    expect(server.quarantine, hasLength(2));
    expect(server.quarantine.keys, isNot(contains(unreadable.changeId)));
    expect(teamFile('team-0'), isTrue);
    expect(session.state, isA<Unlocked>());
    expect(sync.snapshot.frozen, contains('couldn’t be sent'));
    expect(sync.store!.entry(unreadable.changeId), isNotNull);
  });

  test('a wipe whose confirmation couldn’t be sent is confirmed later, after a restart too', () async {
    // Review finding: the device ID was forgotten anyway, so the server and the admin's page
    // showed "wipe requested" forever.
    await signIn();
    sync.store!.createEncounter(kind: 'medical');
    final device = deviceOf('team-0');
    server.devices[device]!.status = 'wipe_requested';
    server.onRequest = (path) {
      if (path.endsWith('/wiped')) throw const NetworkException('offline');
    };
    await lock();
    expect(teamFile('team-0'), isFalse);
    expect(server.devices[device]!.status, 'wipe_requested');
    expect(await UnconfirmedWipes(store).all(), hasLength(1));
    server.onRequest = null;
    sync.dispose();
    await launch();
    expect(server.devices[device]!.status, 'wiped');
    expect(await UnconfirmedWipes(store).all(), isEmpty);
  });

  test('work charted under a device ID the server counts as wiped is kept and syncs under a new one', () async {
    // Review finding: 'wiped' was read as a wipe order, deleting work no admin ordered erased.
    await signIn();
    final spent = deviceOf('team-0');
    // As if this phone's earlier wipe was confirmed but forgetting the ID didn't finish.
    server.devices[spent]!.status = 'wiped';
    final encounter = sync.store!.createEncounter(kind: 'medical');
    expect(await sync.syncNow(), isA<SyncDeviceSpent>());
    expect(teamFile('team-0'), isTrue);
    expect(await sync.syncNow(), isA<SyncDone>());
    expect(server.records[encounter], isNotNull);
    expect(server.devices.keys.where((d) => d != spent && server.devices[d]!.teamId == 'team-0'), hasLength(1));
  });

  test('a wipe the app didn’t finish completes before the team can be opened', () async {
    await signIn();
    final kept = sync.store!.createEncounter(kind: 'medical');
    await lock();
    // The app died after writing the wipe down, before deleting the file.
    await UnconfirmedWipes(store)
        .put(UnconfirmedWipe(userId: userId, teamId: 'team-0', deviceId: deviceOf('team-0'), wipedAt: wall));
    server.offline = true;
    await session.unlockWithPin(pin);
    await idle();
    expect(sync.store!.record(kept), isNull);
    expect(sync.store!.unsynced().total, 0);
  });
}

/// The vault's keystore, with a way to hold a read of the wrapped key after it has been read (a
/// PIN or biometric check in progress).
class _HeldStore implements SecureStore {
  _HeldStore(this.inner);
  final SecureStore inner;
  Completer<void>? hold;
  String heldKey = 'dbkey.pin';

  @override
  Future<String?> read(String key) async {
    final value = await inner.read(key);
    final h = hold;
    if (h != null && key.endsWith(heldKey)) await h.future;
    return value;
  }

  @override
  Future<void> write(String key, String value) => inner.write(key, value);
  @override
  Future<void> delete(String key) => inner.delete(key);
  @override
  Future<Map<String, String>> readAll() => inner.readAll();
}
