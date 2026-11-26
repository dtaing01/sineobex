import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/features/patients/flag_sheet.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/features/presets/team_setup_screen.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show Intake;
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;

import '../features/encounters/encounter_kit.dart';
import 'platform_presets.dart';

/// The phase 5 Done when's steps 7 and 8 through the screens (design 10.1, card P6-screens), offline,
/// on the app harness as the screens' own tests run, with the story's names from presets-done-when.json:
/// Team setup, opened from Home's row, shows the Labs item under Labs, the bundle with its line and the
/// flag under Conditions by its pill; then the patient's flags sheet sets the flag with the story's
/// reason, and the phone's next sync has it accepted. Each in Day, Night run and High contrast, at 200%
/// text and 320 wide. Before step 7 the team holds every platform preset as the installer gives them
/// (platform_presets.dart) and steps 2 to 4's presets as the admin routes leave them, and the phone has
/// registered the patient and synced (steps 1 and 6, which done_when_presets_test.dart holds).
void main() {
  final story = jsonDecode(
    File('../../packages/contract/test-vectors/presets-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final patient = story['patient']! as Map<String, Object?>;
  final presets = (story['presets']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> presetOf(String ref) => presets.singleWhere((p) => p['ref'] == ref);
  Map<String, Object?> stepOf(int n) =>
      (story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n);
  Map<String, Object?> expectAt(int n) => stepOf(n)['expect']! as Map<String, Object?>;

  /// A body of the story as the team holds it: each {platform: originKey} the team's copy of that
  /// platform preset and each {preset: ref} the preset an earlier step made, by ID (the story's note).
  Object? asHeld(Object? value, Map<String, String> platformIds, Map<String, String> made) => switch (value) {
    final List<Object?> list => [for (final v in list) asHeld(v, platformIds, made)],
    {'platform': final String key} => platformIds[key],
    {'preset': final String ref} => made[ref],
    final Map<String, Object?> map => {
      for (final MapEntry(:key, :value) in map.entries) key: asHeld(value, platformIds, made),
    },
    _ => value,
  };

  /// The story's world as step 6 leaves it, then offline: the team's platform presets and the admin's
  /// three, the patient registered by this phone, everything synced. The IDs of the presets made, by
  /// ref, and of the Labs category, and the patient's.
  Future<({AppHarness h, Map<String, String> made, String labs, String patientId})> afterStep6(
    WidgetTester tester,
    Run run,
  ) async {
    final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
    final team = h.patients.teamId;
    final platformIds = givePlatformPresets(h.server, team);
    // A sync gives the phone its clock, which a registration needs.
    await syncAndRefresh(tester, h);
    final patientId = h.patients.patients
        .createPatient(
          Intake(
            consent: const ConsentAnswer.given(),
            preferredName: patient['preferredName']! as String,
            visualDescriptor: patient['visualDescriptor']! as String,
            usualArea: patient['usualArea']! as String,
            livingSituation: (patient['livingSituation']! as Map<String, Object?>)['kind']! as String,
            preferredLanguage: patient['preferredLanguage']! as String,
          ),
        )
        .patientId;
    final made = <String, String>{};
    for (final n in [2, 3, 4]) {
      final preset = presetOf(stepOf(n)['adds']! as String);
      made[preset['ref']! as String] = h.server.addPreset(
        team,
        preset['kind']! as String,
        asHeld(preset['body'], platformIds, made)! as Map<String, Object?>,
      );
    }
    await syncAndRefresh(tester, h);
    expect(h.server.records[patientId], isNotNull, reason: 'the patient is on the server');
    expect(h.sync.store!.outbox(), isEmpty);
    h.server.offline = true;
    return (h: h, made: made, labs: platformIds['order_category.labs']!, patientId: patientId);
  }

  Finder part(String key) => find.byKey(ValueKey('teamSetup.$key'));

  /// Scrolls Team setup's list down until [finder] is built, then into view, as a person scrolls it:
  /// the team's whole setup, the platform's presets among it, is a long list at 200% text.
  Future<void> revealInSetup(WidgetTester tester, Finder finder) async {
    if (finder.evaluate().isEmpty) {
      await tester.scrollUntilVisible(finder, 300, scrollable: find.byType(Scrollable).first, maxScrolls: 200);
    }
    await tester.ensureVisible(finder.first);
    await tester.pumpAndSettle();
  }

  Finder inSheet(Finder f) => find.descendant(of: find.byType(BottomSheet), matching: f);
  Finder inDialog(Finder f) => find.descendant(of: find.byType(Dialog), matching: f);

  for (final run in runs) {
    testWidgets('steps 7 and 8 offline: Team setup shows the item under Labs, the bundle with its line and the flag '
        'under Conditions; the flags sheet sets it with the reason, and the next sync has it accepted '
        '(${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final (:h, :made, :labs, :patientId) = await afterStep6(tester, run);
      final store = h.sync.store!;
      final before = auditEvents(store).length;

      // 7. Offline, Team setup from Home's row.
      expect([stepOf(7)['online'], stepOf(7)['by']], [false, 'staff']);
      final setup = expectAt(7)['teamSetup']! as Map<String, Object?>;
      await tapOn(tester, find.text(teamSetupTitle));
      expect(location(tester), teamSetupLocation);
      await expectScreenOk(tester);

      final item = (setup['items']! as List<Object?>).cast<Map<String, Object?>>().single;
      final category = part('category.$labs');
      await revealInSetup(tester, category);
      expect(find.descendant(of: category, matching: find.text(item['under']! as String)), findsOneWidget);
      // A group's rows are built with it: each is there, then scrolled to for the checks.
      final itemRow = find.descendant(of: category, matching: find.text(item['shows']! as String));
      expect(itemRow, findsOneWidget);
      await expectShown(tester, itemRow);
      expect(part('item.${made['glucoseTest']}'), findsOneWidget);
      await expectScreenOk(tester);

      final bundle = (setup['bundles']! as List<Object?>).cast<Map<String, Object?>>().single;
      final card = part('bundle.${made['footCheck']}');
      await revealInSetup(tester, card);
      expect(find.descendant(of: card, matching: find.text(bundle['shows']! as String)), findsOneWidget);
      final lines = (presetOf('footCheck')['body']! as Map<String, Object?>)['lines']! as List<Object?>;
      for (final (i, name) in (bundle['lines']! as List<Object?>).cast<String>().indexed) {
        final line = lines[i]! as Map<String, Object?>;
        final shown = find.descendant(
          of: card,
          matching: find.text('$name × ${line['qty']}, ${line['core'] == true ? 'core' : 'optional'}'),
        );
        expect(shown, findsOneWidget);
        await expectShown(tester, shown);
      }
      await expectScreenOk(tester);

      final flag = (setup['flags']! as List<Object?>).cast<Map<String, Object?>>().single;
      expect(flag['under'], conditionsHeading);
      final conditions = part('flags.secondary');
      await revealInSetup(tester, conditions);
      expect(find.descendant(of: conditions, matching: find.text(conditionsHeading)), findsOneWidget);
      final pill = flag['pill']! as String;
      final flagRow = find.descendant(of: conditions, matching: find.text(pill));
      expect(flagRow, findsOneWidget);
      await expectShown(tester, flagRow);
      expect(part('flag.${made['frostRisk']}'), findsOneWidget);
      await expectScreenOk(tester);
      // Presets name no patient: opening them logs nothing.
      expect(auditEvents(store), hasLength(before));

      // 8. Still offline, the patient's profile, its flags sheet: the flag under Conditions, the
      // story's reason, Save.
      final change = stepOf(8)['flagChange']! as Map<String, Object?>;
      expect(
        [stepOf(8)['online'], stepOf(8)['then'], change['flag'], change['action']],
        [false, 'online', 'frostRisk', 'set'],
      );
      await back(tester);
      await go(tester, '/patients/$patientId');
      expect(find.byType(PatientScreen), findsOneWidget);
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(OutlinedButton, changeFlagsAction));
      expect(inSheet(find.text(changeFlagsTitle)), findsOneWidget);
      await expectScreenOk(tester);
      await tapInSheet(tester, inSheet(find.text(chooseConditionsAction)));
      expect(find.byType(Dialog), findsOneWidget);
      await expectGuidelines(tester);
      // The team's conditions, the platform's among them: the story's is scrolled to, as a person would.
      await tester.ensureVisible(inDialog(find.text(pill)));
      await tester.pumpAndSettle();
      await tester.tap(inDialog(find.text(pill)));
      await tester.pumpAndSettle();
      await tester.ensureVisible(inDialog(find.text(conditionsDoneAction)));
      await tester.pumpAndSettle();
      await tester.tap(inDialog(find.text(conditionsDoneAction)));
      await settle(tester);
      final box = inSheet(find.byKey(const ValueKey('phi.flagReason')));
      await revealInSheet(tester, box);
      await tester.enterText(box, change['reason']! as String);
      // Save comes on with a reason, and its colour settles before its contrast is read.
      await tester.pumpAndSettle();
      await expectScreenOk(tester);
      await tapInSheet(tester, inSheet(find.widgetWithText(FilledButton, 'Save')));

      expect(find.byType(BottomSheet), findsNothing);
      final queued = [
        for (final e in store.outbox())
          if (e.entity == entityFlagChange) e,
      ];
      expect(
        [
          for (final e in queued) [e.op, e.value],
        ],
        [
          [
            'create',
            {
              'patientId': patientId,
              'flagId': made['frostRisk'],
              'action': change['action'],
              'reason': change['reason'],
            },
          ],
        ],
      );
      await expectShown(tester, find.text(flagsSavedText));
      // The profile's pill shows it at once, offline, as the chart will.
      final chart = expectAt(8)['chart']! as Map<String, Object?>;
      expect(chart['pill'], pill);
      await expectShown(tester, find.text(pill));
      await expectScreenOk(tester);

      // Then the phone syncs: the change is accepted, its receipt naming the hash the phone sent, and
      // the pill stays.
      h.server.offline = false;
      await syncAndRefresh(tester, h);
      final receipt = h.server.receipts[queued.single.changeId];
      expect(expectAt(8)['receipts'], {'status': 'accepted', 'hashConfirmed': true});
      expect([receipt?.status, receipt?.hash], ['accepted', queued.single.valueHash]);
      expect([store.outbox(), store.needsAttention()], [isEmpty, isEmpty]);
      await expectShown(tester, find.text(pill));
      await expectScreenOk(tester);
      handle.dispose();
    });
  }
}
