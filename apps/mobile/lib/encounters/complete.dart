part of 'encounter_repository.dart';

// Complete, from the summary screen (phase 4 design, lifecycle 3.3, 3.5, 4.8, 9.6).

/// The wording a `sign` carries, stored on the sign-off (lifecycle 3.5): the sentence of
/// [signingSentence].
///
/// PLAN-OPEN: the wording a signer is shown (lifecycle 12.1 #5): the sentence of 3.5, with its
/// version.
const signStatementVersion = 'sign-2026-11';

/// The wording a `complete` carries. PLAN-OPEN: what is a person shown when they complete a note
/// without signing it, and which version is stored (lifecycle 12.1 #23)? No sentence is written yet;
/// the version names that.
const completeStatementVersion = 'complete-2026-11';

/// The signing sentence (lifecycle 3.5), shown above the button when a note will be signed: the
/// person's name as their saved profile has it, and their credential in words ([credentialText]).
/// A credential this app doesn't know is left out rather than shown as a code; it signs nothing.
String signingSentence(EncounterUser user) {
  final credential = credentialText(user.credential);
  return 'By completing, you sign this note as ${user.displayName}${credential == null ? '' : ', $credential'}.';
}

/// The Complete button, worded by what will happen (lifecycle 3.3).
enum CompleteButton {
  /// Every note is Non-Medical.
  complete,

  /// A Medical note will be signed.
  completeAndSign,

  /// A Medical note will wait for a co-signer.
  completeAndSendForCosignature,
}

/// What stops Complete (lifecycle 3.3's hard stops, and what the store refuses).
enum CompleteStop {
  /// Nothing of the person's to finish in the visit.
  nothingToComplete,

  /// Hard stop 1: a required answer is missing, at [CompleteBlock.section] and [CompleteBlock.path].
  missingAnswer,

  /// Hard stop 2: something about the visit or its notes waits in Needs attention.
  needsAttention,

  /// Hard stop 3, or the store is frozen for a hand-over.
  chartingPaused,

  /// Hard stop 4: a Medical note on a visit with no patient.
  needsPatient,

  /// Hard stop 5: no finished Red flags note, and none of the person's own to finish with the rest.
  redFlagsFirst,

  /// The note changed since the summary drew it (a sync brought a teammate's change in).
  noteChanged,

  /// The note's last Complete, before a reopen, has not been sent yet.
  waitingToSend,

  /// The server holds the note's sign-off for a Program Admin.
  sentForReview,

  /// The note is finished already.
  finished,

  /// The person does not act as the note's author.
  notAuthor,

  /// The phone lacks the definition of the note's own version.
  noDefinition,

  /// The person's role doesn't chart, or their credential doesn't chart Medical notes.
  notCharting,
  medicalCredential,

  /// What was added to the assessment can't be saved (too long).
  assessment,
}

/// One line of what stops Complete. [noteId] and [section] say where the summary jumps to;
/// [message] is the sentence shown.
class CompleteBlock {
  const CompleteBlock(this.stop, this.message, {this.noteId, this.section, this.path});
  final CompleteStop stop;
  final String message;
  final String? noteId;

  /// The section's ID, for the form's `openSection`.
  final String? section;
  final String? path;
}

/// One note Complete will finish, as the summary drew it.
class NoteToComplete {
  const NoteToComplete({
    required this.noteId,
    required this.definition,
    required this.shownHash,
    required this.act,
    required this.settlesOnly,
    this.recap = const [],
  });
  final String noteId;
  final NoteTypeDef definition;

  /// The content hash of what the summary showed (lifecycle 4.5), sent with the sign-off.
  final String shownHash;

  /// The note's recap lines, worked out in the same read as [shownHash] (lifecycle 9.6 item 1): the
  /// summary draws these, not a recap read before or after, so the person signs what they were
  /// shown. A sync between two reads would otherwise show one note and sign another (review LCM-7).
  final List<RecapLine> recap;
  final SignoffAct act;

  /// Its sign-off is the fix of a refused one and changes nothing: the note was finished since, or
  /// removed (an empty draft). It settles the refusal (lifecycle 3.4).
  final bool settlesOnly;

  String get statementVersion => act == SignoffAct.sign ? signStatementVersion : completeStatementVersion;
  bool get medical => isMedicalType(definition);
}

/// A teammate's draft in the visit, which stays a draft: "{name}'s note stays a draft until they
/// complete it." (lifecycle 9.6).
class TeammateDraft {
  const TeammateDraft({required this.noteId, required this.author, required this.title});
  final String noteId;
  final PersonRef author;

  /// The note type's title.
  final String title;
}

/// What the summary screen shows of Complete (lifecycle 9.6, items 6 to 8).
class CompletePlan {
  const CompletePlan({
    required this.encounterId,
    required this.notes,
    required this.stops,
    required this.teammateDrafts,
    required this.sentForReview,
    required this.redFlagsFinished,
    this.signingSentence,
  });
  final String encounterId;

  /// The notes Complete finishes, in the visit's order, the Red flags note last.
  final List<NoteToComplete> notes;
  final List<CompleteBlock> stops;
  final List<TeammateDraft> teammateDrafts;

  /// The person's notes the server holds for review: shown as "Sent for review", not completed.
  final List<String> sentForReview;

  /// The visit has a finished Red flags note this phone does not hold, as the caller passed it.
  final bool redFlagsFinished;

  bool get canComplete => stops.isEmpty;

  /// A note will be signed: the signing sentence shows.
  bool get signs => _signs(notes);

  /// The sentence shown above the button when a note will be signed, naming the signer and their
  /// credential (lifecycle 3.5); null when none will be.
  final String? signingSentence;

  CompleteButton get button {
    final medical = notes.where((n) => !n.settlesOnly && n.medical);
    if (medical.isEmpty) return CompleteButton.complete;
    return signs ? CompleteButton.completeAndSign : CompleteButton.completeAndSendForCosignature;
  }
}

bool _signs(Iterable<NoteToComplete> notes) =>
    notes.any((n) => !n.settlesOnly && n.medical && n.act == SignoffAct.sign);

/// Complete wrote nothing: [stops] say why, worded for the summary.
class CompleteRefused implements Exception {
  const CompleteRefused(this.stops);
  final List<CompleteBlock> stops;
  String get message => stops.first.message;
  @override
  String toString() => 'CompleteRefused(${[for (final s in stops) s.stop.name].join(', ')})';
}

extension EncounterCompletion on EncounterRepository {
  /// What Complete would finish in the visit [encounterId] and what stops it, with the definitions
  /// of the visit's notes loaded first; null when the phone holds no such visit. [redFlagsFinished]:
  /// the visit read (online) shows a finished Red flags note this phone does not hold.
  ///
  /// The summary draws it with the visit's read (`openVisit`, which logs what it shows), each note's
  /// recap from [NoteToComplete.recap], which this read worked out with its hash; it logs nothing of
  /// its own. Throws [ChartingPaused] while the store is frozen.
  Future<CompletePlan?> openComplete(String encounterId, {bool redFlagsFinished = false}) async {
    _guardFrozen();
    await definitions.loadAll(EncounterRepository._versions(_Held.scan(store, encounterId: encounterId).notes));
    return readComplete(encounterId, redFlagsFinished: redFlagsFinished);
  }

  /// [openComplete] with the definitions loaded already.
  ///
  /// Complete finishes every draft of the visit the person acts as the author of, but an empty one
  /// (3.3), and, when one of them is a Medical note and the visit has no finished Red flags note,
  /// their own Red flags note even while it is empty, so its finish check asks for the red-flag
  /// answer (hard stop 5, forms 6.2). It also takes each note of theirs whose sign-off was refused
  /// and that was finished since or removed (an empty draft): the fix of that sign-off settles the
  /// refusal and changes nothing ([NoteToComplete.settlesOnly], 3.4).
  ///
  /// The stops are 3.3's hard stops, each as the store would refuse it and hard stop 4, which only
  /// this layer checks: a required answer missing (1), anything about the visit in Needs attention
  /// but a refused sign-off being fixed now (2), the clock (3), a Medical note on a visit with no
  /// patient (4), no Red flags note to finish with a Medical note (5). And what the store refuses
  /// with less to say: a sign-off of the note still waiting to send after a reopen, a note whose form
  /// the phone lacks, and what the server would hold for a Program Admin (a role that doesn't chart,
  /// a credential that doesn't chart Medical notes, 4.2).
  CompletePlan? readComplete(String encounterId, {bool redFlagsFinished = false}) {
    _guardFrozen();
    final held = _Held.scan(store, encounterId: encounterId);
    final visit = held.visit;
    if (visit == null) return null;
    final refused = _signoffsOfNotes(ChangeState.rejected);
    final pending = _signoffsOfNotes(ChangeState.pending);
    final teammateDrafts = <TeammateDraft>[];
    final sentForReview = <String>[];
    final finishing = <_Finishing>[];
    final ownEmptyRedFlags = <_Finishing>[];
    final noDefinition = <CompleteBlock>[];
    var redFlagsDone = redFlagsFinished;
    for (final rec in held.ordered(held.notes)) {
      final definition = _loadedDefinition(rec);
      final state = store.noteState(rec.id)!;
      final draft = state.status == NoteStatus.draft;
      final stored = EncounterRepository._answersOf(rec);
      final empty = noteIsEmpty(stored);
      final redFlags = definition != null && _isRedFlags(definition);
      // Finished as this phone knows it, as the store reads it for hard stop 5.
      if (redFlags && !draft) redFlagsDone = true;
      if (!_actsAsAuthor(rec)) {
        if (draft && !state.sentForReview && !empty && definition != null && _seesNote(definition, stored)) {
          teammateDrafts.add(TeammateDraft(noteId: rec.id, author: _actingAuthorOf(rec), title: definition.title));
        }
        continue;
      }
      if (state.sentForReview) {
        sentForReview.add(rec.id);
        continue;
      }
      final settlesOnly = refused.contains(rec.id) && (!draft || empty);
      if (!draft && !settlesOnly) continue;
      if (definition == null) {
        if (!empty || settlesOnly) {
          noDefinition.add(CompleteBlock(CompleteStop.noDefinition, _noDefinition, noteId: rec.id));
        }
        continue;
      }
      final note = (rec: rec, definition: definition, settlesOnly: settlesOnly);
      if (empty && !settlesOnly) {
        if (redFlags) ownEmptyRedFlags.add(note);
        continue;
      }
      finishing.add(note);
    }

    bool counts(_Finishing n) => !n.settlesOnly;
    bool medical(_Finishing n) => counts(n) && isMedicalType(n.definition);
    final redFlagsStop = <CompleteBlock>[];
    if (finishing.any(medical) && !redFlagsDone && !finishing.any((n) => counts(n) && _isRedFlags(n.definition))) {
      // Their own is finished with the others, empty or not; without one, the app adds it (forms 6.2).
      if (ownEmptyRedFlags.isNotEmpty) {
        finishing.add(ownEmptyRedFlags.first);
      } else {
        redFlagsStop.add(const CompleteBlock(CompleteStop.redFlagsFirst, _redFlagsFirst));
      }
    }
    // The Red flags note shows last on the summary (forms 6.2); the store sends it first.
    finishing.sort((a, b) => (_isRedFlags(a.definition) ? 1 : 0).compareTo(_isRedFlags(b.definition) ? 1 : 0));

    final notes = [
      for (final n in finishing)
        NoteToComplete(
          noteId: n.rec.id,
          definition: n.definition,
          shownHash: store.contentHashOf(n.rec.id, n.definition),
          act: isMedicalType(n.definition) && user.can.sign ? SignoffAct.sign : SignoffAct.complete,
          settlesOnly: n.settlesOnly,
          recap: _recapOf(n.rec, n.definition),
        ),
    ];
    final stops = <CompleteBlock>[
      if (notes.isNotEmpty && store.chartingPaused) const CompleteBlock(CompleteStop.chartingPaused, _clockPaused),
      if (notes.isNotEmpty && !user.charts) const CompleteBlock(CompleteStop.notCharting, _notCharting),
      if (finishing.any(medical) && !user.can.chartMedical)
        const CompleteBlock(CompleteStop.medicalCredential, _medicalCredential),
      if (notes.isNotEmpty && _waitsInNeedsAttention(held, {for (final n in notes) n.noteId}))
        const CompleteBlock(CompleteStop.needsAttention, _needsAttention),
      // Hard stop 4 (3.3, 3.10): the store does not check it, and the server refuses the note's create.
      if (finishing.any(medical) && EncounterRepository._patientOf(visit) == null)
        CompleteBlock(CompleteStop.needsPatient, EncounterRepository._needsPatient.message),
      ...redFlagsStop,
      for (final n in finishing)
        if (counts(n) && pending.contains(n.rec.id))
          CompleteBlock(CompleteStop.waitingToSend, _waitingToSend, noteId: n.rec.id),
      ...noDefinition,
      for (final n in finishing)
        if (counts(n))
          for (final problem in finishCheck(n.definition, EncounterRepository._answersOf(n.rec)))
            _missing(n.rec.id, n.definition, problem),
    ];
    return CompletePlan(
      encounterId: encounterId,
      notes: notes,
      signingSentence: _signs(notes) ? signingSentence(user) : null,
      stops: [
        ...stops,
        if (notes.isEmpty && stops.isEmpty) const CompleteBlock(CompleteStop.nothingToComplete, _nothingToComplete),
      ],
      teammateDrafts: teammateDrafts,
      sentForReview: sentForReview,
      redFlagsFinished: redFlagsFinished,
    );
  }

  /// **Complete** (lifecycle 3.3, 4.8): the notes of [plan] finished in one transaction, each with the
  /// hash the summary drew and the act and wording it showed, through the store's `finishNotes`.
  /// [addToAssessment], once the visit has a finished note, is an addendum to the visit made with it
  /// (9.6), naming the first sign-off made so it waits behind it (4.7). Returns what the phone
  /// expects of each note, as `finishNotes` does: a note whose fix only settles a refusal is not in
  /// it.
  ///
  /// Throws [CompleteRefused], writing nothing, with what the summary shows: [plan]'s stops; a note
  /// sent for review, finished, or whose last Complete waits to send since the summary was drawn
  /// (asked before the store, which says only [RecordLocked]); and each refusal of the store
  /// (`ChartingPaused`, `NoteChanged` as "This note changed. Read it again.", `needs_attention`,
  /// `incomplete`, `red_flags_first`, `not_author`, `empty`, `RecordLocked`).
  Map<String, LocalEffect> complete(CompletePlan plan, {String? addToAssessment}) {
    if (plan.stops.isNotEmpty) throw CompleteRefused(plan.stops);
    final text = addToAssessment?.trim();
    final Map<String, LocalEffect> made;
    try {
      _guardFrozen();
      final since = [for (final n in plan.notes) ?_stoppedSince(n)];
      if (since.isNotEmpty) throw CompleteRefused(since);
      made = store.transaction(() {
        final effects = store.finishNotes(
          [
            for (final n in plan.notes)
              NoteToFinish(noteId: n.noteId, shownHash: n.shownHash, act: n.act, statementVersion: n.statementVersion),
          ],
          signer: user.signer,
          definitionOf: definitions.loaded,
          redFlagsFinished: plan.redFlagsFinished,
        );
        if (text != null && text.isNotEmpty) {
          try {
            store.createRecord(entityAddendum, {
              'encounterId': plan.encounterId,
              'noteId': null,
              'text': text,
              'signoffId': effects.values.firstOrNull?.signoffId,
            });
          } on LocalValidationError {
            throw const CompleteRefused([CompleteBlock(CompleteStop.assessment, _assessmentTooLong)]);
          }
        }
        return effects;
      });
    } on ChartingPaused catch (e) {
      throw CompleteRefused([CompleteBlock(CompleteStop.chartingPaused, e.message)]);
    } on NoteChanged catch (e) {
      throw CompleteRefused([
        for (final id in e.noteIds) CompleteBlock(CompleteStop.noteChanged, _noteChanged, noteId: id),
      ]);
    } on RecordLocked {
      throw const CompleteRefused([CompleteBlock(CompleteStop.finished, _finished)]);
    } on LocalValidationError catch (e) {
      final stop = switch (e.problem) {
        'needs_attention' => CompleteStop.needsAttention,
        'incomplete' => CompleteStop.missingAnswer,
        'red_flags_first' => CompleteStop.redFlagsFirst,
        'not_author' => CompleteStop.notAuthor,
        'empty' => CompleteStop.nothingToComplete,
        _ => null,
      };
      // A sign-off the registry refuses is a fault of this app, not something the person can fix.
      if (stop == null) rethrow;
      throw CompleteRefused([CompleteBlock(stop, e.message)]);
    }
    onChanged?.call();
    return made;
  }

  /// The visit's assessment (its `summary`, lifecycle 9.6), saved as it is typed while the visit has
  /// no finished note: trimmed, and cleared when blank. Text equal to what is stored is no change.
  /// Returns whether a change was queued.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting`; `read_only` for a Medical visit's
  /// assessment to a reader of no Medical notes, who is not shown it (5.1); [RecordLocked] once the
  /// visit has a finished note (3.1), when what is added goes as an addendum with Complete; a
  /// [LocalValidationError] for text over 4,000 characters. A [StateError] when the phone holds no
  /// such visit.
  bool saveSummary(String encounterId, String? text) {
    _guardFrozen();
    final visit = _visit(encounterId);
    _mayChart(medical: false);
    if (VisitKind.fromCode(visit.fields['kind']?.value) == VisitKind.medical && !user.readsMedical) {
      throw EncounterRepository._readOnly;
    }
    final trimmed = text?.trim();
    final next = trimmed == null || trimmed.isEmpty ? null : trimmed;
    if (visit.fields['summary']?.value == next) return false;
    store.setField(encounterId, 'summary', next);
    onChanged?.call();
    return true;
  }

  /// The recap of [note] as its author reads it, from what the phone holds now; none when the
  /// interpreter can't lay it out.
  List<RecapLine> _recapOf(LocalRecord note, NoteTypeDef definition) {
    try {
      final read = _interpret(
        definition,
        EncounterRepository._answersOf(note),
        user.reader(actsAsAuthor: true),
        const [],
      );
      return read is _Readable ? read.recap : const [];
      // A definition the interpreter can't run is one the phone can't lay the note out by.
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      return const [];
    }
  }

  /// What stops [n] now that did not when the summary drew it, asked before the store, whose
  /// [RecordLocked] would not say which.
  CompleteBlock? _stoppedSince(NoteToComplete n) {
    final state = store.noteState(n.noteId);
    if (state == null) return CompleteBlock(CompleteStop.noteChanged, _noteChanged, noteId: n.noteId);
    if (state.sentForReview) return CompleteBlock(CompleteStop.sentForReview, _sentForReview, noteId: n.noteId);
    if (n.settlesOnly) return null;
    if (state.status != NoteStatus.draft) return CompleteBlock(CompleteStop.finished, _finished, noteId: n.noteId);
    if (_signoffsOfNotes(ChangeState.pending).contains(n.noteId)) {
      return CompleteBlock(CompleteStop.waitingToSend, _waitingToSend, noteId: n.noteId);
    }
    return null;
  }

  /// The notes with a sign-off made here in [state]: refused (in Needs attention) or waiting to send.
  Set<String> _signoffsOfNotes(ChangeState state) => {
    for (final e in store.outbox())
      if ((e.entity, e.op, e.value) case (entitySignoff, 'create', {'noteId': final String noteId})
          when e.state == state)
        noteId,
  };

  /// Hard stop 2 (3.3), as the store's `finishNotes` checks it: a change waiting in Needs attention
  /// to the visit or a note of it, or to a record that names one; a refused sign-off of a note of
  /// [completing] does not count, since completing again is its fix (3.4).
  bool _waitsInNeedsAttention(_Held held, Set<String> completing) {
    final ids = {held.visit!.id, for (final n in held.notes) n.id};
    for (final e in store.needsAttention()) {
      if ((e.entity, e.op, e.value) case (entitySignoff, 'create', {'noteId': final String noteId})
          when completing.contains(noteId)) {
        continue;
      }
      if (ids.contains(e.recordId) ||
          parentsOf(entity: e.entity, op: e.op, field: e.field, value: e.value).any((p) => ids.contains(p.id))) {
        return true;
      }
    }
    return false;
  }

  /// "Wound care: Exam, “Consent recorded” needs an answer." (9.6): the note, the section and the
  /// field, so the line jumps to it.
  static CompleteBlock _missing(String noteId, NoteTypeDef definition, FinishProblem problem) {
    final at = fieldAt(definition, problem.path);
    final section = at?.section ?? definition.sections.firstWhere((s) => s.id == problem.section);
    final side = switch (at?.side) {
      'right' => ' (right)',
      'left' => ' (left)',
      _ => '',
    };
    final label = '${at?.field?.label ?? problem.path}$side';
    return CompleteBlock(
      CompleteStop.missingAnswer,
      '${definition.title}: ${section.title}, “$label” needs an answer.',
      noteId: noteId,
      section: problem.section,
      path: problem.path,
    );
  }
}

/// A note Complete takes, as [EncounterCompletion.readComplete] finds it.
typedef _Finishing = ({LocalRecord rec, NoteTypeDef definition, bool settlesOnly});

/// The Red flags and disposition note, found by its type's `auto`, as the store and the server find it.
bool _isRedFlags(NoteTypeDef definition) => definition.auto == 'medical';

// What the summary shows when Complete stops (lifecycle 9.6). The design gives the first three
// (4.8, 9.13); the store words needs_attention so; the rest are this layer's.
const _noteChanged = 'This note changed. Read it again.';
const _redFlagsFirst = 'Answer the red-flag question first, then complete again.';
const _needsAttention = 'Something about this visit waits in Needs attention. Fix it there first, then complete again.';
// The store's sentence for the clock pause (ChartingPaused), shown before Complete is pressed.
const _clockPaused = 'Charting is paused until the phone’s clock is right.';
const _waitingToSend =
    'Your last Complete of this note hasn’t been sent yet. Connect so it can send, then complete again.';
const _sentForReview =
    'This note was sent to a Program Admin for review. It can’t be completed again until they decide.';
const _finished = 'This note is already finished.';
const _nothingToComplete = 'There’s nothing of yours to complete in this visit.';
const _noDefinition = 'This note’s form isn’t on this phone yet. Connect to load it, then complete.';
const _notCharting = 'Your role doesn’t chart visits.';
const _medicalCredential = 'Your credential doesn’t chart clinical notes.';
const _assessmentTooLong = 'What you added to the assessment is too long. Keep it to 4,000 characters.';
