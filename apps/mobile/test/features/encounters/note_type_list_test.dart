import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/features/encounters/note_type_list.dart';

import 'encounter_kit.dart';

/// The note types (lifecycle 9.4, 6.2; card L5-note-type-list): the team's list in its order, as the
/// visit's kind and the person's credential allow it, the Red flags note never among them; tapping
/// a type is Add note, which opens a draft of that type already in the visit (the person's own
/// first, then a teammate's) or makes the note, with the person's Red flags note beside a Medical
/// one; Add another makes a second. Three themes, 200% text and 320 wide; offline, then synced.
void main() {
  const medicalTypes = [
    'General / primary care',
    'Harm reduction',
    'Outreach',
    'Behavioral health',
    'Quick encounter',
    'Sexual and reproductive health',
    'Social needs',
    'Wound care',
  ];

  /// The types the list on screen offers, in its order.
  List<String> offered(WidgetTester tester) => [
    for (final t in tester.widgetList<Text>(
      find.descendant(of: find.byType(NoteTypeList), matching: find.byType(Text)),
    ))
      if (medicalTypes.contains(t.data)) t.data!,
  ];

  Future<void> addAnother(WidgetTester tester) async {
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
    expect(find.byType(NoteTypesScreen), findsOneWidget);
  }

  for (final run in runs) {
    testWidgets('the team’s note types for a Medical visit, a draft’s type saying it opens (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h);
      await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
      await openVisit(tester, visit);
      await addAnother(tester);
      expect(find.widgetWithText(AppBar, 'Note types'), findsOneWidget);
      final heading = find.text('Choose a note type');
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      // The team's order; the Red flags note is the app's to add.
      expect(offered(tester), medicalTypes);
      expect(find.text('Red flags and disposition'), findsNothing);
      final general = find.bySemanticsLabel(
        'General / primary care. A draft of this is in the visit. Tapping it opens the draft.',
      );
      await reveal(tester, general);
      expect(tester.getSemantics(general), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
      final another = find.bySemanticsLabel('Add another General / primary care');
      await reveal(tester, another);
      expect(tester.getSemantics(another), isSemantics(isButton: true, hasTapAction: true));
      final wound = find.bySemanticsLabel('Wound care');
      await reveal(tester, wound);
      expect(tester.getSemantics(wound), isSemantics(isButton: true, hasTapAction: true));
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('a type tapped makes its note, with the person’s Red flags note, and opens it in the list’s place', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openVisit(tester, visit);
    await addAnother(tester);
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    await tapOn(tester, find.bySemanticsLabel('Wound care'));
    final wound = noteOfType(h, visit, 'wound_care')!;
    // The first Medical note of the person's own brings their Red flags note (forms 6.2).
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNotNull);
    expectNoteOpened(tester, wound.id);
    // Going back from the note lands on the encounter screen, not on the list.
    await back(tester);
    expect(find.byType(EncounterScreen), findsOneWidget);
    expect(find.byType(NoteTypesScreen), findsNothing);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.server.records[wound.id], isNotNull);
  });

  testWidgets('a type the person has a draft of opens that draft; Add another makes a second', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await openVisit(tester, visit);
    await addAnother(tester);
    await tapOn(tester, find.bySemanticsLabel(RegExp(r'^General / primary care\. A draft')));
    expectNoteOpened(tester, general);
    expect(notesOf(h, visit).where((n) => n.attributes['noteTypeKey'] == 'general_primary_care'), hasLength(1));

    await back(tester);
    await addAnother(tester);
    await tapOn(tester, find.bySemanticsLabel('Add another General / primary care'));
    final both = notesOf(h, visit).where((n) => n.attributes['noteTypeKey'] == 'general_primary_care').toList();
    expect(both, hasLength(2));
    final second = both.firstWhere((n) => n.id != general);
    expectNoteOpened(tester, second.id);
  });

  testWidgets('a teammate’s draft of the type opens as Add note decides, and no second note is made', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final theirs = await teammatesNote(tester, h, visit);
    await openVisit(tester, visit);
    await addAnother(tester);
    await tapOn(tester, find.bySemanticsLabel(RegExp(r'^Social needs\. A draft')));
    expectNoteOpened(tester, theirs);
    expect(notesOf(h, visit).map((n) => n.id), [theirs]);
  });

  testWidgets('on a visit with no note yet, the list is on the encounter screen, and a note opens over it', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await openVisit(tester, visit);
    expect(find.byType(EncounterScreen), findsOneWidget);
    expect(offered(tester), ['Outreach', 'Social needs']);
    await expectShown(tester, find.text('For clinical notes, switch this visit to Medical.'));
    await expectScreenOk(tester);
    await tapOn(tester, find.bySemanticsLabel('Social needs'));
    final social = noteOfType(h, visit, 'social_needs')!;
    // A Non-Medical note brings no Red flags note.
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    expectNoteOpened(tester, social.id);
    await back(tester);
    // Empty, the note isn't listed (3.1); tapped again, the person's own empty draft opens: no second.
    expect(find.byType(EncounterScreen), findsOneWidget);
    await tapOn(tester, find.bySemanticsLabel('Social needs'));
    expectNoteOpened(tester, social.id);
    expect(notesOf(h, visit), hasLength(1));
    handle.dispose();
  });

  testWidgets('a refusal is shown in the domain layer’s words, and nothing is made', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await openVisit(tester, visit);
    h.serverAhead = const Duration(hours: 2);
    await tester.runAsync(() => h.sync.checkClock(fresh: true));
    await settle(tester);
    await tapOn(tester, find.bySemanticsLabel('Outreach'));
    await expectShown(tester, find.text('Charting is paused until the phone’s clock is right.'));
    expect(notesOf(h, visit), isEmpty);
    expect(location(tester), '/encounters/$visit');
  });

  testWidgets('no note type list on the phone yet: connect once to load it', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await remakeServices(tester, h, noteTypes: false);
    await openVisit(tester, visit);
    await expectShown(tester, find.text('Connect once to load your team’s note types.'));
    expect(offered(tester), isEmpty);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a role that doesn’t chart is told why, and offered nothing', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await remakeServices(tester, h, permissions: ['patients.view']);
    await openVisit(tester, visit);
    await expectShown(tester, find.text('Your role doesn’t chart visits.'));
    expect(offered(tester), isEmpty);
  });
}
