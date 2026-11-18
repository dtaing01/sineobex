/// Who is charting, as the phone knows them (phase 4 design, lifecycle 3.5, 6.2 and 6.4): their
/// role's permission keys and their credential, as `/v1/me` last reported them, and what that
/// credential may do. The server decides again from the membership it holds; the phone uses this
/// to show what the server would show and to offer what it would accept.
library;

import '../forms/visible.dart';
import '../patients/access.dart';
import '../patients/generated/sensitive_codes.dart';
import '../sync/local_store.dart' show Signer;

/// What a credential may do (services/api/src/auth/permissions.ts `CredentialCapabilities`, less
/// the rank, which only the server's credential change reads).
typedef CredentialCapabilities = ({
  bool chartMedical,
  bool orderMedications,
  bool sign,
  bool attest,
  bool billingNeedsAttestation,
});

/// A copy of permissions.ts `CAPABILITIES`. test/encounters/credentials_test.dart reads that file
/// and fails when the two differ, since no vector carries the table.
const credentialCapabilities = <String, CredentialCapabilities>{
  'attending': (chartMedical: true, orderMedications: true, sign: true, attest: true, billingNeedsAttestation: false),
  'resident': (chartMedical: true, orderMedications: true, sign: true, attest: false, billingNeedsAttestation: true),
  'np': (chartMedical: true, orderMedications: true, sign: true, attest: false, billingNeedsAttestation: true),
  'pa': (chartMedical: true, orderMedications: true, sign: true, attest: false, billingNeedsAttestation: true),
  'student': (chartMedical: true, orderMedications: false, sign: false, attest: false, billingNeedsAttestation: true),
  'chw': (chartMedical: false, orderMedications: false, sign: false, attest: false, billingNeedsAttestation: false),
  'none': (chartMedical: false, orderMedications: false, sign: false, attest: false, billingNeedsAttestation: false),
};

/// [credential]'s capabilities; a credential this app does not know may do nothing, so the phone
/// never offers what an unknown credential might not hold.
CredentialCapabilities capabilitiesOf(String credential) =>
    credentialCapabilities[credential] ?? credentialCapabilities['none']!;

/// A credential in words, as the portal words it (apps/portal/src/lib/labels.ts); null for one this
/// app version doesn't know, which is then left out rather than shown as a code. The read view and
/// the signing sentence both word a credential with it.
String? credentialText(String code) => switch (code) {
  'attending' => 'Attending physician',
  'resident' => 'Resident',
  'np' => 'Nurse practitioner',
  'pa' => 'Physician assistant',
  'student' => 'Student or volunteer',
  'chw' => 'Community health worker',
  'none' => 'No clinical credential',
  _ => null,
};

/// The person using the phone in the open team.
class EncounterUser {
  EncounterUser({
    required this.userId,
    required this.displayName,
    required this.credential,
    required Iterable<String> permissions,
  }) : permissions = Set.unmodifiable(permissions);

  final String userId;

  /// Their name as the saved profile has it (`LocalUser.displayName`, from `/v1/me`): the name the
  /// signing sentence signs under (lifecycle 3.5).
  final String displayName;

  /// The credential's code (`attending` ... `none`).
  final String credential;
  final Set<String> permissions;

  CredentialCapabilities get can => capabilitiesOf(credential);

  /// Reads Medical notes, and a Medical visit's summary: `patients.view` with `encounters.chart` or
  /// `billing.view_codes`, the rule D37 set for the problem list (lifecycle 6.4, row 1).
  bool get readsMedical => mayViewProblems(permissions);

  /// Charts: starts visits, adds notes, changes drafts (lifecycle 3.1, the draft rule).
  bool get charts => permissions.contains('encounters.chart');

  /// The person as Complete names them to the store (lifecycle 3.3, 3.5, 4.8), from the saved
  /// profile: the credential a `sign` claims, whether it signs, and whether its signature waits for
  /// an attending. The server decides again from the membership it holds.
  Signer get signer => Signer(credential: credential, canSign: can.sign, needsAttestation: can.billingNeedsAttestation);

  /// The person as `visibleAnswers` reads them (records.ts noteReader): their keys and their
  /// credential now, and whether they act as the note's author (lifecycle 3.8).
  NoteReader reader({required bool actsAsAuthor}) => NoteReader(
    actsAsAuthor: actsAsAuthor,
    viewSensitive: permissions.contains('patients.view_sensitive'),
    viewSensitiveExams: permissions.contains('patients.view_sensitive_exams'),
    readsMedical: readsMedical,
    chartsMedical: can.chartMedical,
    ordersMedications: can.orderMedications,
    sensitiveCodes: sensitiveCodeRanges,
  );
}
