import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/entities.dart';

/// The phone's entity registry against the shared vectors (packages/contract/test-vectors/
/// sync-values.json), which the API's Zod schemas pass too: the same values are valid, an invalid
/// one fails at the same issue paths or breaks the same named rule, and every valid change names
/// the same parents. The fake server checks values with this registry, so it is pinned as well.
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
    for (final entity in [
      entityPatient,
      entityAlias,
      entityAllergy,
      entityConsent,
      entityProblem,
      entityProblemNote,
      entityIdLink,
    ]) {
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
    final paused = {for (final e in recordEntities) e: rulesFor(e)!.pausesWithClock};
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
  });

  test('categories group the unsynced summary', () {
    expect(categoryOf(entityPatient), 'patients');
    expect(categoryOf(entityIdLink), 'patients');
    expect(categoryOf(entityProblemNote), 'problems');
    expect(categoryOf(entityAudit), 'activity');
    expect(categoryOf(entityEncounter), 'encounters');
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
}
