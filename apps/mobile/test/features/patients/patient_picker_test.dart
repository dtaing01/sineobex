import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/encounters/encounter_widgets.dart' show PatientFinder;
import 'package:sineobex_field/features/patients/patient_picker.dart';
import 'package:sineobex_field/features/patients/patient_row.dart';
import 'package:sineobex_field/sync/local_store.dart';

import 'patient_kit.dart';

/// The patient picker (design 2.6, Needs attention's **Attach to another patient**): a modal sheet,
/// so not under a screen's gate. A freeze for a hand-over takes a found patient off it whatever
/// tells it, and what it read before is never shown again (V1). New encounter's Who keeps its own
/// copy of the search (`PatientFinder`); the two find the same patients in the same order and log
/// the search alike.
void main() {
  const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';
  final sheet = find.byType(BottomSheet);
  final searchButton = find.widgetWithText(OutlinedButton, 'Search');

  /// Opens the picker over the screen, as Needs attention does.
  Future<void> openPicker(WidgetTester tester, AppHarness h) async {
    final context = tester.element(find.byType(Navigator).first);
    unawaited(pickPatient(context, h.patients, today: fixtureNow));
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
    testWidgets('a freeze for a hand-over takes a found patient off the sheet: $how (V1)', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      await syncAndRefresh(tester, h);
      await openPicker(tester, h);
      await type(tester, 'attachSearch', 'del');
      await tapOn(tester, searchButton);
      expect(rows(tester, sheet), [p1Id]);
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

      // Access comes back: what the sheet read before is never shown again, and nothing was logged.
      store.unfreeze();
      await tester.runAsync(() => h.sync.syncNow());
      await settle(tester);
      expect(find.byKey(const ValueKey('phi.attachSearch')), findsOneWidget);
      expect(rows(tester, sheet), isEmpty);
      expect(find.textContaining('found', skipOffstage: false), findsNothing);
      expect(auditEvents(store), hasLength(before));
    });
  }

  for (final offline in [true, false]) {
    testWidgets('the picker and New encounter’s Who find the same patients in the same order, and log the search alike '
        '(${offline ? 'offline' : 'online'})', (tester) async {
      final h = await signIn(tester);
      seedP1(h.server);
      for (final name in ['Demo Adele', 'Demo Dell', 'Demo Delia']) {
        h.server.seedPatient(preferredName: name);
      }
      await syncAndRefresh(tester, h);
      h.server.offline = offline;
      final store = h.sync.store!;
      // The search's audit: the phone's own entry offline, the server's online.
      List<Object?> searchAudit() => offline
          ? [
              for (final e in store.outbox())
                if (e.entity == entityAudit && (e.value! as Map<String, Object?>)['action'] == 'patient.searched')
                  e.value,
            ]
          : [
              for (final a in h.server.serverAudit)
                if (a['action'] == 'patient.searched') a,
            ];

      var before = searchAudit().length;
      await openPicker(tester, h);
      await type(tester, 'attachSearch', 'del');
      await tapOn(tester, searchButton);
      final picked = rows(tester, sheet);
      final pickerAudit = searchAudit().skip(before).toList();
      Navigator.of(tester.element(sheet)).pop();
      await settle(tester);

      before = searchAudit().length;
      await go(tester, '/encounters/new');
      await type(tester, 'visitSearch', 'del');
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
      final found = rows(tester, find.byType(PatientFinder));
      final whoAudit = searchAudit().skip(before).toList();

      // More than one, so that the order is something to agree on.
      expect(picked.length, greaterThan(1));
      expect(found, picked);
      expect(pickerAudit, hasLength(1));
      expect(whoAudit, pickerAudit);
    });
  }
}
