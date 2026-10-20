import 'dart:convert';

import 'package:sqlite3/sqlite3.dart';
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import 'canonical_json.dart';
import 'local_db.dart';

/// Local work on the phone and its confirmed-receipt lifecycle (module 9).
///
/// Every edit becomes an immutable change entry in the outbox, with the version the person was
/// looking at. A change leaves the phone only when a receipt confirms the server stored that exact
/// value (its hash matches); a rejected or conflicted change stays until the person resolves it.
/// Field values are purged only after the record leaves active use (Save & Close), and then only
/// the fields whose latest change is confirmed.

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
class LocalValidationError implements Exception {
  const LocalValidationError(this.message);
  final String message;
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

/// A record as the server holds it, for opening someone else's draft here.
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
  });
  final String id;
  final String entity;
  final String status;
  final String? authorUserId;
  final Map<String, Object?> attributes;
  final bool open;
  final String origin;
  final Map<String, LocalField> fields;
}

/// What is not yet confirmed, by category (module 9: "Patient encounters: 35%").
class UnsyncedSummary {
  const UnsyncedSummary(this.counts, this.oldest);
  final Map<String, int> counts;
  final DateTime? oldest;
  int get total => counts.values.fold(0, (a, b) => a + b);
}

const entityEncounter = 'encounter';
const entityNote = 'encounter_note';
const entityAudit = 'audit';

/// Read-only copies of server records expire after this (module 9 "Route cache").
const serverCopyLifetime = Duration(hours: 24);

final _uuidPattern = RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
final _dataPath = RegExp(r'^[a-z][a-zA-Z0-9_]{0,60}(\.[a-z][a-zA-Z0-9_]{0,60}){0,3}$');
final _noteTypeKey = RegExp(r'^[a-z][a-z0-9_]{1,60}$');
const _auditActions = {'patient.viewed', 'patient.searched', 'encounter.viewed', 'note.viewed'};

String _category(String entity) => switch (entity) {
  entityEncounter => 'encounters',
  entityNote => 'notes',
  _ => 'activity',
};

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

  Database get _db => _local.db;
  int get _nowMs => _now().toUtc().millisecondsSinceEpoch;

  T _tx<T>(T Function() fn) {
    _db.execute('BEGIN IMMEDIATE');
    try {
      final result = fn();
      _db.execute('COMMIT');
      return result;
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  void _guardCharting() {
    if (_paused()) {
      throw const ChartingPaused('Charting is paused until the phone’s clock is right.');
    }
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
    final problem = storableProblem(value);
    if (problem != null) throw LocalValidationError('This value can’t be saved: $problem.');
    final stamp = _stamp();
    final changeId = _newId();
    _db.execute(
      'INSERT INTO outbox (change_id, seq, entity, record_id, op, field, value_json, value_hash, base_version, '
      'follows, supersedes, conflict_of, resolution, device_time, corrected_time, clock_verified, category, '
      "state, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
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
        _category(entity),
        _nowMs,
      ],
    );
    return changeId;
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
    if (patientId != null && !_uuidPattern.hasMatch(patientId)) throw const LocalValidationError('Unknown patient.');
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

  /// A note for one care type within an encounter.
  String createNote({
    required String encounterId,
    required String noteTypeKey,
    int? noteTypeVersion,
    Map<String, Object?> data = const {},
  }) {
    _guardCharting();
    if (!_noteTypeKey.hasMatch(noteTypeKey)) throw const LocalValidationError('Unknown note type.');
    for (final key in data.keys) {
      if (!_dataPath.hasMatch(key)) throw LocalValidationError('Unknown field $key.');
    }
    final encounter = record(encounterId);
    if (encounter != null && encounter.status == 'signed') throw const RecordLocked();
    final id = _newId();
    return _tx(() {
      final value = <String, Object?>{
        'encounterId': encounterId,
        'noteTypeKey': noteTypeKey,
        'noteTypeVersion': ?noteTypeVersion,
        if (data.isNotEmpty) 'data': data,
      };
      final changeId = _append(entity: entityNote, recordId: id, op: 'create', value: value, baseVersion: 0);
      _insertRecord(
        id,
        entityNote,
        attributes: {'encounterId': encounterId, 'noteTypeKey': noteTypeKey, 'noteTypeVersion': noteTypeVersion},
        origin: 'local',
      );
      _putField(id, 'status', 'draft', serverVersion: 0, pending: changeId);
      for (final MapEntry(:key, :value) in data.entries) {
        _putField(id, 'data.$key', value, serverVersion: 0, pending: changeId);
      }
      return id;
    });
  }

  void _insertRecord(String id, String entity, {required Map<String, Object?> attributes, required String origin}) {
    _db.execute(
      'INSERT INTO records (id, entity, status, author_user_id, attributes_json, open, origin, created_at, updated_at) '
      "VALUES (?, ?, 'draft', ?, ?, 1, ?, ?, ?)",
      [id, entity, userId, jsonEncode(attributes), origin, _nowMs, _nowMs],
    );
  }

  void _checkLocation(Map<String, Object?>? location) {
    if (location == null) return;
    final lat = location['lat'];
    final lng = location['lng'];
    final ok =
        lat is num &&
        lng is num &&
        lat.abs() <= 90 &&
        lng.abs() <= 180 &&
        location.keys.every((k) => k == 'lat' || k == 'lng' || k == 'accuracyM');
    if (!ok) throw const LocalValidationError('That location isn’t valid.');
  }

  void _checkField(String entity, String field, Object? value) {
    if (field == 'status') {
      if (value != 'draft' && value != 'completed') {
        throw const LocalValidationError('Status must be draft or completed.');
      }
      return;
    }
    if (entity == entityEncounter && field == 'patientId') {
      if (value != null && (value is! String || !_uuidPattern.hasMatch(value))) {
        throw const LocalValidationError('Unknown patient.');
      }
      return;
    }
    if (entity == entityEncounter && field == 'location') {
      if (value != null && value is! Map<String, Object?>) {
        throw const LocalValidationError('That location isn’t valid.');
      }
      _checkLocation(value as Map<String, Object?>?);
      return;
    }
    if (entity == entityNote && field.startsWith('data.') && _dataPath.hasMatch(field.substring(5))) return;
    throw LocalValidationError('Unknown field $field.');
  }

  /// Changes one field. A second edit before the first is confirmed builds on it (`follows`), so
  /// the server never mistakes the person's own earlier edit for someone else's.
  void setField(String recordId, String field, Object? value) {
    _guardCharting();
    final rec = record(recordId);
    if (rec == null) throw StateError('no such record');
    if (rec.status == 'signed') throw const RecordLocked();
    _checkField(rec.entity, field, value);
    final current = rec.fields[field];
    if (current != null && canonicalJson(current.value) == canonicalJson(value)) return;
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
      _touch(recordId, status: field == 'status' ? value! as String : null);
    });
  }

  void _touch(String recordId, {String? status}) {
    _db.execute('UPDATE records SET updated_at = ?, status = coalesce(?, status) WHERE id = ?', [
      _nowMs,
      status,
      recordId,
    ]);
  }

  /// Reads and searches made offline join the server audit chain on sync (module 9). Logging
  /// never pauses, even when charting does.
  void appendAudit(String action, {String? entity, String? entityId, String? patientId, int? resultCount}) {
    if (!_auditActions.contains(action)) throw ArgumentError('unknown audit action $action');
    _tx(() {
      _append(
        entity: entityAudit,
        recordId: _newId(),
        op: 'append',
        value: <String, Object?>{
          'action': action,
          'entity': ?entity,
          'entityId': ?entityId,
          'patientId': ?patientId,
          'resultCount': ?resultCount,
        },
        baseVersion: 0,
      );
    });
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
    );
  }

  List<String> recordIds({bool openOnly = false}) => [
    for (final r in _db.select(openOnly ? 'SELECT id FROM records WHERE open = 1' : 'SELECT id FROM records'))
      r['id'] as String,
  ];

  OutboxEntry? entry(String changeId) =>
      _db.select('SELECT * FROM outbox WHERE change_id = ?', [changeId]).map(OutboxEntry.fromRow).firstOrNull;

  List<OutboxEntry> outbox() => _db.select('SELECT * FROM outbox ORDER BY seq').map(OutboxEntry.fromRow).toList();

  /// The oldest changes that may go now, in order. A change waits ("held") while an earlier change
  /// it depends on is rejected or in conflict: any earlier one on the same field, or a rejected
  /// create of its record (module 9: "Later changes that depend on a rejected one are held").
  List<OutboxEntry> sendable({int limit = 100}) => _db
      .select(
        "SELECT o.* FROM outbox o WHERE o.state = 'pending' AND NOT EXISTS ($_heldClause) ORDER BY o.seq LIMIT ?",
        [limit],
      )
      .map(OutboxEntry.fromRow)
      .toList();

  static const _heldClause =
      "SELECT 1 FROM outbox b WHERE b.state IN ('rejected', 'conflict') AND b.record_id = o.record_id "
      "AND b.seq < o.seq AND (b.op = 'create' OR b.field IS o.field)";

  int _count(String sql, [List<Object?> args = const []]) => _db.select(sql, args).first['n']! as int;

  /// Pending changes that wait on an unresolved earlier one.
  int heldCount() => _count("SELECT count(*) AS n FROM outbox o WHERE o.state = 'pending' AND EXISTS ($_heldClause)");

  /// The Needs attention list: rejections the person can fix and conflicts they must choose on.
  List<OutboxEntry> needsAttention() => _db
      .select("SELECT * FROM outbox WHERE state IN ('rejected', 'conflict') ORDER BY seq")
      .map(OutboxEntry.fromRow)
      .toList();

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
  void confirm(OutboxEntry e, {required int serverVersion, bool inReview = false}) {
    _tx(() {
      if (e.op == 'create') {
        _db.execute(
          'UPDATE fields SET server_version = 1, pending_change = NULL WHERE record_id = ? AND pending_change = ?',
          [e.recordId, e.changeId],
        );
        // The fields the create set are at version 1 on the server, including ones edited here
        // again since; fields first set by a later edit are still unknown to it (version 0).
        for (final name in _createdFields(e)) {
          _db.execute('UPDATE fields SET server_version = 1 WHERE record_id = ? AND field = ? AND server_version = 0', [
            e.recordId,
            name,
          ]);
        }
      } else if (e.op == 'set') {
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
      // The conflict or rejection this change resolved is settled with it.
      for (final settled in [e.conflictOf, e.supersedes].nonNulls) {
        _db.execute("DELETE FROM outbox WHERE change_id = ? AND state = 'superseded'", [settled]);
      }
      // Changes this one replaced (later edits folded into a resolution) go with it.
      _db.execute("DELETE FROM outbox WHERE state = 'superseded' AND (conflict_of = ? OR supersedes = ?)", [
        e.changeId,
        e.changeId,
      ]);
      if (inReview) {
        _db.execute('INSERT OR IGNORE INTO in_review (change_id, entity, record_id, received_at) VALUES (?, ?, ?, ?)', [
          e.changeId,
          e.entity,
          e.recordId,
          _nowMs,
        ]);
      }
      _db.execute('DELETE FROM outbox WHERE change_id = ?', [e.changeId]);
      _purge();
    });
  }

  /// The fields a create sets on the server (see insertEncounter and insertNote in the API).
  static List<String> _createdFields(OutboxEntry e) {
    if (e.entity == entityEncounter) return const ['patientId', 'location', 'status'];
    final data = (e.value as Map<String, Object?>?)?['data'];
    return ['status', if (data is Map<String, Object?>) ...data.keys.map((k) => 'data.$k')];
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
  /// Either way one new change goes to the server naming the conflict: `replace` puts their
  /// latest value on the chart (the replaced value and who approved it are logged), and
  /// `keep_server` keeps the server's value while their own is kept in history. Edits they made
  /// to the field after the conflict are folded into this one choice.
  void resolveConflict(String changeId, {required bool keepMine}) {
    final x = entry(changeId);
    if (x == null || x.state != ChangeState.conflict || x.server == null) throw StateError('not a conflict');
    final rec = record(x.recordId);
    final field = x.field!;
    final mine = rec?.fields[field]?.value ?? x.value;
    _tx(() {
      final resolution = _append(
        entity: x.entity,
        recordId: x.recordId,
        op: 'set',
        field: field,
        value: mine,
        baseVersion: x.server!.version,
        conflictOf: x.changeId,
        resolution: keepMine ? 'replace' : 'keep_server',
      );
      _supersedeAfter(x, resolution);
      _putField(
        x.recordId,
        field,
        keepMine ? mine : x.server!.value,
        serverVersion: x.server!.version,
        pending: resolution,
      );
    });
  }

  /// A fix for a rejected change, sent as a new change linked to it (module 9 "Rejections"). For a
  /// rejected set, [value] is the corrected field value. For a rejected create, it is the corrected
  /// create value; the record's later edits are folded into it.
  void fixRejected(String changeId, Object? value) {
    final x = entry(changeId);
    if (x == null || x.state != ChangeState.rejected) throw StateError('not a rejection');
    final rec = record(x.recordId);
    if (x.op == 'set') {
      _checkField(x.entity, x.field!, value);
      _tx(() {
        final fix = _append(
          entity: x.entity,
          recordId: x.recordId,
          op: 'set',
          field: x.field,
          value: value,
          baseVersion: rec?.fields[x.field]?.serverVersion ?? 0,
          supersedes: x.changeId,
        );
        _supersedeAfter(x, fix);
        _putField(x.recordId, x.field!, value, serverVersion: rec?.fields[x.field]?.serverVersion ?? 0, pending: fix);
      });
    } else if (x.op == 'create') {
      final created = value is Map<String, Object?> ? value : throw const LocalValidationError('Fix the record.');
      _tx(() {
        // Everything the person has in the record now goes with the fixed create.
        final merged = {...created};
        if (x.entity == entityNote && rec != null) {
          final data = <String, Object?>{
            for (final MapEntry(:key, :value) in rec.fields.entries)
              if (key.startsWith('data.')) key.substring(5): value.value,
          };
          if (data.isNotEmpty) merged['data'] = data;
        } else if (x.entity == entityEncounter && rec != null) {
          for (final name in ['patientId', 'location']) {
            final v = rec.fields[name]?.value;
            if (v != null) merged[name] = v;
          }
        }
        final fix = _append(
          entity: x.entity,
          recordId: x.recordId,
          op: 'create',
          value: merged,
          baseVersion: 0,
          supersedes: x.changeId,
        );
        _supersedeAfter(x, fix, wholeRecord: true);
        _db.execute('UPDATE fields SET pending_change = ?, server_version = 0 WHERE record_id = ?', [fix, x.recordId]);
        final status = rec?.fields['status']?.value;
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
      });
    } else {
      throw StateError('audit entries are never rejected for the person to fix');
    }
  }

  /// Marks [x] and every later unconfirmed change that depended on it as superseded by [by].
  /// For a whole record (a fixed create) that includes later changes the server rejected only
  /// because the record didn't exist yet: their values are in the fixed create.
  void _supersedeAfter(OutboxEntry x, String by, {bool wholeRecord = false}) {
    _db.execute("UPDATE outbox SET state = 'superseded' WHERE change_id = ?", [x.changeId]);
    _db.execute(
      // They point at [by], so they are deleted when [by] is confirmed.
      "UPDATE outbox SET state = 'superseded', supersedes = ? WHERE state IN ('pending', 'rejected') "
      "AND (state = 'pending' OR ? = 1) "
      'AND record_id = ? AND seq > ? AND seq < (SELECT seq FROM outbox WHERE change_id = ?) '
      'AND (? = 1 OR field IS ?)',
      [by, wholeRecord ? 1 : 0, x.recordId, x.seq, by, wholeRecord ? 1 : 0, x.field],
    );
  }

  /// Opens the server's copy of a record here (someone else's draft, or a refresh of one this
  /// phone holds open). Fields with local edits keep the person's value and the version they
  /// built on; the rest take the server's value.
  void importServerRecord(ServerRecord r) {
    _tx(() {
      final existing = _db.select('SELECT id FROM records WHERE id = ?', [r.id]).isNotEmpty;
      if (!existing) {
        _db.execute(
          'INSERT INTO records (id, entity, status, author_user_id, attributes_json, open, origin, downloaded_at, '
          "created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'server', ?, ?, ?)",
          [r.id, r.entity, r.status, r.authorUserId, jsonEncode(r.attributes), _nowMs, _nowMs, _nowMs],
        );
      } else {
        _db.execute('UPDATE records SET downloaded_at = ? WHERE id = ?', [_nowMs, r.id]);
      }
      for (final MapEntry(key: name, value: f) in r.fields.entries) {
        final local = _db.select('SELECT pending_change FROM fields WHERE record_id = ? AND field = ?', [
          r.id,
          name,
        ]).firstOrNull;
        if (local != null && local['pending_change'] != null) continue;
        _putField(r.id, name, f.value, serverVersion: f.version);
      }
      final status = _db.select("SELECT value_json FROM fields WHERE record_id = ? AND field = 'status'", [
        r.id,
      ]).firstOrNull;
      if (status != null) _touch(r.id, status: jsonDecode(status['value_json'] as String) as String);
    });
  }

  // ---- purge ----

  /// Deletes what the server already holds and the person no longer uses (module 9 "Purge rules").
  /// Returns the number of fields removed.
  int purge() => _tx(_purge);

  int _purge() {
    final expired = _nowMs - serverCopyLifetime.inMilliseconds;
    // A field goes once the record left active use (or its server copy expired), its latest
    // change is confirmed, and no change to it is still waiting.
    _db.execute(
      'DELETE FROM fields WHERE pending_change IS NULL '
      'AND record_id IN (SELECT id FROM records WHERE open = 0 OR (origin = ? AND downloaded_at < ?)) '
      'AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.record_id = fields.record_id '
      "  AND (o.field = fields.field OR o.op = 'create'))",
      ['server', expired],
    );
    final removed = _db.updatedRows;
    // A record goes once all its fields are gone and nothing about it waits.
    _db.execute(
      'DELETE FROM records WHERE NOT EXISTS (SELECT 1 FROM fields WHERE record_id = records.id) '
      'AND NOT EXISTS (SELECT 1 FROM outbox WHERE record_id = records.id) '
      'AND (open = 0 OR (origin = ? AND downloaded_at < ?))',
      ['server', expired],
    );
    return removed;
  }
}
