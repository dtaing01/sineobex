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
        if (newValue != null) 'newValue': newValue,
        if (oldValue != null) 'oldValue': oldValue,
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

  /// Create a custom role from existing permissions
  Future<Role> createRole({required RoleInput body}) async {
    final json = await _transport.send('POST', '/v1/team/roles', body: body.toJson());
    return Role.fromJson(json as Map<String, dynamic>);
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

  /// Everyone on the team, active and removed
  Future<List<Member>> listMembers() async {
    final json = await _transport.send('GET', '/v1/team/members');
    return (json as List<dynamic>).map((e) => Member.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Every permission a role can hold, with a plain description
  Future<List<PermissionInfo>> listPermissions() async {
    final json = await _transport.send('GET', '/v1/permissions');
    return (json as List<dynamic>).map((e) => PermissionInfo.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Standard roles and this team's custom roles
  Future<List<Role>> listRoles() async {
    final json = await _transport.send('GET', '/v1/team/roles');
    return (json as List<dynamic>).map((e) => Role.fromJson(e as Map<String, dynamic>)).toList();
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

  /// Change a custom role. Standard roles cannot be changed.
  Future<Role> updateRole({required String roleId, required RoleInput body}) async {
    final json = await _transport.send('PUT', '/v1/team/roles/${Uri.encodeComponent(roleId)}', body: body.toJson());
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Recompute every hash in the team's audit chain
  Future<ChainCheck> verifyAuditChain() async {
    final json = await _transport.send('POST', '/v1/team/audit/verify');
    return ChainCheck.fromJson(json as Map<String, dynamic>);
  }
}
