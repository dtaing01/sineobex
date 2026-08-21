import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';

/// Ports `FollowUpsView`.
///
/// The prototype implemented this screen in full but never routed to it — no
/// tab, no button, no link (plan defect D2). It is reachable here from the
/// dashboard's "Alerts" shortcut, which is what that button always claimed to
/// open.
class FollowUpsScreen extends ConsumerWidget {
  const FollowUpsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final followUps = ref.watch(allFollowUpsProvider);

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
                    const SizedBox(width: AppSpace.x2),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Follow-up Alerts',
                            style: TextStyle(
                              fontSize: AppText.xxl,
                              fontWeight: AppText.bold,
                              color: AppColors.slate900,
                            ),
                          ),
                          Text(
                            'Patients requiring outreach attention.',
                            style: TextStyle(
                              fontSize: AppText.sm,
                              color: AppColors.slate500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpace.x6),
                if (followUps.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpace.x8),
                    child: Text(
                      'No follow-ups outstanding.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: AppText.xs,
                        color: AppColors.slate400,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                for (final p in followUps) ...[
                  AppCard(
                    onTap: () => context.go(AppRoutes.patientDetail(p.id)),
                    leftRailColor: AppColors.blue500,
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: const BoxDecoration(
                            color: AppColors.blue50,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            LucideIcons.calendar,
                            size: 20,
                            color: AppColors.blue600,
                          ),
                        ),
                        const SizedBox(width: AppSpace.x3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                p.name,
                                style: const TextStyle(
                                  fontSize: AppText.base,
                                  fontWeight: AppText.bold,
                                  color: AppColors.slate900,
                                ),
                              ),
                              Row(
                                children: [
                                  const Icon(
                                    LucideIcons.mapPin,
                                    size: 12,
                                    color: AppColors.slate500,
                                  ),
                                  const SizedBox(width: AppSpace.x1),
                                  Flexible(
                                    child: Text(
                                      p.loc,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: AppText.xs,
                                        color: AppColors.slate500,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        AppButton(
                          label: 'View Chart',
                          uppercase: true,
                          size: AppButtonSize.sm,
                          variant: AppButtonVariant.outline,
                          onPressed: () =>
                              context.go(AppRoutes.patientDetail(p.id)),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpace.x4),
                ],
                const SizedBox(height: AppSpace.x2),
                AppCard(
                  background: AppColors.slate900,
                  borderColor: null,
                  padding: const EdgeInsets.all(AppSpace.x6),
                  child: Column(
                    children: [
                      Text(
                        'TEAM REMINDER',
                        style: TextStyle(
                          fontSize: AppText.sm,
                          fontWeight: AppText.bold,
                          color: AppColors.white.withValues(alpha: 0.7),
                          letterSpacing: AppText.widest,
                        ),
                      ),
                      const SizedBox(height: AppSpace.x2),
                      const Text(
                        'Ensure all follow-ups are documented before shift '
                        'end at 18:00.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: AppText.lg,
                          fontWeight: AppText.medium,
                          color: AppColors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
