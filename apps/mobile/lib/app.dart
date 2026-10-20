import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'app_providers.dart';
import 'auth/session_controller.dart';
import 'design/theme.dart';
import 'design/tokens.dart';
import 'design/widgets/demo_banner.dart';
import 'features/home/home_screen.dart';
import 'features/lock/lock_screens.dart';
import 'features/sign_in/sign_in_screens.dart';
import 'features/sync/needs_attention_screen.dart';
import 'security/idle_lock.dart';

export 'app_providers.dart' show appConfigProvider;

/// The user's theme choice from settings; null follows the system.
class ThemeChoice extends Notifier<FieldTheme?> {
  @override
  FieldTheme? build() => null;
  void choose(FieldTheme? theme) => state = theme;
}

final themeChoiceProvider = NotifierProvider<ThemeChoice, FieldTheme?>(ThemeChoice.new);

/// Where each session state lives. Anything else redirects here, so a deep link can never land on
/// a screen with patient data while the app is locked.
String? sessionRoute(SessionState s) => switch (s) {
  Starting() => '/starting',
  SignedOut() => '/sign-in',
  AwaitingMfa() => '/sign-in/code',
  AwaitingEnrollment() => '/sign-in/authenticator',
  NeedsPin() => '/pin',
  Locked() => '/unlock',
  Unlocked(:final user) when user.team == null => '/team',
  Unlocked() => null,
};

const _gateRoutes = {'/starting', '/sign-in', '/sign-in/code', '/sign-in/authenticator', '/pin', '/unlock', '/team'};

final routerProvider = Provider<GoRouter>((ref) {
  final session = ref.watch(sessionProvider);
  final router = GoRouter(
    initialLocation: '/starting',
    refreshListenable: session,
    redirect: (context, state) {
      final required = sessionRoute(session.state);
      final here = state.matchedLocation;
      if (required != null) return here == required ? null : required;
      return _gateRoutes.contains(here) ? '/' : null;
    },
    routes: [
      GoRoute(
        path: '/starting',
        builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(path: '/sign-in', builder: (_, _) => const SignInScreen()),
      GoRoute(path: '/sign-in/code', builder: (_, _) => const MfaScreen()),
      GoRoute(path: '/sign-in/authenticator', builder: (_, _) => const EnrollScreen()),
      GoRoute(path: '/pin', builder: (_, _) => const PinSetupScreen()),
      GoRoute(path: '/unlock', builder: (_, _) => const UnlockScreen()),
      GoRoute(path: '/team', builder: (_, _) => const TeamPickerScreen()),
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      GoRoute(path: '/attention', builder: (_, _) => const NeedsAttentionScreen()),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

class SineobexApp extends ConsumerStatefulWidget {
  const SineobexApp({super.key});
  @override
  ConsumerState<SineobexApp> createState() => _SineobexAppState();
}

class _SineobexAppState extends ConsumerState<SineobexApp> {
  // Coming back to the foreground: the phone may have slept, or someone may have changed its clock.
  late final _lifecycle = AppLifecycleListener(
    onResume: () => unawaited(ref.read(syncControllerProvider).checkClock()),
  );

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _lifecycle;
    // The sync controller follows the session from the first state on (it checks for a remote
    // wipe while the app sits at the lock screen).
    ref.read(syncControllerProvider);
    unawaited(ref.read(sessionProvider).start());
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(appConfigProvider);
    final choice = ref.watch(themeChoiceProvider);
    final router = ref.watch(routerProvider);
    final session = ref.watch(sessionProvider);
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
      builder: (context, child) => IdleLock(
        session: session,
        idle: config.idleLock,
        child: DemoFrame(enabled: config.isDemo, child: child ?? const SizedBox.shrink()),
      ),
    );
  }
}
