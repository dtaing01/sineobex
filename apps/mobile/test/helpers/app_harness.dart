import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/app.dart';
import 'package:sineobex_field/app_providers.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/config/env.dart';
import 'package:sineobex_field/design/tokens.dart';
import 'package:sineobex_field/features/lock/lock_screens.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../auth/fakes.dart';
import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

class AppHarness {
  AppHarness({
    DeploymentKind deployment = DeploymentKind.preview,
    this.idle = const Duration(minutes: 5),
    int teams = 1,
    this.theme,
  }) : config = AppConfig(
         apiBaseUrl: Uri.parse('https://api.invalid'),
         deployment: deployment,
         idleLockMinutes: idle.inMinutes,
       ) {
    session = SessionController(
      auth: auth,
      vault: KeyVault(store: store, biometricStore: bio, pbkdf2Iterations: 1000),
      store: store,
      fetchMe: (_) async => demoUser(teams: teams),
      localData: DeferredLocalData(() => sync),
    );
    sync = SyncController(
      session: session,
      databaseDirectory: () async => dir.path,
      deviceStore: store,
      teamApi: (teamId) => SineobexApi(server.transportFor(demoUser().userId, teamId)),
      deviceApi: SineobexApi(server.transportFor('', '')),
      boot: boot,
      platform: RegisterDevicePlatform.android,
      appVersion: '0.2.0-test',
      autoSync: false,
      now: () => wall,
      monotonic: () => boot.elapsed,
    );
    addTearDown(dispose);
  }

  final AppConfig config;
  final Duration idle;
  final FieldTheme? theme;
  final auth = FakeAuth();
  final store = MemorySecureStore();
  final bio = MemorySecureStore();
  final dir = Directory.systemTemp.createTempSync('app');
  final boot = FakeBootClock();

  /// The phone's clock, and how far the server's runs ahead of it.
  DateTime wall = DateTime.utc(2026, 10, 20, 15);
  Duration serverAhead = Duration.zero;
  late final server = FakeSyncServer(now: () => wall.add(serverAhead));
  late final SessionController session;
  late final SyncController sync;

  Widget build() => ProviderScope(
    overrides: [
      appConfigProvider.overrideWithValue(config),
      sessionProvider.overrideWithValue(session),
      syncControllerProvider.overrideWithValue(sync),
      biometricsAvailableProvider.overrideWith((ref) async => true),
      if (theme != null) themeChoiceProvider.overrideWith(() => _FixedTheme(theme!)),
    ],
    child: const SineobexApp(),
  );

  void dispose() {
    sync.dispose();
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  }
}

class _FixedTheme extends ThemeChoice {
  _FixedTheme(this.theme);
  final FieldTheme theme;
  @override
  FieldTheme? build() => theme;
}

/// Tap targets, labels and text contrast on whatever is on screen now.
Future<void> expectGuidelines(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
}

Future<void> enter(WidgetTester tester, String label, String text) async {
  await tester.enterText(find.widgetWithText(TextField, label), text);
  await tester.pump();
}

/// Scrolls [text] into view if needed, then taps it, the way a person would.
Future<void> tapText(WidgetTester tester, String text) async {
  final finder = find.text(text);
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(finder, 120, scrollable: find.byType(Scrollable).last);
  }
  await tester.ensureVisible(finder.first);
  await tester.pumpAndSettle();
  await tester.tap(finder.first);
  await tester.pumpAndSettle();
}

/// A 390 × 844 phone at 3× density, like the design system's mockups.
void usePhoneSize(WidgetTester tester) {
  tester.view.physicalSize = const Size(1170, 2532);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}
