import 'enums.dart';

class ImpactMetric {
  const ImpactMetric({
    required this.label,
    required this.value,
    required this.trend,
  });

  final String label;
  final String value;
  final String trend;

  factory ImpactMetric.fromJson(Map<String, dynamic> j) => ImpactMetric(
        label: j['label'] as String,
        value: j['value'] as String,
        trend: j['trend'] as String,
      );

  Map<String, dynamic> toJson() =>
      {'label': label, 'value': value, 'trend': trend};
}

class MonthlyImpact {
  const MonthlyImpact({
    required this.month,
    required this.encounters,
    required this.uniquePatients,
    required this.newPatients,
    required this.repeatPatients,
  });

  final String month;
  final int encounters;
  final int uniquePatients;
  final int newPatients;
  final int repeatPatients;

  factory MonthlyImpact.fromJson(Map<String, dynamic> j) => MonthlyImpact(
        month: j['month'] as String,
        encounters: (j['encounters'] as num).toInt(),
        uniquePatients: (j['uniquePatients'] as num).toInt(),
        newPatients: (j['newPatients'] as num).toInt(),
        repeatPatients: (j['repeatPatients'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => {
        'month': month,
        'encounters': encounters,
        'uniquePatients': uniquePatients,
        'newPatients': newPatients,
        'repeatPatients': repeatPatients,
      };
}

class SeasonalDemand {
  const SeasonalDemand({
    required this.month,
    required this.items,
    required this.intensity,
  });

  final String month;
  final List<String> items;
  final int intensity;

  factory SeasonalDemand.fromJson(Map<String, dynamic> j) => SeasonalDemand(
        month: j['month'] as String,
        items: (j['items'] as List).map((e) => e as String).toList(),
        intensity: (j['intensity'] as num).toInt(),
      );

  Map<String, dynamic> toJson() =>
      {'month': month, 'items': items, 'intensity': intensity};
}

class RegionSupplyUsage {
  const RegionSupplyUsage({
    required this.region,
    required this.supply,
    required this.usage,
  });

  final String region;
  final String supply;
  final int usage;

  factory RegionSupplyUsage.fromJson(Map<String, dynamic> j) =>
      RegionSupplyUsage(
        region: j['region'] as String,
        supply: j['supply'] as String,
        usage: (j['usage'] as num).toInt(),
      );

  Map<String, dynamic> toJson() =>
      {'region': region, 'supply': supply, 'usage': usage};
}

class ContinuityDatum {
  const ContinuityDatum({
    required this.metric,
    required this.value,
    required this.total,
  });

  final ContinuityMetric metric;
  final int value;
  final int total;

  String get label => metric.label;

  /// Fixed in the port: the prototype matched on a display string that never
  /// equalled the data, so both rows showed the readmissions caption (D5).
  String get caption => metric.caption;

  double get fraction => total == 0 ? 0 : value / total;

  factory ContinuityDatum.fromJson(Map<String, dynamic> j) => ContinuityDatum(
        metric: ContinuityMetric.values
            .firstWhere((m) => m.name == j['metric'] as String),
        value: (j['value'] as num).toInt(),
        total: (j['total'] as num).toInt(),
      );

  Map<String, dynamic> toJson() =>
      {'metric': metric.name, 'value': value, 'total': total};
}

class ProgressJourney {
  const ProgressJourney({
    required this.metric,
    required this.baseline,
    required this.current,
    required this.goal,
  });

  final String metric;
  final String baseline;
  final String current;
  final String goal;

  factory ProgressJourney.fromJson(Map<String, dynamic> j) => ProgressJourney(
        metric: j['metric'] as String,
        baseline: j['baseline'] as String,
        current: j['current'] as String,
        goal: j['goal'] as String,
      );

  Map<String, dynamic> toJson() => {
        'metric': metric,
        'baseline': baseline,
        'current': current,
        'goal': goal,
      };
}

class KeyOutcome {
  const KeyOutcome({
    required this.category,
    required this.insight,
    required this.status,
    required this.trend,
  });

  final String category;
  final String insight;
  final OutcomeStatus status;
  final String trend;

  bool get isUp => trend.startsWith('+');
  bool get isDown => trend.startsWith('-');

  factory KeyOutcome.fromJson(Map<String, dynamic> j) => KeyOutcome(
        category: j['category'] as String,
        insight: j['insight'] as String,
        status: OutcomeStatus.fromLabel(j['status'] as String?),
        trend: j['trend'] as String,
      );

  Map<String, dynamic> toJson() => {
        'category': category,
        'insight': insight,
        'status': status.label,
        'trend': trend,
      };
}

class GrantSummary {
  const GrantSummary({
    required this.period,
    required this.status,
    required this.siteExpansion,
    required this.siteExpansionProgress,
    required this.siteExpansionCaption,
    required this.patientVolume,
    required this.patientVolumeProgress,
    required this.patientVolumeCaption,
  });

  final String period;
  final OutcomeStatus status;
  final String siteExpansion;
  final double siteExpansionProgress;
  final String siteExpansionCaption;
  final String patientVolume;
  final double patientVolumeProgress;
  final String patientVolumeCaption;
}

/// Everything the Insights screen renders, fetched as one payload so the
/// screen has a single loading state.
class InsightsBundle {
  const InsightsBundle({
    required this.impactMetrics,
    required this.monthlyImpact,
    required this.seasonalDemand,
    required this.regionUsage,
    required this.continuity,
    required this.journeys,
    required this.outcomes,
    required this.grant,
    required this.momGrowth,
    required this.encountersThisMonth,
    required this.weeklyAverage,
    required this.uniquePatients,
    required this.newPatients,
    required this.continuityCallout,
    required this.risingNeedAlert,
  });

  final List<ImpactMetric> impactMetrics;
  final List<MonthlyImpact> monthlyImpact;
  final List<SeasonalDemand> seasonalDemand;
  final List<RegionSupplyUsage> regionUsage;
  final List<ContinuityDatum> continuity;
  final List<ProgressJourney> journeys;
  final List<KeyOutcome> outcomes;
  final GrantSummary grant;
  final String momGrowth;
  final int encountersThisMonth;
  final int weeklyAverage;
  final int uniquePatients;
  final int newPatients;
  final String continuityCallout;
  final String risingNeedAlert;

  /// "55% of Total" beneath the New Patients tile.
  int get newPatientShare =>
      uniquePatients == 0 ? 0 : ((newPatients / uniquePatients) * 100).round();
}
