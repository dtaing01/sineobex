import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/widgets/form_bits.dart' show ErrorMessage;
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/forms/note_read_view.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAudit, entityReferral;
import 'package:sineobex_field/sync/local_store.dart' show entityNote;

import 'encounter_kit.dart';

/// A note form's actions on the note screen (forms 6, 8.1; card F7-actions): `open_note_type` adds or
/// opens a note of its type in the visit, only where that type can be started there; the Red flags
/// note goes through `addRedFlagsNote`, and a teammate's finished one, which makes the person's own
/// needless, opens read-only; `add_referral` adds a referral made at the visit. Offline.
void main() {
  /// An action button of the form, by its label.
  Finder action(String label) => find.widgetWithText(OutlinedButton, label);

  Future<void> openSection(WidgetTester tester, String id) => tapOn(tester, find.byKey(ValueKey('form.section.$id')));

  /// Scrolls the sheet's own list to [finder] and taps it.
  Future<void> tapInSheet(WidgetTester tester, Finder finder) async {
    final list = find.descendant(of: find.byType(BottomSheet), matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(finder, 100, scrollable: list);
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await settle(tester);
  }

  testWidgets('Chart in Wound care opens the visit’s Wound care note', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {
      'exam.systems': ['skin'],
      'skin_findings.e1234567.entryAt': '2026-10-20T15:00:00.000Z',
      'skin_findings.e1234567.type': ['ulcer'],
    });
    await openNote(tester, general);
    await openSection(tester, 'skin_findings');
    await tapOn(tester, action('Chart in Wound care'));
    await settle(tester);
    final wound = noteOfType(h, visit, 'wound_care')!;
    expectNoteOpened(tester, wound.id);
    // Tapped again from the exam, the same draft opens: no second note.
    await tester.pageBack();
    await settle(tester);
    await tapOn(tester, action('Chart in Wound care'));
    await settle(tester);
    expectNoteOpened(tester, wound.id);
    expect(notesOf(h, visit).where((n) => n.attributes['noteTypeKey'] == 'wound_care'), hasLength(1));
  });

  testWidgets('Go to Red flags opens the person’s own Red flags note, added if they have none', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    // An Outreach note brings no Red flags note: it is Non-Medical.
    final outreach = await chart(tester, h, visit, 'outreach', {
      'outreach.new_need': ['emergency'],
    });
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    await openNote(tester, outreach);
    await tapOn(tester, action('Go to Red flags and disposition'));
    await settle(tester);
    final flags = noteOfType(h, visit, 'red_flags_disposition')!;
    expectNoteOpened(tester, flags.id);
    await tester.pageBack();
    await settle(tester);
    await tapOn(tester, action('Go to Red flags and disposition'));
    await settle(tester);
    expectNoteOpened(tester, flags.id);
    expect(notesOf(h, visit).where((n) => n.attributes['noteTypeKey'] == 'red_flags_disposition'), hasLength(1));
  });

  testWidgets('a teammate’s finished Red flags note makes the person’s needless: it opens read-only', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final theirs = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'red_flags_disposition',
      'noteTypeVersion': 1,
      'data': {'red_flags.emergency': 'no'},
    }, by: blair);
    h.server.finishNote(theirs, status: 'signed');
    expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, theirs)), isTrue);
    h.server.offline = true;
    final outreach = await chart(tester, h, visit, 'outreach', {
      'outreach.new_need': ['emergency'],
    });
    final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await openNote(tester, outreach);
    final store = h.sync.store!;
    final before = store.outbox().length;
    await tapOn(tester, action('Go to Red flags and disposition'));
    await settle(tester);
    expectNoteOpened(tester, theirs);
    expect(find.byType(NoteReadView), findsOneWidget);
    expect(find.text('By Demo Blair'), findsOneWidget);
    // Only what the note screen shows is logged, once: not the visit, nor its other notes (10.1).
    final logged = [
      for (final e in store.outbox().skip(before))
        if (e.entity == entityAudit) (e.value! as Map<String, Object?>)['entityId'],
    ];
    expect(logged, [theirs]);
    expect(logged.contains(general), isFalse);
    // None of the person's own was made.
    expect(notesOf(h, visit).where((n) => n.attributes['noteTypeKey'] == 'red_flags_disposition'), hasLength(1));
  });

  testWidgets('an action whose note type can’t be started in the visit is not drawn', (tester) async {
    final h = await signInToChart(tester);
    // The Red flags note is Medical: a Non-Medical visit can't take it (forms 10.1 #39).
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final outreach = await chart(tester, h, visit, 'outreach', {
      'outreach.new_need': ['emergency'],
    });
    await openNote(tester, outreach);
    expect(find.text('Go to Red flags and disposition'), findsNothing);
    // A visit with no patient takes no referral.
    final none = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    final social = await chart(tester, h, none, 'social_needs');
    await openNote(tester, social);
    expect(find.text('Add referral'), findsNothing);
  });

  for (final run in runs) {
    testWidgets('Add referral from a note: a date, today by default, and the details (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h, kind: VisitKind.nonMedical);
      final social = await chart(tester, h, visit, 'social_needs');
      await openNote(tester, social);
      await tapOn(tester, action('Add referral'));
      await settle(tester);
      expect(find.text('Date: October 22, 2026'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Change date'), findsOneWidget);
      await expectScreenOk(tester);
      // Nothing typed: the domain layer's refusal, in its words, and nothing written.
      final referrals = h.sync.store!.recordIds().where((id) => h.sync.store!.record(id)!.entity == entityReferral);
      expect(referrals, isEmpty);
      final add = find.widgetWithText(FilledButton, 'Add referral');
      await tapInSheet(tester, add);
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.textContaining('details', findRichText: true), findsWidgets);
      expect(find.byType(ErrorMessage), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('phi.referralDetails')), 'Demo: shelter intake on Monday');
      await tester.pump();
      await tapInSheet(tester, add);
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('Referral added'), findsOneWidget);
      final made = [
        for (final id in h.sync.store!.recordIds())
          if (h.sync.store!.record(id)! case final r when r.entity == entityReferral) r,
      ];
      expect(made, hasLength(1));
      expect(made.single.attributes['encounterId'], visit);
      expect(made.single.attributes['details'], 'Demo: shelter intake on Monday');
      expect(made.single.attributes['referredOn'], '2026-10-22');
      handle.dispose();
    });
  }
}
