// GENERATED FILE. Do not edit by hand.
// Source: packages/contract/openapi.json (Sineobex API 0.1.0).
// Regenerate with `pnpm contract:generate`; CI fails if this file is out of date.
// ignore_for_file: type=lint, unused_element

import 'transport.dart';

enum AcknowledgementKind {
  termsOfUse('terms_of_use'),
  confidentiality('confidentiality'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const AcknowledgementKind(this.wire);
  final String wire;

  static AcknowledgementKind fromJson(String value) =>
      AcknowledgementKind.values.firstWhere((e) => e.wire == value, orElse: () => AcknowledgementKind.unknown);

  String toJson() => wire;
}

enum ChangeEntity {
  encounter('encounter'),
  encounterNote('encounter_note'),
  audit('audit'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ChangeEntity(this.wire);
  final String wire;

  static ChangeEntity fromJson(String value) =>
      ChangeEntity.values.firstWhere((e) => e.wire == value, orElse: () => ChangeEntity.unknown);

  String toJson() => wire;
}

enum ChangeMemberCredentialResponseDirection {
  up('up'),
  down('down'),
  same('same'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ChangeMemberCredentialResponseDirection(this.wire);
  final String wire;

  static ChangeMemberCredentialResponseDirection fromJson(String value) =>
      ChangeMemberCredentialResponseDirection.values.firstWhere((e) => e.wire == value, orElse: () => ChangeMemberCredentialResponseDirection.unknown);

  String toJson() => wire;
}

enum ChangeMemberCredentialResponseStatus {
  active('active'),
  removed('removed'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ChangeMemberCredentialResponseStatus(this.wire);
  final String wire;

  static ChangeMemberCredentialResponseStatus fromJson(String value) =>
      ChangeMemberCredentialResponseStatus.values.firstWhere((e) => e.wire == value, orElse: () => ChangeMemberCredentialResponseStatus.unknown);

  String toJson() => wire;
}

enum Credential {
  attending('attending'),
  resident('resident'),
  np('np'),
  pa('pa'),
  student('student'),
  chw('chw'),
  none('none'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const Credential(this.wire);
  final String wire;

  static Credential fromJson(String value) =>
      Credential.values.firstWhere((e) => e.wire == value, orElse: () => Credential.unknown);

  String toJson() => wire;
}

enum DecideQuarantineDecision {
  accept('accept'),
  reject('reject'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DecideQuarantineDecision(this.wire);
  final String wire;

  static DecideQuarantineDecision fromJson(String value) =>
      DecideQuarantineDecision.values.firstWhere((e) => e.wire == value, orElse: () => DecideQuarantineDecision.unknown);

  String toJson() => wire;
}

enum DeviceStatus {
  active('active'),
  wipeRequested('wipe_requested'),
  wiped('wiped'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DeviceStatus(this.wire);
  final String wire;

  static DeviceStatus fromJson(String value) =>
      DeviceStatus.values.firstWhere((e) => e.wire == value, orElse: () => DeviceStatus.unknown);

  String toJson() => wire;
}

/// removed: the user lost access to the team; upload unsynced work to quarantine, then wipe
enum DeviceStatusResultAccess {
  active('active'),
  removed('removed'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DeviceStatusResultAccess(this.wire);
  final String wire;

  static DeviceStatusResultAccess fromJson(String value) =>
      DeviceStatusResultAccess.values.firstWhere((e) => e.wire == value, orElse: () => DeviceStatusResultAccess.unknown);

  String toJson() => wire;
}

enum HealthEnvironment {
  local('local'),
  test('test'),
  preview('preview'),
  pilot('pilot'),
  production('production'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const HealthEnvironment(this.wire);
  final String wire;

  static HealthEnvironment fromJson(String value) =>
      HealthEnvironment.values.firstWhere((e) => e.wire == value, orElse: () => HealthEnvironment.unknown);

  String toJson() => wire;
}

enum ListQuarantineStatus {
  pending('pending'),
  accepted('accepted'),
  rejected('rejected'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ListQuarantineStatus(this.wire);
  final String wire;

  static ListQuarantineStatus fromJson(String value) =>
      ListQuarantineStatus.values.firstWhere((e) => e.wire == value, orElse: () => ListQuarantineStatus.unknown);

  String toJson() => wire;
}

enum MemberStatus {
  active('active'),
  removed('removed'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const MemberStatus(this.wire);
  final String wire;

  static MemberStatus fromJson(String value) =>
      MemberStatus.values.firstWhere((e) => e.wire == value, orElse: () => MemberStatus.unknown);

  String toJson() => wire;
}

enum MembershipChangeKind {
  invited('invited'),
  role('role'),
  credential('credential'),
  removed('removed'),
  restored('restored'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const MembershipChangeKind(this.wire);
  final String wire;

  static MembershipChangeKind fromJson(String value) =>
      MembershipChangeKind.values.firstWhere((e) => e.wire == value, orElse: () => MembershipChangeKind.unknown);

  String toJson() => wire;
}

enum MyTeamTeamStatus {
  active('active'),
  suspended('suspended'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const MyTeamTeamStatus(this.wire);
  final String wire;

  static MyTeamTeamStatus fromJson(String value) =>
      MyTeamTeamStatus.values.firstWhere((e) => e.wire == value, orElse: () => MyTeamTeamStatus.unknown);

  String toJson() => wire;
}

enum OwnerTeamStatus {
  active('active'),
  suspended('suspended'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const OwnerTeamStatus(this.wire);
  final String wire;

  static OwnerTeamStatus fromJson(String value) =>
      OwnerTeamStatus.values.firstWhere((e) => e.wire == value, orElse: () => OwnerTeamStatus.unknown);

  String toJson() => wire;
}

enum Permission {
  teamManageUsers('team.manage_users'),
  teamManagePresets('team.manage_presets'),
  teamViewAudit('team.view_audit'),
  patientsView('patients.view'),
  patientsEdit('patients.edit'),
  patientsCorrectIdentity('patients.correct_identity'),
  patientsReviewDuplicates('patients.review_duplicates'),
  patientsViewSensitive('patients.view_sensitive'),
  patientsViewSensitiveExams('patients.view_sensitive_exams'),
  patientsReverseResolved('patients.reverse_resolved'),
  encountersChart('encounters.chart'),
  checkinsCreate('checkins.create'),
  referralsCreate('referrals.create'),
  routesView('routes.view'),
  routesManage('routes.manage'),
  inventoryView('inventory.view'),
  inventoryManage('inventory.manage'),
  billingViewCodes('billing.view_codes'),
  exportsBilling('exports.billing'),
  exportsGrant('exports.grant'),
  exportsData('exports.data'),
  quarantineReview('quarantine.review'),
  devicesManage('devices.manage'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const Permission(this.wire);
  final String wire;

  static Permission fromJson(String value) =>
      Permission.values.firstWhere((e) => e.wire == value, orElse: () => Permission.unknown);

  String toJson() => wire;
}

/// awaiting_review: it belongs to a record whose create is also waiting here, so that is decided first
enum QuarantineItemReason {
  accessRemoved('access_removed'),
  permission('permission'),
  awaitingReview('awaiting_review'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const QuarantineItemReason(this.wire);
  final String wire;

  static QuarantineItemReason fromJson(String value) =>
      QuarantineItemReason.values.firstWhere((e) => e.wire == value, orElse: () => QuarantineItemReason.unknown);

  String toJson() => wire;
}

enum QuarantineItemStatus {
  pending('pending'),
  accepted('accepted'),
  rejected('rejected'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const QuarantineItemStatus(this.wire);
  final String wire;

  static QuarantineItemStatus fromJson(String value) =>
      QuarantineItemStatus.values.firstWhere((e) => e.wire == value, orElse: () => QuarantineItemStatus.unknown);

  String toJson() => wire;
}

/// quarantined: held for a Program Admin; recorded: an activity log entry, now in the audit chain
enum QuarantineReceiptResultsItemStatus {
  quarantined('quarantined'),
  recorded('recorded'),
  rejected('rejected'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const QuarantineReceiptResultsItemStatus(this.wire);
  final String wire;

  static QuarantineReceiptResultsItemStatus fromJson(String value) =>
      QuarantineReceiptResultsItemStatus.values.firstWhere((e) => e.wire == value, orElse: () => QuarantineReceiptResultsItemStatus.unknown);

  String toJson() => wire;
}

enum RecordEntity {
  encounter('encounter'),
  encounterNote('encounter_note'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const RecordEntity(this.wire);
  final String wire;

  static RecordEntity fromJson(String value) =>
      RecordEntity.values.firstWhere((e) => e.wire == value, orElse: () => RecordEntity.unknown);

  String toJson() => wire;
}

enum RegisterDevicePlatform {
  ios('ios'),
  android('android'),
  other('other'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const RegisterDevicePlatform(this.wire);
  final String wire;

  static RegisterDevicePlatform fromJson(String value) =>
      RegisterDevicePlatform.values.firstWhere((e) => e.wire == value, orElse: () => RegisterDevicePlatform.unknown);

  String toJson() => wire;
}

enum RejectReason {
  validation('validation'),
  signingRule('signing_rule'),
  staleReference('stale_reference'),
  permission('permission'),
  recordLocked('record_locked'),
  hashMismatch('hash_mismatch'),
  awaitingReview('awaiting_review'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const RejectReason(this.wire);
  final String wire;

  static RejectReason fromJson(String value) =>
      RejectReason.values.firstWhere((e) => e.wire == value, orElse: () => RejectReason.unknown);

  String toJson() => wire;
}

enum SyncChangeOp {
  create('create'),
  setValue('set'),
  append('append'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SyncChangeOp(this.wire);
  final String wire;

  static SyncChangeOp fromJson(String value) =>
      SyncChangeOp.values.firstWhere((e) => e.wire == value, orElse: () => SyncChangeOp.unknown);

  String toJson() => wire;
}

enum SyncChangeResolution {
  replace('replace'),
  keepServer('keep_server'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SyncChangeResolution(this.wire);
  final String wire;

  static SyncChangeResolution fromJson(String value) =>
      SyncChangeResolution.values.firstWhere((e) => e.wire == value, orElse: () => SyncChangeResolution.unknown);

  String toJson() => wire;
}

enum SyncResultStatus {
  accepted('accepted'),
  rejected('rejected'),
  conflict('conflict'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SyncResultStatus(this.wire);
  final String wire;

  static SyncResultStatus fromJson(String value) =>
      SyncResultStatus.values.firstWhere((e) => e.wire == value, orElse: () => SyncResultStatus.unknown);

  String toJson() => wire;
}

enum TeamStatusChangeStatus {
  active('active'),
  suspended('suspended'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const TeamStatusChangeStatus(this.wire);
  final String wire;

  static TeamStatusChangeStatus fromJson(String value) =>
      TeamStatusChangeStatus.values.firstWhere((e) => e.wire == value, orElse: () => TeamStatusChangeStatus.unknown);

  String toJson() => wire;
}

class Acknowledgement {
  const Acknowledgement({
    required this.kind,
    required this.version,
  });

  final AcknowledgementKind kind;
  final String version;

  factory Acknowledgement.fromJson(Map<String, dynamic> json) => Acknowledgement(
        kind: AcknowledgementKind.fromJson(json['kind'] as String),
        version: json['version'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind.toJson(),
        'version': version,
      };
}

class AppointAdmin {
  const AppointAdmin({
    this.credential,
    this.credentialFields,
    required this.displayName,
    required this.email,
  });

  final Credential? credential;
  final CredentialFields? credentialFields;
  final String displayName;
  final String email;

  factory AppointAdmin.fromJson(Map<String, dynamic> json) => AppointAdmin(
        credential: json['credential'] == null ? null : Credential.fromJson(json['credential'] as String),
        credentialFields: json['credentialFields'] == null ? null : CredentialFields.fromJson(json['credentialFields'] as Map<String, dynamic>),
        displayName: json['displayName'] as String,
        email: json['email'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (credential != null) 'credential': credential!.toJson(),
        if (credentialFields != null) 'credentialFields': credentialFields!.toJson(),
        'displayName': displayName,
        'email': email,
      };
}

class AuditEntry {
  const AuditEntry({
    required this.action,
    required this.actor,
    required this.details,
    required this.deviceId,
    required this.deviceTime,
    required this.entity,
    required this.entityId,
    required this.id,
    required this.ip,
    required this.occurredAt,
    required this.patientId,
    required this.seq,
  });

  final String action;
  final AuditEntryActor actor;
  final Map<String, Object?> details;
  final String? deviceId;
  final DateTime? deviceTime;
  final String? entity;
  final String? entityId;
  final String id;
  final String? ip;
  final DateTime occurredAt;
  final String? patientId;
  final String seq;

  factory AuditEntry.fromJson(Map<String, dynamic> json) => AuditEntry(
        action: json['action'] as String,
        actor: AuditEntryActor.fromJson(json['actor'] as Map<String, dynamic>),
        details: Map<String, Object?>.from(json['details'] as Map),
        deviceId: json['deviceId'] == null ? null : json['deviceId'] as String,
        deviceTime: json['deviceTime'] == null ? null : DateTime.parse(json['deviceTime'] as String),
        entity: json['entity'] == null ? null : json['entity'] as String,
        entityId: json['entityId'] == null ? null : json['entityId'] as String,
        id: json['id'] as String,
        ip: json['ip'] == null ? null : json['ip'] as String,
        occurredAt: DateTime.parse(json['occurredAt'] as String),
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        seq: json['seq'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'action': action,
        'actor': actor.toJson(),
        'details': details,
        'deviceId': deviceId == null ? null : deviceId!,
        'deviceTime': deviceTime == null ? null : deviceTime!.toUtc().toIso8601String(),
        'entity': entity == null ? null : entity!,
        'entityId': entityId == null ? null : entityId!,
        'id': id,
        'ip': ip == null ? null : ip!,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
        'patientId': patientId == null ? null : patientId!,
        'seq': seq,
      };
}

class AuditEntryActor {
  const AuditEntryActor({
    required this.displayName,
    required this.role,
    required this.userId,
  });

  final String? displayName;
  final String? role;
  final String? userId;

  factory AuditEntryActor.fromJson(Map<String, dynamic> json) => AuditEntryActor(
        displayName: json['displayName'] == null ? null : json['displayName'] as String,
        role: json['role'] == null ? null : json['role'] as String,
        userId: json['userId'] == null ? null : json['userId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'displayName': displayName == null ? null : displayName!,
        'role': role == null ? null : role!,
        'userId': userId == null ? null : userId!,
      };
}

class AuditPage {
  const AuditPage({
    required this.entries,
    required this.nextBeforeId,
  });

  final List<AuditEntry> entries;
  final String? nextBeforeId;

  factory AuditPage.fromJson(Map<String, dynamic> json) => AuditPage(
        entries: (json['entries'] as List<dynamic>).map((e) => AuditEntry.fromJson(e as Map<String, dynamic>)).toList(),
        nextBeforeId: json['nextBeforeId'] == null ? null : json['nextBeforeId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'entries': entries.map((e) => e.toJson()).toList(),
        'nextBeforeId': nextBeforeId == null ? null : nextBeforeId!,
      };
}

class AuditSearch {
  const AuditSearch({
    this.actionPrefix,
    this.actorUserId,
    this.beforeId,
    this.from,
    this.limit,
    this.patientId,
    this.to,
  });

  final String? actionPrefix;
  final String? actorUserId;
  final String? beforeId;
  final DateTime? from;
  final int? limit;
  final String? patientId;
  final DateTime? to;

  factory AuditSearch.fromJson(Map<String, dynamic> json) => AuditSearch(
        actionPrefix: json['actionPrefix'] == null ? null : json['actionPrefix'] as String,
        actorUserId: json['actorUserId'] == null ? null : json['actorUserId'] as String,
        beforeId: json['beforeId'] == null ? null : json['beforeId'] as String,
        from: json['from'] == null ? null : DateTime.parse(json['from'] as String),
        limit: json['limit'] == null ? null : (json['limit'] as num).toInt(),
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        to: json['to'] == null ? null : DateTime.parse(json['to'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (actionPrefix != null) 'actionPrefix': actionPrefix!,
        if (actorUserId != null) 'actorUserId': actorUserId!,
        if (beforeId != null) 'beforeId': beforeId!,
        if (from != null) 'from': from!.toUtc().toIso8601String(),
        if (limit != null) 'limit': limit!,
        if (patientId != null) 'patientId': patientId!,
        if (to != null) 'to': to!.toUtc().toIso8601String(),
      };
}

class ChainCheck {
  const ChainCheck({
    required this.checked,
    required this.firstBadSeq,
    required this.ok,
    required this.problem,
  });

  final int checked;
  final int? firstBadSeq;
  final bool ok;
  final String? problem;

  factory ChainCheck.fromJson(Map<String, dynamic> json) => ChainCheck(
        checked: (json['checked'] as num).toInt(),
        firstBadSeq: json['firstBadSeq'] == null ? null : (json['firstBadSeq'] as num).toInt(),
        ok: json['ok'] as bool,
        problem: json['problem'] == null ? null : json['problem'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'checked': checked,
        'firstBadSeq': firstBadSeq == null ? null : firstBadSeq!,
        'ok': ok,
        'problem': problem == null ? null : problem!,
      };
}

class ChangeCredential {
  const ChangeCredential({
    required this.credential,
    this.credentialFields,
    required this.reason,
  });

  final Credential credential;
  final CredentialFields? credentialFields;
  /// Why, in a few words. Logged.
  final String reason;

  factory ChangeCredential.fromJson(Map<String, dynamic> json) => ChangeCredential(
        credential: Credential.fromJson(json['credential'] as String),
        credentialFields: json['credentialFields'] == null ? null : CredentialFields.fromJson(json['credentialFields'] as Map<String, dynamic>),
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'credential': credential.toJson(),
        if (credentialFields != null) 'credentialFields': credentialFields!.toJson(),
        'reason': reason,
      };
}

class ChangeMemberCredentialResponse {
  const ChangeMemberCredentialResponse({
    required this.credential,
    required this.credentialFields,
    required this.displayName,
    required this.email,
    required this.invitedAt,
    required this.membershipId,
    required this.removedAt,
    required this.role,
    required this.status,
    required this.userId,
    required this.direction,
  });

  final Credential credential;
  final CredentialFields credentialFields;
  final String displayName;
  final String email;
  final DateTime invitedAt;
  final String membershipId;
  final DateTime? removedAt;
  final RoleSummary role;
  final ChangeMemberCredentialResponseStatus status;
  final String userId;
  final ChangeMemberCredentialResponseDirection direction;

  factory ChangeMemberCredentialResponse.fromJson(Map<String, dynamic> json) => ChangeMemberCredentialResponse(
        credential: Credential.fromJson(json['credential'] as String),
        credentialFields: CredentialFields.fromJson(json['credentialFields'] as Map<String, dynamic>),
        displayName: json['displayName'] as String,
        email: json['email'] as String,
        invitedAt: DateTime.parse(json['invitedAt'] as String),
        membershipId: json['membershipId'] as String,
        removedAt: json['removedAt'] == null ? null : DateTime.parse(json['removedAt'] as String),
        role: RoleSummary.fromJson(json['role'] as Map<String, dynamic>),
        status: ChangeMemberCredentialResponseStatus.fromJson(json['status'] as String),
        userId: json['userId'] as String,
        direction: ChangeMemberCredentialResponseDirection.fromJson(json['direction'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'credential': credential.toJson(),
        'credentialFields': credentialFields.toJson(),
        'displayName': displayName,
        'email': email,
        'invitedAt': invitedAt.toUtc().toIso8601String(),
        'membershipId': membershipId,
        'removedAt': removedAt == null ? null : removedAt!.toUtc().toIso8601String(),
        'role': role.toJson(),
        'status': status.toJson(),
        'userId': userId,
        'direction': direction.toJson(),
      };
}

class ChangeRole {
  const ChangeRole({
    required this.reason,
    required this.roleId,
  });

  /// Why, in a few words. Logged.
  final String reason;
  final String roleId;

  factory ChangeRole.fromJson(Map<String, dynamic> json) => ChangeRole(
        reason: json['reason'] as String,
        roleId: json['roleId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
        'roleId': roleId,
      };
}

class CreateTeam {
  const CreateTeam({
    required this.name,
  });

  final String name;

  factory CreateTeam.fromJson(Map<String, dynamic> json) => CreateTeam(
        name: json['name'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'name': name,
      };
}

class CredentialFields {
  const CredentialFields({
    this.licenseNumber,
    this.licenseState,
    this.npi,
    this.program,
    this.school,
    this.supervisingAttending,
    this.supervisingPhysician,
  });

  final String? licenseNumber;
  final String? licenseState;
  final String? npi;
  final String? program;
  final String? school;
  final String? supervisingAttending;
  final String? supervisingPhysician;

  factory CredentialFields.fromJson(Map<String, dynamic> json) => CredentialFields(
        licenseNumber: json['licenseNumber'] == null ? null : json['licenseNumber'] as String,
        licenseState: json['licenseState'] == null ? null : json['licenseState'] as String,
        npi: json['npi'] == null ? null : json['npi'] as String,
        program: json['program'] == null ? null : json['program'] as String,
        school: json['school'] == null ? null : json['school'] as String,
        supervisingAttending: json['supervisingAttending'] == null ? null : json['supervisingAttending'] as String,
        supervisingPhysician: json['supervisingPhysician'] == null ? null : json['supervisingPhysician'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (licenseNumber != null) 'licenseNumber': licenseNumber!,
        if (licenseState != null) 'licenseState': licenseState!,
        if (npi != null) 'npi': npi!,
        if (program != null) 'program': program!,
        if (school != null) 'school': school!,
        if (supervisingAttending != null) 'supervisingAttending': supervisingAttending!,
        if (supervisingPhysician != null) 'supervisingPhysician': supervisingPhysician!,
      };
}

class DecideQuarantine {
  const DecideQuarantine({
    required this.decision,
    required this.reason,
  });

  final DecideQuarantineDecision decision;
  /// Why, in a few words. Logged.
  final String reason;

  factory DecideQuarantine.fromJson(Map<String, dynamic> json) => DecideQuarantine(
        decision: DecideQuarantineDecision.fromJson(json['decision'] as String),
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'decision': decision.toJson(),
        'reason': reason,
      };
}

class Device {
  const Device({
    required this.id,
    required this.registeredAt,
    required this.status,
  });

  final String id;
  final DateTime registeredAt;
  final DeviceStatus status;

  factory Device.fromJson(Map<String, dynamic> json) => Device(
        id: json['id'] as String,
        registeredAt: DateTime.parse(json['registeredAt'] as String),
        status: DeviceStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'registeredAt': registeredAt.toUtc().toIso8601String(),
        'status': status.toJson(),
      };
}

class DeviceStatusResult {
  const DeviceStatusResult({
    required this.access,
    required this.serverTime,
    required this.status,
  });

  /// removed: the user lost access to the team; upload unsynced work to quarantine, then wipe
  final DeviceStatusResultAccess access;
  final DateTime serverTime;
  final DeviceStatus status;

  factory DeviceStatusResult.fromJson(Map<String, dynamic> json) => DeviceStatusResult(
        access: DeviceStatusResultAccess.fromJson(json['access'] as String),
        serverTime: DateTime.parse(json['serverTime'] as String),
        status: DeviceStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'access': access.toJson(),
        'serverTime': serverTime.toUtc().toIso8601String(),
        'status': status.toJson(),
      };
}

class ErrorResponse {
  const ErrorResponse({
    required this.error,
  });

  final ErrorResponseError error;

  factory ErrorResponse.fromJson(Map<String, dynamic> json) => ErrorResponse(
        error: ErrorResponseError.fromJson(json['error'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'error': error.toJson(),
      };
}

class ErrorResponseError {
  const ErrorResponseError({
    required this.code,
    this.details,
    required this.message,
  });

  final String code;
  final Map<String, Object?>? details;
  final String message;

  factory ErrorResponseError.fromJson(Map<String, dynamic> json) => ErrorResponseError(
        code: json['code'] as String,
        details: json['details'] == null ? null : Map<String, Object?>.from(json['details'] as Map),
        message: json['message'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'code': code,
        if (details != null) 'details': details!,
        'message': message,
      };
}

class FetchRecords {
  const FetchRecords({
    required this.records,
  });

  final List<RecordRef> records;

  factory FetchRecords.fromJson(Map<String, dynamic> json) => FetchRecords(
        records: (json['records'] as List<dynamic>).map((e) => RecordRef.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'records': records.map((e) => e.toJson()).toList(),
      };
}

class FetchRecordsResult {
  const FetchRecordsResult({
    required this.missing,
    required this.records,
  });

  final List<RecordRef> missing;
  final List<RecordSnapshot> records;

  factory FetchRecordsResult.fromJson(Map<String, dynamic> json) => FetchRecordsResult(
        missing: (json['missing'] as List<dynamic>).map((e) => RecordRef.fromJson(e as Map<String, dynamic>)).toList(),
        records: (json['records'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'missing': missing.map((e) => e.toJson()).toList(),
        'records': records.map((e) => e.toJson()).toList(),
      };
}

/// On conflict: the value the server holds
class FieldState {
  const FieldState({
    required this.changedAt,
    required this.changedBy,
    this.value,
    required this.version,
  });

  final DateTime? changedAt;
  final String? changedBy;
  final Object? value;
  final int version;

  factory FieldState.fromJson(Map<String, dynamic> json) => FieldState(
        changedAt: json['changedAt'] == null ? null : DateTime.parse(json['changedAt'] as String),
        changedBy: json['changedBy'] == null ? null : json['changedBy'] as String,
        value: json['value'],
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changedAt': changedAt == null ? null : changedAt!.toUtc().toIso8601String(),
        'changedBy': changedBy == null ? null : changedBy!,
        'value': value,
        'version': version,
      };
}

class Health {
  const Health({
    required this.demo,
    required this.environment,
    required this.release,
    required this.status,
  });

  final bool demo;
  final HealthEnvironment environment;
  final String release;
  final String status;

  factory Health.fromJson(Map<String, dynamic> json) => Health(
        demo: json['demo'] as bool,
        environment: HealthEnvironment.fromJson(json['environment'] as String),
        release: json['release'] as String,
        status: json['status'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'demo': demo,
        'environment': environment.toJson(),
        'release': release,
        'status': status,
      };
}

class InviteMember {
  const InviteMember({
    this.credential,
    this.credentialFields,
    required this.displayName,
    required this.email,
    required this.roleId,
  });

  final Credential? credential;
  final CredentialFields? credentialFields;
  final String displayName;
  final String email;
  final String roleId;

  factory InviteMember.fromJson(Map<String, dynamic> json) => InviteMember(
        credential: json['credential'] == null ? null : Credential.fromJson(json['credential'] as String),
        credentialFields: json['credentialFields'] == null ? null : CredentialFields.fromJson(json['credentialFields'] as Map<String, dynamic>),
        displayName: json['displayName'] as String,
        email: json['email'] as String,
        roleId: json['roleId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (credential != null) 'credential': credential!.toJson(),
        if (credentialFields != null) 'credentialFields': credentialFields!.toJson(),
        'displayName': displayName,
        'email': email,
        'roleId': roleId,
      };
}

class Me {
  const Me({
    required this.isOwner,
    required this.mfa,
    required this.pendingAcknowledgements,
    required this.teams,
    required this.user,
  });

  final bool isOwner;
  final MeMfa mfa;
  final List<Acknowledgement> pendingAcknowledgements;
  final List<MyTeam> teams;
  final MeUser user;

  factory Me.fromJson(Map<String, dynamic> json) => Me(
        isOwner: json['isOwner'] as bool,
        mfa: MeMfa.fromJson(json['mfa'] as Map<String, dynamic>),
        pendingAcknowledgements: (json['pendingAcknowledgements'] as List<dynamic>).map((e) => Acknowledgement.fromJson(e as Map<String, dynamic>)).toList(),
        teams: (json['teams'] as List<dynamic>).map((e) => MyTeam.fromJson(e as Map<String, dynamic>)).toList(),
        user: MeUser.fromJson(json['user'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'isOwner': isOwner,
        'mfa': mfa.toJson(),
        'pendingAcknowledgements': pendingAcknowledgements.map((e) => e.toJson()).toList(),
        'teams': teams.map((e) => e.toJson()).toList(),
        'user': user.toJson(),
      };
}

class MeMfa {
  const MeMfa({
    required this.requiredValue,
    required this.satisfied,
  });

  final bool requiredValue;
  final bool satisfied;

  factory MeMfa.fromJson(Map<String, dynamic> json) => MeMfa(
        requiredValue: json['required'] as bool,
        satisfied: json['satisfied'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'required': requiredValue,
        'satisfied': satisfied,
      };
}

class MeUser {
  const MeUser({
    required this.displayName,
    required this.email,
    required this.id,
  });

  final String displayName;
  final String email;
  final String id;

  factory MeUser.fromJson(Map<String, dynamic> json) => MeUser(
        displayName: json['displayName'] as String,
        email: json['email'] as String,
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'displayName': displayName,
        'email': email,
        'id': id,
      };
}

class Member {
  const Member({
    required this.credential,
    required this.credentialFields,
    required this.displayName,
    required this.email,
    required this.invitedAt,
    required this.membershipId,
    required this.removedAt,
    required this.role,
    required this.status,
    required this.userId,
  });

  final Credential credential;
  final CredentialFields credentialFields;
  final String displayName;
  final String email;
  final DateTime invitedAt;
  final String membershipId;
  final DateTime? removedAt;
  final RoleSummary role;
  final MemberStatus status;
  final String userId;

  factory Member.fromJson(Map<String, dynamic> json) => Member(
        credential: Credential.fromJson(json['credential'] as String),
        credentialFields: CredentialFields.fromJson(json['credentialFields'] as Map<String, dynamic>),
        displayName: json['displayName'] as String,
        email: json['email'] as String,
        invitedAt: DateTime.parse(json['invitedAt'] as String),
        membershipId: json['membershipId'] as String,
        removedAt: json['removedAt'] == null ? null : DateTime.parse(json['removedAt'] as String),
        role: RoleSummary.fromJson(json['role'] as Map<String, dynamic>),
        status: MemberStatus.fromJson(json['status'] as String),
        userId: json['userId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'credential': credential.toJson(),
        'credentialFields': credentialFields.toJson(),
        'displayName': displayName,
        'email': email,
        'invitedAt': invitedAt.toUtc().toIso8601String(),
        'membershipId': membershipId,
        'removedAt': removedAt == null ? null : removedAt!.toUtc().toIso8601String(),
        'role': role.toJson(),
        'status': status.toJson(),
        'userId': userId,
      };
}

class MembershipChange {
  const MembershipChange({
    required this.changedAt,
    required this.changedBy,
    required this.id,
    required this.kind,
    this.newValue,
    this.oldValue,
    required this.reason,
  });

  final DateTime changedAt;
  final MembershipChangeChangedBy changedBy;
  final String id;
  final MembershipChangeKind kind;
  final Object? newValue;
  final Object? oldValue;
  final String? reason;

  factory MembershipChange.fromJson(Map<String, dynamic> json) => MembershipChange(
        changedAt: DateTime.parse(json['changedAt'] as String),
        changedBy: MembershipChangeChangedBy.fromJson(json['changedBy'] as Map<String, dynamic>),
        id: json['id'] as String,
        kind: MembershipChangeKind.fromJson(json['kind'] as String),
        newValue: json['newValue'],
        oldValue: json['oldValue'],
        reason: json['reason'] == null ? null : json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changedAt': changedAt.toUtc().toIso8601String(),
        'changedBy': changedBy.toJson(),
        'id': id,
        'kind': kind.toJson(),
        'newValue': newValue,
        'oldValue': oldValue,
        'reason': reason == null ? null : reason!,
      };
}

class MembershipChangeChangedBy {
  const MembershipChangeChangedBy({
    required this.displayName,
    required this.userId,
  });

  final String displayName;
  final String userId;

  factory MembershipChangeChangedBy.fromJson(Map<String, dynamic> json) => MembershipChangeChangedBy(
        displayName: json['displayName'] as String,
        userId: json['userId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'displayName': displayName,
        'userId': userId,
      };
}

class MyTeam {
  const MyTeam({
    required this.credential,
    required this.permissions,
    required this.roleKey,
    required this.roleName,
    required this.teamId,
    required this.teamName,
    required this.teamStatus,
  });

  final Credential credential;
  final List<Permission> permissions;
  final String roleKey;
  final String roleName;
  final String teamId;
  final String teamName;
  final MyTeamTeamStatus teamStatus;

  factory MyTeam.fromJson(Map<String, dynamic> json) => MyTeam(
        credential: Credential.fromJson(json['credential'] as String),
        permissions: (json['permissions'] as List<dynamic>).map((e) => Permission.fromJson(e as String)).toList(),
        roleKey: json['roleKey'] as String,
        roleName: json['roleName'] as String,
        teamId: json['teamId'] as String,
        teamName: json['teamName'] as String,
        teamStatus: MyTeamTeamStatus.fromJson(json['teamStatus'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'credential': credential.toJson(),
        'permissions': permissions.map((e) => e.toJson()).toList(),
        'roleKey': roleKey,
        'roleName': roleName,
        'teamId': teamId,
        'teamName': teamName,
        'teamStatus': teamStatus.toJson(),
      };
}

class Notice {
  const Notice({
    required this.createdAt,
    required this.entity,
    required this.id,
    required this.kind,
    required this.readAt,
    required this.recordId,
  });

  final DateTime createdAt;
  final String? entity;
  final String id;
  final String kind;
  final DateTime? readAt;
  final String? recordId;

  factory Notice.fromJson(Map<String, dynamic> json) => Notice(
        createdAt: DateTime.parse(json['createdAt'] as String),
        entity: json['entity'] == null ? null : json['entity'] as String,
        id: json['id'] as String,
        kind: json['kind'] as String,
        readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
        recordId: json['recordId'] == null ? null : json['recordId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'createdAt': createdAt.toUtc().toIso8601String(),
        'entity': entity == null ? null : entity!,
        'id': id,
        'kind': kind,
        'readAt': readAt == null ? null : readAt!.toUtc().toIso8601String(),
        'recordId': recordId == null ? null : recordId!,
      };
}

class Ok {
  const Ok({
    required this.ok,
  });

  final bool ok;

  factory Ok.fromJson(Map<String, dynamic> json) => Ok(
        ok: json['ok'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'ok': ok,
      };
}

class OwnerRemoveMemberRequest {
  const OwnerRemoveMemberRequest({
    required this.reason,
  });

  /// Why, in a few words. Logged.
  final String reason;

  factory OwnerRemoveMemberRequest.fromJson(Map<String, dynamic> json) => OwnerRemoveMemberRequest(
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
      };
}

class OwnerTeam {
  const OwnerTeam({
    required this.activeMembers,
    required this.createdAt,
    required this.id,
    required this.name,
    required this.programAdmins,
    required this.status,
  });

  final int activeMembers;
  final DateTime createdAt;
  final String id;
  final String name;
  final List<OwnerTeamProgramAdminsItem> programAdmins;
  final OwnerTeamStatus status;

  factory OwnerTeam.fromJson(Map<String, dynamic> json) => OwnerTeam(
        activeMembers: (json['activeMembers'] as num).toInt(),
        createdAt: DateTime.parse(json['createdAt'] as String),
        id: json['id'] as String,
        name: json['name'] as String,
        programAdmins: (json['programAdmins'] as List<dynamic>).map((e) => OwnerTeamProgramAdminsItem.fromJson(e as Map<String, dynamic>)).toList(),
        status: OwnerTeamStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'activeMembers': activeMembers,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'id': id,
        'name': name,
        'programAdmins': programAdmins.map((e) => e.toJson()).toList(),
        'status': status.toJson(),
      };
}

class OwnerTeamProgramAdminsItem {
  const OwnerTeamProgramAdminsItem({
    required this.displayName,
    required this.email,
    required this.membershipId,
  });

  final String displayName;
  final String email;
  final String membershipId;

  factory OwnerTeamProgramAdminsItem.fromJson(Map<String, dynamic> json) => OwnerTeamProgramAdminsItem(
        displayName: json['displayName'] as String,
        email: json['email'] as String,
        membershipId: json['membershipId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'displayName': displayName,
        'email': email,
        'membershipId': membershipId,
      };
}

class PermissionInfo {
  const PermissionInfo({
    required this.description,
    required this.key,
  });

  final String description;
  final Permission key;

  factory PermissionInfo.fromJson(Map<String, dynamic> json) => PermissionInfo(
        description: json['description'] as String,
        key: Permission.fromJson(json['key'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'description': description,
        'key': key.toJson(),
      };
}

class QuarantineItem {
  const QuarantineItem({
    required this.changeId,
    required this.decidedAt,
    required this.decidedBy,
    required this.decisionReason,
    required this.deviceId,
    required this.deviceTime,
    required this.entity,
    required this.field,
    required this.id,
    required this.op,
    required this.reason,
    required this.receivedAt,
    required this.recordId,
    required this.status,
    required this.user,
    this.value,
  });

  final String changeId;
  final DateTime? decidedAt;
  final UserRef? decidedBy;
  final String? decisionReason;
  final String deviceId;
  final DateTime deviceTime;
  final String entity;
  final String? field;
  final String id;
  final String op;
  /// awaiting_review: it belongs to a record whose create is also waiting here, so that is decided first
  final QuarantineItemReason reason;
  final DateTime receivedAt;
  final String recordId;
  final QuarantineItemStatus status;
  final UserRef user;
  final Object? value;

  factory QuarantineItem.fromJson(Map<String, dynamic> json) => QuarantineItem(
        changeId: json['changeId'] as String,
        decidedAt: json['decidedAt'] == null ? null : DateTime.parse(json['decidedAt'] as String),
        decidedBy: json['decidedBy'] == null ? null : UserRef.fromJson(json['decidedBy'] as Map<String, dynamic>),
        decisionReason: json['decisionReason'] == null ? null : json['decisionReason'] as String,
        deviceId: json['deviceId'] as String,
        deviceTime: DateTime.parse(json['deviceTime'] as String),
        entity: json['entity'] as String,
        field: json['field'] == null ? null : json['field'] as String,
        id: json['id'] as String,
        op: json['op'] as String,
        reason: QuarantineItemReason.fromJson(json['reason'] as String),
        receivedAt: DateTime.parse(json['receivedAt'] as String),
        recordId: json['recordId'] as String,
        status: QuarantineItemStatus.fromJson(json['status'] as String),
        user: UserRef.fromJson(json['user'] as Map<String, dynamic>),
        value: json['value'],
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changeId': changeId,
        'decidedAt': decidedAt == null ? null : decidedAt!.toUtc().toIso8601String(),
        'decidedBy': decidedBy == null ? null : decidedBy!.toJson(),
        'decisionReason': decisionReason == null ? null : decisionReason!,
        'deviceId': deviceId,
        'deviceTime': deviceTime.toUtc().toIso8601String(),
        'entity': entity,
        'field': field == null ? null : field!,
        'id': id,
        'op': op,
        'reason': reason.toJson(),
        'receivedAt': receivedAt.toUtc().toIso8601String(),
        'recordId': recordId,
        'status': status.toJson(),
        'user': user.toJson(),
        'value': value,
      };
}

class QuarantinePage {
  const QuarantinePage({
    required this.items,
    required this.nextAfterId,
    required this.people,
  });

  /// Oldest first
  final List<QuarantineItem> items;
  /// Pass as afterId for the next page; null on the last
  final String? nextAfterId;
  /// Everyone with items in this status, and the person filtered to, for a filter
  final List<UserRef> people;

  factory QuarantinePage.fromJson(Map<String, dynamic> json) => QuarantinePage(
        items: (json['items'] as List<dynamic>).map((e) => QuarantineItem.fromJson(e as Map<String, dynamic>)).toList(),
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
        people: (json['people'] as List<dynamic>).map((e) => UserRef.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'items': items.map((e) => e.toJson()).toList(),
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
        'people': people.map((e) => e.toJson()).toList(),
      };
}

class QuarantineReceipt {
  const QuarantineReceipt({
    required this.results,
  });

  final List<QuarantineReceiptResultsItem> results;

  factory QuarantineReceipt.fromJson(Map<String, dynamic> json) => QuarantineReceipt(
        results: (json['results'] as List<dynamic>).map((e) => QuarantineReceiptResultsItem.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'results': results.map((e) => e.toJson()).toList(),
      };
}

class QuarantineReceiptResultsItem {
  const QuarantineReceiptResultsItem({
    required this.changeId,
    this.hash,
    this.reason,
    required this.status,
  });

  final String changeId;
  /// SHA-256 of the canonical JSON of the value, lowercase hex
  final String? hash;
  final RejectReason? reason;
  /// quarantined: held for a Program Admin; recorded: an activity log entry, now in the audit chain
  final QuarantineReceiptResultsItemStatus status;

  factory QuarantineReceiptResultsItem.fromJson(Map<String, dynamic> json) => QuarantineReceiptResultsItem(
        changeId: json['changeId'] as String,
        hash: json['hash'] == null ? null : json['hash'] as String,
        reason: json['reason'] == null ? null : RejectReason.fromJson(json['reason'] as String),
        status: QuarantineReceiptResultsItemStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changeId': changeId,
        if (hash != null) 'hash': hash!,
        if (reason != null) 'reason': reason!.toJson(),
        'status': status.toJson(),
      };
}

class RecordRef {
  const RecordRef({
    required this.entity,
    required this.id,
  });

  final RecordEntity entity;
  final String id;

  factory RecordRef.fromJson(Map<String, dynamic> json) => RecordRef(
        entity: RecordEntity.fromJson(json['entity'] as String),
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'entity': entity.toJson(),
        'id': id,
      };
}

class RecordSnapshot {
  const RecordSnapshot({
    required this.attributes,
    required this.authorUserId,
    required this.createdAt,
    required this.entity,
    required this.fields,
    required this.id,
    required this.status,
    required this.updatedAt,
    required this.version,
  });

  /// Set at creation, never changed
  final Map<String, Object?> attributes;
  final String authorUserId;
  final DateTime createdAt;
  final RecordEntity entity;
  final Map<String, FieldState> fields;
  final String id;
  final String status;
  final DateTime updatedAt;
  final int version;

  factory RecordSnapshot.fromJson(Map<String, dynamic> json) => RecordSnapshot(
        attributes: Map<String, Object?>.from(json['attributes'] as Map),
        authorUserId: json['authorUserId'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        entity: RecordEntity.fromJson(json['entity'] as String),
        fields: (json['fields'] as Map<String, dynamic>).map((k, v) => MapEntry(k, FieldState.fromJson(v as Map<String, dynamic>))),
        id: json['id'] as String,
        status: json['status'] as String,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'attributes': attributes,
        'authorUserId': authorUserId,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'entity': entity.toJson(),
        'fields': fields.map((k, v) => MapEntry(k, v.toJson())),
        'id': id,
        'status': status,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'version': version,
      };
}

class RegisterDevice {
  const RegisterDevice({
    required this.appVersion,
    required this.deviceId,
    required this.platform,
    required this.publicKey,
  });

  final String appVersion;
  final String deviceId;
  final RegisterDevicePlatform platform;
  /// Ed25519 public key, raw bytes, unpadded base64url
  final String publicKey;

  factory RegisterDevice.fromJson(Map<String, dynamic> json) => RegisterDevice(
        appVersion: json['appVersion'] as String,
        deviceId: json['deviceId'] as String,
        platform: RegisterDevicePlatform.fromJson(json['platform'] as String),
        publicKey: json['publicKey'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'appVersion': appVersion,
        'deviceId': deviceId,
        'platform': platform.toJson(),
        'publicKey': publicKey,
      };
}

class RemoveMember {
  const RemoveMember({
    required this.reason,
  });

  /// Why, in a few words. Logged.
  final String reason;

  factory RemoveMember.fromJson(Map<String, dynamic> json) => RemoveMember(
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
      };
}

class Role {
  const Role({
    required this.archived,
    required this.description,
    required this.id,
    required this.isStandard,
    required this.key,
    required this.memberCount,
    required this.name,
    required this.permissions,
  });

  final bool archived;
  final String? description;
  final String id;
  final bool isStandard;
  final String key;
  final int memberCount;
  final String name;
  final List<Permission> permissions;

  factory Role.fromJson(Map<String, dynamic> json) => Role(
        archived: json['archived'] as bool,
        description: json['description'] == null ? null : json['description'] as String,
        id: json['id'] as String,
        isStandard: json['isStandard'] as bool,
        key: json['key'] as String,
        memberCount: (json['memberCount'] as num).toInt(),
        name: json['name'] as String,
        permissions: (json['permissions'] as List<dynamic>).map((e) => Permission.fromJson(e as String)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'archived': archived,
        'description': description == null ? null : description!,
        'id': id,
        'isStandard': isStandard,
        'key': key,
        'memberCount': memberCount,
        'name': name,
        'permissions': permissions.map((e) => e.toJson()).toList(),
      };
}

class RoleInput {
  const RoleInput({
    this.description,
    required this.name,
    required this.permissions,
  });

  final String? description;
  final String name;
  final List<Permission> permissions;

  factory RoleInput.fromJson(Map<String, dynamic> json) => RoleInput(
        description: json['description'] == null ? null : json['description'] as String,
        name: json['name'] as String,
        permissions: (json['permissions'] as List<dynamic>).map((e) => Permission.fromJson(e as String)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (description != null) 'description': description!,
        'name': name,
        'permissions': permissions.map((e) => e.toJson()).toList(),
      };
}

class RoleSummary {
  const RoleSummary({
    required this.id,
    required this.isStandard,
    required this.key,
    required this.name,
  });

  final String id;
  final bool isStandard;
  final String key;
  final String name;

  factory RoleSummary.fromJson(Map<String, dynamic> json) => RoleSummary(
        id: json['id'] as String,
        isStandard: json['isStandard'] as bool,
        key: json['key'] as String,
        name: json['name'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'isStandard': isStandard,
        'key': key,
        'name': name,
      };
}

class ServerTime {
  const ServerTime({
    required this.epochMs,
    required this.serverTime,
  });

  final int epochMs;
  final DateTime serverTime;

  factory ServerTime.fromJson(Map<String, dynamic> json) => ServerTime(
        epochMs: (json['epochMs'] as num).toInt(),
        serverTime: DateTime.parse(json['serverTime'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'epochMs': epochMs,
        'serverTime': serverTime.toUtc().toIso8601String(),
      };
}

class SignedQuarantine {
  const SignedQuarantine({
    required this.payload,
    required this.signature,
  });

  final SignedQuarantinePayload payload;
  /// Ed25519 signature of the canonical JSON of `payload`, unpadded base64url
  final String signature;

  factory SignedQuarantine.fromJson(Map<String, dynamic> json) => SignedQuarantine(
        payload: SignedQuarantinePayload.fromJson(json['payload'] as Map<String, dynamic>),
        signature: json['signature'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'payload': payload.toJson(),
        'signature': signature,
      };
}

class SignedQuarantinePayload {
  const SignedQuarantinePayload({
    required this.changes,
    required this.deviceId,
    required this.purpose,
  });

  final List<SyncChange> changes;
  final String deviceId;
  final String purpose;

  factory SignedQuarantinePayload.fromJson(Map<String, dynamic> json) => SignedQuarantinePayload(
        changes: (json['changes'] as List<dynamic>).map((e) => SyncChange.fromJson(e as Map<String, dynamic>)).toList(),
        deviceId: json['deviceId'] as String,
        purpose: json['purpose'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changes': changes.map((e) => e.toJson()).toList(),
        'deviceId': deviceId,
        'purpose': purpose,
      };
}

class SignedStatus {
  const SignedStatus({
    required this.payload,
    required this.signature,
  });

  final SignedStatusPayload payload;
  /// Ed25519 signature of the canonical JSON of `payload`, unpadded base64url
  final String signature;

  factory SignedStatus.fromJson(Map<String, dynamic> json) => SignedStatus(
        payload: SignedStatusPayload.fromJson(json['payload'] as Map<String, dynamic>),
        signature: json['signature'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'payload': payload.toJson(),
        'signature': signature,
      };
}

class SignedStatusPayload {
  const SignedStatusPayload({
    required this.deviceId,
    required this.purpose,
    required this.sentAt,
  });

  final String deviceId;
  final String purpose;
  final DateTime sentAt;

  factory SignedStatusPayload.fromJson(Map<String, dynamic> json) => SignedStatusPayload(
        deviceId: json['deviceId'] as String,
        purpose: json['purpose'] as String,
        sentAt: DateTime.parse(json['sentAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'deviceId': deviceId,
        'purpose': purpose,
        'sentAt': sentAt.toUtc().toIso8601String(),
      };
}

class SignedWiped {
  const SignedWiped({
    required this.payload,
    required this.signature,
  });

  final SignedWipedPayload payload;
  /// Ed25519 signature of the canonical JSON of `payload`, unpadded base64url
  final String signature;

  factory SignedWiped.fromJson(Map<String, dynamic> json) => SignedWiped(
        payload: SignedWipedPayload.fromJson(json['payload'] as Map<String, dynamic>),
        signature: json['signature'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'payload': payload.toJson(),
        'signature': signature,
      };
}

class SignedWipedPayload {
  const SignedWipedPayload({
    required this.deviceId,
    required this.purpose,
    required this.wipedAt,
  });

  final String deviceId;
  final String purpose;
  final DateTime wipedAt;

  factory SignedWipedPayload.fromJson(Map<String, dynamic> json) => SignedWipedPayload(
        deviceId: json['deviceId'] as String,
        purpose: json['purpose'] as String,
        wipedAt: DateTime.parse(json['wipedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'deviceId': deviceId,
        'purpose': purpose,
        'wipedAt': wipedAt.toUtc().toIso8601String(),
      };
}

class SyncChange {
  const SyncChange({
    this.baseVersion,
    required this.changeId,
    this.clockVerified,
    this.conflictOf,
    this.correctedTime,
    required this.deviceTime,
    required this.entity,
    this.field,
    this.follows,
    required this.op,
    required this.recordId,
    this.resolution,
    required this.seq,
    this.supersedes,
    this.value,
    required this.valueHash,
  });

  /// The field version the user saw
  final int? baseVersion;
  final String changeId;
  final bool? clockVerified;
  /// The conflicted change this one resolves
  final String? conflictOf;
  /// Device time corrected by the last measured offset
  final DateTime? correctedTime;
  final DateTime deviceTime;
  final ChangeEntity entity;
  final String? field;
  /// An earlier change from this device to the same field that this one builds on
  final String? follows;
  final SyncChangeOp op;
  final String recordId;
  final SyncChangeResolution? resolution;
  /// Per-device sequence
  final int seq;
  /// A rejected change this one fixes
  final String? supersedes;
  /// Required; null is a value
  final Object? value;
  /// SHA-256 of the canonical JSON of the value, lowercase hex
  final String valueHash;

  factory SyncChange.fromJson(Map<String, dynamic> json) => SyncChange(
        baseVersion: json['baseVersion'] == null ? null : (json['baseVersion'] as num).toInt(),
        changeId: json['changeId'] as String,
        clockVerified: json['clockVerified'] == null ? null : json['clockVerified'] as bool,
        conflictOf: json['conflictOf'] == null ? null : json['conflictOf'] as String,
        correctedTime: json['correctedTime'] == null ? null : DateTime.parse(json['correctedTime'] as String),
        deviceTime: DateTime.parse(json['deviceTime'] as String),
        entity: ChangeEntity.fromJson(json['entity'] as String),
        field: json['field'] == null ? null : json['field'] as String,
        follows: json['follows'] == null ? null : json['follows'] as String,
        op: SyncChangeOp.fromJson(json['op'] as String),
        recordId: json['recordId'] as String,
        resolution: json['resolution'] == null ? null : SyncChangeResolution.fromJson(json['resolution'] as String),
        seq: (json['seq'] as num).toInt(),
        supersedes: json['supersedes'] == null ? null : json['supersedes'] as String,
        value: json['value'],
        valueHash: json['valueHash'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (baseVersion != null) 'baseVersion': baseVersion!,
        'changeId': changeId,
        if (clockVerified != null) 'clockVerified': clockVerified!,
        if (conflictOf != null) 'conflictOf': conflictOf!,
        if (correctedTime != null) 'correctedTime': correctedTime!.toUtc().toIso8601String(),
        'deviceTime': deviceTime.toUtc().toIso8601String(),
        'entity': entity.toJson(),
        if (field != null) 'field': field!,
        if (follows != null) 'follows': follows!,
        'op': op.toJson(),
        'recordId': recordId,
        if (resolution != null) 'resolution': resolution!.toJson(),
        'seq': seq,
        if (supersedes != null) 'supersedes': supersedes!,
        'value': value,
        'valueHash': valueHash,
      };
}

class SyncPush {
  const SyncPush({
    required this.changes,
    required this.clock,
    required this.deviceId,
    required this.unsynced,
  });

  final List<SyncChange> changes;
  final SyncPushClock clock;
  final String deviceId;
  final SyncPushUnsynced unsynced;

  factory SyncPush.fromJson(Map<String, dynamic> json) => SyncPush(
        changes: (json['changes'] as List<dynamic>).map((e) => SyncChange.fromJson(e as Map<String, dynamic>)).toList(),
        clock: SyncPushClock.fromJson(json['clock'] as Map<String, dynamic>),
        deviceId: json['deviceId'] as String,
        unsynced: SyncPushUnsynced.fromJson(json['unsynced'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changes': changes.map((e) => e.toJson()).toList(),
        'clock': clock.toJson(),
        'deviceId': deviceId,
        'unsynced': unsynced.toJson(),
      };
}

class SyncPushClock {
  const SyncPushClock({
    required this.deviceTime,
  });

  final DateTime deviceTime;

  factory SyncPushClock.fromJson(Map<String, dynamic> json) => SyncPushClock(
        deviceTime: DateTime.parse(json['deviceTime'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'deviceTime': deviceTime.toUtc().toIso8601String(),
      };
}

class SyncPushResult {
  const SyncPushResult({
    required this.clock,
    required this.device,
    required this.results,
    required this.serverTime,
  });

  final SyncPushResultClock clock;
  final SyncPushResultDevice device;
  /// In the order processed. Changes without a result were not processed; send them again.
  final List<SyncResult> results;
  final DateTime serverTime;

  factory SyncPushResult.fromJson(Map<String, dynamic> json) => SyncPushResult(
        clock: SyncPushResultClock.fromJson(json['clock'] as Map<String, dynamic>),
        device: SyncPushResultDevice.fromJson(json['device'] as Map<String, dynamic>),
        results: (json['results'] as List<dynamic>).map((e) => SyncResult.fromJson(e as Map<String, dynamic>)).toList(),
        serverTime: DateTime.parse(json['serverTime'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'clock': clock.toJson(),
        'device': device.toJson(),
        'results': results.map((e) => e.toJson()).toList(),
        'serverTime': serverTime.toUtc().toIso8601String(),
      };
}

class SyncPushResultClock {
  const SyncPushResultClock({
    required this.flagged,
    required this.offsetMs,
  });

  final bool flagged;
  final int offsetMs;

  factory SyncPushResultClock.fromJson(Map<String, dynamic> json) => SyncPushResultClock(
        flagged: json['flagged'] as bool,
        offsetMs: (json['offsetMs'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'flagged': flagged,
        'offsetMs': offsetMs,
      };
}

class SyncPushResultDevice {
  const SyncPushResultDevice({
    required this.status,
  });

  final DeviceStatus status;

  factory SyncPushResultDevice.fromJson(Map<String, dynamic> json) => SyncPushResultDevice(
        status: DeviceStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'status': status.toJson(),
      };
}

class SyncPushUnsynced {
  const SyncPushUnsynced({
    required this.counts,
    this.oldest,
  });

  final Map<String, int> counts;
  final DateTime? oldest;

  factory SyncPushUnsynced.fromJson(Map<String, dynamic> json) => SyncPushUnsynced(
        counts: (json['counts'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as num).toInt())),
        oldest: json['oldest'] == null ? null : DateTime.parse(json['oldest'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'counts': counts.map((k, v) => MapEntry(k, v)),
        if (oldest != null) 'oldest': oldest!.toUtc().toIso8601String(),
      };
}

class SyncResult {
  const SyncResult({
    required this.changeId,
    this.details,
    this.hash,
    this.message,
    this.quarantined,
    this.reason,
    this.server,
    this.serverVersion,
    required this.status,
  });

  final String changeId;
  final Map<String, Object?>? details;
  /// The server’s hash of what it stored; purge only on a match
  final String? hash;
  final String? message;
  final bool? quarantined;
  final RejectReason? reason;
  final FieldState? server;
  final int? serverVersion;
  final SyncResultStatus status;

  factory SyncResult.fromJson(Map<String, dynamic> json) => SyncResult(
        changeId: json['changeId'] as String,
        details: json['details'] == null ? null : Map<String, Object?>.from(json['details'] as Map),
        hash: json['hash'] == null ? null : json['hash'] as String,
        message: json['message'] == null ? null : json['message'] as String,
        quarantined: json['quarantined'] == null ? null : json['quarantined'] as bool,
        reason: json['reason'] == null ? null : RejectReason.fromJson(json['reason'] as String),
        server: json['server'] == null ? null : FieldState.fromJson(json['server'] as Map<String, dynamic>),
        serverVersion: json['serverVersion'] == null ? null : (json['serverVersion'] as num).toInt(),
        status: SyncResultStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changeId': changeId,
        if (details != null) 'details': details!,
        if (hash != null) 'hash': hash!,
        if (message != null) 'message': message!,
        if (quarantined != null) 'quarantined': quarantined!,
        if (reason != null) 'reason': reason!.toJson(),
        if (server != null) 'server': server!.toJson(),
        if (serverVersion != null) 'serverVersion': serverVersion!,
        'status': status.toJson(),
      };
}

class TeamDevice {
  const TeamDevice({
    required this.appVersion,
    required this.clockFlagged,
    required this.clockOffsetMs,
    required this.id,
    required this.lastSeenAt,
    required this.lastSyncAt,
    required this.oldestUnsyncedAt,
    required this.openRejections,
    required this.platform,
    required this.registeredAt,
    required this.status,
    required this.unsyncedCounts,
    required this.unsyncedStale,
    required this.user,
    required this.wipeRequestedAt,
    required this.wipedAt,
  });

  final String appVersion;
  final bool clockFlagged;
  final int? clockOffsetMs;
  final String id;
  final DateTime? lastSeenAt;
  final DateTime? lastSyncAt;
  final DateTime? oldestUnsyncedAt;
  final int openRejections;
  final String platform;
  final DateTime registeredAt;
  final DeviceStatus status;
  final Map<String, int> unsyncedCounts;
  /// Something on the phone has waited more than 24 hours (module 9: an admin alert at 24 hours)
  final bool unsyncedStale;
  final UserRef user;
  final DateTime? wipeRequestedAt;
  final DateTime? wipedAt;

  factory TeamDevice.fromJson(Map<String, dynamic> json) => TeamDevice(
        appVersion: json['appVersion'] as String,
        clockFlagged: json['clockFlagged'] as bool,
        clockOffsetMs: json['clockOffsetMs'] == null ? null : (json['clockOffsetMs'] as num).toInt(),
        id: json['id'] as String,
        lastSeenAt: json['lastSeenAt'] == null ? null : DateTime.parse(json['lastSeenAt'] as String),
        lastSyncAt: json['lastSyncAt'] == null ? null : DateTime.parse(json['lastSyncAt'] as String),
        oldestUnsyncedAt: json['oldestUnsyncedAt'] == null ? null : DateTime.parse(json['oldestUnsyncedAt'] as String),
        openRejections: (json['openRejections'] as num).toInt(),
        platform: json['platform'] as String,
        registeredAt: DateTime.parse(json['registeredAt'] as String),
        status: DeviceStatus.fromJson(json['status'] as String),
        unsyncedCounts: (json['unsyncedCounts'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as num).toInt())),
        unsyncedStale: json['unsyncedStale'] as bool,
        user: UserRef.fromJson(json['user'] as Map<String, dynamic>),
        wipeRequestedAt: json['wipeRequestedAt'] == null ? null : DateTime.parse(json['wipeRequestedAt'] as String),
        wipedAt: json['wipedAt'] == null ? null : DateTime.parse(json['wipedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'appVersion': appVersion,
        'clockFlagged': clockFlagged,
        'clockOffsetMs': clockOffsetMs == null ? null : clockOffsetMs!,
        'id': id,
        'lastSeenAt': lastSeenAt == null ? null : lastSeenAt!.toUtc().toIso8601String(),
        'lastSyncAt': lastSyncAt == null ? null : lastSyncAt!.toUtc().toIso8601String(),
        'oldestUnsyncedAt': oldestUnsyncedAt == null ? null : oldestUnsyncedAt!.toUtc().toIso8601String(),
        'openRejections': openRejections,
        'platform': platform,
        'registeredAt': registeredAt.toUtc().toIso8601String(),
        'status': status.toJson(),
        'unsyncedCounts': unsyncedCounts.map((k, v) => MapEntry(k, v)),
        'unsyncedStale': unsyncedStale,
        'user': user.toJson(),
        'wipeRequestedAt': wipeRequestedAt == null ? null : wipeRequestedAt!.toUtc().toIso8601String(),
        'wipedAt': wipedAt == null ? null : wipedAt!.toUtc().toIso8601String(),
      };
}

class TeamStatusChange {
  const TeamStatusChange({
    required this.reason,
    required this.status,
  });

  /// Why, in a few words. Logged.
  final String reason;
  final TeamStatusChangeStatus status;

  factory TeamStatusChange.fromJson(Map<String, dynamic> json) => TeamStatusChange(
        reason: json['reason'] as String,
        status: TeamStatusChangeStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
        'status': status.toJson(),
      };
}

class UserRef {
  const UserRef({
    required this.displayName,
    required this.userId,
  });

  final String displayName;
  final String userId;

  factory UserRef.fromJson(Map<String, dynamic> json) => UserRef(
        displayName: json['displayName'] as String,
        userId: json['userId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'displayName': displayName,
        'userId': userId,
      };
}

class WipeDevice {
  const WipeDevice({
    required this.reason,
  });

  /// Why, in a few words. Logged.
  final String reason;

  factory WipeDevice.fromJson(Map<String, dynamic> json) => WipeDevice(
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
      };
}

/// Typed client for every operation in the API contract.
class SineobexApi {
  SineobexApi(this._transport);

  final ApiTransport _transport;

  /// Accept the Terms of Use or the confidentiality acknowledgement
  Future<Ok> acceptAcknowledgement({required Acknowledgement body}) async {
    final json = await _transport.send('POST', '/v1/me/acknowledgements', body: body.toJson());
    return Ok.fromJson(json as Map<String, dynamic>);
  }

  /// Archive a custom role nobody holds
  Future<Role> archiveRole({required String roleId}) async {
    final json = await _transport.send('POST', '/v1/team/roles/${Uri.encodeComponent(roleId)}/archive');
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Change a credential. Moving up takes effect only with the new credential's fields filled in.
  Future<ChangeMemberCredentialResponse> changeMemberCredential({required String membershipId, required ChangeCredential body}) async {
    final json = await _transport.send('PUT', '/v1/team/members/${Uri.encodeComponent(membershipId)}/credential', body: body.toJson());
    return ChangeMemberCredentialResponse.fromJson(json as Map<String, dynamic>);
  }

  /// Change a role, with a reason that is logged
  Future<Member> changeMemberRole({required String membershipId, required ChangeRole body}) async {
    final json = await _transport.send('PUT', '/v1/team/members/${Uri.encodeComponent(membershipId)}/role', body: body.toJson());
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Report that this phone deleted its data and key for the team
  Future<Ok> confirmWiped({required String deviceId, required SignedWiped body}) async {
    final json = await _transport.send('POST', '/v1/devices/${Uri.encodeComponent(deviceId)}/wiped', body: body.toJson());
    return Ok.fromJson(json as Map<String, dynamic>);
  }

  /// Create a custom role from existing permissions
  Future<Role> createRole({required RoleInput body}) async {
    final json = await _transport.send('POST', '/v1/team/roles', body: body.toJson());
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Accept a quarantined change onto the chart, or reject it with a reason
  Future<Ok> decideQuarantine({required String itemId, required DecideQuarantine body}) async {
    final json = await _transport.send('POST', '/v1/team/quarantine/${Uri.encodeComponent(itemId)}/decision', body: body.toJson());
    return Ok.fromJson(json as Map<String, dynamic>);
  }

  /// Whether this phone must wipe, and whether its user still has access
  Future<DeviceStatusResult> deviceStatus({required String deviceId, required SignedStatus body}) async {
    final json = await _transport.send('POST', '/v1/devices/${Uri.encodeComponent(deviceId)}/status', body: body.toJson());
    return DeviceStatusResult.fromJson(json as Map<String, dynamic>);
  }

  /// The server’s copy of records, with each field’s version, for drafts a phone holds open
  Future<FetchRecordsResult> fetchRecords({required FetchRecords body}) async {
    final json = await _transport.send('POST', '/v1/sync/records', body: body.toJson());
    return FetchRecordsResult.fromJson(json as Map<String, dynamic>);
  }

  /// Liveness, database reachability and whether this is a demo deployment
  Future<Health> getHealth() async {
    final json = await _transport.send('GET', '/v1/health');
    return Health.fromJson(json as Map<String, dynamic>);
  }

  /// The signed-in person, their teams, and what they still need to do before using one
  Future<Me> getMe() async {
    final json = await _transport.send('GET', '/v1/me');
    return Me.fromJson(json as Map<String, dynamic>);
  }

  Future<Member> getMember({required String membershipId}) async {
    final json = await _transport.send('GET', '/v1/team/members/${Uri.encodeComponent(membershipId)}');
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Every role, credential and status change for one membership, with reasons
  Future<List<MembershipChange>> getMemberHistory({required String membershipId}) async {
    final json = await _transport.send('GET', '/v1/team/members/${Uri.encodeComponent(membershipId)}/history');
    return (json as List<dynamic>).map((e) => MembershipChange.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Server time, used by the phone to measure its clock offset (module 9)
  Future<ServerTime> getServerTime() async {
    final json = await _transport.send('GET', '/v1/time');
    return ServerTime.fromJson(json as Map<String, dynamic>);
  }

  /// Invite a person with a role and credential (Program Admins can only be appointed by owners)
  Future<Member> inviteMember({required InviteMember body}) async {
    final json = await _transport.send('POST', '/v1/team/members', body: body.toJson());
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Every phone on the team, with sync status, clock flag and unsynced counts
  Future<List<TeamDevice>> listDevices() async {
    final json = await _transport.send('GET', '/v1/team/devices');
    return (json as List<dynamic>).map((e) => TeamDevice.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Everyone on the team, active and removed
  Future<List<Member>> listMembers() async {
    final json = await _transport.send('GET', '/v1/team/members');
    return (json as List<dynamic>).map((e) => Member.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Things the signed-in person should look at, without patient details
  Future<List<Notice>> listNotices() async {
    final json = await _transport.send('GET', '/v1/team/notices');
    return (json as List<dynamic>).map((e) => Notice.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Every permission a role can hold, with a plain description
  Future<List<PermissionInfo>> listPermissions() async {
    final json = await _transport.send('GET', '/v1/permissions');
    return (json as List<dynamic>).map((e) => PermissionInfo.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Changes from phones whose user lost access, waiting for review, a page at a time
  Future<QuarantinePage> listQuarantine({ListQuarantineStatus? status, String? userId, String? afterId}) async {
    final json = await _transport.send('GET', '/v1/team/quarantine', query: <String, String>{if (status != null) 'status': (status.toJson()).toString(), if (userId != null) 'userId': (userId).toString(), if (afterId != null) 'afterId': (afterId).toString()}, );
    return QuarantinePage.fromJson(json as Map<String, dynamic>);
  }

  /// Standard roles and this team's custom roles
  Future<List<Role>> listRoles() async {
    final json = await _transport.send('GET', '/v1/team/roles');
    return (json as List<dynamic>).map((e) => Role.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Ok> markNoticeRead({required String noticeId}) async {
    final json = await _transport.send('POST', '/v1/team/notices/${Uri.encodeComponent(noticeId)}/read');
    return Ok.fromJson(json as Map<String, dynamic>);
  }

  /// Appoint a team's Program Admin
  Future<Member> ownerAppointProgramAdmin({required String teamId, required AppointAdmin body}) async {
    final json = await _transport.send('POST', '/v1/owner/teams/${Uri.encodeComponent(teamId)}/program-admins', body: body.toJson());
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Create a team. A community health worker preset role is added to it.
  Future<OwnerTeam> ownerCreateTeam({required CreateTeam body}) async {
    final json = await _transport.send('POST', '/v1/owner/teams', body: body.toJson());
    return OwnerTeam.fromJson(json as Map<String, dynamic>);
  }

  /// Every team, with its Program Admins (platform owners only)
  Future<List<OwnerTeam>> ownerListTeams() async {
    final json = await _transport.send('GET', '/v1/owner/teams');
    return (json as List<dynamic>).map((e) => OwnerTeam.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Remove anyone from a team, including a Program Admin
  Future<Member> ownerRemoveMember({required String teamId, required String membershipId, required OwnerRemoveMemberRequest body}) async {
    final json = await _transport.send('POST', '/v1/owner/teams/${Uri.encodeComponent(teamId)}/members/${Uri.encodeComponent(membershipId)}/remove', body: body.toJson());
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Suspend or reinstate a team. A suspended team cannot reach any data.
  Future<OwnerTeam> ownerSetTeamStatus({required String teamId, required TeamStatusChange body}) async {
    final json = await _transport.send('POST', '/v1/owner/teams/${Uri.encodeComponent(teamId)}/status', body: body.toJson());
    return OwnerTeam.fromJson(json as Map<String, dynamic>);
  }

  /// Register this phone’s key for the current team
  Future<Device> registerDevice({required RegisterDevice body}) async {
    final json = await _transport.send('POST', '/v1/devices', body: body.toJson());
    return Device.fromJson(json as Map<String, dynamic>);
  }

  /// Remove a person. Their sessions stop working at once; their phone's data is handled at next contact.
  Future<Member> removeMember({required String membershipId, required RemoveMember body}) async {
    final json = await _transport.send('POST', '/v1/team/members/${Uri.encodeComponent(membershipId)}/remove', body: body.toJson());
    return Member.fromJson(json as Map<String, dynamic>);
  }

  /// Search the audit log by person, patient, action and time. The search itself is logged.
  Future<AuditPage> searchAudit({required AuditSearch body}) async {
    final json = await _transport.send('POST', '/v1/team/audit/search', body: body.toJson());
    return AuditPage.fromJson(json as Map<String, dynamic>);
  }

  /// Send change entries; get a receipt for each (accepted with hash, rejected with reason, or conflict)
  Future<SyncPushResult> syncPush({required SyncPush body}) async {
    final json = await _transport.send('POST', '/v1/sync/push', body: body.toJson());
    return SyncPushResult.fromJson(json as Map<String, dynamic>);
  }

  /// Change a custom role. Standard roles cannot be changed.
  Future<Role> updateRole({required String roleId, required RoleInput body}) async {
    final json = await _transport.send('PUT', '/v1/team/roles/${Uri.encodeComponent(roleId)}', body: body.toJson());
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Hand over unsynced changes after the user lost access; a Program Admin reviews them
  Future<QuarantineReceipt> uploadQuarantine({required String deviceId, required SignedQuarantine body}) async {
    final json = await _transport.send('POST', '/v1/devices/${Uri.encodeComponent(deviceId)}/quarantine', body: body.toJson());
    return QuarantineReceipt.fromJson(json as Map<String, dynamic>);
  }

  /// Recompute every hash in the team's audit chain
  Future<ChainCheck> verifyAuditChain() async {
    final json = await _transport.send('POST', '/v1/team/audit/verify');
    return ChainCheck.fromJson(json as Map<String, dynamic>);
  }

  /// Remotely wipe a lost or stolen phone; its unsynced data is lost
  Future<Ok> wipeDevice({required String deviceId, required WipeDevice body}) async {
    final json = await _transport.send('POST', '/v1/team/devices/${Uri.encodeComponent(deviceId)}/wipe', body: body.toJson());
    return Ok.fromJson(json as Map<String, dynamic>);
  }
}
