import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/forms/field_at.dart';
import 'package:sineobex_field/forms/finish.dart';
import 'package:sineobex_field/forms/handoff.dart';
import 'package:sineobex_field/forms/normal.dart';
import 'package:sineobex_field/forms/read_model.dart';
import 'package:sineobex_field/forms/recap.dart';
import 'package:sineobex_field/forms/suggestions.dart';
import 'package:sineobex_field/forms/visible.dart';

/// The interpreter's answers are data (phase 4 design, forms 7.2): they live in
/// packages/contract/test-vectors/forms-conformance.json, and packages/forms/test/conformance.test.ts
/// reads the same file. A phone that answered differently would save what the server refuses, or
/// show a note otherwise than the portal. This reader holds no answer of its own: it calls each
/// function with a case's inputs and writes the result back as plain data.
typedef Case = Map<String, Object?>;

/// The functions of forms 7.1 the phone does not have yet. Each job of unit F2 shortens the list;
/// the last one empties it.
const notWrittenYet = {'expandQuick'};

/// The inputs each function reads from a case, beside name, definition, why and expected; the
/// optional ones end in '?'. A case with any other key would be run without what it meant to give.
const inputs = {
  'fieldAt': ['path'],
  'checkAnswer': ['path', 'value'],
  'effectiveAnswers': ['answers'],
  'finishCheck': ['answers'],
  'normalAnswers': ['section', 'answers', 'entry?'],
  'recapLines': ['answers'],
  'readModel': ['answers', 'corrections'],
  'visibleAnswers': ['answers', 'reader'],
  'suggestions': ['answers'],
  'expandQuick': ['answers', 'full', 'newEntryIds'],
  'handoffLines': ['notes'],
};

/// The functions that give a map whose key order is part of the answer: the content hash is taken
/// over effectiveAnswers as written (lifecycle 4.5), visibleAnswers keeps its order, and TypeScript
/// writes all three in UTF-16 code-unit order. A map's equality ignores its order, so it is checked
/// apart.
const ordered = {'effectiveAnswers', 'normalAnswers', 'visibleAnswers'};

/// What is wrong with a case's keys for its function: one it does not read, or one it needs.
List<String> keyFaults(String function, Case c) {
  final reads = inputs[function] ?? const <String>[];
  final known = {'name', 'definition', 'why', 'expected', for (final k in reads) k.replaceAll('?', '')};
  final needed = [
    'name',
    'definition',
    'expected',
    for (final k in reads)
      if (!k.endsWith('?')) k,
  ];
  return [
    for (final k in c.keys)
      if (!known.contains(k)) 'reads no $k',
    for (final k in needed)
      if (!c.containsKey(k)) 'needs $k',
  ];
}

Map<String, Object?> answersOf(Case c) => c['answers']! as Map<String, Object?>;

/// A case's reader: six facts and the sensitive code ranges, as the vector file writes them.
NoteReader readerOf(Map<String, Object?> json) => NoteReader(
  actsAsAuthor: json['actsAsAuthor']! as bool,
  viewSensitive: json['viewSensitive']! as bool,
  viewSensitiveExams: json['viewSensitiveExams']! as bool,
  readsMedical: json['readsMedical']! as bool,
  chartsMedical: json['chartsMedical']! as bool,
  ordersMedications: json['ordersMedications']! as bool,
  sensitiveCodes: [
    for (final range in (json['sensitiveCodes']! as List<Object?>).cast<Map<String, Object?>>())
      (from: range['from']! as String, to: range['to']! as String),
  ],
);

void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final definitions = (vectors['definitions']! as Map<String, Object?>).map(
    (name, json) => MapEntry(name, NoteTypeDef.fromJson(json! as Map<String, Object?>)),
  );
  final cases = (vectors['cases']! as Map<String, Object?>).map(
    (function, list) => MapEntry(function, (list! as List<Object?>).cast<Case>()),
  );

  /// Each function, called with a case's definition and its other inputs.
  final functions = <String, Object? Function(NoteTypeDef definition, Case c)>{
    // What a path points at, as plain data both readers can give.
    'fieldAt': (definition, c) {
      final target = fieldAt(definition, c['path']! as String);
      if (target == null) return null;
      return {
        'points': target.points.name,
        'at': target.at,
        'entry': target.entry,
        'row': target.row,
        'side': target.side,
        'part': target.part?.name,
        'stores': target.holds != null,
      };
    },
    'checkAnswer': (definition, c) => checkAnswer(definition, c['path']! as String, c['value'])?.code,
    'effectiveAnswers': (definition, c) => effectiveAnswers(definition, answersOf(c)),
    'finishCheck': (definition, c) => [for (final p in finishCheck(definition, answersOf(c))) p.toJson()],
    'normalAnswers': (definition, c) =>
        normalAnswers(definition, c['section']! as String, answersOf(c), c['entry'] as String?),
    'recapLines': (definition, c) => [for (final line in recapLines(definition, answersOf(c))) line.toJson()],
    'readModel': (definition, c) => readModel(definition, answersOf(c), [
      for (final row in (c['corrections']! as List<Object?>).cast<Map<String, Object?>>()) NoteCorrection.fromJson(row),
    ]).toJson(),
    'visibleAnswers': (definition, c) =>
        visibleAnswers(definition, answersOf(c), readerOf(c['reader']! as Map<String, Object?>)),
    'suggestions': (definition, c) => suggestions(definition, answersOf(c)),
    // A handoff reads every note of a visit: `notes` names each one's definition, and the case's own
    // `definition` is the first's.
    'handoffLines': (_, c) {
      final notes = (c['notes']! as List<Object?>).cast<Case>();
      return [
        for (final line in handoffLines(
          [for (final n in notes) definitions[n['definition']! as String]!],
          [for (final n in notes) n['answers'] as Map<String, Object?>?],
        ))
          line.toJson(),
      ];
    },
  };

  group('the case reader', () {
    test('runs every function of the file, or lists it as not written yet', () {
      expect(cases.keys.toSet(), {...functions.keys, ...notWrittenYet});
      expect(functions.keys.where(notWrittenYet.contains), isEmpty);
    });
    test('names the inputs of every function', () {
      expect(inputs.keys.toSet(), cases.keys.toSet());
    });
    test('refuses a key a function does not read, and a missing input', () {
      const base = {'name': 'x', 'definition': 'checkup', 'expected': <String, Object?>{}};
      expect(keyFaults('normalAnswers', {...base, 'section': 'limbs', 'answers': {}, 'entryId': 'eaaaaaa1'}), [
        'reads no entryId',
      ]);
      expect(keyFaults('effectiveAnswers', {...base, 'answer': {}}), ['reads no answer', 'needs answers']);
      expect(keyFaults('normalAnswers', {...base, 'section': 'limbs', 'answers': {}, 'entry': 'eaaaaaa1'}), isEmpty);
    });
  });

  for (final MapEntry(key: function, value: list) in cases.entries) {
    group(function, () {
      test('has cases, each named once, each on a definition of the file', () {
        expect(list, isNotEmpty);
        expect(list.map((c) => c['name']).toSet(), hasLength(list.length));
        for (final c in list) {
          final name = c['name'];
          expect(definitions.keys, contains(c['definition']), reason: '$name');
          if (c['full'] != null) expect(definitions.keys, contains(c['full']), reason: '$name');
          for (final note in (c['notes'] as List<Object?>? ?? const []).cast<Case>()) {
            expect(definitions.keys, contains(note['definition']), reason: '$name');
          }
          expect(keyFaults(function, c), isEmpty, reason: '$name');
        }
      });

      final run = functions[function];
      if (run == null) return;
      for (final c in list) {
        test(c['name']! as String, () {
          final result = run(definitions[c['definition']]!, c);
          expect(result, c['expected']);
          if (ordered.contains(function) && result != null) {
            // Code-unit order is String.compareTo's, as it is JavaScript's < on strings.
            expect(
              (result as Map<String, Object?>).keys,
              (c['expected']! as Map<String, Object?>).keys.toList()..sort(),
            );
          }
        });
      }
    });
  }
}
