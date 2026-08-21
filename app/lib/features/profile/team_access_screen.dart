import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';

/// Ports `MemberManagementView`.
class TeamAccessScreen extends ConsumerWidget {
  const TeamAccessScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final members = ref.watch(teamMembersProvider).valueOrNull ?? const [];
    final user = ref.watch(currentUserProvider);

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
                Row(
                  children: [
                    AppIconButton(
                      icon: LucideIcons.chevronLeft,
                      background: AppColors.transparent,
                      foreground: AppColors.slate600,
                      size: 32,
                      onPressed: () => context.pop(),
                    ),
                    const SizedBox(width: AppSpace.x3),
                    const Text(
                      'Team Access',
                      style: TextStyle(
                        fontSize: AppText.xl,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpace.x6),
                Container(
                  padding: const EdgeInsets.all(AppSpace.x4),
                  decoration: BoxDecoration(
                    color: AppColors.blue50,
                    borderRadius: BorderRadius.circular(AppRadius.xxl),
                    border: Border.all(color: AppColors.blue100),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        LucideIcons.shield,
                        size: 20,
                        color: AppColors.blue600,
                      ),
                      const SizedBox(width: AppSpace.x3),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Admin Authority Enabled',
                              style: TextStyle(
                                fontSize: AppText.xs,
                                fontWeight: AppText.bold,
                                color: AppColors.blue900,
                              ),
                            ),
                            const SizedBox(height: AppSpace.x1),
                            RichText(
                              text: TextSpan(
                                style: const TextStyle(
                                  fontSize: AppText.micro,
                                  color: AppColors.blue700,
                                  height: 1.6,
                                  fontFamily: AppText.family,
                                ),
                                children: [
                                  const TextSpan(
                                    text: 'You are managing access for ',
                                  ),
                                  TextSpan(
                                    text: user.agency,
                                    style: const TextStyle(
                                      fontWeight: AppText.bold,
                                    ),
                                  ),
                                  const TextSpan(
                                    text:
                                        '. You can revoke credentials or '
                                        'update permissions at any time.',
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpace.x6),
                for (final m in members) ...[
                  _MemberCard(member: m),
                  const SizedBox(height: AppSpace.x3),
                ],
                const SizedBox(height: AppSpace.x3),
                AppButton(
                  label: 'Provision New Member',
                  icon: LucideIcons.plus,
                  size: AppButtonSize.lg,
                  expanded: true,
                  radius: AppRadius.xl,
                  variant: AppButtonVariant.white,
                  onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Provisioning creates a Cognito user and requires a '
                        'configured backend.',
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpace.x6),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MemberCard extends ConsumerWidget {
  const _MemberCard({required this.member});

  final TeamMember member;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AppCard(
      opacity: member.isActive ? 1.0 : 0.6,
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: member.isActive ? AppColors.slate100 : AppColors.slate200,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              member.initials,
              style: TextStyle(
                fontSize: AppText.sm,
                fontWeight: AppText.bold,
                color: member.isActive
                    ? AppColors.slate600
                    : AppColors.slate400,
              ),
            ),
          ),
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        member.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: AppText.sm,
                          fontWeight: AppText.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                    ),
                    if (member.isSelf) ...[
                      const SizedBox(width: AppSpace.x1),
                      const AppBadge(
                        'You',
                        background: AppColors.blue100,
                        foreground: AppColors.blue600,
                        fontSize: AppText.xxs,
                      ),
                    ],
                  ],
                ),
                RichText(
                  overflow: TextOverflow.ellipsis,
                  text: TextSpan(
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      color: AppColors.slate500,
                      fontFamily: AppText.family,
                    ),
                    children: [
                      TextSpan(text: '${member.role} • '),
                      TextSpan(
                        text: '${member.access.label} Access',
                        style: const TextStyle(fontWeight: AppText.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // An admin cannot deactivate themselves.
          if (!member.isSelf)
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                AppBadge.outline(
                  member.status.label,
                  color: member.isActive
                      ? AppColors.green700
                      : AppColors.slate500,
                  border: member.isActive
                      ? AppColors.green200
                      : AppColors.slate200,
                  fill: member.isActive
                      ? AppColors.green100
                      : AppColors.slate100,
                  fontSize: AppText.xxs,
                ),
                const SizedBox(height: AppSpace.x2),
                GestureDetector(
                  onTap: () async {
                    await ref
                        .read(teamRepositoryProvider)
                        .toggleStatus(member.id);
                    ref.invalidate(teamMembersProvider);
                  },
                  child: Text(
                    member.isActive ? 'DEACTIVATE' : 'RESTORE',
                    style: const TextStyle(
                      fontSize: AppText.tiny,
                      fontWeight: AppText.bold,
                      color: AppColors.blue600,
                      decoration: TextDecoration.underline,
                      letterSpacing: AppText.tight,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
