import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'test_note_types.dart';

/// The test-only note types the phone's sync tests chart on are the ones the API's tests install
/// (services/api/test/sync-encounters.test.ts checks the same file against the server's rules).
void main() {
  NoteTypeDef definitionOf(TestNoteType type) =>
      NoteTypeDef.fromJson(testNoteTypes.singleWhere((d) => d['key'] == type.key && d['version'] == type.version));

  test('one Non-Medical and one Medical note type, at the keys and versions the tests name', () {
    expect(
      [for (final d in testNoteTypes) (d['key'], d['version'])],
      [(testNote.key, testNote.version), (testMedical.key, testMedical.version)],
    );
    expect(testNoteTypes.first['kinds'], ['medical', 'non_medical']);
    expect(testNoteTypes.last['kinds'], ['medical']);
  });

  test('take the answers the phone’s sync tests send, at the paths their doc names', () {
    const entry = 'rows.e0000001';
    final answers = <String, Object?>{
      'vitals.temp_c': 38.2,
      'vitals.pulse': 96,
      'care.plan': 'Demo: rest and fluids',
      'care.followup': 'Demo: clinic Friday',
      'care.allergies': 'Demo: penicillin',
      'care.history': 'Demo: ${'h' * 3990}',
      'wound.site': 'Demo: left forearm',
      'wound.length_cm': 2.5,
      for (final x in 'abcdefg'.split('')) 'extra.$x': 'ok',
      '$entry.n': 12,
      '$entry.text': 'Demo: a row',
    };
    for (final type in [testNote, testMedical]) {
      final definition = definitionOf(type);
      for (final MapEntry(:key, :value) in answers.entries) {
        expect((key, checkAnswer(definition, key, value)), (key, null));
      }
      expect(checkAnswer(definition, 'temp_c', 38.2), AnswerProblem.unknownPath);
    }
  });
}
