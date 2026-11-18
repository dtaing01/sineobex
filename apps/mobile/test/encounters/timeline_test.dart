import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show SineobexApi, Timeline;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/local_store.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart';

/// The patient profile's timeline on the phone (lifecycle 5.2, 8.2, 9.1; card L4-timeline): the
/// chart's list of visits and referrals merged with the visits the phone holds, which it knows
/// better of, newest first; each note's state in words, "Waiting to send" until what was done here
/// is confirmed; the type filter; and Show earlier visits.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const v1 = 'e0000000-0000-4000-8000-000000000001';
  const v2 = 'e0000000-0000-4000-8000-000000000002';
  const n1 = 'f0000000-0000-4000-8000-000000000001';
  const n2 = 'f0000000-0000-4000-8000-000000000002';
  const n3 = 'f0000000-0000-4000-8000-000000000003';
  const referral = 'f0000000-0000-4000-8000-000000000004';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;

  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    server = FakeSyncServer(now: () => start);
    for (final d in restrictedNoteTypes) {
      server.noteTypes[(d['key']! as String, d['version']! as int)] = d;
    }
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {
    for (final d in [...testNoteTypes, redFlagsNoteType, ...restrictedNoteTypes])
      (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };
  NoteTypeDef? typeOf(String key) => definitions.values.where((d) => d.key == key).firstOrNull;
  NoteTypeDef definition(TestNoteType t) => definitions[(t.key, t.version)]!;

  EncounterRepository repo(TestPhone p, {Set<String> permissions = staff}) => EncounterRepository(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: 'attending',
      permissions: permissions,
    ),
    definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
    noteTypes: () async => definitions.values,
  );

  String note(TestPhone p, String visit, TestNoteType type, [Map<String, Object?> data = const {}]) =>
      p.store.createNote(encounterId: visit, noteTypeKey: type.key, noteTypeVersion: type.version, data: data);

  void complete(TestPhone p, String noteId, TestNoteType type) => p.store.finishNotes(
    [
      NoteToFinish(
        noteId: noteId,
        shownHash: p.store.contentHashOf(noteId, definition(type)),
        act: SignoffAct.complete,
        statementVersion: 'complete-2026-11',
      ),
    ],
    signer: const Signer(credential: 'attending', canSign: true, needsAttestation: false),
    definitionOf: (key, version) => definitions[(key, version)],
  );

  Map<String, Object?> visitRow(
    String id,
    String startedAt, {
    String kind = 'non_medical',
    String status = 'completed',
    List<Map<String, Object?>> notes = const [],
  }) => {'encounterId': id, 'startedAt': startedAt, 'kind': kind, 'status': status, 'notes': notes};

  Map<String, Object?> noteRow(String id, String key, {String status = 'completed', String group = 'clinical'}) => {
    'noteId': id,
    'noteTypeKey': key,
    'group': group,
    'status': status,
    'attestation': 'not_needed',
  };

  Map<String, Object?> referralSnapshot(String patient) => {
    'entity': 'referral',
    'id': referral,
    'status': 'active',
    'authorUserId': blair,
    'createdAt': '2026-10-12T16:00:00.000Z',
    'updatedAt': '2026-10-12T16:00:00.000Z',
    'version': 1,
    'attributes': {
      'patientId': patient,
      'referredOn': '2026-10-12',
      'details': 'Demo: dental clinic',
      'encounterId': null,
      'recordedAt': '2026-10-12T16:00:00.000Z',
      'clockVerified': true,
    },
    'fields': <String, Object?>{},
  };

  List<String> ids(Iterable<TimelineRow> rows) => [
    for (final row in rows)
      switch (row) {
        TimelineVisitRow(:final encounterId) => encounterId,
        TimelineReferralRow(:final referral) => referral.id,
      },
  ];

  TimelineVisitRow visitIn(TimelineView view, String id) =>
      view.rows.whereType<TimelineVisitRow>().firstWhere((r) => r.encounterId == id);

  int auditCount(TestPhone p) => p.store.outbox().where((e) => e.entity == entityAudit).length;

  group('the timeline (lifecycle 5.2, 8.2, 9.1)', () {
    test('the chart’s visits and the phone’s own, newest first; “Waiting to send” until confirmed', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      // A visit the server has, completed here and not sent yet.
      final held = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final heldNote = note(p, held, testNote, {'vitals.pulse': 80});
      await p.engine.syncAll(force: true);
      complete(p, heldNote, testNote);
      // A visit only this phone holds.
      p.advance(const Duration(hours: 1));
      final fresh = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final freshNote = note(p, fresh, testNote, {'vitals.pulse': 70});
      // Someone else's visit on this phone is on their timeline, not this one.
      final other = server.seedPatient(preferredName: 'Demo Other');
      note(p, r.startEncounter(kind: VisitKind.nonMedical, patientId: other), testNote, {'vitals.pulse': 60});

      final chart = Timeline.fromJson({
        'encounters': [
          visitRow(
            held,
            '2026-10-20T15:00:00.000Z',
            status: 'draft',
            notes: [noteRow(heldNote, testNote.key, status: 'draft')],
          ),
          visitRow(v2, '2026-10-15T15:00:00.000Z', kind: 'medical', notes: [noteRow(n2, testMedical.key)]),
          visitRow(v1, '2026-10-10T15:00:00.000Z', notes: [noteRow(n1, testNote.key, group: 'social')]),
        ],
        'referrals': [referralSnapshot(patient)],
      });
      final before = auditCount(p);
      final view = await r.openTimeline(patient, chart: chart, typeOf: typeOf);
      expect(ids(view.rows), [fresh, held, v2, referral, v1]);
      expect(view.earlierBefore, isNull);

      final first = visitIn(view, fresh);
      expect(
        [first.kind, first.status, first.waitingToSend, first.onPhone, first.startedAt],
        [VisitKind.nonMedical, NoteStatus.draft, true, true, start.add(const Duration(hours: 1))],
      );
      expect([for (final c in first.notes) (c.noteId, c.title, c.shown)], [(freshNote, 'Test note', NoteShown.draft)]);
      // The phone knows better than the chart of what it did: complete, waiting to send.
      final second = visitIn(view, held);
      expect(
        [second.status, second.waitingToSend, second.notes.single.shown, second.notes.single.waitingToSend],
        [NoteStatus.completed, true, NoteShown.complete, true],
      );
      // The chart's own: a Medical note completed waits for a co-signer; a Non-Medical one is complete.
      expect(
        [visitIn(view, v2).notes.single.shown, visitIn(view, v2).onPhone, visitIn(view, v2).waitingToSend],
        [NoteShown.waitingForCosigner, false, false],
      );
      expect(
        [visitIn(view, v1).notes.single.shown, visitIn(view, v1).notes.single.title],
        [NoteShown.complete, 'Test note'],
      );
      final referralRow = view.rows.whereType<TimelineReferralRow>().single;
      expect([referralRow.referral.details, referralRow.referral.recordedBy.userId], ['Demo: dental clinic', blair]);
      // Part of the chart already opened and logged (phase 3): the timeline logs nothing of its own.
      expect(auditCount(p), before);

      await p.engine.syncAll(force: true);
      final synced = r.readTimeline(patient, chart: chart, typeOf: typeOf);
      expect([visitIn(synced, fresh).waitingToSend, visitIn(synced, held).waitingToSend], [false, false]);
    });

    test('a note the person may not see, and an empty draft, are left out of their visit’s row', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: blair);
      final sensitive = server.seed('encounter_note', {
        'encounterId': visit,
        'noteTypeKey': 'test_sensitive',
        'noteTypeVersion': 1,
        'data': {'talk.notes': 'Demo: talked through housing'},
      }, by: blair);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', sensitive), isTrue);
      note(p, visit, testNote);

      final reader = repo(p, permissions: staff.difference({'patients.view_sensitive'}));
      final hidden = await reader.openTimeline(patient, typeOf: typeOf);
      expect(
        [ids(hidden.rows), visitIn(hidden, visit).notes],
        [
          [visit],
          isEmpty,
        ],
      );
      final shown = await repo(p).openTimeline(patient, typeOf: typeOf);
      expect([for (final c in visitIn(shown, visit).notes) (c.noteId, c.group)], [(sensitive, 'psych')]);

      // The chart was cached while their role saw it: the phone holds the note and hides it now, so
      // the chart's chip of it is not shown either (review LRA-5).
      final chart = Timeline.fromJson({
        'encounters': [
          visitRow(visit, '2026-10-20T15:00:00.000Z', notes: [noteRow(sensitive, 'test_sensitive', group: 'psych')]),
        ],
        'referrals': <Object?>[],
      });
      final cached = await reader.openTimeline(patient, chart: chart, typeOf: typeOf);
      expect(visitIn(cached, visit).notes, isEmpty);
    });

    test('the type filter: a visit under each group its notes are in, a referral under Referrals', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final chart = Timeline.fromJson({
        'encounters': [
          visitRow(v2, '2026-10-15T15:00:00.000Z', notes: [noteRow(n2, testNote.key, group: 'psych')]),
          visitRow(
            v1,
            '2026-10-10T15:00:00.000Z',
            notes: [
              noteRow(n1, testNote.key, group: 'social'),
              noteRow(n3, testNote.key),
            ],
          ),
        ],
        'referrals': [referralSnapshot(patient)],
      });
      final view = repo(p).readTimeline(patient, chart: chart, typeOf: typeOf);
      expect(timelineGroups, ['clinical', 'psych', 'social', 'referrals', 'outreach', 'harm_reduction', 'wound']);
      expect(ids(view.filtered({'psych'})), [v2]);
      expect(ids(view.filtered({'social', 'referrals'})), [referral, v1]);
      expect(ids(view.filtered({'clinical'})), [v1]);
      expect(ids(view.filtered({'wound'})), isEmpty);
      expect(ids(view.filtered(const {})), ids(view.rows));
    });

    test('Show earlier visits: after a full page, the next is asked from before the last shown', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      String visitId(int i) => 'e0000000-0000-4000-8000-${(1000 + i).toString().padLeft(12, '0')}';
      final page = [
        for (var i = 0; i < timelinePage; i++)
          visitRow(visitId(i), DateTime.utc(2026, 10, 1).subtract(Duration(days: i)).toIso8601String()),
      ];
      final chart = Timeline.fromJson({'encounters': page, 'referrals': <Object?>[]});
      final r = repo(p);
      final view = r.readTimeline(patient, chart: chart, typeOf: typeOf);
      expect(view.earlierBefore, visitId(timelinePage - 1));

      final api = ScriptedApi();
      final online = EncounterApi(
        SineobexApi(api),
        p.store,
        user: EncounterUser(userId: alex, displayName: 'Demo Charter', credential: 'attending', permissions: staff),
        definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
      );
      api.on(
        'GET',
        '/v1/patients/$patient/timeline',
        (_) => {
          'encounters': [
            // The last one shown again, as a visit started at the same time may be: listed once.
            visitRow(visitId(timelinePage - 1), page.last['startedAt']! as String),
            visitRow(v1, '2026-01-01T15:00:00.000Z'),
          ],
        },
      );
      final earlier = await online.earlierVisits(patient, before: view.earlierBefore!);
      expect(api.asked.single.query, {'before': visitId(timelinePage - 1)});
      expect(earlier.map((v) => v.encounterId), [visitId(timelinePage - 1), v1]);
      final more = r.readTimeline(patient, chart: chart, earlier: [earlier], typeOf: typeOf);
      expect(ids(more.rows), [for (var i = 0; i < timelinePage; i++) visitId(i), v1]);
      expect(more.earlierBefore, isNull);

      api.offline = true;
      await expectLater(
        online.earlierVisits(patient, before: v1),
        throwsA(isA<EncounterRequestFailed>().having((e) => e.message, 'message', 'Connect to see earlier visits.')),
      );
    });

    test('nothing is read while the store is frozen', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      p.store.freeze('Demo: handing over');
      final r = repo(p);
      await expectLater(r.openTimeline(patient, typeOf: typeOf), throwsA(isA<ChartingPaused>()));
      expect(() => r.readTimeline(patient, typeOf: typeOf), throwsA(isA<ChartingPaused>()));
    });
  });
}
