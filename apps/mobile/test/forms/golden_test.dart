import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/forms/conditions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/field_at.dart';
import 'package:sineobex_field/forms/finish.dart';
import 'package:sineobex_field/forms/normal.dart';
import 'package:sineobex_field/forms/paths.dart';
import 'package:sineobex_field/forms/read_model.dart';
import 'package:sineobex_field/forms/recap.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// The golden file (phase 4 design, forms 7.3): packages/forms/generated/golden.json holds what the
/// TypeScript interpreter says about every real note type version, for three sets of answers made
/// by rule (packages/forms/scripts/golden.ts). This test makes the same answers from the bundled
/// presets and holds the phone's interpreter to every line of it, so the two agree on the real
/// forms and not only on the small definitions of the vectors.
///
/// golden.json is empty until the definitions are typed, so the same check also runs over
/// golden_sample.json: the fixture note types and the vectors' definitions, with what TypeScript
/// says about them, written by packages/forms/test/golden.test.ts.

/// The one entry an opened repeating section gets: golden.ts's GOLDEN_ENTRY.
const goldenEntry = (id: 'e0000001', at: '2000-01-01T00:00:00Z');

/// The three sets of answers for a definition, in golden.ts's order and by its rules: none; every
/// section opened and one-tap Normal applied to it in turn; every section opened and the first
/// option of every code answer picked, hidden or not. Each in code-unit key order.
List<({String name, Answers answers})> answerSets(NoteTypeDef definition) {
  final model = definitionModel(definition);

  final normal = <String, Object?>{};
  for (final section in model.sections) {
    final entry = _open(section, normal);
    normal.addAll(normalAnswers(definition, section.section.id, normal, entry));
  }

  final first = <String, Object?>{};
  for (final section in model.sections) {
    _open(section, first);
  }
  final reading = NoteReading(definition, const {});
  for (final leaf in model.leaves.values) {
    final holds = leaf.holds;
    if (holds is! CodesHolds || holds.options.isEmpty) continue;
    final code = holds.options.first.code;
    // pathOf leaves the entry out of a section that does not repeat.
    first[reading.pathOf(leaf, goldenEntry.id)] = holds.many ? [code] : code;
  }

  return [
    (name: 'blank', answers: {}),
    (name: 'normal', answers: _sorted(normal)),
    (name: 'first', answers: _sorted(first)),
  ];
}

/// Opens a section: a repeating one gets [goldenEntry], whose ID is returned.
String? _open(SectionNode section, Answers answers) {
  if (section.section.repeat == null) return null;
  answers['${section.section.id}.${goldenEntry.id}.entryAt'] = goldenEntry.at;
  return goldenEntry.id;
}

// Code-unit order is String.compareTo's, as it is JavaScript's < on strings.
Answers _sorted(Answers answers) => {for (final key in answers.keys.toList()..sort()) key: answers[key]};

List<Map<String, Object?>> _list(Object? json) => (json! as List<Object?>).cast<Map<String, Object?>>();

/// Holds the phone's interpreter to a golden list over the presets it was written from.
void checkGolden(String what, List<Map<String, Object?>> presets, List<Map<String, Object?>> golden) {
  group(what, () {
    test('names the same note type versions, with the same hashes, in the same order', () {
      List<Object?> versions(List<Map<String, Object?>> list) => [
        for (final p in list) [p['key'], p['version'], p['hash']],
      ];
      expect(versions(golden), versions(presets));
    });

    for (final preset in presets) {
      final json = preset['definition']! as Map<String, Object?>;
      final name = '${preset['key']} v${preset['version']}';
      final cases = _list(
        golden.firstWhere(
          (g) => g['key'] == preset['key'] && g['version'] == preset['version'],
          orElse: () => {'cases': const <Object?>[]},
        )['cases'],
      );

      test('$name: its hash is its definition’s', () {
        expect(valueHash(json), preset['hash']);
      });

      test('$name: makes the same three sets of answers', () {
        final made = answerSets(NoteTypeDef.fromJson(json));
        expect([for (final c in cases) c['name']], [for (final set in made) set.name]);
        for (final (index, set) in made.indexed) {
          final expected = cases[index]['answers']! as Map<String, Object?>;
          expect(set.answers, expected, reason: set.name);
          expect(set.answers.keys, expected.keys.toList(), reason: '${set.name}: key order');
        }
      });

      // Over golden.json's own answers, so a difference in what is said about them is told apart
      // from a difference in the answers made.
      for (final c in cases) {
        test('$name ${c['name']}: says the same about its answers', () {
          final definition = NoteTypeDef.fromJson(json);
          final answers = c['answers']! as Map<String, Object?>;
          expect([for (final p in finishCheck(definition, answers)) p.toJson()], c['finishCheck']);
          expect([for (final line in recapLines(definition, answers)) line.toJson()], c['recapLines']);
          expect(valueHash(readModel(definition, answers, const []).toJson()), c['readModelHash']);
        });
      }
    }
  });
}

void main() {
  final presets = _list(jsonDecode(File('assets/forms/presets.json').readAsStringSync()));
  final golden = _list(jsonDecode(File('../../packages/forms/generated/golden.json').readAsStringSync()));
  checkGolden('the real note types', presets, golden);

  final sample = jsonDecode(File('test/forms/golden_sample.json').readAsStringSync()) as Map<String, Object?>;
  final samplePresets = _list(sample['presets']);
  test('the sample holds note types that offer Normal and that repeat', () {
    final golden = _list(sample['golden']);
    expect(samplePresets, hasLength(greaterThan(10)));
    final normal = [
      for (final g in golden)
        for (final c in _list(g['cases']))
          if (c['name'] == 'normal') c['answers']! as Map<String, Object?>,
    ];
    expect(normal.where((a) => a.keys.any((k) => !k.endsWith('.entryAt'))), isNotEmpty);
    expect(normal.where((a) => a.keys.any((k) => k.endsWith('.entryAt'))), isNotEmpty);
  });
  checkGolden('the sample', samplePresets, _list(sample['golden']));
}
