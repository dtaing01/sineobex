import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/env/app_config.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/formatting.dart';
import '../../widgets/app_card.dart';
import '../auth/session_controller.dart';

/// Ports `ProfileView`.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final sync = ref.watch(syncStatusProvider).valueOrNull;

    return Scaffold(
      backgroundColor: AppColors.slate50,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: AppSpace.maxContentWidth,
            ),
            child: ListView(
              padding: const EdgeInsets.all(AppSpace.x4),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    icon: const Icon(LucideIcons.chevronLeft),
                    color: AppColors.slate600,
                    onPressed: () => context.pop(),
                  ),
                ),
                const SizedBox(height: AppSpace.x4),
                Column(
                  children: [
                    Stack(
                      children: [
                        Container(
                          width: 96,
                          height: 96,
                          decoration: BoxDecoration(
                            color: AppColors.blue100,
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: AppColors.white,
                              width: 4,
                            ),
                            boxShadow: AppShadows.lg,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            user.initials,
                            style: const TextStyle(
                              fontSize: AppText.xxxl,
                              fontWeight: AppText.bold,
                              color: AppColors.blue600,
                            ),
                          ),
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: Container(
                            padding: const EdgeInsets.all(AppSpace.x1_5),
                            decoration: BoxDecoration(
                              color: AppColors.blue600,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: AppColors.white,
                                width: 2,
                              ),
                            ),
                            child: const Icon(
                              LucideIcons.user,
                              size: 14,
                              color: AppColors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.x4),
                    Text(
                      user.name,
                      style: const TextStyle(
                        fontSize: AppText.xxl,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          user.role.toUpperCase(),
                          style: const TextStyle(
                            fontSize: AppText.sm,
                            fontWeight: AppText.bold,
                            color: AppColors.blue600,
                            letterSpacing: AppText.wider,
                          ),
                        ),
                        if (user.isAdmin) ...[
                          const SizedBox(width: AppSpace.x1),
                          const Icon(
                            LucideIcons.shield,
                            size: 12,
                            color: AppColors.blue600,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: AppSpace.x6),
                if (user.isAdmin) ...[
                  const Padding(
                    padding: EdgeInsets.only(left: AppSpace.x1),
                    child: SectionHeader('Admin Control Center'),
                  ),
                  const SizedBox(height: AppSpace.x3),
                  AppCard(
                    onTap: () => context.push(AppRoutes.teamAccess),
                    background: AppColors.blue600,
                    borderColor: null,
                    shadows: AppShadows.blueGlow,
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(AppSpace.x2),
                          decoration: BoxDecoration(
                            color: AppColors.white.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(AppRadius.md),
                          ),
                          child: const Icon(
                            LucideIcons.users,
                            size: 20,
                            color: AppColors.white,
                          ),
                        ),
                        const SizedBox(width: AppSpace.x3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Manage Team Access',
                                style: TextStyle(
                                  fontSize: AppText.sm,
                                  fontWeight: AppText.bold,
                                  color: AppColors.white,
                                ),
                              ),
                              Text(
                                'Control permissions & active members',
                                style: TextStyle(
                                  fontSize: AppText.micro,
                                  fontStyle: FontStyle.italic,
                                  color: AppColors.blue100.withValues(
                                    alpha: 0.9,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Icon(
                          LucideIcons.chevronRight,
                          size: 20,
                          color: AppColors.white,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.x6),
                ],
                const Padding(
                  padding: EdgeInsets.only(left: AppSpace.x1),
                  child: SectionHeader('Professional Identity'),
                ),
                const SizedBox(height: AppSpace.x3),
                AppCard(
                  padding: EdgeInsets.zero,
                  child: Column(
                    children: [
                      _IdentityRow(
                        icon: LucideIcons.fileText,
                        label: 'Agency',
                        value: user.agency,
                      ),
                      const Divider(color: AppColors.slate100),
                      _IdentityRow(
                        icon: LucideIcons.mail,
                        label: 'Email Address',
                        value: user.email,
                      ),
                      const Divider(color: AppColors.slate100),
                      _IdentityRow(
                        icon: LucideIcons.briefcase,
                        label: 'Current Assignment',
                        value: user.team,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.x6),
                const Padding(
                  padding: EdgeInsets.only(left: AppSpace.x1),
                  child: SectionHeader('Account & Security'),
                ),
                const SizedBox(height: AppSpace.x3),
                _ActionRow(
                  icon: LucideIcons.shield,
                  label: 'Security Settings',
                  onTap: () => _showSecuritySheet(context),
                ),
                const SizedBox(height: AppSpace.x2),
                _ActionRow(
                  icon: LucideIcons.bell,
                  label: 'Notification Prefs',
                  onTap: () => _todo(context),
                ),
                const SizedBox(height: AppSpace.x2),
                _ActionRow(
                  icon: LucideIcons.messageSquare,
                  label: 'App Feedback',
                  onTap: () => _todo(context),
                ),
                const SizedBox(height: AppSpace.x2),
                _ActionRow(
                  icon: LucideIcons.logOut,
                  label: 'Log Out',
                  color: AppColors.red600,
                  onTap: () => _confirmSignOut(context, ref),
                ),
                const SizedBox(height: AppSpace.x6),
                Column(
                  children: [
                    Text(
                      'SINEOBEX V${AppConfig.appVersion}',
                      style: const TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.slate400,
                        letterSpacing: AppText.widest,
                      ),
                    ),
                    const SizedBox(height: AppSpace.x1),
                    Text(
                      sync?.lastSyncedAt == null
                          ? 'Not yet synced'
                          : 'Last Sync: Today at '
                                '${Fmt.time12(sync!.lastSyncedAt!)}',
                      style: const TextStyle(
                        fontSize: AppText.tiny,
                        color: AppColors.slate300,
                      ),
                    ),
                    if (sync != null && sync.pending > 0) ...[
                      const SizedBox(height: AppSpace.x1),
                      Text(
                        '${sync.pending} change(s) waiting to sync',
                        style: const TextStyle(
                          fontSize: AppText.tiny,
                          color: AppColors.orange600,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpace.x6),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static void _todo(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Not available in this build.')),
    );
  }

  static void _showSecuritySheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.xxl),
        ),
      ),
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.x5),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Security',
                style: TextStyle(
                  fontSize: AppText.lg,
                  fontWeight: AppText.bold,
                  color: AppColors.slate900,
                ),
              ),
              const SizedBox(height: AppSpace.x3),
              _SecurityFact(
                icon: LucideIcons.lock,
                text:
                    'Patient data on this device is encrypted with '
                    'SQLCipher. The key lives in the secure enclave.',
              ),
              _SecurityFact(
                icon: LucideIcons.clock,
                text:
                    'The app locks automatically after '
                    '${AppConfig.inactivityLockTimeout.inMinutes} minutes of '
                    'inactivity.',
              ),
              _SecurityFact(
                icon: LucideIcons.fileText,
                text:
                    'Every chart you open and every note you write is '
                    'recorded in the audit log.',
              ),
              _SecurityFact(
                icon: LucideIcons.trash2,
                text:
                    'Signing out erases all patient data stored on this '
                    'device.',
              ),
            ],
          ),
        ),
      ),
    );
  }

  static Future<void> _confirmSignOut(
    BuildContext context,
    WidgetRef ref,
  ) async {
    final pending = ref.read(syncStatusProvider).valueOrNull?.pending ?? 0;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Log out?'),
        content: Text(
          pending > 0
              ? 'You have $pending unsynced change(s). Logging out erases all '
                    'patient data on this device, and those changes will be '
                    'lost. Connect to a network and sync first.'
              : 'Logging out erases all patient data stored on this device. '
                    'Your synced records are unaffected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.red600),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await ref.read(sessionControllerProvider.notifier).signOut();
  }
}

class _SecurityFact extends StatelessWidget {
  const _SecurityFact({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpace.x3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: AppColors.slate400),
        const SizedBox(width: AppSpace.x3),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: AppText.xs,
              color: AppColors.slate600,
              height: 1.5,
            ),
          ),
        ),
      ],
    ),
  );
}

class _IdentityRow extends StatelessWidget {
  const _IdentityRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppSpace.x4),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpace.x2),
            decoration: BoxDecoration(
              color: AppColors.slate50,
              borderRadius: BorderRadius.circular(AppRadius.md),
            ),
            child: Icon(icon, size: 18, color: AppColors.slate400),
          ),
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FieldLabel(label),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: AppText.sm,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = AppColors.slate600,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      borderColor: AppColors.slate100,
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: AppText.sm,
                fontWeight: AppText.bold,
                color: color,
              ),
            ),
          ),
          const Icon(
            LucideIcons.chevronRight,
            size: 16,
            color: AppColors.slate300,
          ),
        ],
      ),
    );
  }
}
