import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show HomeCounts, SineobexApi, VisitRead;
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

/// What the phone asks the server for, online only (lifecycle 5.1 to 5.6, 9.7, 9.9; card L4-online):
/// a visit that is not on the phone, co-sign and attest, the queues and Home's counts. Each answer
/// becomes the read model the screens draw, and each refusal the sentence they show. The phone's test
/// server has none of these routes, so each test scripts the API's answer (scripted_api.dart).
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const dana = 'd0000000-0000-4000-8000-00000000000d';
  const patient = 'e0000000-0000-4000-8000-000000000001';
  const visit = 'e0000000-0000-4000-8000-000000000002';
  const n1 = 'f0000000-0000-4000-8000-000000000001';
  const n2 = 'f0000000-0000-4000-8000-000000000002';
  const n3 = 'f0000000-0000-4000-8000-000000000003';
  const n4 = 'f0000000-0000-4000-8000-000000000004';
  const s1 = '10000000-0000-4000-8000-000000000001';
  const s2 = '10000000-0000-4000-8000-000000000002';
  const s3 = '10000000-0000-4000-8000-000000000003';
  final hash1 = List.filled(64, 'a').join();
  final hash3 = List.filled(64, 'c').join();
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;
  final blairRef = userRef(blair, 'Demo Blair');
  final danaRef = userRef(dana, 'Demo Dana');
  final alexRef = userRef(alex, 'Demo Alex');

  late FakeSyncServer server;
  late ScriptedApi api;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    server = FakeSyncServer(now: () => start);
    api = ScriptedApi();
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {
    for (final d in [...testNoteTypes, redFlagsNoteType])
      (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };
  NoteDefinitions defs() => NoteDefinitions(held: (key, version) async => definitions[(key, version)]);
  EncounterUser person(String userId, {String credential = 'attending', Set<String> permissions = staff}) =>
      EncounterUser(userId: userId, displayName: 'Demo Charter', credential: credential, permissions: permissions);

  EncounterApi online(TestPhone p, {String credential = 'attending', Set<String> permissions = staff}) => EncounterApi(
    SineobexApi(api),
    p.store,
    user: person(p.userId, credential: credential, permissions: permissions),
    definitions: defs(),
  );

  List<Map<String, Object?>> audits(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];

  Matcher failsWith(EncounterProblem problem, String message, {List<String>? noteIds}) => throwsA(
    isA<EncounterRequestFailed>()
        .having((e) => e.problem, 'problem', problem)
        .having((e) => e.message, 'message', message)
        .having((e) => e.noteIds, 'noteIds', noteIds ?? isEmpty),
  );

  // A student's Medical note completed, a correction of it, and the visit's own addendum.
  Map<String, Object?> readOf({String? summary = 'Demo: follow up in a week', List<Map<String, Object?>>? notes}) =>
      visitJson(
        encounterId: visit,
        patientId: patient,
        locationText: 'Demo: east underpass',
        summary: summary,
        addenda: [
          {
            'id': s3,
            'noteId': null,
            'author': blairRef,
            'credential': 'student',
            'text': 'Demo: called back with results',
            'writtenAt': '2026-10-19T18:00:00.000Z',
            'clockVerified': false,
          },
        ],
        notes:
            notes ??
            [
              visitNoteJson(
                noteId: n1,
                author: blairRef,
                contentHash: hash1,
                sections: [
                  {
                    'id': 'vitals',
                    'title': 'Vitals',
                    'items': [
                      {
                        'path': 'vitals.pulse',
                        'labels': ['Pulse'],
                        'value': '86',
                        'corrections': [
                          {
                            'path': 'vitals.pulse',
                            'old': '88',
                            'by': 'Demo Blair',
                            'credential': 'student',
                            'at': '2026-10-19T17:00:00.000Z',
                            'reason': 'Demo: counted twice',
                          },
                        ],
                      },
                    ],
                  },
                ],
                signoffs: [signoffJson(id: s1, signer: blairRef)],
                corrections: [
                  {
                    'id': s2,
                    'corrector': blairRef,
                    'credential': 'student',
                    'fields': ['data.vitals.pulse'],
                    'outcome': 'corrected',
                    'reason': 'Demo: counted twice',
                    'requestedByPatient': false,
                    'correctedAt': '2026-10-19T17:00:00.000Z',
                    'clockVerified': true,
                  },
                ],
              ),
            ],
      );

  group('a visit read online (lifecycle 5.1, 8.2, 9.7)', () {
    test('the server’s read is the read model the screen draws, and the phone writes nothing of it', () async {
      final p = phone(alex);
      api.on('GET', '/v1/encounters/$visit', (_) => readOf());
      final v = await online(p).readVisit(visit);
      expect(api.asked.single.path, '/v1/encounters/$visit');
      expect(
        [v.source, v.encounterId, v.patientId, v.kind, v.status, v.startedAt, v.clockVerified, v.locationText],
        [
          VisitSource.server,
          visit,
          patient,
          VisitKind.medical,
          NoteStatus.completed,
          DateTime.utc(2026, 10, 19, 15),
          true,
          'Demo: east underpass',
        ],
      );
      expect(
        [v.summary, v.summaryHidden, v.envelopeLocked, v.notSynced],
        ['Demo: follow up in a week', false, true, false],
      );
      final addendum = v.addenda.single;
      expect(
        [
          addendum.id,
          addendum.noteId,
          addendum.author.name,
          addendum.credential,
          addendum.text,
          addendum.clockVerified,
        ],
        [s3, null, 'Demo Blair', 'student', 'Demo: called back with results', false],
      );
      final note = v.notes.single;
      expect(
        [note.noteId, note.title, note.definition?.key, note.medical, note.shown, note.actsAsAuthor, note.editable],
        [n1, 'Test medical', 'test_medical', true, NoteShown.waitingForCosigner, false, false],
      );
      expect([note.author.name, note.actingAuthor.userId, note.contentHash], ['Demo Blair', blair, hash1]);
      final item = note.read!.sections.single.items.single;
      expect(
        [item.path, item.labels, item.value],
        [
          'vitals.pulse',
          ['Pulse'],
          '86',
        ],
      );
      expect(
        [item.corrections.single.old, item.corrections.single.by, item.corrections.single.reason],
        ['88', 'Demo Blair', 'Demo: counted twice'],
      );
      final signoff = note.signoffs.single;
      expect(
        [signoff.act, signoff.effect, signoff.signer.name, signoff.credential, signoff.sending],
        ['complete', 'completed', 'Demo Blair', 'student', Sending.sent],
      );
      final correction = note.corrections.single;
      expect(
        [correction.fields, correction.outcome, correction.declined, correction.reason],
        [
          ['data.vitals.pulse'],
          'corrected',
          false,
          'Demo: counted twice',
        ],
      );
      // The server logged its read in its own transaction (5.1); nothing waits here.
      expect(p.store.outbox(), isEmpty);
    });

    test('a reader of no Medical notes is not given a Medical visit’s summary or its own addenda', () async {
      final p = phone(alex);
      api.on('GET', '/v1/encounters/$visit', (_) => readOf(summary: null, notes: [])..['addenda'] = <Object?>[]);
      final v = await online(p, credential: 'chw', permissions: {'patients.view'}).readVisit(visit);
      expect([v.summary, v.summaryHidden, v.addenda, v.notes], [null, true, isEmpty, isEmpty]);
    });

    test(
      'a visit opens from the phone, else from the chart’s recent visits, logged here, else from the server',
      () async {
        final p = phone(alex);
        final held = p.store.createEncounter(kind: 'non_medical', patientId: patient);
        p.store.createNote(
          encounterId: held,
          noteTypeKey: testNote.key,
          noteTypeVersion: testNote.version,
          data: {'vitals.pulse': 72},
        );
        final repo = EncounterRepository(
          p.store,
          user: person(alex),
          definitions: defs(),
          noteTypes: () async => definitions.values,
        );
        final e = online(p);
        final fromPhone = await e.openVisit(held, phone: repo);
        expect([fromPhone.source, fromPhone.notes.length, api.asked], [VisitSource.phone, 1, isEmpty]);

        // The chart's last three visits are read offline, and logged here as the server logs them.
        final recent = VisitRead.fromJson(
          readOf(
              notes: [
                visitNoteJson(
                  noteId: n1,
                  author: blairRef,
                  signoffs: [signoffJson(id: s1, signer: blairRef)],
                  attestations: [
                    {
                      'id': n4,
                      'signoffId': s1,
                      'attending': danaRef,
                      'attestedAt': '2026-10-20T09:00:00.000Z',
                      'statementVersion': 'attest-2026-11',
                    },
                  ],
                ),
              ],
            )
            ..['records'] = [
              {
                'entity': 'referral',
                'id': n2,
                'status': 'active',
                'authorUserId': blair,
                'createdAt': '2026-10-19T16:00:00.000Z',
                'updatedAt': '2026-10-19T16:00:00.000Z',
                'version': 1,
                'attributes': {
                  'patientId': patient,
                  'referredOn': '2026-10-19',
                  'details': 'Demo: dental',
                  'encounterId': visit,
                },
                'fields': <String, Object?>{},
              },
            ],
        );
        api.offline = true;
        final before = audits(p).length;
        final fromChart = await e.openVisit(visit, phone: repo, recent: [recent]);
        expect(
          [fromChart.source, fromChart.notes.single.attestations.single.attending.name],
          [VisitSource.chart, 'Demo Dana'],
        );
        expect(fromChart.records.single.id, n2);
        Map<String, Object?> logged(String action, String entity, String id) => {
          'action': action,
          'entity': entity,
          'entityId': id,
          'patientId': patient,
          'source': 'cache',
        };
        expect(audits(p).skip(before), [
          logged('encounter.viewed', 'encounter', visit),
          logged('note.viewed', 'note_addendum', s3),
          logged('note.viewed', 'encounter_note', n1),
          logged('note.viewed', 'note_signoff', s1),
          logged('note.viewed', 'note_attestation', n4),
          logged('patient.viewed', 'referral', n2),
        ]);
        // Read again as it is on screen: nothing new is logged.
        await e.openVisit(visit, phone: repo, recent: [recent], shownBefore: fromChart.shownIds);
        expect(audits(p).skip(before), hasLength(6));

        // Anything else is the server's, and needs a connection.
        const elsewhere = 'e0000000-0000-4000-8000-000000000009';
        await expectLater(
          e.openVisit(elsewhere, phone: repo, recent: [recent]),
          failsWith(EncounterProblem.offline, 'This visit isn’t on this phone. Connect to open it.'),
        );
        api.offline = false;
        api.on('GET', '/v1/encounters/$elsewhere', (_) => readOf()..['encounterId'] = elsewhere);
        expect((await e.openVisit(elsewhere, phone: repo)).source, VisitSource.server);
      },
    );

    test('a recent visit logs each addendum and correction of its notes, and each record made at it on that '
        'record’s own patient, the visit moved or not (review LRA-1, LRA-2)', () async {
      final p = phone(alex);
      final e = online(p);
      const moved = 'e0000000-0000-4000-8000-0000000000bb';
      const problem = 'c0000000-0000-4000-8000-000000000001';
      const problemNote = 'c0000000-0000-4000-8000-000000000002';
      const heldProblem = 'c0000000-0000-4000-8000-000000000003';
      const heldProblemNote = 'c0000000-0000-4000-8000-000000000004';
      const unknownProblemNote = 'c0000000-0000-4000-8000-000000000005';
      const noteAddendum = '10000000-0000-4000-8000-000000000004';
      // A problem of the first patient this phone holds, its note written at the visit.
      p.store.importServerRecord(
        const ServerRecord(
          entity: 'problem',
          id: heldProblem,
          status: 'active',
          authorUserId: blair,
          attributes: {'patientId': patient, 'title': 'Demo: knee pain', 'code': null, 'sensitive': false},
          fields: {},
        ),
        open: false,
      );
      Map<String, Object?> snapshot(String entity, String id, Map<String, Object?> attributes) => {
        'entity': entity,
        'id': id,
        'status': 'active',
        'authorUserId': blair,
        'createdAt': '2026-10-19T16:00:00.000Z',
        'updatedAt': '2026-10-19T16:00:00.000Z',
        'version': 1,
        'attributes': attributes,
        'fields': <String, Object?>{},
      };
      Map<String, Object?> noteOn(String problemId) => {
        'problemId': problemId,
        'text': 'Demo: better',
        'encounterId': visit,
        'writtenAt': '2026-10-19T16:00:00.000Z',
      };
      // The visit was made for the first patient and moved to another since (8.4, D91): what was made
      // at it stays on the first patient's chart, and a problem's note names no patient of its own.
      final read = readOf()..['patientId'] = moved;
      final note = (read['notes']! as List<Object?>).single! as Map<String, Object?>;
      note['addenda'] = [
        {
          'id': noteAddendum,
          'noteId': n1,
          'author': blairRef,
          'credential': 'student',
          'text': 'Demo: dressing changed',
          'writtenAt': '2026-10-19T17:30:00.000Z',
          'clockVerified': true,
        },
      ];
      read['records'] = [
        snapshot('problem', problem, {'patientId': patient, 'title': 'Demo: cough', 'code': null, 'sensitive': false}),
        snapshot('problem_note', problemNote, noteOn(problem)),
        snapshot('problem_note', heldProblemNote, noteOn(heldProblem)),
        snapshot('problem_note', unknownProblemNote, noteOn('c0000000-0000-4000-8000-000000000009')),
      ];
      api.offline = true;
      await e.recentVisit(VisitRead.fromJson(read));
      final logged = {
        for (final a in audits(p)) a['entityId']: (a['action'], a['entity'], a['patientId'], a['source']),
      };
      expect(logged[noteAddendum], ('note.viewed', 'note_addendum', moved, 'cache'));
      expect(logged[s2], ('note.viewed', 'note_correction', moved, 'cache'));
      expect(logged[problem], ('patient.viewed', 'problem', patient, 'cache'));
      expect(logged[problemNote], ('patient.viewed', 'problem_note', patient, 'cache'));
      expect(logged[heldProblemNote], ('patient.viewed', 'problem_note', patient, 'cache'));
      // Its problem neither listed nor held here: logged with no patient rather than the wrong one.
      expect(logged[unknownProblemNote], ('patient.viewed', 'problem_note', null, 'cache'));
    });

    test('each note’s recap lines, as the server worked them out for the reader, online and from the chart '
        '(D108)', () async {
      final p = phone(alex);
      final e = online(p);
      Map<String, Object?> read() => readOf(
        notes: [
          visitNoteJson(
            noteId: n1,
            author: blairRef,
            recap: [
              {'section': 'vitals', 'text': 'Pulse: 86'},
              {'section': 'care', 'text': 'Plan: Demo: rest'},
            ],
          ),
        ],
      );
      api.on('GET', '/v1/encounters/$visit', (_) => read());
      List<(String, String)> recapOf(VisitView v) => [for (final l in v.notes.single.recap) (l.section, l.text)];
      const lines = [('vitals', 'Pulse: 86'), ('care', 'Plan: Demo: rest')];
      expect(recapOf(await e.readVisit(visit)), lines);
      expect(recapOf(await e.recentVisit(VisitRead.fromJson(read()))), lines);
    });

    test('what the server refuses becomes what the screen shows', () async {
      final p = phone(alex);
      final e = online(p);
      final path = '/v1/encounters/$visit';
      api.refuse('GET', path, 404, 'not_found');
      await expectLater(e.readVisit(visit), failsWith(EncounterProblem.notFound, 'This visit can’t be found.'));
      api.refuse('GET', path, 403, 'forbidden');
      await expectLater(e.readVisit(visit), failsWith(EncounterProblem.notAllowed, 'Your role can’t open this.'));
      api.refuse('GET', path, 401, 'unauthorized');
      await expectLater(e.readVisit(visit), failsWith(EncounterProblem.signInAgain, 'Sign in again to go on.'));
      api.refuse('GET', path, 422, 'invalid');
      await expectLater(
        e.readVisit(visit),
        failsWith(EncounterProblem.invalid, 'Something about this request was wrong. Load it again.'),
      );
      api.refuse('GET', path, 500, 'internal');
      await expectLater(e.readVisit(visit), failsWith(EncounterProblem.failed, 'Something went wrong. Try again.'));
    });

    test('nothing is asked or shown while the store is frozen', () async {
      final p = phone(alex);
      api.on('GET', '/v1/encounters/$visit', (_) => readOf());
      p.store.freeze('Demo: handing over');
      final e = online(p);
      await expectLater(e.readVisit(visit), throwsA(isA<ChartingPaused>()));
      await expectLater(e.recentVisit(VisitRead.fromJson(readOf())), throwsA(isA<ChartingPaused>()));
      await expectLater(e.cosignQueue(), throwsA(isA<ChartingPaused>()));
      expect(api.asked, isEmpty);
      expect(p.store.outbox(), isEmpty);
    });
  });

  group('co-sign and attest (lifecycle 3.7, 5.3, 5.4, 9.7, 9.9)', () {
    // n1: a student's note waiting, read whole. n2: one with a part the reader can't open (no hash).
    // n3: the reader's own, waiting. n4: a Non-Medical note completed, which waits for no one.
    Map<String, Object?> waiting() => readOf(
      notes: [
        visitNoteJson(
          noteId: n1,
          author: blairRef,
          contentHash: hash1,
          signoffs: [signoffJson(id: s1, signer: blairRef)],
        ),
        visitNoteJson(
          noteId: n2,
          author: blairRef,
          signoffs: [signoffJson(id: s2, signer: blairRef)],
        ),
        visitNoteJson(
          noteId: n3,
          author: alexRef,
          contentHash: hash3,
          signoffs: [signoffJson(id: s3, signer: alexRef)],
        ),
        visitNoteJson(noteId: n4, author: blairRef, key: 'test_note', title: 'Test note', contentHash: hash1),
      ],
    );

    test('Co-sign names every waiting note the person may act on, with the hash they read', () async {
      final p = phone(dana);
      api.on('GET', '/v1/encounters/$visit', (_) => waiting());
      final e = online(p, credential: 'resident');
      final plan = e.cosignPlan(await e.readVisit(visit))!;
      expect(
        [plan.act, plan.noteIds, plan.cannotSeeAll, plan.canAct],
        [
          SecondAct.cosign,
          [n1, n3],
          [n2],
          true,
        ],
      );
      expect([plan.statementVersion, plan.sentence], ['cosign-2026-11', 'I reviewed this note and agree with it.']);
      expect(plan.cannotSeeAllMessage, 'This note has a part you can’t open. Ask a Program Admin.');

      api.on(
        'POST',
        '/v1/encounters/$visit/cosign',
        (_) => {
          'notes': [
            {'noteId': n1, 'status': 'signed', 'attestation': 'waiting'},
            {'noteId': n3, 'status': 'signed', 'attestation': 'waiting'},
          ],
        },
      );
      final done = await e.secondAct(plan);
      expect(api.asked.last.body, {
        'notes': [
          {'noteId': n1, 'contentHash': hash1},
          {'noteId': n3, 'contentHash': hash3},
        ],
        'statementVersion': 'cosign-2026-11',
      });
      expect(done[n1], (status: NoteStatus.signed, attestation: Attestation.waiting));
    });

    test('nobody co-signs a note they wrote or completed, and a credential that can’t sign is offered none', () async {
      final p = phone(alex);
      api.on('GET', '/v1/encounters/$visit', (_) => waiting());
      final v = await online(p).readVisit(visit);
      expect(online(p).cosignPlan(v)!.noteIds, [n1]);
      expect(online(p, credential: 'student').cosignPlan(v), isNull);
      expect(online(p, permissions: {'patients.view', 'patients.view_sensitive'}).cosignPlan(v), isNull);

      // Completed by the reader as its assignee, then given to someone else: still theirs (5.3).
      final assigned = visitNoteJson(
        noteId: n1,
        author: blairRef,
        actingAuthor: danaRef,
        contentHash: hash1,
        signoffs: [signoffJson(id: s1, signer: alexRef)],
      );
      api.on('GET', '/v1/encounters/$visit', (_) => readOf(notes: [assigned]));
      expect(online(p).cosignPlan(await online(p).readVisit(visit)), isNull);

      // Written by the reader, then given to someone who completed it: still the reader's note.
      final written = visitNoteJson(
        noteId: n1,
        author: alexRef,
        actingAuthor: danaRef,
        contentHash: hash1,
        signoffs: [signoffJson(id: s1, signer: danaRef)],
      );
      api.on('GET', '/v1/encounters/$visit', (_) => readOf(notes: [written]));
      expect(online(p).cosignPlan(await online(p).readVisit(visit)), isNull);

      // Given to the reader after its writer left: theirs now (3.8).
      final given = visitNoteJson(
        noteId: n1,
        author: blairRef,
        actingAuthor: alexRef,
        contentHash: hash1,
        signoffs: [signoffJson(id: s1, signer: blairRef)],
      );
      api.on('GET', '/v1/encounters/$visit', (_) => readOf(notes: [given]));
      expect(online(p).cosignPlan(await online(p).readVisit(visit)), isNull);
    });

    test('Attest: never one’s own signature; only a credential that attests', () async {
      final p = phone(alex);
      Map<String, Object?> signedBy(String id, Map<String, Object?> signer, {String? hash}) => visitNoteJson(
        noteId: id,
        author: blairRef,
        status: 'signed',
        attestation: 'waiting',
        contentHash: hash,
        signoffs: [
          signoffJson(id: s1, signer: blairRef),
          signoffJson(
            id: s2,
            signer: signer,
            act: 'cosign',
            effect: 'signed',
            credential: 'resident',
            signedAt: '2026-10-19T19:00:00.000Z',
            needsAttestation: true,
          ),
        ],
      );
      api.on(
        'GET',
        '/v1/encounters/$visit',
        (_) => readOf(
          notes: [
            signedBy(n1, danaRef, hash: hash1),
            signedBy(n2, alexRef, hash: hash3),
          ],
        ),
      );
      final e = online(p);
      final plan = e.attestPlan(await e.readVisit(visit))!;
      expect(
        [plan.act, plan.noteIds, plan.statementVersion, plan.sentence],
        [
          SecondAct.attest,
          [n1],
          'attest-2026-11',
          'I reviewed this note and agree with the assessment and plan.',
        ],
      );
      expect(online(p, credential: 'resident').attestPlan(await e.readVisit(visit)), isNull);

      api.on(
        'POST',
        '/v1/encounters/$visit/attest',
        (_) => {
          'notes': [
            {'noteId': n1, 'status': 'signed', 'attestation': 'attested'},
          ],
        },
      );
      expect((await e.secondAct(plan))[n1], (status: NoteStatus.signed, attestation: Attestation.attested));
      expect(api.asked.last.path, '/v1/encounters/$visit/attest');
    });

    test('a visit changed since it was read, a part one can’t open, and no signal are each said so', () async {
      final p = phone(dana);
      api.on('GET', '/v1/encounters/$visit', (_) => waiting());
      final e = online(p, credential: 'resident');
      final plan = e.cosignPlan(await e.readVisit(visit))!;
      final path = '/v1/encounters/$visit/cosign';
      api.refuse(
        'POST',
        path,
        409,
        'content_changed',
        details: {
          'noteIds': [n3],
        },
      );
      await expectLater(
        e.secondAct(plan),
        failsWith(EncounterProblem.changed, 'This visit changed. Read it again.', noteIds: [n3]),
      );
      api.refuse(
        'POST',
        path,
        409,
        'not_waiting',
        details: {
          'noteIds': [n1],
        },
      );
      await expectLater(
        e.secondAct(plan),
        failsWith(EncounterProblem.changed, 'This visit changed. Read it again.', noteIds: [n1]),
      );
      api.refuse(
        'POST',
        path,
        403,
        'cannot_see_all',
        details: {
          'noteIds': [n1],
        },
      );
      await expectLater(
        e.secondAct(plan),
        failsWith(
          EncounterProblem.notAllowed,
          'This note has a part you can’t open. Ask a Program Admin.',
          noteIds: [n1],
        ),
      );
      api.refuse('POST', path, 403, 'cannot_sign');
      await expectLater(e.secondAct(plan), failsWith(EncounterProblem.notAllowed, 'Your credential can’t sign notes.'));
      api.offline = true;
      await expectLater(e.secondAct(plan), failsWith(EncounterProblem.offline, 'Connect to co-sign.'));
    });

    test('a visit read from the phone or the chart is read again online before anyone signs it', () async {
      final p = phone(dana);
      final e = online(p, credential: 'resident');
      final fromChart = await e.recentVisit(VisitRead.fromJson(waiting()));
      final plan = e.cosignPlan(fromChart)!;
      expect(
        [plan.noteIds, plan.canAct, plan.readOnline],
        [
          [n1, n2, n3],
          false,
          true,
        ],
      );
      await expectLater(e.secondAct(plan), throwsStateError);
    });
  });

  group('the queues and Home’s counts (lifecycle 5.4, 5.6, 9.9)', () {
    test('a queue lists one row per visit, with who wrote and signed each waiting note', () async {
      final p = phone(alex);
      api.on(
        'GET',
        '/v1/team/attestation-queue',
        (_) => {
          'rows': [
            {
              'encounterId': visit,
              'patientId': patient,
              'preferredName': 'Demo Patient',
              'startedAt': '2026-10-19T15:00:00.000Z',
              'notes': [
                {
                  'noteId': n1,
                  'noteTypeKey': 'test_medical',
                  'author': blairRef,
                  'completedAt': '2026-10-19T16:00:00.000Z',
                  'signedBefore': danaRef,
                  'attestedBefore': null,
                  'canAct': false,
                },
              ],
            },
          ],
        },
      );
      final rows = await online(p).attestationQueue();
      final row = rows.single;
      expect(
        [row.encounterId, row.patientId, row.preferredName, row.startedAt, row.canActOnAny],
        [visit, patient, 'Demo Patient', DateTime.utc(2026, 10, 19, 15), false],
      );
      final note = row.notes.single;
      expect(
        [note.noteId, note.noteTypeKey, note.author.name, note.signedBefore?.name, note.attestedBefore, note.canAct],
        [n1, 'test_medical', 'Demo Blair', 'Demo Dana', null, false],
      );

      api.offline = true;
      await expectLater(
        online(p).cosignQueue(),
        failsWith(EncounterProblem.offline, 'Connect to see notes waiting for you.'),
      );
    });

    test('Home’s tiles: shown by credential, the counts online, “connect” offline, no patient named', () async {
      final p = phone(alex);
      api.on(
        'GET',
        '/v1/me/counts',
        (_) => {'notesToFinish': 2, 'notesOverdue': 1, 'cosignWaiting': 3, 'attestationWaiting': 4},
      );
      HomeCounts? given;
      ({int notes, int overdue}) mine(HomeCounts? server) {
        given = server;
        return (notes: (server?.notesToFinish ?? 0) + 1, overdue: server?.notesOverdue ?? 0);
      }

      final tiles = await online(p).homeTiles(notesToFinish: mine);
      expect(given?.cosignWaiting, 3);
      expect(
        [
          tiles.online,
          tiles.notesToFinish,
          tiles.showsCosign,
          tiles.cosignWaiting,
          tiles.showsAttestation,
          tiles.attestationWaiting,
        ],
        [true, (notes: 3, overdue: 1), true, 3, true, 4],
      );
      // A resident signs and does not attest.
      final resident = await online(p, credential: 'resident').homeTiles(notesToFinish: mine);
      expect([resident.showsCosign, resident.showsAttestation], [true, false]);
      // A student and a role that doesn't chart see neither queue.
      final student = await online(p, credential: 'student').homeTiles(notesToFinish: mine);
      expect([student.showsCosign, student.showsAttestation], [false, false]);

      api.offline = true;
      final offline = await online(p).homeTiles(notesToFinish: mine);
      expect(
        [offline.online, given, offline.notesToFinish, offline.cosignWaiting, offline.showsCosign],
        [false, null, (notes: 1, overdue: 0), null, true],
      );
      expect(p.store.outbox(), isEmpty);
    });
  });
}
