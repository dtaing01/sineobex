import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/encounters/handoff_screen.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAudit;

import 'encounter_kit.dart';

/// The EMS handoff (lifecycle 9.8; cards L5-handoff and F7-handoff): a full-screen page built by
/// handoffLines, opened by Show handoff once EMS is activated. Large text in high contrast in every
/// theme, no app bar actions, Done at the bottom, nothing to copy, share or select; its showing
/// logged before it shows. Built for EMS's reader whoever shows it (D94): no note of a sensitive
/// type. Three themes, 200% text, 320 wide; offline.
void main() {
  /// A Medical visit for P1 with a General note and the Red flags note answered as EMS activated.
  Future<({String visit, String flags})> emsVisit(WidgetTester tester, AppHarness h) async {
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: chest pain'});
    final flags = noteOfType(h, visit, 'red_flags_disposition')!.id;
    final r = h.encounters.repository;
    await tester.runAsync(() => r.openNote(flags));
    r
      ..saveAnswer(flags, 'red_flags.emergency', 'yes')
      ..saveAnswer(flags, 'red_flags.ems_activated', 'yes')
      ..saveAnswer(flags, 'red_flags.transport', 'yes')
      ..saveAnswer(flags, 'red_flags.ems_time', '14:30');
    return (visit: visit, flags: flags);
  }

  double luminance(Color c) {
    double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  double contrast(Color a, Color b) {
    final (x, y) = (luminance(a), luminance(b));
    return (math.max(x, y) + 0.05) / (math.min(x, y) + 0.05);
  }

  for (final run in runs) {
    testWidgets('Show handoff opens the full-screen page, logged, in high contrast (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final (:visit, :flags) = await emsVisit(tester, h);
      final store = h.sync.store!;
      await openNote(tester, flags);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Show handoff'));
      await settle(tester);
      expect(location(tester), '/encounters/$visit/handoff');
      expect(find.byType(HandoffScreen), findsOneWidget);
      // Logged before it shows: the visit's read, then the showing, on the visit with its patient.
      final shown = [
        for (final e in store.outbox())
          if (e.entity == entityAudit && (e.value! as Map<String, Object?>)['action'] == 'ems_handoff.shown')
            e.value! as Map<String, Object?>,
      ];
      expect(shown, hasLength(1));
      expect(shown.single, containsPair('entity', 'encounter'));
      expect(shown.single, containsPair('entityId', visit));
      expect(shown.single, containsPair('patientId', p1Id));

      // A fixed title, no back arrow and no actions; Done at the bottom.
      final bar = tester.widget<AppBar>(find.byType(AppBar));
      expect([bar.actions, bar.automaticallyImplyLeading], [isNull, isFalse]);
      expect(find.byTooltip('Back'), findsNothing);
      await expectShown(tester, find.widgetWithText(FilledButton, 'Done'));
      // Who, as the file heads it: never the legal name or the birth date.
      expect(find.text('Del'), findsOneWidget);
      expect(find.textContaining(RegExp(r'^Age \d+$')), findsOneWidget);
      expect(find.text('Allergy: penicillin (severe)'), findsOneWidget);
      expectNoLegalName(tester);
      expect(find.textContaining('1946'), findsNothing);
      // The lines, each note's under its title and state: its answers, then, under Recap, its recap.
      await reveal(tester, find.text('General / primary care (Draft)'));
      await expectShown(tester, find.text('Chief concern: Demo: chest pain'));
      await reveal(tester, find.text('Red flags and disposition (Draft)'));
      await expectShown(tester, find.text('EMS activated?: YES'));
      await expectShown(tester, find.text('Time EMS called: 14:30'));
      // Nothing to select, copy or share.
      expect(find.byType(SelectionArea), findsNothing);
      expect(find.byType(SelectableText), findsNothing);
      expect(find.byType(TextField), findsNothing);
      await reveal(tester, find.text('Chief concern: Demo: chest pain'));
      await tester.longPress(find.text('Chief concern: Demo: chest pain'));
      await settle(tester);
      expect(find.text('Copy'), findsNothing);
      expect(h.copied, isEmpty);
      // High contrast in every theme: every word at 7:1 or more on the page.
      final ground = tester
          .widget<Scaffold>(find.descendant(of: find.byType(HandoffScreen), matching: find.byType(Scaffold)))
          .backgroundColor!;
      for (final p in tester.renderObjectList<RenderParagraph>(
        find.descendant(of: find.byType(HandoffScreen), matching: find.byType(RichText)),
      )) {
        final color = p.text.style?.color;
        if (color == null || p.text.toPlainText() == 'Done') continue;
        expect(contrast(color, ground), greaterThanOrEqualTo(7), reason: p.text.toPlainText());
      }
      await expectScreenOk(tester);
      // Done goes back to the note.
      await tapOn(tester, find.widgetWithText(FilledButton, 'Done'));
      expectNoteOpened(tester, flags);
      handle.dispose();
    });
  }

  testWidgets('built for EMS whoever shows it: no note of a sensitive type, nor its name (D94)', (tester) async {
    final h = await signInToChart(tester);
    final (:visit, flags: _) = await emsVisit(tester, h);
    // The person's own Behavioral health note: they see all of it; EMS may not.
    await chart(tester, h, visit, 'psychological', {
      'reason.reasons': ['substance_use'],
    });
    await chart(tester, h, visit, 'social_needs', {
      'needs.needs': ['food'],
    });
    await go(tester, '/encounters/$visit/handoff');
    await expectShown(tester, find.text('Social needs (Draft)'));
    expect(find.textContaining('Behavioral', skipOffstage: false), findsNothing);
    expect(find.textContaining('Psycholog', skipOffstage: false), findsNothing);
    expect(find.textContaining('Substance', skipOffstage: false), findsNothing);
  });

  testWidgets('a frozen store shows nothing and logs nothing', (tester) async {
    final h = await signInToChart(tester);
    final (:visit, flags: _) = await emsVisit(tester, h);
    final store = h.sync.store!;
    final before = auditEvents(store).length;
    store.freeze('Your access to this team ended. Its records are being handed over.');
    await go(tester, '/encounters/$visit/handoff');
    expect(find.text('Your access to this team ended. Its records are being handed over.'), findsOneWidget);
    expect(find.text('Del'), findsNothing);
    expect(auditEvents(store).skip(before), isEmpty);
  });
}
