import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/visible.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entityAudit, entityCorrection;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// A visit read from the phone's store (lifecycle 9.7, 10.1; card L4-models-read): as the person may
/// see it (6.4), each record shown logged in the read's own transaction, nothing read while the
/// store is frozen, offline as online. The phone's test server stands in for the API (4.9).
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;

  late DateTime serverTime;
  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime)
      ..noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
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
  NoteTypeDef definition(TestNoteType t) => definitions[(t.key, t.version)]!;
  NoteTypeDef? definitionOf(String key, int version) => definitions[(key, version)];

  NoteDefinitions lookup({Set<TestNoteType> lacking = const {}}) => NoteDefinitions(
    held: (key, version) async => lacking.contains((key: key, version: version)) ? null : definitions[(key, version)],
  );

  EncounterRepository repo(
    TestPhone p, {
    String credential = 'attending',
    Set<String> permissions = staff,
    NoteDefinitions? defs,
  }) => EncounterRepository(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: credential,
      permissions: permissions,
    ),
    definitions: defs ?? lookup(),
    noteTypes: () async => definitions.values,
  );

  List<Map<String, Object?>> audits(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];

  Map<String, Object?> viewed(String action, String entity, String id, String? patient, {String source = 'local'}) => {
    'action': action,
    'entity': entity,
    'entityId': id,
    'patientId': ?patient,
    'source': source,
  };

  String note(TestPhone p, String visit, TestNoteType type, [Map<String, Object?> data = const {}]) =>
      p.store.createNote(encounterId: visit, noteTypeKey: type.key, noteTypeVersion: type.version, data: data);

  NoteToFinish finishing(TestPhone p, String noteId, TestNoteType type, {SignoffAct act = SignoffAct.complete}) =>
      NoteToFinish(
        noteId: noteId,
        shownHash: p.store.contentHashOf(noteId, definition(type)),
        act: act,
        statementVersion: '${act.name}-2026-11',
      );

  const attending = Signer(credential: 'attending', canSign: true, needsAttestation: false);
  const resident = Signer(credential: 'resident', canSign: true, needsAttestation: true);
  const student = Signer(credential: 'student', canSign: false, needsAttestation: true);

  Map<String, LocalEffect> complete(TestPhone p, List<NoteToFinish> notes, {Signer signer = attending}) =>
      p.store.finishNotes(notes, signer: signer, definitionOf: definitionOf);

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  NoteView noteIn(VisitView v, String noteId) => v.notes.singleWhere((n) => n.noteId == noteId);

  group('what a read logs (lifecycle 9.7, 10.1)', () {
    test(
      'each record shown, in the read’s own transaction, naming the visit’s patient; the server takes each',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(
          kind: 'medical',
          patientId: patient,
          locationText: 'Demo: east underpass',
        );
        final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
        final n = note(p, visit, testMedical, {'vitals.pulse': 96, 'care.plan': 'Demo: rest and fluids'});
        // An empty draft does not count (3.1): not listed, not logged.
        note(p, visit, testNote);
        final effects = complete(p, [
          finishing(p, flags, testRedFlags, act: SignoffAct.sign),
          finishing(p, n, testMedical, act: SignoffAct.sign),
        ]);
        final below = p.store.createRecord(entityAddendum, {
          'encounterId': visit,
          'noteId': n,
          'text': 'Demo: seen again at noon',
          'signoffId': effects[n]!.signoffId,
        });
        final own = p.store.createRecord(entityAddendum, {
          'encounterId': visit,
          'noteId': null,
          'text': 'Demo: walked over from the shelter',
          'signoffId': null,
        });
        expect(audits(p), isEmpty);

        final view = (await repo(p).openVisit(visit))!;
        expect(view.notes.map((x) => x.noteId), unorderedEquals([flags, n]));
        final expected = [
          viewed('encounter.viewed', 'encounter', visit, patient),
          viewed('note.viewed', 'note_addendum', own, patient),
          for (final id in [flags, n]) viewed('note.viewed', 'encounter_note', id, patient),
          for (final id in [flags, n]) viewed('note.viewed', 'note_signoff', effects[id]!.signoffId, patient),
          viewed('note.viewed', 'note_addendum', below, patient),
        ];
        expect(audits(p).first, expected.first, reason: 'the visit is logged first');
        expect(audits(p), unorderedEquals(expected));
        expect(view.shownIds, {for (final e in expected) e['entityId']});

        expect(
          [view.source, view.patientId, view.kind, view.locationText, view.notSynced, view.summaryHidden],
          [VisitSource.phone, patient, VisitKind.medical, 'Demo: east underpass', true, false],
        );
        expect(view.startedAt, isNotNull, reason: 'by this phone’s clock while its create waits');
        expect([for (final a in view.addenda) a.text], ['Demo: walked over from the shelter']);
        final medical = noteIn(view, n);
        expect(
          [for (final s in medical.signoffs) (s.id, s.act, s.sending)],
          [(effects[n]!.signoffId, 'sign', Sending.waiting)],
        );
        expect([for (final a in medical.addenda) a.text], ['Demo: seen again at noon']);

        // Each entry is one the server takes: the closed list of offline reads (4.8).
        expect(await sync(p), isA<SyncDone>());
        expect(p.store.outbox(), isEmpty);
        expect([
          for (final a in server.audit)
            {
              for (final key in ['action', 'entity', 'entityId', 'patientId', 'source']) key: ?a[key],
            },
        ], unorderedEquals(expected));
      },
    );

    test('a read shown again logs only what it adds', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final r = repo(p);
      final first = (await r.openVisit(visit))!;
      expect(audits(p), [
        viewed('encounter.viewed', 'encounter', visit, null),
        viewed('note.viewed', 'encounter_note', n, null),
      ]);
      final again = (await r.openVisit(visit, shownBefore: first.shownIds))!;
      expect(audits(p), hasLength(2));
      final m = note(p, visit, testNote, {'care.plan': 'Demo: rest and fluids'});
      final third = (await r.openVisit(visit, shownBefore: again.shownIds))!;
      expect(audits(p).skip(2), [viewed('note.viewed', 'encounter_note', m, null)]);
      expect(third.notes, hasLength(2));
    });

    test('nothing is read, and nothing logged, while the store is frozen', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final r = repo(p);
      p.store.freeze('Demo: handing over');
      await expectLater(r.openVisit(visit), throwsA(isA<ChartingPaused>()));
      expect(() => r.readVisit(visit), throwsA(isA<ChartingPaused>()));
      await expectLater(r.openNote(n), throwsA(isA<ChartingPaused>()));
      expect(() => r.readNote(n), throwsA(isA<ChartingPaused>()));
      expect(audits(p), isEmpty);
      p.store.unfreeze();
      expect(await r.openVisit(visit), isNotNull);
      expect(audits(p), hasLength(2));
    });

    test('a read goes on offline and while charting waits for the clock: logged, never paused', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      final view = await repo(p).openVisit(visit);
      expect(view?.notes, hasLength(1));
      expect(audits(p), hasLength(2));
    });

    test('a visit or a note the phone doesn’t hold reads as nothing, and logs nothing', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final r = repo(p);
      expect(await r.openVisit('0d000000-0000-4000-8000-000000000000'), isNull);
      expect(await r.openNote('0d000000-0000-4000-8000-000000000000'), isNull);
      // Neither is a note a visit, nor a visit a note.
      expect(await r.openVisit(n), isNull);
      expect(await r.openNote(visit), isNull);
      expect(audits(p), isEmpty);
    });

    test('a note opened on its own logs the note and what hangs off it, not the visit', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final effects = complete(p, [finishing(p, n, testNote)]);
      final shown = (await repo(p).openNote(n))!;
      expect([shown.noteId, shown.shown, shown.waitingToSend], [n, NoteShown.complete, true]);
      expect(audits(p), [
        viewed('note.viewed', 'encounter_note', n, patient),
        viewed('note.viewed', 'note_signoff', effects[n]!.signoffId, patient),
      ]);
    });
  });

  group('who and when, as the sync read gives them (D108)', () {
    test('a visit’s notes in the order the server made them, to the microsecond, then by ID; those made '
        'here after them, in the order made', () async {
      final patient = server.seedPatient();
      final visit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: blair);
      String seeded(String id, Duration after) {
        serverTime = start.add(after);
        return server.seed(
          'encounter_note',
          {
            'encounterId': visit,
            'noteTypeKey': testNote.key,
            'noteTypeVersion': testNote.version,
            'data': const {'vitals.pulse': 80},
          },
          id: id,
          by: blair,
        );
      }

      // Made in the opposite order to their IDs; the last two in the same microsecond. A millisecond
      // apart only in their microseconds would sort wrong through milliseconds.
      final second = seeded('f0000000-0000-4000-8000-000000000002', const Duration(microseconds: 1001));
      final first = seeded('f0000000-0000-4000-8000-000000000001', const Duration(microseconds: 1002));
      final tiedB = seeded('f0000000-0000-4000-8000-000000000004', const Duration(seconds: 1));
      final tiedA = seeded('f0000000-0000-4000-8000-000000000003', const Duration(seconds: 1));
      serverTime = start;
      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      for (final n in [tiedA, first, tiedB, second]) {
        expect(await p.engine.openServerRecord('encounter_note', n), isTrue);
      }
      expect(p.store.record(second)!.attributes['createdAt'], endsWith('.001001Z'));
      final mine = note(p, visit, testNote, {'vitals.pulse': 70});
      final later = note(p, visit, testNote, {'vitals.pulse': 72});
      final view = (await repo(p).openVisit(visit))!;
      expect([for (final n in view.notes) n.noteId], [second, first, tiedA, tiedB, mine, later]);
    });

    test('a teammate is named by the name their record carries; the reader’s own records by their own name', () async {
      server.names[blair] = 'Demo Blair Rivera';
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final theirs = (await rb.addNote(visit, definition(testNote), another: true)).noteId;
      await rb.openNote(theirs);
      rb.saveAnswer(theirs, 'vitals.pulse', 88);
      rb.complete((await rb.openComplete(visit))!);
      await sync(b);
      await rb.correct(visit, theirs, changes: {'vitals.pulse': 86}, reason: 'Demo: counted twice');
      await sync(b);

      // Alex's phone has no way to name Blair but what the server sent with each record.
      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      for (final rec in [...server.records.values]) {
        if (rec.attributes['noteId'] == theirs) expect(await p.engine.openServerRecord(rec.entity, rec.id), isTrue);
      }
      final r = repo(p);
      final mine = (await r.addNote(visit, definition(testNote), another: true)).noteId;
      await r.openNote(mine);
      r.saveAnswer(mine, 'care.plan', 'Demo: blankets');
      r.complete((await r.openComplete(visit))!);
      await r.addAddendum(visit, noteId: theirs, text: 'Demo: seen again');
      final view = (await r.openVisit(visit))!;
      final blairs = noteIn(view, theirs);
      expect(
        [
          blairs.author.name,
          blairs.actingAuthor.name,
          blairs.signoffs.single.signer.name,
          blairs.corrections.single.corrector.name,
          blairs.addenda.single.author.name,
        ],
        ['Demo Blair Rivera', 'Demo Blair Rivera', 'Demo Blair Rivera', 'Demo Blair Rivera', 'Demo Charter'],
      );
      final shownCorrection = blairs.read!.sections.expand((s) => s.items).single.corrections.single;
      expect(shownCorrection.by, 'Demo Blair Rivera');
      final own = noteIn(view, mine);
      expect(
        [own.author.name, own.actingAuthor.name, own.signoffs.single.signer.name],
        ['Demo Charter', 'Demo Charter', 'Demo Charter'],
      );
    });
  });

  group('what the reader sees (lifecycle 6.4)', () {
    const e1 = 'e0000001';
    const at = '2026-10-20T14:50:00Z';
    const restricted = <String, Object?>{
      'general.notes': 'Demo: walked over from the shelter',
      'exam.findings': 'Demo: no lesions seen',
      'moud.dose': 'Demo: 8 mg',
      'dx.$e1.entryAt': at,
      'dx.$e1.diagnosis.code': 'F11.20',
      'dx.$e1.diagnosis.label': 'Demo: opioid use',
      'dx.$e1.note': 'Demo: talk again next week',
    };

    /// Alex's visit with a restricted note on the server, and Blair's phone holding both as the
    /// server sent them to Blair.
    Future<({String patient, String visit, String n, TestPhone b})> teammatesNote() async {
      final patient = server.seedPatient();
      final visit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: alex);
      final n = server.seed('encounter_note', {
        'encounterId': visit,
        'noteTypeKey': testRestricted.key,
        'noteTypeVersion': testRestricted.version,
        'data': restricted,
      }, by: alex);
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      return (patient: patient, visit: visit, n: n, b: b);
    }

    test('a teammate’s note shows what the server would show them, and no more once their role is lowered', () async {
      final (:patient, :visit, :n, :b) = await teammatesNote();
      final shown = noteIn((await repo(b).openVisit(visit))!, n);
      final reader = EncounterUser(
        userId: blair,
        displayName: 'Demo Charter',
        credential: 'attending',
        permissions: staff,
      );
      expect(shown.actsAsAuthor, isFalse);
      expect(shown.answers, visibleAnswers(definition(testRestricted), restricted, reader.reader(actsAsAuthor: false)));
      expect(shown.answers.keys, isNot(contains('exam.findings')));
      expect(shown.answers.keys, containsAll(['moud.dose', 'dx.$e1.diagnosis.code']));
      expect(shown.recap.map((l) => l.text).join(' '), isNot(contains('lesions')));
      expect(shown.read, isNotNull);

      // Their role no longer reads sensitive notes: the diagnosis and the treatment go too, though
      // the phone still holds them as the server sent them.
      final lowered = noteIn(
        (await repo(b, permissions: staff.difference({'patients.view_sensitive'})).openVisit(visit))!,
        n,
      );
      expect(lowered.answers.keys, ['general.notes']);
      expect(b.store.record(n)!.fields.keys, contains('data.dx.$e1.diagnosis.code'));

      // Whoever acts as the author sees all of it (rule 1).
      final a = phone(alex);
      expect(await a.engine.openServerRecord('encounter', visit), isTrue);
      expect(await a.engine.openServerRecord('encounter_note', n), isTrue);
      final own = noteIn(
        (await repo(a, credential: 'none', permissions: const {'patients.view'}).openVisit(visit))!,
        n,
      );
      expect([own.actsAsAuthor, own.answers], [true, restricted]);
      expect(audits(a).map((e) => e['patientId']).toSet(), {patient});
    });

    test('a Medical note is left out for a reader of no Medical notes, with all that hangs off it; so are a Medical visit’s assessment and its own addenda', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final visit = a.store.createEncounter(kind: 'medical', patientId: patient);
      a.store.setField(visit, 'summary', 'Demo: stable, follow up next week');
      final medical = note(a, visit, testMedical, {'vitals.pulse': 96});
      final social = note(a, visit, testNote, {'care.plan': 'Demo: shelter bed tonight'});
      final own = a.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': null,
        'text': 'Demo: came back later',
        'signoffId': null,
      });
      final below = a.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': medical,
        'text': 'Demo: pulse taken again',
        'signoffId': null,
      });
      expect(await sync(a), isA<SyncDone>());
      expect(a.store.outbox(), isEmpty);

      final b = phone(blair);
      for (final (entity, id) in [
        ('encounter', visit),
        ('encounter_note', medical),
        ('encounter_note', social),
        ('note_addendum', own),
        ('note_addendum', below),
      ]) {
        expect(await b.engine.openServerRecord(entity, id), isTrue, reason: entity);
      }
      final full = (await repo(b).openVisit(visit))!;
      expect(full.notes.map((x) => x.noteId), unorderedEquals([medical, social]));
      expect([full.summary, full.summaryHidden, full.addenda.length], ['Demo: stable, follow up next week', false, 1]);

      // A role that registers and refers, and reads no clinical notes (the CHW preset's keys).
      final before = audits(b).length;
      final view = (await repo(b, credential: 'chw', permissions: FakeSyncServer.chw).openVisit(visit))!;
      expect(view.notes.map((x) => x.noteId), [social]);
      expect([view.summary, view.summaryHidden, view.addenda], [null, true, isEmpty]);
      expect(view.status, NoteStatus.draft);
      expect(audits(b).skip(before), [
        viewed('encounter.viewed', 'encounter', visit, patient, source: 'cache'),
        viewed('note.viewed', 'encounter_note', social, patient, source: 'cache'),
      ]);
    });

    test('a note whose definition the phone lacks is listed for whoever acts as its author, with nothing of its answers, and left out for everyone else', () async {
      final (patient: _, :visit, :n, :b) = await teammatesNote();
      final lacking = lookup(lacking: {testRestricted});
      final before = audits(b).length;
      final view = (await repo(b, defs: lacking).openVisit(visit))!;
      expect(view.notes, isEmpty);
      expect(audits(b).skip(before).map((e) => e['action']), ['encounter.viewed']);

      final a = phone(alex);
      expect(await a.engine.openServerRecord('encounter', visit), isTrue);
      expect(await a.engine.openServerRecord('encounter_note', n), isTrue);
      final own = noteIn((await repo(a, defs: lacking).openVisit(visit))!, n);
      expect(
        [own.unreadable, own.definition, own.answers, own.read, own.recap, own.editable],
        [true, null, isEmpty, null, isEmpty, false],
      );
      expect(
        [own.noteTypeKey, own.noteTypeVersion, own.shown],
        [testRestricted.key, testRestricted.version, NoteShown.draft],
      );
    });

    test('a correction the phone holds is shown only while nothing it names is hidden from the reader', () async {
      final patient = server.seedPatient();
      final visit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: alex);
      final n = server.seed('encounter_note', {
        'encounterId': visit,
        'noteTypeKey': testRestricted.key,
        'noteTypeVersion': testRestricted.version,
        'data': restricted,
      }, by: alex);
      server.finishNote(n);
      final a = phone(alex);
      expect(await a.engine.openServerRecord('encounter', visit), isTrue);
      expect(await a.engine.openServerRecord('encounter_note', n), isTrue);
      String correct(String path, Object? value) => a.store.createRecord(entityCorrection, {
        'noteId': n,
        'changes': [
          {
            'field': 'data.$path',
            'newValue': value,
            'baseVersion': a.store.record(n)!.fields['data.$path']!.serverVersion,
          },
        ],
        'reason': 'Demo: wrote it down wrong',
        'requestedByPatient': false,
        'declined': false,
        'claimedCredential': null,
        'signoffId': null,
      });
      final exam = correct('exam.findings', 'Demo: a small rash');
      final general = correct('general.notes', 'Demo: walked over from the park');
      // Before its receipt a correction waits; the note still reads as it was.
      final waiting = noteIn((await repo(a).openVisit(visit))!, n);
      expect(
        [for (final c in waiting.corrections) (c.id, c.sending, c.outcome)],
        [(exam, Sending.waiting, null), (general, Sending.waiting, null)],
      );
      expect(await sync(a), isA<SyncDone>());

      // Blair downloads the note and both corrections while their role reads sensitive exams.
      server.permissions[blair] = {...staff, 'patients.view_sensitive_exams'};
      final b = phone(blair);
      for (final (entity, id) in [
        ('encounter', visit),
        ('encounter_note', n),
        ('note_correction', exam),
        ('note_correction', general),
      ]) {
        expect(await b.engine.openServerRecord(entity, id), isTrue, reason: id);
      }
      final both = noteIn(
        (await repo(b, permissions: {...staff, 'patients.view_sensitive_exams'}).openVisit(visit))!,
        n,
      );
      expect(both.corrections.map((c) => c.id), unorderedEquals([exam, general]));
      expect(both.corrections.map((c) => c.outcome).toSet(), {'corrected'});

      // Their role no longer reads them: the correction of the exam goes, whole; the other stays,
      // and the read model shows its old value struck through under the new.
      final before = audits(b).length;
      final now = noteIn((await repo(b).openVisit(visit))!, n);
      expect(now.corrections.map((c) => c.id), [general]);
      expect(now.answers.keys, isNot(contains('exam.findings')));
      final item = now.read!.sections.expand((s) => s.items).singleWhere((i) => i.path == 'general.notes');
      expect(
        [item.value, item.corrections.single.old],
        ['Demo: walked over from the park', 'Demo: walked over from the shelter'],
      );
      expect(audits(b).skip(before).where((e) => e['entity'] == 'note_correction').map((e) => e['entityId']), [
        general,
      ]);
    });
  });

  group('the state as this phone knows it (lifecycle 3.1, 4.8)', () {
    test('a note finished here says Waiting to send until its receipt, then shows what the server made it', () async {
      Future<void> check(Signer signer, String credential, NoteShown shown, NoteStatus visitStatus) async {
        final p = phone(alex);
        server.credentials[alex] = credential;
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
        final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
        final n = note(p, visit, testMedical, {'vitals.pulse': 96});
        final act = signer.canSign ? SignoffAct.sign : SignoffAct.complete;
        complete(p, [
          finishing(p, flags, testRedFlags, act: act),
          finishing(p, n, testMedical, act: act),
        ], signer: signer);
        final r = repo(p, credential: credential);
        var view = (await r.openVisit(visit))!;
        expect([noteIn(view, n).shown, noteIn(view, n).waitingToSend, noteIn(view, n).editable], [shown, true, false]);
        expect(view.status, visitStatus);
        expect(view.envelopeLocked, isTrue);
        expect(await sync(p), isA<SyncDone>());
        view = (await r.openVisit(visit, shownBefore: view.shownIds))!;
        expect(
          [noteIn(view, n).shown, noteIn(view, n).waitingToSend, noteIn(view, n).sentForReview],
          [shown, false, false],
        );
        expect(noteIn(view, n).signoffs.single.sending, Sending.sent);
      }

      await check(student, 'student', NoteShown.waitingForCosigner, NoteStatus.completed);
      await check(resident, 'resident', NoteShown.waitingForAttestation, NoteStatus.signed);
      await check(attending, 'attending', NoteShown.signed, NoteStatus.signed);
    });

    test('a sign-off held for review says Sent for review, not Waiting to send', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      await sync(p);
      // The credential was lowered on the server; the phone's profile didn't know (4.2).
      server.changeCredential(alex, 'chw');
      complete(p, [finishing(p, flags, testRedFlags)]);
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);
      final shown = noteIn((await repo(p).openVisit(visit))!, flags);
      expect([shown.sentForReview, shown.waitingToSend, shown.finished, shown.editable], [true, false, true, false]);
    });

    test('a draft its author may change: every answer stored, those waiting to send marked; a credential that can’t chart Medical changes only a Non-Medical one', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final social = note(p, visit, testNote, {'vitals.pulse': 88, 'more.detail': 'Demo: hidden later'});
      p.store.setField(social, 'data.more.none', true);
      final medical = note(p, visit, testMedical, {'vitals.pulse': 96});
      var view = (await repo(p).openVisit(visit))!;
      final draft = noteIn(view, social);
      expect([draft.editable, draft.actsAsAuthor, draft.shown], [true, true, NoteShown.draft]);
      // The form keeps an answer a condition hides, for when its field shows again (forms 8.1); the
      // read view and the recap don't show it.
      expect(draft.answers, {'vitals.pulse': 88, 'more.detail': 'Demo: hidden later', 'more.none': true});
      expect(draft.read!.sections.expand((s) => s.items).map((i) => i.path), isNot(contains('more.detail')));
      expect(draft.pendingPaths, {'vitals.pulse', 'more.detail', 'more.none'});
      await sync(p);
      view = (await repo(p).openVisit(visit, shownBefore: view.shownIds))!;
      expect(noteIn(view, social).pendingPaths, isEmpty);
      expect([view.notSynced, noteIn(view, social).notSynced], [false, false]);

      final chw = (await repo(p, credential: 'chw').openVisit(visit))!;
      expect([noteIn(chw, social).editable, noteIn(chw, medical).editable], [true, false]);
    });
  });
}
