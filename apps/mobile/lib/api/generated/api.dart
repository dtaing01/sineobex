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

enum AllergyCategory {
  drug('drug'),
  food('food'),
  environment('environment'),
  other('other'),
  unknownValue('unknown'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const AllergyCategory(this.wire);
  final String wire;

  static AllergyCategory fromJson(String value) =>
      AllergyCategory.values.firstWhere((e) => e.wire == value, orElse: () => AllergyCategory.unknown);

  String toJson() => wire;
}

enum AllergyScreen {
  notAsked('not_asked'),
  noneKnown('none_known'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const AllergyScreen(this.wire);
  final String wire;

  static AllergyScreen fromJson(String value) =>
      AllergyScreen.values.firstWhere((e) => e.wire == value, orElse: () => AllergyScreen.unknown);

  String toJson() => wire;
}

enum AllergySeverity {
  mild('mild'),
  moderate('moderate'),
  severe('severe'),
  unknownValue('unknown'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const AllergySeverity(this.wire);
  final String wire;

  static AllergySeverity fromJson(String value) =>
      AllergySeverity.values.firstWhere((e) => e.wire == value, orElse: () => AllergySeverity.unknown);

  String toJson() => wire;
}

enum BirthPrecision {
  day('day'),
  year('year'),
  estimated('estimated'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const BirthPrecision(this.wire);
  final String wire;

  static BirthPrecision fromJson(String value) =>
      BirthPrecision.values.firstWhere((e) => e.wire == value, orElse: () => BirthPrecision.unknown);

  String toJson() => wire;
}

enum ChangeEntity {
  encounter('encounter'),
  encounterNote('encounter_note'),
  audit('audit'),
  patient('patient'),
  patientAlias('patient_alias'),
  patientAllergy('patient_allergy'),
  patientConsent('patient_consent'),
  problem('problem'),
  problemNote('problem_note'),
  idLink('id_link'),

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

enum ConsentViewDecision {
  given('given'),
  unable('unable'),
  acknowledged('acknowledged'),
  declined('declined'),
  notOffered('not_offered'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ConsentViewDecision(this.wire);
  final String wire;

  static ConsentViewDecision fromJson(String value) =>
      ConsentViewDecision.values.firstWhere((e) => e.wire == value, orElse: () => ConsentViewDecision.unknown);

  String toJson() => wire;
}

enum ConsentViewKind {
  careAndRecord('care_and_record'),
  privacyNotice('privacy_notice'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ConsentViewKind(this.wire);
  final String wire;

  static ConsentViewKind fromJson(String value) =>
      ConsentViewKind.values.firstWhere((e) => e.wire == value, orElse: () => ConsentViewKind.unknown);

  String toJson() => wire;
}

enum ConsentViewMethod {
  verbal('verbal'),
  written('written'),
  notApplicable('not_applicable'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ConsentViewMethod(this.wire);
  final String wire;

  static ConsentViewMethod fromJson(String value) =>
      ConsentViewMethod.values.firstWhere((e) => e.wire == value, orElse: () => ConsentViewMethod.unknown);

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

enum DecideDuplicateDecision {
  merge('merge'),
  keepSeparate('keep_separate'),
  notSure('not_sure'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DecideDuplicateDecision(this.wire);
  final String wire;

  static DecideDuplicateDecision fromJson(String value) =>
      DecideDuplicateDecision.values.firstWhere((e) => e.wire == value, orElse: () => DecideDuplicateDecision.unknown);

  String toJson() => wire;
}

enum DecideFieldReviewKeep {
  current('current'),
  alternate('alternate'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DecideFieldReviewKeep(this.wire);
  final String wire;

  static DecideFieldReviewKeep fromJson(String value) =>
      DecideFieldReviewKeep.values.firstWhere((e) => e.wire == value, orElse: () => DecideFieldReviewKeep.unknown);

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

enum DuplicateDecisionViewDecision {
  merge('merge'),
  keepSeparate('keep_separate'),
  notSure('not_sure'),
  undoMerge('undo_merge'),
  flaggedByStaff('flagged_by_staff'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DuplicateDecisionViewDecision(this.wire);
  final String wire;

  static DuplicateDecisionViewDecision fromJson(String value) =>
      DuplicateDecisionViewDecision.values.firstWhere((e) => e.wire == value, orElse: () => DuplicateDecisionViewDecision.unknown);

  String toJson() => wire;
}

enum DuplicateHintStatus {
  open('open'),
  notSure('not_sure'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DuplicateHintStatus(this.wire);
  final String wire;

  static DuplicateHintStatus fromJson(String value) =>
      DuplicateHintStatus.values.firstWhere((e) => e.wire == value, orElse: () => DuplicateHintStatus.unknown);

  String toJson() => wire;
}

enum DuplicateSource {
  syncValue('sync'),
  edit('edit'),
  mergeRematch('merge_rematch'),
  correction('correction'),
  staffReport('staff_report'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DuplicateSource(this.wire);
  final String wire;

  static DuplicateSource fromJson(String value) =>
      DuplicateSource.values.firstWhere((e) => e.wire == value, orElse: () => DuplicateSource.unknown);

  String toJson() => wire;
}

enum DuplicateStatus {
  open('open'),
  notSure('not_sure'),
  keepSeparate('keep_separate'),
  merged('merged'),
  superseded('superseded'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const DuplicateStatus(this.wire);
  final String wire;

  static DuplicateStatus fromJson(String value) =>
      DuplicateStatus.values.firstWhere((e) => e.wire == value, orElse: () => DuplicateStatus.unknown);

  String toJson() => wire;
}

enum FetchChartsReason {
  opened('opened'),
  refresh('refresh'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const FetchChartsReason(this.wire);
  final String wire;

  static FetchChartsReason fromJson(String value) =>
      FetchChartsReason.values.firstWhere((e) => e.wire == value, orElse: () => FetchChartsReason.unknown);

  String toJson() => wire;
}

enum FieldReviewViewStatus {
  open('open'),
  decided('decided'),
  obsolete('obsolete'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const FieldReviewViewStatus(this.wire);
  final String wire;

  static FieldReviewViewStatus fromJson(String value) =>
      FieldReviewViewStatus.values.firstWhere((e) => e.wire == value, orElse: () => FieldReviewViewStatus.unknown);

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

enum HistoryKind {
  created('created'),
  setValue('set'),
  filledBlank('filled_blank'),
  replacedAfterReview('replaced_after_review'),
  keptBoth('kept_both'),
  confirmed('confirmed'),
  redirected('redirected'),
  corrected('corrected'),
  reviewDecided('review_decided'),
  mergeFill('merge_fill'),
  mergeUndone('merge_undone'),
  clearedByAllergy('cleared_by_allergy'),
  enteredInError('entered_in_error'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const HistoryKind(this.wire);
  final String wire;

  static HistoryKind fromJson(String value) =>
      HistoryKind.values.firstWhere((e) => e.wire == value, orElse: () => HistoryKind.unknown);

  String toJson() => wire;
}

enum IdLinkReason {
  firstCard('first_card'),
  lost('lost'),
  damaged('damaged'),
  stolen('stolen'),
  patientRequest('patient_request'),
  other('other'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const IdLinkReason(this.wire);
  final String wire;

  static IdLinkReason fromJson(String value) =>
      IdLinkReason.values.firstWhere((e) => e.wire == value, orElse: () => IdLinkReason.unknown);

  String toJson() => wire;
}

enum IdLinkStatus {
  active('active'),
  retired('retired'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const IdLinkStatus(this.wire);
  final String wire;

  static IdLinkStatus fromJson(String value) =>
      IdLinkStatus.values.firstWhere((e) => e.wire == value, orElse: () => IdLinkStatus.unknown);

  String toJson() => wire;
}

enum IdentityCorrectionField {
  legalName('legalName'),
  birth('birth'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const IdentityCorrectionField(this.wire);
  final String wire;

  static IdentityCorrectionField fromJson(String value) =>
      IdentityCorrectionField.values.firstWhere((e) => e.wire == value, orElse: () => IdentityCorrectionField.unknown);

  String toJson() => wire;
}

/// declined: an amendment request refused with a reason; the chart is unchanged
enum IdentityCorrectionOutcome {
  corrected('corrected'),
  declined('declined'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const IdentityCorrectionOutcome(this.wire);
  final String wire;

  static IdentityCorrectionOutcome fromJson(String value) =>
      IdentityCorrectionOutcome.values.firstWhere((e) => e.wire == value, orElse: () => IdentityCorrectionOutcome.unknown);

  String toJson() => wire;
}

/// open: open and not sure
enum ListDuplicatesStatus {
  open('open'),
  notSure('not_sure'),
  decided('decided'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ListDuplicatesStatus(this.wire);
  final String wire;

  static ListDuplicatesStatus fromJson(String value) =>
      ListDuplicatesStatus.values.firstWhere((e) => e.wire == value, orElse: () => ListDuplicatesStatus.unknown);

  String toJson() => wire;
}

enum ListFieldReviewsStatus {
  open('open'),
  decided('decided'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ListFieldReviewsStatus(this.wire);
  final String wire;

  static ListFieldReviewsStatus fromJson(String value) =>
      ListFieldReviewsStatus.values.firstWhere((e) => e.wire == value, orElse: () => ListFieldReviewsStatus.unknown);

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

enum MatchBand {
  likely('likely'),
  possible('possible'),
  weak('weak'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const MatchBand(this.wire);
  final String wire;

  static MatchBand fromJson(String value) =>
      MatchBand.values.firstWhere((e) => e.wire == value, orElse: () => MatchBand.unknown);

  String toJson() => wire;
}

enum MatchReason {
  name('name'),
  alias('alias'),
  legalName('legal_name'),
  descriptor('descriptor'),
  typo('typo'),
  nickname('nickname'),
  soundsLike('sounds_like'),
  initial('initial'),
  dobExact('dob_exact'),
  dobSwapped('dob_swapped'),
  dobMonthYear('dob_month_year'),
  dobYearSlip('dob_year_slip'),
  dobYear('dob_year'),
  dobEstimate('dob_estimate'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const MatchReason(this.wire);
  final String wire;

  static MatchReason fromJson(String value) =>
      MatchReason.values.firstWhere((e) => e.wire == value, orElse: () => MatchReason.unknown);

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

enum PairSideCreatedHow {
  phoneOffline('phone_offline'),
  phone('phone'),
  unknownValue('unknown'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PairSideCreatedHow(this.wire);
  final String wire;

  static PairSideCreatedHow fromJson(String value) =>
      PairSideCreatedHow.values.firstWhere((e) => e.wire == value, orElse: () => PairSideCreatedHow.unknown);

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

enum ProblemStatus {
  newValue('new'),
  ongoing('ongoing'),
  resolved('resolved'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ProblemStatus(this.wire);
  final String wire;

  static ProblemStatus fromJson(String value) =>
      ProblemStatus.values.firstWhere((e) => e.wire == value, orElse: () => ProblemStatus.unknown);

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
  patient('patient'),
  patientAlias('patient_alias'),
  patientAllergy('patient_allergy'),
  patientConsent('patient_consent'),
  problem('problem'),
  problemNote('problem_note'),
  idLink('id_link'),

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

enum ReviewNeeds {
  patientsEdit('patients.edit'),
  patientsCorrectIdentity('patients.correct_identity'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ReviewNeeds(this.wire);
  final String wire;

  static ReviewNeeds fromJson(String value) =>
      ReviewNeeds.values.firstWhere((e) => e.wire == value, orElse: () => ReviewNeeds.unknown);

  String toJson() => wire;
}

/// Where the result is shown. On the phone no result carries a legal name.
enum Surface {
  portal('portal'),
  phone('phone'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const Surface(this.wire);
  final String wire;

  static Surface fromJson(String value) =>
      Surface.values.firstWhere((e) => e.wire == value, orElse: () => Surface.unknown);

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

enum TeamIndexPageStatus {
  unchanged('unchanged'),
  page('page'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const TeamIndexPageStatus(this.wire);
  final String wire;

  static TeamIndexPageStatus fromJson(String value) =>
      TeamIndexPageStatus.values.firstWhere((e) => e.wire == value, orElse: () => TeamIndexPageStatus.unknown);

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

class AllergySummary {
  const AllergySummary({
    required this.count,
    required this.screen,
    required this.severe,
  });

  final int count;
  final AllergyScreen screen;
  final bool severe;

  factory AllergySummary.fromJson(Map<String, dynamic> json) => AllergySummary(
        count: (json['count'] as num).toInt(),
        screen: AllergyScreen.fromJson(json['screen'] as String),
        severe: json['severe'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'count': count,
        'screen': screen.toJson(),
        'severe': severe,
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

class BirthInput {
  const BirthInput({
    this.date,
    required this.precision,
    this.year,
  });

  /// With precision day
  final String? date;
  final BirthPrecision precision;
  /// With year or estimated
  final int? year;

  factory BirthInput.fromJson(Map<String, dynamic> json) => BirthInput(
        date: json['date'] == null ? null : json['date'] as String,
        precision: BirthPrecision.fromJson(json['precision'] as String),
        year: json['year'] == null ? null : (json['year'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (date != null) 'date': date!,
        'precision': precision.toJson(),
        if (year != null) 'year': year!,
      };
}

class BirthQuery {
  const BirthQuery({
    this.day,
    this.month,
    required this.year,
  });

  final int? day;
  final int? month;
  final int year;

  factory BirthQuery.fromJson(Map<String, dynamic> json) => BirthQuery(
        day: json['day'] == null ? null : (json['day'] as num).toInt(),
        month: json['month'] == null ? null : (json['month'] as num).toInt(),
        year: (json['year'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (day != null) 'day': day!,
        if (month != null) 'month': month!,
        'year': year,
      };
}

class BirthView {
  const BirthView({
    this.date,
    required this.precision,
    this.year,
  });

  /// A calendar date, YYYY-MM-DD
  final String? date;
  final BirthPrecision precision;
  final int? year;

  factory BirthView.fromJson(Map<String, dynamic> json) => BirthView(
        date: json['date'] == null ? null : json['date'] as String,
        precision: BirthPrecision.fromJson(json['precision'] as String),
        year: json['year'] == null ? null : (json['year'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (date != null) 'date': date!,
        'precision': precision.toJson(),
        if (year != null) 'year': year!,
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

class ChartBundle {
  const ChartBundle({
    required this.charts,
    required this.missing,
    required this.redirects,
  });

  final List<PatientChart> charts;
  final List<String> missing;
  /// Every live redirect into or out of the requested IDs and the returned groups
  final List<PatientRedirect> redirects;

  factory ChartBundle.fromJson(Map<String, dynamic> json) => ChartBundle(
        charts: (json['charts'] as List<dynamic>).map((e) => PatientChart.fromJson(e as Map<String, dynamic>)).toList(),
        missing: (json['missing'] as List<dynamic>).map((e) => e as String).toList(),
        redirects: (json['redirects'] as List<dynamic>).map((e) => PatientRedirect.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'charts': charts.map((e) => e.toJson()).toList(),
        'missing': missing.map((e) => e).toList(),
        'redirects': redirects.map((e) => e.toJson()).toList(),
      };
}

class ConsentView {
  const ConsentView({
    required this.decision,
    required this.id,
    required this.kind,
    required this.method,
    required this.recordedAt,
    required this.recordedBy,
  });

  final ConsentViewDecision decision;
  final String id;
  final ConsentViewKind kind;
  final ConsentViewMethod method;
  final DateTime recordedAt;
  final UserRef recordedBy;

  factory ConsentView.fromJson(Map<String, dynamic> json) => ConsentView(
        decision: ConsentViewDecision.fromJson(json['decision'] as String),
        id: json['id'] as String,
        kind: ConsentViewKind.fromJson(json['kind'] as String),
        method: ConsentViewMethod.fromJson(json['method'] as String),
        recordedAt: DateTime.parse(json['recordedAt'] as String),
        recordedBy: UserRef.fromJson(json['recordedBy'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'decision': decision.toJson(),
        'id': id,
        'kind': kind.toJson(),
        'method': method.toJson(),
        'recordedAt': recordedAt.toUtc().toIso8601String(),
        'recordedBy': recordedBy.toJson(),
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

class DecideDuplicate {
  const DecideDuplicate({
    required this.comment,
    required this.decision,
    this.fieldNote,
    this.survivorId,
    required this.versions,
  });

  /// Why, in a few words. Logged.
  final String comment;
  final DecideDuplicateDecision decision;
  /// Not sure only: shown to field staff on both charts
  final String? fieldNote;
  /// Merge only: the chart that is kept
  final String? survivorId;
  /// The versions the reviewer saw
  final DecideDuplicateVersions versions;

  factory DecideDuplicate.fromJson(Map<String, dynamic> json) => DecideDuplicate(
        comment: json['comment'] as String,
        decision: DecideDuplicateDecision.fromJson(json['decision'] as String),
        fieldNote: json['fieldNote'] == null ? null : json['fieldNote'] as String,
        survivorId: json['survivorId'] == null ? null : json['survivorId'] as String,
        versions: DecideDuplicateVersions.fromJson(json['versions'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
        'decision': decision.toJson(),
        if (fieldNote != null) 'fieldNote': fieldNote!,
        if (survivorId != null) 'survivorId': survivorId!,
        'versions': versions.toJson(),
      };
}

/// The versions the reviewer saw
class DecideDuplicateVersions {
  const DecideDuplicateVersions({
    required this.a,
    required this.b,
  });

  final int a;
  final int b;

  factory DecideDuplicateVersions.fromJson(Map<String, dynamic> json) => DecideDuplicateVersions(
        a: (json['a'] as num).toInt(),
        b: (json['b'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'a': a,
        'b': b,
      };
}

class DecideFieldReview {
  const DecideFieldReview({
    required this.baseVersion,
    this.comment,
    this.historyId,
    required this.keep,
  });

  final int baseVersion;
  /// Required for legal name and birth
  final String? comment;
  /// The alternate kept
  final String? historyId;
  final DecideFieldReviewKeep keep;

  factory DecideFieldReview.fromJson(Map<String, dynamic> json) => DecideFieldReview(
        baseVersion: (json['baseVersion'] as num).toInt(),
        comment: json['comment'] == null ? null : json['comment'] as String,
        historyId: json['historyId'] == null ? null : json['historyId'] as String,
        keep: DecideFieldReviewKeep.fromJson(json['keep'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'baseVersion': baseVersion,
        if (comment != null) 'comment': comment!,
        if (historyId != null) 'historyId': historyId!,
        'keep': keep.toJson(),
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

class DeclineReversal {
  const DeclineReversal({
    required this.reason,
  });

  /// Why, in a few words. Logged.
  final String reason;

  factory DeclineReversal.fromJson(Map<String, dynamic> json) => DeclineReversal(
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
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

class DuplicateDecisionResult {
  const DuplicateDecisionResult({
    required this.merge,
    required this.pair,
  });

  final MergeView? merge;
  final DuplicatePairSummary pair;

  factory DuplicateDecisionResult.fromJson(Map<String, dynamic> json) => DuplicateDecisionResult(
        merge: json['merge'] == null ? null : MergeView.fromJson(json['merge'] as Map<String, dynamic>),
        pair: DuplicatePairSummary.fromJson(json['pair'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'merge': merge == null ? null : merge!.toJson(),
        'pair': pair.toJson(),
      };
}

class DuplicateDecisionView {
  const DuplicateDecisionView({
    required this.comment,
    required this.decidedAt,
    required this.decidedBy,
    required this.decision,
    required this.id,
    required this.mergeId,
    required this.survivorId,
  });

  final String comment;
  final DateTime decidedAt;
  final UserRef decidedBy;
  final DuplicateDecisionViewDecision decision;
  final String id;
  final String? mergeId;
  final String? survivorId;

  factory DuplicateDecisionView.fromJson(Map<String, dynamic> json) => DuplicateDecisionView(
        comment: json['comment'] as String,
        decidedAt: DateTime.parse(json['decidedAt'] as String),
        decidedBy: UserRef.fromJson(json['decidedBy'] as Map<String, dynamic>),
        decision: DuplicateDecisionViewDecision.fromJson(json['decision'] as String),
        id: json['id'] as String,
        mergeId: json['mergeId'] == null ? null : json['mergeId'] as String,
        survivorId: json['survivorId'] == null ? null : json['survivorId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
        'decidedAt': decidedAt.toUtc().toIso8601String(),
        'decidedBy': decidedBy.toJson(),
        'decision': decision.toJson(),
        'id': id,
        'mergeId': mergeId == null ? null : mergeId!,
        'survivorId': survivorId == null ? null : survivorId!,
      };
}

class DuplicateHint {
  const DuplicateHint({
    required this.note,
    required this.status,
  });

  /// The reviewer’s Not sure note, shown to field staff
  final String? note;
  final DuplicateHintStatus status;

  factory DuplicateHint.fromJson(Map<String, dynamic> json) => DuplicateHint(
        note: json['note'] == null ? null : json['note'] as String,
        status: DuplicateHintStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'note': note == null ? null : note!,
        'status': status.toJson(),
      };
}

class DuplicatePage {
  const DuplicatePage({
    required this.nextAfterId,
    required this.pairs,
  });

  /// Pass as afterId for the next page; null on the last
  final String? nextAfterId;
  final List<DuplicatePairSummary> pairs;

  factory DuplicatePage.fromJson(Map<String, dynamic> json) => DuplicatePage(
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
        pairs: (json['pairs'] as List<dynamic>).map((e) => DuplicatePairSummary.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
        'pairs': pairs.map((e) => e.toJson()).toList(),
      };
}

class DuplicatePairDetail {
  const DuplicatePairDetail({
    required this.a,
    required this.b,
    required this.compared,
    required this.decisions,
    required this.pair,
  });

  final PairSide a;
  final PairSide b;
  final List<DuplicatePairDetailComparedItem> compared;
  final List<DuplicateDecisionView> decisions;
  final DuplicatePairSummary pair;

  factory DuplicatePairDetail.fromJson(Map<String, dynamic> json) => DuplicatePairDetail(
        a: PairSide.fromJson(json['a'] as Map<String, dynamic>),
        b: PairSide.fromJson(json['b'] as Map<String, dynamic>),
        compared: (json['compared'] as List<dynamic>).map((e) => DuplicatePairDetailComparedItem.fromJson(e as Map<String, dynamic>)).toList(),
        decisions: (json['decisions'] as List<dynamic>).map((e) => DuplicateDecisionView.fromJson(e as Map<String, dynamic>)).toList(),
        pair: DuplicatePairSummary.fromJson(json['pair'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'a': a.toJson(),
        'b': b.toJson(),
        'compared': compared.map((e) => e.toJson()).toList(),
        'decisions': decisions.map((e) => e.toJson()).toList(),
        'pair': pair.toJson(),
      };
}

class DuplicatePairDetailComparedItem {
  const DuplicatePairDetailComparedItem({
    required this.field,
    required this.same,
  });

  final String field;
  final bool same;

  factory DuplicatePairDetailComparedItem.fromJson(Map<String, dynamic> json) => DuplicatePairDetailComparedItem(
        field: json['field'] as String,
        same: json['same'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'field': field,
        'same': same,
      };
}

class DuplicatePairSummary {
  const DuplicatePairSummary({
    required this.a,
    required this.b,
    required this.band,
    required this.creatorDismissed,
    required this.decidedAt,
    required this.firstFlaggedAt,
    required this.id,
    required this.lastFlaggedAt,
    required this.note,
    required this.reasons,
    required this.score,
    required this.sources,
    required this.status,
  });

  final PairPatient a;
  final PairPatient b;
  final MatchBand band;
  /// The creator saw this match at intake and said "Not them"
  final bool creatorDismissed;
  final DateTime? decidedAt;
  final DateTime firstFlaggedAt;
  final String id;
  final DateTime lastFlaggedAt;
  final String? note;
  final List<MatchReason> reasons;
  final double score;
  final List<DuplicateSource> sources;
  final DuplicateStatus status;

  factory DuplicatePairSummary.fromJson(Map<String, dynamic> json) => DuplicatePairSummary(
        a: PairPatient.fromJson(json['a'] as Map<String, dynamic>),
        b: PairPatient.fromJson(json['b'] as Map<String, dynamic>),
        band: MatchBand.fromJson(json['band'] as String),
        creatorDismissed: json['creatorDismissed'] as bool,
        decidedAt: json['decidedAt'] == null ? null : DateTime.parse(json['decidedAt'] as String),
        firstFlaggedAt: DateTime.parse(json['firstFlaggedAt'] as String),
        id: json['id'] as String,
        lastFlaggedAt: DateTime.parse(json['lastFlaggedAt'] as String),
        note: json['note'] == null ? null : json['note'] as String,
        reasons: (json['reasons'] as List<dynamic>).map((e) => MatchReason.fromJson(e as String)).toList(),
        score: (json['score'] as num).toDouble(),
        sources: (json['sources'] as List<dynamic>).map((e) => DuplicateSource.fromJson(e as String)).toList(),
        status: DuplicateStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'a': a.toJson(),
        'b': b.toJson(),
        'band': band.toJson(),
        'creatorDismissed': creatorDismissed,
        'decidedAt': decidedAt == null ? null : decidedAt!.toUtc().toIso8601String(),
        'firstFlaggedAt': firstFlaggedAt.toUtc().toIso8601String(),
        'id': id,
        'lastFlaggedAt': lastFlaggedAt.toUtc().toIso8601String(),
        'note': note == null ? null : note!,
        'reasons': reasons.map((e) => e.toJson()).toList(),
        'score': score,
        'sources': sources.map((e) => e.toJson()).toList(),
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

class FetchCharts {
  const FetchCharts({
    required this.patientIds,
    required this.reason,
  });

  final List<String> patientIds;
  final FetchChartsReason reason;

  factory FetchCharts.fromJson(Map<String, dynamic> json) => FetchCharts(
        patientIds: (json['patientIds'] as List<dynamic>).map((e) => e as String).toList(),
        reason: FetchChartsReason.fromJson(json['reason'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'patientIds': patientIds.map((e) => e).toList(),
        'reason': reason.toJson(),
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

class FieldHistoryEntry {
  const FieldHistoryEntry({
    required this.approvedBy,
    required this.changedBy,
    required this.correctionId,
    required this.deviceTime,
    required this.entity,
    required this.field,
    required this.id,
    required this.kind,
    this.previousValue,
    required this.recordId,
    required this.recordedAt,
    required this.reviewId,
    this.value,
    required this.version,
  });

  final UserRef? approvedBy;
  final UserRef changedBy;
  final String? correctionId;
  final DateTime? deviceTime;
  final String entity;
  final String field;
  /// A field history entry
  final String id;
  final HistoryKind kind;
  final Object? previousValue;
  final String recordId;
  final DateTime recordedAt;
  final String? reviewId;
  final Object? value;
  final int version;

  factory FieldHistoryEntry.fromJson(Map<String, dynamic> json) => FieldHistoryEntry(
        approvedBy: json['approvedBy'] == null ? null : UserRef.fromJson(json['approvedBy'] as Map<String, dynamic>),
        changedBy: UserRef.fromJson(json['changedBy'] as Map<String, dynamic>),
        correctionId: json['correctionId'] == null ? null : json['correctionId'] as String,
        deviceTime: json['deviceTime'] == null ? null : DateTime.parse(json['deviceTime'] as String),
        entity: json['entity'] as String,
        field: json['field'] as String,
        id: json['id'] as String,
        kind: HistoryKind.fromJson(json['kind'] as String),
        previousValue: json['previousValue'],
        recordId: json['recordId'] as String,
        recordedAt: DateTime.parse(json['recordedAt'] as String),
        reviewId: json['reviewId'] == null ? null : json['reviewId'] as String,
        value: json['value'],
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'approvedBy': approvedBy == null ? null : approvedBy!.toJson(),
        'changedBy': changedBy.toJson(),
        'correctionId': correctionId == null ? null : correctionId!,
        'deviceTime': deviceTime == null ? null : deviceTime!.toUtc().toIso8601String(),
        'entity': entity,
        'field': field,
        'id': id,
        'kind': kind.toJson(),
        'previousValue': previousValue,
        'recordId': recordId,
        'recordedAt': recordedAt.toUtc().toIso8601String(),
        'reviewId': reviewId == null ? null : reviewId!,
        'value': value,
        'version': version,
      };
}

class FieldHistoryPage {
  const FieldHistoryPage({
    required this.entries,
    required this.nextAfterId,
  });

  final List<FieldHistoryEntry> entries;
  /// A field history entry
  final String? nextAfterId;

  factory FieldHistoryPage.fromJson(Map<String, dynamic> json) => FieldHistoryPage(
        entries: (json['entries'] as List<dynamic>).map((e) => FieldHistoryEntry.fromJson(e as Map<String, dynamic>)).toList(),
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'entries': entries.map((e) => e.toJson()).toList(),
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
      };
}

class FieldReviewPage {
  const FieldReviewPage({
    required this.nextAfterId,
    required this.reviews,
  });

  /// Pass as afterId for the next page; null on the last
  final String? nextAfterId;
  final List<FieldReviewView> reviews;

  factory FieldReviewPage.fromJson(Map<String, dynamic> json) => FieldReviewPage(
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
        reviews: (json['reviews'] as List<dynamic>).map((e) => FieldReviewView.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
        'reviews': reviews.map((e) => e.toJson()).toList(),
      };
}

class FieldReviewView {
  const FieldReviewView({
    required this.alternates,
    required this.current,
    required this.field,
    required this.id,
    required this.needs,
    required this.openedAt,
    required this.patientId,
    required this.status,
  });

  final List<FieldReviewViewAlternatesItem> alternates;
  final FieldState current;
  final String field;
  final String id;
  final ReviewNeeds needs;
  final DateTime openedAt;
  final String patientId;
  final FieldReviewViewStatus status;

  factory FieldReviewView.fromJson(Map<String, dynamic> json) => FieldReviewView(
        alternates: (json['alternates'] as List<dynamic>).map((e) => FieldReviewViewAlternatesItem.fromJson(e as Map<String, dynamic>)).toList(),
        current: FieldState.fromJson(json['current'] as Map<String, dynamic>),
        field: json['field'] as String,
        id: json['id'] as String,
        needs: ReviewNeeds.fromJson(json['needs'] as String),
        openedAt: DateTime.parse(json['openedAt'] as String),
        patientId: json['patientId'] as String,
        status: FieldReviewViewStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'alternates': alternates.map((e) => e.toJson()).toList(),
        'current': current.toJson(),
        'field': field,
        'id': id,
        'needs': needs.toJson(),
        'openedAt': openedAt.toUtc().toIso8601String(),
        'patientId': patientId,
        'status': status.toJson(),
      };
}

class FieldReviewViewAlternatesItem {
  const FieldReviewViewAlternatesItem({
    required this.by,
    required this.deviceTime,
    required this.historyId,
    this.value,
  });

  final UserRef by;
  final DateTime? deviceTime;
  /// A field history entry
  final String historyId;
  final Object? value;

  factory FieldReviewViewAlternatesItem.fromJson(Map<String, dynamic> json) => FieldReviewViewAlternatesItem(
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        deviceTime: json['deviceTime'] == null ? null : DateTime.parse(json['deviceTime'] as String),
        historyId: json['historyId'] as String,
        value: json['value'],
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'by': by.toJson(),
        'deviceTime': deviceTime == null ? null : deviceTime!.toUtc().toIso8601String(),
        'historyId': historyId,
        'value': value,
      };
}

/// On conflict, or when the value was kept but not applied: the value the server holds
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

class FlagDuplicate {
  const FlagDuplicate({
    required this.comment,
    required this.patientA,
    required this.patientB,
  });

  /// Why, in a few words. Logged.
  final String comment;
  final String patientA;
  final String patientB;

  factory FlagDuplicate.fromJson(Map<String, dynamic> json) => FlagDuplicate(
        comment: json['comment'] as String,
        patientA: json['patientA'] as String,
        patientB: json['patientB'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
        'patientA': patientA,
        'patientB': patientB,
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

class IdLinkState {
  const IdLinkState({
    required this.active,
    required this.history,
  });

  final List<IdLinkView> active;
  final List<IdLinkView> history;

  factory IdLinkState.fromJson(Map<String, dynamic> json) => IdLinkState(
        active: (json['active'] as List<dynamic>).map((e) => IdLinkView.fromJson(e as Map<String, dynamic>)).toList(),
        history: (json['history'] as List<dynamic>).map((e) => IdLinkView.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'active': active.map((e) => e.toJson()).toList(),
        'history': history.map((e) => e.toJson()).toList(),
      };
}

class IdLinkSummary {
  const IdLinkSummary({
    required this.effectiveAt,
    required this.id,
    required this.issuedOn,
    required this.madeOffline,
    required this.status,
    this.url,
  });

  final DateTime effectiveAt;
  final String id;
  /// The patient record the link was issued on
  final String issuedOn;
  final bool madeOffline;
  final IdLinkStatus status;
  /// patients.edit only
  final String? url;

  factory IdLinkSummary.fromJson(Map<String, dynamic> json) => IdLinkSummary(
        effectiveAt: DateTime.parse(json['effectiveAt'] as String),
        id: json['id'] as String,
        issuedOn: json['issuedOn'] as String,
        madeOffline: json['madeOffline'] as bool,
        status: IdLinkStatus.fromJson(json['status'] as String),
        url: json['url'] == null ? null : json['url'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'effectiveAt': effectiveAt.toUtc().toIso8601String(),
        'id': id,
        'issuedOn': issuedOn,
        'madeOffline': madeOffline,
        'status': status.toJson(),
        if (url != null) 'url': url!,
      };
}

class IdLinkView {
  const IdLinkView({
    required this.effectiveAt,
    required this.id,
    required this.issuedBy,
    required this.issuedOn,
    required this.madeOffline,
    required this.reason,
    required this.replacedBy,
    required this.restoredAt,
    required this.retiredAt,
    required this.retiredReason,
    required this.status,
    required this.tokenRef,
    this.url,
  });

  final DateTime effectiveAt;
  final String id;
  final UserRef issuedBy;
  final String issuedOn;
  final bool madeOffline;
  final IdLinkReason reason;
  final String? replacedBy;
  final DateTime? restoredAt;
  final DateTime? retiredAt;
  final String? retiredReason;
  final IdLinkStatus status;
  /// First 12 hex characters of the token’s SHA-256
  final String tokenRef;
  /// Active links only, for patients.edit
  final String? url;

  factory IdLinkView.fromJson(Map<String, dynamic> json) => IdLinkView(
        effectiveAt: DateTime.parse(json['effectiveAt'] as String),
        id: json['id'] as String,
        issuedBy: UserRef.fromJson(json['issuedBy'] as Map<String, dynamic>),
        issuedOn: json['issuedOn'] as String,
        madeOffline: json['madeOffline'] as bool,
        reason: IdLinkReason.fromJson(json['reason'] as String),
        replacedBy: json['replacedBy'] == null ? null : json['replacedBy'] as String,
        restoredAt: json['restoredAt'] == null ? null : DateTime.parse(json['restoredAt'] as String),
        retiredAt: json['retiredAt'] == null ? null : DateTime.parse(json['retiredAt'] as String),
        retiredReason: json['retiredReason'] == null ? null : json['retiredReason'] as String,
        status: IdLinkStatus.fromJson(json['status'] as String),
        tokenRef: json['tokenRef'] as String,
        url: json['url'] == null ? null : json['url'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'effectiveAt': effectiveAt.toUtc().toIso8601String(),
        'id': id,
        'issuedBy': issuedBy.toJson(),
        'issuedOn': issuedOn,
        'madeOffline': madeOffline,
        'reason': reason.toJson(),
        'replacedBy': replacedBy == null ? null : replacedBy!,
        'restoredAt': restoredAt == null ? null : restoredAt!.toUtc().toIso8601String(),
        'retiredAt': retiredAt == null ? null : retiredAt!.toUtc().toIso8601String(),
        'retiredReason': retiredReason == null ? null : retiredReason!,
        'status': status.toJson(),
        'tokenRef': tokenRef,
        if (url != null) 'url': url!,
      };
}

class IdentityCorrection {
  const IdentityCorrection({
    required this.baseVersion,
    required this.field,
    required this.outcome,
    required this.reason,
    required this.requestedByPatient,
    required this.value,
  });

  final int baseVersion;
  final IdentityCorrectionField field;
  /// declined: an amendment request refused with a reason; the chart is unchanged
  final IdentityCorrectionOutcome outcome;
  /// Why, in a few words. Logged.
  final String reason;
  /// A HIPAA §164.526 amendment request
  final bool requestedByPatient;
  final Object? value;

  factory IdentityCorrection.fromJson(Map<String, dynamic> json) => IdentityCorrection(
        baseVersion: (json['baseVersion'] as num).toInt(),
        field: IdentityCorrectionField.fromJson(json['field'] as String),
        outcome: IdentityCorrectionOutcome.fromJson(json['outcome'] as String),
        reason: json['reason'] as String,
        requestedByPatient: json['requestedByPatient'] as bool,
        value: json['value'],
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'baseVersion': baseVersion,
        'field': field.toJson(),
        'outcome': outcome.toJson(),
        'reason': reason,
        'requestedByPatient': requestedByPatient,
        'value': value,
      };
}

class IndexEntry {
  const IndexEntry({
    required this.aliases,
    required this.allergies,
    required this.allergyScreen,
    required this.birth,
    required this.duplicate,
    required this.idLinks,
    required this.lastSeenOn,
    required this.patientId,
    required this.preferredName,
    required this.reviews,
    required this.usualArea,
    required this.versions,
    required this.visualDescriptor,
  });

  final List<IndexEntryAliasesItem> aliases;
  final List<IndexEntryAllergiesItem> allergies;
  final AllergyScreen allergyScreen;
  final BirthView? birth;
  final DuplicateHint? duplicate;
  final List<IndexEntryIdLinksItem> idLinks;
  /// A calendar date, YYYY-MM-DD
  final String? lastSeenOn;
  final String patientId;
  final String? preferredName;
  /// Fields with an open review
  final List<String> reviews;
  final String? usualArea;
  final IndexEntryVersions versions;
  final String? visualDescriptor;

  factory IndexEntry.fromJson(Map<String, dynamic> json) => IndexEntry(
        aliases: (json['aliases'] as List<dynamic>).map((e) => IndexEntryAliasesItem.fromJson(e as Map<String, dynamic>)).toList(),
        allergies: (json['allergies'] as List<dynamic>).map((e) => IndexEntryAllergiesItem.fromJson(e as Map<String, dynamic>)).toList(),
        allergyScreen: AllergyScreen.fromJson(json['allergyScreen'] as String),
        birth: json['birth'] == null ? null : BirthView.fromJson(json['birth'] as Map<String, dynamic>),
        duplicate: json['duplicate'] == null ? null : DuplicateHint.fromJson(json['duplicate'] as Map<String, dynamic>),
        idLinks: (json['idLinks'] as List<dynamic>).map((e) => IndexEntryIdLinksItem.fromJson(e as Map<String, dynamic>)).toList(),
        lastSeenOn: json['lastSeenOn'] == null ? null : json['lastSeenOn'] as String,
        patientId: json['patientId'] as String,
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        reviews: (json['reviews'] as List<dynamic>).map((e) => e as String).toList(),
        usualArea: json['usualArea'] == null ? null : json['usualArea'] as String,
        versions: IndexEntryVersions.fromJson(json['versions'] as Map<String, dynamic>),
        visualDescriptor: json['visualDescriptor'] == null ? null : json['visualDescriptor'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'aliases': aliases.map((e) => e.toJson()).toList(),
        'allergies': allergies.map((e) => e.toJson()).toList(),
        'allergyScreen': allergyScreen.toJson(),
        'birth': birth == null ? null : birth!.toJson(),
        'duplicate': duplicate == null ? null : duplicate!.toJson(),
        'idLinks': idLinks.map((e) => e.toJson()).toList(),
        'lastSeenOn': lastSeenOn == null ? null : lastSeenOn!,
        'patientId': patientId,
        'preferredName': preferredName == null ? null : preferredName!,
        'reviews': reviews.map((e) => e).toList(),
        'usualArea': usualArea == null ? null : usualArea!,
        'versions': versions.toJson(),
        'visualDescriptor': visualDescriptor == null ? null : visualDescriptor!,
      };
}

class IndexEntryAliasesItem {
  const IndexEntryAliasesItem({
    required this.alias,
    required this.id,
  });

  final String alias;
  final String id;

  factory IndexEntryAliasesItem.fromJson(Map<String, dynamic> json) => IndexEntryAliasesItem(
        alias: json['alias'] as String,
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'alias': alias,
        'id': id,
      };
}

class IndexEntryAllergiesItem {
  const IndexEntryAllergiesItem({
    required this.category,
    required this.id,
    required this.severity,
    required this.substance,
  });

  final AllergyCategory category;
  final String id;
  final AllergySeverity severity;
  final String substance;

  factory IndexEntryAllergiesItem.fromJson(Map<String, dynamic> json) => IndexEntryAllergiesItem(
        category: AllergyCategory.fromJson(json['category'] as String),
        id: json['id'] as String,
        severity: AllergySeverity.fromJson(json['severity'] as String),
        substance: json['substance'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'category': category.toJson(),
        'id': id,
        'severity': severity.toJson(),
        'substance': substance,
      };
}

class IndexEntryIdLinksItem {
  const IndexEntryIdLinksItem({
    required this.effectiveAt,
    required this.id,
  });

  final DateTime effectiveAt;
  final String id;

  factory IndexEntryIdLinksItem.fromJson(Map<String, dynamic> json) => IndexEntryIdLinksItem(
        effectiveAt: DateTime.parse(json['effectiveAt'] as String),
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'effectiveAt': effectiveAt.toUtc().toIso8601String(),
        'id': id,
      };
}

class IndexEntryVersions {
  const IndexEntryVersions({
    required this.allergyScreen,
    required this.preferredName,
    required this.usualArea,
    required this.visualDescriptor,
  });

  final int allergyScreen;
  final int preferredName;
  final int usualArea;
  final int visualDescriptor;

  factory IndexEntryVersions.fromJson(Map<String, dynamic> json) => IndexEntryVersions(
        allergyScreen: (json['allergyScreen'] as num).toInt(),
        preferredName: (json['preferredName'] as num).toInt(),
        usualArea: (json['usualArea'] as num).toInt(),
        visualDescriptor: (json['visualDescriptor'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'allergyScreen': allergyScreen,
        'preferredName': preferredName,
        'usualArea': usualArea,
        'visualDescriptor': visualDescriptor,
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

class IssueIdLink {
  const IssueIdLink({
    required this.linkId,
    required this.reason,
    required this.replacesLinkId,
  });

  /// Made by the client, so a retry issues nothing twice
  final String linkId;
  final IdLinkReason reason;
  /// The newest active link the issuer saw; null for a first card
  final String? replacesLinkId;

  factory IssueIdLink.fromJson(Map<String, dynamic> json) => IssueIdLink(
        linkId: json['linkId'] as String,
        reason: IdLinkReason.fromJson(json['reason'] as String),
        replacesLinkId: json['replacesLinkId'] == null ? null : json['replacesLinkId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'linkId': linkId,
        'reason': reason.toJson(),
        'replacesLinkId': replacesLinkId == null ? null : replacesLinkId!,
      };
}

class LegalNameInput {
  const LegalNameInput({
    required this.family,
    required this.given,
  });

  final String? family;
  final String? given;

  factory LegalNameInput.fromJson(Map<String, dynamic> json) => LegalNameInput(
        family: json['family'] == null ? null : json['family'] as String,
        given: json['given'] == null ? null : json['given'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'family': family == null ? null : family!,
        'given': given == null ? null : given!,
      };
}

class LegalNameView {
  const LegalNameView({
    required this.family,
    required this.given,
  });

  final String? family;
  final String? given;

  factory LegalNameView.fromJson(Map<String, dynamic> json) => LegalNameView(
        family: json['family'] == null ? null : json['family'] as String,
        given: json['given'] == null ? null : json['given'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'family': family == null ? null : family!,
        'given': given == null ? null : given!,
      };
}

class Me {
  const Me({
    required this.idLinkBaseUrl,
    required this.isOwner,
    required this.mfa,
    required this.pendingAcknowledgements,
    required this.teams,
    required this.user,
  });

  /// Where Street Medicine ID cards point: the link is `{idLinkBaseUrl}/c#<token>`. Cached on the phone, so a card made offline carries the same URL the portal shows.
  final String idLinkBaseUrl;
  final bool isOwner;
  final MeMfa mfa;
  final List<Acknowledgement> pendingAcknowledgements;
  final List<MyTeam> teams;
  final MeUser user;

  factory Me.fromJson(Map<String, dynamic> json) => Me(
        idLinkBaseUrl: json['idLinkBaseUrl'] as String,
        isOwner: json['isOwner'] as bool,
        mfa: MeMfa.fromJson(json['mfa'] as Map<String, dynamic>),
        pendingAcknowledgements: (json['pendingAcknowledgements'] as List<dynamic>).map((e) => Acknowledgement.fromJson(e as Map<String, dynamic>)).toList(),
        teams: (json['teams'] as List<dynamic>).map((e) => MyTeam.fromJson(e as Map<String, dynamic>)).toList(),
        user: MeUser.fromJson(json['user'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'idLinkBaseUrl': idLinkBaseUrl,
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

class MergePage {
  const MergePage({
    required this.merges,
    required this.nextAfterId,
  });

  final List<MergeView> merges;
  /// Pass as afterId for the next page; null on the last
  final String? nextAfterId;

  factory MergePage.fromJson(Map<String, dynamic> json) => MergePage(
        merges: (json['merges'] as List<dynamic>).map((e) => MergeView.fromJson(e as Map<String, dynamic>)).toList(),
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'merges': merges.map((e) => e.toJson()).toList(),
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
      };
}

class MergeProblems {
  const MergeProblems({
    required this.comment,
    required this.intoProblemId,
  });

  /// Why, in a few words. Logged.
  final String comment;
  final String intoProblemId;

  factory MergeProblems.fromJson(Map<String, dynamic> json) => MergeProblems(
        comment: json['comment'] as String,
        intoProblemId: json['intoProblemId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
        'intoProblemId': intoProblemId,
      };
}

class MergeView {
  const MergeView({
    required this.comment,
    required this.id,
    required this.merged,
    required this.mergedAt,
    required this.mergedBy,
    required this.pairId,
    required this.survivor,
    required this.undoable,
    required this.undone,
  });

  final String comment;
  final String id;
  final PairPatient merged;
  final DateTime mergedAt;
  final UserRef mergedBy;
  final String pairId;
  final PairPatient survivor;
  /// For a caller with patients.correct_identity, when nothing was merged on top
  final bool undoable;
  final MergeViewUndone? undone;

  factory MergeView.fromJson(Map<String, dynamic> json) => MergeView(
        comment: json['comment'] as String,
        id: json['id'] as String,
        merged: PairPatient.fromJson(json['merged'] as Map<String, dynamic>),
        mergedAt: DateTime.parse(json['mergedAt'] as String),
        mergedBy: UserRef.fromJson(json['mergedBy'] as Map<String, dynamic>),
        pairId: json['pairId'] as String,
        survivor: PairPatient.fromJson(json['survivor'] as Map<String, dynamic>),
        undoable: json['undoable'] as bool,
        undone: json['undone'] == null ? null : MergeViewUndone.fromJson(json['undone'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
        'id': id,
        'merged': merged.toJson(),
        'mergedAt': mergedAt.toUtc().toIso8601String(),
        'mergedBy': mergedBy.toJson(),
        'pairId': pairId,
        'survivor': survivor.toJson(),
        'undoable': undoable,
        'undone': undone == null ? null : undone!.toJson(),
      };
}

class MergeViewUndone {
  const MergeViewUndone({
    required this.at,
    required this.by,
    required this.comment,
  });

  final DateTime at;
  final UserRef by;
  final String comment;

  factory MergeViewUndone.fromJson(Map<String, dynamic> json) => MergeViewUndone(
        at: DateTime.parse(json['at'] as String),
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        comment: json['comment'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'by': by.toJson(),
        'comment': comment,
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

class PairPatient {
  const PairPatient({
    required this.patientId,
    required this.summary,
  });

  final String patientId;
  final PatientSummary summary;

  factory PairPatient.fromJson(Map<String, dynamic> json) => PairPatient(
        patientId: json['patientId'] as String,
        summary: PatientSummary.fromJson(json['summary'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'patientId': patientId,
        'summary': summary.toJson(),
      };
}

class PairSide {
  const PairSide({
    required this.chart,
    required this.createdBy,
    required this.createdHow,
    required this.photoId,
    required this.recentEncounters,
    required this.version,
  });

  final PatientChart chart;
  final UserRef createdBy;
  final PairSideCreatedHow createdHow;
  /// Phase 8; always null in phase 3
  final String? photoId;
  /// Dates and kinds only
  final List<PairSideRecentEncountersItem> recentEncounters;
  /// Send back in DecideDuplicate.versions
  final int version;

  factory PairSide.fromJson(Map<String, dynamic> json) => PairSide(
        chart: PatientChart.fromJson(json['chart'] as Map<String, dynamic>),
        createdBy: UserRef.fromJson(json['createdBy'] as Map<String, dynamic>),
        createdHow: PairSideCreatedHow.fromJson(json['createdHow'] as String),
        photoId: json['photoId'] == null ? null : json['photoId'] as String,
        recentEncounters: (json['recentEncounters'] as List<dynamic>).map((e) => PairSideRecentEncountersItem.fromJson(e as Map<String, dynamic>)).toList(),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'chart': chart.toJson(),
        'createdBy': createdBy.toJson(),
        'createdHow': createdHow.toJson(),
        'photoId': photoId == null ? null : photoId!,
        'recentEncounters': recentEncounters.map((e) => e.toJson()).toList(),
        'version': version,
      };
}

class PairSideRecentEncountersItem {
  const PairSideRecentEncountersItem({
    required this.id,
    required this.kind,
    required this.startedAt,
  });

  final String id;
  final String kind;
  final DateTime startedAt;

  factory PairSideRecentEncountersItem.fromJson(Map<String, dynamic> json) => PairSideRecentEncountersItem(
        id: json['id'] as String,
        kind: json['kind'] as String,
        startedAt: DateTime.parse(json['startedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'kind': kind,
        'startedAt': startedAt.toUtc().toIso8601String(),
      };
}

class PatientChart {
  const PatientChart({
    required this.aliases,
    required this.allergies,
    required this.canonicalId,
    required this.consents,
    required this.duplicate,
    required this.idLinks,
    required this.mergedFrom,
    required this.patient,
    this.problemHistory,
    this.problemNotes,
    this.problems,
    required this.projection,
    this.redirectedFrom,
    required this.reviews,
  });

  final List<RecordSnapshot> aliases;
  final List<RecordSnapshot> allergies;
  final String canonicalId;
  final List<ConsentView> consents;
  final DuplicateHint? duplicate;
  /// Active links of the group: usually one; one per merged record that had a card until the next new card
  final List<IdLinkSummary> idLinks;
  final List<PatientChartMergedFromItem> mergedFrom;
  final RecordSnapshot patient;
  final List<ProblemStatusEvent>? problemHistory;
  final List<ProblemNoteView>? problemNotes;
  final List<RecordSnapshot>? problems;
  /// Which projection made this copy
  final String projection;
  /// The merged ID that was asked for
  final String? redirectedFrom;
  final List<FieldReviewView> reviews;

  factory PatientChart.fromJson(Map<String, dynamic> json) => PatientChart(
        aliases: (json['aliases'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        allergies: (json['allergies'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        canonicalId: json['canonicalId'] as String,
        consents: (json['consents'] as List<dynamic>).map((e) => ConsentView.fromJson(e as Map<String, dynamic>)).toList(),
        duplicate: json['duplicate'] == null ? null : DuplicateHint.fromJson(json['duplicate'] as Map<String, dynamic>),
        idLinks: (json['idLinks'] as List<dynamic>).map((e) => IdLinkSummary.fromJson(e as Map<String, dynamic>)).toList(),
        mergedFrom: (json['mergedFrom'] as List<dynamic>).map((e) => PatientChartMergedFromItem.fromJson(e as Map<String, dynamic>)).toList(),
        patient: RecordSnapshot.fromJson(json['patient'] as Map<String, dynamic>),
        problemHistory: json['problemHistory'] == null ? null : (json['problemHistory'] as List<dynamic>).map((e) => ProblemStatusEvent.fromJson(e as Map<String, dynamic>)).toList(),
        problemNotes: json['problemNotes'] == null ? null : (json['problemNotes'] as List<dynamic>).map((e) => ProblemNoteView.fromJson(e as Map<String, dynamic>)).toList(),
        problems: json['problems'] == null ? null : (json['problems'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        projection: json['projection'] as String,
        redirectedFrom: json['redirectedFrom'] == null ? null : json['redirectedFrom'] as String,
        reviews: (json['reviews'] as List<dynamic>).map((e) => FieldReviewView.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'aliases': aliases.map((e) => e.toJson()).toList(),
        'allergies': allergies.map((e) => e.toJson()).toList(),
        'canonicalId': canonicalId,
        'consents': consents.map((e) => e.toJson()).toList(),
        'duplicate': duplicate == null ? null : duplicate!.toJson(),
        'idLinks': idLinks.map((e) => e.toJson()).toList(),
        'mergedFrom': mergedFrom.map((e) => e.toJson()).toList(),
        'patient': patient.toJson(),
        if (problemHistory != null) 'problemHistory': problemHistory!.map((e) => e.toJson()).toList(),
        if (problemNotes != null) 'problemNotes': problemNotes!.map((e) => e.toJson()).toList(),
        if (problems != null) 'problems': problems!.map((e) => e.toJson()).toList(),
        'projection': projection,
        if (redirectedFrom != null) 'redirectedFrom': redirectedFrom!,
        'reviews': reviews.map((e) => e.toJson()).toList(),
      };
}

class PatientChartMergedFromItem {
  const PatientChartMergedFromItem({
    required this.mergeId,
    required this.mergedAt,
    required this.patientId,
  });

  final String mergeId;
  final DateTime mergedAt;
  final String patientId;

  factory PatientChartMergedFromItem.fromJson(Map<String, dynamic> json) => PatientChartMergedFromItem(
        mergeId: json['mergeId'] as String,
        mergedAt: DateTime.parse(json['mergedAt'] as String),
        patientId: json['patientId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'mergeId': mergeId,
        'mergedAt': mergedAt.toUtc().toIso8601String(),
        'patientId': patientId,
      };
}

class PatientHit {
  const PatientHit({
    required this.band,
    required this.patientId,
    required this.reasons,
    required this.score,
    required this.summary,
  });

  final MatchBand band;
  /// The canonical patient
  final String patientId;
  final List<MatchReason> reasons;
  final double score;
  final PatientSummary summary;

  factory PatientHit.fromJson(Map<String, dynamic> json) => PatientHit(
        band: MatchBand.fromJson(json['band'] as String),
        patientId: json['patientId'] as String,
        reasons: (json['reasons'] as List<dynamic>).map((e) => MatchReason.fromJson(e as String)).toList(),
        score: (json['score'] as num).toDouble(),
        summary: PatientSummary.fromJson(json['summary'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'band': band.toJson(),
        'patientId': patientId,
        'reasons': reasons.map((e) => e.toJson()).toList(),
        'score': score,
        'summary': summary.toJson(),
      };
}

class PatientMatchRequest {
  const PatientMatchRequest({
    this.aliases,
    this.birth,
    this.excludePatientId,
    this.legalName,
    this.preferredName,
    required this.surface,
  });

  final List<String>? aliases;
  final BirthInput? birth;
  /// The patient being edited
  final String? excludePatientId;
  final LegalNameInput? legalName;
  final String? preferredName;
  final Surface surface;

  factory PatientMatchRequest.fromJson(Map<String, dynamic> json) => PatientMatchRequest(
        aliases: json['aliases'] == null ? null : (json['aliases'] as List<dynamic>).map((e) => e as String).toList(),
        birth: json['birth'] == null ? null : BirthInput.fromJson(json['birth'] as Map<String, dynamic>),
        excludePatientId: json['excludePatientId'] == null ? null : json['excludePatientId'] as String,
        legalName: json['legalName'] == null ? null : LegalNameInput.fromJson(json['legalName'] as Map<String, dynamic>),
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        surface: Surface.fromJson(json['surface'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (aliases != null) 'aliases': aliases!.map((e) => e).toList(),
        if (birth != null) 'birth': birth!.toJson(),
        if (excludePatientId != null) 'excludePatientId': excludePatientId!,
        if (legalName != null) 'legalName': legalName!.toJson(),
        if (preferredName != null) 'preferredName': preferredName!,
        'surface': surface.toJson(),
      };
}

class PatientMatchResult {
  const PatientMatchResult({
    required this.candidates,
    required this.checkId,
  });

  final List<PatientHit> candidates;
  final String checkId;

  factory PatientMatchResult.fromJson(Map<String, dynamic> json) => PatientMatchResult(
        candidates: (json['candidates'] as List<dynamic>).map((e) => PatientHit.fromJson(e as Map<String, dynamic>)).toList(),
        checkId: json['checkId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'candidates': candidates.map((e) => e.toJson()).toList(),
        'checkId': checkId,
      };
}

class PatientRedirect {
  const PatientRedirect({
    required this.mergedAt,
    required this.mergedId,
    required this.survivorId,
  });

  final DateTime mergedAt;
  final String mergedId;
  final String survivorId;

  factory PatientRedirect.fromJson(Map<String, dynamic> json) => PatientRedirect(
        mergedAt: DateTime.parse(json['mergedAt'] as String),
        mergedId: json['mergedId'] as String,
        survivorId: json['survivorId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'mergedAt': mergedAt.toUtc().toIso8601String(),
        'mergedId': mergedId,
        'survivorId': survivorId,
      };
}

class PatientSearch {
  const PatientSearch({
    this.birth,
    this.limit,
    this.name,
    required this.surface,
  });

  final BirthQuery? birth;
  final int? limit;
  /// Name, street name or description
  final String? name;
  final Surface surface;

  factory PatientSearch.fromJson(Map<String, dynamic> json) => PatientSearch(
        birth: json['birth'] == null ? null : BirthQuery.fromJson(json['birth'] as Map<String, dynamic>),
        limit: json['limit'] == null ? null : (json['limit'] as num).toInt(),
        name: json['name'] == null ? null : json['name'] as String,
        surface: Surface.fromJson(json['surface'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (birth != null) 'birth': birth!.toJson(),
        if (limit != null) 'limit': limit!,
        if (name != null) 'name': name!,
        'surface': surface.toJson(),
      };
}

class PatientSearchResult {
  const PatientSearchResult({
    required this.hits,
    required this.truncated,
  });

  final List<PatientHit> hits;
  /// More matched than shown: ask for more letters or a birth year
  final bool truncated;

  factory PatientSearchResult.fromJson(Map<String, dynamic> json) => PatientSearchResult(
        hits: (json['hits'] as List<dynamic>).map((e) => PatientHit.fromJson(e as Map<String, dynamic>)).toList(),
        truncated: json['truncated'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'hits': hits.map((e) => e.toJson()).toList(),
        'truncated': truncated,
      };
}

class PatientSummary {
  const PatientSummary({
    this.ageYears,
    this.aliases,
    this.allergy,
    this.birth,
    this.duplicateHint,
    this.lastSeenOn,
    this.legalName,
    this.preferredName,
    this.usualArea,
    this.visualDescriptor,
  });

  final int? ageYears;
  final List<String>? aliases;
  final AllergySummary? allergy;
  final BirthView? birth;
  final bool? duplicateHint;
  /// A calendar date, YYYY-MM-DD
  final String? lastSeenOn;
  final LegalNameView? legalName;
  final String? preferredName;
  final String? usualArea;
  final String? visualDescriptor;

  factory PatientSummary.fromJson(Map<String, dynamic> json) => PatientSummary(
        ageYears: json['ageYears'] == null ? null : (json['ageYears'] as num).toInt(),
        aliases: json['aliases'] == null ? null : (json['aliases'] as List<dynamic>).map((e) => e as String).toList(),
        allergy: json['allergy'] == null ? null : AllergySummary.fromJson(json['allergy'] as Map<String, dynamic>),
        birth: json['birth'] == null ? null : BirthView.fromJson(json['birth'] as Map<String, dynamic>),
        duplicateHint: json['duplicateHint'] == null ? null : json['duplicateHint'] as bool,
        lastSeenOn: json['lastSeenOn'] == null ? null : json['lastSeenOn'] as String,
        legalName: json['legalName'] == null ? null : LegalNameView.fromJson(json['legalName'] as Map<String, dynamic>),
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        usualArea: json['usualArea'] == null ? null : json['usualArea'] as String,
        visualDescriptor: json['visualDescriptor'] == null ? null : json['visualDescriptor'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (ageYears != null) 'ageYears': ageYears == null ? null : ageYears!,
        if (aliases != null) 'aliases': aliases!.map((e) => e).toList(),
        if (allergy != null) 'allergy': allergy!.toJson(),
        if (birth != null) 'birth': birth == null ? null : birth!.toJson(),
        if (duplicateHint != null) 'duplicateHint': duplicateHint!,
        if (lastSeenOn != null) 'lastSeenOn': lastSeenOn == null ? null : lastSeenOn!,
        if (legalName != null) 'legalName': legalName == null ? null : legalName!.toJson(),
        if (preferredName != null) 'preferredName': preferredName == null ? null : preferredName!,
        if (usualArea != null) 'usualArea': usualArea == null ? null : usualArea!,
        if (visualDescriptor != null) 'visualDescriptor': visualDescriptor == null ? null : visualDescriptor!,
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

class ProblemNoteView {
  const ProblemNoteView({
    required this.author,
    required this.encounterId,
    required this.id,
    required this.problemId,
    required this.text,
    required this.writtenAt,
  });

  final UserRef author;
  final String? encounterId;
  final String id;
  final String problemId;
  final String text;
  final DateTime writtenAt;

  factory ProblemNoteView.fromJson(Map<String, dynamic> json) => ProblemNoteView(
        author: UserRef.fromJson(json['author'] as Map<String, dynamic>),
        encounterId: json['encounterId'] == null ? null : json['encounterId'] as String,
        id: json['id'] as String,
        problemId: json['problemId'] as String,
        text: json['text'] as String,
        writtenAt: DateTime.parse(json['writtenAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'author': author.toJson(),
        'encounterId': encounterId == null ? null : encounterId!,
        'id': id,
        'problemId': problemId,
        'text': text,
        'writtenAt': writtenAt.toUtc().toIso8601String(),
      };
}

class ProblemStatusEvent {
  const ProblemStatusEvent({
    required this.at,
    required this.by,
    required this.encounterId,
    required this.historyId,
    required this.kind,
    required this.problemId,
    required this.status,
  });

  final DateTime at;
  final UserRef by;
  final String? encounterId;
  /// A field history entry
  final String historyId;
  final HistoryKind kind;
  final String problemId;
  final ProblemStatus status;

  factory ProblemStatusEvent.fromJson(Map<String, dynamic> json) => ProblemStatusEvent(
        at: DateTime.parse(json['at'] as String),
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        encounterId: json['encounterId'] == null ? null : json['encounterId'] as String,
        historyId: json['historyId'] as String,
        kind: HistoryKind.fromJson(json['kind'] as String),
        problemId: json['problemId'] as String,
        status: ProblemStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'by': by.toJson(),
        'encounterId': encounterId == null ? null : encounterId!,
        'historyId': historyId,
        'kind': kind.toJson(),
        'problemId': problemId,
        'status': status.toJson(),
      };
}

class ProblemView {
  const ProblemView({
    required this.author,
    required this.code,
    required this.codeDisplay,
    required this.createdAt,
    required this.enteredInError,
    required this.id,
    required this.mergedInto,
    required this.notes,
    required this.patientId,
    required this.recurrenceOf,
    required this.resolvedInErrorOf,
    required this.reversalRequest,
    required this.sensitive,
    required this.status,
    required this.statusHistory,
    required this.title,
  });

  final UserRef author;
  final String? code;
  final String? codeDisplay;
  final DateTime createdAt;
  final ProblemViewEnteredInError? enteredInError;
  final String id;
  final String? mergedInto;
  final List<ProblemNoteView> notes;
  final String patientId;
  final String? recurrenceOf;
  final String? resolvedInErrorOf;
  final String? reversalRequest;
  final bool sensitive;
  final ProblemStatus status;
  final List<ProblemStatusEvent> statusHistory;
  final String title;

  factory ProblemView.fromJson(Map<String, dynamic> json) => ProblemView(
        author: UserRef.fromJson(json['author'] as Map<String, dynamic>),
        code: json['code'] == null ? null : json['code'] as String,
        codeDisplay: json['codeDisplay'] == null ? null : json['codeDisplay'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        enteredInError: json['enteredInError'] == null ? null : ProblemViewEnteredInError.fromJson(json['enteredInError'] as Map<String, dynamic>),
        id: json['id'] as String,
        mergedInto: json['mergedInto'] == null ? null : json['mergedInto'] as String,
        notes: (json['notes'] as List<dynamic>).map((e) => ProblemNoteView.fromJson(e as Map<String, dynamic>)).toList(),
        patientId: json['patientId'] as String,
        recurrenceOf: json['recurrenceOf'] == null ? null : json['recurrenceOf'] as String,
        resolvedInErrorOf: json['resolvedInErrorOf'] == null ? null : json['resolvedInErrorOf'] as String,
        reversalRequest: json['reversalRequest'] == null ? null : json['reversalRequest'] as String,
        sensitive: json['sensitive'] as bool,
        status: ProblemStatus.fromJson(json['status'] as String),
        statusHistory: (json['statusHistory'] as List<dynamic>).map((e) => ProblemStatusEvent.fromJson(e as Map<String, dynamic>)).toList(),
        title: json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'author': author.toJson(),
        'code': code == null ? null : code!,
        'codeDisplay': codeDisplay == null ? null : codeDisplay!,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'enteredInError': enteredInError == null ? null : enteredInError!.toJson(),
        'id': id,
        'mergedInto': mergedInto == null ? null : mergedInto!,
        'notes': notes.map((e) => e.toJson()).toList(),
        'patientId': patientId,
        'recurrenceOf': recurrenceOf == null ? null : recurrenceOf!,
        'resolvedInErrorOf': resolvedInErrorOf == null ? null : resolvedInErrorOf!,
        'reversalRequest': reversalRequest == null ? null : reversalRequest!,
        'sensitive': sensitive,
        'status': status.toJson(),
        'statusHistory': statusHistory.map((e) => e.toJson()).toList(),
        'title': title,
      };
}

class ProblemViewEnteredInError {
  const ProblemViewEnteredInError({
    required this.at,
    required this.by,
    required this.reason,
  });

  final DateTime at;
  final UserRef by;
  final String reason;

  factory ProblemViewEnteredInError.fromJson(Map<String, dynamic> json) => ProblemViewEnteredInError(
        at: DateTime.parse(json['at'] as String),
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'by': by.toJson(),
        'reason': reason,
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

class ReversalRequestPage {
  const ReversalRequestPage({
    required this.nextAfterId,
    required this.requests,
  });

  /// Pass as afterId for the next page; null on the last
  final String? nextAfterId;
  final List<ReversalRequestPageRequestsItem> requests;

  factory ReversalRequestPage.fromJson(Map<String, dynamic> json) => ReversalRequestPage(
        nextAfterId: json['nextAfterId'] == null ? null : json['nextAfterId'] as String,
        requests: (json['requests'] as List<dynamic>).map((e) => ReversalRequestPageRequestsItem.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'nextAfterId': nextAfterId == null ? null : nextAfterId!,
        'requests': requests.map((e) => e.toJson()).toList(),
      };
}

class ReversalRequestPageRequestsItem {
  const ReversalRequestPageRequestsItem({
    required this.original,
    required this.patient,
    required this.patientId,
    required this.request,
    required this.requestedAt,
    required this.requestedBy,
  });

  final ProblemView original;
  final PatientSummary patient;
  final String patientId;
  final ProblemView request;
  final DateTime requestedAt;
  final UserRef requestedBy;

  factory ReversalRequestPageRequestsItem.fromJson(Map<String, dynamic> json) => ReversalRequestPageRequestsItem(
        original: ProblemView.fromJson(json['original'] as Map<String, dynamic>),
        patient: PatientSummary.fromJson(json['patient'] as Map<String, dynamic>),
        patientId: json['patientId'] as String,
        request: ProblemView.fromJson(json['request'] as Map<String, dynamic>),
        requestedAt: DateTime.parse(json['requestedAt'] as String),
        requestedBy: UserRef.fromJson(json['requestedBy'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'original': original.toJson(),
        'patient': patient.toJson(),
        'patientId': patientId,
        'request': request.toJson(),
        'requestedAt': requestedAt.toUtc().toIso8601String(),
        'requestedBy': requestedBy.toJson(),
      };
}

class ReverseResolved {
  const ReverseResolved({
    required this.reason,
    this.requestProblemId,
  });

  /// Why, in a few words. Logged.
  final String reason;
  /// The "Resolved by mistake" entry this answers
  final String? requestProblemId;

  factory ReverseResolved.fromJson(Map<String, dynamic> json) => ReverseResolved(
        reason: json['reason'] as String,
        requestProblemId: json['requestProblemId'] == null ? null : json['requestProblemId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
        if (requestProblemId != null) 'requestProblemId': requestProblemId!,
      };
}

class ReverseResolvedResult {
  const ReverseResolvedResult({
    required this.mergeCandidates,
    required this.problem,
  });

  /// New or Ongoing entries added since, with the same code or title; the request first
  final List<ProblemView> mergeCandidates;
  final ProblemView problem;

  factory ReverseResolvedResult.fromJson(Map<String, dynamic> json) => ReverseResolvedResult(
        mergeCandidates: (json['mergeCandidates'] as List<dynamic>).map((e) => ProblemView.fromJson(e as Map<String, dynamic>)).toList(),
        problem: ProblemView.fromJson(json['problem'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'mergeCandidates': mergeCandidates.map((e) => e.toJson()).toList(),
        'problem': problem.toJson(),
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

class TeamIndexPage {
  const TeamIndexPage({
    required this.entries,
    required this.generatedAt,
    required this.next,
    required this.projection,
    required this.redirects,
    required this.status,
    required this.version,
  });

  final List<IndexEntry> entries;
  final DateTime generatedAt;
  final String? next;
  final String projection;
  /// First page only: the team’s complete list
  final List<PatientRedirect> redirects;
  final TeamIndexPageStatus status;
  final String version;

  factory TeamIndexPage.fromJson(Map<String, dynamic> json) => TeamIndexPage(
        entries: (json['entries'] as List<dynamic>).map((e) => IndexEntry.fromJson(e as Map<String, dynamic>)).toList(),
        generatedAt: DateTime.parse(json['generatedAt'] as String),
        next: json['next'] == null ? null : json['next'] as String,
        projection: json['projection'] as String,
        redirects: (json['redirects'] as List<dynamic>).map((e) => PatientRedirect.fromJson(e as Map<String, dynamic>)).toList(),
        status: TeamIndexPageStatus.fromJson(json['status'] as String),
        version: json['version'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'entries': entries.map((e) => e.toJson()).toList(),
        'generatedAt': generatedAt.toUtc().toIso8601String(),
        'next': next == null ? null : next!,
        'projection': projection,
        'redirects': redirects.map((e) => e.toJson()).toList(),
        'status': status.toJson(),
        'version': version,
      };
}

class TeamIndexRequest {
  const TeamIndexRequest({
    this.after,
    this.have,
    this.limit,
  });

  /// The previous page’s next
  final String? after;
  /// The version this phone holds
  final String? have;
  final int? limit;

  factory TeamIndexRequest.fromJson(Map<String, dynamic> json) => TeamIndexRequest(
        after: json['after'] == null ? null : json['after'] as String,
        have: json['have'] == null ? null : json['have'] as String,
        limit: json['limit'] == null ? null : (json['limit'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (after != null) 'after': after!,
        if (have != null) 'have': have!,
        if (limit != null) 'limit': limit!,
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

class UndoMerge {
  const UndoMerge({
    required this.comment,
  });

  /// Why, in a few words. Logged.
  final String comment;

  factory UndoMerge.fromJson(Map<String, dynamic> json) => UndoMerge(
        comment: json['comment'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'comment': comment,
      };
}

class UndoMergeResult {
  const UndoMergeResult({
    required this.keptFields,
    required this.linksIssuedWhileMerged,
    required this.merge,
    required this.redirectedEdits,
    required this.restoredLinks,
    required this.revertedFields,
    required this.reviewsClosed,
  });

  final List<String> keptFields;
  final List<UndoMergeResultLinksIssuedWhileMergedItem> linksIssuedWhileMerged;
  final MergeView merge;
  /// Edits sent to the merged record and applied to the survivor: move by hand
  final List<UndoMergeResultRedirectedEditsItem> redirectedEdits;
  final List<UndoMergeResultRestoredLinksItem> restoredLinks;
  final List<String> revertedFields;
  final int reviewsClosed;

  factory UndoMergeResult.fromJson(Map<String, dynamic> json) => UndoMergeResult(
        keptFields: (json['keptFields'] as List<dynamic>).map((e) => e as String).toList(),
        linksIssuedWhileMerged: (json['linksIssuedWhileMerged'] as List<dynamic>).map((e) => UndoMergeResultLinksIssuedWhileMergedItem.fromJson(e as Map<String, dynamic>)).toList(),
        merge: MergeView.fromJson(json['merge'] as Map<String, dynamic>),
        redirectedEdits: (json['redirectedEdits'] as List<dynamic>).map((e) => UndoMergeResultRedirectedEditsItem.fromJson(e as Map<String, dynamic>)).toList(),
        restoredLinks: (json['restoredLinks'] as List<dynamic>).map((e) => UndoMergeResultRestoredLinksItem.fromJson(e as Map<String, dynamic>)).toList(),
        revertedFields: (json['revertedFields'] as List<dynamic>).map((e) => e as String).toList(),
        reviewsClosed: (json['reviewsClosed'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'keptFields': keptFields.map((e) => e).toList(),
        'linksIssuedWhileMerged': linksIssuedWhileMerged.map((e) => e.toJson()).toList(),
        'merge': merge.toJson(),
        'redirectedEdits': redirectedEdits.map((e) => e.toJson()).toList(),
        'restoredLinks': restoredLinks.map((e) => e.toJson()).toList(),
        'revertedFields': revertedFields.map((e) => e).toList(),
        'reviewsClosed': reviewsClosed,
      };
}

class UndoMergeResultLinksIssuedWhileMergedItem {
  const UndoMergeResultLinksIssuedWhileMergedItem({
    required this.effectiveAt,
    required this.issuedOn,
    required this.linkId,
    required this.reason,
    required this.tokenRef,
  });

  final DateTime effectiveAt;
  final String issuedOn;
  final String linkId;
  final IdLinkReason reason;
  final String tokenRef;

  factory UndoMergeResultLinksIssuedWhileMergedItem.fromJson(Map<String, dynamic> json) => UndoMergeResultLinksIssuedWhileMergedItem(
        effectiveAt: DateTime.parse(json['effectiveAt'] as String),
        issuedOn: json['issuedOn'] as String,
        linkId: json['linkId'] as String,
        reason: IdLinkReason.fromJson(json['reason'] as String),
        tokenRef: json['tokenRef'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'effectiveAt': effectiveAt.toUtc().toIso8601String(),
        'issuedOn': issuedOn,
        'linkId': linkId,
        'reason': reason.toJson(),
        'tokenRef': tokenRef,
      };
}

class UndoMergeResultRedirectedEditsItem {
  const UndoMergeResultRedirectedEditsItem({
    required this.at,
    required this.by,
    required this.field,
    required this.historyId,
  });

  final DateTime at;
  final UserRef by;
  final String field;
  /// A field history entry
  final String historyId;

  factory UndoMergeResultRedirectedEditsItem.fromJson(Map<String, dynamic> json) => UndoMergeResultRedirectedEditsItem(
        at: DateTime.parse(json['at'] as String),
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        field: json['field'] as String,
        historyId: json['historyId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'by': by.toJson(),
        'field': field,
        'historyId': historyId,
      };
}

class UndoMergeResultRestoredLinksItem {
  const UndoMergeResultRestoredLinksItem({
    required this.issuedOn,
    required this.linkId,
    required this.tokenRef,
  });

  final String issuedOn;
  final String linkId;
  final String tokenRef;

  factory UndoMergeResultRestoredLinksItem.fromJson(Map<String, dynamic> json) => UndoMergeResultRestoredLinksItem(
        issuedOn: json['issuedOn'] as String,
        linkId: json['linkId'] as String,
        tokenRef: json['tokenRef'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'issuedOn': issuedOn,
        'linkId': linkId,
        'tokenRef': tokenRef,
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

  /// Correct a legal name or birth date with a reason, or record a declined amendment request
  Future<PatientChart> correctIdentity({required String patientId, required IdentityCorrection body}) async {
    final json = await _transport.send('POST', '/v1/patients/${Uri.encodeComponent(patientId)}/corrections', body: body.toJson());
    return PatientChart.fromJson(json as Map<String, dynamic>);
  }

  /// Create a custom role from existing permissions
  Future<Role> createRole({required RoleInput body}) async {
    final json = await _transport.send('POST', '/v1/team/roles', body: body.toJson());
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Merge, keep separate or not sure, with a comment
  Future<DuplicateDecisionResult> decideDuplicate({required String pairId, required DecideDuplicate body}) async {
    final json = await _transport.send('POST', '/v1/team/duplicates/${Uri.encodeComponent(pairId)}/decision', body: body.toJson());
    return DuplicateDecisionResult.fromJson(json as Map<String, dynamic>);
  }

  /// Keep the chart’s value or an alternate. Legal name and birth date need an admin and a comment.
  Future<FieldReviewView> decideFieldReview({required String reviewId, required DecideFieldReview body}) async {
    final json = await _transport.send('POST', '/v1/team/field-reviews/${Uri.encodeComponent(reviewId)}/decision', body: body.toJson());
    return FieldReviewView.fromJson(json as Map<String, dynamic>);
  }

  /// Accept a quarantined change onto the chart, or reject it with a reason
  Future<Ok> decideQuarantine({required String itemId, required DecideQuarantine body}) async {
    final json = await _transport.send('POST', '/v1/team/quarantine/${Uri.encodeComponent(itemId)}/decision', body: body.toJson());
    return Ok.fromJson(json as Map<String, dynamic>);
  }

  /// Decline a request with a reason; the entry stays a separate problem
  Future<ProblemView> declineProblemReversal({required String problemId, required DeclineReversal body}) async {
    final json = await _transport.send('POST', '/v1/team/problem-reversals/${Uri.encodeComponent(problemId)}/decline', body: body.toJson());
    return ProblemView.fromJson(json as Map<String, dynamic>);
  }

  /// Whether this phone must wipe, and whether its user still has access
  Future<DeviceStatusResult> deviceStatus({required String deviceId, required SignedStatus body}) async {
    final json = await _transport.send('POST', '/v1/devices/${Uri.encodeComponent(deviceId)}/status', body: body.toJson());
    return DeviceStatusResult.fromJson(json as Map<String, dynamic>);
  }

  /// The team search index for a phone, a page at a time. Field roles only. Gzipped.
  Future<TeamIndexPage> downloadTeamIndex({required TeamIndexRequest body}) async {
    final json = await _transport.send('POST', '/v1/patients/index', body: body.toJson());
    return TeamIndexPage.fromJson(json as Map<String, dynamic>);
  }

  /// Charts for the phone’s 24-hour cache, with every redirect that touches them. Gzipped.
  Future<ChartBundle> fetchCharts({required FetchCharts body}) async {
    final json = await _transport.send('POST', '/v1/patients/charts', body: body.toJson());
    return ChartBundle.fromJson(json as Map<String, dynamic>);
  }

  /// The server’s copy of records, with each field’s version, for records a phone holds open
  Future<FetchRecordsResult> fetchRecords({required FetchRecords body}) async {
    final json = await _transport.send('POST', '/v1/sync/records', body: body.toJson());
    return FetchRecordsResult.fromJson(json as Map<String, dynamic>);
  }

  /// Report two charts that are the same person, for a reviewer to decide
  Future<DuplicatePairSummary> flagDuplicate({required FlagDuplicate body}) async {
    final json = await _transport.send('POST', '/v1/team/duplicates', body: body.toJson());
    return DuplicatePairSummary.fromJson(json as Map<String, dynamic>);
  }

  /// Both charts of a pair side by side, with what matched and earlier decisions
  Future<DuplicatePairDetail> getDuplicatePair({required String pairId}) async {
    final json = await _transport.send('GET', '/v1/team/duplicates/${Uri.encodeComponent(pairId)}');
    return DuplicatePairDetail.fromJson(json as Map<String, dynamic>);
  }

  /// Liveness, database reachability and whether this is a demo deployment
  Future<Health> getHealth() async {
    final json = await _transport.send('GET', '/v1/health');
    return Health.fromJson(json as Map<String, dynamic>);
  }

  /// The patient’s Street Medicine ID cards: active links with their URLs, and history
  Future<IdLinkState> getIdLinks({required String patientId}) async {
    final json = await _transport.send('GET', '/v1/patients/${Uri.encodeComponent(patientId)}/id-link');
    return IdLinkState.fromJson(json as Map<String, dynamic>);
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

  /// A patient’s chart, as the role may see it. A merged ID answers the kept chart.
  Future<PatientChart> getPatient({required String patientId}) async {
    final json = await _transport.send('GET', '/v1/patients/${Uri.encodeComponent(patientId)}');
    return PatientChart.fromJson(json as Map<String, dynamic>);
  }

  /// Every recorded value of the chart’s fields, old and new, with who and how
  Future<FieldHistoryPage> getPatientHistory({required String patientId, String? field, String? afterId}) async {
    final json = await _transport.send('GET', '/v1/patients/${Uri.encodeComponent(patientId)}/history', query: <String, String>{if (field != null) 'field': (field).toString(), if (afterId != null) 'afterId': (afterId).toString()}, );
    return FieldHistoryPage.fromJson(json as Map<String, dynamic>);
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

  /// Make a new card. Every active card of the patient stops working.
  Future<IdLinkState> issueIdLink({required String patientId, required IssueIdLink body}) async {
    final json = await _transport.send('POST', '/v1/patients/${Uri.encodeComponent(patientId)}/id-link', body: body.toJson());
    return IdLinkState.fromJson(json as Map<String, dynamic>);
  }

  /// Every phone on the team, with sync status, clock flag and unsynced counts
  Future<List<TeamDevice>> listDevices() async {
    final json = await _transport.send('GET', '/v1/team/devices');
    return (json as List<dynamic>).map((e) => TeamDevice.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Pairs of charts that may be the same person, oldest flagged first
  Future<DuplicatePage> listDuplicates({ListDuplicatesStatus? status, String? afterId}) async {
    final json = await _transport.send('GET', '/v1/team/duplicates', query: <String, String>{if (status != null) 'status': (status.toJson()).toString(), if (afterId != null) 'afterId': (afterId).toString()}, );
    return DuplicatePage.fromJson(json as Map<String, dynamic>);
  }

  /// Fields where two values were recorded, that the signed-in person may decide
  Future<FieldReviewPage> listFieldReviews({ListFieldReviewsStatus? status, String? afterId}) async {
    final json = await _transport.send('GET', '/v1/team/field-reviews', query: <String, String>{if (status != null) 'status': (status.toJson()).toString(), if (afterId != null) 'afterId': (afterId).toString()}, );
    return FieldReviewPage.fromJson(json as Map<String, dynamic>);
  }

  /// Everyone on the team, active and removed
  Future<List<Member>> listMembers() async {
    final json = await _transport.send('GET', '/v1/team/members');
    return (json as List<dynamic>).map((e) => Member.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Recent merges, newest first
  Future<MergePage> listMerges({String? afterId}) async {
    final json = await _transport.send('GET', '/v1/team/merges', query: <String, String>{if (afterId != null) 'afterId': (afterId).toString()}, );
    return MergePage.fromJson(json as Map<String, dynamic>);
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

  /// Problems staff marked Resolved by mistake, waiting for an admin
  Future<ReversalRequestPage> listProblemReversals({String? afterId}) async {
    final json = await _transport.send('GET', '/v1/team/problem-reversals', query: <String, String>{if (afterId != null) 'afterId': (afterId).toString()}, );
    return ReversalRequestPage.fromJson(json as Map<String, dynamic>);
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

  /// Patients who may be the person being registered, before the chart is created
  Future<PatientMatchResult> matchPatients({required PatientMatchRequest body}) async {
    final json = await _transport.send('POST', '/v1/patients/match', body: body.toJson());
    return PatientMatchResult.fromJson(json as Map<String, dynamic>);
  }

  /// Merge this entry into another; both histories and notes stay
  Future<ProblemView> mergeProblems({required String problemId, required MergeProblems body}) async {
    final json = await _transport.send('POST', '/v1/problems/${Uri.encodeComponent(problemId)}/merge', body: body.toJson());
    return ProblemView.fromJson(json as Map<String, dynamic>);
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

  /// Set a Resolved problem back to Ongoing, with a reason; then offers entries to merge into it
  Future<ReverseResolvedResult> reverseResolvedProblem({required String problemId, required ReverseResolved body}) async {
    final json = await _transport.send('POST', '/v1/problems/${Uri.encodeComponent(problemId)}/reverse', body: body.toJson());
    return ReverseResolvedResult.fromJson(json as Map<String, dynamic>);
  }

  /// Search the audit log by person, patient, action and time. The search itself is logged.
  Future<AuditPage> searchAudit({required AuditSearch body}) async {
    final json = await _transport.send('POST', '/v1/team/audit/search', body: body.toJson());
    return AuditPage.fromJson(json as Map<String, dynamic>);
  }

  /// Find patients by name, street name, description or birth date. Logged with the patients shown.
  Future<PatientSearchResult> searchPatients({required PatientSearch body}) async {
    final json = await _transport.send('POST', '/v1/patients/search', body: body.toJson());
    return PatientSearchResult.fromJson(json as Map<String, dynamic>);
  }

  /// Send change entries; get a receipt for each (accepted with hash, rejected with reason, or conflict)
  Future<SyncPushResult> syncPush({required SyncPush body}) async {
    final json = await _transport.send('POST', '/v1/sync/push', body: body.toJson());
    return SyncPushResult.fromJson(json as Map<String, dynamic>);
  }

  /// Undo a merge, with a comment. Each chart gets its own ID cards back.
  Future<UndoMergeResult> undoMerge({required String mergeId, required UndoMerge body}) async {
    final json = await _transport.send('POST', '/v1/team/merges/${Uri.encodeComponent(mergeId)}/undo', body: body.toJson());
    return UndoMergeResult.fromJson(json as Map<String, dynamic>);
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
