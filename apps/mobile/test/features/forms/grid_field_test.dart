import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/grid_field.dart';
import 'package:sineobex_field/features/forms/group_field.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A grid (forms 2.2 `grid`, 2.3, 8.2): one cell for each row, fixed or picked in a choose-many,
/// stored at the grid's path and the row's code (and the side, where the grid has sides); one row
/// per line, the sides reflowing under each other at 320 px and at 200% text; never sideways.
void main() {
  final general = presetDefinition('general_primary_care');
  final pulses = presetField('general_primary_care', 'cv_perfusion.pulses') as GridDef;
  final strength = presetField('general_primary_care', 'neuro_motor.strength') as GridDef;
  final reflexes = presetField('general_primary_care', 'neuro_motor.reflexes') as GridDef;
  final shoulder = presetField('general_primary_care', 'msk.shoulder_tests') as GridDef;
  final nodeFindings = presetField('general_primary_care', 'lymphatic.node_findings') as GridDef;
  final nodes = presetField('general_primary_care', 'lymphatic.nodes') as ChoiceDef;
  final vaccineStatus = presetField('general_primary_care', 'preventive.vaccine_status') as GridDef;
  final vaccines = presetField('general_primary_care', 'preventive.vaccines') as ChoiceDef;

  String pathOf(GridDef g) => {
    pulses: 'cv_perfusion.pulses',
    strength: 'neuro_motor.strength',
    reflexes: 'neuro_motor.reflexes',
    shoulder: 'msk.e0000001.shoulder_tests',
    nodeFindings: 'lymphatic.node_findings',
    vaccineStatus: 'preventive.vaccine_status',
  }[g]!;

  /// The choose-many each grid of picked rows reads, and where it is.
  final pickers = {nodeFindings: (nodes, 'lymphatic.nodes'), vaccineStatus: (vaccines, 'preventive.vaccines')};

  /// Opens [grid] as the form would: its rows worked out from the answers, each cell drawn bare at
  /// its path, a group cell as a group with its flags read in its own row.
  Future<TestAnswers> open(
    WidgetTester tester,
    GridDef grid, {
    Map<String, Object?>? values,
    bool enabled = true,
    bool filled = false,
    Run? run,
    Size? size,
  }) async {
    final answers = TestAnswers(values);
    final path = pathOf(grid);
    await pumpField(
      tester,
      answering(answers, () {
        final picker = pickers[grid];
        return GridField(
          field: grid,
          rows: gridRows(grid, options: picker?.$1.options ?? const [], picked: answers.values[picker?.$2]),
          filled: filled,
          cell: (row, side) {
            final at = cellPath(path, row.code, side);
            final cell = grid.cell;
            if (cell is GroupDef) {
              return GroupField(
                field: cell,
                enabled: enabled,
                ticked: (flag) => answers.values['$at.${flag.id}'] == true,
                child: (f, {required enabled}) => kindWidget(f, '$at.${f.id}', answers, enabled: enabled),
              );
            }
            return kindWidget(cell, at, answers, enabled: enabled);
          },
        );
      }),
      run: run,
      size: size,
    );
    return answers;
  }

  /// The semantics widget of the row a screen reader names [row].
  Finder rowNamed(String row) => find.bySemanticsLabel(row).first;

  /// The [side] of [row].
  Finder sideOf(String row, String side) =>
      find.descendant(of: rowNamed(row), matching: find.bySemanticsLabel(side)).first;

  Finder chipIn(Finder within, String label) =>
      find.descendant(of: within, matching: find.bySemanticsLabel(label)).last;

  final picked = {
    'lymphatic.nodes': ['cervical', 'axillary'],
    'preventive.vaccines': [vaccines.options.first.code],
  };

  forEachRun('every kind of grid, each row and side named, nothing sideways', (tester, run) async {
    for (final grid in [pulses, strength, shoulder, nodeFindings, vaccineStatus]) {
      await open(tester, grid, values: picked, run: run);
      final rows = gridRows(grid, options: pickers[grid]?.$1.options ?? const [], picked: picked[pickers[grid]?.$2]);
      expect(rows, isNotEmpty, reason: grid.label);
      expect(find.bySemanticsLabel(grid.label), findsOneWidget, reason: grid.label);
      for (final row in rows) {
        expect(rowNamed(row.label), findsOneWidget, reason: '${grid.label}: ${row.label}');
        if (grid.sides) {
          for (final side in ['Right', 'Left']) {
            expect(sideOf(row.label, side), findsOneWidget, reason: '${row.label}, $side');
          }
        }
      }
      await expectFieldOk(tester);
    }
  });

  for (final run in runs) {
    testWidgets('one row per line, in the definition’s order (${runName(run)})', (tester) async {
      await open(tester, pulses, run: run);
      final rects = [for (final row in pulses.rows!) tester.getRect(rowNamed(row.label))];
      for (var i = 1; i < rects.length; i++) {
        expect(rects[i].top, greaterThanOrEqualTo(rects[i - 1].bottom), reason: pulses.rows![i].label);
        expect(rects[i].left, rects[0].left);
      }
      // On a phone a row's sides are one under the other: each has the whole width for its chips.
      final right = tester.getRect(sideOf('Radial', 'Right'));
      final left = tester.getRect(sideOf('Radial', 'Left'));
      expect(left.top, greaterThanOrEqualTo(right.bottom));
    });
  }

  testWidgets('on a tablet a row’s sides sit side by side', (tester) async {
    await open(tester, pulses, size: const Size(1024, 768));
    final right = tester.getRect(sideOf('Radial', 'Right'));
    final left = tester.getRect(sideOf('Radial', 'Left'));
    expect(left.top, right.top);
    expect(left.left, greaterThan(right.right));
    await expectFieldOk(tester);
  });

  testWidgets('on a tablet at 200% text a row’s sides go one under the other', (tester) async {
    await open(tester, pulses, size: const Size(1024, 768), run: runs.firstWhere((r) => r.scale > 1));
    final right = tester.getRect(sideOf('Radial', 'Right'));
    final left = tester.getRect(sideOf('Radial', 'Left'));
    expect(left.top, greaterThanOrEqualTo(right.bottom));
    await expectFieldOk(tester);
  });

  testWidgets('a cell stores at the grid’s path, the row’s code and the side', (tester) async {
    final answers = await open(tester, pulses);
    final cell = chipIn(sideOf('Dorsalis pedis (DP)', 'Left'), '2+');
    await tester.ensureVisible(cell);
    await tester.pumpAndSettle();
    await tester.tap(cell);
    await tester.pumpAndSettle();
    expect(answers.changes, [('cv_perfusion.pulses.dorsalis_pedis_dp.left', 'two_plus')]);
    expect(checkAnswer(general, answers.changes.single.$1, answers.changes.single.$2), isNull);
  });

  testWidgets('a grid without sides stores at the row’s code', (tester) async {
    final answers = await open(tester, shoulder);
    final cell = chipIn(rowNamed('Hawkins'), 'Positive');
    await tester.ensureVisible(cell);
    await tester.pumpAndSettle();
    await tester.tap(cell);
    await tester.pumpAndSettle();
    expect(answers.changes, [('msk.e0000001.shoulder_tests.hawkins', 'positive')]);
    expect(checkAnswer(general, answers.changes.single.$1, answers.changes.single.$2), isNull);
  });

  testWidgets('a group cell stores each of its fields after the row’s code', (tester) async {
    final answers = await open(tester, nodeFindings, values: picked);
    final cell = chipIn(rowNamed('Axillary'), 'Tender');
    await tester.ensureVisible(cell);
    await tester.pumpAndSettle();
    await tester.tap(cell);
    await tester.pumpAndSettle();
    expect(answers.changes.single.$1, 'lymphatic.node_findings.axillary.findings');
    expect(answers.changes.single.$2, ['tender']);
    expect(checkAnswer(general, answers.changes.single.$1, answers.changes.single.$2), isNull);
  });

  testWidgets('picked rows are the options picked, in that field’s order, and follow the picks', (tester) async {
    final answers = await open(
      tester,
      nodeFindings,
      values: {
        'lymphatic.nodes': ['axillary'],
      },
    );
    expect(rowNamed('Axillary'), findsOneWidget);
    expect(find.bySemanticsLabel('Cervical'), findsNothing);
    answers.change('lymphatic.nodes', ['cervical', 'axillary']);
    await tester.pumpAndSettle();
    final cervical = tester.getRect(rowNamed('Cervical'));
    final axillary = tester.getRect(rowNamed('Axillary'));
    expect(axillary.top, greaterThan(cervical.top));
  });

  testWidgets('gridRows: fixed rows as written; picked rows in the options’ order', (tester) async {
    expect(gridRows(pulses), same(pulses.rows));
    final rows = gridRows(nodeFindings, options: nodes.options, picked: ['inguinal', 'cervical', 'not_a_code']);
    expect([for (final r in rows) r.code], ['cervical', 'inguinal']);
    expect(gridRows(nodeFindings, options: nodes.options), isEmpty);
    expect(gridRows(nodeFindings, options: nodes.options, picked: 'cervical'), isEmpty);
  });

  testWidgets('with nothing picked, a line says where its rows come from', (tester) async {
    await open(tester, vaccineStatus);
    expect(find.text('Each one picked above gets its own line here.'), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('gridSides: right then left where the grid asks, never for a region or a problem (D80)', (tester) async {
    expect(gridSides(pulses), ['right', 'left']);
    expect(gridSides(shoulder), [null]);
    for (final cell in [
      {'id': 'where', 'kind': 'region', 'label': 'Demo: where', 'options': _codes},
      {'id': 'dx', 'kind': 'problem', 'label': 'Demo: dx'},
      {
        'id': 'g',
        'kind': 'group',
        'layout': 'stack',
        'label': 'Demo: g',
        'fields': [
          {'id': 'dx', 'kind': 'problem', 'label': 'Demo: dx'},
        ],
      },
    ]) {
      final grid = fieldOf({
        'id': 'demo_grid',
        'kind': 'grid',
        'label': 'Demo: grid',
        'sides': true,
        'rows': _codes,
        'cell': cell,
      });
      expect(gridSides(grid as GridDef), [null], reason: cell['kind']! as String);
    }
  });

  testWidgets('cellPath: the grid’s path, the row’s code, then the side', (tester) async {
    expect(cellPath('neuro_motor.reflexes', 'biceps', 'right'), 'neuro_motor.reflexes.biceps.right');
    expect(cellPath('msk.shoulder_tests', 'neer', null), 'msk.shoulder_tests.neer');
  });

  testWidgets('a collapsed grid is closed until tapped, and says so', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, reflexes);
    expect(
      tester.getSemantics(find.bySemanticsLabel(reflexes.label)),
      isSemantics(label: reflexes.label, isButton: true, hasTapAction: true, hasExpandedState: true, isExpanded: false),
    );
    expect(find.bySemanticsLabel('Biceps'), findsNothing);
    await tester.tap(find.bySemanticsLabel(reflexes.label));
    await tester.pumpAndSettle();
    expect(rowNamed('Biceps'), findsOneWidget);
    await expectFieldOk(tester);
    handle.dispose();
  });

  testWidgets('a collapsed grid that holds an answer opens with it showing', (tester) async {
    await open(tester, reflexes, filled: true, values: {'neuro_motor.reflexes.biceps.right': 'two_plus'});
    expect(rowNamed('Biceps'), findsOneWidget);
  });

  testWidgets('disabled, every cell is read-only and says so', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, strength, enabled: false, values: {'neuro_motor.strength.upper_extremity.right': 5});
    final cell = find.descendant(of: sideOf('Upper extremity', 'Right'), matching: find.bySemanticsLabel('Strength'));
    expect(tester.getSemantics(cell), isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false));
    handle.dispose();
  });
}

const _codes = [
  {'code': 'one', 'label': 'Demo: one'},
  {'code': 'two', 'label': 'Demo: two'},
];
