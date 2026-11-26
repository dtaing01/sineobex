import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason, PresetsPull, PulledPreset;
import 'package:sineobex_field/api/generated/api.dart' as api show PulledPresetKind, PulledPresetState;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/consent_script.dart' show ConsentGiven;
import 'package:sineobex_field/patients/flags.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show Intake;
import 'package:sineobex_field/patients/team_index.dart' show TeamIndexRefresher;
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/presets/presets_refresher.dart';
import 'package:sineobex_field/sync/canonical_json.dart' show valueHash;
import 'package:sineobex_field/sync/clock.dart' show ClockState;
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart' show RefreshReason;

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The phone's test server, with a hand that spoils a flag change's reason on its way, once: the
/// server then refuses it `reason_invalid`, which no change the phone makes can be (the store refuses
/// such a reason first), as a build that counts differently would.
class _Link implements ApiTransport {
  _Link(this.inner);
  final ApiTransport inner;

  /// The flag changes whose create goes out with an empty reason, once each.
  final spoil = <String>{};

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) {
    if (path == '/v1/sync/push' && spoil.isNotEmpty) {
      final sent = jsonDecode(jsonEncode(body)) as Map<String, Object?>;
      for (final c in (sent['changes']! as List<Object?>).cast<Map<String, Object?>>()) {
        if (c['op'] == 'create' && spoil.remove(c['recordId'])) {
          final value = {...c['value']! as Map<String, Object?>, 'reason': ''};
          c
            ..['value'] = value
            ..['valueHash'] = valueHash(value);
        }
      }
      return inner.send(method, path, query: query, body: sent);
    }
    return inner.send(method, path, query: query, body: body);
  }
}

/// A patient's flags on the phone (phase 5 design 6.1, 6.2, 8.2; card P5-phone-domain), the one
/// domain class the flags sheet, intake, the patient list and Needs attention write through, offline
/// first and then synced to the phone's test server, which holds the API's rules for a flag change
/// (fake_parity_test.dart): the flag rule, held role by role to the server's projection; recording a
/// set and a clear through the store, never while it is frozen or the clock is paused; the current
/// flags, folded from the chart's changes and this phone's own as `currentFlags` folds them; Entered
/// in error, by the change's author or a Program Admin; Choose a flag and Change the reason through
/// `fixRejected`; and the notice of a held change, filed under its patient.
///
/// Written ahead of its code (card P5-tests): each case fails until P5-phone-domain builds it.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 22, 15);
  const frozen = 'Your access to this team ended.';

  late DateTime serverTime;
  late FakeSyncServer server;
  late _Link link;
  late TestPhone phone;
  late PatientServices services;

  // The team's flags (section 11, row 5's shape; every name made up): two risk levels, three
  // conditions, one of them sensitive, and one the team will remove.
  late String high, medium, frost, wet, pregnancy, heat;

  PatientServices servicesFor(List<String> permissions) => PatientServices(
    OpenTeam(
      userId: alex,
      teamId: team,
      store: phone.store,
      api: phone.engine.api,
      clock: phone.clock,
      permissions: permissions,
    ),
    idLinkBaseUrl: 'http://localhost:3100',
    copy: (_) async => true,
    wallNow: () => phone.wall,
  );

  Map<String, Object?> flag(String name, String tier, String color, int rank, {bool sensitive = false}) => {
    'name': name,
    'tier': tier,
    'criteria': '',
    'color': color,
    'rank': rank,
    'sensitive': sensitive,
  };

  /// The team's presets onto the phone, as a sync's refreshers pull them.
  Future<void> pullPresets() =>
      PresetsRefresher(PresetStore(phone.store), phone.engine.api, current: () => true).refresh(RefreshReason.manual);

  setUp(() async {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime)..names[blair] = 'Demo Blair';
    link = _Link(server.transportFor(alex, team));
    phone = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
    services = servicesFor(FakeSyncServer.healthcareStaff.toList());
    high = server.addPreset(team, 'flag', flag('Demo: High', 'primary', 'red', 10));
    medium = server.addPreset(team, 'flag', flag('Demo: Medium', 'primary', 'yellow', 20));
    frost = server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10));
    wet = server.addPreset(team, 'flag', flag('Demo: Wet feet', 'secondary', 'teal', 20));
    pregnancy = server.addPreset(team, 'flag', flag('Demo: Pregnancy', 'secondary', 'purple', 30, sensitive: true));
    heat = server.addPreset(team, 'flag', flag('Demo: Heat risk', 'secondary', 'orange', 5));
    // A push gives the phone its clock reference.
    await phone.engine.syncAll();
    await pullPresets();
  });
  tearDown(() => phone.close());

  LocalStore store() => phone.store;
  PatientFlags flags() => services.flags;

  void advance(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  Future<String> openedPatient({String name = 'Demo Wren'}) async {
    final p = server.seedPatient(preferredName: name);
    await services.patients.open(p);
    return p;
  }

  List<OutboxEntry> flagChanges() => [
    for (final e in store().outbox())
      if (e.entity == entityFlagChange) e,
  ];

  OutboxEntry createOf(String recordId) => store().outbox().singleWhere((e) => e.recordId == recordId);

  /// The phone's own clock runs ten minutes from the server's: charting pauses (D35).
  void pauseClock() {
    phone.wall = phone.wall.add(const Duration(minutes: 10));
    expect(phone.clock.status.paused, isTrue);
  }

  void resumeClock() {
    phone.wall = phone.wall.subtract(const Duration(minutes: 10));
    expect(phone.clock.status.paused, isFalse);
  }

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  List<String> ids(Iterable<FlagView> views) => [for (final v in views) v.flagId];

  group('the flag rule, the phone’s one copy (6.2, D136)', () {
    final access =
        jsonDecode(File('../../packages/contract/test-vectors/access.json').readAsStringSync()) as Map<String, Object?>;
    const sensitive = FlagBody(
      name: 'Demo: Pregnancy',
      tier: FlagTier.secondary,
      criteria: '',
      color: FlagColor.purple,
      rank: 30,
      sensitive: true,
    );
    const plain = FlagBody(
      name: 'Demo: Frost risk',
      tier: FlagTier.secondary,
      criteria: '',
      color: FlagColor.blue,
      rank: 10,
      sensitive: false,
    );
    for (final c in (access['cases']! as List<Object?>).cast<Map<String, Object?>>()) {
      final role = c['name']! as String;
      final permissions = (c['permissions']! as List<Object?>).cast<String>();
      test('a sensitive flag is seen exactly where a sensitive problem is, as the server’s projection sees it '
          '($role)', () {
        // Projection.sensitive (services/api projection.ts): mayViewProblems, which access.json pins on
        // both sides, and patients.view_sensitive.
        final sees = c['mayViewProblems'] == true && permissions.contains('patients.view_sensitive');
        expect(seesSensitiveFlags(permissions), sees);
        expect(flagHidden(permissions, sensitive), !sees);
        expect(flagHidden(permissions, plain), isFalse);
        // A flag that is none of the team's names nothing anyone could be shown.
        expect(flagHidden(permissions, null), isTrue);
      });
    }

    test('a custom role with patients.view_sensitive but no problem list sees no sensitive flag (12.1, risk 6)', () {
      const permissions = ['patients.view', 'patients.view_sensitive', 'patients.edit'];
      expect(seesSensitiveFlags(permissions), isFalse);
      expect(flagHidden(permissions, sensitive), isTrue);
      expect(flagHidden(permissions, plain), isFalse);
    });
  });

  group('recording a change (6.2, 8.2)', () {
    test('a set and a clear made offline wait under the patient, show at once, and the server takes them', () async {
      final p = await openedPatient();
      server.offline = true;
      var changed = 0;
      flags().onChanged = () => changed++;

      final set = flags().record(p, flagId: high, action: 'set', reason: '  Demo: missed two follow-ups  ');
      final entry = createOf(set);
      expect([entry.entity, entry.op, entry.category, entry.patientId], [entityFlagChange, 'create', 'patients', p]);
      expect(entry.value, {'patientId': p, 'flagId': high, 'action': 'set', 'reason': 'Demo: missed two follow-ups'});
      var view = flags().flagsOf(p);
      expect(view.riskLevel?.flagId, high);
      expect(
        [view.riskLevel?.name, view.riskLevel?.colorName, view.riskLevel?.color, view.riskLevel?.archived],
        ['Demo: High', 'Red', FlagColor.red, false],
      );
      expect(view.conditions, isEmpty);
      expect(
        [for (final h in view.history) (h.changeId, h.action, h.state, h.authorId, h.reason)],
        [(set, 'set', FlagChangeState.waiting, alex, 'Demo: missed two follow-ups')],
      );

      advance(const Duration(minutes: 1));
      final clear = flags().record(p, flagId: high, action: 'clear', reason: 'Demo: seen at the clinic');
      view = flags().flagsOf(p);
      expect(view.riskLevel, isNull);
      // Newest first.
      expect([for (final h in view.history) h.changeId], [clear, set]);
      expect(changed, 2);

      server.offline = false;
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'both confirmed by their receipts');
      expect(
        [server.records[set]!.attributes['action'], server.records[clear]!.attributes['action']],
        ['set', 'clear'],
      );
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      view = flags().flagsOf(p);
      expect(view.riskLevel, isNull);
      expect(
        [for (final h in view.history) (h.changeId, h.state)],
        [(clear, FlagChangeState.sent), (set, FlagChangeState.sent)],
      );
    });

    test('a change names the patient as this phone knows them now: a merged record’s survivor', () async {
      final kept = server.seedPatient(preferredName: 'Demo Wren');
      final merged = server.seedPatient(preferredName: 'Demo Renny');
      await services.patients.open(merged);
      server.merge(merged, kept);
      await services.charts.fetch([merged], reason: FetchChartsReason.refresh);
      final id = flags().record(merged, flagId: frost, action: 'set', reason: 'Demo: sleeps by the river');
      expect((createOf(id).value! as Map<String, Object?>)['patientId'], kept);
      expect(ids(flags().flagsOf(merged).conditions), [frost]);
    });

    test('nothing is recorded or read while the store is frozen, and nothing recorded while the clock is paused '
        '(D35)', () async {
      final p = await openedPatient();
      pauseClock();
      expect(
        () => flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital'),
        throwsA(isA<ChartingPaused>()),
      );
      expect(
        () => flags().save(p, riskLevel: high, conditions: {frost}, reason: 'Demo: left hospital'),
        throwsA(isA<ChartingPaused>()),
      );
      // Reading waits for no clock.
      expect(flags().flagsOf(p).riskLevel, isNull);
      resumeClock();

      store().freeze(frozen);
      expect(
        () => flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital'),
        throwsA(isA<ChartingPaused>()),
      );
      expect(() => flags().flagsOf(p), throwsA(isA<ChartingPaused>()));
      expect(flagChanges(), isEmpty);
    });

    test('a reason is trimmed and 1 to 500 code points, so an astral character counts once', () async {
      final p = await openedPatient();
      // 500 astral characters are 1,000 UTF-16 units: still 500 code points, taken.
      final ice = '🧊' * 500;
      final id = flags().record(p, flagId: frost, action: 'set', reason: ice);
      expect((createOf(id).value! as Map<String, Object?>)['reason'], ice);
      for (final bad in ['', '   ', '🧊' * 501, 'x' * 501]) {
        expect(
          () => flags().record(p, flagId: wet, action: 'set', reason: bad),
          refused('reason_invalid'),
          reason: '${bad.runes.length} code points',
        );
      }
      expect(flagChanges(), hasLength(1));
    });

    test('without patients.edit nothing is offered to change and nothing is recorded', () async {
      final p = await openedPatient();
      final billing = servicesFor(const ['patients.view', 'billing.view_codes', 'inventory.view']);
      expect(billing.flags.mayEdit, isFalse);
      expect(flags().mayEdit, isTrue);
      expect(
        () => billing.flags.record(p, flagId: high, action: 'set', reason: 'Demo: left hospital'),
        refused('not_allowed'),
      );
      expect(flagChanges(), isEmpty);
    });

    test('a sensitive flag is never offered to, recorded by or answered to a reader the rule hides it from', () async {
      final p = await openedPatient();
      server.offline = true;
      // Healthcare Staff see it, and set it.
      // By rank: Heat risk (5) before Frost risk (10).
      expect(ids(flags().teamFlags(FlagTier.secondary)), [heat, frost, wet, pregnancy]);
      final id = flags().record(p, flagId: pregnancy, action: 'set', reason: 'Demo: told the team');
      expect(ids(flags().flagsOf(p).conditions), [pregnancy]);

      // A community health worker on the same phone does not, anywhere.
      final chw = servicesFor(FakeSyncServer.chw.toList());
      expect(ids(chw.flags.teamFlags(FlagTier.secondary)), [heat, frost, wet]);
      expect(ids(chw.flags.offered(p, FlagTier.secondary)), [heat, frost, wet]);
      final shown = chw.flags.flagsOf(p);
      expect(shown.conditions, isEmpty);
      expect([for (final h in shown.history) h.changeId], isNot(contains(id)));
      expect(
        () => chw.flags.record(p, flagId: pregnancy, action: 'clear', reason: 'Demo: not so'),
        refused('unknown_flag'),
      );
      expect(flagChanges(), hasLength(1));
    });

    test('a flag the phone’s copy of the presets doesn’t hold is never recorded', () async {
      final p = await openedPatient();
      const stranger = '5e5e5e5e-0000-4000-8000-000000000001';
      expect(
        () => flags().record(p, flagId: stranger, action: 'set', reason: 'Demo: from another team'),
        refused('unknown_flag'),
      );
      expect(flagChanges(), isEmpty);
    });

    test('an archived flag stays on the patient, named, and is offered only to clear (5.1)', () async {
      final p = await openedPatient();
      final other = await openedPatient(name: 'Demo Kestrel');
      flags().record(p, flagId: heat, action: 'set', reason: 'Demo: no shade at the camp');
      await phone.engine.syncAll(force: true);
      server.archivePreset(team, heat);
      await pullPresets();

      final carried = flags().flagsOf(p).conditions.single;
      expect([carried.flagId, carried.name, carried.archived], [heat, 'Demo: Heat risk', true]);
      expect(ids(flags().teamFlags(FlagTier.secondary)), isNot(contains(heat)));
      expect(ids(flags().offered(p, FlagTier.secondary)), contains(heat));
      expect(ids(flags().offered(other, FlagTier.secondary)), isNot(contains(heat)));
      expect(() => flags().record(other, flagId: heat, action: 'set', reason: 'Demo: no shade'), refused('archived'));
      // A clear is taken, and it comes off.
      flags().record(p, flagId: heat, action: 'clear', reason: 'Demo: moved indoors');
      expect(flags().flagsOf(p).conditions, isEmpty);
    });

    test(
      'where the presets aren’t held nothing is offered, and the patient’s flags are named from the chart',
      () async {
        final p = server.seedPatient(preferredName: 'Demo Wren');
        server.seed(entityFlagChange, {
          'patientId': p,
          'flagId': medium,
          'action': 'set',
          'reason': 'Demo: weekly check',
        }, by: blair);
        await services.patients.open(p);
        PresetStore(store()).clear();
        expect(flags().presetsHeld, isFalse);
        expect(flags().teamFlags(FlagTier.primary), isEmpty);
        expect(flags().offered(p, FlagTier.secondary), isEmpty);
        final level = flags().flagsOf(p).riskLevel!;
        expect(
          [level.flagId, level.name, level.colorName, level.color, level.tier],
          [medium, 'Demo: Medium', 'Yellow', FlagColor.yellow, FlagTier.primary],
        );
        expect(
          () => flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital'),
          refused('unknown_flag'),
        );
      },
    );
  });

  group('Save (8.2)', () {
    test('each difference is one change with the one reason; None clears the level; nothing differs, nothing '
        'is sent', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      server.seed(
        entityFlagChange,
        {'patientId': p, 'flagId': medium, 'action': 'set', 'reason': 'Demo: weekly check'},
        by: blair,
        at: start.subtract(const Duration(days: 1)),
      );
      await services.patients.open(p);
      server.offline = true;

      ({String flagId, String action}) what(String id) {
        final v = createOf(id).value! as Map<String, Object?>;
        return (flagId: v['flagId']! as String, action: v['action']! as String);
      }

      final first = flags().save(p, riskLevel: high, conditions: {frost, wet}, reason: 'Demo: weekly review');
      expect(
        {for (final id in first) what(id)},
        {(flagId: high, action: 'set'), (flagId: frost, action: 'set'), (flagId: wet, action: 'set')},
      );
      expect(
        {for (final id in first) (createOf(id).value! as Map<String, Object?>)['reason']},
        {'Demo: weekly review'},
      );
      var view = flags().flagsOf(p);
      expect(
        [view.riskLevel?.flagId, ids(view.conditions)],
        [
          high,
          [frost, wet],
        ],
      );

      advance(const Duration(minutes: 1));
      final second = flags().save(p, riskLevel: null, conditions: {wet}, reason: 'Demo: doing better');
      expect({for (final id in second) what(id)}, {(flagId: high, action: 'clear'), (flagId: frost, action: 'clear')});
      view = flags().flagsOf(p);
      expect(
        [view.riskLevel, ids(view.conditions)],
        [
          null,
          [wet],
        ],
      );

      final before = flagChanges().length;
      expect(flags().save(p, riskLevel: null, conditions: {wet}, reason: 'Demo: no change'), isEmpty);
      expect(flagChanges(), hasLength(before));
    });

    test('one change refused writes none of them', () async {
      final p = await openedPatient();
      server.archivePreset(team, heat);
      await pullPresets();
      final before = store().outbox().length;
      expect(
        () => flags().save(p, riskLevel: high, conditions: {frost, heat}, reason: 'Demo: weekly review'),
        refused('archived'),
      );
      expect(store().outbox(), hasLength(before));
      expect(flags().flagsOf(p).riskLevel, isNull);
    });
  });

  group('the current flags (6.1)', () {
    test('folded from the chart’s changes as currentFlags folds them, each named from the presets', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      void change(String flagId, String action, Duration ago) => server.seed(
        entityFlagChange,
        {'patientId': p, 'flagId': flagId, 'action': action, 'reason': 'Demo: change'},
        by: blair,
        at: start.subtract(ago),
      );
      change(medium, 'set', const Duration(days: 3));
      change(high, 'set', const Duration(days: 2));
      // A clear of a level that isn't the patient's then takes nothing off (5.3's two-phone case).
      change(medium, 'clear', const Duration(days: 1));
      change(wet, 'set', const Duration(days: 3));
      change(frost, 'set', const Duration(days: 2));
      change(wet, 'clear', const Duration(hours: 1));
      await services.patients.open(p);
      server.offline = true;

      final view = flags().flagsOf(p);
      expect(view.riskLevel?.flagId, high);
      expect(ids(view.conditions), [frost]);
      expect([view.conditions.single.name, view.conditions.single.colorName], ['Demo: Frost risk', 'Blue']);
      expect(view.history, hasLength(6));
      expect(view.history.first.flag.flagId, wet);
      expect(view.history.first.action, 'clear');
      expect({for (final h in view.history) h.authorName}, {'Demo Blair'});
      expect({for (final h in view.history) h.state}, {FlagChangeState.sent});
      expect(view.sentForReview, isFalse);
    });

    test('a change made on this phone counts at once, before its receipt and after it', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      server.seed(
        entityFlagChange,
        {'patientId': p, 'flagId': medium, 'action': 'set', 'reason': 'Demo: weekly check'},
        by: blair,
        at: start.subtract(const Duration(days: 1)),
      );
      await services.patients.open(p);
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      expect(flags().flagsOf(p).riskLevel?.flagId, high);
      await phone.engine.syncAll(force: true);
      // Confirmed, and the chart not yet downloaded again: still this phone's.
      expect(flags().flagsOf(p).riskLevel?.flagId, high);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).riskLevel?.flagId, high);
    });

    // Review finding F1: a change confirmed here, and not yet dated by a chart, keeps its own time (the
    // corrected clock's, as the server's when reads it), never the phone's own clock's, which may run
    // off the server's by anything short of the pause limit.
    test('a change confirmed here is dated by its own time until a chart dates it: the clock three minutes '
        'ahead', () async {
      final p = await openedPatient();
      phone.wall = phone.wall.add(const Duration(minutes: 3));
      expect(phone.clock.status.paused, isFalse, reason: 'within the limit, so charting goes on');
      final first = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'confirmed');

      advance(const Duration(minutes: 1));
      server.offline = true;
      final second = flags().record(p, flagId: medium, action: 'set', reason: 'Demo: doing better');
      final view = flags().flagsOf(p);
      expect([view.riskLevel?.flagId, flags().riskLevelOf(p)?.flagId], [medium, medium]);
      expect(
        [for (final h in view.history) (h.changeId, h.state, h.at)],
        [
          (second, FlagChangeState.waiting, start.add(const Duration(minutes: 1))),
          (first, FlagChangeState.sent, start),
        ],
      );

      server.offline = false;
      await phone.engine.syncAll(force: true);
      expect(flags().flagsOf(p).riskLevel?.flagId, medium);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).riskLevel?.flagId, medium, reason: 'as the server holds it');
    });

    test('with the clock ahead, None clears the level the phone shows, which the server then takes off', () async {
      final p = await openedPatient();
      phone.wall = phone.wall.add(const Duration(minutes: 3));
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      advance(const Duration(minutes: 1));
      server.offline = true;
      flags().save(p, riskLevel: medium, conditions: const {}, reason: 'Demo: doing better');
      advance(const Duration(seconds: 30));
      expect(flags().flagsOf(p).riskLevel?.flagId, medium);
      final cleared = flags().save(p, riskLevel: null, conditions: const {}, reason: 'Demo: discharged');
      expect((createOf(cleared.single).value! as Map<String, Object?>)['flagId'], medium);
      expect(flags().flagsOf(p).riskLevel, isNull);

      server.offline = false;
      await phone.engine.syncAll(force: true);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).riskLevel, isNull, reason: 'the server holds no level either');
    });

    test('with the clock behind, a change confirmed here after a teammate’s still counts after it', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      server.seed(
        entityFlagChange,
        {'patientId': p, 'flagId': medium, 'action': 'set', 'reason': 'Demo: weekly check'},
        by: blair,
        at: start.subtract(const Duration(minutes: 1)),
      );
      await services.patients.open(p);
      phone.wall = phone.wall.subtract(const Duration(minutes: 3));
      expect(phone.clock.status.paused, isFalse, reason: 'within the limit, so charting goes on');
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'confirmed');
      final view = flags().flagsOf(p);
      expect([view.riskLevel?.flagId, view.history.first.changeId], [high, id]);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).riskLevel?.flagId, high, reason: 'as the server holds it');
    });

    test('a change made while the clock had no reference is dated no later than its receipt, as the server '
        'dates it', () async {
      final p = await openedPatient();
      // The phone restarts offline, its clock two hours ahead: no reference, so nothing pauses and the
      // change carries the phone's own time.
      server.offline = true;
      phone.boot.reboot();
      phone.wall = phone.wall.add(const Duration(hours: 2));
      await phone.restart();
      services = servicesFor(FakeSyncServer.healthcareStaff.toList());
      expect(phone.clock.status.state, ClockState.unverified);
      final first = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      server.offline = false;
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'confirmed');
      // The sync measured the clock; the person puts it right, and a minute later chooses Medium.
      phone.wall = phone.wall.subtract(const Duration(hours: 2));
      advance(const Duration(minutes: 1));
      server.offline = true;
      final second = flags().record(p, flagId: medium, action: 'set', reason: 'Demo: doing better');
      final view = flags().flagsOf(p);
      expect(view.riskLevel?.flagId, medium);
      expect([for (final h in view.history) h.changeId], [second, first]);
      expect(view.history.last.at, start, reason: 'its receipt’s time, as the server’s effective time is');
    });

    // Review finding S1, the chart's side: a change confirmed by a receipt replayed after its first
    // answer was lost is dated as the server dated it, never by when the replay was answered.
    test('a change whose first answer was lost, made while the clock had no reference, is dated as the server '
        'dated it, not by when its receipt came again', () async {
      final p = await openedPatient();
      server.offline = true;
      phone.boot.reboot();
      phone.wall = phone.wall.add(const Duration(hours: 2));
      await phone.restart();
      services = servicesFor(FakeSyncServer.healthcareStaff.toList());
      expect(phone.clock.status.state, ClockState.unverified);
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      server.offline = false;
      server.dropPushResponses = 1;
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), hasLength(1), reason: 'the server took it; its answer never came');
      // The person puts the clock right; half an hour on, the phone sends the change again.
      phone.wall = phone.wall.subtract(const Duration(hours: 2));
      advance(const Duration(minutes: 30));
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'its stored receipt confirms it');
      final dated = DateTime.parse(server.records[id]!.attributes['effectiveAt']! as String);
      expect(dated, start, reason: 'the server dated it at its first receipt');
      expect(flags().flagsOf(p).history.single.at, dated);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).history.single.at, dated, reason: 'as the chart dates it');
    });

    test(
      'a change the server holds for review shows only as Sent for review, until a Program Admin accepts it',
      () async {
        final p = await openedPatient();
        // The person's role lost patients.edit while the phone was offline.
        server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
        final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
        final changeId = createOf(id).changeId;
        await phone.engine.syncAll(force: true);
        expect(flagChanges(), isEmpty, reason: 'held there, so it left the phone');
        expect(server.held.keys, contains(changeId));

        var view = flags().flagsOf(p);
        expect(view.riskLevel, isNull);
        expect(view.sentForReview, isTrue);
        expect([for (final h in view.history) (h.changeId, h.state)], [(id, FlagChangeState.inReview)]);

        server.acceptHeld(changeId);
        await services.charts.fetch([p], reason: FetchChartsReason.refresh);
        view = flags().flagsOf(p);
        expect(view.riskLevel?.flagId, high);
        expect(view.sentForReview, isFalse);
      },
    );

    test('a change the server refused counts nowhere and shows only in Needs attention', () async {
      final p = await openedPatient();
      // The server's list lost a flag this phone's copy still holds (a build fault, 6.2).
      server.presetsOf(team).heads.remove(medium);
      final id = flags().record(p, flagId: medium, action: 'set', reason: 'Demo: weekly check');
      await phone.engine.syncAll(force: true);
      expect(createOf(id).state, ChangeState.rejected);
      final view = flags().flagsOf(p);
      expect(view.riskLevel, isNull);
      expect([for (final h in view.history) h.changeId], isNot(contains(id)));
    });

    test('a flag change of a flag the reader may not see is left out of the fold and the history', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      server.seed(entityFlagChange, {
        'patientId': p,
        'flagId': pregnancy,
        'action': 'set',
        'reason': 'Demo: told the team',
      }, by: blair);
      await services.patients.open(p);
      expect(ids(flags().flagsOf(p).conditions), [pregnancy]);
      // The same phone's records, read for a reader who sees no sensitive problem.
      final chw = servicesFor(FakeSyncServer.chw.toList());
      final view = chw.flags.flagsOf(p);
      expect([view.conditions, view.history], [isEmpty, isEmpty]);
    });
  });

  group('Entered in error (6.2; section 11, rows 23 and 24)', () {
    test('its author marks a change: it drops out, and stays in the history with the mark', () async {
      final p = await openedPatient();
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      final shown = flags().flagsOf(p).history.single;
      expect(flags().mayEnterInError(shown), isTrue);
      server.offline = true;

      flags().enterInError(id, '  Demo: set on the wrong patient  ');
      final mark = flagChanges().single;
      expect(
        [mark.op, mark.field, mark.value, mark.patientId],
        [
          'set',
          'enteredInError',
          {'reason': 'Demo: set on the wrong patient'},
          p,
        ],
      );
      final view = flags().flagsOf(p);
      expect(view.riskLevel, isNull);
      final row = view.history.single;
      expect([row.enteredInError?.reason, row.enteredInError?.waiting], ['Demo: set on the wrong patient', true]);
      expect(flags().mayEnterInError(row), isFalse, reason: 'marked once');
      expect(() => flags().enterInError(id, 'Demo: again'), refused('entered_in_error'));

      server.offline = false;
      await phone.engine.syncAll(force: true);
      expect(server.records[id]!.status, 'entered_in_error');
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      final after = flags().flagsOf(p);
      expect(after.riskLevel, isNull);
      expect(after.history.single.enteredInError?.reason, 'Demo: set on the wrong patient');
    });

    test('a holder of team.manage_users marks a teammate’s change; anyone else may not', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      final id = server.seed(entityFlagChange, {
        'patientId': p,
        'flagId': frost,
        'action': 'set',
        'reason': 'Demo: sleeps by the river',
      }, by: blair);
      await services.patients.open(p);
      final row = flags().flagsOf(p).history.single;
      // Healthcare Staff don't manage the team's people.
      expect(flags().mayEnterInError(row), isFalse);
      expect(() => flags().enterInError(id, 'Demo: wrong patient'), refused('not_allowed'));
      expect(flagChanges(), isEmpty);

      final admin = servicesFor([...FakeSyncServer.healthcareStaff, 'team.manage_users']);
      expect(admin.flags.mayEnterInError(admin.flags.flagsOf(p).history.single), isTrue);
      admin.flags.enterInError(id, 'Demo: wrong patient');
      expect(admin.flags.flagsOf(p).conditions, isEmpty);
    });

    test('a mark’s reason is 3 to 300 code points: two astral characters are too few, 300 are taken', () async {
      final p = await openedPatient();
      final id = flags().record(p, flagId: frost, action: 'set', reason: 'Demo: sleeps by the river');
      expect(() => flags().enterInError(id, '🧊🧊'), refused('reason'));
      expect(() => flags().enterInError(id, 'x' * 301), refused('reason'));
      flags().enterInError(id, '🧊' * 300);
      expect(flagChanges().last.value, {'reason': '🧊' * 300});
    });

    test('nothing is marked while the clock is paused or the store is frozen', () async {
      final p = await openedPatient();
      final id = flags().record(p, flagId: frost, action: 'set', reason: 'Demo: sleeps by the river');
      pauseClock();
      expect(() => flags().enterInError(id, 'Demo: wrong patient'), throwsA(isA<ChartingPaused>()));
      resumeClock();
      store().freeze(frozen);
      expect(() => flags().enterInError(id, 'Demo: wrong patient'), throwsA(isA<ChartingPaused>()));
      expect(flagChanges(), hasLength(1));
    });

    test('its reasons reach only its author and Program Admins: a teammate sees the mark, never why', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      final id = server.seed(entityFlagChange, {
        'patientId': p,
        'flagId': frost,
        'action': 'set',
        'reason': 'Demo: sleeps by the river',
      }, by: blair);
      server.serverEdit(id, 'enteredInError', {'reason': 'Demo: wrong patient'}, by: blair);
      await services.patients.open(p);
      final row = flags().flagsOf(p).history.single;
      expect([row.reason, row.enteredInError?.reason], [null, null]);
      expect(row.enteredInError?.byName, 'Demo Blair');
      expect(row.enteredInError?.at, isNotNull);
    });

    // Review finding F4: the server holds a mark of this phone's for a Program Admin when the role was
    // lowered while the phone kept its permissions. Its change still counts on the server's chart.
    /// High set and charted, then marked by its author after the role lost patients.edit: held.
    Future<({String patientId, String recordId, String markChange})> heldMark() async {
      final p = await openedPatient();
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      advance(const Duration(minutes: 1));
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      flags().enterInError(id, 'Demo: set on the wrong patient');
      final markChange = flagChanges().single.changeId;
      await phone.engine.syncAll(force: true);
      expect(server.held.keys, contains(markChange));
      expect(flagChanges(), isEmpty, reason: 'held there, so it left the phone');
      return (patientId: p, recordId: id, markChange: markChange);
    }

    test('a mark the server holds for review is Sent for review, and its change counts until a Program Admin '
        'accepts it, before the chart comes again and after', () async {
      final held = await heldMark();
      final p = held.patientId;
      void expectHeld() {
        final view = flags().flagsOf(p);
        expect([view.riskLevel?.flagId, view.sentForReview], [high, true]);
        final row = view.history.single;
        expect([row.state, row.enteredInError?.held, row.enteredInError?.waiting], [FlagChangeState.sent, true, false]);
        expect(flags().mayEnterInError(row), isFalse, reason: 'sent once');
      }

      expectHeld();
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expectHeld();

      server.acceptHeld(held.markChange);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      final view = flags().flagsOf(p);
      expect([view.riskLevel, view.sentForReview, view.history.single.enteredInError?.held], [null, false, false]);
    });

    test('a held mark a Program Admin didn’t apply leaves its change standing, unmarked', () async {
      final held = await heldMark();
      server.rejectHeld(held.markChange);
      await services.notices.sync();
      var view = flags().flagsOf(held.patientId);
      expect([view.riskLevel?.flagId, view.sentForReview, view.history.single.enteredInError], [high, false, null]);
      await services.charts.fetch([held.patientId], reason: FetchChartsReason.refresh);
      view = flags().flagsOf(held.patientId);
      expect([view.riskLevel?.flagId, view.sentForReview, view.history.single.enteredInError], [high, false, null]);
    });

    test('a mark made again once a held one wasn’t applied, and taken, is the change’s mark', () async {
      final held = await heldMark();
      server.rejectHeld(held.markChange);
      await services.notices.sync();
      // The role is put right; the person marks the change again, and the server takes it.
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff};
      expect(flags().mayEnterInError(flags().flagsOf(held.patientId).history.single), isTrue);
      flags().enterInError(held.recordId, 'Demo: set on the wrong patient, again');
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'taken');
      expect(server.records[held.recordId]!.status, 'entered_in_error');
      final view = flags().flagsOf(held.patientId);
      expect([view.riskLevel, view.sentForReview], [null, false]);
      final mark = view.history.single.enteredInError;
      expect([mark?.held, mark?.waiting, mark?.reason], [false, false, 'Demo: set on the wrong patient, again']);
    });
  });

  group('the two refusals a worker can fix (6.2, D121)', () {
    /// A risk level the server's list lost after this phone pulled it (a build fault): its change is
    /// refused `unknown_flag`.
    Future<OutboxEntry> refusedFlag(String p, {String tier = 'primary'}) async {
      final ghost = server.addPreset(team, 'flag', flag('Demo: Old level', tier, 'grey', 40));
      await pullPresets();
      server.presetsOf(team).heads.remove(ghost);
      final id = flags().record(p, flagId: ghost, action: 'set', reason: 'Demo: left hospital');
      await phone.engine.syncAll(force: true);
      final entry = createOf(id);
      expect([entry.state, entry.details?['problem']], [ChangeState.rejected, 'unknown_flag']);
      return entry;
    }

    test('Choose a flag: the refused change is sent again with the flag and the reason chosen', () async {
      final p = await openedPatient();
      final entry = await refusedFlag(p);
      expect([settledByFlag(entry), settledByReason(entry)], [true, false]);
      // The active risk levels the person may see; the refused flag is not offered again.
      expect(ids(flags().flagsToChoose(entry.changeId)), [high, medium]);

      pauseClock();
      expect(
        () => flags().chooseFlag(entry.changeId, flagId: medium, reason: 'Demo: left hospital'),
        throwsA(isA<ChartingPaused>()),
      );
      resumeClock();
      expect(() => flags().chooseFlag(entry.changeId, flagId: medium, reason: ''), refused('reason_invalid'));

      flags().chooseFlag(entry.changeId, flagId: medium, reason: 'Demo: left hospital this week');
      await phone.engine.syncAll(force: true);
      expect(store().needsAttention(), isEmpty);
      final stored = server.records[entry.recordId]!;
      expect([stored.attributes['flagId'], stored.attributes['reason']], [medium, 'Demo: left hospital this week']);
      expect(flags().flagsOf(p).riskLevel?.flagId, medium);
    });

    test('Choose a flag offers nothing where no active flag of the tier is left, and sends nothing', () async {
      final p = await openedPatient();
      for (final f in [frost, wet, pregnancy, heat]) {
        server.archivePreset(team, f);
      }
      await pullPresets();
      final entry = await refusedFlag(p, tier: 'secondary');
      expect(flags().flagsToChoose(entry.changeId), isEmpty);
    });

    // Review finding F2: a refused clear sent again with another flag would clear that one.
    test('Choose a flag offers nothing for a refused clear, and sends nothing: no other flag is cleared in its '
        'place', () async {
      final p = await openedPatient();
      final ghost = server.addPreset(team, 'flag', flag('Demo: Old level', 'primary', 'grey', 40));
      await pullPresets();
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      advance(const Duration(minutes: 1));
      flags().record(p, flagId: ghost, action: 'set', reason: 'Demo: weekly check');
      await phone.engine.syncAll(force: true);
      server.presetsOf(team).heads.remove(ghost);
      advance(const Duration(minutes: 1));
      final id = flags().record(p, flagId: ghost, action: 'clear', reason: 'Demo: doing better');
      await phone.engine.syncAll(force: true);
      final entry = createOf(id);
      expect(
        [entry.state, entry.details?['problem'], settledByFlag(entry), clearsFlag(entry)],
        [ChangeState.rejected, 'unknown_flag', true, true],
      );

      expect(flags().flagsToChoose(entry.changeId), isEmpty);
      expect(
        () => flags().chooseFlag(entry.changeId, flagId: high, reason: 'Demo: doing better'),
        refused('unknown_flag'),
      );
      await phone.engine.syncAll(force: true);
      expect(createOf(id).state, ChangeState.rejected, reason: 'nothing was sent again');
      expect([
        for (final r in server.records.values)
          if (r.entity == entityFlagChange && r.attributes['action'] == 'clear') r.id,
      ], isEmpty);
    });

    test('Change the reason: a change the server refused for its reason is sent again with the new one', () async {
      final p = await openedPatient();
      server.offline = true;
      final id = flags().record(p, flagId: frost, action: 'set', reason: 'Demo: sleeps by the river');
      link.spoil.add(id);
      server.offline = false;
      await phone.engine.syncAll(force: true);
      final entry = createOf(id);
      expect([entry.state, entry.details?['problem']], [ChangeState.rejected, 'reason_invalid']);
      expect([settledByFlag(entry), settledByReason(entry)], [false, true]);
      expect(flags().flagsOf(p).conditions, isEmpty);

      expect(() => flags().changeReason(entry.changeId, '🧊' * 501), refused('reason_invalid'));
      pauseClock();
      expect(() => flags().changeReason(entry.changeId, 'Demo: by the river'), throwsA(isA<ChartingPaused>()));
      resumeClock();

      flags().changeReason(entry.changeId, 'Demo: sleeps by the river most nights');
      await phone.engine.syncAll(force: true);
      expect(store().needsAttention(), isEmpty);
      expect(server.records[id]!.attributes['reason'], 'Demo: sleeps by the river most nights');
      expect(ids(flags().flagsOf(p).conditions), [frost]);
    });

    test('neither fix takes a change it doesn’t settle', () async {
      final p = await openedPatient();
      final entry = await refusedFlag(p);
      expect(() => flags().changeReason(entry.changeId, 'Demo: new reason'), throwsA(isA<StateError>()));
      expect(() => flags().chooseFlag('no-such-change', flagId: high, reason: 'Demo: x'), throwsA(isA<StateError>()));
    });
  });

  group('the notice of a held change that won’t be applied (6.2; the second part’s note 4)', () {
    /// A risk level this phone set while its role had lost patients.edit: the server holds it. Made
    /// through the store, so this group holds the notices alone, whatever the domain class does.
    Future<({String patientId, String changeId, String recordId})> heldChange() async {
      final p = await openedPatient();
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      final id = store().createRecord(entityFlagChange, {
        'patientId': p,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      final changeId = createOf(id).changeId;
      await phone.engine.syncAll(force: true);
      expect(server.held.keys, contains(changeId));
      return (patientId: p, changeId: changeId, recordId: id);
    }

    test('is filed under its patient when this phone no longer holds the change, after the purge', () async {
      final held = await heldChange();
      // The chart's 24 hours pass with no work on it: the change's record goes with the chart.
      advance(const Duration(hours: 25));
      store().purge();
      expect(store().record(held.recordId), isNull);

      server.rejectHeld(held.changeId);
      await services.notices.sync();
      final notice = store().notices().singleWhere((n) => n.kind == noticeFlagChangeNotApplied);
      expect([notice.recordId, notice.patientId], [held.recordId, held.patientId]);
    });

    test('is filed under its patient on another phone of the same person, which never held the change', () async {
      final held = await heldChange();
      server.rejectHeld(held.changeId);
      final other = TestPhone(
        userId: alex,
        teamId: team,
        transport: () => server.transportFor(alex, team),
        wall: phone.wall,
      );
      addTearDown(other.close);
      final theirs = PatientServices(
        OpenTeam(
          userId: alex,
          teamId: team,
          store: other.store,
          api: other.engine.api,
          clock: other.clock,
          permissions: FakeSyncServer.healthcareStaff.toList(),
        ),
        copy: (_) async => true,
        wallNow: () => other.wall,
      );
      await other.engine.syncAll();
      await theirs.notices.sync();
      final notice = other.store.notices().singleWhere((n) => n.kind == noticeFlagChangeNotApplied);
      expect([notice.recordId, notice.patientId], [held.recordId, held.patientId]);
    });

    test('names the survivor when the patient was merged since', () async {
      final held = await heldChange();
      final kept = server.seedPatient(preferredName: 'Demo Wrenna');
      advance(const Duration(hours: 25));
      store().purge();
      server.merge(held.patientId, kept);
      await services.charts.fetch([held.patientId], reason: FetchChartsReason.refresh);
      server.rejectHeld(held.changeId);
      await services.notices.sync();
      final notice = store().notices().singleWhere((n) => n.kind == noticeFlagChangeNotApplied);
      expect(notice.patientId, kept);
    });

    // Verification finding VS3: a held create stays held here once a Program Admin takes it. Where a
    // chart this phone holds whole lists the change, the create was taken and a held mark is what wasn't
    // applied; where the phone holds both held and no whole chart lists the change, either could be.
    test('names the mark of a held create a whole chart lists, and no act once no whole chart lists it', () async {
      final p = await openedPatient();
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      final create = createOf(id).changeId;
      await phone.engine.syncAll(force: true);
      server.acceptHeld(create);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      flags().enterInError(id, 'Demo: set on the wrong patient');
      final mark = flagChanges().single.changeId;
      await phone.engine.syncAll(force: true);
      server.rejectHeld(mark);
      await services.notices.sync();
      expect(flags().notAppliedOf(id), NotAppliedFlagChange.mark);

      // Merged since into a patient whose chart this phone doesn't hold, as the index tells it.
      final kept = server.seedPatient(preferredName: 'Demo Wrenna');
      server.merge(p, kept);
      await TeamIndexRefresher(
        services.index,
        phone.engine.api,
        wallNow: () => phone.wall,
      ).refresh(RefreshReason.manual);
      expect([store().canonicalPatient(p), store().record(id)?.id], [kept, id]);
      expect(flags().notAppliedOf(id), isNull);
    });
  });

  // Card P5-phone-domain's own cases, beside those written ahead of it: intake's risk level in
  // createPatient's transaction, a patient the phone holds no whole chart of, a held change a Program
  // Admin didn't apply, and Save's tiers.
  group('intake’s risk level, saved with the patient in one transaction (8.2)', () {
    Intake intake(IntakeRiskLevel level) =>
        Intake(consent: const ConsentGiven(), preferredName: 'Demo Wren', riskLevel: level);

    test('a set whose parent is the patient’s create, after it in the outbox', () {
      final made = services.patients.createPatient(intake((flagId: high, reason: '  Demo: left hospital  ')));
      final patient = store().outbox().singleWhere((e) => e.entity == entityPatient && e.op == 'create');
      final change = createOf(made.riskLevelChangeId!);
      expect(change.value, {
        'patientId': made.patientId,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      expect([change.seq > patient.seq, change.patientId], [true, made.patientId]);
      expect(flags().flagsOf(made.patientId).riskLevel?.flagId, high);
    });

    test('one the flags refuse saves nothing, the patient included', () {
      for (final (level, problem) in [
        ((flagId: high, reason: '   '), 'reason_invalid'),
        // A condition is no risk level.
        ((flagId: frost, reason: 'Demo: by the river'), 'unknown_flag'),
        ((flagId: '5e5e5e5e-0000-4000-8000-000000000001', reason: 'Demo: from another team'), 'unknown_flag'),
      ]) {
        expect(() => services.patients.createPatient(intake(level)), refused(problem));
      }
      expect(store().outbox().where((e) => e.entity != entityAudit), isEmpty);
    });

    test('while the clock is paused, or where the presets aren’t held, the patient saves without one', () {
      pauseClock();
      expect(
        services.patients.createPatient(intake((flagId: high, reason: 'Demo: left hospital'))).riskLevelChangeId,
        isNull,
      );
      resumeClock();
      PresetStore(store()).clear();
      expect(
        services.patients.createPatient(intake((flagId: high, reason: 'Demo: left hospital'))).riskLevelChangeId,
        isNull,
      );
      expect(store().outbox().where((e) => e.entity == entityPatient), hasLength(2));
      expect(flagChanges(), isEmpty);
    });
  });

  // Review finding S2: what the flag hook and the status check hook keep of a record goes with it,
  // whichever path deletes the record, so nothing of a chart outlives it (D30, D29).
  group('what a receipt hook keeps goes with its record', () {
    List<String> keptFor(String recordId) => [
      for (final r in store().database.select('SELECT kind FROM receipt_kept WHERE record_id = ?', [recordId]))
        r['kind']! as String,
    ];

    /// A flag set and a status check confirmed on this phone, for one patient.
    Future<({String flagChange, String problem})> confirmedWork() async {
      final p = await openedPatient();
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      final problem = services.problems.add(p, title: 'Demo: cough', status: 'ongoing');
      await phone.engine.syncAll(force: true);
      services.problems.confirmStatus(problem);
      await phone.engine.syncAll(force: true);
      expect(store().outbox(), isEmpty, reason: 'every change confirmed');
      expect(
        [keptFor(id), keptFor(problem)],
        [
          ['flagChange'],
          ['statusCheck'],
        ],
      );
      return (flagChange: id, problem: problem);
    }

    void expectNothingKept() {
      expect(store().database.select('SELECT record_id FROM receipt_kept'), isEmpty);
      expect(
        store().database.select("SELECT key FROM kv WHERE key LIKE 'flagChange%' OR key LIKE 'statusCheck%'"),
        isEmpty,
      );
    }

    test('at the purge, once the chart is out of use', () async {
      final w = await confirmedWork();
      advance(const Duration(hours: 25));
      store().purge();
      expect([store().record(w.flagChange), store().record(w.problem)], [null, null]);
      expectNothingKept();
    });

    test('at Log out anyway, which deletes the server’s data and keeps local work', () async {
      final w = await confirmedWork();
      store().clearServerData();
      expect([store().record(w.flagChange), store().record(w.problem)], [null, null]);
      expectNothingKept();
    });
  });

  group('a patient whose chart the phone doesn’t hold whole: the index’s word (6.1)', () {
    Future<void> indexRefresh() =>
        TeamIndexRefresher(services.index, phone.engine.api, wallNow: () => phone.wall).refresh(RefreshReason.manual);

    void seeded(String p, String flagId, {String action = 'set', Duration ago = Duration.zero}) => server.seed(
      entityFlagChange,
      {'patientId': p, 'flagId': flagId, 'action': action, 'reason': 'Demo: weekly check'},
      by: blair,
      at: serverTime.subtract(ago),
    );

    test('its index entry’s flags stand until the chart comes, with this phone’s changes after them', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      seeded(p, medium, ago: const Duration(days: 1));
      seeded(p, frost, ago: const Duration(days: 1));
      await indexRefresh();
      server.offline = true;
      // Never opened: the list's row reads the index.
      expect(flags().riskLevelOf(p)?.flagId, medium);
      // Opened offline from the index: a list-only copy, with the index's flags and no history.
      await services.patients.open(p);
      expect(isPartialChart(store(), p), isTrue);
      var view = flags().flagsOf(p);
      expect(
        [view.riskLevel?.flagId, ids(view.conditions), view.history],
        [
          medium,
          [frost],
          isEmpty,
        ],
      );

      advance(const Duration(minutes: 1));
      final clear = flags().record(p, flagId: medium, action: 'clear', reason: 'Demo: doing better');
      view = flags().flagsOf(p);
      expect(
        [view.riskLevel, ids(view.conditions), flags().riskLevelOf(p)],
        [
          null,
          [frost],
          null,
        ],
      );
      expect([for (final h in view.history) h.changeId], [clear]);

      // Online, the chart whole: the server's word.
      server.offline = false;
      await phone.engine.syncAll(force: true);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      view = flags().flagsOf(p);
      expect(
        [view.riskLevel, ids(view.conditions), view.history.length],
        [
          null,
          [frost],
          3,
        ],
      );
    });

    test('a change of this phone’s the index has taken in since is not folded again over a later one', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      await indexRefresh();
      server.offline = true;
      await services.patients.open(p);
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      server.offline = false;
      await phone.engine.syncAll(force: true);
      // A teammate sets a later level; the index, downloaded again, holds both.
      advance(const Duration(minutes: 5));
      seeded(p, medium);
      advance(const Duration(minutes: 1));
      await indexRefresh();
      expect(services.index.flagsOf(p)?.primary, medium);
      expect(flags().flagsOf(p).riskLevel?.flagId, medium);
    });

    // Review finding F1, the index's side: the index's time is the server's, so a change confirmed
    // here is weighed against it by when its receipt came, by the corrected clock, never by the phone's
    // own clock or by when it was made.
    test('a change confirmed before the index comes again counts after the index’s word: the clock two '
        'minutes behind', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      phone.wall = phone.wall.subtract(const Duration(minutes: 2));
      expect(phone.clock.status.paused, isFalse, reason: 'within the limit, so charting goes on');
      await indexRefresh();
      server.offline = true;
      await services.patients.open(p);
      expect(isPartialChart(store(), p), isTrue);
      advance(const Duration(minutes: 1));
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      expect(flags().flagsOf(p).riskLevel?.flagId, high);

      server.offline = false;
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'confirmed');
      expect([flags().flagsOf(p).riskLevel?.flagId, flags().riskLevelOf(p)?.flagId], [high, high]);
    });

    // Review finding S1: the index's time and a receipt's are both the server's. A change whose first
    // answer was lost is confirmed by its stored receipt, which says when the server received it, so an
    // index worked out since, which holds it and a teammate's later change, keeps its word.
    test('a change whose first answer was lost counts as the index holds it once its receipt comes again, under '
        'a teammate’s later change', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      await indexRefresh();
      server.offline = true;
      await services.patients.open(p);
      expect(isPartialChart(store(), p), isTrue);
      advance(const Duration(minutes: 1));
      flags().record(p, flagId: medium, action: 'set', reason: 'Demo: doing better');
      server.offline = false;
      server.dropPushResponses = 1;
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), hasLength(1), reason: 'the server took it; its answer never came');

      // A teammate sets High later; the index, downloaded again, holds both, High last.
      advance(const Duration(minutes: 5));
      seeded(p, high);
      advance(const Duration(minutes: 1));
      await indexRefresh();
      expect(services.index.flagsOf(p)?.primary, high);

      advance(const Duration(seconds: 30));
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'its stored receipt confirms it');
      expect(isPartialChart(store(), p), isTrue);
      expect([flags().flagsOf(p).riskLevel?.flagId, flags().riskLevelOf(p)?.flagId], [high, high]);
      await services.charts.fetch([p], reason: FetchChartsReason.refresh);
      expect(flags().flagsOf(p).riskLevel?.flagId, high, reason: 'as the server holds it');
    });

    test('a change confirmed after an index that came while it waited counts, the chart not downloaded', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      await indexRefresh();
      server.offline = true;
      await services.patients.open(p);
      advance(const Duration(minutes: 1));
      flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      advance(const Duration(minutes: 30));
      server.offline = false;
      // A pull to refresh downloads the index while the change still waits here.
      await indexRefresh();
      expect(flags().flagsOf(p).riskLevel?.flagId, high);
      advance(const Duration(seconds: 20));
      await phone.engine.syncAll(force: true);
      expect(flagChanges(), isEmpty, reason: 'confirmed');
      expect(isPartialChart(store(), p), isTrue);
      expect([flags().flagsOf(p).riskLevel?.flagId, flags().riskLevelOf(p)?.flagId], [high, high]);
    });

    // Review finding F4, without the chart: the notice that a held mark wasn't applied names the change
    // it was for, as the notice of a held create does; the change stands.
    test('a held mark a Program Admin didn’t apply leaves its change counting, from the index alone', () async {
      final p = server.seedPatient(preferredName: 'Demo Wren');
      await indexRefresh();
      server.offline = true;
      await services.patients.open(p);
      advance(const Duration(minutes: 1));
      final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
      server.offline = false;
      await phone.engine.syncAll(force: true);
      server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      flags().enterInError(id, 'Demo: set on the wrong patient');
      final markChange = flagChanges().single.changeId;
      await phone.engine.syncAll(force: true);
      expect(server.held.keys, contains(markChange));
      expect(isPartialChart(store(), p), isTrue);
      expect([flags().flagsOf(p).riskLevel?.flagId, flags().flagsOf(p).sentForReview], [high, true]);

      server.rejectHeld(markChange);
      await services.notices.sync();
      final view = flags().flagsOf(p);
      expect([view.riskLevel?.flagId, view.sentForReview, view.history.single.enteredInError], [high, false, null]);
    });
  });

  test('a change the chart no longer lists counts nowhere, though its record is still here', () async {
    final p = server.seedPatient(preferredName: 'Demo Wren');
    final id = server.seed(entityFlagChange, {
      'patientId': p,
      'flagId': wet,
      'action': 'set',
      'reason': 'Demo: wet feet',
    }, by: blair);
    await services.patients.open(p);
    expect(ids(flags().flagsOf(p).conditions), [wet]);
    // The server's list lost the flag (a build fault, 6.2), so its chart leaves the change out; this
    // phone's copy of the presets still holds the flag, and its store the record, until the purge.
    server.presetsOf(team).heads.remove(wet);
    await services.charts.fetch([p], reason: FetchChartsReason.refresh);
    expect(store().record(id), isNotNull);
    final view = flags().flagsOf(p);
    expect([view.conditions, view.history], [isEmpty, isEmpty]);
  });

  test('a held change a Program Admin didn’t apply leaves Sent for review and counts nowhere', () async {
    final p = await openedPatient();
    server.permissions[alex] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
    final id = flags().record(p, flagId: high, action: 'set', reason: 'Demo: left hospital');
    final changeId = createOf(id).changeId;
    await phone.engine.syncAll(force: true);
    expect(flags().flagsOf(p).sentForReview, isTrue);
    server.rejectHeld(changeId);
    await services.notices.sync();
    final view = flags().flagsOf(p);
    expect([view.riskLevel, view.sentForReview, view.history], [null, false, isEmpty]);
  });

  test('this phone’s own changes on one instant count in the order they were made', () async {
    final p = await openedPatient();
    final more = [
      for (var i = 0; i < 10; i++) server.addPreset(team, 'flag', flag('Demo: Extra $i', 'secondary', 'teal', 100 + i)),
    ];
    await pullPresets();
    // The clock stands still, so each set and its clear fall on one instant: only the order they were
    // made in says which came last. Ordered by ID, about half of them would stay set.
    for (final f in more) {
      flags().record(p, flagId: f, action: 'set', reason: 'Demo: by the river');
      flags().record(p, flagId: f, action: 'clear', reason: 'Demo: moved indoors');
    }
    final view = flags().flagsOf(p);
    expect(view.conditions, isEmpty);
    expect(
      [for (final h in view.history.take(2)) (h.flag.flagId, h.action)],
      [(more.last, 'clear'), (more.last, 'set')],
    );
  });

  test('Save takes a risk level only from the risk levels, and conditions only from the conditions', () async {
    final p = await openedPatient();
    expect(() => flags().save(p, riskLevel: frost, conditions: const {}, reason: 'Demo: x'), refused('unknown_flag'));
    expect(() => flags().save(p, riskLevel: null, conditions: {high}, reason: 'Demo: x'), refused('unknown_flag'));
    expect(flagChanges(), isEmpty);
  });

  group('the copy of the presets the domain reads', () {
    test('a flag the phone’s copy holds is offered by its rank, whether or not the server still has it', () {
      // Choose a flag's fixture above rests on it: the domain offers what the phone's copy holds.
      final copy = PresetStore(store());
      final revision = copy.revision!;
      copy.apply(
        PresetsPull(
          reset: false,
          revision: revision,
          epoch: copy.epoch!,
          presets: [
            PulledPreset(
              id: '5e5e5e5e-0000-4000-8000-000000000002',
              kind: api.PulledPresetKind.flag,
              state: api.PulledPresetState.active,
              version: 1,
              originKey: null,
              body: flag('Demo: Copy only', 'primary', 'green', 50),
            ),
          ],
        ),
      );
      expect(ids(flags().teamFlags(FlagTier.primary)), [high, medium, '5e5e5e5e-0000-4000-8000-000000000002']);
    });
  });
}
