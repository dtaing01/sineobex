import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/flag_sheet.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;

import '../../sync/fake_server.dart';
import 'patient_kit.dart';

/// The team's flags as an admin left them (every name made up): two risk levels, two conditions, one
/// of them sensitive.
typedef _Flags = ({String high, String medium, String frost, String pregnancy});

/// The **Change flags** sheet (phase 5 design 8.2; card P5-phone-sheet): opened from the profile's
/// flags row with `patients.edit`, through `SheetGate.patients`, its choosers through `DialogGate`,
/// its reason box a `PrivateBox`; Risk level (one, or None) and Conditions (several), the history,
/// a reason, Save, and Entered in error on a change of the person's own. Works offline. Three themes,
/// 200% text, 320 wide; without `patients.edit`; without sight of sensitive flags; a freeze while it
/// is open draws nothing of it.
///
/// Written ahead of its code (card P5-tests): each case fails until P5-phone-sheet lands.
void main() {
  const teammate = 'c0000000-0000-4000-8000-0000000000c2';
  const frozen = 'Your access to this team ended. Saved records are being sent to a Program Admin.';

  Map<String, Object?> flag(String name, String tier, String color, int rank, {bool sensitive = false}) => {
    'name': name,
    'tier': tier,
    'criteria': '',
    'color': color,
    'rank': rank,
    'sensitive': sensitive,
  };

  _Flags addFlags(AppHarness h) {
    final team = h.patients.teamId;
    return (
      high: h.server.addPreset(team, 'flag', flag('Demo: High', 'primary', 'red', 10)),
      medium: h.server.addPreset(team, 'flag', flag('Demo: Medium', 'primary', 'yellow', 20)),
      frost: h.server.addPreset(team, 'flag', flag('Demo: Frost risk', 'secondary', 'blue', 10)),
      pregnancy: h.server.addPreset(team, 'flag', flag('Demo: Pregnancy', 'secondary', 'purple', 30, sensitive: true)),
    );
  }

  String change(AppHarness h, String flagId, String action, {String by = teammate, Duration ago = Duration.zero}) =>
      h.server.seed(
        entityFlagChange,
        {'patientId': p1Id, 'flagId': flagId, 'action': action, 'reason': 'Demo: seen under the bridge'},
        by: by,
        at: h.wall.subtract(ago),
      );

  /// Del on the phone with the team's flags, the chart opened online, then offline.
  Future<({AppHarness h, _Flags f})> openDel(
    WidgetTester tester, {
    Run? run,
    List<String>? permissions,
    void Function(AppHarness h, _Flags f)? before,
  }) async {
    final h = await signIn(
      tester,
      theme: run?.theme,
      scale: run?.scale ?? 1,
      narrow: run?.narrow ?? false,
      permissions: permissions,
    );
    seedP1(h.server);
    h.server.names[teammate] = 'Demo Teammate';
    final f = addFlags(h);
    before?.call(h, f);
    await syncAndRefresh(tester, h);
    await go(tester, '/patients/$p1Id');
    h.server.offline = true;
    return (h: h, f: f);
  }

  Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);
  Finder inDialog(Finder f) => find.descendant(of: find.byType(Dialog), matching: f);
  Finder sheetList() => find.descendant(of: find.byType(BottomSheet), matching: find.byType(Scrollable)).first;

  Future<void> revealInSheet(WidgetTester tester, Finder finder) async {
    if (finder.evaluate().isEmpty) {
      try {
        await tester.scrollUntilVisible(finder, 200, scrollable: sheetList(), maxScrolls: 30);
      } on StateError {
        await tester.scrollUntilVisible(finder, -200, scrollable: sheetList(), maxScrolls: 30);
      }
    }
    await tester.ensureVisible(finder.first);
    await tester.pumpAndSettle();
  }

  Future<void> tapInSheet(WidgetTester tester, Finder finder) async {
    await revealInSheet(tester, finder);
    await tester.tap(finder.first);
    await settle(tester);
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tapOn(tester, find.widgetWithText(OutlinedButton, changeFlagsAction));
    expect(inSheet(find.text(changeFlagsTitle)), findsOneWidget);
  }

  Future<void> chooseLevel(WidgetTester tester, String pill) async {
    await tapInSheet(tester, find.text(chooseRiskLevelAction));
    await tester.tap(inDialog(find.text(pill)));
    await settle(tester);
  }

  Future<void> toggleConditions(WidgetTester tester, List<String> pills) async {
    await tapInSheet(tester, find.text(chooseConditionsAction));
    for (final p in pills) {
      await tester.tap(inDialog(find.text(p)));
      await tester.pumpAndSettle();
    }
    await tester.tap(inDialog(find.text(conditionsDoneAction)));
    await settle(tester);
  }

  Future<void> typeReason(WidgetTester tester, String reason) async {
    final box = inSheet(find.byKey(const ValueKey('phi.flagReason')));
    await revealInSheet(tester, box);
    await tester.enterText(box, reason);
    await tester.pump();
  }

  FilledButton save(WidgetTester tester) =>
      tester.widget<FilledButton>(inSheet(find.widgetWithText(FilledButton, 'Save')));

  List<Map<String, Object?>> flagCreates(AppHarness h) => [
    for (final e in h.sync.store!.outbox())
      if (e.entity == entityFlagChange && e.op == 'create') e.value! as Map<String, Object?>,
  ];

  for (final run in runs) {
    testWidgets('offline: a risk level and a condition chosen, a reason, Save; it says so and focus returns '
        '(${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final (:h, :f) = await openDel(tester, run: run);
      await openSheet(tester);
      await expectScreenOk(tester);
      // Save waits for a reason.
      expect(save(tester).onPressed, isNull);

      await chooseLevel(tester, 'Red · Demo: High');
      await toggleConditions(tester, ['Blue · Demo: Frost risk']);
      await expectScreenOk(tester);
      expect(save(tester).onPressed, isNull);
      await typeReason(tester, 'Demo: left hospital this week');
      expect(save(tester).onPressed, isNotNull);
      await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save'));

      expect(find.byType(BottomSheet), findsNothing);
      expect(
        {for (final v in flagCreates(h)) (v['flagId'], v['action'], v['reason'])},
        {(f.high, 'set', 'Demo: left hospital this week'), (f.frost, 'set', 'Demo: left hospital this week')},
      );
      final said = find.text('Flags saved.');
      await expectShown(tester, said);
      expect(tester.getSemantics(said), isSemantics(isLiveRegion: true));
      final row = find.widgetWithText(OutlinedButton, changeFlagsAction);
      expect(Focus.of(tester.element(row)).hasFocus, isTrue);
      // The profile's pills show them at once, offline.
      await expectShown(tester, find.text('Red · Demo: High'));
      await expectShown(tester, find.text('Blue · Demo: Frost risk'));
      await expectScreenOk(tester);
      handle.dispose();
    });
  }

  testWidgets('each Save is announced again, so a second press is heard too', (tester) async {
    final handle = tester.ensureSemantics();
    final (:h, :f) = await openDel(tester);
    for (final (pill, reason) in [
      ('Red · Demo: High', 'Demo: left hospital'),
      ('Yellow · Demo: Medium', 'Demo: settled in'),
    ]) {
      await openSheet(tester);
      await chooseLevel(tester, pill);
      await typeReason(tester, reason);
      await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save'));
      final said = find.text('Flags saved.');
      expect(said, findsOneWidget);
      expect(tester.getSemantics(said), isSemantics(isLiveRegion: true));
    }
    expect([for (final v in flagCreates(h)) v['flagId']], [f.high, f.medium]);
    handle.dispose();
  });

  testWidgets('None clears the risk level; the history says who set what, when and why', (tester) async {
    final handle = tester.ensureSemantics();
    final (:h, :f) = await openDel(tester, before: (h, f) => change(h, f.high, 'set', ago: const Duration(days: 2)));
    await expectShown(tester, find.text('Red · Demo: High'));
    await openSheet(tester);
    final history = inSheet(find.textContaining('Demo Teammate'));
    await revealInSheet(tester, history);
    expect(inSheet(find.textContaining(flagSetText)), findsWidgets);
    expect(inSheet(find.textContaining('Demo: seen under the bridge')), findsOneWidget);

    await chooseLevel(tester, noRiskLevelText);
    await typeReason(tester, 'Demo: doing better');
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save'));
    expect(flagCreates(h).single, {
      'patientId': p1Id,
      'flagId': f.high,
      'action': 'clear',
      'reason': 'Demo: doing better',
    });
    expect(find.text('Red · Demo: High'), findsNothing);
    await openSheet(tester);
    await revealInSheet(tester, inSheet(find.textContaining(flagClearedText)));
    handle.dispose();
  });

  testWidgets('Entered in error on a change of the person’s own, never on a teammate’s', (tester) async {
    final handle = tester.ensureSemantics();
    final (:h, :f) = await openDel(tester, before: (h, f) => change(h, f.frost, 'set', ago: const Duration(days: 1)));
    await openSheet(tester);
    // The teammate's change offers no mark to Healthcare Staff, who don't manage the team's people.
    expect(inSheet(find.text(flagEnteredInErrorAction)), findsNothing);
    await chooseLevel(tester, 'Red · Demo: High');
    await typeReason(tester, 'Demo: left hospital');
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save'));
    final mine = h.sync.store!.outbox().singleWhere((e) => e.entity == entityFlagChange).recordId;

    await openSheet(tester);
    await tapInSheet(tester, find.text(flagEnteredInErrorAction));
    expect(find.byType(Dialog), findsOneWidget);
    await expectGuidelines(tester);
    await tester.enterText(inDialog(find.byKey(const ValueKey('phi.reason'))), 'Demo: set on the wrong patient');
    await tester.tap(inDialog(find.widgetWithText(FilledButton, markFlagChangeAction)));
    await settle(tester);
    final mark = h.sync.store!.outbox().singleWhere((e) => e.recordId == mine && e.op == 'set');
    expect(
      [mark.field, mark.value],
      [
        'enteredInError',
        {'reason': 'Demo: set on the wrong patient'},
      ],
    );
    expect(find.text('Red · Demo: High'), findsNothing);
    handle.dispose();
  });

  testWidgets('without patients.edit the pills show and no sheet is offered', (tester) async {
    await openDel(
      tester,
      permissions: const ['patients.view', 'billing.view_codes', 'inventory.view'],
      before: (h, f) => change(h, f.high, 'set'),
    );
    await expectShown(tester, find.text('Red · Demo: High'));
    expect(find.text(changeFlagsAction), findsNothing);
  });

  testWidgets('a sensitive flag is absent everywhere for a reader the flag rule hides it from', (tester) async {
    final (h: _, f: _) = await openDel(
      tester,
      permissions: FakeSyncServer.chw.toList(),
      before: (h, f) => change(h, f.pregnancy, 'set'),
    );
    expect(find.textContaining('Pregnancy'), findsNothing);
    await openSheet(tester);
    expect(inSheet(find.textContaining('Pregnancy')), findsNothing);
    await tapInSheet(tester, find.text(chooseConditionsAction));
    expect(inDialog(find.text('Blue · Demo: Frost risk')), findsOneWidget);
    expect(inDialog(find.textContaining('Pregnancy')), findsNothing);
  });

  testWidgets('an archived flag the patient carries shows its words, and is offered only to clear', (tester) async {
    final (:h, :f) = await openDel(tester, before: (h, f) => change(h, f.frost, 'set'));
    h.server
      ..offline = false
      ..archivePreset(h.patients.teamId, f.frost);
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    await expectShown(tester, find.text('Blue · Demo: Frost risk'));
    await expectShown(tester, find.text('No longer on the team’s list'));
    await openSheet(tester);
    await tapInSheet(tester, find.text(chooseConditionsAction));
    // Ticked, as the patient carries it: unticking it is the one thing offered.
    final tile = inDialog(find.widgetWithText(CheckboxListTile, 'Blue · Demo: Frost risk'));
    expect(tester.widget<CheckboxListTile>(tile).value, isTrue);
    await tester.tap(tile);
    await tester.pumpAndSettle();
    await tester.tap(inDialog(find.text(conditionsDoneAction)));
    await settle(tester);
    await typeReason(tester, 'Demo: moved indoors');
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Save'));
    expect(flagCreates(h).single, containsPair('action', 'clear'));
  });

  testWidgets('while the clock is paused Save is off and the sheet says why', (tester) async {
    final (:h, f: _) = await openDel(tester);
    // The server's clock is hours from the phone's: charting pauses (D35).
    h.server.offline = false;
    h.serverAhead = const Duration(hours: 2);
    await tester.runAsync(() => h.sync.checkClock(fresh: true));
    h.server.offline = true;
    await settle(tester);
    await openSheet(tester);
    await typeReason(tester, 'Demo: left hospital');
    await revealInSheet(tester, inSheet(find.text('Flags can be changed once the phone’s clock is right.')));
    expect(save(tester).onPressed, isNull);
  });

  testWidgets('where the presets aren’t held the sheet says to connect, and offers nothing', (tester) async {
    final (:h, f: _) = await openDel(tester);
    PresetStore(h.sync.store!).clear();
    h.patients.changed();
    await settle(tester);
    await openSheet(tester);
    await revealInSheet(tester, inSheet(find.text('Your team’s setup hasn’t downloaded yet. Connect to finish.')));
    expect(inSheet(find.text(chooseRiskLevelAction)), findsNothing);
    expect(inSheet(find.text(chooseConditionsAction)), findsNothing);
  });

  for (final (how, tell) in <(String, Future<void> Function(WidgetTester, AppHarness))>[
    // A sync that finds no signal.
    ('the controller says so', (tester, h) => tester.runAsync(() => h.sync.syncNow())),
    ('a download ends before the controller says so', (tester, h) async => h.patients.changed()),
  ]) {
    testWidgets('a freeze while the sheet is open draws nothing of it, what was typed included: $how (D125)', (
      tester,
    ) async {
      final (:h, :f) = await openDel(tester, before: (h, f) => change(h, f.high, 'set'));
      await openSheet(tester);
      await chooseLevel(tester, 'Yellow · Demo: Medium');
      await typeReason(tester, 'Demo: something private');
      final store = h.sync.store!;
      final before = store.outbox().length;

      store.freeze(frozen);
      await tell(tester, h);
      await settle(tester);
      expect(tester.takeException(), isNull);
      expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(frozen)), findsOneWidget);
      expect(find.text(changeFlagsTitle), findsNothing);
      expect(find.textContaining('Demo: something private', skipOffstage: false), findsNothing);
      expect(find.textContaining('Demo: Medium', skipOffstage: false), findsNothing);
      expect(find.textContaining('Demo: High', skipOffstage: false), findsNothing);
      expect(store.outbox(), hasLength(before));
    });
  }
}
