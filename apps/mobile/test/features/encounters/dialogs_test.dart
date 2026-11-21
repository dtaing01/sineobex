import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/patients/patient_widgets.dart' show askReason;

import 'encounter_kit.dart';

/// The questions the encounter screens ask (Remove this note, Switch to Medical, Reopen, a
/// referral's Entered in error) and phase 3's reason dialog: in the five runs and at 200% text on a
/// 320 px phone, nothing overflows and every button can be reached and pressed (lifecycle 9's
/// accessibility rules; review SAX-9, SAX-10).
void main() {
  final all = [...runs, (theme: FieldTheme.day, scale: 2.0, narrow: true)];

  /// The open dialog fits: nothing overflowed, it passes the guidelines, and [button] scrolls into
  /// view inside the screen.
  Future<void> fits(WidgetTester tester, Finder button) async {
    expect(tester.takeException(), isNull);
    await expectGuidelines(tester);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    final screen = tester.view.physicalSize / tester.view.devicePixelRatio;
    final rect = tester.getRect(button);
    expect(rect.top, greaterThanOrEqualTo(0));
    expect(rect.bottom, lessThanOrEqualTo(screen.height));
    expect(tester.takeException(), isNull);
  }

  Future<void> cancel(WidgetTester tester) async {
    final no = find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(TextButton, 'Cancel'));
    await tester.ensureVisible(no);
    await tester.pumpAndSettle();
    await tester.tap(no);
    await settle(tester);
    expect(find.byType(AlertDialog), findsNothing);
  }

  for (final run in all) {
    testWidgets('Remove this note and Switch to Medical (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h, kind: VisitKind.nonMedical);
      await chart(tester, h, visit, 'social_needs', {
        'needs.needs': ['food'],
      });
      await openVisit(tester, visit);
      await tapOn(tester, find.byTooltip('More for Social needs'));
      await tapOn(tester, find.text('Remove this note'));
      expect(find.text('Remove this note?'), findsOneWidget);
      await fits(tester, find.widgetWithText(FilledButton, 'Remove'));
      await cancel(tester);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Switch to Medical'));
      expect(find.text('Switch this visit to Medical?'), findsOneWidget);
      final yes = find.descendant(of: find.byType(AlertDialog), matching: find.byType(FilledButton));
      await fits(tester, yes);
      await tester.tap(yes);
      await settle(tester);
      expect(h.sync.store!.record(visit)!.fields['kind']!.value, 'medical');
      handle.dispose();
    });

    testWidgets('Reopen and a referral’s Entered in error (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      await asCredential(tester, h, 'student');
      final v = await finishedVisit(tester, h);
      h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic', encounterId: v.visit);
      await openVisitScreen(tester, v.visit);
      await tapOn(tester, find.bySemanticsLabel('Reopen General / primary care'));
      expect(find.text('Reopen this note?'), findsOneWidget);
      await fits(tester, find.widgetWithText(FilledButton, 'Reopen'));
      await cancel(tester);
      await tapOn(tester, find.bySemanticsLabel(RegExp('^Referral, .*: Demo: dental clinic')));
      await tapInSheet(tester, find.bySemanticsLabel(RegExp('^Mark the referral of .* entered in error')));
      expect(find.text('Mark this referral entered in error?'), findsOneWidget);
      await fits(tester, find.widgetWithText(FilledButton, 'Mark entered in error'));
      await cancel(tester);
      handle.dispose();
    });
  }

  for (final narrow in [false, true]) {
    testWidgets('phase 3’s reason dialog scrolls to its buttons at 200% text (${narrow ? 320 : 390} px)', (
      tester,
    ) async {
      await signInToChart(tester, run: (theme: FieldTheme.day, scale: 2.0, narrow: narrow));
      // As the profile asks it to remove a street name.
      final context = tester.element(find.byType(Navigator).first);
      unawaited(
        askReason(
          context,
          title: 'Remove “Demo Del”?',
          body: 'Say why. The street name stays in the chart’s history.',
          action: 'Remove',
          quick: const ['Wrong patient', 'Typed by mistake', 'They don’t use it'],
        ),
      );
      await settle(tester);
      await fits(tester, find.widgetWithText(FilledButton, 'Remove'));
      await cancel(tester);
    });
  }
}
