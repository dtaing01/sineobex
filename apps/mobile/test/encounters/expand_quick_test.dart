import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show VisitRead;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart' show visitFromRead;
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/expand.dart' show expandQuick;
import 'package:sineobex_field/sync/entities.dart' show entityCorrection, entityNote;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart' show userRef, visitJson, visitNoteJson;

/// Expand on the Quick encounter (forms 6.4; card F7-expand): a part of a quick note made into its
/// full note type in the same visit, each mapped answer written into it as an ordinary change, the
/// quick note keeping its own. Each runs offline first, then syncs to the phone's test server (4.9),
/// which checks every answer against the full note type as the API does.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;
  final added = DateTime.utc(2026, 10, 20, 15, 5);

  // The released note types, as the phone bundles them.
  final presets = {
    for (final p in (jsonDecode(
      File('assets/forms/presets.json').readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>())
      p['key']! as String: p['definition']! as Map<String, Object?>,
  };

  // A quick note type of the tests' own, and the full one it maps into: answers the full type
  // doesn't take (another unit, a longer text), a repeating section, a part that needs an ordering
  // credential, and a second note type mapped from another part.
  Map<String, Object?> text(String id, String label, {int max = 200, String? mapsTo}) => {
    'id': id,
    'kind': 'text',
    'label': label,
    'lines': 'one',
    'maxLength': max,
    'mapsTo': ?mapsTo,
  };
  Map<String, Object?> number(
    String id,
    String label,
    num min,
    num max, {
    int decimals = 0,
    String? unit,
    String? mapsTo,
  }) => {
    'id': id,
    'kind': 'number',
    'label': label,
    'min': min,
    'max': max,
    'decimals': decimals,
    'unit': ?unit,
    'mapsTo': ?mapsTo,
  };
  final quickJson = <String, Object?>{
    'key': 'test_quick',
    'version': 1,
    'title': 'Test quick note',
    'kinds': ['medical'],
    'group': 'clinical',
    'sensitivity': 'none',
    'quick': true,
    'sections': [
      {
        'id': 'q',
        'title': 'Quick',
        'fields': [
          number('pulse', 'Pulse', 0, 300, mapsTo: 'test_full:vitals.pulse'),
          number('temp', 'Temperature', 80, 110, decimals: 1, unit: '°F', mapsTo: 'test_full:vitals.temp_c'),
          text('followup', 'Follow-up', max: 2000, mapsTo: 'test_full:care.followup'),
          number('count', 'Count', 0, 100, mapsTo: 'test_full:rows.n'),
          text('aside', 'Aside'),
          // Into a part that needs an ordering credential, from one that doesn't: the validator
          // refuses it in a quick note type's newest version, not in an older one (6.4).
          text('route', 'Route', mapsTo: 'test_full:meds.route'),
        ],
      },
      {
        'id': 'meds',
        'title': 'Medication',
        'needs': 'orderMedications',
        'fields': [text('dose', 'Dose', mapsTo: 'test_full:meds.dose')],
      },
      {
        'id': 'other',
        'title': 'Other',
        'fields': [text('plan', 'Plan', mapsTo: 'test_medical:care.plan')],
      },
    ],
  };
  final fullJson = <String, Object?>{
    'key': 'test_full',
    'version': 1,
    'title': 'Test full note',
    'kinds': ['medical'],
    'group': 'clinical',
    'sensitivity': 'none',
    'sections': [
      {
        'id': 'vitals',
        'title': 'Vitals',
        'fields': [number('pulse', 'Pulse', 0, 300), number('temp_c', 'Temperature', 30, 45, decimals: 1)],
      },
      {
        'id': 'care',
        'title': 'Care',
        'fields': [text('followup', 'Follow-up')],
      },
      {
        'id': 'rows',
        'title': 'Rows',
        'repeat': {'max': 20, 'itemTitle': 'Row {n}'},
        'fields': [number('n', 'Count', 0, 100000)],
      },
      {
        'id': 'meds',
        'title': 'Medication',
        'needs': 'orderMedications',
        'fields': [text('dose', 'Dose'), text('route', 'Route')],
      },
    ],
  };
  // A quick note type whose part maps into a sensitive one (the API's test type `test_sensitive`),
  // which a teammate's note of is hidden from a reader without `patients.view_sensitive`.
  final quickTalkJson = <String, Object?>{
    'key': 'test_quick_talk',
    'version': 1,
    'title': 'Test quick talk',
    'kinds': ['medical'],
    'group': 'clinical',
    'sensitivity': 'none',
    'quick': true,
    'sections': [
      {
        'id': 'talk',
        'title': 'Talk',
        'fields': [text('notes', 'Notes', max: 4000, mapsTo: 'test_sensitive:talk.notes')],
      },
    ],
  };

  late DateTime serverTime;
  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  final all = [
    ...presets.values,
    quickJson,
    fullJson,
    quickTalkJson,
    ...testNoteTypes,
    ...restrictedNoteTypes.where((d) => d['key'] == testSensitive.key),
  ];
  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
    for (final d in all) {
      server.noteTypes[(d['key']! as String, d['version']! as int)] = d;
    }
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {for (final d in all) (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d)};
  NoteTypeDef type(String key) => definitions[(key, 1)]!;

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

  Map<String, Object?> answersOf(TestPhone p, String noteId) => {
    for (final MapEntry(:key, :value) in p.store.record(noteId)!.fields.entries)
      if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
  };

  Map<String, Object?> answersOnServer(String noteId) => {
    for (final MapEntry(:key, :value) in server.records[noteId]!.fields.entries)
      if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
  };

  /// A quick note of [key] with [answers], made through the domain layer as the form saves them.
  Future<String> quickNote(
    EncounterRepository r,
    String visit,
    Map<String, Object?> answers, {
    String key = 'quick_encounter',
  }) async {
    final id = (await r.addNote(visit, type(key))).noteId;
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

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  /// Entry IDs made in turn, as the form's `makeEntryId` would, but known to the test.
  String Function() entryIds(List<String> ids) {
    var i = 0;
    return () => ids[i++];
  }

  const quickGeneral = {
    'visit.parts': ['general', 'wound', 'social_needs'],
    'general.concern': 'Demo: cough for a week',
    'general.hpi': 'yes',
    'general.hpi_details': 'Demo: worse at night',
    'general.bp.systolic': 128,
    'general.bp.diastolic': 82,
    'general.hr': 96,
    'general.temp': 99.1,
    'general.assessment': 'Demo: likely viral',
    'wound.type': 'abscess',
    'wound.location.region': 'legs',
    'wound.location.side': 'left',
    'wound.dimensions.length': 2.5,
    'wound.dimensions.width': 1.5,
    'wound.drainage': 'small',
    'wound.dressing': ['gauze', 'other'],
    'wound.dressing_other': 'Demo: foam pad',
    'social.needs': ['housing', 'id'],
  };

  group('the parts a quick form offers to expand (forms 6.4)', () {
    test('each part, and the full note type its answers map into', () {
      expect(expandTargets(type('quick_encounter')), [
        (section: 'general', noteTypeKey: 'general_primary_care'),
        (section: 'wound', noteTypeKey: 'wound_care'),
        (section: 'social', noteTypeKey: 'social_needs'),
      ]);
      expect(expandTargets(type('test_quick')), [
        (section: 'q', noteTypeKey: 'test_full'),
        (section: 'meds', noteTypeKey: 'test_full'),
        (section: 'other', noteTypeKey: 'test_medical'),
      ]);
      // Only a quick note type maps.
      expect(expandTargets(type('general_primary_care')), isEmpty);
      expect(expandTargets(NoteTypeDef.fromJson({...quickJson, 'quick': false})), isEmpty);
    });

    test('offered on a quick draft the person may change, not on a finished one', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      expect(r.mayExpand((await r.openNote(quick))!), isTrue);
      final general = (await r.addNote(visit, type('general_primary_care'))).noteId;
      expect(r.mayExpand((await r.openNote(general))!), isFalse);
    });
  });

  group('Expand (forms 6.4)', () {
    test('into General: a new note in the visit, every mapped answer in one change, the quick note kept', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      final quickBefore = answersOf(p, quick);
      final before = p.store.outbox().length;
      var changed = 0;
      r.onChanged = () => changed++;

      final done = await r.expand(
        quick,
        type('general_primary_care'),
        newEntryId: entryIds(['e0000001', 'e0000002', 'e0000003']),
        clock: () => added,
      );
      expect([done.existing, done.leftOut, changed], [false, isEmpty, 1]);
      final rec = p.store.record(done.noteId)!;
      expect(
        [rec.attributes['encounterId'], rec.attributes['noteTypeKey'], rec.attributes['noteTypeVersion']],
        [visit, 'general_primary_care', 1],
      );
      final vitals = done.written.keys.firstWhere((k) => k.startsWith('vitals.')).split('.')[1];
      expect(answersOf(p, done.noteId), {
        'reason.concern': 'Demo: cough for a week',
        'hpi.narrative': 'Demo: worse at night',
        'vitals.$vitals.entryAt': added.toIso8601String(),
        'vitals.$vitals.bp.systolic': 128,
        'vitals.$vitals.bp.diastolic': 82,
        'vitals.$vitals.hr': 96,
        'vitals.$vitals.temp': 99.1,
      });
      expect(done.written, answersOf(p, done.noteId));
      // One create carries them; the Red flags note came with the quick note, and no second.
      expect([for (final e in p.store.outbox().skip(before)) (e.recordId, e.op)], [(done.noteId, 'create')]);
      expect(answersOf(p, quick), quickBefore);

      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(answersOnServer(done.noteId), answersOf(p, done.noteId));
      expect(answersOnServer(quick), quickBefore);
    });

    test('into Wound care: the wound a new entry, with its region, measures and dressing', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      final done = await r.expand(
        quick,
        type('wound_care'),
        newEntryId: entryIds(['e0000009', 'e000000a', 'e000000b', 'e000000c']),
        clock: () => added,
      );
      final wound = done.written.keys.firstWhere((k) => k.startsWith('wound.')).split('.')[1];
      expect(answersOf(p, done.noteId), {
        'wound.$wound.entryAt': added.toIso8601String(),
        'wound.$wound.type': 'abscess',
        'wound.$wound.location.region': 'legs',
        'wound.$wound.location.side': 'left',
        'wound.$wound.measurements.length': 2.5,
        'wound.$wound.measurements.width': 1.5,
        'wound.$wound.drainage_amount': 'small',
        'wound.$wound.treatment.dressing': ['gauze', 'other'],
        'wound.$wound.treatment.dressing_other': 'Demo: foam pad',
      });
      // Exactly what the interpreter writes for that entry (7.1).
      final quickDefinition = type('quick_encounter');
      final expected = expandQuick(quickDefinition, answersOf(p, quick), type('wound_care'), {
        for (final s in type('wound_care').sections)
          if (s.repeat != null) s.id: (id: wound, at: added.toIso8601String()),
      });
      expect(done.written, expected.answers);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(answersOnServer(done.noteId), answersOf(p, done.noteId));
    });

    test('into Social needs, a Non-Medical note, in the Medical visit', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      final done = await r.expand(quick, type('social_needs'));
      expect(answersOf(p, done.noteId), {
        'needs.needs': ['housing', 'id'],
      });
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(server.records[done.noteId]!.author, alex);
    });

    test('a correction of the full note before its sync reads each answer at the version its create gave it '
        '(review LCM-5)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, {
        'visit.parts': ['social_needs'],
        'social.needs': ['housing', 'id'],
      });
      final done = await r.expand(quick, type('social_needs'));
      final own = (await r.ownRedFlagsNote(visit))!;
      await r.openNote(own);
      r.saveAnswer(own, 'red_flags.emergency', 'no');
      r.complete((await r.openComplete(visit))!);
      await r.correct(
        visit,
        done.noteId,
        changes: {
          'needs.needs': ['housing'],
        },
        reason: 'Demo: ID came through',
      );
      final correction = p.store.outbox().lastWhere((e) => e.entity == entityCorrection);
      expect((correction.value! as Map)['changes'], [
        {
          'field': 'data.needs.needs',
          'newValue': ['housing'],
          'baseVersion': 1,
        },
      ]);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(answersOnServer(done.noteId), {
        'needs.needs': ['housing'],
      });
    });

    test('opening their own Medical draft of the full type brings their Red flags note, if they have none '
        '(review LFM-4)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      // Made before the app added the Red flags note with a Medical note: neither brought one.
      final quick = p.store.createNote(
        encounterId: visit,
        noteTypeKey: 'quick_encounter',
        noteTypeVersion: 1,
        data: const {
          'visit.parts': ['general'],
          'general.concern': 'Demo: cough for a week',
        },
      );
      final full = p.store.createNote(
        encounterId: visit,
        noteTypeKey: 'general_primary_care',
        noteTypeVersion: 1,
        data: const {'reason.concern': 'Demo: sore knee'},
      );
      expect(await r.ownRedFlagsNote(visit), isNull);
      final done = await r.expand(quick, type('general_primary_care'));
      expect([done.noteId, done.existing, done.written], [full, true, isEmpty]);
      expect(await r.ownRedFlagsNote(visit), isNotNull);
    });

    test('a part expanded again opens its note as it is; an empty draft of the type of theirs is filled', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      // Nothing of the type yet: Expand would copy (the form says so, review LFM-5).
      expect(await r.expandOpensAsItIs(quick, type('social_needs')), isFalse);
      // An empty draft of theirs, added by mistake: Expand fills it rather than make a second.
      final empty = (await r.addNote(visit, type('social_needs'))).noteId;
      expect(await r.expandOpensAsItIs(quick, type('social_needs')), isFalse);
      final first = await r.expand(quick, type('social_needs'));
      expect([first.noteId, first.existing], [empty, false]);
      expect(answersOf(p, empty), {
        'needs.needs': ['housing', 'id'],
      });

      // Once it holds answers it opens as it is: the quick answers are not written over it twice.
      await r.openNote(empty);
      r.saveAnswer(empty, 'needs.needs', ['housing']);
      final before = p.store.outbox().length;
      expect(await r.expandOpensAsItIs(quick, type('social_needs')), isTrue);
      final again = await r.expand(quick, type('social_needs'));
      expect([again.noteId, again.existing, again.written, again.leftOut], [empty, true, isEmpty, isEmpty]);
      expect(p.store.outbox(), hasLength(before));
      expect(answersOf(p, empty), {
        'needs.needs': ['housing'],
      });
      server.offline = false;
      await sync(p);
      serverTookAll(p);
    });

    test('a finished note of the type opens read-only and nothing is copied, their own or a teammate’s, '
        'rather than an empty draft of theirs filled beside it (12.1 #30)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      // Their Social needs note, finished before the quick note was started.
      final social = (await r.addNote(visit, type('social_needs'))).noteId;
      await r.openNote(social);
      r.saveAnswer(social, 'needs.needs', ['food']);
      r.complete((await r.openComplete(visit))!);
      final quick = await quickNote(r, visit, quickGeneral);
      // An empty draft of the type, added by mistake: filled, it would chart the needs a second time.
      final empty = (await r.addNote(visit, type('social_needs'), another: true)).noteId;
      expect(await r.expandOpensAsItIs(quick, type('social_needs')), isTrue);
      final before = p.store.outbox().length;
      final done = await r.expand(quick, type('social_needs'));
      expect(
        [done.noteId, done.existing, done.finished, done.written, done.leftOut, done.notCopied],
        [social, true, true, isEmpty, isEmpty, isEmpty],
      );
      expect(p.store.outbox(), hasLength(before));
      expect(
        [answersOf(p, social), answersOf(p, empty)],
        [
          {
            'needs.needs': ['food'],
          },
          isEmpty,
        ],
      );
      expect((await r.openNote(social))!.editable, isFalse);
      server.offline = false;
      await sync(p);
      serverTookAll(p);

      // A teammate's quick note on the visit opens the same finished note, theirs to read.
      final b = phone(blair);
      final rb = repo(b);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', social), isTrue);
      server.offline = true;
      final theirs = await quickNote(rb, visit, quickGeneral);
      expect(await rb.expandOpensAsItIs(theirs, type('social_needs')), isTrue);
      final opened = await rb.expand(theirs, type('social_needs'));
      expect([opened.noteId, opened.existing, opened.finished, opened.written], [social, true, true, isEmpty]);
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(answersOnServer(social), {
        'needs.needs': ['food'],
      });
    });

    test('a visit read that shows a finished Red flags note the phone doesn’t hold brings no second one, '
        'as Add note takes it (forms 6.2)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      await sync(p);
      // A teammate's Red flags note, finished on the server: the visit read shows it, the phone holds none.
      server.finishNote(
        server.seed(entityNote, {
          'encounterId': visit,
          'noteTypeKey': 'red_flags_disposition',
          'noteTypeVersion': 1,
          'data': {'red_flags.emergency': 'no'},
        }, by: blair),
        status: 'signed',
      );
      server.offline = true;
      final quick = (await r.addNote(visit, type('quick_encounter'), redFlagsFinished: true)).noteId;
      await r.openNote(quick);
      r.saveAnswer(quick, 'visit.parts', ['general']);
      r.saveAnswer(quick, 'general.concern', 'Demo: cough for a week');
      final done = await r.expand(quick, type('general_primary_care'), redFlagsFinished: true);
      expect([done.existing, answersOf(p, done.noteId)['reason.concern']], [false, 'Demo: cough for a week']);
      expect(await r.ownRedFlagsNote(visit), isNull);
      // Completed with the teammate's Red flags note as the visit read shows it, then expanded into again
      // from a second quick note: the finished note opens to be read, and brings no Red flags note.
      final plan = (await r.openComplete(visit, redFlagsFinished: true))!;
      expect([plan.stops, for (final n in plan.notes) n.noteId], [isEmpty, quick, done.noteId]);
      r.complete(plan);
      final second = (await r.addNote(visit, type('quick_encounter'), another: true, redFlagsFinished: true)).noteId;
      await r.openNote(second);
      r.saveAnswer(second, 'visit.parts', ['general']);
      r.saveAnswer(second, 'general.concern', 'Demo: cough still');
      final again = await r.expand(second, type('general_primary_care'));
      expect([again.noteId, again.existing, again.finished], [done.noteId, true, true]);
      expect(await r.ownRedFlagsNote(visit), isNull);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(answersOnServer(done.noteId)['reason.concern'], 'Demo: cough for a week');
    });

    test('a finished note of the type that the visit read shows, and the phone doesn’t hold, opens from that '
        'read and nothing is copied (12.1 #30)', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final ra = repo(a);
      final visit = ra.startEncounter(kind: VisitKind.medical, patientId: patient);
      final social = (await ra.addNote(visit, type('social_needs'))).noteId;
      await ra.openNote(social);
      ra.saveAnswer(social, 'needs.needs', ['food']);
      ra.complete((await ra.openComplete(visit))!);
      await sync(a);
      serverTookAll(a);

      // Blair's phone brings the visit on to chart on it, not Alex's finished note.
      final b = phone(blair);
      final rb = repo(b);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      server.offline = true;
      final quick = await quickNote(rb, visit, quickGeneral);
      expect(b.store.record(social), isNull);
      // The visit as the chart's cache read it, as the server answers it (5.1): Alex's note, completed.
      VisitView readOf(String encounterId) => visitFromRead(
        VisitRead.fromJson(
          visitJson(
            encounterId: encounterId,
            patientId: patient,
            notes: [
              visitNoteJson(
                noteId: social,
                author: userRef(alex, 'Demo Alex'),
                key: 'social_needs',
                title: 'Social needs',
                group: 'social',
              ),
            ],
          ),
        ),
        source: VisitSource.chart,
        user: rb.user,
        definitionOf: (key, version) => definitions[(key, version)],
      );
      final read = readOf(visit);
      expect(await rb.expandOpensAsItIs(quick, type('social_needs'), visitRead: read), isTrue);
      // Another visit's read says nothing of this one.
      expect(await rb.expandOpensAsItIs(quick, type('social_needs'), visitRead: readOf(patient)), isFalse);
      final before = b.store.outbox().length;
      final done = await rb.expand(quick, type('social_needs'), visitRead: read);
      expect(
        [done.noteId, done.existing, done.finished, done.written, done.leftOut, done.notCopied],
        [social, true, true, isEmpty, isEmpty, isEmpty],
      );
      expect([b.store.outbox(), b.store.record(social)], [hasLength(before), isNull]);
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(
        [
          for (final r in server.records.values)
            if (r.entity == entityNote && r.attributes['noteTypeKey'] == 'social_needs') r.id,
        ],
        [social],
      );
      expect(answersOnServer(social), {
        'needs.needs': ['food'],
      });
    });

    test('a teammate’s finished note of the type that the person may not read is not opened: Expand makes '
        'a note of their own (forms 6.4, 12.1 #30)', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final ra = repo(a);
      final visit = ra.startEncounter(kind: VisitKind.medical, patientId: patient);
      final theirs = (await ra.addNote(visit, type(testSensitive.key))).noteId;
      await ra.openNote(theirs);
      ra.saveAnswer(theirs, 'talk.notes', 'Demo: talked about sleep');
      ra.complete((await ra.openComplete(visit))!);
      await sync(a);
      serverTookAll(a);

      final b = phone(blair);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', theirs), isTrue);
      // Their role no longer reads sensitive notes: the phone holds Alex's, which is not theirs to see.
      final rb = repo(b, permissions: staff.difference({'patients.view_sensitive'}));
      server.offline = true;
      final quick = await quickNote(rb, visit, {
        'talk.notes': 'Demo: slept outside',
      }, key: quickTalkJson['key']! as String);
      // The chart's cache, read while their role still read it, shows it too: the phone's copy decides.
      final cached = visitFromRead(
        VisitRead.fromJson(
          visitJson(
            encounterId: visit,
            patientId: patient,
            notes: [
              visitNoteJson(
                noteId: theirs,
                author: userRef(alex, 'Demo Alex'),
                key: testSensitive.key,
                title: 'Test sensitive',
                group: 'psych',
              ),
            ],
          ),
        ),
        source: VisitSource.chart,
        user: rb.user,
        definitionOf: (key, version) => definitions[(key, version)],
      );
      expect(await rb.expandOpensAsItIs(quick, type(testSensitive.key)), isFalse);
      expect(await rb.expandOpensAsItIs(quick, type(testSensitive.key), visitRead: cached), isFalse);
      final done = await rb.expand(quick, type(testSensitive.key), visitRead: cached);
      expect(
        [done.noteId == theirs, done.existing, done.finished, done.written],
        [
          false,
          false,
          false,
          {'talk.notes': 'Demo: slept outside'},
        ],
      );
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(
        [answersOnServer(theirs), answersOnServer(done.noteId)],
        [
          {'talk.notes': 'Demo: talked about sleep'},
          {'talk.notes': 'Demo: slept outside'},
        ],
      );
    });

    test('once a removed note’s fix has settled, Add note and Expand open the draft with answers made after it, '
        'not the removed empty one (lifecycle 3.3, 12.1 #30)', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final removed = (await r.addNote(visit, type('social_needs'))).noteId;
      await r.openNote(removed);
      r.saveAnswer(removed, 'needs.needs', ['food']);
      await sync(p);
      // A teammate's change the phone hasn't seen: the Complete is refused content_changed.
      server.serverEdit(removed, 'data.needs.needs', ['food', 'housing'], by: blair);
      r.complete((await r.openComplete(visit))!);
      await sync(p);
      expect(p.store.needsAttention(), hasLength(1));
      server.offline = true;
      await r.removeNote(removed);
      final charted = await r.addNote(visit, type('social_needs'));
      expect([charted.noteId == removed, charted.existing], [false, false]);
      await r.openNote(charted.noteId);
      r.saveAnswer(charted.noteId, 'needs.needs', ['housing']);
      // Made after the removed note, on the phone and the server alike, so it comes after it in the
      // visit's order.
      serverTime = serverTime.add(const Duration(minutes: 10));
      p.advance(const Duration(minutes: 10));
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect([server.records[removed]!.status, answersOnServer(removed)], ['draft', isEmpty]);

      // The removed note stays an empty draft of theirs: the one with answers opens before it.
      server.offline = true;
      expect(await r.addNote(visit, type('social_needs')), (noteId: charted.noteId, existing: true));
      final quick = await quickNote(r, visit, quickGeneral);
      expect(await r.expandOpensAsItIs(quick, type('social_needs')), isTrue);
      final done = await r.expand(quick, type('social_needs'));
      expect([done.noteId, done.existing, done.written], [charted.noteId, true, isEmpty]);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
      expect(
        [answersOnServer(removed), answersOnServer(charted.noteId)],
        [
          isEmpty,
          {
            'needs.needs': ['housing'],
          },
        ],
      );
    });

    test('answers the full note type doesn’t take are left out and listed; the rest are written', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final long = 'Demo: ${'x' * 250}';
      final quick = await quickNote(r, visit, {
        'q.pulse': 96,
        'q.temp': 98.6,
        'q.followup': long,
        'q.count': 3,
        'q.aside': 'Demo: not mapped',
      }, key: 'test_quick');
      final done = await r.expand(quick, type('test_full'), newEntryId: entryIds(['e0000001']), clock: () => added);
      expect(answersOf(p, done.noteId), {
        'vitals.pulse': 96,
        'rows.e0000001.entryAt': added.toIso8601String(),
        'rows.e0000001.n': 3,
      });
      expect(
        [for (final l in done.leftOut) (l.path, l.target, l.problem, l.label)],
        [
          ('q.temp', 'vitals.temp_c', 'wrong_type', 'Temperature'),
          ('q.followup', 'care.followup', 'too_long', 'Follow-up'),
        ],
      );
      expect(answersOf(p, quick)['q.temp'], 98.6);
      server.offline = false;
      await sync(p);
      serverTookAll(p);
    });

    test('a part that needs an ordering credential is carried only by one that may order', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, {'q.pulse': 96, 'meds.dose': 'Demo: 500 mg'}, key: 'test_quick');
      await sync(p);

      // A student can't chart the Medication part: it is not carried, and they are told so.
      final b = phone(blair);
      final student = repo(b, credential: 'student');
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', quick), isTrue);
      server.offline = true;
      final byStudent = await student.expand(quick, type('test_full'));
      expect(answersOf(b, byStudent.noteId), {'vitals.pulse': 96});
      expect(byStudent.notCopied, ['meds.dose']);
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(server.records[byStudent.noteId]!.author, blair);

      // One who may order carries it.
      final again = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final second = await quickNote(r, again, {'q.pulse': 96, 'meds.dose': 'Demo: 500 mg'}, key: 'test_quick');
      final byAttending = await r.expand(second, type('test_full'));
      expect(answersOf(p, byAttending.noteId), {'vitals.pulse': 96, 'meds.dose': 'Demo: 500 mg'});
      expect(byAttending.notCopied, isEmpty);
      await sync(p);
      serverTookAll(p);
    });

    test('an answer the server would hold from them refuses Expand, writing nothing', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, {'q.pulse': 96, 'q.route': 'Demo: by mouth'}, key: 'test_quick');
      await sync(p);
      final b = phone(blair);
      final student = repo(b, credential: 'student');
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', quick), isTrue);
      await expectLater(student.expand(quick, type('test_full')), refused('read_only'));
      expect(b.store.outbox(), isEmpty);
      // One who may order carries it.
      final done = await r.expand(quick, type('test_full'));
      expect(answersOf(p, done.noteId), {'vitals.pulse': 96, 'meds.route': 'Demo: by mouth'});
      await sync(p);
      serverTookAll(p);
    });

    test('a teammate’s quick draft: the new note is theirs, with a Red flags note of their own', () async {
      final a = phone(alex);
      final patient = server.seedPatient();
      final visit = repo(a).startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(repo(a), visit, quickGeneral);
      await sync(a);

      final b = phone(blair);
      final r = repo(b);
      expect(await b.engine.openServerRecord('encounter', visit), isTrue);
      expect(await b.engine.openServerRecord('encounter_note', quick), isTrue);
      server.offline = true;
      final done = await r.expand(quick, type('general_primary_care'));
      expect(b.store.record(done.noteId)!.authorUserId, blair);
      expect(await r.ownRedFlagsNote(visit), isNotNull);
      server.offline = false;
      await sync(b);
      serverTookAll(b);
      expect(server.records[done.noteId]!.author, blair);
      expect(answersOnServer(done.noteId)['reason.concern'], 'Demo: cough for a week');
    });

    test('what Expand refuses, writing nothing', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, quickGeneral);
      await sync(p);

      // A note type the quick form maps nothing into, and a note that is not quick.
      await expectLater(r.expand(quick, type('harm_reduction')), throwsArgumentError);
      final general = (await r.addNote(visit, type('general_primary_care'))).noteId;
      final before = p.store.outbox().length;
      await expectLater(r.expand(general, type('wound_care')), throwsArgumentError);
      // A role that doesn't chart, and a credential that doesn't chart Medical notes.
      await expectLater(
        repo(p, credential: 'chw', permissions: FakeSyncServer.chw).expand(quick, type('social_needs')),
        refused('not_charting'),
      );
      await expectLater(repo(p, credential: 'none').expand(quick, type('wound_care')), refused('medical_credential'));
      expect(p.store.outbox(), hasLength(before));
      // A quick note on a visit that is not Medical, as another client might have left it: a Medical
      // note goes only on a Medical visit.
      final social = r.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
      final stray = p.store.createNote(
        encounterId: social,
        noteTypeKey: 'quick_encounter',
        noteTypeVersion: 1,
        data: const {
          'visit.parts': ['general'],
          'general.hr': 96,
        },
      );
      final afterStray = p.store.outbox().length;
      await expectLater(r.expand(stray, type('general_primary_care')), refused('not_offered'));
      expect(p.store.outbox(), hasLength(afterStray));

      // While the clock check fails, and while the store is frozen.
      server.offline = true;
      p.wall = p.wall.add(const Duration(minutes: 10));
      expect(p.clock.status.paused, isTrue);
      await expectLater(r.expand(quick, type('wound_care')), throwsA(isA<ChartingPaused>()));
      p.wall = p.wall.subtract(const Duration(minutes: 10));
      p.store.freeze('Demo: handing over');
      await expectLater(r.expand(quick, type('wound_care')), throwsA(isA<ChartingPaused>()));
      await expectLater(r.expand(quick, type('social_needs')), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), hasLength(afterStray));
    });

    test('a finished quick note is not expanded', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      server.offline = true;
      final r = repo(p);
      final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
      final quick = await quickNote(r, visit, {
        'visit.parts': ['social_needs'],
        'social.needs': ['housing'],
      });
      final own = (await r.ownRedFlagsNote(visit))!;
      await r.openNote(own);
      r.saveAnswer(own, 'red_flags.emergency', 'no');
      r.complete((await r.openComplete(visit))!);
      expect(r.mayExpand((await r.openNote(quick))!), isFalse);
      final before = p.store.outbox().length;
      await expectLater(r.expand(quick, type('social_needs')), throwsA(isA<RecordLocked>()));
      expect(p.store.outbox(), hasLength(before));
      server.offline = false;
      await sync(p);
      serverTookAll(p);
    });
  });
}
