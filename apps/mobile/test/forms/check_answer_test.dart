import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

/// What the shared vectors cannot show: JSON is one thing to TypeScript and two to Dart (3 and 3.0
/// are one number there, an int and a double here), and the phone hands checkAnswer values that no
/// JSON decoder made. The vectors (conformance_test.dart) hold every other answer.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  NoteTypeDef definition(String name) => NoteTypeDef.fromJson(definitions[name]! as Map<String, Object?>);
  final visit = definition('visit');
  final wound = definition('wound');
  final outreach = definition('outreach');

  test('takes a whole number written with a decimal point as the number it is', () {
    // jsonDecode('3.0') is a double; JSON.parse('3.0') is 3, which the server takes.
    expect(checkAnswer(wound, 'wounds.e1a2b3c4.healing', jsonDecode('14.0')), isNull);
    expect(checkAnswer(visit, 'vitals.pulse', jsonDecode('72.0')), isNull);
    expect(checkAnswer(visit, 'vitals.temp', 36.60), isNull);
    expect(checkAnswer(wound, 'wounds.e1a2b3c4.healing', 14.5), AnswerProblem.wrongType);
    expect(checkAnswer(visit, 'vitals.pulse', 72.5), AnswerProblem.outOfRange);
  });

  test('refuses a number JSON cannot write, without failing', () {
    expect(checkAnswer(visit, 'vitals.pulse', double.nan), AnswerProblem.outOfRange);
    expect(checkAnswer(visit, 'vitals.pulse', double.infinity), AnswerProblem.outOfRange);
    expect(checkAnswer(wound, 'wounds.e1a2b3c4.healing', double.nan), AnswerProblem.wrongType);
    expect(checkAnswer(wound, 'wounds.e1a2b3c4.healing', double.infinity), AnswerProblem.wrongType);
  });

  test('refuses a value of a Dart type as JSON would have no such value', () {
    expect(checkAnswer(wound, 'care.teaching', DateTime.utc(2026)), AnswerProblem.wrongType);
    expect(checkAnswer(visit, 'meds.given', {'none'}), AnswerProblem.wrongType);
    expect(checkAnswer(visit, 'meds.given', [1]), AnswerProblem.wrongType);
    expect(checkAnswer(visit, 'vitals.unableBp', 1), AnswerProblem.wrongType);
    expect(checkAnswer(visit, 'vitals.pulse', '72'), AnswerProblem.wrongType);
  });

  test('takes a choose-many as any list of strings, typed or not', () {
    expect(checkAnswer(visit, 'meds.given', <Object?>['naloxone']), isNull);
    expect(checkAnswer(visit, 'meds.given', const ['naloxone']), isNull);
  });

  test('counts a text in code points, and refuses a half of a pair however it was made', () {
    final halfPair = String.fromCharCode(0xd83d);
    expect(checkAnswer(outreach, 'supplies.given_other', 'Demo $halfPair'), AnswerProblem.wrongType);
    expect(checkAnswer(outreach, 'supplies.given_other', 'Demo ${String.fromCharCode(0)}'), AnswerProblem.wrongType);
    expect(checkAnswer(outreach, 'supplies.given_other', '\u{1F9E2}' * 200), isNull);
    expect(checkAnswer(outreach, 'supplies.given_other', '\u{1F9E2}' * 201), AnswerProblem.tooLong);
  });

  test('names its problems by the codes the server sends, in the order the checks run', () {
    expect(AnswerProblem.values.map((p) => p.code), [
      'unknown_path',
      'wrong_type',
      'unknown_option',
      'out_of_range',
      'too_long',
      'excluded_pair',
      'exclusive_with_others',
    ]);
  });
}
