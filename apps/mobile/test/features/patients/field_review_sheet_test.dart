import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart' show ApiException;
import 'package:sineobex_field/features/patients/patient_labels.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show OnlineProblem;

import '../../auth/fakes.dart' show demoUser;
import 'patient_kit.dart';

/// "Which is right?" (design 3.2, 12.1), from the profile's banner through the domain layer to the
/// fake server (review P10): each value a radio card labelled with the value, who and when; Save
/// choice decides the review on the server and the chart then shows the value kept; every refusal
/// in plain words; identity reviews say a Program Admin will check them and offer no choice. Three
/// themes, 200% text and 320 wide.
void main() {
  const teammate = 'c0000000-0000-4000-8000-0000000000c2';
  const river = 'Demo: by the river';
  const steps = 'Demo: by the library steps';
  // Found when asked for: a finder by label needs the test's binding.
  Finder onChart() => find.bySemanticsLabel(RegExp('^${RegExp.escape(river)}\\. On the chart now'));
  Finder other() => find.bySemanticsLabel(RegExp('^${RegExp.escape(steps)}\\. Recorded by Demo user'));
  Finder save() => find.widgetWithText(FilledButton, 'Save choice');

  /// Del's usual area recorded twice: a teammate's value on the chart and this phone's kept beside
  /// it. Leaves the profile open, online, with the banner showing.
  Future<AppHarness> twoValues(WidgetTester tester, {Run? run}) async {
    final h = await signIn(tester, theme: run?.theme, scale: run?.scale ?? 1, narrow: run?.narrow ?? false);
    seedP1(h.server);
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(p1Id));
    h.server.serverEdit(p1Id, 'usualArea', river, by: teammate);
    h.patients.patients.update(p1Id, {'usualArea': steps});
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('Two values for Usually found'));
    return h;
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tapOn(tester, find.bySemanticsLabel('Choose the value for Usually found'));
    expect(find.text('Which is right?'), findsOneWidget);
  }

  int chartViews(AppHarness h) => h.server.serverAudit.where((a) => a['action'] == 'patient.viewed').length;

  for (final run in runs) {
    testWidgets('the values are a radio group, and Save choice keeps the one chosen (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await twoValues(tester, run: run);
      await openSheet(tester);
      expect(tester.getSemantics(find.text('Which is right?')), isSemantics(isHeader: true));
      for (final card in [onChart(), other()]) {
        await reveal(tester, card);
        expect(tester.getSemantics(card), isSemantics(isInMutuallyExclusiveGroup: true, isChecked: false));
      }
      await reveal(tester, save());
      expect(tester.widget<FilledButton>(save()).onPressed, isNull);
      // From the top of the sheet: at 200% text it scrolls, and a card cut off by its top edge
      // would be measured as it shows.
      await reveal(tester, find.text('Which is right?'));
      await expectGuidelines(tester);

      await tapOn(tester, other());
      expect(tester.getSemantics(other()), isSemantics(isInMutuallyExclusiveGroup: true, isChecked: true));
      expect(tester.getSemantics(onChart()), isSemantics(isChecked: false));
      final views = chartViews(h);
      await tapOn(tester, save());

      // Decided on the server, as of the version this phone was shown.
      final review = h.server.reviews.values.single;
      expect(review.status, 'decided');
      expect(review.decidedBy, demoUser().userId);
      expect(review.decision!['kept'], 'alternate');
      expect(h.server.records[p1Id]!.fields['usualArea']!.value, steps);
      expect(h.server.serverAudit.map((a) => a['action']), contains('field_review.decided'));
      // The sheet closes, and the chart, opened again once, shows the value kept.
      expect(find.text('Which is right?'), findsNothing);
      expect(find.text('Choice saved'), findsOneWidget);
      expect(chartViews(h), views + 1);
      await expectShown(tester, find.text('Usually found: $steps'));
      expect(find.text('Two values for Usually found'), findsNothing);
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('keeping the value on the chart closes the review and changes nothing else', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await twoValues(tester);
    await openSheet(tester);
    await tapOn(tester, onChart());
    await tapOn(tester, save());
    final review = h.server.reviews.values.single;
    expect(review.status, 'decided');
    expect(review.decision, {'kept': 'current', 'historyId': null});
    expect(h.server.records[p1Id]!.fields['usualArea']!.value, river);
    expect(find.text('Choice saved'), findsOneWidget);
    await expectShown(tester, find.text('Usually found: $river'));
    expect(find.text('Two values for Usually found'), findsNothing);
    handle.dispose();
  });

  testWidgets('offline, Save choice is off and says why', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await twoValues(tester);
    h.server.offline = true;
    await tester.runAsync(() => h.sync.syncNow());
    await settle(tester);
    await openSheet(tester);
    await tapOn(tester, other());
    await expectShown(tester, find.text('Connect to save a choice. Until then both values stay on the chart.'));
    expect(tester.widget<FilledButton>(save()).onPressed, isNull);
    await expectGuidelines(tester);
    expect(h.server.reviews.values.single.status, 'open');
    handle.dispose();
  });

  testWidgets('an identity review is a Program Admin’s: no choice here', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    final ash = h.server.seedPatient(preferredName: 'Demo Ash');
    await syncAndRefresh(tester, h);
    await tester.runAsync(() => h.patients.patients.open(ash));
    // A teammate records a legal name; this phone, which hadn't seen it, records another.
    h.server.serverEdit(ash, 'legalName', {'given': 'Demo', 'family': 'Ashby'}, by: teammate);
    h.patients.patients.update(ash, {
      'legalName': {'given': 'Demo', 'family': 'Ashdown'},
    });
    await syncAndRefresh(tester, h);
    expect(h.server.reviews.values.single.needs, 'patients.correct_identity');
    await go(tester, '/patients/$ash');
    await expectShown(tester, find.text('Two values for Legal name'));
    await tapOn(tester, find.bySemanticsLabel('Choose the value for Legal name'));
    expect(find.text('A Program Admin will check this.'), findsOneWidget);
    expect(find.text('Save choice'), findsNothing);
    final current = find.bySemanticsLabel(RegExp(r'^Demo Ashby\. On the chart now'));
    await reveal(tester, current);
    expect(tester.getSemantics(current), isSemantics(isEnabled: false));
    await expectGuidelines(tester);
    handle.dispose();
  });

  testWidgets('a choice the server refuses says why in plain words, and the sheet stays', (tester) async {
    final h = await twoValues(tester);
    await openSheet(tester);
    await tapOn(tester, other());
    final me = demoUser().userId;

    /// Saves with the server answering as [arrange] sets it up, and expects [problem]'s sentence.
    Future<void> refused(OnlineProblem problem, void Function() arrange, [void Function()? undo]) async {
      arrange();
      await tapOn(tester, save());
      undo?.call();
      await expectShown(tester, find.text(reviewProblemText(problem)));
      expect(find.text('Which is right?'), findsOneWidget, reason: problem.name);
      expect(find.text('Choice saved'), findsNothing, reason: problem.name);
    }

    void answer(Object? error) => h.server.onRequest = error == null
        ? null
        : (path) {
            if (path.endsWith('/decision')) throw error;
          };

    // The phone was online when the sheet opened; the signal went before Save.
    await refused(OnlineProblem.offline, () => h.server.offline = true, () => h.server.offline = false);
    // The role lost patients.edit since the chart was opened.
    await refused(
      OnlineProblem.notAllowed,
      () => h.server.permissions[me] = {'patients.view'},
      () => h.server.permissions.remove(me),
    );
    await refused(
      OnlineProblem.signInAgain,
      () => h.server.refuseCode = 'reauth_required',
      () => h.server.refuseCode = null,
    );
    // Answers only a legal name or birth decision gets, which the phone never sends; worded all
    // the same, should the server's rules move.
    await refused(
      OnlineProblem.commentRequired,
      () => answer(const ApiException(422, 'comment_required', '')),
      () => answer(null),
    );
    await refused(
      OnlineProblem.nothingToRecognise,
      () => answer(const ApiException(409, 'nothing_to_recognise', '')),
      () => answer(null),
    );
    await refused(
      OnlineProblem.invalid,
      () => answer(const ApiException(422, 'not_an_alternate', '')),
      () => answer(null),
    );
    await refused(OnlineProblem.failed, () => answer(const ApiException(503, 'unavailable', '')), () => answer(null));
    // A teammate changes the value again while the sheet is open.
    await refused(
      OnlineProblem.fieldChanged,
      () => h.server.serverEdit(p1Id, 'usualArea', 'Demo: by the bridge', by: teammate),
    );
    // Someone else chooses first.
    await refused(OnlineProblem.alreadyDecided, () => h.server.reviews.values.single.status = 'decided');
    // The review is gone altogether.
    await refused(OnlineProblem.notFound, h.server.reviews.clear);
    expect(h.server.serverAudit.map((a) => a['action']), isNot(contains('field_review.decided')));
  });

  test('every reason a choice or the history can fail has its own plain sentence', () {
    for (final wording in [reviewProblemText, historyProblemText]) {
      for (final problem in OnlineProblem.values) {
        final text = wording(problem);
        expect(text, endsWith('.'), reason: problem.name);
        // Words for a person: no code, no status, nothing that reads like the API.
        expect(text, isNot(matches(RegExp(r'[_{}<>]|\d{3}|\b(null|error|exception|invalid|request)\b'))));
      }
    }
    // A choice's reasons are all different things to do, so no two share a sentence.
    expect(OnlineProblem.values.map(reviewProblemText).toSet(), hasLength(OnlineProblem.values.length));
  });
}
