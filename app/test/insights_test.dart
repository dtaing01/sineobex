import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/models/models.dart';
import 'package:sineobex/data/repositories/insights_repository.dart';
import 'package:sineobex/data/seed/demo_seed.dart' as seed;

void main() {
  group('InsightsRepository.computeLocal', () {
    test('derives a bundle from the seeded encounter record', () {
      final bundle = InsightsRepository.computeLocal(
        seed.demoPatients(),
        now: DateTime(2026, 4, 15),
      );

      expect(bundle.impactMetrics, hasLength(4));
      expect(bundle.monthlyImpact, hasLength(4));
      expect(bundle.continuity, hasLength(2));
    });

    test('splits each month into first-seen and returning patients', () {
      final bundle = InsightsRepository.computeLocal(
        seed.demoPatients(),
        now: DateTime(2026, 4, 15),
      );

      for (final m in bundle.monthlyImpact) {
        expect(
          m.newPatients + m.repeatPatients,
          m.uniquePatients,
          reason: '${m.month} should partition its unique patients',
        );
        expect(m.newPatients, greaterThanOrEqualTo(0));
        expect(m.repeatPatients, greaterThanOrEqualTo(0));
      }
    });

    test('the trailing window ends on the current month', () {
      final bundle = InsightsRepository.computeLocal(
        seed.demoPatients(),
        now: DateTime(2026, 4, 15),
      );
      expect(bundle.monthlyImpact.last.month, 'Apr');
      expect(bundle.monthlyImpact.first.month, 'Jan');
    });

    test('survives an empty caseload without dividing by zero', () {
      final bundle = InsightsRepository.computeLocal(
        const [],
        now: DateTime(2026, 4, 15),
      );

      expect(bundle.encountersThisMonth, 0);
      expect(bundle.uniquePatients, 0);
      expect(bundle.newPatientShare, 0);
      expect(bundle.momGrowth, '—');
      // Falls back to the seeded continuity shape rather than an empty chart.
      expect(bundle.continuity, hasLength(2));
    });

    test('region usage is ranked and capped at five bars', () {
      final bundle = InsightsRepository.computeLocal(
        seed.demoPatients(),
        now: DateTime(2026, 4, 15),
      );

      expect(bundle.regionUsage.length, lessThanOrEqualTo(5));
      for (var i = 1; i < bundle.regionUsage.length; i++) {
        expect(
          bundle.regionUsage[i - 1].usage,
          greaterThanOrEqualTo(bundle.regionUsage[i].usage),
          reason: 'regions should be ordered by units distributed',
        );
      }
    });

    test('newPatientShare is a percentage of unique patients', () {
      const bundle = InsightsBundle(
        impactMetrics: [],
        monthlyImpact: [],
        seasonalDemand: [],
        regionUsage: [],
        continuity: [],
        journeys: [],
        outcomes: [],
        grant: GrantSummary(
          period: 'Q2',
          status: OutcomeStatus.onTrack,
          siteExpansion: '3 New',
          siteExpansionProgress: 0.75,
          siteExpansionCaption: '',
          patientVolume: '+18%',
          patientVolumeProgress: 0.9,
          patientVolumeCaption: '',
        ),
        momGrowth: '+10%',
        encountersThisMonth: 100,
        weeklyAverage: 25,
        uniquePatients: 40,
        newPatients: 10,
        continuityCallout: '',
        risingNeedAlert: '',
      );

      expect(bundle.newPatientShare, 25);
    });
  });

  group('ContinuityDatum', () {
    test('fraction handles a zero total', () {
      const d = ContinuityDatum(
        metric: ContinuityMetric.primaryCareConnected,
        value: 0,
        total: 0,
      );
      expect(d.fraction, 0);
    });
  });
}
