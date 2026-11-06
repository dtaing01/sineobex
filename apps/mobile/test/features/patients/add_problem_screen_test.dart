import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/add_problem_screen.dart';
import 'package:sineobex_field/patients/problems.dart' show ProblemCodes;
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// Add problem (design 9.5, 12.1): code results from the bundled list as labelled buttons, the
/// status chips with nothing chosen, "No code" allowed and explained, a sensitive code locking
/// Sensitive on, and the recurrence question. Three themes, 200% text and 320 wide; offline.
void main() {
  Future<AppHarness> addProblem(WidgetTester tester, {Run? run, void Function(AppHarness h)? seed}) async {
    final h = await signIn(tester, theme: run?.theme, scale: run?.scale ?? 1, narrow: run?.narrow ?? false);
    seedP1(h.server);
    seed?.call(h);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    h.server.offline = true;
    await tapOn(tester, find.text('Add problem'));
    expect(find.byType(AddProblemScreen), findsOneWidget);
    return h;
  }

  Map<String, Object?> created(AppHarness h) =>
      h.sync.store!.outbox().lastWhere((e) => e.entity == entityProblem && e.op == 'create').value!
          as Map<String, Object?>;

  for (final run in runs) {
    testWidgets('a coded problem from the list; status chips start empty (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await addProblem(tester, run: run);
      await expectShown(
        tester,
        find.text(
          'No code is fine: the problem is saved without one. A problem with no code won’t add supplies to '
          'route bags.',
        ),
      );
      for (final status in ['New', 'Ongoing']) {
        final chip = find.bySemanticsLabel(status);
        await reveal(tester, chip);
        expect(tester.getSemantics(chip), isSemantics(isInMutuallyExclusiveGroup: true, isSelected: false));
      }
      expect(find.text('Resolved'), findsNothing);
      await expectScreenOk(tester);

      await type(tester, 'codeSearch', 'burn left forearm first');
      await settle(tester);
      final result = find.bySemanticsLabel('Burn of first degree of left forearm, initial encounter, code T22.112A');
      await expectShown(tester, result);
      expect(tester.getSemantics(result), isSemantics(isButton: true));
      await expectScreenOk(tester);
      await tapOn(tester, result);
      expect(
        (await fieldNamed(tester, 'problemTitle')).controller!.text,
        'Burn of first degree of left forearm, initial encounter',
      );

      // Without a status, Add problem says what is missing.
      await tapOn(tester, find.widgetWithText(FilledButton, 'Add problem'));
      await expectShown(tester, find.text('Choose New or Ongoing.'));
      await tapOn(tester, find.text('Ongoing'));
      await tapOn(tester, find.widgetWithText(FilledButton, 'Add problem'));
      final value = created(h);
      expect(value['status'], 'ongoing');
      expect(value['code'], {
        'system': 'icd10cm',
        'code': 'T22.112A',
        'display': 'Burn of first degree of left forearm, initial encounter',
      });
      expect(value['sensitive'], isFalse);
      handle.dispose();
    });
  }

  testWidgets('the curated list ships as an asset the app can load', (tester) async {
    final codes = await tester.runAsync(ProblemCodes.load);
    expect(codes!.codes.length, greaterThan(400));
    expect(codes.search('T22.112A').single.title, 'Burn of first degree of left forearm, initial encounter');
  });

  testWidgets('a sensitive code turns Sensitive on and locks it', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await addProblem(tester);
    await type(tester, 'codeSearch', 'F10');
    await settle(tester);
    await tapOn(tester, find.bySemanticsLabel(RegExp(r', code F10')).first);
    final sensitive = tester.widget<SwitchListTile>(find.widgetWithText(SwitchListTile, 'Sensitive'));
    expect(sensitive.value, isTrue);
    expect(sensitive.onChanged, isNull);
    await expectShown(tester, find.text('This code is always sensitive.'));
    await tapOn(tester, find.text('New'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Add problem'));
    expect(created(h)['sensitive'], isTrue);
    handle.dispose();
  });

  testWidgets('a title matching a Resolved problem asks whether it came back', (tester) async {
    final handle = tester.ensureSemantics();
    late String earlier;
    final h = await addProblem(
      tester,
      seed: (h) {
        earlier = h.server.seed(entityProblem, {'patientId': p1Id, 'title': 'Demo: cough', 'status': 'new'});
        h.server.serverEdit(earlier, 'status', {'status': 'resolved', 'encounterId': null}, by: 'seed-user');
      },
    );
    await type(tester, 'problemTitle', 'demo cough');
    await expectShown(tester, find.text('Is this the same problem coming back?'));
    await tapOn(tester, find.text('New'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Add problem'));
    await expectShown(tester, find.text('Answer whether this is the same problem coming back.'));
    await tapOn(tester, find.text('Yes, it came back'));
    await tapOn(tester, find.widgetWithText(FilledButton, 'Add problem'));
    expect(created(h)['recurrenceOf'], earlier);
    await expectScreenOk(tester);
    handle.dispose();
  });
}
