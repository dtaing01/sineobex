part of 'encounter_repository.dart';

// Reopen, addenda and corrections (phase 4 design, lifecycle 3.6, 4.7, 4.8, 9.7): the visit screen's
// actions on a finished note, each offered only where the server would take it, each sent through
// the store, which holds the sync rules.

extension NoteActions on EncounterRepository {
  /// Whether **Reopen** is offered on [noteId] (9.7): a Medical note that waits for a co-signer and
  /// was never signed, to whoever acts as its author ([reopenEffect] says `apply`), not while it is
  /// sent for review, and to someone who may chart it. False while the note's definition is not
  /// loaded.
  bool mayReopen(String noteId) {
    final rec = store.record(noteId);
    final definition = rec == null || rec.entity != entityNote ? null : _loadedDefinition(rec);
    if (definition == null) return false;
    final state = store.noteState(noteId)!;
    final medical = isMedicalType(definition);
    return user.charts &&
        (!medical || user.can.chartMedical) &&
        !state.sentForReview &&
        reopenEffect(
              noteStatus: state.status,
              everSigned: rec!.attributes['everSigned'] == true,
              medicalNote: medical,
              actsAsAuthor: _actsAsAuthor(rec),
            ) ==
            ReopenEffect.apply;
  }

  /// **Reopen** (3.6, 4.4): the note back to draft, by the store's `reopenNote` with the definition
  /// of the note's own version, so its author can change it and complete it again. Returns
  /// [ReopenEffect.apply], or [ReopenEffect.nothing] for a draft, which sends nothing.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting` and `medical_credential` as
  /// [EncounterRepository.startEncounter]; `sent_for_review` while the server holds its sign-off for a
  /// Program Admin, asked first so the person is told that rather than that it is finished (4.8);
  /// [RecordLocked] for a note the server keeps as it is (signed, signed once, or a Non-Medical note
  /// completed: an addendum or a correction is the way); `not_author` for someone else's note. A
  /// [StateError] when the phone holds no such note, or not its definition.
  Future<ReopenEffect> reopen(String noteId) async {
    _guardFrozen();
    final definition = await _definitionOf(_noteRecord(noteId));
    _guardFrozen();
    _mayChart(medical: isMedicalType(definition));
    if (store.sentForReview(noteId)) throw _heldForReview;
    final effect = store.reopenNote(noteId, definition);
    if (effect == ReopenEffect.apply) onChanged?.call();
    return effect;
  }

  /// Whether **Add addendum** is offered below [note] (9.7): to anyone who charts, on a note finished
  /// as this phone knows it.
  bool mayAddAddendum(NoteView note) => user.charts && note.finished;

  /// Whether **Add addendum** is offered on [visit] itself: once it has a finished note (3.6), to
  /// anyone who charts and is shown the visit's assessment and addenda (5.1).
  bool mayAddVisitAddendum(VisitView visit) => user.charts && visit.envelopeLocked && !visit.summaryHidden;

  /// **Add addendum** (3.6, 4.7): [text] below the note [noteId], or below the visit [encounterId]
  /// itself when [noteId] is null; trimmed, 1 to 4,000 characters. Append-only: it changes no state.
  /// While a sign-off this phone made of the note (or, for the visit's own, of a note of the visit)
  /// waits to be confirmed, the addendum names it, so it waits behind it (4.7; PRD main 564). A note
  /// or visit that has left the phone is opened from the server first (4.8, 8.2). Returns its ID.
  ///
  /// Throws, writing nothing: [ChartingPaused] (the clock pauses an addendum, 3.11); `not_charting`;
  /// `text` for a blank or too long text; `not_on_phone` for a note not on the phone without a
  /// connection; `cannot_read` for a note the person may not read, which the server would hold for a
  /// Program Admin (6.4).
  Future<String> addAddendum(String encounterId, {String? noteId, required String text}) async {
    _guardFrozen();
    _mayChart(medical: false);
    final trimmed = text.trim();
    if (trimmed.isEmpty) throw const LocalValidationError(_addendumEmpty, problem: 'text', paths: {'text'});
    await _hold(encounterId, noteId);
    _guardFrozen();
    _visit(encounterId);
    if (noteId != null) {
      final rec = _noteOf(encounterId, noteId);
      if (!_actsAsAuthor(rec)) {
        final definition = await definitions.load(
          rec.attributes['noteTypeKey'] as String? ?? '',
          rec.attributes['noteTypeVersion'] as int? ?? 0,
        );
        if (definition == null || !_seesNote(definition, EncounterRepository._answersOf(rec))) throw _cannotRead;
      }
    }
    final String id;
    try {
      id = store.createRecord(entityAddendum, {
        'encounterId': encounterId,
        'noteId': noteId,
        'text': trimmed,
        'signoffId': _waitingSignoff(noteId == null ? _noteIdsOf(encounterId) : {noteId}),
      });
    } on LocalValidationError catch (e) {
      if (!e.paths.contains('text')) rethrow;
      throw const LocalValidationError(_addendumTooLong, problem: 'text', paths: {'text'});
    }
    onChanged?.call();
    return id;
  }

  /// Whether **Correct** is offered on [note]'s answers (9.7): to whoever acts as its author, on a
  /// note finished as this phone knows it and not sent for review, with its form on the phone, to
  /// someone who may chart it.
  bool mayCorrect(NoteView note) =>
      note.actsAsAuthor &&
      note.finished &&
      !note.sentForReview &&
      !note.unreadable &&
      user.charts &&
      (note.medical != true || user.can.chartMedical);

  /// **Correct** (3.6, 4.7): one to ten answers of the finished note [noteId] of [encounterId],
  /// changed together, by `data` path to the new value (null clears it), with a [reason] of 3 to
  /// 500 characters (trimmed). Each goes with the version of the answer the person was looking at
  /// (the phone's copy), so a correction made elsewhere first is refused `field_changed` rather than
  /// overwritten; one the phone holds no row of goes at 0 (Complete dropped it, or a correction hid
  /// it: D107, D109). An answer that already holds its new value is not sent, nor one hidden before
  /// the correction and after it, which changes nothing the note shows and which the server would not
  /// write (4.7 step 7). [requestedByPatient] marks a patient's amendment request; [declined] records
  /// that request as declined, the note unchanged. The credential the saved profile shows is claimed,
  /// as for a signature (3.5). While a sign-off this phone made of the note waits, the correction
  /// names it and waits behind it. A note that has left the phone is opened from the server first.
  /// Returns its ID.
  ///
  /// PLAN-OPEN: how is a wrong free-text assessment fixed after Complete (lifecycle 12.1 #9)? By an
  /// addendum, not here: only a note's answers are corrected.
  /// PLAN-OPEN: what does a patient's amendment request need beyond the logged decision (lifecycle
  /// 12.1 #10)? Only the request and the decision are recorded.
  /// PLAN-OPEN: does a correction record the wording its corrector was shown (lifecycle 12.1 #24)?
  /// No: it carries no statement version.
  ///
  /// Throws, writing nothing, what the server would refuse or hold: [ChartingPaused]; `not_charting`
  /// and `medical_credential`; `not_on_phone`; `not_author`; `sent_for_review`; `draft` for a note
  /// not finished (its answers are changed in the form); `read_only` for an answer the server would
  /// hold from them (a section that needs an ordering credential, 6.4 rule 5); the problem
  /// `checkAnswer` names, with the path; `no_change` when every answer already says so or stays
  /// hidden; `incomplete` when the note would then miss a required answer, with those paths;
  /// `reason`. An [ArgumentError] for no change or more than ten, or [declined] without
  /// [requestedByPatient].
  Future<String> correct(
    String encounterId,
    String noteId, {
    required Map<String, Object?> changes,
    required String reason,
    bool requestedByPatient = false,
    bool declined = false,
  }) async {
    if (changes.isEmpty || changes.length > maxCorrectionChanges) {
      throw ArgumentError('a correction changes one to $maxCorrectionChanges answers');
    }
    if (declined && !requestedByPatient) throw ArgumentError('only a patient’s request is declined');
    _guardFrozen();
    _mayChart(medical: false);
    await _hold(encounterId, noteId);
    final definition = await _definitionOf(_noteOf(encounterId, noteId));
    _guardFrozen();
    final rec = _noteOf(encounterId, noteId);
    if (!_actsAsAuthor(rec)) throw _correctNotAuthor;
    _mayChart(medical: isMedicalType(definition));
    final state = store.noteState(noteId)!;
    if (state.sentForReview) throw _heldForReview;
    if (state.status == NoteStatus.draft) throw _correctDraft;
    for (final path in changes.keys) {
      if (_heldFromPerson(definition, path, actsAsAuthor: true)) {
        throw LocalValidationError(EncounterRepository._readOnly.message, problem: 'read_only', paths: {path});
      }
    }
    final stored = EncounterRepository._answersOf(rec);
    // A declined request leaves the note as it is, so the server takes what was asked for as it was
    // asked (4.7, step 4 before step 5).
    var sent = changes;
    if (!declined) {
      final asked = {
        for (final MapEntry(key: path, :value) in changes.entries)
          if (canonicalJson(stored[path]) != canonicalJson(value)) path: value,
      };
      for (final MapEntry(key: path, :value) in asked.entries) {
        final problem = checkAnswer(definition, path, value);
        if (problem != null) throw LocalValidationError(_cantSave, problem: problem.code, paths: {path});
      }
      // An answer hidden before the correction and after it changes nothing the note shows, and the
      // server writes none (4.7 step 7).
      final before = NoteReading(definition, stored), after = NoteReading(definition, {...stored, ...asked});
      sent = {
        for (final MapEntry(key: path, :value) in asked.entries)
          if (before.counts(path) || after.counts(path)) path: value,
      };
      if (sent.isEmpty) throw const LocalValidationError(_noChange, problem: 'no_change');
      // A correction never leaves a finished note without what it needs (4.7 step 8).
      final missing = finishCheck(definition, {...stored, ...sent});
      if (missing.isNotEmpty) {
        throw LocalValidationError(_wouldBeIncomplete, problem: 'incomplete', paths: {for (final m in missing) m.path});
      }
    }
    final String id;
    try {
      id = store.createRecord(entityCorrection, {
        'noteId': noteId,
        'changes': [
          for (final MapEntry(key: path, :value) in sent.entries)
            {'field': '$_data$path', 'newValue': value, 'baseVersion': _versionSeen(rec, path)},
        ],
        'reason': reason.trim(),
        'requestedByPatient': requestedByPatient,
        'declined': declined,
        'claimedCredential': credentials.contains(user.credential) ? user.credential : null,
        'signoffId': _waitingSignoff({noteId}),
      });
    } on LocalValidationError catch (e) {
      if (!e.paths.contains('reason')) rethrow;
      throw const LocalValidationError(_reasonLength, problem: 'reason', paths: {'reason'});
    }
    onChanged?.call();
    return id;
  }

  /// **Correct again** on a correction the server refused `field_changed` (4.1, 9.13): the same
  /// record, its answers and reason as they were, sent again as the fix of the refusal (the store's
  /// `fixRejected`), each answer at the version the person reads now, as [correct] reads it. An
  /// answer the phone holds no row of is at 0: one Complete dropped or a correction hid, which a
  /// finished note's read never sends (D107) and the server takes from 0 (D109). Needs attention
  /// holds no version rule of its own.
  ///
  /// Throws, sending nothing: [ChartingPaused]; `not_charting` and `medical_credential` as
  /// [correct]. A [StateError] for a change that is not a refused correction, or a note not on the
  /// phone (a refusal keeps its visit on the phone).
  Future<void> correctAgain(String changeId) async {
    _guardFrozen();
    final refused = store.entry(changeId);
    if (refused == null ||
        refused.entity != entityCorrection ||
        refused.op != 'create' ||
        refused.state != ChangeState.rejected) {
      throw StateError('not a refused correction');
    }
    final sent = refused.value! as Map<String, Object?>;
    final noteId = sent['noteId']! as String;
    final definition = await _definitionOf(_noteRecord(noteId));
    _guardFrozen();
    _mayChart(medical: isMedicalType(definition));
    final rec = _noteRecord(noteId);
    store.fixRejected(changeId, {
      ...sent,
      'changes': [
        for (final c in (sent['changes']! as List<Object?>).cast<Map<String, Object?>>())
          {...c, 'baseVersion': _versionSeen(rec, (c['field']! as String).substring(_data.length))},
      ],
    });
    onChanged?.call();
  }

  /// Brings the visit [encounterId] and the note [noteId] onto the phone when it lacks them (4.8,
  /// 8.2): the store files an addendum or a correction under its patient through the note and its
  /// visit, and takes no patient hint.
  Future<void> _hold(String encounterId, String? noteId) async {
    final missing = [
      if (store.record(encounterId) == null) (entityEncounter, encounterId),
      if (noteId != null && store.record(noteId) == null) (entityNote, noteId),
    ];
    if (missing.isEmpty) return;
    final open = openServerRecord;
    if (open == null) throw _notOnPhone;
    for (final (entity, id) in missing) {
      final bool found;
      try {
        found = await open(entity, id);
      } on NetworkException {
        throw _notOnPhone;
      }
      if (!found) throw StateError('the server has no such $entity');
    }
  }

  /// The note [noteId] of the visit [encounterId] on the phone.
  LocalRecord _noteOf(String encounterId, String noteId) {
    final rec = _noteRecord(noteId);
    if (rec.attributes['encounterId'] != encounterId) throw ArgumentError('the note is not of this visit');
    return rec;
  }

  /// The version the answer at [path] of [note] has on the server once what waits of it here is
  /// applied: the person reads the note as the phone holds it, their own changes not yet sent
  /// included. A note's create writes each answer at version 1, and each set adds one, but a Keep
  /// theirs choice, which the server takes at the version it holds (fields.ts `keepServer`); an
  /// answer never written is at 0. Should the server hold another, the correction is refused
  /// `field_changed`, and the person looks again (4.7 step 6).
  int _versionSeen(LocalRecord note, String path) {
    final field = note.fields['$_data$path'];
    if (field == null) return 0;
    var version = field.serverVersion;
    if (field.confirmed) return version;
    for (final e in store.outbox()) {
      if (e.recordId != note.id || e.state != ChangeState.pending) continue;
      final written = switch ((e.op, e.value)) {
        ('create', {'data': final Map<String, Object?> data}) => data.containsKey(path),
        ('set', _) => e.field == '$_data$path' && e.resolution != 'keep_server',
        _ => false,
      };
      if (written) version++;
    }
    return version;
  }

  Set<String> _noteIdsOf(String encounterId) => {
    for (final n in _Held.scan(store, encounterId: encounterId).notes) n.id,
  };

  /// The latest sign-off this phone made of one of [noteIds] that the server has not confirmed:
  /// waiting to send, or refused and waiting in Needs attention for Complete to fix (4.7).
  String? _waitingSignoff(Set<String> noteIds) => [
    for (final e in store.outbox())
      if ((e.entity, e.op, e.value) case (entitySignoff, 'create', {'noteId': final String noteId})
          when e.state != ChangeState.superseded && noteIds.contains(noteId))
        e.recordId,
  ].lastOrNull;
}

// What the visit screen's actions say when they stop (lifecycle 8.2, 9.7): this layer's words.
const _heldForReview = LocalValidationError(
  'This note was sent to a Program Admin for review. It can’t be changed until they decide.',
  problem: 'sent_for_review',
);
const _notOnPhone = LocalValidationError(
  'This note isn’t on this phone. Connect, then try again.',
  problem: 'not_on_phone',
);
const _cannotRead = LocalValidationError('You can’t add to a note you can’t open.', problem: 'cannot_read');
const _correctNotAuthor = LocalValidationError('Only the note’s author can correct it.', problem: 'not_author');
const _correctDraft = LocalValidationError(
  'This note isn’t finished. Change the answer in the note itself.',
  problem: 'draft',
);
const _addendumEmpty = 'Write the addendum first.';
const _addendumTooLong = 'An addendum can be up to 4,000 characters.';
const _cantSave = 'This answer can’t be saved.';
const _noChange = 'Nothing changed: each answer already says that, or isn’t shown in the note.';
const _wouldBeIncomplete = 'This change would leave the note missing something it needs.';
const _reasonLength = 'Give a reason of 3 to 500 characters.';
