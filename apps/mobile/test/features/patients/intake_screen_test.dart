import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/sync/local_store.dart';

import '../../helpers/app_harness.dart';
import 'patient_kit.dart';

/// New patient (design 11, 8.1, 12.1), offline as in 13.1 step 5: consent as a radio group, the
/// date-of-birth read-back in a live region with **Yes, that's right** gating Create, the duplicate
/// panel showing Del as likely without a legal name and never taking focus, **Not them**, and Create
/// with no sheet. Then the Create sheet's focus and order, the draft kept on Back, and the card
/// chip's clock sentence.
void main() {
  Future<AppHarness> offlineIntake(WidgetTester tester, {Run? run}) async {
    final h = await signIn(tester, theme: run?.theme, scale: run?.scale ?? 1, narrow: run?.narrow ?? false);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    await openPatientsTab(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'New patient'));
    return h;
  }

  FilledButton createButton(WidgetTester tester) =>
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Create patient'));

  /// 13.1 step 5's typing: Agrees, "Smitty", legal given name "Del", born 7/3/46.
  Future<void> typeSmitty(WidgetTester tester) async {
    await tapOn(tester, find.text('Agrees'));
    await type(tester, 'preferredName', 'Smitty');
    await type(tester, 'legalGiven', 'Del');
    await type(tester, 'birth', '7/3/46');
    await tester.pump(const Duration(milliseconds: 900));
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('a new patient offline: read-back, likely match, Not them, Create (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await offlineIntake(tester, run: run);
      expect(find.text('New patient'), findsWidgets);
      await expectScreenOk(tester);

      // Consent first, as a radio group with nothing chosen.
      final agrees = find.bySemanticsLabel('Agrees');
      await reveal(tester, find.text('Agrees'));
      await expectScreenOk(tester);
      expect(tester.getSemantics(agrees), isSemantics(isInMutuallyExclusiveGroup: true, isSelected: false));
      await tapOn(tester, find.text('Agrees'));
      expect(tester.getSemantics(agrees), isSemantics(isInMutuallyExclusiveGroup: true, isSelected: true));

      await type(tester, 'preferredName', 'Smitty');
      await type(tester, 'legalGiven', 'Del');
      await settle(tester);
      // The panel arrived while the worker was typing the legal name: focus stayed there.
      final givenField = find.byKey(const ValueKey('phi.legalGiven'), skipOffstage: false);
      expect(tester.widget<TextField>(givenField).focusNode!.hasFocus, isTrue);
      await expectShown(tester, find.text('1 possible match'));

      await type(tester, 'birth', '7/3/46');
      // Read back only after a pause in typing.
      expect(find.text('July 3, 1946 · age 80'), findsNothing);
      await tester.pump(const Duration(milliseconds: 900));
      final readBack = find.text('July 3, 1946 · age 80');
      await expectShown(tester, readBack);
      expect(tester.getSemantics(readBack), isSemantics(isLiveRegion: true));
      FocusManager.instance.primaryFocus?.unfocus();
      await settle(tester);

      // A two-digit year with day and month both 12 or less: Create waits for the confirmation.
      expect(createButton(tester).onPressed, isNull);
      await tapOn(tester, find.text('Yes, that’s right'));
      expect(createButton(tester).onPressed, isNotNull);

      // The panel: Del, likely, with the reasons in words and no legal name.
      final count = find.text('1 possible match');
      await expectShown(tester, count);
      expect(tester.getSemantics(count), isSemantics(isLiveRegion: true));
      final card = find.bySemanticsLabel(RegExp(r'^Likely the same person\. Del\.'));
      await expectShown(tester, card);
      expect(
        tester.getSemantics(card).label,
        contains('Why: Name they go by matches; Street name matches; Birth date: day and month swapped'),
      );
      expectNoLegalName(tester);
      await expectScreenOk(tester);

      await tapOn(tester, find.text('Not them'));
      await expectShown(tester, find.text('Not Del'));

      await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));
      // Every likely card was dismissed: no sheet; the profile opens.
      expect(find.text('No, create a new patient'), findsNothing);
      expect(find.byType(PatientScreen), findsOneWidget);

      final store = h.sync.store!;
      final outbox = store.outbox();
      final checks = [
        for (final e in outbox)
          if (e.entity == entityAudit && (e.value! as Map)['action'] == 'patient.match_checked') e,
      ];
      final create = outbox.singleWhere((e) => e.entity == entityPatient && e.op == 'create');
      expect(checks, isNotEmpty);
      expect(checks.last.seq, lessThan(create.seq));
      final value = create.value! as Map<String, Object?>;
      final matchCheck = value['matchCheck']! as Map<String, Object?>;
      expect(matchCheck['where'], 'phone');
      expect(matchCheck['dismissed'], [p1Id]);
      expect(matchCheck['checkId'], (checks.last.value! as Map)['checkId']);
      expect(value['preferredName'], 'Smitty');
      expect(value['birth'], {'precision': 'day', 'date': '1946-07-03'});
      expect((value['consent']! as Map)['decision'], 'given');
      expect((value['privacyNotice']! as Map)['decision'], 'acknowledged');
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('Create with a likely match still showing asks once, heading first, and can create', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await offlineIntake(tester);
    await typeSmitty(tester);
    await tapOn(tester, find.text('Yes, that’s right'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));

    final heading = find.text('Is this Del, born March 7, 1946, usually Demo: by the made-up Elm St underpass?');
    expect(heading, findsOneWidget);
    expect(tester.getSemantics(heading), isSemantics(isHeader: true));
    // Focus is on the question, so a screen reader starts there.
    expect(FocusManager.instance.primaryFocus?.context?.findAncestorWidgetOfExactType<BottomSheet>(), isNotNull);
    final open = tester.getRect(find.text('Open Del’s chart'));
    final create = tester.getRect(find.text('No, create a new patient'));
    expect(open.top, lessThan(create.top));
    await expectGuidelines(tester);

    // Back closes it with nothing done.
    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(find.text('No, create a new patient'), findsNothing);
    expect(h.sync.store!.outbox().where((e) => e.entity == entityPatient), isEmpty);

    await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));
    await tapOn(tester, find.text('No, create a new patient'));
    final create2 = h.sync.store!.outbox().singleWhere((e) => e.entity == entityPatient);
    expect(((create2.value! as Map)['matchCheck']! as Map)['dismissed'], [p1Id]);
    expect(find.byType(PatientScreen), findsOneWidget);
    handle.dispose();
  });

  testWidgets('This is them opens the chart and offers to add what was typed', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await offlineIntake(tester);
    await tapOn(tester, find.text('Agrees'));
    await type(tester, 'preferredName', 'Del');
    await type(tester, 'alias', 'Red');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add'));
    await type(tester, 'usualArea', 'Demo: by the library steps');
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
    await tapOn(tester, find.text('This is them'));
    expect(find.text('Open Del’s chart?'), findsOneWidget);
    await tapOn(tester, find.text('Open the chart'));
    expect(find.byType(PatientScreen), findsOneWidget);
    await expectShown(tester, find.text('Add what you typed?'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Add what you typed'));
    final store = h.sync.store!;
    // Nothing new was created: a street name and an edit on Del's chart.
    expect(store.outbox().where((e) => e.entity == entityPatient && e.op == 'create'), isEmpty);
    final alias = store.outbox().singleWhere((e) => e.entity == entityAlias);
    expect(alias.value, {'patientId': p1Id, 'alias': 'Red'});
    final edit = store.outbox().singleWhere((e) => e.entity == entityPatient && e.op == 'set');
    expect(edit.field, 'usualArea');
    expect(h.patients.patients.draft(), isNull);
    handle.dispose();
  });

  testWidgets('Back with anything typed keeps a draft the Patients tab offers to continue', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await offlineIntake(tester);
    await tapOn(tester, find.text('Agrees'));
    await type(tester, 'preferredName', 'Smitty');
    await tester.binding.handlePopRoute();
    await settle(tester);
    expect(find.text('Keep this as a draft?'), findsOneWidget);
    await tapOn(tester, find.text('Keep draft'));
    expect(h.patients.patients.draft()?['preferred'], 'Smitty');
    await expectShown(tester, find.text('Continue the patient you were adding?'));
    await tapOn(tester, find.text('Continue'));
    expect((await fieldNamed(tester, 'preferredName')).controller!.text, 'Smitty');
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('declining ends the intake with nothing recorded', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await offlineIntake(tester);
    await tapOn(tester, find.text('Declines'));
    await expectShown(tester, find.textContaining('No record is made.'));
    expect(find.text('Create patient'), findsNothing);
    await tapOn(tester, find.text('Close without saving'));
    expect(h.sync.store!.outbox().where((e) => e.entity == entityPatient), isEmpty);
    handle.dispose();
  });

  testWidgets('a card wanted while the clock is off waits, and the chip says so', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    h.serverAhead = const Duration(minutes: 7);
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    await openPatientsTab(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'New patient'));
    await tapOn(tester, find.text('Agrees'));
    await type(tester, 'visualDescriptor', 'Demo: man in a blue wheelchair');
    await tapOn(tester, find.text('Wants a card'));
    await expectShown(tester, find.text('The card can be made once the phone’s clock is right.'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));
    // The clock never fails an intake (D35): the patient is saved, wanting a card, without one.
    final create = h.sync.store!.outbox().singleWhere((e) => e.entity == entityPatient);
    expect((create.value! as Map)['idCardChoice'], 'wants');
    expect(h.sync.store!.outbox().where((e) => e.entity == entityIdLink), isEmpty);
    await expectShown(tester, find.text('Make the card once the phone’s clock is right.'));
    handle.dispose();
  });

  testWidgets('errors are listed at the top, linked to their fields', (tester) async {
    final handle = tester.ensureSemantics();
    await offlineIntake(tester);
    await tapOn(tester, find.text('Agrees'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));
    final error = find.text('Add a name or what they look like, so the team can recognise them.');
    await expectShown(tester, error);
    expect(tester.getSemantics(find.text('One thing to fix')), isSemantics(isLiveRegion: true));
    // Focus moved to the first field to fix.
    expect((await fieldNamed(tester, 'preferredName')).focusNode!.hasFocus, isTrue);
    await expectScreenOk(tester);
    handle.dispose();
  });
}
