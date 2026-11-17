import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/visible.dart';
import 'package:sineobex_field/patients/generated/sensitive_codes.dart';
import 'package:sineobex_field/patients/problems.dart' as problems;

/// What the vectors cannot say (conformance_test.dart runs them): a map's equality ignores its key
/// order and never sees whether a value was copied, and the sync read and the visit read rest on
/// both. And where the vectors leave a rule of who reads what unpinned, each case here was checked
/// against packages/forms/src/interp/visible.ts: a difference is a leak or a loss.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  NoteTypeDef definition(String name) => NoteTypeDef.fromJson(definitions[name]! as Map<String, Object?>);
  final exam = definition('exam');
  const reader = NoteReader(
    actsAsAuthor: false,
    viewSensitive: true,
    viewSensitiveExams: false,
    readsMedical: true,
    chartsMedical: true,
    ordersMedications: true,
    sensitiveCodes: [],
  );

  group('visibleAnswers', () {
    test('gives the paths in code-unit order, as effectiveAnswers does', () {
      final answers = {
        'heart.rhythm': 'regular',
        'systems.picked': ['heart', 'gu'],
        'gu.consent': 'yes',
        'heart.murmur': 'none',
      };
      expect(visibleAnswers(exam, answers, reader)!.keys, ['heart.murmur', 'heart.rhythm', 'systems.picked']);
    });

    test('leaves the answers it is given as they were, and shares no list with them', () {
      final picked = ['heart', 'gu'];
      final answers = <String, Object?>{'systems.picked': picked, 'gu.consent': 'yes', 'heart.rhythm': 'regular'};
      final before = jsonEncode(answers);
      final seen = visibleAnswers(exam, answers, reader)!;
      expect(jsonEncode(answers), before);
      expect(seen['systems.picked'], ['heart']);
      final all = visibleAnswers(
        exam,
        {'systems.picked': picked},
        const NoteReader(
          actsAsAuthor: true,
          viewSensitive: false,
          viewSensitiveExams: false,
          readsMedical: false,
          chartsMedical: false,
          ordersMedications: false,
          sensitiveCodes: [],
        ),
      )!;
      expect(identical(all['systems.picked'], picked), isFalse);
      final kept = visibleAnswers(
        exam,
        {'systems.picked': picked},
        const NoteReader(
          actsAsAuthor: false,
          viewSensitive: true,
          viewSensitiveExams: true,
          readsMedical: true,
          chartsMedical: true,
          ordersMedications: true,
          sensitiveCodes: [],
        ),
      )!;
      expect(identical(kept['systems.picked'], picked), isFalse);
    });
  });

  group('where the vectors leave a rule unpinned', () {
    const withoutSensitive = NoteReader(
      actsAsAuthor: false,
      viewSensitive: false,
      viewSensitiveExams: true,
      readsMedical: true,
      chartsMedical: true,
      ordersMedications: true,
      sensitiveCodes: [(from: 'F01', to: 'F99')],
    );

    test('a diagnosis that does not count hides nothing of its section', () {
      // A diagnosis hidden by a condition, beside answers that count: the validator takes it.
      final check = NoteTypeDef.fromJson({
        'key': 'demo_dxcheck',
        'version': 1,
        'title': 'Demo check',
        'kinds': ['medical'],
        'group': 'medical',
        'sensitivity': 'none',
        'sections': [
          {
            'id': 'dx',
            'title': 'Demo diagnosis',
            'fields': [
              {'id': 'none', 'kind': 'flag', 'label': 'Demo nothing found'},
              {
                'id': 'problem',
                'kind': 'problem',
                'label': 'Demo diagnosis',
                'showWhen': {
                  'not': {'field': 'dx.none', 'filled': true},
                },
              },
              {'id': 'notes', 'kind': 'text', 'lines': 'one', 'maxLength': 100, 'label': 'Demo notes'},
            ],
          },
        ],
      });
      final answers = {'dx.none': true, 'dx.problem.code': 'F32.9', 'dx.notes': 'Demo: x'};
      expect(visibleAnswers(check, answers, withoutSensitive), {'dx.none': true, 'dx.notes': 'Demo: x'});
    });

    test('a diagnosis’s label is never judged as a code', () {
      final answers = {
        'dx.eaaaaaa1.entryAt': '2026-03-01T10:00:00Z',
        'dx.eaaaaaa1.problem.code': 'I10',
        'dx.eaaaaaa1.problem.label': 'Demo label',
      };
      const reader = NoteReader(
        actsAsAuthor: false,
        viewSensitive: false,
        viewSensitiveExams: true,
        readsMedical: true,
        chartsMedical: true,
        ordersMedications: true,
        sensitiveCodes: [(from: 'D', to: 'D'), (from: 'De', to: 'De')],
      );
      expect(visibleAnswers(definition('problems'), answers, reader), answers);
    });
  });

  test('isSensitiveCode, given the phone’s list, says what the problem list says', () {
    // The problem list (phase 3) and the note read must hide the same diagnoses.
    const codes = ['F01', 'F32.9', 'F99.0', 'G00', 'E99', 'O9A.1', 'O9B', 'Z30', 'Z39.2', 'Z40', 'B20', 'B20.1', 'B21'];
    const more = ['Z21', 'A50', 'A64.0', 'A65', 'Z71.4', 'Z71.41', 'Z71.3', 'Z71', 'Z7', 'F', 'I10', ''];
    for (final code in [...codes, ...more]) {
      expect(isSensitiveCode(code, sensitiveCodeRanges), problems.isSensitiveCode(code), reason: code);
    }
  });
}
