import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/note_form.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// Expand on a quick form (forms 6.4; card F7-expand-control): at the top of a part, a button that
/// asks the screen to carry the part's answers into its full note type. The form offers it only
/// where the screen gives it something to do, and only while the note can be changed.
void main() {
  final quick = presetDefinition('quick_encounter');
  const parts = {
    'visit.parts': ['general', 'wound'],
    'general.hr': 96,
  };

  /// The quick form, with [expand] as the screen's Expands.
  Future<TestAnswers> open(WidgetTester tester, {ExpandHandler? expand, bool enabled = true, Run? run}) async {
    final answers = TestAnswers(parts);
    await pumpField(
      tester,
      answering(
        answers,
        () => NoteForm(
          definition: quick,
          answers: answers.values,
          onChanged: answers.change,
          expand: expand,
          enabled: enabled,
          openSection: 'general',
        ),
      ),
      run: run,
    );
    return answers;
  }

  /// The screen's Expands: General into General / primary care, Wound into Wound care.
  ExpandHandler offering(void Function(String into) onPressed) =>
      (SectionDef section) => [
        if (section.id == 'general')
          ExpandOffer(into: 'General / primary care', onPressed: () => onPressed('general_primary_care')),
        if (section.id == 'wound') ExpandOffer(into: 'Wound care', onPressed: () => onPressed('wound_care')),
      ];

  Finder expandOf(String part, String into) => find.bySemanticsLabel('Expand $part into $into');

  Future<void> tap(WidgetTester tester, Finder found) async {
    await tester.ensureVisible(found);
    await tester.pumpAndSettle();
    await tester.tap(found);
    await tester.pumpAndSettle();
  }

  forEachRun('a part of a quick form offers Expand into its full note type, labelled', (tester, run) async {
    await open(tester, expand: offering((_) {}), run: run);
    expect(
      controlNamed(tester, 'Expand General into General / primary care'),
      isSemantics(isButton: true, hasTapAction: true, hasEnabledState: true, isEnabled: true),
    );
    expect(find.text('Expand into General / primary care'), findsOneWidget);
    expect(find.text('Its answers are copied into a full note. This quick note keeps them.'), findsOneWidget);
    await expectFieldOk(tester);
    await toggleSection(tester, 'wound');
    expect(controlNamed(tester, 'Expand Wound into Wound care'), isSemantics(isButton: true, hasTapAction: true));
    await expectFieldOk(tester);
  }, over: formRuns);

  testWidgets('a tap asks the screen once, and a second tap while it runs does nothing', (tester) async {
    final handle = tester.ensureSemantics();
    final asked = <String>[];
    var running = Completer<void>();
    List<ExpandOffer> expand(SectionDef section) => [
      if (section.id == 'general')
        ExpandOffer(
          into: 'General / primary care',
          onPressed: () {
            asked.add(section.id);
            return running.future;
          },
        ),
    ];
    final answers = await open(tester, expand: expand);
    final button = expandOf('General', 'General / primary care');
    await tap(tester, button);
    await tap(tester, button);
    expect(asked, ['general']);
    expect(tester.getSemantics(button), isSemantics(isButton: true, hasEnabledState: true, isEnabled: false));
    running.complete();
    await tester.pumpAndSettle();
    running = Completer<void>()..complete();
    await tap(tester, button);
    expect(asked, ['general', 'general']);
    // Expand writes nothing through the form: the screen's domain layer writes the full note.
    expect(answers.changes, isEmpty);
    handle.dispose();
  });

  testWidgets('no Expand on a read-only form, on a part the screen offers none, or without a screen', (tester) async {
    final handle = tester.ensureSemantics();
    await open(tester, expand: offering((_) {}), enabled: false);
    expect(find.bySemanticsLabel(RegExp('^Expand ')), findsNothing);

    await open(tester);
    expect(find.bySemanticsLabel(RegExp('^Expand ')), findsNothing);

    await open(tester, expand: offering((_) {}));
    await toggleSection(tester, 'visit');
    expect(find.bySemanticsLabel(RegExp('^Expand ')), findsNothing);
    handle.dispose();
  });
}
