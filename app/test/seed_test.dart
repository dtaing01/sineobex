import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/models/models.dart';
import 'package:sineobex/data/seed/demo_seed.dart' as seed;

/// Verifies the generated seed matches the prototype's MOCK_DATA exactly.
/// If these counts drift, the parity claim in docs/PARITY_REVIEW.md is stale.
void main() {
  group('demo seed fidelity', () {
    test('carries all 12 patients', () {
      expect(seed.demoPatients(), hasLength(12));
    });

    test('carries all 37 inventory items', () {
      expect(seed.demoInventory(), hasLength(37));
    });

    test('carries all 13 partner facilities', () {
      expect(seed.demoResources(), hasLength(13));
    });

    test('carries all 19 hotspots, split 12 clinical / 7 supply', () {
      final hotspots = seed.demoHotspots();
      expect(hotspots, hasLength(19));
      expect(hotspots.where((h) => h.type.isSupply), hasLength(7));
      expect(hotspots.where((h) => !h.type.isSupply), hasLength(12));
    });

    test('carries 12 months of seasonal demand', () {
      expect(seed.demoSeasonalDemand(), hasLength(12));
    });

    test('carries 5 key outcomes and 4 impact metrics', () {
      expect(seed.demoOutcomes(), hasLength(5));
      expect(seed.demoImpactMetrics(), hasLength(4));
    });

    test('John Doe survives the port intact', () {
      final john = seed.demoPatients().firstWhere((p) => p.id == '1');
      expect(john.name, 'John Doe');
      expect(john.dobIso, '1979-05-12');
      expect(john.risk, RiskLevel.high);
      expect(john.loc, 'Cass Park');
      expect(john.flags, [PatientFlag.chronicDisease]);
      expect(john.tags, ['Chronic Wound', 'Hypertension']);
      expect(john.commonLocations, hasLength(3));
      expect(john.history, hasLength(2));
      expect(
        john.history.first.supplies,
        contains('Amoxicillin 500mg (1 tab twice daily for 7 days)'),
      );
    });

    test('rebuilds movement timestamps from the split date/time strings', () {
      final john = seed.demoPatients().firstWhere((p) => p.id == '1');
      final first = john.commonLocations.first;
      expect(first.name, 'Cass Park (North)');
      expect(first.date, '2026-04-11');
      expect(first.day, 'Saturday');
      expect(first.time, '09:15 AM');
    });

    test('parses a PM movement time correctly', () {
      final john = seed.demoPatients().firstWhere((p) => p.id == '1');
      final church = john.commonLocations.firstWhere(
        (l) => l.name == 'St. Peter Church',
      );
      expect(church.observedAt.hour, 14);
      expect(church.time, '02:30 PM');
    });

    test('preserves on-order inventory metadata', () {
      final tamiflu = seed.demoInventory().firstWhere(
        (i) => i.name == 'Tamiflu',
      );
      expect(tamiflu.isOnOrder, isTrue);
      expect(tamiflu.orderedBy, 'Sarah Chen, RN');
      expect(tamiflu.orderedAtLabel, '2026-04-11 09:00');
    });

    test('every resource type from the prototype is represented', () {
      final types = seed.demoResources().map((r) => r.type).toSet();
      expect(types, containsAll(ResourceType.values));
    });

    test('supply hotspots all name an item', () {
      final supply = seed.demoHotspots().where((h) => h.type.isSupply);
      expect(supply.every((h) => h.supply != null), isTrue);
    });

    test('the roster marks exactly one member as self', () {
      expect(seed.demoMembers().where((m) => m.isSelf), hasLength(1));
    });
  });
}
