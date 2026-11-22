import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/design/theme.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/design/widgets/flag_pill.dart';
import 'package:sineobex_field/features/encounters/home_tiles.dart' show EncounterTiles;
import 'package:sineobex_field/features/presets/team_setup_screen.dart';
import 'package:sineobex_field/features/sync/sync_cards.dart' show SyncStatusCard;
import 'package:sineobex_field/patients/patient_providers.dart' show PatientServices;
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart' show RefreshReason;

import '../../auth/fakes.dart';
import '../../sync/fake_server.dart';
import '../encounters/encounter_kit.dart';

/// **Team setup** (phase 5 design 8.2; card P2-setup-screen): Home's row under phase 4's tiles opens
/// the team's presets as the phone holds them, read only, naming no patient and logging nothing:
/// the Orders items by category, the bundles with their lines and the flags by tier, each active
/// one, and when the copy was updated. Before the team's first pull it says to connect; offline it
/// shows the copy held. A flag is drawn by its pill, "Red · High", never by colour alone. Three
/// themes, 200% text, 320 wide.
void main() {
  const team = 'team-0';

  /// A team's presets of every kind a phone holds, as its admin and the installer left them: some
  /// removed, a sensitive flag among the conditions. By name, their IDs.
  Map<String, String> holdEveryKind(FakeSyncServer server) {
    final ids = <String, String>{};
    String add(String ref, String kind, Map<String, Object?> body) => ids[ref] = server.addPreset(team, kind, body);
    Map<String, Object?> item(String name, String category, String unit, {bool medical = false, Object? result}) => {
      'name': name,
      'categoryId': ids[category],
      'unit': unit,
      'medical': medical,
      'captureLot': false,
      'result': result,
    };
    Map<String, Object?> flag(String name, String tier, String color, int rank, {bool sensitive = false}) => {
      'name': name,
      'tier': tier,
      'criteria': '',
      'color': color,
      'rank': rank,
      'sensitive': sensitive,
    };

    add('supplies', 'order_category', {'name': 'Supplies', 'behaviour': 'supply', 'sort': 40});
    add('labs', 'order_category', {'name': 'Labs', 'behaviour': 'lab', 'sort': 30});
    add('otc', 'order_category', {'name': 'OTC', 'behaviour': 'medication', 'sort': 10});
    // Holds no active item, so it has no group.
    add('shelf', 'order_category', {'name': 'Demo: Empty shelf', 'behaviour': 'supply', 'sort': 5});
    add('oldCategory', 'order_category', {'name': 'Demo: Old category', 'behaviour': 'supply', 'sort': 1});
    server.archivePreset(team, ids['oldCategory']!);

    add(
      'glucose',
      'item',
      item('Demo: Glucose test', 'labs', 'test', medical: true, result: {'type': 'number', 'unit': 'mg/dL'}),
    );
    add(
      'pregnancyTest',
      'item',
      item(
        'Demo: Pregnancy test',
        'labs',
        'test',
        medical: true,
        result: {
          'type': 'choice',
          'options': ['Positive', 'Negative'],
        },
      ),
    );
    add('acetaminophen', 'item', {...item('Demo: Acetaminophen', 'otc', 'tablet', medical: true), 'captureLot': true});
    add('socks', 'item', item('demo: wool socks', 'supplies', 'pair'));
    add('gauze', 'item', item('Demo: Gauze', 'supplies', 'each'));
    add('oldDressing', 'item', item('Demo: Old dressing', 'supplies', 'each'));
    server.archivePreset(team, ids['oldDressing']!);

    add('footCheck', 'bundle', {
      'name': 'Demo: Foot check',
      'medical': true,
      'prompt': 'Demo: look at both feet before giving this bundle.',
      'lines': [
        {'itemId': ids['glucose'], 'qty': 1, 'core': true},
        {'itemId': ids['gauze'], 'qty': 2, 'core': false},
        {'itemId': ids['oldDressing'], 'qty': 1, 'core': false},
      ],
    });
    add('rainyNight', 'bundle', {
      'name': 'Demo: Rainy night',
      'medical': false,
      'prompt': '',
      'lines': [
        {'itemId': ids['socks'], 'qty': 1, 'core': true},
      ],
    });
    add('oldBundle', 'bundle', {
      'name': 'Demo: Old bundle',
      'medical': false,
      'prompt': '',
      'lines': [
        {'itemId': ids['gauze'], 'qty': 1, 'core': true},
      ],
    });
    server.archivePreset(team, ids['oldBundle']!);

    add('low', 'flag', flag('Demo: Low', 'primary', 'green', 30));
    add('high', 'flag', {...flag('Demo: High', 'primary', 'red', 10), 'criteria': 'Demo: left hospital this week.'});
    add('medium', 'flag', flag('Demo: Medium', 'primary', 'yellow', 20));
    add('frostRisk', 'flag', {
      ...flag('Demo: Frost risk', 'secondary', 'teal', 40),
      'criteria': 'Demo: sleeps outside on nights below freezing.',
    });
    add('pregnancy', 'flag', flag('Demo: Pregnancy', 'secondary', 'purple', 30, sensitive: true));
    add('oldFlag', 'flag', flag('Demo: Old flag', 'secondary', 'grey', 10));
    server.archivePreset(team, ids['oldFlag']!);

    // The kinds Team setup doesn't list.
    add('woundMap', 'field_supply_map', {
      'name': 'Demo: Wound dressing',
      'noteTypeKey': 'wound_care',
      'lines': [
        {'itemId': ids['gauze'], 'qty': 1},
      ],
    });
    add('rashMap', 'condition_supply_map', {
      'name': 'Demo: Rash supplies',
      'codes': ['R21'],
      'lines': [
        {'itemId': ids['gauze'], 'qtyPerPatient': 1},
      ],
    });
    add('bag', 'bag', {
      'name': 'Demo: Bag A',
      'minimums': [
        {'itemId': ids['gauze'], 'min': 10},
      ],
    });
    add('settings', 'settings', {
      'name': 'Team settings',
      'bagMinimumsOn': true,
      'newBagMinimums': <Object?>[],
      'problemCheckDays': 90,
    });
    return ids;
  }

  /// A time as the screen words one.
  const time = r'\d{1,2}:\d{2}\s?[AP]M';
  final updatedToday = RegExp('^Updated $time\$');

  /// A part of the screen by its key: a category's group, a bundle, a tier, a flag.
  Finder part(String key) => find.byKey(ValueKey('teamSetup.$key'));

  /// Opens Team setup from Home's row, as a person would.
  Future<void> openTeamSetup(WidgetTester tester) async {
    await tapOn(tester, find.text(teamSetupTitle));
    expect(location(tester), teamSetupLocation);
    expect(find.widgetWithText(AppBar, teamSetupTitle), findsOneWidget);
  }

  /// A sync that reached the server, with the team's refreshers after it.
  Future<Map<String, String>> pulledEveryKind(WidgetTester tester, AppHarness h) async {
    final ids = holdEveryKind(h.server);
    await syncAndRefresh(tester, h);
    expect(PresetStore(h.sync.store!).preset(ids['frostRisk']!), isNotNull);
    return ids;
  }

  for (final run in runs) {
    testWidgets('from Home, offline: the items by category, the bundles with their lines, the flags by tier '
        '(${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
      final ids = await pulledEveryKind(tester, h);
      h.server.offline = true;
      final store = h.sync.store!;
      final before = auditEvents(store).length;

      await expectShown(tester, find.text(teamSetupTitle));
      await expectScreenOk(tester);
      await openTeamSetup(tester);
      await expectShown(tester, find.textContaining(updatedToday));
      await expectScreenOk(tester);

      final labs = part('category.${ids['labs']}');
      await reveal(tester, labs);
      expect(find.descendant(of: labs, matching: find.text('Labs')), findsOneWidget);
      expect(find.descendant(of: labs, matching: find.text('Demo: Glucose test')), findsOneWidget);
      expect(
        find.descendant(of: labs, matching: find.text('Counted in test · Medical · Records a number in mg/dL')),
        findsOneWidget,
      );
      await expectScreenOk(tester);

      final foot = part('bundle.${ids['footCheck']}');
      await reveal(tester, foot);
      expect(find.descendant(of: foot, matching: find.text('Demo: Foot check')), findsOneWidget);
      expect(find.descendant(of: foot, matching: find.text('Demo: Glucose test × 1, core')), findsOneWidget);
      await expectScreenOk(tester);

      final conditions = part('flags.secondary');
      await reveal(tester, conditions);
      expect(find.descendant(of: conditions, matching: find.text('Conditions')), findsOneWidget);
      expect(find.descendant(of: conditions, matching: find.text('Teal · Demo: Frost risk')), findsOneWidget);
      await reveal(tester, find.text('Demo: sleeps outside on nights below freezing.'));
      await expectScreenOk(tester);

      // Presets name no patient: opening them logs nothing.
      expect(auditEvents(store), hasLength(before));
      handle.dispose();
    });
  }

  testWidgets('a screen reader hears each part in order: the sections and their groups as headings, an item '
      'with what it is, a bundle with its lines, a flag by its colour’s name and its own', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    h.server.offline = true;
    await openTeamSetup(tester);
    // Tall enough for the whole list to be built at once.
    tester.view.physicalSize = const Size(1170, 3 * 6000);
    await tester.pumpAndSettle();
    final order = readingOrder(tester);
    final from = order.indexOf('[H] $ordersHeading');
    expect(from, greaterThan(0));
    expect(order.sublist(from), [
      '[H] Orders',
      '[H] OTC',
      'Demo: Acetaminophen, Counted in tablet, Medical, Lot and expiry',
      '[H] Labs',
      'Demo: Glucose test, Counted in test, Medical, Records a number in mg/dL',
      'Demo: Pregnancy test, Counted in test, Medical, Records a choice',
      '[H] Supplies',
      'Demo: Gauze, Counted in each, Non-Medical',
      // Whatever its case, A to Z.
      'demo: wool socks, Counted in pair, Non-Medical',
      '[H] Bundles',
      '[H] Demo: Foot check',
      'Medical, 3 items, 2 optional, Asks before applying',
      'Demo: Glucose test, quantity 1, core',
      'Demo: Gauze, quantity 2, optional',
      'Demo: Old dressing, quantity 1, optional, no longer on the team’s list',
      '[H] Demo: Rainy night',
      'Non-Medical, 1 item',
      'demo: wool socks, quantity 1, core',
      '[H] Flags',
      '[H] Risk level',
      'Red, Demo: High',
      'Demo: left hospital this week.',
      'Yellow, Demo: Medium',
      'Green, Demo: Low',
      '[H] Conditions',
      'Purple, Demo: Pregnancy\nSensitive',
      'Teal, Demo: Frost risk',
      'Demo: sleeps outside on nights below freezing.',
    ]);
    handle.dispose();
  });

  testWidgets('a team holding every kind: a removed preset, a map, a bag and the settings are not listed, and an item '
      'whose category isn’t held is under Other items', (tester) async {
    final h = await signIn(tester);
    final ids = holdEveryKind(h.server);
    // Its category is no preset of the team's.
    final stray = h.server.addPreset(team, 'item', {
      'name': 'Demo: Stray item',
      'categoryId': '0a0a0a0a-0000-4000-8000-00000000000a',
      'unit': 'each',
      'medical': false,
      'captureLot': false,
      'result': null,
    });
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    final held = PresetStore(h.sync.store!).presets();
    expect({for (final p in held) p.kind}, PresetKind.values.toSet(), reason: 'the phone holds every kind');
    expect(held.where((p) => p.state == PresetState.archived), hasLength(4));
    await openTeamSetup(tester);
    tester.view.physicalSize = const Size(1170, 3 * 6000);
    await tester.pumpAndSettle();

    for (final removed in ['Demo: Old category', 'Demo: Old bundle', 'Demo: Old flag', 'Grey · Demo: Old flag']) {
      expect(find.textContaining(removed), findsNothing, reason: removed);
    }
    // A removed item shows only on the line that names it.
    expect(find.text('Demo: Old dressing'), findsNothing);
    expect(find.text('Demo: Old dressing × 1, optional · no longer on the team’s list'), findsOneWidget);
    expect(part('category.${ids['shelf']}'), findsNothing, reason: 'a category with no active item has no group');
    for (final unlisted in ['Demo: Wound dressing', 'Demo: Rash supplies', 'Demo: Bag A', 'Team settings']) {
      expect(find.textContaining(unlisted), findsNothing, reason: unlisted);
    }
    final other = part('category.other');
    expect(find.descendant(of: other, matching: find.text(otherItemsHeading)), findsOneWidget);
    expect(find.descendant(of: other, matching: find.text('Demo: Stray item')), findsOneWidget);
    expect(part('item.$stray'), findsOneWidget);
    // Other items come after every category in its place.
    expect(tester.getTopLeft(other).dy, greaterThan(tester.getTopLeft(part('category.${ids['supplies']}')).dy));
  });

  testWidgets('before the team’s first pull it says to connect; once a sync reaches the server it shows the copy', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final h = await signInOffline(tester);
    holdEveryKind(h.server);
    expect(PresetStore(h.sync.store!).downloaded, isFalse);
    await expectShown(tester, find.text(teamSetupTitle));
    await openTeamSetup(tester);
    await expectShown(tester, find.text(setupNotDownloaded));
    expect(tester.getSemantics(find.text(setupNotDownloaded)), isSemantics(isLiveRegion: true));
    expect(find.text(ordersHeading), findsNothing);
    expect(find.textContaining(updatedToday), findsNothing);
    await expectScreenOk(tester);

    // Offline, the pull to refresh asks and fails: still nothing held.
    await pullToRefresh(tester);
    expect(find.text(setupNotDownloaded), findsOneWidget);

    h.server.offline = false;
    await syncAndRefresh(tester, h);
    expect(find.text(setupNotDownloaded), findsNothing);
    await expectShown(tester, find.textContaining(updatedToday));
    await expectShown(tester, find.text('Demo: Glucose test'));
    await expectScreenOk(tester);
    handle.dispose();
  });

  testWidgets('a team that holds no preset says so in each part, its copy downloaded all the same', (tester) async {
    final h = await signIn(tester);
    // The team has taken no revision: the pull answers revision 0 under the nil epoch (6.1).
    await syncAndRefresh(tester, h);
    h.server.offline = true;
    expect(PresetStore(h.sync.store!).downloaded, isTrue);
    await openTeamSetup(tester);
    await expectShown(tester, find.textContaining(updatedToday));
    for (final empty in [noItemsText, noBundlesText, noRiskLevelsText, noConditionsText]) {
      await expectShown(tester, find.text(empty));
    }
    expect(find.text(setupNotDownloaded), findsNothing);
  });

  testWidgets('a copy the team’s refusal cleared says to connect again', (tester) async {
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    h.server.offline = true;
    await openTeamSetup(tester);
    await expectShown(tester, find.text('Demo: Glucose test'));
    // As the pull's 403 not_a_member clears it (6.1); the screen hears the controller's next run.
    PresetStore(h.sync.store!).clear();
    await tester.runAsync(() => h.sync.refreshNow(reason: RefreshReason.manual));
    await tester.pumpAndSettle();
    expect(find.text(setupNotDownloaded), findsOneWidget);
    expect(find.text('Demo: Glucose test'), findsNothing);
  });

  testWidgets('online, pull to refresh brings what the admin added at the desk', (tester) async {
    final h = await signIn(tester);
    final ids = await pulledEveryKind(tester, h);
    await openTeamSetup(tester);
    expect(find.text('Demo: Pulse oximeter'), findsNothing);
    h.server.addPreset(team, 'item', {
      'name': 'Demo: Pulse oximeter',
      'categoryId': ids['supplies'],
      'unit': 'each',
      'medical': true,
      'captureLot': false,
      'result': null,
    });
    await pullToRefresh(tester);
    await expectShown(tester, find.text('Demo: Pulse oximeter'));
    expect(
      find.descendant(of: part('category.${ids['supplies']}'), matching: find.text('Demo: Pulse oximeter')),
      findsOneWidget,
    );
  });

  testWidgets('online, a pull to refresh that finds the team index a week old still shows the copy', (tester) async {
    // Healthcare Staff hold the team index. Its 7-day expiry clears every server copy, the presets
    // among them; the presets' pull, after the index's refresher in the same run, brings them back.
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    final index = PatientServices.of(h.sync.store!)!.index;
    expect(index.state.present, isTrue);
    await openTeamSetup(tester);
    expect(find.textContaining(updatedToday), findsOneWidget);
    final weekOld = h.wall.subtract(const Duration(days: 8));
    h.sync.store!.setKv('index.refreshedAt', weekOld.toIso8601String());
    await pullToRefresh(tester);
    expect(index.state.present, isTrue);
    expect(index.state.refreshedAt!.isAfter(weekOld), isTrue, reason: 'the run downloaded the index again');
    expect(find.text(setupNotDownloaded), findsNothing);
    await expectShown(tester, find.text('Demo: Glucose test'));
  });

  testWidgets('a copy from another day says the day it was updated', (tester) async {
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    h.server.offline = true;
    // A day and an hour pass, by the phone's clock and its time since boot alike.
    const d = Duration(hours: 25);
    h
      ..wall = h.wall.add(d)
      ..boot.advance(d);
    await openTeamSetup(tester);
    await expectShown(tester, find.textContaining(RegExp('^Updated [A-Z][a-z]{2} \\d{1,2} at $time\$')));
    expect(find.textContaining(updatedToday), findsNothing);
  });

  for (final (role, permissions, sees) in [
    ('Healthcare Staff', FakeSyncServer.healthcareStaff.toList(), true),
    ('a CHW', FakeSyncServer.chw.toList(), false),
    (
      'Billing/Data',
      ['patients.view', 'billing.view_codes', 'inventory.view', 'exports.billing', 'exports.grant'],
      false,
    ),
    // A custom role with the key but no problem list (12.1, risk 6): the server's projection sees no
    // sensitive problem for it, so no sensitive flag either.
    ('a custom role with patients.view_sensitive alone', ['patients.view', 'patients.view_sensitive'], false),
  ]) {
    testWidgets('a sensitive flag is listed, marked, only to a person who may see a sensitive problem ($role)', (
      tester,
    ) async {
      final h = await signIn(tester, permissions: permissions);
      await pulledEveryKind(tester, h);
      h.server.offline = true;
      await openTeamSetup(tester);
      tester.view.physicalSize = const Size(1170, 3 * 6000);
      await tester.pumpAndSettle();
      expect(find.text('Purple · Demo: Pregnancy'), sees ? findsOneWidget : findsNothing);
      expect(find.text(sensitiveFlagText), sees ? findsOneWidget : findsNothing);
      // Every other flag shows to every role, and so does the rest of the team's setup.
      expect(find.text('Teal · Demo: Frost risk'), findsOneWidget);
      expect(find.text('Red · Demo: High'), findsOneWidget);
      expect(find.text('Demo: Glucose test'), findsOneWidget);
    });
  }

  testWidgets('while the team is handed over nothing of it shows, and Home has no row to it', (tester) async {
    const frozen = 'Your access to this team ended.';
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    h.server.offline = true;
    await openTeamSetup(tester);
    await expectShown(tester, find.text('Demo: Glucose test'));
    h.sync.store!.freeze(frozen);
    await tester.runAsync(() => h.sync.refreshNow(reason: RefreshReason.manual));
    await tester.pumpAndSettle();
    expect(find.text(frozen), findsOneWidget);
    for (final shown in ['Demo: Glucose test', ordersHeading, 'Teal · Demo: Frost risk']) {
      expect(find.text(shown), findsNothing, reason: shown);
    }
    expect(find.textContaining(updatedToday), findsNothing);
    expect(tester.takeException(), isNull);

    await back(tester);
    expect(location(tester), '/');
    expect(find.text(teamSetupTitle), findsNothing);
  });

  testWidgets('Home’s row sits below phase 4’s tiles and the sync card, before Lock now, names itself to a screen '
      'reader and opens Team setup by its tap action', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signIn(tester);
    await pulledEveryKind(tester, h);
    h.server.offline = true;
    final row = find.bySemanticsLabel(RegExp('^$teamSetupTitle\n$teamSetupRowDetail\$'));
    await reveal(tester, row);
    expect(tester.getSemantics(row), isSemantics(isButton: true, hasTapAction: true));
    double top(Finder f) => tester.getTopLeft(f).dy;
    double bottom(Finder f) => tester.getBottomLeft(f).dy;
    expect(top(row), greaterThanOrEqualTo(bottom(find.byType(EncounterTiles, skipOffstage: false))));
    expect(top(row), greaterThanOrEqualTo(bottom(find.byType(SyncStatusCard, skipOffstage: false))));
    expect(bottom(row), lessThanOrEqualTo(top(find.text('Lock now', skipOffstage: false))));
    await semanticTap(tester, RegExp('^$teamSetupTitle\n'));
    expect(location(tester), teamSetupLocation);
    await expectShown(tester, find.text('Demo: Glucose test'));
    handle.dispose();
  });

  group('the flag pill', () {
    testWidgets('reads the colour’s name, then the flag’s, and says them to a screen reader without the dot', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      for (final theme in FieldTheme.values) {
        await tester.pumpWidget(
          MaterialApp(
            theme: buildFieldTheme(theme),
            home: Scaffold(
              body: Wrap(
                children: [
                  for (final color in FlagColor.values)
                    FlagPill.of(
                      FlagBody(
                        name: 'Demo: ${color.colorName} flag',
                        tier: FlagTier.secondary,
                        criteria: '',
                        color: color,
                        rank: 0,
                        sensitive: false,
                      ),
                    ),
                  // A colour a later palette names, which this phone doesn't know.
                  const FlagPill(name: 'Demo: Later flag', colorName: 'Magenta'),
                ],
              ),
            ),
          ),
        );
        for (final color in FlagColor.values) {
          final name = 'Demo: ${color.colorName} flag';
          expect(find.text('${color.colorName} · $name'), findsOneWidget);
          expect(find.bySemanticsLabel('${color.colorName}, $name'), findsOneWidget);
        }
        expect(find.text('Magenta · Demo: Later flag'), findsOneWidget);
        expect(find.bySemanticsLabel('Magenta, Demo: Later flag'), findsOneWidget);
        await expectGuidelines(tester);
      }
      handle.dispose();
    });

    for (final theme in FieldTheme.values) {
      final palette = FieldPalette(FieldColors.of(theme), theme);
      final c = palette.colors;
      final minimum = theme == FieldTheme.contrast ? 7.0 : 4.5;
      test('in ${theme.name}, each colour’s words meet $minimum:1 on its fill and its edge 3:1 on the ground and '
          'the surface', () {
        for (final color in [...FlagColor.values, null]) {
          final t = flagPillColors(palette, color);
          expect(contrast(t.fg, t.bg), greaterThanOrEqualTo(minimum), reason: '$color');
          expect(contrast(t.border, c.ground), greaterThanOrEqualTo(3), reason: '$color');
          expect(contrast(t.border, c.surface), greaterThanOrEqualTo(3), reason: '$color');
        }
      });
    }

    test('grey and a colour the phone doesn’t know are drawn as the neutral chip; no two colours share a fill', () {
      for (final theme in FieldTheme.values) {
        final palette = FieldPalette(FieldColors.of(theme), theme);
        expect(flagPillColors(palette, null), flagPillColors(palette, FlagColor.grey));
        final fills = {for (final color in FlagColor.values) flagPillColors(palette, color).bg};
        expect(fills, hasLength(FlagColor.values.length), reason: theme.name);
      }
    });
  });
}

/// Signs in as Healthcare Staff with the server out of reach from the start: the team opens
/// offline, as a team first opened offline after a sign-out does.
Future<AppHarness> signInOffline(WidgetTester tester) async {
  usePhoneSize(tester);
  final h = AppHarness(permissions: FakeSyncServer.healthcareStaff.toList())
    ..wall = fixtureNow
    ..server.offline = true;
  await tester.pumpWidget(h.build());
  await tester.pumpAndSettle();
  await enter(tester, 'Email', 'clinician@example.com');
  await enter(tester, 'Password', validPassword);
  await tapText(tester, 'Continue');
  await enter(tester, '6-digit code', validCode);
  await tapText(tester, 'Sign in');
  await enter(tester, 'New PIN', '482913');
  await enter(tester, 'Type it again', '482913');
  await tapText(tester, 'Save PIN');
  await tester.runAsync(h.sync.ready);
  await tester.pumpAndSettle();
  return h;
}

/// A pull down from the top of the screen's list, and what it set off.
Future<void> pullToRefresh(WidgetTester tester) async {
  await tester.fling(find.byType(Scrollable).first, const Offset(0, 400), 1000);
  await tester.pump();
  await tester.pump(const Duration(seconds: 1));
  await settle(tester);
}

/// WCAG 2.x contrast, as test/design/contrast_test.dart works it out.
double contrast(Color a, Color b) {
  double luminance(Color c) {
    double channel(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  }

  final la = luminance(a);
  final lb = luminance(b);
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}
