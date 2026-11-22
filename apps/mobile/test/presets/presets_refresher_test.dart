import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/app_providers.dart' show appRefreshers;
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/presets/presets_refresher.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../auth/fakes.dart';
import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import 'presets_stand_in.dart';

final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));
final wall = DateTime.utc(2026, 11, 2, 10, 42);

/// The pull that keeps the phone's copy of its team's presets current (phase 5 design 6.1): what it
/// sends, what a pull cut short leaves, a 403, and an answer that comes back when the database it
/// was asked for is no longer the one open. `GET /v1/presets` is a stand-in that answers as each
/// test writes (presets_stand_in.dart): the rules here are the phone's, given an answer.
///
/// Written ahead of P2-store (with P2-local-db's table and P2-models' parser), whose code, and
/// whose line in `appRefreshers`, make it pass.
void main() {
  /// As the engine runs a refresher: a failed pull is the next run's to retry, and never thrown
  /// further (SyncEngine.runRefreshers). Code not written yet still fails the test.
  Future<void> runQuietly(AfterSyncRefresher refresher, [RefreshReason reason = RefreshReason.manual]) async {
    try {
      await refresher.refresh(reason);
    } on UnimplementedError {
      rethrow;
    } on Object {
      // The engine swallows it.
    }
  }

  /// Waits for [done], as long as a local answer could take.
  Future<void> until(bool Function() done) async {
    for (var i = 0; i < 400 && !done(); i++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  const noCopy = {'rows': <String, Object?>{}, 'keys': <String, Object?>{}};

  group('the refresher', () {
    const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
    const team = 'team-1';
    late Directory dir;
    late LocalDatabase db;
    late LocalStore store;
    late PresetStore presets;
    late PresetsStandIn standIn;
    late PresetsRefresher refresher;
    var open = true;

    LocalStore storeOf(LocalDatabase d) => LocalStore(
      d,
      userId: userId,
      stamp: () => ClockStamp(deviceTime: wall, correctedTime: wall, verified: true),
      now: () => wall,
    );

    setUp(() {
      dir = Directory.systemTemp.createTempSync('presets-refresher');
      db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, team), key);
      store = storeOf(db);
      presets = PresetStore(store, now: () => wall);
      standIn = PresetsStandIn();
      open = true;
      refresher = PresetsRefresher(presets, SineobexApi(standIn.transportFor(team)), current: () => open);
    });
    tearDown(() {
      db.close();
      dir.deleteSync(recursive: true);
    });

    Future<void> run([RefreshReason reason = RefreshReason.manual]) => runQuietly(refresher, reason);

    /// The copy at revision 3 under [epochA]: Labs and its glucose test.
    Future<void> holdThree() async {
      standIn.answers[team] = pullAnswer(
        reset: true,
        revision: 3,
        presets: [pulled(labsId, 'order_category', labs()), pulled(glucoseId, 'item', glucose())],
      );
      await run(RefreshReason.opened);
      expect(presets.revision, 3);
    }

    /// Runs a pull whose answer comes back only after [meanwhile] has happened.
    Future<void> answeredAfter(Object answer, void Function() meanwhile, {AfterSyncRefresher? by}) async {
      final hold = standIn.holds[team] = Completer<void>();
      standIn.answers[team] = answer;
      final asked = standIn.requests.length;
      final running = runQuietly(by ?? refresher);
      await until(() => standIn.requests.length > asked);
      expect(standIn.requests, hasLength(asked + 1), reason: 'the pull was sent');
      meanwhile();
      hold.complete();
      await running;
      standIn.holds.remove(team);
    }

    test('the first pull sends no since and no epoch; the next sends what the first wrote', () async {
      await holdThree();
      standIn.answers[team] = pullAnswer(revision: 4, presets: [pulled(footCheckId, 'bundle', footCheck())]);
      await run(RefreshReason.afterSync);
      expect(standIn.queriesOf(team), [
        <String, String>{},
        {'since': '3', 'epoch': epochA},
      ]);
      expect(presets.revision, 4);
      expect(presets.preset(footCheckId), isNotNull);
    });

    test('since and epoch are the kv keys as they stand', () async {
      store
        ..setKv('presets.revision', '41')
        ..setKv('presets.epoch', epochB);
      standIn.answers[team] = pullAnswer(revision: 41, epoch: epochB);
      await run();
      expect(standIn.queriesOf(team), [
        {'since': '41', 'epoch': epochB},
      ]);
    });

    test('it pulls at each open, after each sync that reached the server, and on pull to refresh', () async {
      final reasons = [RefreshReason.opened, RefreshReason.afterSync, RefreshReason.afterSync, RefreshReason.manual];
      for (final (i, reason) in reasons.indexed) {
        standIn.answers[team] = pullAnswer(reset: i == 0, revision: i + 1);
        await run(reason);
        expect(standIn.requests, hasLength(i + 1), reason: '${reason.name}, pull ${i + 1}');
        expect(presets.revision, i + 1, reason: '${reason.name}, pull ${i + 1}');
      }
    });

    test('a pull the network cuts off leaves the copy as it was, and the next asks from the same revision', () async {
      await holdThree();
      final held = copyIn(db.db);
      standIn.answers[team] = const NetworkException('timeout');
      await run(RefreshReason.afterSync);
      expect(copyIn(db.db), held);
      standIn.answers[team] = pullAnswer(revision: 5, presets: [pulled(footCheckId, 'bundle', footCheck())]);
      await run(RefreshReason.afterSync);
      expect(standIn.queriesOf(team).skip(1), [
        {'since': '3', 'epoch': epochA},
        {'since': '3', 'epoch': epochA},
      ]);
      expect(presets.revision, 5);
    });

    test('an answer cut off part way leaves the copy as it was', () async {
      await holdThree();
      final held = copyIn(db.db);
      for (final broken in [
        {'reset': true, 'revision': 9},
        pullAnswer(
          reset: true,
          revision: 9,
          presets: [
            pulled(frostRiskId, 'flag', frostRisk()),
            {'kind': 'flag', 'state': 'active'},
          ],
        ),
      ]) {
        standIn.answers[team] = broken;
        await run();
        expect(copyIn(db.db), held);
      }
      expect(standIn.queriesOf(team).skip(1), everyElement({'since': '3', 'epoch': epochA}));
    });

    test('a write cut short leaves the copy as it was, and the next pull asks the same again', () async {
      await holdThree();
      final held = copyIn(db.db);
      failWritesOf(db.db, footCheckId);
      standIn.answers[team] = pullAnswer(
        revision: 5,
        presets: [pulled(gauzeId, 'item', gauze()), pulled(footCheckId, 'bundle', footCheck())],
      );
      await run(RefreshReason.afterSync);
      expect(copyIn(db.db), held);
      writesWork(db.db);
      await run(RefreshReason.afterSync);
      expect(standIn.queriesOf(team).skip(1), [
        {'since': '3', 'epoch': epochA},
        {'since': '3', 'epoch': epochA},
      ]);
      expect(presets.presets().map((p) => p.id), containsAll([gauzeId, footCheckId]));
      expect(presets.revision, 5);
    });

    test('a 403 takes the copy and every key, and the next pull asks for everything', () async {
      await holdThree();
      store.setKv('intake.draft', '{}');
      standIn.answers[team] = const ApiException(403, 'not_a_member', 'You are not a member of this team.');
      await run();
      expect(copyIn(db.db), noCopy);
      expect(presets.downloaded, isFalse);
      expect(store.kv('intake.draft'), '{}');
      standIn.answers[team] = pullAnswer(reset: true, revision: 6);
      await run();
      expect(standIn.queriesOf(team).last, isEmpty);
    });

    test('a refused sign-in, a fault or a refused request keeps the copy and its revision', () async {
      await holdThree();
      final held = copyIn(db.db);
      for (final refusal in const [
        ApiException(401, 'unauthorized', 'Sign in again.'),
        ApiException(500, 'internal', 'Something went wrong.'),
        ApiException(422, 'validation_failed', 'The request is not valid.'),
      ]) {
        standIn.answers[team] = refusal;
        await run();
        expect(copyIn(db.db), held, reason: refusal.code);
      }
      standIn.answers[team] = pullAnswer(revision: 3);
      await run();
      expect(standIn.queriesOf(team).last, {'since': '3', 'epoch': epochA});
    });

    test('nothing is asked while the store is frozen', () async {
      store.freeze('Your access to this team ended.');
      standIn.answers[team] = pullAnswer(reset: true, revision: 1);
      await run(RefreshReason.opened);
      await run(RefreshReason.afterSync);
      expect(standIn.requests, isEmpty);
      store.unfreeze();
      await run();
      expect(standIn.requests, hasLength(1));
      expect(presets.revision, 1);
    });

    test('an answer that comes back after the store froze writes nothing, and nor does a 403', () async {
      await holdThree();
      // Unfrozen, an answer that took its time is written: the wait alone drops nothing.
      await answeredAfter(pullAnswer(revision: 4, presets: [pulled(gauzeId, 'item', gauze())]), () {});
      expect(presets.revision, 4);
      final held = copyIn(db.db);
      await answeredAfter(
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
        () => store.freeze('Your access to this team ended.'),
      );
      expect(copyIn(db.db), held);
      store.unfreeze();
      await answeredAfter(
        const ApiException(403, 'not_a_member', 'You are not a member of this team.'),
        () => store.freeze('Your access to this team ended.'),
      );
      expect(copyIn(db.db), held);
    });

    test('an answer that comes back once the copy went is written only when it is a reset', () async {
      // A search finds the team index too old and clears every server copy, the presets included,
      // while a pull is on its way.
      await holdThree();
      await answeredAfter(
        pullAnswer(revision: 5, presets: [pulled(footCheckId, 'bundle', footCheck())]),
        store.clearServerData,
      );
      expect(copyIn(db.db), noCopy);
      expect(presets.downloaded, isFalse);
      // The next pull asks for everything.
      await holdThree();
      expect(standIn.queriesOf(team).last, isEmpty);
      // A reset holds everything, so one that comes back after a clear is written.
      await answeredAfter(
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
        store.clearServerData,
      );
      expect(standIn.queriesOf(team).last, {'since': '3', 'epoch': epochA});
      expect(presets.presets().map((p) => p.id), [frostRiskId]);
      expect([presets.revision, presets.epoch], [9, epochB]);
    });

    test('an answer that comes back once this is not the open database writes nothing, nor does a 403', () async {
      // Signed out, another team opened, or the same file opened again for a new sign-in: the
      // controller holds another store, or none.
      await holdThree();
      await answeredAfter(pullAnswer(revision: 4, presets: [pulled(gauzeId, 'item', gauze())]), () {});
      expect(presets.revision, 4);
      final held = copyIn(db.db);
      await answeredAfter(
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
        () => open = false,
      );
      expect(copyIn(db.db), held);
      open = true;
      await answeredAfter(
        const ApiException(403, 'not_a_member', 'You are not a member of this team.'),
        () => open = false,
      );
      expect(copyIn(db.db), held);
    });

    test('presetRefreshers makes the team’s one refresher, whose answers go only into the store held open', () async {
      final otherDb = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-2'), key);
      addTearDown(otherDb.close);
      final other = storeOf(otherDb);
      LocalStore? openStore = store;
      final made = presetRefreshers(
        OpenTeam(
          userId: userId,
          teamId: team,
          store: store,
          api: SineobexApi(standIn.transportFor(team)),
          clock: ClockSync(boot: FakeBootClock(), references: DatabaseClockReferences(db), wallNow: () => wall),
          permissions: const ['encounters.chart'],
        ),
        openStore: () => openStore,
      );
      expect(made, [isA<PresetsRefresher>()]);
      final wired = made.single as PresetsRefresher;
      expect(identical(wired.presets.store, store), isTrue);
      standIn.answers[team] = pullAnswer(reset: true, revision: 3, presets: [pulled(labsId, 'order_category', labs())]);
      await runQuietly(wired, RefreshReason.opened);
      expect(presets.revision, 3);
      final held = copyIn(db.db);
      // Another team's store is open now, then none.
      for (final LocalStore? now in [other, null]) {
        await answeredAfter(
          pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
          () => openStore = now,
          by: wired,
        );
        expect(copyIn(db.db), held);
        expect(copyIn(otherDb.db), noCopy);
        openStore = store;
      }
    });

    test('an answer, or a 403, for an earlier sign-in goes nowhere once the same file is open again', () async {
      // A sign-in again opens the file with a connection and a store of its own. The first
      // connection stays open here, so only the refresher's check can stop the write: in the app the
      // controller closes it first, which stops it too.
      final againDb = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, team), key);
      addTearDown(againDb.close);
      final again = storeOf(againDb);
      LocalStore? openStore = store;
      final wired = presetRefreshers(
        OpenTeam(
          userId: userId,
          teamId: team,
          store: store,
          api: SineobexApi(standIn.transportFor(team)),
          clock: ClockSync(boot: FakeBootClock(), references: DatabaseClockReferences(db), wallNow: () => wall),
          permissions: const ['encounters.chart'],
        ),
        openStore: () => openStore,
      ).single;
      standIn.answers[team] = pullAnswer(reset: true, revision: 3, presets: [pulled(labsId, 'order_category', labs())]);
      await runQuietly(wired, RefreshReason.opened);
      final held = copyIn(againDb.db);
      expect(PresetStore(again).revision, 3);
      for (final arriving in <Object>[
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
        const ApiException(403, 'not_a_member', 'You are not a member of this team.'),
      ]) {
        await answeredAfter(arriving, () => openStore = again, by: wired);
        expect(copyIn(againDb.db), held);
        openStore = store;
      }
    });
  });

  group('as the app wires it (appRefreshers):', () {
    const pin = '482913';
    final userId = demoUser().userId;
    late Directory dir;
    late FakeSyncServer server;
    late PresetsStandIn standIn;
    late MemorySecureStore secure;
    late KeyVault vault;
    late FakeBootClock boot;
    late SessionController session;
    late SyncController sync;
    var teams = 1;

    /// Runs at sign-out once the server's copies are cleared, before the session ends.
    Future<void> Function()? afterClear;

    Future<void> launch() async {
      session = SessionController(
        auth: FakeAuth(),
        vault: vault,
        store: secure,
        fetchMe: (_) async => demoUser(teams: teams),
        localData: _AfterClear(DeferredLocalData(() => sync), () async => afterClear?.call()),
      );
      sync = SyncController(
        session: session,
        databaseDirectory: () async => dir.path,
        deviceStore: secure,
        teamApi: (teamId) => SineobexApi(standIn.transportFor(teamId, inner: server.transportFor(userId, teamId))),
        deviceApi: SineobexApi(server.transportFor('', '')),
        boot: boot,
        platform: RegisterDevicePlatform.android,
        appVersion: '0.2.0-test',
        interval: const Duration(hours: 1),
        // The app's own factory: the refreshers every open team gets (app_providers.dart).
        refreshers: appRefreshers(session: session, sync: () => sync),
        now: () => wall,
        monotonic: () => boot.elapsed,
      );
      await session.start();
      await sync.checkDevices();
    }

    setUp(() async {
      dir = Directory.systemTemp.createTempSync('presets-app');
      teams = 1;
      afterClear = null;
      server = FakeSyncServer(now: () => wall);
      standIn = PresetsStandIn();
      secure = MemorySecureStore();
      vault = KeyVault(store: secure, biometricStore: MemorySecureStore(), pbkdf2Iterations: 1000);
      boot = FakeBootClock();
      for (final t in ['team-0', 'team-1']) {
        standIn.answers[t] = pullAnswer(reset: true, revision: 1, presets: [pulled(labsId, 'order_category', labs())]);
      }
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

    /// The open team's copy, as its screens read it.
    PresetStore open() => PresetStore(sync.store!);

    /// The copy in [teamId]'s file, read through a connection of its own.
    Map<String, Object?> copyInFile(String teamId, Uint8List databaseKey) {
      final db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, teamId), databaseKey);
      try {
        return copyIn(db.db);
      } finally {
        db.close();
      }
    }

    /// Starts a pull of [teamId] whose answer waits for the returned completer.
    Future<({Completer<void> hold, Future<void> run})> pullOnItsWay(String teamId, Object answer) async {
      final hold = standIn.holds[teamId] = Completer<void>();
      standIn.answers[teamId] = answer;
      final asked = standIn.requests.length;
      final run = sync.refreshNow();
      await until(() => standIn.requests.length > asked);
      expect(standIn.requests.length, greaterThan(asked), reason: 'the pull was sent');
      return (hold: hold, run: run);
    }

    test('every open team gets one presets refresher: at open, after a sync, on pull to refresh', () async {
      await signIn();
      await until(() => open().downloaded);
      expect(sync.engine!.refreshers.whereType<PresetsRefresher>(), hasLength(1));
      expect(open().preset(labsId), isNotNull);
      expect(standIn.queriesOf('team-0').first, isEmpty);
      // A sync that reached the server.
      standIn.answers['team-0'] = pullAnswer(revision: 2, presets: [pulled(glucoseId, 'item', glucose())]);
      sync.store!.createEncounter(kind: 'medical');
      await sync.syncNow();
      expect(open().preset(glucoseId), isNotNull);
      // Pull to refresh.
      standIn.answers['team-0'] = pullAnswer(revision: 3, presets: [pulled(footCheckId, 'bundle', footCheck())]);
      await sync.refreshNow();
      expect(open().preset(footCheckId), isNotNull);
      expect(open().revision, 3);
      expect(
        standIn.queriesOf('team-0'),
        containsAllInOrder([
          <String, String>{},
          {'since': '1', 'epoch': epochA},
          {'since': '2', 'epoch': epochA},
        ]),
      );
    });

    test('an answer that comes back after a sign-out writes nothing into the file', () async {
      await signIn();
      await until(() => open().downloaded);
      await sync.refreshNow();
      sync.store!.createEncounter(kind: 'medical');
      final databaseKey = session.databaseKey!;
      final pull = await pullOnItsWay(
        'team-0',
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
      );
      afterClear = () async {
        // The answer comes back after the clear, before the session has ended.
        pull.hold.complete();
        await pull.run;
      };
      // "Log out anyway": the unsynced work keeps the file.
      await session.signOut(keepUnsynced: true);
      expect(copyInFile('team-0', databaseKey), noCopy);
    });

    test('an answer for a team no longer open goes into neither team’s file', () async {
      teams = 2;
      sync.dispose();
      await launch();
      standIn.answers['team-1'] = pullAnswer(
        reset: true,
        epoch: epochB,
        revision: 7,
        presets: [pulled(frostRiskId, 'flag', frostRisk())],
      );
      await signIn();
      await openTeam('team-0');
      await until(() => open().downloaded);
      await sync.refreshNow();
      final databaseKey = session.databaseKey!;
      final team0 = copyIn(sync.store!.database);
      final pull = await pullOnItsWay(
        'team-0',
        pullAnswer(revision: 5, presets: [pulled(footCheckId, 'bundle', footCheck())]),
      );
      await openTeam('team-1');
      await until(() => open().downloaded);
      // Team 1's own pulls are done: nothing after the late answer could write over what it did.
      await sync.refreshNow();
      pull.hold.complete();
      await pull.run;
      expect(open().presets().map((p) => p.id), [frostRiskId]);
      expect([open().revision, open().epoch], [7, epochB]);
      expect(copyInFile('team-0', databaseKey), team0);
    });

    test('an answer for an earlier sign-in goes nowhere, though the same file is open again', () async {
      await signIn();
      await until(() => open().downloaded);
      await sync.refreshNow();
      sync.store!.createEncounter(kind: 'medical');
      final pull = await pullOnItsWay(
        'team-0',
        pullAnswer(reset: true, epoch: epochB, revision: 9, presets: [pulled(frostRiskId, 'flag', frostRisk())]),
      );
      await session.signOut(keepUnsynced: true);
      // The same person signs in again, and their own pull is answered at once.
      standIn.holds.remove('team-0');
      standIn.answers['team-0'] = pullAnswer(reset: true, revision: 3, presets: [pulled(glucoseId, 'item', glucose())]);
      await signIn();
      await until(() => open().downloaded);
      // The new sign-in's own pulls are done: nothing after the late answer could write over it.
      await sync.refreshNow();
      pull.hold.complete();
      await pull.run;
      expect(open().presets().map((p) => p.id), [glucoseId]);
      expect([open().revision, open().epoch], [3, epochA]);
    });
  });
}

/// [LocalData] that runs [after] once the server's copies are cleared, before the session ends.
class _AfterClear implements LocalData {
  _AfterClear(this.inner, this.after);
  final LocalData inner;
  final Future<void> Function() after;

  @override
  Future<bool> hasAny(String userId) => inner.hasAny(userId);
  @override
  Future<int?> unsynced(String userId, Uint8List key) => inner.unsynced(userId, key);
  @override
  Future<void> erase(String userId) => inner.erase(userId);
  @override
  Future<void> clearServerCopies(String userId, Uint8List key) async {
    await inner.clearServerCopies(userId, key);
    await after();
  }

  @override
  Future<void> markServerCopiesStale(String userId) => inner.markServerCopiesStale(userId);

  @override
  Future<void> afterSignIn(LocalUser user) => inner.afterSignIn(user);
}
