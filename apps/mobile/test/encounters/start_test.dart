import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/entities.dart' show entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// Starting a visit, its notes, and switching it to Medical, on the phone (lifecycle 3.1, 3.10, 9.2
/// to 9.4; card L4-start): what the screens offer, what each writes through the store, and that the
/// server takes it. Each runs offline first and syncs after, against the phone's test server (4.9).
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

  EncounterRepository repo(TestPhone p, {String credential = 'attending', Set<String> permissions = staff}) =>
      EncounterRepository(
        p.store,
        user: EncounterUser(
          userId: p.userId,
          displayName: 'Demo Charter',
          credential: credential,
          permissions: permissions,
        ),
        definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
        noteTypes: () async => definitions.values,
      );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  Map<String, Object?> answersOf(TestPhone p, String noteId) => {
    for (final MapEntry(:key, :value) in p.store.record(noteId)!.fields.entries)
      if (key.startsWith('data.')) key.substring('data.'.length): value.value,
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

  Map<String, LocalEffect> complete(TestPhone p, List<NoteToFinish> notes) =>
      p.store.finishNotes(notes, signer: attending, definitionOf: definitionOf);

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  /// Nothing the phone sent waits, is refused, or was held for a Program Admin.
  void serverTookAll(TestPhone p) {
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  group('Start (lifecycle 9.2, 9.3)', () {
    test(
      'a visit starts with its patient, the place typed and the place tapped, and its kind; the server takes it',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        server.offline = true;
        final r = repo(p);
        var changed = 0;
        r.onChanged = () => changed++;
        final visit = r.startEncounter(
          kind: VisitKind.medical,
          patientId: patient,
          locationText: '  Demo: east underpass ',
          location: const {'lat': 40.1, 'lng': -75.2, 'accuracyM': 12},
        );
        expect(changed, 1);
        expect(p.store.outbox().single.value, {
          'kind': 'medical',
          'patientId': patient,
          'location': {'lat': 40.1, 'lng': -75.2, 'accuracyM': 12},
          'locationText': 'Demo: east underpass',
        });
        final view = (await r.openVisit(visit))!;
        expect(
          [view.kind, view.patientId, view.locationText, view.notSynced],
          [VisitKind.medical, patient, 'Demo: east underpass', true],
        );

        // A place of spaces is no place; nothing typed and nothing tapped starts a visit all the same.
        final bare = r.startEncounter(kind: VisitKind.nonMedical, locationText: '   ');
        expect(p.store.outbox().last.value, {'kind': 'non_medical'});

        server.offline = false;
        await sync(p);
        serverTookAll(p);
        expect(server.records[visit]!.fields['locationText']!.value, 'Demo: east underpass');
        expect(server.records[visit]!.fields['kind']!.value, 'medical');
        expect(server.records[bare]!.fields['kind']!.value, 'non_medical');
      },
    );

    test('a credential that can’t chart Medical is not asked, and its visits start Non-Medical', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      expect(repo(p).asksKind, isTrue);
      expect(repo(p, credential: 'student').asksKind, isTrue);
      // An outreach worker on the staff role: charts, never Medical (lifecycle 6.2).
      final r = repo(p, credential: 'none');
      expect(r.asksKind, isFalse);
      expect(() => r.startEncounter(kind: VisitKind.medical, patientId: patient), refused('medical_credential'));
      expect(p.store.outbox(), isEmpty);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      server.credentials[alex] = 'none';
      await sync(p);
      serverTookAll(p);
      expect(server.records[visit]!.fields['kind']!.value, 'non_medical');
    });

    test('a Medical visit names its patient; a visit with no patient starts Non-Medical', () async {
      // Lifecycle 3.10, 12.1 #11: a Medical note needs a chart to live on, so a visit for someone
      // who declines to be registered holds Non-Medical notes only.
      final p = phone(alex);
      final r = repo(p);
      expect(() => r.startEncounter(kind: VisitKind.medical), refused('medical_note_needs_patient'));
      expect(p.store.outbox(), isEmpty);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, locationText: 'Demo: river path');
      await sync(p);
      serverTookAll(p);
      expect(server.records[visit]!.fields['patientId']?.value, isNull);
    });

    test('someone whose role doesn’t chart starts nothing', () {
      final p = phone(alex);
      final r = repo(p, credential: 'chw', permissions: FakeSyncServer.chw);
      expect(r.asksKind, isFalse);
      expect(() => r.startEncounter(kind: VisitKind.nonMedical), refused('not_charting'));
      expect(p.store.outbox(), isEmpty);
    });

    test('while the clock check fails, Start says why and creates nothing; nor while the store is frozen', () async {
      final p = phone(alex);
      final r = repo(p);
      // The phone's clock, checked against the server's, then set wrong while offline.
      await sync(p);
      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      expect(
        () => r.startEncounter(kind: VisitKind.nonMedical),
        throwsA(isA<ChartingPaused>().having((e) => e.message, 'message', contains('clock'))),
      );
      expect(p.store.outbox(), isEmpty);

      final q = phone(blair);
      q.store.freeze('Demo: handing over');
      expect(() => repo(q).startEncounter(kind: VisitKind.nonMedical), throwsA(isA<ChartingPaused>()));
      expect(q.store.outbox(), isEmpty);
    });
  });

  group('Switch to Medical (lifecycle 3.10, 9.3)', () {
    test('keeps every answer, goes once, and never back', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final social = note(p, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      await sync(p);
      server.offline = true;
      var changed = 0;
      r.onChanged = () => changed++;
      r.switchToMedical(visit);
      expect(changed, 1);
      expect(p.store.outbox().single.field, 'kind');
      expect(answersOf(p, social), {'care.plan': 'Demo: shelter tonight'});
      expect((await r.openVisit(visit))!.kind, VisitKind.medical);
      // Medical already: nothing more to send, nothing changed.
      r.switchToMedical(visit);
      expect(p.store.outbox().where((e) => e.field == 'kind'), hasLength(1));
      expect(changed, 1);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[visit]!.fields['kind']!.value, 'medical');
      expect(server.records[social]!.fields['data.care.plan']!.value, 'Demo: shelter tonight');
    });

    test('a visit with no patient asks who the patient is first, and is given them with the switch', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      note(p, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      final before = p.store.outbox().length;
      expect(() => r.switchToMedical(visit), refused('medical_note_needs_patient'));
      expect(p.store.outbox(), hasLength(before));
      r.switchToMedical(visit, patientId: patient);
      expect([for (final e in p.store.outbox().skip(before)) e.field], ['patientId', 'kind']);
      await sync(p);
      serverTookAll(p);
      expect(
        [server.records[visit]!.fields['patientId']!.value, server.records[visit]!.fields['kind']!.value],
        [patient, 'medical'],
      );
      // The visit's patient is not changed by a switch.
      final other = server.seedPatient();
      final named = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      expect(() => r.switchToMedical(named, patientId: other), throwsArgumentError);
    });

    test('goes after a note is finished, and a patient is given to a visit with none even then', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = note(p, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      complete(p, [finishing(p, n, testNote)]);
      expect((await r.openVisit(visit))!.envelopeLocked, isTrue);
      r.switchToMedical(visit, patientId: patient);
      await sync(p);
      serverTookAll(p);
      expect(server.records[visit]!.fields['kind']!.value, 'medical');
      expect(server.records[visit]!.fields['patientId']!.value, patient);
    });

    test('only a credential that charts Medical switches', () {
      final p = phone(alex);
      final visit = repo(p).startEncounter(kind: VisitKind.nonMedical, patientId: server.seedPatient());
      final before = p.store.outbox().length;
      expect(() => repo(p, credential: 'none').switchToMedical(visit), refused('medical_credential'));
      expect(p.store.outbox(), hasLength(before));
    });
  });

  group('Note types (lifecycle 6.2, 9.4)', () {
    final listed = [
      for (final t in [testNote, testMedical, testRedFlags, testRestricted, testSensitive]) definition(t),
    ];
    List<String> keys(Iterable<NoteTypeDef> types) => [for (final t in types) t.key];

    test('a Medical visit offers every type, a Non-Medical one its own; the Red flags note is the app’s to add', () {
      final p = phone(alex);
      final r = repo(p);
      expect(keys(r.noteTypesOffered(listed, VisitKind.medical)), [
        'test_note',
        'test_medical',
        'test_restricted',
        'test_sensitive',
      ]);
      expect(keys(r.noteTypesOffered(listed, VisitKind.nonMedical)), [
        'test_note',
        'test_restricted',
        'test_sensitive',
      ]);
      // A credential that can't chart Medical is offered Non-Medical types only, in any visit.
      final rn = repo(p, credential: 'none');
      expect(keys(rn.noteTypesOffered(listed, VisitKind.medical)), ['test_note', 'test_restricted', 'test_sensitive']);
      expect(
        repo(p, credential: 'chw', permissions: FakeSyncServer.chw).noteTypesOffered(listed, VisitKind.medical),
        isEmpty,
      );
    });

    test('tapping a type makes its note on that version and opens it; a draft of that type opens instead', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      var changed = 0;
      r.onChanged = () => changed++;
      final first = await r.addNote(visit, definition(testMedical));
      expect([first.existing, changed], [false, 1]);
      final rec = p.store.record(first.noteId)!;
      expect(
        [rec.attributes['encounterId'], rec.attributes['noteTypeKey'], rec.attributes['noteTypeVersion']],
        [visit, 'test_medical', 1],
      );
      // An empty draft counts for nothing (3.1): tapping the type again makes no second one while
      // the first is there to open, empty or not.
      expect((await r.addNote(visit, definition(testMedical))).noteId, first.noteId);
      p.store.setField(first.noteId, 'data.vitals.pulse', 96);
      final again = await r.addNote(visit, definition(testMedical));
      expect([again.noteId, again.existing], [first.noteId, true]);
      // Asked for another: a second note of the type (lifecycle 4.4).
      final second = await r.addNote(visit, definition(testMedical), another: true);
      expect([second.existing, second.noteId == first.noteId], [false, false]);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([server.records[first.noteId]!.status, server.records[second.noteId]!.status], ['draft', 'draft']);
    });

    test('a teammate’s draft of the type opens to help with it, if the person may see and change it', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final visit = repo(a).startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final theirs = (await repo(a).addNote(visit, definition(testNote))).noteId;
      a.store.setField(theirs, 'data.care.plan', 'Demo: shelter tonight');
      final sensitive = (await repo(a).addNote(visit, definition(testSensitive))).noteId;
      a.store.setField(sensitive, 'data.talk.notes', 'Demo: talked about sleep');
      final empty = (await repo(a).addNote(visit, definition(testRestricted))).noteId;
      await sync(a);

      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      for (final n in [theirs, sensitive, empty]) {
        expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      }
      final opened = await repo(b).addNote(visit, definition(testNote));
      expect([opened.noteId, opened.existing], [theirs, true]);
      // Their own draft of the type, once they have one, opens before a teammate's.
      final second = await repo(b).addNote(visit, definition(testNote), another: true);
      expect((await repo(b).addNote(visit, definition(testNote))).noteId, second.noteId);
      // A role that doesn't read sensitive notes doesn't see Alex's: it gets a note of its own.
      final plain = repo(b, permissions: staff.difference({'patients.view_sensitive'}));
      final own = await plain.addNote(visit, definition(testSensitive));
      expect(own.existing, isFalse);
      // A teammate's empty draft is not there to them (3.1): neither opened on its own nor reused.
      expect(await repo(b).openNote(empty), isNull);
      expect(await repo(a).openNote(empty), isNotNull);
      final fresh = await repo(b).addNote(visit, definition(testRestricted));
      expect([fresh.noteId == empty, fresh.existing], [false, false]);
      await sync(b);
      serverTookAll(b);
      expect(server.records[own.noteId]!.author, blair);
    });

    test('a Medical note needs a Medical visit, a patient, and a credential that charts Medical', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final social = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final medical = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      // This phone starts no Medical visit without a patient; another client may have.
      final bare = server.seed('encounter', {'kind': 'medical'}, by: blair);
      expect(await p.engine.openServerRecord('encounter', bare), isTrue);
      final before = p.store.outbox().length;
      await expectLater(
        r.addNote(social, definition(testMedical)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_offered')),
      );
      await expectLater(
        r.addNote(bare, definition(testMedical)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'medical_note_needs_patient')),
      );
      await expectLater(
        repo(p, credential: 'none').addNote(medical, definition(testMedical)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'medical_credential')),
      );
      await expectLater(
        repo(p, credential: 'chw', permissions: FakeSyncServer.chw).addNote(social, definition(testNote)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_charting')),
      );
      expect(p.store.outbox(), hasLength(before));
      // A Non-Medical note goes on either, and on one with no patient.
      await r.addNote(bare, definition(testNote));
      await r.addNote(medical, definition(testMedical));
      await sync(p);
      serverTookAll(p);
    });

    test('a note goes on a visit whose notes are finished, offline, and waits for the clock', () async {
      // PLAN-OPEN 12.1 #3: a note may be added to a visit whose other notes are finished.
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      p.store.setField(n, 'data.care.plan', 'Demo: shelter tonight');
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      expect(server.records[visit]!.status, 'completed');

      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      final before = p.store.outbox().length;
      await expectLater(r.addNote(visit, definition(testNote)), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), hasLength(before));
      p.wall = p.wall.subtract(const Duration(minutes: 10));
      final later = await r.addNote(visit, definition(testNote));
      expect(later.existing, isFalse);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[later.noteId]!.status, 'draft');
    });
  });

  group('Remove this note (lifecycle 3.1, 3.4, 9.4)', () {
    test(
      'blanks every answer, those a condition hides and an entry’s own among them; the note then counts for nothing',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        final r = repo(p);
        final visit = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
        final kept = (await r.addNote(visit, definition(testNote))).noteId;
        p.store.setField(kept, 'data.care.plan', 'Demo: shelter tonight');
        final n = (await r.addNote(visit, definition(testNote), another: true)).noteId;
        for (final MapEntry(:key, :value) in {
          'vitals.pulse': 96,
          'more.detail': 'Demo: hidden later',
          'more.none': true,
          'rows.e0000001.entryAt': '2026-10-20T14:50:00Z',
          'rows.e0000001.text': 'Demo: first row',
        }.entries) {
          p.store.setField(n, 'data.$key', value);
        }
        await sync(p);
        server.offline = true;
        var changed = 0;
        r.onChanged = () => changed++;
        await r.removeNote(n);
        expect(changed, 1);
        expect(noteIsEmpty(answersOf(p, n)), isTrue);
        expect(answersOf(p, n).keys, hasLength(5));
        expect([for (final note in (await r.openVisit(visit))!.notes) note.noteId], [kept]);
        // Removing it again sends nothing more.
        final queued = p.store.outbox().length;
        await r.removeNote(n);
        expect(p.store.outbox(), hasLength(queued));

        server.offline = false;
        await sync(p);
        serverTookAll(p);
        expect(server.records[n]!.status, 'draft');
        expect([
          for (final MapEntry(:key, :value) in server.records[n]!.fields.entries)
            if (key.startsWith('data.')) value.value,
        ], everyElement(isNull));
      },
    );

    test('only the note’s author removes it, and only while it is a draft', () async {
      final a = phone(alex);
      final r = repo(a);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      a.store.setField(n, 'data.care.plan', 'Demo: shelter tonight');
      await sync(a);

      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      await expectLater(
        repo(b).removeNote(n),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_author')),
      );
      expect(b.store.outbox(), isEmpty);

      complete(a, [finishing(a, n, testNote)]);
      final before = a.store.outbox().length;
      await expectLater(r.removeNote(n), throwsA(isA<RecordLocked>()));
      expect(a.store.outbox(), hasLength(before));
      expect(answersOf(a, n), {'care.plan': 'Demo: shelter tonight'});
    });

    test('a note whose sign-off was refused is removed with the refusal’s fix, so the next sync settles it', () async {
      // Lifecycle 3.4, 4.8 (review finding SFN-7): the fix of the refused sign-off goes over the
      // empty note, the server stores it with no effect, and nothing waits in Needs attention.
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      p.store.setField(n, 'data.vitals.pulse', 88);
      await sync(p);
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      final refusal = p.store.needsAttention().single;
      expect(refusal.entity, entitySignoff);

      server.offline = true;
      await r.removeNote(n);
      final fix = p.store.outbox().where((e) => e.entity == entitySignoff && e.state == ChangeState.pending).single;
      expect([fix.recordId, fix.supersedes], [refusal.recordId, refusal.changeId]);
      expect(p.store.localEffect(n), isNull);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[refusal.recordId]!.status, 'none');
      expect(p.store.noteState(n)!.status, NoteStatus.draft);
      expect((await r.openVisit(visit))!.notes, isEmpty);
    });

    test('Add note makes a new draft while a removed note’s fix waits to send, so Complete never stops it '
        'over a Complete the person did not make (lifecycle 3.3, 9.4)', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      p.store.setField(n, 'data.vitals.pulse', 88);
      await sync(p);
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      server.offline = true;
      await r.removeNote(n);

      final added = await r.addNote(visit, definition(testNote));
      expect([added.existing, added.noteId == n], [false, false]);
      p.store.setField(added.noteId, 'data.vitals.pulse', 90);
      final plan = (await r.openComplete(visit))!;
      expect([plan.stops, for (final x in plan.notes) x.noteId], [isEmpty, added.noteId]);
      r.complete(plan);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(
        [server.records[n]!.fields['status']!.value, server.records[added.noteId]!.fields['status']!.value],
        ['draft', 'completed'],
      );
    });

    test('a reopened note of theirs whose last Complete waits to send is still the draft Add note opens: '
        'that Complete was theirs', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      server.offline = true;
      final r = repo(p, credential: 'student');
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final medical = (await r.addNote(visit, definition(testMedical))).noteId;
      p.store.setField((await r.ownRedFlagsNote(visit))!, 'data.flags.any', 'no');
      p.store.setField(medical, 'data.vitals.pulse', 96);
      r.complete((await r.openComplete(visit))!);
      expect(p.store.reopenNote(medical, definition(testMedical)), ReopenEffect.apply);
      final opened = await r.addNote(visit, definition(testMedical));
      expect([opened.noteId, opened.existing], [medical, true]);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
    });

    test('waits, writing nothing, while something else about the visit waits in Needs attention', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      p.store.setField(n, 'data.vitals.pulse', 88);
      await sync(p);
      server.serverEdit(n, 'data.care.plan', 'Demo: shelter tonight', by: blair);
      complete(p, [finishing(p, n, testNote)]);
      await sync(p);
      // The visit's place, refused as well.
      p.store.setField(visit, 'locationText', 'Demo: river path');
      final place = p.store.outbox().last;
      p.store.reject(place, reason: 'validation', details: {'problem': 'demo'});
      final before = p.store.outbox().length;
      await expectLater(
        r.removeNote(n),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'needs_attention')),
      );
      expect(p.store.outbox(), hasLength(before));
      expect(answersOf(p, n), {'vitals.pulse': 88, 'care.plan': 'Demo: shelter tonight'});
    });

    test('an answer the person may not change keeps the note, rather than half remove it', () async {
      // A student's note on which an attending charted the medication (lifecycle 6.4 rule 5): the
      // server would hold the student's clear of it, and the note would never be empty there.
      final a = phone(alex);
      final patient = server.seedPatient();
      final visit = repo(a, credential: 'student').startEncounter(kind: VisitKind.medical, patientId: patient);
      final n = (await repo(a, credential: 'student').addNote(visit, definition(testRestricted))).noteId;
      a.store.setField(n, 'data.general.notes', 'Demo: walked over');
      await sync(a);
      server.serverEdit(n, 'data.meds.given', 'Demo: one tablet', by: blair);
      await a.engine.openServerRecord('encounter_note', n);
      expect(answersOf(a, n)['meds.given'], 'Demo: one tablet');
      final before = a.store.outbox().length;
      await expectLater(
        repo(a, credential: 'student').removeNote(n),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'read_only')),
      );
      expect(a.store.outbox(), hasLength(before));
      // An attending, acting as the author, removes it whole.
      server.credentials[alex] = 'attending';
      await repo(a).removeNote(n);
      await sync(a);
      serverTookAll(a);
    });
  });
}
