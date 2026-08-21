import 'package:latlong2/latlong.dart';

import 'enums.dart';

/// A partner facility: shelter, clinic, pharmacy, restroom, etc.
class FieldResource {
  const FieldResource({
    required this.id,
    required this.name,
    required this.type,
    required this.loc,
    required this.lat,
    required this.lng,
    required this.hours,
    required this.phone,
  });

  final String id;
  final String name;
  final ResourceType type;
  final String loc;
  final double lat;
  final double lng;
  final String hours;
  final String phone;

  LatLng get position => LatLng(lat, lng);

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'type': type.label,
    'loc': loc,
    'lat': lat,
    'lng': lng,
    'hours': hours,
    'phone': phone,
  };

  factory FieldResource.fromJson(Map<String, dynamic> j) => FieldResource(
    id: j['id'] as String,
    name: j['name'] as String,
    type: ResourceType.fromLabel(j['type'] as String?),
    loc: j['loc'] as String? ?? '',
    lat: (j['lat'] as num).toDouble(),
    lng: (j['lng'] as num).toDouble(),
    hours: j['hours'] as String? ?? '',
    phone: j['phone'] as String? ?? 'N/A',
  );
}

/// A geographic cluster: disease surveillance, unmet need, or supply draw.
class Hotspot {
  const Hotspot({
    required this.id,
    required this.name,
    required this.type,
    required this.intensity,
    required this.patients,
    required this.lat,
    required this.lng,
    this.supply,
  });

  final String id;
  final String name;
  final HotspotType type;
  final Intensity intensity;
  final int patients;
  final double lat;
  final double lng;

  /// Only set for `HotspotType.supplyUsage`.
  final String? supply;

  LatLng get position => LatLng(lat, lng);

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'type': type.label,
    'intensity': intensity.label,
    'patients': patients,
    'lat': lat,
    'lng': lng,
    'supply': supply,
  };

  factory Hotspot.fromJson(Map<String, dynamic> j) => Hotspot(
    id: j['id'] as String,
    name: j['name'] as String,
    type: HotspotType.fromLabel(j['type'] as String?),
    intensity: Intensity.fromLabel(j['intensity'] as String?),
    patients: (j['patients'] as num?)?.toInt() ?? 0,
    lat: (j['lat'] as num).toDouble(),
    lng: (j['lng'] as num).toDouble(),
    supply: j['supply'] as String?,
  );
}

class TeamTask {
  const TeamTask({
    required this.id,
    required this.text,
    required this.status,
    required this.priority,
  });

  final String id;
  final String text;
  final TaskStatus status;
  final TaskPriority priority;

  bool get isPending => status == TaskStatus.pending;

  TeamTask copyWith({TaskStatus? status}) => TeamTask(
    id: id,
    text: text,
    status: status ?? this.status,
    priority: priority,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'text': text,
    'status': status.name,
    'priority': priority.label,
  };

  factory TeamTask.fromJson(Map<String, dynamic> j) => TeamTask(
    id: j['id'] as String,
    text: j['text'] as String,
    status: j['status'] == 'completed'
        ? TaskStatus.completed
        : TaskStatus.pending,
    priority: TaskPriority.fromLabel(j['priority'] as String?),
  );
}

class OutreachAction {
  const OutreachAction({
    required this.id,
    required this.time,
    required this.location,
    required this.goal,
  });

  final String id;
  final String time;
  final String location;
  final String goal;

  Map<String, dynamic> toJson() => {
    'id': id,
    'time': time,
    'location': location,
    'goal': goal,
  };

  factory OutreachAction.fromJson(Map<String, dynamic> j) => OutreachAction(
    id: j['id'] as String,
    time: j['time'] as String,
    location: j['location'] as String,
    goal: j['goal'] as String,
  );
}

class TeamMember {
  const TeamMember({
    required this.id,
    required this.name,
    required this.role,
    required this.status,
    required this.access,
    this.isSelf = false,
  });

  final String id;
  final String name;
  final String role;
  final MemberStatus status;
  final AccessTier access;
  final bool isSelf;

  bool get isActive => status == MemberStatus.active;

  String get initials =>
      name.split(' ').where((p) => p.isNotEmpty).map((p) => p[0]).join();

  TeamMember copyWith({MemberStatus? status, AccessTier? access}) => TeamMember(
    id: id,
    name: name,
    role: role,
    status: status ?? this.status,
    access: access ?? this.access,
    isSelf: isSelf,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'role': role,
    'status': status.label,
    'access': access.label,
    'isSelf': isSelf,
  };

  factory TeamMember.fromJson(Map<String, dynamic> j) => TeamMember(
    id: j['id'] as String,
    name: j['name'] as String,
    role: j['role'] as String,
    status: MemberStatus.fromLabel(j['status'] as String?),
    access: AccessTier.fromLabel(j['access'] as String?),
    isSelf: j['isSelf'] as bool? ?? false,
  );
}

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.role,
    required this.email,
    required this.agency,
    required this.team,
    required this.access,
  });

  final String id;
  final String name;
  final String role;
  final String email;
  final String agency;
  final String team;
  final AccessTier access;

  bool get isAdmin => access.canAdminister;

  String get initials => name
      .replaceAll(RegExp(r',.*$'), '')
      .split(' ')
      .where((p) => p.isNotEmpty)
      .map((p) => p[0])
      .take(2)
      .join()
      .toUpperCase();
}
