import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/note_form.dart';
import 'package:sineobex_field/features/forms/problem_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// **Add to the problem list** under a picked diagnosis (lifecycle 8.3; card F7-problem-button):
/// offered where the screen gives it through a [ProblemListScope], at the status the note gives,
/// or New or Ongoing as the person chooses; "On the problem list" once it is there. The widget
/// stores nothing for it: the screen's domain layer adds the problem (`addToProblemList`).
void main() {
  final general = presetDefinition('general_primary_care');
  final diagnosis = presetField('general_primary_care', 'problems.diagnosis') as ProblemDef;
  const path = 'problems.e0000001.diagnosis';
  const scalp = (code: 'S01.01XA', title: 'Laceration without foreign body of scalp, initial encounter');
  const addLabel = 'Add ${'Laceration without foreign body of scalp, initial encounter'} to the problem list';

  /// A picked diagnosis on its own, with [handler] as the screen's.
  Future<void> open(WidgetTester tester, {ProblemListHandler? handler, bool enabled = true, Run? run}) async {
    final answers = TestAnswers({'$path.code': scalp.code, '$path.label': scalp.title});
    Widget field() => ProblemField(
      field: diagnosis,
      value: problemAnswer((part) => answers.values['$path.$part']),
      onChanged: (v) {
        answers.change('$path.code', v.code);
        answers.change('$path.label', v.label);
      },
      enabled: enabled,
      path: path,
    );
    await pumpField(
      tester,
      answering(answers, () => handler == null ? field() : ProblemListScope(handler: handler, child: field())),
      run: run,
    );
  }

  Future<void> tap(WidgetTester tester, Finder found) async {
    await tester.ensureVisible(found);
    await tester.pumpAndSettle();
    await tester.tap(found);
    await tester.pumpAndSettle();
  }

  forEachRun('a picked diagnosis offers Add to the problem list, then says it is there', (tester, run) async {
    final added = <String>[];
    final listed = ValueNotifier(false);
    await open(
      tester,
      run: run,
      handler: (at, d) => listed.value
          ? const ProblemListOffer.listed()
          : ProblemListOffer.add(status: 'ongoing', onAdd: (status) => added.add(status)),
    );
    expect(controlNamed(tester, addLabel), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
    expect(find.text('Add to the problem list'), findsOneWidget);
    await expectFieldOk(tester);
    await tap(tester, find.bySemanticsLabel(addLabel));
    expect(added, ['ongoing']);

    listed.value = true;
    await open(tester, run: run, handler: (at, d) => const ProblemListOffer.listed());
    expect(find.bySemanticsLabel(addLabel), findsNothing);
    expect(find.bySemanticsLabel('On the problem list'), findsOneWidget);
    await expectFieldOk(tester);
  }, over: formRuns);

  forEachRun('with no status from the note, the person chooses New or Ongoing', (tester, run) async {
    final added = <String>[];
    await open(
      tester,
      run: run,
      handler: (at, d) => ProblemListOffer.add(onAdd: added.add),
    );
    await tap(tester, find.bySemanticsLabel(addLabel));
    expect(find.text('Add as New or Ongoing?'), findsOneWidget);
    await expectFieldOk(tester);
    await tap(tester, find.text('Cancel'));
    expect(added, isEmpty);
    await tap(tester, find.bySemanticsLabel(addLabel));
    await tap(tester, find.text('New'));
    await tap(tester, find.bySemanticsLabel(addLabel));
    await tap(tester, find.text('Ongoing'));
    expect(added, ['new', 'ongoing']);
  }, over: formRuns);

  testWidgets('one tap adds one problem: a second tap while it is being added does nothing', (tester) async {
    final handle = tester.ensureSemantics();
    final added = <String>[];
    final adding = Completer<void>();
    await open(
      tester,
      handler: (at, d) => ProblemListOffer.add(
        status: 'new',
        onAdd: (status) {
          added.add(status);
          return adding.future;
        },
      ),
    );
    await tap(tester, find.bySemanticsLabel(addLabel));
    await tap(tester, find.bySemanticsLabel(addLabel));
    expect(added, ['new']);
    expect(controlNamed(tester, addLabel), isSemantics(isButton: true, hasEnabledState: true, isEnabled: false));
    adding.complete();
    await tester.pumpAndSettle();
    expect(controlNamed(tester, addLabel), isSemantics(isButton: true, hasEnabledState: true, isEnabled: true));
    handle.dispose();
  });

  testWidgets('nothing offered on a read-only note, without the screen’s offer, or before a pick', (tester) async {
    final handle = tester.ensureSemantics();
    ProblemListOffer offer(String at, ProblemAnswer d) => ProblemListOffer.add(status: 'new', onAdd: (_) {});
    await open(tester, handler: offer, enabled: false);
    expect(find.text('Add to the problem list'), findsNothing);
    await open(tester);
    expect(find.text('Add to the problem list'), findsNothing);
    await open(tester, handler: (at, d) => null);
    expect(find.text('Add to the problem list'), findsNothing);
    // Removed, the search shows again, and nothing under it.
    await open(tester, handler: offer);
    await tap(tester, find.bySemanticsLabel('Remove ${scalp.title}'));
    expect(find.text('Add to the problem list'), findsNothing);
    handle.dispose();
  });

  testWidgets('in a note form, the screen is asked with the diagnosis’s whole path', (tester) async {
    final handle = tester.ensureSemantics();
    final asked = <(String, String?)>[];
    final answers = TestAnswers({
      'problems.e0000001.entryAt': '2026-10-20T15:01:00.000Z',
      '$path.code': scalp.code,
      '$path.label': scalp.title,
    });
    await pumpField(
      tester,
      answering(
        answers,
        () => ProblemListScope(
          handler: (at, d) {
            asked.add((at, d.code));
            return const ProblemListOffer.listed();
          },
          child: NoteForm(
            definition: general,
            answers: answers.values,
            onChanged: answers.change,
            openSection: 'problems',
          ),
        ),
      ),
    );
    expect(asked.toSet(), {(path, scalp.code)});
    expect(find.bySemanticsLabel('On the problem list'), findsOneWidget);
    handle.dispose();
  });
}
