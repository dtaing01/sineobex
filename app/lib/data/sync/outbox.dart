import 'dart:convert';

import 'package:drift/drift.dart';

import '../local/database.dart';

enum SyncEntity { patient, encounter, inventory, member, task }

enum SyncOp { create, update, delete }

/// The offline write queue.
///
/// Every mutation commits to the local database first and appends an entry
/// here. Nothing in the UI ever awaits the network — a nurse in a basement
/// gets the same write latency as one on LTE.
class Outbox {
  Outbox(this._db);

  final AppDatabase _db;

  Future<void> enqueue({
    required SyncEntity entity,
    required String entityId,
    required SyncOp op,
    required Map<String, dynamic> payload,
  }) async {
    await _db
        .into(_db.outboxRows)
        .insert(
          OutboxRowsCompanion.insert(
            entity: entity.name,
            entityId: entityId,
            op: op.name,
            payload: jsonEncode(payload),
            queuedAt: DateTime.now().toUtc(),
          ),
        );
  }

  Future<List<OutboxRow>> pending({int limit = 50}) =>
      (_db.select(_db.outboxRows)
            ..orderBy([(t) => OrderingTerm.asc(t.seq)])
            ..limit(limit))
          .get();

  Future<int> pendingCount() async {
    final count = _db.outboxRows.seq.count();
    final row = await (_db.selectOnly(
      _db.outboxRows,
    )..addColumns([count])).getSingle();
    return row.read(count) ?? 0;
  }

  Stream<int> watchPendingCount() {
    final count = _db.outboxRows.seq.count();
    return (_db.selectOnly(
      _db.outboxRows,
    )..addColumns([count])).watchSingle().map((row) => row.read(count) ?? 0);
  }

  Future<void> markDone(int seq) =>
      (_db.delete(_db.outboxRows)..where((t) => t.seq.equals(seq))).go();

  /// Increments the attempt counter in place so backoff grows across retries
  /// rather than resetting each pass.
  Future<void> markFailed(int seq, Object error) async {
    await _db.customUpdate(
      'UPDATE outbox_rows SET attempts = attempts + 1, last_error = ? '
      'WHERE seq = ?',
      variables: [Variable<String>(error.toString()), Variable<int>(seq)],
      updates: {_db.outboxRows},
    );
  }

  /// Exponential backoff, capped at 30 minutes. A device that has been out of
  /// range all day should not hammer the API the moment it reconnects.
  static Duration backoffFor(int attempts) {
    if (attempts <= 0) return Duration.zero;
    final seconds = 2 << (attempts.clamp(0, 10));
    final capped = seconds.clamp(2, 1800);
    return Duration(seconds: capped);
  }
}
