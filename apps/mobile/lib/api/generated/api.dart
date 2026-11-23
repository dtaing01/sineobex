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
  noteSignoff('note_signoff'),
  noteAddendum('note_addendum'),
  noteCorrection('note_correction'),
  referral('referral'),
  patientFlagChange('patient_flag_change'),

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

enum CorrectionViewOutcome {
  corrected('corrected'),
  declined('declined'),
  noChange('no_change'),
  draftEdit('draft_edit'),
  notAuthor('not_author'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const CorrectionViewOutcome(this.wire);
  final String wire;

  static CorrectionViewOutcome fromJson(String value) =>
      CorrectionViewOutcome.values.firstWhere((e) => e.wire == value, orElse: () => CorrectionViewOutcome.unknown);

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

enum EncounterKind {
  medical('medical'),
  nonMedical('non_medical'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const EncounterKind(this.wire);
  final String wire;

  static EncounterKind fromJson(String value) =>
      EncounterKind.values.firstWhere((e) => e.wire == value, orElse: () => EncounterKind.unknown);

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

enum FlagColor {
  red('red'),
  orange('orange'),
  yellow('yellow'),
  green('green'),
  teal('teal'),
  blue('blue'),
  purple('purple'),
  grey('grey'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const FlagColor(this.wire);
  final String wire;

  static FlagColor fromJson(String value) =>
      FlagColor.values.firstWhere((e) => e.wire == value, orElse: () => FlagColor.unknown);

  String toJson() => wire;
}

enum FlagHistoryRowAction {
  setValue('set'),
  clear('clear'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const FlagHistoryRowAction(this.wire);
  final String wire;

  static FlagHistoryRowAction fromJson(String value) =>
      FlagHistoryRowAction.values.firstWhere((e) => e.wire == value, orElse: () => FlagHistoryRowAction.unknown);

  String toJson() => wire;
}

/// primary: the risk level, one at a time; secondary: conditions
enum FlagTier {
  primary('primary'),
  secondary('secondary'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const FlagTier(this.wire);
  final String wire;

  static FlagTier fromJson(String value) =>
      FlagTier.values.firstWhere((e) => e.wire == value, orElse: () => FlagTier.unknown);

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

/// merged_name: the preferred name of a record merged into this one. Not a street name record
enum IndexEntryAliasesItemKind {
  alias('alias'),
  mergedName('merged_name'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const IndexEntryAliasesItemKind(this.wire);
  final String wire;

  static IndexEntryAliasesItemKind fromJson(String value) =>
      IndexEntryAliasesItemKind.values.firstWhere((e) => e.wire == value, orElse: () => IndexEntryAliasesItemKind.unknown);

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

enum NoteAttestation {
  notNeeded('not_needed'),
  waiting('waiting'),
  attested('attested'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const NoteAttestation(this.wire);
  final String wire;

  static NoteAttestation fromJson(String value) =>
      NoteAttestation.values.firstWhere((e) => e.wire == value, orElse: () => NoteAttestation.unknown);

  String toJson() => wire;
}

/// Why a note that waits for a co-signature or an attestation waits for someone other than the reader: they wrote it, act as its author (assigned to them), completed it, made its current signature, or cannot see every answer that counts. Given whenever the act’s first refusal of the reader is about the note, whatever their credential. Absent when the note waits for nothing, the reader may act, the first refusal is about their credential, or their role does not chart
enum NoteHeldBecause {
  wrote('wrote'),
  actsAsAuthor('acts_as_author'),
  completed('completed'),
  signed('signed'),
  cannotSeeAll('cannot_see_all'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const NoteHeldBecause(this.wire);
  final String wire;

  static NoteHeldBecause fromJson(String value) =>
      NoteHeldBecause.values.firstWhere((e) => e.wire == value, orElse: () => NoteHeldBecause.unknown);

  String toJson() => wire;
}

enum NoteStatus {
  draft('draft'),
  completed('completed'),
  signed('signed'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const NoteStatus(this.wire);
  final String wire;

  static NoteStatus fromJson(String value) =>
      NoteStatus.values.firstWhere((e) => e.wire == value, orElse: () => NoteStatus.unknown);

  String toJson() => wire;
}

enum NoteTypeEntryKindsItem {
  medical('medical'),
  nonMedical('non_medical'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const NoteTypeEntryKindsItem(this.wire);
  final String wire;

  static NoteTypeEntryKindsItem fromJson(String value) =>
      NoteTypeEntryKindsItem.values.firstWhere((e) => e.wire == value, orElse: () => NoteTypeEntryKindsItem.unknown);

  String toJson() => wire;
}

/// `sensitive` needs patients.view_sensitive to read
enum NoteTypeEntrySensitivity {
  none('none'),
  sensitive('sensitive'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const NoteTypeEntrySensitivity(this.wire);
  final String wire;

  static NoteTypeEntrySensitivity fromJson(String value) =>
      NoteTypeEntrySensitivity.values.firstWhere((e) => e.wire == value, orElse: () => NoteTypeEntrySensitivity.unknown);

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

/// installed and platform_updated are the platform installer’s; every other act is a person’s
enum PresetEventAct {
  created('created'),
  updated('updated'),
  archived('archived'),
  restored('restored'),
  updateTaken('update_taken'),
  reordered('reordered'),
  installed('installed'),
  platformUpdated('platform_updated'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PresetEventAct(this.wire);
  final String wire;

  static PresetEventAct fromJson(String value) =>
      PresetEventAct.values.firstWhere((e) => e.wire == value, orElse: () => PresetEventAct.unknown);

  String toJson() => wire;
}

/// Whose version it is: the team’s, or the platform’s, installed or taken by a person
enum PresetEventSource {
  team('team'),
  platform('platform'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PresetEventSource(this.wire);
  final String wire;

  static PresetEventSource fromJson(String value) =>
      PresetEventSource.values.firstWhere((e) => e.wire == value, orElse: () => PresetEventSource.unknown);

  String toJson() => wire;
}

/// An archived preset is offered for no new work
enum PresetViewState {
  active('active'),
  archived('archived'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PresetViewState(this.wire);
  final String wire;

  static PresetViewState fromJson(String value) =>
      PresetViewState.values.firstWhere((e) => e.wire == value, orElse: () => PresetViewState.unknown);

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

/// A phone skips a kind it does not know
enum PulledPresetKind {
  orderCategory('order_category'),
  item('item'),
  bundle('bundle'),
  flag('flag'),
  fieldSupplyMap('field_supply_map'),
  conditionSupplyMap('condition_supply_map'),
  bag('bag'),
  settings('settings'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PulledPresetKind(this.wire);
  final String wire;

  static PulledPresetKind fromJson(String value) =>
      PulledPresetKind.values.firstWhere((e) => e.wire == value, orElse: () => PulledPresetKind.unknown);

  String toJson() => wire;
}

/// An archived preset is kept for its name
enum PulledPresetState {
  active('active'),
  archived('archived'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const PulledPresetState(this.wire);
  final String wire;

  static PulledPresetState fromJson(String value) =>
      PulledPresetState.values.firstWhere((e) => e.wire == value, orElse: () => PulledPresetState.unknown);

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
  noteSignoff('note_signoff'),
  noteAddendum('note_addendum'),
  noteCorrection('note_correction'),
  referral('referral'),
  patientFlagChange('patient_flag_change'),

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

/// The risk level (primary) or the conditions (secondary)
enum ReorderFlagsTier {
  primary('primary'),
  secondary('secondary'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const ReorderFlagsTier(this.wire);
  final String wire;

  static ReorderFlagsTier fromJson(String value) =>
      ReorderFlagsTier.values.firstWhere((e) => e.wire == value, orElse: () => ReorderFlagsTier.unknown);

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

enum SetPatientFlagAction {
  setValue('set'),
  clear('clear'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SetPatientFlagAction(this.wire);
  final String wire;

  static SetPatientFlagAction fromJson(String value) =>
      SetPatientFlagAction.values.firstWhere((e) => e.wire == value, orElse: () => SetPatientFlagAction.unknown);

  String toJson() => wire;
}

enum SignoffViewAct {
  complete('complete'),
  sign('sign'),
  cosign('cosign'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SignoffViewAct(this.wire);
  final String wire;

  static SignoffViewAct fromJson(String value) =>
      SignoffViewAct.values.firstWhere((e) => e.wire == value, orElse: () => SignoffViewAct.unknown);

  String toJson() => wire;
}

enum SignoffViewEffect {
  signed('signed'),
  completed('completed'),
  savedUnsigned('saved_unsigned'),
  none('none'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const SignoffViewEffect(this.wire);
  final String wire;

  static SignoffViewEffect fromJson(String value) =>
      SignoffViewEffect.values.firstWhere((e) => e.wire == value, orElse: () => SignoffViewEffect.unknown);

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

/// The note type’s timeline filter (forms 2.2)
enum TimelineGroup {
  clinical('clinical'),
  psych('psych'),
  social('social'),
  outreach('outreach'),
  harmReduction('harm_reduction'),
  wound('wound'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const TimelineGroup(this.wire);
  final String wire;

  static TimelineGroup fromJson(String value) =>
      TimelineGroup.values.firstWhere((e) => e.wire == value, orElse: () => TimelineGroup.unknown);

  String toJson() => wire;
}

/// applied: written to the kept chart; kept_both: offered in a review there (taken out by the undo); history_only: kept in its history
enum UndoMergeResultRedirectedEditsItemOutcome {
  applied('applied'),
  keptBoth('kept_both'),
  historyOnly('history_only'),

  /// A value this app version does not know yet. Kept so a newer server never breaks decoding.
  unknown('');

  const UndoMergeResultRedirectedEditsItemOutcome(this.wire);
  final String wire;

  static UndoMergeResultRedirectedEditsItemOutcome fromJson(String value) =>
      UndoMergeResultRedirectedEditsItemOutcome.values.firstWhere((e) => e.wire == value, orElse: () => UndoMergeResultRedirectedEditsItemOutcome.unknown);

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

class AddendumView {
  const AddendumView({
    required this.author,
    required this.clockVerified,
    required this.credential,
    required this.id,
    required this.noteId,
    required this.text,
    required this.writtenAt,
  });

  final UserRef author;
  final bool clockVerified;
  final Credential credential;
  final String id;
  final String? noteId;
  final String text;
  final DateTime writtenAt;

  factory AddendumView.fromJson(Map<String, dynamic> json) => AddendumView(
        author: UserRef.fromJson(json['author'] as Map<String, dynamic>),
        clockVerified: json['clockVerified'] as bool,
        credential: Credential.fromJson(json['credential'] as String),
        id: json['id'] as String,
        noteId: json['noteId'] == null ? null : json['noteId'] as String,
        text: json['text'] as String,
        writtenAt: DateTime.parse(json['writtenAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'author': author.toJson(),
        'clockVerified': clockVerified,
        'credential': credential.toJson(),
        'id': id,
        'noteId': noteId == null ? null : noteId!,
        'text': text,
        'writtenAt': writtenAt.toUtc().toIso8601String(),
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

class ArchivePreset {
  const ArchivePreset({
    required this.baseVersion,
    required this.reason,
  });

  /// The version you opened: any other is refused as stale, with the current one
  final int baseVersion;
  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;

  factory ArchivePreset.fromJson(Map<String, dynamic> json) => ArchivePreset(
        baseVersion: (json['baseVersion'] as num).toInt(),
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'baseVersion': baseVersion,
        'reason': reason,
      };
}

class AssignInput {
  const AssignInput({
    required this.reason,
    required this.toUserId,
  });

  /// Why, in a few words. Logged.
  final String reason;
  /// The clinician who will act as the note’s author
  final String toUserId;

  factory AssignInput.fromJson(Map<String, dynamic> json) => AssignInput(
        reason: json['reason'] as String,
        toUserId: json['toUserId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
        'toUserId': toUserId,
      };
}

class AttestationView {
  const AttestationView({
    required this.attending,
    required this.attestedAt,
    required this.id,
    required this.signoffId,
    required this.statementVersion,
  });

  final UserRef attending;
  final DateTime attestedAt;
  final String id;
  final String signoffId;
  final String statementVersion;

  factory AttestationView.fromJson(Map<String, dynamic> json) => AttestationView(
        attending: UserRef.fromJson(json['attending'] as Map<String, dynamic>),
        attestedAt: DateTime.parse(json['attestedAt'] as String),
        id: json['id'] as String,
        signoffId: json['signoffId'] as String,
        statementVersion: json['statementVersion'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'attending': attending.toJson(),
        'attestedAt': attestedAt.toUtc().toIso8601String(),
        'id': id,
        'signoffId': signoffId,
        'statementVersion': statementVersion,
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

/// A flag as the team holds it now
class ChartFlag {
  const ChartFlag({
    required this.archived,
    required this.color,
    required this.colorName,
    required this.flagId,
    required this.name,
    required this.rank,
    required this.tier,
  });

  /// No longer on the team’s list: it stays on the patient, and is never offered to be set
  final bool archived;
  final FlagColor color;
  /// The colour’s plain name, shown before the flag’s own
  final String colorName;
  final String flagId;
  final String name;
  final int rank;
  final FlagTier tier;

  factory ChartFlag.fromJson(Map<String, dynamic> json) => ChartFlag(
        archived: json['archived'] as bool,
        color: FlagColor.fromJson(json['color'] as String),
        colorName: json['colorName'] as String,
        flagId: json['flagId'] as String,
        name: json['name'] as String,
        rank: (json['rank'] as num).toInt(),
        tier: FlagTier.fromJson(json['tier'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'archived': archived,
        'color': color.toJson(),
        'colorName': colorName,
        'flagId': flagId,
        'name': name,
        'rank': rank,
        'tier': tier.toJson(),
      };
}

/// The patient’s current flags and their history, as the reader may see them: a sensitive flag only for a reader who sees sensitive problems, and every change of a flag hidden from them left out. Sent with every chart; a chart without it holds none
class ChartFlags {
  const ChartFlags({
    required this.history,
    required this.primary,
    required this.secondary,
  });

  /// Every change the reader may see, oldest first: by its time, then ID
  final List<FlagHistoryRow> history;
  /// The risk level, or none
  final ChartFlag? primary;
  /// The conditions, by rank, then name, then ID
  final List<ChartFlag> secondary;

  factory ChartFlags.fromJson(Map<String, dynamic> json) => ChartFlags(
        history: (json['history'] as List<dynamic>).map((e) => FlagHistoryRow.fromJson(e as Map<String, dynamic>)).toList(),
        primary: json['primary'] == null ? null : ChartFlag.fromJson(json['primary'] as Map<String, dynamic>),
        secondary: (json['secondary'] as List<dynamic>).map((e) => ChartFlag.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'history': history.map((e) => e.toJson()).toList(),
        'primary': primary == null ? null : primary!.toJson(),
        'secondary': secondary.map((e) => e.toJson()).toList(),
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

/// The values are in the read model, under the answers
class CorrectionView {
  const CorrectionView({
    required this.clockVerified,
    required this.correctedAt,
    required this.corrector,
    required this.credential,
    required this.fields,
    required this.id,
    required this.outcome,
    required this.reason,
    required this.requestedByPatient,
  });

  final bool clockVerified;
  final DateTime correctedAt;
  final UserRef corrector;
  final Credential credential;
  final List<String> fields;
  final String id;
  final CorrectionViewOutcome outcome;
  final String reason;
  final bool requestedByPatient;

  factory CorrectionView.fromJson(Map<String, dynamic> json) => CorrectionView(
        clockVerified: json['clockVerified'] as bool,
        correctedAt: DateTime.parse(json['correctedAt'] as String),
        corrector: UserRef.fromJson(json['corrector'] as Map<String, dynamic>),
        credential: Credential.fromJson(json['credential'] as String),
        fields: (json['fields'] as List<dynamic>).map((e) => e as String).toList(),
        id: json['id'] as String,
        outcome: CorrectionViewOutcome.fromJson(json['outcome'] as String),
        reason: json['reason'] as String,
        requestedByPatient: json['requestedByPatient'] as bool,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'clockVerified': clockVerified,
        'correctedAt': correctedAt.toUtc().toIso8601String(),
        'corrector': corrector.toJson(),
        'credential': credential.toJson(),
        'fields': fields.map((e) => e).toList(),
        'id': id,
        'outcome': outcome.toJson(),
        'reason': reason,
        'requestedByPatient': requestedByPatient,
      };
}

class CreatePreset {
  const CreatePreset({
    required this.body,
    required this.reason,
  });

  /// The preset in its kind’s shape (@sineobex/presets), checked against that shape and the team’s other presets
  final Object? body;
  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;

  factory CreatePreset.fromJson(Map<String, dynamic> json) => CreatePreset(
        body: json['body'],
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'body': body,
        'reason': reason,
      };
}

class CreatePresetResult {
  const CreatePresetResult({
    required this.id,
    required this.revision,
    required this.version,
  });

  final String id;
  /// The team’s revision this write took: a phone’s next pull gets the change
  final int revision;
  final int version;

  factory CreatePresetResult.fromJson(Map<String, dynamic> json) => CreatePresetResult(
        id: json['id'] as String,
        revision: (json['revision'] as num).toInt(),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'revision': revision,
        'version': version,
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

class EditPreset {
  const EditPreset({
    required this.baseVersion,
    required this.body,
    required this.reason,
  });

  /// The version you opened: any other is refused as stale, with the current one
  final int baseVersion;
  /// The preset in its kind’s shape (@sineobex/presets), checked against that shape and the team’s other presets
  final Object? body;
  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;

  factory EditPreset.fromJson(Map<String, dynamic> json) => EditPreset(
        baseVersion: (json['baseVersion'] as num).toInt(),
        body: json['body'],
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'baseVersion': baseVersion,
        'body': body,
        'reason': reason,
      };
}

class EditPresetResult {
  const EditPresetResult({
    required this.revision,
    required this.version,
  });

  /// The team’s revision this write took: a phone’s next pull gets the change
  final int revision;
  final int version;

  factory EditPresetResult.fromJson(Map<String, dynamic> json) => EditPresetResult(
        revision: (json['revision'] as num).toInt(),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'revision': revision,
        'version': version,
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
    this.currentBy,
    required this.field,
    required this.id,
    required this.needs,
    required this.openedAt,
    this.patient,
    required this.patientId,
    required this.status,
  });

  final List<FieldReviewViewAlternatesItem> alternates;
  final FieldState current;
  /// Who recorded the chart’s value; null when nobody did. In the team list and a decision’s answer
  final UserRef? currentBy;
  final String field;
  final String id;
  final ReviewNeeds needs;
  final DateTime openedAt;
  final PatientSummary? patient;
  final String patientId;
  final FieldReviewViewStatus status;

  factory FieldReviewView.fromJson(Map<String, dynamic> json) => FieldReviewView(
        alternates: (json['alternates'] as List<dynamic>).map((e) => FieldReviewViewAlternatesItem.fromJson(e as Map<String, dynamic>)).toList(),
        current: FieldState.fromJson(json['current'] as Map<String, dynamic>),
        currentBy: json['currentBy'] == null ? null : UserRef.fromJson(json['currentBy'] as Map<String, dynamic>),
        field: json['field'] as String,
        id: json['id'] as String,
        needs: ReviewNeeds.fromJson(json['needs'] as String),
        openedAt: DateTime.parse(json['openedAt'] as String),
        patient: json['patient'] == null ? null : PatientSummary.fromJson(json['patient'] as Map<String, dynamic>),
        patientId: json['patientId'] as String,
        status: FieldReviewViewStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'alternates': alternates.map((e) => e.toJson()).toList(),
        'current': current.toJson(),
        if (currentBy != null) 'currentBy': currentBy == null ? null : currentBy!.toJson(),
        'field': field,
        'id': id,
        'needs': needs.toJson(),
        'openedAt': openedAt.toUtc().toIso8601String(),
        if (patient != null) 'patient': patient!.toJson(),
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

class FlagChangeMark {
  const FlagChangeMark({
    required this.at,
    required this.byName,
    this.reason,
  });

  final DateTime at;
  /// Who marked it, by their display name now
  final String byName;
  /// Left out as the change’s own reason is
  final String? reason;

  factory FlagChangeMark.fromJson(Map<String, dynamic> json) => FlagChangeMark(
        at: DateTime.parse(json['at'] as String),
        byName: json['byName'] as String,
        reason: json['reason'] == null ? null : json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'byName': byName,
        if (reason != null) 'reason': reason!,
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

class FlagHistoryRow {
  const FlagHistoryRow({
    required this.action,
    required this.authorName,
    required this.changeId,
    required this.effectiveAt,
    required this.enteredInError,
    required this.flagId,
    required this.name,
    this.reason,
    required this.tier,
  });

  final FlagHistoryRowAction action;
  /// Who made it, by their display name now
  final String authorName;
  final String changeId;
  /// The change’s time, never later than its receipt
  final DateTime effectiveAt;
  final FlagChangeMark? enteredInError;
  final String flagId;
  /// The flag’s name now
  final String name;
  /// Left out of a change entered in error for a reader who neither made it nor is a Program Admin
  final String? reason;
  final FlagTier tier;

  factory FlagHistoryRow.fromJson(Map<String, dynamic> json) => FlagHistoryRow(
        action: FlagHistoryRowAction.fromJson(json['action'] as String),
        authorName: json['authorName'] as String,
        changeId: json['changeId'] as String,
        effectiveAt: DateTime.parse(json['effectiveAt'] as String),
        enteredInError: json['enteredInError'] == null ? null : FlagChangeMark.fromJson(json['enteredInError'] as Map<String, dynamic>),
        flagId: json['flagId'] as String,
        name: json['name'] as String,
        reason: json['reason'] == null ? null : json['reason'] as String,
        tier: FlagTier.fromJson(json['tier'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'action': action.toJson(),
        'authorName': authorName,
        'changeId': changeId,
        'effectiveAt': effectiveAt.toUtc().toIso8601String(),
        'enteredInError': enteredInError == null ? null : enteredInError!.toJson(),
        'flagId': flagId,
        'name': name,
        if (reason != null) 'reason': reason!,
        'tier': tier.toJson(),
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

class HomeCounts {
  const HomeCounts({
    this.attestationWaiting,
    this.cosignWaiting,
    this.notesOverdue,
    this.notesToFinish,
    this.teamIncomplete,
    this.teamOverdue,
  });

  /// Visits in the attestation queue (GET /v1/team/attestation-queue); encounters.chart and a credential that attests
  final int? attestationWaiting;
  /// Visits in the co-sign queue (GET /v1/team/cosign-queue); encounters.chart and a credential that signs
  final int? cosignWaiting;
  /// How many of those are overdue (lifecycle 3.9)
  final int? notesOverdue;
  /// The drafts the caller acts as the author of (GET /v1/me/notes-to-finish); encounters.chart
  final int? notesToFinish;
  /// The team’s drafts (GET /v1/team/incomplete-notes); team.manage_users
  final int? teamIncomplete;
  /// How many of the team’s drafts are overdue, as that list says each is; team.manage_users
  final int? teamOverdue;

  factory HomeCounts.fromJson(Map<String, dynamic> json) => HomeCounts(
        attestationWaiting: json['attestationWaiting'] == null ? null : (json['attestationWaiting'] as num).toInt(),
        cosignWaiting: json['cosignWaiting'] == null ? null : (json['cosignWaiting'] as num).toInt(),
        notesOverdue: json['notesOverdue'] == null ? null : (json['notesOverdue'] as num).toInt(),
        notesToFinish: json['notesToFinish'] == null ? null : (json['notesToFinish'] as num).toInt(),
        teamIncomplete: json['teamIncomplete'] == null ? null : (json['teamIncomplete'] as num).toInt(),
        teamOverdue: json['teamOverdue'] == null ? null : (json['teamOverdue'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (attestationWaiting != null) 'attestationWaiting': attestationWaiting!,
        if (cosignWaiting != null) 'cosignWaiting': cosignWaiting!,
        if (notesOverdue != null) 'notesOverdue': notesOverdue!,
        if (notesToFinish != null) 'notesToFinish': notesToFinish!,
        if (teamIncomplete != null) 'teamIncomplete': teamIncomplete!,
        if (teamOverdue != null) 'teamOverdue': teamOverdue!,
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

class IncompleteNote {
  const IncompleteNote({
    required this.encounterId,
    required this.noteId,
    required this.noteTypeKey,
    required this.overdue,
    required this.patientId,
    required this.startedAt,
    required this.author,
    required this.authorActive,
    this.preferredName,
    this.title,
  });

  final String encounterId;
  final String noteId;
  final String noteTypeKey;
  /// More than 24 hours since the visit started, or since the server received it when its start was not verified
  final bool overdue;
  final String? patientId;
  final DateTime startedAt;
  final Object? author;
  /// The author is still an active member of the team
  final bool authorActive;
  /// The patient’s preferred name, from the chart they were merged into when they were, as a queue row shows it; null for a visit with no patient, and without patients.view
  final String? preferredName;
  /// The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
  final String? title;

  factory IncompleteNote.fromJson(Map<String, dynamic> json) => IncompleteNote(
        encounterId: json['encounterId'] as String,
        noteId: json['noteId'] as String,
        noteTypeKey: json['noteTypeKey'] as String,
        overdue: json['overdue'] as bool,
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        startedAt: DateTime.parse(json['startedAt'] as String),
        author: json['author'],
        authorActive: json['authorActive'] as bool,
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        title: json['title'] == null ? null : json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounterId': encounterId,
        'noteId': noteId,
        'noteTypeKey': noteTypeKey,
        'overdue': overdue,
        'patientId': patientId == null ? null : patientId!,
        'startedAt': startedAt.toUtc().toIso8601String(),
        'author': author,
        'authorActive': authorActive,
        if (preferredName != null) 'preferredName': preferredName == null ? null : preferredName!,
        if (title != null) 'title': title!,
      };
}

class IncompleteNotes {
  const IncompleteNotes({
    required this.notes,
  });

  final List<IncompleteNote> notes;

  factory IncompleteNotes.fromJson(Map<String, dynamic> json) => IncompleteNotes(
        notes: (json['notes'] as List<dynamic>).map((e) => IncompleteNote.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'notes': notes.map((e) => e.toJson()).toList(),
      };
}

class IndexDuplicateHint {
  const IndexDuplicateHint({
    required this.status,
  });

  final DuplicateHintStatus status;

  factory IndexDuplicateHint.fromJson(Map<String, dynamic> json) => IndexDuplicateHint(
        status: DuplicateHintStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'status': status.toJson(),
      };
}

class IndexEntry {
  const IndexEntry({
    required this.aliases,
    required this.allergies,
    required this.allergyScreen,
    required this.birth,
    required this.duplicate,
    this.flags,
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
  final IndexDuplicateHint? duplicate;
  final IndexFlags? flags;
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
        duplicate: json['duplicate'] == null ? null : IndexDuplicateHint.fromJson(json['duplicate'] as Map<String, dynamic>),
        flags: json['flags'] == null ? null : IndexFlags.fromJson(json['flags'] as Map<String, dynamic>),
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
        if (flags != null) 'flags': flags!.toJson(),
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
    required this.kind,
  });

  final String alias;
  /// The street name’s record, which a phone may remove offline; null for a merged name
  final String? id;
  /// merged_name: the preferred name of a record merged into this one. Not a street name record
  final IndexEntryAliasesItemKind kind;

  factory IndexEntryAliasesItem.fromJson(Map<String, dynamic> json) => IndexEntryAliasesItem(
        alias: json['alias'] as String,
        id: json['id'] == null ? null : json['id'] as String,
        kind: IndexEntryAliasesItemKind.fromJson(json['kind'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'alias': alias,
        'id': id == null ? null : id!,
        'kind': kind.toJson(),
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

/// The patient’s current flags by ID, as the reader may see them: a sensitive one only under idx1+sens. Sent with every entry; an entry without it, kept from before, holds none
class IndexFlags {
  const IndexFlags({
    required this.primary,
    required this.secondary,
  });

  /// The risk level, or none
  final String? primary;
  /// The conditions, by rank, then name, then ID
  final List<String> secondary;

  factory IndexFlags.fromJson(Map<String, dynamic> json) => IndexFlags(
        primary: json['primary'] == null ? null : json['primary'] as String,
        secondary: (json['secondary'] as List<dynamic>).map((e) => e as String).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'primary': primary == null ? null : primary!,
        'secondary': secondary.map((e) => e).toList(),
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

/// One of the team’s active flags the caller may see
class ListedFlag {
  const ListedFlag({
    required this.color,
    required this.colorName,
    required this.flagId,
    required this.name,
    required this.rank,
    required this.tier,
  });

  final FlagColor color;
  /// The colour’s plain name, shown before the flag’s own
  final String colorName;
  final String flagId;
  final String name;
  final int rank;
  final FlagTier tier;

  factory ListedFlag.fromJson(Map<String, dynamic> json) => ListedFlag(
        color: FlagColor.fromJson(json['color'] as String),
        colorName: json['colorName'] as String,
        flagId: json['flagId'] as String,
        name: json['name'] as String,
        rank: (json['rank'] as num).toInt(),
        tier: FlagTier.fromJson(json['tier'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'color': color.toJson(),
        'colorName': colorName,
        'flagId': flagId,
        'name': name,
        'rank': rank,
        'tier': tier.toJson(),
      };
}

class MarkFlagChange {
  const MarkFlagChange({
    required this.reason,
  });

  /// Why: trimmed, 3 to 300 characters. Shown only to the change’s author and Program Admins
  final String reason;

  factory MarkFlagChange.fromJson(Map<String, dynamic> json) => MarkFlagChange(
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'reason': reason,
      };
}

class MarkFlagChangeResult {
  const MarkFlagChangeResult({
    required this.version,
  });

  /// The change’s version after its mark
  final int version;

  factory MarkFlagChangeResult.fromJson(Map<String, dynamic> json) => MarkFlagChangeResult(
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'version': version,
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

/// Every note of the visit that waits for this act and that the caller may act on, each with the hash of what they read
class NoteActInput {
  const NoteActInput({
    required this.notes,
    required this.statementVersion,
  });

  final List<NoteActInputNotesItem> notes;
  final String statementVersion;

  factory NoteActInput.fromJson(Map<String, dynamic> json) => NoteActInput(
        notes: (json['notes'] as List<dynamic>).map((e) => NoteActInputNotesItem.fromJson(e as Map<String, dynamic>)).toList(),
        statementVersion: json['statementVersion'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'notes': notes.map((e) => e.toJson()).toList(),
        'statementVersion': statementVersion,
      };
}

class NoteActInputNotesItem {
  const NoteActInputNotesItem({
    required this.contentHash,
    required this.noteId,
  });

  /// The note’s contentHash from the visit read: what the person read (lifecycle 4.5)
  final String contentHash;
  final String noteId;

  factory NoteActInputNotesItem.fromJson(Map<String, dynamic> json) => NoteActInputNotesItem(
        contentHash: json['contentHash'] as String,
        noteId: json['noteId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'contentHash': contentHash,
        'noteId': noteId,
      };
}

class NoteActResult {
  const NoteActResult({
    required this.notes,
  });

  final List<NoteActResultNotesItem> notes;

  factory NoteActResult.fromJson(Map<String, dynamic> json) => NoteActResult(
        notes: (json['notes'] as List<dynamic>).map((e) => NoteActResultNotesItem.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'notes': notes.map((e) => e.toJson()).toList(),
      };
}

class NoteActResultNotesItem {
  const NoteActResultNotesItem({
    required this.attestation,
    required this.noteId,
    required this.status,
  });

  final NoteAttestation attestation;
  final String noteId;
  final NoteStatus status;

  factory NoteActResultNotesItem.fromJson(Map<String, dynamic> json) => NoteActResultNotesItem(
        attestation: NoteAttestation.fromJson(json['attestation'] as String),
        noteId: json['noteId'] as String,
        status: NoteStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'attestation': attestation.toJson(),
        'noteId': noteId,
        'status': status.toJson(),
      };
}

class NoteAssigned {
  const NoteAssigned({
    required this.assignmentId,
    required this.fromUserId,
    required this.noteId,
    required this.toUserId,
  });

  final String assignmentId;
  /// Who acted as the author until now
  final String fromUserId;
  final String noteId;
  final String toUserId;

  factory NoteAssigned.fromJson(Map<String, dynamic> json) => NoteAssigned(
        assignmentId: json['assignmentId'] as String,
        fromUserId: json['fromUserId'] as String,
        noteId: json['noteId'] as String,
        toUserId: json['toUserId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'assignmentId': assignmentId,
        'fromUserId': fromUserId,
        'noteId': noteId,
        'toUserId': toUserId,
      };
}

class NoteAssignee {
  const NoteAssignee({
    required this.credential,
    required this.displayName,
    required this.userId,
  });

  final Credential credential;
  final String displayName;
  final String userId;

  factory NoteAssignee.fromJson(Map<String, dynamic> json) => NoteAssignee(
        credential: Credential.fromJson(json['credential'] as String),
        displayName: json['displayName'] as String,
        userId: json['userId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'credential': credential.toJson(),
        'displayName': displayName,
        'userId': userId,
      };
}

/// Every active member the assign route would take for this note, by name
class NoteAssignees {
  const NoteAssignees({
    required this.assignees,
  });

  final List<NoteAssignee> assignees;

  factory NoteAssignees.fromJson(Map<String, dynamic> json) => NoteAssignees(
        assignees: (json['assignees'] as List<dynamic>).map((e) => NoteAssignee.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'assignees': assignees.map((e) => e.toJson()).toList(),
      };
}

class NoteToFinish {
  const NoteToFinish({
    required this.encounterId,
    required this.noteId,
    required this.noteTypeKey,
    required this.overdue,
    required this.patientId,
    required this.startedAt,
  });

  final String encounterId;
  final String noteId;
  final String noteTypeKey;
  /// More than 24 hours since the visit started, or since the server received it when its start was not verified
  final bool overdue;
  final String? patientId;
  final DateTime startedAt;

  factory NoteToFinish.fromJson(Map<String, dynamic> json) => NoteToFinish(
        encounterId: json['encounterId'] as String,
        noteId: json['noteId'] as String,
        noteTypeKey: json['noteTypeKey'] as String,
        overdue: json['overdue'] as bool,
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        startedAt: DateTime.parse(json['startedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounterId': encounterId,
        'noteId': noteId,
        'noteTypeKey': noteTypeKey,
        'overdue': overdue,
        'patientId': patientId == null ? null : patientId!,
        'startedAt': startedAt.toUtc().toIso8601String(),
      };
}

class NoteTypeDefinition {
  const NoteTypeDefinition({
    required this.definition,
    required this.hash,
    required this.key,
    required this.version,
  });

  /// The resolved definition, in the format of @sineobex/forms
  final Map<String, Object?> definition;
  final String hash;
  /// A note type’s key, as migration 0017 allows it
  final String key;
  final int version;

  factory NoteTypeDefinition.fromJson(Map<String, dynamic> json) => NoteTypeDefinition(
        definition: Map<String, Object?>.from(json['definition'] as Map),
        hash: json['hash'] as String,
        key: json['key'] as String,
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'definition': definition,
        'hash': hash,
        'key': key,
        'version': version,
      };
}

class NoteTypeEntry {
  const NoteTypeEntry({
    required this.auto,
    required this.hash,
    required this.key,
    required this.kinds,
    required this.quick,
    required this.sensitivity,
    required this.title,
    required this.version,
  });

  /// Added by itself with the first Medical note of an encounter
  final String? auto;
  /// SHA-256 of the definition’s canonical JSON
  final String hash;
  /// A note type’s key, as migration 0017 allows it
  final String key;
  /// Which encounters offer it
  final List<NoteTypeEntryKindsItem> kinds;
  /// The Quick encounter
  final bool quick;
  /// `sensitive` needs patients.view_sensitive to read
  final NoteTypeEntrySensitivity sensitivity;
  final String title;
  /// The newest version the team holds
  final int version;

  factory NoteTypeEntry.fromJson(Map<String, dynamic> json) => NoteTypeEntry(
        auto: json['auto'] == null ? null : json['auto'] as String,
        hash: json['hash'] as String,
        key: json['key'] as String,
        kinds: (json['kinds'] as List<dynamic>).map((e) => NoteTypeEntryKindsItem.fromJson(e as String)).toList(),
        quick: json['quick'] as bool,
        sensitivity: NoteTypeEntrySensitivity.fromJson(json['sensitivity'] as String),
        title: json['title'] as String,
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'auto': auto == null ? null : auto!,
        'hash': hash,
        'key': key,
        'kinds': kinds.map((e) => e.toJson()).toList(),
        'quick': quick,
        'sensitivity': sensitivity.toJson(),
        'title': title,
        'version': version,
      };
}

class NoteTypeList {
  const NoteTypeList({
    required this.noteTypes,
  });

  final List<NoteTypeEntry> noteTypes;

  factory NoteTypeList.fromJson(Map<String, dynamic> json) => NoteTypeList(
        noteTypes: (json['noteTypes'] as List<dynamic>).map((e) => NoteTypeEntry.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'noteTypes': noteTypes.map((e) => e.toJson()).toList(),
      };
}

class NotesToFinish {
  const NotesToFinish({
    required this.notes,
  });

  final List<NoteToFinish> notes;

  factory NotesToFinish.fromJson(Map<String, dynamic> json) => NotesToFinish(
        notes: (json['notes'] as List<dynamic>).map((e) => NoteToFinish.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'notes': notes.map((e) => e.toJson()).toList(),
      };
}

class Notice {
  const Notice({
    required this.createdAt,
    required this.entity,
    required this.id,
    required this.kind,
    required this.noteId,
    required this.patientId,
    required this.readAt,
    required this.recordId,
  });

  final DateTime createdAt;
  final String? entity;
  final String id;
  final String kind;
  /// The note a `signoff_not_applied` or `correction_not_applied` notice is about: its record is the held sign-off or correction, which no sync read gives, so a phone that never held it opens the note by this. Null for every other notice
  final String? noteId;
  /// The patient a `flag_change_not_applied` notice is about: its record is the flag change a held create or Entered in error mark was for, which the phone let go of when it was held, so a phone opens the chart by this. Null for every other notice
  final String? patientId;
  final DateTime? readAt;
  final String? recordId;

  factory Notice.fromJson(Map<String, dynamic> json) => Notice(
        createdAt: DateTime.parse(json['createdAt'] as String),
        entity: json['entity'] == null ? null : json['entity'] as String,
        id: json['id'] as String,
        kind: json['kind'] as String,
        noteId: json['noteId'] == null ? null : json['noteId'] as String,
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
        recordId: json['recordId'] == null ? null : json['recordId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'createdAt': createdAt.toUtc().toIso8601String(),
        'entity': entity == null ? null : entity!,
        'id': id,
        'kind': kind,
        'noteId': noteId == null ? null : noteId!,
        'patientId': patientId == null ? null : patientId!,
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
    this.flagChanges,
    this.flags,
    required this.idLinks,
    required this.mergedFrom,
    required this.patient,
    this.problemHistory,
    this.problemNotes,
    this.problems,
    required this.projection,
    this.recentVisits,
    this.redirectedFrom,
    required this.reviews,
    this.timeline,
  });

  final List<RecordSnapshot> aliases;
  final List<RecordSnapshot> allergies;
  final String canonicalId;
  final List<ConsentView> consents;
  final DuplicateHint? duplicate;
  /// The group’s flag changes the reader may see, oldest first, as records for the phone’s copy. Sent with every chart; a chart without it holds none
  final List<RecordSnapshot>? flagChanges;
  final ChartFlags? flags;
  /// Active links of the group: usually one; one per merged record that had a card until the next new card
  final List<IdLinkSummary> idLinks;
  final List<PatientChartMergedFromItem> mergedFrom;
  final RecordSnapshot patient;
  final List<ProblemStatusEvent>? problemHistory;
  final List<ProblemNoteView>? problemNotes;
  final List<RecordSnapshot>? problems;
  /// Which projection made this copy
  final String projection;
  /// The last three visits in full, read offline from the cache: on the phone’s cached chart (POST /v1/patients/charts) only
  final List<VisitRead>? recentVisits;
  /// The merged ID that was asked for
  final String? redirectedFrom;
  final List<FieldReviewView> reviews;
  final Timeline? timeline;

  factory PatientChart.fromJson(Map<String, dynamic> json) => PatientChart(
        aliases: (json['aliases'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        allergies: (json['allergies'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        canonicalId: json['canonicalId'] as String,
        consents: (json['consents'] as List<dynamic>).map((e) => ConsentView.fromJson(e as Map<String, dynamic>)).toList(),
        duplicate: json['duplicate'] == null ? null : DuplicateHint.fromJson(json['duplicate'] as Map<String, dynamic>),
        flagChanges: json['flagChanges'] == null ? null : (json['flagChanges'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        flags: json['flags'] == null ? null : ChartFlags.fromJson(json['flags'] as Map<String, dynamic>),
        idLinks: (json['idLinks'] as List<dynamic>).map((e) => IdLinkSummary.fromJson(e as Map<String, dynamic>)).toList(),
        mergedFrom: (json['mergedFrom'] as List<dynamic>).map((e) => PatientChartMergedFromItem.fromJson(e as Map<String, dynamic>)).toList(),
        patient: RecordSnapshot.fromJson(json['patient'] as Map<String, dynamic>),
        problemHistory: json['problemHistory'] == null ? null : (json['problemHistory'] as List<dynamic>).map((e) => ProblemStatusEvent.fromJson(e as Map<String, dynamic>)).toList(),
        problemNotes: json['problemNotes'] == null ? null : (json['problemNotes'] as List<dynamic>).map((e) => ProblemNoteView.fromJson(e as Map<String, dynamic>)).toList(),
        problems: json['problems'] == null ? null : (json['problems'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        projection: json['projection'] as String,
        recentVisits: json['recentVisits'] == null ? null : (json['recentVisits'] as List<dynamic>).map((e) => VisitRead.fromJson(e as Map<String, dynamic>)).toList(),
        redirectedFrom: json['redirectedFrom'] == null ? null : json['redirectedFrom'] as String,
        reviews: (json['reviews'] as List<dynamic>).map((e) => FieldReviewView.fromJson(e as Map<String, dynamic>)).toList(),
        timeline: json['timeline'] == null ? null : Timeline.fromJson(json['timeline'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'aliases': aliases.map((e) => e.toJson()).toList(),
        'allergies': allergies.map((e) => e.toJson()).toList(),
        'canonicalId': canonicalId,
        'consents': consents.map((e) => e.toJson()).toList(),
        'duplicate': duplicate == null ? null : duplicate!.toJson(),
        if (flagChanges != null) 'flagChanges': flagChanges!.map((e) => e.toJson()).toList(),
        if (flags != null) 'flags': flags!.toJson(),
        'idLinks': idLinks.map((e) => e.toJson()).toList(),
        'mergedFrom': mergedFrom.map((e) => e.toJson()).toList(),
        'patient': patient.toJson(),
        if (problemHistory != null) 'problemHistory': problemHistory!.map((e) => e.toJson()).toList(),
        if (problemNotes != null) 'problemNotes': problemNotes!.map((e) => e.toJson()).toList(),
        if (problems != null) 'problems': problems!.map((e) => e.toJson()).toList(),
        'projection': projection,
        if (recentVisits != null) 'recentVisits': recentVisits!.map((e) => e.toJson()).toList(),
        if (redirectedFrom != null) 'redirectedFrom': redirectedFrom!,
        'reviews': reviews.map((e) => e.toJson()).toList(),
        if (timeline != null) 'timeline': timeline!.toJson(),
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

class PresetEvent {
  const PresetEvent({
    required this.act,
    required this.at,
    required this.body,
    required this.by,
    required this.reason,
    required this.source,
    required this.version,
  });

  /// installed and platform_updated are the platform installer’s; every other act is a person’s
  final PresetEventAct act;
  final DateTime at;
  /// That version’s body, in the shape of @sineobex/presets for its kind
  final Map<String, Object?> body;
  /// Who acted; null for the platform installer
  final UserRef? by;
  /// Why, as the person gave it; null for the platform installer
  final String? reason;
  /// Whose version it is: the team’s, or the platform’s, installed or taken by a person
  final PresetEventSource source;
  /// The version the act made, or stood on: an archive and a restore make none
  final int version;

  factory PresetEvent.fromJson(Map<String, dynamic> json) => PresetEvent(
        act: PresetEventAct.fromJson(json['act'] as String),
        at: DateTime.parse(json['at'] as String),
        body: Map<String, Object?>.from(json['body'] as Map),
        by: json['by'] == null ? null : UserRef.fromJson(json['by'] as Map<String, dynamic>),
        reason: json['reason'] == null ? null : json['reason'] as String,
        source: PresetEventSource.fromJson(json['source'] as String),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'act': act.toJson(),
        'at': at.toUtc().toIso8601String(),
        'body': body,
        'by': by == null ? null : by!.toJson(),
        'reason': reason == null ? null : reason!,
        'source': source.toJson(),
        'version': version,
      };
}

class PresetPlatformUpdate {
  const PresetPlatformUpdate({
    required this.body,
    required this.changesFixed,
    required this.platformVersion,
  });

  /// The platform’s body, naming the team’s presets: what taking it writes
  final Map<String, Object?> body;
  /// The fields fixed at creation it changes; with any, it is taken only as a new preset
  final List<String> changesFixed;
  /// Send it back as platformVersion to take this update and no other
  final int platformVersion;

  factory PresetPlatformUpdate.fromJson(Map<String, dynamic> json) => PresetPlatformUpdate(
        body: Map<String, Object?>.from(json['body'] as Map),
        changesFixed: (json['changesFixed'] as List<dynamic>).map((e) => e as String).toList(),
        platformVersion: (json['platformVersion'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'body': body,
        'changesFixed': changesFixed.map((e) => e).toList(),
        'platformVersion': platformVersion,
      };
}

class PresetRevision {
  const PresetRevision({
    required this.revision,
  });

  /// The team’s revision this write took: a phone’s next pull gets the change
  final int revision;

  factory PresetRevision.fromJson(Map<String, dynamic> json) => PresetRevision(
        revision: (json['revision'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'revision': revision,
      };
}

class PresetView {
  const PresetView({
    required this.body,
    required this.customized,
    required this.id,
    required this.name,
    required this.referencedBy,
    required this.state,
    required this.update,
    required this.updateChangesFixed,
    required this.updateOnOffer,
    required this.version,
  });

  /// Its current version’s body, in the shape of @sineobex/presets for its kind
  final Map<String, Object?> body;
  /// The team edited, archived or restored it: a platform version is then only offered
  final bool customized;
  final String id;
  final String name;
  /// How many active presets name it, by their kind; only kinds that do. It can’t be archived while any do
  final Map<String, int> referencedBy;
  /// An archived preset is offered for no new work
  final PresetViewState state;
  /// The update on offer, for the person to review before taking it; null when none is
  final PresetPlatformUpdate? update;
  /// The update changes a field fixed at creation, so it is taken only as a new preset
  final bool updateChangesFixed;
  /// A newer platform version is on offer to take
  final bool updateOnOffer;
  /// Its current version: an edit sends it back
  final int version;

  factory PresetView.fromJson(Map<String, dynamic> json) => PresetView(
        body: Map<String, Object?>.from(json['body'] as Map),
        customized: json['customized'] as bool,
        id: json['id'] as String,
        name: json['name'] as String,
        referencedBy: (json['referencedBy'] as Map<String, dynamic>).map((k, v) => MapEntry(k, (v as num).toInt())),
        state: PresetViewState.fromJson(json['state'] as String),
        update: json['update'] == null ? null : PresetPlatformUpdate.fromJson(json['update'] as Map<String, dynamic>),
        updateChangesFixed: json['updateChangesFixed'] as bool,
        updateOnOffer: json['updateOnOffer'] as bool,
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'body': body,
        'customized': customized,
        'id': id,
        'name': name,
        'referencedBy': referencedBy.map((k, v) => MapEntry(k, v)),
        'state': state.toJson(),
        'update': update == null ? null : update!.toJson(),
        'updateChangesFixed': updateChangesFixed,
        'updateOnOffer': updateOnOffer,
        'version': version,
      };
}

class PresetsPull {
  const PresetsPull({
    required this.epoch,
    required this.presets,
    required this.reset,
    required this.revision,
  });

  /// Send as epoch next time
  final String epoch;
  /// Every preset changed after since, or all of them; archived ones included
  final List<PulledPreset> presets;
  /// Replace the copy whole: no revision was sent, the revision sent is above the team’s, or another epoch
  final bool reset;
  /// Send as since next time: the greatest revision among presets, else since
  final int revision;

  factory PresetsPull.fromJson(Map<String, dynamic> json) => PresetsPull(
        epoch: json['epoch'] as String,
        presets: (json['presets'] as List<dynamic>).map((e) => PulledPreset.fromJson(e as Map<String, dynamic>)).toList(),
        reset: json['reset'] as bool,
        revision: (json['revision'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'epoch': epoch,
        'presets': presets.map((e) => e.toJson()).toList(),
        'reset': reset,
        'revision': revision,
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

class PulledPreset {
  const PulledPreset({
    required this.body,
    required this.id,
    required this.kind,
    required this.originKey,
    required this.state,
    required this.version,
  });

  /// Its current version’s body, in the shape of @sineobex/presets for its kind
  final Map<String, Object?> body;
  final String id;
  /// A phone skips a kind it does not know
  final PulledPresetKind kind;
  /// The platform preset it came from; null for the team’s own
  final String? originKey;
  /// An archived preset is kept for its name
  final PulledPresetState state;
  /// Its current version
  final int version;

  factory PulledPreset.fromJson(Map<String, dynamic> json) => PulledPreset(
        body: Map<String, Object?>.from(json['body'] as Map),
        id: json['id'] as String,
        kind: PulledPresetKind.fromJson(json['kind'] as String),
        originKey: json['originKey'] == null ? null : json['originKey'] as String,
        state: PulledPresetState.fromJson(json['state'] as String),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'body': body,
        'id': id,
        'kind': kind.toJson(),
        'originKey': originKey == null ? null : originKey!,
        'state': state.toJson(),
        'version': version,
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
    this.hidden,
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
  /// The reviewer may not read this change (lifecycle 6.4): field and value are null, and nothing names what it holds. Their accept answers 403 change_hidden; they may reject it
  final bool? hidden;
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
        hidden: json['hidden'] == null ? null : json['hidden'] as bool,
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
        if (hidden != null) 'hidden': hidden!,
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

class QueueNote {
  const QueueNote({
    required this.attestedBefore,
    required this.author,
    required this.canAct,
    required this.completedAt,
    this.heldBecause,
    required this.noteId,
    required this.noteTypeKey,
    required this.signedBefore,
    this.title,
  });

  /// Who attested it last, when a correction sent it back; null otherwise
  final UserRef? attestedBefore;
  final UserRef author;
  /// False for a note the caller may not co-sign or attest: one with an answer they may not see, or one they wrote or signed
  final bool canAct;
  final DateTime? completedAt;
  final Object? heldBecause;
  final String noteId;
  final String noteTypeKey;
  /// Who signed it before, when a correction sent it back; null otherwise
  final UserRef? signedBefore;
  /// The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
  final String? title;

  factory QueueNote.fromJson(Map<String, dynamic> json) => QueueNote(
        attestedBefore: json['attestedBefore'] == null ? null : UserRef.fromJson(json['attestedBefore'] as Map<String, dynamic>),
        author: UserRef.fromJson(json['author'] as Map<String, dynamic>),
        canAct: json['canAct'] as bool,
        completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
        heldBecause: json['heldBecause'],
        noteId: json['noteId'] as String,
        noteTypeKey: json['noteTypeKey'] as String,
        signedBefore: json['signedBefore'] == null ? null : UserRef.fromJson(json['signedBefore'] as Map<String, dynamic>),
        title: json['title'] == null ? null : json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'attestedBefore': attestedBefore == null ? null : attestedBefore!.toJson(),
        'author': author.toJson(),
        'canAct': canAct,
        'completedAt': completedAt == null ? null : completedAt!.toUtc().toIso8601String(),
        'heldBecause': heldBecause,
        'noteId': noteId,
        'noteTypeKey': noteTypeKey,
        'signedBefore': signedBefore == null ? null : signedBefore!.toJson(),
        if (title != null) 'title': title!,
      };
}

class QueueVisit {
  const QueueVisit({
    required this.encounterId,
    required this.notes,
    required this.patientId,
    required this.preferredName,
    required this.startedAt,
  });

  final String encounterId;
  final List<QueueNote> notes;
  final String? patientId;
  final String? preferredName;
  final DateTime startedAt;

  factory QueueVisit.fromJson(Map<String, dynamic> json) => QueueVisit(
        encounterId: json['encounterId'] as String,
        notes: (json['notes'] as List<dynamic>).map((e) => QueueNote.fromJson(e as Map<String, dynamic>)).toList(),
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        startedAt: DateTime.parse(json['startedAt'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounterId': encounterId,
        'notes': notes.map((e) => e.toJson()).toList(),
        'patientId': patientId == null ? null : patientId!,
        'preferredName': preferredName == null ? null : preferredName!,
        'startedAt': startedAt.toUtc().toIso8601String(),
      };
}

class ReadCorrection {
  const ReadCorrection({
    required this.at,
    required this.by,
    required this.credential,
    required this.old,
    required this.path,
    required this.reason,
  });

  final String at;
  final String by;
  final String credential;
  final String? old;
  final String path;
  final String reason;

  factory ReadCorrection.fromJson(Map<String, dynamic> json) => ReadCorrection(
        at: json['at'] as String,
        by: json['by'] as String,
        credential: json['credential'] as String,
        old: json['old'] == null ? null : json['old'] as String,
        path: json['path'] as String,
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at,
        'by': by,
        'credential': credential,
        'old': old == null ? null : old!,
        'path': path,
        'reason': reason,
      };
}

class ReadEntry {
  const ReadEntry({
    required this.id,
    required this.items,
    required this.title,
  });

  final String id;
  final List<ReadItem> items;
  final String title;

  factory ReadEntry.fromJson(Map<String, dynamic> json) => ReadEntry(
        id: json['id'] as String,
        items: (json['items'] as List<dynamic>).map((e) => ReadItem.fromJson(e as Map<String, dynamic>)).toList(),
        title: json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'items': items.map((e) => e.toJson()).toList(),
        'title': title,
      };
}

class ReadItem {
  const ReadItem({
    required this.corrections,
    required this.labels,
    required this.path,
    required this.value,
  });

  final List<ReadCorrection> corrections;
  final List<String> labels;
  final String path;
  /// Null for an answer a correction took away
  final String? value;

  factory ReadItem.fromJson(Map<String, dynamic> json) => ReadItem(
        corrections: (json['corrections'] as List<dynamic>).map((e) => ReadCorrection.fromJson(e as Map<String, dynamic>)).toList(),
        labels: (json['labels'] as List<dynamic>).map((e) => e as String).toList(),
        path: json['path'] as String,
        value: json['value'] == null ? null : json['value'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'corrections': corrections.map((e) => e.toJson()).toList(),
        'labels': labels.map((e) => e).toList(),
        'path': path,
        'value': value == null ? null : value!,
      };
}

class ReadModel {
  const ReadModel({
    required this.sections,
  });

  final List<ReadSection> sections;

  factory ReadModel.fromJson(Map<String, dynamic> json) => ReadModel(
        sections: (json['sections'] as List<dynamic>).map((e) => ReadSection.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'sections': sections.map((e) => e.toJson()).toList(),
      };
}

/// A section with items, or a repeating one with entries
class ReadSection {
  const ReadSection({
    this.entries,
    required this.id,
    this.items,
    required this.title,
  });

  final List<ReadEntry>? entries;
  final String id;
  final List<ReadItem>? items;
  final String title;

  factory ReadSection.fromJson(Map<String, dynamic> json) => ReadSection(
        entries: json['entries'] == null ? null : (json['entries'] as List<dynamic>).map((e) => ReadEntry.fromJson(e as Map<String, dynamic>)).toList(),
        id: json['id'] as String,
        items: json['items'] == null ? null : (json['items'] as List<dynamic>).map((e) => ReadItem.fromJson(e as Map<String, dynamic>)).toList(),
        title: json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (entries != null) 'entries': entries!.map((e) => e.toJson()).toList(),
        'id': id,
        if (items != null) 'items': items!.map((e) => e.toJson()).toList(),
        'title': title,
      };
}

/// The automatic recap of one section with an answer (lifecycle 8.1)
class RecapLine {
  const RecapLine({
    required this.section,
    required this.text,
  });

  final String section;
  final String text;

  factory RecapLine.fromJson(Map<String, dynamic> json) => RecapLine(
        section: json['section'] as String,
        text: json['text'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'section': section,
        'text': text,
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

  /// What the server holds of the record beyond its fields; no change sets them. Most are set at creation. Some follow what the server records later: a patient’s lastSeenAt, a problem’s status times, merge and reversal request, and a note’s attestation, actingAuthorId and actingAuthorName (who acts as its author, by their display name now), everSigned (signed once, signed now or not), completedAt and signoffId (lifecycle 4.4), and a visit’s hasFinishedNote (a note of it the reader is shown is finished, so its patient, place and summary are locked, lifecycle 3.1). A problem note’s patientId is its problem’s patient, which nothing else of it names (lifecycle 8.4). A note’s createdAt is when the server made it (an admin’s accept, for a create held for review), the order the visit read gives a visit’s notes in, then by ID: to the microsecond, with all six places, so the text sorts as the time does. A sign-off’s signerName, a correction’s correctorName and an addendum’s authorName are as they were then; a referral’s authorName, who recorded it, is their name now. A problem’s statusCheckDue says whether its status check is due, by the team’s window at the server’s time
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

class ReorderFlags {
  const ReorderFlags({
    required this.flags,
    required this.reason,
    required this.tier,
  });

  /// Every active flag of the tier, each once, in the order its list shows them, each with the version it was listed at
  final List<ReorderedFlag> flags;
  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;
  /// The risk level (primary) or the conditions (secondary)
  final ReorderFlagsTier tier;

  factory ReorderFlags.fromJson(Map<String, dynamic> json) => ReorderFlags(
        flags: (json['flags'] as List<dynamic>).map((e) => ReorderedFlag.fromJson(e as Map<String, dynamic>)).toList(),
        reason: json['reason'] as String,
        tier: ReorderFlagsTier.fromJson(json['tier'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'flags': flags.map((e) => e.toJson()).toList(),
        'reason': reason,
        'tier': tier.toJson(),
      };
}

class ReorderFlagsResult {
  const ReorderFlagsResult({
    required this.changed,
  });

  /// How many flags moved, each to its next version: 0 when none did, and nothing is written
  final int changed;

  factory ReorderFlagsResult.fromJson(Map<String, dynamic> json) => ReorderFlagsResult(
        changed: (json['changed'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'changed': changed,
      };
}

class ReorderedFlag {
  const ReorderedFlag({
    required this.baseVersion,
    required this.id,
  });

  /// The version the list showed this flag at: any other refuses the whole order as stale, with the current one
  final int baseVersion;
  final String id;

  factory ReorderedFlag.fromJson(Map<String, dynamic> json) => ReorderedFlag(
        baseVersion: (json['baseVersion'] as num).toInt(),
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'baseVersion': baseVersion,
        'id': id,
      };
}

class RestorePreset {
  const RestorePreset({
    required this.reason,
  });

  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;

  factory RestorePreset.fromJson(Map<String, dynamic> json) => RestorePreset(
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

class SetPatientFlag {
  const SetPatientFlag({
    required this.action,
    required this.flagId,
    required this.id,
    required this.reason,
  });

  final SetPatientFlagAction action;
  final String flagId;
  /// The change’s ID, made once per form by the page, so a retry gets the first answer
  final String id;
  /// Why: trimmed, 1 to 500 characters, else reason_invalid. Kept with the change, never logged
  final String reason;

  factory SetPatientFlag.fromJson(Map<String, dynamic> json) => SetPatientFlag(
        action: SetPatientFlagAction.fromJson(json['action'] as String),
        flagId: json['flagId'] as String,
        id: json['id'] as String,
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'action': action.toJson(),
        'flagId': flagId,
        'id': id,
        'reason': reason,
      };
}

class SetPatientFlagResult {
  const SetPatientFlagResult({
    required this.id,
  });

  final String id;

  factory SetPatientFlagResult.fromJson(Map<String, dynamic> json) => SetPatientFlagResult(
        id: json['id'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
      };
}

class SignatureQueue {
  const SignatureQueue({
    required this.rows,
  });

  final List<QueueVisit> rows;

  factory SignatureQueue.fromJson(Map<String, dynamic> json) => SignatureQueue(
        rows: (json['rows'] as List<dynamic>).map((e) => QueueVisit.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'rows': rows.map((e) => e.toJson()).toList(),
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

class SignoffView {
  const SignoffView({
    required this.act,
    required this.claimedCredential,
    required this.clockVerified,
    this.contentHash,
    required this.credential,
    required this.effect,
    required this.id,
    required this.needsAttestation,
    required this.signedAt,
    required this.signer,
    required this.statementVersion,
  });

  final SignoffViewAct act;
  final Credential? claimedCredential;
  final bool clockVerified;
  /// Only to whoever acts as the note’s author, its signer, and a reader who sees every answer of any note
  final String? contentHash;
  final Credential credential;
  final SignoffViewEffect effect;
  final String id;
  final bool needsAttestation;
  final DateTime signedAt;
  final UserRef signer;
  final String statementVersion;

  factory SignoffView.fromJson(Map<String, dynamic> json) => SignoffView(
        act: SignoffViewAct.fromJson(json['act'] as String),
        claimedCredential: json['claimedCredential'] == null ? null : Credential.fromJson(json['claimedCredential'] as String),
        clockVerified: json['clockVerified'] as bool,
        contentHash: json['contentHash'] == null ? null : json['contentHash'] as String,
        credential: Credential.fromJson(json['credential'] as String),
        effect: SignoffViewEffect.fromJson(json['effect'] as String),
        id: json['id'] as String,
        needsAttestation: json['needsAttestation'] as bool,
        signedAt: DateTime.parse(json['signedAt'] as String),
        signer: UserRef.fromJson(json['signer'] as Map<String, dynamic>),
        statementVersion: json['statementVersion'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'act': act.toJson(),
        'claimedCredential': claimedCredential == null ? null : claimedCredential!.toJson(),
        'clockVerified': clockVerified,
        if (contentHash != null) 'contentHash': contentHash!,
        'credential': credential.toJson(),
        'effect': effect.toJson(),
        'id': id,
        'needsAttestation': needsAttestation,
        'signedAt': signedAt.toUtc().toIso8601String(),
        'signer': signer.toJson(),
        'statementVersion': statementVersion,
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
  /// Device time corrected by the last measured offset; from 1970 through 9999 (UTC)
  final DateTime? correctedTime;
  /// From 1970 through 9999 (UTC)
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
  /// What the server did beyond storing the value. A sign-off’s (lifecycle 4.6): effect, status, attestation, hashMatches, and for effect none its reason: already_finished, not_author or empty (an empty draft, which does not count)
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

class TakePresetUpdate {
  const TakePresetUpdate({
    required this.asNew,
    required this.baseVersion,
    required this.platformVersion,
    required this.reason,
  });

  /// Take it as a new preset: this one is archived and kept in the history. The only way to take an update that changes a field fixed at creation
  final bool asNew;
  /// The version you opened: any other is refused as stale, with the current one
  final int baseVersion;
  /// The platform version you reviewed, as the list’s update gave it: a newer one on offer by then is refused as stale
  final int platformVersion;
  /// Why, in a few words: 3 to 300 characters. Kept in the history, never in the audit log.
  final String reason;

  factory TakePresetUpdate.fromJson(Map<String, dynamic> json) => TakePresetUpdate(
        asNew: json['asNew'] as bool,
        baseVersion: (json['baseVersion'] as num).toInt(),
        platformVersion: (json['platformVersion'] as num).toInt(),
        reason: json['reason'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'asNew': asNew,
        'baseVersion': baseVersion,
        'platformVersion': platformVersion,
        'reason': reason,
      };
}

class TakePresetUpdateResult {
  const TakePresetUpdateResult({
    required this.id,
    required this.revision,
    required this.version,
  });

  /// The preset that now holds the update: this one, or the new one
  final String id;
  /// The team’s revision this write took: a phone’s next pull gets the change
  final int revision;
  /// Its version now: 1 for a new preset
  final int version;

  factory TakePresetUpdateResult.fromJson(Map<String, dynamic> json) => TakePresetUpdateResult(
        id: json['id'] as String,
        revision: (json['revision'] as num).toInt(),
        version: (json['version'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'revision': revision,
        'version': version,
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
  /// idx1, or idx1+sens for a reader who sees sensitive flags: another copy, sent whole
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

/// On the chart and the phone’s cache; absent where a chart is shown beside a decision
class Timeline {
  const Timeline({
    required this.encounters,
    required this.referrals,
  });

  /// Newest first, the first 50
  final List<TimelineVisit> encounters;
  final List<RecordSnapshot> referrals;

  factory Timeline.fromJson(Map<String, dynamic> json) => Timeline(
        encounters: (json['encounters'] as List<dynamic>).map((e) => TimelineVisit.fromJson(e as Map<String, dynamic>)).toList(),
        referrals: (json['referrals'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounters': encounters.map((e) => e.toJson()).toList(),
        'referrals': referrals.map((e) => e.toJson()).toList(),
      };
}

class TimelineNote {
  const TimelineNote({
    required this.attestation,
    required this.group,
    this.medical,
    required this.noteId,
    required this.noteTypeKey,
    required this.status,
    this.title,
  });

  final NoteAttestation attestation;
  final TimelineGroup group;
  /// A Medical note: completed for a co-signer or signed, and attested when it waits (lifecycle 3.1)
  final bool? medical;
  final String noteId;
  final String noteTypeKey;
  final NoteStatus status;
  /// The note type’s title, so no page reads the note types list to word it; empty only in a copy cached before it was sent
  final String? title;

  factory TimelineNote.fromJson(Map<String, dynamic> json) => TimelineNote(
        attestation: NoteAttestation.fromJson(json['attestation'] as String),
        group: TimelineGroup.fromJson(json['group'] as String),
        medical: json['medical'] == null ? null : json['medical'] as bool,
        noteId: json['noteId'] as String,
        noteTypeKey: json['noteTypeKey'] as String,
        status: NoteStatus.fromJson(json['status'] as String),
        title: json['title'] == null ? null : json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'attestation': attestation.toJson(),
        'group': group.toJson(),
        if (medical != null) 'medical': medical!,
        'noteId': noteId,
        'noteTypeKey': noteTypeKey,
        'status': status.toJson(),
        if (title != null) 'title': title!,
      };
}

class TimelinePage {
  const TimelinePage({
    required this.encounters,
  });

  /// Newest first, at most 50
  final List<TimelineVisit> encounters;

  factory TimelinePage.fromJson(Map<String, dynamic> json) => TimelinePage(
        encounters: (json['encounters'] as List<dynamic>).map((e) => TimelineVisit.fromJson(e as Map<String, dynamic>)).toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounters': encounters.map((e) => e.toJson()).toList(),
      };
}

class TimelineVisit {
  const TimelineVisit({
    required this.encounterId,
    required this.kind,
    required this.notes,
    required this.startedAt,
    required this.status,
  });

  final String encounterId;
  final EncounterKind kind;
  final List<TimelineNote> notes;
  final DateTime startedAt;
  final NoteStatus status;

  factory TimelineVisit.fromJson(Map<String, dynamic> json) => TimelineVisit(
        encounterId: json['encounterId'] as String,
        kind: EncounterKind.fromJson(json['kind'] as String),
        notes: (json['notes'] as List<dynamic>).map((e) => TimelineNote.fromJson(e as Map<String, dynamic>)).toList(),
        startedAt: DateTime.parse(json['startedAt'] as String),
        status: NoteStatus.fromJson(json['status'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'encounterId': encounterId,
        'kind': kind.toJson(),
        'notes': notes.map((e) => e.toJson()).toList(),
        'startedAt': startedAt.toUtc().toIso8601String(),
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
    required this.decidedReviews,
    required this.keptFields,
    required this.linksIssuedWhileMerged,
    required this.merge,
    required this.redirectedEdits,
    required this.restoredLinks,
    required this.revertedFields,
    required this.reviewsClosed,
    required this.reviewsReopened,
  });

  /// Reviews on the kept chart that offered the merged record’s values and were decided while merged
  final List<UndoMergeResultDecidedReviewsItem> decidedReviews;
  final List<String> keptFields;
  final List<UndoMergeResultLinksIssuedWhileMergedItem> linksIssuedWhileMerged;
  final MergeView merge;
  /// Edits sent to the merged record while merged, which went to the kept chart: move by hand
  final List<UndoMergeResultRedirectedEditsItem> redirectedEdits;
  final List<UndoMergeResultRestoredLinksItem> restoredLinks;
  final List<String> revertedFields;
  /// Open reviews on the kept chart closed because only the merged record’s values were left to choose
  final int reviewsClosed;
  /// The merged record’s own open reviews, which the merge had closed, open again
  final int reviewsReopened;

  factory UndoMergeResult.fromJson(Map<String, dynamic> json) => UndoMergeResult(
        decidedReviews: (json['decidedReviews'] as List<dynamic>).map((e) => UndoMergeResultDecidedReviewsItem.fromJson(e as Map<String, dynamic>)).toList(),
        keptFields: (json['keptFields'] as List<dynamic>).map((e) => e as String).toList(),
        linksIssuedWhileMerged: (json['linksIssuedWhileMerged'] as List<dynamic>).map((e) => UndoMergeResultLinksIssuedWhileMergedItem.fromJson(e as Map<String, dynamic>)).toList(),
        merge: MergeView.fromJson(json['merge'] as Map<String, dynamic>),
        redirectedEdits: (json['redirectedEdits'] as List<dynamic>).map((e) => UndoMergeResultRedirectedEditsItem.fromJson(e as Map<String, dynamic>)).toList(),
        restoredLinks: (json['restoredLinks'] as List<dynamic>).map((e) => UndoMergeResultRestoredLinksItem.fromJson(e as Map<String, dynamic>)).toList(),
        revertedFields: (json['revertedFields'] as List<dynamic>).map((e) => e as String).toList(),
        reviewsClosed: (json['reviewsClosed'] as num).toInt(),
        reviewsReopened: (json['reviewsReopened'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'decidedReviews': decidedReviews.map((e) => e.toJson()).toList(),
        'keptFields': keptFields.map((e) => e).toList(),
        'linksIssuedWhileMerged': linksIssuedWhileMerged.map((e) => e.toJson()).toList(),
        'merge': merge.toJson(),
        'redirectedEdits': redirectedEdits.map((e) => e.toJson()).toList(),
        'restoredLinks': restoredLinks.map((e) => e.toJson()).toList(),
        'revertedFields': revertedFields.map((e) => e).toList(),
        'reviewsClosed': reviewsClosed,
        'reviewsReopened': reviewsReopened,
      };
}

class UndoMergeResultDecidedReviewsItem {
  const UndoMergeResultDecidedReviewsItem({
    required this.decidedAt,
    required this.decidedBy,
    required this.field,
    required this.keptMergedValue,
    required this.reviewId,
  });

  final DateTime decidedAt;
  final UserRef decidedBy;
  final String field;
  /// The kept chart took the merged record’s value. Undo leaves it there: check it and correct it by hand
  final bool keptMergedValue;
  final String reviewId;

  factory UndoMergeResultDecidedReviewsItem.fromJson(Map<String, dynamic> json) => UndoMergeResultDecidedReviewsItem(
        decidedAt: DateTime.parse(json['decidedAt'] as String),
        decidedBy: UserRef.fromJson(json['decidedBy'] as Map<String, dynamic>),
        field: json['field'] as String,
        keptMergedValue: json['keptMergedValue'] as bool,
        reviewId: json['reviewId'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'decidedAt': decidedAt.toUtc().toIso8601String(),
        'decidedBy': decidedBy.toJson(),
        'field': field,
        'keptMergedValue': keptMergedValue,
        'reviewId': reviewId,
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
    required this.outcome,
  });

  final DateTime at;
  final UserRef by;
  final String field;
  /// A field history entry
  final String historyId;
  /// applied: written to the kept chart; kept_both: offered in a review there (taken out by the undo); history_only: kept in its history
  final UndoMergeResultRedirectedEditsItemOutcome outcome;

  factory UndoMergeResultRedirectedEditsItem.fromJson(Map<String, dynamic> json) => UndoMergeResultRedirectedEditsItem(
        at: DateTime.parse(json['at'] as String),
        by: UserRef.fromJson(json['by'] as Map<String, dynamic>),
        field: json['field'] as String,
        historyId: json['historyId'] as String,
        outcome: UndoMergeResultRedirectedEditsItemOutcome.fromJson(json['outcome'] as String),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'at': at.toUtc().toIso8601String(),
        'by': by.toJson(),
        'field': field,
        'historyId': historyId,
        'outcome': outcome.toJson(),
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

class VisitNote {
  const VisitNote({
    required this.actingAuthor,
    required this.addenda,
    required this.attestation,
    required this.attestations,
    required this.author,
    this.canAttest,
    this.canCosign,
    required this.completedAt,
    this.contentHash,
    required this.corrections,
    required this.group,
    this.heldBecause,
    this.medical,
    required this.noteId,
    required this.noteTypeKey,
    required this.noteTypeVersion,
    required this.read,
    required this.recap,
    required this.signoffs,
    required this.status,
    required this.title,
  });

  final UserRef actingAuthor;
  final List<AddendumView> addenda;
  final NoteAttestation attestation;
  final List<AttestationView> attestations;
  final UserRef author;
  /// The reader may attest it now: the attestation’s own rule asked as if the hash matched (lifecycle 5.4)
  final bool? canAttest;
  /// The reader may co-sign it now: the co-sign’s own rule asked as if the hash matched, as a queue’s canAct is (lifecycle 5.3)
  final bool? canCosign;
  final DateTime? completedAt;
  /// The note as it is now (lifecycle 4.5), to send with a co-sign or an attest: only to a reader who acts as its author, sees every answer of any note, or may co-sign or attest and sees every answer of this one
  final String? contentHash;
  final List<CorrectionView> corrections;
  final TimelineGroup group;
  final NoteHeldBecause? heldBecause;
  /// A Medical note: completed for a co-signer or signed, and attested when it waits (lifecycle 3.1)
  final bool? medical;
  final String noteId;
  final String noteTypeKey;
  final int noteTypeVersion;
  final ReadModel read;
  /// One line per section with an answer, in the definition’s order, over what the reader may see of the note; nothing from a sensitive exam, for any reader
  final List<RecapLine> recap;
  final List<SignoffView> signoffs;
  final NoteStatus status;
  final String title;

  factory VisitNote.fromJson(Map<String, dynamic> json) => VisitNote(
        actingAuthor: UserRef.fromJson(json['actingAuthor'] as Map<String, dynamic>),
        addenda: (json['addenda'] as List<dynamic>).map((e) => AddendumView.fromJson(e as Map<String, dynamic>)).toList(),
        attestation: NoteAttestation.fromJson(json['attestation'] as String),
        attestations: (json['attestations'] as List<dynamic>).map((e) => AttestationView.fromJson(e as Map<String, dynamic>)).toList(),
        author: UserRef.fromJson(json['author'] as Map<String, dynamic>),
        canAttest: json['canAttest'] == null ? null : json['canAttest'] as bool,
        canCosign: json['canCosign'] == null ? null : json['canCosign'] as bool,
        completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
        contentHash: json['contentHash'] == null ? null : json['contentHash'] as String,
        corrections: (json['corrections'] as List<dynamic>).map((e) => CorrectionView.fromJson(e as Map<String, dynamic>)).toList(),
        group: TimelineGroup.fromJson(json['group'] as String),
        heldBecause: json['heldBecause'] == null ? null : NoteHeldBecause.fromJson(json['heldBecause'] as String),
        medical: json['medical'] == null ? null : json['medical'] as bool,
        noteId: json['noteId'] as String,
        noteTypeKey: json['noteTypeKey'] as String,
        noteTypeVersion: (json['noteTypeVersion'] as num).toInt(),
        read: ReadModel.fromJson(json['read'] as Map<String, dynamic>),
        recap: (json['recap'] as List<dynamic>).map((e) => RecapLine.fromJson(e as Map<String, dynamic>)).toList(),
        signoffs: (json['signoffs'] as List<dynamic>).map((e) => SignoffView.fromJson(e as Map<String, dynamic>)).toList(),
        status: NoteStatus.fromJson(json['status'] as String),
        title: json['title'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'actingAuthor': actingAuthor.toJson(),
        'addenda': addenda.map((e) => e.toJson()).toList(),
        'attestation': attestation.toJson(),
        'attestations': attestations.map((e) => e.toJson()).toList(),
        'author': author.toJson(),
        if (canAttest != null) 'canAttest': canAttest!,
        if (canCosign != null) 'canCosign': canCosign!,
        'completedAt': completedAt == null ? null : completedAt!.toUtc().toIso8601String(),
        if (contentHash != null) 'contentHash': contentHash!,
        'corrections': corrections.map((e) => e.toJson()).toList(),
        'group': group.toJson(),
        if (heldBecause != null) 'heldBecause': heldBecause!.toJson(),
        if (medical != null) 'medical': medical!,
        'noteId': noteId,
        'noteTypeKey': noteTypeKey,
        'noteTypeVersion': noteTypeVersion,
        'read': read.toJson(),
        'recap': recap.map((e) => e.toJson()).toList(),
        'signoffs': signoffs.map((e) => e.toJson()).toList(),
        'status': status.toJson(),
        'title': title,
      };
}

class VisitRead {
  const VisitRead({
    required this.addenda,
    required this.clockVerified,
    required this.encounterId,
    this.hasHandoff,
    required this.kind,
    required this.locationText,
    required this.notes,
    required this.patientId,
    this.preferredName,
    required this.records,
    this.recordsOnAnotherChart,
    required this.startedAt,
    required this.status,
    this.summary,
  });

  /// The visit’s own, naming no note
  final List<AddendumView> addenda;
  final bool clockVerified;
  final String encounterId;
  /// The visit’s Red flags note, as the reader may read it, shows Show handoff (EMS was activated): GET /v1/encounters/{encounterId}/ems-handoff would give its file (lifecycle 5.7, 9.11)
  final bool? hasHandoff;
  final EncounterKind kind;
  final String? locationText;
  /// The notes the reader may see; no empty draft
  final List<VisitNote> notes;
  final String? patientId;
  /// The patient’s preferred name, from the chart they were merged into when they were, as a queue row shows it; null for a visit with no patient
  final String? preferredName;
  /// Referrals, allergies, problems and problem notes made at the visit, whichever chart they are on, as the reader may see them
  final List<RecordSnapshot> records;
  /// The IDs of the records above that are on a chart other than the visit’s now, by the patients’ charts: a record kept under a merged ID of the visit’s own patient is on its chart; every record of a visit with no patient is on another
  final List<String>? recordsOnAnotherChart;
  final DateTime startedAt;
  final NoteStatus status;
  /// Absent for a Medical visit to a reader of no Medical notes
  final String? summary;

  factory VisitRead.fromJson(Map<String, dynamic> json) => VisitRead(
        addenda: (json['addenda'] as List<dynamic>).map((e) => AddendumView.fromJson(e as Map<String, dynamic>)).toList(),
        clockVerified: json['clockVerified'] as bool,
        encounterId: json['encounterId'] as String,
        hasHandoff: json['hasHandoff'] == null ? null : json['hasHandoff'] as bool,
        kind: EncounterKind.fromJson(json['kind'] as String),
        locationText: json['locationText'] == null ? null : json['locationText'] as String,
        notes: (json['notes'] as List<dynamic>).map((e) => VisitNote.fromJson(e as Map<String, dynamic>)).toList(),
        patientId: json['patientId'] == null ? null : json['patientId'] as String,
        preferredName: json['preferredName'] == null ? null : json['preferredName'] as String,
        records: (json['records'] as List<dynamic>).map((e) => RecordSnapshot.fromJson(e as Map<String, dynamic>)).toList(),
        recordsOnAnotherChart: json['recordsOnAnotherChart'] == null ? null : (json['recordsOnAnotherChart'] as List<dynamic>).map((e) => e as String).toList(),
        startedAt: DateTime.parse(json['startedAt'] as String),
        status: NoteStatus.fromJson(json['status'] as String),
        summary: json['summary'] == null ? null : json['summary'] as String,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'addenda': addenda.map((e) => e.toJson()).toList(),
        'clockVerified': clockVerified,
        'encounterId': encounterId,
        if (hasHandoff != null) 'hasHandoff': hasHandoff!,
        'kind': kind.toJson(),
        'locationText': locationText == null ? null : locationText!,
        'notes': notes.map((e) => e.toJson()).toList(),
        'patientId': patientId == null ? null : patientId!,
        if (preferredName != null) 'preferredName': preferredName == null ? null : preferredName!,
        'records': records.map((e) => e.toJson()).toList(),
        if (recordsOnAnotherChart != null) 'recordsOnAnotherChart': recordsOnAnotherChart!.map((e) => e).toList(),
        'startedAt': startedAt.toUtc().toIso8601String(),
        'status': status.toJson(),
        if (summary != null) 'summary': summary == null ? null : summary!,
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

  /// Archive a preset no active preset names, with a reason (recent sign-in); nothing is deleted
  Future<PresetRevision> archivePreset({required String kind, required String id, required ArchivePreset body}) async {
    final json = await _transport.send('POST', '/v1/admin/presets/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}/archive', body: body.toJson());
    return PresetRevision.fromJson(json as Map<String, dynamic>);
  }

  /// Archive a custom role nobody holds
  Future<Role> archiveRole({required String roleId}) async {
    final json = await _transport.send('POST', '/v1/team/roles/${Uri.encodeComponent(roleId)}/archive');
    return Role.fromJson(json as Map<String, dynamic>);
  }

  /// Put another clinician in the place of a note’s author who has left the team
  Future<NoteAssigned> assignNote({required String noteId, required AssignInput body}) async {
    final json = await _transport.send('POST', '/v1/notes/${Uri.encodeComponent(noteId)}/assign', body: body.toJson());
    return NoteAssigned.fromJson(json as Map<String, dynamic>);
  }

  /// Attest the visit’s signed notes that wait for attestation, all or nothing
  Future<NoteActResult> attestEncounter({required String encounterId, required NoteActInput body}) async {
    final json = await _transport.send('POST', '/v1/encounters/${Uri.encodeComponent(encounterId)}/attest', body: body.toJson());
    return NoteActResult.fromJson(json as Map<String, dynamic>);
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

  /// Co-sign the visit’s notes that wait for a co-signer, all or nothing
  Future<NoteActResult> cosignEncounter({required String encounterId, required NoteActInput body}) async {
    final json = await _transport.send('POST', '/v1/encounters/${Uri.encodeComponent(encounterId)}/cosign', body: body.toJson());
    return NoteActResult.fromJson(json as Map<String, dynamic>);
  }

  /// Add a preset of the team’s own, with a reason (recent sign-in)
  Future<CreatePresetResult> createPreset({required String kind, required CreatePreset body}) async {
    final json = await _transport.send('POST', '/v1/admin/presets/${Uri.encodeComponent(kind)}', body: body.toJson());
    return CreatePresetResult.fromJson(json as Map<String, dynamic>);
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

  /// Give a preset its next version, with a reason (recent sign-in); what is fixed at creation stays
  Future<EditPresetResult> editPreset({required String kind, required String id, required EditPreset body}) async {
    final json = await _transport.send('PUT', '/v1/admin/presets/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}', body: body.toJson());
    return EditPresetResult.fromJson(json as Map<String, dynamic>);
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

  /// The team’s visits with notes that wait for attestation, oldest first
  Future<SignatureQueue> getAttestationQueue() async {
    final json = await _transport.send('GET', '/v1/team/attestation-queue');
    return SignatureQueue.fromJson(json as Map<String, dynamic>);
  }

  /// The team’s visits with notes that wait for a co-signature, oldest first
  Future<SignatureQueue> getCosignQueue() async {
    final json = await _transport.send('GET', '/v1/team/cosign-queue');
    return SignatureQueue.fromJson(json as Map<String, dynamic>);
  }

  /// Both charts of a pair side by side, with what matched and earlier decisions
  Future<DuplicatePairDetail> getDuplicatePair({required String pairId}) async {
    final json = await _transport.send('GET', '/v1/team/duplicates/${Uri.encodeComponent(pairId)}');
    return DuplicatePairDetail.fromJson(json as Map<String, dynamic>);
  }

  // getEmsHandoff (GET /v1/encounters/{encounterId}/ems-handoff) is not here: it answers application/pdf, not JSON.

  /// A visit as the reader may see it: its notes laid out for reading, and what hangs off them
  Future<VisitRead> getEncounter({required String encounterId}) async {
    final json = await _transport.send('GET', '/v1/encounters/${Uri.encodeComponent(encounterId)}');
    return VisitRead.fromJson(json as Map<String, dynamic>);
  }

  /// Liveness, database reachability and whether this is a demo deployment
  Future<Health> getHealth() async {
    final json = await _transport.send('GET', '/v1/health');
    return Health.fromJson(json as Map<String, dynamic>);
  }

  /// The numbers Home shows: notes to finish, the queues, the team’s incomplete notes
  Future<HomeCounts> getHomeCounts() async {
    final json = await _transport.send('GET', '/v1/me/counts');
    return HomeCounts.fromJson(json as Map<String, dynamic>);
  }

  /// The patient’s Street Medicine ID cards: active links with their URLs, and history
  Future<IdLinkState> getIdLinks({required String patientId}) async {
    final json = await _transport.send('GET', '/v1/patients/${Uri.encodeComponent(patientId)}/id-link');
    return IdLinkState.fromJson(json as Map<String, dynamic>);
  }

  /// Every draft of the team, with its author, whether they are still a member, and whether it is overdue
  Future<IncompleteNotes> getIncompleteNotes({String? author}) async {
    final json = await _transport.send('GET', '/v1/team/incomplete-notes', query: <String, String>{if (author != null) 'author': (author).toString()}, );
    return IncompleteNotes.fromJson(json as Map<String, dynamic>);
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

  /// Who may be put in the place of a note’s author who has left the team
  Future<NoteAssignees> getNoteAssignees({required String noteId}) async {
    final json = await _transport.send('GET', '/v1/notes/${Uri.encodeComponent(noteId)}/assignees');
    return NoteAssignees.fromJson(json as Map<String, dynamic>);
  }

  /// The drafts the caller acts as the author of, with whether each is overdue
  Future<NotesToFinish> getNotesToFinish() async {
    final json = await _transport.send('GET', '/v1/me/notes-to-finish');
    return NotesToFinish.fromJson(json as Map<String, dynamic>);
  }

  /// One version of a note type, resolved. It never changes, so it may be kept
  Future<NoteTypeDefinition> getNoteTypeDefinition({required String key, required String version}) async {
    final json = await _transport.send('GET', '/v1/forms/note-types/${Uri.encodeComponent(key)}/${Uri.encodeComponent(version)}');
    return NoteTypeDefinition.fromJson(json as Map<String, dynamic>);
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

  /// The patient’s earlier visits, 50 at a time, after the last one shown
  Future<TimelinePage> getPatientTimeline({required String patientId, String? before}) async {
    final json = await _transport.send('GET', '/v1/patients/${Uri.encodeComponent(patientId)}/timeline', query: <String, String>{if (before != null) 'before': (before).toString()}, );
    return TimelinePage.fromJson(json as Map<String, dynamic>);
  }

  /// Every act on a preset, oldest first, with who, when and why, and the body of its version
  Future<List<PresetEvent>> getPresetHistory({required String kind, required String id}) async {
    final json = await _transport.send('GET', '/v1/admin/presets/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}/history');
    return (json as List<dynamic>).map((e) => PresetEvent.fromJson(e as Map<String, dynamic>)).toList();
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

  /// The team’s active flags the caller may see, for the portal’s Flags panel and search filters
  Future<List<ListedFlag>> listFlags() async {
    final json = await _transport.send('GET', '/v1/presets/flags');
    return (json as List<dynamic>).map((e) => ListedFlag.fromJson(e as Map<String, dynamic>)).toList();
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

  /// The team’s note types, each at its newest version
  Future<NoteTypeList> listNoteTypes() async {
    final json = await _transport.send('GET', '/v1/forms/note-types');
    return NoteTypeList.fromJson(json as Map<String, dynamic>);
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

  /// Every preset of a kind, archived ones too, with what names each and any update on offer
  Future<List<PresetView>> listPresets({required String kind}) async {
    final json = await _transport.send('GET', '/v1/admin/presets/${Uri.encodeComponent(kind)}');
    return (json as List<dynamic>).map((e) => PresetView.fromJson(e as Map<String, dynamic>)).toList();
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

  /// Mark a flag change of the chart entered in error, once, with a reason
  Future<MarkFlagChangeResult> markFlagChangeInError({required String patientId, required String changeId, required MarkFlagChange body}) async {
    final json = await _transport.send('POST', '/v1/patients/${Uri.encodeComponent(patientId)}/flag-changes/${Uri.encodeComponent(changeId)}/entered-in-error', body: body.toJson());
    return MarkFlagChangeResult.fromJson(json as Map<String, dynamic>);
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

  /// The team’s presets changed since a revision, for the phone’s copy (any member)
  Future<PresetsPull> pullPresets({String? since, String? epoch}) async {
    final json = await _transport.send('GET', '/v1/presets', query: <String, String>{if (since != null) 'since': (since).toString(), if (epoch != null) 'epoch': (epoch).toString()}, );
    return PresetsPull.fromJson(json as Map<String, dynamic>);
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

  /// Put a tier’s active flags in the order sent, each at the version its list showed, with a reason (recent sign-in)
  Future<ReorderFlagsResult> reorderFlags({required ReorderFlags body}) async {
    final json = await _transport.send('POST', '/v1/admin/preset-order/flag', body: body.toJson());
    return ReorderFlagsResult.fromJson(json as Map<String, dynamic>);
  }

  /// Restore an archived preset at the version it is at, with a reason (recent sign-in)
  Future<PresetRevision> restorePreset({required String kind, required String id, required RestorePreset body}) async {
    final json = await _transport.send('POST', '/v1/admin/presets/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}/restore', body: body.toJson());
    return PresetRevision.fromJson(json as Map<String, dynamic>);
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

  /// Set or clear a flag on the patient, with a reason. A retry of the same form gets the first answer.
  Future<SetPatientFlagResult> setPatientFlag({required String patientId, required SetPatientFlag body}) async {
    final json = await _transport.send('POST', '/v1/patients/${Uri.encodeComponent(patientId)}/flags', body: body.toJson());
    return SetPatientFlagResult.fromJson(json as Map<String, dynamic>);
  }

  /// Send change entries; get a receipt for each (accepted with hash, rejected with reason, or conflict)
  Future<SyncPushResult> syncPush({required SyncPush body}) async {
    final json = await _transport.send('POST', '/v1/sync/push', body: body.toJson());
    return SyncPushResult.fromJson(json as Map<String, dynamic>);
  }

  /// Take the platform’s newer version of a preset, in place or as a new preset, with a reason (recent sign-in)
  Future<TakePresetUpdateResult> takePresetUpdate({required String kind, required String id, required TakePresetUpdate body}) async {
    final json = await _transport.send('POST', '/v1/admin/presets/${Uri.encodeComponent(kind)}/${Uri.encodeComponent(id)}/take-update', body: body.toJson());
    return TakePresetUpdateResult.fromJson(json as Map<String, dynamic>);
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
