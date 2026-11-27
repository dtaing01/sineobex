import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/duration_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A duration (forms 2.2 `duration`, D85): weeks and days typed, whole days stored, never more than
/// the definition's most (gestational age: 315 days, 45 weeks), or a hundred years without one.
void main() {
  final gestation = presetField('sexual_reproductive', 'pregnant.gestational_age') as DurationDef;
  final weeks = find.byKey(const ValueKey('phi.form.gestational_age.weeks'));
  final days = find.byKey(const ValueKey('phi.form.gestational_age.days'));

  Future<List<int?>> open(WidgetTester tester, {DurationDef? field, int? value, bool enabled = true, Run? run}) async {
    final changes = <int?>[];
    await pumpField(
      tester,
      DurationField(field: field ?? gestation, value: value, onChanged: changes.add, enabled: enabled),
      run: run,
    );
    return changes;
  }

  forEachRun('two boxes, weeks and days, under the field’s label', (tester, run) async {
    await open(tester, value: 268, run: run);
    expect(tester.widget<TextField>(weeks).controller!.text, '38');
    expect(tester.widget<TextField>(days).controller!.text, '2');
    expect(tester.widget<TextField>(weeks).keyboardType, TextInputType.number);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Weeks')),
      isSemantics(label: 'Weeks', isTextField: true, hasTapAction: true),
    );
    expect(
      tester.getSemantics(find.bySemanticsLabel('Days')),
      isSemantics(label: 'Days', isTextField: true, hasTapAction: true),
    );
    expect(find.bySemanticsLabel('Gestational age'), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('weeks and days are saved as days once typing pauses', (tester) async {
    final changes = await open(tester);
    await tester.enterText(weeks, '38');
    await tester.enterText(days, '2');
    await tester.pump(typingPause ~/ 2);
    expect(changes, isEmpty);
    await tester.pump(typingPause);
    expect(changes, [268]);
    expect(checkAnswer(_definitionOf(gestation), 'pregnant.gestational_age', 268), isNull);
  });

  testWidgets('weeks alone, or days alone, are taken', (tester) async {
    final changes = await open(tester);
    await tester.enterText(days, '10');
    await tester.pump(typingPause);
    await tester.enterText(weeks, '1');
    await tester.enterText(days, '');
    await tester.pump(typingPause);
    expect(changes, [10, 7]);
  });

  testWidgets('both boxes empty clears the answer', (tester) async {
    final changes = await open(tester, value: 268);
    await tester.enterText(weeks, '');
    await tester.enterText(days, '');
    await tester.pump(typingPause);
    expect(changes, [null]);
  });

  forEachRun('more than the most is not saved, and the line under it says the most', (tester, run) async {
    final changes = await open(tester, value: 280, run: run);
    await tester.enterText(weeks, '400');
    await tester.pump(typingPause);
    expect(find.text('It can be at most 45 weeks.'), findsOneWidget);
    expect(tester.getSemantics(find.text('It can be at most 45 weeks.')), isSemantics(isLiveRegion: true));
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    expect(changes, isEmpty);
    await expectFieldOk(tester);
    // Exactly the most is taken.
    await tester.enterText(weeks, '45');
    await tester.enterText(days, '0');
    await tester.pump(typingPause);
    expect(find.text('It can be at most 45 weeks.'), findsNothing);
    expect(changes, [315]);
  });

  testWidgets('without a most, a hundred years', (tester) async {
    final any = fieldOf({'id': 'since', 'kind': 'duration', 'label': 'Demo: how long'}) as DurationDef;
    final changes = await open(tester, field: any);
    final w = find.byKey(const ValueKey('phi.form.since.weeks'));
    final d = find.byKey(const ValueKey('phi.form.since.days'));
    await tester.enterText(w, '5217');
    await tester.enterText(d, '6');
    await tester.pump(typingPause);
    expect(changes, [36525]);
    await tester.enterText(d, '7');
    await tester.pump(typingPause);
    expect(find.text('It can be at most 5217 weeks 6 days.'), findsOneWidget);
    expect(changes, [36525]);
  });

  testWidgets('only whole numbers', (tester) async {
    final changes = await open(tester);
    await tester.enterText(weeks, '3.5');
    await tester.pump(typingPause);
    expect(find.text('Type whole weeks and days.'), findsOneWidget);
    expect(changes, isEmpty);
  });

  testWidgets('leaving both boxes saves at once; moving between them does not', (tester) async {
    final changes = await open(tester);
    await tester.enterText(weeks, '12');
    await tester.tap(days);
    await tester.pump();
    expect(changes, isEmpty);
    FocusManager.instance.primaryFocus!.unfocus();
    await tester.pump();
    expect(changes, [84]);
  });

  testWidgets('what was typed is saved when the field leaves the screen', (tester) async {
    final changes = await open(tester);
    await tester.enterText(weeks, '12');
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(changes, [84]);
  });

  forEachRun('disabled, it is read-only, says so, and stays readable', (tester, run) async {
    final changes = await open(tester, value: 268, enabled: false, run: run);
    expect(find.byType(TextField), findsNothing);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Gestational age')),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: '38 weeks 2 days'),
    );
    expect(changes, isEmpty);
    await expectFieldOk(tester);
  });
}

NoteTypeDef _definitionOf(DurationDef field) => NoteTypeDef(
  key: 'sexual_reproductive',
  version: 1,
  title: 'Demo',
  kinds: const [NoteKind.medical],
  group: 'clinical',
  sensitivity: Sensitivity.none,
  sections: [
    SectionDef(id: 'pregnant', title: 'Demo', fields: [field]),
  ],
);
