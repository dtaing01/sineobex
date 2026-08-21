import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../core/util/formatting.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/map_pin.dart';
import '../../widgets/mini_map.dart';

/// Ports `HomeView`.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  /// The prototype's hardcoded outreach route through downtown Detroit.
  static const routePoints = [
    LatLng(42.3314, -83.0458),
    LatLng(42.3350, -83.0500),
    LatLng(42.3400, -83.0580),
    LatLng(42.3450, -83.0600),
    LatLng(42.3480, -83.0750),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final patients = ref.watch(patientsProvider).valueOrNull ?? const [];
    final highRisk = ref.watch(highRiskPatientsProvider);
    final followUps = ref.watch(routineFollowUpsProvider);
    final lowStock = ref.watch(lowStockProvider);
    final tasks = ref.watch(teamTasksProvider).valueOrNull ?? const [];
    final actions = ref.watch(outreachActionsProvider).valueOrNull ?? const [];
    final pendingTasks = tasks.where((t) => t.isPending).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        _Welcome(patientCount: patients.length, alertCount: lowStock.length),
        const SizedBox(height: AppSpace.x6),
        const _ModuleShortcuts(),
        const SizedBox(height: AppSpace.x6),
        _UrgentAttention(patients: highRisk),
        const SizedBox(height: AppSpace.x6),
        _RoutePreview(patients: patients),
        const SizedBox(height: AppSpace.x6),
        _TodaysActions(actions: actions),
        const SizedBox(height: AppSpace.x4),
        _TeamTasks(tasks: pendingTasks),
        const SizedBox(height: AppSpace.x6),
        _PendingFollowUps(patients: followUps),
        const SizedBox(height: AppSpace.x6),
        _InventoryAlerts(items: lowStock),
      ],
    );
  }
}

class _Welcome extends StatelessWidget {
  const _Welcome({required this.patientCount, required this.alertCount});

  final int patientCount;
  final int alertCount;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Coordination Hub',
          style: TextStyle(
            fontSize: AppText.xxl,
            fontWeight: AppText.bold,
            color: AppColors.slate900,
            letterSpacing: AppText.tight,
          ),
        ),
        Text(
          // Live, unlike the prototype's hardcoded "Saturday, April 11".
          '${Fmt.dashboardDate(DateTime.now())} • Team A',
          style: const TextStyle(
            fontSize: AppText.sm,
            color: AppColors.slate500,
          ),
        ),
        const SizedBox(height: AppSpace.x4),
        Row(
          children: [
            Expanded(
              child: AppCard(
                onTap: () => context.go(AppRoutes.patients),
                background: AppColors.blue600,
                borderColor: null,
                shadows: AppShadows.blueGlow,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Icon(
                          LucideIcons.users,
                          size: 20,
                          color: AppColors.white.withValues(alpha: 0.8),
                        ),
                        AppBadge(
                          'Care',
                          background: AppColors.white.withValues(alpha: 0.2),
                          foreground: AppColors.white,
                          fontSize: AppText.micro,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.x2),
                    Text(
                      '$patientCount',
                      style: const TextStyle(
                        fontSize: AppText.xxxl,
                        fontWeight: AppText.bold,
                        color: AppColors.white,
                        height: 1.1,
                      ),
                    ),
                    Text(
                      'ACTIVE PATIENTS',
                      style: TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.white.withValues(alpha: 0.8),
                        letterSpacing: AppText.wider,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: AppSpace.x3),
            Expanded(
              child: AppCard(
                onTap: () => goToMapLayer(context, MapLayer.inventory),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Icon(
                          LucideIcons.circleAlert,
                          size: 20,
                          color: AppColors.orange500,
                        ),
                        AppBadge.outline(
                          '$alertCount Alerts',
                          color: AppColors.orange600,
                          border: AppColors.orange200,
                          fontSize: AppText.micro,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.x2),
                    Text(
                      '$alertCount',
                      style: const TextStyle(
                        fontSize: AppText.xxxl,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                        height: 1.1,
                      ),
                    ),
                    const Text(
                      'SUPPLY ALERTS',
                      style: TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.slate400,
                        letterSpacing: AppText.wider,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _ModuleShortcuts extends StatelessWidget {
  const _ModuleShortcuts();

  @override
  Widget build(BuildContext context) {
    Widget tile(IconData icon, Color color, String label, VoidCallback onTap) =>
        Expanded(
          child: AppCard(
            onTap: onTap,
            padding: const EdgeInsets.symmetric(vertical: AppSpace.x3),
            borderColor: AppColors.slate100,
            radius: AppRadius.xxl,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(height: AppSpace.x1),
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: AppText.tiny,
                    fontWeight: AppText.bold,
                    color: AppColors.slate700,
                  ),
                ),
              ],
            ),
          ),
        );

    return Row(
      children: [
        tile(
          LucideIcons.map,
          AppColors.blue500,
          'Map',
          () => context.go(AppRoutes.map),
        ),
        const SizedBox(width: AppSpace.x2),
        tile(
          LucideIcons.chartColumn,
          AppColors.purple500,
          'Insights',
          () => context.go(AppRoutes.insights),
        ),
        const SizedBox(width: AppSpace.x2),
        // The prototype labelled this "Alerts" but routed to the patient list.
        // It now opens the follow-up alerts screen it always named.
        tile(
          LucideIcons.calendar,
          AppColors.green500,
          'Alerts',
          () => context.push(AppRoutes.followUps),
        ),
      ],
    );
  }
}

class _UrgentAttention extends StatelessWidget {
  const _UrgentAttention({required this.patients});

  final List<Patient> patients;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Urgent Attention',
          trailing: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpace.x2,
              vertical: 1,
            ),
            decoration: BoxDecoration(
              color: AppColors.red50,
              borderRadius: BorderRadius.circular(AppRadius.full),
            ),
            child: const Text(
              'IMMEDIATE',
              style: TextStyle(
                fontSize: AppText.micro,
                fontWeight: AppText.bold,
                color: AppColors.red500,
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpace.x3),
        if (patients.isEmpty)
          const Text(
            'No high-risk patients flagged.',
            style: TextStyle(
              fontSize: AppText.xs,
              color: AppColors.slate400,
              fontStyle: FontStyle.italic,
            ),
          ),
        for (final p in patients) ...[
          AppCard(
            onTap: () => context.go(AppRoutes.patientDetail(p.id)),
            leftRailColor: AppColors.red500,
            child: Row(
              children: [
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
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const AppBadge(
                      'High Risk',
                      background: AppColors.red100,
                      foreground: AppColors.red700,
                    ),
                    const SizedBox(height: AppSpace.x1),
                    Text(
                      p.history.isEmpty
                          ? 'Awaiting first encounter'
                          : p.history.first.needs,
                      style: const TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.medium,
                        color: AppColors.slate400,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
      ],
    );
  }
}

class _RoutePreview extends StatelessWidget {
  const _RoutePreview({required this.patients});

  final List<Patient> patients;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Route Preview'),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          padding: EdgeInsets.zero,
          clip: true,
          shadows: AppShadows.sm,
          child: Column(
            children: [
              SizedBox(
                height: 160,
                child: Stack(
                  children: [
                    // Interaction disabled, matching the prototype's
                    // dragging/touchZoom/scrollWheelZoom={false}.
                    FlutterMap(
                      options: const MapOptions(
                        initialCenter: detroitCenter,
                        initialZoom: 13,
                        interactionOptions: InteractionOptions(
                          flags: InteractiveFlag.none,
                        ),
                      ),
                      children: [
                        const OsmTileLayer(),
                        PolylineLayer(
                          polylines: [
                            dashedRoute(
                              DashboardScreen.routePoints,
                              color: AppColors.orange500,
                              strokeWidth: 2,
                              pattern: const [5, 5],
                              opacity: 0.4,
                            ),
                          ],
                        ),
                        MarkerLayer(
                          markers: [
                            for (final p in patients)
                              Marker(
                                point: p.position,
                                width: 12,
                                height: 15,
                                alignment: Alignment.topCenter,
                                child: MapPin.risk(
                                  p.risk,
                                  size: 12,
                                  dot: false,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                    Positioned.fill(
                      child: GestureDetector(
                        behavior: HitTestBehavior.translucent,
                        onTap: () => goToMapLayer(context, MapLayer.patients),
                      ),
                    ),
                    const Positioned(
                      top: AppSpace.x2,
                      right: AppSpace.x2,
                      child: MapLegend.compact(
                        entries: [
                          MapLegendEntry(
                            label: 'High Risk',
                            color: AppColors.red500,
                            dotSize: 6,
                            fontSize: AppText.xxs,
                          ),
                          MapLegendEntry(
                            label: 'Moderate',
                            color: AppColors.amber500,
                            dotSize: 6,
                            fontSize: AppText.xxs,
                          ),
                        ],
                      ),
                    ),
                    const Positioned(
                      bottom: 0,
                      left: 0,
                      child: MapAttribution(),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x3),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${patients.length} Active Cases in Field',
                      style: const TextStyle(
                        fontSize: AppText.xs,
                        fontWeight: AppText.bold,
                        color: AppColors.slate700,
                      ),
                    ),
                    AppButton(
                      label: 'View Full Map',
                      uppercase: true,
                      size: AppButtonSize.sm,
                      variant: AppButtonVariant.ghost,
                      foreground: AppColors.blue600,
                      onPressed: () => context.go(AppRoutes.map),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TodaysActions extends StatelessWidget {
  const _TodaysActions({required this.actions});

  final List<OutreachAction> actions;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader("Today's Actions"),
        const SizedBox(height: AppSpace.x3),
        for (final a in actions) ...[
          Container(
            padding: const EdgeInsets.all(AppSpace.x3),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.slate100),
            ),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(AppSpace.x2),
                  decoration: BoxDecoration(
                    color: AppColors.slate100,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                  ),
                  child: Text(
                    a.time,
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.bold,
                      color: AppColors.slate600,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpace.x3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        a.goal,
                        style: const TextStyle(
                          fontSize: AppText.xs,
                          fontWeight: AppText.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      Text(
                        a.location,
                        style: const TextStyle(
                          fontSize: AppText.micro,
                          color: AppColors.slate500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
      ],
    );
  }
}

class _TeamTasks extends ConsumerWidget {
  const _TeamTasks({required this.tasks});

  final List<TeamTask> tasks;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Team Tasks'),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var i = 0; i < tasks.length; i++)
                Container(
                  padding: const EdgeInsets.all(AppSpace.x3),
                  decoration: BoxDecoration(
                    border: i == tasks.length - 1
                        ? null
                        : const Border(
                            bottom: BorderSide(color: AppColors.slate50),
                          ),
                  ),
                  child: Row(
                    children: [
                      GestureDetector(
                        onTap: () async {
                          await ref
                              .read(teamRepositoryProvider)
                              .toggleTask(tasks[i].id);
                          ref.invalidate(teamTasksProvider);
                        },
                        child: Container(
                          width: 20,
                          height: 20,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            border: Border.all(
                              color: AppColors.slate200,
                              width: 2,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpace.x3),
                      Expanded(
                        child: Text(
                          tasks[i].text,
                          style: const TextStyle(
                            fontSize: AppText.xs,
                            fontWeight: AppText.medium,
                            color: AppColors.slate700,
                          ),
                        ),
                      ),
                      if (tasks[i].priority == TaskPriority.high)
                        const StatusDot(color: AppColors.red500),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _PendingFollowUps extends StatelessWidget {
  const _PendingFollowUps({required this.patients});

  final List<Patient> patients;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Pending Follow-ups'),
        const SizedBox(height: AppSpace.x3),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: patients.length,
            separatorBuilder: (_, __) => const SizedBox(width: AppSpace.x2),
            itemBuilder: (_, i) {
              final p = patients[i];
              return SizedBox(
                width: 140,
                child: AppCard(
                  onTap: () => context.go(AppRoutes.patientDetail(p.id)),
                  padding: const EdgeInsets.all(AppSpace.x3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        p.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: AppText.xs,
                          fontWeight: AppText.bold,
                          color: AppColors.slate900,
                        ),
                      ),
                      Text(
                        p.loc,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: AppText.micro,
                          color: AppColors.slate500,
                        ),
                      ),
                      const SizedBox(height: AppSpace.x2),
                      const AppBadge('Routine', fontSize: AppText.xxs),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _InventoryAlerts extends ConsumerWidget {
  const _InventoryAlerts({required this.items});

  final List<InventoryItem> items;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repo = ref.watch(inventoryRepositoryProvider);
    final user = ref.watch(currentUserProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Inventory Alerts'),
        const SizedBox(height: AppSpace.x3),
        for (final item in items) ...[
          Container(
            padding: const EdgeInsets.all(AppSpace.x3),
            decoration: BoxDecoration(
              color: AppColors.orange50,
              borderRadius: BorderRadius.circular(AppRadius.xl),
              border: Border.all(color: AppColors.orange100),
            ),
            child: Row(
              children: [
                const Icon(
                  LucideIcons.package,
                  size: 14,
                  color: AppColors.orange600,
                ),
                const SizedBox(width: AppSpace.x2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: AppText.micro,
                          fontWeight: AppText.bold,
                          color: AppColors.orange900,
                        ),
                      ),
                      Text(
                        '${item.stock} left',
                        style: const TextStyle(
                          fontSize: AppText.micro,
                          color: AppColors.orange700,
                        ),
                      ),
                      const SizedBox(height: AppSpace.x1),
                      if (item.isOnOrder)
                        Text(
                          'Ordered: ${item.orderedAtLabel} by ${item.orderedBy}',
                          style: const TextStyle(
                            fontSize: AppText.xxs,
                            fontWeight: AppText.bold,
                            color: AppColors.blue600,
                            height: 1.2,
                          ),
                        )
                      else
                        const Text(
                          'NEED TO ORDER',
                          style: TextStyle(
                            fontSize: AppText.xxs,
                            fontWeight: AppText.bold,
                            color: AppColors.red600,
                            letterSpacing: AppText.tighter,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.x2),
                if (item.isOnOrder)
                  AppButton(
                    label: 'Mark Received',
                    uppercase: true,
                    size: AppButtonSize.sm,
                    fontSize: AppText.xxs,
                    variant: AppButtonVariant.outline,
                    foreground: AppColors.blue700,
                    borderColor: AppColors.blue200,
                    background: AppColors.transparent,
                    onPressed: () => repo.markReceived(item.id),
                  )
                else
                  AppButton(
                    label: 'Mark Ordered',
                    uppercase: true,
                    size: AppButtonSize.sm,
                    fontSize: AppText.xxs,
                    variant: AppButtonVariant.outline,
                    foreground: AppColors.orange700,
                    borderColor: AppColors.orange200,
                    background: AppColors.transparent,
                    onPressed: () => repo.markOrdered(item.id, user.name),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
      ],
    );
  }
}
