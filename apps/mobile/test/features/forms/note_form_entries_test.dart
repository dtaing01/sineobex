import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/features/forms/note_form.dart';
import 'package:sineobex_field/forms/check_answer.dart';

import 'forms_test_helpers.dart';

/// The entries of a repeating section (forms 2.3; lifecycle 9.5): each titled by its place among
/// the entries that are there, with Add and Remove. Adding writes the new entry's `entryAt`, at an
/// ID made on the phone; removing writes its `entryRemoved`, and its answers stop counting.
void main() {
  final wound = presetDefinition('wound_care');
  final demo = definitionOf([
    {
      'id': 'tests',
      'title': 'Demo: tests',
      'repeat': {'max': 2, 'itemTitle': 'Test {n}'},
      'fields': [
        {'id': 'result', 'kind': 'text', 'label': 'Result', 'lines': 'one', 'maxLength': 50},
      ],
    },
  ]);
  const a = 'e0000001';
  const b = 'e0000002';
  const c = 'e0000003';

  forEachRun('each entry has its title and Remove, and the section has Add', (tester, run) async {
    await pumpForm(
      tester,
      wound,
      run: run,
      values: {'wound.$a.entryAt': '2026-11-17T10:00:00Z', 'wound.$b.entryAt': '2026-11-17T10:05:00Z'},
    );
    await expectFieldOk(tester);
    expect(find.text('Wound 1'), findsOneWidget);
    expect(find.text('Wound 2'), findsOneWidget);
    for (final label in ['Remove Wound 1', 'Remove Wound 2', 'Add wound']) {
      expect(controlNamed(tester, label), isSemantics(isButton: true, hasTapAction: true), reason: label);
    }
    // Each entry's fields are named by its title for a screen reader.
    expect(find.bySemanticsLabel('Wound 1'), findsOneWidget);
  });

  // Past 200%: iOS's accessibility text sizes go further.
  for (final Run run in [
    (theme: FieldTheme.day, scale: 3.0, narrow: false),
    (theme: FieldTheme.day, scale: 3.0, narrow: true),
  ]) {
    testWidgets('at 300% text an entry’s title and Remove fit${run.narrow ? ', 320 wide' : ''}', (tester) async {
      await pumpForm(tester, wound, run: run, values: {'wound.$a.entryAt': '2026-11-17T10:00:00Z'});
      expect(tester.takeException(), isNull);
      expect(find.text('Remove'), findsOneWidget);
      for (final r in tester.allRenderObjects.whereType<RenderFlex>()) {
        expect(r.toStringShort(), isNot(contains('OVERFLOWING')));
      }
    });
  }

  testWidgets('Add writes the new entry’s entryAt, at a new ID, and the entry shows', (tester) async {
    final answers = await pumpForm(
      tester,
      demo,
      newEntryId: () => c,
      // The phone's clock is local time; entryAt is UTC.
      clock: () => DateTime.utc(2026, 11, 17, 10, 30).toLocal(),
    );
    expect(find.text('No test added yet.'), findsOneWidget);
    await tester.tap(find.text('Add test'));
    await tester.pumpAndSettle();
    expect(answers.changes, [('tests.$c.entryAt', '2026-11-17T10:30:00.000Z')]);
    expect(checkAnswer(demo, 'tests.$c.entryAt', answers.values['tests.$c.entryAt']), isNull);
    expect(find.text('Test 1'), findsOneWidget);
    expect(fieldHost('tests.$c.result'), findsOneWidget);
    expect(find.text('No test added yet.'), findsNothing);
  });

  testWidgets('an ID already in the note is never used again', (tester) async {
    final ids = [a, b];
    final answers = await pumpForm(
      tester,
      demo,
      // A removed entry's ID is still the note's: its answers are there.
      values: {'tests.$a.entryAt': '2026-11-17T10:00:00Z', 'tests.$a.entryRemoved': true},
      newEntryId: () => ids.removeAt(0),
      clock: () => DateTime.utc(2026, 11, 17, 10, 30),
    );
    await tester.tap(find.text('Add test'));
    await tester.pumpAndSettle();
    expect(answers.changes.single.$1, 'tests.$b.entryAt');
  });

  test('an entry ID made on the phone is e and seven characters from a-z0-9', () {
    final made = {for (var i = 0; i < 200; i++) makeEntryId()};
    expect(made, everyElement(matches(RegExp(r'^e[a-z0-9]{7}$'))));
    expect(made.length, greaterThan(190));
  });

  testWidgets('entries are in the order added, numbered among those that are there', (tester) async {
    await pumpForm(
      tester,
      demo,
      values: {
        // b was added first, whatever its ID.
        'tests.$a.entryAt': '2026-11-17T10:05:00Z',
        'tests.$a.result': 'Demo: second',
        'tests.$b.entryAt': '2026-11-17T10:00:00Z',
        'tests.$b.result': 'Demo: first',
        'tests.$c.entryAt': '2026-11-17T09:00:00Z',
        'tests.$c.entryRemoved': true,
        'tests.$c.result': 'Demo: removed',
      },
    );
    expect(find.text('Test 3'), findsNothing);
    expect(find.text('Demo: removed'), findsNothing);
    final first = tester.getRect(find.text('Test 1'));
    final second = tester.getRect(find.text('Test 2'));
    expect(tester.getRect(find.text('Demo: first')).top, inInclusiveRange(first.bottom, second.top));
    expect(tester.getRect(find.text('Demo: second')).top, greaterThan(second.bottom));
  });

  testWidgets('Remove on an empty entry removes it at once', (tester) async {
    final answers = await pumpForm(tester, demo, values: {'tests.$a.entryAt': '2026-11-17T10:00:00Z'});
    await tester.tap(find.bySemanticsLabel('Remove Test 1'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(answers.changes, [('tests.$a.entryRemoved', true)]);
    expect(find.text('Test 1'), findsNothing);
  });

  testWidgets('Remove on an entry with answers asks first', (tester) async {
    final handle = tester.ensureSemantics();
    final answers = await pumpForm(
      tester,
      demo,
      values: {'tests.$a.entryAt': '2026-11-17T10:00:00Z', 'tests.$a.result': 'Demo: negative'},
    );
    await tester.tap(find.bySemanticsLabel('Remove Test 1'));
    await tester.pumpAndSettle();
    expect(find.text('Remove Test 1?'), findsOneWidget);
    expect(find.text('Its answers will no longer count. They stay in the note’s history.'), findsOneWidget);
    await expectFieldOk(tester);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(answers.changes, isEmpty);
    expect(find.text('Demo: negative'), findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Remove Test 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
    await tester.pumpAndSettle();
    expect(answers.changes, [('tests.$a.entryRemoved', true)]);
    // The answers stay in the note; they no longer count.
    expect(answers.values['tests.$a.result'], 'Demo: negative');
    expect(find.text('Demo: negative'), findsNothing);
    handle.dispose();
  });

  testWidgets('at the most a section holds, Add is not offered and a line says why', (tester) async {
    await pumpForm(
      tester,
      demo,
      values: {'tests.$a.entryAt': '2026-11-17T10:00:00Z', 'tests.$b.entryAt': '2026-11-17T10:05:00Z'},
    );
    expect(find.text('Add test'), findsNothing);
    expect(find.text('A note holds at most 2. Remove one to add another.'), findsOneWidget);
  });

  testWidgets('a read-only form offers neither Add nor Remove', (tester) async {
    await pumpForm(
      tester,
      demo,
      enabled: false,
      values: {'tests.$a.entryAt': '2026-11-17T10:00:00Z', 'tests.$a.result': 'Demo: negative'},
    );
    expect(find.text('Test 1'), findsOneWidget);
    expect(find.text('Demo: negative'), findsOneWidget);
    expect(find.bySemanticsLabel('Remove Test 1'), findsNothing);
    expect(find.text('Add test'), findsNothing);
  });
}
