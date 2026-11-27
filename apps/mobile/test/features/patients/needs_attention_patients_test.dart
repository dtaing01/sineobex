import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason;
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;
import 'package:sineobex_field/sync/local_store.dart';

import '../../sync/fake_server.dart';
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

  testWidgets('a problem choice the store refuses says why, and the card stays', (tester) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signIn(tester);
    seedP1(h.server);
    final burn = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: burn', 'status': 'new'});
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    h.server.serverEdit(burn, 'status', {'status': 'resolved', 'encounterId': null}, by: teammate);
    h.wall = h.wall.add(const Duration(minutes: 1));
    h.boot.advance(const Duration(minutes: 1));
    h.patients.problems.move(burn, 'ongoing');
    await syncAndRefresh(tester, h);
    await openAttention(tester);
    // The hand-over starts with the card on screen; the controller hasn't said so yet.
    final store = h.sync.store!..freeze(frozen);
    final before = store.outbox().length;
    for (final choice in ['Keep Resolved', 'It came back: add as a new problem', 'Resolved by mistake: ask an admin']) {
      await tapOn(tester, find.text(choice));
      expect(tester.takeException(), isNull, reason: choice);
      expect(find.text(frozen), findsOneWidget, reason: choice);
      // The message has gone before the next choice.
      await tester.pump(const Duration(seconds: 5));
      await settle(tester);
    }
    expect(store.outbox(), hasLength(before));
    await expectShown(tester, find.text('Keep Resolved'));
  });

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

  // Phase 5 (design 6.2, 8.2; D121; card P5-needs-attention), written ahead of its code: a flag
  // change's two refusals a worker can fix, Choose a flag (or, with no flag of its tier to choose, why
  // not) and Change the reason, each settled through the flags domain class; the notice of a held
  // change that won't be applied, with Open patient; once frozen, only how many changes wait.
  group('a flag change in Needs attention (phase 5 design 8.2)', () {
    Map<String, Object?> flag(String name, String tier, String color, int rank) => {
      'name': name,
      'tier': tier,
      'criteria': '',
      'color': color,
      'rank': rank,
      'sensitive': false,
    };

    Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);
    Finder inDialog(Finder f) => find.descendant(of: find.byType(Dialog), matching: f);

    /// Del, the team's flags on the phone, and a change of [tier]'s flag the server's list has lost
    /// since this phone pulled it (a build fault): refused `unknown_flag`. Returns its record's ID.
    Future<({AppHarness h, String changeId, String recordId, String medium})> refusedFlag(
      WidgetTester tester, {
      Run? run,
      String tier = 'primary',
      bool archiveTheRest = false,
      String action = 'set',
    }) async {
      final h = await signIn(tester, theme: run?.theme, scale: run?.scale ?? 1, narrow: run?.narrow ?? false);
      seedP1(h.server);
      final team = h.patients.teamId;
      h.server.addPreset(team, 'flag', flag('Demo: High', 'primary', 'red', 10));
      final medium = h.server.addPreset(team, 'flag', flag('Demo: Medium', 'primary', 'yellow', 20));
      final frost = h.server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10));
      final ghost = h.server.addPreset(team, 'flag', flag('Demo: Old flag', tier, 'grey', 40));
      if (archiveTheRest) h.server.archivePreset(team, frost);
      await syncAndRefresh(tester, h);
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      h.server.presetsOf(team).heads.remove(ghost);
      final id = h.sync.store!.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': ghost,
        'action': action,
        'reason': 'Demo: left hospital',
      });
      final changeId = h.sync.store!.outbox().singleWhere((e) => e.recordId == id).changeId;
      await syncAndRefresh(tester, h);
      expect(h.sync.store!.entry(changeId)!.details?['problem'], 'unknown_flag');
      return (h: h, changeId: changeId, recordId: id, medium: medium);
    }

    for (final run in runs) {
      testWidgets('Choose a flag: its tier’s flags, the reason shown and editable; sent again, it settles '
          '(${runName(run)})', (tester) async {
        final handle = tester.ensureSemantics();
        final (:h, changeId: _, :recordId, :medium) = await refusedFlag(tester, run: run);
        await openAttention(tester);
        final heading = find.text('Flag change');
        await expectShown(tester, heading);
        expect(tester.getSemantics(heading), isSemantics(isHeader: true));
        await expectShown(tester, find.text('This flag isn’t on your team’s list. Choose a flag.'));
        await expectScreenOk(tester);

        await tapOn(tester, find.widgetWithText(FilledButton, 'Choose a flag'));
        expect(inSheet(find.text('Red · Demo: High')), findsOneWidget);
        expect(inSheet(find.text('Yellow · Demo: Medium')), findsOneWidget);
        expect(inSheet(find.textContaining('Demo: Old flag')), findsNothing);
        final reason = inSheet(find.byKey(const ValueKey('phi.flagReason')));
        expect(tester.widget<TextField>(reason).controller!.text, 'Demo: left hospital');
        await expectScreenOk(tester);
        await tester.tap(inSheet(find.text('Yellow · Demo: Medium')));
        await tester.enterText(reason, 'Demo: left hospital this week');
        await tester.pumpAndSettle();
        await tester.tap(inSheet(find.widgetWithText(FilledButton, 'Send it again')));
        await settle(tester);
        await syncAndRefresh(tester, h);
        final stored = h.server.records[recordId]!;
        expect([stored.attributes['flagId'], stored.attributes['reason']], [medium, 'Demo: left hospital this week']);
        expect(find.text('Nothing needs attention.'), findsOneWidget);
        handle.dispose();
      });
    }

    testWidgets('with no flag of its tier to choose, the card says so, and nothing is sent', (tester) async {
      final (:h, changeId: _, recordId: _, medium: _) = await refusedFlag(
        tester,
        tier: 'secondary',
        archiveTheRest: true,
      );
      await openAttention(tester);
      await expectShown(tester, find.text('This flag can’t be set on this phone. Tell a Program Admin.'));
      expect(find.widgetWithText(FilledButton, 'Choose a flag'), findsNothing);
      expect(h.sync.store!.needsAttention(), hasLength(1));
    });

    // Review finding F2: a refused clear sent again with another flag would clear that one, which the
    // person never chose to take off.
    for (final run in runs) {
      testWidgets('a refused clear offers no Choose a flag, says why, and sends nothing (${runName(run)})', (
        tester,
      ) async {
        final (:h, :changeId, recordId: _, medium: _) = await refusedFlag(tester, run: run, action: 'clear');
        await openAttention(tester);
        await expectShown(tester, find.text('This flag can’t be cleared on this phone. Tell a Program Admin.'));
        expect(find.text('This flag isn’t on your team’s list. Choose a flag.'), findsNothing);
        expect(find.widgetWithText(FilledButton, 'Choose a flag'), findsNothing);
        await expectScreenOk(tester);
        await syncAndRefresh(tester, h);
        expect(h.sync.store!.entry(changeId)!.state, ChangeState.rejected);
        expect(h.sync.store!.needsAttention(), hasLength(1));
      });
    }

    testWidgets('Change the reason: the same change sent again with the reason given', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final frost = h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10));
      await syncAndRefresh(tester, h);
      final store = h.sync.store!;
      final id = store.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': frost,
        'action': 'set',
        'reason': 'Demo: sleeps by the river',
      });
      // The server refused its reason, as a build that counts otherwise would.
      store.reject(
        store.outbox().singleWhere((e) => e.recordId == id),
        reason: 'validation',
        details: {'problem': 'reason_invalid'},
      );
      // A sync tells the controller; the refused change stays, and is never sent again as it was.
      await syncAndRefresh(tester, h);
      expect(store.needsAttention(), hasLength(1));
      await openAttention(tester);
      await expectShown(tester, find.text('The reason is empty or too long. Change the reason.'));
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Change the reason'));
      final box = inDialog(find.byKey(const ValueKey('phi.flagReason')));
      expect(tester.widget<TextField>(box).controller!.text, 'Demo: sleeps by the river');
      await expectGuidelines(tester);
      await tester.enterText(box, 'Demo: sleeps by the river most nights');
      await tester.tap(inDialog(find.widgetWithText(FilledButton, 'Send it again')));
      await settle(tester);
      await syncAndRefresh(tester, h);
      expect(h.server.records[id]!.attributes['reason'], 'Demo: sleeps by the river most nights');
      expect(store.needsAttention(), isEmpty);
    });

    testWidgets('a held flag change that won’t be applied: the notice, and Open patient', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester);
      seedP1(h.server);
      final high = h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10));
      await syncAndRefresh(tester, h);
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      // The role lost patients.edit at the desk: the server holds the change for a Program Admin.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      final store = h.sync.store!;
      final id = store.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      final changeId = store.outbox().singleWhere((e) => e.recordId == id).changeId;
      await syncAndRefresh(tester, h);
      h.server.rejectHeld(changeId);
      h.wall = h.wall.add(const Duration(minutes: 3));
      await syncAndRefresh(tester, h);
      await openAttention(tester);
      await expectShown(tester, find.text('A flag you set wasn’t applied. Open the patient to set it again.'));
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open patient'));
      expect(find.byType(PatientScreen), findsOneWidget);
      handle.dispose();
    });

    // Review finding W1: the notice says what the phone holds of the change, not always a set.
    Future<({AppHarness h, String high})> flagged(WidgetTester tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final high = h.server.addPreset(h.patients.teamId, 'flag', flag('Demo: High', 'primary', 'red', 10));
      await syncAndRefresh(tester, h);
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      return (h: h, high: high);
    }

    /// The words of the held flag change's notice, scrolled into view.
    Future<String?> noticeWords(WidgetTester tester) async {
      final notice = find.textContaining('wasn’t applied. Open the patient');
      await expectShown(tester, notice);
      return tester.widget<Text>(notice).data;
    }

    Future<void> rejected(WidgetTester tester, AppHarness h, String recordId) async {
      final changeId = h.sync.store!.outbox().singleWhere((e) => e.recordId == recordId).changeId;
      await syncAndRefresh(tester, h);
      expect(h.server.held.keys, contains(changeId));
      h.server.rejectHeld(changeId);
      h.wall = h.wall.add(const Duration(minutes: 3));
      await syncAndRefresh(tester, h);
    }

    testWidgets('a held clear that won’t be applied: the notice says it was a clear', (tester) async {
      final handle = tester.ensureSemantics();
      final (:h, :high) = await flagged(tester);
      h.server.seed(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      }, by: teammate);
      // The role lost patients.edit at the desk: the server holds the clear for a Program Admin.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      final id = h.sync.store!.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'clear',
        'reason': 'Demo: doing better',
      });
      await rejected(tester, h, id);
      await openAttention(tester);
      expect(await noticeWords(tester), 'A flag you cleared wasn’t applied. Open the patient to clear it again.');
      await expectScreenOk(tester);
      handle.dispose();
    });

    testWidgets('a held Entered in error mark that won’t be applied: the notice says it was the mark', (tester) async {
      final handle = tester.ensureSemantics();
      final (:h, :high) = await flagged(tester);
      final id = h.sync.store!.createRecord(entityFlagChange, {
        'patientId': p1Id,
        'flagId': high,
        'action': 'set',
        'reason': 'Demo: left hospital',
      });
      await syncAndRefresh(tester, h);
      expect(h.server.records[id]?.status, 'active', reason: 'the set was taken');
      // Then the role lost patients.edit at the desk: the mark is held for a Program Admin.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      h.patients.flags.enterInError(id, 'Demo: set on the wrong patient');
      await rejected(tester, h, id);
      await openAttention(tester);
      expect(
        await noticeWords(tester),
        'Your Entered in error mark wasn’t applied. Open the patient to mark it again.',
      );
      await expectScreenOk(tester);
      handle.dispose();
    });

    // Verification finding VS3: a held create stays held here once a Program Admin takes it, so the
    // notice of its mark, held since and not applied, read as the create's.
    testWidgets('a held set taken from review, then its Entered in error mark held and not applied: the notice '
        'says it was the mark', (tester) async {
      final handle = tester.ensureSemantics();
      final (:h, :high) = await flagged(tester);
      // The role lost patients.edit at the desk: the set is held, and a Program Admin takes it.
      h.server.permissions[h.patients.userId] = {...FakeSyncServer.healthcareStaff}..remove('patients.edit');
      final id = h.patients.flags.record(p1Id, flagId: high, action: 'set', reason: 'Demo: left hospital');
      final create = h.sync.store!.outbox().singleWhere((e) => e.recordId == id).changeId;
      await syncAndRefresh(tester, h);
      h.server.acceptHeld(create);
      await tester.runAsync(() => h.patients.charts.fetch([p1Id], reason: FetchChartsReason.refresh));
      // On the chart now, so it can be marked; the mark is held too, and not applied.
      h.patients.flags.enterInError(id, 'Demo: set on the wrong patient');
      await rejected(tester, h, id);
      await openAttention(tester);
      const words = 'Your Entered in error mark wasn’t applied. Open the patient to mark it again.';
      expect(await noticeWords(tester), words);
      await expectScreenOk(tester);
      // The same once the team's database is opened again, with nothing kept in memory.
      await tester.runAsync(h.session.lock);
      await settle(tester);
      await enter(tester, 'PIN', '482913');
      await tapText(tester, 'Unlock');
      await tester.runAsync(h.sync.ready);
      await settle(tester);
      await openAttention(tester);
      expect(await noticeWords(tester), words);
      handle.dispose();
    });

    testWidgets('a held flag change this phone never held: the notice names no act, and opens the patient', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final (:h, high: _) = await flagged(tester);
      // Made on another phone of the person's, held there, and not applied: this phone holds nothing of it.
      h.server.notices.add(
        FakeNotice(
          'f1a90000-0000-4000-8000-0000000000a1',
          h.patients.userId,
          noticeFlagChangeNotApplied,
          entityFlagChange,
          'f1a90000-0000-4000-8000-0000000000a2',
          h.server.now(),
          patientId: p1Id,
        ),
      );
      h.wall = h.wall.add(const Duration(minutes: 3));
      await syncAndRefresh(tester, h);
      await openAttention(tester);
      expect(
        await noticeWords(tester),
        'A flag change you made wasn’t applied. Open the patient to check their flags.',
      );
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open patient'));
      expect(find.byType(PatientScreen), findsOneWidget);
      handle.dispose();
    });

    testWidgets('while the clock is paused the fixes wait, and say so (D35)', (tester) async {
      final (:h, changeId: _, recordId: _, medium: _) = await refusedFlag(tester);
      // The server's clock is hours from the phone's: charting pauses, and the fixes with it.
      h.serverAhead = const Duration(hours: 2);
      await tester.runAsync(() => h.sync.checkClock(fresh: true));
      await settle(tester);
      await openAttention(tester);
      final choose = find.widgetWithText(FilledButton, 'Choose a flag');
      await reveal(tester, choose);
      expect(tester.widget<FilledButton>(choose).onPressed, isNull);
      await expectShown(tester, find.text('You can choose once the phone’s clock is right.'));
    });

    testWidgets('once the store freezes, only how many changes are on the phone (D125)', (tester) async {
      const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
      final (:h, changeId: _, recordId: _, medium: _) = await refusedFlag(tester);
      await openAttention(tester);
      await expectShown(tester, find.text('This flag isn’t on your team’s list. Choose a flag.'));
      h.sync.store!.freeze(frozen);
      h.patients.changed();
      await settle(tester);
      expect(find.text('This flag isn’t on your team’s list. Choose a flag.'), findsNothing);
      expect(find.text('Flag change'), findsNothing);
      await expectShown(tester, find.text('1 change is still on this phone.'));
    });
  });
}
