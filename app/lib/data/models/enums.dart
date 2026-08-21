/// Domain enums replacing the prototype's bare strings.
///
/// The prototype compared string literals in ~40 places, which is where
/// defects D1 and D5 came from (`'home'` matching no case, and a label
/// comparison that could never be true). Enums make those unrepresentable.
library;

enum RiskLevel {
  low('Low'),
  moderate('Moderate'),
  high('High');

  const RiskLevel(this.label);
  final String label;

  static RiskLevel fromLabel(String? s) => switch (s) {
    'High' => RiskLevel.high,
    'Moderate' => RiskLevel.moderate,
    _ => RiskLevel.low,
  };
}

enum PatientFlag {
  pregnancy('Pregnancy', '🤰'),
  mentalHealth('Mental Health', '🧠'),
  chronicDisease('Chronic Disease', '🏥');

  const PatientFlag(this.label, this.emoji);
  final String label;
  final String emoji;

  static PatientFlag? fromLabel(String? s) {
    for (final f in PatientFlag.values) {
      if (f.label == s) return f;
    }
    return null;
  }
}

enum SupplyCategory {
  medical('Medical'),
  essentials('Essentials'),
  clothing('Clothing');

  const SupplyCategory(this.label);
  final String label;

  static SupplyCategory fromLabel(String? s) => switch (s) {
    'Essentials' => SupplyCategory.essentials,
    'Clothing' => SupplyCategory.clothing,
    _ => SupplyCategory.medical,
  };
}

enum StockStatus { inStock, low, out }

enum ResourceType {
  shelter('Shelter', '🏠'),
  hospital('Hospital', '🏥'),
  soupKitchen('Soup Kitchen', '🍲'),
  pharmacy('Pharmacy', '💊'),
  dental('Dental', '🦷'),
  restroom('Restroom', '🚻');

  const ResourceType(this.label, this.emoji);
  final String label;
  final String emoji;

  static ResourceType fromLabel(String? s) {
    for (final t in ResourceType.values) {
      if (t.label == s) return t;
    }
    return ResourceType.shelter;
  }
}

enum HotspotType {
  risingNeed('Rising Need'),
  foodDesert('Food Desert'),
  pharmacyDesert('Pharmacy Desert'),
  supplyUsage('Supply Usage'),
  hepatitisC('Hepatitis C'),
  hiv('HIV'),
  covid19('COVID-19'),
  scabies('Scabies');

  const HotspotType(this.label);
  final String label;

  static HotspotType fromLabel(String? s) {
    for (final t in HotspotType.values) {
      if (t.label == s) return t;
    }
    return HotspotType.risingNeed;
  }

  /// The prototype's heatmap layer excludes supply-usage hotspots and the
  /// inventory layer shows only those.
  bool get isSupply => this == HotspotType.supplyUsage;

  /// Anything not in the named non-clinical buckets is treated as an
  /// infectious-disease cluster and rendered red.
  bool get isInfectious =>
      this != HotspotType.risingNeed &&
      this != HotspotType.foodDesert &&
      this != HotspotType.pharmacyDesert &&
      this != HotspotType.supplyUsage;
}

enum Intensity {
  low('Low'),
  moderate('Moderate'),
  high('High');

  const Intensity(this.label);
  final String label;

  static Intensity fromLabel(String? s) => switch (s) {
    'High' => Intensity.high,
    'Moderate' => Intensity.moderate,
    _ => Intensity.low,
  };

  /// `h.intensity === 'High' ? 700 : 400`
  double get baseRadiusMeters => this == Intensity.high ? 700 : 400;
}

enum TaskPriority {
  low('Low'),
  moderate('Moderate'),
  high('High');

  const TaskPriority(this.label);
  final String label;

  static TaskPriority fromLabel(String? s) => switch (s) {
    'High' => TaskPriority.high,
    'Moderate' => TaskPriority.moderate,
    _ => TaskPriority.low,
  };
}

enum TaskStatus { pending, completed }

enum MapLayer {
  patients('Patients'),
  resources('Resources'),
  heatmap('Heatmap'),
  inventory('Inventory');

  const MapLayer(this.label);
  final String label;

  static MapLayer fromLabel(String? s) {
    for (final l in MapLayer.values) {
      if (l.label == s) return l;
    }
    return MapLayer.patients;
  }
}

/// Replaces the prototype's `activeTab` string, which had an orphan initial
/// value of `'home'` that matched no route (plan defect D1).
enum AppTab {
  dashboard('Dashboard'),
  patients('Patients'),
  map('Map'),
  inventory('Inventory'),
  insights('Insights');

  const AppTab(this.label);
  final String label;
}

enum AccessTier {
  fullAdmin('Full Admin'),
  standard('Standard'),
  viewOnly('View Only');

  const AccessTier(this.label);
  final String label;

  static AccessTier fromLabel(String? s) {
    for (final a in AccessTier.values) {
      if (a.label == s) return a;
    }
    return AccessTier.viewOnly;
  }

  bool get canEdit => this != AccessTier.viewOnly;
  bool get canAdminister => this == AccessTier.fullAdmin;
}

enum MemberStatus {
  active('Active'),
  inactive('Inactive');

  const MemberStatus(this.label);
  final String label;

  static MemberStatus fromLabel(String? s) =>
      s == 'Inactive' ? MemberStatus.inactive : MemberStatus.active;
}

enum OutcomeStatus {
  onTrack('On Track'),
  needsAttention('Needs Attention'),
  atRisk('At Risk');

  const OutcomeStatus(this.label);
  final String label;

  static OutcomeStatus fromLabel(String? s) => switch (s) {
    'Needs Attention' => OutcomeStatus.needsAttention,
    'At Risk' => OutcomeStatus.atRisk,
    _ => OutcomeStatus.onTrack,
  };
}

/// Distinguishes the two continuity rows without matching on display text —
/// the prototype compared against `'Primary Care Connected'` while the data
/// said `'Primary Care Connected (YTD)'`, so its true branch was unreachable
/// (plan defect D5).
enum ContinuityMetric {
  primaryCareConnected(
    'Primary Care Connected (YTD)',
    'Demonstrates successful bridge from street to clinic.',
  ),
  hospitalReadmissions(
    'Hospital Readmissions (YTD)',
    '30-day post-discharge readmission rate tracking.',
  );

  const ContinuityMetric(this.label, this.caption);
  final String label;
  final String caption;
}
