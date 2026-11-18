import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import '../encounters/content_hash.dart';
import '../encounters/rules.dart';
import '../forms/definition.dart';
import '../forms/effective.dart';
import '../forms/finish.dart';
import '../patients/recognisable.dart';
import 'canonical_json.dart';
import 'entities.dart';
import 'local_db.dart';

export 'entities.dart'
    show
        entityAlias,
        entityAllergy,
        entityAudit,
        entityConsent,
        entityEncounter,
        entityIdLink,
        entityNote,
        entityPatient,
        entityProblem,
        entityProblemNote,
        maxNoteFields;

/// Local work on the phone and its confirmed-receipt lifecycle (module 9).
///
/// Every edit becomes an immutable change entry in the outbox, with the version the person was
/// looking at. A change leaves the phone only when a receipt confirms the server stored that exact
/// value (its hash matches); a rejected or conflicted change stays until the person resolves it.
/// Field values are purged only after the record leaves active use (Save & Close), and then only
/// the fields whose latest change is confirmed. A patient's chart is server data kept for a reason
/// (a scope, or local work on that patient) and goes, with its search rows and ID links, when the
/// last reason does (phase 3 design 2.9).

/// When an edit happened, by this phone's clock, and corrected by the last measured offset.
class ClockStamp {
  const ClockStamp({required this.deviceTime, required this.correctedTime, required this.verified});
  final DateTime deviceTime;
  final DateTime? correctedTime;
  final bool verified;
}

/// Charting is refused while the clock check fails (module 9: "Charting pauses whenever the
/// phone's clock is more than 5 minutes off server time"). Saved data and syncing go on.
class ChartingPaused implements Exception {
  const ChartingPaused(this.message);
  final String message;
  @override
  String toString() => 'ChartingPaused';
}

/// A hard stop on the phone: the same rule the server would reject with (module 9 "Hard stops").
/// [problem] is the server's `details.problem` for the rule, and [paths] where a value broke its
/// schema, so a screen can say which field; neither ever holds a value.
class LocalValidationError implements Exception {
  const LocalValidationError(this.message, {this.problem, this.paths = const {}});
  final String message;
  final String? problem;
  final Set<String> paths;
  @override
  String toString() => 'LocalValidationError($message)';
}

/// The lock (lifecycle 4.8): what a finished note no longer lets anyone change, as the server
/// keeps it, which the phone refuses rather than send a change the server would only keep in
/// history. An addendum or a correction is the way.
class RecordLocked implements Exception {
  const RecordLocked();
}

/// Complete stopped before writing anything: these notes changed since the summary screen worked
/// out their hashes (a sync brought in a teammate's change), and a signature covers what was on the
/// screen, not what arrived behind it. "This note changed. Read it again." (lifecycle 4.8, 9.6).
class NoteChanged implements Exception {
  const NoteChanged(this.noteIds);
  final List<String> noteIds;
  @override
  String toString() => 'NoteChanged';
}

/// Who presses Complete, as the phone's saved profile shows them (lifecycle 3.3, 3.5). The server
/// decides again from the membership it holds; this is what the phone shows at once.
class Signer {
  const Signer({required this.credential, required this.canSign, required this.needsAttestation});

  /// The credential a `sign` claims (`claimedCredential`).
  final String credential;
  final bool canSign;
  final bool needsAttestation;
}

/// One note Complete finishes (lifecycle 4.8): the content hash the summary screen worked out when
/// it drew the note, what the person asked for (3.3's table), and the wording they were shown.
class NoteToFinish {
  const NoteToFinish({
    required this.noteId,
    required this.shownHash,
    required this.act,
    required this.statementVersion,
  });
  final String noteId;
  final String shownHash;
  final SignoffAct act;
  final String statementVersion;
}

/// What the phone expects a sign-off it made to do to its note (`localEffect`, lifecycle 4.8),
/// worked out by [signoffEffect], until the sign-off's receipt settles it. A note with one is
/// finished as far as the phone is concerned.
class LocalEffect {
  const LocalEffect({required this.effect, required this.status, required this.attestation, required this.signoffId});

  static LocalEffect? fromJson(Object? j) => j is Map<String, Object?>
      ? LocalEffect(
          effect: SignoffOutcome.values.firstWhere((o) => o.code == j['effect']),
          status: NoteStatus.values.byName(j['status']! as String),
          attestation: Attestation.values.firstWhere((a) => a.code == j['attestation']),
          signoffId: j['signoffId']! as String,
        )
      : null;

  final SignoffOutcome effect;
  final NoteStatus status;
  final Attestation attestation;

  /// The sign-off that should do it: an addendum written before its receipt names it, so it waits
  /// behind it (lifecycle 4.7).
  final String signoffId;

  Map<String, Object?> toJson() => {
    'effect': effect.code,
    'status': status.name,
    'attestation': attestation.code,
    'signoffId': signoffId,
  };
}

/// Where a note keeps its [LocalEffect] (in its record's attributes, which no change sets).
const _localEffectKey = 'localEffect';

enum ChangeState { pending, rejected, conflict, superseded }

/// The server's value for a field, as a conflict or a fetched record reports it.
class ServerField {
  const ServerField({required this.value, required this.version, this.changedBy, this.changedAt});

  factory ServerField.fromJson(Map<String, Object?> j) => ServerField(
    value: j['value'],
    version: (j['version']! as num).toInt(),
    changedBy: j['changedBy'] as String?,
    changedAt: j['changedAt'] == null ? null : DateTime.parse(j['changedAt']! as String),
  );

  final Object? value;
  final int version;
  final String? changedBy;
  final DateTime? changedAt;

  Map<String, Object?> toJson() => {
    'value': value,
    'version': version,
    'changedBy': changedBy,
    'changedAt': changedAt?.toUtc().toIso8601String(),
  };
}

/// A record as the server holds it, for opening someone else's draft here or caching a chart.
class ServerRecord {
  const ServerRecord({
    required this.entity,
    required this.id,
    required this.status,
    required this.authorUserId,
    required this.attributes,
    required this.fields,
  });
  final String entity;
  final String id;
  final String status;
  final String authorUserId;
  final Map<String, Object?> attributes;
  final Map<String, ServerField> fields;
}

class OutboxEntry {
  const OutboxEntry({
    required this.changeId,
    required this.seq,
    required this.entity,
    required this.recordId,
    required this.op,
    required this.field,
    required this.value,
    required this.valueHash,
    required this.baseVersion,
    required this.follows,
    required this.supersedes,
    required this.conflictOf,
    required this.resolution,
    required this.deviceTime,
    required this.correctedTime,
    required this.clockVerified,
    required this.category,
    required this.state,
    required this.attempts,
    required this.reason,
    required this.message,
    required this.details,
    required this.server,
    this.patientId,
  });

  final String changeId;
  final int seq;
  final String entity;
  final String recordId;
  final String op;
  final String? field;
  final Object? value;
  final String valueHash;
  final int baseVersion;
  final String? follows;
  final String? supersedes;
  final String? conflictOf;
  final String? resolution;
  final DateTime deviceTime;
  final DateTime? correctedTime;
  final bool clockVerified;
  final String category;
  final ChangeState state;
  final int attempts;
  final String? reason;
  final String? message;
  final Map<String, Object?>? details;
  final ServerField? server;

  /// The patient this change is work on, if any: that patient's chart stays here while it waits.
  final String? patientId;

  static OutboxEntry fromRow(Row r) => OutboxEntry(
    changeId: r['change_id'] as String,
    seq: r['seq'] as int,
    entity: r['entity'] as String,
    recordId: r['record_id'] as String,
    op: r['op'] as String,
    field: r['field'] as String?,
    value: jsonDecode(r['value_json'] as String),
    valueHash: r['value_hash'] as String,
    baseVersion: r['base_version'] as int,
    follows: r['follows'] as String?,
    supersedes: r['supersedes'] as String?,
    conflictOf: r['conflict_of'] as String?,
    resolution: r['resolution'] as String?,
    deviceTime: DateTime.fromMillisecondsSinceEpoch(r['device_time'] as int, isUtc: true),
    correctedTime: r['corrected_time'] == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(r['corrected_time'] as int, isUtc: true),
    clockVerified: r['clock_verified'] == 1,
    category: r['category'] as String,
    state: ChangeState.values.byName(r['state'] as String),
    attempts: r['attempts'] as int,
    reason: r['reason'] as String?,
    message: r['message'] as String?,
    details: r['details_json'] == null ? null : jsonDecode(r['details_json'] as String) as Map<String, Object?>,
    server: r['server_json'] == null
        ? null
        : ServerField.fromJson(jsonDecode(r['server_json'] as String) as Map<String, Object?>),
    patientId: r['patient_id'] as String?,
  );
}

class LocalField {
  const LocalField({required this.value, required this.serverVersion, required this.pendingChange});
  final Object? value;
  final int serverVersion;
  final String? pendingChange;
  bool get confirmed => pendingChange == null;
}

class LocalRecord {
  const LocalRecord({
    required this.id,
    required this.entity,
    required this.status,
    required this.authorUserId,
    required this.attributes,
    required this.open,
    required this.origin,
    required this.fields,
    this.patientId,
  });
  final String id;
  final String entity;
  final String status;
  final String? authorUserId;
  final Map<String, Object?> attributes;
  final bool open;
  final String origin;
  final Map<String, LocalField> fields;

  /// The patient a patient-side record belongs to (its own ID for a patient).
  final String? patientId;
}

/// What is not yet confirmed, by category (module 9: "Patient encounters: 35%").
class UnsyncedSummary {
  const UnsyncedSummary(this.counts, this.oldest);
  final Map<String, int> counts;
  final DateTime? oldest;
  int get total => counts.values.fold(0, (a, b) => a + b);
}

/// What a receipt said about a change it accepted (design 2.5): the version it left the field at,
/// the field as the server holds it when the value was kept but not applied, and the details
/// (`outcome`, `redirectedTo`, `linkOutcome`, `possibleDuplicate`, `problemRetracted`).
class AcceptedReceipt {
  const AcceptedReceipt({required this.serverVersion, this.server, this.details, this.inReview = false});
  final int serverVersion;
  final ServerField? server;
  final Map<String, Object?>? details;

  /// Held by the server for a Program Admin rather than on the chart.
  final bool inReview;
}

/// Called for every confirmed change, inside the confirmation's transaction (lib/patients/ updates
/// its ID links here).
typedef ConfirmHook = void Function(OutboxEntry entry, AcceptedReceipt receipt);

/// Why a server copy of a chart stays on this phone (section 7). Local work keeps a chart too,
/// without a scope.
class CacheScope {
  const CacheScope({
    required this.patientId,
    required this.kind,
    required this.ref,
    required this.addedAt,
    required this.expiresAt,
  });
  final String patientId;

  /// [scopeOpened], or in phase 7 [scopeRoute].
  final String kind;

  /// '' or a route ID.
  final String ref;
  final DateTime addedAt;
  final DateTime expiresAt;
}

const scopeOpened = 'opened';
const scopeRoute = 'route';

/// A merged patient this phone knows of, and where it learned it.
class PatientRedirect {
  const PatientRedirect({required this.mergedId, required this.survivorId, this.mergedAt, this.origin = 'receipt'});
  final String mergedId;
  final String survivorId;
  final DateTime? mergedAt;

  /// 'index', 'chart' or 'receipt'.
  final String origin;
}

/// Something to tell the person that is not a rejection. Kinds, fields and IDs only.
class LocalNotice {
  const LocalNotice({
    required this.id,
    required this.kind,
    required this.patientId,
    required this.recordId,
    required this.field,
    required this.createdAt,
    required this.readAt,
  });
  final String id;
  final String kind;
  final String? patientId;
  final String? recordId;
  final String? field;
  final DateTime createdAt;
  final DateTime? readAt;
}

/// "Two values recorded for Usual area. Someone who knows this person will choose."
const noticeKeptBoth = 'kept_both';

/// "Kept the name: this person would have had no name or description left."
const noticeNothingToRecognise = 'nothing_to_recognise';

/// "A reviewer will check whether this person already has a chart."
const noticePossibleDuplicate = 'possible_duplicate';

/// "Your note was saved on a problem someone marked entered in error."
const noticeProblemRetracted = 'problem_retracted';

/// The server's `change_not_applied` (lifecycle 4.10): "Only the note’s author can do that. Nothing
/// was changed."
const noticeChangeNotApplied = 'change_not_applied';

/// The server's notice that a sign-off it held for review will not reach the chart (lifecycle 4.6,
/// 9.13, D89): a Program Admin rejected it, or couldn't apply it to the note as it is now. It names
/// the sign-off (entity `note_signoff`), and its kind alone words it: "Your Complete of this note
/// wasn’t applied. Open it and complete it again."
const noticeSignoffNotApplied = 'signoff_not_applied';

/// A sign-off that found its note already finished by a signature over other content (lifecycle
/// 3.4): the person opens the note and reads what was signed.
const noticeFinishedDifferently = 'finished_differently';

/// Where the phone keeps, by note, the sign-off of it the server holds for review (IDs only), until a
/// Program Admin's decision reaches the phone (4.6).
const _heldKvPrefix = 'held_signoff.';

/// Where the phone keeps, by sign-off, the note of each sign-off of its own the server held (IDs
/// only), for good: the notice that one wasn't applied names the sign-off, and settles only the held
/// one it names, or, for one settled here already, is read (D89).
const _heldNoteKvPrefix = 'held_note.';

/// Read-only copies of server records expire after this (module 9 "Route cache").
const serverCopyLifetime = Duration(hours: 24);

/// The keys of the team index's bookkeeping in `kv` (section 6), cleared with the index.
const indexKvPrefix = 'index.';

final _noteTypeKey = RegExp(r'^[a-z][a-z0-9_]{1,60}$');

/// SyncChange.field's limit in the API. A longer field fails the whole push.
const maxFieldLength = 200;

const _tooManyFields = LocalValidationError('A note can have at most $maxNoteFields fields.');

class LocalStore {
  LocalStore(
    this._local, {
    required this.userId,
    required this._stamp,
    bool Function()? chartingPaused,
    DateTime Function()? now,
    Uuid? uuid,
  }) : _paused = chartingPaused ?? (() => false),
       _now = now ?? DateTime.now,
       _uuid = uuid ?? const Uuid(goptions: GlobalOptions(CryptoRNG())) {
    // An edit form is never open in a store that just opened (screens review V2): a file an earlier
    // version left with a patient-side record open, after a lock, a sign-out or a killed app, would
    // otherwise keep that chart, legal name included, from the purge for good.
    _local.db.execute('UPDATE records SET open = 0 WHERE open = 1 AND patient_id IS NOT NULL');
  }

  final LocalDatabase _local;
  final String userId;
  final ClockStamp Function() _stamp;
  final bool Function() _paused;
  final DateTime Function() _now;
  final Uuid _uuid;

  /// Run for every confirmed change, in its transaction (see [confirm]).
  final onConfirmed = <ConfirmHook>[];

  /// Run for every change the server refuses, in the transaction that marks it (see [reject]):
  /// lib/patients/ marks a refused card unusable there.
  final onRejected = <void Function(OutboxEntry entry)>[];

  Database get _db => _local.db;
  int get _nowMs => _now().toUtc().millisecondsSinceEpoch;

  /// The database, for lib/patients/'s own tables (the team index, search names, ID links), always
  /// written inside [transaction].
  Database get database => _db;

  /// How deep [_tx] is nested: the outermost call owns the transaction, inner ones are savepoints.
  int _depth = 0;

  /// One transaction, re-entrant (review finding 15): the outermost call runs BEGIN IMMEDIATE and
  /// COMMIT, a nested one a savepoint, so a store method called inside [transaction] joins it and
  /// a throw anywhere undoes the whole outer transaction.
  T _tx<T>(T Function() fn) {
    final depth = _depth;
    final savepoint = 'tx_$depth';
    _db.execute(depth == 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT $savepoint');
    _depth = depth + 1;
    try {
      final result = fn();
      _db.execute(depth == 0 ? 'COMMIT' : 'RELEASE $savepoint');
      return result;
    } catch (_) {
      if (depth > 0) {
        _db
          ..execute('ROLLBACK TO $savepoint')
          ..execute('RELEASE $savepoint');
      } else if (!_db.autocommit) {
        _db.execute('ROLLBACK');
      }
      rethrow;
    } finally {
      _depth = depth;
    }
  }

  /// Runs [fn] in one SQLite transaction with every store call inside it: a patient with its
  /// aliases, allergies, consents, ID link, search names and scope, or a search with its audit
  /// entry (design 2.9-8). A throw rolls all of it back.
  T transaction<T>(T Function() fn) => _tx(fn);

  void _guardCharting() {
    if (_paused()) {
      throw const ChartingPaused('Charting is paused until the phone’s clock is right.');
    }
  }

  /// The clock pause covers what device time decides (D35): problems, their notes and ID links, as
  /// encounters and notes before them. Registering someone, their demographics, street names,
  /// allergies and consents never wait for it; their changes are stamped unverified meanwhile.
  void _guardFor(String entity) {
    if (rulesFor(entity)?.pausesWithClock ?? true) _guardCharting();
  }

  /// Charting is paused for the clock check now (an intake that wants a card saves without it).
  bool get chartingPaused => _paused();

  String? _frozen;

  /// Stops every new change, audit entries included: the team's data is being handed to a
  /// Program Admin and wiped, so nothing written after the hand-over snapshot may be lost.
  void freeze(String message) => _frozen = message;
  void unfreeze() => _frozen = null;
  bool get frozen => _frozen != null;

  /// Why nothing new may be written, while [frozen].
  String? get frozenMessage => _frozen;

  /// The file this store writes to.
  String get path => _local.path;

  /// The phone's date for the rules a value breaks on its own, by its corrected clock when it has
  /// one. The server checks again against its own date.
  String get _today {
    final stamp = _stamp();
    return (stamp.correctedTime ?? stamp.deviceTime).toUtc().toIso8601String().substring(0, 10);
  }

  // ---- key-value ----

  String? kv(String key) => _local.kvGet(key);

  void setKv(String key, String value) => _local.kvSet(key, value);

  int _nextSeq() {
    final next = (int.tryParse(kv('seq') ?? '') ?? 0) + 1;
    setKv('seq', '$next');
    return next;
  }

  // ---- making changes ----

  String _newId() => _uuid.v4();

  /// Writes one change entry. Runs inside the caller's transaction.
  String _append({
    required String entity,
    required String recordId,
    required String op,
    String? field,
    required Object? value,
    required int baseVersion,
    String? follows,
    String? supersedes,
    String? conflictOf,
    String? resolution,
  }) {
    if (_frozen != null) throw ChartingPaused(_frozen!);
    final problem = storableProblem(value);
    if (problem != null) throw LocalValidationError('This value can’t be saved: $problem.');
    final stamp = _stamp();
    final changeId = _newId();
    _db.execute(
      'INSERT INTO outbox (change_id, seq, entity, record_id, op, field, value_json, value_hash, base_version, '
      'follows, supersedes, conflict_of, resolution, device_time, corrected_time, clock_verified, category, '
      "state, created_at, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      [
        changeId,
        _nextSeq(),
        entity,
        recordId,
        op,
        field,
        jsonEncode(value),
        valueHash(value),
        baseVersion,
        follows,
        supersedes,
        conflictOf,
        resolution,
        stamp.deviceTime.toUtc().millisecondsSinceEpoch,
        stamp.correctedTime?.toUtc().millisecondsSinceEpoch,
        stamp.verified ? 1 : 0,
        categoryOf(entity),
        _nowMs,
        op == 'append' ? null : _patientOfChange(entity, op, recordId, field, value),
      ],
    );
    return changeId;
  }

  /// The patient a change is work on: the one a create names, or that of the record it hangs off (a
  /// problem note's problem, a note's or an addendum's visit, a sign-off's or a correction's note:
  /// lifecycle 4.8), the one an encounter is moved to, or the record's own.
  String? _patientOfChange(String entity, String op, String recordId, String? field, Object? value) {
    if (op == 'create' && value is Map<String, Object?>) {
      final rules = rulesFor(entity);
      return rules?.patientOfCreate(recordId, value) ?? _patientOfRecord(rules?.patientVia(value)?.id);
    }
    if (entity == entityEncounter && field == 'patientId') return value is String ? value : null;
    return _patientOfRecord(recordId);
  }

  /// The patient a record here belongs to: its own column for patient-side records (a sign-off's is
  /// its note's), an encounter's patient field, and a note's encounter's.
  String? _patientOfRecord(Object? id) {
    if (id is! String) return null;
    final r = _db.select('SELECT entity, patient_id, attributes_json FROM records WHERE id = ?', [id]).firstOrNull;
    if (r == null) return null;
    if (r['patient_id'] != null) return r['patient_id'] as String;
    if (r['entity'] == entityEncounter) {
      final v = _fieldValue(id, 'patientId');
      return v is String ? v : null;
    }
    if (r['entity'] == entityNote) {
      final encounter = (jsonDecode(r['attributes_json'] as String) as Map<String, Object?>)['encounterId'];
      return encounter == id ? null : _patientOfRecord(encounter);
    }
    return null;
  }

  Object? _fieldValue(String recordId, String field) {
    final row = _db.select('SELECT value_json FROM fields WHERE record_id = ? AND field = ?', [
      recordId,
      field,
    ]).firstOrNull;
    return row == null ? null : jsonDecode(row['value_json'] as String);
  }

  void _putField(String recordId, String field, Object? value, {required int serverVersion, String? pending}) {
    _db.execute(
      'INSERT INTO fields (record_id, field, value_json, server_version, pending_change) VALUES (?, ?, ?, ?, ?) '
      'ON CONFLICT (record_id, field) DO UPDATE SET value_json = excluded.value_json, '
      'server_version = excluded.server_version, pending_change = excluded.pending_change',
      [recordId, field, jsonEncode(value), serverVersion, pending],
    );
  }

  /// A new encounter, open for charting. Returns its ID (made here, so no server round trip).
  ///
  /// Its kind is a field, which a set moves to Medical; its status is not: the server works it out
  /// from the visit's notes, and the phone takes it from the server's copy (lifecycle 4.3).
  /// [locationText], the place typed by hand, is sent as it is, so it comes trimmed.
  String createEncounter({
    required String kind,
    String? patientId,
    Map<String, Object?>? location,
    String? locationText,
  }) {
    _guardCharting();
    if (kind != 'medical' && kind != 'non_medical') throw const LocalValidationError('Choose medical or non-medical.');
    if (patientId != null && !isUuid(patientId)) throw const LocalValidationError('Unknown patient.');
    _checkLocation(location);
    if (locationText != null) _checkField(entityEncounter, 'locationText', locationText);
    final rules = rulesFor(entityEncounter)!;
    final id = _newId();
    return _tx(() {
      final value = <String, Object?>{
        'kind': kind,
        'patientId': ?patientId,
        'location': ?location,
        'locationText': ?locationText,
      };
      final changeId = _append(entity: entityEncounter, recordId: id, op: 'create', value: value, baseVersion: 0);
      _insertRecord(
        id,
        entityEncounter,
        attributes: rules.attributes(value),
        origin: 'local',
        status: rules.initialStatus(value),
      );
      for (final MapEntry(:key, :value) in rules.createdFields(value).entries) {
        _putField(id, key, value, serverVersion: 0, pending: changeId);
      }
      return id;
    });
  }

  /// A note for one care type within an encounter. Data too large for one create follows it as
  /// edits (see [_splitData]).
  ///
  /// Any visit takes a new note, its notes finished or not: the note is the unit, and a teammate's
  /// Social needs note after the clinician signed must not be lost (lifecycle 4.4).
  String createNote({
    required String encounterId,
    required String noteTypeKey,
    int? noteTypeVersion,
    Map<String, Object?> data = const {},
  }) {
    _guardCharting();
    if (!_noteTypeKey.hasMatch(noteTypeKey)) throw const LocalValidationError('Unknown note type.');
    if (data.length > maxNoteFields) throw _tooManyFields;
    for (final key in data.keys) {
      if (!_dataFieldOk(key)) throw LocalValidationError('Unknown field $key.');
    }
    final id = _newId();
    return _tx(() {
      final head = <String, Object?>{
        'encounterId': encounterId,
        'noteTypeKey': noteTypeKey,
        'noteTypeVersion': ?noteTypeVersion,
      };
      final (:inCreate, :after) = _splitData(head, data);
      final value = {...head, if (inCreate.isNotEmpty) 'data': inCreate};
      final changeId = _append(entity: entityNote, recordId: id, op: 'create', value: value, baseVersion: 0);
      _insertRecord(
        id,
        entityNote,
        attributes: {'encounterId': encounterId, 'noteTypeKey': noteTypeKey, 'noteTypeVersion': noteTypeVersion},
        origin: 'local',
      );
      _putField(id, 'status', 'draft', serverVersion: 0, pending: changeId);
      for (final MapEntry(:key, :value) in inCreate.entries) {
        _putField(id, 'data.$key', value, serverVersion: 0, pending: changeId);
      }
      _appendData(id, after);
      return id;
    });
  }

  /// A new patient-side record made here: an intake, a street name, an allergy, a consent, a
  /// problem, a note on one, an ID link. [value] is the create exactly as it is sent and hashed
  /// (text already trimmed). It is checked as the server would, joins the patient's local work, and
  /// keeps that patient's chart for 24 hours (design 2.9-10). Returns the record's ID.
  String createRecord(String entity, Map<String, Object?> value, {String? id}) {
    final rules = rulesFor(entity);
    if (rules == null || !rules.patientSide) throw ArgumentError('not a patient-side record: $entity');
    if (id != null && !isUuid(id)) throw ArgumentError('record IDs are UUIDs');
    _guardFor(entity);
    _checkCreate(rules, value);
    final recordId = id ?? _newId();
    return _tx(() {
      final changeId = _append(entity: entity, recordId: recordId, op: 'create', value: value, baseVersion: 0);
      _insertCreated(rules, recordId, value, changeId);
      return recordId;
    });
  }

  /// The local record a create makes, its fields as the create sets them, and its patient's scope.
  void _insertCreated(EntityRules rules, String recordId, Map<String, Object?> value, String changeId) {
    final patientId = _patientOfChange(rules.entity, 'create', recordId, null, value);
    _insertRecord(
      recordId,
      rules.entity,
      attributes: rules.attributes(value),
      origin: 'local',
      status: rules.initialStatus(value),
      open: false,
      patientId: patientId,
    );
    for (final MapEntry(:key, :value) in rules.createdFields(value).entries) {
      _putField(recordId, key, value, serverVersion: 0, pending: changeId);
    }
    if (patientId != null) _extendOpened(patientId);
  }

  void _checkCreate(EntityRules rules, Map<String, Object?> value) {
    final paths = rules.createIssues(value);
    if (paths.isNotEmpty) {
      throw LocalValidationError('This entry has a problem. Check it and save again.', paths: paths);
    }
    final problem = rules.valueProblem('create', null, value, _today);
    if (problem != null) throw LocalValidationError('This entry has a problem.', problem: problem);
  }

  /// Which of a note's data goes in its create, and which follows it. One value holds at most
  /// [maxValueBytes] (MAX_VALUE_BYTES in the API), so a note too large for one create goes the way
  /// one charted bit by bit does: the create with the fields that fit, then the rest one by one.
  /// A value that can't be stored at all goes on its own, where [_append] refuses it.
  static ({Map<String, Object?> inCreate, Map<String, Object?> after}) _splitData(
    Map<String, Object?> head,
    Map<String, Object?> data,
  ) {
    if (storableProblem({...head, if (data.isNotEmpty) 'data': data}) == null || storableProblem(head) != null) {
      return (inCreate: data, after: const {});
    }
    final inCreate = <String, Object?>{};
    final after = <String, Object?>{};
    // The create with empty data, then each field adds its key, a colon and its value, and a
    // comma after the first.
    var bytes = _bytes({...head, 'data': const <String, Object?>{}});
    for (final MapEntry(:key, :value) in data.entries) {
      final cost = storableProblem(value) == null ? _bytes(key) + 1 + _bytes(value) + (inCreate.isEmpty ? 0 : 1) : null;
      if (cost != null && bytes + cost <= maxValueBytes) {
        inCreate[key] = value;
        bytes += cost;
      } else {
        after[key] = value;
      }
    }
    return (inCreate: inCreate, after: after);
  }

  static int _bytes(Object? value) => utf8.encode(canonicalJson(value)).length;

  /// Sends a note's data that didn't fit in its create, after it, one field per change. These
  /// fields are new to the server, so each builds on version 0.
  void _appendData(String recordId, Map<String, Object?> data) {
    for (final MapEntry(:key, :value) in data.entries) {
      final changeId = _append(
        entity: entityNote,
        recordId: recordId,
        op: 'set',
        field: 'data.$key',
        value: value,
        baseVersion: 0,
      );
      _putField(recordId, 'data.$key', value, serverVersion: 0, pending: changeId);
    }
  }

  void _insertRecord(
    String id,
    String entity, {
    required Map<String, Object?> attributes,
    required String origin,
    String status = 'draft',
    bool open = true,
    String? patientId,
  }) {
    _db.execute(
      'INSERT INTO records (id, entity, status, author_user_id, attributes_json, open, origin, created_at, updated_at, '
      'patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, entity, status, userId, jsonEncode(attributes), open ? 1 : 0, origin, _nowMs, _nowMs, patientId],
    );
  }

  /// The API's Location schema (services/api/src/sync/records.ts): lat, lng and an optional
  /// non-negative accuracy, nothing else.
  void _checkLocation(Map<String, Object?>? location) {
    if (location == null) return;
    if (rulesFor(entityEncounter)!.fieldIssues('location', location)!.isNotEmpty) {
      throw const LocalValidationError('That location isn’t valid.');
    }
  }

  /// A note field name the API accepts: a data path, and at most [maxFieldLength] characters.
  static bool _dataFieldOk(String path) => dataPathPattern.hasMatch(path) && 'data.$path'.length <= maxFieldLength;

  /// The field's schema and the rules its value breaks on its own, as the server checks them.
  void _checkField(String entity, String field, Object? value) {
    final rules = rulesFor(entity);
    final paths = rules?.fieldIssues(field, value);
    if (paths == null || field.length > maxFieldLength) throw LocalValidationError('Unknown field $field.');
    if (paths.isNotEmpty) {
      throw switch ((entity, field)) {
        // A note is finished by its sign-off (finishNotes); a set of its status only sends it back.
        (entityNote, 'status') => const LocalValidationError('A note is finished with Complete.'),
        (entityEncounter, 'patientId') => const LocalValidationError('Unknown patient.'),
        (entityEncounter, 'location') => const LocalValidationError('That location isn’t valid.'),
        _ => LocalValidationError('This value has a problem. Check it and save again.', paths: paths),
      };
    }
    final problem = rules!.valueProblem('set', field, value, _today);
    if (problem != null) throw LocalValidationError('This value has a problem.', problem: problem);
  }

  /// The server's rules that would refuse a set the person can see coming (hard-stop mirrors):
  /// clearing the last name or description of someone, changing a recorded legal name or birth
  /// (an admin's correction), and moving a problem's status back.
  void _checkSetRules(LocalRecord rec, String field, Object? value) {
    if (rec.entity == entityPatient) {
      final values = {for (final MapEntry(:key, :value) in rec.fields.entries) key: value.value};
      if (isRecognisableField(field) && !recognisableAfter(values, field, value)) {
        throw const LocalValidationError(
          'This person needs a name or a description. Add one before clearing this.',
          problem: 'nothing_to_recognise',
        );
      }
      final cur = values[field];
      if (identityFields.contains(field) &&
          !isBlankValue(cur) &&
          !fills(field, cur, value) &&
          !(field == 'birth' && refinedOutOfRange(cur, value))) {
        throw const LocalValidationError(
          'A recorded legal name or birth date is corrected by a Program Admin.',
          problem: 'identity_admin_only',
        );
      }
    }
    if (rec.entity == entityProblem && field == 'status') {
      final cur = rec.fields['status']?.value;
      if (cur is Map<String, Object?> && value is Map<String, Object?>) {
        final backwards = problemStatusRank(value['status']) < problemStatusRank(cur['status']);
        if (backwards) {
          throw cur['status'] == 'resolved'
              ? const LocalValidationError(
                  'Only a Program Admin moves a problem out of Resolved.',
                  problem: 'resolved_needs_admin',
                )
              : const LocalValidationError('A problem’s status doesn’t go back.', problem: 'status_backwards');
        }
      }
    }
  }

  /// Changes one field. A second edit before the first is confirmed builds on it (`follows`), so
  /// the server never mistakes the person's own earlier edit for someone else's.
  ///
  /// A value equal to the field's is no change and is not sent, unless [observe]: a problem's
  /// status seen again ("Still ongoing", design 9.1) is an observation the server records, moving
  /// its version and check date (9.2). Only a status field is observed.
  ///
  /// Throws [RecordLocked] for what a finished note locks ([_locked]); a note goes back to draft by
  /// [reopenNote].
  void setField(String recordId, String field, Object? value, {bool observe = false}) {
    final rec = record(recordId);
    if (rec == null) throw StateError('no such record');
    if (observe && rulesFor(rec.entity)?.fieldClass(field) != FieldClass.status) {
      throw ArgumentError('only a status is observed: $field');
    }
    _guardFor(rec.entity);
    if (_locked(rec, field)) throw const RecordLocked();
    _checkField(rec.entity, field, value);
    final current = rec.fields[field];
    if (!observe && current != null && canonicalJson(current.value) == canonicalJson(value)) return;
    if (current == null &&
        field.startsWith('data.') &&
        rec.fields.keys.where((k) => k.startsWith('data.')).length >= maxNoteFields) {
      throw _tooManyFields;
    }
    _checkSetRules(rec, field, value);
    _tx(() {
      final changeId = _append(
        entity: rec.entity,
        recordId: recordId,
        op: 'set',
        field: field,
        value: value,
        baseVersion: current?.serverVersion ?? 0,
        follows: current?.pendingChange,
      );
      _putField(recordId, field, value, serverVersion: current?.serverVersion ?? 0, pending: changeId);
      _touch(recordId, status: rulesFor(rec.entity)!.statusAfter(field, value));
      _workedOn(recordId);
      final patientId = rec.patientId;
      if (patientId != null) _extendOpened(patientId);
      if (rec.entity == entityEncounter && field == 'patientId') _fileUnfiled();
    });
  }

  /// The patient, the place and the summary: what a signer vouched for with the notes (lifecycle 3.1).
  static const _envelope = {'patientId', 'location', 'locationText', 'summary'};

  /// Whether the lock stops a set of [field] on [rec] (lifecycle 4.8), as the server would keep it
  /// in history: any field of a note finished as this phone knows it ([_noteStatusHere]), and the
  /// envelope of a visit with a finished note. A visit with no patient is given one at any time,
  /// since filling a blank takes nothing from what anyone signed, and its kind goes to Medical at
  /// any time (3.10).
  bool _locked(LocalRecord rec, String field) => switch (rec.entity) {
    entityNote => _noteStatusHere(rec) != NoteStatus.draft,
    entityEncounter =>
      _envelope.contains(field) &&
          !(field == 'patientId' && isBlankValue(rec.fields['patientId']?.value)) &&
          _envelopeLockedHere(rec),
    _ => false,
  };

  /// A note's status as this phone knows it: what its own sign-off is expected to make it
  /// ([localEffect]) until a receipt settles that sign-off, else the server's.
  NoteStatus _noteStatusHere(LocalRecord note) =>
      LocalEffect.fromJson(note.attributes[_localEffectKey])?.status ?? NoteStatus.values.byName(note.status);

  /// Whether [visit]'s envelope is locked (lifecycle 3.1): the server's copy says it holds a finished
  /// note (`hasFinishedNote`, review finding SLK-1), or a note of it this phone holds is finished
  /// here. The visit's status is not read: a finished note beside a teammate's draft leaves it a
  /// draft. A finished note the reader may not see still locks the visit on the server, which keeps
  /// the change in history; the person learns that the visit holds a finished note, and nothing more.
  /// After every finished note is reopened here, the lock holds until a refresh says otherwise:
  /// that is the safe direction (SLK-2).
  bool _envelopeLockedHere(LocalRecord visit) =>
      visit.attributes['hasFinishedNote'] == true ||
      envelopeLocked([
        for (final r in _db.select(
          "SELECT id FROM records WHERE entity = ? AND json_extract(attributes_json, '\$.encounterId') = ?",
          [entityNote, visit.id],
        ))
          _noteStatusHere(record(r['id'] as String)!),
      ]);

  /// Whether this phone's user acts as [note]'s author (lifecycle 3.8): the clinician an admin
  /// assigned it to after its author left, as the server's copy says, else its author.
  bool _actsAsAuthor(LocalRecord note) => (note.attributes['actingAuthorId'] ?? note.authorUserId) == userId;

  /// Files under their patient the records made here that had none to name when they were made: a
  /// sign-off, an addendum or a correction at a visit with no patient, once the visit is given one
  /// (lifecycle 3.1), as its notes then are. Their waiting changes keep that chart on the phone.
  void _fileUnfiled() {
    for (final r in _db.select(
      'SELECT id, entity, attributes_json FROM records WHERE patient_id IS NULL AND entity IN (?, ?, ?)',
      [entitySignoff, entityAddendum, entityCorrection],
    )) {
      final attributes = jsonDecode(r['attributes_json'] as String) as Map<String, Object?>;
      final patientId = _patientOfRecord(rulesFor(r['entity'] as String)!.patientVia(attributes)?.id);
      if (patientId == null) continue;
      _db
        ..execute('UPDATE records SET patient_id = ? WHERE id = ?', [patientId, r['id']])
        ..execute('UPDATE outbox SET patient_id = ? WHERE record_id = ? AND patient_id IS NULL', [patientId, r['id']]);
      _extendOpened(patientId);
    }
  }

  /// A server copy the person edits is their work now: it follows the Save & Close purge rule,
  /// not the 24-hour expiry of read-only copies.
  void _workedOn(String recordId) =>
      _db.execute("UPDATE records SET origin = 'local' WHERE id = ? AND origin = 'server'", [recordId]);

  void _touch(String recordId, {String? status}) {
    _db.execute('UPDATE records SET updated_at = ?, status = coalesce(?, status) WHERE id = ?', [
      _nowMs,
      status,
      recordId,
    ]);
  }

  /// Reads and searches made offline join the server audit chain on sync (module 9). Logging
  /// doesn't pause for the clock check. During a removal hand-over ([freeze]) it throws like
  /// everything else, and the read must not happen: what can't be logged can't be shown.
  ///
  /// [patientIds] lists the patients a search or match check showed, in order (at most
  /// [auditMaxPatients]); [criteria] which kinds of terms it used. Never the terms (D41).
  void appendAudit(
    String action, {
    String? entity,
    String? entityId,
    String? patientId,
    List<String>? patientIds,
    int? resultCount,
    List<String>? criteria,
    String? source,
    String? checkId,
  }) {
    final value = <String, Object?>{
      'action': action,
      'entity': ?entity,
      'entityId': ?entityId,
      'patientId': ?patientId,
      'patientIds': ?patientIds,
      'resultCount': ?resultCount,
      'criteria': ?criteria,
      'source': ?source,
      'checkId': ?checkId,
    };
    // The API's AuditAppend rules, so an entry the server would refuse never enters the outbox:
    // a refused audit entry could never be fixed or leave the phone.
    final issues = auditIssues(value);
    if (issues.isNotEmpty) throw ArgumentError('the server would refuse this audit entry (${issues.join(', ')})');
    _tx(() => _append(entity: entityAudit, recordId: _newId(), op: 'append', value: value, baseVersion: 0));
  }

  /// Save & Close: the record leaves active use, so its confirmed fields can be purged.
  void closeRecord(String recordId) {
    _db.execute('UPDATE records SET open = 0, updated_at = ? WHERE id = ?', [_nowMs, recordId]);
    purge();
  }

  void reopen(String recordId) => _db.execute('UPDATE records SET open = 1 WHERE id = ?', [recordId]);

  /// Patient-side records with an edit form open on them, in memory only (screens review V2): the
  /// editing ends with this store, so a lock, a sign-out, a team switch or a killed app never
  /// leaves a chart kept from the purge by a form nobody has open. (An encounter or note stays open
  /// in the file until Save & Close, phase 2's rule; a patient's edit form saves as it goes.)
  final _editing = <String>{};

  /// An edit form is open on [recordId]: its patient's chart is local work until [endEditing].
  void beginEditing(String recordId) => _editing.add(recordId);

  /// The form closed: what it kept may be purged now.
  void endEditing(String recordId) {
    _editing.remove(recordId);
    purge();
  }

  // ---- Complete (phase 4) ----

  /// Complete (lifecycle 3.3, 4.8): one sign-off for each of [notes], in one transaction, and the
  /// Red flags note first, so the server finds it finished when the visit's other notes arrive
  /// (4.6). Returns what the phone expects of each, by note, in the order the sign-offs go.
  ///
  /// Each note's content hash is worked out again over what the phone holds now. If one differs
  /// from the hash the summary screen showed, nothing is written and [NoteChanged] names the notes.
  /// Otherwise each note keeps only its answers that count, as the server's copy will once it is
  /// finished (4.5), and gets its sign-off: a new one, or for a note whose last sign-off was refused,
  /// the fix of that sign-off (the same record with the new hash, superseding the refusal), so the
  /// refusal is settled and what waited behind it goes. Each note is then marked with the effect
  /// [signoffEffect] gives ([localEffect]).
  ///
  /// Every refused sign-off can be settled this way: the fix of one whose note was finished since
  /// (here or on another phone), or whose note is now an empty draft (Remove this note), is sent with
  /// the note's hash as the phone holds it and changes nothing on the server, which settles the
  /// refusal. Such a note keeps what it holds, is marked with no effect, and is not in the map.
  ///
  /// [definitionOf] finds a note type's definition by key and version: the definitions of the notes
  /// finished, and of the visit's other notes, to find a finished Red flags note among them.
  /// [redFlagsFinished]: the visit has a finished Red flags note this phone does not hold (the visit
  /// read says so).
  ///
  /// Throws, writing nothing: [ChartingPaused] while the clock check fails (3.11); [RecordLocked]
  /// for a note finished already, here or on the server, with no refused sign-off to settle;
  /// [LocalValidationError] with the server's problem for a sign-off it would refuse (`incomplete`,
  /// `red_flags_first`) or store with no effect (`not_author`, and `empty` for an empty draft with no
  /// refusal to settle: Complete skips those, 3.3), since a worker can't fix either once it is sent.
  Map<String, LocalEffect> finishNotes(
    List<NoteToFinish> notes, {
    required Signer signer,
    required NoteTypeDef? Function(String key, int version) definitionOf,
    bool redFlagsFinished = false,
  }) {
    _guardFor(entitySignoff);
    if ({for (final n in notes) n.noteId}.length != notes.length) {
      throw ArgumentError('a note is finished once by one Complete');
    }
    final shown = [
      for (final n in notes) (asked: n, note: _signable(n.noteId, _definitionOfNote(n.noteId, definitionOf))),
    ];
    final changed = [
      for (final s in shown)
        if (s.note.hash != s.asked.shownHash) s.asked.noteId,
    ];
    if (changed.isNotEmpty) throw NoteChanged(changed);
    final ordered = [
      for (final s in shown)
        if (_isRedFlags(s.note.definition)) s,
      for (final s in shown)
        if (!_isRedFlags(s.note.definition)) s,
    ];
    // A Red flags note finished with the others counts as finished for them: if it can't be, the
    // whole Complete stops on it.
    final redFlagsWith = {
      for (final s in ordered)
        if (_isRedFlags(s.note.definition)) s.note.encounterId,
    };
    return _tx(() {
      final made = <String, LocalEffect>{};
      for (final (:asked, :note) in ordered) {
        bool redFlagsDone() =>
            _isRedFlags(note.definition) ||
            redFlagsFinished ||
            redFlagsWith.contains(note.encounterId) ||
            _redFlagsFinishedHere(note.encounterId, note.rec.id, definitionOf);
        final local = _finishNote(asked, note, signer, redFlagsDone);
        if (local != null) made[asked.noteId] = local;
      }
      return made;
    });
  }

  /// The content hash of [noteId] as this phone holds it (lifecycle 4.5): the visit's patient and
  /// summary, and the note's answers that count by [definition], the definition of its own version.
  /// The summary screen shows the person this, and [finishNotes] works it out again.
  String contentHashOf(String noteId, NoteTypeDef definition) => _signable(noteId, definition).hash;

  /// What the phone expects the sign-off it made of [noteId] to do, until its receipt settles it;
  /// null when it made none (lifecycle 4.8).
  LocalEffect? localEffect(String noteId) => LocalEffect.fromJson(record(noteId)?.attributes[_localEffectKey]);

  /// Whether [noteId] is "Sent for review" (lifecycle 4.8, 9.13): the server holds the sign-off this
  /// phone made of it for a Program Admin. The note stays as the person completed it, locked, until
  /// the admin decides: accepted, the refresh finds it finished ([importServerRecord]); rejected, or
  /// no longer matching the note, its notice makes it a draft to complete again ([addNotice]).
  bool sentForReview(String noteId) {
    final held = _heldSignoff(noteId);
    return held != null && localEffect(noteId)?.signoffId == held;
  }

  /// The sign-off of [noteId] the server holds for review, until its review is settled here.
  String? _heldSignoff(String noteId) => kv('$_heldKvPrefix$noteId');

  void _heldSettled(String noteId) => _db.execute('DELETE FROM kv WHERE key = ?', ['$_heldKvPrefix$noteId']);

  /// A note's state as this phone shows it (lifecycle 3.1, 4.8): what its own sign-off is expected
  /// to make it until a receipt settles it, else the server's status and attestation as the last
  /// receipt or refresh gave them. Null when [noteId] is no note here.
  ({NoteStatus status, Attestation attestation, bool sentForReview})? noteState(String noteId) {
    final rec = record(noteId);
    if (rec == null || rec.entity != entityNote) return null;
    final settled = rec.attributes['attestation'];
    return (
      status: _noteStatusHere(rec),
      attestation:
          localEffect(noteId)?.attestation ??
          Attestation.values.where((a) => a.code == settled).firstOrNull ??
          Attestation.notNeeded,
      sentForReview: sentForReview(noteId),
    );
  }

  /// Sends [noteId] back to draft (lifecycle 3.6, 4.4): a set of its `status` to `draft`, the one
  /// change the lock lets through, when [reopenEffect] says the server will apply it: a Medical note
  /// that waits for a co-signer and was never signed, reopened by whoever acts as its author. The
  /// note is a draft here at once and takes edits again; what the phone expected its sign-off to do
  /// is cleared. A sign-off of it still waiting goes first, so the server finishes the note and then
  /// reopens it, as the person did; [finishNotes] completes it again once that sign-off is confirmed,
  /// since it never leaves two in the outbox.
  ///
  /// [definition] is the note type's, of the note's own key and version: whether a note is Medical is
  /// its type's (3.1).
  ///
  /// Returns [ReopenEffect.apply], or [ReopenEffect.nothing] for a draft, and then sends nothing.
  /// Throws, writing nothing: [ChartingPaused] while the clock check fails; [RecordLocked] for a
  /// note the server keeps as it is (signed or signed once, or a Non-Medical note completed: an
  /// addendum or a correction is the way) and for one [sentForReview]; [LocalValidationError]
  /// `not_author` for someone else's note that its author could reopen, which the server would store
  /// with no effect.
  ReopenEffect reopenNote(String noteId, NoteTypeDef definition) {
    final rec = record(noteId);
    if (rec == null || rec.entity != entityNote) throw StateError('no such note');
    _ownDefinition(rec, definition);
    _guardFor(entityNote);
    // The server holds its sign-off for review and the note there is a draft: a reopen would change
    // nothing, and the admin's accept would then finish the note after it.
    if (sentForReview(noteId)) throw const RecordLocked();
    final status = _noteStatusHere(rec);
    ReopenEffect effect({required bool actsAsAuthor}) => reopenEffect(
      noteStatus: status,
      // The server's copy says whether a note completed now was signed once (a student's correction
      // of a co-signed note leaves one so). A note made here and never refreshed was not.
      everSigned: rec.attributes['everSigned'] == true,
      medicalNote: !definition.kinds.contains(NoteKind.nonMedical),
      actsAsAuthor: actsAsAuthor,
    );
    switch (effect(actsAsAuthor: _actsAsAuthor(rec))) {
      case ReopenEffect.nothing:
        return ReopenEffect.nothing;
      case ReopenEffect.keepInHistory when effect(actsAsAuthor: true) == ReopenEffect.apply:
        throw const LocalValidationError('Only the note’s author can reopen it.', problem: 'not_author');
      case ReopenEffect.keepInHistory:
        throw const RecordLocked();
      case ReopenEffect.apply:
        final current = rec.fields['status'];
        _tx(() {
          final changeId = _append(
            entity: entityNote,
            recordId: noteId,
            op: 'set',
            field: 'status',
            value: NoteStatus.draft.name,
            baseVersion: current?.serverVersion ?? 0,
            follows: current?.pendingChange,
          );
          _putField(
            noteId,
            'status',
            NoteStatus.draft.name,
            serverVersion: current?.serverVersion ?? 0,
            pending: changeId,
          );
          _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [
            jsonEncode({...rec.attributes}..remove(_localEffectKey)),
            noteId,
          ]);
          _touch(noteId, status: NoteStatus.draft.name);
          _workedOn(noteId);
        });
        return ReopenEffect.apply;
    }
  }

  /// [definition], checked to be [note]'s own type and version: a note's content and whether it is
  /// Medical are read by those (lifecycle 4.5).
  static NoteTypeDef _ownDefinition(LocalRecord note, NoteTypeDef? definition) {
    final version = note.attributes['noteTypeVersion'];
    if (definition == null ||
        definition.key != note.attributes['noteTypeKey'] ||
        version is! num ||
        definition.version != version.toInt()) {
      throw StateError('the definition of the note’s own version is needed');
    }
    return definition;
  }

  /// The Red flags and disposition note, which the app adds to a Medical visit by itself (forms 6.2):
  /// found by its type's `auto`, never by its key, as the server finds it.
  static bool _isRedFlags(NoteTypeDef definition) => definition.auto == 'medical';

  NoteTypeDef? _definitionOfNote(String noteId, NoteTypeDef? Function(String key, int version) definitionOf) {
    final attributes = record(noteId)?.attributes ?? const {};
    final key = attributes['noteTypeKey'], version = attributes['noteTypeVersion'];
    return key is String && version is num ? definitionOf(key, version.toInt()) : null;
  }

  /// A note as Complete reads it: the record, its definition, the visit it is on, its answers as
  /// the person has them, and its content hash over those.
  ({LocalRecord rec, NoteTypeDef definition, String encounterId, Map<String, Object?> answers, String hash}) _signable(
    String noteId,
    NoteTypeDef? definition,
  ) {
    final rec = record(noteId);
    if (rec == null || rec.entity != entityNote) throw StateError('no such note');
    // The hash names the type's key and version, so it is taken by the note's own.
    final own = _ownDefinition(rec, definition);
    final encounterId = rec.attributes['encounterId'];
    final visit = encounterId is String ? record(encounterId) : null;
    if (visit == null) throw StateError('the note’s visit is not on this phone');
    final answers = <String, Object?>{
      for (final MapEntry(:key, :value) in rec.fields.entries)
        if (key.startsWith('data.')) key.substring('data.'.length): value.value,
    };
    final patientId = visit.fields['patientId']?.value, summary = visit.fields['summary']?.value;
    return (
      rec: rec,
      definition: own,
      encounterId: visit.id,
      answers: answers,
      hash: noteContentHash(
        noteId: noteId,
        encounterId: visit.id,
        patientId: patientId is String ? patientId : null,
        summary: summary is String ? summary : null,
        definition: own,
        answers: answers,
      ),
    );
  }

  /// One note of [finishNotes], inside its transaction. Null when its sign-off is the fix of a
  /// refused one that is expected to change nothing.
  LocalEffect? _finishNote(
    NoteToFinish asked,
    ({LocalRecord rec, NoteTypeDef definition, String encounterId, Map<String, Object?> answers, String hash}) note,
    Signer signer,
    bool Function() redFlagsDone,
  ) {
    final rec = note.rec;
    final waiting = _signoffsOf(rec.id);
    // Never two sign-offs of one note: one waiting, or one the server holds for review, finishes it
    // here. Only a refused one is completed again (its refusal cleared the effect).
    if (waiting.any((e) => e.state != ChangeState.rejected) || (waiting.isEmpty && localEffect(rec.id) != null)) {
      throw const RecordLocked();
    }
    final medical = !note.definition.kinds.contains(NoteKind.nonMedical);
    final finishOk = finishCheck(note.definition, note.answers).isEmpty;
    final effect = signoffEffect(
      noteStatus: NoteStatus.values.byName(rec.status),
      medicalNote: medical,
      act: asked.act,
      actsAsAuthor: _actsAsAuthor(rec),
      canSign: signer.canSign,
      needsAttestation: signer.needsAttestation,
      hashMatches: true,
      emptyDraft: noteIsEmpty(note.answers),
      finishOk: finishOk,
      redFlagsDone: medical && redFlagsDone(),
    );
    // A refused sign-off is always settled by its fix (the coordinator's decision on review findings
    // SFN-1 and SFN-7): of a note finished since, here or on another phone, or of one removed since
    // (an empty draft), the server stores it with no effect, which settles the refusal; its receipt
    // then shows the note as the server holds it, and says whether what was finished is what this
    // phone saw (finished_differently).
    final settlesOnly =
        waiting.isNotEmpty &&
        effect is SignoffUnchanged &&
        (effect.reason == SignoffUnchangedReason.alreadyFinished || effect.reason == SignoffUnchangedReason.empty);
    final applied = switch (effect) {
      SignoffApplied() => effect,
      SignoffUnchanged() when settlesOnly => null,
      SignoffUnchanged(reason: SignoffUnchangedReason.alreadyFinished) => throw const RecordLocked(),
      // Complete skips an empty draft (3.3), but not the person's own Red flags note on a Medical
      // visit, whose finish check asks for the red-flag answer (hard stop 5): what is missing is said
      // first.
      SignoffUnchanged(reason: SignoffUnchangedReason.empty) =>
        throw finishOk
            ? const LocalValidationError('This note is empty, so there is nothing to complete.', problem: 'empty')
            : const LocalValidationError('This is missing something the note needs.', problem: 'incomplete'),
      SignoffUnchanged() => throw const LocalValidationError(
        'Only the note’s author can complete it.',
        problem: 'not_author',
      ),
      SignoffRefused(problem: SignoffRefusal.redFlagsFirst) => throw const LocalValidationError(
        'Answer the red-flag question first, then complete again.',
        problem: 'red_flags_first',
      ),
      SignoffRefused(:final problem) => throw LocalValidationError(
        'This is missing something the note needs.',
        problem: problem.code,
      ),
    };
    final value = <String, Object?>{
      'noteId': rec.id,
      'act': asked.act.name,
      'contentHash': note.hash,
      'claimedCredential': asked.act == SignoffAct.sign ? signer.credential : null,
      'statementVersion': asked.statementVersion,
    };
    final rules = rulesFor(entitySignoff)!;
    _checkCreate(rules, value);
    // The phone's copy holds what was signed, as the server's will (lifecycle 4.5), so nothing done
    // here later (a correction) can bring back an answer the signer never saw. A change to one that
    // is not confirmed yet still goes: the server drops it as it finishes the note, into history.
    // A sign-off that finishes nothing leaves the note as it is.
    if (applied != null) {
      final counting = effectiveAnswers(note.definition, note.answers);
      for (final path in note.answers.keys) {
        if (!counting.containsKey(path)) {
          _db.execute('DELETE FROM fields WHERE record_id = ? AND field = ?', [rec.id, 'data.$path']);
        }
      }
    }
    final String signoffId;
    if (waiting.isEmpty) {
      signoffId = _newId();
      _insertCreated(
        rules,
        signoffId,
        value,
        _append(entity: entitySignoff, recordId: signoffId, op: 'create', value: value, baseVersion: 0),
      );
    } else {
      // The refused sign-off sent again with the new hash (lifecycle 3.4): the same record ID, so
      // what names it (an addendum) still does, and the copy here holds the new value.
      signoffId = waiting.last.recordId;
      final fix = _append(
        entity: entitySignoff,
        recordId: signoffId,
        op: 'create',
        value: value,
        baseVersion: 0,
        supersedes: waiting.last.changeId,
      );
      for (final refused in waiting) {
        _supersede(refused.changeId, by: fix);
      }
      _db.execute('DELETE FROM records WHERE id = ?', [signoffId]);
      _insertCreated(rules, signoffId, value, fix);
    }
    // Completing again answers "Your Complete of this note wasn’t applied" about any sign-off of it:
    // read here, and on the server at the next contact (4.6).
    _db.execute(
      'UPDATE local_notices SET read_at = ? WHERE kind = ? AND read_at IS NULL AND (record_id IN '
      '(SELECT substr(key, ${_heldNoteKvPrefix.length + 1}) FROM kv '
      "WHERE substr(key, 1, ${_heldNoteKvPrefix.length}) = '$_heldNoteKvPrefix' AND value = ?) "
      "OR record_id IN (SELECT id FROM records WHERE entity = ? AND json_extract(attributes_json, '\$.noteId') = ?))",
      [_nowMs, noticeSignoffNotApplied, rec.id, entitySignoff, rec.id],
    );
    _touch(rec.id);
    _workedOn(rec.id);
    if (applied == null) return null;
    final local = LocalEffect(
      effect: applied.effect,
      status: applied.statusAfter,
      attestation: applied.attestationAfter,
      signoffId: signoffId,
    );
    _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [
      jsonEncode({...rec.attributes, _localEffectKey: local.toJson()}),
      rec.id,
    ]);
    return local;
  }

  /// The sign-offs of [noteId] in the outbox that nothing has superseded, oldest first.
  List<OutboxEntry> _signoffsOf(String noteId) => _db
      .select(
        "SELECT * FROM outbox WHERE entity = ? AND op = 'create' AND state <> 'superseded' "
        "AND json_extract(value_json, '\$.noteId') = ? ORDER BY seq",
        [entitySignoff, noteId],
      )
      .map(OutboxEntry.fromRow)
      .toList();

  /// Whether a Red flags note of [encounterId] other than [noteId] is finished as this phone knows
  /// it: by the server's copy, or by a sign-off made here that the server has not refused.
  bool _redFlagsFinishedHere(
    String encounterId,
    String noteId,
    NoteTypeDef? Function(String key, int version) definitionOf,
  ) {
    for (final r in _db.select(
      "SELECT id FROM records WHERE entity = ? AND id <> ? AND json_extract(attributes_json, '\$.encounterId') = ?",
      [entityNote, noteId, encounterId],
    )) {
      final id = r['id'] as String;
      final definition = _definitionOfNote(id, definitionOf);
      if (definition == null || !_isRedFlags(definition)) continue;
      if (_noteStatusHere(record(id)!) != NoteStatus.draft) return true;
    }
    return false;
  }

  // ---- reading ----

  LocalRecord? record(String id) {
    final r = _db.select('SELECT * FROM records WHERE id = ?', [id]).firstOrNull;
    if (r == null) return null;
    final fields = {
      for (final f in _db.select('SELECT * FROM fields WHERE record_id = ?', [id]))
        f['field'] as String: LocalField(
          value: jsonDecode(f['value_json'] as String),
          serverVersion: f['server_version'] as int,
          pendingChange: f['pending_change'] as String?,
        ),
    };
    return LocalRecord(
      id: id,
      entity: r['entity'] as String,
      status: r['status'] as String,
      authorUserId: r['author_user_id'] as String?,
      attributes: jsonDecode(r['attributes_json'] as String) as Map<String, Object?>,
      open: r['open'] == 1,
      origin: r['origin'] as String,
      fields: fields,
      patientId: r['patient_id'] as String?,
    );
  }

  List<String> recordIds({bool openOnly = false}) => [
    for (final r in _db.select(openOnly ? 'SELECT id FROM records WHERE open = 1' : 'SELECT id FROM records'))
      r['id'] as String,
  ];

  /// The patient-side records here that belong to [patientId] (its chart, as far as this phone has it).
  List<String> recordIdsOfPatient(String patientId) => [
    for (final r in _db.select('SELECT id FROM records WHERE patient_id = ? ORDER BY created_at, id', [patientId]))
      r['id'] as String,
  ];

  OutboxEntry? entry(String changeId) =>
      _db.select('SELECT * FROM outbox WHERE change_id = ?', [changeId]).map(OutboxEntry.fromRow).firstOrNull;

  List<OutboxEntry> outbox() => _db.select('SELECT * FROM outbox ORDER BY seq').map(OutboxEntry.fromRow).toList();

  /// What a removal hands to quarantine: every unconfirmed change, except one the server refused
  /// as unreadable (a 422, see SyncEngine). Quarantine reads changes with the same schema, so one
  /// such change would block the hand-over, and with it the wipe, for good.
  List<OutboxEntry> handOver() => [
    for (final e in outbox())
      if (e.state != ChangeState.superseded && e.details?['problem'] != 'malformed') e,
  ];

  Set<String> handOverIds() => {for (final e in handOver()) e.changeId};

  /// Rejections the server couldn't read: they can't be handed over, so a removal keeps them on
  /// the phone (locked) until an administrator orders a wipe.
  int unreadableCount() =>
      outbox().where((e) => e.state == ChangeState.rejected && e.details?['problem'] == 'malformed').length;

  /// The oldest changes that may go now, in order. A change waits ("held") while something it
  /// depends on is rejected or in conflict (module 9: "Later changes that depend on a rejected
  /// one are held, not sent"): an earlier change to the same field; any change to a record whose
  /// create is rejected; and any change naming such a record (design 2.9-2: a patient's street
  /// names, allergies, consents, problems and ID link, a problem's notes, an encounter's notes, and
  /// a problem status naming an encounter), with everything on it in turn.
  List<OutboxEntry> sendable({int limit = 100}) => _classify().sendable.take(limit).toList();

  /// Pending changes that wait on an unresolved earlier one.
  int heldCount() => _classify().held;

  ({List<OutboxEntry> sendable, int held}) _classify() {
    final blockedRecords = <String>{};
    final blockedFields = <String>{};
    final sendable = <OutboxEntry>[];
    var held = 0;
    final entries = _db
        .select("SELECT * FROM outbox WHERE state <> 'superseded' ORDER BY seq")
        .map(OutboxEntry.fromRow)
        .toList();
    // Where each record's unconfirmed create sits. A fixed create comes after the changes that
    // waited on the one it replaces; the server applies a batch in order, so those wait for it.
    final createdAt = {
      for (final e in entries)
        if (e.op == 'create') e.recordId: e.seq,
    };
    bool createdLater(String recordId, int seq) => (createdAt[recordId] ?? 0) > seq;
    for (final e in entries) {
      final fieldKey = '${e.recordId}|${e.field}';
      if (e.state == ChangeState.rejected || e.state == ChangeState.conflict) {
        if (e.op == 'create') {
          blockedRecords.add(e.recordId);
        } else {
          blockedFields.add(fieldKey);
        }
        continue;
      }
      final parents = [for (final p in parentsOf(entity: e.entity, op: e.op, field: e.field, value: e.value)) p.id];
      final waits =
          blockedRecords.contains(e.recordId) ||
          (e.op == 'set' && blockedFields.contains(fieldKey)) ||
          parents.any(blockedRecords.contains) ||
          createdLater(e.recordId, e.seq) ||
          parents.any((p) => createdLater(p, e.seq));
      if (waits) {
        held++;
        // What waits on a held create waits too, and a later edit of a held edit's field.
        if (e.op == 'create') blockedRecords.add(e.recordId);
        if (e.op == 'set') blockedFields.add(fieldKey);
      } else {
        sendable.add(e);
      }
    }
    return (sendable: sendable, held: held);
  }

  int _count(String sql, [List<Object?> args = const []]) => _db.select(sql, args).first['n']! as int;

  /// The Needs attention list: rejections the person can fix and conflicts they must choose on.
  ///
  /// A field with several conflicts (edited twice before syncing) shows once, with the server's
  /// latest value: the person makes one choice for the field.
  List<OutboxEntry> needsAttention() {
    final all = _db
        .select("SELECT * FROM outbox WHERE state IN ('rejected', 'conflict') ORDER BY seq")
        .map(OutboxEntry.fromRow)
        .toList();
    final latestConflict = <String, int>{
      for (final e in all)
        if (e.state == ChangeState.conflict) '${e.recordId}|${e.field}': e.seq,
    };
    return [
      for (final e in all)
        if (e.state == ChangeState.rejected || latestConflict['${e.recordId}|${e.field}'] == e.seq) e,
    ];
  }

  /// "Your value" on a conflict card: what the person has in the field now (cleared counts as a
  /// value), which is exactly what "Use my value" sends and what "Keep theirs" keeps in history.
  ///
  /// After "Keep theirs" the field shows the server's value, while the person's own value travels
  /// in that choice. If the choice comes back as a new conflict (the value moved on again), the
  /// card shows the value the choice carried, unless the person edited the field since.
  Object? myValue(OutboxEntry conflict) {
    final row = _db.select('SELECT value_json, pending_change FROM fields WHERE record_id = ? AND field = ?', [
      conflict.recordId,
      conflict.field,
    ]).firstOrNull;
    if (row == null || (conflict.resolution == 'keep_server' && row['pending_change'] == conflict.changeId)) {
      return conflict.value;
    }
    return jsonDecode(row['value_json'] as String);
  }

  int inReviewCount() => _count('SELECT count(*) AS n FROM in_review');

  UnsyncedSummary unsynced() {
    final rows = _db.select(
      "SELECT category, count(*) AS n, min(device_time) AS oldest FROM outbox WHERE state <> 'superseded' "
      'GROUP BY category',
    );
    final counts = {for (final r in rows) r['category'] as String: r['n'] as int};
    final oldest = rows.map((r) => r['oldest'] as int).fold<int?>(null, (a, b) => a == null || b < a ? b : a);
    return UnsyncedSummary(counts, oldest == null ? null : DateTime.fromMillisecondsSinceEpoch(oldest, isUtc: true));
  }

  bool get hasUnsynced => unsynced().total > 0;

  /// What [unsynced] totals, for a database no store has open (another team's).
  static int unsyncedIn(LocalDatabase local) =>
      local.db.select("SELECT count(*) AS n FROM outbox WHERE state <> 'superseded'").first['n']! as int;

  // ---- receipts ----

  void recordAttempt(Iterable<OutboxEntry> sent) {
    for (final e in sent) {
      _db.execute('UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ? WHERE change_id = ?', [
        _nowMs,
        e.changeId,
      ]);
    }
  }

  /// The server stored exactly this value. The entry is deleted (the server holds it now), and the
  /// field it set counts as confirmed unless a newer local change to it is still waiting.
  /// [inReview]: the server holds it for a Program Admin rather than on the chart.
  ///
  /// [server] comes with a value the server kept but didn't apply (kept both, history only): the
  /// field shows the chart's value, unless the person edited it again since (design 2.5).
  /// [details] may say the record was merged (`redirectedTo`: a provisional redirect until the next
  /// index or chart refresh replaces it) and carry outcomes the person is told about. Everything
  /// here, and every [onConfirmed] hook, runs in one transaction with the outbox delete.
  void confirm(
    OutboxEntry e, {
    required int serverVersion,
    ServerField? server,
    Map<String, Object?>? details,
    bool inReview = false,
  }) {
    _tx(() {
      final rules = rulesFor(e.entity);
      if (e.op == 'create') {
        _db.execute(
          'UPDATE fields SET server_version = 1, pending_change = NULL WHERE record_id = ? AND pending_change = ?',
          [e.recordId, e.changeId],
        );
        // The fields the create set are at version 1 on the server, including ones edited here
        // again since; fields first set by a later edit are still unknown to it (version 0).
        final value = e.value;
        for (final name
            in rules != null && value is Map<String, Object?> ? rules.createdFields(value).keys : const <String>[]) {
          _db.execute('UPDATE fields SET server_version = 1 WHERE record_id = ? AND field = ? AND server_version = 0', [
            e.recordId,
            name,
          ]);
        }
      } else if (e.op == 'set') {
        final row = _db.select('SELECT pending_change FROM fields WHERE record_id = ? AND field = ?', [
          e.recordId,
          e.field,
        ]).firstOrNull;
        final newerWaits = row != null && row['pending_change'] != null && row['pending_change'] != e.changeId;
        if (server != null && row != null && !newerWaits) {
          // Kept, not applied: the chart's value is what the person sees now.
          _putField(e.recordId, e.field!, server.value, serverVersion: server.version);
          _touch(e.recordId, status: rules?.statusAfter(e.field!, server.value));
        } else {
          _db.execute('UPDATE fields SET server_version = ? WHERE record_id = ? AND field = ? AND server_version < ?', [
            serverVersion,
            e.recordId,
            e.field,
            serverVersion,
          ]);
          _db.execute(
            'UPDATE fields SET pending_change = NULL WHERE record_id = ? AND field = ? AND pending_change = ?',
            [e.recordId, e.field, e.changeId],
          );
        }
      }
      if (e.entity == entitySignoff && e.op == 'create') _settleSignoff(e, details, inReview: inReview);
      if (details != null) _receiptDetails(e, details);
      _deleteSettled(e);
      if (inReview) {
        _db.execute('INSERT OR IGNORE INTO in_review (change_id, entity, record_id, received_at) VALUES (?, ?, ?, ?)', [
          e.changeId,
          e.entity,
          e.recordId,
          _nowMs,
        ]);
      }
      _db.execute('DELETE FROM outbox WHERE change_id = ?', [e.changeId]);
      final receipt = AcceptedReceipt(
        serverVersion: serverVersion,
        server: server,
        details: details,
        inReview: inReview,
      );
      for (final hook in onConfirmed) {
        // Its own savepoint: a failing hook loses only its own bookkeeping. The server holds the
        // value either way, and a confirmation that could never complete would hold the queue.
        try {
          _tx(() => hook(e, receipt));
        } on Object {
          // Nothing of the hook was written.
        }
      }
      _purge();
    });
  }

  /// What an accepted receipt's details change here: a redirect learned, and the notices.
  void _receiptDetails(OutboxEntry e, Map<String, Object?> details) {
    final redirectedTo = details['redirectedTo'];
    // A merged patient's set went to the survivor. A problem's `redirectedTo` (merged into another
    // problem) is no patient redirect.
    if (e.entity == entityPatient && redirectedTo is String) {
      _db.execute(
        'INSERT INTO patient_redirects (merged_id, survivor_id, merged_at, origin) VALUES (?, ?, NULL, ?) '
        'ON CONFLICT (merged_id) DO UPDATE SET survivor_id = excluded.survivor_id, merged_at = excluded.merged_at, '
        'origin = excluded.origin',
        [e.recordId, redirectedTo, 'receipt'],
      );
    }
    final patientId = e.entity == entityPatient && redirectedTo is String ? redirectedTo : e.patientId;
    if (details['outcome'] == 'kept_both') {
      addNotice(noticeKeptBoth, patientId: patientId, recordId: e.recordId, field: e.field);
    }
    if (details['problem'] == 'nothing_to_recognise') {
      addNotice(noticeNothingToRecognise, patientId: patientId, recordId: e.recordId, field: e.field);
    }
    if (details['possibleDuplicate'] == true) addNotice(noticePossibleDuplicate, patientId: e.recordId);
    if (details['problemRetracted'] == true) {
      addNotice(noticeProblemRetracted, patientId: patientId, recordId: e.recordId);
    }
  }

  /// What a sign-off's receipt settles here (lifecycle 4.6, 4.8). Held for review, its note keeps the
  /// effect the phone expects and says "Sent for review" until a Program Admin decides. Otherwise the
  /// note takes the status and attestation the receipt gives, which are the server's decision
  /// whatever the phone expected (a credential lowered meanwhile saves a signature unsigned), and
  /// what the phone expected is cleared. A sign-off that found the note finished by a signature over
  /// other content tells the person to read what was signed (3.4).
  void _settleSignoff(OutboxEntry e, Map<String, Object?>? details, {required bool inReview}) {
    final value = e.value;
    final noteId = value is Map<String, Object?> ? value['noteId'] : null;
    if (noteId is! String) return;
    if (inReview) {
      setKv('$_heldNoteKvPrefix${e.recordId}', noteId);
      // Its notice came first (this receipt was lost and is the one sent again): settled at once.
      if (_count('SELECT count(*) AS n FROM local_notices WHERE kind = ? AND record_id = ?', [
            noticeSignoffNotApplied,
            e.recordId,
          ]) >
          0) {
        if (localEffect(noteId)?.signoffId == e.recordId) _clearEffect(noteId);
      } else {
        setKv('$_heldKvPrefix$noteId', e.recordId);
      }
      return;
    }
    final note = record(noteId);
    if (note == null) return;
    final expected = LocalEffect.fromJson(note.attributes[_localEffectKey]);
    final mine = expected?.signoffId == e.recordId ? expected : null;
    // A receipt that doesn't give the note's state leaves it as the phone expected, locked rather
    // than open, until the refresh shows it.
    final status = NoteStatus.values.asNameMap()[details?['status']] ?? mine?.status;
    final attestation =
        Attestation.values.where((a) => a.code == details?['attestation']).firstOrNull ?? mine?.attestation;
    final attributes = {...note.attributes, 'attestation': ?attestation?.code};
    if (mine != null) attributes.remove(_localEffectKey);
    _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [jsonEncode(attributes), noteId]);
    // A reopen made after this sign-off waits behind it: the note stays the draft the person made it.
    final field = note.fields['status'];
    if (status != null && field?.pendingChange == null) {
      _putField(noteId, 'status', status.name, serverVersion: field?.serverVersion ?? 0);
      _touch(noteId, status: status.name);
    }
    if (details?['effect'] == 'none' && details?['reason'] == 'already_finished' && details?['hashMatches'] == false) {
      addNotice(noticeFinishedDifferently, patientId: e.patientId, recordId: noteId);
    }
  }

  /// Deletes every superseded entry this confirmed change covers, following the links both ways
  /// and through chains (a resolution that was itself superseded by a later one, a fix of a fix):
  /// their values are in [e], which the server now holds. Without following chains, the first
  /// entry of a chain stayed forever and kept its record from being purged.
  void _deleteSettled(OutboxEntry e) {
    final queue = <String>[e.changeId];
    final seen = <String>{};
    while (queue.isNotEmpty) {
      final id = queue.removeLast();
      if (!seen.add(id)) continue;
      final linked = _db.select(
        "SELECT change_id, conflict_of, supersedes FROM outbox WHERE state = 'superseded' AND "
        '(conflict_of = ? OR supersedes = ? OR change_id IN (SELECT conflict_of FROM outbox WHERE change_id = ?) '
        'OR change_id IN (SELECT supersedes FROM outbox WHERE change_id = ?))',
        [id, id, id, id],
      );
      for (final r in linked) {
        queue.add(r['change_id'] as String);
      }
    }
    seen.remove(e.changeId);
    for (final id in seen) {
      _db.execute("DELETE FROM outbox WHERE change_id = ? AND state = 'superseded'", [id]);
    }
  }

  /// Kept, marked Rejected, until someone resolves it (module 9). Never purged. Every [onRejected]
  /// hook runs in the same transaction.
  void reject(OutboxEntry e, {required String reason, String? message, Map<String, Object?>? details}) {
    _tx(() {
      _db.execute(
        "UPDATE outbox SET state = 'rejected', reason = ?, message = ?, details_json = ? WHERE change_id = ? "
        "AND state = 'pending'",
        [reason, message, details == null ? null : jsonEncode(details), e.changeId],
      );
      if (_db.updatedRows == 0) return;
      if (e.entity == entitySignoff && e.op == 'create') _signoffRefused(e);
      for (final hook in onRejected) {
        // As in [confirm]: a failing hook loses only its own bookkeeping, never the rejection.
        try {
          _tx(() => hook(e));
        } on Object {
          // Nothing of the hook was written.
        }
      }
    });
  }

  /// A refused sign-off (lifecycle 3.4, 4.8): its note is no longer finished here but a draft, as the
  /// server keeps it, and the refusal waits in Needs attention. Complete again is its fix.
  void _signoffRefused(OutboxEntry e) {
    final value = e.value;
    final noteId = value is Map<String, Object?> ? value['noteId'] : null;
    if (noteId is String && localEffect(noteId)?.signoffId == e.recordId) _clearEffect(noteId);
  }

  void _clearEffect(String noteId) => _db.execute(
    "UPDATE records SET attributes_json = json_remove(attributes_json, '\$.$_localEffectKey') WHERE id = ?",
    [noteId],
  );

  /// The field holds a different value on the server. Both are shown side by side.
  void conflict(OutboxEntry e, ServerField server) {
    _db.execute("UPDATE outbox SET state = 'conflict', server_json = ? WHERE change_id = ? AND state = 'pending'", [
      jsonEncode(server.toJson()),
      e.changeId,
    ]);
  }

  /// The person chose between their value and the server's (Oct 19 reconciliation rule).
  ///
  /// One new change goes to the server for the field: `replace` puts the person's value on the
  /// chart (the replaced value and who approved it are logged), and `keep_server` keeps the
  /// server's value while theirs is kept in history. "Their value" is [myValue], exactly what the
  /// card shows. Every other open conflict and waiting edit on the field is folded into this one
  /// choice. Returns false, changing nothing, when [changeId] is no longer the field's latest
  /// conflict: the server's value moved on since the card was drawn, so the person must look again.
  bool resolveConflict(String changeId, {required bool keepMine}) {
    final shown = entry(changeId);
    if (shown == null || shown.state != ChangeState.conflict || shown.server == null) {
      throw StateError('not a conflict');
    }
    _guardFor(shown.entity);
    final field = shown.field!;
    final latest = _db.select(
      "SELECT change_id FROM outbox WHERE state = 'conflict' AND record_id = ? AND field = ? ORDER BY seq DESC LIMIT 1",
      [shown.recordId, field],
    ).first;
    if (latest['change_id'] != changeId) return false;
    final server = shown.server!;
    final mine = myValue(shown);
    if (keepMine && shown.entity == entityProblem && field == 'status') {
      // Out of Resolved is an admin's (design 9.3): the card offers a recurrence or a reversal
      // request instead, and the server would refuse this.
      final theirs = server.value, next = mine;
      if (theirs is Map<String, Object?> &&
          next is Map<String, Object?> &&
          problemStatusRank(next['status']) < problemStatusRank(theirs['status'])) {
        throw const LocalValidationError(
          'Only a Program Admin moves a problem out of Resolved.',
          problem: 'resolved_needs_admin',
        );
      }
    }
    _tx(() {
      final resolution = _append(
        entity: shown.entity,
        recordId: shown.recordId,
        op: 'set',
        field: field,
        value: mine,
        baseVersion: server.version,
        conflictOf: shown.changeId,
        resolution: keepMine ? 'replace' : 'keep_server',
      );
      _foldField(shown.recordId, field, resolution);
      final shownValue = keepMine ? mine : server.value;
      _putField(shown.recordId, field, shownValue, serverVersion: server.version, pending: resolution);
      _touch(shown.recordId, status: rulesFor(shown.entity)?.statusAfter(field, shownValue));
      _workedOn(shown.recordId);
    });
    return true;
  }

  /// Every unresolved entry on one field before [by] is now covered by it.
  void _foldField(String recordId, String field, String by) {
    _db.execute(
      "UPDATE outbox SET state = 'superseded', supersedes = ? WHERE state IN ('pending', 'rejected', 'conflict') "
      'AND record_id = ? AND field = ? AND change_id <> ?',
      [by, recordId, field, by],
    );
  }

  /// A fix for a rejected change, sent as a new change linked to it (module 9 "Rejections").
  ///
  /// For a rejected set, [value] is the corrected field value; later edits waiting on the field
  /// are folded into it. For a rejected create, [value] is the corrected create value. The
  /// record's other fields, as the person has them now (cleared ones included), fill in what
  /// [value] leaves out, and the record's waiting or refused-with-it edits are folded in. What a
  /// create can't carry (a note's data that no longer fits, a status past a create's first one, a
  /// retraction) follows it as edits. Its dependants (a patient's street names, a problem's
  /// notes) were held behind it and go once it is confirmed.
  void fixRejected(String changeId, Object? value) {
    final x = entry(changeId);
    if (x == null || x.state != ChangeState.rejected) throw StateError('not a rejection');
    _guardFor(x.entity);
    if (x.op == 'set') {
      _checkField(x.entity, x.field!, value);
      final base = record(x.recordId)?.fields[x.field]?.serverVersion ?? 0;
      _tx(() {
        final fix = _append(
          entity: x.entity,
          recordId: x.recordId,
          op: 'set',
          field: x.field,
          value: value,
          baseVersion: base,
          supersedes: x.changeId,
        );
        _foldField(x.recordId, x.field!, fix);
        _putField(x.recordId, x.field!, value, serverVersion: base, pending: fix);
        _touch(x.recordId, status: rulesFor(x.entity)!.statusAfter(x.field!, value));
        _workedOn(x.recordId);
      });
      return;
    }
    if (x.op != 'create') throw StateError('audit entries are refused only for app faults; they can’t be fixed');
    final created = value is Map<String, Object?> ? value : throw const LocalValidationError('Fix the record.');
    final rec = record(x.recordId);
    final fields = rec?.fields ?? const <String, LocalField>{};
    if (x.entity == entityNote) return _fixNote(x, created, fields);
    final rules = rulesFor(x.entity)!;
    if (x.entity == entityEncounter) {
      final kind = created['kind'];
      if (kind != 'medical' && kind != 'non_medical') {
        throw const LocalValidationError('Choose medical or non-medical.');
      }
    }
    // The person's current values of what the create carries; their corrections win.
    final carried = switch (x.entity) {
      entityEncounter => const ['patientId', 'location', 'locationText'],
      entityPatient => patientFieldNames,
      _ => const <String>[],
    };
    final merged = {
      for (final name in carried)
        if (fields.containsKey(name)) name: fields[name]!.value,
      ...created,
    };
    if (x.entity == entityEncounter) {
      for (final name in carried) {
        _checkField(entityEncounter, name, merged[name]);
      }
    }
    _checkCreate(rules, merged);
    final inCreate = rules.createdFields(merged);
    // What later edits changed that the create doesn't carry: they follow it.
    final after = <String, Object?>{
      for (final MapEntry(key: name, value: f) in fields.entries)
        if (!carried.contains(name) &&
            f.pendingChange != null &&
            f.pendingChange != x.changeId &&
            (inCreate.containsKey(name)
                ? canonicalJson(inCreate[name]) != canonicalJson(f.value)
                : !isBlankValue(f.value)))
          name: f.value,
    };
    _tx(() {
      final fix = _append(
        entity: x.entity,
        recordId: x.recordId,
        op: 'create',
        value: merged,
        baseVersion: 0,
        supersedes: x.changeId,
      );
      // Everything unresolved on the record is in the fixed create now, or follows it.
      _db.execute(
        "UPDATE outbox SET state = 'superseded', supersedes = ? WHERE state IN ('pending', 'rejected', 'conflict') "
        'AND record_id = ? AND change_id <> ?',
        [fix, x.recordId, fix],
      );
      for (final MapEntry(:key, :value) in inCreate.entries) {
        _putField(x.recordId, key, value, serverVersion: 0, pending: fix);
      }
      _db.execute('UPDATE fields SET pending_change = ?, server_version = 0 WHERE record_id = ?', [fix, x.recordId]);
      _db.execute('UPDATE records SET attributes_json = ?, patient_id = coalesce(?, patient_id) WHERE id = ?', [
        jsonEncode(rules.attributes(merged)),
        rules.patientSide ? _patientOfChange(x.entity, 'create', x.recordId, null, merged) : null,
        x.recordId,
      ]);
      _touch(x.recordId, status: rules.initialStatus(merged));
      if (x.entity == entityEncounter) _fileUnfiled();
      // The create always starts where a create starts (a draft, a problem's first status); a
      // later move, or a retraction, goes as its own change after it.
      for (final MapEntry(key: name, value: v) in after.entries) {
        final followUp = _append(
          entity: x.entity,
          recordId: x.recordId,
          op: 'set',
          field: name,
          value: v,
          baseVersion: 0,
          follows: fix,
        );
        _putField(x.recordId, name, v, serverVersion: 0, pending: followUp);
        _touch(x.recordId, status: rules.statusAfter(name, v));
      }
      _workedOn(x.recordId);
    });
  }

  void _fixNote(OutboxEntry x, Map<String, Object?> created, Map<String, LocalField> fields) {
    final createdData = (created['data'] as Map<String, Object?>?) ?? const {};
    final data = <String, Object?>{
      for (final MapEntry(:key, :value) in fields.entries)
        if (key.startsWith('data.')) key.substring(5): value.value,
      ...createdData,
    };
    if (data.length > maxNoteFields) throw _tooManyFields;
    for (final key in data.keys) {
      if (!_dataFieldOk(key)) throw LocalValidationError('Unknown field $key.');
    }
    final head = {...created}..remove('data');
    final (:inCreate, :after) = _splitData(head, data);
    final merged = {...head, if (inCreate.isNotEmpty) 'data': inCreate};
    final localUpdates = {for (final MapEntry(:key, :value) in data.entries) 'data.$key': value};
    final attributes = {
      for (final name in ['encounterId', 'noteTypeKey', 'noteTypeVersion']) name: merged[name],
    };
    _tx(() {
      final fix = _append(
        entity: x.entity,
        recordId: x.recordId,
        op: 'create',
        value: merged,
        baseVersion: 0,
        supersedes: x.changeId,
      );
      // Everything unresolved on the record is in the fixed create now.
      _db.execute(
        "UPDATE outbox SET state = 'superseded', supersedes = ? WHERE state IN ('pending', 'rejected', 'conflict') "
        'AND record_id = ? AND change_id <> ?',
        [fix, x.recordId, fix],
      );
      for (final MapEntry(:key, :value) in localUpdates.entries) {
        _putField(x.recordId, key, value, serverVersion: 0, pending: fix);
      }
      _db.execute('UPDATE fields SET pending_change = ?, server_version = 0 WHERE record_id = ?', [fix, x.recordId]);
      _appendData(x.recordId, after);
      // The record is what the fixed create says now, which may be another encounter: the purge
      // keeps the encounter a note names. What a sign-off waiting behind it should do stays.
      _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [
        jsonEncode({...?record(x.recordId)?.attributes, ...attributes}),
        x.recordId,
      ]);
      final status = fields['status']?.value;
      if (status != null && status != 'draft') {
        // The create always starts as a draft; a later Complete goes as its own change.
        final followUp = _append(
          entity: x.entity,
          recordId: x.recordId,
          op: 'set',
          field: 'status',
          value: status,
          baseVersion: 0,
          follows: fix,
        );
        _putField(x.recordId, 'status', status, serverVersion: 0, pending: followUp);
      }
      _workedOn(x.recordId);
    });
  }

  /// A fix that is a new record (design 2.9-5): a card made on the kept chart after one for a
  /// merged patient was refused, a street name, allergy or problem attached to another patient.
  /// [value] is the new record's create; it supersedes the refused change, so confirming it settles
  /// that one (`_deleteSettled` follows the link). A refused create's record is never on the
  /// server, so it goes here, and what waited on it is sent again after the new create
  /// ([_resendDependants]); a refused or conflicting set falls back to the server's value. Returns
  /// the new record's ID.
  String replaceRejected(String changeId, {required String entity, required Map<String, Object?> value, String? id}) {
    final x = entry(changeId);
    if (x == null || (x.state != ChangeState.rejected && x.state != ChangeState.conflict)) {
      throw StateError('not a rejection');
    }
    final rules = rulesFor(entity);
    if (rules == null || !rules.patientSide) throw ArgumentError('not a patient-side record: $entity');
    // What names the refused record is made again naming the new one, so the new one must be the
    // same kind. A patient is fixed in place (fixRejected): an encounter's patient is a set.
    if (x.op == 'create' && (entity != x.entity || entity == entityPatient)) {
      throw ArgumentError('a refused $entity create is replaced by a new record of its own kind');
    }
    if (id != null && !isUuid(id)) throw ArgumentError('record IDs are UUIDs');
    _guardFor(entity);
    _checkCreate(rules, value);
    final recordId = id ?? _newId();
    return _tx(() {
      final fix = _append(
        entity: entity,
        recordId: recordId,
        op: 'create',
        value: value,
        baseVersion: 0,
        supersedes: x.changeId,
      );
      _insertCreated(rules, recordId, value, fix);
      if (x.op == 'create') {
        _supersede(x.changeId, by: fix);
        _resendDependants(x, recordId, fix);
        _db.execute('DELETE FROM records WHERE id = ? AND origin = ?', [x.recordId, 'local']);
      } else {
        _foldField(x.recordId, x.field!, fix);
        final server = x.server;
        if (server != null) {
          _putField(x.recordId, x.field!, server.value, serverVersion: server.version);
        } else {
          _db.execute('UPDATE fields SET pending_change = NULL WHERE record_id = ? AND field = ?', [
            x.recordId,
            x.field,
          ]);
        }
      }
      return recordId;
    });
  }

  void _supersede(String changeId, {required String by}) =>
      _db.execute("UPDATE outbox SET state = 'superseded', supersedes = ? WHERE change_id = ?", [by, changeId]);

  /// What waited on [x], a refused create that [replacement] replaces (its create is [fix]), sent
  /// again after [fix] in the order it was made (review P1): the refused record's own edits as edits
  /// of [replacement]; every create naming the refused record (a note on a problem, a recurrence
  /// or a reversal request) made again naming [replacement] instead, followed by its own record's
  /// edits; and so on for what names those. Each is a new change with its own receipt, superseding
  /// the one it repeats, so none is folded into a create that doesn't carry its value, and none is
  /// sent toward a record that will never exist. The waiting ones were never on the server: their
  /// record, or one they name, was refused.
  void _resendDependants(OutboxEntry x, String replacement, String fix) {
    final waiting = _db
        .select("SELECT * FROM outbox WHERE state IN ('pending', 'rejected', 'conflict') ORDER BY seq")
        .map(OutboxEntry.fromRow)
        .toList();
    // The records made again: the refused one as [replacement], and every record whose create names
    // one made again, as itself. A fix made earlier may have put a parent's create after its child's.
    final remade = {x.recordId: replacement};
    for (var grew = true; grew;) {
      grew = false;
      for (final e in waiting) {
        if (e.op == 'create' &&
            !remade.containsKey(e.recordId) &&
            parentsOf(entity: e.entity, op: e.op, value: e.value).any((p) => remade.containsKey(p.id))) {
          remade[e.recordId] = e.recordId;
          grew = true;
        }
      }
    }
    // The newest change made here for each record ('id') and field ('id|field'), which the next
    // edit of it follows.
    final last = {replacement: fix};
    for (final e in waiting) {
      final target = remade[e.recordId];
      if (target == null || e.changeId == x.changeId) continue;
      final rules = rulesFor(e.entity)!;
      if (e.op == 'create') {
        final value = _repoint(e.entity, e.value! as Map<String, Object?>, x.recordId, replacement);
        _checkCreate(rules, value);
        final create = _append(
          entity: e.entity,
          recordId: target,
          op: 'create',
          value: value,
          baseVersion: 0,
          supersedes: e.changeId,
        );
        _supersede(e.changeId, by: create);
        _db
          ..execute('UPDATE records SET attributes_json = ?, patient_id = coalesce(?, patient_id) WHERE id = ?', [
            jsonEncode(rules.attributes(value)),
            rules.patientSide ? _patientOfChange(e.entity, 'create', target, null, value) : null,
            target,
          ])
          ..execute('UPDATE fields SET pending_change = ?, server_version = 0 WHERE record_id = ?', [create, target]);
        for (final MapEntry(key: name, value: v) in rules.createdFields(value).entries) {
          _putField(target, name, v, serverVersion: 0, pending: create);
        }
        _touch(target, status: rules.initialStatus(value));
        last[target] = create;
      } else if (e.op == 'set') {
        final field = e.field!;
        final resent = _append(
          entity: e.entity,
          recordId: target,
          op: 'set',
          field: field,
          value: e.value,
          baseVersion: 0,
          follows: last['$target|$field'] ?? last[target],
          supersedes: e.changeId,
        );
        _supersede(e.changeId, by: resent);
        _putField(target, field, e.value, serverVersion: 0, pending: resent);
        _touch(target, status: rules.statusAfter(field, e.value));
        last['$target|$field'] = resent;
      }
    }
  }

  /// [value] with each reference to the record [from] made a reference to [to]: only keys that name
  /// a record (a note's `problemId`, a problem's `recurrenceOf`), never text that happens to match.
  static Map<String, Object?> _repoint(String entity, Map<String, Object?> value, String from, String to) => {
    for (final MapEntry(:key, value: v) in value.entries)
      key: v == from && parentsOf(entity: entity, op: 'create', value: {...value, key: to}).any((p) => p.id == to)
          ? to
          : v,
  };

  /// Opens the server's copy of a record here (someone else's draft, a refresh of one this phone
  /// holds open, or part of a chart). Fields with local edits keep the person's value and the
  /// version they built on; the rest take the server's value.
  ///
  /// [open]: a draft to work on (open until Save & Close). A chart's records come in closed
  /// (`open: false`), kept by their patient's scopes and local work (design 2.9-9); [patientId]
  /// names that patient when the record doesn't (a note on a problem). Otherwise a record that
  /// names none is filed under the patient of what it hangs off here, as a create made here is (a
  /// sign-off's note, an addendum's visit: lifecycle 4.8).
  void importServerRecord(ServerRecord r, {bool open = true, String? patientId}) {
    final rules = rulesFor(r.entity);
    final patientSide = rules?.patientSide ?? false;
    final patient = patientSide
        ? patientId ??
              (r.entity == entityPatient ? r.id : r.attributes['patientId'] as String?) ??
              _patientOfRecord(rules!.patientVia(r.attributes)?.id)
        : null;
    _tx(() {
      final existing = _db.select('SELECT id FROM records WHERE id = ?', [r.id]).isNotEmpty;
      if (!existing) {
        _db.execute(
          'INSERT INTO records (id, entity, status, author_user_id, attributes_json, open, origin, downloaded_at, '
          "created_at, updated_at, patient_id) VALUES (?, ?, ?, ?, ?, ?, 'server', ?, ?, ?, ?)",
          [
            r.id,
            r.entity,
            r.status,
            r.authorUserId,
            jsonEncode(r.attributes),
            open ? 1 : 0,
            _nowMs,
            _nowMs,
            _nowMs,
            patient,
          ],
        );
      } else {
        _db.execute(
          'UPDATE records SET downloaded_at = ?, open = max(open, ?), patient_id = coalesce(patient_id, ?) WHERE id = ?',
          [_nowMs, open ? 1 : 0, patient, r.id],
        );
      }
      for (final MapEntry(key: name, value: f) in r.fields.entries) {
        final local = _db.select('SELECT pending_change FROM fields WHERE record_id = ? AND field = ?', [
          r.id,
          name,
        ]).firstOrNull;
        if (local != null && local['pending_change'] != null) continue;
        _putField(r.id, name, f.value, serverVersion: f.version);
      }
      if (patientSide) {
        // What a create made and no set changes, and the record's state (a street name removed),
        // are the server's unless something of the record still waits here.
        if (_count('SELECT count(*) AS n FROM outbox WHERE record_id = ?', [r.id]) == 0) {
          _db.execute('UPDATE records SET status = ?, attributes_json = ?, updated_at = ? WHERE id = ?', [
            r.status,
            jsonEncode(r.attributes),
            _nowMs,
            r.id,
          ]);
        }
        return;
      }
      if (r.entity == entityEncounter) {
        // The server works a visit's status out from its notes (lifecycle 2.2), and whether it holds a
        // finished note (hasFinishedNote); no change sets either.
        _touch(r.id, status: r.status);
        if (existing) {
          _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [
            jsonEncode({...record(r.id)!.attributes, ...r.attributes}),
            r.id,
          ]);
        }
        // A teammate may have given it a patient.
        _fileUnfiled();
        return;
      }
      if (r.entity == entityNote) _noteFromServer(r);
      final status = _db.select("SELECT value_json FROM fields WHERE record_id = ? AND field = 'status'", [
        r.id,
      ]).firstOrNull;
      if (status != null) _touch(r.id, status: jsonDecode(status['value_json'] as String) as String);
    });
  }

  /// A note's state as the server's copy shows it (lifecycle 4.4, 4.10): who acts as its author, its
  /// attestation, the signature that signs it, unless its own create still waits here. What the
  /// phone expects of its own sign-off stays until a receipt settles it, but one the server held for
  /// review is settled once the server's copy is finished: a Program Admin accepted it, or the note
  /// was finished another way. The note then shows as the server holds it.
  void _noteFromServer(ServerRecord r) {
    if (_count("SELECT count(*) AS n FROM outbox WHERE record_id = ? AND op = 'create' AND state <> 'superseded'", [
          r.id,
        ]) >
        0) {
      return;
    }
    final attributes = {...r.attributes};
    final kept = record(r.id)!.attributes[_localEffectKey];
    final expected = LocalEffect.fromJson(kept);
    if (expected != null && (r.status == NoteStatus.draft.name || _signoffsOf(r.id).isNotEmpty)) {
      attributes[_localEffectKey] = kept;
    } else if (expected != null) {
      _heldSettled(r.id);
    }
    _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [jsonEncode(attributes), r.id]);
  }

  // ---- charts kept on the phone (section 7) ----

  /// Keeps [patientId]'s chart here until [expiresAt] (default: 24 hours from now) for [kind].
  /// Opening a chart again or working on it extends its scope; nothing shortens one, and a refresh
  /// that downloads it again doesn't call this (design 7.2).
  void addScope(String patientId, {String kind = scopeOpened, String ref = '', DateTime? expiresAt}) {
    final until = (expiresAt ?? _now().add(serverCopyLifetime)).toUtc().millisecondsSinceEpoch;
    _db.execute(
      'INSERT INTO cache_scopes (patient_id, kind, ref, added_at, expires_at) VALUES (?, ?, ?, ?, ?) '
      'ON CONFLICT (patient_id, kind, ref) DO UPDATE SET expires_at = max(expires_at, excluded.expires_at)',
      [patientId, kind, ref, _nowMs, until],
    );
  }

  /// Local creates and edits keep the chart the worker stands in front of (design 2.9-10).
  void _extendOpened(String patientId) => addScope(patientId);

  List<CacheScope> scopes() => [
    for (final r in _db.select('SELECT * FROM cache_scopes ORDER BY patient_id, kind, ref'))
      CacheScope(
        patientId: r['patient_id'] as String,
        kind: r['kind'] as String,
        ref: r['ref'] as String,
        addedAt: DateTime.fromMillisecondsSinceEpoch(r['added_at'] as int, isUtc: true),
        expiresAt: DateTime.fromMillisecondsSinceEpoch(r['expires_at'] as int, isUtc: true),
      ),
  ];

  /// Deletes scopes past their expiry; the purge then decides what of their charts goes.
  int expireScopes() {
    _db.execute('DELETE FROM cache_scopes WHERE expires_at <= ?', [_nowMs]);
    return _db.updatedRows;
  }

  /// Moves the scopes of merged patients to their survivors, keeping the later expiry, so a chart
  /// kept for someone stays kept under the chart that holds them now.
  void rekeyScopes() {
    _tx(() {
      for (final r in _db.select(
        'SELECT s.patient_id, s.kind, s.ref, s.added_at, s.expires_at FROM cache_scopes s '
        'JOIN patient_redirects d ON d.merged_id = s.patient_id',
      )) {
        final survivor = canonicalPatient(r['patient_id'] as String);
        _db
          ..execute('DELETE FROM cache_scopes WHERE patient_id = ? AND kind = ? AND ref = ?', [
            r['patient_id'],
            r['kind'],
            r['ref'],
          ])
          ..execute(
            'INSERT INTO cache_scopes (patient_id, kind, ref, added_at, expires_at) VALUES (?, ?, ?, ?, ?) '
            'ON CONFLICT (patient_id, kind, ref) DO UPDATE SET expires_at = max(expires_at, excluded.expires_at)',
            [survivor, r['kind'], r['ref'], r['added_at'], r['expires_at']],
          );
      }
    });
  }

  // ---- merged patients (D27) ----

  Map<String, PatientRedirect> redirects() => {
    for (final r in _db.select('SELECT * FROM patient_redirects'))
      r['merged_id'] as String: PatientRedirect(
        mergedId: r['merged_id'] as String,
        survivorId: r['survivor_id'] as String,
        mergedAt: r['merged_at'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(r['merged_at'] as int, isUtc: true),
        origin: r['origin'] as String,
      ),
  };

  /// The patient whose chart holds [patientId] now, as far as this phone knows.
  String canonicalPatient(String patientId) {
    var id = patientId;
    // Server lists name the canonical survivor; a chain only forms from receipts learned in turn.
    for (var hops = 0; hops < 20; hops++) {
      final next = _db.select('SELECT survivor_id FROM patient_redirects WHERE merged_id = ?', [id]).firstOrNull;
      if (next == null || next['survivor_id'] == id) return id;
      id = next['survivor_id'] as String;
    }
    return id;
  }

  /// The server's redirect list is authoritative (D27, review finding 3): it replaces every row it
  /// covers, whatever that row's origin, so a redirect learned from a receipt for a merge since
  /// undone goes, and new work names the restored patient again.
  ///
  /// [origin] 'index': [list] is the team's complete list (the index's first page) and replaces
  /// all rows. [origin] 'chart': a chart bundle's list, covering [covering] (the IDs asked for and
  /// the groups returned): rows into or out of those are replaced. Scopes follow the survivors.
  void replaceRedirects(
    Iterable<PatientRedirect> list, {
    required String origin,
    Iterable<String> covering = const [],
  }) {
    if (origin != 'index' && origin != 'chart') throw ArgumentError('server lists are index or chart lists');
    final byMerged = {for (final r in list) r.mergedId: r};
    _tx(() {
      final stale = [
        for (final r in redirects().values)
          if (!byMerged.containsKey(r.mergedId) &&
              (origin == 'index' || covering.contains(r.mergedId) || covering.contains(r.survivorId)))
            r.mergedId,
      ];
      for (final id in stale) {
        _db.execute('DELETE FROM patient_redirects WHERE merged_id = ?', [id]);
      }
      for (final r in byMerged.values) {
        _db.execute(
          'INSERT INTO patient_redirects (merged_id, survivor_id, merged_at, origin) VALUES (?, ?, ?, ?) '
          'ON CONFLICT (merged_id) DO UPDATE SET survivor_id = excluded.survivor_id, '
          'merged_at = excluded.merged_at, origin = excluded.origin',
          [r.mergedId, r.survivorId, r.mergedAt?.toUtc().millisecondsSinceEpoch, origin],
        );
      }
      rekeyScopes();
    });
  }

  // ---- notices ----

  /// Keeps a notice for the person: kinds, fields and IDs only.
  ///
  /// A [noticeSignoffNotApplied] names a sign-off the server held for review that will not reach the
  /// chart (lifecycle 4.6, D89). For the one this phone holds as sent for review, the note is no longer
  /// finished here: what the phone expected of that sign-off is cleared, and the note is a draft
  /// again, to read and complete again (fetched again first if it left the phone). One this phone
  /// settled already (its note finished since) changes nothing, and is kept read. One this phone knows
  /// nothing of (another phone's, or a database erased since) is kept as it is.
  String addNotice(String kind, {String? patientId, String? recordId, String? field}) => _tx(() {
    var settled = false;
    final noteId = kind == noticeSignoffNotApplied && recordId != null ? kv('$_heldNoteKvPrefix$recordId') : null;
    if (noteId != null) {
      if (_heldSignoff(noteId) == recordId) {
        _heldSettled(noteId);
        if (localEffect(noteId)?.signoffId == recordId) _clearEffect(noteId);
      } else {
        settled = true;
      }
    }
    final id = _newId();
    _db.execute(
      'INSERT INTO local_notices (id, kind, patient_id, record_id, field, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, kind, patientId, recordId, field, _nowMs, settled ? _nowMs : null],
    );
    return id;
  });

  List<LocalNotice> notices({bool unreadOnly = false}) => [
    for (final r in _db.select(
      'SELECT * FROM local_notices ${unreadOnly ? 'WHERE read_at IS NULL ' : ''}ORDER BY created_at, id',
    ))
      LocalNotice(
        id: r['id'] as String,
        kind: r['kind'] as String,
        patientId: r['patient_id'] as String?,
        recordId: r['record_id'] as String?,
        field: r['field'] as String?,
        createdAt: DateTime.fromMillisecondsSinceEpoch(r['created_at'] as int, isUtc: true),
        readAt: r['read_at'] == null ? null : DateTime.fromMillisecondsSinceEpoch(r['read_at'] as int, isUtc: true),
      ),
  ];

  void markNoticeRead(String id) =>
      _db.execute('UPDATE local_notices SET read_at = ? WHERE id = ? AND read_at IS NULL', [_nowMs, id]);

  // ---- purge ----

  /// Patients someone is working on here: a change waiting (or refused, or in conflict) that is
  /// about them, a record of theirs on an edit form, and an encounter on them open here.
  Set<String> localWorkPatients() => {
    for (final r in _db.select(
      "SELECT patient_id AS p FROM outbox WHERE state <> 'superseded' AND patient_id IS NOT NULL "
      'UNION SELECT patient_id FROM records WHERE open = 1 AND patient_id IS NOT NULL '
      "UNION SELECT json_extract(f.value_json, '\$') FROM records r JOIN fields f ON f.record_id = r.id "
      "WHERE r.entity = 'encounter' AND r.open = 1 AND f.field = 'patientId' AND json_type(f.value_json) = 'text'",
    ))
      r['p'] as String,
    for (final id in _editing)
      if (_db.select('SELECT patient_id FROM records WHERE id = ?', [id]).firstOrNull?['patient_id']
          case final String p)
        p,
  };

  /// Whether [patientId]'s chart is in use, given the patients in use: theirs, or their survivor's.
  bool _inUse(String patientId, Set<String> used) =>
      used.contains(patientId) || used.contains(canonicalPatient(patientId));

  /// The patients whose charts a live scope or local work keeps, with their survivors.
  Set<String> _chartsInUse() {
    final used = {
      for (final r in _db.select('SELECT DISTINCT patient_id FROM cache_scopes WHERE expires_at > ?', [_nowMs]))
        r['patient_id'] as String,
      ...localWorkPatients(),
    };
    return {...used, for (final p in used) canonicalPatient(p)};
  }

  /// Deletes what the server already holds and the person no longer uses (module 9 "Purge rules").
  /// Returns the number of fields removed.
  int purge() => _tx(_purge);

  int _purge() {
    expireScopes();
    return _purgeRecords() + _purgeCharts();
  }

  /// Encounters and notes (phase 2's rule).
  int _purgeRecords() {
    final expired = _nowMs - serverCopyLifetime.inMilliseconds;
    // Out of use: closed (Save & Close), or a server copy past its lifetime. An encounter stays
    // while the person has a note on it open or unsynced, or the note would lose its encounter
    // and patient; after that, a teammate's encounter expires like any other server copy.
    const outOfUse =
        'patient_id IS NULL AND (open = 0 OR (origin = ? AND downloaded_at < ?)) AND NOT EXISTS (SELECT 1 FROM records n '
        "WHERE n.origin = 'local' AND json_extract(n.attributes_json, '\$.encounterId') = records.id "
        'AND (n.open = 1 OR EXISTS (SELECT 1 FROM outbox o WHERE o.record_id = n.id)))';
    // A field goes once its record is out of use, its latest change is confirmed, and no change
    // to it is still waiting.
    _db.execute(
      'DELETE FROM fields WHERE pending_change IS NULL '
      'AND record_id IN (SELECT id FROM records WHERE $outOfUse) '
      'AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.record_id = fields.record_id '
      "  AND (o.field = fields.field OR o.op = 'create'))",
      ['server', expired],
    );
    final removed = _db.updatedRows;
    // A record goes once all its fields are gone and nothing about it waits.
    _db.execute(
      'DELETE FROM records WHERE NOT EXISTS (SELECT 1 FROM fields WHERE record_id = records.id) '
      'AND NOT EXISTS (SELECT 1 FROM outbox WHERE record_id = records.id) '
      'AND $outOfUse',
      ['server', expired],
    );
    return removed;
  }

  /// Patients' charts (design 2.9-6): a chart is out of use when no live scope covers its patient
  /// or the patient's survivor and no local work is about them. Then its confirmed fields and
  /// records go, as above, and in the same transaction its search names (origin 'cache' and
  /// 'local') and its ID links with their tokens, so nothing of a chart, a name fragment or a
  /// token outlives its scope (review finding 9). FTS5 `secure-delete` makes the name deletes real
  /// on disk. The index's own names go only with the index.
  int _purgeCharts() {
    final used = _chartsInUse();
    final patients = {
      for (final r in _db.select(
        'SELECT patient_id AS p FROM records WHERE patient_id IS NOT NULL '
        "UNION SELECT patient_id FROM patient_names WHERE origin IN ('cache', 'local') "
        'UNION SELECT patient_id FROM id_links',
      ))
        r['p'] as String,
    };
    var removed = 0;
    for (final p in patients) {
      if (_inUse(p, used)) continue;
      _db.execute(
        'DELETE FROM fields WHERE pending_change IS NULL '
        'AND record_id IN (SELECT id FROM records WHERE patient_id = ? AND open = 0) '
        'AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.record_id = fields.record_id '
        "  AND (o.field = fields.field OR o.op = 'create'))",
        [p],
      );
      removed += _db.updatedRows;
      _db
        ..execute(
          'DELETE FROM records WHERE patient_id = ? AND open = 0 '
          'AND NOT EXISTS (SELECT 1 FROM fields WHERE record_id = records.id) '
          'AND NOT EXISTS (SELECT 1 FROM outbox WHERE record_id = records.id)',
          [p],
        )
        ..execute("DELETE FROM patient_names WHERE patient_id = ? AND origin IN ('cache', 'local')", [p])
        ..execute('DELETE FROM id_links WHERE patient_id = ?', [p]);
    }
    return removed;
  }

  /// Deletes the server's data from this phone and keeps local work (design 2.9-7, 6.3): the team
  /// index, its staging and its search names; every scope; every redirect but those between a
  /// patient with waiting work and the chart that holds them; and the charts no local work is
  /// about, with their search names and ID links. A chart local work keeps stays whole, its names
  /// and redirect included, as in the purge: the worker must still find offline the patient whose
  /// work waits. Never an outbox entry. Called at sign-out, at the index's 7-day expiry, on a 403
  /// for the index, and first at open when the file was marked stale.
  void clearServerData() {
    _tx(() {
      final work = localWorkPatients();
      final keep = {...work, for (final p in work) canonicalPatient(p)};
      bool kept(String p) => _inUse(p, keep);
      _db
        ..execute('DELETE FROM team_index')
        ..execute('DELETE FROM team_index_staging')
        ..execute("DELETE FROM patient_names WHERE origin = 'index'");
      for (final p in {
        for (final r in _db.select(
          "SELECT patient_id AS p FROM patient_names WHERE origin IN ('cache', 'local') "
          'UNION SELECT patient_id FROM id_links UNION SELECT patient_id FROM records WHERE patient_id IS NOT NULL',
        ))
          r['p'] as String,
      }) {
        if (kept(p)) continue;
        _db
          ..execute("DELETE FROM patient_names WHERE patient_id = ? AND origin IN ('cache', 'local')", [p])
          ..execute('DELETE FROM id_links WHERE patient_id = ?', [p])
          ..execute(
            'DELETE FROM records WHERE patient_id = ? AND open = 0 '
            'AND NOT EXISTS (SELECT 1 FROM outbox WHERE record_id = records.id)',
            [p],
          );
      }
      // A redirect that ties waiting work to the chart it keeps stays (review P5): without it the next
      // purge no longer finds the survivor's chart in use and deletes it, names and all.
      for (final r in _db.select('SELECT merged_id, survivor_id FROM patient_redirects')) {
        if (keep.contains(r['merged_id']) || keep.contains(r['survivor_id'])) continue;
        _db.execute('DELETE FROM patient_redirects WHERE merged_id = ?', [r['merged_id']]);
      }
      _db
        ..execute('DELETE FROM cache_scopes')
        ..execute("DELETE FROM kv WHERE key LIKE '$indexKvPrefix%'");
    });
  }
}
