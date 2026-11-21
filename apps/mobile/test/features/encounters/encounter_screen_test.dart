import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/encounters/note_type_list.dart';

import 'encounter_kit.dart';

/// The encounter screen (lifecycle 9.3, 9.4; cards L5-encounter-screen and L5-kind): the visit's
/// notes, each collapsed to its recap line, a teammate's naming them, an empty draft not listed;
/// Remove this note on a draft of the person's own, asked first; Add another note type; Switch to
/// Medical in the header, asking who the patient is on a visit with none. Every read logged. Three
/// themes, 200% text and 320 wide; offline, then synced.
void main() {
  for (final run in runs) {
    testWidgets('the visit’s notes, each to its recap line, a teammate’s by name (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h);
      final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
      final social = await teammatesNote(tester, h, visit);
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await openVisit(tester, visit);
      // A fixed title, and the header read as one heading: who, the kind, the place.
      expect(find.widgetWithText(AppBar, 'Encounter'), findsOneWidget);
      final header = find.bySemanticsLabel('Del, Medical visit, Where: Demo: by the library');
      expect(tester.getSemantics(header), isSemantics(isHeader: true));
      expectNoLegalName(tester);
      // No switch on a Medical visit.
      expect(find.text('Switch to Medical'), findsNothing);

      // Read whole: the type, its state, then its recap.
      final mine = find.bySemanticsLabel('General / primary care, Draft, Chief concern: Demo: cough');
      await expectShown(tester, mine);
      expect(tester.getSemantics(mine), isSemantics(isButton: true, hasTapAction: true));
      // Remove this note is in the menu of the person's own draft only.
      await expectShown(tester, find.byTooltip('More for General / primary care'));
      final theirs = find.bySemanticsLabel('Social needs, Draft, By Demo Blair, Current needs: Food');
      await expectShown(tester, theirs);
      await expectShown(tester, find.text('By Demo Blair'));
      await expectShown(tester, find.text('Current needs: Food'));
      expect(find.byTooltip('More for Social needs'), findsNothing);
      // The Red flags note the app added is an empty draft: it counts for nothing, so isn't listed.
      expect(noteOfType(h, visit, 'red_flags_disposition'), isNotNull);
      expect(find.textContaining('Red flags', skipOffstage: false), findsNothing);
      await expectShown(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
      await expectScreenOk(tester);
      // The read is logged, each record once, whatever rebuilds the screen.
      final logged = auditEvents(store).skip(before).toList();
      expect(logged, ['encounter.viewed', 'note.viewed', 'note.viewed']);
      h.encounters.changed();
      await settle(tester);
      expect(auditEvents(store).skip(before), logged);
      expect([general, social], everyElement(isNotNull));
      handle.dispose();
    });
  }

  testWidgets('a note opens where its form is, by its ID', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await openVisit(tester, visit);
    // Made here and not sent yet.
    final row = find.bySemanticsLabel('General / primary care, Draft, On this phone only, Chief concern: Demo: cough');
    await expectShown(tester, row);
    await tapOn(tester, row);
    expectNoteOpened(tester, general);
  });

  testWidgets('with a screen reader on, Remove this note leaves focus on the list’s Add button (review finding PX-5)', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await chart(tester, h, visit, 'outreach', {'outreach.type': 'wellness_check'});
    await openVisit(tester, visit);
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
      accessibleNavigation: true,
    );
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tapOn(tester, find.byTooltip('More for Social needs'));
    await tapOn(tester, find.text('Remove this note'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Remove'));
    expect(find.text('Note removed'), findsOneWidget);
    expect(tester.takeException(), isNull);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'add a note type');
    handle.dispose();
  });

  testWidgets('Remove this note asks first, then blanks every answer, and the note counts for nothing', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openVisit(tester, visit);
    final menu = find.byTooltip('More for Social needs');
    expect(tester.getSemantics(menu), isSemantics(isButton: true, hasTapAction: true));
    await tapOn(tester, menu);
    await tapOn(tester, find.text('Remove this note'));
    expect(find.text('Remove this note?'), findsOneWidget);
    expect(find.text('Every answer in it is cleared, and the note counts for nothing.'), findsOneWidget);
    await expectGuidelines(tester);
    // Cancel changes nothing.
    await tapOn(tester, find.text('Cancel'));
    expect(answersOf(h, social)['needs.needs'], ['food']);

    // With a screen reader on, focus goes on from the list's Add button once the row has gone
    // (review finding PX-5).
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
      accessibleNavigation: true,
    );
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tapOn(tester, menu);
    await tapOn(tester, find.text('Remove this note'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Remove'));
    expect(answersOf(h, social).values.where((v) => v != null), isEmpty);
    expect(find.text('Note removed'), findsOneWidget);
    // Its only note gone, the list became the note types: nothing to look up where the button was.
    expect(tester.takeException(), isNull);
    // Empty, it is no longer listed: the visit offers its note types again.
    expect(find.bySemanticsLabel(RegExp(r'^Social needs, Draft')), findsNothing);
    await expectShown(tester, find.text('Choose a note type'));
    await expectScreenOk(tester);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final onServer = h.server.records[social]!.fields;
    expect(onServer['data.needs.needs']?.value, isNull);
    handle.dispose();
  });

  testWidgets('Remove this note shows the domain layer’s refusal and changes nothing', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openVisit(tester, visit);
    // The hand-over froze charting between the menu and the answer: nothing is shown or written.
    await tapOn(tester, find.byTooltip('More for Social needs'));
    await tapOn(tester, find.text('Remove this note'));
    h.server.offline = false;
    h.serverAhead = const Duration(hours: 2);
    await tester.runAsync(() => h.sync.checkClock(fresh: true));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Remove'));
    expect(find.text('Charting is paused until the phone’s clock is right.'), findsOneWidget);
    expect(answersOf(h, social)['needs.needs'], ['food']);
  });

  testWidgets('Switch to Medical asks first, keeps every answer, and offers the clinical note types', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openVisit(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Switch to Medical'));
    expect(find.text('Switch this visit to Medical?'), findsOneWidget);
    expect(find.text('The notes and their answers stay as they are. A visit can’t be switched back.'), findsOneWidget);
    await expectGuidelines(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Switch to Medical'));
    expect(h.sync.store!.record(visit)!.fields['kind']!.value, 'medical');
    expect(answersOf(h, social)['needs.needs'], ['food']);
    expect(find.text('Switched to Medical'), findsOneWidget);
    await expectShown(tester, find.bySemanticsLabel('Del, Medical visit, Where: Demo: by the library'));
    // There is no switch back.
    expect(find.widgetWithText(OutlinedButton, 'Switch to Medical'), findsNothing);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
    expect(find.byType(NoteTypesScreen), findsOneWidget);
    await expectShown(tester, find.text('General / primary care'));
    expect(find.text('For clinical notes, switch this visit to Medical.'), findsNothing);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.server.records[visit]!.fields['kind']!.value, 'medical');
    handle.dispose();
  });

  testWidgets('Switch to Medical on a visit with no patient asks who first, then sets both', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    await openVisit(tester, visit);
    await expectShown(tester, find.bySemanticsLabel('No patient, Non-Medical visit, Where: Demo: by the library'));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Switch to Medical'));
    expect(find.text('Who is this visit for?'), findsOneWidget);
    expect(find.text('A Medical visit needs a patient.'), findsOneWidget);
    await expectScreenOk(tester);
    await type(tester, 'visitSearch', 'del');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Del,')));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Switch to Medical'));
    final record = h.sync.store!.record(visit)!;
    expect([record.fields['kind']!.value, record.fields['patientId']!.value], ['medical', p1Id]);
    await expectShown(tester, find.bySemanticsLabel('Del, Medical visit, Where: Demo: by the library'));
    handle.dispose();
  });

  testWidgets('a freeze for a hand-over: the search results in Who go at their next build (V1)', (tester) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    await openVisit(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Switch to Medical'));
    await type(tester, 'visitSearch', 'del');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    expect(find.bySemanticsLabel(RegExp('^Del,')), findsOneWidget);
    h.sync.store!.freeze(frozen);
    // A rebuild the controller didn't cause: the phone turned on its side.
    tester.view.physicalSize = const Size(2532, 1170);
    await tester.pump();
    expect(find.bySemanticsLabel(RegExp('^Del,')), findsNothing);
    expect(find.text(frozen), findsWidgets);
  });

  testWidgets('Switch to Medical on a visit with no patient: closing the question changes nothing', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    await openVisit(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Switch to Medical'));
    await tester.tapAt(const Offset(20, 120));
    await settle(tester);
    expect(find.text('Switch this visit to Medical?'), findsNothing);
    expect(h.sync.store!.record(visit)!.fields['kind']!.value, 'non_medical');
  });

  testWidgets('a credential that can’t chart Medical: no switch, and only Non-Medical note types', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final medical = startVisit(h);
    final other = startVisit(h, kind: VisitKind.nonMedical);
    await asCredential(tester, h, 'chw');
    await openVisit(tester, other);
    expect(find.text('Switch to Medical'), findsNothing);
    expect(find.text('For clinical notes, switch this visit to Medical.'), findsNothing);
    await tester.pageBack();
    await settle(tester);
    // A Medical visit a teammate started: they can still add a Social needs note to it (6.2).
    await openVisit(tester, medical);
    final offered = [
      for (final t in tester.widgetList<Text>(
        find.descendant(of: find.byType(NoteTypeList), matching: find.byType(Text)),
      ))
        t.data,
    ];
    expect(offered, ['Outreach', 'Social needs']);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('the visit stays on the phone while it shows, and the close sweep may take it after (8.2)', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await openVisit(tester, visit);
    expect(h.encounters.sweep.showing, contains(visit));
    await tester.pageBack();
    await settle(tester);
    expect(h.encounters.sweep.showing, isNot(contains(visit)));
  });

  testWidgets('covered by the note’s form, the screen reads nothing at each answer, and catches up after', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs');
    await openVisit(tester, visit);
    // Empty, the note isn't listed yet.
    expect(find.bySemanticsLabel(RegExp(r'^Social needs, Draft')), findsNothing);
    await go(tester, '/notes/$social');
    expectNoteOpened(tester, social);
    final store = h.sync.store!;
    final before = auditEvents(store).length;
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['food']);
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['food', 'hygiene']);
    await settle(tester);
    expect(auditEvents(store).skip(before), isEmpty);
    await back(tester);
    await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Social needs, Draft, ')));
    expect(auditEvents(store).skip(before), ['note.viewed']);
  });

  testWidgets('a visit the phone doesn’t hold says so', (tester) async {
    await signInToChart(tester);
    await openVisit(tester, '0a0a0a0a-0000-4000-8000-000000000000');
    expect(find.text('This visit isn’t on this phone. Connect to open it.'), findsOneWidget);
  });

  testWidgets('a freeze for a hand-over: the visit goes at the screen’s next rebuild, whatever causes it', (
    tester,
  ) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await openVisit(tester, visit);
    expect(find.text('Del'), findsOneWidget);
    h.sync.store!.freeze(frozen);
    h.encounters.changed();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('Del'), findsNothing);
    expect(find.textContaining('General / primary care'), findsNothing);
  });
}
