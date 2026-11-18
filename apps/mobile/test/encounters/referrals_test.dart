import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart'
    show FetchRecords, RecordEntity, RecordRef, RecordSnapshot, SineobexApi;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/referrals.dart';
import 'package:sineobex_field/patients/chart_cache.dart' show chartMetaField;
import 'package:sineobex_field/sync/entities.dart' show entityAudit, entityPatient, entityReferral;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Referrals on the phone (lifecycle 4.7, 7, 9.10; card L4-referrals): the list the Referrals sheet
/// shows, Add referral, and Entered in error, each offline first and then synced to the phone's test
/// server (4.9), which holds the API's rules for who may make and take back a referral.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const chris = 'c0000000-0000-4000-8000-00000000000c';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;
  const chw = FakeSyncServer.chw;

  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() => server = FakeSyncServer(now: () => start));
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  Referrals referrals(TestPhone p, {String credential = 'attending', Set<String> permissions = staff}) => Referrals(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: credential,
      permissions: permissions,
    ),
  );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  void serverTookAll(TestPhone p) {
    expect(p.store.outbox().where((e) => e.entity != entityAudit), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  List<Map<String, Object?>> audits(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  Future<RecordSnapshot> snapshotOf(String userId, String id) async {
    final api = SineobexApi(server.transportFor(userId, team));
    final got = await api.fetchRecords(
      body: FetchRecords(
        records: [RecordRef(entity: RecordEntity.fromJson(entityReferral), id: id)],
      ),
    );
    return got.records.single;
  }

  group('the list (lifecycle 7, 9.10)', () {
    test('a referral made offline shows at once, waiting to send, newest first; the server takes it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = referrals(p);
      var changed = 0;
      r.onChanged = () => changed++;
      final older = r.add(patient, referredOn: DateTime(2026, 10, 18), details: '  Demo: shelter intake  ');
      final newer = r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: dental clinic');
      expect(changed, 2);
      expect(p.store.outbox().first.value, {
        'patientId': patient,
        'referredOn': '2026-10-18',
        'details': 'Demo: shelter intake',
        'encounterId': null,
      });

      final list = r.openReferrals(patient);
      expect([for (final x in list) x.id], [newer, older]);
      final first = list.last;
      expect(
        [first.referredOn, first.details, first.recordedBy.userId, first.atVisit, first.enteredInError, first.sending],
        ['2026-10-18', 'Demo: shelter intake', alex, false, null, Sending.waiting],
      );

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[older]!.attributes['referredOn'], '2026-10-18');
      expect([for (final x in r.openReferrals(patient)) x.sending], [Sending.sent, Sending.sent]);
    });

    test('each referral shown is logged as it is read, once; nothing is read while the store is frozen', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = referrals(p);
      final one = r.add(patient, referredOn: DateTime(2026, 10, 19), details: 'Demo: food bank');
      final shown = r.openReferrals(patient);
      expect(audits(p), [
        {
          'action': 'patient.viewed',
          'entity': entityReferral,
          'entityId': one,
          'patientId': patient,
          'source': 'local',
        },
      ]);

      // A read again of what is on screen logs only what it adds.
      final two = r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: eye clinic');
      r.openReferrals(patient, shownBefore: {for (final x in shown) x.id});
      expect([for (final a in audits(p)) a['entityId']], [one, two]);

      p.store.freeze('Demo: handing over');
      final before = p.store.outbox().length;
      expect(() => r.openReferrals(patient), throwsA(isA<ChartingPaused>()));
      // The profile's own list, which its chart's read logged, shows nothing either.
      expect(() => r.referralsOf(patient), throwsA(isA<ChartingPaused>()));
      expect(
        () => r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: x'),
        throwsA(isA<ChartingPaused>()),
      );
      expect(p.store.outbox(), hasLength(before));
    });

    test('a referral the chart lists and the phone does not hold is listed, and can be taken back offline', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final id = server.seed(entityReferral, {
        'patientId': patient,
        'referredOn': '2026-10-15',
        'details': 'Demo: housing navigator',
        'encounterId': null,
      }, by: blair);
      final chart = [await snapshotOf(alex, id)];
      server.offline = true;
      final r = referrals(p);
      final listed = r.openReferrals(patient, chart: chart).single;
      expect(
        [listed.id, listed.recordedBy.userId, listed.sending, listed.details],
        [id, blair, Sending.sent, 'Demo: housing navigator'],
      );
      expect(audits(p).single, {
        'action': 'patient.viewed',
        'entity': entityReferral,
        'entityId': id,
        'patientId': patient,
        'source': 'cache',
      });

      // A clinician takes back anyone's referral (4.7).
      expect(r.mayEnterInError(listed), isTrue);
      r.enterInError(id, '  Demo: entered on the wrong chart ', chart: chart);
      final marked = r.openReferrals(patient, chart: chart).single;
      expect([marked.enteredInError, marked.markWaiting], ['Demo: entered on the wrong chart', true]);
      expect(r.mayEnterInError(marked), isFalse);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[id]!.status, 'entered_in_error');
      // It stays in the list, struck through: nothing is deleted.
      expect(r.openReferrals(patient, chart: chart).single.enteredInError, 'Demo: entered on the wrong chart');
    });
  });

  group('on whose chart, at which visit (lifecycle 8.4)', () {
    /// [patient]'s chart as this phone cached it: its timeline lists [visits], the group's.
    void cachedTimeline(TestPhone p, String patient, List<String> visits) => p.store.importServerRecord(
      ServerRecord(
        entity: entityPatient,
        id: patient,
        status: 'active',
        authorUserId: '',
        attributes: const {},
        fields: {
          chartMetaField: ServerField(
            value: {
              'partial': false,
              'timeline': {
                'encounters': [
                  for (final v in visits)
                    {
                      'encounterId': v,
                      'kind': 'non_medical',
                      'notes': <Object?>[],
                      'startedAt': '2026-10-15T15:00:00.000Z',
                      'status': 'completed',
                    },
                ],
                'referrals': <Object?>[],
              },
            },
            version: 0,
          ),
        },
      ),
      open: false,
    );

    test('a visit the phone doesn’t hold is “a visit” of the chart only when the chart lists it as the '
        'group’s (review LRA-3)', () async {
      final p = phone(alex);
      final a = server.seedPatient();
      final b = server.seedPatient();
      final kept = server.seed('encounter', {'kind': 'non_medical', 'patientId': a}, by: blair);
      final moved = server.seed('encounter', {'kind': 'non_medical', 'patientId': a}, by: blair);
      String referralAt(String visit) => server.seed(entityReferral, {
        'patientId': a,
        'referredOn': '2026-10-15',
        'details': 'Demo: housing navigator',
        'encounterId': visit,
      }, by: blair);
      final atKept = referralAt(kept);
      final atMoved = referralAt(moved);
      // The second visit's patient was corrected to someone else since (8.4, D91).
      server.serverEdit(moved, 'patientId', b, by: blair);
      final chart = [await snapshotOf(alex, atKept), await snapshotOf(alex, atMoved)];
      cachedTimeline(p, a, [kept]);
      final listed = {for (final r in referrals(p).openReferrals(a, chart: chart)) r.id: r.atVisit};
      expect(listed, {atKept: true, atMoved: false});
      expect([p.store.record(kept), p.store.record(moved)], [isNull, isNull]);
    });

    test('the chart lists only its group’s referrals (review LRA-5)', () async {
      final p = phone(alex);
      final a = server.seedPatient();
      final other = server.seedPatient();
      String referralOf(String patient) => server.seed(entityReferral, {
        'patientId': patient,
        'referredOn': '2026-10-15',
        'details': 'Demo: dental clinic',
        'encounterId': null,
      }, by: blair);
      final ours = referralOf(a);
      // A chart cached before a merge was undone still lists the split-off patient's referral.
      final theirs = referralOf(other);
      final chart = [await snapshotOf(alex, ours), await snapshotOf(alex, theirs)];
      expect([for (final r in referrals(p).openReferrals(a, chart: chart)) r.id], [ours]);
    });
  });

  group('Add referral (lifecycle 4.7, 9.10)', () {
    test('a community health worker makes one with no visit; without referrals.create nothing is written', () async {
      final p = phone(chris);
      server.permissions[chris] = chw;
      final patient = server.seedPatient();
      final r = referrals(p, credential: 'chw', permissions: chw);
      expect(r.mayAdd, isTrue);
      final id = r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: benefits office');
      await sync(p);
      serverTookAll(p);
      expect(server.records[id]!.author, chris);

      final viewer = referrals(phone(blair), permissions: {'patients.view'});
      expect(viewer.mayAdd, isFalse);
      expect(
        () => viewer.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: benefits office'),
        refused('not_allowed'),
      );
      expect(phones.last.store.outbox(), isEmpty);
    });

    test('the date and the details are checked as the server checks them, and the refusal is worded', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = referrals(p);
      final tooLong = List.filled(2001, 'a').join();
      expect(() => r.add(patient, referredOn: DateTime(2026, 10, 20), details: '   '), refused('details'));
      expect(() => r.add(patient, referredOn: DateTime(2026, 10, 20), details: tooLong), refused('details'));
      expect(
        () => r.add(patient, referredOn: DateTime(2026, 10, 23), details: 'Demo: clinic'),
        throwsA(
          isA<LocalValidationError>()
              .having((e) => e.problem, 'problem', 'referral_in_future')
              .having((e) => e.message, 'message', 'A referral can’t be dated in the future.'),
        ),
      );
      expect(() => r.add(patient, referredOn: DateTime(99, 3, 1), details: 'Demo: clinic'), refused('date'));
      expect(p.store.outbox(), isEmpty);
      // A phone a time zone ahead may be on tomorrow already, as the server allows (4.7).
      r.add(patient, referredOn: DateTime(2026, 10, 21), details: List.filled(2000, 'a').join());
      await sync(p);
      serverTookAll(p);
    });

    test('a referral never waits for the clock check', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      await sync(p);
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      final id = referrals(p).add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: shelter intake');
      expect(p.store.outbox().single.recordId, id);
    });
  });

  group('at a visit (lifecycle 7, 8.4, 9.7)', () {
    test('Add referral from the summary screen names the visit; a visit of someone else is refused here', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final other = server.seedPatient(preferredName: 'Demo Other');
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final elsewhere = p.store.createEncounter(kind: 'non_medical', patientId: other);
      final r = referrals(p);
      final id = r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: dental', encounterId: visit);
      expect(r.openReferrals(patient).single.atVisit, isTrue);
      expect(r.madeAt(visit).map((x) => x.id), [id]);

      final before = p.store.outbox().length;
      expect(
        () => r.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: dental', encounterId: elsewhere),
        refused('encounter_other_patient'),
      );
      expect(p.store.outbox(), hasLength(before));
      await sync(p);
      serverTookAll(p);

      // The visit moves to someone else: the referral stays with its patient, naming the visit, and
      // their chart no longer says "at a visit" (8.4, 12.1 #25); the visit still lists it (9.7).
      p.store.setField(visit, 'patientId', other);
      await sync(p);
      serverTookAll(p);
      expect(r.openReferrals(patient).single.atVisit, isFalse);
      expect(r.madeAt(visit).map((x) => x.id), [id]);
    });
  });

  group('Entered in error (lifecycle 4.7, 7)', () {
    test('its author takes it back, a clinician anyone’s, and a community health worker no one else’s', () async {
      final a = phone(alex);
      final c = phone(chris);
      server.permissions[chris] = chw;
      final patient = server.seedPatient();
      final ra = referrals(a);
      final rc = referrals(c, credential: 'chw', permissions: chw);
      final byAlex = ra.add(patient, referredOn: DateTime(2026, 10, 19), details: 'Demo: dental');
      final byChris = rc.add(patient, referredOn: DateTime(2026, 10, 19), details: 'Demo: food bank');
      final byChrisToo = rc.add(patient, referredOn: DateTime(2026, 10, 20), details: 'Demo: eye clinic');
      await sync(a);
      await sync(c);
      serverTookAll(a);
      serverTookAll(c);
      final chart = [await snapshotOf(chris, byAlex)];

      // Chris may not take back Alex's: nothing is written, and the server would hold it.
      final alexs = rc.openReferrals(patient, chart: chart).firstWhere((x) => x.id == byAlex);
      expect(rc.mayEnterInError(alexs), isFalse);
      final before = c.store.outbox().length;
      expect(() => rc.enterInError(byAlex, 'Demo: not mine', chart: chart), refused('not_allowed'));
      expect(() => rc.enterInError(byChris, 'no'), refused('reason'));
      expect(c.store.outbox(), hasLength(before));

      rc.enterInError(byChris, 'Demo: wrong patient');
      final mine = rc.openReferrals(patient).firstWhere((x) => x.id == byChris);
      expect([mine.enteredInError, mine.markWaiting], ['Demo: wrong patient', true]);
      expect(() => rc.enterInError(byChris, 'Demo: again'), refused('entered_in_error'));
      await sync(c);
      serverTookAll(c);
      expect(server.records[byChris]!.status, 'entered_in_error');

      // Alex charts, so takes back Chris's other one.
      final chrisChart = [await snapshotOf(alex, byChrisToo)];
      ra.enterInError(byChrisToo, 'Demo: duplicate', chart: chrisChart);
      await sync(a);
      serverTookAll(a);
      expect(server.records[byChrisToo]!.status, 'entered_in_error');
    });
  });
}
