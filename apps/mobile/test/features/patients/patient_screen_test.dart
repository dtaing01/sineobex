import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// The profile (design 12.1): the header read first as one summary with the allergy badge right
/// after it, the sections, banners (merged, consent not recorded, two values), and Copy ID link with
/// two cards after a merge. Three themes, 200% text and 320 wide.
void main() {
  const otherStaff = 'c0000000-0000-4000-8000-0000000000c2';

  for (final run in runs) {
    testWidgets('Del’s profile: one summary, the badge, the sections (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'ongoing'});
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      expect(find.byType(PatientScreen), findsOneWidget);
      // A generic title: the app switcher never shows the patient.
      expect(find.widgetWithText(AppBar, 'Patient'), findsOneWidget);

      final header = find.bySemanticsLabel('Del, age 80, born March 7, 1946, allergy: penicillin, severe');
      expect(header, findsOneWidget);
      expect(tester.getSemantics(header), isSemantics(isHeader: true));
      // The badge comes straight after the name, in words with its own icon.
      final badge = find.bySemanticsLabel('Allergy: penicillin, severe');
      expect(badge, findsOneWidget);
      expect(tester.getRect(badge).top, greaterThan(tester.getRect(header).top));
      expect(find.text('Allergy: penicillin (severe)'), findsOneWidget);
      // The legal name shows on the chart's own profile only.
      await expectShown(tester, find.text('Legal name: Delbert Smithfield'));
      await expectScreenOk(tester);

      for (final section in [
        'Problems',
        'Allergies',
        'Street names',
        'Consent',
        'Street Medicine ID card',
        'History',
      ]) {
        final heading = find.text(section);
        await expectShown(tester, heading);
        expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      }
      await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing, No code')));
      await expectShown(tester, find.text('No card yet.'));
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('two cards after a merge: Copy ID link asks which, and says the link clears', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    final p2 = h.server.seedPatient(preferredName: 'Demo Smitty');
    for (final (patient, token) in [(p1Id, 'AAAAAAAAAAAAAAAAAAAAAA'), (p2, 'BBBBBBBBBBBBBBBBBBBBBB')]) {
      h.server.seed(entityIdLink, {
        'patientId': patient,
        'token': token,
        'replacesLinkId': null,
        'reason': 'first_card',
      });
    }
    h.server.merge(p2, p1Id);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('2 cards open this chart (two records were merged).'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Copy ID link'));
    expect(find.text('Copy which card’s link?'), findsOneWidget);
    await expectGuidelines(tester);
    await tapOn(tester, find.textContaining('Card made').first);
    final copied = find.text('Link copied. It clears in 60 seconds.');
    await expectShown(tester, copied);
    expect(tester.getSemantics(copied), isSemantics(isLiveRegion: true));
    expect(h.copied.single, matches(RegExp(r'^http://localhost:3100/c#[A-Z]{22}$')));
    expect([
      for (final e in h.sync.store!.outbox())
        if (e.entity == entityAudit) (e.value! as Map)['action'],
    ], contains('id_link.copied'));

    // The merged record opens with the banner, and editing from it is off.
    await go(tester, '/patients/$p2');
    await expectShown(tester, find.text('This chart was merged into another on Oct 22. Open the combined chart.'));
    expect(find.widgetWithText(OutlinedButton, 'Edit'), findsNothing);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('consent not recorded: the banner, and Record consent now', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final id = h.server.seed(entityPatient, {
      'preferredName': 'Demo Ash',
      'consent': {
        'id': '5eed0c00-0000-4000-8000-0000000000a1',
        'decision': 'unable',
        'method': 'not_applicable',
        'reason': 'In crisis',
        'scriptVersion': '2026-10-1',
        'language': 'en',
      },
      'privacyNotice': {'id': '5eed0c00-0000-4000-8000-0000000000a2', 'decision': 'unable', 'reason': 'In crisis'},
    });
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$id');
    await expectShown(tester, find.text('Consent not recorded yet. Ask at the next visit.'));
    await tapOn(tester, find.text('Record consent now'));
    await tapOn(tester, find.text('Agrees'));
    await expectGuidelines(tester);
    await tapOn(tester, find.text('Save'));
    final consent = h.sync.store!.outbox().singleWhere((e) => e.entity == entityConsent);
    expect((consent.value! as Map)['decision'], 'given');
    expect(find.text('Consent not recorded yet. Ask at the next visit.'), findsNothing);
    handle.dispose();
  });

  testWidgets('two values recorded: the banner, and the review offline is read-only', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    // A teammate changes where Del is found; this phone, not having seen it, changes it too.
    h.server.serverEdit(p1Id, 'usualArea', 'Demo: by the river', by: otherStaff);
    h.patients.patients.update(p1Id, {'usualArea': 'Demo: by the library steps'});
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    await settle(tester);
    await expectShown(tester, find.text('Two values for Usually found'));
    h.server.offline = true;
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    await tapOn(tester, find.bySemanticsLabel('Choose the value for Usually found'));
    expect(find.text('Which is right?'), findsOneWidget);
    await expectShown(tester, find.text('Connect to save a choice. Until then both values stay on the chart.'));
    final save = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save choice'));
    expect(save.onPressed, isNull);
    await expectGuidelines(tester);
    handle.dispose();
  });
}
