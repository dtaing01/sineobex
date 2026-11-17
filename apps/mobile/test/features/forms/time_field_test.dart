import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/time_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A time of day (forms 2.2 `time`): `HH:MM` on the 24-hour clock, shown as the phone shows times.
void main() {
  final emsTime = presetField('red_flags_disposition', 'red_flags.ems_time') as TimeDef;
  final now = DateTime(2026, 10, 20, 14, 5);

  Future<List<String?>> open(WidgetTester tester, {String? value, bool enabled = true, Run? run}) async {
    final changes = <String?>[];
    await pumpField(
      tester,
      TimeField(field: emsTime, value: value, onChanged: changes.add, enabled: enabled, now: now),
      run: run,
    );
    return changes;
  }

  forEachRun('a time to choose, then the time chosen, each labelled with a tap action', (tester, run) async {
    await open(tester, run: run);
    expect(find.text('Choose a time'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Time EMS called: no time')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Choose a time'),
    );
    await expectFieldOk(tester);
    await open(tester, value: '14:05', run: run);
    expect(find.text('2:05 PM'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Time EMS called: 2:05 PM')),
      isSemantics(isButton: true, hasTapAction: true, hint: 'Change the time'),
    );
    expect(
      tester.getSemantics(find.bySemanticsLabel('Clear Time EMS called')),
      isSemantics(isButton: true, hasTapAction: true),
    );
    await expectFieldOk(tester);
  });

  testWidgets('a picked time is stored as HH:MM on the 24-hour clock, from the dial only', (tester) async {
    final handle = tester.ensureSemantics();
    final changes = await open(tester);
    tester.semantics.tap(find.semantics.byLabel('Time EMS called: no time'));
    await tester.pumpAndSettle();
    expect(find.text('Time EMS called'), findsOneWidget);
    // No typing mode: its boxes are text the keyboard would learn.
    expect(find.byType(TextField), findsNothing);
    expect(find.byIcon(Icons.keyboard_outlined), findsNothing);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(changes, ['14:05']);
    handle.dispose();
  });

  testWidgets('the dial starts at the stored time', (tester) async {
    final changes = await open(tester, value: '09:30');
    await tester.tap(find.text('9:30 AM'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(changes, ['09:30']);
  });

  testWidgets('Clear clears the answer with null', (tester) async {
    final changes = await open(tester, value: '14:05');
    await tester.tap(find.text('Clear'));
    expect(changes, [null]);
  });

  forEachRun('disabled, it is read-only, says so, and stays readable', (tester, run) async {
    final changes = await open(tester, value: '14:05', enabled: false, run: run);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Time EMS called')),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: '2:05 PM'),
    );
    await tester.tap(find.text('2:05 PM'));
    await tester.pumpAndSettle();
    expect(find.text('OK'), findsNothing);
    expect(changes, isEmpty);
    await expectFieldOk(tester);
  });

  test('HH:MM and back', () {
    expect(hhmm(const TimeOfDay(hour: 7, minute: 3)), '07:03');
    expect(timeOf('23:59'), const TimeOfDay(hour: 23, minute: 59));
    expect(timeOf('24:00'), isNull);
  });
}
