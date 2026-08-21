import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/theme/tokens.dart';
import '../../widgets/app_button.dart';
import 'session_controller.dart';

/// Shown after the inactivity timeout. The session and local data survive; only
/// the UI is sealed until the operator proves it is still them.
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  final _auth = LocalAuthentication();
  bool _checking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Offer biometrics immediately — one glance beats one password.
    WidgetsBinding.instance.addPostFrameCallback((_) => _authenticate());
  }

  Future<void> _authenticate() async {
    if (_checking) return;
    setState(() {
      _checking = true;
      _error = null;
    });

    try {
      final supported = await _auth.isDeviceSupported();
      if (!supported) {
        setState(
          () => _error =
              'This device has no screen lock configured. Set one up to '
              'protect patient data.',
        );
        return;
      }

      final ok = await _auth.authenticate(
        localizedReason: 'Unlock Sineobex to continue patient care',
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
          useErrorDialogs: true,
        ),
      );

      if (ok && mounted) {
        ref.read(sessionControllerProvider.notifier).unlock();
      } else if (mounted) {
        setState(() => _error = 'Unlock cancelled.');
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not unlock: $e');
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(sessionControllerProvider).user;

    return Scaffold(
      backgroundColor: AppColors.slate900,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.x6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpace.x4),
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    LucideIcons.lock,
                    size: 32,
                    color: AppColors.white,
                  ),
                ),
                const SizedBox(height: AppSpace.x6),
                const Text(
                  'Locked',
                  style: TextStyle(
                    fontSize: AppText.xxl,
                    fontWeight: AppText.bold,
                    color: AppColors.white,
                  ),
                ),
                const SizedBox(height: AppSpace.x2),
                Text(
                  user == null
                      ? 'Unlock to continue.'
                      : 'Signed in as ${user.name}.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: AppText.sm,
                    color: AppColors.white.withValues(alpha: 0.6),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpace.x4),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: AppText.xs,
                      color: AppColors.amber400,
                    ),
                  ),
                ],
                const SizedBox(height: AppSpace.x8),
                AppButton(
                  label: _checking ? 'Waiting…' : 'Unlock',
                  icon: LucideIcons.fingerprint,
                  size: AppButtonSize.lg,
                  radius: AppRadius.xl,
                  onPressed: _checking ? null : _authenticate,
                ),
                const SizedBox(height: AppSpace.x3),
                AppButton(
                  label: 'Sign out',
                  variant: AppButtonVariant.ghost,
                  foreground: AppColors.white,
                  onPressed: () =>
                      ref.read(sessionControllerProvider.notifier).signOut(),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
