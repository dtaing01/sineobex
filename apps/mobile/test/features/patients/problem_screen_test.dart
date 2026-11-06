import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/problem_screen.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// A problem (design 9.1, 12.1): the status as a radio group with only the forward moves, Still
/// ongoing as an observation, Resolved asked once, Still has this? on a Resolved problem, and a
/// note with its counter announced near the limit. Three themes, 200% text and 320 wide; offline.
void main() {
  List<OutboxEntry> statusSets(AppHarness h, String problemId) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityProblem && e.recordId == problemId && e.field == 'status') e,
  ];

  for (final run in runs) {
    testWidgets('a problem moves forward only, and Resolved asks once (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      final cough = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'new'});
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      h.server.offline = true;
      await tapOn(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, New')));
      expect(find.byType(ProblemScreen), findsOneWidget);
      expect(find.widgetWithText(AppBar, 'Problem'), findsOneWidget);
      await expectShown(tester, find.text('No code: won’t add supplies to route bags'));

      final now = find.bySemanticsLabel('New, current status');
      await expectShown(tester, now);
      expect(tester.getSemantics(now), isSemantics(isInMutuallyExclusiveGroup: true, isChecked: true));
      expect(find.bySemanticsLabel('Move to Ongoing'), findsOneWidget);
      expect(find.bySemanticsLabel('Move to Resolved'), findsOneWidget);
      await expectScreenOk(tester);

      // Confirming the status at a visit is an observation of its own.
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Still new'));
      expect(statusSets(h, cough), hasLength(1));
      expect(statusSets(h, cough).single.value, {'status': 'new', 'encounterId': null});

      await tapOn(tester, find.bySemanticsLabel('Move to Resolved'));
      expect(find.text('Mark as Resolved?'), findsOneWidget);
      expect(
        find.text('It stops counting toward route supplies, and only a Program Admin can undo it.'),
        findsOneWidget,
      );
      await expectGuidelines(tester);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Mark as Resolved'));
      expect(statusSets(h, cough).last.value, {'status': 'resolved', 'encounterId': null});
      // Resolved offers no move back, only Still has this?.
      expect(find.bySemanticsLabel(RegExp('^Move to')), findsNothing);
      await expectShown(tester, find.widgetWithText(OutlinedButton, 'Still has this?'));
      await expectScreenOk(tester);

      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Still has this?'));
      await tapOn(tester, find.text('It came back (a new episode)'));
      final again = h.sync.store!.outbox().lastWhere((e) => e.entity == entityProblem && e.op == 'create');
      expect((again.value! as Map)['recurrenceOf'], cough);
      expect((again.value! as Map)['status'], 'new');
      handle.dispose();
    });
  }

  testWidgets('a note, with the counter announced near the limit', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    final cough = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'ongoing'});
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, Ongoing')));
    await type(tester, 'problemNote', 'x' * 3500);
    expect(find.text('3,500 of 4,000 characters'), findsNothing);
    await type(tester, 'problemNote', 'x' * 3700);
    final counter = find.text('3,700 of 4,000 characters');
    await expectShown(tester, counter);
    expect(tester.getSemantics(counter), isSemantics(isLiveRegion: true));
    await type(tester, 'problemNote', 'Demo: worse at night');
    await tapOn(tester, find.widgetWithText(FilledButton, 'Add note'));
    final note = h.sync.store!.outbox().singleWhere((e) => e.entity == entityProblemNote);
    expect(note.value, {'problemId': cough, 'text': 'Demo: worse at night'});
    await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Note by you, not synced yet: Demo: worse at night')));
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a role without encounters.chart reads problems and changes nothing', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester, permissions: const ['patients.view', 'patients.edit', 'billing.view_codes']);
    seedP1(h.server);
    h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'new'});
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    expect(find.text('Add problem'), findsNothing);
    await tapOn(tester, find.bySemanticsLabel(RegExp(r'^Demo: cough, New')));
    expect(find.bySemanticsLabel(RegExp('^Move to')), findsNothing);
    expect(find.text('Still new'), findsNothing);
    await expectShown(tester, find.text('Your role reads problems; it doesn’t add notes.'));
    await expectScreenOk(tester);
    handle.dispose();
  });
}
