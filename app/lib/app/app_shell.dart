import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../core/router/app_router.dart';
import '../core/theme/tokens.dart';
import '../data/models/models.dart';
import '../data/sync/sync_service.dart';
import 'providers.dart';

/// The persistent chrome: sticky blurred header, animated content area, and
/// bottom navigation. Ports the outer `<div className="max-w-md …">`.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.slate50,
      body: Center(
        child: ConstrainedBox(
          // `max-w-md mx-auto border-x shadow-xl`
          constraints: const BoxConstraints(maxWidth: AppSpace.maxContentWidth),
          child: DecoratedBox(
            decoration: const BoxDecoration(
              color: AppColors.slate50,
              border: Border.symmetric(
                vertical: BorderSide(color: AppColors.slate200),
              ),
            ),
            child: Column(
              children: [
                const _AppHeader(),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    transitionBuilder: (child, animation) => FadeTransition(
                      opacity: animation,
                      child: SlideTransition(
                        position: Tween<Offset>(
                          // `initial={{ y: 10 }}` at 448px ≈ 0.02 of height
                          begin: const Offset(0, 0.02),
                          end: Offset.zero,
                        ).animate(animation),
                        child: child,
                      ),
                    ),
                    child: KeyedSubtree(
                      key: ValueKey(shell.currentIndex),
                      child: shell,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      bottomNavigationBar: _BottomNav(shell: shell),
    );
  }
}

class _AppHeader extends ConsumerWidget {
  const _AppHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final sync = ref.watch(syncStatusProvider).valueOrNull;

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
        child: Container(
          padding: EdgeInsets.only(
            top: MediaQuery.of(context).padding.top + AppSpace.x3,
            left: AppSpace.x4,
            right: AppSpace.x4,
            bottom: AppSpace.x3,
          ),
          decoration: BoxDecoration(
            color: AppColors.white.withValues(alpha: 0.8),
            border: const Border(
              bottom: BorderSide(color: AppColors.slate200),
            ),
          ),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => context.go(AppRoutes.dashboard),
                behavior: HitTestBehavior.opaque,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(AppSpace.x1_5),
                      decoration: BoxDecoration(
                        color: AppColors.blue600,
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                      ),
                      child: const Icon(
                        LucideIcons.stethoscope,
                        size: 20,
                        color: AppColors.white,
                      ),
                    ),
                    const SizedBox(width: AppSpace.x2),
                    const Text(
                      'Sineobex',
                      style: TextStyle(
                        fontSize: AppText.xl,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                        letterSpacing: AppText.tight,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              if (sync != null) _SyncIndicator(status: sync),
              const SizedBox(width: AppSpace.x2),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpace.x2,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.blue50,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                  border: Border.all(color: AppColors.blue200),
                ),
                child: const Text(
                  'Team A',
                  style: TextStyle(
                    fontSize: AppText.micro,
                    fontWeight: AppText.medium,
                    color: AppColors.blue600,
                  ),
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              _AvatarButton(initials: user.initials),
            ],
          ),
        ),
      ),
    );
  }
}

/// Offline state and pending-write count. The prototype had no concept of
/// either — but a nurse needs to know whether the chart they just wrote has
/// left the device.
class _SyncIndicator extends StatelessWidget {
  const _SyncIndicator({required this.status});

  final SyncStatus status;

  @override
  Widget build(BuildContext context) {
    if (status.state == SyncState.idle && status.pending == 0) {
      return const SizedBox.shrink();
    }

    final (icon, color) = switch (status.state) {
      SyncState.offline => (LucideIcons.cloudOff, AppColors.slate400),
      SyncState.syncing => (LucideIcons.refreshCw, AppColors.blue500),
      SyncState.error => (LucideIcons.triangleAlert, AppColors.orange500),
      SyncState.idle => (LucideIcons.cloud, AppColors.slate400),
    };

    return Tooltip(
      message: status.pending == 0
          ? 'All changes synced'
          : '${status.pending} change(s) waiting to sync',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          if (status.pending > 0) ...[
            const SizedBox(width: 2),
            Text(
              '${status.pending}',
              style: TextStyle(
                fontSize: AppText.tiny,
                fontWeight: AppText.bold,
                color: color,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AvatarButton extends StatelessWidget {
  const _AvatarButton({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    final isActive =
        GoRouterState.of(context).uri.path.startsWith(AppRoutes.profile);

    return GestureDetector(
      onTap: () => context.push(AppRoutes.profile),
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: isActive ? AppColors.blue600 : AppColors.slate200,
          shape: BoxShape.circle,
          border: Border.all(
            color: isActive ? AppColors.blue600 : AppColors.white,
            width: 2,
          ),
          boxShadow: AppShadows.sm,
        ),
        alignment: Alignment.center,
        child: Text(
          initials,
          style: TextStyle(
            fontSize: AppText.micro,
            fontWeight: AppText.bold,
            color: isActive ? AppColors.white : AppColors.slate600,
          ),
        ),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({required this.shell});

  final StatefulNavigationShell shell;

  static const _icons = [
    LucideIcons.house,
    LucideIcons.users,
    LucideIcons.map,
    LucideIcons.package,
    LucideIcons.chartColumn,
  ];

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppSpace.maxContentWidth),
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.white,
            border: Border(top: BorderSide(color: AppColors.slate200)),
          ),
          padding: EdgeInsets.only(
            top: AppSpace.x2,
            bottom: MediaQuery.of(context).padding.bottom + AppSpace.x2,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (final tab in AppTab.values)
                _NavItem(
                  icon: _icons[tab.index],
                  label: tab.label,
                  active: shell.currentIndex == tab.index,
                  onTap: () => shell.goBranch(
                    tab.index,
                    initialLocation: tab.index == shell.currentIndex,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? AppColors.blue600 : AppColors.slate400;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.x2,
          vertical: AppSpace.x2,
        ),
        child: AnimatedScale(
          // `scale-110` on the active tab
          scale: active ? 1.1 : 1.0,
          duration: const Duration(milliseconds: 150),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 22, color: color),
              const SizedBox(height: AppSpace.x1),
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  fontSize: AppText.tiny,
                  fontWeight: AppText.bold,
                  color: color,
                  letterSpacing: 0.4,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
