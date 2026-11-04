import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

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

class RecordLocked implements Exception {
  const RecordLocked();
}

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
       _uuid = uuid ?? const Uuid(goptions: GlobalOptions(CryptoRNG()));

  final LocalDatabase _local;
  final String userId;
  final ClockStamp Function() _stamp;
  final bool Function() _paused;
  final DateTime Function() _now;
  final Uuid _uuid;

  /// Run for every confirmed change, in its transaction (see [confirm]).
  final onConfirmed = <ConfirmHook>[];

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

  /// The patient a change is work on: the one a create names (a problem note's is its problem's),
  /// the one an encounter is moved to, or the record's own.
  String? _patientOfChange(String entity, String op, String recordId, String? field, Object? value) {
    if (op == 'create' && value is Map<String, Object?>) {
      return switch (entity) {
        entityProblemNote => _patientOfRecord(value['problemId']),
        entityNote => _patientOfRecord(value['encounterId']),
        _ => rulesFor(entity)?.patientOfCreate(recordId, value),
      };
    }
    if (entity == entityEncounter && field == 'patientId') return value is String ? value : null;
    return _patientOfRecord(recordId);
  }

  /// The patient a record here belongs to: its own column for patient-side records, an
  /// encounter's patient field, and a note's encounter's.
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
  String createEncounter({required String kind, String? patientId, Map<String, Object?>? location}) {
    _guardCharting();
    if (kind != 'medical' && kind != 'non_medical') throw const LocalValidationError('Choose medical or non-medical.');
    if (patientId != null && !isUuid(patientId)) throw const LocalValidationError('Unknown patient.');
    _checkLocation(location);
    final id = _newId();
    return _tx(() {
      final value = <String, Object?>{'kind': kind, 'patientId': ?patientId, 'location': ?location};
      final changeId = _append(entity: entityEncounter, recordId: id, op: 'create', value: value, baseVersion: 0);
      _insertRecord(id, entityEncounter, attributes: {'kind': kind}, origin: 'local');
      for (final MapEntry(:key, :value) in {'patientId': patientId, 'location': location, 'status': 'draft'}.entries) {
        _putField(id, key, value, serverVersion: 0, pending: changeId);
      }
      return id;
    });
  }

  /// A note for one care type within an encounter. Data too large for one create follows it as
  /// edits (see [_splitData]).
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
    final encounter = record(encounterId);
    if (encounter != null && encounter.status == 'signed') throw const RecordLocked();
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
        (_, 'status') when entity == entityEncounter || entity == entityNote => const LocalValidationError(
          'Status must be draft or completed.',
        ),
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
  void setField(String recordId, String field, Object? value, {bool observe = false}) {
    final rec = record(recordId);
    if (rec == null) throw StateError('no such record');
    if (observe && rulesFor(rec.entity)?.fieldClass(field) != FieldClass.status) {
      throw ArgumentError('only a status is observed: $field');
    }
    _guardFor(rec.entity);
    if (rec.status == 'signed') throw const RecordLocked();
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
    });
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

  /// Kept, marked Rejected, until someone resolves it (module 9). Never purged.
  void reject(OutboxEntry e, {required String reason, String? message, Map<String, Object?>? details}) {
    _db.execute(
      "UPDATE outbox SET state = 'rejected', reason = ?, message = ?, details_json = ? WHERE change_id = ? "
      "AND state = 'pending'",
      [reason, message, details == null ? null : jsonEncode(details), e.changeId],
    );
  }

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
      entityEncounter => const ['patientId', 'location'],
      entityPatient => patientFieldNames,
      _ => const <String>[],
    };
    final merged = {
      for (final name in carried)
        if (fields.containsKey(name)) name: fields[name]!.value,
      ...created,
    };
    if (x.entity == entityEncounter) {
      _checkField(entityEncounter, 'patientId', merged['patientId']);
      _checkField(entityEncounter, 'location', merged['location']);
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
      // keeps the encounter a note names.
      _db.execute('UPDATE records SET attributes_json = ? WHERE id = ?', [jsonEncode(attributes), x.recordId]);
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
  /// merged patient was refused, a problem added as new. [value] is the new record's create; it
  /// supersedes the refused change, so confirming it settles that one (`_deleteSettled` follows
  /// the link). A refused create's record is never on the server, so it goes here, and whatever
  /// waited on it goes with the new create; a refused or conflicting set falls back to the
  /// server's value. Returns the new record's ID.
  String replaceRejected(String changeId, {required String entity, required Map<String, Object?> value, String? id}) {
    final x = entry(changeId);
    if (x == null || (x.state != ChangeState.rejected && x.state != ChangeState.conflict)) {
      throw StateError('not a rejection');
    }
    final rules = rulesFor(entity);
    if (rules == null || !rules.patientSide) throw ArgumentError('not a patient-side record: $entity');
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
        _db.execute(
          "UPDATE outbox SET state = 'superseded', supersedes = ? WHERE state IN ('pending', 'rejected', 'conflict') "
          'AND record_id = ?',
          [fix, x.recordId],
        );
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

  /// Opens the server's copy of a record here (someone else's draft, a refresh of one this phone
  /// holds open, or part of a chart). Fields with local edits keep the person's value and the
  /// version they built on; the rest take the server's value.
  ///
  /// [open]: a draft to work on (open until Save & Close). A chart's records come in closed
  /// (`open: false`), kept by their patient's scopes and local work (design 2.9-9); [patientId]
  /// names that patient when the record doesn't (a note on a problem).
  void importServerRecord(ServerRecord r, {bool open = true, String? patientId}) {
    final rules = rulesFor(r.entity);
    final patientSide = rules?.patientSide ?? false;
    final patient = patientSide
        ? patientId ?? (r.entity == entityPatient ? r.id : r.attributes['patientId'] as String?)
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
      final status = _db.select("SELECT value_json FROM fields WHERE record_id = ? AND field = 'status'", [
        r.id,
      ]).firstOrNull;
      if (status != null) _touch(r.id, status: jsonDecode(status['value_json'] as String) as String);
    });
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

  String addNotice(String kind, {String? patientId, String? recordId, String? field}) {
    final id = _newId();
    _db.execute(
      'INSERT INTO local_notices (id, kind, patient_id, record_id, field, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, kind, patientId, recordId, field, _nowMs],
    );
    return id;
  }

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
  /// about them, and a record of theirs, or an encounter on them, open here.
  Set<String> localWorkPatients() => {
    for (final r in _db.select(
      "SELECT patient_id AS p FROM outbox WHERE state <> 'superseded' AND patient_id IS NOT NULL "
      'UNION SELECT patient_id FROM records WHERE open = 1 AND patient_id IS NOT NULL '
      "UNION SELECT json_extract(f.value_json, '\$') FROM records r JOIN fields f ON f.record_id = r.id "
      "WHERE r.entity = 'encounter' AND r.open = 1 AND f.field = 'patientId' AND json_type(f.value_json) = 'text'",
    ))
      r['p'] as String,
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
  /// index, its staging and its search names; every redirect and scope; and the charts no local
  /// work is about, with their search names and ID links. A chart local work keeps stays whole, its
  /// names included, as in the purge: the worker must still find offline the patient whose work
  /// waits. Never an outbox entry. Called at sign-out, at the index's 7-day expiry, on a 403 for
  /// the index, and first at open when the file was marked stale.
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
      _db
        ..execute('DELETE FROM patient_redirects')
        ..execute('DELETE FROM cache_scopes')
        ..execute("DELETE FROM kv WHERE key LIKE '$indexKvPrefix%'");
    });
  }
}
