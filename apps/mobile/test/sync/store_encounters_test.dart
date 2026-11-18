import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entityCorrection, entityReferral, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';
import 'test_note_types.dart';

/// The phone's store in phase 4 (lifecycle 4.8): the visit as the server keeps it, Complete
/// (`finishNotes`), the lock that follows a note's effect, and the patient of a new record. Each
/// rule is checked against the phone's test server, which mirrors the API (lifecycle 4.9): where
/// the answer is the server's, the test syncs and reads the store's state after the receipt.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const carol = 'c0000000-0000-4000-8000-00000000000c';
  final start = DateTime.utc(2026, 10, 20, 15);

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
  NoteTypeDef? definitionOf(String key, int version) => definitions[(key, version)];
  NoteTypeDef definition(TestNoteType t) => definitions[(t.key, t.version)]!;

  const attending = Signer(credential: 'attending', canSign: true, needsAttestation: false);
  const resident = Signer(credential: 'resident', canSign: true, needsAttestation: true);
  const student = Signer(credential: 'student', canSign: false, needsAttestation: true);

  String note(TestPhone p, String encounter, TestNoteType type, [Map<String, Object?> data = const {}]) =>
      p.store.createNote(encounterId: encounter, noteTypeKey: type.key, noteTypeVersion: type.version, data: data);

  Map<String, Object?> answersOf(TestPhone p, String noteId) => {
    for (final MapEntry(:key, :value) in p.store.record(noteId)!.fields.entries)
      if (key.startsWith('data.')) key.substring('data.'.length): value.value,
  };

  /// The hash the summary screen works out as it draws [noteId] (lifecycle 9.6): the visit's patient
  /// and summary and the note's answers, as the phone holds them now.
  String drawn(TestPhone p, String noteId, TestNoteType type) {
    final rec = p.store.record(noteId)!;
    final visit = p.store.record(rec.attributes['encounterId']! as String)!;
    return noteContentHash(
      noteId: noteId,
      encounterId: visit.id,
      patientId: visit.fields['patientId']?.value as String?,
      summary: visit.fields['summary']?.value as String?,
      definition: definition(type),
      answers: answersOf(p, noteId),
    );
  }

  NoteToFinish finishing(TestPhone p, String noteId, TestNoteType type, {SignoffAct act = SignoffAct.complete}) =>
      NoteToFinish(
        noteId: noteId,
        shownHash: drawn(p, noteId, type),
        act: act,
        statementVersion: '${act.name}-2026-11',
      );

  Map<String, LocalEffect> complete(
    TestPhone p,
    List<NoteToFinish> notes, {
    Signer signer = attending,
    bool redFlagsFinished = false,
  }) => p.store.finishNotes(notes, signer: signer, definitionOf: definitionOf, redFlagsFinished: redFlagsFinished);

  List<OutboxEntry> signoffs(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entitySignoff && e.state != ChangeState.superseded) e,
  ];

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  /// What reached the server too late to apply: kept in its history, and who was told so.
  List<Object> late() => [
    ...server.history.where((h) => h['kind'] == 'kept_both'),
    ...server.notices.where((n) => n.kind == 'late_change_kept' || n.kind == 'change_not_applied'),
  ];

  OutboxEntry createOf(TestPhone p, String recordId) =>
      p.store.outbox().singleWhere((e) => e.recordId == recordId && e.op == 'create');

  group('the visit as the server keeps it (lifecycle 4.3)', () {
    test('a new visit holds its kind as a field beside the place typed by hand, and no status', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical', locationText: 'Demo: east underpass');
      final create = p.store.outbox().single;
      expect(create.value, {'kind': 'non_medical', 'locationText': 'Demo: east underpass'});
      final rec = p.store.record(visit)!;
      expect(rec.attributes, isEmpty);
      expect(rec.fields.keys, unorderedEquals(['patientId', 'location', 'locationText', 'kind']));
      expect([rec.fields['kind']!.value, rec.fields['locationText']!.value], ['non_medical', 'Demo: east underpass']);
      expect({for (final f in rec.fields.values) f.pendingChange}, {create.changeId});
      // The server stores text as it is sent, so the phone sends it trimmed and within its length.
      for (final bad in [' Demo: east underpass', 'x' * 201, '']) {
        expect(() => p.store.createEncounter(kind: 'medical', locationText: bad), throwsA(isA<LocalValidationError>()));
      }
      expect(p.store.outbox(), hasLength(1));

      expect(await sync(p), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['locationText']!.value, 'Demo: east underpass');
      expect(p.store.record(visit)!.fields['kind']!.serverVersion, 1);

      // Switching to Medical is a set of the kind, from the version the create left it at.
      p.store.setField(visit, 'kind', 'medical');
      expect(p.store.outbox().single.baseVersion, 1);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['kind']!.value, 'medical');
      expect(
        [p.store.record(visit)!.fields['kind']!.value, p.store.record(visit)!.fields['kind']!.serverVersion],
        ['medical', 2],
      );
    });

    test('a visit’s status is the one the server works out from its notes', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      expect(p.store.record(visit)!.status, 'draft');

      server.finishNote(n);
      expect(server.records[visit]!.status, 'completed');
      await sync(p);
      expect(p.store.record(visit)!.status, 'completed');
      expect(p.store.record(visit)!.fields.containsKey('status'), isFalse);

      // A teammate who opens the visit sees the same, and sees it change.
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(b.store.record(visit)!.status, 'completed');
      note(p, visit, testNote, {'vitals.pulse': 90});
      await sync(p);
      expect(server.records[visit]!.status, 'draft');
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect([p.store.record(visit)!.status, b.store.record(visit)!.status], ['draft', 'draft']);
    });

    test('a refused visit create is fixed with the place typed by hand the person has now', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical', locationText: 'Demo: east underpass');
      final refused = p.store.outbox().single;
      p.store.reject(refused, reason: 'validation');
      p.store.fixRejected(refused.changeId, {'kind': 'medical'});
      final fix = p.store.sendable().single;
      expect(fix.value, containsPair('locationText', 'Demo: east underpass'));
      expect(p.store.record(visit)!.fields['locationText']!.value, 'Demo: east underpass');

      // Changed since: the fix carries the new place, and nothing follows it.
      p.store.reject(fix, reason: 'validation');
      p.store.setField(visit, 'locationText', 'Demo: north lot');
      p.store.fixRejected(fix.changeId, {'kind': 'medical'});
      expect(p.store.sendable().single.value, containsPair('locationText', 'Demo: north lot'));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['locationText']!.value, 'Demo: north lot');
    });
  });

  group('Complete (lifecycle 4.8)', () {
    test('the hash shown is the hash sent, over the visit’s patient and summary, and the server agrees', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final n = note(p, visit, testNote, {'vitals.pulse': 88, 'care.plan': 'Demo: rest and fluids'});
      p.store.setField(visit, 'summary', 'Demo: well; follow up next week');
      final shown = drawn(p, n, testNote);
      expect(p.store.contentHashOf(n, definition(testNote)), shown);

      final made = complete(p, [finishing(p, n, testNote)]);
      final signoff = signoffs(p).single;
      expect(signoff.value, {
        'noteId': n,
        'act': 'complete',
        'contentHash': shown,
        'claimedCredential': null,
        'statementVersion': 'complete-2026-11',
      });
      // The sign-off is work on the visit's patient: that chart stays on the phone while it waits.
      expect(signoff.patientId, patient);
      expect(p.store.record(signoff.recordId)!.patientId, patient);
      final effect = p.store.localEffect(n)!;
      expect(
        [effect.effect, effect.status, effect.attestation, effect.signoffId],
        [SignoffOutcome.completed, NoteStatus.completed, Attestation.notNeeded, signoff.recordId],
      );
      expect(made.keys, [n]);
      expect(made[n]!.signoffId, signoff.recordId);
      // The note's own status is the server's to change.
      expect(p.store.record(n)!.status, 'draft');

      expect(await sync(p), isA<SyncDone>());
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(server.records[signoff.recordId]!.attributes['contentHash'], shown);
    });

    test('a signature covers what was on the screen: a change synced in since stops Complete', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final other = server.seedPatient(preferredName: 'Demo Other');
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final first = note(p, visit, testNote, {'vitals.pulse': 88});
      final second = note(p, visit, testNote, {'care.plan': 'Demo: shelter referral'});
      await sync(p);

      Future<void> stops(void Function() teammate, List<String> changed) async {
        final shown = [finishing(p, first, testNote), finishing(p, second, testNote)];
        teammate();
        await sync(p);
        final before = p.store.outbox().length;
        expect(() => complete(p, shown), throwsA(isA<NoteChanged>().having((e) => e.noteIds, 'noteIds', changed)));
        expect(p.store.outbox(), hasLength(before));
        expect([p.store.localEffect(first), p.store.localEffect(second)], [null, null]);
      }

      await stops(() => server.serverEdit(first, 'data.vitals.pulse', 92, by: blair), [first]);
      expect(answersOf(p, first), {'vitals.pulse': 92});
      await stops(() => server.serverEdit(visit, 'summary', 'Demo: teammate’s assessment', by: blair), [first, second]);
      await stops(() => server.serverEdit(visit, 'patientId', other, by: blair), [first, second]);

      // Drawn again, it goes.
      complete(p, [finishing(p, first, testNote), finishing(p, second, testNote)]);
      expect(signoffs(p), hasLength(2));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(
        [server.records[first]!.fields['status']!.value, server.records[second]!.fields['status']!.value],
        ['completed', 'completed'],
      );
    });

    test('a sign-off the server refuses is fixed by completing again: the same record with the new hash', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      // A teammate's change reaches the server before the sign-off; this phone hasn't seen it.
      server.serverEdit(n, 'data.vitals.pulse', 92, by: blair);
      final signoffId = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      final refused = signoffs(p).single;

      await sync(p);
      final shown = p.store.needsAttention().single;
      expect([shown.changeId, shown.details?['problem']], [refused.changeId, 'content_changed']);
      expect(server.records[n]!.fields['status']!.value, 'draft');
      // What names the refused sign-off waits behind it.
      final addendum = p.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: called back with results',
        'signoffId': signoffId,
      });
      expect(p.store.heldCount(), 1);
      // The refusal is kept until it is fixed, and stops nothing else.
      final later = p.store.createEncounter(kind: 'non_medical');
      await sync(p);
      expect(server.records.containsKey(later), isTrue);
      expect(p.store.needsAttention().single.changeId, refused.changeId);

      // The sync brought the teammate's change in; the person reads the note again and completes.
      expect(answersOf(p, n), {'vitals.pulse': 92});
      final again = finishing(p, n, testNote);
      expect(complete(p, [again])[n]!.signoffId, signoffId);
      final fix = signoffs(p).single;
      expect([fix.recordId, fix.supersedes, fix.op], [signoffId, refused.changeId, 'create']);
      expect((fix.value! as Map<String, Object?>)['contentHash'], again.shownHash);
      expect(p.store.entry(refused.changeId)!.state, ChangeState.superseded);
      expect(p.store.needsAttention(), isEmpty);
      expect(p.store.localEffect(n)!.signoffId, signoffId);

      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(server.records[signoffId]!.attributes['contentHash'], again.shownHash);
      // The addendum went after the sign-off it named, which the server now holds.
      expect(server.records[addendum]!.attributes['noteId'], n);
    });

    test('a refused note fixed while its sign-off waits behind it is still finished here', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      await sync(p);
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final create = p.store.outbox().single;
      p.store.reject(create, reason: 'validation', details: {'problem': 'unknown_note_type'});
      final expected = complete(p, [finishing(p, n, testNote)])[n]!;
      expect(p.store.heldCount(), 1);

      p.store.fixRejected(create.changeId, {
        'encounterId': visit,
        'noteTypeKey': testNote.key,
        'noteTypeVersion': testNote.version,
      });
      expect(p.store.localEffect(n)?.toJson(), expected.toJson());
      expect(() => complete(p, [finishing(p, n, testNote)]), throwsA(isA<RecordLocked>()));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
    });

    test('the Red flags note goes first, so the visit’s Medical notes are signed with it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final wound = note(p, visit, testMedical, {'wound.site': 'Demo: left shin'});
      final vitals = note(p, visit, testMedical, {'vitals.pulse': 96});
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});

      final made = complete(p, [
        finishing(p, wound, testMedical, act: SignoffAct.sign),
        finishing(p, vitals, testMedical, act: SignoffAct.sign),
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
      ]);
      expect([for (final s in signoffs(p)) (s.value! as Map<String, Object?>)['noteId']], [flags, wound, vitals]);
      expect(made.keys, [flags, wound, vitals]);
      for (final s in signoffs(p)) {
        expect(s.value, containsPair('claimedCredential', 'attending'));
        expect(s.patientId, patient);
      }
      for (final n in [flags, wound, vitals]) {
        expect(
          [p.store.localEffect(n)!.status, p.store.localEffect(n)!.attestation],
          [NoteStatus.signed, Attestation.notNeeded],
        );
      }

      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(
        [
          for (final n in [flags, wound, vitals]) server.records[n]!.fields['status']!.value,
        ],
        ['signed', 'signed', 'signed'],
      );
    });

    test('a resident’s signature waits for attestation; a student’s note waits for a co-signer', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      server.credentials[alex] = 'resident';
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, n, testMedical, act: SignoffAct.sign),
      ], signer: resident);
      expect(signoffs(p).last.value, containsPair('claimedCredential', 'resident'));
      expect(
        [p.store.localEffect(n)!.effect, p.store.localEffect(n)!.attestation],
        [SignoffOutcome.signed, Attestation.waiting],
      );
      await sync(p);
      expect([server.records[n]!.fields['status']!.value, server.records[n]!.attestation], ['signed', 'waiting']);

      final s = phone(blair);
      server.credentials[blair] = 'student';
      final visit2 = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags2 = note(s, visit2, testRedFlags, {'flags.any': 'yes'});
      final n2 = note(s, visit2, testMedical, {'vitals.pulse': 70});
      complete(s, [finishing(s, flags2, testRedFlags), finishing(s, n2, testMedical)], signer: student);
      expect([for (final o in signoffs(s)) (o.value! as Map<String, Object?>)['claimedCredential']], [null, null]);
      expect(
        [s.store.localEffect(n2)!.effect, s.store.localEffect(n2)!.status],
        [SignoffOutcome.completed, NoteStatus.completed],
      );
      await sync(s);
      expect(s.store.outbox(), isEmpty);
      expect(server.records[n2]!.fields['status']!.value, 'completed');
    });

    test('Complete stops where the server would refuse, and writes nothing', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      final flags = note(p, visit, testRedFlags);
      final before = p.store.outbox().length;

      Matcher problem(String code) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', code));
      // The red-flag question unanswered: the Red flags note is refused, and the others with it.
      expect(
        () => complete(p, [
          finishing(p, n, testMedical, act: SignoffAct.sign),
          finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        ]),
        problem('incomplete'),
      );
      // A Medical note while the visit has no finished Red flags note.
      expect(() => complete(p, [finishing(p, n, testMedical, act: SignoffAct.sign)]), problem('red_flags_first'));
      expect(p.store.outbox(), hasLength(before));
      expect([p.store.localEffect(n), p.store.localEffect(flags)], [null, null]);

      // A visit whose Red flags note a teammate finished (the visit read says so) is not held up.
      complete(p, [finishing(p, n, testMedical, act: SignoffAct.sign)], redFlagsFinished: true);
      expect(p.store.localEffect(n)!.effect, SignoffOutcome.signed);
      // Finished here already: a second Complete makes no second sign-off.
      expect(() => complete(p, [finishing(p, n, testMedical, act: SignoffAct.sign)]), throwsA(isA<RecordLocked>()));
      expect(signoffs(p), hasLength(1));
    });

    test('a Red flags note finished on the server lets the visit’s other Medical notes be signed', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      await sync(p);
      server.finishNote(flags, status: 'signed');
      await sync(p);
      expect(p.store.record(flags)!.status, 'signed');
      complete(p, [finishing(p, n, testMedical, act: SignoffAct.sign)]);
      // Already finished there: no sign-off of it is made again.
      expect(() => complete(p, [finishing(p, flags, testRedFlags)]), throwsA(isA<RecordLocked>()));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'signed');
    });

    test('only whoever acts as the author completes a note', () async {
      final b = phone(blair);
      final visit = b.store.createEncounter(kind: 'non_medical');
      final n = note(b, visit, testNote, {'vitals.pulse': 70});
      await sync(b);
      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', n), isTrue);
      expect(
        () => complete(p, [finishing(p, n, testNote)]),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_author')),
      );
      expect(p.store.outbox(), isEmpty);
    });

    test('answers that do not count leave the phone’s copy at Complete, as they leave the server’s', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {
        'vitals.pulse': 88,
        'more.detail': 'Demo: slept outside two nights',
        'care.plan': 'Demo: to be cleared',
      });
      await sync(p);
      // Ticked "Nothing more" hides the detail; the plan is cleared. Neither is sent yet.
      p.store.setField(n, 'data.more.none', true);
      p.store.setField(n, 'data.care.plan', null);
      final waiting = p.store.outbox().length;
      final shown = finishing(p, n, testNote);
      complete(p, [shown]);
      expect(answersOf(p, n), {'vitals.pulse': 88, 'more.none': true});
      expect(answersOf(p, n), effectiveAnswers(definition(testNote), answersOf(p, n)));
      expect(p.store.contentHashOf(n, definition(testNote)), shown.shownHash);
      // What the person changed still leaves the phone only with its receipt.
      expect(p.store.outbox(), hasLength(waiting + 1));

      await sync(p);
      expect(p.store.outbox(), isEmpty);
      final held = server.records[n]!;
      expect(held.fields['status']!.value, 'completed');
      expect(
        {
          for (final MapEntry(:key, :value) in held.fields.entries)
            if (key.startsWith('data.') && value.value != null) key: value.value,
        },
        {'data.vitals.pulse': 88, 'data.more.none': true},
      );
      // Nothing is lost: the server keeps the dropped answer in its history.
      expect(
        server.history.where((h) => h['field'] == 'data.more.detail' && h['value'] == null).single['previous'],
        'Demo: slept outside two nights',
      );
    });

    test('Complete waits for the clock check, and writes nothing while it fails', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final shown = finishing(p, n, testNote);
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      expect(() => complete(p, [shown]), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), isEmpty);
      expect(p.store.localEffect(n), isNull);
    });

    test('one Complete is one transaction: a note refused undoes the notes before it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final social = note(p, visit, testNote, {'vitals.pulse': 88, 'more.detail': 'Demo: hidden later'});
      p.store.setField(social, 'data.more.none', true);
      final medical = note(p, visit, testMedical, {'vitals.pulse': 96});
      final before = p.store.outbox().length;
      final answers = answersOf(p, social);
      expect(
        () => complete(p, [finishing(p, social, testNote), finishing(p, medical, testMedical, act: SignoffAct.sign)]),
        throwsA(isA<LocalValidationError>()),
      );
      expect(p.store.outbox(), hasLength(before));
      expect(p.store.localEffect(social), isNull);
      expect(answersOf(p, social), answers);
      expect(() => complete(p, [finishing(p, social, testNote), finishing(p, social, testNote)]), throwsArgumentError);
    });
  });

  group('the lock follows the effect (lifecycle 4.8)', () {
    test('a note Complete finished is locked here at once, and stays locked once the server holds it', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final other = note(p, visit, testNote, {'vitals.pulse': 70});
      await sync(p);
      complete(p, [finishing(p, n, testNote)]);
      final before = p.store.outbox().length;
      for (final (field, value) in [('data.vitals.pulse', 90), ('data.care.plan', 'Demo: rest'), ('status', 'draft')]) {
        expect(() => p.store.setField(n, field, value), throwsA(isA<RecordLocked>()), reason: field);
      }
      expect(p.store.outbox(), hasLength(before));
      expect(answersOf(p, n), {'vitals.pulse': 88});
      // The visit's other note is a draft still.
      p.store.setField(other, 'data.vitals.pulse', 72);

      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(p.store.record(n)!.status, 'completed');
      expect(() => p.store.setField(n, 'data.vitals.pulse', 90), throwsA(isA<RecordLocked>()));
      expect(server.records[other]!.fields['data.vitals.pulse']!.value, 72);
      // Nothing reached the server after the note was finished there.
      expect(late(), isEmpty);
    });

    test('a note the server holds signed and attested is locked here; an addendum and a correction still go', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      await sync(p);
      // Signed by its author and attested online (L2's routes, which the fake's hooks stand in for).
      server
        ..finishNote(n, status: 'signed')
        ..attest(n, by: carol);
      await sync(p);
      expect(p.store.record(n)!.status, 'signed');
      expect(() => p.store.setField(n, 'data.vitals.pulse', 98), throwsA(isA<RecordLocked>()));
      // A teammate who opens it finds it locked too.
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      expect(() => b.store.setField(n, 'data.vitals.pulse', 98), throwsA(isA<RecordLocked>()));
      expect(b.store.outbox(), isEmpty);

      final addendum = p.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: the lab came back normal',
        'signoffId': null,
      });
      final correction = p.store.createRecord(entityCorrection, {
        'noteId': n,
        'changes': [
          {
            'field': 'data.vitals.pulse',
            'newValue': 94,
            'baseVersion': p.store.record(n)!.fields['data.vitals.pulse']!.serverVersion,
          },
        ],
        'reason': 'Demo: misread the monitor',
        'requestedByPatient': false,
        'declined': false,
        'claimedCredential': 'attending',
        'signoffId': null,
      });
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[addendum]!.attributes['noteId'], n);
      expect(server.records[correction]!.status, 'corrected');
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 94);
      expect(late(), isEmpty);
    });

    test('a note whose sign-off the server refused is a draft here again, to change and complete again', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      // A teammate's change reaches the server before the sign-off does.
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      expect(p.store.needsAttention().single.details?['problem'], 'content_changed');
      p.store.setField(n, 'data.vitals.pulse', 86);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(
        [server.records[n]!.fields['status']!.value, server.records[n]!.fields['data.vitals.pulse']!.value],
        ['completed', 86],
      );
      expect(late(), isEmpty);
    });

    test('what waits in Needs attention on a note finished since is still settled, into its history', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      // An answer the note type refuses, and one a teammate changed first.
      p.store.setField(n, 'data.vitals.pulse', 'fast');
      server.serverEdit(n, 'data.care.plan', 'Demo: teammate’s plan', by: blair);
      p.store.setField(n, 'data.care.plan', 'Demo: my plan');
      await sync(p);
      final refused = p.store.needsAttention().singleWhere((e) => e.state == ChangeState.rejected);
      final conflict = p.store.needsAttention().singleWhere((e) => e.state == ChangeState.conflict);
      // Then the note is finished (on the person's other phone, say).
      server.finishNote(n);
      await sync(p);
      expect(p.store.record(n)!.status, 'completed');
      expect(() => p.store.setField(n, 'data.vitals.pulse', 90), throwsA(isA<RecordLocked>()));

      p.store.fixRejected(refused.changeId, 90);
      expect(p.store.resolveConflict(conflict.changeId, keepMine: true), isTrue);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      // The note is as it was finished; both values are in its history.
      expect(answersOf(p, n), {'vitals.pulse': 88, 'care.plan': 'Demo: teammate’s plan'});
      expect(
        [
          for (final h in server.history)
            if (h['recordId'] == n && h['kind'] == 'kept_both') h['value'],
        ],
        [90, 'Demo: my plan'],
      );
    });

    test(
      'a visit’s patient, place and summary lock with its first finished note, not its kind or a blank patient',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        final other = server.seedPatient(preferredName: 'Demo Other');
        final visit = p.store.createEncounter(kind: 'non_medical', locationText: 'Demo: east underpass');
        final first = note(p, visit, testNote, {'vitals.pulse': 88});
        final second = note(p, visit, testNote, {'vitals.pulse': 70});
        // Open while every note is a draft.
        p.store.setField(visit, 'summary', 'Demo: well');
        await sync(p);
        complete(p, [finishing(p, first, testNote)]);
        final before = p.store.outbox().length;
        for (final (field, value) in [
          ('summary', 'Demo: changed afterwards'),
          ('locationText', 'Demo: north lot'),
          ('location', {'lat': 42.3, 'lng': -83.0}),
        ]) {
          expect(() => p.store.setField(visit, field, value), throwsA(isA<RecordLocked>()), reason: field);
        }
        expect(p.store.outbox(), hasLength(before));
        // The other note is a draft still; the kind goes to Medical at any time; a visit with no
        // patient is given one, which then locks with the rest.
        p.store
          ..setField(second, 'data.vitals.pulse', 72)
          ..setField(visit, 'kind', 'medical')
          ..setField(visit, 'patientId', patient);
        expect(() => p.store.setField(visit, 'patientId', other), throwsA(isA<RecordLocked>()));

        await sync(p);
        expect(p.store.outbox(), isEmpty);
        final held = server.records[visit]!.fields;
        expect(
          [
            for (final f in ['summary', 'locationText', 'kind', 'patientId']) held[f]!.value,
          ],
          ['Demo: well', 'Demo: east underpass', 'medical', patient],
        );
        expect(server.records[first]!.fields['status']!.value, 'completed');
        expect(server.records[second]!.fields['data.vitals.pulse']!.value, 72);
        expect(late(), isEmpty);
      },
    );

    test('a visit the server holds finished is locked here though its notes are not on the phone', () async {
      final b = phone(blair);
      final visit = b.store.createEncounter(kind: 'non_medical');
      final n = note(b, visit, testNote, {'vitals.pulse': 70});
      complete(b, [finishing(b, n, testNote)]);
      await sync(b);
      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(p.store.record(visit)!.status, 'completed');
      expect(() => p.store.setField(visit, 'summary', 'Demo: teammate’s view'), throwsA(isA<RecordLocked>()));
      p.store.setField(visit, 'kind', 'medical');
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['kind']!.value, 'medical');
      expect(late(), isEmpty);
    });

    test('a reopen gets through: a student’s note waiting for a co-signer goes back to draft for its author', () async {
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final patient = server.seedPatient();
      final visit = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(s, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(s, visit, testMedical, {'vitals.pulse': 96});
      complete(s, [finishing(s, flags, testRedFlags), finishing(s, n, testMedical)], signer: student);
      await sync(s);
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(s.store.record(n)!.status, 'completed');
      expect(() => s.store.setField(n, 'data.vitals.pulse', 98), throwsA(isA<RecordLocked>()));

      expect(s.store.reopenNote(n, definition(testMedical)), ReopenEffect.apply);
      final reopen = s.store.outbox().single;
      expect([reopen.op, reopen.field, reopen.value], ['set', 'status', 'draft']);
      expect(s.store.localEffect(n), isNull);
      expect(s.store.record(n)!.status, 'draft');
      // A draft again: the author changes it.
      s.store.setField(n, 'data.vitals.pulse', 98);
      await sync(s);
      expect(s.store.outbox(), isEmpty);
      expect(
        [server.records[n]!.fields['status']!.value, server.records[n]!.fields['data.vitals.pulse']!.value],
        ['draft', 98],
      );
      expect(late(), isEmpty);

      // Read again, it is completed again: a new sign-off.
      complete(s, [finishing(s, n, testMedical)], signer: student);
      await sync(s);
      expect(s.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
    });

    test('a reopen made before the sign-off is sent goes after it; Complete again waits for that sign-off', () async {
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final patient = server.seedPatient();
      final visit = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(s, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(s, visit, testMedical, {'vitals.pulse': 96});
      complete(s, [finishing(s, flags, testRedFlags), finishing(s, n, testMedical)], signer: student);
      expect(s.store.reopenNote(n, definition(testMedical)), ReopenEffect.apply);
      s.store.setField(n, 'data.vitals.pulse', 99);
      // Never two sign-offs of one note in the outbox.
      expect(() => complete(s, [finishing(s, n, testMedical)], signer: student), throwsA(isA<RecordLocked>()));
      await sync(s);
      expect(s.store.outbox(), isEmpty);
      // The server finished the note, then sent it back to draft, as the person did.
      expect(
        [
          for (final h in server.history)
            if (h['recordId'] == n && h['field'] == 'status') h['value'],
        ],
        ['draft', 'completed', 'draft'],
      );
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 99);
      expect(late(), isEmpty);
      complete(s, [finishing(s, n, testMedical)], signer: student);
      await sync(s);
      expect(s.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
    });

    test('a reopen the server would keep as it is never leaves the phone', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final signed = note(p, visit, testMedical, {'vitals.pulse': 96});
      final social = note(p, visit, testNote, {'vitals.pulse': 80});
      final draft = note(p, visit, testNote, {'vitals.pulse': 81});
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, signed, testMedical, act: SignoffAct.sign),
        finishing(p, social, testNote),
      ]);
      final before = p.store.outbox().length;
      void kept() {
        expect(() => p.store.reopenNote(signed, definition(testMedical)), throwsA(isA<RecordLocked>()));
        expect(() => p.store.reopenNote(social, definition(testNote)), throwsA(isA<RecordLocked>()));
      }

      // By the effect the phone expects, and then by the server's copy.
      kept();
      // A draft has nothing to reopen.
      expect(p.store.reopenNote(draft, definition(testNote)), ReopenEffect.nothing);
      expect(p.store.outbox(), hasLength(before));
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect([p.store.record(signed)!.status, p.store.record(social)!.status], ['signed', 'completed']);
      kept();
      // The server would keep each in history (lifecycle 4.4).
      for (final id in [signed, social]) {
        final held = server.records[id]!;
        expect(
          reopenEffect(
            noteStatus: NoteStatus.values.byName(held.fields['status']!.value! as String),
            everSigned: held.everSigned,
            medicalNote: held.medical,
            actsAsAuthor: true,
          ),
          ReopenEffect.keepInHistory,
        );
      }

      // Someone else's note waiting for a co-signer is its author's to reopen.
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final visit2 = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags2 = note(s, visit2, testRedFlags, {'flags.any': 'no'});
      final waiting = note(s, visit2, testMedical, {'vitals.pulse': 70});
      complete(s, [finishing(s, flags2, testRedFlags), finishing(s, waiting, testMedical)], signer: student);
      await sync(s);
      expect(await p.engine.openServerRecord('encounter', visit2), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', waiting), isTrue);
      expect(
        () => p.store.reopenNote(waiting, definition(testMedical)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_author')),
      );
      expect(p.store.outbox(), isEmpty);
      expect(late(), isEmpty);
    });

    test('a note can be added to any visit, its notes finished or not', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, n, testMedical, act: SignoffAct.sign),
      ]);
      // Before the sign-offs are sent, and after the server holds the visit signed.
      final early = note(p, visit, testNote, {'care.plan': 'Demo: food bank list'});
      await sync(p);
      expect(p.store.record(visit)!.status, 'draft');
      expect(server.records[early]!.fields['status']!.value, 'draft');
      server.finishNote(early);
      await sync(p);
      expect(p.store.record(visit)!.status, 'signed');
      final added = note(p, visit, testNote, {'care.plan': 'Demo: shelter referral'});
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[added]!.fields['status']!.value, 'draft');
      expect(server.records[visit]!.status, 'draft');
      // It changes nothing that was finished: the visit's envelope stays locked.
      expect(() => p.store.setField(visit, 'summary', 'Demo: later'), throwsA(isA<RecordLocked>()));
    });
  });

  group('the patient of a new record (lifecycle 4.8)', () {
    test('a sign-off, an addendum, a correction and a referral are filed under their patient', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      final addendum = p.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: called back with results',
        'signoffId': signoff,
      });
      final correction = p.store.createRecord(entityCorrection, {
        'noteId': n,
        'changes': [
          {'field': 'data.vitals.pulse', 'newValue': 86, 'baseVersion': 1},
        ],
        'reason': 'Demo: counted twice',
        'requestedByPatient': false,
        'declined': false,
        'claimedCredential': null,
        'signoffId': signoff,
      });
      final referral = p.store.createRecord(entityReferral, {
        'patientId': patient,
        'referredOn': '2026-10-20',
        'details': 'Demo: shelter intake',
        'encounterId': visit,
      });
      final made = [signoff, addendum, correction, referral];
      for (final id in made) {
        expect([p.store.record(id)!.patientId, createOf(p, id).patientId], [patient, patient], reason: id);
      }
      expect(p.store.recordIdsOfPatient(patient), containsAll(made));
      expect(p.store.localWorkPatients(), {patient});
      expect(p.store.scopes().single.patientId, patient);

      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[correction]!.status, 'corrected');
      expect(server.records[referral]!.attributes['encounterId'], visit);
    });

    test('records made at a visit with no patient are filed under the patient it is given', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      final addendum = p.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: name given later',
        'signoffId': signoff,
      });
      for (final id in [signoff, addendum]) {
        expect([p.store.record(id)!.patientId, createOf(p, id).patientId], [null, null]);
      }
      expect(p.store.localWorkPatients(), isEmpty);

      p.store.setField(visit, 'patientId', patient);
      for (final id in [signoff, addendum]) {
        expect([p.store.record(id)!.patientId, createOf(p, id).patientId], [patient, patient], reason: id);
      }
      expect(p.store.recordIdsOfPatient(patient), containsAll([signoff, addendum]));
      expect(p.store.localWorkPatients(), {patient});
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[visit]!.fields['patientId']!.value, patient);
      expect(server.records[n]!.fields['status']!.value, 'completed');
    });

    test('a refused visit fixed with a patient files what was made at it under them', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical');
      final refused = p.store.outbox().single;
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      p.store.reject(refused, reason: 'validation');
      expect(p.store.record(signoff)!.patientId, isNull);
      p.store.fixRejected(refused.changeId, {'kind': 'non_medical', 'patientId': patient});
      expect([p.store.record(signoff)!.patientId, createOf(p, signoff).patientId], [patient, patient]);
      expect(p.store.localWorkPatients(), {patient});
    });

    test('a patient a teammate gives the visit files what waits here under them', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      server.serverEdit(visit, 'patientId', patient, by: blair);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect([p.store.record(signoff)!.patientId, createOf(p, signoff).patientId], [patient, patient]);
      expect(p.store.localWorkPatients(), {patient});
    });

    test('a sign-off, an addendum and a correction opened from the server are filed under their patient', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final visit = b.store.createEncounter(kind: 'non_medical', patientId: patient);
      final n = note(b, visit, testNote, {'vitals.pulse': 88});
      await sync(b);
      final signoff = complete(b, [finishing(b, n, testNote)])[n]!.signoffId;
      final addendum = b.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: seen again at noon',
        'signoffId': signoff,
      });
      await sync(b);
      expect(b.store.outbox(), isEmpty);

      final p = phone(alex);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', n), isTrue);
      for (final (entity, id) in [('note_signoff', signoff), ('note_addendum', addendum)]) {
        expect(await p.engine.openServerRecord(entity, id), isTrue, reason: entity);
        expect(p.store.record(id)!.patientId, patient, reason: entity);
      }
    });
  });
}
