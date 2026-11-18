/// Who is charting, as the phone knows them (phase 4 design, lifecycle 3.5, 6.2 and 6.4): their
/// role's permission keys and their credential, as `/v1/me` last reported them, and what that
/// credential may do. The server decides again from the membership it holds; the phone uses this
/// to show what the server would show and to offer what it would accept.
library;

import '../forms/visible.dart';
import '../patients/access.dart';
import '../patients/generated/sensitive_codes.dart';

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

/// The person using the phone in the open team.
class EncounterUser {
  EncounterUser({required this.userId, required this.credential, required Iterable<String> permissions})
    : permissions = Set.unmodifiable(permissions);

  final String userId;

  /// The credential's code (`attending` ... `none`).
  final String credential;
  final Set<String> permissions;

  CredentialCapabilities get can => capabilitiesOf(credential);

  /// Reads Medical notes, and a Medical visit's summary: `patients.view` with `encounters.chart` or
  /// `billing.view_codes`, the rule D37 set for the problem list (lifecycle 6.4, row 1).
  bool get readsMedical => mayViewProblems(permissions);

  /// Charts: starts visits, adds notes, changes drafts (lifecycle 3.1, the draft rule).
  bool get charts => permissions.contains('encounters.chart');

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
