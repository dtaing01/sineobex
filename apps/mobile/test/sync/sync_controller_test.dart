import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
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
    vault = KeyVault(store: store, biometricStore: MemorySecureStore(), pbkdf2Iterations: 1000);
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
}
