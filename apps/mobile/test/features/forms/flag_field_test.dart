import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/flag_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A tick (forms 2.2 `flag`): ticked stores true, unticked clears the answer with null, never false
/// (2.3, which `checkAnswer` refuses).
void main() {
  final consented = presetField('general_primary_care', 'gu.consented') as FlagDef;

  Future<List<bool?>> open(WidgetTester tester, {required bool value, bool enabled = true, Run? run}) async {
    final changes = <bool?>[];
    await pumpField(
      tester,
      FlagField(field: consented, value: value, onChanged: changes.add, enabled: enabled),
      run: run,
    );
    return changes;
  }

  forEachRun('a tick with its label, its state and a tap action', (tester, run) async {
    for (final ticked in [false, true]) {
      await open(tester, value: ticked, run: run);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Patient consented')),
        isSemantics(
          label: 'Patient consented',
          hasCheckedState: true,
          isChecked: ticked,
          hasTapAction: true,
          hasEnabledState: true,
          isEnabled: true,
        ),
      );
      await expectFieldOk(tester);
    }
  });

  testWidgets('ticking stores true, by a tap or a screen reader', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, value: false);
    await tester.tap(find.text('Patient consented'));
    tester.semantics.tap(find.semantics.byLabel('Patient consented'));
    expect(changes, [true, true]);
    handle.dispose();
  });

  testWidgets('unticking clears the answer with null, never false', (tester) async {
    final changes = await open(tester, value: true);
    await tester.tap(find.text('Patient consented'));
    expect(changes, [null]);
  });

  testWidgets('its help is shown under it', (tester) async {
    final flag = fieldOf({'id': 'approx', 'kind': 'flag', 'label': 'Approximate', 'help': 'Demo: the date is a guess'});
    await pumpField(tester, FlagField(field: flag as FlagDef, value: false, onChanged: (_) {}));
    expect(find.text('Demo: the date is a guess'), findsOneWidget);
  });

  forEachRun('disabled, its help stays readable too', (tester, run) async {
    final flag = fieldOf({'id': 'approx', 'kind': 'flag', 'label': 'Approximate', 'help': 'Demo: the date is a guess'});
    await pumpField(
      tester,
      FlagField(field: flag as FlagDef, value: true, onChanged: (_) {}, enabled: false),
      run: run,
    );
    expect(find.text('Demo: the date is a guess'), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('disabled, it is read-only, says so, and stays readable', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, value: true, enabled: false);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Patient consented')),
      isSemantics(isChecked: true, hasEnabledState: true, isEnabled: false),
    );
    await tester.tap(find.text('Patient consented'));
    expect(changes, isEmpty);
    // The label keeps the ink of the text around it, not a disabled control's faded colour.
    final style = tester.widget<Text>(find.text('Patient consented')).style;
    expect(style?.color, Theme.of(tester.element(find.text('Patient consented'))).textTheme.bodyLarge?.color);
    await expectFieldOk(tester);
    handle.dispose();
  });
}
