import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';
import '../../data/models/models.dart';

/// The four-colour cycle the prototype uses for the region chart.
const chartPalette = [
  AppColors.blue600,
  AppColors.blue500,
  AppColors.blue400,
  AppColors.blue300,
];

/// Seasonal supply demand — twelve bars, the current month highlighted orange
/// and the rest blue at 60% opacity, with a dark tooltip listing that month's
/// priority items as chips.
class SeasonalDemandChart extends StatelessWidget {
  const SeasonalDemandChart({
    super.key,
    required this.data,
    required this.currentMonth,
  });

  final List<SeasonalDemand> data;
  final String currentMonth;

  @override
  Widget build(BuildContext context) {
    return BarChart(
      BarChartData(
        alignment: BarChartAlignment.spaceAround,
        maxY: 110,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) => const FlLine(
            color: AppColors.slate100,
            strokeWidth: 1,
            dashArray: [3, 3],
          ),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(),
          topTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 22,
              getTitlesWidget: (value, _) {
                final i = value.toInt();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: AppSpace.x1),
                  child: Text(
                    data[i].month,
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      fontWeight: AppText.semibold,
                      color: AppColors.slate400,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipColor: (_) => AppColors.slate900,
            tooltipRoundedRadius: AppRadius.md,
            getTooltipItem: (group, _, __, ___) {
              final d = data[group.x];
              return BarTooltipItem(
                '${d.month} Demand\n',
                const TextStyle(
                  color: AppColors.white,
                  fontWeight: AppText.bold,
                  fontSize: AppText.micro,
                ),
                children: [
                  TextSpan(
                    text: d.items.join(' · '),
                    style: TextStyle(
                      color: AppColors.white.withValues(alpha: 0.75),
                      fontSize: AppText.xxs,
                      fontWeight: AppText.regular,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
        barGroups: [
          for (var i = 0; i < data.length; i++)
            BarChartGroupData(
              x: i,
              barRods: [
                BarChartRodData(
                  toY: data[i].intensity.toDouble(),
                  width: 12,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(4),
                  ),
                  color: data[i].month == currentMonth
                      ? AppColors.orange500
                      : AppColors.blue500.withValues(alpha: 0.6),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// Encounters and patient mix: new + repeat stacked, with total encounters as
/// a faint reference bar behind them.
class EncounterMixChart extends StatelessWidget {
  const EncounterMixChart({super.key, required this.data});

  final List<MonthlyImpact> data;

  @override
  Widget build(BuildContext context) {
    final maxEncounters = data.isEmpty
        ? 10.0
        : data
              .map((d) => d.encounters)
              .reduce((a, b) => a > b ? a : b)
              .toDouble();

    return BarChart(
      BarChartData(
        alignment: BarChartAlignment.spaceAround,
        maxY: maxEncounters * 1.15,
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) => const FlLine(
            color: AppColors.slate100,
            strokeWidth: 1,
            dashArray: [3, 3],
          ),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          leftTitles: const AxisTitles(),
          topTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 22,
              getTitlesWidget: (value, _) {
                final i = value.toInt();
                if (i < 0 || i >= data.length) return const SizedBox.shrink();
                return Padding(
                  padding: const EdgeInsets.only(top: AppSpace.x1),
                  child: Text(
                    data[i].month,
                    style: const TextStyle(
                      fontSize: AppText.micro,
                      color: AppColors.slate400,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipColor: (_) => AppColors.white,
            tooltipRoundedRadius: AppRadius.xl,
            tooltipBorder: const BorderSide(color: AppColors.slate200),
            getTooltipItem: (group, _, rod, rodIndex) {
              final d = data[group.x];
              if (rodIndex == 1) {
                return BarTooltipItem(
                  '${d.encounters} encounters',
                  const TextStyle(
                    color: AppColors.slate500,
                    fontSize: AppText.micro,
                    fontWeight: AppText.bold,
                  ),
                );
              }
              return BarTooltipItem(
                '${d.newPatients} new · ${d.repeatPatients} repeat',
                const TextStyle(
                  color: AppColors.slate900,
                  fontSize: AppText.micro,
                  fontWeight: AppText.bold,
                ),
              );
            },
          ),
        ),
        barGroups: [
          for (var i = 0; i < data.length; i++)
            BarChartGroupData(
              x: i,
              barsSpace: 2,
              barRods: [
                // Stacked: new patients at the base, repeat above.
                BarChartRodData(
                  toY: (data[i].newPatients + data[i].repeatPatients)
                      .toDouble(),
                  width: 14,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(4),
                  ),
                  rodStackItems: [
                    BarChartRodStackItem(
                      0,
                      data[i].newPatients.toDouble(),
                      AppColors.blue400,
                    ),
                    BarChartRodStackItem(
                      data[i].newPatients.toDouble(),
                      (data[i].newPatients + data[i].repeatPatients).toDouble(),
                      AppColors.blue600,
                    ),
                  ],
                ),
                BarChartRodData(
                  toY: data[i].encounters.toDouble(),
                  width: 14,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(4),
                  ),
                  color: AppColors.slate400.withValues(alpha: 0.2),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

/// Supply usage by region — horizontal bars with region labels down the left.
///
/// Built from primitives rather than fl_chart: a rotated cartesian chart puts
/// the axis labels on their side, and this layout is what the prototype's
/// `layout="vertical"` Recharts config actually renders. Tapping a bar shows
/// the same tooltip content.
class RegionUsageChart extends StatefulWidget {
  const RegionUsageChart({super.key, required this.data});

  final List<RegionSupplyUsage> data;

  @override
  State<RegionUsageChart> createState() => _RegionUsageChartState();
}

class _RegionUsageChartState extends State<RegionUsageChart> {
  int? _selected;

  @override
  Widget build(BuildContext context) {
    if (widget.data.isEmpty) {
      return const Center(
        child: Text(
          'No supply distribution recorded yet.',
          style: TextStyle(
            fontSize: AppText.xs,
            color: AppColors.slate400,
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    final maxUsage = widget.data
        .map((d) => d.usage)
        .reduce((a, b) => a > b ? a : b)
        .toDouble();

    return Column(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        for (var i = 0; i < widget.data.length; i++)
          Expanded(
            child: _RegionBar(
              datum: widget.data[i],
              fraction: maxUsage == 0 ? 0 : widget.data[i].usage / maxUsage,
              color: chartPalette[i % chartPalette.length],
              showTooltip: _selected == i,
              onTap: () =>
                  setState(() => _selected = _selected == i ? null : i),
            ),
          ),
      ],
    );
  }
}

class _RegionBar extends StatelessWidget {
  const _RegionBar({
    required this.datum,
    required this.fraction,
    required this.color,
    required this.showTooltip,
    required this.onTap,
  });

  final RegionSupplyUsage datum;
  final double fraction;
  final Color color;
  final bool showTooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        children: [
          SizedBox(
            width: 80,
            child: Text(
              datum.region,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: AppText.tiny,
                fontWeight: AppText.bold,
                color: AppColors.slate500,
              ),
            ),
          ),
          const SizedBox(width: AppSpace.x2),
          Expanded(
            child: Stack(
              alignment: Alignment.centerLeft,
              children: [
                FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: fraction.clamp(0.02, 1.0),
                  child: TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: 20),
                    duration: const Duration(milliseconds: 600),
                    builder: (_, height, __) => Container(
                      height: height,
                      decoration: BoxDecoration(
                        color: color,
                        borderRadius: const BorderRadius.horizontal(
                          right: Radius.circular(4),
                        ),
                      ),
                    ),
                  ),
                ),
                if (showTooltip)
                  Padding(
                    padding: const EdgeInsets.only(left: AppSpace.x2),
                    child: Container(
                      padding: const EdgeInsets.all(AppSpace.x2),
                      decoration: BoxDecoration(
                        color: AppColors.white,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(color: AppColors.slate200),
                        boxShadow: AppShadows.lg,
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Top Item: ${datum.supply}',
                            style: const TextStyle(
                              fontSize: AppText.micro,
                              fontWeight: AppText.bold,
                              color: AppColors.blue600,
                            ),
                          ),
                          Text(
                            '${datum.usage} units distributed',
                            style: const TextStyle(
                              fontSize: AppText.micro,
                              color: AppColors.slate500,
                            ),
                          ),
                        ],
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
