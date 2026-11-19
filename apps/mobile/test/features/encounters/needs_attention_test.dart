import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart'
    show CompletePlan, EncounterCompletion, NoteActions;
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/sync/entities.dart' show entityCorrection, entityEncounter, entityNote, entitySignoff;
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
}
