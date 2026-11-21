import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:sineobex_field/features/forms/problem_field.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A diagnosis (forms 2.2 `problem`, 2.3): searched on the phone's own problem code list, offline,
/// and stored as its code and its label at the field's path. A code on phase 3's sensitive list is
/// marked as the problem list marks it.
void main() {
  final general = presetDefinition('general_primary_care');
  final diagnosis = presetField('general_primary_care', 'problems.diagnosis') as ProblemDef;
  const path = 'problems.e0000001.diagnosis';
  const box = ValueKey('phi.form.diagnosis');

  // From the bundled list: one ordinary code and one on the sensitive list.
  const scalp = (code: 'S01.01XA', title: 'Laceration without foreign body of scalp, initial encounter');
  const syphilis = (code: 'A53.9', title: 'Syphilis, unspecified');

  /// Opens the diagnosis with its two parts held as the form holds them, every change drawn again.
  Future<TestAnswers> open(WidgetTester tester, {Map<String, Object?>? values, bool enabled = true, Run? run}) async {
    final answers = TestAnswers(values);
    await pumpField(
      tester,
      answering(
        answers,
        () => ProblemField(
          field: diagnosis,
          value: problemAnswer((part) => answers.values['$path.$part']),
          onChanged: (v) {
            answers.change('$path.code', v.code);
            answers.change('$path.label', v.label);
          },
          enabled: enabled,
        ),
      ),
      run: run,
    );
    return answers;
  }

  Future<void> search(WidgetTester tester, String words) async {
    await tester.enterText(find.byKey(box), words);
    await tester.pumpAndSettle();
  }

  String spoken(({String code, String title}) c, {bool sensitive = false}) =>
      '${c.title}, code ${c.code}${sensitive ? ', sensitive' : ''}';

  Future<void> pick(WidgetTester tester, String label) async {
    await tester.ensureVisible(find.bySemanticsLabel(label));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel(label));
    await tester.pumpAndSettle();
  }

  forEachRun('the search, its matches and a picked diagnosis', (tester, run) async {
    await open(tester, run: run);
    expect(tester.getSemantics(find.byKey(box)), isSemantics(label: diagnosis.label, isTextField: true));
    await expectFieldOk(tester);

    await search(tester, 'syphilis');
    expect(controlNamed(tester, spoken(syphilis, sensitive: true)), isSemantics(isButton: true, hasTapAction: true));
    await expectFieldOk(tester);

    await pick(tester, spoken(syphilis, sensitive: true));
    expect(find.text('${syphilis.title} (${syphilis.code})'), findsOneWidget);
    expect(controlNamed(tester, 'Remove ${syphilis.title}'), isSemantics(isButton: true, hasTapAction: true));
    await expectFieldOk(tester);
  });

  forEachRun('a finished note shows the diagnosis read-only', (tester, run) async {
    await open(tester, values: {'$path.code': syphilis.code, '$path.label': syphilis.title}, enabled: false, run: run);
    expect(find.byKey(box), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Remove')), findsNothing);
    expect(
      controlNamed(tester, diagnosis.label),
      isSemantics(value: '${syphilis.title} (${syphilis.code})', isReadOnly: true, hasEnabledState: true),
    );
    expect(find.bySemanticsLabel('Sensitive'), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('a match found by word is stored as its code and its label', (tester) async {
    final answers = await open(tester);
    await search(tester, 'laceration scalp');
    await pick(tester, spoken(scalp));
    expect(answers.changes, [('$path.code', scalp.code), ('$path.label', scalp.title)]);
    for (final (p, v) in answers.changes) {
      expect(checkAnswer(general, p, v), isNull, reason: p);
    }
    // What was typed to search is not kept: it is not an answer, and an empty search follows Remove.
    expect(find.byKey(box), findsNothing);
    await tester.tap(find.bySemanticsLabel('Remove ${scalp.title}'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byKey(box)).controller!.text, isEmpty);
  });

  testWidgets('a code is found by its first characters, with or without its dot', (tester) async {
    await open(tester);
    await search(tester, 'S01.01');
    expect(find.bySemanticsLabel(spoken(scalp)), findsOneWidget);
    await search(tester, 's0101');
    expect(find.bySemanticsLabel(spoken(scalp)), findsOneWidget);
  });

  testWidgets('at most eight matches are listed', (tester) async {
    await open(tester);
    await search(tester, 'laceration');
    final rows = find.bySemanticsLabel(RegExp(r', code [A-Z0-9.]+(, sensitive)?$'));
    expect(rows, findsNWidgets(problemMatchLimit));
    expect(bundledProblemCodes.search('laceration', limit: 100).length, greaterThan(problemMatchLimit));
  });

  testWidgets('a code on the sensitive list is marked Sensitive, as the problem list marks it', (tester) async {
    final answers = await open(tester);
    await search(tester, 'syphilis');
    expect(find.bySemanticsLabel(spoken(syphilis, sensitive: true)), findsOneWidget);
    expect(find.text('Sensitive'), findsOneWidget);
    await pick(tester, spoken(syphilis, sensitive: true));
    expect(answers.values['$path.code'], syphilis.code);
    expect(find.bySemanticsLabel('Sensitive'), findsOneWidget);
    expect(find.byIcon(LucideIcons.lock), findsOneWidget);
  });

  testWidgets('an ordinary code is not marked', (tester) async {
    await open(tester);
    await search(tester, 'laceration scalp');
    expect(find.text('Sensitive'), findsNothing);
    await pick(tester, spoken(scalp));
    expect(find.bySemanticsLabel('Sensitive'), findsNothing);
  });

  testWidgets('only the code decides: a stored code on the sensitive list is marked, a label alone is not', (
    tester,
  ) async {
    // A code this phone's list doesn't hold (a newer list on another phone), inside a sensitive range.
    await open(tester, values: {'$path.code': 'F11.20', '$path.label': 'Demo problem'});
    expect(find.text('Demo problem (F11.20)'), findsOneWidget);
    expect(find.bySemanticsLabel('Sensitive'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());

    await open(tester, values: {'$path.label': 'Demo: opioid use'});
    expect(find.text('Demo: opioid use'), findsOneWidget);
    expect(find.bySemanticsLabel('Sensitive'), findsNothing);
  });

  testWidgets('Remove clears the code and the label, and the search is back', (tester) async {
    final answers = await open(tester, values: {'$path.code': scalp.code, '$path.label': scalp.title});
    expect(find.byKey(box), findsNothing);
    await tester.tap(find.bySemanticsLabel('Remove ${scalp.title}'));
    await tester.pumpAndSettle();
    expect(answers.changes, [('$path.code', null), ('$path.label', null)]);
    expect(find.byKey(box), findsOneWidget);
  });

  testWidgets('a value changed elsewhere is shown', (tester) async {
    final answers = await open(tester);
    answers
      ..change('$path.code', scalp.code)
      ..change('$path.label', scalp.title);
    await tester.pumpAndSettle();
    expect(find.text('${scalp.title} (${scalp.code})'), findsOneWidget);
    expect(find.byKey(box), findsNothing);
  });

  testWidgets('no match says so, and nothing is stored', (tester) async {
    final answers = await open(tester);
    await search(tester, 'zzqq');
    expect(find.text('No code on this phone’s list matches.'), findsOneWidget);
    expect(answers.changes, isEmpty);
  });

  test('a stored problem written out as the read view writes it', () {
    expect(problemText((code: 'S01.01XA', label: 'Demo scalp')), 'Demo scalp (S01.01XA)');
    expect(problemText((code: null, label: 'Demo scalp')), 'Demo scalp');
    expect(problemText((code: 'S01.01XA', label: null)), 'S01.01XA');
    expect(problemText((code: null, label: null)), isNull);
    expect(problemAnswer((part) => {'code': 'S01.01XA', 'label': 7}[part]), (code: 'S01.01XA', label: null));
  });
}
