import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/app_providers.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/encounter_services.dart';
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../auth/fakes.dart';
import '../forms/forms_fake.dart';
import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The encounter services as the app wires them (phase 4 design, lifecycle 4.8, 8.2): made with each
/// team database the sync controller opens, for the person the session unlocked in that team, with
/// the close sweep among the refreshers, so it runs at the opening and after every sync.
void main() {
  const pin = '482913';
  late Directory dir;
  late FakeSyncServer server;
  late FakeFormsServer forms;
  late MemorySecureStore store;
  late FakeBootClock boot;
  late SessionController session;
  late SyncController sync;
  late DateTime wall;
  final presets = jsonDecode(File('assets/forms/presets.json').readAsStringSync()) as List<Object?>;

  /// Two teams, with a different credential and different keys in each.
  LocalUser person(String userId, String name) => LocalUser(
    userId: userId,
    email: 'clinician@example.com',
    displayName: name,
    teams: const [
      TeamRef(
        id: 'team-0',
        name: 'Demo Team 0',
        roleName: 'Healthcare Staff',
        credential: 'np',
        permissions: ['patients.view', 'encounters.chart'],
      ),
      TeamRef(
        id: 'team-1',
        name: 'Demo Team 1',
        roleName: 'Healthcare Staff',
        credential: 'student',
        permissions: ['patients.view', 'encounters.chart', 'referrals.create'],
      ),
    ],
  );
  var me = person('user-1', 'Demo Jordan Lee');

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('encounter-services');
    wall = DateTime.utc(2026, 10, 20, 15);
    me = person('user-1', 'Demo Jordan Lee');
    server = FakeSyncServer(now: () => wall);
    forms = FakeFormsServer();
    for (final t in me.teams) {
      forms.teams[t.id] = [...presets.cast<Version>()];
    }
    store = MemorySecureStore();
    boot = FakeBootClock();
    session = SessionController(
      auth: FakeAuth(),
      vault: KeyVault(store: store, biometricStore: MemorySecureStore(), pbkdf2Iterations: 1000),
      store: store,
      fetchMe: (_) async => me,
      localData: DeferredLocalData(() => sync),
    );
    sync = SyncController(
      session: session,
      databaseDirectory: () async => dir.path,
      deviceStore: store,
      teamApi: (teamId) => SineobexApi(forms.transportFor(teamId, server.transportFor(me.userId, teamId))),
      deviceApi: SineobexApi(server.transportFor('', '')),
      boot: boot,
      platform: RegisterDevicePlatform.android,
      appVersion: '0.2.0-test',
      interval: const Duration(hours: 1),
      now: () => wall,
      monotonic: () => boot.elapsed,
      // As the app wires them.
      refreshers: appRefreshers(session: session, sync: () => sync),
      definitions: DefinitionStore(directory: () async => '${dir.path}/forms', presets: () async => presets),
    );
    await session.start();
    await sync.checkDevices();
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

  Future<void> openTeam(String teamId) async {
    await session.selectTeam(teamId);
    await idle();
  }

  /// Signs in and opens team-0.
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
    await openTeam('team-0');
  }

  EncounterServices open() => EncounterServices.of(sync.store!)!;

  test('the app’s sync controller makes them for each team it opens, beside the patient services', () {
    final container = ProviderContainer(
      overrides: [
        deviceStoreProvider.overrideWithValue(MemorySecureStore()),
        biometricStoreProvider.overrideWithValue(MemorySecureStore()),
      ],
    );
    addTearDown(container.dispose);
    final phone = TestPhone(
      userId: 'user-1',
      teamId: 'team-0',
      transport: () => server.transportFor('user-1', 'team-0'),
    );
    addTearDown(phone.close);
    final made = container.read(syncControllerProvider).refreshers!(
      OpenTeam(
        userId: phone.userId,
        teamId: phone.teamId,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: const ['encounters.chart'],
      ),
    );
    final services = EncounterServices.of(phone.store)!;
    expect(PatientServices.of(phone.store), isNotNull);
    expect(made, containsAll(services.refreshers));
    expect(made, contains(services.sweep));
    // No one is unlocked in this container: no credential, nothing offered that the server would refuse.
    expect([services.user.credential, services.user.displayName], ['none', '']);
  });

  test('a profile that is not the open team’s person gives no credential and no name', () {
    final phone = TestPhone(
      userId: 'user-1',
      teamId: 'team-0',
      transport: () => server.transportFor('user-1', 'team-0'),
    );
    addTearDown(phone.close);
    OpenTeam team(String teamId) => OpenTeam(
      userId: phone.userId,
      teamId: teamId,
      store: phone.store,
      api: phone.engine.api,
      clock: phone.clock,
      permissions: const ['encounters.chart'],
    );
    encounterRefreshers(team('team-0'), person: person('user-2', 'Demo Sam Ortiz'));
    expect(
      [EncounterServices.of(phone.store)!.user.credential, EncounterServices.of(phone.store)!.user.displayName],
      ['none', ''],
    );
    encounterRefreshers(team('team-9'), person: person('user-1', 'Demo Jordan Lee'));
    expect(EncounterServices.of(phone.store)!.user.credential, 'none');
    encounterRefreshers(team('team-1'), person: person('user-1', 'Demo Jordan Lee'));
    expect(
      [EncounterServices.of(phone.store)!.user.credential, EncounterServices.of(phone.store)!.user.displayName],
      ['student', 'Demo Jordan Lee'],
    );
  });

  test('made for the person the session unlocked in the open team, with the engine to open records', () async {
    await signIn();
    final services = open();
    expect(services.teamId, 'team-0');
    expect(
      [services.user.userId, services.user.displayName, services.user.credential, services.user.permissions],
      [
        'user-1',
        'Demo Jordan Lee',
        'np',
        unorderedEquals(['patients.view', 'encounters.chart']),
      ],
    );
    expect(services.repository.openServerRecord, sync.engine!.openServerRecord);
    expect([services.repository.store, services.api.store, services.referrals.store], everyElement(sync.store));
    // The team's list, offline too, with the Red flags note type the repository adds by itself.
    expect([for (final d in await services.noteTypes()) d.key], contains('red_flags_disposition'));
  });

  test('the close sweep runs after a sync in the app’s wiring', () async {
    await signIn();
    final services = open();
    final visit = services.repository.startEncounter(kind: VisitKind.nonMedical);
    await sync.syncNow();
    expect(sync.store!.outbox().where((e) => e.recordId == visit), isEmpty);
    expect(sync.store!.record(visit)!.open, isTrue);

    // A week and a day on, a visit with no note that nobody touched closes at the next sync.
    wall = wall.add(const Duration(days: 8));
    boot.advance(const Duration(days: 8));
    await sync.syncNow();
    expect(sync.store!.record(visit)?.open ?? false, isFalse);
  });

  test('what a screen shows stays open through the sweep', () async {
    await signIn();
    final services = open();
    final visit = services.repository.startEncounter(kind: VisitKind.nonMedical);
    services.sweep.showing.add(visit);
    await sync.syncNow();
    wall = wall.add(const Duration(days: 8));
    boot.advance(const Duration(days: 8));
    await sync.syncNow();
    expect(sync.store!.record(visit)!.open, isTrue);
  });

  test('made again for another team, and for another person; the screens’ provider follows', () async {
    final container = ProviderContainer(overrides: [syncControllerProvider.overrideWithValue(sync)]);
    addTearDown(container.dispose);
    final seen = <EncounterServices?>[];
    container.listen(encounterServicesProvider, (_, next) => seen.add(next), fireImmediately: true);
    expect(seen, [null]);

    await signIn();
    final first = open();
    expect(container.read(encounterServicesProvider), same(first));

    await openTeam('team-1');
    final second = open();
    expect(second, isNot(same(first)));
    expect(
      [second.teamId, second.user.credential, second.user.permissions.contains('referrals.create')],
      ['team-1', 'student', true],
    );
    expect(container.read(encounterServicesProvider), same(second));

    await session.signOut();
    expect(container.read(encounterServicesProvider), isNull);
    me = person('user-2', 'Demo Sam Ortiz');
    server.permissions['user-2'] = {'patients.view', 'encounters.chart'};
    await signIn();
    final third = open();
    expect([third.user.userId, third.user.displayName, third.user.credential], ['user-2', 'Demo Sam Ortiz', 'np']);
    expect(container.read(encounterServicesProvider), same(third));
    expect(seen.whereType<EncounterServices>().toSet(), {first, second, third});
  });
}
