import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/encounters/referrals_sheet.dart' show referralDateMissing, referralDateUnsaved;
import 'package:sineobex_field/sync/entities.dart' show entityReferral;
import 'package:sineobex_field/sync/local_store.dart' show entityAudit;

import '../../sync/fake_server.dart' show FakeSyncServer;
import 'encounter_kit.dart';

/// The Referrals sheet (lifecycle 7, 9.10; card L5-referrals), from the profile's **+ Referral**: the
/// patient's referrals newest first, the phone's own and those the chart it keeps lists, each with
/// who recorded it, "At a visit" and "Waiting to send"; **Add referral** below them; **Entered in
/// error** with a reason, the referral staying in the list struck through. Each referral shown is
/// logged once. Offline; three themes, 200% text, 320 wide.
void main() {
  const r1 = 'f0000000-0000-4000-8000-0000000000c1';
  const r2 = 'f0000000-0000-4000-8000-0000000000c2';

  /// The chart's two referrals by Demo Blair, the earlier one entered in error already.
  Map<String, Object?> listed() => {
    'timeline': {
      'encounters': <Object?>[],
      'referrals': [
        referralSnapshot(r1, p1Id, referredOn: '2026-10-18', details: 'Demo: dental clinic'),
        referralSnapshot(
          r2,
          p1Id,
          referredOn: '2026-10-01',
          details: 'Demo: eye clinic',
          enteredInError: 'Wrong patient',
        ),
      ],
    },
  };

  Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);

  Future<void> openSheet(WidgetTester tester) async {
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.bySemanticsLabel('Add a referral'));
    expect(inSheet(find.text('Referrals')), findsOneWidget);
  }

  List<Map<Object?, Object?>> referralReads(AppHarness h) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityAudit && (e.value! as Map)['entity'] == entityReferral) e.value! as Map,
  ];

  for (final run in runs) {
    testWidgets('the referrals, Add referral, and Entered in error (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      await cacheChart(tester, h, p1Id, listed());
      await openSheet(tester);

      // Newest first, each read as one item; one entered in error stays, struck through, with its reason.
      final dental = inSheet(
        find.bySemanticsLabel('Referral, October 18, 2026: Demo: dental clinic. Recorded by a teammate'),
      );
      final eye = inSheet(
        find.bySemanticsLabel(
          'Referral, October 1, 2026: Demo: eye clinic. Recorded by a teammate. Entered in error: Wrong patient',
        ),
      );
      await revealInSheet(tester, dental);
      await revealInSheet(tester, eye);
      // Large text pushes the first out of the sheet's list once the second is in view.
      if (dental.evaluate().isNotEmpty) expect(tester.getTopLeft(dental).dy, lessThan(tester.getTopLeft(eye).dy));
      expect(tester.widget<Text>(inSheet(find.text('Demo: eye clinic'))).style?.decoration, TextDecoration.lineThrough);
      // A clinician may mark a teammate's referral; one marked already offers nothing.
      await revealInSheet(tester, find.bySemanticsLabel('Mark the referral of October 18, 2026 entered in error'));
      expect(find.bySemanticsLabel('Mark the referral of October 1, 2026 entered in error'), findsNothing);
      await expectScreenOk(tester);
      // Each referral shown is logged once, on the referral (10.1).
      expect([for (final r in referralReads(h)) r['entityId']], unorderedEquals([r1, r2]));

      // Add referral: today by default; the domain layer's refusal in its words, then the referral,
      // at the top, waiting to send. The sheet stays open on the list.
      await revealInSheet(tester, inSheet(find.bySemanticsLabel('Date referred: October 22, 2026')));
      final add = inSheet(find.widgetWithText(FilledButton, 'Add referral'));
      await tapInSheet(tester, add);
      await revealInSheet(tester, find.text('Write the referral’s details, up to 2,000 characters.'));
      await tester.enterText(find.byKey(const ValueKey('phi.referralDetails')), 'Demo: shelter intake on Monday');
      await tester.pump();
      await tapInSheet(tester, add);
      expect(find.byType(BottomSheet), findsOneWidget);
      final made = inSheet(
        find.bySemanticsLabel(
          'Referral, October 22, 2026: Demo: shelter intake on Monday. Recorded by Jordan Lee (demo). Waiting to send',
        ),
      );
      await revealInSheet(tester, made);
      expect(find.text('Write the referral’s details, up to 2,000 characters.'), findsNothing);
      // Said in the sheet, under the button, as a live region: no SnackBar is drawn under the sheet.
      final added = inSheet(find.bySemanticsLabel('Referral added'));
      await revealInSheet(tester, added);
      expect(tester.getSemantics(added), isSemantics(isLiveRegion: true));
      expect(find.byType(SnackBar), findsNothing);
      await expectScreenOk(tester);

      // Entered in error asks for a reason, then the row stays, struck through.
      await tapInSheet(tester, find.bySemanticsLabel('Mark the referral of October 18, 2026 entered in error'));
      expect(find.text('Mark this referral entered in error?'), findsOneWidget);
      await expectGuidelines(tester);
      // Too short a reason: the domain layer's words, and the dialog stays.
      await tester.enterText(find.byKey(const ValueKey('phi.referralReason')), 'no');
      await tester.pump();
      await tapOn(tester, find.widgetWithText(FilledButton, 'Mark entered in error'));
      expect(find.text('Give a short reason (3 to 300 characters).'), findsOneWidget);
      expect(h.sync.store!.record(r1), isNull);
      await tapOn(tester, find.text('Typed by mistake'));
      await tapOn(tester, find.widgetWithText(FilledButton, 'Mark entered in error'));
      final marked = inSheet(
        find.bySemanticsLabel(
          'Referral, October 18, 2026: Demo: dental clinic. Recorded by a teammate. Waiting to send. '
          'Entered in error: Typed by mistake',
        ),
      );
      await revealInSheet(tester, marked);
      expect(find.bySemanticsLabel('Mark the referral of October 18, 2026 entered in error'), findsNothing);
      final said = inSheet(find.bySemanticsLabel('Marked entered in error'));
      await revealInSheet(tester, said);
      expect(tester.getSemantics(said), isSemantics(isLiveRegion: true));
      expect(find.byType(SnackBar), findsNothing);
      // Taken onto the phone to be marked offline, and read once still.
      final rec = h.sync.store!.record(r1)!;
      expect(rec.fields['enteredInError']!.value, {'reason': 'Typed by mistake'});
      expect(referralReads(h).where((r) => r['entityId'] == r1), hasLength(1));
      handle.dispose();
    });
  }

  // A referral's date is a date the phone takes, so D92 holds for it as for a note's (the coordinator's
  // decision on review finding PX-3): typed in three private boxes, or picked on the calendar alone,
  // whose typing box would let the keyboard learn. The calendar's day cells are accessibility.md's one
  // exception, beside the typed date; what each run's cells can't meet is recorded, as the date
  // field's own test records it, so a change to Material that fixes them shows.
  bool cellsMeetAndroid(Run run) => false; // 48 × 48: in no run
  // 44 × 44: met at 390 wide, not at 320; nor at 200% text in the app, whose demo banner leaves the
  // dialog less height than the forms' own test gives it (34.6 px tall cells).
  bool cellsMeetIos(Run run) => !run.narrow && run.scale == 1;
  Finder dateBox(String part) => inSheet(find.byKey(ValueKey('phi.form.referredOn.$part')));
  String boxText(WidgetTester tester, String part) => tester.widget<TextField>(dateBox(part)).controller!.text;
  Future<void> typeDate(WidgetTester tester, String month, String day, String year) async {
    for (final (part, text) in [('month', month), ('day', day), ('year', year)]) {
      await revealInSheet(tester, dateBox(part));
      await tester.enterText(dateBox(part), text);
      await tester.pump();
    }
  }

  Future<void> leaveBoxes(WidgetTester tester) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets(
      'Add referral’s date: typed in three private boxes, or picked on the calendar alone (${runName(run)})',
      (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signInToChart(tester, run: run);
        await openSheet(tester);
        // Today by default, in the boxes and on the calendar's button.
        await revealInSheet(tester, dateBox('year'));
        expect(
          [
            for (final part in ['month', 'day', 'year']) boxText(tester, part),
          ],
          ['10', '22', '2026'],
        );
        final calendar = inSheet(find.bySemanticsLabel('Date referred: October 22, 2026'));
        await revealInSheet(tester, calendar);
        expect(tester.getSemantics(calendar), isSemantics(isButton: true, hasTapAction: true));
        await expectScreenOk(tester);

        // The calendar alone, headed by the date's label; its day cells are the one exception.
        await tapInSheet(tester, calendar);
        final dialog = find.byType(DatePickerDialog);
        expect(dialog, findsOneWidget);
        expect(find.descendant(of: dialog, matching: find.text('Date referred')), findsOneWidget);
        expect(find.descendant(of: dialog, matching: find.byType(TextField)), findsNothing);
        expect(find.descendant(of: dialog, matching: find.byIcon(Icons.edit_outlined)), findsNothing);
        expect(tester.widget<DatePickerDialog>(dialog).lastDate, DateTime(2026, 10, 22));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        final android = await androidTapTargetGuideline.evaluate(tester);
        final ios = await iOSTapTargetGuideline.evaluate(tester);
        expect(android.passed, cellsMeetAndroid(run), reason: android.reason);
        expect(ios.passed, cellsMeetIos(run), reason: ios.reason);
        for (final evaluation in [android, if (!ios.passed) ios]) {
          final small = (evaluation.reason ?? '').split('\n').where((l) => l.startsWith('SemanticsNode#'));
          expect(small, isNotEmpty);
          for (final target in small) {
            expect(target, matches(RegExp(r'label: "\d{1,2}, [A-Z][a-z]+day, ')), reason: 'not a day cell');
          }
        }
        await tester.tap(find.descendant(of: dialog, matching: find.text('3')));
        await tester.tap(find.descendant(of: dialog, matching: find.text('OK')));
        await settle(tester);
        expect(
          [
            for (final part in ['month', 'day', 'year']) boxText(tester, part),
          ],
          ['10', '3', '2026'],
        );

        // Typed: a date after today is refused under the boxes, and Add referral adds nothing on it.
        await typeDate(tester, '10', '23', '2026');
        await leaveBoxes(tester);
        await revealInSheet(tester, inSheet(find.text('The date can’t be after today.')));
        await tester.enterText(find.byKey(const ValueKey('phi.referralDetails')), 'Demo: shelter intake on Monday');
        await tester.pump();
        final add = inSheet(find.widgetWithText(FilledButton, 'Add referral'));
        await tapInSheet(tester, add);
        await revealInSheet(tester, inSheet(find.text(referralDateUnsaved)));
        expect(h.sync.store!.recordIds().where((id) => h.sync.store!.record(id)!.entity == entityReferral), isEmpty);
        await expectScreenOk(tester);
        // Typed right, and Add referral pressed with the year's box still in use: the date typed is the one added.
        await typeDate(tester, '10', '5', '2026');
        await tapInSheet(tester, add);
        final made = inSheet(
          find.bySemanticsLabel(
            'Referral, October 5, 2026: Demo: shelter intake on Monday. Recorded by Jordan Lee (demo). Waiting to send',
          ),
        );
        await revealInSheet(tester, made);
        // The form starts again on today.
        await revealInSheet(tester, dateBox('day'));
        expect(boxText(tester, 'day'), '22');
        // Cleared, the date is asked for.
        await revealInSheet(tester, inSheet(find.bySemanticsLabel('Clear Date referred')));
        tester.semantics.tap(find.semantics.byLabel('Clear Date referred'));
        await settle(tester);
        await tester.enterText(find.byKey(const ValueKey('phi.referralDetails')), 'Demo: food bank');
        await tester.pump();
        await tapInSheet(tester, add);
        await revealInSheet(tester, inSheet(find.text(referralDateMissing)));
        expect(find.bySemanticsLabel(RegExp('^Referral, .*: Demo: food bank')), findsNothing);
        handle.dispose();
      },
    );
  }

  testWidgets('who may add and mark: a community health worker marks their own, never a teammate’s', (tester) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, listed());
    await remakeServices(tester, h, credential: 'chw', permissions: FakeSyncServer.chw.toList());
    await openSheet(tester);
    await revealInSheet(tester, inSheet(find.widgetWithText(FilledButton, 'Add referral')));
    expect(find.bySemanticsLabel(RegExp('^Mark the referral')), findsNothing);
    await tester.enterText(find.byKey(const ValueKey('phi.referralDetails')), 'Demo: food bank');
    await tester.pump();
    await tapInSheet(tester, inSheet(find.widgetWithText(FilledButton, 'Add referral')));
    await revealInSheet(tester, find.bySemanticsLabel('Mark the referral of October 22, 2026 entered in error'));
    expect(find.bySemanticsLabel('Mark the referral of October 18, 2026 entered in error'), findsNothing);
  });

  testWidgets('a role without referrals.create reads the list from the timeline, and adds and marks nothing', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, listed());
    await remakeServices(
      tester,
      h,
      permissions: [...FakeSyncServer.healthcareStaff.where((k) => k != 'referrals.create')],
    );
    await go(tester, '/patients/$p1Id');
    expect(find.bySemanticsLabel('Add a referral'), findsNothing);
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Referral, October 18, 2026: Demo: dental clinic')));
    expect(inSheet(find.text('Referrals')), findsOneWidget);
    await revealInSheet(tester, inSheet(find.text('Demo: eye clinic')));
    expect(inSheet(find.text('Add referral')), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Mark the referral')), findsNothing);
  });

  testWidgets('while the store is frozen the sheet shows why and nothing of the list', (tester) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, listed());
    await openSheet(tester);
    await revealInSheet(tester, inSheet(find.text('Demo: dental clinic')));
    h.sync.store!.freeze('Demo: handing over');
    h.encounters.changed();
    await settle(tester);
    expect(find.text('Demo: dental clinic'), findsNothing);
    expect(find.text('Demo: handing over'), findsWidgets);
    h.sync.store!.unfreeze();
  });

  testWidgets('a freeze a download tells of first takes the list off the sheet too (V1)', (tester) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, listed());
    await openSheet(tester);
    await revealInSheet(tester, inSheet(find.text('Demo: dental clinic')));
    h.sync.store!.freeze('Demo: handing over');
    // The patient services, not the visits' nor the controller: the sheet sits in the sheets' gate.
    h.patients.changed();
    await settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.text('Demo: dental clinic', skipOffstage: false), findsNothing);
    expect(find.text('Demo: eye clinic', skipOffstage: false), findsNothing);
    expect(inSheet(find.text('Demo: handing over')), findsOneWidget);
    h.sync.store!.unfreeze();
  });
}
