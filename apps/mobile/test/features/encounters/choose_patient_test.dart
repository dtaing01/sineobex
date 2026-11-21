import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/encounters/encounter_labels.dart' show switchNeedsPatient;
import 'package:sineobex_field/features/encounters/encounter_widgets.dart' show choosePatient;
import 'package:sineobex_field/features/patients/patient_row.dart';

import 'encounter_kit.dart';

/// Who a visit is for, asked in a modal sheet with phase 3's search (`choosePatient`: Switch to
/// Medical on a visit with no patient, lifecycle 3.10, and Needs attention's Choose the patient): not
/// under a screen's gate, so a freeze for a hand-over takes a found patient off it whatever tells it,
/// and what it found before is never shown again (phase 3's V1).
void main() {
  const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
  final sheet = find.byType(BottomSheet);
  final searchButton = find.widgetWithText(OutlinedButton, 'Search');

  /// Opens the question over the screen, as Switch to Medical does.
  Future<void> openQuestion(WidgetTester tester, AppHarness h) async {
    final context = tester.element(find.byType(Navigator).first);
    unawaited(choosePatient(context, h.patients, line: switchNeedsPatient));
    await settle(tester);
  }

  /// The patients [list] shows, top to bottom, built or not yet scrolled to.
  List<String> rows(WidgetTester tester, Finder list) => [
    for (final r in tester.widgetList<PatientRow>(
      find.descendant(of: list, matching: find.byType(PatientRow, skipOffstage: false), skipOffstage: false),
    ))
      r.patient.patientId,
  ];

  for (final (how, tell) in <(String, Future<void> Function(WidgetTester, AppHarness))>[
    // A sync that finds no signal.
    ('the controller says so', (tester, h) => tester.runAsync(() => h.sync.syncNow())),
    ('a download ends before the controller says so', (tester, h) async => h.patients.changed()),
    ('a visit’s change ends before the controller says so', (tester, h) async => h.encounters.changed()),
    // Nothing tells it: the store refuses the search.
    ('the person searches again before anything says so', (tester, h) => tapOn(tester, searchButton)),
  ]) {
    testWidgets('a freeze for a hand-over takes a found patient off Who is this visit for: $how (V1)', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await openQuestion(tester, h);
      await type(tester, 'visitSearch', 'del');
      await tapOn(tester, searchButton);
      expect(rows(tester, sheet), [p1Id]);
      expect(find.descendant(of: sheet, matching: find.text('1 patient found')), findsOneWidget);
      h.server.offline = true;
      final store = h.sync.store!;
      final before = auditEvents(store).length;

      store.freeze(frozen);
      await tell(tester, h);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.descendant(of: sheet, matching: find.text(frozen)), findsOneWidget);
      expect(rows(tester, sheet), isEmpty);
      expect(find.bySemanticsLabel(RegExp('^Del'), skipOffstage: false), findsNothing);
      expect(find.textContaining('found', skipOffstage: false), findsNothing);
      expectNoLegalName(tester);

      // The controller says so in the end, as it does as soon as it freezes the store; then access
      // comes back: what the sheet found before is never shown again, and nothing was logged.
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(rows(tester, sheet), isEmpty);
      store.unfreeze();
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(find.byKey(const ValueKey('phi.visitSearch')), findsOneWidget);
      expect(rows(tester, sheet), isEmpty);
      expect(find.textContaining('found', skipOffstage: false), findsNothing);
      expect(auditEvents(store), hasLength(before));
    });
  }
}
