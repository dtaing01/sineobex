import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/group_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A group (forms 2.2 `group`, 8.2): its fields one under another (stack) or side by side (row),
/// reflowing to one per line at 320 px and at 200% text; a collapsed group closed until tapped; a
/// set flag's cleared fields read-only while it is set (2.3).
void main() {
  final bp = presetField('general_primary_care', 'vitals.bp') as GroupDef;
  final dre = presetField('general_primary_care', 'rectal.dre') as GroupDef;
  final infection = presetField('wound_care', 'wound.infection') as GroupDef;
  final measurements = presetField('wound_care', 'wound.measurements') as GroupDef;

  /// Where the form would put each group: its section, then its ID (an entry part for a wound).
  String pathOf(GroupDef g) => {
    bp: 'vitals.bp',
    dre: 'rectal.dre',
    infection: 'wound.e0000001.infection',
    measurements: 'wound.e0000001.measurements',
  }[g]!;

  /// Opens [group] with each field drawn as the form draws it, every change drawn again.
  Future<TestAnswers> open(
    WidgetTester tester,
    GroupDef group, {
    Map<String, Object?>? values,
    bool enabled = true,
    bool filled = false,
    Run? run,
    Set<String> hidden = const {},
  }) async {
    final answers = TestAnswers(values);
    final path = pathOf(group);
    await pumpField(
      tester,
      answering(
        answers,
        () => GroupField(
          field: group,
          filled: filled,
          enabled: enabled,
          ticked: (flag) => answers.values['$path.${flag.id}'] == true,
          child: (f, {required enabled}) =>
              hidden.contains(f.id) ? null : kindWidget(f, '$path.${f.id}', answers, enabled: enabled),
        ),
      ),
      run: run,
    );
    return answers;
  }

  Rect box(WidgetTester tester, String label) => tester.getRect(find.bySemanticsLabel(label).first);

  forEachRun('each kind of group draws its fields, labelled, in every run', (tester, run) async {
    for (final group in [bp, dre, measurements]) {
      await open(tester, group, run: run);
      // The fields are in a group a screen reader names, so "Systolic" is heard as blood pressure's.
      expect(find.bySemanticsLabel(group.label), findsOneWidget, reason: group.label);
      for (final f in group.fields) {
        expect(find.bySemanticsLabel(RegExp('^${RegExp.escape(f.label)}')), findsWidgets, reason: f.label);
      }
      await expectFieldOk(tester);
    }
    await open(tester, infection, run: run);
    await expectFieldOk(tester);
    await tester.tap(find.bySemanticsLabel(infection.label));
    await tester.pumpAndSettle();
    await expectFieldOk(tester);
  });

  testWidgets('a stack puts its fields one under another, in the definition’s order', (tester) async {
    await open(tester, dre);
    final result = box(tester, 'Result');
    final findings = box(tester, 'Findings');
    expect(findings.top, greaterThanOrEqualTo(result.bottom));
  });

  testWidgets('a row puts its fields side by side where they fit', (tester) async {
    await open(tester, bp);
    final systolic = box(tester, 'Systolic');
    final diastolic = box(tester, 'Diastolic');
    expect(diastolic.top, systolic.top);
    expect(diastolic.left, greaterThan(systolic.right));
  });

  testWidgets('a row of four on a phone takes two lines of two', (tester) async {
    await open(tester, measurements);
    final tops = [for (final f in measurements.fields) box(tester, f.label).top];
    expect(tops[1], tops[0]);
    expect(tops[2], greaterThan(tops[0]));
    expect(tops[3], tops[2]);
  });

  for (final run in runs.where((r) => r.narrow || r.scale > 1)) {
    testWidgets('a row reflows to one field per line (${runName(run)})', (tester) async {
      for (final group in [bp, measurements]) {
        await open(tester, group, run: run);
        final boxes = [for (final f in group.fields) box(tester, f.label)];
        for (var i = 1; i < boxes.length; i++) {
          expect(boxes[i].top, greaterThanOrEqualTo(boxes[i - 1].bottom), reason: group.fields[i].label);
          expect(boxes[i].left, boxes[0].left, reason: group.fields[i].label);
        }
        await expectFieldOk(tester);
      }
    });
  }

  testWidgets('a row takes the width it is given: on a tablet, four fields on one line', (tester) async {
    final answers = TestAnswers();
    const path = 'wound.e0000001.measurements';
    await pumpField(
      tester,
      GroupField(
        field: measurements,
        child: (f, {required enabled}) => kindWidget(f, '$path.${f.id}', answers, enabled: enabled),
      ),
      size: const Size(1024, 768),
    );
    final tops = {for (final f in measurements.fields) box(tester, f.label).top};
    expect(tops, hasLength(1));
    await expectFieldOk(tester);
  });

  testWidgets('a collapsed group is closed until tapped, and says so', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, infection);
    final header = find.bySemanticsLabel(infection.label);
    expect(
      tester.getSemantics(header),
      isSemantics(
        label: infection.label,
        isButton: true,
        hasTapAction: true,
        hasExpandedState: true,
        isExpanded: false,
      ),
    );
    expect(find.bySemanticsLabel('Infection findings'), findsNothing);

    await tester.tap(header);
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Infection findings'), findsOneWidget);
    expect(tester.getSemantics(header), isSemantics(isExpanded: true, hasExpandedState: true));

    // A screen reader opens and closes it the same way.
    tester.semantics.tap(find.semantics.byLabel(infection.label));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Infection findings'), findsNothing);
    handle.dispose();
  });

  testWidgets('a collapsed group that holds an answer opens with it showing', (tester) async {
    await open(
      tester,
      infection,
      filled: true,
      values: {
        'wound.e0000001.infection.findings': ['fever'],
      },
    );
    expect(find.bySemanticsLabel('Infection findings'), findsOneWidget);
  });

  testWidgets('a collapsed group shows its help under its header', (tester) async {
    final group = fieldOf({
      'id': 'more',
      'kind': 'group',
      'layout': 'stack',
      'collapsed': true,
      'label': 'Demo: more',
      'help': 'Demo: only when asked',
      'fields': [
        {'id': 'a', 'kind': 'flag', 'label': 'Demo: a'},
      ],
    });
    await pumpField(
      tester,
      GroupField(
        field: group as GroupDef,
        child: (f, {required enabled}) => kindWidget(f, 'demo.more.${f.id}', TestAnswers(), enabled: enabled),
      ),
    );
    expect(find.text('Demo: only when asked'), findsOneWidget);
  });

  testWidgets('while a flag is set, the fields it clears are read-only; the flag is not', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await open(tester, measurements, values: {'wound.e0000001.measurements.length': 4.5});
    expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Length'))), isSemantics(isReadOnly: false));

    await tester.tap(find.text('Unable to measure'));
    await tester.pumpAndSettle();
    expect(answers.changes.last, ('wound.e0000001.measurements.unable', true));
    for (final label in ['Length', 'Width', 'Depth']) {
      expect(
        tester.getSemantics(find.bySemanticsLabel(label)),
        isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false),
        reason: label,
      );
    }
    expect(
      tester.getSemantics(find.bySemanticsLabel('Unable to measure')),
      isSemantics(isChecked: true, isEnabled: true, hasEnabledState: true),
    );
    // Clearing writes nothing to the fields it clears: the length is kept, and counts again once unticked.
    expect(answers.values['wound.e0000001.measurements.length'], 4.5);

    await tester.tap(find.text('Unable to measure'));
    await tester.pumpAndSettle();
    expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Length'))), isSemantics(isReadOnly: false));
    handle.dispose();
  });

  testWidgets('clearedBy names the fields a set flag clears, and only while it is set', (tester) async {
    final unable = measurements.fields.whereType<FlagDef>().single;
    expect(clearedBy(measurements.fields, (f) => false), isEmpty);
    expect(clearedBy(measurements.fields, (f) => f == unable), {'length', 'width', 'depth'});
  });

  testWidgets('disabled, every field in it is read-only', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, bp, enabled: false, values: {'vitals.bp.systolic': 120});
    for (final label in ['Systolic', 'Diastolic']) {
      expect(
        tester.getSemantics(find.bySemanticsLabel(label)),
        isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false),
        reason: label,
      );
    }
    handle.dispose();
  });

  testWidgets('a disabled collapsed group still opens, to be read', (tester) async {
    await open(tester, infection, enabled: false);
    await tester.tap(find.bySemanticsLabel(infection.label));
    await tester.pumpAndSettle();
    expect(find.bySemanticsLabel('Infection findings'), findsOneWidget);
  });

  testWidgets('a field the form hides is left out, with no gap where it was', (tester) async {
    await open(tester, dre, hidden: {'result'});
    expect(find.bySemanticsLabel('Result'), findsNothing);
    expect(find.bySemanticsLabel('Findings'), findsOneWidget);
    expect(tester.widget<FieldsInStack>(find.byType(FieldsInStack)).children, hasLength(1));
  });
}
