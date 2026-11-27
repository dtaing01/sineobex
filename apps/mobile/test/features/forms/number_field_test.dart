import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/number_field.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A number (forms 2.2 `number`, 8.2): a box with the numeric keyboard and its unit, saved as typing
/// pauses; a value outside the range is not saved and the line under it says the range; with a
/// second unit, a two-way switch, and the answer stored in the base unit; a stepper where the
/// definition asks for one; "out of N" for a score.
void main() {
  final temp = presetField('general_primary_care', 'vitals.temp') as NumberDef;
  final systolic = presetField('general_primary_care', 'vitals.bp.systolic') as NumberDef;
  final pain = presetField('general_primary_care', 'vitals.pain') as NumberDef;
  final length = presetField('wound_care', 'wound.measurements.length') as NumberDef;
  final doses = presetField('harm_reduction', 'provided.naloxone_doses') as NumberDef;
  final primaryCare = presetDefinition('general_primary_care');

  Finder box(NumberDef f) => find.byKey(ValueKey('phi.form.${f.id}'));

  /// Opens [field] as the form holds it: each change is drawn again.
  Future<TestAnswers> open(WidgetTester tester, NumberDef field, {num? value, bool enabled = true, Run? run}) async {
    final answers = TestAnswers({'x': value});
    await pumpField(
      tester,
      answering(
        answers,
        () => NumberField(
          field: field,
          value: answers.values['x'] as num?,
          onChanged: (v) => answers.change('x', v),
          enabled: enabled,
        ),
      ),
      run: run,
    );
    return answers;
  }

  List<Object?> saved(TestAnswers answers) => [for (final (_, v) in answers.changes) v];

  Future<void> type(WidgetTester tester, NumberDef f, String text) async {
    await tester.enterText(box(f), text);
    await tester.pump(typingPause);
  }

  forEachRun('a box with the numeric keyboard, its label and its unit', (tester, run) async {
    await open(tester, temp, value: 98.6, run: run);
    final input = tester.widget<TextField>(box(temp));
    expect(input.keyboardType, const TextInputType.numberWithOptions(decimal: true));
    expect(input.controller!.text, '98.6');
    expect(find.text('°F'), findsOneWidget);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Temperature')),
      isSemantics(label: 'Temperature', isTextField: true, hasTapAction: true),
    );
    // The unit is read too, after the box.
    expect(find.bySemanticsLabel('°F'), findsOneWidget);
    await expectFieldOk(tester);
  });

  testWidgets('a whole number has the keyboard without a decimal point', (tester) async {
    await open(tester, systolic);
    expect(tester.widget<TextField>(box(systolic)).keyboardType, TextInputType.number);
  });

  testWidgets('saves once typing pauses, a whole number as one', (tester) async {
    final answers = await open(tester, temp);
    await tester.enterText(box(temp), '98.');
    await tester.pump(typingPause ~/ 2);
    await tester.enterText(box(temp), '98.6');
    await tester.pump(typingPause ~/ 2);
    expect(answers.changes, isEmpty);
    await tester.pump(typingPause);
    await type(tester, temp, '99');
    expect(saved(answers), [98.6, 99]);
    expect(saved(answers).last, isA<int>());
    for (final v in saved(answers)) {
      expect(checkAnswer(primaryCare, 'vitals.e0000001.temp', v), isNull);
    }
  });

  testWidgets('a comma is taken as the decimal point', (tester) async {
    final answers = await open(tester, temp);
    await type(tester, temp, '98,6');
    expect(saved(answers), [98.6]);
  });

  testWidgets('an empty box clears the answer', (tester) async {
    final answers = await open(tester, temp, value: 98.6);
    await type(tester, temp, '  ');
    expect(saved(answers), [null]);
  });

  forEachRun('out of the range it is not saved, and the line under it says the range', (tester, run) async {
    final answers = await open(tester, temp, value: 98.6, run: run);
    const line = 'It must be from 50 to 115 °F.';
    await type(tester, temp, '120');
    expect(find.text(line), findsOneWidget);
    expect(tester.getSemantics(find.text(line)), isSemantics(isLiveRegion: true));
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump();
    expect(answers.changes, isEmpty);
    await expectFieldOk(tester);
    // The bounds are in it.
    await type(tester, temp, '115');
    expect(find.text(line), findsNothing);
    await type(tester, temp, '50');
    await type(tester, temp, '49.9');
    expect(find.text(line), findsOneWidget);
    expect(saved(answers), [115, 50]);
  });

  testWidgets('typed one key at a time, nothing is said until typing pauses', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await open(tester, temp);
    Iterable<String> live() => [
      for (final e in find.byType(Text).evaluate())
        if (tester.getSemantics(find.byWidget(e.widget)).flagsCollection.isLiveRegion) (e.widget as Text).data!,
    ];
    // 9 alone is out of the range, as is 1 and 12 on the way to 120: none is said while typing.
    for (final keys in ['9', '98', '98.', '98.6', '9', '1', '12']) {
      await tester.enterText(box(temp), keys);
      await tester.pump(typingPause ~/ 3);
      expect(live(), isEmpty, reason: keys);
      expect(find.textContaining('It must be from'), findsNothing, reason: keys);
    }
    await tester.enterText(box(temp), '120');
    await tester.pump(typingPause);
    expect(live(), ['It must be from 50 to 115 °F.']);
    // Typed right again, the line goes at once.
    await tester.enterText(box(temp), '12');
    await tester.pump(typingPause ~/ 3);
    expect(live(), ['It must be from 50 to 115 °F.']);
    await tester.enterText(box(temp), '102');
    await tester.pump();
    expect(live(), isEmpty);
    await tester.pump(typingPause);
    // Leaving the box says it at once, as it saves at once.
    await tester.enterText(box(temp), '-');
    await tester.pump();
    expect(live(), isEmpty);
    FocusManager.instance.primaryFocus!.unfocus();
    // The focus change is told after the frame, and the line drawn in the next.
    await tester.pump();
    await tester.pump();
    expect(live(), ['Type a number.']);
    expect(saved(answers), [102]);
    handle.dispose();
  });

  testWidgets('a trailing zero past the field’s decimals is not counted', (tester) async {
    final wound = await open(tester, length);
    await type(tester, length, '2.50');
    expect(find.text('Type at most 1 decimal place.'), findsNothing);
    expect(saved(wound), [2.5]);
    expect(checkAnswer(presetDefinition('wound_care'), 'wound.e0000001.measurements.length', 2.5), isNull);
    final bp = await open(tester, systolic);
    await type(tester, systolic, '120.00');
    expect(saved(bp), [120]);
    expect(saved(bp).single, isA<int>());
    await type(tester, systolic, '120.50');
    expect(find.text('Type a whole number.'), findsOneWidget);
    expect(saved(bp), [120]);
  });

  testWidgets('more decimals than the field keeps are not saved', (tester) async {
    final answers = await open(tester, temp);
    await type(tester, temp, '98.65');
    expect(find.text('Type at most 1 decimal place.'), findsOneWidget);
    expect(answers.changes, isEmpty);
    final bp = await open(tester, systolic);
    await type(tester, systolic, '120.5');
    expect(find.text('Type a whole number.'), findsOneWidget);
    expect(bp.changes, isEmpty);
  });

  testWidgets('what isn’t a number is not saved', (tester) async {
    final answers = await open(tester, temp);
    for (final text in ['abc', '9 8', '98.6.1', '-']) {
      await type(tester, temp, text);
      expect(find.text('Type a number.'), findsOneWidget, reason: text);
    }
    expect(answers.changes, isEmpty);
  });

  testWidgets('leaving the box saves at once, and so does leaving the screen', (tester) async {
    final answers = await open(tester, temp);
    await tester.enterText(box(temp), '97.5');
    FocusManager.instance.primaryFocus!.unfocus();
    await tester.pump();
    expect(saved(answers), [97.5]);
    await tester.enterText(box(temp), '97.7');
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(saved(answers), [97.5, 97.7]);
  });

  testWidgets('a value changed elsewhere is shown, unless they are typing over it', (tester) async {
    final answers = await open(tester, temp, value: 98.6);
    answers.change('x', 99.1);
    await tester.pump();
    expect(tester.widget<TextField>(box(temp)).controller!.text, '99.1');
    await tester.enterText(box(temp), '100.');
    answers.change('x', 98.2);
    await tester.pump();
    expect(tester.widget<TextField>(box(temp)).controller!.text, '100.');
  });

  group('a second unit', () {
    Finder unit(String u) => find.bySemanticsLabel(u);

    forEachRun('a two-way switch beside the box, the base unit picked', (tester, run) async {
      await open(tester, length, value: 5.1, run: run);
      expect(
        tester.getSemantics(unit('cm').last),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: true),
      );
      expect(
        tester.getSemantics(unit('in').last),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: false),
      );
      await tester.tap(unit('in').last);
      await tester.pumpAndSettle();
      expect(tester.getSemantics(unit('in').last), isSemantics(isSelected: true, hasSelectedState: true));
      await expectFieldOk(tester);
    });

    testWidgets('typed in the second unit, it is stored in the base unit', (tester) async {
      final answers = await open(tester, length);
      await tester.tap(unit('in').last);
      await tester.pumpAndSettle();
      await type(tester, length, '2');
      expect(saved(answers), [5.1]);
      expect(find.text('Saved as 5.1 cm.'), findsOneWidget);
      expect(checkAnswer(presetDefinition('wound_care'), 'wound.e0000001.measurements.length', 5.1), isNull);
    });

    testWidgets('switching shows the same answer in the other unit and saves nothing', (tester) async {
      final answers = await open(tester, length, value: 5.1);
      await tester.tap(unit('in').last);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(box(length)).controller!.text, '2.01');
      await tester.pump(typingPause);
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
      await tester.tap(unit('cm').last);
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(box(length)).controller!.text, '5.1');
      expect(answers.changes, isEmpty);
    });

    testWidgets('the range is said in the base unit', (tester) async {
      final answers = await open(tester, length);
      await tester.tap(unit('in').last);
      await tester.pumpAndSettle();
      await type(tester, length, '40');
      expect(find.text('It must be from 0.1 to 100 cm.'), findsOneWidget);
      expect(answers.changes, isEmpty);
    });
  });

  group('a stepper', () {
    Finder more() => find.bySemanticsLabel('One more');
    Finder fewer() => find.bySemanticsLabel('One fewer');

    forEachRun('one fewer and one more beside the box', (tester, run) async {
      await open(tester, doses, value: 2, run: run);
      expect(tester.getSemantics(more()), isSemantics(isButton: true, hasTapAction: true, isEnabled: true, value: '2'));
      expect(
        tester.getSemantics(fewer()),
        isSemantics(isButton: true, hasTapAction: true, isEnabled: true, value: '2'),
      );
      expect(find.text('doses'), findsOneWidget);
      await expectFieldOk(tester);
    });

    testWidgets('starts at the least, steps by one, and saves once tapping pauses', (tester) async {
      final answers = await open(tester, doses);
      expect(tester.getSemantics(fewer()), isSemantics(isButton: true, hasEnabledState: true, isEnabled: false));
      for (var i = 0; i < 3; i++) {
        await tester.tap(more());
        await tester.pump();
      }
      expect(tester.widget<TextField>(box(doses)).controller!.text, '3');
      await tester.tap(fewer());
      await tester.pump(typingPause);
      expect(saved(answers), [2]);
    });

    testWidgets('stops at the least and the most', (tester) async {
      await open(tester, doses, value: 1);
      expect(tester.getSemantics(fewer()), isSemantics(hasEnabledState: true, isEnabled: false));
      await open(tester, doses, value: 20);
      expect(tester.getSemantics(more()), isSemantics(hasEnabledState: true, isEnabled: false));
      expect(tester.getSemantics(fewer()), isSemantics(hasEnabledState: true, isEnabled: true));
    });

    testWidgets('a screen reader’s tap steps as a finger’s does', (tester) async {
      final handle = tester.ensureSemantics();
      final answers = await open(tester, doses, value: 4);
      tester.semantics.tap(find.semantics.byLabel('One more'));
      await tester.pump(typingPause);
      expect(saved(answers), [5]);
      handle.dispose();
    });

    testWidgets('only where the definition asks for one', (tester) async {
      await open(tester, temp);
      expect(more(), findsNothing);
    });
  });

  forEachRun('a score is shown out of its most', (tester, run) async {
    final answers = await open(tester, pain, value: 7, run: run);
    expect(find.text('out of 10'), findsOneWidget);
    expect(tester.getSemantics(find.bySemanticsLabel('Pain')), isSemantics(label: 'Pain', isTextField: true));
    expect(find.bySemanticsLabel('out of 10'), findsOneWidget);
    await type(tester, pain, '11');
    expect(find.text('It must be from 0 to 10.'), findsOneWidget);
    expect(answers.changes, isEmpty);
    await expectFieldOk(tester);
  });

  forEachRun('disabled, it is read-only, says so, and stays readable', (tester, run) async {
    for (final (field, value, written) in [(temp, 98.6, '98.6 °F'), (pain, 7, '7 of 10'), (doses, 2, '2 doses')]) {
      final answers = await open(tester, field, value: value, enabled: false, run: run);
      expect(find.byType(TextField), findsNothing);
      expect(find.bySemanticsLabel('One more'), findsNothing);
      expect(
        tester.getSemantics(find.bySemanticsLabel(field.label)),
        isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: written),
      );
      expect(answers.changes, isEmpty);
      await expectFieldOk(tester);
    }
  });
}
