import '../forms/conditions.dart' show Answers;
import '../forms/definition.dart';
import '../forms/forms_api.dart' show NoteTypeVersion;
import '../forms/read_model.dart';
import '../forms/recap.dart';
import '../forms/visible.dart';
import '../sync/entities.dart' show entityAddendum, entityCorrection, entitySignoff;
import '../sync/local_store.dart';
import 'credentials.dart';
import 'encounter_models.dart';
import 'note_definitions.dart';
import 'rules.dart';
import 'visibility.dart';

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
  EncounterRepository(this.store, {required this.user, required this.definitions, this.nameOf});

  final LocalStore store;
  final EncounterUser user;
  final NoteDefinitions definitions;

  /// A person's name, where the phone knows it; null otherwise. A teammate's record carries only
  /// their ID (an addendum excepted), so a name is often unknown on the phone.
  final String? Function(String userId)? nameOf;

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
      final notes = [for (final rec in held.ordered(held.notes)) ?_note(rec, held, shown)];
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

  /// One note, as the person may see it, with what hangs off it; null when the phone holds no such
  /// note or the person may not see it. The visit itself is not read, nor logged.
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
      final view = _note(rec, held, shown);
      final visit = held.visit;
      _log(shown, visit == null ? null : _patientOf(visit), shownBefore);
      return view;
    });
  }

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
  NoteView? _note(LocalRecord rec, _Held held, List<_Shown> shown) {
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
    if (state.status == NoteStatus.draft && noteIsEmpty(stored)) return null;
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
      author: _person(authorId),
      actingAuthor: _person(actingId),
      actsAsAuthor: actsAsAuthor,
      status: state.status,
      attestation: state.attestation,
      waitingToSend: store.localEffect(rec.id) != null && !state.sentForReview,
      sentForReview: state.sentForReview,
      editable: draft && !state.sentForReview && user.charts && (!medical || user.can.chartMedical),
      answers: answers,
      pendingPaths: {
        for (final MapEntry(:key, :value) in rec.fields.entries)
          if (key.startsWith(_data) && !value.confirmed && answers.containsKey(key.substring(_data.length)))
            key.substring(_data.length),
      },
      read: read.model,
      recap: read.recap,
      signoffs: signoffs,
      addenda: addenda,
      corrections: correctionItems,
      attestations: const [],
      notSynced: held.createOf(rec.id) != null,
    );
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
      author: _person(authorId),
      actingAuthor: _person(actingId),
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

  PersonRef _person(String userId) => PersonRef(userId, name: nameOf?.call(userId));

  SignoffItem _signoff(LocalRecord s, _Held held, List<_Shown> shown) {
    shown.add(_Shown('note.viewed', entitySignoff, s));
    final a = s.attributes;
    final create = held.createOf(s.id);
    return SignoffItem(
      id: s.id,
      signer: _person(s.authorUserId ?? ''),
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
      author: PersonRef(authorId, name: a['authorName'] as String? ?? nameOf?.call(authorId)),
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
      corrector: _person(r.authorUserId ?? ''),
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

  /// A correction the server has answered, as the read model takes it. A teammate's name is often
  /// unknown on the phone: "a teammate", and "you" for the reader's own.
  NoteCorrection _readCorrection(LocalRecord r, String outcome) {
    final a = r.attributes;
    final by = r.authorUserId ?? '';
    return NoteCorrection(
      outcome: outcome,
      reason: a['reason'] as String? ?? '',
      correctorName: nameOf?.call(by) ?? (by == user.userId ? 'you' : 'a teammate'),
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
  /// the time it gives them, then those confirmed with no time known (a note, or a record made here
  /// before a refresh brings its time) by ID, then those waiting here in the order they were made. The server's order is the order it applied them, which is what
  /// [hiddenCorrections] reads.
  List<LocalRecord> ordered(List<LocalRecord> records) {
    DateTime? at(LocalRecord r) {
      for (final key in const ['signedAt', 'writtenAt', 'correctedAt']) {
        if (r.attributes[key] case final String iso) return DateTime.tryParse(iso);
      }
      return null;
    }

    int rank(LocalRecord r) => _creates.containsKey(r.id) ? 2 : (at(r) == null ? 1 : 0);
    return [...records]..sort((a, b) {
      final byRank = rank(a).compareTo(rank(b));
      if (byRank != 0) return byRank;
      return switch (rank(a)) {
        0 => at(a)!.compareTo(at(b)!),
        2 => _creates[a.id]!.seq.compareTo(_creates[b.id]!.seq),
        _ => a.id.compareTo(b.id),
      };
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
