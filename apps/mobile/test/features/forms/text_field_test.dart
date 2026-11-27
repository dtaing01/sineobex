import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/text_field.dart';
import 'package:sineobex_field/forms/definition.dart';

import 'forms_test_helpers.dart';

/// A text answer (forms 2.2 `text`, 8.2): a private box, saved trimmed as typing pauses and when
/// the person leaves it, never longer than its `maxLength` in code points (2.3).
void main() {
  final concern = presetField('general_primary_care', 'reason.concern') as TextDef;
  final sputum = presetField('general_primary_care', 'pulmonary.sputum_color') as TextDef;
  final box = find.byKey(ValueKey('phi.form.${concern.id}'));

  Future<List<String?>> open(
    WidgetTester tester, {
    TextDef? field,
    String? value,
    bool enabled = true,
    Run? run,
    List<String?>? into,
  }) async {
    final changes = into ?? <String?>[];
    await pumpField(
      tester,
      NoteTextField(field: field ?? concern, value: value, onChanged: changes.add, enabled: enabled),
      run: run,
    );
    return changes;
  }

  forEachRun('a box of one line and a box of several, labelled and private', (tester, run) async {
    for (final field in [concern, sputum]) {
      await open(tester, field: field, value: 'Demo: worse at night', run: run);
      final input = find.byKey(ValueKey('phi.form.${field.id}'));
      expect(tester.getSemantics(input), isSemantics(label: field.label, isTextField: true, hasTapAction: true));
      expect(tester.widget<TextField>(input).maxLines, field.lines == 'one' ? 1 : 10);
      await expectFieldOk(tester);
    }
  });

  testWidgets('saves once typing pauses, not at each keystroke, and trimmed', (tester) async {
    final changes = await open(tester);
    await tester.enterText(box, 'Demo: co');
    await tester.pump(typingPause ~/ 2);
    await tester.enterText(box, '  Demo: cough  ');
    await tester.pump(typingPause ~/ 2);
    expect(changes, isEmpty);
    await tester.pump(typingPause);
    expect(changes, ['Demo: cough']);
  });

  testWidgets('a box of spaces clears the answer', (tester) async {
    final changes = await open(tester, value: 'Demo: cough');
    await tester.enterText(box, '   ');
    await tester.pump(typingPause);
    expect(changes, [null]);
  });

  testWidgets('leaving the box saves at once', (tester) async {
    final changes = await open(tester);
    await tester.enterText(box, 'Demo: cough');
    FocusManager.instance.primaryFocus!.unfocus();
    await tester.pump();
    expect(changes, ['Demo: cough']);
    await tester.pump(typingPause);
    expect(changes, ['Demo: cough'], reason: 'the pause saves nothing more');
  });

  testWidgets('Done saves a box of one line at once', (tester) async {
    final changes = await open(tester, field: sputum);
    await tester.enterText(find.byKey(ValueKey('phi.form.${sputum.id}')), 'Demo: green');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pump();
    expect(changes, ['Demo: green']);
  });

  testWidgets('what was typed is saved when the box leaves the screen (Save & Close while typing)', (tester) async {
    final changes = await open(tester);
    await tester.enterText(box, 'Demo: cough');
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    expect(changes, ['Demo: cough']);
  });

  testWidgets('what was typed is saved when the field turns read-only', (tester) async {
    final changes = await open(tester);
    await tester.enterText(box, 'Demo: cough');
    await open(tester, enabled: false, into: changes);
    await tester.pump();
    expect(changes, ['Demo: cough']);
  });

  testWidgets('counts code points, as the server does: an emoji with a skin tone is two', (tester) async {
    final five = fieldOf({'id': 'short', 'kind': 'text', 'lines': 'one', 'maxLength': 5, 'label': 'Demo: short'});
    final changes = await open(tester, field: five as TextDef);
    final input = find.byKey(const ValueKey('phi.form.short'));
    // Three thumbs with a skin tone: three characters on screen, six code points.
    await tester.enterText(input, '👍🏽👍🏽👍🏽');
    await tester.pump(typingPause);
    expect(tester.widget<TextField>(input).controller!.text.runes.length, 5);
    expect(changes.single!.runes.length, 5);
  });

  group('the counter is said once on crossing 90% and once at the limit, never per keystroke', () {
    List<String> liveLabels(WidgetTester tester) => [
      for (final node
          in find.semantics.byPredicate((n) => n.getSemanticsData().flagsCollection.isLiveRegion).evaluate())
        node.label,
    ];

    testWidgets('where the platform takes announcements (iOS)', (tester) async {
      final handle = tester.ensureSemantics();
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
        supportsAnnounce: true,
      );
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await open(tester);
      tester.takeAnnouncements();
      for (final n in [1700, 1800, 1801, 1802]) {
        await tester.enterText(box, 'a' * n);
        await tester.pump();
        expect(liveLabels(tester), isEmpty);
      }
      expect(find.text('1,802 of 2,000 characters'), findsOneWidget);
      expect(tester.takeAnnouncements().map((a) => a.message), ['Near the 2,000-character limit.']);
      await tester.enterText(box, 'a' * 2000);
      await tester.pump();
      expect(tester.takeAnnouncements().map((a) => a.message), ['At the 2,000-character limit: it can’t be longer.']);
      handle.dispose();
    });

    testWidgets('where it doesn’t (Android): the band line is the live region', (tester) async {
      final handle = tester.ensureSemantics();
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures();
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await open(tester);
      final live = <String>{};
      for (final n in [1800, 1801, 1802]) {
        await tester.enterText(box, 'a' * n);
        await tester.pump();
        live.addAll(liveLabels(tester));
      }
      expect(live, {'Near the 2,000-character limit.'});
      handle.dispose();
    });
  });

  testWidgets('a value changed elsewhere is shown, unless the person is typing over it', (tester) async {
    await open(tester, value: 'Demo: cough');
    await open(tester, value: 'Demo: cough at night');
    expect(find.text('Demo: cough at night'), findsOneWidget);
    await tester.enterText(box, 'Demo: wheeze');
    await open(tester, value: 'Demo: fever');
    expect(find.text('Demo: wheeze'), findsOneWidget);
  });

  forEachRun('disabled, it is read-only, says so, and stays readable', (tester, run) async {
    final changes = await open(tester, value: 'Demo: cough', enabled: false, run: run);
    expect(find.byType(TextField), findsNothing);
    expect(
      tester.getSemantics(find.bySemanticsLabel('Chief concern')),
      isSemantics(isReadOnly: true, hasEnabledState: true, isEnabled: false, value: 'Demo: cough'),
    );
    expect(changes, isEmpty);
    await expectFieldOk(tester);
  });
}
