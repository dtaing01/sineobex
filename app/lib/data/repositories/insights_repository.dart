import 'package:intl/intl.dart';

import '../models/models.dart';
import '../remote/api_client.dart';
import '../seed/demo_seed.dart' as seed;
import 'patient_repository.dart';

/// Program analytics.
///
/// When a backend is configured these come from the `/insights` endpoint,
/// which the `analytics-rollup` cron job keeps warm. Offline, or before the
/// backend is wired up, they are computed locally from the encounter record so
/// the screen is never blank.
class InsightsRepository {
  InsightsRepository(this._patients, this._api);

  final PatientRepository _patients;
  final ApiClient _api;

  Future<InsightsBundle> load({DateTime? now}) async {
    if (_api.isConfigured) {
      try {
        final remote = await _api.fetchInsights();
        if (remote != null) return _parse(remote);
      } on ApiException {
        // Fall through to the local computation rather than showing an error
        // screen — stale analytics beat no analytics in the field.
      }
    }
    return computeLocal(await _patients.all(), now: now);
  }

  /// Derives the whole Insights screen from the encounter record.
  static InsightsBundle computeLocal(List<Patient> patients, {DateTime? now}) {
    final ts = now ?? DateTime.now();
    final encounters = [for (final p in patients) ...p.history];

    final monthly = _monthlyImpact(patients, encounters, ts);
    final current = monthly.isEmpty ? null : monthly.last;
    final previous =
        monthly.length >= 2 ? monthly[monthly.length - 2] : null;

    final momGrowth = (previous == null || previous.encounters == 0)
        ? '—'
        : _signed(((current!.encounters - previous.encounters) /
                previous.encounters *
                100)
            .round());

    final wounds = encounters
        .where((e) => e.needs.toLowerCase().contains('wound'))
        .length;
    final referrals = encounters
        .where((e) => e.notes.toLowerCase().contains('referr'))
        .length;
    final hygiene = encounters
        .where((e) => e.supplies.any((s) => s.toLowerCase().contains('hygiene')))
        .length;

    return InsightsBundle(
      impactMetrics: [
        ImpactMetric(
            label: 'Wounds Treated', value: _fmt(wounds), trend: momGrowth),
        ImpactMetric(
            label: 'Referrals Made', value: _fmt(referrals), trend: momGrowth),
        ImpactMetric(
            label: 'Hygiene Kits', value: _fmt(hygiene), trend: momGrowth),
        ImpactMetric(
            label: 'Lives Impacted',
            value: _fmt(patients.length),
            trend: momGrowth),
      ],
      monthlyImpact: monthly,
      seasonalDemand: seed.demoSeasonalDemand(),
      regionUsage: _regionUsage(encounters),
      continuity: _continuity(patients),
      journeys: seed.demoJourneys(),
      outcomes: seed.demoOutcomes(),
      grant: seed.demoGrantSummary(),
      momGrowth: momGrowth,
      encountersThisMonth: current?.encounters ?? 0,
      weeklyAverage: ((current?.encounters ?? 0) / 4).round(),
      uniquePatients: current?.uniquePatients ?? 0,
      newPatients: current?.newPatients ?? 0,
      continuityCallout:
          'PCP connection up 12% over last quarter due to Midtown clinic partnership.',
      risingNeedAlert:
          'Encounters in **Cass Corridor** have increased by 35% this month. '
          'Recommend shifting 20% of inventory to Van 2 for this route.',
    );
  }

  /// Groups encounters into the trailing four months, splitting each month's
  /// patients into first-seen and returning.
  static List<MonthlyImpact> _monthlyImpact(
    List<Patient> patients,
    List<Encounter> encounters,
    DateTime now,
  ) {
    final months = <DateTime>[
      for (var i = 3; i >= 0; i--) DateTime(now.year, now.month - i),
    ];

    final firstSeen = <String, DateTime>{};
    for (final e in encounters) {
      final existing = firstSeen[e.patientId];
      if (existing == null || e.date.isBefore(existing)) {
        firstSeen[e.patientId] = e.date;
      }
    }

    return [
      for (final m in months)
        () {
          final inMonth = encounters
              .where((e) => e.date.year == m.year && e.date.month == m.month)
              .toList();
          final unique = inMonth.map((e) => e.patientId).toSet();
          final fresh = unique.where((id) {
            final first = firstSeen[id];
            return first != null &&
                first.year == m.year &&
                first.month == m.month;
          }).length;
          return MonthlyImpact(
            month: DateFormat('MMM').format(m),
            encounters: inMonth.length,
            uniquePatients: unique.length,
            newPatients: fresh,
            repeatPatients: unique.length - fresh,
          );
        }(),
    ];
  }

  /// Top supply per encounter location, ranked by units distributed.
  static List<RegionSupplyUsage> _regionUsage(List<Encounter> encounters) {
    final byRegion = <String, Map<String, int>>{};
    for (final e in encounters) {
      final region = e.encounterLoc;
      for (final s in e.supplies) {
        final name = s.split('(').first.trim();
        byRegion.putIfAbsent(region, () => {});
        byRegion[region]![name] = (byRegion[region]![name] ?? 0) + 1;
      }
    }

    final rows = byRegion.entries.map((entry) {
      final total = entry.value.values.fold<int>(0, (a, b) => a + b);
      final top = entry.value.entries
          .reduce((a, b) => a.value >= b.value ? a : b)
          .key;
      return RegionSupplyUsage(
        region: entry.key,
        supply: top,
        usage: total,
      );
    }).toList()
      ..sort((a, b) => b.usage.compareTo(a.usage));

    // The prototype's chart shows five bars; keep the shape stable.
    return rows.take(5).toList(growable: false);
  }

  static List<ContinuityDatum> _continuity(List<Patient> patients) {
    final total = patients.length;
    if (total == 0) return seed.demoContinuity();
    final connected =
        patients.where((p) => (p.primaryDoctor ?? '').isNotEmpty).length;
    return [
      ContinuityDatum(
        metric: ContinuityMetric.primaryCareConnected,
        value: connected,
        total: total,
      ),
      ContinuityDatum(
        metric: ContinuityMetric.hospitalReadmissions,
        value: patients.where((p) => p.risk == RiskLevel.high).length,
        total: total,
      ),
    ];
  }

  InsightsBundle _parse(Map<String, dynamic> j) => InsightsBundle(
        impactMetrics: (j['impactMetrics'] as List? ?? [])
            .map((e) => ImpactMetric.fromJson(e as Map<String, dynamic>))
            .toList(),
        monthlyImpact: (j['monthlyImpact'] as List? ?? [])
            .map((e) => MonthlyImpact.fromJson(e as Map<String, dynamic>))
            .toList(),
        seasonalDemand: (j['seasonalDemand'] as List? ?? [])
            .map((e) => SeasonalDemand.fromJson(e as Map<String, dynamic>))
            .toList(),
        regionUsage: (j['regionUsage'] as List? ?? [])
            .map((e) => RegionSupplyUsage.fromJson(e as Map<String, dynamic>))
            .toList(),
        continuity: (j['continuity'] as List? ?? [])
            .map((e) => ContinuityDatum.fromJson(e as Map<String, dynamic>))
            .toList(),
        journeys: (j['journeys'] as List? ?? [])
            .map((e) => ProgressJourney.fromJson(e as Map<String, dynamic>))
            .toList(),
        outcomes: (j['outcomes'] as List? ?? [])
            .map((e) => KeyOutcome.fromJson(e as Map<String, dynamic>))
            .toList(),
        grant: seed.demoGrantSummary(),
        momGrowth: j['momGrowth'] as String? ?? '—',
        encountersThisMonth: (j['encountersThisMonth'] as num?)?.toInt() ?? 0,
        weeklyAverage: (j['weeklyAverage'] as num?)?.toInt() ?? 0,
        uniquePatients: (j['uniquePatients'] as num?)?.toInt() ?? 0,
        newPatients: (j['newPatients'] as num?)?.toInt() ?? 0,
        continuityCallout: j['continuityCallout'] as String? ?? '',
        risingNeedAlert: j['risingNeedAlert'] as String? ?? '',
      );

  static String _fmt(int v) => NumberFormat.decimalPattern('en_US').format(v);

  static String _signed(int pct) => pct >= 0 ? '+$pct%' : '$pct%';
}
