import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart' show ApiException;
import 'package:sineobex_field/features/patients/patient_labels.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show OnlineProblem;

import '../../auth/fakes.dart' show demoUser;
import '../../sync/fake_server.dart' show FakeSyncServer;
import 'patient_kit.dart';

/// What changed (design 11.7, 12.1), from the profile's History through the domain layer to the
/// fake server (review P10): every change of the chart newest first, each in words (a problem's
/// status, a street name removed with its reason), a page at a time, the read logged by the server,
/// and every refusal in plain words. Three themes, 200% text and 320 wide.
void main() {
  const steps = 'Demo: by the library steps';
  final smitty = ((p1['aliases']! as List<Object?>).first! as Map<String, Object?>)['id']! as String;

  Future<AppHarness> openDel(WidgetTester tester, {Run? run, void Function(AppHarness h)? changes}) async {
    final h = await signIn(tester, theme: run?.theme, scale: run?.scale ?? 1, narrow: run?.narrow ?? false);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    if (changes != null) {
      await tester.runAsync(() => h.patients.patients.open(p1Id));
      changes(h);
      await syncAndRefresh(tester, h);
    }
    await go(tester, '/patients/$p1Id');
    return h;
  }

  Finder showHistory() => find.widgetWithText(OutlinedButton, 'Show what changed');
  Finder sheetList() => find.descendant(of: find.byType(BottomSheet), matching: find.byType(Scrollable)).first;

  ScrollPosition sheetPosition(WidgetTester tester) => tester.state<ScrollableState>(sheetList()).position;

  /// The sheet's own list (the profile's is under it) from its top, down to its end.
  Future<void> sheetTo(WidgetTester tester, {required bool end}) async {
    final position = sheetPosition(tester)..jumpTo(0);
    await tester.pump();
    // A list builds what is near the screen, and learns how long it is as it goes.
    while (end && position.pixels < position.maxScrollExtent) {
      position.jumpTo(position.maxScrollExtent);
      await tester.pump();
    }
  }

  /// Scrolls the sheet's list from the top until [finder] shows.
  Future<void> shownInSheet(WidgetTester tester, Finder finder) async {
    await sheetTo(tester, end: false);
    final position = sheetPosition(tester);
    while (finder.evaluate().isEmpty && position.pixels < position.maxScrollExtent) {
      position.jumpTo(math.min(position.pixels + 300, position.maxScrollExtent));
      await tester.pump();
    }
    expect(finder, findsOneWidget);
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
  }

  int historyReads(AppHarness h) => h.server.serverAudit.where((a) => a['action'] == 'patient.history_viewed').length;

  for (final run in runs) {
    testWidgets('every change in words, newest first, and the read is logged (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      late String cough;
      final h = await openDel(
        tester,
        run: run,
        changes: (h) {
          // Where Del is found changes, a street name is removed, and a problem is added and moved.
          h.patients.patients.update(p1Id, {'usualArea': steps});
          h.patients.patients.removeAlias(smitty, 'Typed by mistake');
          cough = h.patients.problems.add(p1Id, title: 'Demo: cough', status: 'new');
          h.patients.problems.move(cough, 'ongoing');
        },
      );
      await tapOn(tester, showHistory());
      final heading = find.text('What changed');
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      expect(historyReads(h), 1);
      await expectGuidelines(tester);

      const how = ' · Demo user · Oct 22 · on a phone';
      final moved = find.text('Problem status: New → Ongoing$how');
      final added = find.text('Problem status: (blank) → New$how');
      final removed = find.text('Street name removed: Typed by mistake$how');
      final area = find.text('Usually found: Demo: by the made-up Elm St underpass → $steps$how');
      for (final line in [moved, added, removed, area]) {
        await shownInSheet(tester, line);
      }
      // Newest first: the last thing done leads, above the one before it.
      await sheetTo(tester, end: false);
      expect(tester.getRect(moved).top, lessThan(tester.getRect(added).top));
      // What the chart was registered with is at the end, the legal name on the chart's own screen.
      await shownInSheet(tester, find.textContaining('Name they go by: (blank) → Del · Demo user'));
      await shownInSheet(tester, find.textContaining('Legal name: (blank) → Delbert Smithfield · Demo user'));
      await sheetTo(tester, end: false);
      await expectGuidelines(tester);
      expect(historyReads(h), 1);
      handle.dispose();
    });
  }

  testWidgets('a long history comes a page at a time: Show earlier changes', (tester) async {
    final h = await openDel(
      tester,
      changes: (h) {
        // More edits than one page holds.
        for (var i = 1; i <= FakeSyncServer.historyPage + 5; i++) {
          h.patients.patients.update(p1Id, {'usualArea': 'Demo: spot $i'});
        }
      },
    );
    await tapOn(tester, showHistory());
    final more = find.widgetWithText(OutlinedButton, 'Show earlier changes');
    final registered = find.textContaining('Name they go by: (blank) → Del');
    // The first page ends with the button, not with the chart's registration.
    await sheetTo(tester, end: true);
    expect(more, findsOneWidget);
    expect(registered, findsNothing);
    expect(historyReads(h), 1);

    await tester.tap(more);
    await settle(tester);
    // The last page: the registration is there, and nothing earlier to ask for.
    await shownInSheet(tester, registered);
    await sheetTo(tester, end: true);
    expect(more, findsNothing);
    expect(historyReads(h), 2);
  });

  testWidgets('a chart with nothing recorded says so', (tester) async {
    final h = await signIn(tester);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    h.server.history.clear();
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, showHistory());
    expect(find.text('No changes recorded yet.'), findsOneWidget);
  });

  testWidgets('history the server refuses says why in plain words', (tester) async {
    final h = await openDel(tester);
    final me = demoUser().userId;

    /// Opens History with the server answering as [arrange] sets it up, expects [problem]'s
    /// sentence and nothing of the chart's history, then closes the sheet.
    Future<void> refused(OnlineProblem problem, void Function() arrange, [void Function()? undo]) async {
      arrange();
      await tapOn(tester, showHistory());
      undo?.call();
      expect(find.text(historyProblemText(problem)), findsOneWidget, reason: problem.name);
      expect(find.textContaining('Name they go by:'), findsNothing, reason: problem.name);
      expect(find.text('No changes recorded yet.'), findsNothing, reason: problem.name);
      await tester.binding.handlePopRoute();
      await settle(tester);
      expect(find.text('What changed'), findsNothing);
    }

    void answer(Object? error) => h.server.onRequest = error == null
        ? null
        : (path) {
            if (path.endsWith('/history')) throw error;
          };

    // The signal went after the chart opened: the button is still there.
    await refused(OnlineProblem.offline, () => h.server.offline = true, () => h.server.offline = false);
    // The role lost patients.view since the chart was opened.
    await refused(
      OnlineProblem.notAllowed,
      () => h.server.permissions[me] = {'encounters.chart'},
      () => h.server.permissions.remove(me),
    );
    await refused(
      OnlineProblem.signInAgain,
      () => h.server.refuseCode = 'reauth_required',
      () => h.server.refuseCode = null,
    );
    await refused(OnlineProblem.failed, () => answer(const ApiException(503, 'unavailable', '')), () => answer(null));
    await refused(
      OnlineProblem.invalid,
      () => answer(const ApiException(422, 'validation_failed', '')),
      () => answer(null),
    );
    // The server has no such patient: a chart made on this phone that hasn't synced, for one.
    await refused(OnlineProblem.notFound, () => h.server.records.remove(p1Id));
    expect(historyReads(h), 0);
  });

  testWidgets('a street name removed, an allergy and a problem entered in error read with their reasons', (
    tester,
  ) async {
    final allergy = ((p1['allergies']! as List<Object?>).first! as Map<String, Object?>)['id']! as String;
    await openDel(
      tester,
      changes: (h) {
        final cough = h.patients.problems.add(p1Id, title: 'Demo: cough', status: 'new');
        h.patients.patients.allergyEnteredInError(allergy, 'Not an allergy');
        h.patients.problems.enteredInError(cough, 'Added twice');
      },
    );
    await tapOn(tester, showHistory());
    await shownInSheet(tester, find.textContaining('Allergy entered in error: Not an allergy · Demo user'));
    await shownInSheet(tester, find.textContaining('Problem entered in error: Added twice · Demo user'));
    // Never the raw value.
    expect(find.textContaining('{'), findsNothing);
    expect(find.textContaining('reason:'), findsNothing);
  });
}
