import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_card.dart';
import '../../widgets/insight_card.dart';
import '../../widgets/mini_map.dart';
import 'map_screen.dart';

/// The bottom half of the Map screen: a banner, a list, and an insight card,
/// each specific to the active layer.

class PatientsLayerPanel extends StatelessWidget {
  const PatientsLayerPanel({super.key, required this.patients});

  final List<Patient> patients;

  @override
  Widget build(BuildContext context) {
    final route = MapScreen.routes[MapLayer.patients]!;
    final miles = routeMiles(route);
    // Roughly 20 minutes per stop plus walking time — replaces the
    // prototype's hardcoded "5 Patients • 1.4 miles • 3h est."
    final hours = (route.length * 20 + miles * 20) / 60;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Route Planning'),
        const SizedBox(height: AppSpace.x3),
        ActionBanner(
          title: 'Patient Outreach Route',
          subtitle:
              '${route.length} Stops • '
              '${miles.toStringAsFixed(1)} miles • '
              '${hours.toStringAsFixed(1)}h est.',
          icon: LucideIcons.navigation,
          background: AppColors.blue600,
          actionLabel: 'Start',
        ),
        const SizedBox(height: AppSpace.x6),
        const SectionHeader('Priority Patients in Area'),
        const SizedBox(height: AppSpace.x3),
        // Reads the live patient list. The prototype read MOCK_DATA directly
        // here, so newly enrolled patients never appeared (plan defect D6).
        for (final p in patients.take(4)) ...[
          _ListRow(
            leading: _Dot(color: _riskDotColor(p.risk)),
            title: p.name,
            subtitle: p.loc,
            trailing: AppBadge.outline(
              '${p.risk.label} Risk',
              color: AppColors.slate600,
              border: AppColors.slate200,
              fontSize: AppText.xxs,
            ),
            onTap: () => context.go(AppRoutes.patientDetail(p.id)),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        const SizedBox(height: AppSpace.x4),
        const InsightCard.blue(
          title: 'Clinical Insight',
          body:
              'High concentration of wound care needs in **Cass Corridor**. '
              'Ensure Van 1 is stocked with extra silver sulfadiazine.',
          icon: LucideIcons.circleAlert,
        ),
      ],
    );
  }

  static Color _riskDotColor(RiskLevel risk) => switch (risk) {
    RiskLevel.high => AppColors.red500,
    _ => AppColors.orange500,
  };
}

class ResourcesLayerPanel extends StatelessWidget {
  const ResourcesLayerPanel({super.key, required this.resources});

  final List<FieldResource> resources;

  @override
  Widget build(BuildContext context) {
    final shelters = resources
        .where((r) => r.type == ResourceType.shelter)
        .length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Resource Logistics'),
        const SizedBox(height: AppSpace.x3),
        ActionBanner(
          title: 'Shelter Referral Loop',
          subtitle: '$shelters Partners • Bed availability check',
          icon: LucideIcons.house,
          background: AppColors.green600,
          actionLabel: 'Sync',
        ),
        const SizedBox(height: AppSpace.x6),
        const SectionHeader('Nearby Partner Facilities'),
        const SizedBox(height: AppSpace.x3),
        for (final r in resources.take(4)) ...[
          _ListRow(
            leading: Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: AppColors.green50,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.green100),
              ),
              alignment: Alignment.center,
              child: Text(
                r.type.emoji,
                style: const TextStyle(fontSize: AppText.xs),
              ),
            ),
            title: r.name,
            // The prototype used `text-slate-50` here — near-white on a white
            // card, so the hours were invisible (plan defect D4).
            subtitle: r.hours,
            trailing: AppBadge.outline(
              r.type.label,
              color: AppColors.green600,
              border: AppColors.green200,
              fontSize: AppText.xxs,
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        const SizedBox(height: AppSpace.x4),
        const InsightCard.green(
          title: 'Resource Insight',
          body:
              'Pharmacy desert identified in **Delray**; nearest partner is '
              '1.2 miles away. Consider mobile pharmacy stop on Tuesday.',
          icon: LucideIcons.info,
        ),
      ],
    );
  }
}

class HeatmapLayerPanel extends StatelessWidget {
  const HeatmapLayerPanel({super.key, required this.hotspots});

  final List<Hotspot> hotspots;

  @override
  Widget build(BuildContext context) {
    final clusters = hotspots
        .where((h) => h.intensity == Intensity.high)
        .length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Epidemiology Route'),
        const SizedBox(height: AppSpace.x3),
        ActionBanner(
          title: 'Outbreak Surveillance',
          subtitle: '$clusters Clusters • Screening focus',
          icon: LucideIcons.trendingUp,
          background: AppColors.amber600,
          actionLabel: 'View',
        ),
        const SizedBox(height: AppSpace.x6),
        const SectionHeader('Health Risk Hotspots'),
        const SizedBox(height: AppSpace.x3),
        for (final h in hotspots.take(4)) ...[
          _ListRow(
            leading: _Dot(
              color: h.type.isInfectious
                  ? AppColors.red500
                  : AppColors.amber500,
            ),
            title: h.name,
            subtitle: h.type.label,
            trailing: AppBadge.outline(
              '${h.intensity.label} Risk',
              color: AppColors.slate600,
              border: AppColors.slate200,
              fontSize: AppText.xxs,
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        const SizedBox(height: AppSpace.x4),
        const InsightCard.orange(
          title: 'Strategic Insight',
          body:
              'Rising cluster detected near **Michigan & Trumbull**. No '
              'partner services within 0.5 miles. Recommend adding a water '
              'drop-off point.',
          icon: LucideIcons.circleAlert,
        ),
      ],
    );
  }
}

class InventoryLayerPanel extends StatelessWidget {
  const InventoryLayerPanel({super.key, required this.hotspots});

  final List<Hotspot> hotspots;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Supply Logistics'),
        const SizedBox(height: AppSpace.x3),
        ActionBanner(
          title: 'Restock Route',
          subtitle: '${hotspots.length} Items • Van 2 Optimization',
          icon: LucideIcons.package,
          background: AppColors.purple600,
          actionLabel: 'Restock',
        ),
        const SizedBox(height: AppSpace.x6),
        const SectionHeader('Supply Distribution Points'),
        const SizedBox(height: AppSpace.x3),
        for (final h in hotspots.take(4)) ...[
          _ListRow(
            leading: const _Dot(color: AppColors.purple500),
            title: h.name,
            subtitle: 'Item: ${h.supply ?? '—'}',
            trailing: AppBadge.outline(
              '${h.intensity.label} Usage',
              color: AppColors.purple600,
              border: AppColors.purple200,
              fontSize: AppText.xxs,
            ),
          ),
          const SizedBox(height: AppSpace.x2),
        ],
        const SizedBox(height: AppSpace.x4),
        const InsightCard.purple(
          title: 'Inventory Insight',
          body:
              'Narcan usage is 40% higher than average in **Hart Plaza** '
              'this week. Recommend shifting 20% of inventory to Van 2 for '
              'this route.',
          icon: LucideIcons.trendingUp,
        ),
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: 8,
    height: 8,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}

/// The white pill row shared by every layer panel's list.
class _ListRow extends StatelessWidget {
  const _ListRow({
    required this.leading,
    required this.title,
    required this.subtitle,
    required this.trailing,
    this.onTap,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final Widget trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpace.x3),
      borderColor: AppColors.slate100,
      child: Row(
        children: [
          leading,
          const SizedBox(width: AppSpace.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: AppText.xs,
                    fontWeight: AppText.bold,
                    color: AppColors.slate900,
                  ),
                ),
                Text(
                  subtitle,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: AppText.micro,
                    color: AppColors.slate500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.x2),
          trailing,
        ],
      ),
    );
  }
}
