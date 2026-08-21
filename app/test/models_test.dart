import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/models/models.dart';

void main() {
  Patient patient({
    String first = 'John',
    String last = 'Doe',
    RiskLevel risk = RiskLevel.high,
    List<PatientFlag> flags = const [],
  }) => Patient(
    id: '1',
    firstName: first,
    lastName: last,
    dob: DateTime(1979, 5, 12),
    risk: risk,
    loc: 'Cass Park',
    lat: 42.34,
    lng: -83.058,
    flags: flags,
  );

  group('Patient.matchesSearch', () {
    test('matches on name, case-insensitively', () {
      expect(patient().matchesSearch('john'), isTrue);
      expect(patient().matchesSearch('DOE'), isTrue);
    });

    test('matches on a DOB substring', () {
      expect(patient().matchesSearch('1979-05'), isTrue);
      expect(patient().matchesSearch('1979-05-12'), isTrue);
    });

    test('rejects a non-match', () {
      expect(patient().matchesSearch('Smith'), isFalse);
    });

    test('an empty query matches everything', () {
      expect(patient().matchesSearch(''), isTrue);
    });
  });

  group('InventoryItem', () {
    InventoryItem item(int stock, int min) => InventoryItem(
      id: 's1',
      name: 'Gauze',
      stock: stock,
      min: min,
      unit: 'packs',
      category: SupplyCategory.medical,
    );

    test('classifies stock status', () {
      expect(item(0, 20).status, StockStatus.out);
      expect(item(15, 20).status, StockStatus.low);
      expect(item(25, 20).status, StockStatus.inStock);
    });

    test('fillPercent uses the prototype formula, clamped to 100', () {
      // min * 1.5 = 30; 15/30 = 50%
      expect(item(15, 20).fillPercent, 50);
      // 60/30 would be 200%, clamped
      expect(item(60, 20).fillPercent, 100);
    });

    test('an item at exactly its minimum is not low', () {
      expect(item(20, 20).isLow, isFalse);
    });
  });

  group('HotspotType partitioning', () {
    test('the heatmap and inventory layers are disjoint', () {
      final all = HotspotType.values;
      final supply = all.where((t) => t.isSupply).toSet();
      final clinical = all.where((t) => !t.isSupply).toSet();
      expect(supply.intersection(clinical), isEmpty);
      expect(supply.union(clinical).length, all.length);
    });

    test('named non-clinical categories are not infectious', () {
      expect(HotspotType.risingNeed.isInfectious, isFalse);
      expect(HotspotType.foodDesert.isInfectious, isFalse);
      expect(HotspotType.pharmacyDesert.isInfectious, isFalse);
      expect(HotspotType.hepatitisC.isInfectious, isTrue);
      expect(HotspotType.covid19.isInfectious, isTrue);
    });
  });

  group('ContinuityMetric captions', () {
    // The prototype matched `item.label === 'Primary Care Connected'` against
    // data reading 'Primary Care Connected (YTD)', so its true branch was
    // unreachable and both rows showed the readmissions text (defect D5).
    test('each metric has its own caption', () {
      expect(
        ContinuityMetric.primaryCareConnected.caption,
        isNot(ContinuityMetric.hospitalReadmissions.caption),
      );
      expect(
        ContinuityMetric.primaryCareConnected.caption,
        contains('street to clinic'),
      );
      expect(
        ContinuityMetric.hospitalReadmissions.caption,
        contains('readmission'),
      );
    });
  });

  group('AccessTier', () {
    test('gates editing and administration', () {
      expect(AccessTier.viewOnly.canEdit, isFalse);
      expect(AccessTier.viewOnly.canAdminister, isFalse);
      expect(AccessTier.standard.canEdit, isTrue);
      expect(AccessTier.standard.canAdminister, isFalse);
      expect(AccessTier.fullAdmin.canAdminister, isTrue);
    });
  });

  group('AppUser.initials', () {
    test('strips credentials after a comma', () {
      const user = AppUser(
        id: 'u1',
        name: 'Sarah Chen, RN',
        role: 'Administrator',
        email: 's.chen@streetmed.org',
        agency: 'Street Medicine Detroit',
        team: 'Lead Outreach Council',
        access: AccessTier.fullAdmin,
      );
      expect(user.initials, 'SC');
    });
  });
}
