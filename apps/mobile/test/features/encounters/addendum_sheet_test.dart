import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAddendum;

import 'encounter_kit.dart';

/// The addendum sheet (lifecycle 3.6, 9.7; card L5-addendum-sheet): one private text box of up to
/// 4,000 characters, below a finished note or below the visit itself, the domain layer's refusals in
/// its words, offline. Three themes, 200% text, 320 wide.
void main() {
  Finder addButton() => find.widgetWithText(FilledButton, 'Add addendum');

  /// The addenda waiting in the outbox, as sent.
  List<Map<String, Object?>> addenda(AppHarness h) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityAddendum && e.op == 'create') e.value! as Map<String, Object?>,
  ];

  for (final run in runs) {
    testWidgets('below a note: written, refused when empty, added offline (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final v = await finishedVisit(tester, h);
      await openVisitScreen(tester, v.visit);
      await tapOn(tester, find.bySemanticsLabel('Add addendum to General / primary care'));
      expect(find.text('To General / primary care'), findsOneWidget);
      final heading = find.descendant(of: find.byType(BottomSheet), matching: find.text('Add addendum')).first;
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      await revealInSheet(tester, find.text('0 of 4,000 characters'));
      await expectScreenOk(tester);

      // Nothing written: the domain layer's words, and nothing sent.
      await tapInSheet(tester, addButton());
      await revealInSheet(tester, find.text('Write the addendum first.'));
      expect(addenda(h), isEmpty);

      await revealInSheet(tester, find.byKey(const ValueKey('phi.addendum')));
      await tester.enterText(find.byKey(const ValueKey('phi.addendum')), 'Demo: the swab came back clear');
      await tester.pump();
      await revealInSheet(tester, find.text('30 of 4,000 characters'));
      await tapInSheet(tester, addButton());
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('Addendum added'), findsOneWidget);
      expect(addenda(h).single, containsPair('noteId', v.general));
      expect(addenda(h).single, containsPair('text', 'Demo: the swab came back clear'));
      // Below its note, waiting to send.
      await expectShown(tester, find.text('Demo: the swab came back clear'));
      handle.dispose();
    });
  }

  testWidgets('below the visit itself, shown with the visit’s own', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Add addendum to the visit'));
    expect(find.text('To the visit'), findsOneWidget);
    await revealInSheet(tester, find.byKey(const ValueKey('phi.addendum')));
    await tester.enterText(find.byKey(const ValueKey('phi.addendum')), 'Demo: seen again at the shelter');
    await tester.pump();
    await tapInSheet(tester, addButton());
    expect(addenda(h).single, containsPair('noteId', null));
    await expectShown(tester, find.text('Demo: seen again at the shelter'));
    // Under "Added to the visit", above the notes.
    expect(
      tester.getTopLeft(find.text('Demo: seen again at the shelter')).dy,
      lessThan(tester.getTopLeft(find.text('Notes')).dy),
    );
  });

  testWidgets('the box stops at 4,000 characters, counted as the server counts them', (tester) async {
    final h = await signInToChart(tester);
    final v = await finishedVisit(tester, h);
    await openVisitScreen(tester, v.visit);
    await tapOn(tester, find.bySemanticsLabel('Add addendum to the visit'));
    await revealInSheet(tester, find.byKey(const ValueKey('phi.addendum')));
    await tester.enterText(find.byKey(const ValueKey('phi.addendum')), 'Demo: ${'é' * 4000}');
    await tester.pump();
    await revealInSheet(tester, find.text('4,000 of 4,000 characters'));
    await tapInSheet(tester, addButton());
    expect((addenda(h).single['text']! as String).runes, hasLength(4000));
  });
}
