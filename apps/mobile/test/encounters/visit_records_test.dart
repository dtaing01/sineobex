import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show Sending;
import 'package:sineobex_field/encounters/referrals.dart';
import 'package:sineobex_field/encounters/visit_records.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show NewAllergy;
import 'package:sineobex_field/sync/entities.dart'
    show entityAllergy, entityAudit, entityEncounter, entityProblem, entityProblemNote, entityReferral;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Adds to each chart the API answers the timeline's referrals (lifecycle 5.2), which the phone's
/// test server does not give: [referrals] by canonical ID, as snapshots.
class _Charts implements ApiTransport {
  _Charts(this.inner);
  final ApiTransport inner;
  final referrals = <String, List<Map<String, Object?>>>{};

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final result = await inner.send(method, path, query: query, body: body);
    if (path != '/v1/patients/charts') return result;
    final answer = jsonDecode(jsonEncode(result)) as Map<String, Object?>;
    for (final chart in (answer['charts']! as List<Object?>).cast<Map<String, Object?>>()) {
      chart['timeline'] = {'encounters': <Object?>[], 'referrals': referrals[chart['canonicalId']] ?? <Object?>[]};
    }
    return answer;
  }
}

/// The records made at a visit (lifecycle 9.7, 8.4; D91), read from the phone's own copy: its
/// referrals, problems, allergies and problems' notes, whichever chart they are on, each as the
/// person may see it on a chart, and each logged as the server's visit read logs it. Every scenario
/// runs offline first and then syncs to the phone's test server.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 22, 15);
  const staff = FakeSyncServer.healthcareStaff;
  const syphilis = (system: 'icd10cm', code: 'A53.9', display: 'Syphilis, unspecified');

  late FakeSyncServer server;
  late _Charts link;
  late TestPhone phone;
  late PatientServices services;

  setUp(() {
    server = FakeSyncServer(now: () => start);
    link = _Charts(server.transportFor(alex, team));
    phone = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
    services = PatientServices(
      OpenTeam(
        userId: alex,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: staff.toList(),
      ),
      idLinkBaseUrl: 'http://localhost:3100',
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  });
  tearDown(() => phone.close());

  LocalStore store() => phone.store;

  VisitRecords records({Set<String> permissions = staff}) => VisitRecords(
    store(),
    user: EncounterUser(userId: alex, displayName: 'Demo Charter', credential: 'attending', permissions: permissions),
  );

  // The audit entries waiting to send since the last [dropAudits].
  var seen = 0;
  List<Map<String, Object?>> allAudits() => [
    for (final e in store().outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];
  List<Map<String, Object?>> audits() => allAudits().skip(seen).toList();
  void dropAudits() => seen = allAudits().length;

  Future<void> sync() async {
    await phone.engine.syncAll(force: true);
    expect(store().outbox(), isEmpty);
    expect(store().needsAttention(), isEmpty);
    seen = 0;
  }

  Future<String> openedPatient({String name = 'Demo Zee'}) async {
    final p = server.seedPatient(preferredName: name);
    await services.patients.open(p);
    dropAudits();
    return p;
  }

  /// A visit of [patient] with one record of each kind made at it, and one of each made without it.
  ({String visit, String referral, String problem, String allergy, String note, String sensitive, String hiddenNote})
  madeAtAVisit(String patient) {
    final visit = store().createEncounter(kind: 'medical', patientId: patient);
    final referral = Referrals(
      store(),
      user: records().user,
    ).add(patient, referredOn: DateTime(2026, 10, 22), details: 'Demo: dental clinic', encounterId: visit);
    final problem = services.problems.add(patient, title: 'Demo: cough', status: 'new', encounterId: visit);
    final allergy = services.patients.addAllergy(patient, const NewAllergy(substance: 'latex'), encounterId: visit);
    final note = services.problems.addNote(problem, 'Demo: worse at night', encounterId: visit);
    final sensitive = services.problems.add(
      patient,
      title: 'Demo: follow-up',
      code: syphilis,
      status: 'new',
      encounterId: visit,
    );
    final hiddenNote = services.problems.addNote(sensitive, 'Demo: treated', encounterId: visit);
    // Made without the visit: not listed.
    Referrals(store(), user: records().user).add(patient, referredOn: DateTime(2026, 10, 22), details: 'Demo: food');
    final byHand = services.problems.add(patient, title: 'Demo: burn', status: 'new');
    services.problems.addNote(byHand, 'Demo: healing');
    services.patients.addAllergy(patient, const NewAllergy(substance: 'peanuts'));
    return (
      visit: visit,
      referral: referral,
      problem: problem,
      allergy: allergy,
      note: note,
      sensitive: sensitive,
      hiddenNote: hiddenNote,
    );
  }

  Map<String, Object?> viewed(String entity, String id, String patient, String source) => {
    'action': 'patient.viewed',
    'entity': entity,
    'entityId': id,
    'patientId': patient,
    'source': source,
  };

  test('each record made at the visit is listed, by kind and in the order made, and logged once as read', () async {
    final p = await openedPatient();
    server.offline = true;
    final made = madeAtAVisit(p);
    final list = records().madeAt(made.visit);
    expect(
      [for (final r in list) (r.runtimeType, r.id)],
      [
        (ReferralMadeAt, made.referral),
        (ProblemMadeAt, made.problem),
        (ProblemMadeAt, made.sensitive),
        (AllergyMadeAt, made.allergy),
        (ProblemNoteMadeAt, made.note),
        (ProblemNoteMadeAt, made.hiddenNote),
      ],
    );
    expect({for (final r in list) r.patientId}, {p});
    expect({for (final r in list) r.onAnotherChart}, {false});
    final referral = list.whereType<ReferralMadeAt>().single.referral;
    expect([referral.details, referral.sending], ['Demo: dental clinic', Sending.waiting]);
    final allergy = list.whereType<AllergyMadeAt>().single.allergy;
    expect([allergy.substance, allergy.active, allergy.pending], ['latex', true, true]);
    final note = list.whereType<ProblemNoteMadeAt>().first;
    expect(
      [note.note.text, note.problemId, note.problemTitle, note.note.pending],
      ['Demo: worse at night', made.problem, 'Demo: cough', true],
    );
    expect(list.whereType<ProblemMadeAt>().first.problem.title, 'Demo: cough');

    // One patient.viewed per record, on its own entity and patient, in the read's transaction.
    expect(audits(), [
      viewed(entityReferral, made.referral, p, 'local'),
      viewed(entityProblem, made.problem, p, 'local'),
      viewed(entityProblem, made.sensitive, p, 'local'),
      viewed(entityAllergy, made.allergy, p, 'local'),
      viewed(entityProblemNote, made.note, p, 'local'),
      viewed(entityProblemNote, made.hiddenNote, p, 'local'),
    ]);
    // A read again of what is on screen logs only what it adds.
    final more = services.problems.addNote(made.problem, 'Demo: better', encounterId: made.visit);
    records().madeAt(made.visit, shownBefore: {for (final r in list) r.id});
    expect([for (final a in audits()) a['entityId']].skip(list.length), [more]);

    // Synced, and the chart downloaded again: the same records, the notes now the chart's copies.
    server.offline = false;
    await sync();
    await services.charts.fetch([p], reason: FetchChartsReason.refresh);
    dropAudits();
    final synced = records().madeAt(made.visit);
    // The test server gives every record the same time, so within a kind the order is the IDs'.
    expect(
      [for (final r in synced) r.runtimeType],
      [
        ReferralMadeAt,
        ProblemMadeAt,
        ProblemMadeAt,
        AllergyMadeAt,
        ProblemNoteMadeAt,
        ProblemNoteMadeAt,
        ProblemNoteMadeAt,
      ],
    );
    expect(
      {for (final r in synced) r.id},
      {made.referral, made.problem, made.sensitive, made.allergy, made.note, made.hiddenNote, more},
    );
    expect(synced.whereType<ReferralMadeAt>().single.referral.sending, Sending.sent);
    expect(synced.whereType<AllergyMadeAt>().single.allergy.pending, isFalse);
    expect([for (final n in synced.whereType<ProblemNoteMadeAt>()) n.note.pending], [false, false, false]);
    expect(audits(), hasLength(synced.length));
  });

  test('a record the phone holds only as the chart’s copy, the timeline’s referrals included, is listed and '
      'logged from the cache', () async {
    final p = await openedPatient();
    final visit = server.seed(entityEncounter, {'kind': 'medical', 'patientId': p});
    final problem = server.seed(entityProblem, {
      'patientId': p,
      'title': 'Demo: wound',
      'status': 'new',
      'encounterId': visit,
    }, by: blair);
    final note = server.seed(entityProblemNote, {
      'problemId': problem,
      'text': 'Demo: dressing changed',
      'encounterId': visit,
    }, by: blair);
    final allergy = server.seed(entityAllergy, {'patientId': p, 'substance': 'latex', 'encounterId': visit}, by: blair);
    final referral = server.seed(entityReferral, {
      'patientId': p,
      'referredOn': '2026-10-22',
      'details': 'Demo: eye clinic',
      'encounterId': visit,
    }, by: blair);
    final r = server.records[referral]!;
    link.referrals[p] = [
      {
        'entity': entityReferral,
        'id': referral,
        'status': r.status,
        'authorUserId': blair,
        'createdAt': '2026-10-22T15:00:00.000Z',
        'updatedAt': '2026-10-22T15:00:00.000Z',
        'version': 1,
        'attributes': {...r.attributes, 'patientId': p, 'recordedAt': '2026-10-22T15:00:00.000Z'},
        'fields': {'enteredInError': r.state('enteredInError')},
      },
    ];
    await services.charts.fetch([p], reason: FetchChartsReason.refresh);
    expect([store().record(note), store().record(referral)], [null, null]);
    server.offline = true;
    dropAudits();

    final list = records().madeAt(visit);
    expect([for (final r in list) r.id], [referral, problem, allergy, note]);
    expect(list.whereType<ReferralMadeAt>().single.referral.details, 'Demo: eye clinic');
    expect(list.whereType<ProblemNoteMadeAt>().single.note.text, 'Demo: dressing changed');
    expect(audits(), [
      viewed(entityReferral, referral, p, 'cache'),
      viewed(entityProblem, problem, p, 'cache'),
      viewed(entityAllergy, allergy, p, 'cache'),
      viewed(entityProblemNote, note, p, 'cache'),
    ]);
  });

  test('each is shown as its chart would show it to the reader, and only what is shown is logged', () async {
    final p = await openedPatient();
    server.offline = true;
    final made = madeAtAVisit(p);

    // Without patients.view_sensitive: no sensitive problem, nor its note.
    final noSensitive = records(permissions: staff.difference({'patients.view_sensitive'})).madeAt(made.visit);
    expect([for (final r in noSensitive) r.id], [made.referral, made.problem, made.allergy, made.note]);
    expect([for (final a in audits()) a['entityId']], [made.referral, made.problem, made.allergy, made.note]);
    dropAudits();

    // A role that doesn't see the problem list: the referral and the allergy only.
    final chw = records(permissions: FakeSyncServer.chw).madeAt(made.visit);
    expect([for (final r in chw) r.id], [made.referral, made.allergy]);
    expect([for (final a in audits()) a['entityId']], [made.referral, made.allergy]);
    dropAudits();

    // A role without patient records sees none of them, and nothing is logged.
    expect(records(permissions: staff.difference({'patients.view'})).madeAt(made.visit), isEmpty);
    expect(audits(), isEmpty);
    server.offline = false;
    await sync();
  });

  test('a visit moved to someone else still lists what was made at it, each saying it is on another chart '
      '(8.4, 12.1 #25)', () async {
    final p = await openedPatient();
    final other = await openedPatient(name: 'Demo Other');
    final made = madeAtAVisit(p);
    await sync();
    store().setField(made.visit, 'patientId', other);
    await sync();
    dropAudits();

    final list = records().madeAt(made.visit);
    expect(list, hasLength(6));
    expect({for (final r in list) r.patientId}, {p});
    expect({for (final r in list) r.onAnotherChart}, {true});
    // Logged on the first patient's chart, where each record still is.
    expect({for (final a in audits()) a['patientId']}, {p});

    // Moved back: no longer on another chart.
    store().setField(made.visit, 'patientId', p);
    expect({for (final r in records().madeAt(made.visit)) r.onAnotherChart}, {false});
  });

  test('nothing is read while the store is frozen, and nothing logged', () async {
    final p = await openedPatient();
    final made = madeAtAVisit(p);
    dropAudits();
    store().freeze('Demo: handing over');
    expect(() => records().madeAt(made.visit), throwsA(isA<ChartingPaused>()));
    expect(audits(), isEmpty);
  });
}
