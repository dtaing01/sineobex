import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/encounter_repository.dart' show EncounterCompletion;
import 'package:sineobex_field/features/encounters/note_screen.dart';
import 'package:sineobex_field/features/encounters/summary_screen.dart';
import 'package:sineobex_field/features/forms/note_read_view.dart';
import 'package:sineobex_field/patients/problems.dart' show Problems;
import 'package:sineobex_field/sync/local_store.dart' show entityNote;

import 'encounter_kit.dart';

/// The note screen (lifecycle 9.5; card L5-note-screen): the frame around a note's form. The header
/// names the patient by their preferred name with the allergy badge; every answer is saved as it is
/// entered; Save & Close leaves for the chart and asks for a sync, Continue goes to the summary; a
/// finished note opens read-only; a conflict shows both values and its choice syncs; an answer the
/// server would hold from the person is refused and drawn again from what is stored (D92); Expand
/// and Add to the problem list as the domain layer offers them. Three themes, 200% text and 320
/// wide; offline first.
void main() {
  /// The chip of [label] in the form, as a screen reader finds it.
  Finder chip(String label) => find.bySemanticsLabel(label).last;

  /// The section [id]'s header, tapped to open it.
  Future<void> openSection(WidgetTester tester, String id) => tapOn(tester, find.byKey(ValueKey('form.section.$id')));

  /// Lets a typing pause pass, so what was typed is saved.
  Future<void> pause(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('the note’s frame: who, the allergy badge, the form, saved as entered (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h);
      final general = await chart(tester, h, visit, 'general_primary_care', {
        'reason.reasons': ['new_concern'],
      });
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await openNote(tester, general);
      // A fixed title, and the header read as one heading: the patient's preferred name and the type.
      expect(find.widgetWithText(AppBar, 'Note'), findsOneWidget);
      final header = find.bySemanticsLabel('Del, General / primary care');
      expect(tester.getSemantics(header), isSemantics(isHeader: true));
      await expectShown(tester, find.bySemanticsLabel('Allergy: penicillin, severe'));
      await expectShown(tester, find.text('Allergy: penicillin (severe)'));
      expectNoLegalName(tester);
      await expectShown(tester, find.text('Draft'));
      // The form, the first section open; the answer as the store holds it.
      expect(chip('New concern'), findsOneWidget);
      expect(tester.getSemantics(chip('New concern')), isSemantics(isSelected: true, isButton: true));

      // Typed: saved once typing pauses, and shown as waiting to send.
      await tester.enterText(find.byKey(const ValueKey('phi.form.concern')), 'Demo: cough for a week');
      await pause(tester);
      expect(answersOf(h, general)['reason.concern'], 'Demo: cough for a week');
      expect(find.text('Waiting to send'), findsWidgets);
      await expectShown(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
      await expectShown(tester, find.widgetWithText(FilledButton, 'Continue'));
      await expectScreenOk(tester);
      // The read is logged once; a save reads again and logs nothing new.
      expect(auditEvents(store).skip(before), ['note.viewed']);
      handle.dispose();
    });
  }

  testWidgets('Save & Close while typing keeps what was typed, opens the chart and syncs', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care');
    await openNote(tester, general);
    // Typed, and Save & Close pressed before typing pauses: the box saves as it leaves.
    await tester.enterText(find.byKey(const ValueKey('phi.form.concern')), 'Demo: cough');
    await tester.pump();
    expect(answersOf(h, general)['reason.concern'], isNull);
    h.server.offline = false;
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    await settle(tester);
    expect(location(tester), '/patients/$p1Id');
    expect(find.byType(NoteScreen), findsNothing);
    expect(answersOf(h, general)['reason.concern'], 'Demo: cough');
    // Asked for a sync: the draft reached the server, and stays on the phone (3.2).
    expect(h.server.records[general]!.fields['data.reason.concern']?.value, 'Demo: cough');
    expect(h.sync.store!.record(general), isNotNull);
  });

  testWidgets('Save & Close lands on the chart under the visit, and Home for a visit with no patient', (tester) async {
    final h = await signInToChart(tester);
    await go(tester, '/patients/$p1Id');
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs');
    await go(tester, '/encounters/$visit');
    await openNote(tester, social);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    expect(location(tester), '/patients/$p1Id');
    // The chart that was under the visit, not a second one: back goes Home.
    await tester.pageBack();
    await settle(tester);
    expect(location(tester), '/');

    final none = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    final theirs = await chart(tester, h, none, 'social_needs');
    await openNote(tester, theirs);
    expect(find.bySemanticsLabel('No patient, Social needs'), findsOneWidget);
    expect(find.textContaining('Allerg'), findsNothing);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    expect(location(tester), '/');
  });

  testWidgets('Continue goes to the visit’s summary', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs');
    await openNote(tester, social);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Continue'));
    expect(location(tester), '/encounters/$visit/summary');
    expect(find.byType(SummaryScreen), findsOneWidget);
  });

  testWidgets('a finished note opens read-only, as its read view', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    final r = h.encounters.repository;
    final plan = (await tester.runAsync(() => r.openComplete(visit)))!;
    r.complete(plan);
    await openNote(tester, social);
    expect(find.byType(NoteReadView), findsOneWidget);
    await expectShown(tester, find.text('Waiting to send'));
    expect(find.bySemanticsLabel(RegExp('^Current needs')), findsOneWidget);
    // Nothing to change: no form, no box, no Save & Close.
    expect(find.byType(TextField), findsNothing);
    expect(find.text('Save & Close'), findsNothing);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a conflict shows both values; the choice is made in the store and synced', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {'needs.housing': 'shelter'});
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.serverEdit(social, 'data.needs.housing', 'transitional', by: blair);
    h.encounters.repository.saveAnswer(social, 'needs.housing', 'permanent');
    await syncAndRefresh(tester, h);
    await openNote(tester, social);
    await openSection(tester, 'needs');
    await expectShown(tester, find.text('This field already had a different value. Choose which one to keep.'));
    expect(find.text('Permanent'), findsWidgets);
    expect(find.text('Transitional'), findsWidgets);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Use my value'));
    await settle(tester);
    expect(find.text('This field already had a different value. Choose which one to keep.'), findsNothing);
    // Synced after the choice, as Needs attention does.
    expect(h.server.records[social]!.fields['data.needs.housing']?.value, 'permanent');
  });

  testWidgets('an answer the server would hold from a non-author is refused and drawn from the store (D92)', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    // Blair's General draft; this person may not see sensitive exams, so the exam picker could hold
    // a code they were never sent.
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final theirs = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {
        'reason.concern': 'Demo: knee pain',
        'exam.systems': ['skin'],
      },
    }, by: blair);
    expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, theirs)), isTrue);
    h.server.offline = true;
    await openNote(tester, theirs);
    expect(find.text('By Demo Blair'), findsOneWidget);
    await openSection(tester, 'exam');
    final queued = h.sync.store!.outbox().length;
    await tester.tap(chip('Pulmonary'));
    await settle(tester);
    expect(find.text('You can’t change this answer.'), findsOneWidget);
    expect(h.sync.store!.outbox(), hasLength(queued));
    expect(answersOf(h, theirs)['exam.systems'], ['skin']);
    // Drawn again from the store: the tap is not shown as picked.
    expect(tester.getSemantics(chip('Pulmonary')), isSemantics(isSelected: false, isButton: true));
    // A field they may change is saved as ever.
    await openSection(tester, 'reason');
    await tester.tap(chip('Follow-up'));
    await settle(tester);
    expect(answersOf(h, theirs)['reason.reasons'], ['follow_up']);
    expect(find.text('You can’t change this answer.'), findsNothing);
  });

  testWidgets('Expand carries a quick part into its full note, which opens', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final quick = await chart(tester, h, visit, 'quick_encounter', {
      'visit.parts': ['general'],
      'general.concern': 'Demo: sore throat',
    });
    await openNote(tester, quick);
    await openSection(tester, 'general');
    await expectShown(tester, find.bySemanticsLabel('Expand into General / primary care, from General'));
    await tapOn(tester, find.text('Expand into General / primary care'));
    await settle(tester);
    final general = noteOfType(h, visit, 'general_primary_care')!;
    expectNoteOpened(tester, general.id);
    expect(answersOf(h, general.id)['reason.concern'], 'Demo: sore throat');
  });

  testWidgets('Add to the problem list under a picked diagnosis', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {
      'problems.e1234567.entryAt': '2026-10-20T15:00:00.000Z',
      'problems.e1234567.diagnosis.code': 'J02.9',
      'problems.e1234567.diagnosis.label': 'Acute pharyngitis, unspecified',
      'problems.e1234567.status': 'new',
    });
    await openNote(tester, general);
    await openSection(tester, 'problems');
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Add to the problem list')));
    await settle(tester);
    expect(find.text('Added to the problem list'), findsOneWidget);
    final problems = Problems(h.sync.store!, permissions: h.encounters.user.permissions.toList()).problemsOf(p1Id)!;
    expect([for (final p in problems) (p.code?.code, p.status, p.encounterId)], [('J02.9', 'new', visit)]);
    await expectShown(tester, find.text('On the problem list'));
  });

  testWidgets('charting paused for the clock: the form can’t be changed, and says why', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs');
    h.server.offline = false;
    h.serverAhead = const Duration(hours: 2);
    await tester.runAsync(() => h.sync.checkClock(fresh: true));
    await openNote(tester, social);
    await expectShown(tester, find.text('Charting is paused until the phone’s clock is right.'));
    // Read-only: its answers as words, no chip to tap.
    expect(find.bySemanticsLabel('Food'), findsNothing);
    expect(find.bySemanticsLabel('Current needs'), findsOneWidget);
  });

  testWidgets('a frozen store shows nothing of the note', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openNote(tester, social);
    h.sync.store!.freeze('Your access to this team ended. Its records are being handed over.');
    h.encounters.changed();
    await settle(tester);
    expect(find.text('Your access to this team ended. Its records are being handed over.'), findsOneWidget);
    expect(find.text('Del'), findsNothing);
    expect(find.text('Food'), findsNothing);
  });

  testWidgets('a note the phone doesn’t hold says so', (tester) async {
    await signInToChart(tester);
    await openNote(tester, '0f000000-0000-4000-8000-000000000001');
    expect(find.text('This note isn’t on this phone. Connect to open it.'), findsOneWidget);
  });
}
