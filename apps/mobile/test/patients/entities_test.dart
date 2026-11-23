import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/entities.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';

/// The phone's entity registry against the shared vectors (packages/contract/test-vectors/
/// sync-values.json), which the API's Zod schemas pass too: the same values are valid, an invalid
/// one fails at the same issue paths or breaks the same named rule, and every valid change names
/// the same parents. The fake server checks values with this registry, so it is pinned as well.
///
/// Phase 5's flag change (design 4.5, 6.2) is written ahead of P5-phone-entity: its cases, and the
/// vectors' flag change cases this reader runs, fail until that card registers it.

void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/sync-values.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final today = vectors['today']! as String;
  List<Map<String, Object?>> cases(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();

  /// Where [c]'s value breaks its schema, as the API's contract test reads Zod's issues.
  Set<String> issuesOf(Map<String, Object?> c) {
    final entity = c['entity']! as String;
    if (entity == entityAudit) return auditIssues(c['value']);
    final rules = rulesFor(entity)!;
    return c['op'] == 'create' ? rules.createIssues(c['value']) : rules.fieldIssues(c['field']! as String, c['value'])!;
  }

  String? problemOf(Map<String, Object?> c) {
    final rules = rulesFor(c['entity']! as String);
    return rules?.valueProblem(c['op']! as String, c['field'] as String?, c['value'], today);
  }

  test('the vectors cover every patient-side entity, valid and invalid', () {
    // The flag change's own group below holds its cases (phase 5 design 6.2).
    final patientSide = [
      for (final e in recordEntities)
        if (rulesFor(e)!.patientSide && e != 'patient_flag_change') e,
    ];
    expect(patientSide, hasLength(11));
    for (final entity in patientSide) {
      expect(cases('valid').any((c) => c['entity'] == entity), isTrue, reason: entity);
      expect(cases('invalid').any((c) => c['entity'] == entity), isTrue, reason: entity);
    }
  });

  for (final c in cases('valid')) {
    test('accepts ${c['name']}, with its parents', () {
      expect(issuesOf(c), isEmpty);
      expect(problemOf(c), isNull);
      if (c['op'] != 'append') {
        final parents = parentsOf(
          entity: c['entity']! as String,
          op: c['op']! as String,
          field: c['field'] as String?,
          value: c['value'],
        );
        expect([
          for (final p in parents) {'entity': p.entity, 'id': p.id},
        ], c['parents']);
      }
    });
  }

  for (final c in cases('invalid')) {
    test('refuses ${c['name']}', () {
      final expected = c['expect']! as Map<String, Object?>;
      final paths = expected['paths'] as List<Object?>?;
      if (paths != null) {
        expect(issuesOf(c).toList()..sort(), paths);
      } else {
        expect(issuesOf(c), isEmpty);
        expect(problemOf(c), expected['problem']);
      }
    });
  }

  test('the clock pause covers problems, their notes and ID links, never registering someone (D35)', () {
    final paused = {
      for (final e in recordEntities)
        if (e != 'patient_flag_change') e: rulesFor(e)!.pausesWithClock,
    };
    expect(paused, {
      entityEncounter: true,
      entityNote: true,
      entityPatient: false,
      entityAlias: false,
      entityAllergy: false,
      entityConsent: false,
      entityProblem: true,
      entityProblemNote: true,
      entityIdLink: true,
      // A signature, an addendum and a correction are dated by the clock; a referral's date is typed
      // (lifecycle 3.11).
      entitySignoff: true,
      entityAddendum: true,
      entityCorrection: true,
      entityReferral: false,
    });
  });

  test('each change needs the catalog key the API names (D37)', () {
    String key(String entity, String op, [String? field]) => rulesFor(entity)!.permission(op, field);
    for (final entity in [entityPatient, entityAlias, entityConsent, entityIdLink]) {
      expect(key(entity, 'create'), 'patients.edit', reason: entity);
    }
    expect(key(entityPatient, 'set', 'usualArea'), 'patients.edit');
    expect(key(entityAlias, 'set', 'removal'), 'patients.edit');
    expect(key(entityAllergy, 'create'), 'patients.edit');
    expect(key(entityAllergy, 'set', 'enteredInError'), 'encounters.chart');
    for (final entity in [entityProblem, entityProblemNote, entityEncounter, entityNote]) {
      expect(key(entity, 'create'), 'encounters.chart', reason: entity);
    }
    expect(key(entityProblem, 'set', 'enteredInError'), 'encounters.chart');
    for (final entity in [entitySignoff, entityAddendum, entityCorrection]) {
      expect(key(entity, 'create'), 'encounters.chart', reason: entity);
    }
    expect(key(entityEncounter, 'set', 'kind'), 'encounters.chart');
    expect(key(entityReferral, 'create'), 'referrals.create');
    expect(key(entityReferral, 'set', 'enteredInError'), 'referrals.create');
  });

  test('categories group the unsynced summary', () {
    expect(categoryOf(entityPatient), 'patients');
    expect(categoryOf(entityIdLink), 'patients');
    expect(categoryOf(entityProblemNote), 'problems');
    expect(categoryOf(entityAudit), 'activity');
    expect(categoryOf(entityEncounter), 'encounters');
    for (final entity in [entityNote, entitySignoff, entityAddendum, entityCorrection]) {
      expect(categoryOf(entity), 'notes', reason: entity);
    }
    expect(categoryOf(entityReferral), 'patients');
  });

  test('field classes follow the design (2.4)', () {
    final patient = rulesFor(entityPatient)!;
    expect(patient.fieldClass('legalName'), FieldClass.identity);
    expect(patient.fieldClass('birth'), FieldClass.identity);
    expect(patient.fieldClass('usualArea'), FieldClass.keepBoth);
    expect(patient.fieldClass('allergyScreen'), FieldClass.keepBoth);
    expect(rulesFor(entityProblem)!.fieldClass('status'), FieldClass.status);
    expect(rulesFor(entityProblem)!.fieldClass('enteredInError'), FieldClass.setOnce);
    expect(rulesFor(entityAlias)!.fieldClass('removal'), FieldClass.setOnce);
    expect(rulesFor(entityConsent)!.settable('decision'), isFalse);
    expect(rulesFor(entityNote)!.fieldClass('data.vitals.temp_c'), FieldClass.draft);
    // Their own rules (lifecycle 4.3, 4.4): a note's status is the reopen, a visit's kind goes one way.
    expect(rulesFor(entityNote)!.fieldClass('status'), FieldClass.status);
    expect(rulesFor(entityEncounter)!.fieldClass('kind'), FieldClass.status);
    expect(rulesFor(entityReferral)!.fieldClass('enteredInError'), FieldClass.setOnce);
    for (final entity in [entitySignoff, entityAddendum, entityCorrection]) {
      expect(rulesFor(entity)!.settable('status'), isFalse, reason: entity);
    }
  });

  group('the encounter (lifecycle 4.3)', () {
    final encounter = rulesFor(entityEncounter)!;

    test('its place, summary and kind are fields, and its status is not', () {
      expect(encounter.settable('status'), isFalse);
      for (final field in ['patientId', 'location', 'locationText', 'summary']) {
        expect(encounter.fieldClass(field), FieldClass.draft, reason: field);
      }
      expect(encounter.createdFields({'kind': 'non_medical', 'patientId': 'p', 'locationText': 'Demo: lot'}), {
        'patientId': 'p',
        'location': null,
        'locationText': 'Demo: lot',
        'kind': 'non_medical',
      });
      // What the server keeps with an encounter (its start) the phone does not make up.
      expect(encounter.attributes({'kind': 'medical'}), isEmpty);
      expect(encounter.statusAfter('kind', 'medical'), isNull);
    });

    // The values of sync-encounters.test.ts, 'a summary holds 1 to 4,000 characters and a place 1 to
    // 200, with no space at either end'.
    test('a summary holds 1 to 4,000 characters and a place 1 to 200, with no space at either end', () {
      for (final (field, value) in [
        ('summary', ''),
        ('summary', 'x' * 4001),
        ('summary', ' Demo: a space before'),
        ('summary', 'Demo: a line end after\n'),
        ('summary', 42),
        ('locationText', ''),
        ('locationText', 'y' * 201),
        ('locationText', 'Demo: a space after '),
        ('kind', 'telehealth'),
        ('kind', null),
      ]) {
        expect(encounter.fieldIssues(field, value), {''}, reason: '$field $value');
      }
      for (final (field, value) in [
        ('summary', 'Demo:${'é' * 3995}'),
        ('summary', null),
        ('locationText', 'Demo:${'y' * 195}'),
        ('locationText', null),
        ('kind', 'medical'),
        ('kind', 'non_medical'),
      ]) {
        expect(encounter.fieldIssues(field, value), isEmpty, reason: '$field $value');
      }
      expect(encounter.createIssues({'kind': 'non_medical', 'locationText': 'Demo: by the river steps'}), isEmpty);
      for (final locationText in ['', 'y' * 201, ' Demo: padded']) {
        expect(encounter.createIssues({'kind': 'medical', 'locationText': locationText}), {'locationText'});
      }
      // The summary is written on the summary screen, never with the create.
      expect(encounter.createIssues({'kind': 'medical', 'summary': 'Demo: early'}), {''});
    });
  });

  test('a note’s status takes draft only from the phone, and a note holds up to 1,000 answers (lifecycle 4.4)', () {
    final note = rulesFor(entityNote)!;
    expect(note.fieldIssues('status', 'draft'), isEmpty);
    // Complete is a sign-off, and only a sign-off signs.
    expect(note.fieldIssues('status', 'completed'), {''});
    expect(note.fieldIssues('status', 'signed'), {''});
    expect(maxNoteFields, 1000);
  });

  test('a new record’s patient is the one it names, or the one of the record it is about (lifecycle 4.8)', () {
    final [patient, encounter, note, signoff] = [
      '5eed0000-0000-4000-8000-000000000001',
      '0e0e0000-0000-4000-8000-000000000001',
      'a0a00000-0000-4000-8000-000000000001',
      'b5b50000-0000-4000-8000-000000000001',
    ];
    final referral = {'patientId': patient, 'referredOn': '2026-10-22', 'details': 'Demo: dental', 'encounterId': null};
    expect(rulesFor(entityReferral)!.patientOfCreate('r', referral), patient);
    expect(rulesFor(entityReferral)!.patientVia(referral), isNull);
    expect(rulesFor(entitySignoff)!.patientVia({'noteId': note}), (entity: entityNote, id: note));
    expect(rulesFor(entityCorrection)!.patientVia({'noteId': note, 'signoffId': signoff}), (
      entity: entityNote,
      id: note,
    ));
    // An addendum names its visit even when it is about a note of it.
    expect(rulesFor(entityAddendum)!.patientVia({'encounterId': encounter, 'noteId': note}), (
      entity: entityEncounter,
      id: encounter,
    ));
    expect(rulesFor(entityNote)!.patientVia({'encounterId': encounter}), (entity: entityEncounter, id: encounter));
    expect(rulesFor(entityProblemNote)!.patientVia({'problemId': 'q'}), (entity: entityProblem, id: 'q'));
    for (final entity in [entitySignoff, entityAddendum, entityCorrection]) {
      expect(rulesFor(entity)!.patientOfCreate('r', {'noteId': note, 'encounterId': encounter}), isNull);
    }
    expect(rulesFor(entityPatient)!.patientVia({}), isNull);
  });

  test('a new record starts as the phone knows it: a sign-off and a correction wait for the server’s answer', () {
    expect(rulesFor(entitySignoff)!.initialStatus({}), 'pending');
    expect(rulesFor(entityCorrection)!.initialStatus({}), 'pending');
    expect(rulesFor(entityAddendum)!.initialStatus({}), 'written');
    expect(rulesFor(entityReferral)!.initialStatus({}), 'active');
    expect(
      rulesFor(entityReferral)!.statusAfter('enteredInError', const {'reason': 'Wrong patient'}),
      'entered_in_error',
    );
    for (final entity in [entitySignoff, entityAddendum, entityCorrection, entityReferral]) {
      expect(rulesFor(entity)!.createdFields(const {}), isEmpty, reason: entity);
    }
  });

  // Beyond the shared vectors: where Zod 4 runs a refinement and where it does not, as the API's
  // NoteCorrectionCreate and NoteSignoffCreate answered each of these values.
  test('a correction or a sign-off fails at the paths the API names, its refinements included', () {
    const note = 'a0a00000-0000-4000-8000-000000000001';
    final base = <String, Object?>{
      'noteId': note,
      'changes': [
        {'field': 'data.care.plan', 'newValue': 'Demo: rest', 'baseVersion': 1},
      ],
      'reason': 'Demo: typo',
      'requestedByPatient': false,
      'declined': false,
      'claimedCredential': null,
      'signoffId': null,
    };
    Map<String, Object?> change(String? field, {Object? newValue = 1, Object? baseVersion = 1, bool hasValue = true}) =>
        {'field': ?field, if (hasValue) 'newValue': newValue, 'baseVersion': baseVersion};
    Set<String> issues(Map<String, Object?> v) => rulesFor(entityCorrection)!.createIssues({...base, ...v});

    expect(issues({}), isEmpty);
    expect(issues({'changes': <Object?>[]}), {'changes'});
    // A missing new value is refused by its refinement, so the object's own still runs.
    expect(
      issues({
        'declined': true,
        'changes': [change('data.a', hasValue: false)],
      }),
      {'changes.0.newValue', 'declined'},
    );
    expect(
      issues({
        'changes': [change('data.a', newValue: null)],
      }),
      isEmpty,
    );
    // A value of the wrong type stops the list's refinement; a field that is no answer does not.
    expect(
      issues({
        'changes': [change('data.a'), change('data.a', baseVersion: 'x')],
      }),
      {'changes.1.baseVersion'},
    );
    expect(
      issues({
        'changes': [change('nope'), change('nope')],
      }),
      {'changes.0.field', 'changes.1.field', 'changes'},
    );
    expect(
      issues({
        'changes': [change(null, hasValue: false), change(null, hasValue: false)],
      }),
      {'changes.0.field', 'changes.0.newValue', 'changes.1.field', 'changes.1.newValue'},
    );
    expect(issues({'declined': true, 'reason': 'x'}), {'reason', 'declined'});
    expect(issues({'declined': true, 'requestedByPatient': 'yes'}), {'requestedByPatient'});
    expect(
      rulesFor(entitySignoff)!.createIssues({
        'noteId': note,
        'act': 'complete',
        'contentHash': 'AB',
        'claimedCredential': 'attending',
        'statementVersion': 'complete-2026-11',
      }),
      {'contentHash', 'claimedCredential'},
    );
  });

  test('a phone logs the EMS handoff it showed and the notes to finish it listed (lifecycle 4.8)', () {
    expect(auditActions, containsAll(['ems_handoff.shown', 'notes_to_finish.viewed']));
    expect(auditActions, isNot(contains('ems_handoff.exported')));
  });

  test('a fill keeps what was recorded; an estimate is refined only within ESTIMATE_RANGE', () {
    expect(fills('legalName', {'given': 'Del', 'family': null}, {'given': 'Del', 'family': 'Moreno'}), isTrue);
    expect(fills('legalName', {'given': 'Del', 'family': null}, {'given': 'Dell', 'family': 'Moreno'}), isFalse);
    expect(fills('birth', {'precision': 'year', 'year': 1980}, {'precision': 'day', 'date': '1980-04-02'}), isTrue);
    expect(fills('birth', {'precision': 'year', 'year': 1980}, {'precision': 'day', 'date': '1981-04-02'}), isFalse);
    final estimate = {'precision': 'estimated', 'year': 1980};
    expect(fills('birth', estimate, {'precision': 'year', 'year': 1983}), isTrue);
    expect(fills('birth', estimate, {'precision': 'year', 'year': 1984}), isFalse);
    expect(refinedOutOfRange(estimate, {'precision': 'year', 'year': 1984}), isTrue);
    expect(
      fills('birth', {'precision': 'day', 'date': '1980-04-02'}, {'precision': 'day', 'date': '1980-04-03'}),
      isFalse,
    );
    expect(fills('legalName', {'given': 'Del', 'family': null}, null), isFalse);
  });

  test('a create sets its fields at version 1 the way the server does, defaults included', () {
    final patient = rulesFor(entityPatient)!.createdFields({'preferredName': 'Del'});
    expect(patient['preferredName'], 'Del');
    expect(patient['allergyScreen'], 'not_asked');
    expect(patient['idCardChoice'], 'not_asked');
    expect(patient.keys, hasLength(9));
    expect(rulesFor(entityProblem)!.createdFields({'status': 'new', 'patientId': 'x'}), {
      'status': {'status': 'new', 'encounterId': null},
    });
    expect(rulesFor(entityAlias)!.createdFields({'patientId': 'x', 'alias': 'Dee'}), isEmpty);
    // An ID link's token is in the change, never in the record.
    expect(rulesFor(entityIdLink)!.attributes({'patientId': 'x', 'token': 't', 'reason': 'lost'}), {
      'patientId': 'x',
      'reason': 'lost',
    });
  });

  // Phase 5 (design 4.5, 6.2): services/api/src/sync/entities/patient-flag-change.ts and values.ts
  // hold the server's side; sync-flag-change.test.ts the same rules through a push.
  group('the flag change (phase 5 design 6.2)', () {
    const patient = '5eed0000-0000-4000-8000-000000000001';
    const high = 'f1a90000-0000-4000-8000-000000000001';
    const change = 'c4a90000-0000-4000-8000-000000000001';
    Map<String, Object?> setHigh({String reason = 'Demo: missed two follow-ups this month'}) => {
      'patientId': patient,
      'flagId': high,
      'action': 'set',
      'reason': reason,
    };

    test('the vectors cover the flag change, valid and invalid, its reason’s rule among them', () {
      expect(cases('valid').where((c) => c['entity'] == entityFlagChange), isNotEmpty);
      expect(cases('invalid').where((c) => c['entity'] == entityFlagChange), isNotEmpty);
      expect(
        cases('invalid').where((c) => (c['expect']! as Map<String, Object?>)['problem'] == 'reason_invalid'),
        isNotEmpty,
      );
    });

    test('is the server’s patient_flag_change: about its patient, set once, and paused with the clock', () {
      expect(entityFlagChange, 'patient_flag_change');
      expect(recordEntities, contains(entityFlagChange));
      final rules = rulesFor(entityFlagChange)!;
      // Ordered by their time, as ID link conflicts are (design 6.2, D35).
      expect([rules.patientSide, rules.pausesWithClock, rules.category], [true, true, 'patients']);
      expect(categoryOf(entityFlagChange), 'patients');
      // Who may flag a patient, and mark a flag change entered in error (section 11, row 8).
      expect(rules.permission('create'), 'patients.edit');
      expect(rules.permission('set', 'enteredInError'), 'patients.edit');
      expect(rules.fieldClass('enteredInError'), FieldClass.setOnce);
      // Its one field is the mark; what it set, why and when are fixed at its create.
      expect(rules.settable('enteredInError'), isTrue);
      for (final field in ['reason', 'action', 'flagId', 'patientId', 'status', 'effectiveAt']) {
        expect(rules.settable(field), isFalse, reason: field);
      }
      expect(rules.fieldIssues('enteredInError', const {'reason': 'Demo: set on the wrong patient'}), isEmpty);
    });

    test('names its patient, who is its one parent, and keeps what it set as the phone made it', () {
      final rules = rulesFor(entityFlagChange)!;
      expect(rules.parentsOfCreate(setHigh()), [(entity: entityPatient, id: patient)]);
      expect(parentsOf(entity: entityFlagChange, op: 'create', value: setHigh()), [
        (entity: entityPatient, id: patient),
      ]);
      expect(rules.parentsOfSet('enteredInError', const {'reason': 'Demo: set on the wrong patient'}), isEmpty);
      expect(rules.patientOfCreate(change, setHigh()), patient);
      expect(rules.patientVia(setHigh()), isNull);
      // The server sets its time (4.5); the phone keeps the value it sent, its reason in the store only.
      expect(rules.attributes(setHigh()), setHigh());
      expect(rules.createdFields(setHigh()), isEmpty);
      expect(rules.initialStatus(setHigh()), 'active');
      expect(
        rules.statusAfter('enteredInError', const {'reason': 'Demo: set on the wrong patient'}),
        'entered_in_error',
      );
    });

    test('a reason is trimmed and 1 to 500 code points, so an astral character counts once', () {
      final rules = rulesFor(entityFlagChange)!;
      String? problemOf(String reason) => rules.valueProblem('create', null, setHigh(reason: reason), today);
      expect(problemOf('x'), isNull);
      expect(problemOf('\u{1F9CA}' * 500), isNull);
      expect(problemOf('${'D' * 499}\u{1F9CA}'), isNull);
      for (final reason in ['', ' ', 'Demo: a space after ', '\u{1F9CA}' * 501, 'D' * 501]) {
        expect(problemOf(reason), 'reason_invalid', reason: reason);
      }
      // A reason the rule refuses still passes the value's schema: the server answers it by name.
      expect(rules.createIssues(setHigh(reason: '')), isEmpty);
    });

    group('in the store', () {
      const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
      final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));
      late Directory dir;
      late LocalDatabase db;
      late LocalStore store;
      var paused = false;
      final now = DateTime.utc(2026, 10, 22, 15);

      setUp(() {
        dir = Directory.systemTemp.createTempSync('flags');
        db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-1'), key);
        paused = false;
        store = LocalStore(
          db,
          userId: userId,
          stamp: () => ClockStamp(deviceTime: now, correctedTime: now, verified: true),
          chartingPaused: () => paused,
          now: () => now,
        );
      });
      tearDown(() {
        db.close();
        dir.deleteSync(recursive: true);
      });

      test('a flag change made here waits under its patient, in the patients category', () {
        final id = store.createRecord(entityFlagChange, setHigh());
        final entry = store.outbox().single;
        expect(
          [entry.entity, entry.recordId, entry.op, entry.category, entry.patientId],
          [entityFlagChange, id, 'create', 'patients', patient],
        );
        expect(store.record(id)!.patientId, patient);
        expect(store.unsynced().counts, {'patients': 1});
      });

      test('its mark waits under the patient of the change, a change the chart brought here too', () {
        store.importServerRecord(
          const ServerRecord(
            entity: 'patient_flag_change',
            id: change,
            status: 'active',
            authorUserId: userId,
            attributes: {
              'patientId': patient,
              'flagId': high,
              'action': 'set',
              'reason': 'Demo: missed two follow-ups this month',
              'effectiveAt': '2026-10-21T09:00:00.000Z',
              'clockVerified': true,
            },
            fields: {'enteredInError': ServerField(value: null, version: 0)},
          ),
          open: false,
        );
        expect(store.record(change)!.patientId, patient);
        store.setField(change, 'enteredInError', const {'reason': 'Demo: set on the wrong patient'});
        final mark = store.outbox().single;
        expect(
          [mark.entity, mark.op, mark.field, mark.category, mark.patientId],
          [entityFlagChange, 'set', 'enteredInError', 'patients', patient],
        );
      });

      test('waits for the clock check, as an ID link does, and is never queued with a reason the server refuses', () {
        paused = true;
        expect(() => store.createRecord(entityFlagChange, setHigh()), throwsA(isA<ChartingPaused>()));
        paused = false;
        expect(
          () => store.createRecord(entityFlagChange, setHigh(reason: '')),
          throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'reason_invalid')),
        );
        expect(store.outbox(), isEmpty);
      });

      test('the notice that a held flag change will not be applied is the server’s kind, kept under its patient', () {
        expect(noticeFlagChangeNotApplied, 'flag_change_not_applied');
        store.addNotice(noticeFlagChangeNotApplied, patientId: patient, recordId: change);
        expect(
          [for (final n in store.notices()) (n.kind, n.patientId, n.recordId, n.noteId)],
          [('flag_change_not_applied', patient, change, null)],
        );
      });
    });
  });
}
