import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/conditions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/forms/finish.dart';

/// What the vectors cannot say (conformance_test.dart runs them): a map's equality ignores its key
/// order and never sees whether a value was copied, and the content hash and a finished note's data
/// rest on both. Also what a Dart reading of odd data must not do that TypeScript cannot: throw.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  NoteTypeDef definition(String name) => NoteTypeDef.fromJson(definitions[name]! as Map<String, Object?>);
  final visit = definition('visit');
  final wound = definition('wound');

  group('effectiveAnswers', () {
    test('gives the paths in code-unit order, whatever order the note holds them in', () {
      final answers = {
        'vitals.pulse': 70,
        'plan.notes': 'Demo: ate today',
        'vitals.bp.systolic': 120,
        'meds.given': ['naloxone'],
        'vitals.alert': 'alert',
        'meds.doses': 1,
      };
      expect(effectiveAnswers(visit, answers).keys, [
        'meds.doses',
        'meds.given',
        'plan.notes',
        'vitals.alert',
        'vitals.bp.systolic',
        'vitals.pulse',
      ]);
    });

    test('leaves the answers it is given as they were, and shares no list with them', () {
      final given = ['naloxone', 'ondansetron'];
      final answers = <String, Object?>{
        'meds.given': given,
        'meds.doses': 2,
        'vitals.unableBp': true,
        'vitals.bp.systolic': 120,
      };
      final before = jsonEncode(answers);
      final counted = effectiveAnswers(visit, answers);
      expect(jsonEncode(answers), before);
      expect(counted['meds.given'], given);
      expect(identical(counted['meds.given'], given), isFalse);
    });

    test('reads a key that only looks like an entry’s time as no entry, without failing', () {
      // In TypeScript the entry ID of `wounds.entryAt` slices to ''; a Dart substring would throw.
      final answers = {'wounds.entryAt': '2026-11-02T10:00:00Z', 'wounds..entryAt': '2026-11-02T10:00:00Z'};
      expect(effectiveAnswers(wound, answers), isEmpty);
      expect(finishCheck(wound, answers), isEmpty);
    });
  });

  test('a definition whose conditions come round to themselves is refused, not looped on', () {
    // The validator refuses it (validate.condition_cycle), so no such definition reaches the phone.
    final looped = NoteTypeDef.fromJson({
      'key': 'demo_loop',
      'version': 1,
      'title': 'Demo loop',
      'kinds': ['medical'],
      'group': 'clinical',
      'sensitivity': 'none',
      'sections': [
        {
          'id': 'one',
          'title': 'Demo one',
          'normal': true,
          'fields': [
            {
              'id': 'a',
              'kind': 'flag',
              'label': 'Demo a',
              'showWhen': {'field': 'one.b', 'filled': true},
            },
            {
              'id': 'b',
              'kind': 'flag',
              'label': 'Demo b',
              'showWhen': {'field': 'one.a', 'filled': true},
            },
          ],
        },
      ],
    });
    expect(() => effectiveAnswers(looped, {'one.a': true}), throwsStateError);
  });

  test('isBlank is true for the blanks of lifecycle 4.5, and false for any answer', () {
    for (final blank in [null, '', <Object?>[], <String, Object?>{}]) {
      expect(isBlank(blank), isTrue, reason: jsonEncode(blank));
    }
    for (final answer in [
      0,
      0.0,
      false,
      true,
      ' ',
      'a',
      ['a'],
      {'a': 1},
    ]) {
      expect(isBlank(answer), isFalse, reason: jsonEncode(answer));
    }
  });
}
