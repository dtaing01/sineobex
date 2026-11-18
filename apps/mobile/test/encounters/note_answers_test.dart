import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// The note form's answers saved through the domain layer (lifecycle 9.5, forms 8.1): each checked
/// by the note's own version and saved as it is entered; one equal to what is stored never queued;
/// an answer the server would hold from the person read-only to them, so nothing is sent that they
/// could never fix. Offline first, then synced to the phone's test server (4.9).
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

  /// What waits to be sent, the read logs left out.
  List<OutboxEntry> changes(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity != entityAudit) e,
  ];

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  void serverTookAll(TestPhone p) {
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  test(
    'an answer is checked by the note’s own version and saved as it is entered; the form reads it back at once',
    () async {
      final p = phone(alex);
      final r = repo(p);
      server.offline = true;
      final visit = r.startEncounter(kind: VisitKind.nonMedical);
      final n = (await r.addNote(visit, definition(testNote))).noteId;
      // The form saves only into a note it has open: the definition it checks by is the one the read loaded.
      expect(() => r.saveAnswer(n, 'vitals.pulse', 96), throwsStateError);
      var view = (await r.openNote(n))!;
      var changed = 0;
      r.onChanged = () => changed++;
      expect(r.saveAnswer(n, 'vitals.pulse', 96), isTrue);
      expect(r.saveAnswer(n, 'care.plan', 'Demo: shelter tonight'), isTrue);
      expect(changed, 2);
      view = r.readNote(n, shownBefore: view.shownIds.toSet())!;
      expect(view.answers, {'vitals.pulse': 96, 'care.plan': 'Demo: shelter tonight'});
      expect(view.pendingPaths, {'vitals.pulse', 'care.plan'});

      // What the definition refuses is never queued: it would be refused at the server, never to be
      // fixed by the form that sent it.
      final before = p.store.outbox().length;
      expect(() => r.saveAnswer(n, 'vitals.nowhere', 1), refused('unknown_path'));
      expect(() => r.saveAnswer(n, 'vitals.pulse', 'ninety'), refused('wrong_type'));
      expect(() => r.saveAnswer(n, 'vitals.pulse', 301), refused('out_of_range'));
      expect(p.store.outbox(), hasLength(before));
      expect(changed, 2);

      // Clearing an answer is a null.
      expect(r.saveAnswer(n, 'care.plan', null), isTrue);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[n]!.fields['data.vitals.pulse']!.value, 96);
      expect(server.records[n]!.fields['data.care.plan']!.value, isNull);
    },
  );

  test('an answer equal to what is stored is not queued: a second tap of Normal sends nothing', () async {
    final p = phone(alex);
    final r = repo(p);
    final visit = r.startEncounter(kind: VisitKind.nonMedical);
    final n = (await r.addNote(visit, definition(testNote))).noteId;
    await r.openNote(n);
    expect(r.saveAnswer(n, 'vitals.pulse', 96), isTrue);
    expect(r.saveAnswer(n, 'rows.e0000001.entryAt', '2026-10-20T14:50:00Z'), isTrue);
    final queued = p.store.outbox().length;
    var changed = 0;
    r.onChanged = () => changed++;
    // The same values again, as the form sends them before it is drawn again; and the clear of an
    // answer that was never there.
    expect(r.saveAnswer(n, 'vitals.pulse', 96), isFalse);
    expect(r.saveAnswer(n, 'rows.e0000001.entryAt', '2026-10-20T14:50:00Z'), isFalse);
    expect(r.saveAnswer(n, 'care.plan', null), isFalse);
    expect(r.saveAnswer(n, 'more.none', null), isFalse);
    expect(p.store.outbox(), hasLength(queued));
    expect(changed, 0);
    await sync(p);
    serverTookAll(p);
    // Confirmed since: still no change.
    expect(r.saveAnswer(n, 'vitals.pulse', 96), isFalse);
    expect(p.store.outbox(), isEmpty);
  });

  group('what the person may not change is read-only to them (lifecycle 6.4 rule 5, 9.5)', () {
    const w = 'e0000003';
    const marked = <String, Object?>{
      'look.systems': ['heart', 'other'],
      'look.systems_other': 'Demo: a scrape',
      'look.notes': 'Demo: walked over',
      'wounds.$w.entryAt': '2026-10-20T14:50:00Z',
      'wounds.$w.where': 'groin',
      'wounds.$w.size': 'Demo: 2 cm',
    };

    /// Alex's draft on the server, and Blair's phone holding it as the server sent it to Blair.
    Future<({String visit, String n, TestPhone b})> teammatesDraft(TestNoteType type, Map<String, Object?> data) async {
      final patient = server.seedPatient();
      final visit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: alex);
      final n = server.seed('encounter_note', {
        'encounterId': visit,
        'noteTypeKey': type.key,
        'noteTypeVersion': type.version,
        'data': data,
      }, by: alex);
      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', n), isTrue);
      return (visit: visit, n: n, b: b);
    }

    test('an answer that could hold what someone may not see, to anyone who does not act as the author', () async {
      // F5's review BEH-4, D88: Blair's phone holds the picker without the GU code, so a tap would
      // send a list without it; the server holds every such set, whatever the note holds.
      final (:visit, :n, :b) = await teammatesDraft(testMarked, marked);
      final r = repo(b);
      final view = (await r.openNote(n))!;
      expect([view.actsAsAuthor, view.editable], [false, true]);
      expect(view.answers['look.systems'], ['heart']);
      expect(
        {
          for (final path in ['look.systems', 'look.systems_other', 'wounds.$w.where', 'wounds.$w.size', 'look.notes'])
            path: r.readOnlyAt(view, path),
        },
        {
          'look.systems': true,
          'look.systems_other': true,
          'wounds.$w.where': true,
          'wounds.$w.size': false,
          'look.notes': false,
        },
      );
      server.offline = true;
      expect(() => r.saveAnswer(n, 'look.systems', null), refused('read_only'));
      expect(() => r.saveAnswer(n, 'wounds.$w.where', 'arm'), refused('read_only'));
      expect(changes(b), isEmpty);
      expect(r.saveAnswer(n, 'look.notes', 'Demo: walked back'), isTrue);
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(server.records[n]!.fields['data.look.notes']!.value, 'Demo: walked back');
      expect(server.records[n]!.fields['data.look.systems']!.value, ['heart', 'other']);

      // With the exam key, each is the draft rule's.
      final keyed = repo(b, permissions: {...staff, 'patients.view_sensitive_exams'});
      final shown = (await keyed.openNote(n))!;
      expect(keyed.readOnlyAt(shown, 'look.systems'), isFalse);
      // Whoever acts as the author is never held by it.
      final a = phone(alex);
      expect(await a.engine.openServerRecord('encounter', visit), isTrue);
      expect(await a.engine.openServerRecord('encounter_note', n), isTrue);
      final own = repo(a, credential: 'none', permissions: const {'patients.view', 'encounters.chart'});
      final mine = (await own.openNote(n))!;
      expect(
        [mine.actsAsAuthor, own.readOnlyAt(mine, 'look.systems'), own.readOnlyAt(mine, 'wounds.$w.where')],
        [true, false, false],
      );
      expect(own.saveAnswer(n, 'look.systems', ['other']), isTrue);
      await sync(a);
      serverTookAll(a);
    });

    test('a diagnosis’s section, to someone without the sensitive key', () async {
      const e1 = 'e0000001';
      final (visit: _, :n, :b) = await teammatesDraft(testRestricted, const {
        'general.notes': 'Demo: walked over',
        'dx.$e1.entryAt': '2026-10-20T14:50:00Z',
        'dx.$e1.diagnosis.code': 'J02.9',
        'dx.$e1.diagnosis.label': 'Demo: sore throat',
      });
      final r = repo(b, permissions: const {'patients.view', 'encounters.chart'});
      final view = (await r.openNote(n))!;
      expect([r.readOnlyAt(view, 'dx.$e1.diagnosis.code'), r.readOnlyAt(view, 'general.notes')], [true, false]);
      expect(() => r.saveAnswer(n, 'dx.e0000002.note', 'Demo: a second one'), refused('read_only'));
      expect(changes(b), isEmpty);
    });

    test(
      'a section that needs an ordering credential, to a credential that can’t order, its author included',
      () async {
        // Lifecycle 4.2, 6.4 rule 5: the Quick encounter's Medication section.
        final p = phone(alex);
        server.credentials[alex] = 'student';
        final student = repo(p, credential: 'student');
        final visit = student.startEncounter(kind: VisitKind.medical, patientId: server.seedPatient());
        final n = (await student.addNote(visit, definition(testRestricted))).noteId;
        final view = (await student.openNote(n))!;
        expect(
          [view.actsAsAuthor, student.readOnlyAt(view, 'meds.given'), student.readOnlyAt(view, 'general.notes')],
          [true, true, false],
        );
        server.offline = true;
        expect(() => student.saveAnswer(n, 'meds.given', 'Demo: one tablet'), refused('read_only'));
        expect(student.saveAnswer(n, 'general.notes', 'Demo: walked over'), isTrue);
        server.offline = false;
        await sync(p);
        serverTookAll(p);

        server.credentials[alex] = 'attending';
        final attending = repo(p);
        final again = (await attending.openNote(n))!;
        expect(attending.readOnlyAt(again, 'meds.given'), isFalse);
        expect(attending.saveAnswer(n, 'meds.given', 'Demo: one tablet'), isTrue);
        await sync(p);
        serverTookAll(p);
        expect(server.records[n]!.fields['data.meds.given']!.value, 'Demo: one tablet');
      },
    );

    test('a Medical note, to a credential that can’t chart Medical; a finished note, to everyone', () async {
      final p = phone(alex);
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: server.seedPatient());
      final medical = (await r.addNote(visit, definition(testMedical))).noteId;
      final social = (await r.addNote(visit, definition(testNote))).noteId;
      final rn = repo(p, credential: 'none');
      final view = (await rn.openVisit(visit))!;
      final medicalView = view.notes.where((v) => v.noteId == medical).firstOrNull;
      // An empty draft is not listed; read on its own, it is not the RN's to change.
      final asRead = medicalView ?? (await rn.openNote(medical))!;
      expect(rn.readOnlyAt(asRead, 'vitals.pulse'), isTrue);
      expect(() => rn.saveAnswer(medical, 'vitals.pulse', 96), refused('medical_credential'));
      expect(rn.saveAnswer(social, 'care.plan', 'Demo: shelter tonight'), isTrue);

      // Finished as this phone knows it: locked until reopened.
      await r.openNote(social);
      p.store.finishNotes(
        [
          NoteToFinish(
            noteId: social,
            shownHash: p.store.contentHashOf(social, definition(testNote)),
            act: SignoffAct.complete,
            statementVersion: 'complete-2026-11',
          ),
        ],
        signer: r.user.signer,
        definitionOf: definitionOf,
      );
      final finished = (await r.openNote(social))!;
      expect(r.readOnlyAt(finished, 'care.plan'), isTrue);
      final before = p.store.outbox().length;
      expect(() => r.saveAnswer(social, 'care.plan', 'Demo: something else'), throwsA(isA<RecordLocked>()));
      // Equal to what was finished: still locked, not quietly dropped.
      expect(() => r.saveAnswer(social, 'care.plan', 'Demo: shelter tonight'), throwsA(isA<RecordLocked>()));
      expect(p.store.outbox(), hasLength(before));
      await sync(p);
      serverTookAll(p);
    });
  });

  test('nothing is saved while the clock check fails or the store is frozen', () async {
    final p = phone(alex);
    final r = repo(p);
    final visit = r.startEncounter(kind: VisitKind.nonMedical);
    final n = (await r.addNote(visit, definition(testNote))).noteId;
    await r.openNote(n);
    await sync(p);
    server.offline = true;
    p.wall = p.wall.add(const Duration(minutes: 10));
    expect(p.clock.status.paused, isTrue);
    expect(() => r.saveAnswer(n, 'vitals.pulse', 96), throwsA(isA<ChartingPaused>()));
    p.wall = p.wall.subtract(const Duration(minutes: 10));
    p.store.freeze('Demo: handing over');
    expect(() => r.saveAnswer(n, 'vitals.pulse', 96), throwsA(isA<ChartingPaused>()));
    expect(p.store.outbox(), isEmpty);
    p.store.unfreeze();
    expect(r.saveAnswer(n, 'vitals.pulse', 96), isTrue);
  });
}
