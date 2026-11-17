import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/read_model.dart';
import 'package:sineobex_field/forms/recap.dart';

/// What the vectors cannot say (conformance_test.dart runs them): JSON has no negative zero worth
/// keeping and no whole double, and the phone reads numbers from its own store as well as from
/// JSON.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  NoteTypeDef definition(String name) => NoteTypeDef.fromJson(definitions[name]! as Map<String, Object?>);
  final visit = definition('visit');
  final wound = definition('wound');
  List<String?> values(ReadModel read) => [
    for (final section in read.sections)
      for (final item in [...section.items, for (final entry in section.entries ?? <ReadEntry>[]) ...entry.items])
        item.value,
  ];

  group('a value written out', () {
    test('a negative zero is written as zero, as toFixed writes it', () {
      expect(values(readModel(visit, {'vitals.strength': -0.0}, const [])), ['0 of 5']);
      expect(recapLines(visit, {'vitals.strength': -0.0}).single.text, 'Demo grip strength: 0 of 5');
    });

    test('a whole number held as a double is written as the whole number', () {
      final answers = {
        'wounds.eaaaaaa1.entryAt': '2026-11-02T10:00:00Z',
        'wounds.eaaaaaa1.healing': 15.0,
        'wounds.eaaaaaa1.length': 3.0,
      };
      expect(values(readModel(wound, answers, const [])), ['3.0 cm', '2 weeks 1 day']);
    });

    test('an old value held as a double is written as the answer would be', () {
      final read = readModel(
        wound,
        {'wounds.eaaaaaa1.entryAt': '2026-11-02T10:00:00Z', 'wounds.eaaaaaa1.healing': 7},
        const [
          NoteCorrection(
            outcome: 'corrected',
            reason: 'Demo: typo',
            correctorName: 'Demo Corrector',
            correctorCredential: 'rn',
            correctedAt: '2026-11-03T10:00:00Z',
            changes: [CorrectionChange(field: 'data.wounds.eaaaaaa1.healing', oldValue: 8.0, newValue: 7)],
          ),
        ],
      );
      expect(read.sections.single.entries!.single.items.single.corrections.single.old, '1 week 1 day');
    });
  });
}
