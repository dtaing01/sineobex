import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart'
    show CompletePlan, EncounterCompletion, NoteActions;
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/sync/canonical_json.dart' show valueHash;
import 'package:sineobex_field/sync/entities.dart'
    show entityCorrection, entityEncounter, entityNote, entityReferral, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart'
    show ChangeState, noticeFinishedDifferently, noticeSignoffNotApplied;

import '../../sync/fake_server.dart' show FakeNotice;
import 'encounter_kit.dart';

/// Needs attention for a note's life (lifecycle 4.1, 9.13; card L5-needs-attention): each problem of
/// a refused sign-off or correction in the design's words, with the buttons that settle it through
/// the domain layer: **Open the note** to complete again; **Correct again** and **Leave it** for a
/// correction someone else's got to first. And the notices of a note's life: **Open the note** on
/// one that a Complete wasn't applied, or that a note was finished with other content, fetched
/// first when the phone does not hold it. Three themes, 200% text, 320 wide.
void main() {
  Future<void> openAttention(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')));
    await settle(tester);
    await tapOn(tester, find.text('Needs attention'));
    expect(location(tester), '/attention');
  }

  /// A Medical visit charted offline and sent, General / primary care's concern then changed on the
  /// server by Demo Blair, and the visit completed here without seeing it: General's sign-off is
  /// refused `content_changed`; the Red flags note's goes through.
  Future<({String visit, String general, String flags})> refusedComplete(WidgetTester tester, AppHarness h) async {
    final r = h.encounters.repository;
    final visit = startVisit(h);
    final general = await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    await tester.runAsync(() => r.openNote(flags));
    r.saveAnswer(flags, 'red_flags.emergency', 'no');
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    h.server.serverEdit(general, 'data.reason.concern', 'Demo: cough and a fever', by: blair);
    r.complete((await tester.runAsync<CompletePlan?>(() => r.openComplete(visit)))!);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    return (visit: visit, general: general, flags: flags);
  }

  /// A finished visit, sent, its General / primary care note kept on the phone (the visit on screen,
  /// so the close sweep leaves it); the person corrects the concern on another phone first, and this
  /// one, offline, corrects it from the version it read: the server refuses it `field_changed`.
  Future<({String visit, String general, String flags})> refusedCorrection(WidgetTester tester, AppHarness h) async {
    final v = await finishedVisit(tester, h);
    h.encounters.sweep.showing.add(v.visit);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    h.server.serverEdit(v.general, 'data.reason.concern', 'Demo: cough, three days', by: me);
    await tester.runAsync(
      () => h.encounters.repository.correct(
        v.visit,
        v.general,
        changes: {'reason.concern': 'Demo: cough and a fever'},
        reason: 'Demo: the fever was missed',
      ),
    );
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final refused = h.sync.store!.needsAttention().single;
    expect([refused.entity, refused.details?['problem']], [entityCorrection, 'field_changed']);
    return v;
  }

  for (final run in runs) {
    testWidgets('a Complete the server refused: its sentence, and Open the note (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final v = await refusedComplete(tester, h);
      final refused = h.sync.store!.needsAttention().single;
      expect([refused.entity, refused.details?['problem']], [entitySignoff, 'content_changed']);
      await openAttention(tester);
      final heading = find.text('Sign-off');
      await expectShown(tester, heading);
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      await expectShown(
        tester,
        find.text('This note changed after you completed it. Open it, read it and complete it again.'),
      );
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
      expectNoteOpened(tester, v.general);
      handle.dispose();
    });
  }

  testWidgets('a correction someone else’s got to first: Correct again sends it at the versions now seen', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final v = await refusedCorrection(tester, h);
    await openAttention(tester);
    await expectShown(tester, find.text('Correction'));
    await expectShown(tester, find.text('Someone corrected this answer first. Open the note and check it.'));
    await expectShown(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    await expectShown(tester, find.widgetWithText(OutlinedButton, 'Leave it'));
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Correct again'));
    expect(h.sync.store!.needsAttention(), isEmpty);
    expect(h.server.records[v.general]!.fields['data.reason.concern']!.value, 'Demo: cough and a fever');
    expect(find.text('Correction'), findsNothing);
  });

  testWidgets('Leave it abandons the correction, changing nothing, and the refusal settles', (tester) async {
    final h = await signInToChart(tester);
    final v = await refusedCorrection(tester, h);
    await openAttention(tester);
    // Offline the fix waits to send, as any fix does; the card goes once it is sent.
    h.server.offline = true;
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Leave it'));
    expect(
      h.sync.store!.outbox().where((e) => e.entity == entityCorrection && e.state == ChangeState.pending),
      hasLength(1),
    );
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(h.sync.store!.needsAttention(), isEmpty);
    expect(h.server.records[v.general]!.fields['data.reason.concern']!.value, 'Demo: cough, three days');
  });

  testWidgets('Correct again refuses what Correct refuses, in the domain layer’s words, and sends nothing', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    await refusedCorrection(tester, h);
    await openAttention(tester);
    // A role that no longer charts: nothing is sent, and the card stays.
    await remakeServices(tester, h, permissions: ['patients.view', 'patients.edit']);
    final outbox = h.sync.store!.outbox().length;
    await tapOn(tester, find.widgetWithText(FilledButton, 'Correct again'));
    expect(find.text('Your role doesn’t chart visits.'), findsOneWidget);
    expect(h.sync.store!.outbox(), hasLength(outbox));
    await expectShown(tester, find.text('Correction'));
  });

  testWidgets('two people changed a note’s answers: named by the form’s labels, chosen on the note, no codes', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.housing': 'shelter',
      'needs.needs': ['food'],
    });
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.serverEdit(social, 'data.needs.housing', 'transitional', by: blair);
    h.server.serverEdit(social, 'data.needs.needs', ['food', 'clothing'], by: blair);
    h.encounters.repository
      ..saveAnswer(social, 'needs.housing', 'permanent')
      ..saveAnswer(social, 'needs.needs', ['hygiene']);
    await syncAndRefresh(tester, h);
    // As after a restart: no note's definition loaded yet; Needs attention loads what it words.
    await remakeServices(tester, h);
    await openAttention(tester);
    for (final heading in ['Housing status, in Social needs', 'Current needs, in Social needs']) {
      final title = find.text(heading);
      await expectShown(tester, title);
      expect(tester.getSemantics(title), isSemantics(isHeader: true));
    }
    // Each value in the form's words: no field key, option code or raw value.
    for (final raw in ['Needs housing', 'Needs needs', 'permanent', 'transitional', 'hygiene', '[']) {
      expect(find.textContaining(raw, skipOffstage: false), findsNothing, reason: raw);
    }
    await expectShown(tester, find.text('Permanent'));
    await expectShown(tester, find.text('Transitional'));
    await expectShown(tester, find.text('Food, Clothing'));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note').first);
    expectNoteOpened(tester, social);
  });

  testWidgets('once the store freezes, the reason shows in place of a note answer’s conflict, and nothing of it '
      '(review finding PP-2)', (tester) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.housing': 'shelter',
      'needs.needs': ['food'],
    });
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.serverEdit(social, 'data.needs.needs', ['food', 'clothing'], by: blair);
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['hygiene']);
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    await expectShown(tester, find.text('Food, Clothing'));

    h.server.offline = true;
    h.sync.store!.freeze(frozen);
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('1 thing waits here until then.'), findsOneWidget);
    for (final shown in [
      'Food, Clothing',
      'Hygiene',
      'Current needs, in Social needs',
      'Use my value',
      'Keep theirs',
    ]) {
      expect(find.text(shown, skipOffstage: false), findsNothing, reason: shown);
    }
    await expectScreenOk(tester);
  });

  testWidgets('an answer the server refused settles once it is changed: the next save is its fix', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['housing'],
    });
    // The server's copy of the type no longer knows "food" (a build fault: the phone's differs).
    final key = ('social_needs', 1);
    final json = jsonEncode(h.server.noteTypes[key]);
    h.server.noteTypes[key] = jsonDecode(json.replaceAll('"food"', '"food_gone"')) as Map<String, Object?>;
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['food']);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final store = h.sync.store!;
    expect([for (final e in store.needsAttention()) e.field], ['data.needs.needs']);
    await openAttention(tester);
    // Named as the form names it.
    await expectShown(tester, find.text('Current needs, in Social needs'));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    expectNoteOpened(tester, social);
    // The person changes the answer, as the card says: it settles the refusal, and nothing waits.
    h.encounters.repository.saveAnswer(social, 'needs.needs', ['housing']);
    await syncAndRefresh(tester, h);
    expect(store.needsAttention(), isEmpty);
    expect(store.heldCount(), 0);
    expect(h.server.records[social]!.fields['data.needs.needs']?.value, ['housing']);
  });

  testWidgets('a notice that a Complete wasn’t applied opens its note, fetched first on a phone that never held it', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    // A note of the person's own on the server, from another phone: this one holds neither it nor the
    // held sign-off the notice names.
    final visit = h.server.seed(entityEncounter, {'kind': 'non_medical', 'patientId': p1Id}, by: me);
    final note = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'social_needs',
      'noteTypeVersion': 1,
      'data': {
        'needs.needs': ['food'],
      },
    }, by: me);
    const signoff = 'f1000000-0000-4000-8000-0000000000e1';
    h.server.notices.add(
      FakeNotice(
        'f2000000-0000-4000-8000-0000000000e2',
        me,
        noticeSignoffNotApplied,
        entitySignoff,
        signoff,
        h.wall,
        noteId: note,
      ),
    );
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    expect(h.sync.store!.record(note), isNull);
    await openAttention(tester);
    await expectShown(tester, find.text('Your Complete of this note wasn’t applied. Open it and complete it again.'));
    expect(find.text('Open the chart'), findsNothing);
    await expectScreenOk(tester);

    // Without signal it can't be fetched, and the notice stays.
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    expect(location(tester), '/attention');
    expect(find.text('This note isn’t on this phone. Connect to open it.'), findsOneWidget);
    h.server.offline = false;
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    expectNoteOpened(tester, note);
    expect(h.sync.store!.record(note), isNotNull);
  });

  testWidgets('a note finished with other content opens from its notice, read-only', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final outreach = await chart(tester, h, visit, 'outreach', {'outreach.type': 'outreach'});
    h.sync.store!.addNotice(noticeFinishedDifferently, patientId: p1Id, recordId: outreach);
    h.patients.changed();
    await openAttention(tester);
    await expectShown(
      tester,
      find.text('This note was already finished with different content. Open it and read what was finished.'),
    );
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    expectNoteOpened(tester, outreach);
  });

  // The refusals of 4.1 and 8.4 that had no way out (decided item B6): each card settles its
  // refusal through the domain layer and the store's fixRejected, and the queue goes on.

  testWidgets('a clinical note refused for a visit with no patient: Choose a patient names it, and the note goes', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final store = h.sync.store!;
    final visit = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
    // An older build let a clinical note into a visit with no patient; the server refuses it (3.10).
    final general = store.createNote(
      encounterId: visit,
      noteTypeKey: 'general_primary_care',
      noteTypeVersion: 1,
      data: {'reason.concern': 'Demo: cough'},
    );
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect([for (final e in store.needsAttention()) e.details?['problem']], ['medical_note_needs_patient']);
    await openAttention(tester);
    await expectShown(tester, find.text('A clinical note needs a patient. Choose who this visit is for.'));
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Choose a patient'));
    await type(tester, 'visitSearch', 'Del');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Del,')));
    await settle(tester);
    // The visit names Del, then the note's create goes again as the refusal's fix, and is taken.
    expect(store.needsAttention(), isEmpty);
    expect(store.heldCount(), 0);
    expect(h.server.records[visit]!.fields['patientId']!.value, p1Id);
    expect(h.server.records[general]!.fields['data.reason.concern']!.value, 'Demo: cough');
    expect(find.text('A clinical note needs a patient. Choose who this visit is for.'), findsNothing);
    handle.dispose();
  });

  /// A referral made offline at [visit], a visit of P1 the phone holds, which a teammate then moves
  /// to another patient on the server: the referral's create is refused `encounter_other_patient`.
  /// [other], another visit of P1, stays on the phone (on screen, so the close sweep leaves it).
  Future<({String referral, String other})> referralAtMovedVisit(WidgetTester tester, AppHarness h) async {
    final kit = h.server.seedPatient(preferredName: 'Demo Kit');
    final visit = startVisit(h);
    final other = startVisit(h, kind: VisitKind.nonMedical);
    h.encounters.sweep.showing.addAll([visit, other]);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    final referral = h.encounters.referrals.add(
      p1Id,
      referredOn: fixtureNow,
      details: 'Demo: dental clinic',
      encounterId: visit,
    );
    h.server.serverEdit(visit, 'patientId', kit, by: blair);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final refused = h.sync.store!.needsAttention().single;
    expect([refused.entity, refused.details?['problem']], [entityReferral, 'encounter_other_patient']);
    return (referral: referral, other: other);
  }

  for (final run in runs) {
    testWidgets(
      'a referral at a visit that moved to someone else: Choose a visit makes it at another of theirs (${runName(run)})',
      (tester) async {
        final h = await signInToChart(tester, run: run);
        final r = await referralAtMovedVisit(tester, h);
        // Offline while the sheet is read, so the audit entries it writes wait in the outbox to be counted.
        h.server.offline = true;
        final viewed = auditEvents(h.sync.store!).where((a) => a == 'encounter.viewed').length;
        await openAttention(tester);
        await expectShown(tester, find.text('The visit this names belongs to someone else.'));
        await expectShown(tester, find.widgetWithText(OutlinedButton, 'Send without the visit'));
        await expectScreenOk(tester);
        await tapOn(tester, find.widgetWithText(FilledButton, 'Choose a visit'));
        // The patient's other visit the phone holds, and only it, logged as it is shown.
        final row = find.text('Non-Medical visit');
        await expectShown(tester, row);
        expect(find.text('Medical visit'), findsNothing);
        await expectScreenOk(tester);
        expect(auditEvents(h.sync.store!).where((a) => a == 'encounter.viewed'), hasLength(viewed + 1));
        h.server.offline = false;
        await tapOn(tester, row);
        await settle(tester);
        expect(h.sync.store!.needsAttention(), isEmpty);
        expect(h.server.records[r.referral]!.attributes['encounterId'], r.other);
      },
    );
  }

  testWidgets('a referral at a visit the team never had: Send without the visit makes it at no visit', (tester) async {
    final h = await signInToChart(tester);
    final referral = h.encounters.referrals.add(
      p1Id,
      referredOn: fixtureNow,
      details: 'Demo: dental clinic',
      encounterId: '7e570000-0000-4000-8000-0000000000f1',
    );
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final store = h.sync.store!;
    expect([for (final e in store.needsAttention()) e.details?['problem']], ['encounter_missing']);
    await openAttention(tester);
    await expectShown(tester, find.text('The visit this names isn’t on the team’s list.'));
    // The phone holds no other visit of the patient: nothing to choose.
    expect(find.widgetWithText(FilledButton, 'Choose a visit'), findsNothing);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Send without the visit'));
    await settle(tester);
    expect(store.needsAttention(), isEmpty);
    expect(h.server.records[referral]!.attributes['encounterId'], isNull);
  });

  for (final run in runs) {
    testWidgets('a referral the server refused for its date: Change the date, typed or on the calendar, settles it '
        '(${runName(run)})', (tester) async {
      // Review finding PS-3: a referral does not wait for the clock, and the server's date was behind.
      final h = await signInToChart(tester, run: run);
      final now = h.server.now;
      h.server.now = () => now().subtract(const Duration(days: 3));
      final referral = h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic');
      h.server.offline = false;
      await syncAndRefresh(tester, h);
      final store = h.sync.store!;
      expect([for (final e in store.needsAttention()) e.details?['problem']], ['referral_in_future']);
      // The server's clock is set right, and the phone measures against it again.
      h.server.now = now;
      await syncAndRefresh(tester, h);
      await openAttention(tester);
      await expectShown(tester, find.text('A referral can’t be dated in the future.'));
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Change the date'));
      // Typed in three private boxes, today by default, or picked on the calendar alone, as every
      // date the phone takes is (D92; the coordinator's decision on review finding PX-3).
      final ask = find.byType(BottomSheet);
      Finder box(String part) => find.descendant(of: ask, matching: find.byKey(ValueKey('phi.form.referredOn.$part')));
      final change = find.descendant(of: ask, matching: find.widgetWithText(FilledButton, 'Change the date'));
      expect(box('month'), findsOneWidget);
      await expectScreenOk(tester);
      // A date after today is refused under the boxes, and nothing is sent on it.
      for (final (part, typed) in [('month', '10'), ('day', '23'), ('year', '2026')]) {
        await tester.ensureVisible(box(part));
        await tester.enterText(box(part), typed);
        await tester.pump();
      }
      await tapOn(tester, change);
      await settle(tester);
      await expectShown(tester, find.text('The date can’t be after today.'));
      await expectShown(tester, find.text('Fix the date first: what’s typed can’t be saved.'));
      expect(store.needsAttention(), hasLength(1));
      await expectScreenOk(tester);
      // The calendar alone: no typing box to switch to. Its day cells are the one exception, beside
      // the typed date (accessibility.md).
      await tapOn(tester, find.bySemanticsLabel('Date referred: October 22, 2026'));
      final calendar = find.byType(DatePickerDialog);
      expect(calendar, findsOneWidget);
      expect(find.descendant(of: calendar, matching: find.text('Date referred')), findsOneWidget);
      expect(find.descendant(of: calendar, matching: find.byIcon(Icons.edit_outlined)), findsNothing);
      expect(find.descendant(of: calendar, matching: find.byType(TextField)), findsNothing);
      await tapOn(tester, find.descendant(of: calendar, matching: find.text('OK')));
      await settle(tester);
      await tapOn(tester, change);
      await settle(tester);
      expect(ask, findsNothing);
      expect(store.needsAttention(), isEmpty);
      final day = fixtureNow.toIso8601String().substring(0, 10);
      expect(h.server.records[referral]!.attributes['referredOn'], day);
    });
  }

  testWidgets('Change the date’s sheet, its date typed, and the calendar over it go when the store freezes', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final now = h.server.now;
    h.server.now = () => now().subtract(const Duration(days: 3));
    h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic');
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.now = now;
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Change the date'));
    final month = find.byKey(const ValueKey('phi.form.referredOn.month'));
    await tester.enterText(month, '9');
    await tester.pump();
    await tapOn(tester, find.bySemanticsLabel('Date referred: October 22, 2026'));
    expect(find.byType(DatePickerDialog), findsOneWidget);
    // Offline, so the sync the controller speaks after takes nothing that would end the freeze.
    h.server.offline = true;
    h.sync.store!.freeze('Demo: handing over');
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    expect(find.byType(DatePickerDialog), findsNothing);
    expect(month, findsNothing);
    expect(find.text('Demo: handing over'), findsWidgets);
    h.sync.store!.unfreeze();
  });

  testWidgets('a note on a version the team moved on from: Remove this note settles it, and its type opens anew', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final social = await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    // While the phone was offline the team moved Social needs to a version 2 (the same form):
    // the server no longer takes version 1, and the phone's list names version 2 once it reads it.
    final v1 = AppHarness.bundledPresets.cast<Map<String, Object?>>().firstWhere((v) => v['key'] == 'social_needs');
    final definition = {...v1['definition']! as Map<String, Object?>, 'version': 2};
    final v2 = {'key': 'social_needs', 'version': 2, 'hash': valueHash(definition), 'definition': definition};
    for (final team in h.forms.teams.values) {
      team.add(v2);
    }
    h.server.noteTypes
      ..remove(('social_needs', 1))
      ..[('social_needs', 2)] = definition;
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final store = h.sync.store!;
    // The answer's set went in the same push, after the create, and found no note there.
    expect([for (final e in store.needsAttention()) e.details?['problem']], ['unknown_note_type', 'record_missing']);
    await openAttention(tester);
    await expectShown(tester, find.text('This note type isn’t on your team’s list. Choose the note type again.'));
    await expectShown(tester, find.widgetWithText(OutlinedButton, 'Choose a note type'));
    await expectScreenOk(tester);
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Remove this note'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Remove'));
    await settle(tester);
    // Sent again as an empty draft the server takes, which counts for nothing (3.1): the refusal settles.
    expect(store.needsAttention(), isEmpty);
    expect(store.heldCount(), 0);
    expect(h.server.records[social]!.attributes['noteTypeVersion'], 2);
    expect(answersOf(h, social).values.where((v) => v != null), isEmpty);
    // The answer the person charted reached the server and its history, then was cleared: nothing
    // that never synced was deleted (review finding PS-4).
    expect(h.server.records[social]!.fields['data.needs.needs']!.value, isNull);
    expect(
      [
        for (final x in h.server.history)
          if (x['recordId'] == social && x['field'] == 'data.needs.needs') '${x['kind']} ${x['value']}',
      ],
      ['created [food]', 'set null'],
    );
    // Choosing the type again opens a Social needs note on the version the team has now.
    await go(tester, '/encounters/$visit/note-types');
    await tapOn(tester, find.text('Social needs'));
    await settle(tester);
    expect(location(tester), startsWith('/notes/'));
    expect(store.record(location(tester).substring('/notes/'.length))!.attributes['noteTypeVersion'], 2);
  });
}
