import 'package:latlong2/latlong.dart';

import '../../core/util/formatting.dart';
import 'enums.dart';

/// A place a patient is regularly found. Drives the field-intelligence map
/// and the historical-movement list on the patient detail screen.
class CommonLocation {
  const CommonLocation({
    required this.name,
    required this.lat,
    required this.lng,
    required this.observedAt,
    this.verified = true,
  });

  final String name;
  final double lat;
  final double lng;
  final DateTime observedAt;
  final bool verified;

  LatLng get position => LatLng(lat, lng);

  /// The prototype stored `date`, `day`, and `time` as three denormalised
  /// strings. One timestamp derives all three.
  String get date => Fmt.isoDate(observedAt);
  String get day => Fmt.weekday(observedAt);
  String get time => Fmt.time12(observedAt);

  Map<String, dynamic> toJson() => {
    'name': name,
    'lat': lat,
    'lng': lng,
    'observedAt': observedAt.toIso8601String(),
    'verified': verified,
  };

  factory CommonLocation.fromJson(Map<String, dynamic> j) => CommonLocation(
    name: j['name'] as String,
    lat: (j['lat'] as num).toDouble(),
    lng: (j['lng'] as num).toDouble(),
    observedAt: DateTime.parse(j['observedAt'] as String),
    verified: j['verified'] as bool? ?? true,
  );

  CommonLocation copyWith({
    String? name,
    double? lat,
    double? lng,
    DateTime? observedAt,
    bool? verified,
  }) => CommonLocation(
    name: name ?? this.name,
    lat: lat ?? this.lat,
    lng: lng ?? this.lng,
    observedAt: observedAt ?? this.observedAt,
    verified: verified ?? this.verified,
  );
}

/// A documented field encounter. Append-only: an encounter is never
/// overwritten by sync, only superseded by a later one.
class Encounter {
  const Encounter({
    required this.id,
    required this.patientId,
    required this.date,
    required this.provider,
    required this.needs,
    required this.encounterLoc,
    required this.notes,
    this.supplies = const [],
    this.followUpSet = false,
    this.followUpDate,
    this.followUpLoc,
    this.lat,
    this.lng,
  });

  final String id;
  final String patientId;
  final DateTime date;
  final String provider;
  final String needs;
  final String encounterLoc;
  final String notes;

  /// Free-text supply descriptions as displayed, e.g.
  /// "Amoxicillin 500mg (1 tab twice daily for 7 days)".
  final List<String> supplies;

  final bool followUpSet;
  final DateTime? followUpDate;
  final String? followUpLoc;
  final double? lat;
  final double? lng;

  LatLng? get position =>
      (lat == null || lng == null) ? null : LatLng(lat!, lng!);

  Map<String, dynamic> toJson() => {
    'id': id,
    'patientId': patientId,
    'date': date.toIso8601String(),
    'provider': provider,
    'needs': needs,
    'encounterLoc': encounterLoc,
    'notes': notes,
    'supplies': supplies,
    'followUpSet': followUpSet,
    'followUpDate': followUpDate?.toIso8601String(),
    'followUpLoc': followUpLoc,
    'lat': lat,
    'lng': lng,
  };

  factory Encounter.fromJson(Map<String, dynamic> j) => Encounter(
    id: j['id'] as String,
    patientId: j['patientId'] as String,
    date: DateTime.parse(j['date'] as String),
    provider: j['provider'] as String,
    needs: j['needs'] as String? ?? '',
    encounterLoc: j['encounterLoc'] as String? ?? 'Field Location',
    notes: j['notes'] as String? ?? '',
    supplies:
        (j['supplies'] as List?)?.map((e) => e as String).toList() ?? const [],
    followUpSet: j['followUpSet'] as bool? ?? false,
    followUpDate: Fmt.tryParseIso(j['followUpDate'] as String?),
    followUpLoc: j['followUpLoc'] as String?,
    lat: (j['lat'] as num?)?.toDouble(),
    lng: (j['lng'] as num?)?.toDouble(),
  );
}

class Patient {
  const Patient({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.dob,
    required this.risk,
    required this.loc,
    required this.lat,
    required this.lng,
    this.tags = const [],
    this.flags = const [],
    this.followUp = false,
    this.nextFollowUp,
    this.commonLocations = const [],
    this.history = const [],
    this.phone,
    this.insuranceName,
    this.memberId,
    this.primaryDoctor,
    this.updatedAt,
  });

  final String id;
  final String firstName;
  final String lastName;
  final DateTime dob;
  final RiskLevel risk;
  final String loc;
  final double lat;
  final double lng;
  final List<String> tags;
  final List<PatientFlag> flags;
  final bool followUp;
  final DateTime? nextFollowUp;
  final List<CommonLocation> commonLocations;
  final List<Encounter> history;
  final String? phone;
  final String? insuranceName;
  final String? memberId;
  final String? primaryDoctor;
  final DateTime? updatedAt;

  String get name => '$firstName $lastName';
  LatLng get position => LatLng(lat, lng);

  /// True age, unlike the prototype's year subtraction (plan defect D10).
  int get age => Fmt.age(dob);

  String get dobIso => Fmt.isoDate(dob);
  String get nextFollowUpIso =>
      nextFollowUp == null ? '' : Fmt.isoDate(nextFollowUp!);

  bool hasFlag(PatientFlag f) => flags.contains(f);

  /// Matches the prototype's search: name substring OR DOB substring.
  bool matchesSearch(String query) {
    if (query.isEmpty) return true;
    final q = query.toLowerCase();
    return name.toLowerCase().contains(q) || dobIso.contains(query);
  }

  Patient copyWith({
    String? firstName,
    String? lastName,
    DateTime? dob,
    RiskLevel? risk,
    String? loc,
    double? lat,
    double? lng,
    List<String>? tags,
    List<PatientFlag>? flags,
    bool? followUp,
    DateTime? nextFollowUp,
    bool clearNextFollowUp = false,
    List<CommonLocation>? commonLocations,
    List<Encounter>? history,
    String? phone,
    String? insuranceName,
    String? memberId,
    String? primaryDoctor,
    DateTime? updatedAt,
  }) => Patient(
    id: id,
    firstName: firstName ?? this.firstName,
    lastName: lastName ?? this.lastName,
    dob: dob ?? this.dob,
    risk: risk ?? this.risk,
    loc: loc ?? this.loc,
    lat: lat ?? this.lat,
    lng: lng ?? this.lng,
    tags: tags ?? this.tags,
    flags: flags ?? this.flags,
    followUp: followUp ?? this.followUp,
    nextFollowUp: clearNextFollowUp
        ? null
        : (nextFollowUp ?? this.nextFollowUp),
    commonLocations: commonLocations ?? this.commonLocations,
    history: history ?? this.history,
    phone: phone ?? this.phone,
    insuranceName: insuranceName ?? this.insuranceName,
    memberId: memberId ?? this.memberId,
    primaryDoctor: primaryDoctor ?? this.primaryDoctor,
    updatedAt: updatedAt ?? this.updatedAt,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'firstName': firstName,
    'lastName': lastName,
    'dob': Fmt.isoDate(dob),
    'risk': risk.label,
    'loc': loc,
    'lat': lat,
    'lng': lng,
    'tags': tags,
    'flags': flags.map((f) => f.label).toList(),
    'followUp': followUp,
    'nextFollowUp': nextFollowUp == null ? null : Fmt.isoDate(nextFollowUp!),
    'commonLocations': commonLocations.map((c) => c.toJson()).toList(),
    'history': history.map((h) => h.toJson()).toList(),
    'phone': phone,
    'insuranceName': insuranceName,
    'memberId': memberId,
    'primaryDoctor': primaryDoctor,
    'updatedAt': updatedAt?.toIso8601String(),
  };

  factory Patient.fromJson(Map<String, dynamic> j) => Patient(
    id: j['id'] as String,
    firstName: j['firstName'] as String,
    lastName: j['lastName'] as String,
    dob: DateTime.parse(j['dob'] as String),
    risk: RiskLevel.fromLabel(j['risk'] as String?),
    loc: j['loc'] as String? ?? '',
    lat: (j['lat'] as num).toDouble(),
    lng: (j['lng'] as num).toDouble(),
    tags: (j['tags'] as List?)?.map((e) => e as String).toList() ?? const [],
    flags:
        (j['flags'] as List?)
            ?.map((e) => PatientFlag.fromLabel(e as String))
            .whereType<PatientFlag>()
            .toList() ??
        const [],
    followUp: j['followUp'] as bool? ?? false,
    nextFollowUp: Fmt.tryParseIso(j['nextFollowUp'] as String?),
    commonLocations:
        (j['commonLocations'] as List?)
            ?.map((e) => CommonLocation.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    history:
        (j['history'] as List?)
            ?.map((e) => Encounter.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const [],
    phone: j['phone'] as String?,
    insuranceName: j['insuranceName'] as String?,
    memberId: j['memberId'] as String?,
    primaryDoctor: j['primaryDoctor'] as String?,
    updatedAt: Fmt.tryParseIso(j['updatedAt'] as String?),
  );
}
