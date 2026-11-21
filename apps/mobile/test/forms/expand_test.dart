import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/expand.dart';

/// What the vectors cannot say (conformance_test.dart runs them): a case never leaves out an entry
/// the caller must make, and a map's equality never sees whether a value was copied.
void main() {
  final definitions =
      (jsonDecode(File('../../packages/contract/test-vectors/forms-conformance.json').readAsStringSync())
              as Map<String, Object?>)['definitions']!
          as Map<String, Object?>;
  NoteTypeDef definition(String name) => NoteTypeDef.fromJson(definitions[name]! as Map<String, Object?>);
  final quick = definition('quick');
  final visit = definition('visit');
  final wound = definition('wound');

  group('expandQuick', () {
    test('throws when an answer goes into a repeating section the caller gave no entry for', () {
      expect(
        () => expandQuick(quick, {'vitals.woundType': 'abscess'}, wound, {}),
        throwsA(isA<ArgumentError>().having((e) => '${e.message}', 'message', contains('"wounds"'))),
      );
    });

    test('throws on an entry the server would not take, rather than writing it', () {
      for (final bad in [(id: 'E7K2M9Q1', at: '2026-11-17T15:04:05Z'), (id: 'e7k2m9q1', at: '2026-11-17 15:04')]) {
        expect(
          () => expandQuick(quick, {'vitals.woundType': 'abscess'}, wound, {'wounds': bad}),
          throwsA(isA<ArgumentError>()),
          reason: '$bad',
        );
      }
    });

    test('needs no entry when nothing goes into a repeating section', () {
      final expansion = expandQuick(quick, {'vitals.pulse': 80}, wound, {});
      expect(expansion.toJson(), {'answers': <String, Object>{}, 'leftOut': <Object>[]});
    });

    test('shares no list with the answers it is given', () {
      final given = <Object?>['naloxone'];
      final expansion = expandQuick(quick, {'meds.given': given}, visit, {});
      expect(expansion.answers['meds.given'], ['naloxone']);
      expect(identical(expansion.answers['meds.given'], given), isFalse);
      (expansion.answers['meds.given']! as List<Object?>).add('Demo: changed');
      expect(given, ['naloxone']);
    });

    test('gives the paths in code-unit order, an entry\'s entryAt among them', () {
      final placed = expandQuick(
        quick,
        {'vitals.woundType': 'abscess', 'vitals.woundLength': 1},
        wound,
        {'wounds': (id: 'e7k2m9q1', at: '2026-11-17T15:04:05Z')},
      );
      expect(placed.answers.keys, ['wounds.e7k2m9q1.entryAt', 'wounds.e7k2m9q1.length', 'wounds.e7k2m9q1.type']);
    });
  });
}
