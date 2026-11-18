/// A visit and its notes as the person may see them (phase 4 design, lifecycle 3.1, 5.1, 6.4, 9.7):
/// what the visit screen, the encounter screen and the note screen draw, whichever source it was
/// read from. Everything here was worked out for one reader; nothing they may not see is in it.
library;

import '../api/generated/api.dart' show RecordSnapshot;
// The form's own contract types (forms 8.1): a note's conflicts are handed to it as they are.
import '../forms/answer_state.dart' show AnswerConflict;
import '../forms/definition.dart';
import '../forms/read_model.dart';
import '../forms/recap.dart';
import 'rules.dart';

/// A visit's kind. [code] is the wire value.
enum VisitKind {
  medical('medical'),
  nonMedical('non_medical');

  const VisitKind(this.code);
  final String code;

  static VisitKind fromCode(Object? code) => code == medical.code ? medical : nonMedical;
}

/// Where a visit was read from (lifecycle 9.7, 8.2): the phone's own copy; the chart's recent
/// visits, offline; or the server, online.
enum VisitSource { phone, chart, server }

/// A note's state in the words the apps show (lifecycle 3.1's first column).
enum NoteShown {
  draft,

  /// A Non-Medical note completed.
  complete,

  /// A Medical note completed by someone who can't sign.
  waitingForCosigner,
  signed,
  waitingForAttestation,
  attested,
}

/// Lifecycle 3.1's table: a completed note waits for a co-signer only when it is Medical.
NoteShown noteShown({required NoteStatus status, required Attestation attestation, required bool medical}) =>
    switch ((status, attestation)) {
      (NoteStatus.draft, _) => NoteShown.draft,
      (NoteStatus.completed, _) => medical ? NoteShown.waitingForCosigner : NoteShown.complete,
      (NoteStatus.signed, Attestation.waiting) => NoteShown.waitingForAttestation,
      (NoteStatus.signed, Attestation.attested) => NoteShown.attested,
      (NoteStatus.signed, Attestation.notNeeded) => NoteShown.signed,
    };

/// A Medical note is one whose type is offered for Medical visits only (lifecycle 3.1).
bool isMedicalType(NoteTypeDef definition) => !definition.kinds.contains(NoteKind.nonMedical);

/// Someone a visit names. [name] is null where the phone does not know it: the person themselves,
/// and a teammate whose record carries only their ID.
class PersonRef {
  const PersonRef(this.userId, {this.name});
  final String userId;
  final String? name;
}

/// Where a record made here stands with the server.
enum Sending {
  /// Confirmed, or never made here.
  sent,

  /// "Waiting to send": its create waits in the outbox.
  waiting,

  /// Refused: it waits in Needs attention.
  refused,
}

/// A sign-off of a note (lifecycle 4.6): a Complete, a signature, or a co-signature.
class SignoffItem {
  const SignoffItem({
    required this.id,
    required this.signer,
    required this.act,
    required this.effect,
    required this.credential,
    required this.signedAt,
    required this.clockVerified,
    required this.statementVersion,
    required this.needsAttestation,
    required this.sending,
  });

  final String id;
  final PersonRef signer;

  /// `complete`, `sign` or `cosign`.
  final String act;

  /// What it did, as the server stored it: `completed`, `signed`, `saved_unsigned` or `none`; null
  /// while the phone does not know (made here, no refresh since).
  final String? effect;

  /// The credential it was made under: the server's, or the one claimed for one made here.
  final String? credential;

  /// When it was made, by the server's record, or by this phone's clock while it waits here; null
  /// once confirmed and before a refresh brings the server's.
  final DateTime? signedAt;
  final bool clockVerified;
  final String statementVersion;
  final bool? needsAttestation;
  final Sending sending;
}

/// An addendum (lifecycle 3.6): below a note, or below the visit itself when [noteId] is null.
class AddendumItem {
  const AddendumItem({
    required this.id,
    required this.noteId,
    required this.author,
    required this.credential,
    required this.text,
    required this.writtenAt,
    required this.clockVerified,
    required this.sending,
  });

  final String id;
  final String? noteId;
  final PersonRef author;
  final String? credential;
  final String text;
  final DateTime? writtenAt;
  final bool clockVerified;
  final Sending sending;
}

/// A correction of a finished note, or a patient's amendment request (lifecycle 3.6). Its values are
/// in the note's read model, which strikes through each old one under the new (forms 7.1).
class CorrectionItem {
  const CorrectionItem({
    required this.id,
    required this.corrector,
    required this.credential,
    required this.fields,
    required this.outcome,
    required this.reason,
    required this.requestedByPatient,
    required this.declined,
    required this.correctedAt,
    required this.clockVerified,
    required this.sending,
  });

  final String id;
  final PersonRef corrector;
  final String? credential;

  /// The answers it changes, each `data.<path>`.
  final List<String> fields;

  /// `corrected`, `declined`, `no_change`, `draft_edit` or `not_author`, as the server decided; null
  /// until the phone learns it.
  final String? outcome;
  final String reason;
  final bool requestedByPatient;

  /// Asked to be recorded as a declined amendment request.
  final bool declined;
  final DateTime? correctedAt;
  final bool clockVerified;
  final Sending sending;
}

/// An attending's attestation of a signature (lifecycle 3.7): online only, so only the server's read
/// carries one.
class AttestationItem {
  const AttestationItem({
    required this.id,
    required this.signoffId,
    required this.attending,
    required this.attestedAt,
    required this.statementVersion,
  });
  final String id;
  final String signoffId;
  final PersonRef attending;
  final DateTime attestedAt;
  final String statementVersion;
}

/// A note as one reader may see it.
class NoteView {
  const NoteView({
    required this.noteId,
    required this.encounterId,
    required this.noteTypeKey,
    required this.noteTypeVersion,
    required this.definition,
    required this.author,
    required this.actingAuthor,
    required this.actsAsAuthor,
    required this.status,
    required this.attestation,
    required this.waitingToSend,
    required this.sentForReview,
    required this.editable,
    required this.answers,
    required this.pendingPaths,
    required this.read,
    required this.recap,
    required this.signoffs,
    required this.addenda,
    required this.corrections,
    required this.attestations,
    required this.notSynced,
    this.title,
    this.contentHash,
    this.conflicts = const {},
  });

  final String noteId;
  final String encounterId;
  final String noteTypeKey;

  /// Null for a note written before note types had versions (phase 2).
  final int? noteTypeVersion;

  /// The definition of the note's own key and version; null when the phone does not hold it (and
  /// could not fetch it): then the note is listed for whoever acts as its author, with nothing of
  /// its answers ([unreadable]), and left out for anyone else, as the server leaves out a note it
  /// cannot lay out (lifecycle 5.1).
  final NoteTypeDef? definition;
  final PersonRef author;

  /// Who acts as the author (lifecycle 3.8): the assignee after the author left, else the author.
  final PersonRef actingAuthor;

  /// The reader acts as the author: they see all of it, and Complete and reopen are theirs.
  final bool actsAsAuthor;

  /// As this phone knows it: what its own sign-off is expected to make it until the receipt, else
  /// the server's (`LocalStore.noteState`).
  final NoteStatus status;
  final Attestation attestation;

  /// "Waiting to send": finished here, its sign-off not confirmed yet, and not sent for review
  /// (lifecycle 4.8).
  final bool waitingToSend;

  /// "Sent for review": the server holds this phone's sign-off of it for a Program Admin.
  final bool sentForReview;

  /// The reader may change its answers now (the draft rule, lifecycle 3.1): a draft as this phone
  /// knows it, a definition to check answers by, `encounters.chart`, and for a Medical note a
  /// credential that charts Medical (4.2). A field that could hold what the reader may not see is
  /// still read-only to someone who does not act as the author (9.5).
  final bool editable;

  /// The answers the reader sees, by path. Whoever acts as the author of a draft gets every answer
  /// stored, those a condition hides included, so the form keeps them for when the field shows
  /// again (forms 8.1); everyone else, and the author of a finished note, the answers that count
  /// that `visibleAnswers` gives them. Empty for an [unreadable] note.
  final Map<String, Object?> answers;

  /// Answers changed here and not yet confirmed ("Waiting to send" under the field).
  final Set<String> pendingPaths;

  /// By path, each answer two people changed (lifecycle 9.5): the value on the server beside the
  /// one in [answers], until the person chooses; the choice is null while charting is paused for the
  /// phone's clock (3.11). Only a value the reader may see is given; none in the server's read.
  final Map<String, AnswerConflict> conflicts;

  /// The note laid out for reading, with the corrections the reader may see; null when the phone laid
  /// it out and [unreadable].
  final ReadModel? read;

  /// One line per section (lifecycle 8.1), nothing from a sensitive exam for anyone; empty when
  /// [unreadable].
  final List<RecapLine> recap;

  /// In the order the phone holds them.
  final List<SignoffItem> signoffs;
  final List<AddendumItem> addenda;
  final List<CorrectionItem> corrections;
  final List<AttestationItem> attestations;

  /// Its create waits here.
  final bool notSynced;

  /// Its note type's title: the definition's, or the server's where the phone lacks the definition.
  final String? title;

  /// The note as the server holds it (lifecycle 4.5), which co-sign and attest send back: only in the
  /// server's read (5.1), and there only to a reader who acts as its author, sees every answer of any
  /// note, or may co-sign or attest it and sees every answer of it that counts.
  final String? contentHash;

  /// The phone lacks its definition. A note the server read keeps its [read] all the same.
  bool get unreadable => definition == null;

  /// Medical, by its type; null when [unreadable].
  bool? get medical => definition == null ? null : isMedicalType(definition!);

  /// Its state in the apps' words; a note whose type the phone does not hold is read as Medical
  /// when completed, the state that asks more of it.
  NoteShown get shown => noteShown(status: status, attestation: attestation, medical: medical ?? true);

  /// Finished as this phone knows it.
  bool get finished => status != NoteStatus.draft;

  /// Every record of this note the reader is shown: the note and what hangs off it.
  Iterable<String> get shownIds => [
    noteId,
    for (final s in signoffs) s.id,
    for (final a in addenda) a.id,
    for (final c in corrections) c.id,
    for (final a in attestations) a.id,
  ];
}

/// A visit as one reader may see it (lifecycle 5.1, 9.7).
class VisitView {
  const VisitView({
    required this.encounterId,
    required this.source,
    required this.patientId,
    required this.kind,
    required this.status,
    required this.startedAt,
    required this.clockVerified,
    required this.locationText,
    required this.summary,
    required this.summaryHidden,
    required this.envelopeLocked,
    required this.addenda,
    required this.notes,
    required this.notSynced,
    required this.pendingFields,
    this.records = const [],
  });

  final String encounterId;
  final VisitSource source;
  final String? patientId;
  final VisitKind kind;

  /// Worked out from the notes shown (`encounterStatus`), so it says nothing of a note left out.
  final NoteStatus status;

  /// When it started, by the server's record, or by this phone's clock while its create waits here;
  /// null once confirmed and before a refresh brings the server's.
  final DateTime? startedAt;

  /// False: "time not verified".
  final bool clockVerified;
  final String? locationText;

  /// The assessment; null when there is none, or when [summaryHidden].
  final String? summary;

  /// A Medical visit's summary is Medical content: withheld from a reader of no Medical notes, with
  /// the visit's own addenda (lifecycle 5.1).
  final bool summaryHidden;

  /// The patient, the place and the summary are locked: a note of the visit is finished, here or on
  /// the server (lifecycle 3.1). A person who finishes their notes after that adds to the assessment
  /// with an addendum to the visit (9.6).
  final bool envelopeLocked;

  /// The visit's own, naming no note.
  final List<AddendumItem> addenda;

  /// The notes the reader may see, an empty draft left out (lifecycle 3.1, 9.4).
  final List<NoteView> notes;

  /// Its create waits here.
  final bool notSynced;

  /// Envelope fields changed here and not yet confirmed.
  final Set<String> pendingFields;

  /// The records made at the visit (referrals, allergies, problems and problem notes, whichever chart
  /// they are on, 9.7, D91), as the server's read gives them to the reader; none in the phone's own
  /// read, whose records `VisitRecords.madeAt` reads and logs.
  final List<RecordSnapshot> records;

  bool get medical => kind == VisitKind.medical;

  /// Every record the reader is shown: the visit, its addenda, its notes and what hangs off them, and
  /// the records made at it. A read logs each once; pass it back to log only what a later read adds.
  Set<String> get shownIds => {
    encounterId,
    for (final a in addenda) a.id,
    for (final n in notes) ...n.shownIds,
    for (final r in records) r.id,
  };
}
