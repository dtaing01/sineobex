import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/read_model.dart';
import 'package:sineobex_field/forms/recap.dart';

/// What the vectors cannot say (conformance_test.dart runs them): JSON has no negative zero worth
/// keeping and no whole double, and the phone reads numbers from its own store as well as from
/// JSON. And where the vectors leave a rule of the read model unpinned, each case here was checked
/// against packages/forms/src/interp/read-model.ts.
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

  group('readModel, where the vectors leave a rule unpinned', () {
    List<NoteCorrection> corrected(List<CorrectionChange> changes) => [
      NoteCorrection(
        outcome: 'corrected',
        reason: 'Demo: wrong line',
        correctorName: 'Demo Corrector',
        correctorCredential: 'rn',
        correctedAt: '2026-11-03T10:00:00Z',
        changes: changes,
      ),
    ];
    Map<String, Object?> marked(String path, String old) => {
      'path': path,
      'old': old,
      'by': 'Demo Corrector',
      'credential': 'rn',
      'at': '2026-11-03T10:00:00Z',
      'reason': 'Demo: wrong line',
    };
    const at = {'wounds.eaaaaaa1.entryAt': '2026-03-01T10:00:00Z'};

    test('a cleared Other text alone keeps its choice’s place, with no value', () {
      final read = readModel(
        wound,
        {...at, 'wounds.eaaaaaa1.where.region': 'arm'},
        corrected(const [
          CorrectionChange(field: 'data.wounds.eaaaaaa1.type_other', oldValue: 'Demo: bite', newValue: null),
        ]),
      );
      expect(read.sections.single.entries!.single.items.last.toJson(), {
        'path': 'wounds.eaaaaaa1.type',
        'labels': ['Demo wound type'],
        'value': null,
        'corrections': [marked('wounds.eaaaaaa1.type_other', 'Demo: bite')],
      });
    });

    test('a cleared region keeps its place, with no value', () {
      final read = readModel(
        wound,
        {...at, 'wounds.eaaaaaa1.type': 'burn'},
        corrected(const [
          CorrectionChange(field: 'data.wounds.eaaaaaa1.where.region', oldValue: 'arm', newValue: null),
        ]),
      );
      expect(read.sections.single.entries!.single.items.first.toJson(), {
        'path': 'wounds.eaaaaaa1.where',
        'labels': ['Demo location'],
        'value': null,
        'corrections': [marked('wounds.eaaaaaa1.where.region', 'Demo arm')],
      });
    });

    test('a change whose field only ends like data.<path> marks nothing', () {
      final read = readModel(visit, {
        'vitals.pulse': 72,
      }, corrected(const [CorrectionChange(field: 'note.vitals.pulse', oldValue: 70, newValue: 72)]));
      expect(read.sections.single.items.single.corrections, isEmpty);
    });
  });
}
