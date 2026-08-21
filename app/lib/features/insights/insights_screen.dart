import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/router/app_router.dart';
import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';
import '../../widgets/app_badge.dart';
import '../../widgets/app_button.dart';
import '../../widgets/app_card.dart';
import '../../widgets/insight_card.dart';
import '../../widgets/progress_bar.dart';
import 'charts.dart';

/// Ports `InsightsView`.
class InsightsScreen extends ConsumerWidget {
  const InsightsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final insights = ref.watch(insightsProvider);

    return insights.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.x6),
          child: Text(
            'Could not load insights: $e',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: AppText.sm,
              color: AppColors.slate500,
            ),
          ),
        ),
      ),
      data: (bundle) => _InsightsBody(bundle: bundle),
    );
  }
}

class _InsightsBody extends StatelessWidget {
  const _InsightsBody({required this.bundle});

  final InsightsBundle bundle;

  @override
  Widget build(BuildContext context) {
    final currentMonth = DateFormat('MMM').format(DateTime.now());

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x4,
        AppSpace.x8,
      ),
      children: [
        _Header(),
        const SizedBox(height: AppSpace.x4),
        _ImpactGrid(metrics: bundle.impactMetrics),
        const SizedBox(height: AppSpace.x6),
        _SeasonalDemandSection(
          data: bundle.seasonalDemand,
          currentMonth: currentMonth,
        ),
        const SizedBox(height: AppSpace.x6),
        _OutreachVolume(bundle: bundle),
        const SizedBox(height: AppSpace.x6),
        _ContinuitySection(bundle: bundle),
        const SizedBox(height: AppSpace.x6),
        _RegionUsageSection(data: bundle.regionUsage),
        const SizedBox(height: AppSpace.x6),
        _GrantReporting(bundle: bundle),
        const SizedBox(height: AppSpace.x6),
        InsightCard.blue(
          title: 'Rising Need Alert',
          body: bundle.risingNeedAlert,
          icon: LucideIcons.trendingUp,
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        const Flexible(
          child: Text(
            'Program Insights',
            style: TextStyle(
              fontSize: AppText.xxl,
              fontWeight: AppText.bold,
              color: AppColors.slate900,
            ),
          ),
        ),
        Row(
          children: [
            AppButton(
              label: 'View Heatmap',
              icon: LucideIcons.map,
              uppercase: true,
              size: AppButtonSize.sm,
              variant: AppButtonVariant.outline,
              foreground: AppColors.amber600,
              borderColor: AppColors.amber200,
              onPressed: () => goToMapLayer(context, MapLayer.heatmap),
            ),
            const SizedBox(width: AppSpace.x2),
            AppButton(
              label: 'Grant Report',
              icon: LucideIcons.save,
              uppercase: true,
              size: AppButtonSize.sm,
              variant: AppButtonVariant.outline,
              foreground: AppColors.blue600,
              borderColor: AppColors.blue200,
              onPressed: () => _notImplemented(context),
            ),
          ],
        ),
      ],
    );
  }
}

void _notImplemented(BuildContext context) {
  ScaffoldMessenger.of(context).showSnackBar(
    const SnackBar(
      content: Text('Grant report export requires a configured backend.'),
    ),
  );
}

class _ImpactGrid extends StatelessWidget {
  const _ImpactGrid({required this.metrics});

  final List<ImpactMetric> metrics;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: AppSpace.x3,
      mainAxisSpacing: AppSpace.x3,
      childAspectRatio: 2.1,
      children: [
        for (final m in metrics)
          AppCard(
            borderColor: AppColors.slate100,
            shadows: AppShadows.sm,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                FieldLabel(m.label),
                const SizedBox(height: AppSpace.x1),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      m.value,
                      style: const TextStyle(
                        fontSize: AppText.xl,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                    const SizedBox(width: AppSpace.x2),
                    Text(
                      m.trend,
                      style: const TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.green600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _SeasonalDemandSection extends StatelessWidget {
  const _SeasonalDemandSection({
    required this.data,
    required this.currentMonth,
  });

  final List<SeasonalDemand> data;
  final String currentMonth;

  @override
  Widget build(BuildContext context) {
    final thisMonth =
        data.where((d) => d.month == currentMonth).firstOrNull?.items ??
        const <String>[];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          'Seasonal Supply Demand',
          icon: LucideIcons.trendingUp,
          trailing: const AppBadge(
            'Predictive AI',
            background: AppColors.blue50,
            foreground: AppColors.blue600,
            borderColor: AppColors.blue100,
            fontSize: AppText.xxs,
          ),
        ),
        const SizedBox(height: AppSpace.x4),
        AppCard(
          padding: EdgeInsets.zero,
          borderColor: AppColors.slate100,
          shadows: AppShadows.sm,
          clip: true,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: SizedBox(
                  height: 200,
                  child: SeasonalDemandChart(
                    data: data,
                    currentMonth: currentMonth,
                  ),
                ),
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpace.x4),
                decoration: const BoxDecoration(
                  color: AppColors.slate50,
                  border: Border(top: BorderSide(color: AppColors.slate100)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    FieldLabel(
                      'High Demand This Month '
                      '(${DateFormat('MMMM').format(DateTime.now())})',
                      color: AppColors.slate500,
                    ),
                    const SizedBox(height: AppSpace.x3),
                    Wrap(
                      spacing: AppSpace.x2,
                      runSpacing: AppSpace.x2,
                      children: [
                        for (final item in thisMonth)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppSpace.x3,
                              vertical: AppSpace.x1_5,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.white,
                              borderRadius: BorderRadius.circular(AppRadius.md),
                              border: Border.all(color: AppColors.orange100),
                              boxShadow: AppShadows.sm,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const StatusDot(color: AppColors.orange500),
                                const SizedBox(width: AppSpace.x2),
                                Text(
                                  item,
                                  style: const TextStyle(
                                    fontSize: AppText.micro,
                                    fontWeight: AppText.bold,
                                    color: AppColors.slate700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
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

class _OutreachVolume extends StatelessWidget {
  const _OutreachVolume({required this.bundle});

  final InsightsBundle bundle;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      borderColor: AppColors.slate100,
      shadows: AppShadows.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    FieldLabel('Outreach Volume'),
                    Text(
                      'Encounters & Patient Mix',
                      style: TextStyle(
                        fontSize: AppText.lg,
                        fontWeight: AppText.bold,
                        color: AppColors.slate900,
                      ),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  AppBadge(
                    '${bundle.momGrowth} MoM',
                    background: AppColors.blue50,
                    foreground: AppColors.blue600,
                    borderColor: AppColors.blue100,
                    fontSize: AppText.micro,
                  ),
                  const SizedBox(height: 2),
                  const FieldLabel('Monthly Growth'),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x6),
          Row(
            children: [
              Expanded(
                child: StatTile(
                  label: 'Encounters (Mo)',
                  value: '${bundle.encountersThisMonth}',
                  caption: 'Avg ${bundle.weeklyAverage}/wk',
                  captionColor: AppColors.green600,
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              Expanded(
                child: StatTile(
                  label: 'Unique Patients',
                  value: '${bundle.uniquePatients}',
                  caption: 'Current Month',
                ),
              ),
              const SizedBox(width: AppSpace.x2),
              Expanded(
                child: StatTile(
                  label: 'New Patients',
                  value: '${bundle.newPatients}',
                  caption: '${bundle.newPatientShare}% of Total',
                  captionColor: AppColors.blue600,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x6),
          SizedBox(
            height: 220,
            child: EncounterMixChart(data: bundle.monthlyImpact),
          ),
          const SizedBox(height: AppSpace.x4),
          const Wrap(
            alignment: WrapAlignment.center,
            spacing: AppSpace.x4,
            runSpacing: AppSpace.x2,
            children: [
              _ChartLegend(color: AppColors.blue600, label: 'Repeat Patients'),
              _ChartLegend(color: AppColors.blue400, label: 'New Patients'),
              _ChartLegend(
                color: AppColors.slate200,
                label: 'Total Encounters',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ChartLegend extends StatelessWidget {
  const _ChartLegend({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
      const SizedBox(width: AppSpace.x1_5),
      Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontSize: AppText.tiny,
          fontWeight: AppText.bold,
          color: AppColors.slate500,
        ),
      ),
    ],
  );
}

class _ContinuitySection extends StatelessWidget {
  const _ContinuitySection({required this.bundle});

  final InsightsBundle bundle;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      borderColor: AppColors.slate100,
      shadows: AppShadows.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const FieldLabel('Healthcare Integration'),
          const SizedBox(height: AppSpace.x4),
          const Text(
            'Patient Continuity Metrics',
            style: TextStyle(
              fontSize: AppText.lg,
              fontWeight: AppText.bold,
              color: AppColors.slate900,
            ),
          ),
          const SizedBox(height: AppSpace.x6),
          for (var i = 0; i < bundle.continuity.length; i++) ...[
            if (i > 0) const SizedBox(height: AppSpace.x6),
            _ContinuityRow(datum: bundle.continuity[i], index: i),
          ],
          const SizedBox(height: AppSpace.x8),
          const Divider(color: AppColors.slate50),
          const SizedBox(height: AppSpace.x4),
          Container(
            padding: const EdgeInsets.all(AppSpace.x3),
            decoration: BoxDecoration(
              color: AppColors.emerald50,
              borderRadius: BorderRadius.circular(AppRadius.xl),
            ),
            child: Row(
              children: [
                const Icon(
                  LucideIcons.trendingUp,
                  size: 16,
                  color: AppColors.emerald600,
                ),
                const SizedBox(width: AppSpace.x2),
                Expanded(
                  child: Text(
                    bundle.continuityCallout,
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.bold,
                      color: AppColors.emerald600,
                    ),
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

class _ContinuityRow extends StatelessWidget {
  const _ContinuityRow({required this.datum, required this.index});

  final ContinuityDatum datum;
  final int index;

  @override
  Widget build(BuildContext context) {
    final color = datum.metric == ContinuityMetric.primaryCareConnected
        ? AppColors.emerald500
        : AppColors.rose500;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Text(
                datum.label,
                style: const TextStyle(
                  fontSize: AppText.xs,
                  fontWeight: AppText.bold,
                  color: AppColors.slate700,
                ),
              ),
            ),
            RichText(
              text: TextSpan(
                style: const TextStyle(
                  fontSize: AppText.sm,
                  fontWeight: AppText.bold,
                  color: AppColors.slate900,
                  fontFamily: AppText.family,
                ),
                children: [
                  TextSpan(text: '${datum.value} '),
                  TextSpan(
                    text: '/ ${datum.total} Patients',
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.regular,
                      color: AppColors.slate400,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.x2),
        ProgressBar(
          value: datum.fraction,
          color: color,
          height: 8,
          animate: true,
          animationDelay: Duration(milliseconds: index * 200),
        ),
        const SizedBox(height: AppSpace.x2),
        // Correct per-row caption. The prototype compared the label against a
        // string the data never matched, so both rows showed the readmissions
        // text (plan defect D5).
        Text(
          datum.caption,
          style: const TextStyle(
            fontSize: AppText.tiny,
            color: AppColors.slate400,
          ),
        ),
      ],
    );
  }
}

class _RegionUsageSection extends StatelessWidget {
  const _RegionUsageSection({required this.data});

  final List<RegionSupplyUsage> data;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(
          'Supply Usage by Region',
          icon: LucideIcons.package,
        ),
        const SizedBox(height: AppSpace.x4),
        AppCard(
          borderColor: AppColors.slate100,
          shadows: AppShadows.sm,
          clip: true,
          child: Column(
            children: [
              SizedBox(height: 240, child: RegionUsageChart(data: data)),
              const SizedBox(height: AppSpace.x4),
              for (var i = 0; i < data.length; i++)
                Container(
                  padding: const EdgeInsets.symmetric(vertical: AppSpace.x2),
                  decoration: BoxDecoration(
                    border: i == data.length - 1
                        ? null
                        : const Border(
                            bottom: BorderSide(color: AppColors.slate50),
                          ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: chartPalette[i % chartPalette.length],
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: AppSpace.x2),
                      Expanded(
                        child: Text(
                          data[i].region,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: AppText.micro,
                            fontWeight: AppText.bold,
                            color: AppColors.slate700,
                          ),
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            data[i].supply,
                            style: const TextStyle(
                              fontSize: AppText.micro,
                              fontWeight: AppText.bold,
                              color: AppColors.slate900,
                            ),
                          ),
                          Text(
                            '${data[i].usage} units',
                            style: const TextStyle(
                              fontSize: AppText.tiny,
                              color: AppColors.slate400,
                            ),
                          ),
                        ],
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

class _GrantReporting extends StatelessWidget {
  const _GrantReporting({required this.bundle});

  final InsightsBundle bundle;

  @override
  Widget build(BuildContext context) {
    final grant = bundle.grant;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('Grant Reporting Summary'),
        const SizedBox(height: AppSpace.x3),
        AppCard(
          padding: EdgeInsets.zero,
          borderColor: AppColors.slate100,
          shadows: AppShadows.sm,
          clip: true,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(AppSpace.x4),
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: AppColors.slate50)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Flexible(
                      child: Text(
                        grant.period,
                        style: const TextStyle(
                          fontSize: AppText.sm,
                          fontWeight: AppText.bold,
                          color: AppColors.slate800,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpace.x2,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.emerald50,
                        borderRadius: BorderRadius.circular(AppRadius.full),
                        border: Border.all(color: AppColors.emerald100),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const StatusDot(
                            color: AppColors.emerald500,
                            pulse: true,
                          ),
                          const SizedBox(width: AppSpace.x1_5),
                          Text(
                            grant.status.label.toUpperCase(),
                            style: const TextStyle(
                              fontSize: AppText.micro,
                              fontWeight: AppText.bold,
                              color: AppColors.emerald600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpace.x4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _GrantMetric(
                        label: 'Site Expansion',
                        value: grant.siteExpansion,
                        valueColor: AppColors.blue500,
                        progress: grant.siteExpansionProgress,
                        caption: grant.siteExpansionCaption,
                      ),
                    ),
                    const SizedBox(width: AppSpace.x4),
                    Expanded(
                      child: _GrantMetric(
                        label: 'Patient Volume',
                        value: grant.patientVolume,
                        valueColor: AppColors.slate900,
                        progress: grant.patientVolumeProgress,
                        caption: grant.patientVolumeCaption,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.x4),
        _EngagementJourney(journeys: bundle.journeys),
        const SizedBox(height: AppSpace.x4),
        _KeyOutcomes(outcomes: bundle.outcomes),
        const SizedBox(height: AppSpace.x4),
        Row(
          children: [
            Expanded(
              child: AppButton(
                label: 'Generate Grant Report',
                icon: LucideIcons.fileText,
                uppercase: true,
                size: AppButtonSize.md,
                fontSize: AppText.micro,
                shadows: AppShadows.blueGlow,
                onPressed: () => _notImplemented(context),
              ),
            ),
            const SizedBox(width: AppSpace.x3),
            Expanded(
              child: AppButton(
                label: 'Edit Metrics',
                icon: LucideIcons.settings2,
                uppercase: true,
                size: AppButtonSize.md,
                fontSize: AppText.micro,
                variant: AppButtonVariant.outline,
                foreground: AppColors.slate600,
                onPressed: () => _notImplemented(context),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _GrantMetric extends StatelessWidget {
  const _GrantMetric({
    required this.label,
    required this.value,
    required this.valueColor,
    required this.progress,
    required this.caption,
  });

  final String label;
  final String value;
  final Color valueColor;
  final double progress;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FieldLabel(label),
        const SizedBox(height: AppSpace.x1),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: AppText.lg,
                fontWeight: AppText.bold,
                color: valueColor,
              ),
            ),
            const SizedBox(width: AppSpace.x1_5),
            const Padding(
              padding: EdgeInsets.only(bottom: 4),
              child: Icon(
                LucideIcons.trendingUp,
                size: 12,
                color: AppColors.emerald500,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.x1),
        ProgressBar(value: progress, color: AppColors.blue500, height: 4),
        const SizedBox(height: AppSpace.x1),
        Text(
          caption,
          style: const TextStyle(
            fontSize: AppText.xxs,
            fontWeight: AppText.medium,
            color: AppColors.slate400,
          ),
        ),
      ],
    );
  }
}

class _EngagementJourney extends StatelessWidget {
  const _EngagementJourney({required this.journeys});

  final List<ProgressJourney> journeys;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      borderColor: AppColors.slate100,
      shadows: AppShadows.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Engagement Journey',
                style: TextStyle(
                  fontSize: AppText.sm,
                  fontWeight: AppText.bold,
                  color: AppColors.slate900,
                ),
              ),
              Row(
                children: [
                  const Icon(
                    LucideIcons.trendingUp,
                    size: 14,
                    color: AppColors.emerald500,
                  ),
                  const SizedBox(width: AppSpace.x1),
                  Text(
                    'IMPROVING',
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.bold,
                      color: AppColors.emerald500,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x4),
          for (final j in journeys) ...[
            FieldLabel(j.metric),
            const SizedBox(height: AppSpace.x3),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _JourneyStage(
                    stage: 'Baseline',
                    text: j.baseline,
                    barColor: AppColors.slate100,
                    stageColor: AppColors.slate400,
                    textColor: AppColors.slate600,
                  ),
                ),
                const Icon(
                  LucideIcons.chevronRight,
                  size: 14,
                  color: AppColors.blue300,
                ),
                Expanded(
                  child: _JourneyStage(
                    stage: 'Current',
                    text: j.current,
                    barColor: AppColors.blue500,
                    stageColor: AppColors.blue500,
                    textColor: AppColors.slate900,
                  ),
                ),
                const Icon(
                  LucideIcons.chevronRight,
                  size: 14,
                  color: AppColors.slate200,
                ),
                Expanded(
                  child: _JourneyStage(
                    stage: 'Goal',
                    text: j.goal,
                    barColor: AppColors.slate100,
                    stageColor: AppColors.slate400,
                    textColor: AppColors.slate500,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _JourneyStage extends StatelessWidget {
  const _JourneyStage({
    required this.stage,
    required this.text,
    required this.barColor,
    required this.stageColor,
    required this.textColor,
  });

  final String stage;
  final String text;
  final Color barColor;
  final Color stageColor;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          height: 4,
          decoration: BoxDecoration(
            color: barColor,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
        ),
        const SizedBox(height: AppSpace.x2),
        Text(
          stage,
          style: TextStyle(
            fontSize: AppText.tiny,
            fontWeight: AppText.medium,
            color: stageColor,
          ),
        ),
        const SizedBox(height: AppSpace.x1),
        Text(
          '“$text”',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: AppText.micro,
            fontWeight: AppText.bold,
            fontStyle: FontStyle.italic,
            color: textColor,
            height: 1.2,
          ),
        ),
      ],
    );
  }
}

class _KeyOutcomes extends StatelessWidget {
  const _KeyOutcomes({required this.outcomes});

  final List<KeyOutcome> outcomes;

  static const _prompts = [
    'What changed?',
    'Who is being reached?',
    'How has access improved?',
  ];

  @override
  Widget build(BuildContext context) {
    return AppCard(
      borderColor: AppColors.slate100,
      shadows: AppShadows.sm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Key Outcomes',
                style: TextStyle(
                  fontSize: AppText.sm,
                  fontWeight: AppText.bold,
                  color: AppColors.slate900,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpace.x1_5,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.slate50,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
                child: const Text(
                  'FILTER: Q2',
                  style: TextStyle(
                    fontSize: AppText.xxs,
                    fontWeight: AppText.bold,
                    color: AppColors.slate400,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.x2),
          const Divider(color: AppColors.slate50),
          const SizedBox(height: AppSpace.x4),
          for (final o in outcomes) ...[
            _OutcomeRow(outcome: o),
            const SizedBox(height: AppSpace.x5),
          ],
          const Divider(color: AppColors.slate50),
          const SizedBox(height: AppSpace.x4),
          const Center(
            child: Text(
              'INSIGHT PROMPTS',
              style: TextStyle(
                fontSize: AppText.xxs,
                fontWeight: AppText.bold,
                color: AppColors.slate400,
                letterSpacing: AppText.widest,
              ),
            ),
          ),
          const SizedBox(height: AppSpace.x2),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: AppSpace.x2,
            runSpacing: AppSpace.x2,
            children: [
              for (final p in _prompts)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.x2,
                    vertical: AppSpace.x1,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.slate50,
                    borderRadius: BorderRadius.circular(AppRadius.full),
                    border: Border.all(color: AppColors.slate100),
                  ),
                  child: Text(
                    p,
                    style: const TextStyle(
                      fontSize: AppText.tiny,
                      color: AppColors.slate400,
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

class _OutcomeRow extends StatelessWidget {
  const _OutcomeRow({required this.outcome});

  final KeyOutcome outcome;

  @override
  Widget build(BuildContext context) {
    final dotColor = switch (outcome.status) {
      OutcomeStatus.onTrack => AppColors.emerald400,
      OutcomeStatus.needsAttention => AppColors.amber400,
      OutcomeStatus.atRisk => AppColors.rose400,
    };
    final (badgeBg, badgeFg) = switch (outcome.status) {
      OutcomeStatus.onTrack => (AppColors.emerald50, AppColors.emerald600),
      OutcomeStatus.needsAttention => (AppColors.amber50, AppColors.amber600),
      OutcomeStatus.atRisk => (AppColors.rose50, AppColors.rose600),
    };
    final trendColor = outcome.isUp
        ? AppColors.emerald500
        : outcome.isDown
        ? AppColors.rose500
        : AppColors.slate400;
    final trendIcon = outcome.isUp
        ? LucideIcons.trendingUp
        : outcome.isDown
        ? LucideIcons.trendingDown
        : LucideIcons.minus;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: AppSpace.x1),
          child: StatusDot(color: dotColor, size: 4),
        ),
        const SizedBox(width: AppSpace.x3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      outcome.category.toUpperCase(),
                      style: const TextStyle(
                        fontSize: AppText.micro,
                        fontWeight: AppText.bold,
                        color: AppColors.slate700,
                        letterSpacing: AppText.tight,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpace.x2,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: badgeBg,
                      borderRadius: BorderRadius.circular(2),
                    ),
                    child: Text(
                      outcome.status.label.toUpperCase(),
                      style: TextStyle(
                        fontSize: AppText.xxs,
                        fontWeight: AppText.bold,
                        color: badgeFg,
                        letterSpacing: AppText.widest,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpace.x1_5),
              Text(
                outcome.insight,
                style: const TextStyle(
                  fontSize: AppText.mini,
                  fontWeight: AppText.medium,
                  color: AppColors.slate500,
                  height: 1.6,
                ),
              ),
              const SizedBox(height: AppSpace.x1),
              Row(
                children: [
                  Icon(trendIcon, size: 10, color: trendColor),
                  const SizedBox(width: AppSpace.x1),
                  Text(
                    outcome.trend,
                    style: TextStyle(
                      fontSize: AppText.tiny,
                      fontWeight: AppText.bold,
                      color: trendColor,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
