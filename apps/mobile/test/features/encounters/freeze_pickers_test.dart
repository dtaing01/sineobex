import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'encounter_kit.dart';

/// D125: nothing of a chart stays on screen once the store freezes. A picker or a dialog is not
/// under its screen's gate, so each that names a chart's detail sits in a dialog gate of its own and
/// closes when the freeze is heard (review finding PP-1): a note's date and time pickers, a referral's
/// Entered in error dialog with its typed reason, and the Referrals sheet's date picker.
void main() {
  Future<void> openSection(WidgetTester tester, String id) => tapOn(tester, find.byKey(ValueKey('form.section.$id')));
  const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';

  Future<void> freeze(WidgetTester tester, AppHarness h) async {
    h.sync.store!.freeze(frozen);
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
  }

  testWidgets('a note’s date picker, open on its answer, closes when the store freezes', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final note = await chart(tester, h, visit, 'sexual_reproductive', {
      'reason.reasons': ['pregnancy'],
      'lmp.date': '2026-09-01',
    });
    await openNote(tester, note);
    await openSection(tester, 'lmp');
    await semanticTap(tester, RegExp('^Date of last menstrual period: '));
    expect(find.byType(DatePickerDialog), findsOneWidget);
    final before = h.sync.store!.outbox().length;
    await freeze(tester, h);
    expect(find.byType(DatePickerDialog), findsNothing);
    expect(find.text('Date of last menstrual period'), findsNothing);
    expect(find.text(frozen), findsWidgets);
    expect(h.sync.store!.outbox().length, before);
  });

  testWidgets('the Red flags note’s time picker closes when the store freezes', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: chest pain'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    await tester.runAsync(() => h.encounters.repository.openNote(flags));
    h.encounters.repository
      ..saveAnswer(flags, 'red_flags.emergency', 'yes')
      ..saveAnswer(flags, 'red_flags.ems_activated', 'yes')
      ..saveAnswer(flags, 'red_flags.ems_time', '14:35');
    await openNote(tester, flags);
    await openSection(tester, 'red_flags');
    final button = find.ancestor(
      of: find.textContaining(RegExp('2:35|14:35')),
      matching: find.byWidgetPredicate((w) => w is ButtonStyleButton),
    );
    await reveal(tester, button.first);
    await tester.tap(button.first);
    await settle(tester);
    expect(find.byType(TimePickerDialog), findsOneWidget);
    await freeze(tester, h);
    expect(find.byType(TimePickerDialog), findsNothing);
    expect(find.text(frozen), findsWidgets);
  });

  testWidgets('a referral’s Entered in error dialog, its reason typed, closes when the store freezes', (tester) async {
    final h = await signInToChart(tester);
    await asCredential(tester, h, 'student');
    final v = await finishedVisit(tester, h);
    h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic', encounterId: v.visit);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Referral, .*: Demo: dental clinic')));
    await tapInSheet(tester, find.bySemanticsLabel(RegExp('^Mark the referral of .* entered in error')));
    expect(find.text('Mark this referral entered in error?'), findsOneWidget);
    final box = find.descendant(of: find.byType(Dialog), matching: find.byType(EditableText));
    await tester.enterText(box, 'Demo: this was for her sister Demo Ana');
    await settle(tester);
    final before = h.sync.store!.outbox().length;
    await freeze(tester, h);
    expect(find.byType(Dialog), findsNothing);
    expect(find.text('Demo: this was for her sister Demo Ana'), findsNothing);
    expect(h.sync.store!.outbox().length, before);
  });

  testWidgets('the Referrals sheet’s date picker closes when the store freezes', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic', encounterId: v.visit);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Referral, .*: Demo: dental clinic')));
    await tapInSheet(tester, find.bySemanticsLabel(RegExp('^Date referred: ')));
    expect(find.byType(DatePickerDialog), findsOneWidget);
    await freeze(tester, h);
    expect(find.byType(DatePickerDialog), findsNothing);
  });
}
