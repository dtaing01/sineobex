import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// Complete from the summary screen (lifecycle 3.3, 3.5, 4.8, 9.6; card L4-complete): what stops it,
/// hard stop 4 the domain layer's own, the act and the button by credential, the hashes the summary
/// drew, and each refusal of the store worded for the summary. Each runs offline, then syncs to the
/// phone's test server (4.9), which decides as the API does.
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
  NoteTypeDef definition(TestNoteType t) => definitions[(t.key, t.version)]!;
  String nameOf(String user) => 'Demo ${user == alex ? 'Alex' : 'Blair'} Rivera';

  EncounterRepository repo(
    TestPhone p, {
    String credential = 'attending',
    Set<String> permissions = staff,
    Set<TestNoteType> lacking = const {},
    Iterable<NoteTypeDef>? listed,
  }) => EncounterRepository(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: nameOf(p.userId),
      credential: credential,
      permissions: permissions,
    ),
    definitions: NoteDefinitions(
      held: (key, version) async => lacking.contains((key: key, version: version)) ? null : definitions[(key, version)],
    ),
    noteTypes: () async => listed ?? definitions.values,
    openServerRecord: p.engine.openServerRecord,
  );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  /// A note of [type] added through the domain layer, its [answers] saved as the form saves them.
  Future<String> charted(EncounterRepository r, String visit, TestNoteType type, Map<String, Object?> answers) async {
    final id = (await r.addNote(visit, definition(type), another: true)).noteId;
    await r.openNote(id);
    for (final MapEntry(:key, :value) in answers.entries) {
      r.saveAnswer(id, key, value);
    }
    return id;
  }

  List<OutboxEntry> signoffs(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entitySignoff && e.state != ChangeState.superseded) e,
  ];

  List<CompleteStop> stopsOf(CompletePlan plan) => [for (final s in plan.stops) s.stop];

  Matcher refused(CompleteStop stop, {String? message}) => throwsA(
    isA<CompleteRefused>()
        .having((e) => [for (final s in e.stops) s.stop], 'stops', [stop])
        .having((e) => e.message, 'message', message ?? isNotEmpty),
  );

  /// Nothing the phone sent waits, is refused, or was held for a Program Admin.
  void serverTookAll(TestPhone p) {
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  String statusOn(String noteId) => server.records[noteId]!.fields['status']!.value! as String;

  group('what Complete finishes, and how (lifecycle 3.3, 3.5)', () {
    test('every draft of theirs that counts, the Red flags note last, each with the hash the summary drew', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final flags = await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      final social = await charted(r, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      // An empty draft counts for nothing (3.1): not completed, and nothing stops on it.
      await r.addNote(visit, definition(testNote), another: true);

      final plan = (await r.openComplete(visit))!;
      expect(plan.stops, isEmpty);
      expect([for (final n in plan.notes) n.noteId], [medical, social, flags]);
      expect([for (final n in plan.notes) n.act], [SignoffAct.sign, SignoffAct.complete, SignoffAct.sign]);
      expect([for (final n in plan.notes) n.statementVersion], ['sign-2026-11', 'complete-2026-11', 'sign-2026-11']);
      for (final n in plan.notes) {
        expect(n.shownHash, p.store.contentHashOf(n.noteId, n.definition), reason: n.noteId);
        expect(n.settlesOnly, isFalse);
      }
      expect([plan.button, plan.signs, plan.canComplete], [CompleteButton.completeAndSign, true, true]);

      var changed = 0;
      r.onChanged = () => changed++;
      final effects = r.complete(plan);
      expect(changed, 1);
      // The store sends the Red flags note's first (4.6), and expects what the server will decide.
      expect(effects.keys, [flags, medical, social]);
      expect(
        [
          for (final id in [flags, medical, social]) effects[id]!.status,
        ],
        [NoteStatus.signed, NoteStatus.signed, NoteStatus.completed],
      );
      expect(
        [for (final e in signoffs(p)) (e.value! as Map)['contentHash']],
        [
          for (final id in [flags, medical, social]) plan.notes.singleWhere((n) => n.noteId == id).shownHash,
        ],
      );
      expect([for (final e in signoffs(p)) (e.value! as Map)['claimedCredential']], ['attending', 'attending', null]);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([statusOn(flags), statusOn(medical), statusOn(social)], ['signed', 'signed', 'completed']);
    });

    test('the button and the act follow the credential the saved profile shows', () async {
      // Lifecycle 3.3's table and 6.2: a student's Medical note waits for a co-signer; a visit of
      // Non-Medical notes only is completed.
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      final r = repo(p, credential: 'student');
      server.offline = true;
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      final plan = (await r.openComplete(visit))!;
      expect([for (final n in plan.notes) n.act], [SignoffAct.complete, SignoffAct.complete]);
      expect([plan.button, plan.signs], [CompleteButton.completeAndSendForCosignature, false]);
      r.complete(plan);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(statusOn(medical), 'completed');

      final q = phone(blair);
      final s = repo(q);
      final outreach = s.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      await charted(s, outreach, testNote, {'care.plan': 'Demo: blankets'});
      final only = (await s.openComplete(outreach))!;
      expect([only.button, only.signs, only.notes.single.act], [CompleteButton.complete, false, SignoffAct.complete]);
    });

    test('the signing sentence names the signer as their saved profile does, and their credential (3.5)', () async {
      expect(
        signingSentence(
          EncounterUser(userId: alex, displayName: 'Demo Alex Rivera', credential: 'resident', permissions: staff),
        ),
        'By completing, you sign this note as Demo Alex Rivera, Resident.',
      );
      // A credential this app doesn't know is left out rather than shown as a code; it signs nothing.
      expect(
        signingSentence(
          EncounterUser(userId: alex, displayName: 'Demo Alex Rivera', credential: 'demo_new', permissions: staff),
        ),
        'By completing, you sign this note as Demo Alex Rivera.',
      );

      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p, credential: 'np');
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      await charted(r, visit, testMedical, {'vitals.pulse': 96});
      final plan = (await r.openComplete(visit))!;
      expect(
        [plan.signs, plan.signingSentence],
        [true, 'By completing, you sign this note as ${nameOf(alex)}, Nurse practitioner.'],
      );

      final student = repo(phone(blair), credential: 'student');
      final theirs = student.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(student, theirs, testRedFlags, {'flags.any': 'no'});
      await charted(student, theirs, testMedical, {'vitals.pulse': 96});
      final cosigned = (await student.openComplete(theirs))!;
      expect([cosigned.signs, cosigned.signingSentence], [false, isNull]);
    });

    test('a teammate’s draft stays a draft; with nothing of theirs to finish, Complete says so', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final theirs = await charted(rb, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      await sync(b);

      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      server.offline = true;
      final r = repo(p);
      final plan = (await r.openComplete(visit))!;
      expect(
        [for (final t in plan.teammateDrafts) (t.noteId, t.author.userId, t.title)],
        [(theirs, blair, definition(testNote).title)],
      );
      expect(plan.notes, isEmpty);
      expect(stopsOf(plan), [CompleteStop.nothingToComplete]);
      expect(() => r.complete(plan), refused(CompleteStop.nothingToComplete));
      expect(p.store.outbox(), isEmpty);

      // Their own note beside it is completed alone.
      final mine = await charted(r, visit, testNote, {'care.plan': 'Demo: sleeping bag'});
      final again = (await r.openComplete(visit))!;
      expect([for (final n in again.notes) n.noteId], [mine]);
      expect(again.teammateDrafts.single.noteId, theirs);
      r.complete(again);
      server.offline = false;
      await sync(p);
      expect([statusOn(mine), statusOn(theirs)], ['completed', 'draft']);
    });
  });

  group('what stops Complete (lifecycle 3.3, 9.6)', () {
    test('hard stop 1: each required answer missing is listed by note and section, and nothing is written', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      // The Red flags note the app added is still empty: it is finished with the Medical note all the
      // same, so its finish check asks for the red-flag answer (forms 6.2, hard stop 5).
      final flags = (await r.addNote(visit, definition(testRedFlags))).noteId;
      final plan = (await r.openComplete(visit))!;
      expect([for (final n in plan.notes) n.noteId], [medical, flags]);
      final missing = plan.stops.single;
      expect(
        [missing.stop, missing.noteId, missing.section, missing.path],
        [CompleteStop.missingAnswer, flags, 'flags', 'flags.any'],
      );
      expect(missing.message, 'Test Red flags note: Red flags, “Any red flags?” needs an answer.');
      expect(plan.canComplete, isFalse);
      final before = p.store.outbox().length;
      expect(() => r.complete(plan), refused(CompleteStop.missingAnswer));
      expect(p.store.outbox(), hasLength(before));
      expect([p.store.localEffect(medical), p.store.localEffect(flags)], [null, null]);

      await r.openNote(flags);
      r.saveAnswer(flags, 'flags.any', 'no');
      r.complete((await r.openComplete(visit))!);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([statusOn(medical), statusOn(flags)], ['signed', 'signed']);
    });

    test('hard stop 4: a Medical note on a visit with no patient waits for one, and nothing is written', () async {
      // Lifecycle 3.3 and 3.10: the store does not check this one. A visit made by an earlier build
      // (or another client) with no patient and a Medical note.
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = p.store.createEncounter(kind: 'medical');
      final flags = p.store.createNote(
        encounterId: visit,
        noteTypeKey: testRedFlags.key,
        noteTypeVersion: testRedFlags.version,
        data: const {'flags.any': 'no'},
      );
      final plan = (await r.openComplete(visit))!;
      expect(stopsOf(plan), [CompleteStop.needsPatient]);
      expect(plan.stops.single.message, 'A clinical note needs a patient. Choose who this visit is for.');
      final before = p.store.outbox().length;
      expect(() => r.complete(plan), refused(CompleteStop.needsPatient));
      expect(p.store.outbox(), hasLength(before));
      expect(p.store.localEffect(flags), isNull);

      // Given a patient, it completes.
      p.store.setField(visit, 'patientId', patient);
      final given = (await r.openComplete(visit))!;
      expect(given.stops, isEmpty);
      expect(r.complete(given).keys, [flags]);
    });

    test('hard stop 5: a finished Red flags note, or their own finished with the rest', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.medical, patientId: patient);
      final theirs = await charted(rb, visit, testRedFlags, {'flags.any': 'no'});
      await sync(b);

      final p = phone(alex);
      // The team's list on this phone names no Red flags type, so the app adds none of their own
      // (red_flags_test.dart has the app's own note).
      final r = repo(
        p,
        listed: [
          for (final d in definitions.values)
            if (d.auto == null) d,
        ],
      );
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      server.offline = true;
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      // A colleague's unfinished Red flags note does not count.
      var plan = (await r.openComplete(visit))!;
      expect(stopsOf(plan), [CompleteStop.redFlagsFirst]);
      expect(plan.stops.single.message, 'Answer the red-flag question first, then complete again.');
      expect(plan.stops.single.noteId, isNull);
      expect(() => r.complete(plan), refused(CompleteStop.redFlagsFirst));
      expect(signoffs(p), isEmpty);
      // The visit read shows a finished one this phone does not hold.
      expect(stopsOf((await r.openComplete(visit, redFlagsFinished: true))!), isEmpty);

      // Once the colleague's is finished, and the phone holds it so, theirs lets the Medical note by.
      server.offline = false;
      rb.complete((await rb.openComplete(visit))!);
      await sync(b);
      await sync(p);
      expect(p.store.noteState(theirs)!.status, NoteStatus.signed);
      server.offline = true;
      plan = (await r.openComplete(visit))!;
      expect(stopsOf(plan), isEmpty);
      expect([for (final n in plan.notes) n.noteId], [medical]);
      r.complete(plan);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(statusOn(medical), 'signed');
    });

    test('hard stop 2: anything about the visit in Needs attention; a refused sign-off being fixed does not', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      // A change the server refused waits in Needs attention.
      p.store.setField(n, 'data.vitals.pulse', 'fast');
      await sync(p);
      final waiting = p.store.needsAttention().single;
      server.offline = true;
      final plan = (await r.openComplete(visit))!;
      expect(stopsOf(plan), [CompleteStop.needsAttention]);
      expect(
        plan.stops.single.message,
        'Something about this visit waits in Needs attention. Fix it there first, then complete again.',
      );
      expect(() => r.complete(plan), refused(CompleteStop.needsAttention));
      expect(signoffs(p), isEmpty);
      p.store.fixRejected(waiting.changeId, 90);
      server.offline = false;
      await sync(p);

      // A teammate's change reaches the server first: the sign-off is refused, and completing again
      // is its fix, so its refusal stops nothing.
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      final refusal = p.store.needsAttention().single;
      expect([refusal.entity, refusal.details?['problem']], [entitySignoff, 'content_changed']);
      final again = (await r.openComplete(visit))!;
      expect(stopsOf(again), isEmpty);
      expect(again.notes.single.settlesOnly, isFalse);
      r.complete(again);
      await sync(p);
      serverTookAll(p);
      expect(statusOn(n), 'completed');
    });

    test('hard stop 3: while the clock check fails, and while the store is frozen', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final drawn = (await r.openComplete(visit))!;
      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      final plan = (await r.openComplete(visit))!;
      expect(stopsOf(plan), [CompleteStop.chartingPaused]);
      expect(plan.stops.single.message, 'Charting is paused until the phone’s clock is right.');
      expect(
        () => r.complete(drawn),
        refused(CompleteStop.chartingPaused, message: 'Charting is paused until the phone’s clock is right.'),
      );
      expect(p.store.localEffect(n), isNull);

      p.wall = p.wall.subtract(const Duration(minutes: 10));
      p.store.freeze('Demo: handing over');
      expect(() => r.openComplete(visit), throwsA(isA<ChartingPaused>()));
      expect(() => r.complete(drawn), refused(CompleteStop.chartingPaused, message: 'Demo: handing over'));
      expect(signoffs(p), isEmpty);
    });

    test(
      'a role that doesn’t chart, or a credential that doesn’t chart Medical, is told before anything is sent',
      () async {
        // The server would hold the sign-off for a Program Admin (4.2), which the person could never fix.
        final p = phone(alex);
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
        p.store
          ..createNote(
            encounterId: visit,
            noteTypeKey: testRedFlags.key,
            noteTypeVersion: testRedFlags.version,
            data: const {'flags.any': 'no'},
          )
          ..createNote(
            encounterId: visit,
            noteTypeKey: testNote.key,
            noteTypeVersion: testNote.version,
            data: const {'care.plan': 'Demo: blankets'},
          );
        final lowered = (await repo(p, credential: 'chw').openComplete(visit))!;
        expect(stopsOf(lowered), [CompleteStop.medicalCredential]);
        expect(lowered.stops.single.message, 'Your credential doesn’t chart clinical notes.');
        final removed = (await repo(p, permissions: const {'patients.view'}).openComplete(visit))!;
        expect(stopsOf(removed), contains(CompleteStop.notCharting));
        expect(signoffs(p), isEmpty);
      },
    );

    test('a note whose form isn’t on this phone is listed, not completed', () async {
      final p = phone(alex);
      final r = repo(p, lacking: {testNote});
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = p.store.createNote(
        encounterId: visit,
        noteTypeKey: testNote.key,
        noteTypeVersion: testNote.version,
        data: const {'care.plan': 'Demo: blankets'},
      );
      final plan = (await r.openComplete(visit))!;
      expect([for (final s in plan.stops) (s.stop, s.noteId)], [(CompleteStop.noDefinition, n)]);
      expect(plan.stops.single.message, 'This note’s form isn’t on this phone yet. Connect to load it, then complete.');
      expect(plan.notes, isEmpty);
    });
  });

  group('Complete, and each refusal worded for the summary (lifecycle 4.8, 9.6)', () {
    test('a change synced in after the summary was drawn: “This note changed. Read it again.”', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final drawn = (await r.openComplete(visit))!;
      server.serverEdit(n, 'data.vitals.pulse', 92, by: blair);
      await sync(p);
      expect(p.store.record(n)!.fields['data.vitals.pulse']!.value, 92);
      server.offline = true;
      expect(
        () => r.complete(drawn),
        throwsA(
          isA<CompleteRefused>().having((e) => [for (final s in e.stops) (s.stop, s.noteId, s.message)], 'stops', [
            (CompleteStop.noteChanged, n, 'This note changed. Read it again.'),
          ]),
        ),
      );
      expect(signoffs(p), isEmpty);
      // Read again, it completes over what was read.
      final read = (await r.openComplete(visit))!;
      r.complete(read);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 92);
      expect(statusOn(n), 'completed');
    });

    test('a refused sign-off of a note finished since is settled by Complete, which expects nothing of it', () async {
      // Lifecycle 3.4 and 4.8 (review finding SFN-1): the note was finished on the person's other phone.
      final a = phone(alex);
      final ra = repo(a);
      final visit = ra.startEncounter(kind: VisitKind.nonMedical);
      final n = await charted(ra, visit, testNote, {'vitals.pulse': 88});
      await sync(a);
      final b = phone(alex);
      final rb = repo(b);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      ra.complete((await ra.openComplete(visit))!);
      await rb.openNote(n);
      rb.saveAnswer(n, 'vitals.pulse', 90);
      await sync(b);
      await sync(a);
      expect(a.store.needsAttention().single.entity, entitySignoff);
      rb.complete((await rb.openComplete(visit))!);
      await sync(b);
      await sync(a);
      expect(a.store.noteState(n)!.status, NoteStatus.completed);

      server.offline = true;
      final plan = (await ra.openComplete(visit))!;
      expect(stopsOf(plan), isEmpty);
      expect([for (final x in plan.notes) (x.noteId, x.settlesOnly)], [(n, true)]);
      expect([plan.button, plan.signs], [CompleteButton.complete, false]);
      expect(ra.complete(plan), isEmpty);
      server.offline = false;
      await sync(a);
      serverTookAll(a);
      expect(a.store.notices(), isEmpty);
    });

    test('after a reopen, Complete waits for the last Complete to send: said before it is pressed', () async {
      // Lifecycle 4.8: the store refuses a second sign-off of a note with one waiting (RecordLocked).
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      final r = repo(p, credential: 'student');
      server.offline = true;
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      r.complete((await r.openComplete(visit))!);
      expect(p.store.reopenNote(medical, definition(testMedical)), ReopenEffect.apply);
      r.saveAnswer(medical, 'vitals.pulse', 98);
      final plan = (await r.openComplete(visit))!;
      expect([for (final s in plan.stops) (s.stop, s.noteId)], [(CompleteStop.waitingToSend, medical)]);
      expect(
        plan.stops.single.message,
        'Your last Complete of this note hasn’t been sent yet. Connect so it can send, then complete again.',
      );
      expect(() => r.complete(plan), refused(CompleteStop.waitingToSend));

      server.offline = false;
      await sync(p);
      final again = (await r.openComplete(visit))!;
      expect(stopsOf(again), isEmpty);
      r.complete(again);
      await sync(p);
      serverTookAll(p);
      expect(server.records[medical]!.fields['data.vitals.pulse']!.value, 98);
      expect(statusOn(medical), 'completed');
    });

    test('a note sent for review is not completed again, and says so rather than that it is finished', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final flags = await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      await sync(p);
      final drawn = (await r.openComplete(visit))!;
      // The credential was lowered on the server and the phone's profile doesn't know (4.2).
      server.changeCredential(alex, 'chw');
      r.complete(drawn);
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);

      server.offline = true;
      final plan = (await r.openComplete(visit))!;
      expect(plan.sentForReview, [flags]);
      expect(plan.notes, isEmpty);
      expect(stopsOf(plan), [CompleteStop.nothingToComplete]);
      expect(
        () => r.complete(drawn),
        refused(
          CompleteStop.sentForReview,
          message: 'This note was sent to a Program Admin for review. It can’t be completed again until they decide.',
        ),
      );
    });

    test('a note finished since the summary was drawn is not finished twice', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      await charted(r, visit, testNote, {'vitals.pulse': 88});
      final drawn = (await r.openComplete(visit))!;
      r.complete(drawn);
      expect(() => r.complete(drawn), refused(CompleteStop.finished, message: 'This note is already finished.'));
      expect(signoffs(p), hasLength(1));
    });

    test('a note gone from the phone since the summary was drawn: “This note changed.” (review LCM-5)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final n = await charted(r, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final drawn = (await r.openComplete(visit))!;
      p.store.closeRecord(n);
      p.store.purge();
      expect(p.store.record(n), isNull);
      expect(
        () => r.complete(drawn),
        throwsA(
          isA<CompleteRefused>().having((e) => [for (final s in e.stops) (s.stop, s.noteId, s.message)], 'stops', [
            (CompleteStop.noteChanged, n, 'This note changed. Read it again.'),
          ]),
        ),
      );
      expect(signoffs(p), isEmpty);
    });

    // What the store refuses that the plan does not foresee, worded for the summary all the same: a
    // fix that only settles a refusal, drawn while the refusal waited, which is gone by the time
    // Complete is pressed.
    CompletePlan settling(EncounterRepository r, String visit, String noteId) => CompletePlan(
      encounterId: visit,
      notes: [
        NoteToComplete(
          noteId: noteId,
          definition: definition(testNote),
          shownHash: r.store.contentHashOf(noteId, definition(testNote)),
          act: SignoffAct.complete,
          settlesOnly: true,
        ),
      ],
      stops: const [],
      teammateDrafts: const [],
      sentForReview: const [],
      redFlagsFinished: false,
    );

    test('the store’s RecordLocked and empty are worded too (review LCM-5)', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final done = await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      expect(
        () => r.complete(settling(r, visit, done)),
        refused(CompleteStop.finished, message: 'This note is already finished.'),
      );
      final empty = (await r.addNote(visit, definition(testNote), another: true)).noteId;
      expect(() => r.complete(settling(r, visit, empty)), refused(CompleteStop.nothingToComplete));
      expect(signoffs(p), hasLength(1));
    });
  });

  group('the assessment (lifecycle 3.1, 9.6)', () {
    test('saved as typed while the visit has no finished note; then locked', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      await charted(r, visit, testNote, {'vitals.pulse': 88});
      var changed = 0;
      r.onChanged = () => changed++;
      expect(r.saveSummary(visit, '  Demo: stable, follow up tomorrow  '), isTrue);
      expect(p.store.record(visit)!.fields['summary']!.value, 'Demo: stable, follow up tomorrow');
      // The same text again is no change; spaces alone clear it.
      expect(r.saveSummary(visit, 'Demo: stable, follow up tomorrow'), isFalse);
      expect(changed, 1);
      expect(r.saveSummary(visit, '   '), isTrue);
      expect(p.store.record(visit)!.fields['summary']!.value, isNull);
      expect(r.saveSummary(visit, 'Demo: stable'), isTrue);

      // The hash the summary draws covers it (4.5): Complete signs the assessment as it was read.
      final plan = (await r.openComplete(visit))!;
      r.complete(plan);
      expect(() => r.saveSummary(visit, 'Demo: later'), throwsA(isA<RecordLocked>()));
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[visit]!.fields['summary']!.value, 'Demo: stable');
    });

    test('a reader of no Medical notes does not change a Medical visit’s assessment', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = repo(p).startEncounter(kind: VisitKind.medical, patientId: patient);
      final r = repo(p, credential: 'chw', permissions: const {'encounters.chart'});
      expect(
        () => r.saveSummary(visit, 'Demo: stable'),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'read_only')),
      );
    });

    test('added to after the visit has a finished note: an addendum to the visit, made with Complete', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      await charted(r, visit, testNote, {'vitals.pulse': 88});
      r.complete((await r.openComplete(visit))!);
      final later = await charted(r, visit, testNote, {'care.plan': 'Demo: came back for socks'});
      final plan = (await r.openComplete(visit))!;
      expect(() => r.complete(plan, addToAssessment: 'Demo: ${'x' * 4000}'), refused(CompleteStop.assessment));
      expect(p.store.localEffect(later), isNull);

      final effects = r.complete(plan, addToAssessment: '  Demo: still stable at noon  ');
      final addendum = p.store.outbox().singleWhere((e) => e.entity == entityAddendum);
      expect(addendum.value, {
        'encounterId': visit,
        'noteId': null,
        'text': 'Demo: still stable at noon',
        'signoffId': effects[later]!.signoffId,
      });
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[addendum.recordId]!.attributes['encounterId'], visit);
    });
  });
}
