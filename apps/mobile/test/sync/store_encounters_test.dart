import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/features/sync/sync_labels.dart' show noticeLabel;
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/patients/patient_providers.dart' show ServerNotices;
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entityCorrection, entityReferral, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'fake_server.dart';
import 'phone_harness.dart';
import 'test_note_types.dart';

/// The phone's store in phase 4 (lifecycle 4.8): the visit as the server keeps it, Complete
/// (`finishNotes`), the lock that follows a note's effect, the patient of a new record, and what a
/// sign-off's receipt settles, a sign-off held for review and its notice among them (4.6). Each
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

    test('a visit’s kind never goes back from Medical, and its patient is never removed: refused here', () async {
      // The coordinator's decision: the server keeps either change in history with no notice, so the
      // person would believe it made.
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      await sync(p);
      final before = p.store.outbox().length;
      Matcher problem(String code) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', code));
      expect(() => p.store.setField(visit, 'kind', 'non_medical'), problem('kind_cannot_go_back'));
      expect(() => p.store.setField(visit, 'patientId', null), problem('patient_cannot_be_removed'));
      expect(p.store.outbox(), hasLength(before));
      expect(
        [p.store.record(visit)!.fields['kind']!.value, p.store.record(visit)!.fields['patientId']!.value],
        ['medical', patient],
      );
      // A Non-Medical visit still goes to Medical, and one with no patient is given one.
      final other = p.store.createEncounter(kind: 'non_medical');
      p.store
        ..setField(other, 'kind', 'medical')
        ..setField(other, 'patientId', patient);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(late(), isEmpty);
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

    test(
      'a refused sign-off of a note finished since is fixed all the same: the server stores it with no effect',
      () async {
        // Review finding SFN-1: the store refused Complete of a finished note, so a sign-off refused on
        // one phone, for a note the same person then finished on another, waited in Needs attention for
        // good. The coordinator's decision: its fix is sent anyway, and settles the refusal.
        final a = phone(alex);
        final visit = a.store.createEncounter(kind: 'non_medical');
        final n = note(a, visit, testNote, {'vitals.pulse': 88});
        await sync(a);
        final b = phone(alex);
        expect(await b.engine.openServerRecord('encounter', visit), isTrue);
        expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
        complete(a, [finishing(a, n, testNote)]);
        b.store.setField(n, 'data.vitals.pulse', 90);
        await sync(b);
        await sync(a);
        final refused = a.store.needsAttention().single;
        expect([refused.entity, refused.details?['problem']], [entitySignoff, 'content_changed']);
        complete(b, [finishing(b, n, testNote)]);
        await sync(b);
        await sync(a);
        expect(a.store.noteState(n)!.status, NoteStatus.completed);

        // Complete again: nothing is expected of it, and what is sent is the fix of the refused one.
        expect(complete(a, [finishing(a, n, testNote)]), isEmpty);
        expect(a.store.localEffect(n), isNull);
        final fix = signoffs(a).single;
        expect([fix.recordId, fix.supersedes, fix.state], [refused.recordId, refused.changeId, ChangeState.pending]);
        await sync(a);
        expect(a.store.outbox(), isEmpty);
        expect(a.store.needsAttention(), isEmpty);
        expect(server.records[fix.recordId]!.status, 'none');
        expect(a.store.noteState(n)!.status, NoteStatus.completed);
        // It saw what was finished, so there is nothing to read again.
        expect(a.store.notices(), isEmpty);
        // A note finished with no refusal waiting is not completed twice.
        expect(() => complete(a, [finishing(a, n, testNote)]), throwsA(isA<RecordLocked>()));
      },
    );

    test(
      'a refused sign-off of a note then removed is settled by completing it: an empty draft changes nothing',
      () async {
        // Review finding SFN-7, as the coordinator decided (signoffEffect's `empty`): Remove this note
        // blanks the answers (lifecycle 9.4), and the refusal is settled at the next sync.
        final p = phone(alex);
        final visit = p.store.createEncounter(kind: 'non_medical');
        final n = note(p, visit, testNote, {'vitals.pulse': 88});
        await sync(p);
        server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
        complete(p, [finishing(p, n, testNote)]);
        await sync(p);
        final refused = p.store.needsAttention().single;
        expect(answersOf(p, n), {'vitals.pulse': 88, 'care.plan': 'Demo: shelter tonight'});
        for (final field in ['data.vitals.pulse', 'data.care.plan']) {
          p.store.setField(n, field, null);
        }
        expect(complete(p, [finishing(p, n, testNote)]), isEmpty);
        expect(p.store.localEffect(n), isNull);
        expect(signoffs(p).single.recordId, refused.recordId);
        await sync(p);
        expect(p.store.outbox(), isEmpty);
        expect(p.store.needsAttention(), isEmpty);
        expect(server.records[refused.recordId]!.status, 'none');
        expect([server.records[n]!.fields['status']!.value, p.store.noteState(n)!.status], ['draft', NoteStatus.draft]);
        expect(p.store.notices(), isEmpty);
      },
    );

    test('an empty draft with no refusal to settle is not completed', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, const {});
      final before = p.store.outbox().length;
      expect(
        () => complete(p, [finishing(p, n, testNote)]),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'empty')),
      );
      expect(p.store.outbox(), hasLength(before));
    });

    test('a refused note fixed while its sign-off waits behind it is still finished here', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      await sync(p);
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final create = p.store.outbox().single;
      final expected = complete(p, [finishing(p, n, testNote)])[n]!;
      // Refused once Complete was made (a refusal waiting already stops Complete, 3.3 hard stop 2).
      p.store.reject(create, reason: 'validation', details: {'problem': 'unknown_note_type'});
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

    test(
      'a Red flags note finished by an earlier Complete, not synced yet, lets the visit’s Medical notes be signed',
      () async {
        // Review finding SFN-2: nothing held that the Red flags note finished here counts.
        final p = phone(alex);
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
        final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
        final n = note(p, visit, testMedical, {'vitals.pulse': 96});
        complete(p, [finishing(p, flags, testRedFlags, act: SignoffAct.sign)]);
        complete(p, [finishing(p, n, testMedical, act: SignoffAct.sign)]);
        await sync(p);
        expect(p.store.outbox(), isEmpty);
        expect(
          [server.records[flags]!.fields['status']!.value, server.records[n]!.fields['status']!.value],
          ['signed', 'signed'],
        );
      },
    );

    test('a sign-off the server would refuse whatever it is sent with is never made', () async {
      // Review finding SFN-2: a value the registry refuses (a statement version of other characters)
      // would be refused each time Complete sends it again.
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final before = p.store.outbox().length;
      final bad = NoteToFinish(
        noteId: n,
        shownHash: drawn(p, n, testNote),
        act: SignoffAct.complete,
        statementVersion: 'Complete, 2026!',
      );
      expect(
        () => p.store.finishNotes([bad], signer: attending, definitionOf: definitionOf),
        throwsA(isA<LocalValidationError>()),
      );
      expect(p.store.outbox(), hasLength(before));
      expect(p.store.localEffect(n), isNull);
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

    test(
      'an answer Complete dropped still reaches the server’s history when the note’s refused create is fixed',
      () async {
        // Review finding SFN-5: the fixed create was rebuilt from the phone's copy, which Complete had
        // left without the answer, so the server never saw it and kept no history of it.
        final p = phone(alex);
        final visit = p.store.createEncounter(kind: 'non_medical');
        await sync(p);
        final n = note(p, visit, testNote, {'vitals.pulse': 88, 'more.detail': 'Demo: slept outside'});
        p.store.setField(n, 'data.more.none', true);
        complete(p, [finishing(p, n, testNote)]);
        expect(answersOf(p, n), {'vitals.pulse': 88, 'more.none': true});
        // The server refuses the note's create (the sign-off waits behind it), and the person fixes it.
        final create = createOf(p, n);
        p.store.reject(create, reason: 'validation', details: {'problem': 'unknown_note_type'});
        p.store.fixRejected(create.changeId, {
          'encounterId': visit,
          'noteTypeKey': testNote.key,
          'noteTypeVersion': testNote.version,
        });
        expect(answersOf(p, n), {'vitals.pulse': 88, 'more.none': true});
        await sync(p);
        await sync(p);
        expect(p.store.outbox(), isEmpty);
        expect(server.records[n]!.fields['status']!.value, 'completed');
        expect(
          [
            for (final h in server.history)
              if (h['recordId'] == n && h['field'] == 'data.more.detail') (h['value'], h['previous']),
          ],
          [('Demo: slept outside', null), (null, 'Demo: slept outside')],
        );
      },
    );

    test('Complete waits while anything about the visit or its notes waits in Needs attention', () async {
      // Review finding SLK-4 (3.3 hard stop 2): Complete dropped the answer whose refusal waited, so
      // its fix went with base version 0 and conflicted with the person's own value, and the sign-off
      // covered a note without it.
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      p.store.setField(n, 'data.vitals.pulse', 'fast');
      await sync(p);
      final refused = p.store.needsAttention().single;
      expect(refused.field, 'data.vitals.pulse');
      final before = p.store.outbox().length;
      Matcher waits() => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'needs_attention'));
      expect(() => complete(p, [finishing(p, n, testNote)]), waits());
      // Another note of the same visit waits on it too.
      final other = note(p, visit, testNote, {'care.plan': 'Demo: rest'});
      expect(() => complete(p, [finishing(p, other, testNote)]), waits());
      expect(p.store.outbox(), hasLength(before + 1));
      expect([p.store.localEffect(n), p.store.localEffect(other)], [null, null]);
      // Fixed, the visit's notes complete.
      p.store.fixRejected(refused.changeId, 90);
      await sync(p);
      expect(p.store.needsAttention(), isEmpty);
      complete(p, [finishing(p, n, testNote), finishing(p, other, testNote)]);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 90);
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(late(), isEmpty);
    });

    test('a refused sign-off of a note being completed does not hold Complete up; another of the visit does', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final a = note(p, visit, testNote, {'vitals.pulse': 88});
      final b = note(p, visit, testNote, {'vitals.pulse': 70});
      await sync(p);
      server
        ..serverEdit(a, 'data.care.plan', 'Demo: shelter tonight', by: blair)
        ..serverEdit(b, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, a, testNote), finishing(p, b, testNote)]);
      await sync(p);
      expect(p.store.needsAttention(), hasLength(2));
      // b's refusal waits in Needs attention while a is completed alone.
      expect(
        () => complete(p, [finishing(p, a, testNote)]),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'needs_attention')),
      );
      complete(p, [finishing(p, a, testNote), finishing(p, b, testNote)]);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
    });

    test('a visit whose create was refused is fixed before its notes are completed', () async {
      // Review finding SFN-6: fixed with a patient after Complete, the visit reached the server ahead
      // of the sign-off, whose hash had no patient, so it was refused.
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical');
      final create = p.store.outbox().single;
      p.store.reject(create, reason: 'validation');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      expect(
        () => complete(p, [finishing(p, n, testNote)]),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'needs_attention')),
      );
      p.store.fixRejected(create.changeId, {'kind': 'non_medical', 'patientId': patient});
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'completed');
    });

    test('the fix of a refused answer whose row is gone builds on the version the person saw', () async {
      // Review finding SLK-4: an earlier Complete could leave a refused answer with no row here; its
      // fix read version 0 from the missing row and conflicted with the person's own value.
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      p.store.setField(n, 'data.vitals.pulse', 'fast');
      await sync(p);
      final refused = p.store.needsAttention().single;
      expect(refused.baseVersion, 1);
      p.store.database.execute('DELETE FROM fields WHERE record_id = ? AND field = ?', [n, 'data.vitals.pulse']);
      p.store.fixRejected(refused.changeId, 90);
      expect(p.store.sendable().single.baseVersion, 1);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 90);
    });

    test('a sign-off is made and fixed only by Complete', () async {
      // Review finding SFN-3: createRecord took a sign-off, with any hash and no effect expected, and
      // the outbox held two sign-offs of one note.
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      final refused = p.store.needsAttention().single;
      final value = <String, Object?>{
        'noteId': n,
        'act': 'complete',
        'contentHash': 'f' * 64,
        'claimedCredential': null,
        'statementVersion': 'complete-2026-11',
      };
      final before = p.store.outbox().length;
      expect(() => p.store.createRecord(entitySignoff, value), throwsArgumentError);
      expect(() => p.store.fixRejected(refused.changeId, value), throwsArgumentError);
      expect(() => p.store.replaceRejected(refused.changeId, entity: entitySignoff, value: value), throwsArgumentError);
      expect(p.store.outbox(), hasLength(before));
      expect(p.store.entry(refused.changeId)!.state, ChangeState.rejected);
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

    test('a visit with a finished note beside a teammate’s draft is locked here, as the server says', () async {
      // Review finding SLK-1: the visit's status is a draft while any note that counts is, so the
      // phone took the envelope for unlocked; the server kept each edit in history and told the signer.
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      p.store.setField(visit, 'summary', 'Demo: well');
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, n, testMedical, act: SignoffAct.sign),
      ]);
      await sync(p);
      // A teammate adds a note to the signed visit (4.4), and syncs: the visit is a draft again.
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      note(b, visit, testNote, {'care.plan': 'Demo: shelter'});
      await sync(b);
      expect([server.records[visit]!.status, b.store.record(visit)!.status], ['draft', 'draft']);
      expect(b.store.record(visit)!.attributes['hasFinishedNote'], isTrue);
      final before = b.store.outbox().length;
      for (final (field, value) in [('summary', 'Demo: teammate changed it'), ('locationText', 'Demo: north lot')]) {
        expect(() => b.store.setField(visit, field, value), throwsA(isA<RecordLocked>()), reason: field);
      }
      expect(b.store.outbox(), hasLength(before));
      await sync(b);
      expect(late(), isEmpty);
    });

    test('the signer’s own phone keeps the visit locked once its finished notes have left it', () async {
      // Review finding SLK-1 on the phone that signed: its notes are closed and purged after Complete
      // (8.2), and a teammate's draft keeps the visit's status a draft.
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      await sync(p);
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      note(b, visit, testNote, {'care.plan': 'Demo: shelter'});
      await sync(b);
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, n, testMedical, act: SignoffAct.sign),
      ]);
      await sync(p);
      p.store
        ..closeRecord(flags)
        ..closeRecord(n);
      expect([p.store.record(flags), p.store.record(n)], [isNull, isNull]);
      await sync(p);
      expect(p.store.record(visit)!.status, 'draft');
      expect(() => p.store.setField(visit, 'summary', 'Demo: later'), throwsA(isA<RecordLocked>()));
      // A blank is still filled, and the kind still goes to Medical (3.1, 3.10): nothing here was signed.
      expect(p.store.outbox(), isEmpty);
      await sync(p);
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

    test('an assignment the refresh brings moves who reopens and completes a note to the assignee', () async {
      // Review findings SLK-3 and SRC-7: who acts as the author (actingAuthorId, lifecycle 3.8) had no
      // test. Read as the note's author, the removed author's phone sent a reopen the server stores
      // with no effect, and the assignee's refused a reopen and a Complete the server applies.
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final patient = server.seedPatient();
      final visit = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(s, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(s, visit, testMedical, {'vitals.pulse': 96});
      final draft = note(s, visit, testMedical, {'vitals.pulse': 90});
      complete(s, [finishing(s, flags, testRedFlags), finishing(s, n, testMedical)], signer: student);
      await sync(s);
      // Blair has left; a Program Admin hands her notes to Carol (5.5), and the refresh brings it.
      for (final id in [n, draft]) {
        server.records[id]!.assignedTo = carol;
      }
      await sync(s);
      expect(
        [s.store.record(n)!.attributes['actingAuthorId'], s.store.record(draft)!.attributes['actingAuthorId']],
        [carol, carol],
      );
      Matcher notAuthor() => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_author'));
      final before = s.store.outbox().length;
      expect(() => s.store.reopenNote(n, definition(testMedical)), notAuthor());
      expect(() => complete(s, [finishing(s, draft, testMedical)], signer: student), notAuthor());
      expect(s.store.outbox(), hasLength(before));

      // Carol reopens the one and signs the other, and the server applies both.
      final c = phone(carol);
      expect(await c.engine.openServerRecord('encounter', visit), isTrue);
      for (final id in [flags, n, draft]) {
        expect(await c.engine.openServerRecord('encounter_note', id), isTrue);
      }
      expect(c.store.reopenNote(n, definition(testMedical)), ReopenEffect.apply);
      complete(c, [finishing(c, draft, testMedical, act: SignoffAct.sign)]);
      await sync(c);
      expect(c.store.outbox(), isEmpty);
      expect(
        [server.records[n]!.fields['status']!.value, server.records[draft]!.fields['status']!.value],
        ['draft', 'signed'],
      );
      expect(late(), isEmpty);
    });

    test('a note signed once and completed since is not reopened: the server keeps that in history', () async {
      // The coordinator's decision: everSigned joins a note's snapshot. A student's note co-signed and
      // then corrected by the student is completed again, never signed now, and was signed once
      // (lifecycle 3.6): the server keeps its reopen in history, and every edit made offline after it.
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final patient = server.seedPatient();
      final visit = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(s, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(s, visit, testMedical, {'vitals.pulse': 96});
      complete(s, [finishing(s, flags, testRedFlags), finishing(s, n, testMedical)], signer: student);
      await sync(s);
      server.cosign(n, by: alex);
      server.records[n]!
        ..signoffId = null
        ..attestation = 'not_needed';
      server.finishNote(n, status: 'completed');
      await sync(s);
      expect(s.store.record(n)!.attributes['everSigned'], isTrue);
      expect(s.store.noteState(n), (
        status: NoteStatus.completed,
        attestation: Attestation.notNeeded,
        sentForReview: false,
      ));
      final before = s.store.outbox().length;
      expect(() => s.store.reopenNote(n, definition(testMedical)), throwsA(isA<RecordLocked>()));
      expect(s.store.outbox(), hasLength(before));
      await sync(s);
      expect(late(), isEmpty);
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

    test('what was filed under a patient filled here moves when the visit ends up with another', () async {
      // Review finding SFN-4: only records with no patient were filed, so a patient filled here that
      // lost to a teammate's left the sign-off and the addendum, and their waiting changes, under it.
      final p = phone(alex);
      final x = server.seedPatient();
      final y = server.seedPatient(preferredName: 'Demo Other');
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      final addendum = p.store.createRecord(entityAddendum, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: called back later',
        'signoffId': signoff,
      });
      p.store.setField(visit, 'patientId', x);
      expect([p.store.record(signoff)!.patientId, p.store.record(addendum)!.patientId], [x, x]);
      // A teammate filled it first: the person keeps theirs.
      server.serverEdit(visit, 'patientId', y, by: blair);
      await sync(p);
      final conflict = p.store.needsAttention().singleWhere((e) => e.state == ChangeState.conflict);
      expect(conflict.field, 'patientId');
      p.store.resolveConflict(conflict.changeId, keepMine: false);
      expect(p.store.record(visit)!.fields['patientId']!.value, y);
      expect([p.store.record(signoff)!.patientId, p.store.record(addendum)!.patientId], [y, y]);
      expect(
        {
          for (final e in p.store.outbox())
            if (e.state != ChangeState.superseded && (e.recordId == signoff || e.recordId == addendum)) e.patientId,
        },
        {y},
      );
      await sync(p);
      expect(p.store.localWorkPatients(), isNot(contains(x)));
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

  group('receipts settle the effect (lifecycle 4.6, 4.8)', () {
    ({NoteStatus status, Attestation attestation, bool sentForReview}) state(
      NoteStatus status, [
      Attestation attestation = Attestation.notNeeded,
      bool sentForReview = false,
    ]) => (status: status, attestation: attestation, sentForReview: sentForReview);

    /// Only the push: what the receipt itself settles, before any refresh of the note.
    Future<void> push(TestPhone p) async => expect(await p.engine.syncOnce(force: true), isA<SyncDone>());

    test('a confirmed sign-off settles its note: the status and attestation the receipt gives', () async {
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

      await push(p);
      expect(p.store.outbox(), isEmpty);
      for (final id in [flags, n]) {
        final rec = p.store.record(id)!;
        expect(p.store.localEffect(id), isNull, reason: id);
        expect(
          [rec.status, rec.fields['status']!.value, rec.attributes['attestation']],
          ['signed', 'signed', 'waiting'],
        );
        expect(p.store.noteState(id), state(NoteStatus.signed, Attestation.waiting));
      }
      // Settled, it is locked as the server holds it.
      expect(() => p.store.setField(n, 'data.vitals.pulse', 98), throwsA(isA<RecordLocked>()));

      // What happens to it online afterwards reaches the phone with the refresh of the note.
      server.attest(n, by: carol);
      await sync(p);
      expect(p.store.noteState(n), state(NoteStatus.signed, Attestation.attested));
      expect(p.store.noteState(flags), state(NoteStatus.signed, Attestation.waiting));
    });

    test('the server decided otherwise: its receipt corrects what the phone showed', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(p, visit, testMedical, {'vitals.pulse': 96});
      await sync(p);
      // The credential was lowered while the phone was offline; its saved profile still signs.
      server.changeCredential(alex, 'student');
      serverTime = serverTime.add(const Duration(minutes: 1));
      p.advance(const Duration(minutes: 1));
      complete(p, [
        finishing(p, flags, testRedFlags, act: SignoffAct.sign),
        finishing(p, n, testMedical, act: SignoffAct.sign),
      ]);
      expect(p.store.noteState(n), state(NoteStatus.signed));

      await push(p);
      expect(server.records[n]!.fields['status']!.value, 'completed');
      expect(p.store.localEffect(n), isNull);
      expect(p.store.noteState(n), state(NoteStatus.completed));
      expect(p.store.record(n)!.status, 'completed');
      // "It was saved unsigned for a co-signer": the server's own notice says so.
      expect(server.notices.where((x) => x.kind == 'note_saved_unsigned' && x.recordId == n), hasLength(1));
    });

    test('the note takes the attestation the receipt gives, not the one the phone expected', () async {
      // Review finding SRC-6: the phone's profile still says attending, and the credential was lowered
      // to resident while it was offline. A resident's signature waits for attestation.
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      await sync(p);
      server.changeCredential(alex, 'resident');
      serverTime = serverTime.add(const Duration(minutes: 1));
      p.advance(const Duration(minutes: 1));
      final expected = complete(p, [finishing(p, flags, testRedFlags, act: SignoffAct.sign)])[flags]!;
      expect([expected.status, expected.attestation], [NoteStatus.signed, Attestation.notNeeded]);
      await push(p);
      expect(p.store.noteState(flags), state(NoteStatus.signed, Attestation.waiting));
      expect(p.store.record(flags)!.attributes['attestation'], 'waiting');
    });

    test('a sign-off stored with no effect, its receipt saying nothing of the hash, tells nothing to read', () async {
      // Review finding SRC-7: hashMatches goes only to whoever acts as the author (4.6); with none, no
      // notice says the note was finished differently.
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      complete(p, [finishing(p, n, testNote)]);
      p.store.confirm(
        signoffs(p).single,
        serverVersion: 1,
        details: const {
          'effect': 'none',
          'reason': 'already_finished',
          'status': 'completed',
          'attestation': 'not_needed',
        },
      );
      expect(p.store.notices(), isEmpty);
      expect(p.store.noteState(n), state(NoteStatus.completed));
    });

    test('a reopen made after the sign-off keeps the note a draft when the sign-off’s receipt comes', () async {
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final patient = server.seedPatient();
      final visit = s.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(s, visit, testRedFlags, {'flags.any': 'no'});
      final n = note(s, visit, testMedical, {'vitals.pulse': 96});
      complete(s, [finishing(s, flags, testRedFlags), finishing(s, n, testMedical)], signer: student);
      expect(s.store.reopenNote(n, definition(testMedical)), ReopenEffect.apply);
      await push(s);
      expect(s.store.outbox(), isEmpty);
      expect(server.records[n]!.fields['status']!.value, 'draft');
      expect([s.store.record(n)!.status, s.store.record(n)!.fields['status']!.value], ['draft', 'draft']);
      expect(s.store.noteState(n), state(NoteStatus.draft));
      expect(s.store.noteState(flags), state(NoteStatus.completed));
    });

    test(
      'a sign-off stored with no effect: the note is as the server holds it; another hash says to read it',
      () async {
        final a = phone(alex);
        final visit = a.store.createEncounter(kind: 'non_medical');
        final same = note(a, visit, testNote, {'vitals.pulse': 70});
        final changed = note(a, visit, testNote, {'vitals.pulse': 88});
        await sync(a);
        // The same person's second phone holds both notes as they were.
        final b = phone(alex);
        expect(await b.engine.openServerRecord('encounter', visit), isTrue);
        for (final id in [same, changed]) {
          expect(await b.engine.openServerRecord('encounter_note', id), isTrue);
        }
        a.store.setField(changed, 'data.vitals.pulse', 90);
        complete(a, [finishing(a, same, testNote), finishing(a, changed, testNote)]);
        await sync(a);
        // The second phone completes them too, from what it showed. Read again before its sign-offs
        // go, the note is finished there already, and still waits for this phone's receipt here.
        final expected = complete(b, [finishing(b, same, testNote), finishing(b, changed, testNote)]);
        expect(await b.engine.openServerRecord('encounter_note', changed), isTrue);
        expect(b.store.localEffect(changed)?.toJson(), expected[changed]!.toJson());
        await push(b);
        expect(b.store.outbox(), isEmpty);
        for (final id in [same, changed]) {
          expect(b.store.localEffect(id), isNull, reason: id);
          expect(b.store.noteState(id), state(NoteStatus.completed), reason: id);
        }
        // Finished from what the other phone showed, not this one: the person reads what was finished.
        final told = b.store.notices().single;
        expect([told.kind, told.recordId], [noticeFinishedDifferently, changed]);
        expect(
          noticeLabel(told.kind, told.field),
          'This note was already finished with different content. Open it and read what was finished.',
        );
        expect(a.store.notices(), isEmpty);
      },
    );

    test('a refused sign-off clears the effect: the note is a draft again, the refusal in Needs attention', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      await sync(p);
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      expect(p.store.noteState(n), state(NoteStatus.completed));

      await push(p);
      expect(p.store.localEffect(n), isNull);
      expect(p.store.noteState(n), state(NoteStatus.draft));
      final refused = p.store.needsAttention().single;
      expect([refused.entity, refused.details?['problem']], [entitySignoff, 'content_changed']);
      // A draft here again: the person changes it, and Complete again is the refusal's fix.
      p.store.setField(n, 'data.vitals.pulse', 86);
      await sync(p);
      complete(p, [finishing(p, n, testNote)]);
      expect(p.store.entry(refused.changeId)!.state, ChangeState.superseded);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(p.store.noteState(n), state(NoteStatus.completed));
    });

    /// [alex]'s Red flags note, completed while their credential was lowered on the server (the
    /// phone's profile didn't know): the Medical gate holds the sign-off for a Program Admin (4.2).
    Future<({TestPhone p, String patient, String visit, String flags, OutboxEntry held, LocalEffect expected})>
    heldForReview() async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
      await sync(p);
      server.changeCredential(alex, 'chw');
      final expected = complete(p, [finishing(p, flags, testRedFlags)])[flags]!;
      final held = signoffs(p).single;
      await sync(p);
      expect(server.held.containsKey(held.changeId), isTrue);
      return (p: p, patient: patient, visit: visit, flags: flags, held: held, expected: expected);
    }

    test(
      'a sign-off held for review keeps its effect: the note says Sent for review and stays as it was sent',
      () async {
        final (:p, patient: _, :visit, :flags, :held, :expected) = await heldForReview();
        expect(p.store.outbox(), isEmpty);
        expect(p.store.inReviewCount(), 1);
        expect(p.store.localEffect(flags)?.toJson(), expected.toJson());
        expect(p.store.sentForReview(flags), isTrue);
        expect(p.store.noteState(flags), state(NoteStatus.completed, Attestation.notNeeded, true));
        // The server's copy is a draft until a Program Admin decides.
        expect(p.store.record(flags)!.status, 'draft');
        expect(server.records[flags]!.fields['status']!.value, 'draft');

        // Nothing changes it, finishes it again or sends it back meanwhile: what the admin applies is
        // what the person completed.
        expect(() => p.store.setField(flags, 'data.flags.any', 'yes'), throwsA(isA<RecordLocked>()));
        expect(() => complete(p, [finishing(p, flags, testRedFlags)]), throwsA(isA<RecordLocked>()));
        expect(() => p.store.reopenNote(flags, definition(testRedFlags)), throwsA(isA<RecordLocked>()));
        expect(() => p.store.setField(visit, 'summary', 'Demo: later'), throwsA(isA<RecordLocked>()));
        expect(p.store.outbox(), isEmpty);
        await sync(p);
        expect(p.store.sentForReview(flags), isTrue);
      },
    );

    test('a held sign-off a Program Admin accepts: the next refresh finds the note finished and settles it', () async {
      final (:p, patient: _, :visit, :flags, :held, expected: _) = await heldForReview();
      server.acceptHeld(held.changeId);
      expect(server.records[flags]!.fields['status']!.value, 'completed');
      await sync(p);
      expect(p.store.localEffect(flags), isNull);
      expect(p.store.sentForReview(flags), isFalse);
      expect(p.store.noteState(flags), state(NoteStatus.completed));
      expect(() => p.store.setField(flags, 'data.flags.any', 'yes'), throwsA(isA<RecordLocked>()));
      expect(p.store.record(visit)!.status, 'completed');
      // Settled: a later notice about the note is about something else.
      final later = p.store.addNotice(noticeChangeNotApplied, recordId: flags);
      expect(p.store.notices().singleWhere((n) => n.id == later).kind, noticeChangeNotApplied);
    });

    test('a held sign-off a Program Admin rejects: its notice makes the note a draft to complete again', () async {
      final (:p, :patient, :visit, :flags, :held, expected: _) = await heldForReview();
      final notices = ServerNotices(p.store, p.engine.api);
      server.rejectHeld(held.changeId);
      await notices.sync();
      // It names the sign-off that was held, and is worded by its kind alone.
      final told = p.store.notices().single;
      expect([told.kind, told.recordId, told.patientId], [noticeSignoffNotApplied, held.recordId, patient]);
      expect(
        noticeLabel(told.kind, told.field),
        'Your Complete of this note wasn’t applied. Open it and complete it again.',
      );
      expect(p.store.localEffect(flags), isNull);
      expect(p.store.sentForReview(flags), isFalse);
      expect(p.store.noteState(flags), state(NoteStatus.draft));
      // It is told once: a later notice about the note is about something else.
      final later = p.store.addNotice(noticeChangeNotApplied, recordId: flags);
      expect(p.store.notices().singleWhere((n) => n.id == later).kind, noticeChangeNotApplied);
      p.store.markNoticeRead(later);

      // A draft here: the person reads it, changes it and completes it again, which answers the notice.
      server.changeCredential(alex, 'attending');
      p.store.setField(flags, 'data.flags.any', 'yes');
      complete(p, [finishing(p, flags, testRedFlags)]);
      expect(p.store.notices(unreadOnly: true), isEmpty);
      await sync(p);
      expect(p.store.outbox(), isEmpty);
      expect(server.records[flags]!.fields['status']!.value, 'completed');
      expect(p.store.noteState(flags), state(NoteStatus.completed));
      expect(p.store.record(visit)!.status, 'completed');
    });

    test('held again and refused at the accept: the second sign-off is told on its own', () async {
      final (:p, patient: _, visit: _, :flags, :held, expected: _) = await heldForReview();
      final notices = ServerNotices(p.store, p.engine.api);
      server.rejectHeld(held.changeId);
      await notices.sync();
      // Completed again with the credential still lowered: held again.
      complete(p, [finishing(p, flags, testRedFlags)]);
      final again = signoffs(p).single;
      expect(again.recordId, isNot(held.recordId));
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);
      // The read made here reaches the server.
      await notices.sync();
      expect(server.notices.single.readAt, isNotNull);

      // A teammate's change reaches the note first, so the accept is refused (content_changed).
      server.serverEdit(flags, 'data.flags.any', 'yes', by: blair);
      expect((server.acceptHeld(again.changeId)['details']! as Map<String, Object?>)['problem'], 'content_changed');
      await notices.sync();
      expect(
        [for (final n in p.store.notices(unreadOnly: true)) (n.kind, n.recordId)],
        [(noticeSignoffNotApplied, again.recordId)],
      );
      expect(p.store.sentForReview(flags), isFalse);
      // The next sync brings the teammate's answer to the draft.
      await sync(p);
      expect(answersOf(p, flags), {'flags.any': 'yes'});
      expect(p.store.noteState(flags), state(NoteStatus.draft));
    });

    test('a note that left the phone while sent for review: its notice still says to complete it again', () async {
      final (:p, patient: _, :visit, :flags, :held, expected: _) = await heldForReview();
      p.store
        ..closeRecord(flags)
        ..closeRecord(visit);
      expect(p.store.record(flags), isNull);
      server.rejectHeld(held.changeId);
      await ServerNotices(p.store, p.engine.api).sync();
      expect(
        [p.store.notices().single.kind, p.store.notices().single.recordId],
        [noticeSignoffNotApplied, held.recordId],
      );
      // Fetched again, it is a draft to complete.
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', flags), isTrue);
      expect(p.store.noteState(flags), state(NoteStatus.draft));
    });

    test('held twice and rejected twice before the first notice’s read reached the server: a draft again', () async {
      // Review finding SRC-1: told by note, the second reject told nobody while the first notice was
      // unread on the server, and the note stayed Sent for review for good.
      final (:p, patient: _, visit: _, :flags, :held, expected: _) = await heldForReview();
      final notices = ServerNotices(p.store, p.engine.api);
      server.rejectHeld(held.changeId);
      await notices.sync();
      // Completed again, the credential still lowered: held again. The notices refresher runs at most
      // every two minutes after a sync, so the read made here has not reached the server yet.
      complete(p, [finishing(p, flags, testRedFlags)]);
      final again = signoffs(p).single;
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);
      server.rejectHeld(again.changeId);
      expect(server.notices.where((n) => n.readAt == null), hasLength(2));
      await notices.sync();
      expect(
        [for (final n in p.store.notices(unreadOnly: true)) (n.kind, n.recordId)],
        [(noticeSignoffNotApplied, again.recordId)],
      );
      expect(p.store.sentForReview(flags), isFalse);
      expect(p.store.noteState(flags), state(NoteStatus.draft));
      await sync(p);
      expect(p.store.noteState(flags), state(NoteStatus.draft));
    });

    test(
      'a phone that knows nothing of the sign-off words its notice the same: erased at sign-out, or a second phone',
      () async {
        // Review finding SRC-2: told apart by this phone's own record, the notice read "Only the note’s
        // author can do that. Nothing was changed." on any other.
        final (:p, patient: _, :visit, :flags, :held, expected: _) = await heldForReview();
        // Everything synced (the held sign-off left the outbox), so a sign-out erases the database.
        expect(p.store.hasUnsynced, isFalse);
        final fresh = phone(alex);
        expect(await fresh.engine.openServerRecord('encounter', visit), isTrue);
        expect(await fresh.engine.openServerRecord('encounter_note', flags), isTrue);
        server.rejectHeld(held.changeId);
        for (final other in [fresh, p]) {
          await ServerNotices(other.store, other.engine.api).sync();
          final told = other.store.notices().single;
          expect([told.kind, told.recordId, told.readAt], [noticeSignoffNotApplied, held.recordId, isNull]);
          expect(
            noticeLabel(told.kind, told.field),
            'Your Complete of this note wasn’t applied. Open it and complete it again.',
          );
        }
        // The sender's phone settles its own; the other had nothing to settle.
        expect(p.store.noteState(flags), state(NoteStatus.draft));
        expect(fresh.store.noteState(flags), state(NoteStatus.draft));
      },
    );

    test(
      'a phone that knows nothing of the sign-off keeps its notice with the note’s ID, as the sender’s own phone does',
      () async {
        // D104: a held sign-off is in no sync read, so a fresh database could not find the note from
        // the sign-off the notice names.
        final (:p, patient: _, visit: _, :flags, :held, expected: _) = await heldForReview();
        final fresh = phone(alex);
        server.rejectHeld(held.changeId);
        for (final other in [fresh, p]) {
          await ServerNotices(other.store, other.engine.api).sync();
          final told = other.store.notices().single;
          expect([told.kind, told.recordId, told.noteId], [noticeSignoffNotApplied, held.recordId, flags]);
        }
        // The fresh phone holds neither, keeps the notice as it came, and opens the note by it: a draft
        // to complete again.
        expect([fresh.store.record(flags), fresh.store.record(held.recordId)], [isNull, isNull]);
        final told = fresh.store.notices().single;
        expect(told.readAt, isNull);
        expect(await fresh.engine.openServerRecord('encounter_note', told.noteId!), isTrue);
        expect(fresh.store.noteState(flags), state(NoteStatus.draft));
        // The sender's phone settled its own by the sign-off's ID.
        expect(p.store.noteState(flags), state(NoteStatus.draft));
      },
    );

    test(
      'the note a notice names settles nothing: the same note held again on another phone stays Sent for review',
      () async {
        // D104: a held sign-off is settled by its own ID only. By its note, the notice of one phone's held
        // Complete would undo another's still held, as SRC-5 found of a phone's own.
        final (:p, patient: _, :visit, :flags, :held, expected: _) = await heldForReview();
        final b = phone(alex);
        expect(await b.engine.openServerRecord('encounter', visit), isTrue);
        expect(await b.engine.openServerRecord('encounter_note', flags), isTrue);
        final second = complete(b, [finishing(b, flags, testRedFlags)])[flags]!;
        await sync(b);
        expect(b.store.sentForReview(flags), isTrue);
        server.rejectHeld(held.changeId);
        for (final other in [p, b]) {
          await ServerNotices(other.store, other.engine.api).sync();
        }
        final told = b.store.notices().single;
        expect(
          [told.kind, told.recordId, told.noteId, told.readAt],
          [noticeSignoffNotApplied, held.recordId, flags, isNull],
        );
        expect(b.store.sentForReview(flags), isTrue);
        expect(b.store.localEffect(flags)?.toJson(), second.toJson());
        expect(b.store.noteState(flags), state(NoteStatus.completed, Attestation.notNeeded, true));
        expect(p.store.noteState(flags), state(NoteStatus.draft));
      },
    );

    test(
      'while a sign-off is held, the refresh brings back an answer Complete dropped, and nothing shown changes',
      () async {
        // D106's third cost (lifecycle 4.4, 4.8): until the review decides, the server's draft, and the
        // author's own sync read of it, still hold an answer Complete dropped from the phone's copy.
        final p = phone(alex);
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
        final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
        complete(p, [finishing(p, flags, testRedFlags)]);
        const details = ['Demo: slept outside', 'Demo: slept by the river'];
        final notes = [
          for (final d in details)
            note(p, visit, testMedical, {'care.plan': 'Demo: rest and fluids', 'more.detail': d}),
        ];
        await sync(p);
        // "Nothing more" hides the detail: an answer that does not count.
        for (final n in notes) {
          p.store.setField(n, 'data.more.none', true);
        }
        await sync(p);
        const counting = {'care.plan': 'Demo: rest and fluids', 'more.none': true};
        server.changeCredential(alex, 'chw');
        final shown = [for (final n in notes) finishing(p, n, testMedical)];
        complete(p, shown);
        final held = [for (final n in notes) signoffs(p).singleWhere((s) => (s.value! as Map)['noteId'] == n)];
        for (final n in notes) {
          expect(answersOf(p, n), counting);
        }
        await sync(p);
        await sync(p);
        for (final (i, n) in notes.indexed) {
          expect(p.store.sentForReview(n), isTrue);
          expect(answersOf(p, n), {...counting, 'more.detail': details[i]});
          expect(effectiveAnswers(definition(testMedical), answersOf(p, n)), counting);
          expect(p.store.contentHashOf(n, definition(testMedical)), shown[i].shownHash);
        }

        // Accepted: the server drops the detail into its history as it finishes the note. As built, the
        // refresh leaves it here, where lifecycle 4.8 expected it taken away (an open question): a
        // finished note's read gives only the answers that count, so the phone keeps the detail at the
        // version it had. Nothing shown changes.
        server.acceptHeld(held[0].changeId);
        await sync(p);
        expect(p.store.noteState(notes[0]), state(NoteStatus.completed));
        final dropped = server.records[notes[0]]!.fields['data.more.detail']!;
        expect([dropped.value, dropped.version], [null, 2]);
        expect(answersOf(p, notes[0]), {...counting, 'more.detail': details[0]});
        expect(p.store.record(notes[0])!.fields['data.more.detail']!.serverVersion, 1);
        expect(effectiveAnswers(definition(testMedical), answersOf(p, notes[0])), counting);
        // Rejected, and told: the draft is the server's, the detail with it.
        server.rejectHeld(held[1].changeId);
        await ServerNotices(p.store, p.engine.api).sync();
        await sync(p);
        expect(p.store.noteState(notes[1]), state(NoteStatus.draft));
        expect(answersOf(p, notes[1]), {...counting, 'more.detail': details[1]});
        expect(answersOf(p, notes[1]), {
          for (final MapEntry(:key, :value) in server.records[notes[1]]!.fields.entries)
            if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
        });
      },
    );

    test(
      'a held receipt lost and its notice fetched before the retry: the retried receipt settles it at once',
      () async {
        // Review finding SRC-3: the receipt sent again set the held record after its notice had come,
        // and the note stayed Sent for review for good.
        final p = phone(alex);
        final patient = server.seedPatient();
        final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
        final flags = note(p, visit, testRedFlags, {'flags.any': 'no'});
        await sync(p);
        server.changeCredential(alex, 'chw');
        complete(p, [finishing(p, flags, testRedFlags)]);
        final s = signoffs(p).single;
        // The server receives and holds it, but its answer is lost.
        server.dropPushResponses = 1;
        await sync(p);
        expect(server.held.containsKey(s.changeId), isTrue);
        expect(signoffs(p), hasLength(1));
        server.rejectHeld(s.changeId);
        await ServerNotices(p.store, p.engine.api).sync();
        expect(
          [p.store.notices().single.kind, p.store.notices().single.recordId],
          [noticeSignoffNotApplied, s.recordId],
        );
        await sync(p);
        expect(p.store.outbox(), isEmpty);
        expect(p.store.sentForReview(flags), isFalse);
        expect(p.store.noteState(flags), state(NoteStatus.draft));
        expect(p.store.notices(unreadOnly: true), hasLength(1));
      },
    );

    test(
      'a sign-off accepted after its note left the phone: a later change_not_applied about the note is its own',
      () async {
        // Review finding SRC-4: the held record outlived the accept, and gave a later notice about the
        // note the sentence of a Complete not applied.
        final (:p, patient: _, :visit, :flags, :held, expected: _) = await heldForReview();
        p.store
          ..closeRecord(flags)
          ..closeRecord(visit);
        expect(p.store.record(flags), isNull);
        server.acceptHeld(held.changeId);
        await sync(p);
        final later = p.store.addNotice(noticeChangeNotApplied, recordId: flags);
        expect(p.store.notices().singleWhere((n) => n.id == later).kind, noticeChangeNotApplied);
      },
    );

    test('a notice about a sign-off settled here already is read, and leaves a later held sign-off alone', () async {
      // Review findings SRC-5 and SRC-7: told by note, a late reject of the first held sign-off was
      // taken for the second, still held, and cleared its effect.
      final (:p, patient: _, visit: _, :flags, :held, expected: _) = await heldForReview();
      final notices = ServerNotices(p.store, p.engine.api);
      // A teammate's answer reaches the note first: the admin's accept is refused, the person told.
      server.serverEdit(flags, 'data.flags.any', 'yes', by: blair);
      expect((server.acceptHeld(held.changeId)['details']! as Map<String, Object?>)['problem'], 'content_changed');
      await notices.sync();
      expect(p.store.noteState(flags), state(NoteStatus.draft));
      await sync(p);
      // Read again and completed again; still gated, so held again.
      final second = complete(p, [finishing(p, flags, testRedFlags)])[flags]!;
      await sync(p);
      expect(p.store.sentForReview(flags), isTrue);
      // Later the reviewer rejects the first, still pending after the refused accept: the server tells
      // nobody again, and a notice naming it here would change nothing.
      server.rejectHeld(held.changeId);
      await notices.sync();
      expect(p.store.notices(), hasLength(1));
      final late = p.store.addNotice(noticeSignoffNotApplied, recordId: held.recordId);
      expect(p.store.notices().singleWhere((n) => n.id == late).readAt, isNotNull);
      expect(p.store.sentForReview(flags), isTrue);
      expect(p.store.localEffect(flags)?.toJson(), second.toJson());
      expect(p.store.noteState(flags), state(NoteStatus.completed, Attestation.notNeeded, true));
    });

    test('a held sign-off settled by the refresh: its notice, when it comes, is read and not shown', () async {
      final (:p, patient: _, visit: _, :flags, :held, expected: _) = await heldForReview();
      // The same person completes the note on another phone, as an attending again: it is finished.
      server.changeCredential(alex, 'attending');
      final b = phone(alex);
      final visitId = p.store.record(flags)!.attributes['encounterId']! as String;
      expect(await b.engine.openServerRecord('encounter', visitId), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', flags), isTrue);
      complete(b, [finishing(b, flags, testRedFlags)]);
      await sync(b);
      await sync(p);
      expect(p.store.sentForReview(flags), isFalse);
      expect(p.store.noteState(flags), state(NoteStatus.completed));
      server.rejectHeld(held.changeId);
      await ServerNotices(p.store, p.engine.api).sync();
      expect(p.store.notices(unreadOnly: true), isEmpty);
      expect(p.store.noteState(flags), state(NoteStatus.completed));
      // And the read goes to the server at the next contact.
      await ServerNotices(p.store, p.engine.api).sync();
      expect(server.notices.single.readAt, isNotNull);
    });

    test('a change_not_applied about anything else says only the author can, and leaves the note as it is', () async {
      final p = phone(alex);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      // A teammate corrects someone else's note: nothing changes, and they are told.
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      b.store.createRecord(entityCorrection, {
        'noteId': n,
        'changes': [
          {
            'field': 'data.vitals.pulse',
            'newValue': 86,
            'baseVersion': b.store.record(n)!.fields['data.vitals.pulse']!.serverVersion,
          },
        ],
        'reason': 'Demo: counted twice',
        'requestedByPatient': false,
        'declined': false,
        'claimedCredential': null,
        'signoffId': null,
      });
      await sync(b);
      await ServerNotices(b.store, b.engine.api).sync();
      final told = b.store.notices().single;
      expect([told.kind, told.recordId], [noticeChangeNotApplied, n]);
      expect(noticeLabel(told.kind, told.field), 'Only the note’s author can do that. Nothing was changed.');

      // Nor does one undo a Complete that was not held for review.
      final other = note(p, visit, testNote, {'vitals.pulse': 70});
      final expected = complete(p, [finishing(p, other, testNote)])[other]!;
      p.store.addNotice(noticeChangeNotApplied, recordId: other);
      expect(p.store.notices().single.kind, noticeChangeNotApplied);
      expect(p.store.localEffect(other)?.toJson(), expected.toJson());
    });

    test('while the clock check fails, sign-offs, addenda and corrections wait; a referral does not', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final n = note(p, visit, testNote, {'vitals.pulse': 88});
      final signoff = complete(p, [finishing(p, n, testNote)])[n]!.signoffId;
      final addendum = <String, Object?>{
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: called back with results',
        'signoffId': signoff,
      };
      final correction = <String, Object?>{
        'noteId': n,
        'changes': [
          {'field': 'data.vitals.pulse', 'newValue': 86, 'baseVersion': 1},
        ],
        'reason': 'Demo: counted twice',
        'requestedByPatient': false,
        'declined': false,
        'claimedCredential': null,
        'signoffId': signoff,
      };
      await sync(p);
      final refused = p.store.createRecord(entityAddendum, addendum);
      p.store.reject(createOf(p, refused), reason: 'validation');

      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      final before = p.store.outbox().length;
      expect(() => p.store.createRecord(entityAddendum, addendum), throwsA(isA<ChartingPaused>()));
      expect(() => p.store.createRecord(entityCorrection, correction), throwsA(isA<ChartingPaused>()));
      expect(() => p.store.fixRejected(createOf(p, refused).changeId, addendum), throwsA(isA<ChartingPaused>()));
      // A reopen is a change to a note (review findings SLK-5 and SRC-6): its time is the clock's too.
      expect(() => p.store.reopenNote(n, definition(testNote)), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), hasLength(before));
      // A referral's date is the one the person types, so it is saved as ever.
      final referral = p.store.createRecord(entityReferral, {
        'patientId': patient,
        'referredOn': '2026-10-20',
        'details': 'Demo: shelter intake',
        'encounterId': visit,
      });
      expect(p.store.outbox(), hasLength(before + 1));
      expect(createOf(p, referral).entity, entityReferral);
    });
  });
}
