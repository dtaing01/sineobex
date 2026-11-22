import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/supplies.dart';

/// The supplies a note suggests and the lines a bundle applies (phase 5 design 5.3) are data:
/// packages/contract/test-vectors/supply-suggest.json, which packages/presets/test/supplies.test.ts
/// reads too. This reader holds no answer of its own: every case runs and its answer is compared
/// with the one the file expects. Phase 6 calls both functions.
///
/// Written ahead of P2-supplies, whose code makes it pass (it reads its maps and bundles with
/// P2-models' parsePreset, as the TypeScript reads them with the schemas).
void main() {
  final vectors = jsonDecode(
    File('../../packages/contract/test-vectors/supply-suggest.json').readAsStringSync(),
  ) as Map<String, Object?>;
  List<Map<String, Object?>> cases(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();
  final items = Map<String, PresetState>.unmodifiable({
    for (final MapEntry(:key, :value) in (vectors['items']! as Map<String, Object?>).entries)
      key: PresetState.values.byName((value! as Map<String, Object?>)['state']! as String),
  });
  final definitions = {
    for (final MapEntry(:key, :value) in (vectors['definitions']! as Map<String, Object?>).entries)
      key: NoteTypeDef.fromJson(value! as Map<String, Object?>),
  };

  test('read definitions and answers the phone’s interpreter takes, one name per case', () {
    for (final MapEntry(:key, :value) in definitions.entries) {
      expect(value.key, key);
    }
    for (final c in cases('suggestSupplies')) {
      final definition = definitions[c['definition']]!;
      final answers = c['answers']! as Map<String, Object?>;
      for (final MapEntry(:key, :value) in answers.entries) {
        expect(checkAnswer(definition, key, value), isNull, reason: '${c['name']}: $key');
      }
      // What the suggesting person may see counts by itself, as visibleAnswers' answers do.
      expect(effectiveAnswers(definition, answers), answers, reason: '${c['name']}');
    }
    for (final key in ['suggestSupplies', 'bundleLines']) {
      final names = [for (final c in cases(key)) c['name']];
      expect(names.toSet(), hasLength(names.length), reason: key);
    }
  });

  group('suggestSupplies:', () {
    for (final c in cases('suggestSupplies')) {
      test('${c['name']}', () {
        final maps = [
          for (final m in (c['maps']! as List<Object?>).cast<Map<String, Object?>>())
            (id: m['id']! as String, body: parsePreset('field_supply_map', m['body'])! as FieldSupplyMapBody),
        ];
        final answers = Map<String, Object?>.unmodifiable(c['answers']! as Map<String, Object?>);
        final before = jsonEncode(answers);
        expect(
          suggestSupplies(
            maps: List.unmodifiable(maps),
            items: items,
            noteTypeKey: c['noteTypeKey']! as String,
            definition: definitions[c['definition']]!,
            answers: answers,
          ),
          [
            for (final e in (c['expected']! as List<Object?>).cast<Map<String, Object?>>())
              (itemId: e['itemId']! as String, qty: e['qty']! as int, mapId: e['mapId']! as String),
          ],
        );
        expect(jsonEncode(answers), before, reason: 'the answers it was given are left as they were');
      });
    }
  });

  group('bundleLines:', () {
    for (final c in cases('bundleLines')) {
      test('${c['name']}', () {
        final bundle = parsePreset('bundle', c['bundle'])! as BundleBody;
        expect(bundleLines(bundle, items, c['multiplier']! as int), [
          for (final e in (c['expected']! as List<Object?>).cast<Map<String, Object?>>())
            (itemId: e['itemId']! as String, qty: e['qty']! as int, checked: e['checked']! as bool),
        ]);
      });
    }
  });
}
