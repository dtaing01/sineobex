import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/providers.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'core/theme/tokens.dart';
import 'data/local/database.dart';
import 'features/auth/lock_screen.dart';
import 'features/auth/session_controller.dart';
import 'features/auth/sign_in_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait-only on phones: the layout is a single 448px column, and a nurse
  // holding a phone one-handed in the field is not rotating it.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  final database = AppDatabase.platform();

  runApp(
    ProviderScope(
      overrides: [databaseProvider.overrideWithValue(database)],
      child: const SineobexApp(),
    ),
  );
}

class SineobexApp extends ConsumerStatefulWidget {
  const SineobexApp({super.key});

  @override
  ConsumerState<SineobexApp> createState() => _SineobexAppState();
}

class _SineobexAppState extends ConsumerState<SineobexApp>
    with WidgetsBindingObserver {
  final _router = buildRouter();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Backgrounding the app locks it immediately. A phone left on a van seat
    // should not show a patient chart to whoever picks it up.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      ref.read(sessionControllerProvider.notifier).lock();
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionControllerProvider);

    // Kick the sync loop when a session becomes active.
    //
    // Invalidating the API client here would rebuild SyncService without
    // anything calling start() again, leaving sync permanently stopped after
    // sign-in. The client resolves its token lazily per request, so it does
    // not need rebuilding — the drain just needs restarting.
    ref.listen(sessionControllerProvider, (previous, next) {
      if (previous?.state != next.state && next.state == SessionState.active) {
        ref.read(syncServiceProvider).start();
      }
    });

    return MaterialApp(
      title: 'Sineobex',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: switch (session.state) {
        SessionState.restoring => const _SplashScreen(),
        SessionState.signedOut ||
        SessionState.mfaRequired ||
        SessionState.newPasswordRequired => const SignInScreen(),
        SessionState.locked => const LockScreen(),
        SessionState.active => _AuthenticatedApp(router: _router),
      },
    );
  }
}

/// The routed application, wrapped in an activity listener that keeps the
/// inactivity lock honest.
class _AuthenticatedApp extends ConsumerWidget {
  const _AuthenticatedApp({required this.router});

  final RouterConfig<Object> router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bootstrap = ref.watch(bootstrapProvider);

    return bootstrap.when(
      loading: () => const _SplashScreen(),
      error: (e, _) => _ErrorScreen(error: e),
      data: (_) => Listener(
        onPointerDown: (_) =>
            ref.read(sessionControllerProvider.notifier).noteActivity(),
        child: MaterialApp.router(
          title: 'Sineobex',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          routerConfig: router,
        ),
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) => const Scaffold(
    backgroundColor: AppColors.slate50,
    body: Center(child: CircularProgressIndicator()),
  );
}

class _ErrorScreen extends StatelessWidget {
  const _ErrorScreen({required this.error});

  final Object error;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.slate50,
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.x6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Could not start',
              style: TextStyle(
                fontSize: AppText.lg,
                fontWeight: AppText.bold,
                color: AppColors.slate900,
              ),
            ),
            const SizedBox(height: AppSpace.x2),
            Text(
              '$error',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: AppText.xs,
                color: AppColors.slate500,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
