import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/encounters/rules.dart' show NoteStatus;
import 'package:sineobex_field/sync/entities.dart' show entityNote;
import 'package:sineobex_field/features/encounters/visit_screen.dart';

import 'encounter_kit.dart';

/// The visit (lifecycle 9.7; cards L5-visit-envelope and L5-visit-trail): the envelope, each note's
/// recap and sections, a draft the person may change opening as its form, a teammate's read-only,
/// what hangs off each note in time order, and the records made at the visit, read from the phone's
/// copy offline and logged as they show. Three themes, 200% text, 320 wide.
void main() {
  /// A time as the screen words one: a date, "at", a time.
  final at = RegExp(r'[A-Z][a-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2}\s?[AP]M');

  for (final run in runs) {
    testWidgets('the envelope, the notes, what hangs off them and the records made at the visit (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final v = await finishedVisit(tester, h);
      final r = h.encounters.repository;
      await r.addendumTo(tester, v.visit, v.general, 'Demo: the swab came back clear');
      h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic', encounterId: v.visit);
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await openVisitScreen(tester, v.visit);
      expect(find.widgetWithText(AppBar, 'Visit'), findsOneWidget);

      // The envelope: who, the kind, when it started, where, read as one heading; the assessment.
      final header = find.bySemanticsLabel(
        RegExp('^Del, Medical visit, Started ${at.pattern}, Where: Demo: by the library\$'),
      );
      expect(tester.getSemantics(header), isSemantics(isHeader: true));
      await expectShown(tester, find.text('Demo: viral, rest and fluids'));
      expectNoLegalName(tester);

      // Each note: its state, its recap, then its sections, each answer with Correct under it.
      await expectShown(tester, find.text('General / primary care'));
      await expectShown(tester, find.text('Chief concern: Demo: cough'));
      await expectShown(tester, find.byKey(const ValueKey('read.reason.concern')));
      await expectShown(tester, find.bySemanticsLabel('Correct Chief concern'));
      // Below it, in the order made: the signature, waiting to send, then the addendum.
      final signed = find.textContaining(
        RegExp('^Signed by Jordan Lee \\(demo\\), Attending physician, ${at.pattern}\$'),
      );
      await reveal(tester, signed);
      await expectShown(tester, find.textContaining(RegExp('^Addendum by Jordan Lee \\(demo\\), ${at.pattern}\$')));
      await expectShown(tester, find.text('Demo: the swab came back clear'));
      expect(
        tester.getTopLeft(signed.first).dy,
        lessThan(tester.getTopLeft(find.text('Demo: the swab came back clear')).dy),
      );
      await expectShown(tester, find.bySemanticsLabel('Add addendum to General / primary care'));
      await expectShown(tester, find.text('Red flags and disposition'));
      await expectShown(tester, find.bySemanticsLabel('Correct Does the patient require emergency evaluation?'));
      // An attending's signed note is never reopened: an addendum or a correction is the way (3.6).
      expect(find.text('Reopen'), findsNothing);

      // The visit's own addendum, and the records made at it, each opening where it can be entered
      // in error.
      await expectShown(tester, find.bySemanticsLabel('Add addendum to the visit'));
      final referral = find.bySemanticsLabel('Referral, ${longDateOf(fixtureNow)}: Demo: dental clinic');
      await expectShown(tester, referral);
      expect(tester.getSemantics(referral), isSemantics(isButton: true, hasTapAction: true));
      await expectScreenOk(tester);

      // Each record shown logged once, in the read that showed it (10.1).
      final logged = auditEvents(store).skip(before).toList();
      expect(logged.where((e) => e == 'encounter.viewed'), hasLength(1));
      // Two notes, their two signatures and the addendum; the referral on its chart.
      expect(logged.where((e) => e == 'note.viewed'), hasLength(5));
      expect(logged.where((e) => e == 'patient.viewed'), hasLength(1));
      handle.dispose();
    });
  }

  testWidgets('a read again logs only what it adds', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    h.encounters.referrals.add(p1Id, referredOn: fixtureNow, details: 'Demo: dental clinic', encounterId: v.visit);
    final store = h.sync.store!;
    await openVisitScreen(tester, v.visit);
    final shown = auditEvents(store).length;
    expect(auditEvents(store).where((e) => e == 'patient.viewed'), hasLength(1));
    h.encounters.changed();
    await settle(tester);
    expect(auditEvents(store), hasLength(shown));
    await h.encounters.repository.addendumTo(tester, v.visit, null, 'Demo: seen again later');
    await settle(tester);
    await expectShown(tester, find.text('Demo: seen again later'));
    expect(auditEvents(store).skip(shown), ['note.viewed']);
  });

  testWidgets('a draft the person may change opens as its form, a teammate’s as well as their own', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h, kind: VisitKind.nonMedical);
    final mine = await chart(tester, h, visit, 'outreach', {'outreach.type': 'outreach'});
    final theirs = await teammatesNote(tester, h, visit);
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('By Demo Blair'));
    await expectShown(tester, find.text('Current needs: Food'));
    // Drafts: nothing to correct or add to yet.
    expect(find.bySemanticsLabel(RegExp('^Correct ')), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Add addendum')), findsNothing);
    await tapOn(tester, find.bySemanticsLabel('Open the note, Outreach'));
    expectNoteOpened(tester, mine);
    await back(tester);
    await tapOn(tester, find.bySemanticsLabel('Open the note, Social needs'));
    expectNoteOpened(tester, theirs);
  });

  testWidgets('a teammate’s draft the person may not change reads as it is', (tester) async {
    final h = await signInToChart(tester);
    final visit = startVisit(h);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    h.server.credentials[blair] = 'student';
    final theirs = h.server.seed(entityNote, {
      'encounterId': visit,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {'reason.concern': 'Demo: cough'},
    }, by: blair);
    expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, theirs)), isTrue);
    h.server.offline = true;
    // A credential that doesn't chart Medical notes reads a Medical draft, and can't change it (6.2).
    await asCredential(tester, h, 'chw');
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('By Demo Blair'));
    await expectShown(tester, find.byKey(const ValueKey('read.reason.concern')));
    expect(find.bySemanticsLabel(RegExp('^Open the note')), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Correct ')), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Add addendum')), findsNothing);
  });

  testWidgets('Reopen: a student’s note waiting for a co-signer goes back to a draft, asked first, and opens', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    await asCredential(tester, h, 'student');
    final v = await finishedVisit(tester, h);
    final store = h.sync.store!;
    expect(store.noteState(v.general)!.status, NoteStatus.completed);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Reopen General / primary care'));
    expect(find.text('Reopen this note?'), findsOneWidget);
    // Cancel changes nothing.
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(store.noteState(v.general)!.status, NoteStatus.completed);
    await tapOn(tester, find.bySemanticsLabel('Reopen General / primary care'));
    await tester.tap(find.widgetWithText(FilledButton, 'Reopen'));
    await settle(tester);
    expect(store.noteState(v.general)!.status, NoteStatus.draft);
    expectNoteOpened(tester, v.general);
  });

  testWidgets('a visit the phone doesn’t hold, offline, says so', (tester) async {
    await signInToChart(tester);
    await go(tester, visitLocation('e0000000-0000-4000-8000-0000000000f1'));
    await expectShown(tester, find.text('This visit isn’t on this phone. Connect to open it.'));
  });
}

/// A day as the screen words it.
String longDateOf(DateTime d) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  final l = d.toLocal();
  return '${months[l.month - 1]} ${l.day}, ${l.year}';
}
