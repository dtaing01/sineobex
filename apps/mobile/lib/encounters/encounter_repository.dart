import 'dart:math' show Random;

import '../api/generated/api.dart' as wire;
import '../api/transport.dart' show NetworkException;
import '../forms/answer_state.dart' show AnswerConflict, ConflictBy;
import '../forms/check_answer.dart';
import '../forms/conditions.dart' show Answers, NoteReading;
import '../forms/definition.dart';
import '../forms/effective.dart' show effectiveAnswers;
import '../forms/expand.dart' show expandQuick;
import '../forms/field_at.dart' show fieldAt;
import '../forms/finish.dart';
import '../forms/forms_api.dart' show NoteTypeVersion;
import '../forms/read_model.dart';
import '../forms/recap.dart';
import '../forms/visible.dart';
import '../patients/chart_cache.dart' show patientGroup;
import '../patients/problems.dart' show Problems, problemListStatus;
import '../sync/canonical_json.dart';
import '../sync/entities.dart'
    show credentials, entityAddendum, entityCorrection, entitySignoff, maxCorrectionChanges, parentsOf;
import '../sync/local_store.dart';
import 'credentials.dart';
import 'encounter_models.dart';
import 'note_definitions.dart';
import 'referrals.dart';
import 'rules.dart';
import 'visibility.dart';

part 'complete.dart';
part 'expand_quick.dart';
part 'note_actions.dart';
part 'red_flags.dart';
part 'timeline.dart';

/// Visits and notes on the phone (phase 4 design, lifecycle 3, 4.8, 9): what the screens read and
/// do, between them and the store. Every change goes through the store's public methods, which hold
/// the sync rules; this layer adds what a screen needs on top: who may see what (6.4), the reads
/// logged (10.1), the lists.
///
/// Reads come in two halves: the `open` methods load the definitions the notes are written on (from
/// the phone's files, or the server when it lacks one and has signal), then read; the `read` methods
/// are the synchronous half, with the definitions loaded already. Each read logs every record it
/// shows (`encounter.viewed` for the visit, `note.viewed` for a note and for each sign-off, addendum
/// and correction of it, as the server's reads log them) in the store transaction that reads it, so
/// a read that can't be logged shows nothing (CLAUDE.md); while the store is frozen nothing is read
/// at all ([ChartingPaused]). Reading never waits for the clock check: it changes nothing a clock
/// decides. A screen that reads again what it shows passes the IDs it was shown
/// ([VisitView.shownIds]), so only what the new read adds is logged again.
class EncounterRepository {
  EncounterRepository(
    this.store, {
    required this.user,
    required this.definitions,
    required this.noteTypes,
    this.nameOf,
    this.openServerRecord,
  });

  final LocalStore store;
  final EncounterUser user;
  final NoteDefinitions definitions;

  /// The team's listed note types (`TeamNoteTypes.listed`, from the phone's files, offline too;
  /// none while the phone holds no list for the team). The app finds the team's Red flags note type
  /// among them ([redFlagsTypeOf]) to add a person's own with their Medical notes (forms 6.2).
  final Future<Iterable<NoteTypeDef>> Function() noteTypes;

  /// A person's name, where the phone knows it; null otherwise. A teammate's record carries only
  /// their ID (an addendum excepted), so a name is often unknown on the phone.
  final String? Function(String userId)? nameOf;

  /// Brings the server's copy of a record onto the phone (`SyncEngine.openServerRecord`): false when
  /// the server has no such record, a `NetworkException` without signal. An addendum or a correction
  /// of a note that has left the phone opens it first (lifecycle 4.8, 8.2). Null where there is no
  /// engine: such a note can't be added to here.
  final Future<bool> Function(String entity, String id)? openServerRecord;

  /// Called after a change made through this repository, so screens read again.
  void Function()? onChanged;

  // ---- reading ----

  /// The visit [encounterId] as the person may see it, from the phone's copy; null when the phone
  /// holds no such visit ("This visit isn't on this phone. Connect to open it.", lifecycle 8.2).
  Future<VisitView?> openVisit(String encounterId, {Set<String> shownBefore = const {}}) async {
    _guardFrozen();
    await definitions.loadAll(_versions(_Held.scan(store, encounterId: encounterId).notes));
    return readVisit(encounterId, shownBefore: shownBefore);
  }

  /// [openVisit] with the definitions loaded already: a note whose definition was not loaded reads
  /// as one the phone lacks.
  VisitView? readVisit(String encounterId, {Set<String> shownBefore = const {}}) {
    _guardFrozen();
    return store.transaction(() {
      final held = _Held.scan(store, encounterId: encounterId);
      final visit = held.visit;
      if (visit == null) return null;
      final patientId = _patientOf(visit);
      final shown = <_Shown>[_Shown('encounter.viewed', entityEncounter, visit)];
      final kind = VisitKind.fromCode(visit.fields['kind']?.value);
      final summaryHidden = kind == VisitKind.medical && !user.readsMedical;
      final addenda = [
        if (!summaryHidden)
          for (final a in held.ordered(held.addendaOf(null))) _addendum(a, held, shown),
      ];
      final notes = redFlagsLast([for (final rec in held.ordered(held.notes)) ?_note(rec, held, shown)]);
      final create = held.createOf(visit.id);
      final view = VisitView(
        encounterId: visit.id,
        source: VisitSource.phone,
        patientId: patientId,
        kind: kind,
        status: encounterStatus([for (final n in notes) (status: n.status, medical: n.medical ?? true, empty: false)]),
        startedAt: _time(visit.attributes['startedAt']) ?? create?.time,
        clockVerified: _flag(visit.attributes['clockVerified']) ?? create?.clockVerified ?? false,
        locationText: visit.fields['locationText']?.value as String?,
        summary: summaryHidden ? null : visit.fields['summary']?.value as String?,
        summaryHidden: summaryHidden,
        envelopeLocked:
            visit.attributes['hasFinishedNote'] == true ||
            envelopeLocked([for (final n in held.notes) store.noteState(n.id)!.status]),
        addenda: addenda,
        notes: notes,
        notSynced: create != null,
        pendingFields: {
          for (final MapEntry(:key, :value) in visit.fields.entries)
            if (!value.confirmed) key,
        },
      );
      _log(shown, patientId, shownBefore);
      return view;
    });
  }

  /// Whether others may have added to the visit [encounterId] what this phone does not hold (lifecycle
  /// 4.10, 9.7): any visit but one made here whose create still waits, which no one else can have
  /// reached. Reads no value of a record and logs nothing.
  bool othersMayHaveAdded(String encounterId) {
    if (store.record(encounterId) == null) return true;
    return !store.outbox().any(
      (e) => e.recordId == encounterId && e.op == 'create' && e.state != ChangeState.superseded,
    );
  }

  /// One note, as the person may see it, with what hangs off it; null when the phone holds no such
  /// note or the person may not see it. The visit itself is not read, nor logged. An empty draft,
  /// which no list shows (3.1), opens here for whoever acts as its author: it is the form of a note
  /// just added, or of one they removed and add again (9.4).
  Future<NoteView?> openNote(String noteId, {Set<String> shownBefore = const {}}) async {
    _guardFrozen();
    final rec = store.record(noteId);
    if (rec == null || rec.entity != entityNote) return null;
    await definitions.loadAll(_versions([rec]));
    return readNote(noteId, shownBefore: shownBefore);
  }

  /// [openNote] with the definitions loaded already.
  NoteView? readNote(String noteId, {Set<String> shownBefore = const {}}) {
    _guardFrozen();
    return store.transaction(() {
      final rec = store.record(noteId);
      if (rec == null || rec.entity != entityNote) return null;
      final held = _Held.scan(store, noteId: noteId);
      final shown = <_Shown>[];
      final view = _note(rec, held, shown, ownEmptyShown: true);
      final visit = held.visit;
      _log(shown, visit == null ? null : _patientOf(visit), shownBefore);
      return view;
    });
  }

  // ---- starting a visit, its notes, and their answers ----

  /// Whether Start asks "Medical or Non-Medical" (lifecycle 9.3): a credential that can't chart
  /// Medical is not asked, and its visits start Non-Medical (6.2).
  bool get asksKind => user.charts && user.can.chartMedical;

  /// The note types to offer in a visit of [kind] (lifecycle 6.2, 9.4), from the team's list
  /// [listed], in its order: every type in a Medical visit and the Non-Medical ones in a Non-Medical
  /// visit; to a credential that can't chart Medical, the Non-Medical ones in any visit. The Red
  /// flags note is not among them: the app adds it (forms 6.2).
  List<NoteTypeDef> noteTypesOffered(Iterable<NoteTypeDef> listed, VisitKind kind) => [
    if (user.charts)
      for (final type in listed)
        if (type.auto == null && (!isMedicalType(type) || (kind == VisitKind.medical && user.can.chartMedical))) type,
  ];

  /// **New encounter** (lifecycle 9.2, 9.3): a visit of [kind] for [patientId] (none for someone who
  /// declines to be registered, 3.10), at the place typed ([locationText], trimmed; blank is none)
  /// and the one the phone gave on **Use my location** ([location]). Returns its ID.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the clock check fails or the store is frozen;
  /// a [LocalValidationError] for someone whose role doesn't chart (`not_charting`), for a Medical
  /// visit from a credential that can't chart Medical (`medical_credential`) or with no patient
  /// (`medical_note_needs_patient`: a Medical visit is for its clinical notes, and those need a
  /// chart, 12.1 #11; Switch to Medical asks who the patient is first, 9.3).
  ///
  /// PLAN-OPEN: can a Medical note be written for someone who is not registered (lifecycle 12.1
  /// #11)? No: a Medical visit names its patient here, and the server refuses a Medical note on a
  /// visit with none.
  /// PLAN-OPEN: is the GPS position stored, and how exact (lifecycle 12.1 #15)? Only on the tap, and
  /// as the phone gave it.
  String startEncounter({
    required VisitKind kind,
    String? patientId,
    String? locationText,
    Map<String, Object?>? location,
  }) {
    _guardFrozen();
    _mayChart(medical: kind == VisitKind.medical);
    if (kind == VisitKind.medical && patientId == null) throw _needsPatient;
    final place = locationText?.trim();
    final id = store.createEncounter(
      kind: kind.code,
      patientId: patientId,
      location: location,
      locationText: place == null || place.isEmpty ? null : place,
    );
    onChanged?.call();
    return id;
  }

  /// **Switch to Medical** (lifecycle 3.10, 9.3): the visit's kind set to Medical, every answer kept.
  /// A visit with no patient is given [patientId] with it, in one transaction; without one it throws
  /// `medical_note_needs_patient` and the screen asks who the patient is. Nothing is sent for a visit
  /// that is Medical already. There is no switch back.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting` and `medical_credential` as
  /// [startEncounter]; an [ArgumentError] for a [patientId] other than the visit's own.
  void switchToMedical(String encounterId, {String? patientId}) {
    _guardFrozen();
    _mayChart(medical: true);
    final visit = _visit(encounterId);
    final current = visit.fields['patientId']?.value as String?;
    if (current != null && patientId != null && patientId != current) {
      throw ArgumentError('the visit has a patient: change it on its own');
    }
    if (VisitKind.fromCode(visit.fields['kind']?.value) == VisitKind.medical) return;
    if (current == null && patientId == null) throw _needsPatient;
    store.transaction(() {
      // A patient is given to a visit with none at any time, its notes finished or not (3.1).
      if (current == null) store.setField(encounterId, 'patientId', patientId);
      store.setField(encounterId, 'kind', VisitKind.medical.code);
    });
    onChanged?.call();
  }

  /// A note of [type] in the visit (lifecycle 9.4): [type] is the definition the team's list gives
  /// for a new note, so the note is written on that version. If the visit already has a draft of
  /// that type the person may change, that draft is opened instead: their own first, one with
  /// answers before an empty one, then a teammate's they may see (an empty draft of a teammate's is
  /// not there to them, 3.1). An empty draft of their own whose refused sign-off's fix waits to send
  /// (a note removed, 3.3 as built) is not opened. [another] makes a second note of the type all the
  /// same (4.4).
  ///
  /// With a Medical note of the person's own, new or opened, the app adds their own Red flags note
  /// on the team's type ([noteTypes]), in the same transaction as a new note, unless the visit has a
  /// finished one or one of theirs (forms 6.2, [RedFlagsNote.addRedFlagsNote]); [redFlagsFinished]:
  /// the visit read (online) shows a finished Red flags note this phone does not hold, as
  /// [EncounterCompletion.openComplete] takes it. Opening a teammate's draft to help with it adds
  /// none. A team whose list names no Red flags type (none on the phone
  /// yet) gets none, and Complete stops at hard stop 5 until the summary adds it.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting` and `medical_credential` as
  /// [startEncounter]; for a Medical note, `not_offered` in a Non-Medical visit (switch it first,
  /// 3.10) and `medical_note_needs_patient` in a visit with no patient, as the server refuses it.
  ///
  /// PLAN-OPEN: may a note be added to a visit whose other notes are finished (lifecycle 12.1 #3)?
  /// Yes: it is its own note, with its own author and time.
  Future<NoteAdded> addNote(
    String encounterId,
    NoteTypeDef type, {
    bool another = false,
    bool redFlagsFinished = false,
  }) async {
    _guardFrozen();
    final medical = isMedicalType(type);
    _mayChart(medical: medical);
    final visit = _visit(encounterId);
    if (medical) _medicalNoteAllowed(visit);
    // The Red flags note itself, asked for by hand, brings no second one.
    final flags = medical && !_isRedFlags(type) && !redFlagsFinished ? await _teamRedFlags() : null;
    if (!another) {
      final open = await _draftToOpen(encounterId, type.key);
      if (open != null) {
        if (flags != null && _actsAsAuthor(_noteRecord(open))) {
          await RedFlagsNote(this)._addRedFlagsNote(encounterId, flags);
        }
        return (noteId: open, existing: true);
      }
    }
    final withFlags = flags != null && await _needsRedFlags(encounterId, flags);
    _guardFrozen();
    final id = store.transaction(() {
      final id = store.createNote(encounterId: encounterId, noteTypeKey: type.key, noteTypeVersion: type.version);
      if (withFlags) {
        store.createNote(encounterId: encounterId, noteTypeKey: flags.key, noteTypeVersion: flags.version);
      }
      return id;
    });
    onChanged?.call();
    return (noteId: id, existing: false);
  }

  /// The team's Red flags note type, from its listed note types; null when they name none.
  Future<NoteTypeDef?> _teamRedFlags() async => redFlagsTypeOf(await noteTypes());

  /// What the server needs of a visit before it takes a Medical note (4.2, 3.10): a Medical visit
  /// with a patient. Throws `not_offered` or `medical_note_needs_patient` otherwise.
  void _medicalNoteAllowed(LocalRecord visit) {
    _mayChart(medical: true);
    if (VisitKind.fromCode(visit.fields['kind']?.value) != VisitKind.medical) {
      throw const LocalValidationError('Switch this visit to Medical to add a clinical note.', problem: 'not_offered');
    }
    if (visit.fields['patientId']?.value == null) throw _needsPatient;
  }

  /// The draft of the type [key] in the visit that [addNote] opens, if there is one.
  Future<String?> _draftToOpen(String encounterId, String key) async {
    final held = _Held.scan(store, encounterId: encounterId);
    final settling = EncounterCompletion(this)._signoffsOfNotes(ChangeState.pending);
    final drafts = [
      for (final rec in held.ordered(held.notes))
        if (rec.attributes['noteTypeKey'] == key &&
            store.noteState(rec.id)!.status == NoteStatus.draft &&
            !store.sentForReview(rec.id) &&
            // A note removed while its refused sign-off is settled, the fix still waiting to send
            // (3.3 as built): charted on again, Complete would stop it over a Complete the person
            // never made.
            !(settling.contains(rec.id) && noteIsEmpty(_answersOf(rec))))
          rec,
    ];
    // Their own that holds answers before an empty one: a note removed stays an empty draft once its
    // fix has settled, beside the one charted on since (3.3 as built).
    final own = [
      for (final empty in [false, true])
        for (final rec in drafts)
          if (_actsAsAuthor(rec) && noteIsEmpty(_answersOf(rec)) == empty) rec,
    ];
    for (final rec in [...own, ...drafts.where((r) => !own.contains(r))]) {
      final version = rec.attributes['noteTypeVersion'];
      // A note the phone can't lay out can't be charted on: a new one is made instead.
      final definition = version is int ? await definitions.load(key, version) : null;
      if (definition == null || (isMedicalType(definition) && !user.can.chartMedical)) continue;
      if (own.contains(rec)) return rec.id;
      final stored = _answersOf(rec);
      if (noteIsEmpty(stored)) continue;
      try {
        if (visibleAnswers(definition, stored, user.reader(actsAsAuthor: false)) != null) return rec.id;
        // A definition the interpreter can't run is one the phone can't lay the note out by.
        // ignore: avoid_catches_without_on_clauses
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  /// **Remove this note** (lifecycle 3.1, 9.4), asked first by the screen: every answer of the
  /// person's own draft blanked, those a condition hides included, so the note counts for nothing.
  /// One transaction. If a sign-off of the note was refused, Complete sends that sign-off's fix over
  /// the empty note (`finishNotes`), which the server stores with no effect, so the refusal settles
  /// at the next sync (3.4, 4.8; review finding SFN-7) rather than wait in Needs attention for a note
  /// nobody sees any more.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting` and `medical_credential` as
  /// [startEncounter]; `not_author` for a note the person does not act as the author of; [RecordLocked]
  /// for a note finished as this phone knows it, or sent for review (the store's lock: a finished note
  /// is never empty); `read_only` when an answer is
  /// one the server would hold from them (a section that needs an ordering credential, a teammate
  /// charted it), since the note would then never be empty there; `needs_attention` while anything
  /// else about the visit waits in Needs attention, so a refusal is never left behind (3.3 hard
  /// stop 2). A [StateError] when the phone holds no such note, or not its definition.
  Future<void> removeNote(String noteId) async {
    _guardFrozen();
    final definition = await _definitionOf(_noteRecord(noteId));
    _guardFrozen();
    final rec = _noteRecord(noteId);
    if (!_actsAsAuthor(rec)) {
      throw const LocalValidationError('Only the note’s author can remove it.', problem: 'not_author');
    }
    _mayChart(medical: isMedicalType(definition));
    final filled = [
      for (final MapEntry(:key, :value) in _answersOf(rec).entries)
        if (!noteIsEmpty({key: value})) key,
    ];
    if (filled.any((path) => _heldFromPerson(definition, path, actsAsAuthor: true))) throw _readOnly;
    final refused = [
      for (final e in store.needsAttention())
        if ((e.entity, e.op, e.state, e.value)
            case (
              entitySignoff,
              'create',
              ChangeState.rejected,
              {'noteId': final String id, 'act': final String act, 'statementVersion': final String version},
            )
            when id == noteId)
          (act: act, version: version),
    ];
    store.transaction(() {
      for (final path in filled) {
        store.setField(noteId, '$_data$path', null);
      }
      if (refused.isEmpty) return;
      try {
        store.finishNotes(
          [
            NoteToFinish(
              noteId: noteId,
              shownHash: store.contentHashOf(noteId, definition),
              act: SignoffAct.values.byName(refused.last.act),
              statementVersion: refused.last.version,
            ),
          ],
          signer: user.signer,
          definitionOf: definitions.loaded,
        );
      } on LocalValidationError catch (e) {
        if (e.problem != 'needs_attention') rethrow;
        throw const LocalValidationError(
          'Something about this visit waits in Needs attention. Fix it there first, then remove the note.',
          problem: 'needs_attention',
        );
      }
    });
    onChanged?.call();
  }

  /// Whether the answer at [path] of [note] is read-only to the person now (lifecycle 9.5, forms
  /// 8.1): the whole note when it is not [NoteView.editable]; otherwise an answer the server would
  /// hold their set of for a Program Admin, which they could never fix: one that could hold what
  /// they may not see, to someone who does not act as the author ([mayHoldHidden], D88, D92), and an
  /// answer of a section that needs an ordering credential, to a credential that can't order,
  /// whoever acts as the author (6.4 rule 5). The form draws such an answer as it draws one a set
  /// flag clears.
  bool readOnlyAt(NoteView note, String path) {
    final definition = note.definition;
    if (!note.editable || definition == null) return true;
    return _heldFromPerson(definition, path, actsAsAuthor: note.actsAsAuthor);
  }

  /// Saves one answer of the note form (lifecycle 3.2, 9.5): checked by the note's own version
  /// (`checkAnswer`, forms 7.1), then queued with the store's `setField`; the screen then reads the
  /// note again ([onChanged]) and draws the form with the answers the store holds. [value] null
  /// clears the answer. A value equal to what is stored at [path], an answer there or none, is no
  /// change and is not queued: the form keeps no copy of its answers, so a second tap of Normal
  /// before it is drawn again sends the same values again (forms 8.1). Returns whether a change was
  /// queued.
  ///
  /// The definition is the one [openNote] or [openVisit] loaded. Throws, writing nothing:
  /// [ChartingPaused]; `not_charting` and `medical_credential` as [startEncounter]; `read_only` for
  /// an answer [readOnlyAt] says is; the problem `checkAnswer` names (`unknown_path`, `wrong_type`,
  /// ...), with [path]; [RecordLocked] for a note finished as this phone knows it, or sent for
  /// review. A [StateError] when the phone holds no such note, or its definition was not loaded.
  bool saveAnswer(String noteId, String path, Object? value) {
    _guardFrozen();
    final rec = _noteRecord(noteId);
    final version = rec.attributes['noteTypeVersion'];
    final key = rec.attributes['noteTypeKey'];
    final definition = key is String && version is int ? definitions.loaded(key, version) : null;
    if (definition == null) throw StateError('open the note first: its definition is not loaded');
    _mayChart(medical: isMedicalType(definition));
    if (_heldFromPerson(definition, path, actsAsAuthor: _actsAsAuthor(rec))) throw _readOnly;
    final problem = checkAnswer(definition, path, value);
    if (problem != null) {
      throw LocalValidationError('This answer can’t be saved.', problem: problem.code, paths: {path});
    }
    if (store.noteState(noteId)!.status != NoteStatus.draft) throw const RecordLocked();
    if (canonicalJson(rec.fields['$_data$path']?.value) == canonicalJson(value)) return false;
    store.setField(noteId, '$_data$path', value);
    onChanged?.call();
    return true;
  }

  /// Where the diagnosis at [path] of the note [noteId] stands for **Add to the problem list**
  /// (lifecycle 8.3), which the form shows under it: null when it is not offered (no diagnosis
  /// picked there, a visit with no patient, or a role that doesn't chart and so can't add a problem);
  /// else whether the patient's problem list, as the person may see it, holds it open already
  /// ([listed]: "On the problem list"), the list's status the note's own status beside it maps to
  /// ([status], null when it gives none and the person chooses New or Ongoing), and, when it is not
  /// listed, the Resolved problem phase 3's Add problem would ask about ([resolved]: "Is this the
  /// same problem coming back?", `Problems.resolvedMatch`). Throws [ChartingPaused] while the store is
  /// frozen; a [StateError] when the phone holds no such note.
  ProblemListPlace? problemListPlace(String noteId, String path) {
    _guardFrozen();
    final at = _diagnosisAt(noteId, path);
    if (at == null || !user.charts) return null;
    final problems = Problems(store, permissions: user.permissions.toList());
    final listed = (problems.problemsOf(at.patientId) ?? const []).any(
      (p) => p.code?.code == at.code && p.status != 'resolved',
    );
    final match = listed ? null : problems.resolvedMatch(at.patientId, code: at.code, title: at.label);
    return (listed: listed, status: at.status, resolved: match == null ? null : (id: match.id, title: match.title));
  }

  /// **Add to the problem list** (lifecycle 8.3): the diagnosis at [path] of the note [noteId] made a
  /// problem of the visit's patient through phase 3's path (`Problems.add`), naming the visit so the
  /// server records it as made at one: its label as the title (cut to the title's 200 characters)
  /// and as the code's words, at [status], New or Ongoing (from [problemListPlace], or the person's
  /// choice), Sensitive for a code on the sensitive list. When the list holds it Resolved
  /// ([ProblemListPlace.resolved]), [sameComingBack] is the person's answer to phase 3's "Is this the
  /// same problem coming back?": Yes adds it as a new episode of that one (`recurrenceOf`), No as a
  /// different problem, as Add problem does. Returns the problem's ID.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting`; `same_problem_question` while that
  /// question waits for its answer; a [LocalValidationError] for a status that is not New or Ongoing,
  /// or a visit the phone holds of someone outside the patient's group; a [StateError] when there is
  /// no diagnosis at [path] or the visit has no patient.
  String addToProblemList(String noteId, String path, {required String status, bool? sameComingBack}) {
    _guardFrozen();
    _mayChart(medical: false);
    final at = _diagnosisAt(noteId, path);
    if (at == null) throw StateError('no diagnosis picked at $path');
    final problems = Problems(store, permissions: user.permissions.toList());
    final match = problems.resolvedMatch(at.patientId, code: at.code, title: at.label);
    if (match != null && sameComingBack == null) {
      throw const LocalValidationError(
        'Answer whether this is the same problem coming back.',
        problem: 'same_problem_question',
      );
    }
    final id = problems.add(
      at.patientId,
      title: String.fromCharCodes(at.label.runes.take(200)),
      code: (system: 'icd10cm', code: at.code, display: at.label),
      status: status,
      recurrenceOf: match != null && sameComingBack! ? match.id : null,
      encounterId: at.encounterId,
    );
    onChanged?.call();
    return id;
  }

  /// The diagnosis picked at [path] of a note, with its visit, the visit's patient and the list's
  /// status the note's own status beside it maps to (PLAN-OPEN 12.1 #16, `problemListStatus`); null
  /// when nothing is picked there or the visit has no patient.
  ({String code, String label, String encounterId, String patientId, String? status})? _diagnosisAt(
    String noteId,
    String path,
  ) {
    final rec = _noteRecord(noteId);
    final answers = _answersOf(rec);
    final code = answers['$path.code'];
    final encounterId = rec.attributes['encounterId'];
    final visit = encounterId is String ? store.record(encounterId) : null;
    final patientId = visit == null ? null : _patientOf(visit);
    if (code is! String || code.isEmpty || encounterId is! String || patientId == null) return null;
    final label = answers['$path.label'];
    // The status is an ordinary field beside the diagnosis, in its entry (8.3).
    final status = answers['${path.substring(0, path.lastIndexOf('.') + 1)}status'];
    return (
      code: code,
      label: label is String && label.isNotEmpty ? label : code,
      encounterId: encounterId,
      patientId: patientId,
      status: problemListStatus(status is String ? status : null),
    );
  }

  /// Whether the server would hold this person's set of [path] for a Program Admin (lifecycle 4.4,
  /// 6.4 rule 5): a section's `needs` the credential lacks, whoever acts as the author; and, for
  /// someone who does not, an answer that could hold what they may not see. An answer the
  /// definition can't place is held, as the server's `byDefinition` refuses it.
  bool _heldFromPerson(NoteTypeDef definition, String path, {required bool actsAsAuthor}) {
    try {
      if (fieldAt(definition, path)?.section.needs == 'orderMedications' && !user.can.orderMedications) return true;
      return !actsAsAuthor && mayHoldHidden(definition, path, user.reader(actsAsAuthor: false));
      // The interpreter's own faults are Errors as well as Exceptions (records.ts byDefinition).
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      return true;
    }
  }

  /// What the server needs of whoever charts (lifecycle 6.1): `encounters.chart`, and for a Medical
  /// visit or note a credential that charts Medical (4.2). Without either it holds the change for a
  /// Program Admin, which the person could never fix, so nothing is sent.
  void _mayChart({required bool medical}) {
    if (!user.charts) {
      throw const LocalValidationError(_notCharting, problem: 'not_charting');
    }
    if (medical && !user.can.chartMedical) {
      throw const LocalValidationError(_medicalCredential, problem: 'medical_credential');
    }
  }

  static const _needsPatient = LocalValidationError(
    'A clinical note needs a patient. Choose who this visit is for.',
    problem: 'medical_note_needs_patient',
  );

  static const _readOnly = LocalValidationError('You can’t change this answer.', problem: 'read_only');

  LocalRecord _visit(String encounterId) {
    final visit = store.record(encounterId);
    if (visit == null || visit.entity != entityEncounter) throw StateError('no such visit on this phone');
    return visit;
  }

  LocalRecord _noteRecord(String noteId) {
    final rec = store.record(noteId);
    if (rec == null || rec.entity != entityNote) throw StateError('no such note on this phone');
    return rec;
  }

  /// The definition of [note]'s own key and version, loaded for [definitions.loaded] too.
  Future<NoteTypeDef> _definitionOf(LocalRecord note) async {
    final key = note.attributes['noteTypeKey'], version = note.attributes['noteTypeVersion'];
    final definition = key is String && version is int ? await definitions.load(key, version) : null;
    if (definition == null) throw StateError('the definition of the note’s own version is not on this phone');
    return definition;
  }

  /// The definition of [note]'s own version, if [definitions] loaded it.
  NoteTypeDef? _loadedDefinition(LocalRecord note) {
    final key = note.attributes['noteTypeKey'], version = note.attributes['noteTypeVersion'];
    return key is String && version is int ? definitions.loaded(key, version) : null;
  }

  /// A note someone else acts as the author of, which the person may see (6.4); one the phone can't lay out is not shown.
  bool _seesNote(NoteTypeDef definition, Answers stored) {
    try {
      return visibleAnswers(definition, stored, user.reader(actsAsAuthor: false)) != null;
      // A definition the interpreter can't run is one the phone can't lay the note out by.
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      return false;
    }
  }

  /// Who acts as [note]'s author (lifecycle 3.8): the assignee the server's copy names, else its author.
  bool _actsAsAuthor(LocalRecord note) =>
      (note.attributes['actingAuthorId'] as String? ?? note.authorUserId) == user.userId;

  static Map<String, Object?> _answersOf(LocalRecord note) => {
    for (final MapEntry(:key, :value) in note.fields.entries)
      if (key.startsWith(_data)) key.substring(_data.length): value.value,
  };

  void _guardFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  static String? _patientOf(LocalRecord visit) => visit.fields['patientId']?.value as String?;

  static Iterable<NoteTypeVersion> _versions(Iterable<LocalRecord> notes) => [
    for (final n in notes)
      if ((n.attributes['noteTypeKey'], n.attributes['noteTypeVersion']) case (final String key, final int version))
        (key: key, version: version),
  ];

  /// Logs each record of [shown] not in [shownBefore], in the caller's transaction: a store that
  /// can't log throws, and the read with it.
  void _log(List<_Shown> shown, String? patientId, Set<String> shownBefore) {
    for (final s in shown) {
      if (shownBefore.contains(s.record.id)) continue;
      store.appendAudit(
        s.action,
        entity: s.entity,
        entityId: s.record.id,
        patientId: patientId,
        // Made or worked on here, or a copy the server sent (as phase 3 logs a chart read offline).
        source: s.record.origin == 'local' ? 'local' : 'cache',
      );
    }
  }

  /// [rec] as the person may see it, adding what is shown of it to [shown]; null when it is not
  /// shown: an empty draft (3.1), a note the reader may not see (6.4), or one whose definition the
  /// phone lacks, to anyone but whoever acts as its author (the server leaves out a note it cannot
  /// lay out, 5.1).
  NoteView? _note(LocalRecord rec, _Held held, List<_Shown> shown, {bool ownEmptyShown = false}) {
    final key = rec.attributes['noteTypeKey'] as String? ?? '';
    final version = rec.attributes['noteTypeVersion'] as int?;
    final authorId = rec.authorUserId ?? '';
    final actingId = rec.attributes['actingAuthorId'] as String? ?? authorId;
    final actsAsAuthor = actingId == user.userId;
    final state = store.noteState(rec.id)!;
    final stored = <String, Object?>{
      for (final MapEntry(:key, :value) in rec.fields.entries)
        if (key.startsWith(_data)) key.substring(_data.length): value.value,
    };
    if (state.status == NoteStatus.draft && noteIsEmpty(stored) && !(ownEmptyShown && actsAsAuthor)) return null;
    final reader = user.reader(actsAsAuthor: actsAsAuthor);
    final definition = version == null ? null : definitions.loaded(key, version);
    final corrections = held.ordered(held.correctionsOf(rec.id));
    _Interpreted? read;
    try {
      read = definition == null ? null : _interpret(definition, stored, reader, corrections);
      // A definition the interpreter can't run is one the phone can't lay the note out by.
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      read = null;
    }
    if (read == null) {
      return actsAsAuthor ? _unreadable(rec, held, shown, key, version, state, authorId, actingId) : null;
    }
    if (read is! _Readable) return null;
    final draft = state.status == NoteStatus.draft;
    final answers = actsAsAuthor && draft ? stored : read.visible;
    shown.add(_Shown('note.viewed', entityNote, rec));
    final signoffs = [for (final s in held.ordered(held.signoffsOf(rec.id))) _signoff(s, held, shown)];
    final addenda = [for (final a in held.ordered(held.addendaOf(rec.id))) _addendum(a, held, shown)];
    final correctionItems = [for (final c in read.corrections) _correction(c, held, shown)];
    final medical = isMedicalType(definition!);
    return NoteView(
      noteId: rec.id,
      encounterId: rec.attributes['encounterId'] as String? ?? '',
      noteTypeKey: key,
      noteTypeVersion: version,
      definition: definition,
      author: _authorOf(rec),
      actingAuthor: _actingAuthorOf(rec),
      actsAsAuthor: actsAsAuthor,
      status: state.status,
      attestation: state.attestation,
      waitingToSend: store.localEffect(rec.id) != null && !state.sentForReview,
      sentForReview: state.sentForReview,
      editable: draft && !state.sentForReview && user.charts && (!medical || user.can.chartMedical),
      answers: answers,
      // What waits to send of what the reader may see, a cleared answer included, which the
      // answers of someone who does not act as the author leave out (review LFM-3).
      pendingPaths: {
        for (final MapEntry(:key, :value) in rec.fields.entries)
          if (key.startsWith(_data) &&
              !value.confirmed &&
              (answers.containsKey(key.substring(_data.length)) ||
                  _seesAt(definition, key.substring(_data.length), reader)))
            key.substring(_data.length),
      },
      read: read.model,
      recap: read.recap,
      signoffs: signoffs,
      addenda: addenda,
      corrections: correctionItems,
      attestations: const [],
      notSynced: held.createOf(rec.id) != null,
      title: definition.title,
      conflicts: _conflictsOf(rec.id, definition, reader),
    );
  }

  /// The answers of [noteId] two people changed (lifecycle 9.5, forms 8.1), from the store's
  /// conflicts, the latest of each answer as Needs attention shows it: the person's value is the one
  /// **Use my value** sends (`myValue`), which after Keep theirs is not the answer the form shows. A value the server holds at
  /// an answer that could hold what [reader] may not see is left out for someone who does not act as
  /// the author (6.4, D92): Needs attention still has it.
  Map<String, AnswerConflict> _conflictsOf(String noteId, NoteTypeDef definition, NoteReader reader) {
    final paused = store.chartingPaused;
    return {
      for (final e in store.needsAttention())
        if ((e.state, e.recordId, e.field, e.server)
            case (ChangeState.conflict, final id, final String field, final ServerField server)
            when id == noteId && field.startsWith(_data) && _seesAt(definition, field.substring(_data.length), reader))
          field.substring(_data.length): AnswerConflict(
            theirs: server.value,
            mine: (value: store.myValue(e)),
            by: server.changedBy == null
                ? ConflictBy.server
                : server.changedBy == user.userId
                ? ConflictBy.youElsewhere
                : ConflictBy.teammate,
            at: server.changedAt,
            onChoose: paused ? null : (keepMine) async => _choose(e.changeId, keepMine: keepMine),
          ),
    };
  }

  /// Whether [reader] sees whatever the server holds at [path]: all of it, acting as the author.
  bool _seesAt(NoteTypeDef definition, String path, NoteReader reader) {
    if (reader.actsAsAuthor) return true;
    try {
      return !mayHoldHidden(definition, path, reader);
      // A definition the interpreter can't run is one the phone can't lay the note out by.
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      return false;
    }
  }

  /// The person's choice on an answer two people changed, as Needs attention makes it (phase 2): one
  /// change for the answer, sent at the next contact. Throws [ChartingPaused] while the clock check
  /// fails or the store is frozen; `conflict_changed` when the choice is out of date (the server's
  /// value moved on, or the conflict was settled in Needs attention), changing nothing.
  void _choose(String changeId, {required bool keepMine}) {
    _guardFrozen();
    final done =
        store.entry(changeId)?.state == ChangeState.conflict && store.resolveConflict(changeId, keepMine: keepMine);
    onChanged?.call();
    if (!done) {
      throw const LocalValidationError(
        'The other value changed. Check both values again.',
        problem: 'conflict_changed',
      );
    }
  }

  /// What [reader] sees of a note on [definition] holding [stored]: [_Hidden] when they may not see
  /// it at all (6.4), else the answers, the corrections and the read model and recap made of them.
  /// Throws what the interpreter throws.
  _Interpreted _interpret(NoteTypeDef definition, Answers stored, NoteReader reader, List<LocalRecord> corrections) {
    final visible = visibleAnswers(definition, stored, reader);
    if (visible == null) return const _Hidden();
    final hidden = hiddenCorrections(definition, stored, reader, [for (final c in corrections) _stored(c)]);
    final shown = [
      for (final c in corrections)
        if (!hidden.contains(c.id)) c,
    ];
    return _Readable(
      visible: visible,
      corrections: shown,
      model: readModel(definition, visible, [
        for (final c in shown)
          if (c.attributes['outcome'] case final String outcome) _readCorrection(c, outcome),
      ]),
      recap: recapLines(definition, visible),
    );
  }

  /// A note the phone can't lay out, for whoever acts as its author: listed, with its state and
  /// nothing of its answers or of what hangs off it, until the phone holds its definition.
  NoteView _unreadable(
    LocalRecord rec,
    _Held held,
    List<_Shown> shown,
    String key,
    int? version,
    ({NoteStatus status, Attestation attestation, bool sentForReview}) state,
    String authorId,
    String actingId,
  ) {
    shown.add(_Shown('note.viewed', entityNote, rec));
    return NoteView(
      noteId: rec.id,
      encounterId: rec.attributes['encounterId'] as String? ?? '',
      noteTypeKey: key,
      noteTypeVersion: version,
      definition: null,
      author: _authorOf(rec),
      actingAuthor: _actingAuthorOf(rec),
      actsAsAuthor: true,
      status: state.status,
      attestation: state.attestation,
      waitingToSend: store.localEffect(rec.id) != null && !state.sentForReview,
      sentForReview: state.sentForReview,
      editable: false,
      answers: const {},
      pendingPaths: const {},
      read: null,
      recap: const [],
      signoffs: const [],
      addenda: const [],
      corrections: const [],
      attestations: const [],
      notSynced: held.createOf(rec.id) != null,
    );
  }

  PersonRef _person(String userId, {Object? named}) => PersonRef(
    userId,
    name: user.nameFor(userId, named: named, nameOf: nameOf),
  );

  /// Whoever acts as [note]'s author, by the name its snapshot carries (`actingAuthorName`, D108).
  PersonRef _actingAuthorOf(LocalRecord note) => _person(
    note.attributes['actingAuthorId'] as String? ?? note.authorUserId ?? '',
    named: note.attributes['actingAuthorName'],
  );

  /// [note]'s author: named only when they act as its author, since the snapshot names no other
  /// (D108: the original author of an assigned note is not named).
  PersonRef _authorOf(LocalRecord note) {
    final authorId = note.authorUserId ?? '';
    final acting = note.attributes['actingAuthorId'] as String? ?? authorId;
    return acting == authorId ? _actingAuthorOf(note) : _person(authorId);
  }

  SignoffItem _signoff(LocalRecord s, _Held held, List<_Shown> shown) {
    shown.add(_Shown('note.viewed', entitySignoff, s));
    final a = s.attributes;
    final create = held.createOf(s.id);
    return SignoffItem(
      id: s.id,
      signer: _person(s.authorUserId ?? '', named: a['signerName']),
      act: a['act'] as String? ?? '',
      effect: a['effect'] as String?,
      credential: a['signerCredential'] as String? ?? a['claimedCredential'] as String?,
      signedAt: _time(a['signedAt']) ?? create?.time,
      clockVerified: _flag(a['clockVerified']) ?? create?.clockVerified ?? false,
      statementVersion: a['statementVersion'] as String? ?? '',
      needsAttestation: _flag(a['needsAttestation']),
      sending: held.sendingOf(s.id),
    );
  }

  AddendumItem _addendum(LocalRecord r, _Held held, List<_Shown> shown) {
    shown.add(_Shown('note.viewed', entityAddendum, r));
    final a = r.attributes;
    final create = held.createOf(r.id);
    final authorId = r.authorUserId ?? '';
    return AddendumItem(
      id: r.id,
      noteId: a['noteId'] as String?,
      author: _person(authorId, named: a['authorName']),
      credential: a['authorCredential'] as String?,
      text: a['text'] as String? ?? '',
      writtenAt: _time(a['writtenAt']) ?? create?.time,
      clockVerified: _flag(a['clockVerified']) ?? create?.clockVerified ?? false,
      sending: held.sendingOf(r.id),
    );
  }

  CorrectionItem _correction(LocalRecord r, _Held held, List<_Shown> shown) {
    shown.add(_Shown('note.viewed', entityCorrection, r));
    final a = r.attributes;
    final create = held.createOf(r.id);
    return CorrectionItem(
      id: r.id,
      corrector: _person(r.authorUserId ?? '', named: a['correctorName']),
      credential: a['correctorCredential'] as String? ?? a['claimedCredential'] as String?,
      fields: [for (final c in _changes(a)) c['field']! as String],
      outcome: a['outcome'] as String?,
      reason: a['reason'] as String? ?? '',
      requestedByPatient: a['requestedByPatient'] == true,
      declined: a['declined'] == true,
      correctedAt: _time(a['correctedAt']) ?? create?.time,
      clockVerified: _flag(a['clockVerified']) ?? create?.clockVerified ?? false,
      sending: held.sendingOf(r.id),
    );
  }

  static List<Map<String, Object?>> _changes(Map<String, Object?> attributes) => [
    for (final c in attributes['changes'] as List<Object?>? ?? const []) c! as Map<String, Object?>,
  ];

  /// A correction as the read rules take it: the server's copy names each old value; one made here
  /// names none until the server answers.
  static StoredCorrection _stored(LocalRecord r) => StoredCorrection(
    id: r.id,
    outcome: r.attributes['outcome'] as String?,
    changes: [
      for (final c in _changes(r.attributes))
        (field: c['field']! as String, oldValue: c['oldValue'], newValue: c['newValue']),
    ],
  );

  /// A correction the server has answered, as the read model takes it, its corrector named as the
  /// server gave them (D108); "a teammate" only when nothing names them.
  NoteCorrection _readCorrection(LocalRecord r, String outcome) {
    final a = r.attributes;
    final by = r.authorUserId ?? '';
    return NoteCorrection(
      outcome: outcome,
      reason: a['reason'] as String? ?? '',
      correctorName: _person(by, named: a['correctorName']).name ?? 'a teammate',
      correctorCredential: a['correctorCredential'] as String? ?? '',
      correctedAt: a['correctedAt'] as String? ?? '',
      changes: [
        for (final c in _changes(a))
          CorrectionChange(field: c['field']! as String, oldValue: c['oldValue'], newValue: c['newValue']),
      ],
    );
  }

  static DateTime? _time(Object? iso) => iso is String ? DateTime.tryParse(iso) : null;
  static bool? _flag(Object? value) => value is bool ? value : null;
}

const _data = 'data.';

/// Where a note's diagnosis stands for **Add to the problem list**
/// ([EncounterRepository.problemListPlace]): on the patient's list already, the list's status the
/// note gives it, if any, and the Resolved problem it may be coming back as, if any.
typedef ProblemListPlace = ({bool listed, String? status, ({String id, String title})? resolved});

/// The note [EncounterRepository.addNote] opens: a new one, or a draft of the type already in the
/// visit ([existing]).
typedef NoteAdded = ({String noteId, bool existing});

/// A record a read shows, and how it is logged.
class _Shown {
  const _Shown(this.action, this.entity, this.record);
  final String action;
  final String entity;
  final LocalRecord record;
}

/// A record's create as it waits here: when it was made, by this phone's clock.
typedef _Create = ({DateTime time, bool clockVerified, int seq, ChangeState state});

/// What the phone holds of one visit, or of one note: the records and their waiting creates, read
/// once per read. The store keeps no index by visit, so every record is looked at.
class _Held {
  _Held._(this.visit, this.notes, this._signoffs, this._addenda, this._corrections, this._creates);

  /// Of the visit [encounterId], or of the note [noteId] and its visit.
  factory _Held.scan(LocalStore store, {String? encounterId, String? noteId}) {
    final records = [for (final id in store.recordIds()) store.record(id)!];
    final byId = {for (final r in records) r.id: r};
    final visitId = encounterId ?? byId[noteId]?.attributes['encounterId'];
    final visit = byId[visitId];
    final notes = [
      for (final r in records)
        if (r.entity == entityNote &&
            (noteId == null ? r.attributes['encounterId'] == visitId && visitId != null : r.id == noteId))
          r,
    ];
    final noteIds = {for (final n in notes) n.id};
    List<LocalRecord> of(String entity, bool Function(LocalRecord r) keep) => [
      for (final r in records)
        if (r.entity == entity && keep(r)) r,
    ];
    final creates = <String, _Create>{};
    for (final e in store.outbox()) {
      if (e.op != 'create' || e.state == ChangeState.superseded) continue;
      creates[e.recordId] = (
        time: e.correctedTime ?? e.deviceTime,
        clockVerified: e.clockVerified,
        seq: e.seq,
        state: e.state,
      );
    }
    return _Held._(
      visit?.entity == entityEncounter ? visit : null,
      notes,
      of(entitySignoff, (r) => noteIds.contains(r.attributes['noteId'])),
      of(
        entityAddendum,
        (r) =>
            noteIds.contains(r.attributes['noteId']) ||
            (noteId == null && r.attributes['noteId'] == null && r.attributes['encounterId'] == visitId),
      ),
      of(entityCorrection, (r) => noteIds.contains(r.attributes['noteId'])),
      creates,
    );
  }

  final LocalRecord? visit;
  final List<LocalRecord> notes;
  final List<LocalRecord> _signoffs;
  final List<LocalRecord> _addenda;
  final List<LocalRecord> _corrections;
  final Map<String, _Create> _creates;

  List<LocalRecord> signoffsOf(String noteId) => [
    for (final r in _signoffs)
      if (r.attributes['noteId'] == noteId) r,
  ];

  /// A note's addenda, or the visit's own when [noteId] is null.
  List<LocalRecord> addendaOf(String? noteId) => [
    for (final r in _addenda)
      if (r.attributes['noteId'] == noteId) r,
  ];

  List<LocalRecord> correctionsOf(String noteId) => [
    for (final r in _corrections)
      if (r.attributes['noteId'] == noteId) r,
  ];

  /// The waiting create of [recordId]; null once confirmed (or never made here).
  _Create? createOf(String recordId) => _creates[recordId];

  Sending sendingOf(String recordId) => switch (_creates[recordId]?.state) {
    null => Sending.sent,
    ChangeState.pending => Sending.waiting,
    _ => Sending.refused,
  };

  /// [records] in the order they were made, as far as the phone can tell: those the server holds by
  /// the time it gives them, then those confirmed with no time known (a record made here before a
  /// refresh brings its time) by ID, then those waiting here in the order they were made. A note's
  /// time is when the server made it (`createdAt`, D108), compared as its text, to the microsecond,
  /// then by ID as text, as the visit read orders a visit's notes; a sign-off, an addendum and a
  /// correction go by when it was made. The server's order of corrections is the order it applied
  /// them, which is what [hiddenCorrections] reads.
  List<LocalRecord> ordered(List<LocalRecord> records) {
    Comparable<Object>? at(LocalRecord r) {
      if (r.entity == entityNote) return r.attributes['createdAt'] as String?;
      for (final key in const ['signedAt', 'writtenAt', 'correctedAt']) {
        if (r.attributes[key] case final String iso) return DateTime.tryParse(iso);
      }
      return null;
    }

    int rank(LocalRecord r) => _creates.containsKey(r.id) ? 2 : (at(r) == null ? 1 : 0);
    return [...records]..sort((a, b) {
      final byRank = rank(a).compareTo(rank(b));
      if (byRank != 0) return byRank;
      final byTime = switch (rank(a)) {
        0 => at(a)!.compareTo(at(b)!),
        2 => _creates[a.id]!.seq.compareTo(_creates[b.id]!.seq),
        _ => 0,
      };
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });
  }
}

/// What a note is to one reader, once its definition is read.
sealed class _Interpreted {
  const _Interpreted();
}

/// They may not see it (lifecycle 6.4): it is left out with all that hangs off it.
final class _Hidden extends _Interpreted {
  const _Hidden();
}

final class _Readable extends _Interpreted {
  const _Readable({required this.visible, required this.corrections, required this.model, required this.recap});
  final Map<String, Object> visible;

  /// The corrections they may see, in the order applied.
  final List<LocalRecord> corrections;
  final ReadModel model;
  final List<RecapLine> recap;
}
