/// The rules of a note's life (phase 4 design, lifecycle 3.12). Pure: no database, no clock, no
/// network.
///
/// The server's services/api/src/encounters/rules.ts holds the same ten, and both are pinned by
/// packages/contract/test-vectors/note-lifecycle.json. The phone uses them to show at once what a
/// Complete, a reopen or a correction did; the server still decides, and its receipt corrects the
/// phone if it decided otherwise.
library;

/// A note's status. The names are the wire values.
enum NoteStatus { draft, completed, signed }

/// Whether an attending must still attest a signed note as it reads now. [code] is the wire value.
enum Attestation {
  notNeeded('not_needed'),
  waiting('waiting'),
  attested('attested');

  const Attestation(this.code);
  final String code;
}

/// What the person asked for when finishing a note. The names are the wire values.
enum SignoffAct { complete, sign }

/// Why a sign-off was refused. The fix is the same act again: open the note, look, Complete.
enum SignoffRefusal {
  contentChanged('content_changed'),
  incomplete('incomplete'),
  redFlagsFirst('red_flags_first');

  const SignoffRefusal(this.code);
  final String code;
}

/// Why a sign-off was stored and changed nothing.
enum SignoffUnchangedReason {
  alreadyFinished('already_finished'),
  notAuthor('not_author'),

  /// The draft is empty: it does not count, and there is nothing to fix by completing it.
  empty('empty');

  const SignoffUnchangedReason(this.code);
  final String code;
}

/// What a sign-off did to the note.
enum SignoffOutcome {
  completed('completed'),
  signed('signed'),

  /// The credential can't sign: the note is saved unsigned and waits for a co-signer.
  savedUnsigned('saved_unsigned');

  const SignoffOutcome(this.code);
  final String code;
}

sealed class SignoffEffect {
  const SignoffEffect();
}

/// The note stays a draft and the sign-off goes to Needs attention.
final class SignoffRefused extends SignoffEffect {
  const SignoffRefused(this.problem);
  final SignoffRefusal problem;
}

/// The sign-off is stored and the note is as it was (effect `none`).
final class SignoffUnchanged extends SignoffEffect {
  const SignoffUnchanged(this.reason);
  final SignoffUnchangedReason reason;
}

final class SignoffApplied extends SignoffEffect {
  const SignoffApplied(this.effect, {required this.statusAfter, required this.attestationAfter});
  final SignoffOutcome effect;
  final NoteStatus statusAfter;
  final Attestation attestationAfter;
}

/// What a `complete` or a `sign` does to a note (lifecycle 3.4). The first check that applies
/// decides, so the order below is the rule: a finished note is never looked at again, and a note
/// that changed since the person read it is refused before anything is said about its content. An
/// empty draft does not count (3.1) and has nothing to fix by completing, so its sign-off changes
/// nothing, which settles the refusal of an earlier one (Remove this note after a refused Complete).
///
/// [emptyDraft]: every answer of the draft is blank ([noteIsEmpty]). [redFlagsDone]: the visit has a
/// finished Red flags note, or this note is one.
SignoffEffect signoffEffect({
  required NoteStatus noteStatus,
  required bool medicalNote,
  required SignoffAct act,
  required bool actsAsAuthor,
  required bool canSign,
  required bool needsAttestation,
  required bool hashMatches,
  required bool emptyDraft,
  required bool finishOk,
  required bool redFlagsDone,
}) {
  if (noteStatus != NoteStatus.draft) return const SignoffUnchanged(SignoffUnchangedReason.alreadyFinished);
  if (!actsAsAuthor) return const SignoffUnchanged(SignoffUnchangedReason.notAuthor);
  if (!hashMatches) return const SignoffRefused(SignoffRefusal.contentChanged);
  if (emptyDraft) return const SignoffUnchanged(SignoffUnchangedReason.empty);
  if (!finishOk) return const SignoffRefused(SignoffRefusal.incomplete);
  if (medicalNote && !redFlagsDone) return const SignoffRefused(SignoffRefusal.redFlagsFirst);
  // A Non-Medical note is never signed (lifecycle 3.1), so `sign` on one is a `complete`.
  // PLAN-OPEN: is a Social needs or Outreach note inside a Medical visit signed and attested
  // (lifecycle 12.1 #19)? No.
  if (!medicalNote || act == SignoffAct.complete) {
    return const SignoffApplied(
      SignoffOutcome.completed,
      statusAfter: NoteStatus.completed,
      attestationAfter: Attestation.notNeeded,
    );
  }
  if (canSign) {
    return SignoffApplied(
      SignoffOutcome.signed,
      statusAfter: NoteStatus.signed,
      attestationAfter: needsAttestation ? Attestation.waiting : Attestation.notNeeded,
    );
  }
  // The credential was lowered while the phone was offline: kept, and routed to a co-signer.
  return const SignoffApplied(
    SignoffOutcome.savedUnsigned,
    statusAfter: NoteStatus.completed,
    attestationAfter: Attestation.notNeeded,
  );
}

/// What sending a note back to draft does.
enum ReopenEffect {
  apply('apply'),
  nothing('nothing'),

  /// The note stays as it is; the request is kept in its history, with a notice.
  keepInHistory('keep_in_history');

  const ReopenEffect(this.code);
  final String code;
}

/// What a `set` of a note's status to `draft` does (the table in lifecycle 4.4). Only a Medical
/// note that waits for a co-signer and was never signed goes back, and only for its acting author.
///
/// PLAN-OPEN: can a co-signer send a note back to its author (lifecycle 12.1 #8)? No: only the
/// author reopens it, while it was never signed.
ReopenEffect reopenEffect({
  required NoteStatus noteStatus,
  required bool everSigned,
  required bool medicalNote,
  required bool actsAsAuthor,
}) {
  if (noteStatus == NoteStatus.draft) return ReopenEffect.nothing;
  if (noteStatus == NoteStatus.signed || everSigned) return ReopenEffect.keepInHistory;
  if (!medicalNote) return ReopenEffect.keepInHistory;
  if (actsAsAuthor) return ReopenEffect.apply;
  return ReopenEffect.keepInHistory;
}

/// A note's state after a correction. [clearSignoff]: the note no longer has a current signature.
typedef CorrectionEffect = ({NoteStatus statusAfter, Attestation attestationAfter, bool clearSignoff});

/// What a correction that changed a finished note does to its state (the table in lifecycle 3.6).
/// A note is signed only while someone who may sign covers what it says now. Called for a
/// finished note only.
CorrectionEffect correctionEffect({
  required NoteStatus noteStatus,
  required Attestation attestation,
  required bool correctorCanSign,
  required bool correctorNeedsAttestation,
}) {
  if (noteStatus == NoteStatus.completed) {
    return (statusAfter: NoteStatus.completed, attestationAfter: attestation, clearSignoff: false);
  }
  if (!correctorCanSign) {
    return (statusAfter: NoteStatus.completed, attestationAfter: Attestation.notNeeded, clearSignoff: true);
  }
  if (correctorNeedsAttestation) {
    return (statusAfter: NoteStatus.signed, attestationAfter: Attestation.waiting, clearSignoff: false);
  }
  // A note that was waiting stays waiting: an attending who corrects one answer has not attested
  // the rest.
  return (statusAfter: NoteStatus.signed, attestationAfter: attestation, clearSignoff: false);
}

enum CosignRefusal {
  notWaiting('not_waiting'),
  isAuthor('is_author'),
  cannotSign('cannot_sign'),
  cannotSeeAll('cannot_see_all'),
  contentChanged('content_changed');

  const CosignRefusal(this.code);
  final String code;
}

sealed class CosignEffect {
  const CosignEffect();
}

final class CosignRefused extends CosignEffect {
  const CosignRefused(this.problem);
  final CosignRefusal problem;
}

/// The note becomes signed, with this attestation state.
final class Cosigned extends CosignEffect {
  const Cosigned(this.attestationAfter);
  final Attestation attestationAfter;
}

/// One note of an online co-sign (lifecycle 5.3). The refusals are checked in the order listed.
///
/// PLAN-OPEN: may a resident, NP or PA co-sign a student's note, or only an attending (lifecycle
/// 12.1 #6)? Any credential that signs; the note then waits for attestation if that credential
/// needs it.
CosignEffect cosignEffect({
  required NoteStatus noteStatus,
  required bool medicalNote,
  required bool actsAsAuthor,
  required bool canSign,
  required bool needsAttestation,
  required bool seesAllThatCounts,
  required bool hashMatches,
}) {
  if (noteStatus != NoteStatus.completed || !medicalNote) return const CosignRefused(CosignRefusal.notWaiting);
  if (actsAsAuthor) return const CosignRefused(CosignRefusal.isAuthor);
  if (!canSign) return const CosignRefused(CosignRefusal.cannotSign);
  if (!seesAllThatCounts) return const CosignRefused(CosignRefusal.cannotSeeAll);
  if (!hashMatches) return const CosignRefused(CosignRefusal.contentChanged);
  return Cosigned(needsAttestation ? Attestation.waiting : Attestation.notNeeded);
}

enum AttestRefusal {
  notWaiting('not_waiting'),
  isAuthor('is_author'),
  isSigner('is_signer'),
  cannotAttest('cannot_attest'),
  cannotSeeAll('cannot_see_all'),
  contentChanged('content_changed');

  const AttestRefusal(this.code);
  final String code;
}

/// One note of an online attestation (lifecycle 5.4): why it is refused, or null when the note
/// becomes attested. The refusals are checked in the order listed.
///
/// [isSigner]: the note's current signature is the caller's own.
AttestRefusal? attestEffect({
  required NoteStatus noteStatus,
  required Attestation attestation,
  required bool actsAsAuthor,
  required bool isSigner,
  required bool canAttest,
  required bool seesAllThatCounts,
  required bool hashMatches,
}) {
  if (noteStatus != NoteStatus.signed || attestation != Attestation.waiting) return AttestRefusal.notWaiting;
  if (actsAsAuthor) return AttestRefusal.isAuthor;
  if (isSigner) return AttestRefusal.isSigner;
  if (!canAttest) return AttestRefusal.cannotAttest;
  if (!seesAllThatCounts) return AttestRefusal.cannotSeeAll;
  if (!hashMatches) return AttestRefusal.contentChanged;
  return null;
}

enum AssignRefusal {
  authorActive('author_active'),
  assigneeNotMember('assignee_not_member'),
  assigneeCannotChart('assignee_cannot_chart'),
  credentialTooLow('credential_too_low'),
  cannotSeeAll('cannot_see_all');

  const AssignRefusal(this.code);
  final String code;
}

/// Whether a Program Admin may hand a departed author's note to this clinician (lifecycle 3.8,
/// 5.5): why not, or null when they may.
///
/// [neededRank]: the rank the note was signed under; for an unsigned note, of its author's last
/// credential. [noteHasHiddenSection]: the note holds an answer that counts in a section the
/// assignee's role cannot see today.
AssignRefusal? mayAssign({
  required bool actingAuthorActive,
  required bool assigneeActive,
  required bool assigneeCanChart,
  required int assigneeRank,
  required int neededRank,
  required bool noteHasHiddenSection,
}) {
  if (actingAuthorActive) return AssignRefusal.authorActive;
  if (!assigneeActive) return AssignRefusal.assigneeNotMember;
  if (!assigneeCanChart) return AssignRefusal.assigneeCannotChart;
  if (assigneeRank < neededRank) return AssignRefusal.credentialTooLow;
  if (noteHasHiddenSection) return AssignRefusal.cannotSeeAll;
  return null;
}

bool _isBlank(Object? value) =>
    value == null || value == '' || (value is List && value.isEmpty) || (value is Map && value.isEmpty);

/// True when every answer is null, "", [] or {}: the note counts as not there (lifecycle 3.1).
bool noteIsEmpty(Map<String, Object?> answers) => answers.values.every(_isBlank);

/// An encounter's status, from its notes (lifecycle 2.2). An empty draft does not count.
NoteStatus encounterStatus(Iterable<({NoteStatus status, bool medical, bool empty})> notes) {
  final counted = [
    for (final n in notes)
      if (!(n.status == NoteStatus.draft && n.empty)) n,
  ];
  if (counted.isEmpty) return NoteStatus.draft;
  if (counted.any((n) => n.status == NoteStatus.draft)) return NoteStatus.draft;
  if (counted.any((n) => n.status == NoteStatus.completed && n.medical)) return NoteStatus.completed;
  if (counted.any((n) => n.status == NoteStatus.signed)) return NoteStatus.signed;
  return NoteStatus.completed;
}

/// The patient, the place and the summary are locked from the first finished note on (lifecycle 3.1).
bool envelopeLocked(Iterable<NoteStatus> noteStatuses) => noteStatuses.any((s) => s != NoteStatus.draft);

/// A note still a draft this long after its visit started is overdue (PRD main 99; lifecycle 3.9).
const incompleteAfterHours = 24;

/// Whether a note is overdue (lifecycle 3.9). A start time the phone could not verify is not
/// believed once the server has one of its own: the time it received the encounter.
///
/// [receivedAt] is null for an encounter the server has not confirmed.
bool isOverdue({
  required NoteStatus noteStatus,
  required DateTime startedAt,
  required bool startedVerified,
  required DateTime? receivedAt,
  required DateTime now,
}) {
  if (noteStatus != NoteStatus.draft) return false;
  final start = !startedVerified && receivedAt != null ? receivedAt : startedAt;
  return now.difference(start) > const Duration(hours: incompleteAfterHours);
}
