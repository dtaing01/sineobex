import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entityCorrection, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// Reopen, addenda and corrections on the phone (lifecycle 3.6, 4.7, 4.8, 8.2, 9.7; card
/// L4-note-actions): what the visit screen offers, what each sends through the store, what is
/// refused here before the server would keep it in history or hold it, and a note that has left the
/// phone opened first. Each runs offline, then syncs to the phone's test server (4.9).
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
        openServerRecord: p.engine.openServerRecord,
      );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  Future<String> charted(EncounterRepository r, String visit, TestNoteType type, Map<String, Object?> answers) async {
    final id = (await r.addNote(visit, definition(type), another: true)).noteId;
    await r.openNote(id);
    for (final MapEntry(:key, :value) in answers.entries) {
      r.saveAnswer(id, key, value);
    }
    return id;
  }

  /// A visit of [kind] with [notes] charted and completed by [r]; returns the visit and the notes.
  Future<(String, List<String>)> finished(
    EncounterRepository r,
    String? patient,
    VisitKind kind,
    List<(TestNoteType, Map<String, Object?>)> notes,
  ) async {
    final visit = r.startEncounter(kind: kind, patientId: patient);
    final ids = [for (final (type, answers) in notes) await charted(r, visit, type, answers)];
    r.complete((await r.openComplete(visit))!);
    return (visit, ids);
  }

  OutboxEntry createOf(TestPhone p, String entity) =>
      p.store.outbox().lastWhere((e) => e.entity == entity && e.op == 'create' && e.state != ChangeState.superseded);

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  void serverTookAll(TestPhone p) {
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  Object? serverAnswer(String noteId, String path) => server.records[noteId]!.fields['data.$path']?.value;
  String statusOn(String noteId) => server.records[noteId]!.fields['status']!.value! as String;

  group('Reopen (lifecycle 3.6, 4.4)', () {
    test('a student’s note waiting for a co-signer goes back to draft for its author, offline', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      final r = repo(p, credential: 'student');
      final (visit, [flags, medical]) = await finished(r, patient, VisitKind.medical, [
        (testRedFlags, {'flags.any': 'no'}),
        (testMedical, {'vitals.pulse': 96}),
      ]);
      await sync(p);
      expect(statusOn(medical), 'completed');

      server.offline = true;
      expect([r.mayReopen(medical), r.mayReopen(flags)], [true, true]);
      var changed = 0;
      r.onChanged = () => changed++;
      expect(await r.reopen(medical), ReopenEffect.apply);
      expect(changed, 1);
      final view = (await r.openNote(medical))!;
      expect([view.status, view.editable], [NoteStatus.draft, true]);
      // A draft again: nothing more to send for it, and nothing to reopen.
      final before = p.store.outbox().length;
      expect(await r.reopen(medical), ReopenEffect.nothing);
      expect(r.mayReopen(medical), isFalse);
      expect(p.store.outbox(), hasLength(before));
      r.saveAnswer(medical, 'vitals.pulse', 98);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([statusOn(medical), serverAnswer(medical, 'vitals.pulse')], ['draft', 98]);
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      expect(statusOn(medical), 'completed');
    });

    test('what the server would keep as it is never leaves the phone', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final (_, [flags, social]) = await finished(r, patient, VisitKind.medical, [
        (testRedFlags, {'flags.any': 'no'}),
        (testNote, {'care.plan': 'Demo: blankets'}),
      ]);
      await sync(p);
      server.offline = true;
      // Signed, and a Non-Medical note completed: an addendum or a correction is the way (3.6).
      for (final id in [flags, social]) {
        expect(r.mayReopen(id), isFalse, reason: id);
        await expectLater(r.reopen(id), throwsA(isA<RecordLocked>()), reason: id);
      }

      // Someone else's note its author could reopen.
      final b = phone(blair);
      server.credentials[blair] = 'student';
      final rb = repo(b, credential: 'student');
      final (visit, [_, theirs]) = await finished(rb, patient, VisitKind.medical, [
        (testRedFlags, {'flags.any': 'no'}),
        (testMedical, {'vitals.pulse': 96}),
      ]);
      server.offline = false;
      await sync(b);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      server.offline = true;
      expect(r.mayReopen(theirs), isFalse);
      await expectLater(r.reopen(theirs), refused('not_author'));
      expect(p.store.outbox(), isEmpty);
    });

    test('a credential lowered to one that can’t chart Medical reopens nothing: the server would hold it '
        '(review LCM-4)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      final r = repo(p, credential: 'student');
      final (_, [_, medical]) = await finished(r, patient, VisitKind.medical, [
        (testRedFlags, {'flags.any': 'no'}),
        (testMedical, {'vitals.pulse': 96}),
      ]);
      await sync(p);
      server.offline = true;
      final lowered = repo(p, credential: 'chw');
      expect(lowered.mayReopen(medical), isFalse);
      await expectLater(lowered.reopen(medical), refused('medical_credential'));
      expect(p.store.outbox(), isEmpty);
      expect(p.store.noteState(medical)!.status, NoteStatus.completed);
    });

    test('a note sent for review says so, and is neither reopened nor corrected', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.credentials[alex] = 'student';
      final r = repo(p, credential: 'student');
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      await sync(p);
      // The credential was lowered on the server and the phone's profile doesn't know (4.2).
      server.changeCredential(alex, 'chw');
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      expect(p.store.sentForReview(medical), isTrue);
      expect(r.mayReopen(medical), isFalse);
      expect(r.mayCorrect((await r.openNote(medical))!), isFalse);
      await expectLater(
        r.correct(visit, medical, changes: {'vitals.pulse': 98}, reason: 'Demo: typo'),
        refused('sent_for_review'),
      );
      await expectLater(
        r.reopen(medical),
        throwsA(
          isA<LocalValidationError>()
              .having((e) => e.problem, 'problem', 'sent_for_review')
              .having(
                (e) => e.message,
                'message',
                'This note was sent to a Program Admin for review. It can’t be changed until they decide.',
              ),
        ),
      );
    });
  });

  group('Addenda (lifecycle 3.6, 4.7)', () {
    test('an addendum to a finished note, written offline, waits behind the sign-off it names', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final (visit, [n]) = await finished(r, patient, VisitKind.nonMedical, [
        (testNote, {'vitals.pulse': 88}),
      ]);
      final view = (await r.openVisit(visit))!;
      expect([r.mayAddAddendum(view.notes.single), r.mayAddVisitAddendum(view)], [true, true]);
      final signoff = p.store.localEffect(n)!.signoffId;
      var changed = 0;
      r.onChanged = () => changed++;
      final id = await r.addAddendum(visit, noteId: n, text: '  Demo: results came back normal  ');
      expect(changed, 1);
      expect(createOf(p, entityAddendum).value, {
        'encounterId': visit,
        'noteId': n,
        'text': 'Demo: results came back normal',
        'signoffId': signoff,
      });
      // One to the visit itself names a sign-off of the visit that waits too.
      final own = await r.addAddendum(visit, text: 'Demo: seen again at noon');
      expect(createOf(p, entityAddendum).value, {
        'encounterId': visit,
        'noteId': null,
        'text': 'Demo: seen again at noon',
        'signoffId': signoff,
      });
      expect(p.store.record(id)!.patientId, patient);

      Matcher text(String message) =>
          throwsA(isA<LocalValidationError>().having((e) => (e.problem, e.message), 'problem', ('text', message)));
      await expectLater(r.addAddendum(visit, noteId: n, text: '   '), text('Write the addendum first.'));
      await expectLater(
        r.addAddendum(visit, noteId: n, text: 'Demo: ${'x' * 4000}'),
        text('An addendum can be up to 4,000 characters.'),
      );

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([server.records[id]!.attributes['noteId'], server.records[own]!.attributes['noteId']], [n, null]);
      // Once the sign-off is confirmed, an addendum names none.
      await r.addAddendum(visit, noteId: n, text: 'Demo: called back');
      expect((createOf(p, entityAddendum).value! as Map)['signoffId'], isNull);
    });

    test('anyone who charts adds one; a role that doesn’t chart does not; the clock pauses it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final (visit, [n]) = await finished(r, patient, VisitKind.nonMedical, [
        (testNote, {'vitals.pulse': 88}),
      ]);
      await sync(p);
      final reader = repo(p, credential: 'chw', permissions: FakeSyncServer.chw);
      final view = (await reader.openVisit(visit))!;
      expect(reader.mayAddVisitAddendum(view), isFalse);
      await expectLater(reader.addAddendum(visit, noteId: n, text: 'Demo: note'), refused('not_charting'));

      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      await expectLater(r.addAddendum(visit, noteId: n, text: 'Demo: later'), throwsA(isA<ChartingPaused>()));
      expect([for (final e in p.store.outbox()) e.entity], isNot(contains(entityAddendum)));
    });
  });

  group('a teammate’s note the person may not read (lifecycle 6.4)', () {
    // The phone holds Blair's Medical note as a role that reads Medical notes was sent it; Alex's
    // role now charts but doesn't read Medical notes (no patients.view, D37).
    final noMedical = {...staff}..remove('patients.view');

    Future<(String, String, String)> blairsMedicalNote(TestPhone p, {required bool finish}) async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.medical, patientId: patient);
      final theirs = await charted(rb, visit, testMedical, {'vitals.pulse': 96});
      if (finish) {
        final flags = (await rb.ownRedFlagsNote(visit))!;
        await rb.openNote(flags);
        rb.saveAnswer(flags, 'flags.any', 'no');
        rb.complete((await rb.openComplete(visit))!);
      }
      await sync(b);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      return (patient, visit, theirs);
    }

    test('Complete doesn’t name their draft among the teammates’ drafts (review LCM-4)', () async {
      final p = phone(alex);
      final (_, visit, theirs) = await blairsMedicalNote(p, finish: false);
      final reads = repo(p);
      final mine = await charted(reads, visit, testNote, {'care.plan': 'Demo: blankets'});
      expect([for (final d in (await reads.openComplete(visit))!.teammateDrafts) d.noteId], [theirs]);

      final r = repo(p, permissions: noMedical);
      final plan = (await r.openComplete(visit))!;
      expect(plan.teammateDrafts, isEmpty);
      expect([for (final n in plan.notes) n.noteId], [mine]);
    });

    test('an addendum to it is refused cannot_read, which the server would hold (review LCM-4)', () async {
      final p = phone(alex);
      final (_, visit, theirs) = await blairsMedicalNote(p, finish: true);
      final r = repo(p, permissions: noMedical);
      server.offline = true;
      await expectLater(r.addAddendum(visit, noteId: theirs, text: 'Demo: seen again'), refused('cannot_read'));
      expect(p.store.outbox(), isEmpty);
      // Someone who may read it adds one.
      await repo(p).addAddendum(visit, noteId: theirs, text: 'Demo: seen again');
      expect(createOf(p, entityAddendum).value, containsPair('noteId', theirs));
    });
  });

  group('Corrections (lifecycle 3.6, 4.7)', () {
    test(
      'one to ten answers of a finished note, each with the version it was read at; the server applies it',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        final r = repo(p);
        final (_, [flags, medical]) = await finished(r, patient, VisitKind.medical, [
          (testRedFlags, {'flags.any': 'no'}),
          (testMedical, {'vitals.pulse': 96, 'care.plan': 'Demo: rest'}),
        ]);
        await sync(p);
        final visit = p.store.record(medical)!.attributes['encounterId']! as String;
        server.offline = true;
        final view = (await r.openNote(medical))!;
        expect(r.mayCorrect(view), isTrue);
        final read = p.store.record(medical)!.fields['data.vitals.pulse']!.serverVersion;
        var changed = 0;
        r.onChanged = () => changed++;
        final id = await r.correct(
          visit,
          medical,
          changes: {'vitals.pulse': 86, 'care.plan': 'Demo: rest', 'care.followup': 'Demo: tomorrow'},
          reason: '  Demo: counted twice  ',
        );
        expect(changed, 1);
        // An answer that already says so is not sent as a change.
        expect(createOf(p, entityCorrection).value, {
          'noteId': medical,
          'changes': [
            {'field': 'data.vitals.pulse', 'newValue': 86, 'baseVersion': read},
            {'field': 'data.care.followup', 'newValue': 'Demo: tomorrow', 'baseVersion': 0},
          ],
          'reason': 'Demo: counted twice',
          'requestedByPatient': false,
          'declined': false,
          'claimedCredential': 'attending',
          'signoffId': null,
        });

        // Refused here, writing nothing, as the server would refuse it.
        final before = p.store.outbox().length;
        await expectLater(
          r.correct(visit, medical, changes: {'vitals.pulse': 'fast'}, reason: 'Demo: typo'),
          refused('wrong_type'),
        );
        await expectLater(
          r.correct(visit, medical, changes: {'vitals.pulse': 96}, reason: 'Demo: typo'),
          refused('no_change'),
        );
        await expectLater(
          r.correct(visit, flags, changes: {'flags.any': null}, reason: 'Demo: unsure'),
          refused('incomplete'),
        );
        await expectLater(r.correct(visit, medical, changes: {'vitals.pulse': 80}, reason: 'no'), refused('reason'));
        expect(p.store.outbox(), hasLength(before));

        server.offline = false;
        await sync(p);
        serverTookAll(p);
        expect(server.records[id]!.status, 'corrected');
        expect([serverAnswer(medical, 'vitals.pulse'), serverAnswer(medical, 'care.followup')], [86, 'Demo: tomorrow']);
      },
    );

    test('a correction made before the sign-off is confirmed names it, and waits behind it', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final (visit, [n]) = await finished(r, patient, VisitKind.nonMedical, [
        (testNote, {'vitals.pulse': 88}),
      ]);
      final signoff = p.store.localEffect(n)!.signoffId;
      await r.correct(visit, n, changes: {'vitals.pulse': 86}, reason: 'Demo: counted twice');
      final correction = createOf(p, entityCorrection);
      expect((correction.value! as Map)['signoffId'], signoff);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[correction.recordId]!.status, 'corrected');
    });

    test('only for whoever acts as the author, on a finished note, never a draft or one sent for review', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final (visit, [theirs]) = await finished(rb, patient, VisitKind.nonMedical, [
        (testNote, {'vitals.pulse': 88}),
      ]);
      await sync(b);
      final p = phone(alex);
      final r = repo(p);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);
      expect(r.mayCorrect((await r.openNote(theirs))!), isFalse);
      await expectLater(
        r.correct(visit, theirs, changes: {'vitals.pulse': 86}, reason: 'Demo: typo'),
        refused('not_author'),
      );

      final draft = await charted(r, visit, testNote, {'vitals.pulse': 70});
      expect(r.mayCorrect((await r.openNote(draft))!), isFalse);
      await expectLater(r.correct(visit, draft, changes: {'vitals.pulse': 72}, reason: 'Demo: typo'), refused('draft'));

      // An answer the server would hold from them (a section that needs an ordering credential).
      final s = phone(blair);
      server.credentials[blair] = 'student';
      final rs = repo(s, credential: 'student');
      final (own, [restricted]) = await finished(rs, patient, VisitKind.nonMedical, [
        (testRestricted, {'general.notes': 'Demo: talked'}),
      ]);
      await expectLater(
        rs.correct(own, restricted, changes: {'meds.given': 'Demo: water'}, reason: 'Demo: forgot'),
        refused('read_only'),
      );
      expect([for (final e in p.store.outbox()) e.entity], isNot(contains(entityCorrection)));
      expect([for (final e in s.store.outbox()) e.entity], isNot(contains(entityCorrection)));
    });

    test('a patient’s request: made as a correction, or recorded as declined', () async {
      // PRD main 463: the same path, with the request and the decision logged (lifecycle 3.6).
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final (visit, [n]) = await finished(r, patient, VisitKind.nonMedical, [
        (testNote, {'care.history': 'Demo: smokes'}),
      ]);
      await sync(p);
      server.offline = true;
      final declined = await r.correct(
        visit,
        n,
        changes: {'care.history': 'Demo: never smoked'},
        reason: 'Demo: seen smoking today',
        requestedByPatient: true,
        declined: true,
      );
      expect((createOf(p, entityCorrection).value! as Map)['declined'], isTrue);
      await expectLater(
        r.correct(visit, n, changes: {'care.history': 'Demo: x'}, reason: 'Demo: asked', declined: true),
        throwsArgumentError,
      );
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[declined]!.status, 'declined');
      expect(serverAnswer(n, 'care.history'), 'Demo: smokes');
    });
  });

  group('a note that has left the phone (lifecycle 4.8, 8.2)', () {
    test('an addendum or a correction opens it first, with a connection; offline it says to connect', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final ra = repo(a);
      final (visit, [n]) = await finished(ra, patient, VisitKind.nonMedical, [
        (testNote, {'vitals.pulse': 88}),
      ]);
      await sync(a);

      // The author on another phone, which never held the visit.
      final p = phone(alex);
      final r = repo(p);
      server.offline = true;
      final notHere = isA<LocalValidationError>()
          .having((e) => e.problem, 'problem', 'not_on_phone')
          .having((e) => e.message, 'message', 'This note isn’t on this phone. Connect, then try again.');
      await expectLater(r.addAddendum(visit, noteId: n, text: 'Demo: later'), throwsA(notHere));
      await expectLater(r.correct(visit, n, changes: {'vitals.pulse': 86}, reason: 'Demo: typo'), throwsA(notHere));
      expect(p.store.outbox(), isEmpty);

      server.offline = false;
      final addendum = await r.addAddendum(visit, noteId: n, text: 'Demo: later');
      final correction = await r.correct(visit, n, changes: {'vitals.pulse': 86}, reason: 'Demo: counted twice');
      // Opened first, so each is filed under the note's patient (4.8).
      for (final id in [addendum, correction]) {
        expect(p.store.record(id)!.patientId, patient, reason: id);
      }
      expect(p.store.record(n), isNotNull);
      await sync(p);
      serverTookAll(p);
      expect(server.records[correction]!.status, 'corrected');
      expect(server.records[addendum]!.attributes['noteId'], n);
    });
  });

  test('every action waits while the store is frozen', () async {
    final p = phone(alex);
    final patient = server.seedPatient();
    final r = repo(p);
    final (visit, [n]) = await finished(r, patient, VisitKind.nonMedical, [
      (testNote, {'vitals.pulse': 88}),
    ]);
    p.store.freeze('Demo: handing over');
    final before = p.store.outbox().length;
    await expectLater(r.reopen(n), throwsA(isA<ChartingPaused>()));
    await expectLater(r.addAddendum(visit, noteId: n, text: 'Demo: later'), throwsA(isA<ChartingPaused>()));
    await expectLater(
      r.correct(visit, n, changes: {'vitals.pulse': 86}, reason: 'Demo: typo'),
      throwsA(isA<ChartingPaused>()),
    );
    expect(p.store.outbox(), hasLength(before));
    expect(p.store.record(n)!.attributes.containsKey('localEffect'), isTrue);
    expect([for (final e in p.store.outbox()) e.entity].where((e) => e == entitySignoff), hasLength(1));
  });
}
