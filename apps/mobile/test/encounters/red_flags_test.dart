import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show VisitRead;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart' show visitFromRead;
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart' show NoteStatus;
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/entities.dart' show entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart';

/// The Red flags and disposition note (forms 6.2; lifecycle 3.1, 3.3 hard stop 5; card
/// F7-red-flags-auto): the app adds it for a person with their first Medical note in a visit that
/// has no finished one and none of theirs, it shows last, and Complete never finishes a Medical
/// note without it. Each runs offline first, then syncs to the phone's test server (4.9).
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
  final flagsType = definition(testRedFlags);

  /// A team's list on the phone that names no Red flags note type (one the phone never fetched has
  /// none at all).
  final noFlags = [
    for (final d in definitions.values)
      if (d.auto == null) d,
  ];

  /// [teamList] is the team's list as the phone holds it: by default every test type, the Red flags
  /// note type among them.
  EncounterRepository repo(
    TestPhone p, {
    String credential = 'attending',
    Set<String> permissions = staff,
    Iterable<NoteTypeDef>? teamList,
  }) => EncounterRepository(
    p.store,
    user: EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: credential,
      permissions: permissions,
    ),
    definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
    noteTypes: () async => teamList ?? definitions.values,
    openServerRecord: p.engine.openServerRecord,
  );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  /// The notes of [visit] on [p], by note type key, in no particular order.
  List<String> keysOf(TestPhone p, String visit) => [
    for (final id in p.store.recordIds())
      if (p.store.record(id) case final r? when r.entity == 'encounter_note' && r.attributes['encounterId'] == visit)
        r.attributes['noteTypeKey']! as String,
  ]..sort();

  /// The Red flags notes of [visit] on [p] by [author].
  List<String> flagsOf(TestPhone p, String visit, String author) => [
    for (final id in p.store.recordIds())
      if (p.store.record(id) case final r?
          when r.entity == 'encounter_note' &&
              r.attributes['encounterId'] == visit &&
              r.attributes['noteTypeKey'] == testRedFlags.key &&
              r.authorUserId == author)
        id,
  ];

  /// A note of [type] added through the domain layer, the app's Red flags note with it, and its
  /// [answers] saved as the form saves them.
  Future<String> charted(EncounterRepository r, String visit, TestNoteType type, Map<String, Object?> answers) async {
    final id = (await r.addNote(visit, definition(type))).noteId;
    await r.openNote(id);
    for (final MapEntry(:key, :value) in answers.entries) {
      r.saveAnswer(id, key, value);
    }
    return id;
  }

  void serverTookAll(TestPhone p) {
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(server.held, isEmpty);
  }

  String statusOn(String noteId) => server.records[noteId]!.fields['status']!.value! as String;

  group('the app adds the Red flags note (forms 6.2)', () {
    test(
      'with the first Medical note of theirs, in the same change, as an empty draft that counts for nothing',
      () async {
        final p = phone(alex);
        final patient = server.seedPatient();
        server.offline = true;
        final r = repo(p);
        final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
        // A Non-Medical note in a Medical visit asks no red flags of anyone.
        await r.addNote(visit, definition(testNote));
        expect(keysOf(p, visit), ['test_note']);

        var changed = 0;
        r.onChanged = () => changed++;
        final medical = await r.addNote(visit, definition(testMedical));
        expect(changed, 1);
        expect(keysOf(p, visit), ['test_medical', 'test_note', 'test_red_flags']);
        final flags = flagsOf(p, visit, alex).single;
        expect(await r.ownRedFlagsNote(visit), flags);
        // An empty draft: listed nowhere, it stays out of the way until someone answers it (3.1).
        final view = (await r.openVisit(visit))!;
        expect([for (final n in view.notes) n.noteId], isNot(contains(flags)));
        // Its create follows the Medical note's, written in the same transaction.
        final creates = [for (final e in p.store.outbox()) e.recordId];
        expect(creates.indexOf(flags), creates.indexOf(medical.noteId) + 1);

        // A second Medical note, another of the same type, or the first opened again, adds no second.
        await r.addNote(visit, definition(testMedical));
        await r.addNote(visit, definition(testMedical), another: true);
        expect(flagsOf(p, visit, alex), [flags]);

        server.offline = false;
        await sync(p);
        serverTookAll(p);
        expect([server.records[flags]!.author, statusOn(flags)], [alex, 'draft']);
      },
    );

    test('a Medical draft of theirs that has none gets it when it is opened again', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      // Made while the team's list on the phone named no Red flags type.
      final medical = (await repo(p, teamList: noFlags).addNote(visit, definition(testMedical))).noteId;
      expect(flagsOf(p, visit, alex), isEmpty);
      final opened = await r.addNote(visit, definition(testMedical));
      expect([opened.noteId, opened.existing], [medical, true]);
      final flags = flagsOf(p, visit, alex).single;
      expect(await r.ownRedFlagsNote(visit), flags);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
    });

    test('their own empty Red flags draft counts as theirs, removed or never answered', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final flags = await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      // Asked for by hand, the Red flags note is the app's own: no second one comes with it.
      expect(flagsOf(p, visit, alex), [flags]);
      await r.removeNote(flags);
      await charted(r, visit, testMedical, {'vitals.pulse': 96});
      expect(flagsOf(p, visit, alex), [flags]);
      await sync(p);
    });

    test('a colleague’s unfinished Red flags note doesn’t count: the app gives them their own', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.medical, patientId: patient);
      final theirs = await charted(rb, visit, testMedical, {'vitals.pulse': 96});
      final theirFlags = flagsOf(b, visit, blair).single;
      await rb.openNote(theirFlags);
      rb.saveAnswer(theirFlags, 'flags.any', 'no');
      await sync(b);

      final p = phone(alex);
      final r = repo(p);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      for (final n in [theirs, theirFlags]) {
        expect(await p.engine.openServerRecord('encounter_note', n), isTrue);
      }
      server.offline = true;
      // Helping with a colleague's Medical draft is not writing one: nothing is added.
      final helped = await r.addNote(visit, definition(testMedical));
      expect([helped.noteId, helped.existing], [theirs, true]);
      expect(flagsOf(p, visit, alex), isEmpty);
      // A Medical note of their own is: and with it a Red flags note of their own.
      final own = (await r.addNote(visit, definition(testMedical), another: true)).noteId;
      await r.openNote(own);
      r.saveAnswer(own, 'vitals.pulse', 88);
      final ownFlags = flagsOf(p, visit, alex).single;
      expect(await r.ownRedFlagsNote(visit), ownFlags);

      // At Complete, theirs is finished with the Medical note and asks the red-flag question.
      var plan = (await r.openComplete(visit))!;
      expect([for (final n in plan.notes) n.noteId], [own, ownFlags]);
      expect([for (final s in plan.stops) (s.stop, s.noteId)], [(CompleteStop.missingAnswer, ownFlags)]);
      await r.openNote(ownFlags);
      r.saveAnswer(ownFlags, 'flags.any', 'no');
      plan = (await r.openComplete(visit))!;
      expect(plan.stops, isEmpty);
      r.complete(plan);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([statusOn(own), statusOn(ownFlags), statusOn(theirFlags)], ['signed', 'signed', 'draft']);
    });

    test('a visit whose Red flags note is finished asks a second clinician nothing', () async {
      final b = phone(blair);
      final patient = server.seedPatient();
      final rb = repo(b);
      final visit = rb.startEncounter(kind: VisitKind.medical, patientId: patient);
      await charted(rb, visit, testMedical, {'vitals.pulse': 96});
      final theirFlags = flagsOf(b, visit, blair).single;
      await rb.openNote(theirFlags);
      rb.saveAnswer(theirFlags, 'flags.any', 'no');
      rb.complete((await rb.openComplete(visit))!);
      await sync(b);
      serverTime = serverTime.add(const Duration(minutes: 5));

      final p = phone(alex);
      final r = repo(p);
      expect(await p.engine.openServerRecord('encounter', visit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirFlags), isTrue);
      expect(p.store.noteState(theirFlags)!.status, NoteStatus.signed);
      server.offline = true;
      final own = await charted(r, visit, testMedical, {'vitals.pulse': 88});
      expect(flagsOf(p, visit, alex), isEmpty);
      expect(await r.ownRedFlagsNote(visit), isNull);
      // Nor would the summary add one: a finished Red flags note makes it needless.
      expect(await r.addRedFlagsNote(visit), isNull);
      expect(await repo(p, teamList: noFlags).addRedFlagsNote(visit), isNull);
      expect(flagsOf(p, visit, alex), isEmpty);
      final plan = (await r.openComplete(visit))!;
      expect(plan.stops, isEmpty);
      expect([for (final n in plan.notes) n.noteId], [own]);
      r.complete(plan);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(statusOn(own), 'signed');
    });

    test('nothing is added while the clock check fails or the store is frozen, nor the Medical note', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await sync(p);
      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      await expectLater(r.addNote(visit, definition(testMedical)), throwsA(isA<ChartingPaused>()));
      await expectLater(r.addRedFlagsNote(visit), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), isEmpty);
      p.wall = p.wall.subtract(const Duration(minutes: 10));

      // Frozen, nothing is read either: not even their own, there already.
      await r.addNote(visit, definition(testMedical));
      final before = p.store.outbox().length;
      p.store.freeze('Demo: handing over');
      await expectLater(r.addNote(visit, definition(testMedical)), throwsA(isA<ChartingPaused>()));
      await expectLater(r.addRedFlagsNote(visit), throwsA(isA<ChartingPaused>()));
      await expectLater(r.ownRedFlagsNote(visit), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), hasLength(before));
    });

    test('the team’s Red flags note type is the listed one the app adds by itself', () {
      final listed = [definition(testNote), flagsType, definition(testMedical)];
      expect(redFlagsTypeOf(listed), flagsType);
      expect(redFlagsTypeOf([definition(testNote), definition(testMedical)]), isNull);
    });

    test('the app finds it in the team’s list itself, at the version the list names newest', () async {
      final newer = {...redFlagsNoteType, 'version': testRedFlags.version + 1};
      server.noteTypes[(testRedFlags.key, testRedFlags.version + 1)] = newer;
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p, teamList: [...definitions.values, NoteTypeDef.fromJson(newer)]);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await r.addNote(visit, definition(testMedical));
      final flags = flagsOf(p, visit, alex).single;
      expect(p.store.record(flags)!.attributes['noteTypeVersion'], testRedFlags.version + 1);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[flags]!.attributes['noteTypeVersion'], testRedFlags.version + 1);
    });
  });

  group('hard stop 5 (lifecycle 3.3)', () {
    test('a Medical note with no Red flags note at all: the summary adds theirs, which asks the question', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      // Added while the team's list on the phone named no Red flags type: Complete stops, naming no
      // note to open.
      final medical = (await repo(p, teamList: noFlags).addNote(visit, definition(testMedical))).noteId;
      expect(flagsOf(p, visit, alex), isEmpty);
      await r.openNote(medical);
      r.saveAnswer(medical, 'vitals.pulse', 96);
      var plan = (await r.openComplete(visit))!;
      expect([for (final s in plan.stops) (s.stop, s.noteId)], [(CompleteStop.redFlagsFirst, null)]);
      expect(() => r.complete(plan), throwsA(isA<CompleteRefused>()));
      expect([for (final e in p.store.outbox()) e.entity], isNot(contains(entitySignoff)));

      // The summary adds their own, then plans again: it is finished last, and asks the red flags.
      var changed = 0;
      r.onChanged = () => changed++;
      final flags = (await r.addRedFlagsNote(visit))!;
      expect(changed, 1);
      expect(await r.addRedFlagsNote(visit), flags);
      expect(changed, 1);
      plan = (await r.openComplete(visit))!;
      expect([for (final n in plan.notes) n.noteId], [medical, flags]);
      final missing = plan.stops.single;
      expect(
        [missing.stop, missing.noteId, missing.section, missing.path],
        [CompleteStop.missingAnswer, flags, 'flags', 'flags.any'],
      );
      await r.openNote(flags);
      r.saveAnswer(flags, 'flags.any', 'yes');
      plan = (await r.openComplete(visit))!;
      expect(plan.stops, isEmpty);
      final made = r.complete(plan);
      // The Red flags note's sign-off goes first (4.6).
      expect(made.keys, [flags, medical]);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([statusOn(medical), statusOn(flags)], ['signed', 'signed']);
      // Asked again once it is finished, it is their own that is given back: nothing is added.
      expect(await r.addRedFlagsNote(visit), flags);
      expect(flagsOf(p, visit, alex), [flags]);
    });

    test('the Red flags note is added only where a Medical note could be', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final social = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final medical = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final bare = server.seed('encounter', {'kind': 'medical'}, by: blair);
      expect(await p.engine.openServerRecord('encounter', bare), isTrue);
      final before = p.store.outbox().length;
      Matcher refused(String problem) =>
          throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));
      await expectLater(r.addRedFlagsNote(social), refused('not_offered'));
      await expectLater(r.addRedFlagsNote(bare), refused('medical_note_needs_patient'));
      await expectLater(repo(p, credential: 'none').addRedFlagsNote(medical), refused('medical_credential'));
      await expectLater(
        repo(p, credential: 'chw', permissions: FakeSyncServer.chw).addRedFlagsNote(medical),
        refused('not_charting'),
      );
      // A team's list that names none, or no list on the phone yet: there is nothing to add it on.
      await expectLater(
        repo(p, teamList: noFlags).addRedFlagsNote(medical),
        throwsA(
          isA<LocalValidationError>()
              .having((e) => e.problem, 'problem', 'no_red_flags_type')
              .having((e) => e.message, 'message', 'Connect once to load your team’s note types.'),
        ),
      );
      await expectLater(repo(p, teamList: const []).addRedFlagsNote(medical), refused('no_red_flags_type'));
      expect(p.store.outbox(), hasLength(before));
    });
  });

  group('where it shows (forms 6.2)', () {
    test('last on the visit, whenever it was made', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final flags = await charted(r, visit, testRedFlags, {'flags.any': 'no'});
      final medical = await charted(r, visit, testMedical, {'vitals.pulse': 96});
      final social = await charted(r, visit, testNote, {'care.plan': 'Demo: shelter tonight'});
      expect([for (final n in (await r.openVisit(visit))!.notes) n.noteId], [medical, social, flags]);
      expect(redFlagsLast((await r.openVisit(visit))!.notes).last.noteId, flags);
      await sync(p);
      expect([for (final n in (await r.openVisit(visit))!.notes) n.noteId].last, flags);
    });

    test('last on a visit read from the server, which gives them in the order they were made', () {
      final person = userRef(alex, 'Demo Alex');
      final read = VisitRead.fromJson(
        visitJson(
          encounterId: 'c0000000-0000-4000-8000-0000000000c1',
          notes: [
            visitNoteJson(noteId: 'c0000000-0000-4000-8000-0000000000f1', author: person, key: testRedFlags.key),
            visitNoteJson(noteId: 'c0000000-0000-4000-8000-0000000000f2', author: person),
          ],
        ),
      );
      final view = visitFromRead(
        read,
        source: VisitSource.server,
        user: EncounterUser(userId: alex, displayName: 'Demo Charter', credential: 'attending', permissions: staff),
        definitionOf: (key, version) => definitions[(key, version)],
      );
      expect(
        [for (final n in view.notes) n.noteId],
        ['c0000000-0000-4000-8000-0000000000f2', 'c0000000-0000-4000-8000-0000000000f1'],
      );
    });
  });
}
