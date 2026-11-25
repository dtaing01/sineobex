import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/features/patients/flag_sheet.dart' show conditionsDoneAction;
import 'package:sineobex_field/features/patients/patient_row.dart' show PatientRow;
import 'package:sineobex_field/features/patients/patients_screen.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;
import 'package:sineobex_field/sync/local_store.dart';

import '../../sync/fake_server.dart';
import 'patient_kit.dart';

/// The Patients tab (design 12.1): the list's status line, a search found offline by a misspelled
/// street name (13.1 step 3) with the count announced once per run and no legal name anywhere,
/// no results and New patient with this name, and the list's expiry. Day, Night run, High contrast,
/// and 200% text.
void main() {
  for (final run in runs) {
    testWidgets('a misspelled street name finds Del offline, audited, with no legal name (${runName(run)})', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      seedP1(h.server);
      await syncAndRefresh(tester, h);

      await openPatientsTab(tester);
      expect(find.byType(PatientsScreen), findsOneWidget);
      expect(find.text('Patient list updated just now · 1 patient'), findsOneWidget);
      // Opened from the bar, the search takes focus.
      final search = tester.widget<TextField>(find.byKey(const ValueKey('phi.search')));
      expect(search.focusNode!.hasFocus, isTrue);
      await expectScreenOk(tester);

      // Airplane mode.
      h.server.offline = true;
      final before = auditEvents(h.sync.store!).length;
      await tester.enterText(find.byKey(const ValueKey('phi.search')), 'Smity');
      await tester.pump(const Duration(milliseconds: 300));
      // Nothing runs, and nothing is announced, while the person is still typing.
      expect(find.textContaining('found'), findsNothing);
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);

      final count = find.text('1 patient found on this phone');
      await reveal(tester, count);
      expect(count, findsOneWidget);
      expect(tester.getSemantics(count), isSemantics(isLiveRegion: true));
      final row = find.bySemanticsLabel(RegExp(r'^Del, also known as Smitty, born 1946, age 80'));
      await reveal(tester, row);
      expect(row, findsOneWidget);
      expect(
        tester.getSemantics(row).label,
        'Del, also known as Smitty, born 1946, age 80, usually found Demo: by the made-up Elm St underpass, '
        'last seen October 22, looks like Demo: tall, grey beard, red cap. Allergy: penicillin, severe. '
        'Matched: close to a street name',
      );
      expect(tester.getSemantics(row), isSemantics(isButton: true));
      expectNoLegalName(tester);
      // The field kept focus while the results arrived.
      expect(search.focusNode!.hasFocus, isTrue);

      // One run, one audit entry, written before the list showed; the search text never stored.
      final store = h.sync.store!;
      expect(auditEvents(store).sublist(before), ['patient.searched']);
      expect(store.outbox().any((e) => jsonEncode(e.value).toLowerCase().contains('smit')), isFalse);
      await expectScreenOk(tester);

      // The status line says the list is the phone's own.
      await reveal(tester, find.textContaining('Offline · searching the list on this phone'));
      expect(find.textContaining('Offline · searching the list on this phone'), findsOneWidget);

      // A row opens the profile, offline, from the list (13.1 step 4).
      await tapOn(tester, row);
      await expectShown(tester, find.text('List only: the full chart opens when the phone reconnects.'));
      handle.dispose();
    });
  }

  testWidgets('no one found offers New patient with this name, which carries the name into intake', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await openPatientsTab(tester);
    h.server.offline = true;

    await tester.enterText(find.byKey(const ValueKey('phi.search')), 'Quentin');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await settle(tester);
    expect(find.text('No one found on this phone.'), findsOneWidget);
    await expectScreenOk(tester);

    await tapOn(tester, find.text('New patient with this name'));
    expect(find.text('New patient'), findsWidgets);
    expect((await fieldNamed(tester, 'preferredName')).controller!.text, 'Quentin');
    handle.dispose();
  });

  testWidgets('a list older than 7 days is removed and the tab says so', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    // Eight days pass, by the wall clock and the clock since boot the corrected time follows.
    h.wall = h.wall.add(const Duration(days: 8));
    h.boot.advance(const Duration(days: 8));
    expect(h.patients.index.expireIfStale(), isTrue);
    await openPatientsTab(tester);
    expect(
      find.text(
        'The patient list on this phone was more than 7 days old and was removed. Connect to download it again.',
      ),
      findsOneWidget,
    );
    await tester.enterText(find.byKey(const ValueKey('phi.search')), 'Smity');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await settle(tester);
    expect(find.text('No one found on this phone.'), findsOneWidget);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('an empty search lists the charts opened recently, audited once', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    await openPatientsTab(tester);
    expect(find.text('Opened recently on this phone'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'^Del, also known as Smitty')), findsOneWidget);
    // A list of patients is a disclosure: logged once for the display, never per rebuild.
    final listed = [
      for (final e in h.sync.store!.outbox())
        if (e.entity == entityAudit && (e.value! as Map)['action'] == 'patient.searched') e,
    ];
    expect(listed, hasLength(1));
    await tester.pump(const Duration(seconds: 1));
    expect(auditEvents(h.sync.store!).where((a) => a == 'patient.searched'), hasLength(1));
    expectNoLegalName(tester);
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a result row is a button Switch Access and Voice Access can activate (V6)', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    await openPatientsTab(tester);
    await tester.enterText(find.byKey(const ValueKey('phi.search')), 'Smity');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await settle(tester);
    final row = find.bySemanticsLabel(RegExp('^Del, also known as'));
    await reveal(tester, row);
    expect(tester.getSemantics(row), isSemantics(isButton: true, hasTapAction: true));
    tester.semantics.tap(find.semantics.byLabel(RegExp('^Del, also known as')));
    await settle(tester);
    await expectShown(tester, find.text('List only: the full chart opens when the phone reconnects.'));
    handle.dispose();
  });

  group('a lock with patient screens under others reads nothing from the closed database (V12)', () {
    Future<void> lockWithoutErrors(WidgetTester tester, AppHarness h) async {
      await tester.runAsync(h.session.lock);
      await tester.pump();
      await tester.pump();
      expect(tester.takeException(), isNull);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.text('Unlock'), findsWidgets);
    }

    testWidgets('the Patients tab under a profile', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      await openPatientsTab(tester);
      await go(tester, '/patients/$p1Id');
      await lockWithoutErrors(tester, h);
    });

    testWidgets('Home under a profile', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await go(tester, '/patients/$p1Id');
      await lockWithoutErrors(tester, h);
    });

    testWidgets('a profile under its problem, and under its ID card', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      final cough = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'new'});
      await syncAndRefresh(tester, h);
      await openPatientsTab(tester);
      await go(tester, '/patients/$p1Id');
      await go(tester, '/patients/$p1Id/problems/$cough');
      await go(tester, '/patients/$p1Id/card');
      await lockWithoutErrors(tester, h);
    });
  });

  testWidgets('a freeze for a hand-over: the lists go at the tab’s next rebuild, whatever causes it (V1)', (
    tester,
  ) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    await openPatientsTab(tester);
    expect(find.bySemanticsLabel(RegExp('^Del, also known as')), findsOneWidget);
    // The hand-over starts, and before the controller says so a download ends.
    h.sync.store!.freeze(frozen);
    h.patients.changed();
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('Opened recently on this phone'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Del, also known as'), skipOffstage: false), findsNothing);
  });

  testWidgets('a freeze for a hand-over: an Opened-recently row shows no chart, and the list goes (V1)', (
    tester,
  ) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    await openPatientsTab(tester);
    final row = find.bySemanticsLabel(RegExp('^Del, also known as'));
    expect(row, findsOneWidget);
    h.server.offline = true;
    final store = h.sync.store!;
    final before = auditEvents(store).length;
    // The row read before the freeze is still on screen until the controller next tells its
    // listeners; tapping it opens nothing.
    store.freeze(frozen);
    await tapOn(tester, row);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('Legal name: Delbert Smithfield', skipOffstage: false), findsNothing);
    expectNoLegalName(tester);
    expect(auditEvents(store), hasLength(before));

    // Back on the tab once the controller has spoken: the list read before the freeze is gone, and
    // the tab's own state with it.
    final context = tester.element(find.byType(Navigator).first);
    GoRouter.of(context).pop();
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    expect(find.text(frozen), findsOneWidget);
    expect(find.text('Opened recently on this phone'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Del, also known as'), skipOffstage: false), findsNothing);
    expect(auditEvents(store), hasLength(before));

    // Access comes back: the tab starts over, and the list it shows now is read, and logged, afresh.
    store.unfreeze();
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    expect(find.text(frozen), findsNothing);
    expect(find.text('Opened recently on this phone'), findsOneWidget);
    expect(auditEvents(store).sublist(before), ['patient.searched']);
  });

  // A sheet is not under the tab's gate: it sits in its own (phase 3's V1).
  for (final (how, tell) in <(String, Future<void> Function(WidgetTester, AppHarness))>[
    // A sync that finds no signal.
    ('the controller says so', (tester, h) => tester.runAsync(() => h.sync.syncNow())),
    ('a download ends before the controller says so', (tester, h) async => h.patients.changed()),
  ]) {
    testWidgets('a freeze for a hand-over leaves only why on the Born sheet, and searches nothing: $how (V1)', (
      tester,
    ) async {
      const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await openPatientsTab(tester);
      await tapOn(tester, find.widgetWithText(ActionChip, 'Born'));
      await tester.enterText(find.byKey(const ValueKey('phi.born')), '1946');
      await tester.pump(const Duration(milliseconds: 900));
      await settle(tester);
      expect(find.descendant(of: find.byType(BottomSheet), matching: find.text('1946')), findsOneWidget);
      h.server.offline = true;
      final store = h.sync.store!;
      final before = store.outbox().length;

      store.freeze(frozen);
      await tell(tester, h);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(frozen)), findsOneWidget);
      expect(find.text('1946', skipOffstage: false), findsNothing);
      expect(find.byKey(const ValueKey('phi.born'), skipOffstage: false), findsNothing);

      // Closing it sets no criterion and runs no search.
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.textContaining('Born 1946', skipOffstage: false), findsNothing);
      expect(store.outbox(), hasLength(before));
    });
  }

  // Phase 5 (design 8.2; section 11, row 37; card P5-phone-list), written ahead of its code: each index
  // row's risk level, and the Risk level and Conditions filters, offline from the index, a sensitive
  // flag absent for a reader the flag rule hides it from.
  group('flags on the patient list (phase 5 design 8.2)', () {
    Map<String, Object?> flag(String name, String tier, String color, int rank, {bool sensitive = false}) => {
      'name': name,
      'tier': tier,
      'criteria': '',
      'color': color,
      'rank': rank,
      'sensitive': sensitive,
    };

    /// Three patients on the team's list: Quill with High, Quillon with Medium and Frost risk, and
    /// Quillan with Pregnancy (sensitive) and Frost risk.
    Future<AppHarness> listWithFlags(WidgetTester tester, {Run? run, List<String>? permissions}) async {
      final h = await signIn(
        tester,
        theme: run?.theme,
        scale: run?.scale ?? 1,
        narrow: run?.narrow ?? false,
        permissions: permissions,
      );
      final team = h.patients.teamId;
      final high = h.server.addPreset(team, 'flag', flag('Demo: High', 'primary', 'red', 10));
      final medium = h.server.addPreset(team, 'flag', flag('Demo: Medium', 'primary', 'yellow', 20));
      final frost = h.server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10));
      final pregnancy = h.server.addPreset(
        team,
        'flag',
        flag('Demo: Pregnancy', 'secondary', 'purple', 30, sensitive: true),
      );
      void set(String patientId, String flagId) => h.server.seed(entityFlagChange, {
        'patientId': patientId,
        'flagId': flagId,
        'action': 'set',
        'reason': 'Demo: a reason',
      });
      final quill = h.server.seedPatient(preferredName: 'Demo Quill');
      final quillon = h.server.seedPatient(preferredName: 'Demo Quillon');
      final quillan = h.server.seedPatient(preferredName: 'Demo Quillan');
      set(quill, high);
      set(quillon, medium);
      set(quillon, frost);
      set(quillan, pregnancy);
      set(quillan, frost);
      await syncAndRefresh(tester, h);
      h.server.offline = true;
      await openPatientsTab(tester);
      return h;
    }

    Finder rowOf(String name) => find.bySemanticsLabel(RegExp('^$name[,.]'));

    Future<void> chooseInDialog(WidgetTester tester, String chip, List<String> pills, {bool done = false}) async {
      await tapOn(tester, find.widgetWithText(ActionChip, chip));
      for (final pill in pills) {
        await tester.tap(find.descendant(of: find.byType(Dialog), matching: find.text(pill)));
        await tester.pumpAndSettle();
      }
      if (done) await tester.tap(find.descendant(of: find.byType(Dialog), matching: find.text(conditionsDoneAction)));
      await settle(tester);
    }

    for (final run in runs) {
      testWidgets('each row shows its risk level, and Risk level lists who carries it, offline (${runName(run)})', (
        tester,
      ) async {
        final handle = tester.ensureSemantics();
        final h = await listWithFlags(tester, run: run);
        await tester.enterText(find.byKey(const ValueKey('phi.search')), 'Demo Quill');
        await tester.pump(const Duration(milliseconds: 700));
        await settle(tester);
        final quill = rowOf('Demo Quill');
        await reveal(tester, quill);
        // Its pill, in words, and in what a screen reader hears of the row.
        expect(find.descendant(of: find.byType(PatientRow), matching: find.text('Red · Demo: High')), findsOneWidget);
        expect(tester.getSemantics(quill).label, contains('Red, Demo: High'));
        await expectScreenOk(tester);

        // The filter, with no name typed: the list on this phone, by risk level.
        await tester.enterText(find.byKey(const ValueKey('phi.search')), '');
        await settle(tester);
        final before = auditEvents(h.sync.store!).length;
        await chooseInDialog(tester, 'Risk level', ['Red · Demo: High']);
        await expectShown(tester, find.text('1 patient found on this phone'));
        await reveal(tester, rowOf('Demo Quill'));
        expect(rowOf('Demo Quillon'), findsNothing);
        expect(rowOf('Demo Quillan'), findsNothing);
        // One list, one audit entry, and never the flag.
        expect(auditEvents(h.sync.store!).sublist(before), ['patient.searched']);
        await expectScreenOk(tester);
        handle.dispose();
      });
    }

    testWidgets('Conditions lists who carries every one chosen, with or without a risk level', (tester) async {
      await listWithFlags(tester);
      await chooseInDialog(tester, 'Conditions', ['Blue · Demo: Frost risk'], done: true);
      await expectShown(tester, find.text('2 patients found on this phone'));
      expect(rowOf('Demo Quillon'), findsOneWidget);
      expect(rowOf('Demo Quillan'), findsOneWidget);
      await chooseInDialog(tester, 'Risk level', ['Yellow · Demo: Medium']);
      await expectShown(tester, find.text('1 patient found on this phone'));
      expect(rowOf('Demo Quillon'), findsOneWidget);
    });

    testWidgets('a sensitive flag is absent for a reader the flag rule hides it from', (tester) async {
      await listWithFlags(tester, permissions: FakeSyncServer.chw.toList());
      await tapOn(tester, find.widgetWithText(ActionChip, 'Conditions'));
      expect(find.descendant(of: find.byType(Dialog), matching: find.text('Blue · Demo: Frost risk')), findsOneWidget);
      expect(find.textContaining('Pregnancy'), findsNothing);
    });
  });
}
