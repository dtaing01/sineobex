import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/encounters/new_encounter_screen.dart';
import 'package:sineobex_field/features/encounters/start_sheet.dart';

import 'encounter_kit.dart';

/// The tab bar's Start (+) (lifecycle 9.2, card L5-start-tab): between Patients and the tabs to come,
/// it opens a sheet with one choice, New encounter, which opens its screen. A role that doesn't chart
/// is told why instead. Three themes, 200% text and 320 wide; offline.
void main() {
  Future<void> openStart(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Start')));
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('Start opens one choice, New encounter, which opens its screen (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      await signInToChart(tester, run: run);
      // Start sits after Patients in the bar, a tab with its words.
      final labels = [
        for (final d in tester.widgetList<NavigationDestination>(find.byType(NavigationDestination))) d.label,
      ];
      expect(labels, ['Home', 'Patients', 'Start']);
      await openStart(tester);
      expect(find.byType(StartSheet), findsOneWidget);
      final heading = find.descendant(of: find.byType(StartSheet), matching: find.text('Start'));
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      final choice = find.bySemanticsLabel('New encounter. Chart a visit, with or without a registered patient.');
      expect(tester.getSemantics(choice), isSemantics(isButton: true, hasTapAction: true, isEnabled: true));
      await expectScreenOk(tester);

      await tapOn(tester, choice);
      expect(find.byType(StartSheet), findsNothing);
      expect(find.byType(NewEncounterScreen), findsOneWidget);
      expect(location(tester), '/encounters/new');
      // The tab that was showing stays selected: Start is a sheet, not a place.
      await tester.pageBack();
      await settle(tester);
      expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 0);
      handle.dispose();
    });
  }

  testWidgets('a role that doesn’t chart is told why, and New encounter does nothing', (tester) async {
    final handle = tester.ensureSemantics();
    await signInToChart(tester, permissions: ['patients.view', 'patients.edit', 'referrals.create']);
    await openStart(tester);
    final choice = find.bySemanticsLabel('New encounter. Your role doesn’t chart visits.');
    expect(tester.getSemantics(choice), isSemantics(isButton: true, isEnabled: false));
    expect(find.text('Your role doesn’t chart visits.'), findsOneWidget);
    await tester.tap(find.text('New encounter'));
    await settle(tester);
    expect(find.byType(NewEncounterScreen), findsNothing);
    expect(find.byType(StartSheet), findsOneWidget);
    await expectScreenOk(tester);
    handle.dispose();
  });
}
