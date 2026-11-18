import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/referrals.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/chart_cache.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/sync/entities.dart' show entityReferral;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart';

/// Adds to each chart the API answers what it says of the patient's visits (lifecycle 5.2), which
/// the phone's test server does not give: [visits] by canonical ID.
class _Charts implements ApiTransport {
  _Charts(this.inner);
  final ApiTransport inner;
  final visits = <String, Map<String, Object?>>{};
  bool offline = false;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    final result = await inner.send(method, path, query: query, body: body);
    if (path != '/v1/patients/charts') return result;
    final answer = jsonDecode(jsonEncode(result)) as Map<String, Object?>;
    for (final chart in (answer['charts']! as List<Object?>).cast<Map<String, Object?>>()) {
      chart.addAll(visits[chart['canonicalId']] ?? const {});
    }
    return answer;
  }
}

/// The profile with no signal (lifecycle 5.2, 8.2, 9.1; card L4-chart-cache): what the chart cache
/// keeps of a patient's visits is what the timeline, the last three visits and the referrals are
/// read from offline, each read logged as it would be from the phone's own records.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const v1 = 'e0000000-0000-4000-8000-000000000001';
  const v2 = 'e0000000-0000-4000-8000-000000000002';
  const n1 = 'f0000000-0000-4000-8000-000000000001';
  const n2 = 'f0000000-0000-4000-8000-000000000002';
  final start = DateTime.utc(2026, 10, 22, 15);
  const staff = FakeSyncServer.healthcareStaff;

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
  });
  tearDown(() => phone.close());

  final definitions = {
    for (final d in testNoteTypes) (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };
  NoteTypeDef? typeOf(String key) => definitions.values.where((d) => d.key == key).firstOrNull;
  final user = EncounterUser(userId: alex, displayName: 'Demo Charter', credential: 'attending', permissions: staff);
  NoteDefinitions defs() => NoteDefinitions(held: (key, version) async => definitions[(key, version)]);

  List<Map<String, Object?>> audits() => [
    for (final e in phone.store.outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];

  /// The API's chart answer for [patientId]: two Medical visits by Blair, newest first, in the
  /// timeline and in full, and the group's [referral] as the timeline lists it.
  Map<String, Object?> visitsOf(String patientId, String referral) {
    final blairRef = userRef(blair, 'Demo Blair');
    const started = {v1: '2026-10-10T15:00:00.000Z', v2: '2026-10-15T15:00:00.000Z'};
    const notes = {v1: n1, v2: n2};
    final r = server.records[referral]!;
    return {
      'timeline': {
        'encounters': [
          for (final v in [v2, v1])
            {
              'encounterId': v,
              'startedAt': started[v],
              'kind': 'medical',
              'status': 'completed',
              'notes': [
                {
                  'noteId': notes[v],
                  'noteTypeKey': testMedical.key,
                  'group': 'clinical',
                  'status': 'completed',
                  'attestation': 'not_needed',
                },
              ],
            },
        ],
        'referrals': [
          {
            'entity': 'referral',
            'id': referral,
            'status': r.status,
            'authorUserId': blair,
            'createdAt': '2026-10-12T16:00:00.000Z',
            'updatedAt': '2026-10-12T16:00:00.000Z',
            'version': 1,
            'attributes': {
              ...r.attributes,
              'patientId': patientId,
              'recordedAt': '2026-10-12T16:00:00.000Z',
              'clockVerified': true,
            },
            'fields': {'enteredInError': r.state('enteredInError')},
          },
        ],
      },
      'recentVisits': [
        for (final v in [v2, v1])
          visitJson(
            encounterId: v,
            patientId: patientId,
            startedAt: started[v]!,
            notes: [
              visitNoteJson(
                noteId: notes[v]!,
                author: blairRef,
                signoffs: [signoffJson(id: '1${notes[v]!.substring(1)}', signer: blairRef, credential: 'attending')],
              ),
            ],
          ),
      ],
    };
  }

  test('offline, the profile reads its cached chart: the timeline, a recent visit and the referrals', () async {
    final patient = server.seedPatient(preferredName: 'Demo Zee');
    final referral = server.seed(entityReferral, {
      'patientId': patient,
      'referredOn': '2026-10-12',
      'details': 'Demo: dental clinic',
      'encounterId': null,
    }, by: blair);
    link.visits[patient] = visitsOf(patient, referral);
    await services.patients.open(patient);
    link.offline = true;

    final meta = chartMetaOf(phone.store, patient)!;
    final repo = EncounterRepository(
      phone.store,
      user: user,
      definitions: defs(),
      noteTypes: () async => definitions.values,
    );
    final timeline = await repo.openTimeline(patient, chart: meta.timeline, typeOf: typeOf);
    expect(
      [
        for (final row in timeline.rows)
          switch (row) {
            TimelineVisitRow(:final encounterId, :final notes) => (encounterId, notes.single.shown),
            TimelineReferralRow(:final referral) => (referral.id, null),
          },
      ],
      [(v2, NoteShown.waitingForCosigner), (referral, null), (v1, NoteShown.waitingForCosigner)],
    );

    // The last visits open with no signal, each record logged here as the server logs a read.
    final before = audits().length;
    final visit = await EncounterApi(
      phone.engine.api,
      phone.store,
      user: user,
      definitions: defs(),
    ).openVisit(v1, phone: repo, recent: meta.recentVisits);
    expect(
      [visit.source, visit.notes.single.noteId, visit.notes.single.author.name],
      [VisitSource.chart, n1, 'Demo Blair'],
    );
    expect([
      for (final a in audits().skip(before)) (a['action'], a['entityId'], a['source']),
    ], containsAllInOrder([('encounter.viewed', v1, 'cache'), ('note.viewed', n1, 'cache')]));

    // A referral the chart lists and the phone does not hold is listed, logged, and marked offline.
    final referrals = Referrals(phone.store, user: user);
    final listed = referrals.openReferrals(patient, chart: meta.referrals);
    expect([listed.single.id, listed.single.details], [referral, 'Demo: dental clinic']);
    expect((audits().last['action'], audits().last['entityId']), ('patient.viewed', referral));
    referrals.enterInError(referral, 'Demo: wrong patient', chart: meta.referrals);

    link.offline = false;
    await phone.engine.syncAll(force: true);
    expect(phone.store.outbox(), isEmpty);
    expect(server.records[referral]!.fields['enteredInError']!.value, {'reason': 'Demo: wrong patient'});
  });
}
