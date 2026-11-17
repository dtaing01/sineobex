import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/date_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A date answer (forms 2.2 `date`): `YYYY-MM-DD`, picked on a calendar bounded by its range, past
/// and future both including today.
void main() {
  final followUp = presetField('red_flags_disposition', 'follow_up.date') as DateDef; // future
  final lmp = presetField('sexual_reproductive', 'lmp.date') as DateDef; // past
  final due = presetField('sexual_reproductive', 'pregnant.due_date') as DateDef; // any
  final today = DateTime(2026, 10, 20, 15);

  Future<List<String?>> open(WidgetTester tester, DateDef field, {String? value, bool enabled = true, Run? run}) async {
    final changes = <String?>[];
    await pumpField(
      tester,
      DateField(field: field, value: value, onChanged: changes.add, enabled: enabled, today: today),
      run: run,
    );
    return changes;
  }

  forEachRun('a date to choose, then the date chosen, each labelled with a tap action', (tester, run) async {
    await open(tester, followUp, run: run);
    expect(find.text('Choose a date'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date: no date')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Choose a date'),
    );
    await expectFieldOk(tester);
    await open(tester, followUp, value: '2026-10-27', run: run);
    expect(find.text('October 27, 2026'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date: October 27, 2026')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Change the date'),
    );
    expect(
      tester.getSemantics(find.bySemanticsLabel('Clear Follow-up date')),
      isSemantics(isButton: true, hasTapAction: true),
    );
    await expectFieldOk(tester);
  });

  testWidgets('a picked date is stored as YYYY-MM-DD', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, followUp);
    tester.semantics.tap(find.semantics.byLabel('Follow-up date: no date'));
    await tester.pumpAndSettle();
    // The picker is headed by the field's label.
    expect(find.text('Follow-up date'), findsOneWidget);
    await tester.tap(find.text('27'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(changes, ['2026-10-27']);
    handle.dispose();
  });

  testWidgets('the calendar only: no typed date, which the keyboard would learn', (tester) async {
    await open(tester, lmp);
    await tester.tap(find.text('Choose a date'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsNothing);
    expect(find.byIcon(Icons.edit_outlined), findsNothing);
  });

  DatePickerDialog picker(WidgetTester tester) => tester.widget<DatePickerDialog>(find.byType(DatePickerDialog));
  final day = DateTime(2026, 10, 20);

  testWidgets('a past date is today or earlier', (tester) async {
    await open(tester, lmp);
    await tester.tap(find.text('Choose a date'));
    await tester.pumpAndSettle();
    expect(picker(tester).lastDate, day);
    expect(picker(tester).firstDate, DateTime(1926, 10, 20));
  });

  testWidgets('a future date is today or later', (tester) async {
    await open(tester, followUp);
    await tester.tap(find.text('Choose a date'));
    await tester.pumpAndSettle();
    expect(picker(tester).firstDate, day);
    expect(picker(tester).lastDate, DateTime(2036, 10, 20));
  });

  testWidgets('any date is either side of today', (tester) async {
    await open(tester, due);
    await tester.tap(find.text('Choose a date'));
    await tester.pumpAndSettle();
    expect(picker(tester).firstDate, DateTime(1926, 10, 20));
    expect(picker(tester).lastDate, DateTime(2036, 10, 20));
  });

  testWidgets('a stored date out of the range now (a follow-up that has passed) is shown, and the picker still opens', (
    tester,
  ) async {
    await open(tester, followUp, value: '2026-10-01');
    expect(find.text('October 1, 2026'), findsOneWidget);
    await tester.tap(find.text('October 1, 2026'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(picker(tester).initialDate, day);
  });

  testWidgets('Clear clears the answer with null', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, followUp, value: '2026-10-27');
    await tester.tap(find.text('Clear'));
    tester.semantics.tap(find.semantics.byLabel('Clear Follow-up date'));
    expect(changes, [null, null]);
    handle.dispose();
  });

  forEachRun('disabled, it is read-only, says so, and stays readable', (tester, run) async {
    final changes = await open(tester, followUp, value: '2026-10-27', enabled: false, run: run);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date')),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: 'October 27, 2026'),
    );
    expect(find.text('Clear'), findsNothing);
    await tester.tap(find.text('October 27, 2026'));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsNothing);
    expect(changes, isEmpty);
    await expectFieldOk(tester);
  });

  test('a date is written as YYYY-MM-DD, padded', () {
    expect(isoDate(DateTime(2026, 3, 4)), '2026-03-04');
  });
}
