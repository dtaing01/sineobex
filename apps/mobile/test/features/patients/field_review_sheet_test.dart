import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FieldReviewView;
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/features/patients/field_review_sheet.dart';

import 'patient_kit.dart';

/// "Which is right?" (design 3.2, 12.1): each value a radio card labelled with the value, who and
/// when; Save choice online only, disabled offline with the reason; identity reviews say a Program
/// Admin will check them and offer no choice. Three themes, 200% text and 320 wide.
void main() {
  FieldReviewView review({String field = 'usualArea', String needs = 'patients.edit'}) => FieldReviewView.fromJson({
    'id': '5eed0e00-0000-4000-8000-000000000001',
    'patientId': p1Id,
    'field': field,
    'needs': needs,
    'current': {
      'value': field == 'birth' ? {'precision': 'day', 'date': '1946-03-07'} : 'Demo: by the river',
      'version': 2,
      'changedBy': 'c0000000-0000-4000-8000-0000000000c2',
      'changedAt': '2026-10-21T14:00:00Z',
    },
    'alternates': [
      {
        'historyId': '5eed0f00-0000-4000-8000-000000000001',
        'value': field == 'birth' ? {'precision': 'day', 'date': '1946-07-03'} : 'Demo: by the library steps',
        'by': {'userId': 'c0000000-0000-4000-8000-0000000000c1', 'displayName': 'Jordan Lee (demo)'},
        'deviceTime': '2026-10-20T10:00:00Z',
      },
    ],
    'openedAt': '2026-10-21T14:00:00Z',
    'status': 'open',
  });

  Future<List<(bool, String?)>> pumpSheet(
    WidgetTester tester, {
    required FieldReviewView r,
    required bool online,
    Run? run,
  }) async {
    usePhoneSize(tester);
    if (run?.narrow ?? false) tester.view.physicalSize = const Size(960, 1920);
    if ((run?.scale ?? 1) != 1) {
      tester.platformDispatcher.textScaleFactorTestValue = run!.scale;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    }
    final saved = <(bool, String?)>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: buildFieldTheme(run?.theme ?? FieldTheme.day),
        home: Scaffold(
          body: FieldReviewSheet(
            review: r,
            mayDecide: true,
            online: online,
            today: fixtureNow,
            onSave: (keep, historyId) async => saved.add((keep, historyId)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return saved;
  }

  for (final run in runs) {
    testWidgets('the values are a radio group, and Save choice sends the one chosen (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final saved = await pumpSheet(tester, r: review(), online: true, run: run);
      expect(find.text('Which is right?'), findsOneWidget);
      expect(tester.getSemantics(find.text('Which is right?')), isSemantics(isHeader: true));
      final current = find.bySemanticsLabel('Demo: by the river. On the chart now · Oct 21');
      final other = find.bySemanticsLabel('Demo: by the library steps. Recorded by Jordan Lee (demo) · Oct 20');
      for (final card in [current, other]) {
        await reveal(tester, card);
        expect(tester.getSemantics(card), isSemantics(isInMutuallyExclusiveGroup: true, isChecked: false));
      }
      final save = find.widgetWithText(FilledButton, 'Save choice');
      expect(tester.widget<FilledButton>(save).onPressed, isNull);
      await expectGuidelines(tester);

      await tester.tap(other);
      await tester.pumpAndSettle();
      expect(tester.getSemantics(other), isSemantics(isInMutuallyExclusiveGroup: true, isChecked: true));
      expect(tester.getSemantics(current), isSemantics(isChecked: false));
      await reveal(tester, save);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(saved, [(false, '5eed0f00-0000-4000-8000-000000000001')]);
      handle.dispose();
    });
  }

  testWidgets('offline, Save choice is off and says why', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpSheet(tester, r: review(), online: false);
    await tester.tap(find.bySemanticsLabel(RegExp('^Demo: by the library steps')));
    await tester.pumpAndSettle();
    expect(find.text('Connect to save a choice. Until then both values stay on the chart.'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save choice')).onPressed, isNull);
    await expectGuidelines(tester);
    handle.dispose();
  });

  testWidgets('an identity review is a Program Admin’s: no choice here', (tester) async {
    final handle = tester.ensureSemantics();
    await pumpSheet(
      tester,
      r: review(field: 'birth', needs: 'patients.correct_identity'),
      online: true,
    );
    expect(find.text('A Program Admin will check this.'), findsOneWidget);
    expect(find.text('Save choice'), findsNothing);
    final current = find.bySemanticsLabel(RegExp(r'^March 7, 1946 · age 80\. On the chart now'));
    expect(current, findsOneWidget);
    expect(tester.getSemantics(current), isSemantics(isEnabled: false));
    await expectGuidelines(tester);
    handle.dispose();
  });
}
