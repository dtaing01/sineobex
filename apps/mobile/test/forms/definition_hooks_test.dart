import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/app_providers.dart' show syncControllerProvider;
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/forms/forms_providers.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../auth/fakes.dart';
import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import 'forms_fake.dart';

/// Where the phone fetches its teams' note types and where it deletes them (phase 4 design, forms
/// 3.4): every team's list right after sign-in, the open team's at each sync, and the files gone
/// at sign-out and with a wiped team. A fetch that fails changes nothing and stops no sync.
void main() {
  const pin = '482913';
  final userId = demoUser().userId;
  late Directory dir;
  late FakeSyncServer server;
  late FakeFormsServer forms;
  late MemorySecureStore store;
  late KeyVault vault;
  late FakeBootClock boot;
  late DefinitionStore definitions;
  late SessionController session;
  late SyncController sync;
  var teams = 1;

  final checks = sampleVersion('checks_demo', 1);
  final visit = sampleVersion('demo_visit', 1);
  final wound = sampleVersion('demo_wound', 1);

  void launch() {
    final user = demoUser(teams: teams);
    definitions = DefinitionStore(directory: () async => p.join(dir.path, 'forms'), presets: () async => [checks]);
    session = SessionController(
      auth: FakeAuth(),
      vault: vault,
      store: store,
      fetchMe: (_) async => user,
      localData: DeferredLocalData(() => sync),
    );
    sync = SyncController(
      session: session,
      databaseDirectory: () async => dir.path,
      deviceStore: store,
      teamApi: (teamId) => SineobexApi(forms.transportFor(teamId, server.transportFor(userId, teamId))),
      deviceApi: SineobexApi(server.transportFor('', '')),
      boot: boot,
      platform: RegisterDevicePlatform.android,
      appVersion: '0.2.0-test',
      interval: const Duration(hours: 1),
      now: () => DateTime.utc(2026, 10, 20, 15),
      monotonic: () => boot.elapsed,
      definitions: definitions,
    );
  }

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('definition_hooks');
    teams = 1;
    server = FakeSyncServer(now: () => DateTime.utc(2026, 10, 20, 15));
    forms = FakeFormsServer()
      ..teams['team-0'] = [checks, visit]
      ..teams['team-1'] = [checks, wound];
    store = MemorySecureStore();
    vault = KeyVault(store: store, biometricStore: MemorySecureStore(), pbkdf2Iterations: 1000);
    boot = FakeBootClock();
    launch();
    await session.start();
  });
  tearDown(() {
    sync.dispose();
    dir.deleteSync(recursive: true);
  });

  Future<void> idle() async {
    await sync.ready();
    await sync.definitionsFetched();
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
      await session.unlockWithPin(pin);
    }
    await idle();
  }

  Future<List<String>?> listed(String teamId) async {
    final team = await definitions.team(userId, teamId);
    return team == null ? null : [for (final d in team.listed) d.key];
  }

  bool filesFor(String teamId) =>
      Directory(p.join(dir.path, 'forms')).existsSync() &&
      Directory(p.join(dir.path, 'forms'))
          .listSync(recursive: true)
          .whereType<Directory>()
          .any((d) => p.basename(d.path) == teamId && d.listSync().isNotEmpty);

  test('right after sign-in every team’s list is fetched, so a team first opened offline has it', () async {
    teams = 2;
    sync.dispose();
    launch();
    await session.start();
    await signIn();
    // Two teams: none is open until the person picks one.
    expect(sync.store, isNull);
    expect(forms.listRequests, 2);
    expect(await listed('team-0'), ['checks_demo', 'demo_visit']);
    expect(await listed('team-1'), ['checks_demo', 'demo_wound']);
    forms.offline = true;
    await session.selectTeam('team-1');
    await idle();
    expect(sync.store, isNotNull);
    expect((await definitions.team(userId, 'team-1'))!.startable('demo_wound', 1), isNotNull);
  });

  test('a sign-in again on a phone that holds the vault fetches too', () async {
    // Two teams, so no team opens by itself and only the sign-in's fetch can bring the lists back.
    teams = 2;
    sync.dispose();
    launch();
    await session.start();
    await signIn();
    await session.selectTeam('team-0');
    await idle();
    await session.lock();
    await session.signOut(keepUnsynced: true);
    expect(await listed('team-0'), isNull);
    await signIn();
    expect(sync.store, isNull);
    expect(await listed('team-0'), ['checks_demo', 'demo_visit']);
    expect(await listed('team-1'), ['checks_demo', 'demo_wound']);
  });

  test('at each sync the open team’s list is asked; a fetch that fails changes nothing and stops no sync', () async {
    await signIn();
    expect(await listed('team-0'), ['checks_demo', 'demo_visit']);
    final before = forms.listRequests;
    forms.teams['team-0'] = [checks, visit, wound];
    forms.offline = true;
    sync.store!.createEncounter(kind: 'medical');
    final outcome = await sync.syncNow();
    expect(outcome, isA<SyncDone>());
    expect(sync.store!.unsynced().total, 0);
    expect(forms.listRequests, greaterThan(before), reason: 'the sync asked');
    expect(await listed('team-0'), ['checks_demo', 'demo_visit']);
    // Back in signal, the next sync brings the new list.
    forms.offline = false;
    await sync.syncNow();
    expect(await listed('team-0'), ['checks_demo', 'demo_visit', 'demo_wound']);
  });

  test('a refused definition stops no sync either', () async {
    await signIn();
    forms.teams['team-0'] = [checks, visit, wound];
    forms.answers['demo_wound/1'] = {...wound, 'definition': edited(wound, 'Demo: altered')['definition']};
    sync.store!.createEncounter(kind: 'medical');
    expect(await sync.syncNow(), isA<SyncDone>());
    expect(sync.store!.unsynced().total, 0);
    expect(await listed('team-0'), ['checks_demo', 'demo_visit']);
    expect(await definitions.definition(userId, 'team-0', 'demo_wound', 1), isNull);
  });

  test('signing out with nothing unsynced deletes the definitions', () async {
    await signIn();
    expect(filesFor('team-0'), isTrue);
    await session.signOut();
    expect(filesFor('team-0'), isFalse);
    expect(await listed('team-0'), isNull);
  });

  test('“Log out anyway” keeps the unsynced work and deletes the definitions', () async {
    await signIn();
    forms.offline = true;
    server.offline = true;
    sync.store!.createEncounter(kind: 'medical');
    await session.signOut(keepUnsynced: true);
    expect(await session.keptUsers(), [userId]);
    expect(filesFor('team-0'), isFalse);
    expect(await listed('team-0'), isNull);
  });

  test('a sign-out from the lock screen deletes the definitions too', () async {
    await signIn();
    server.offline = true;
    sync.store!.createEncounter(kind: 'medical');
    await session.lock();
    await session.signOut();
    expect(filesFor('team-0'), isFalse);
  });

  test('a remote wipe of one team deletes that team’s definitions, and only those', () async {
    teams = 2;
    sync.dispose();
    launch();
    await session.start();
    await signIn();
    // Both teams have a database, so the person stays signed in when one is wiped (a wipe of the
    // last one ends the session, and every file of theirs goes).
    await session.selectTeam('team-1');
    await idle();
    await session.selectTeam('team-0');
    await idle();
    expect(filesFor('team-1'), isTrue);
    final device = server.devices.entries.firstWhere((d) => d.value.teamId == 'team-0').key;
    server.devices[device]!.status = 'wipe_requested';
    await session.lock();
    await sync.checkDevices();
    expect(filesFor('team-0'), isFalse);
    expect(await listed('team-0'), isNull);
    expect(filesFor('team-1'), isTrue);
    expect(await listed('team-1'), ['checks_demo', 'demo_wound']);
  });

  test('the screens get the open team’s note types, and null where it has no list', () async {
    final container = ProviderContainer(overrides: [syncControllerProvider.overrideWithValue(sync)]);
    addTearDown(container.dispose);
    expect(await container.read(teamNoteTypesProvider.future), isNull, reason: 'no team open');
    forms.offline = true;
    await signIn();
    expect(await container.read(teamNoteTypesProvider.future), isNull, reason: 'never fetched: connect once');
    expect(connectOnceMessage, 'Connect once to load your team’s note types.');
    forms.offline = false;
    await sync.refreshNow();
    final team = (await container.read(teamNoteTypesProvider.future))!;
    expect([for (final d in team.listed) d.key], ['checks_demo', 'demo_visit']);
    final def = await container.read(noteTypeDefinitionProvider((key: 'demo_visit', version: 1)).future);
    expect(def?.key, 'demo_visit');
  });
}
