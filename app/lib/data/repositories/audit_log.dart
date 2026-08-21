import 'package:drift/drift.dart';

import '../local/database.dart';

/// HIPAA §164.312(b) — record and examine activity in systems containing PHI.
///
/// Every read of a patient chart and every write to one appends a row here.
/// Rows are queued locally when offline and shipped on the next sync; they are
/// never deleted by the client, only by the server-side archival job.
enum AuditAction {
  viewPatient,
  listPatients,
  createPatient,
  updatePatient,
  logEncounter,
  viewEncounter,
  exportReport,
  signIn,
  signOut,
  unlock,
  failedUnlock,
}

class AuditLog {
  AuditLog(this._db);

  final AppDatabase _db;

  String _actor = 'unknown';

  void setActor(String actorId) => _actor = actorId;

  Future<void> record(
    AuditAction action, {
    required String entity,
    String entityId = '',
  }) async {
    await _db.into(_db.auditRows).insert(
          AuditRowsCompanion.insert(
            actor: _actor,
            action: action.name,
            entity: entity,
            entityId: entityId,
            at: DateTime.now().toUtc(),
          ),
        );
  }

  Future<List<AuditRow>> unsynced({int limit = 200}) =>
      (_db.select(_db.auditRows)
            ..where((t) => t.synced.equals(false))
            ..orderBy([(t) => OrderingTerm.asc(t.seq)])
            ..limit(limit))
          .get();

  Future<void> markSynced(List<int> seqs) async {
    if (seqs.isEmpty) return;
    await (_db.update(_db.auditRows)..where((t) => t.seq.isIn(seqs)))
        .write(const AuditRowsCompanion(synced: Value(true)));
  }
}
