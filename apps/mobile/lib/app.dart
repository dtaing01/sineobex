import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'config/env.dart';
import 'design/theme.dart';
import 'design/tokens.dart';
import 'design/widgets/demo_banner.dart';
import 'features/home/home_screen.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig.fromEnvironment());

/// The user's theme choice from settings; null follows the system.
class ThemeChoice extends Notifier<FieldTheme?> {
  @override
  FieldTheme? build() => null;
  void choose(FieldTheme? theme) => state = theme;
}

final themeChoiceProvider = NotifierProvider<ThemeChoice, FieldTheme?>(ThemeChoice.new);

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    routes: [GoRoute(path: '/', builder: (context, state) => const HomeScreen())],
  );
});

class SineobexApp extends ConsumerWidget {
  const SineobexApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(appConfigProvider);
    final choice = ref.watch(themeChoiceProvider);
    final router = ref.watch(routerProvider);
    final platform = MediaQuery.platformBrightnessOf(context);
    final highContrast = MediaQuery.highContrastOf(context);
    final theme = resolveFieldTheme(
      userChoice: choice,
      platformHighContrast: highContrast,
      platformBrightness: platform,
    );

    return MaterialApp.router(
      // A generic title: the app switcher and accessibility services never see patient details.
      title: 'Sineobex',
      debugShowCheckedModeBanner: false,
      theme: buildFieldTheme(theme),
      routerConfig: router,
      builder: (context, child) => DemoFrame(enabled: config.isDemo, child: child ?? const SizedBox.shrink()),
    );
  }
}
