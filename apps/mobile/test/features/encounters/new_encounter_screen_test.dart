import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/features/encounters/kind_screen.dart';
import 'package:sineobex_field/features/encounters/new_encounter_screen.dart';
import 'package:sineobex_field/features/patients/intake_screen.dart';

import 'encounter_kit.dart';

/// New encounter (lifecycle 9.2, 9.3, 3.10; cards L5-new-encounter and L5-kind): Who, with phase 3's
/// search, New patient and No patient; Where, a private text field; then Medical or Non-Medical. The
/// visit is written only when the last step is answered, and the encounter screen takes this one's
/// place. A Medical visit needs its patient; a credential that can't chart Medical is not asked the
/// kind. While the clock check fails Start says why and writes nothing. Three themes, 200% text and
/// 320 wide; offline, then synced.
void main() {
  const del = 'Del';

  Future<void> openNewEncounter(WidgetTester tester, {String? patientId}) async {
    await go(tester, patientId == null ? '/encounters/new' : '/patients/$patientId/encounters/new');
    expect(find.byType(NewEncounterScreen), findsOneWidget);
  }

  Future<void> searchAndChoose(WidgetTester tester, String query) async {
    await type(tester, 'visitSearch', query);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    await tapOn(tester, find.bySemanticsLabel(RegExp('^$del,')));
  }

  /// The step's heading, read as a heading that says itself when the step changes.
  void expectStep(WidgetTester tester, String heading, {String? step}) {
    final h = find.text(heading).first;
    expect(tester.getSemantics(h), isSemantics(isHeader: true, isLiveRegion: true));
    if (step != null) expect(find.text(step), findsOneWidget);
  }

  for (final run in runs) {
    testWidgets('Who, Where, Medical: a visit for Del, written once the kind is chosen (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      await openNewEncounter(tester);
      // A fixed title: the app switcher never shows who the visit is for.
      expect(find.widgetWithText(AppBar, 'New encounter'), findsOneWidget);
      expectStep(tester, 'Who is this visit for?', step: 'Step 1 of 3');
      await expectShown(tester, find.bySemanticsLabel('No patient. ${_noPatientLine()}'));
      await expectShown(tester, find.bySemanticsLabel('New patient. Register them, then the visit goes on for them.'));
      await expectScreenOk(tester);

      await searchAndChoose(tester, 'del');
      expectStep(tester, 'Where', step: 'Step 2 of 3');
      await expectShown(tester, find.text('For Del'));
      expectNoLegalName(tester);
      final place = await fieldNamed(tester, 'locationText');
      expect(place.decoration!.labelText, 'Where are you?');
      await expectScreenOk(tester);
      await type(tester, 'locationText', '  Demo: under the Fort Street bridge  ');
      await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));

      expectStep(tester, 'Medical or Non-Medical', step: 'Step 3 of 3');
      expect(find.byType(KindChoice), findsOneWidget);
      // Two large buttons, each read as the design's line.
      for (final line in [
        'Medical: clinical notes, orders, signing',
        'Non-Medical: outreach, supplies, social needs',
      ]) {
        final button = find.bySemanticsLabel(line);
        await reveal(tester, button);
        expect(tester.getSemantics(button), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
        expect(tester.getSize(button).height, greaterThanOrEqualTo(96));
      }
      await expectScreenOk(tester);
      // Nothing is written before the last step is answered.
      expect(visits(h), isEmpty);

      await tapOn(tester, find.bySemanticsLabel('Medical: clinical notes, orders, signing'));
      final visit = visits(h).single;
      expect(visit.fields['kind']!.value, 'medical');
      expect(visit.fields['patientId']!.value, p1Id);
      // Trimmed, as the domain layer stores it.
      expect(visit.fields['locationText']!.value, 'Demo: under the Fort Street bridge');
      expect(find.byType(EncounterScreen), findsOneWidget);
      expect(find.byType(NewEncounterScreen), findsNothing);
      expect(location(tester), '/encounters/${visit.id}');
      handle.dispose();
    });
  }

  testWidgets('offline, then synced: the server holds the visit as Start wrote it', (tester) async {
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await searchAndChoose(tester, 'del');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Non-Medical: outreach, supplies, social needs'));
    final visit = visits(h).single;
    expect(h.server.records[visit.id], isNull);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final held = h.server.records[visit.id]!;
    expect(held.fields['kind']!.value, VisitKind.nonMedical.code);
    expect(held.fields['patientId']!.value, p1Id);
    expect(held.fields['locationText']?.value, isNull);
  });

  testWidgets('No patient: Medical is refused in the domain layer’s words, and Choose the patient goes back to Who', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await tapOn(tester, find.bySemanticsLabel('No patient. ${_noPatientLine()}'));
    await expectShown(tester, find.text('No patient'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Medical: clinical notes, orders, signing'));
    await expectShown(tester, find.text('A clinical note needs a patient. Choose who this visit is for.'));
    expect(visits(h), isEmpty);
    await expectScreenOk(tester);

    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Choose the patient'));
    expectStep(tester, 'Who is this visit for?', step: 'Step 1 of 3');
    await searchAndChoose(tester, 'del');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    expect(find.text('A clinical note needs a patient. Choose who this visit is for.'), findsNothing);
    await tapOn(tester, find.bySemanticsLabel('Medical: clinical notes, orders, signing'));
    expect(visits(h).single.fields['patientId']!.value, p1Id);
    handle.dispose();
  });

  testWidgets('No patient, Non-Medical: a visit with no patient', (tester) async {
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await tapOn(tester, find.bySemanticsLabel('No patient. ${_noPatientLine()}'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Non-Medical: outreach, supplies, social needs'));
    final visit = visits(h).single;
    expect(visit.fields['patientId']?.value, isNull);
    expect(visit.fields['kind']!.value, 'non_medical');
    expect(find.byType(EncounterScreen), findsOneWidget);
  });

  testWidgets('going back moves a step back, and Change goes back to Who', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await searchAndChoose(tester, 'del');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    expectStep(tester, 'Medical or Non-Medical');
    await tester.pageBack();
    await settle(tester);
    expectStep(tester, 'Where');
    final change = find.bySemanticsLabel('Change who this visit is for');
    expect(tester.getSemantics(change), isSemantics(isButton: true, hasTapAction: true));
    await tapOn(tester, change);
    expectStep(tester, 'Who is this visit for?');
    await tester.pageBack();
    await settle(tester);
    expect(find.byType(NewEncounterScreen), findsNothing);
    expect(visits(h), isEmpty);
    handle.dispose();
  });

  testWidgets('started from a profile, Who is skipped and the visit is for that patient', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    await go(tester, '/patients/$p1Id');
    await openNewEncounter(tester, patientId: p1Id);
    expectStep(tester, 'Where', step: 'Step 1 of 2');
    await expectShown(tester, find.text('For Del'));
    expect(find.text('Change'), findsNothing);
    expectNoLegalName(tester);
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    expectStep(tester, 'Medical or Non-Medical', step: 'Step 2 of 2');
    await tapOn(tester, find.bySemanticsLabel('Medical: clinical notes, orders, signing'));
    expect(visits(h).single.fields['patientId']!.value, p1Id);
    // Back from the visit lands on the chart it was started from.
    await tester.pageBack();
    await settle(tester);
    expect(location(tester), '/patients/$p1Id');
    handle.dispose();
  });

  testWidgets('a credential that can’t chart Medical is not asked the kind: its visit starts Non-Medical', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    await asCredential(tester, h, 'chw');
    await openNewEncounter(tester);
    expectStep(tester, 'Who is this visit for?', step: 'Step 1 of 2');
    await searchAndChoose(tester, 'del');
    expectStep(tester, 'Where', step: 'Step 2 of 2');
    expect(find.text('Next'), findsNothing);
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Start the visit'));
    final visit = visits(h).single;
    expect(visit.fields['kind']!.value, 'non_medical');
    expect(visit.fields['patientId']!.value, p1Id);
    expect(find.byType(KindChoice), findsNothing);
    expect(find.byType(EncounterScreen), findsOneWidget);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.server.records[visit.id], isNotNull);
    handle.dispose();
  });

  testWidgets('while the clock check fails, Start says why and writes nothing (D35)', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester, offline: false);
    h.serverAhead = const Duration(hours: 2);
    await tester.runAsync(() => h.sync.checkClock(fresh: true));
    await settle(tester);
    expect(h.sync.store!.chartingPaused, isTrue);
    await openNewEncounter(tester);
    // Before anything is pressed, in the store's own words.
    await expectShown(tester, find.text('Charting is paused until the phone’s clock is right.'));
    await tapOn(tester, find.bySemanticsLabel('No patient. ${_noPatientLine()}'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Non-Medical: outreach, supplies, social needs'));
    // The refusal is the store's sentence, the one the screen showed first.
    expect(find.text('Charting is paused until the phone’s clock is right.'), findsNWidgets(2));
    expect(visits(h), isEmpty);
    expect(find.byType(NewEncounterScreen), findsOneWidget);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('New patient opens the intake, which comes back to Where with the new patient', (tester) async {
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await tapOn(tester, find.bySemanticsLabel('New patient. Register them, then the visit goes on for them.'));
    expect(find.byType(IntakeScreen), findsOneWidget);
    expect(location(tester), '/patients/new');
    await tapOn(tester, find.text('Agrees'));
    await type(tester, 'preferredName', 'Wren');
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Create patient'));
    // Back on New encounter, at Where, for the patient just registered; no chart opened.
    expect(find.byType(IntakeScreen), findsNothing);
    expect(find.byType(NewEncounterScreen), findsOneWidget);
    expect(location(tester), '/encounters/new');
    expectStep(tester, 'Where', step: 'Step 2 of 3');
    await expectShown(tester, find.text('For Wren'));
    expect(visits(h), isEmpty);
  });

  testWidgets('a role without patient records charts with No patient only', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester, permissions: ['encounters.chart']);
    await openNewEncounter(tester);
    await expectShown(tester, find.text('Your role in this team doesn’t include patient records.'));
    expect(find.byKey(const ValueKey('phi.visitSearch')), findsNothing);
    expect(find.text('New patient'), findsNothing);
    await tapOn(tester, find.bySemanticsLabel('No patient. ${_noPatientLine()}'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    await tapOn(tester, find.bySemanticsLabel('Non-Medical: outreach, supplies, social needs'));
    expect(visits(h).single.fields['patientId']?.value, isNull);
    handle.dispose();
  });

  testWidgets('each search is a run of its own, logged before it shows, its count said once', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    final before = auditEvents(h.sync.store!).length;
    await type(tester, 'visitSearch', 'del');
    // Typing searches nothing: a run is asked for.
    expect(auditEvents(h.sync.store!).length, before);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    expect(auditEvents(h.sync.store!).skip(before), ['patient.searched']);
    final count = find.text('1 patient found on this phone');
    expect(tester.getSemantics(count), isSemantics(isLiveRegion: true));
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a freeze for a hand-over: what was read goes at the screen’s next build, whatever causes it', (
    tester,
  ) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signInToChart(tester);
    await openNewEncounter(tester);
    await searchAndChoose(tester, 'del');
    await expectShown(tester, find.text('For Del'));
    h.sync.store!.freeze(frozen);
    // A rebuild the controller didn't cause: the person's own tap, to a step that would name them.
    await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('For Del'), findsNothing);
    expect(visits(h), isEmpty);
  });
}

String _noPatientLine() => 'For someone who’d rather not be registered. The visit takes Non-Medical notes only.';
