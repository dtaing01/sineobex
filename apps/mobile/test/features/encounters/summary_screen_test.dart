import 'dart:async';

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/encounter_repository.dart' show CompletePlan, EncounterCompletion;
import 'package:sineobex_field/encounters/rules.dart' show NoteStatus;
import 'package:sineobex_field/features/encounters/summary_screen.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/sync/entities.dart'
    show entityAddendum, entityEncounter, entityNote, entityReferral, entitySignoff;

import '../../encounters/scripted_api.dart' show userRef, visitJson, visitNoteJson;

import 'encounter_kit.dart';

/// The summary (lifecycle 9.6; cards L5-summary-recap and L5-summary-complete): each note's recap
/// from Complete's plan, a teammate's draft named, the assessment saved as typed and, once locked,
/// Add to the assessment; suggested next steps; Add referral; follow-up; what stops Complete, each
/// line opening its note at the section; the signing sentence; Save & Close and the Complete button
/// worded by 3.3's table. After Complete the chart opens. Three themes, 200% text, 320 wide; offline.
void main() {
  /// The summary of [visit], opened as Continue opens it.
  Future<void> openSummary(WidgetTester tester, String visit) async {
    await go(tester, '/encounters/$visit/summary');
    expect(location(tester), '/encounters/$visit/summary');
    expect(find.byType(SummaryScreen), findsOneWidget);
  }

  Finder button(String label) => find.widgetWithText(FilledButton, label);

  for (final run in runs) {
    testWidgets('the recaps, a teammate’s draft, the assessment, what stops Complete (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final visit = startVisit(h);
      await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
      await teammatesNote(tester, h, visit);
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await openSummary(tester, visit);
      expect(find.widgetWithText(AppBar, 'Summary'), findsOneWidget);
      expect(tester.getSemantics(find.bySemanticsLabel('Del, Medical visit')), isSemantics(isHeader: true));
      await expectShown(tester, find.text('Allergy: penicillin (severe)'));
      expectNoLegalName(tester);
      // Each note Complete finishes, under its type's name; the Red flags note the app added, last.
      await expectShown(tester, find.text('General / primary care'));
      // Each recap's note title is a heading, so a screen reader moves note by note (review finding PX-5).
      expect(tester.getSemantics(find.bySemanticsLabel('General / primary care').first), isSemantics(isHeader: true));
      await expectShown(tester, find.text('Chief concern: Demo: cough'));
      await expectShown(tester, find.text('Red flags and disposition'));
      await expectShown(tester, find.text('No answers yet.'));
      await expectShown(tester, find.text('Demo Blair’s note stays a draft until they complete it.'));
      // The assessment, a private box.
      await expectShown(tester, find.byKey(const ValueKey('phi.form.summary')));
      // What stops Complete, the line naming the note, the section and the answer, a button to it.
      final stop = find.bySemanticsLabel(
        'Red flags and disposition: Red flags, “Does the patient require emergency evaluation?” needs an answer.',
      );
      await expectShown(tester, stop);
      expect(tester.getSemantics(stop), isSemantics(isButton: true, hasTapAction: true));
      await expectShown(
        tester,
        find.text('By completing, you sign this note as Jordan Lee (demo), Attending physician.'),
      );
      await expectShown(tester, button('Complete and sign'));
      expect(tester.widget<FilledButton>(button('Complete and sign')).onPressed, isNull);
      await expectShown(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
      await expectScreenOk(tester);
      // The visit's read logs what it shows; the plan logs nothing of its own.
      expect(auditEvents(store).skip(before), ['encounter.viewed', 'note.viewed', 'note.viewed']);
      handle.dispose();
    });
  }

  testWidgets('a line of what stops Complete opens its note at the section', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    final r = h.encounters.repository;
    await tester.runAsync(() => r.openNote(flags));
    r
      ..saveAnswer(flags, 'red_flags.emergency', 'no')
      ..saveAnswer(flags, 'follow_up.when', 'specific_date');
    await openSummary(tester, visit);
    // Its third section, not the one the form opens at.
    await tapOn(
      tester,
      find.bySemanticsLabel('Red flags and disposition: Follow up, “Follow-up date” needs an answer.'),
    );
    expectNoteOpened(tester, flags);
    await reveal(tester, find.bySemanticsLabel('Follow-up date'));
    expect(find.bySemanticsLabel('Follow-up date'), findsOneWidget);
    expect(find.text('Does the patient require emergency evaluation?'), findsNothing);
  });

  testWidgets('Complete and sign: the assessment typed, every note signed, the chart opens', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    await tester.runAsync(() => h.encounters.repository.openNote(flags));
    h.encounters.repository.saveAnswer(flags, 'red_flags.emergency', 'no');
    await openSummary(tester, visit);
    // Typed, and Complete pressed before typing pauses: the assessment is in each note's hash.
    await tester.enterText(find.byKey(const ValueKey('phi.form.summary')), 'Demo: viral, rest and fluids');
    await tester.pump();
    final handle = tester.ensureSemantics();
    await tapOn(tester, button('Complete and sign'));
    await settle(tester);
    expect(location(tester), '/patients/$p1Id');
    // Said on the chart, seen and heard: what Complete did.
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Signed')), findsOneWidget);
    expect(tester.getSemantics(find.text('Signed')), isSemantics(label: 'Signed'));
    handle.dispose();
    final store = h.sync.store!;
    expect(store.record(visit)!.fields['summary']?.value, 'Demo: viral, rest and fluids');
    expect([store.noteState(general)!.status, store.noteState(flags)!.status], [NoteStatus.signed, NoteStatus.signed]);
    final signoffs = [
      for (final e in store.outbox())
        if (e.entity == entitySignoff) (e.value! as Map<String, Object?>)['act'],
    ];
    expect(signoffs, ['sign', 'sign']);
  });

  testWidgets('what Complete did is said on the chart, by its button', (tester) async {
    final h = await signInToChart(tester);
    final social = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, social, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openSummary(tester, social);
    await tapOn(tester, button('Complete'));
    expect(location(tester), '/patients/$p1Id');
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Completed')), findsOneWidget);
    await back(tester);

    await asCredential(tester, h, 'student');
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    await tester.runAsync(() => h.encounters.repository.openNote(flags));
    h.encounters.repository.saveAnswer(flags, 'red_flags.emergency', 'no');
    await openSummary(tester, visit);
    await tapOn(tester, button('Complete and send for co-signature'));
    expect(location(tester), '/patients/$p1Id');
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Sent for co-signature')), findsOneWidget);
  });

  testWidgets('a note changed since the summary drew it: Complete says so, and the new recap shows', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openSummary(tester, visit);
    await expectShown(tester, find.text('Current needs: Food'));
    // Changed under the screen, as a sync brings a teammate's change in, without telling it.
    h.sync.store!.setField(social, 'data.needs.needs', ['housing']);
    await tapOn(tester, button('Complete'));
    await settle(tester);
    await expectShown(tester, find.text('This note changed. Read it again.'));
    // Said once, as a live region (review finding PX-6).
    final handle = tester.ensureSemantics();
    expect(
      tester.getSemantics(find.bySemanticsLabel('This note changed. Read it again.')),
      isSemantics(isLiveRegion: true),
    );
    handle.dispose();
    await expectShown(tester, find.text('Current needs: Housing'));
    expect(h.sync.store!.noteState(social)!.status, NoteStatus.draft);
    expect(location(tester), '/encounters/$visit/summary');
  });

  testWidgets('a Complete pressed while typing, when a note also changed: says so and finishes nothing', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openSummary(tester, visit);
    await expectShown(tester, find.text('Current needs: Food'));
    // The assessment typed with no pause, and a note changed under the screen: the plan made again
    // would sign a recap the person was not shown.
    await tester.enterText(find.byKey(const ValueKey('phi.form.summary')), 'Demo: fed');
    await tester.pump();
    h.sync.store!.setField(social, 'data.needs.needs', ['housing']);
    await tapOn(tester, button('Complete'));
    await settle(tester);
    await expectShown(tester, find.text('This note changed. Read it again.'));
    expect(h.sync.store!.noteState(social)!.status, NoteStatus.draft);
    await expectShown(tester, find.text('Current needs: Housing'));
  });

  testWidgets('the button is worded by what will happen (3.3)', (tester) async {
    final h = await signInToChart(tester);
    final outreach = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, outreach, 'social_needs', {
      'needs.needs': ['food'],
    });
    await openSummary(tester, outreach);
    await expectShown(tester, button('Complete'));
    expect(find.textContaining('By completing, you sign'), findsNothing);
    await tester.pageBack();
    await settle(tester);

    await asCredential(tester, h, 'student');
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await openSummary(tester, visit);
    await expectShown(tester, find.widgetWithText(FilledButton, 'Complete and send for co-signature'));
    expect(find.textContaining('By completing, you sign'), findsNothing);
  });

  testWidgets('once a note is finished the assessment is locked; what is added goes with Complete', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    final r = h.encounters.repository;
    r.saveSummary(visit, 'Demo: fed and warm');
    final plan = await tester.runAsync(() => r.openComplete(visit));
    r.complete(plan!);
    final type = await noteType(tester, h, 'social_needs');
    final second = (await tester.runAsync(() => r.addNote(visit, type, another: true)))!.noteId;
    await tester.runAsync(() => r.openNote(second));
    r.saveAnswer(second, 'needs.needs', ['clothing']);
    await openSummary(tester, visit);
    // The assessment as written, read-only; the box under it adds to it.
    await expectShown(tester, find.text('Demo: fed and warm'));
    expect(find.byKey(const ValueKey('phi.form.summary')), findsNothing);
    await expectShown(tester, find.byKey(const ValueKey('phi.form.summary_addition')));
    await tester.enterText(find.byKey(const ValueKey('phi.form.summary_addition')), 'Demo: socks given too');
    await tester.pump();
    await tapOn(tester, button('Complete'));
    await settle(tester);
    final store = h.sync.store!;
    final addenda = [
      for (final e in store.outbox())
        if (e.entity == entityAddendum) (e.value! as Map<String, Object?>)['text'],
    ];
    expect(addenda, ['Demo: socks given too']);
    expect(store.record(visit)!.fields['summary']?.value, 'Demo: fed and warm');
  });

  testWidgets('Save & Close with something added to a locked assessment asks before dropping it', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    final r = h.encounters.repository;
    r.complete((await tester.runAsync<CompletePlan?>(() => r.openComplete(visit)))!);
    final type = await noteType(tester, h, 'social_needs');
    final second = (await tester.runAsync(() => r.addNote(visit, type, another: true)))!.noteId;
    await tester.runAsync(() => r.openNote(second));
    r.saveAnswer(second, 'needs.needs', ['clothing']);
    await openSummary(tester, visit);
    final box = find.byKey(const ValueKey('phi.form.summary_addition'));
    await reveal(tester, box);
    await tester.enterText(box, 'Demo: socks given too');
    await tester.pump(typingPause);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    expect(find.text('Leave what you added?'), findsOneWidget);
    // Staying keeps it, typed, on the summary.
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(location(tester), '/encounters/$visit/summary');
    expect(tester.widget<TextField>(box).controller!.text, 'Demo: socks given too');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    await tester.tap(find.widgetWithText(FilledButton, 'Close without it'));
    await settle(tester);
    expect(location(tester), '/patients/$p1Id');
  });

  testWidgets('a teammate’s change a sync brings in is said above its recap, and Complete asks for one more look', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    await openSummary(tester, visit);
    await expectShown(tester, find.text('Current needs: Food'));
    expect(find.text('This note changed. Read it again.'), findsNothing);
    // Demo Blair changes it on the server; a sync brings it in while the summary shows.
    h.server.serverEdit(social, 'data.needs.needs', ['housing'], by: blair);
    await syncAndRefresh(tester, h);
    await settle(tester);
    await expectShown(tester, find.text('Current needs: Housing'));
    await expectShown(tester, find.text('This note changed. Read it again.'));
    await tapOn(tester, button('Complete'));
    expect(location(tester), '/encounters/$visit/summary');
    expect(h.sync.store!.noteState(social)!.status, NoteStatus.draft);
    // Read once more: Complete signs what is drawn now.
    await tapOn(tester, button('Complete'));
    expect(location(tester), '/patients/$p1Id');
    expect(h.sync.store!.noteState(social)!.status, isNot(NoteStatus.draft));
  });

  testWidgets('suggested next steps add a note type the visit does not have', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'outreach', {
      'outreach.new_need': ['social'],
    });
    await openSummary(tester, visit);
    final chip = find.bySemanticsLabel('Add Social needs');
    await expectShown(tester, chip);
    expect(tester.getSemantics(chip), isSemantics(isButton: true, hasTapAction: true));
    await expectScreenOk(tester);
    await tapOn(tester, find.text('Social needs'));
    final social = noteOfType(h, visit, 'social_needs')!;
    expectNoteOpened(tester, social.id);
    // Once the visit has the note, nothing suggests it again.
    h.encounters.repository.saveAnswer(social.id, 'needs.needs', ['food']);
    await tester.pageBack();
    await settle(tester);
    expect(find.bySemanticsLabel('Add Social needs'), findsNothing);
    handle.dispose();
  });

  testWidgets('the follow-up as the Red flags note records it', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    await tester.runAsync(() => h.encounters.repository.openNote(flags));
    h.encounters.repository.saveAnswer(flags, 'follow_up.when', 'next_street_clinic');
    await openSummary(tester, visit);
    // In the note's recap, and under Follow-up.
    await reveal(tester, find.text('Follow-up'));
    expect(find.text('Follow up: Next street clinic', skipOffstage: false), findsNWidgets(2));
    expect(find.text('No follow-up recorded yet.', skipOffstage: false), findsNothing);
  });

  testWidgets('no Red flags note to finish with a Medical one: the summary adds the person’s own', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    final general = await noteType(tester, h, 'general_primary_care');
    // Added while the phone held no list of the team's note types: no Red flags note came with it.
    await remakeServices(tester, h, noteTypes: false);
    final n = (await tester.runAsync(() => h.encounters.repository.addNote(visit, general)))!.noteId;
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    await remakeServices(tester, h);
    final r = h.encounters.repository;
    await tester.runAsync(() => r.openNote(n));
    r.saveAnswer(n, 'reason.concern', 'Demo: cough');
    await openSummary(tester, visit);
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNotNull);
    await expectShown(tester, find.bySemanticsLabel(RegExp('^Red flags and disposition: Red flags,')));
  });

  testWidgets('a teammate’s finished Red flags note only the server holds: none of the person’s own is added, '
      'from the note types list or the summary (8.2, D113)', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final routes = await withEncounterRoutes(tester, h);
    final visit = h.server.seed(entityEncounter, {'kind': 'medical', 'patientId': p1Id}, by: blair);
    final theirFlags = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'red_flags_disposition',
      'noteTypeVersion': 1,
      'data': {'red_flags.emergency': 'no', 'follow_up.when': 'next_street_clinic'},
    }, by: blair);
    h.server.finishNote(theirFlags, status: 'signed');
    final theirGeneral = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {'reason.concern': 'Demo: cough'},
    }, by: blair);
    // Blair's draft opened to help: the visit and that note come onto the phone, not the Red flags note.
    expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityEncounter, visit)), isTrue);
    expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, theirGeneral)), isTrue);
    final blairRef = userRef(blair, blairName);
    routes.on(
      'GET',
      '/v1/encounters/$visit',
      (_) => visitJson(
        encounterId: visit,
        patientId: p1Id,
        status: 'draft',
        notes: [
          visitNoteJson(
            noteId: theirGeneral,
            author: blairRef,
            key: 'general_primary_care',
            title: 'General / primary care',
            status: 'draft',
            completedAt: null,
          ),
          visitNoteJson(
            noteId: theirFlags,
            author: blairRef,
            key: 'red_flags_disposition',
            title: 'Red flags and disposition',
            status: 'signed',
          ),
        ],
      ),
    );
    await openVisit(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
    await tapOn(tester, find.bySemanticsLabel('Behavioral health'));
    final mine = noteOfType(h, visit, 'psychological')!.id;
    expectNoteOpened(tester, mine);
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    h.encounters.repository.saveAnswer(mine, 'reason.reasons', ['substance_use']);
    await openSummary(tester, visit);
    await expectShown(tester, find.text('Behavioral health'));
    // Nothing stops Complete: the visit's Red flags note is finished, on the server.
    expect(find.text('Before you complete', skipOffstage: false), findsNothing);
    expect(find.text('Red flags and disposition', skipOffstage: false), findsNothing);
    expect(noteOfType(h, visit, 'red_flags_disposition'), isNull);
    // One read for each screen that asked.
    expect(routes.asked.where((a) => a.path == '/v1/encounters/$visit'), hasLength(2));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Complete and sign'));
    expect(location(tester), '/patients/$p1Id');
    expect(h.sync.store!.noteState(mine)!.status, NoteStatus.signed);
  });

  testWidgets('Add referral opens the whole Referrals sheet; a referral added there is made at the visit', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic');
    await openSummary(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add referral'));
    final sheet = find.byType(BottomSheet);
    expect(find.descendant(of: sheet, matching: find.text('Referrals')), findsOneWidget);
    await revealInSheet(tester, find.descendant(of: sheet, matching: find.text('Demo: dental clinic')));
    final box = find.byKey(const ValueKey('phi.referralDetails'));
    await revealInSheet(tester, box);
    await tester.enterText(box, 'Demo: shelter intake on Monday');
    await tester.pump();
    await tapInSheet(tester, find.descendant(of: sheet, matching: find.widgetWithText(FilledButton, 'Add referral')));
    final made = [
      for (final e in h.sync.store!.outbox())
        if (e.entity == entityReferral && e.op == 'create') e.value! as Map<String, Object?>,
    ].where((v) => v['details'] == 'Demo: shelter intake on Monday').single;
    expect(made['encounterId'], visit);
  });

  testWidgets('hard stop 2’s line opens Needs attention', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['housing'],
    });
    final key = ('social_needs', 1);
    final json = jsonEncode(h.server.noteTypes[key]);
    h.server.noteTypes[key] = jsonDecode(json.replaceAll('"food"', '"food_gone"')) as Map<String, Object?>;
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['food']);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.sync.store!.needsAttention(), isNotEmpty);
    await openSummary(tester, visit);
    final handle = tester.ensureSemantics();
    final line = find.bySemanticsLabel(RegExp('Needs attention'));
    await reveal(tester, line);
    expect(tester.getSemantics(line.first), isSemantics(isButton: true, hasTapAction: true));
    await tapOn(tester, line.first);
    expect(location(tester), '/attention');
    handle.dispose();
  });

  testWidgets('Save & Close on the summary opens the chart', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, visit, 'social_needs');
    await openSummary(tester, visit);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
    expect(location(tester), '/patients/$p1Id');
    expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Saved as a draft')), findsOneWidget);
  });

  // Review finding VX-7 (PX-7): while the server's read of the visit is on its way.
  testWidgets('while the visit’s read waits, a screen reader finds that the visit is loading', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    // Sent, so a teammate may have added to it, and the server is asked whether it holds a finished
    // Red flags note (lifecycle 8.2).
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final slow = Completer<Object?>();
    routes.on('GET', '/v1/encounters/$visit', (_) => slow.future);
    final context = tester.element(find.byType(Navigator).first);
    unawaited(GoRouter.of(context).push('/encounters/$visit/summary'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.bySemanticsLabel('Loading the visit'), findsOneWidget);
    slow.complete(visitJson(encounterId: visit, patientId: p1Id, status: 'draft', notes: const []));
    await settle(tester);
    expect(find.bySemanticsLabel('Loading the visit'), findsNothing);
    handle.dispose();
  });
}
