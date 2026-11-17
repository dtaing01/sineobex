import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/forms/conditions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/forms/expand.dart';
import 'package:sineobex_field/forms/field_at.dart';
import 'package:sineobex_field/forms/finish.dart';
import 'package:sineobex_field/forms/handoff.dart';
import 'package:sineobex_field/forms/normal.dart';
import 'package:sineobex_field/forms/paths.dart';
import 'package:sineobex_field/forms/read_model.dart';
import 'package:sineobex_field/forms/recap.dart';
import 'package:sineobex_field/forms/visible.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// The golden file (phase 4 design, forms 7.3): packages/forms/generated/golden.json holds what the
/// TypeScript interpreter says about every real note type version, for five sets of answers made
/// by rule (packages/forms/scripts/golden.ts). This test makes the same answers from the bundled
/// presets and holds the phone's interpreter to every line of it, so the two agree on the real
/// forms and not only on the small definitions of the vectors.
///
/// golden.json is empty until the definitions are released, so the same check also runs over
/// golden_sample.json: the fixture note types and the vectors' definitions, with what TypeScript
/// says about them, written by packages/forms/test/golden.test.ts.

/// The one entry an opened repeating section gets: golden.ts's GOLDEN_ENTRY.
const goldenEntry = (id: 'e0000001', at: '2000-01-01T00:00:00Z');

/// The entry Expand writes into in each repeating section of the full note: GOLDEN_NEW_ENTRY.
const goldenNewEntry = (id: 'e0000002', at: '2000-01-02T00:00:00Z');

/// What `every` puts in an answer that is neither a code nor a flag: golden.ts's FILLED.
const _filled = <SimpleKind, Object>{
  SimpleKind.time: '12:00',
  SimpleKind.duration: 10,
  SimpleKind.problemCode: 'F11.20',
  SimpleKind.problemLabel: 'Demo problem',
};
const _filledText = 'Demo';
const _filledDate = '2000-01-01';

/// The note, visit and patient a case's content hash is worked out for: GOLDEN_NOTE.
const _note = (
  noteId: '00000000-0000-4000-8000-000000000001',
  encounterId: '00000000-0000-4000-8000-000000000002',
  patientId: '00000000-0000-4000-8000-000000000003',
  summary: 'Demo summary',
);

NoteReader _reader({bool viewSensitive = true, bool viewSensitiveExams = true, bool chartsMedical = true}) =>
    NoteReader(
      actsAsAuthor: false,
      viewSensitive: viewSensitive,
      viewSensitiveExams: viewSensitiveExams,
      readsMedical: true,
      chartsMedical: chartsMedical,
      ordersMedications: true,
      sensitiveCodes: const [(from: 'F10', to: 'F19')],
    );

/// golden.ts's GOLDEN_READERS, by the same names.
final _readers = {
  'full': _reader(),
  'noExams': _reader(viewSensitiveExams: false, chartsMedical: false),
  'noSensitive': _reader(viewSensitive: false, viewSensitiveExams: false),
};

/// The five sets of answers for a definition, in golden.ts's order and by its rules: none; then,
/// every section opened, one-tap Normal applied to each in turn; the first option of every code
/// answer picked, hidden or not; every answer that opens something set, then Normal; every answer
/// filled, then Normal. Each in code-unit key order.
List<({String name, Answers answers})> answerSets(NoteTypeDef definition) {
  final model = definitionModel(definition);
  final reading = NoteReading(definition, const {});
  // pathOf leaves the entry out of a section that does not repeat.
  String pathOf(Leaf leaf) => reading.pathOf(leaf, goldenEntry.id);
  Map<String, Object?> withNormal(Map<String, Object?> answers) {
    for (final section in model.sections) {
      answers.addAll(
        normalAnswers(definition, section.section.id, answers, section.section.repeat == null ? null : goldenEntry.id),
      );
    }
    return answers;
  }

  final normal = withNormal(_opened(model));

  final first = _opened(model);
  for (final leaf in model.leaves.values) {
    final holds = leaf.holds;
    if (holds is! CodesHolds || holds.options.isEmpty) continue;
    final code = holds.options.first.code;
    first[pathOf(leaf)] = holds.many ? [code] : code;
  }

  final opens = _openers(model);
  final systems = _opened(model);
  for (final leaf in model.leaves.values) {
    if (!opens.contains(leaf.key)) continue;
    final holds = leaf.holds;
    if (holds is SimpleHolds && holds.kind == SimpleKind.flag) {
      systems[pathOf(leaf)] = true;
    } else if (holds is CodesHolds && holds.options.isNotEmpty) {
      systems[pathOf(leaf)] = holds.many ? _holdable(holds) : holds.options.first.code;
    }
  }
  withNormal(systems);

  final every = _opened(model);
  for (final leaf in model.leaves.values) {
    final value = _filledAt(leaf.holds);
    if (value != null) every[pathOf(leaf)] = value;
  }
  withNormal(every);

  return [
    (name: 'blank', answers: {}),
    (name: 'normal', answers: _sorted(normal)),
    (name: 'first', answers: _sorted(first)),
    (name: 'systems', answers: _sorted(systems)),
    (name: 'every', answers: _sorted(every)),
  ];
}

/// Every section opened: a repeating one gets [goldenEntry].
Map<String, Object?> _opened(PathModel model) => {
  for (final section in model.sections)
    if (section.section.repeat != null) '${section.section.id}.${goldenEntry.id}.entryAt': goldenEntry.at,
};

/// The answers that open something: each a condition names, read from where it is written (one in
/// a grid's cell starting ./ names a row's answer and is left), and each a grid picks its rows in.
Set<String> _openers(PathModel model) {
  final keys = <String>{};
  void read(Condition? condition, FieldNode? carrier) {
    switch (condition) {
      case null:
        return;
      case AllCondition(:final all):
        for (final c in all) {
          read(c, carrier);
        }
      case AnyCondition(:final any):
        for (final c in any) {
          read(c, carrier);
        }
      case NotCondition(:final not):
        read(not, carrier);
      case IsCondition(:final field) || FilledCondition(:final field):
        final leaf = leafAt(model, field, carrier, null).leaf;
        if (leaf != null) keys.add(leaf.key);
    }
  }

  for (final section in model.sections) {
    read(section.section.showWhen, null);
  }
  for (final node in model.nodes) {
    read(node.field.showWhen, node);
    final picked = node.picked;
    if (picked != null) keys.add(picked.key);
  }
  return keys;
}

/// Every option a choose-many can hold together: no exclusive one, and of a pair it may not hold, the first.
List<String> _holdable(CodesHolds holds) {
  var codes = [
    for (final option in holds.options)
      if (!option.exclusive) option.code,
  ];
  for (final (one, other) in holds.excludes) {
    if (codes.contains(one) && codes.contains(other)) codes = [...codes.where((code) => code != other)];
  }
  return codes.isNotEmpty || holds.options.isEmpty ? codes : [holds.options.first.code];
}

/// What `every` puts at a leaf.
Object? _filledAt(Holds holds) => switch (holds) {
  CodesHolds(many: true) => _holdable(holds),
  CodesHolds(:final options) => options.isEmpty ? null : options.last.code,
  SimpleHolds(kind: SimpleKind.flag) => true,
  TextHolds(:final maxLength) => _filledText.substring(0, min(_filledText.length, maxLength)),
  NumberHolds(min: final low) => low,
  DateHolds() => _filledDate,
  SimpleHolds(:final kind) => _filled[kind],
};

/// The note types a quick definition's mapsTo name, in code-unit order.
List<String> _mapsToKeys(NoteTypeDef definition) {
  final keys = <String>{};
  for (final node in definitionModel(definition).nodes) {
    final mapsTo = node.field.mapsTo;
    if (mapsTo != null) keys.add(mapsTo.substring(0, mapsTo.indexOf(':')));
  }
  return keys.toList()..sort();
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

    // What a mapsTo names: the newest version of the note type (forms 6.4).
    final newest = <String, NoteTypeDef>{};
    for (final preset in presets) {
      final definition = NoteTypeDef.fromJson(preset['definition']! as Map<String, Object?>);
      if ((newest[definition.key]?.version ?? 0) < definition.version) newest[definition.key] = definition;
    }

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

      test('$name: makes the same five sets of answers', () {
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
          expect([
            for (final line in handoffLines([definition], [answers])) line.toJson(),
          ], c['handoffLines']);
          expect(effectiveAnswers(definition, answers).keys.toList(), c['effectiveKeys']);
          final hashes = c['visibleHashes']! as Map<String, Object?>;
          expect(hashes.keys, _readers.keys.toList());
          for (final MapEntry(key: who, value: reader) in _readers.entries) {
            expect(valueHash(visibleAnswers(definition, answers, reader)), hashes[who], reason: who);
          }
          expect(
            noteContentHash(
              noteId: _note.noteId,
              encounterId: _note.encounterId,
              patientId: _note.patientId,
              summary: _note.summary,
              definition: definition,
              answers: answers,
            ),
            c['contentHash'],
          );
          final expansions = [
            for (final key in _mapsToKeys(definition))
              if (newest[key] case final full?)
                {
                  'key': full.key,
                  'version': full.version,
                  ...expandQuick(definition, answers, full, {
                    for (final section in full.sections)
                      if (section.repeat != null) section.id: goldenNewEntry,
                  }).toJson(),
                },
          ];
          expect(expansions, c['expansions']);
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
    // A quick note type whose answers Expand writes somewhere, so expandQuick is held too.
    final written = [
      for (final g in golden)
        for (final c in _list(g['cases']))
          for (final e in _list(c['expansions']))
            if ((e['answers']! as Map<String, Object?>).isNotEmpty) e['key'],
    ];
    expect(written, isNotEmpty);
  });
  checkGolden('the sample', samplePresets, _list(sample['golden']));
}
