import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/group_field.dart' show Collapsible;
import 'package:sineobex_field/features/forms/note_read_view.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/conditions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/paths.dart';
import 'package:sineobex_field/forms/read_model.dart';

import 'forms_test_helpers.dart';

/// Every bundled note type, drawn whole (forms 8.3): every section opened, with every field
/// showing, in the three themes, at 200% text and at 320 wide, with no overflow, no control
/// without a label, and the guideline matchers. Nothing here names a note type or a field: the
/// answers that open each conditional field are worked out from the definition's own conditions,
/// so a new note type is covered the moment it is in assets/forms/presets.json.
void main() {
  final presets = [
    for (final p in jsonDecode(File('assets/forms/presets.json').readAsStringSync()) as List<Object?>)
      NoteTypeDef.fromJson((p! as Map<String, Object?>)['definition']! as Map<String, Object?>),
  ];

  test('the presets are read', () {
    expect(presets, isNotEmpty);
  });

  for (final definition in presets) {
    final notes = showingEverything(definition);

    test('${definition.key}: the answers drawn show every field', () {
      for (final maps in [notes.opened, notes.answered]) {
        for (final target in notes.targets) {
          expect(
            maps.any((m) => target.shows(NoteReading(definition, m))),
            isTrue,
            reason: '${target.name} never shows',
          );
        }
        for (final m in maps) {
          for (final MapEntry(:key, :value) in m.entries) {
            expect(checkAnswer(definition, key, value), isNull, reason: '$key = $value');
          }
        }
      }
    });

    for (final run in runs) {
      testWidgets('${definition.key}: every section and field drawn (${runName(run)})', (tester) async {
        final handle = tester.ensureSemantics();
        // Each field as it opens (only what opens it answered), with an answer, and read-only.
        final passes = [
          for (final (i, m) in notes.opened.indexed) ('opened #$i', m, true),
          for (final (i, m) in notes.answered.indexed) ('answered #$i', m, true),
          for (final (i, m) in notes.answered.indexed) ('read-only #$i', m, false),
        ];
        for (final (name, values, enabled) in passes) {
          await pumpForm(
            tester,
            definition,
            values: values,
            run: run,
            enabled: enabled,
            // Every section shows, a `needs` one included, and every action has something to do.
            capabilities: {for (final s in definition.sections) ?s.needs},
            actions: (field, path) => () {},
          );
          final reading = NoteReading(definition, values);
          for (final section in formSections()) {
            await openSection(tester, section);
            await openCollapsed(tester);
            final why = '${definition.key} $name, section $section';
            expect(find.text('This can’t be answered on this phone yet.'), findsNothing, reason: why);
            for (final target in notes.targets) {
              if (target.section != section || !target.shows(reading) || (target.editable && !enabled)) continue;
              expect(
                find.byWidgetPredicate((w) => target.drawnAs(w.key)),
                findsWidgets,
                reason: '$why: ${target.name}',
              );
            }
            await expectFieldOk(tester);
          }
        }
        handle.dispose();
      });

      testWidgets('${definition.key}: the read view of every answer (${runName(run)})', (tester) async {
        final handle = tester.ensureSemantics();
        for (final values in notes.answered) {
          final model = readModel(definition, values, const []);
          await pumpField(tester, NoteReadView(model: model), run: run);
          expect(model.sections, isNotEmpty);
          for (final section in model.sections) {
            expect(find.text(section.title), findsWidgets, reason: section.id);
          }
          await expectFieldOk(tester);
        }
        handle.dispose();
      });
    }
  }
}

/// Opens [section] of the form on screen, unless it is open.
Future<void> openSection(WidgetTester tester, String section) async {
  final header = sectionHeader(section);
  await tester.ensureVisible(header);
  await tester.pumpAndSettle();
  if (isSemantics(isExpanded: true).matches(tester.getSemantics(header), {})) return;
  await tester.tap(header);
  await tester.pumpAndSettle();
}

/// Opens every collapsed group and grid on screen that is closed, until none is.
Future<void> openCollapsed(WidgetTester tester) async {
  for (var round = 0; round < 10; round++) {
    final closed = tester.widgetList<Collapsible>(find.byType(Collapsible)).where((c) => !c.open).toList();
    if (closed.isEmpty) return;
    for (final c in closed) {
      final header = find.byWidgetPredicate((w) => w is Collapsible && w.label == c.label && !w.open);
      if (header.evaluate().isEmpty) continue;
      final at = find.descendant(of: header.first, matching: find.text(c.label)).first;
      await tester.ensureVisible(at);
      await tester.pumpAndSettle();
      await tester.tap(at);
      await tester.pumpAndSettle();
    }
  }
}

// ---- answers that show every field ----

/// The one entry each repeating section is given.
const smokeEntry = 'esmoke01';

/// Something that should show: a field (in its first row, inside a grid) or the text of an
/// Other option.
class Target {
  Target({
    required this.name,
    required this.section,
    required this.shows,
    required this.drawnAs,
    this.editable = false,
  });
  final String name;

  /// The section it is drawn in.
  final String section;
  final bool Function(NoteReading reading) shows;

  /// Whether a widget's key is that of the widget it is drawn as.
  final bool Function(Key? key) drawnAs;

  /// Drawn only on a form that can be changed: an action, and the box for an Other option's text.
  final bool editable;
}

/// Answers a form can be opened with so that, among them, every field of [definition] shows:
/// [opened] holds only the answers that open fields, [answered] the same with every other field
/// that shows answered too; and the targets that say what shows.
({List<Answers> opened, List<Answers> answered, List<Target> targets}) showingEverything(NoteTypeDef definition) {
  final solver = _Solver(definition);
  final targets = <Target>[];
  final needs = <(List<(String, Object?)>, Target)>[];
  for (final section in solver.model.sections) {
    final id = section.section.id;
    final target = Target(
      name: 'section $id',
      section: id,
      shows: (reading) => reading.sectionShows(section),
      drawnAs: (key) => key == ValueKey('form.section.$id'),
    );
    targets.add(target);
    needs.add(([...?solver.sectionShows(section)], target));
  }
  for (final node in solver.model.nodes) {
    final row = node.grid == null ? null : solver.rowOf(node.grid!);
    if (node.grid != null && row == null) continue;
    final need = [...?solver.require(node, row)];
    final entry = node.section.section.repeat == null ? null : smokeEntry;
    final drawn = solver.drawnPath(node, row);
    final prefix = node.field is ActionDef ? 'form.$drawn' : 'host.$drawn';
    final container = node.field is GroupDef || node.field is GridDef;
    final target = Target(
      name: node.at,
      section: node.section.section.id,
      shows: (reading) => reading.fieldCounts(node, row, entry),
      editable: node.field is ActionDef,
      drawnAs: (key) =>
          container || key is ValueKey<String> && (key.value == prefix || key.value.startsWith('$prefix.')),
    );
    targets.add(target);
    needs.add((need, target));
    // The text of an Other option shows once the option is picked.
    final field = node.field;
    if (field is ChoiceDef && field.options.any((o) => o.other)) {
      final leaf = node.leaves.firstWhere((l) => l.node == node && l.fieldPath != null);
      final other = field.options.firstWhere((o) => o.other).code;
      final otherLeaf = node.leaves.firstWhere((l) => l.node == node && l.fieldPath == null);
      final otherText = Target(
        name: '${node.at} Other text',
        section: node.section.section.id,
        shows: (reading) => reading.leafCounts(otherLeaf, entry),
        editable: true,
        drawnAs: (key) => key is ValueKey<String> && key.value.startsWith('phi.form.${field.id}_other'),
      );
      targets.add(otherText);
      needs.add((
        [
          ...need,
          (solver.pathOf(leaf), field.many ? [other] : other),
        ],
        otherText,
      ));
    }
  }
  // Each target's answers go into the first set they agree with where everything that set was
  // made to show still shows, the target too (a `not` condition agrees with any answers, and
  // may stop holding all the same).
  final sets = <({Answers answers, List<Target> serves})>[];
  for (final (need, target) in needs) {
    final at = sets.indexWhere((set) {
      final next = solver.merged(set.answers, need);
      if (next == null) return false;
      final reading = NoteReading(definition, next);
      return [...set.serves, target].every((t) => t.shows(reading));
    });
    if (at >= 0) {
      final set = sets[at];
      sets[at] = (answers: solver.merged(set.answers, need)!, serves: [...set.serves, target]);
    } else {
      final answers = solver.merged({}, need) ?? (throw StateError('answers that contradict themselves: $need'));
      sets.add((answers: answers, serves: [target]));
    }
  }
  final maps = [for (final set in sets) set.answers];
  if (maps.isEmpty) maps.add({});
  return (opened: maps, answered: [for (final m in maps) solver.fill(m, targets)], targets: targets);
}

class _Solver {
  _Solver(this.definition) : model = NoteReading(definition, const {}).model;
  final NoteTypeDef definition;
  final PathModel model;

  /// Where a leaf's answer is in the note: in a repeating section, in its one entry.
  String pathOf(Leaf leaf) {
    if (leaf.node.section.section.repeat == null) return leaf.key;
    return [leaf.parts.first, smokeEntry, ...leaf.parts.skip(1)].join('.');
  }

  /// The entry a repeating section needs for anything in it to show.
  List<(String, Object?)> entryOf(SectionNode section) => [
    if (section.section.repeat != null) ('${section.section.id}.$smokeEntry.entryAt', '2026-11-01T10:00:00Z'),
  ];

  /// The row a field in [grid]'s cell is shown in: its first.
  String? rowOf(FieldNode grid) => grid.rows.firstOrNull;

  /// The path the form draws [node] at, in [row] for a field in a grid's cell: section, entry, the
  /// fields around it; for a cell, the grid's path, the row, and the fields inside the cell.
  String drawnPath(FieldNode node, String? row) {
    final grid = node.grid;
    final ids = <String>[];
    FieldNode? at = node;
    for (; at != null && at != grid; at = at.parent) {
      if (grid == null || at != grid.cell) ids.insert(0, at.field.id);
    }
    final section = node.section.section;
    final start = [section.id, if (section.repeat != null) smokeEntry];
    if (grid == null) return [...start, ...ids].join('.');
    final gridIds = <String>[];
    for (FieldNode? g = grid; g != null; g = g.parent) {
      gridIds.insert(0, g.field.id);
    }
    return [...start, ...gridIds, row!, ...ids].join('.');
  }

  /// The answers that make [node] show in [row]: its section's condition, and each condition of
  /// it and the fields around it, with what those conditions read showing too; in a grid whose
  /// rows are picked, the row picked. Null where no answer can.
  List<(String, Object?)>? require(FieldNode node, String? row) {
    final need = sectionShows(node.section);
    if (need == null) return null;
    final around = <FieldNode>[];
    for (FieldNode? at = node; at != null; at = at.parent) {
      around.insert(0, at);
    }
    for (final at in around) {
      final inRow = at.grid != null ? row : null;
      if (at.field.showWhen case final c?) {
        final more = _satisfy(c, at, inRow);
        if (more == null) return null;
        need.addAll(more);
      }
      final parent = at.parent;
      final picked = parent != null && parent.cell == at ? parent.picked : null;
      if (picked != null && inRow != null) {
        final more = _set(picked, [inRow]);
        if (more == null) return null;
        need.addAll(more);
      }
    }
    return need;
  }

  /// The answers that make [section] show: an entry, where it repeats, and its condition.
  List<(String, Object?)>? sectionShows(SectionNode section) {
    final condition = section.section.showWhen;
    final more = condition == null ? const <(String, Object?)>[] : _satisfy(condition, null, null);
    return more == null ? null : [...entryOf(section), ...more];
  }

  /// Answers under which [condition] holds, read where it is written.
  List<(String, Object?)>? _satisfy(Condition condition, FieldNode? carrier, String? row) {
    switch (condition) {
      case AllCondition(:final all):
        final need = <(String, Object?)>[];
        for (final c in all) {
          final more = _satisfy(c, carrier, row);
          if (more == null) return null;
          need.addAll(more);
        }
        return need;
      case AnyCondition(any: final some):
        for (final c in some) {
          if (_satisfy(c, carrier, row) case final need?) return need;
        }
        return null;
      // Nothing answered: a condition that reads no answer holds no `is` and no `filled`.
      case NotCondition():
        return const [];
      case FilledCondition(:final field):
        final leaf = leafAt(model, field, carrier, row).leaf;
        return leaf == null ? null : _set(leaf, null);
      case IsCondition(:final field, :final codes):
        final leaf = leafAt(model, field, carrier, row).leaf;
        return leaf == null ? null : _set(leaf, codes);
    }
  }

  /// An answer at [leaf] (one of [codes], when given) that counts: it, and what makes it show.
  List<(String, Object?)>? _set(Leaf leaf, List<String>? codes) {
    final holds = leaf.holds;
    final Object? value = codes == null
        ? sample(leaf)
        : holds is CodesHolds
        ? (holds.many ? [codes.first] : codes.first)
        : null;
    if (value == null) return null;
    final shows = require(leaf.node, leaf.row);
    if (shows == null) return null;
    return [...shows, (pathOf(leaf), value)];
  }

  /// A made-up answer [checkAnswer] takes at [leaf].
  Object? sample(Leaf leaf) => switch (leaf.holds) {
    CodesHolds(:final many, :final options) => many ? [options.first.code] : options.first.code,
    TextHolds() => 'Demo: smoke',
    NumberHolds(:final min) => min,
    DateHolds() => '2026-11-01',
    DurationHolds() => 9,
    SimpleHolds(kind: SimpleKind.flag) => true,
    SimpleHolds(kind: SimpleKind.time) => '10:30',
    SimpleHolds(kind: SimpleKind.problemCode) => 'R51.9',
    SimpleHolds(kind: SimpleKind.problemLabel) => 'Demo: smoke diagnosis',
    SimpleHolds(kind: SimpleKind.entryAt) => '2026-11-01T10:00:00Z',
    SimpleHolds(kind: SimpleKind.entryRemoved) => null,
  };

  /// [answers] with [need] added, or null where it contradicts what is there: a choose-many takes the codes
  /// of both, in the definition's order, where checkAnswer takes them together.
  Answers? merged(Answers answers, List<(String, Object?)> need) {
    final next = {...answers};
    for (final (path, value) in need) {
      final held = next[path];
      if (held == null) {
        next[path] = value;
      } else if (held is List && value is List) {
        final options = (model.leaves.values.firstWhere((l) => pathOf(l) == path).holds as CodesHolds).options;
        final union = [
          for (final o in options)
            if (held.contains(o.code) || value.contains(o.code)) o.code,
        ];
        if (checkAnswer(definition, path, union) != null) return null;
        next[path] = union;
      } else if (held != value) {
        return null;
      }
    }
    return next;
  }

  /// [answers] with every blank answer that counts filled in, so each field is drawn with a value,
  /// where filling it hides nothing that showed (a set flag clears fields; an answer can close a
  /// `not` condition).
  Answers fill(Answers answers, List<Target> targets) {
    final filled = {...answers};
    Set<Target> showing(Answers a) {
      final reading = NoteReading(definition, a);
      return {
        for (final t in targets)
          if (t.shows(reading)) t,
      };
    }

    var shown = showing(filled);
    for (final leaf in model.leaves.values) {
      final path = pathOf(leaf);
      if (filled.containsKey(path)) continue;
      final value = sample(leaf);
      if (value == null || checkAnswer(definition, path, value) != null) continue;
      if (!NoteReading(definition, filled).counts(path)) continue;
      final next = {...filled, path: value};
      final now = showing(next);
      if (!now.containsAll(shown)) continue;
      filled[path] = value;
      shown = now;
    }
    return filled;
  }
}
