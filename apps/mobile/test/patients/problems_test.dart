import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason;
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show NewAllergy;
import 'package:sineobex_field/patients/problems.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Problems made or changed in an encounter (lifecycle 8.3, 8.4; card L4-problems-link), and an
/// allergy recorded in one (9.7): each names the visit, so the server marks a problem made at one; a
/// visit of someone else is refused as the server would refuse it; and a chart says "at a visit" only
/// while that visit is the patient's.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 22, 15);
  const cellulitis = (system: 'icd10cm', code: 'L03.116', display: 'Cellulitis of left lower limb');

  late FakeSyncServer server;
  late TestPhone phone;
  late PatientServices services;

  setUp(() {
    server = FakeSyncServer(now: () => start);
    phone = TestPhone(userId: alex, teamId: team, transport: () => server.transportFor(alex, team), wall: start);
    services = PatientServices(
      OpenTeam(
        userId: alex,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: FakeSyncServer.healthcareStaff.toList(),
      ),
      idLinkBaseUrl: 'http://localhost:3100',
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  });
  tearDown(() => phone.close());

  LocalStore store() => phone.store;
  Problems problems() => services.problems;

  OutboxEntry createOf(String recordId) =>
      store().outbox().singleWhere((e) => e.recordId == recordId && e.op == 'create');

  Matcher refusedAsOtherPatient() => throwsA(
    isA<LocalValidationError>()
        .having((e) => e.problem, 'problem', 'encounter_other_patient')
        .having(
          (e) => e.message,
          'message',
          'That visit is someone else’s. Add this from their chart, or without the visit.',
        ),
  );

  Future<String> openedPatient({String name = 'Demo Zee'}) async {
    final p = server.seedPatient(preferredName: name);
    await services.patients.open(p);
    return p;
  }

  test('a problem added at a visit names it, offline and then on the server, which marks it made at one', () async {
    final p = await openedPatient();
    server.offline = true;
    final visit = store().createEncounter(kind: 'medical', patientId: p);
    final atVisit = problems().add(p, title: 'Demo: cellulitis', code: cellulitis, status: 'new', encounterId: visit);
    final byHand = problems().add(p, title: 'Demo: cough', status: 'ongoing');
    expect(createOf(atVisit).value, containsPair('encounterId', visit));
    expect(createOf(byHand).value, isNot(contains('encounterId')));
    final shown = {for (final v in problems().problemsOf(p)!) v.id: (v.encounterId, v.atVisit)};
    expect(shown, {atVisit: (visit, true), byHand: (null, false)});

    server.offline = false;
    await phone.engine.syncAll(force: true);
    expect(store().outbox(), isEmpty);
    expect(
      [server.records[atVisit]!.attributes['source'], server.records[atVisit]!.attributes['createdEncounterId']],
      ['encounter', visit],
    );
    expect(server.records[byHand]!.attributes['source'], 'manual');
    // The server's copy, as the chart gives it, still says where it was made.
    await services.charts.fetch([p], reason: FetchChartsReason.refresh);
    expect(store().record(atVisit)!.attributes['createdEncounterId'], visit);
    expect([problems().problem(atVisit)!.encounterId, problems().problem(atVisit)!.atVisit], [visit, true]);
    expect([problems().problem(byHand)!.encounterId, problems().problem(byHand)!.atVisit], [null, false]);
  });

  test('a status moved at a visit, a note written at one, and Still has this? at one, each name it', () async {
    final p = server.seedPatient(preferredName: 'Demo Zee');
    final cough = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'new'});
    final burn = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: burn', 'status': 'new'});
    server.serverEdit(burn, 'status', {'status': 'resolved', 'encounterId': null}, by: blair);
    await services.patients.open(p);
    server.offline = true;
    final visit = store().createEncounter(kind: 'medical', patientId: p);
    problems().move(cough, 'ongoing', encounterId: visit);
    final note = problems().addNote(cough, 'Demo: better with rest', encounterId: visit);
    final again = problems().stillHasThis(burn, cameBack: true, encounterId: visit);
    expect(store().outbox().singleWhere((e) => e.recordId == cough).value, {'status': 'ongoing', 'encounterId': visit});
    expect(createOf(note).value, containsPair('encounterId', visit));
    expect(createOf(again).value, allOf(containsPair('encounterId', visit), containsPair('recurrenceOf', burn)));
    expect(problems().problem(again)!.atVisit, isTrue);

    server.offline = false;
    await phone.engine.syncAll(force: true);
    expect(store().outbox(), isEmpty);
    expect(server.records[cough]!.fields['status']!.value, {'status': 'ongoing', 'encounterId': visit});
    expect(server.records[note]!.attributes['encounterId'], visit);
    expect(
      [server.records[again]!.attributes['source'], server.records[again]!.attributes['createdEncounterId']],
      ['encounter', visit],
    );
  });

  test('a visit of someone outside the patient’s group is refused, writing nothing; one with no patient, '
      'or of a record merged into the patient, is taken', () async {
    final p = await openedPatient();
    final other = await openedPatient(name: 'Demo Other');
    final merged = await openedPatient(name: 'Demo Zed');
    final cough = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: cough', 'status': 'new'});
    final burn = server.seed(entityProblem, {'patientId': p, 'title': 'Demo: burn', 'status': 'new'});
    server.serverEdit(burn, 'status', {'status': 'resolved', 'encounterId': null}, by: blair);
    server.merge(merged, p);
    await services.charts.fetch([p, merged], reason: FetchChartsReason.refresh);
    expect(store().canonicalPatient(merged), p);

    server.offline = true;
    final theirs = store().createEncounter(kind: 'medical', patientId: other);
    final before = store().outbox().length;
    expect(
      () => problems().add(p, title: 'Demo: cellulitis', status: 'new', encounterId: theirs),
      refusedAsOtherPatient(),
    );
    expect(() => problems().addNote(cough, 'Demo: better', encounterId: theirs), refusedAsOtherPatient());
    expect(() => problems().stillHasThis(burn, cameBack: true, encounterId: theirs), refusedAsOtherPatient());
    expect(store().outbox(), hasLength(before));

    // A visit that names nobody names nobody else; a merged record's visit is the patient's.
    final nobodys = store().createEncounter(kind: 'non_medical');
    final ofMerged = store().createEncounter(kind: 'medical', patientId: merged);
    final a = problems().add(p, title: 'Demo: cellulitis', status: 'new', encounterId: nobodys);
    final b = problems().add(p, title: 'Demo: wound', status: 'new', encounterId: ofMerged);
    final n = problems().addNote(cough, 'Demo: better', encounterId: ofMerged);
    expect([problems().problem(a)!.atVisit, problems().problem(b)!.atVisit], [true, true]);

    server.offline = false;
    await phone.engine.syncAll(force: true);
    expect([store().outbox(), store().needsAttention()], [isEmpty, isEmpty]);
    expect(
      [server.records[a]!.attributes['createdEncounterId'], server.records[b]!.attributes['createdEncounterId']],
      [nobodys, ofMerged],
    );
    expect(server.records[n]!.attributes['encounterId'], ofMerged);
  });

  test('an allergy recorded at a visit names it; a visit of someone outside the group is refused, writing '
      'nothing', () async {
    final p = await openedPatient();
    final other = await openedPatient(name: 'Demo Other');
    server.offline = true;
    final visit = store().createEncounter(kind: 'medical', patientId: p);
    final theirs = store().createEncounter(kind: 'medical', patientId: other);
    final nobodys = store().createEncounter(kind: 'non_medical');
    final before = store().outbox().length;
    expect(
      () => services.patients.addAllergy(p, const NewAllergy(substance: 'latex'), encounterId: theirs),
      refusedAsOtherPatient(),
    );
    expect(store().outbox(), hasLength(before));

    final atVisit = services.patients.addAllergy(
      p,
      const NewAllergy(substance: 'latex', severity: 'mild'),
      encounterId: visit,
    );
    final atNobodys = services.patients.addAllergy(p, const NewAllergy(substance: 'peanuts'), encounterId: nobodys);
    final byHand = services.patients.addAllergy(p, const NewAllergy(substance: 'shellfish'));
    expect(createOf(atVisit).value, containsPair('encounterId', visit));
    expect(createOf(atNobodys).value, containsPair('encounterId', nobodys));
    expect(createOf(byHand).value, isNot(contains('encounterId')));

    server.offline = false;
    await phone.engine.syncAll(force: true);
    expect([store().outbox(), store().needsAttention()], [isEmpty, isEmpty]);
    expect(
      [
        for (final id in [atVisit, atNobodys, byHand]) server.records[id]!.attributes['encounterId'],
      ],
      [visit, nobodys, null],
    );
  });

  test('“at a visit” only while the visit this phone holds is the patient’s; one it does not hold is '
      'taken at its word', () async {
    final p = await openedPatient();
    final other = server.seedPatient(preferredName: 'Demo Other');
    // Made at a visit this phone never held: the server checked it was the patient's then.
    final elsewhere = server.seed(entityEncounter, {'kind': 'medical', 'patientId': p});
    final fromServer = server.seed(entityProblem, {
      'patientId': p,
      'title': 'Demo: cough',
      'status': 'new',
      'encounterId': elsewhere,
    });
    final visit = store().createEncounter(kind: 'medical', patientId: p);
    final here = problems().add(p, title: 'Demo: cellulitis', status: 'new', encounterId: visit);
    await phone.engine.syncAll(force: true);
    await services.charts.fetch([p], reason: FetchChartsReason.refresh);
    expect([problems().problem(fromServer)!.encounterId, problems().problem(fromServer)!.atVisit], [elsewhere, true]);
    expect(problems().problem(here)!.atVisit, isTrue);

    // The visit moved to someone else (12.1 #25): the problem stays with the patient, still naming
    // the visit, which no longer says it was theirs.
    server.serverEdit(visit, 'patientId', other, by: blair);
    await phone.engine.syncAll(force: true);
    expect(store().record(visit)!.fields['patientId']!.value, other);
    expect([problems().problem(here)!.encounterId, problems().problem(here)!.atVisit], [visit, false]);
  });

  test('a note’s problem status adds it as New or Ongoing; nothing in a note resolves one', () {
    expect(
      [
        for (final s in ['new', 'chronic', 'improving', 'worse', null, 'resolved']) problemListStatus(s),
      ],
      ['new', 'ongoing', 'ongoing', 'ongoing', null, null],
    );
  });
}
