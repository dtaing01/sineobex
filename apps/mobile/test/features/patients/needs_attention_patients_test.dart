import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// Needs attention for patients (design 2.6, 9.3, 12.1): the problem conflict card and its three
/// choices, a refused card's Make a new card from the kept chart, a street name for a patient the
/// server doesn't have attached to another, and notices that need no fix. Titles never hold a value.
void main() {
  const teammate = 'c0000000-0000-4000-8000-0000000000c2';

  Future<void> openAttention(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')));
    await settle(tester);
    await tapOn(tester, find.text('Needs attention'));
  }

  for (final run in runs) {
    testWidgets('a problem Resolved on the server while this phone said Ongoing (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      final burn = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: burn', 'status': 'new'});
      await syncAndRefresh(tester, h);
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      // A teammate marks it Resolved; a minute later this phone, which hadn't seen that, marks it
      // Ongoing.
      h.server.serverEdit(burn, 'status', {'status': 'resolved', 'encounterId': null}, by: teammate);
      h.wall = h.wall.add(const Duration(minutes: 1));
      h.boot.advance(const Duration(minutes: 1));
      h.patients.problems.move(burn, 'ongoing');
      await syncAndRefresh(tester, h);
      await openAttention(tester);

      final heading = find.text('Demo: burn');
      await expectShown(tester, heading);
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      await expectShown(tester, find.textContaining('A teammate marked it Resolved on Oct 22'));
      await expectShown(tester, find.textContaining('You marked it Ongoing on this phone'));
      for (final choice in [
        'Keep Resolved',
        'It came back: add as a new problem',
        'Resolved by mistake: ask an admin',
      ]) {
        await expectShown(tester, find.text(choice));
      }
      await expectScreenOk(tester);

      await tapOn(tester, find.text('It came back: add as a new problem'));
      await settle(tester);
      final again = h.server.records.values.where((r) => r.entity == entityProblem && r.id != burn);
      expect(again, hasLength(1));
      expect(find.text('Demo: burn'), findsNothing);
      handle.dispose();
    });
  }

  testWidgets('a card for a merged chart: Make a new card from the kept chart', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    final p2 = h.server.seedPatient(preferredName: 'Demo Smitty');
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p2));
    h.server.offline = true;
    h.patients.idLinks.makeCard(p2, reason: 'first_card');
    h.server
      ..offline = false
      ..merge(p2, p1Id);
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    await expectShown(tester, find.text('ID card'));
    await expectShown(tester, find.text('This chart was merged. Make a new card from the kept chart.'));
    await expectScreenOk(tester);
    await tapOn(tester, find.text('Make a new card from the kept chart'));
    await settle(tester);
    final active = h.server.idLinks.values.where((l) => l.status == 'active').toList();
    expect(active, hasLength(1));
    expect(active.single.patientId, p1Id);
    expect(find.text('This chart was merged. Make a new card from the kept chart.'), findsNothing);
    handle.dispose();
  });

  testWidgets('a street name for a patient the server lacks is attached to another', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    final ghost = h.server.seedPatient(preferredName: 'Demo Ghost');
    await tester.runAsync(() => h.patients.patients.open(ghost));
    h.server.records.remove(ghost);
    h.patients.patients.addAlias(ghost, 'Demo: Red');
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    await expectShown(tester, find.text('Street name'));
    await expectShown(tester, find.text('The patient this belongs to isn’t on the team’s list.'));
    await expectScreenOk(tester);
    await tapOn(tester, find.text('Attach to another patient'));
    await type(tester, 'attachSearch', 'Del');
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
    await tapOn(tester, find.bySemanticsLabel(RegExp(r'^Del, also known as Smitty')));
    await settle(tester);
    final red = h.server.records.values.where((r) => r.entity == entityAlias && r.patientId == p1Id);
    expect(red.map((r) => r.attributes['alias']), contains('Demo: Red'));
    handle.dispose();
  });

  testWidgets('two values recorded: a notice to acknowledge, not a fix', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    h.server.serverEdit(p1Id, 'usualArea', 'Demo: by the river', by: teammate);
    h.patients.patients.update(p1Id, {'usualArea': 'Demo: by the library steps'});
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    final notice = find.text('Two values recorded for Usually found. Someone who knows this person will choose.');
    await expectShown(tester, notice);
    await expectScreenOk(tester);
    await tapOn(tester, find.text('Got it'));
    expect(notice, findsNothing);
    expect(find.text('Nothing needs attention.'), findsOneWidget);
    handle.dispose();
  });
}
