import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'app_providers.dart';
import 'auth/session_controller.dart';
import 'design/theme.dart';
import 'design/tokens.dart';
import 'design/widgets/demo_banner.dart';
import 'features/home/home_screen.dart';
import 'features/lock/lock_screens.dart';
import 'features/patients/add_problem_screen.dart';
import 'features/patients/id_card_screen.dart';
import 'features/patients/intake_screen.dart';
import 'features/patients/patient_screen.dart';
import 'features/patients/patient_widgets.dart' show IntakeStart, TypedDetails;
import 'features/patients/patients_screen.dart';
import 'features/patients/problem_screen.dart';
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
      // The tabs (design 12.1). Start, Schedule and Resources arrive with their phases.
      ShellRoute(
        builder: (context, state, child) => TabShell(location: state.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
          GoRoute(
            path: '/patients',
            builder: (_, state) => PatientsScreen(focusSearch: state.extra == PatientsScreen.fromTabBar),
          ),
        ],
      ),
      GoRoute(path: '/attention', builder: (_, _) => const NeedsAttentionScreen()),
      // Patient routes carry UUIDs only (D12); what a screen needs beyond the ID travels in `extra`,
      // never in the location.
      GoRoute(
        path: '/patients/new',
        builder: (_, state) => IntakeScreen(start: state.extra is IntakeStart ? state.extra! as IntakeStart : null),
      ),
      GoRoute(
        path: '/patients/:id',
        builder: (_, state) => PatientScreen(
          patientId: state.pathParameters['id']!,
          typed: state.extra is TypedDetails ? state.extra! as TypedDetails : null,
        ),
      ),
      GoRoute(
        path: '/patients/:id/edit',
        builder: (_, state) => IntakeScreen(editing: state.pathParameters['id']),
      ),
      GoRoute(
        path: '/patients/:id/card',
        builder: (_, state) => IdCardScreen(patientId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/patients/:id/problems/new',
        builder: (_, state) => AddProblemScreen(patientId: state.pathParameters['id']!),
      ),
      GoRoute(
        path: '/patients/:id/problems/:problemId',
        builder: (_, state) =>
            ProblemScreen(patientId: state.pathParameters['id']!, problemId: state.pathParameters['problemId']!),
      ),
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
    onPause: () => ref.read(syncControllerProvider).suspendClock(),
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

/// The bottom navigation: Home and Patients. Opening Patients from the bar focuses its search.
class TabShell extends StatelessWidget {
  const TabShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final index = location.startsWith('/patients') ? 1 : 0;
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) {
          if (i == index) return;
          if (i == 0) {
            context.go('/');
          } else {
            context.go('/patients', extra: PatientsScreen.fromTabBar);
          }
        },
        destinations: const [
          NavigationDestination(icon: Icon(LucideIcons.house), label: 'Home'),
          NavigationDestination(icon: Icon(LucideIcons.users), label: 'Patients'),
        ],
      ),
    );
  }
}
