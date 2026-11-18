import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/date_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A date answer (forms 2.2 `date`): `YYYY-MM-DD`, typed in three private boxes (month, day,
/// year) or picked on a calendar, either way held to its range, past and future both including
/// today.
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

  Finder box(DateDef field, String part) => find.byKey(ValueKey('phi.form.${field.id}.$part'));

  /// Types [month], [day] and [year] into the boxes, one box after another, as a person would.
  Future<void> typeDate(WidgetTester tester, DateDef field, String month, String day, String year) async {
    for (final (part, text) in [('month', month), ('day', day), ('year', year)]) {
      await tester.ensureVisible(box(field, part));
      await tester.enterText(box(field, part), text);
      await tester.pump();
    }
  }

  /// Leaves the boxes, as tapping elsewhere does.
  Future<void> leave(WidgetTester tester) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
  }

  /// The words under the boxes, read once when they appear: a live region.
  Finder line(String words) => find.text(words);
  void expectSaid(WidgetTester tester, String words) {
    expect(line(words), findsOneWidget);
    expect(tester.getSemantics(line(words)), isSemantics(isLiveRegion: true, label: words));
  }

  forEachRun('a date to choose, then the date chosen, each labelled with a tap action', (tester, run) async {
    await open(tester, followUp, run: run);
    expect(find.text('Choose on the calendar'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date: no date')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Choose on the calendar'),
    );
    await expectFieldOk(tester);
    await open(tester, followUp, value: '2026-10-27', run: run);
    expect(find.text('October 27, 2026'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Follow-up date: October 27, 2026')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Change on the calendar'),
    );
    expect(
      tester.getSemantics(find.bySemanticsLabel('Clear Follow-up date')),
      isSemantics(isButton: true, hasTapAction: true),
    );
    await expectFieldOk(tester);
  });

  group('the typed date', () {
    forEachRun('passes every guideline, empty, typed, and saying why a date is refused', over: formRuns, (
      tester,
      run,
    ) async {
      await open(tester, followUp, run: run);
      // Three boxes inside one node named by the field's label, as the field host leaves the label
      // to the control.
      for (final part in ['month', 'day', 'year']) {
        expect(box(followUp, part), findsOneWidget);
      }
      expect(find.bySemanticsLabel('Follow-up date'), findsOneWidget);
      await expectFieldOk(tester);
      await typeDate(tester, followUp, '10', '27', '2026');
      await tester.pump(typingPause);
      expectSaid(tester, 'Saved as October 27, 2026.');
      await expectFieldOk(tester);
      await typeDate(tester, followUp, '10', '1', '2026');
      await leave(tester);
      expectSaid(tester, 'The date can’t be before today.');
      await expectFieldOk(tester);
    });

    testWidgets('is stored as YYYY-MM-DD, exactly what checkAnswer takes', (tester) async {
      final definition = presetDefinition('red_flags_disposition');
      final changes = await open(tester, followUp);
      await typeDate(tester, followUp, '3', '7', '2027');
      await tester.pump(typingPause);
      expect(changes, ['2027-03-07']);
      expect(checkAnswer(definition, 'follow_up.date', changes.single), isNull);
      // Padded or not, the same day is the same answer, and it is not stored again.
      await typeDate(tester, followUp, '03', '07', '2027');
      await leave(tester);
      expect(changes, ['2027-03-07']);
    });

    testWidgets('a date out of its range is refused: nothing is stored, and the line says why', (tester) async {
      final changes = await open(tester, lmp, value: '2026-09-01');
      await typeDate(tester, lmp, '10', '21', '2026');
      await leave(tester);
      expectSaid(tester, 'The date can’t be after today.');
      expect(changes, isEmpty);

      final later = await open(tester, followUp, value: '2026-10-27');
      await typeDate(tester, followUp, '10', '19', '2026');
      await tester.pump(typingPause);
      expectSaid(tester, 'The date can’t be before today.');
      expect(later, isEmpty);

      // Today is on both sides.
      await typeDate(tester, followUp, '10', '20', '2026');
      await tester.pump(typingPause);
      expect(later, ['2026-10-20']);
    });

    testWidgets('any date is either side of today, as far as the calendar reaches', (tester) async {
      final changes = await open(tester, due);
      await typeDate(tester, due, '1', '2', '2020');
      await tester.pump(typingPause);
      await typeDate(tester, due, '5', '6', '2030');
      await tester.pump(typingPause);
      expect(changes, ['2020-01-02', '2030-05-06']);
      await typeDate(tester, due, '10', '21', '2036');
      await leave(tester);
      expectSaid(tester, 'The date must be from October 20, 1926 to October 20, 2036.');
      await typeDate(tester, due, '10', '19', '1926');
      await leave(tester);
      expectSaid(tester, 'The date must be from October 20, 1926 to October 20, 2036.');
      expect(changes, hasLength(2));
    });

    testWidgets('a day the month doesn’t have, a month past 12 and a short year are refused', (tester) async {
      final changes = await open(tester, due);
      for (final (m, d, y, said) in [
        ('2', '29', '2027', '2027 isn’t a leap year, so February has 28 days.'),
        ('2', '30', '2028', 'February has 28 or 29 days.'),
        ('4', '31', '2027', 'April has 30 days.'),
        ('6', '0', '2027', 'There is no day 0.'),
        ('13', '1', '2027', 'Type the month as a number from 1 to 12.'),
        ('3', '7', '27', 'Type the year with 4 digits, like 2026.'),
        ('3', '7.', '2027', 'Type the month, day and year in numbers, like 3, 7 and 2026.'),
      ]) {
        await typeDate(tester, due, m, d, y);
        await leave(tester);
        expectSaid(tester, said);
      }
      expect(changes, isEmpty);
      await typeDate(tester, due, '2', '29', '2028');
      await leave(tester);
      expect(changes, ['2028-02-29']);
    });

    testWidgets('its line speaks once: never at a keystroke, never for a date half typed', (tester) async {
      final changes = await open(tester, lmp);
      // Moving from box to box saves nothing and says nothing.
      await tester.enterText(box(lmp, 'month'), '10');
      await tester.pump(typingPause);
      await tester.enterText(box(lmp, 'day'), '21');
      await tester.pump(typingPause);
      expect(find.textContaining('Type the'), findsNothing);
      // The year typed key by key: no line until typing pauses.
      for (final typed in ['2', '20', '202', '2026']) {
        await tester.enterText(box(lmp, 'year'), typed);
        await tester.pump(const Duration(milliseconds: 200));
        expect(line('The date can’t be after today.'), findsNothing, reason: typed);
        expect(find.textContaining('4 digits'), findsNothing, reason: typed);
      }
      await tester.pump(typingPause);
      expectSaid(tester, 'The date can’t be after today.');
      expect(changes, isEmpty);
      // Typing again keeps the words until the boxes hold something new to say or to save.
      await tester.enterText(box(lmp, 'day'), '2');
      await tester.pump();
      expect(line('The date can’t be after today.'), findsNothing);
      await tester.pump(typingPause);
      expect(changes, ['2026-10-02']);
      // Left half typed: said once the boxes are left, not before.
      await tester.enterText(box(lmp, 'year'), '');
      await tester.pump(typingPause);
      expect(find.textContaining('Type the month'), findsNothing);
      await leave(tester);
      expectSaid(tester, 'Type the month, day and year, or clear all three.');
      expect(changes, ['2026-10-02']);
    });

    testWidgets('emptying all three boxes clears the answer', (tester) async {
      final changes = await open(tester, lmp, value: '2026-10-02');
      expect(tester.widget<TextField>(box(lmp, 'month')).controller!.text, '10');
      expect(tester.widget<TextField>(box(lmp, 'day')).controller!.text, '2');
      expect(tester.widget<TextField>(box(lmp, 'year')).controller!.text, '2026');
      await typeDate(tester, lmp, '', '', '');
      await leave(tester);
      expect(changes, [null]);
    });

    testWidgets('a stored date out of the range now is shown, and leaving it as it is says nothing', (tester) async {
      final changes = await open(tester, followUp, value: '2026-10-01');
      expect(tester.widget<TextField>(box(followUp, 'day')).controller!.text, '1');
      await tester.tap(box(followUp, 'day'));
      await tester.pump(typingPause);
      await leave(tester);
      expect(find.textContaining('before today'), findsNothing);
      expect(changes, isEmpty);
    });

    testWidgets('a date picked on the calendar fills the boxes', (tester) async {
      final changes = await open(tester, followUp);
      await tester.tap(find.text('Choose on the calendar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('27'));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(changes, ['2026-10-27']);
      expect(tester.widget<TextField>(box(followUp, 'day')).controller!.text, '27');
    });

    testWidgets('a date typed and not yet saved is saved when the field goes', (tester) async {
      final changes = await open(tester, followUp);
      await typeDate(tester, followUp, '11', '2', '2026');
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      expect(changes, ['2026-11-02']);
    });
  });

  // The calendar's day cells are Material's, seven to a row: 47.7 px wide on a 390-wide phone, and
  // at 320 wide seven can't be 48 px (7 × 48 = 336). So the typed date is the way in that meets
  // every rule, and accessibility.md names the calendar's cells as the one exception. What each run
  // can't meet is recorded here: a run that starts to pass means that page is out of date.
  bool cellsMeetAndroid(Run run) => false; // 48 × 48: in no run
  bool cellsMeetIos(Run run) => !run.narrow; // 44 × 44: met at 390 wide, not at 320
  forEachRun('the calendar, opened: labelled and readable; its day cells are the one exception', over: formRuns, (
    tester,
    run,
  ) async {
    await open(tester, due, run: run);
    await tester.ensureVisible(find.text('Choose on the calendar'));
    await tester.tap(find.text('Choose on the calendar'));
    await tester.pumpAndSettle();
    expect(find.byType(DatePickerDialog), findsOneWidget);
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
    final android = await androidTapTargetGuideline.evaluate(tester);
    final ios = await iOSTapTargetGuideline.evaluate(tester);
    expect(android.passed, cellsMeetAndroid(run), reason: android.reason);
    expect(ios.passed, cellsMeetIos(run), reason: ios.reason);
    // Only the day cells: every target too small is one of the month's days.
    for (final evaluation in [android, if (!ios.passed) ios]) {
      final small = (evaluation.reason ?? '').split('\n').where((l) => l.startsWith('SemanticsNode#'));
      expect(small, isNotEmpty);
      for (final target in small) {
        expect(target, matches(RegExp(r'label: "\d{1,2}, [A-Z][a-z]+day, ')), reason: 'not a day cell');
      }
    }
  });

  testWidgets('a picked date is stored as YYYY-MM-DD', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, followUp);
    tester.semantics.tap(find.semantics.byLabel('Follow-up date: no date'));
    await tester.pumpAndSettle();
    // The picker is headed by the field's label.
    expect(find.descendant(of: find.byType(DatePickerDialog), matching: find.text('Follow-up date')), findsOneWidget);
    await tester.tap(find.text('27'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(changes, ['2026-10-27']);
    handle.dispose();
  });

  testWidgets('the calendar has no typing mode: its box would learn what is typed', (tester) async {
    await open(tester, lmp);
    await tester.tap(find.text('Choose on the calendar'));
    await tester.pumpAndSettle();
    expect(find.descendant(of: find.byType(DatePickerDialog), matching: find.byType(TextField)), findsNothing);
    expect(find.byIcon(Icons.edit_outlined), findsNothing);
  });

  DatePickerDialog picker(WidgetTester tester) => tester.widget<DatePickerDialog>(find.byType(DatePickerDialog));
  final day = DateTime(2026, 10, 20);

  testWidgets('a past date is today or earlier', (tester) async {
    await open(tester, lmp);
    await tester.tap(find.text('Choose on the calendar'));
    await tester.pumpAndSettle();
    expect(picker(tester).lastDate, day);
    expect(picker(tester).firstDate, DateTime(1926, 10, 20));
  });

  testWidgets('a future date is today or later', (tester) async {
    await open(tester, followUp);
    await tester.tap(find.text('Choose on the calendar'));
    await tester.pumpAndSettle();
    expect(picker(tester).firstDate, day);
    expect(picker(tester).lastDate, DateTime(2036, 10, 20));
  });

  testWidgets('any date is either side of today', (tester) async {
    await open(tester, due);
    await tester.tap(find.text('Choose on the calendar'));
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

  testWidgets('Clear clears the answer with null, and the boxes', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester, followUp, value: '2026-10-27');
    await tester.tap(find.text('Clear'));
    await tester.pump();
    expect(tester.widget<TextField>(box(followUp, 'year')).controller!.text, '');
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
    expect(find.byType(TextField), findsNothing);
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
