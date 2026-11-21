import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/forms/text_field.dart' show typingPause;
import 'package:sineobex_field/sync/entities.dart' show entityCorrection;

import 'encounter_kit.dart';

/// The correction sheet (lifecycle 3.6, 9.7; card L5-correction-sheet): the answer's labels and its
/// value now, the field's own input starting from it, a reason, the patient's request with its two
/// choices, another answer added, and the answers a change makes needed asked for with it; every
/// rule the domain layer's, offline. Three themes, 200% text, 320 wide.
void main() {
  Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);
  final concernBox = inSheet(find.byKey(const ValueKey('phi.form.concern')));
  final reasonBox = find.byKey(const ValueKey('phi.correctionReason'));

  /// The corrections waiting in the outbox, as sent.
  List<Map<String, Object?>> corrections(AppHarness h) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityCorrection && e.op == 'create') e.value! as Map<String, Object?>,
  ];

  Future<void> typeIn(WidgetTester tester, Finder box, String text) async {
    await revealInSheet(tester, box);
    await tester.enterText(box, text);
    await tester.pump(typingPause);
    // Done on the keyboard: a focused box keeps its caret on screen, which pulls the sheet back.
    FocusManager.instance.primaryFocus?.unfocus();
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('an answer, its value now, its own input, a reason: saved offline (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final v = await finishedVisit(tester, h);
      await openVisitScreen(tester, v.visit);
      await tapOn(tester, find.bySemanticsLabel('Correct Chief concern'));
      final heading = inSheet(find.text('Correct this note'));
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      await revealInSheet(tester, inSheet(find.text('Now: Demo: cough')));
      // The answer's heading, its value now and its input, each read once, in that order.
      expect(readingOrder(tester), containsAllInOrder(['[H] Chief concern', 'Now: Demo: cough', '[F] Chief concern']));
      // The field's own input, starting from what the note says.
      await revealInSheet(tester, concernBox);
      expect(tester.widget<TextField>(concernBox).controller!.text, 'Demo: cough');
      await revealInSheet(tester, find.text('0 of 500 characters'));
      await revealInSheet(tester, find.text('The patient asked for this change'));
      await expectScreenOk(tester);

      // Nothing changed yet: said here, nothing sent.
      await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save the correction'));
      await revealInSheet(tester, find.text('Change an answer first.'));
      // No reason: the domain layer's words.
      await typeIn(tester, concernBox, 'Demo: cough and a fever');
      await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save the correction'));
      await revealInSheet(tester, find.text('Give a reason of 3 to 500 characters.'));
      expect(corrections(h), isEmpty);

      await typeIn(tester, reasonBox, 'Demo: the fever was missed');
      await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save the correction'));
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('Correction saved'), findsOneWidget);
      final sent = corrections(h).single;
      expect(sent['noteId'], v.general);
      expect(sent['reason'], 'Demo: the fever was missed');
      expect([sent['requestedByPatient'], sent['declined']], [false, false]);
      expect((sent['changes']! as List<Object?>).single, containsPair('newValue', 'Demo: cough and a fever'));
      // Below the note, waiting to send: the server writes the new value and keeps the old.
      await expectShown(tester, find.textContaining(RegExp(r'^Corrected by Jordan Lee \(demo\), .*: Chief concern$')));
      await expectShown(tester, find.text('Reason: Demo: the fever was missed'));
      handle.dispose();
    });
  }

  testWidgets('a freeze while the sheet is open takes the answer off the screen (phase 3’s V1)', (tester) async {
    const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Correct Chief concern'));
    await revealInSheet(tester, inSheet(find.text('Now: Demo: cough')));
    h.sync.store!.freeze(frozen);
    h.encounters.changed();
    await settle(tester);
    expect(inSheet(find.text(frozen)), findsOneWidget);
    expect(find.text('Now: Demo: cough', skipOffstage: false), findsNothing);
    expect(find.byKey(const ValueKey('phi.form.concern'), skipOffstage: false), findsNothing);
  });

  testWidgets('Correct acts by its own tap action, and its read logs only what the screen hadn’t shown', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    final store = h.sync.store!;
    final before = auditEvents(store).length;
    final correct = find.bySemanticsLabel('Correct Chief concern');
    await reveal(tester, correct);
    expect(tester.getSemantics(correct), isSemantics(isButton: true, hasTapAction: true));
    await semanticTap(tester, 'Correct Chief concern');
    await revealInSheet(tester, inSheet(find.text('Now: Demo: cough')));
    // The note and its sign-off were shown already: reading it for the sheet logs nothing again.
    expect(auditEvents(store).skip(before), isEmpty);
    handle.dispose();
  });

  testWidgets('the patient asked: Make the change or Record that it was declined', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Correct Chief concern'));
    expect(find.widgetWithText(FilledButton, 'Make the change'), findsNothing);
    await tapInSheet(tester, find.text('The patient asked for this change'));
    await revealInSheet(tester, find.widgetWithText(FilledButton, 'Make the change'));
    await revealInSheet(tester, find.widgetWithText(OutlinedButton, 'Record that it was declined'));
    expect(find.widgetWithText(FilledButton, 'Save the correction'), findsNothing);
    await typeIn(tester, concernBox, 'Demo: no cough');
    await typeIn(tester, reasonBox, 'Demo: the visit notes say otherwise');
    await tapInSheet(tester, find.widgetWithText(OutlinedButton, 'Record that it was declined'));
    expect(find.text('Declined request recorded'), findsOneWidget);
    final sent = corrections(h).single;
    expect([sent['requestedByPatient'], sent['declined']], [true, true]);
    await expectShown(
      tester,
      find.textContaining(RegExp(r'^The patient asked to change Chief concern\. Declined by Jordan Lee \(demo\), ')),
    );
  });

  testWidgets('another answer added, and one removed again', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Correct Follow up'));
    await tapInSheet(tester, find.widgetWithText(OutlinedButton, 'Correct another answer'));
    await revealInSheet(tester, find.text('Which answer?'));
    await tapInSheet(tester, find.widgetWithText(OutlinedButton, 'Does the patient require emergency evaluation?'));
    await revealInSheet(tester, find.text('Now: NO'));
    await tapInSheet(
      tester,
      find.bySemanticsLabel('Remove Does the patient require emergency evaluation? from this correction'),
    );
    expect(find.text('Now: NO'), findsNothing);
    expect(find.bySemanticsLabel(RegExp('^Remove ')), findsNothing);
    expect(corrections(h), isEmpty);

    // Added again and removed by its own tap action, as Switch Access and Voice Access reach it, with
    // a screen reader on: focus goes to Correct another answer, not nowhere (review finding PX-5).
    final handle = tester.ensureSemantics();
    tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
      accessibleNavigation: true,
    );
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
    await tapInSheet(tester, find.widgetWithText(OutlinedButton, 'Correct another answer'));
    await tapInSheet(tester, find.widgetWithText(OutlinedButton, 'Does the patient require emergency evaluation?'));
    await revealInSheet(tester, find.text('Now: NO'));
    await semanticTap(tester, 'Remove Does the patient require emergency evaluation? from this correction');
    expect(find.text('Now: NO'), findsNothing);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'correct another answer');
    expect(corrections(h), isEmpty);
    handle.dispose();
  });

  testWidgets('a change that makes another answer needed asks for it, and both go together', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Correct Follow up'));
    await tapInSheet(tester, inSheet(find.text('Specific date')));
    await typeIn(tester, reasonBox, 'Demo: a date was set');
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save the correction'));
    // The domain layer's words, and the answer it needs, asked for under its own heading.
    await revealInSheet(tester, find.text('This change would leave the note missing something it needs.'));
    await revealInSheet(tester, find.text('Needed with this change'));
    expect(corrections(h), isEmpty);
    final month = inSheet(find.byKey(const ValueKey('phi.form.date.month')));
    await typeIn(tester, month, '12');
    await typeIn(tester, inSheet(find.byKey(const ValueKey('phi.form.date.day'))), '1');
    await typeIn(tester, inSheet(find.byKey(const ValueKey('phi.form.date.year'))), '${fixtureNow.year}');
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save the correction'));
    expect(find.text('Correction saved'), findsOneWidget);
    final changes = [
      for (final c in (corrections(h).single['changes']! as List<Object?>).cast<Map<String, Object?>>())
        (c['field'], c['newValue']),
    ];
    expect(
      changes,
      unorderedEquals([('data.follow_up.when', 'specific_date'), ('data.follow_up.date', '${fixtureNow.year}-12-01')]),
    );
  });
}
