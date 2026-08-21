import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../local/database.dart';
import '../models/models.dart';
import '../sync/outbox.dart';
import 'audit_log.dart';

const _uuid = Uuid();

class PatientRepository {
  PatientRepository(this._db, this._outbox, this._audit);

  final AppDatabase _db;
  final Outbox _outbox;
  final AuditLog _audit;

  Stream<List<Patient>> watchAll() {
    final query = _db.select(_db.patientRows)
      ..orderBy([(t) => OrderingTerm.asc(t.searchName)]);
    return query.watch().map(
      (rows) => rows.map((r) => _decode(r.payload)).toList(growable: false),
    );
  }

  Future<List<Patient>> all() async {
    await _audit.record(AuditAction.listPatients, entity: 'patient');
    final rows = await (_db.select(
      _db.patientRows,
    )..orderBy([(t) => OrderingTerm.asc(t.searchName)])).get();
    return rows.map((r) => _decode(r.payload)).toList(growable: false);
  }

  Stream<Patient?> watchById(String id) =>
      (_db.select(_db.patientRows)..where((t) => t.id.equals(id)))
          .watchSingleOrNull()
          .map((r) => r == null ? null : _decode(r.payload));

  Future<Patient?> byId(String id) async {
    final row = await (_db.select(
      _db.patientRows,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
    if (row == null) return null;
    await _audit.record(
      AuditAction.viewPatient,
      entity: 'patient',
      entityId: id,
    );
    return _decode(row.payload);
  }

  /// Enrolls a new patient. Unlike the prototype, this persists, uses a UUID
  /// rather than `Math.random().toString(36)`, and computes a true age.
  Future<Patient> enroll({
    required String firstName,
    required String lastName,
    required DateTime dob,
    required RiskLevel risk,
    required String loc,
    required double lat,
    required double lng,
    String? phone,
    String? insuranceName,
    String? memberId,
    String? primaryDoctor,
    DateTime? now,
  }) async {
    final ts = now ?? DateTime.now();
    final patient = Patient(
      id: _uuid.v4(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dob: dob,
      risk: risk,
      loc: loc.trim(),
      lat: lat,
      lng: lng,
      tags: const [],
      flags: const [],
      followUp: false,
      commonLocations: [
        CommonLocation(name: loc.trim(), lat: lat, lng: lng, observedAt: ts),
      ],
      history: const [],
      phone: _blankToNull(phone),
      insuranceName: _blankToNull(insuranceName),
      memberId: _blankToNull(memberId),
      primaryDoctor: _blankToNull(primaryDoctor),
      updatedAt: ts,
    );

    await _upsert(patient, dirty: true);
    await _outbox.enqueue(
      entity: SyncEntity.patient,
      entityId: patient.id,
      op: SyncOp.create,
      payload: patient.toJson(),
    );
    await _audit.record(
      AuditAction.createPatient,
      entity: 'patient',
      entityId: patient.id,
    );
    return patient;
  }

  Future<void> save(Patient patient) async {
    final updated = patient.copyWith(updatedAt: DateTime.now());
    await _upsert(updated, dirty: true);
    await _outbox.enqueue(
      entity: SyncEntity.patient,
      entityId: updated.id,
      op: SyncOp.update,
      payload: updated.toJson(),
    );
    await _audit.record(
      AuditAction.updatePatient,
      entity: 'patient',
      entityId: updated.id,
    );
  }

  /// Appends an encounter and folds its consequences into the patient record:
  /// the follow-up flag, the next follow-up date, and a new movement-pattern
  /// observation for the place the encounter happened.
  ///
  /// The prototype's Save Entry button discarded all of this (plan defect D8).
  Future<Encounter> logEncounter({
    required String patientId,
    required String provider,
    required String notes,
    required String needs,
    required String encounterLoc,
    required List<String> supplies,
    required bool followUpSet,
    DateTime? followUpDate,
    String? followUpLoc,
    double? lat,
    double? lng,
    DateTime? now,
  }) async {
    final ts = now ?? DateTime.now();
    final patient = await byId(patientId);
    if (patient == null) {
      throw StateError(
        'Cannot log an encounter for unknown patient $patientId',
      );
    }

    final encounter = Encounter(
      id: _uuid.v4(),
      patientId: patientId,
      date: ts,
      provider: provider,
      needs: needs.trim().isEmpty ? 'Field Encounter' : needs.trim(),
      encounterLoc: encounterLoc.trim().isEmpty
          ? patient.loc
          : encounterLoc.trim(),
      notes: notes.trim(),
      supplies: supplies,
      followUpSet: followUpSet,
      followUpDate: followUpSet ? followUpDate : null,
      followUpLoc: followUpSet ? (followUpLoc ?? patient.loc) : null,
      lat: lat ?? patient.lat,
      lng: lng ?? patient.lng,
    );

    final history = [encounter, ...patient.history]
      ..sort((a, b) => b.date.compareTo(a.date));

    // Record where we actually found them, so the field-intelligence map
    // learns from every visit.
    final observation = CommonLocation(
      name: encounter.encounterLoc,
      lat: encounter.lat ?? patient.lat,
      lng: encounter.lng ?? patient.lng,
      observedAt: ts,
    );
    final locations = [
      observation,
      ...patient.commonLocations,
    ].take(8).toList(growable: false);

    final updated = patient.copyWith(
      history: history,
      commonLocations: locations,
      followUp: followUpSet,
      nextFollowUp: followUpSet ? encounter.followUpDate : null,
      clearNextFollowUp: !followUpSet,
      updatedAt: ts,
    );

    await _db.transaction(() async {
      await _upsert(updated, dirty: true);
      await _db
          .into(_db.encounterRows)
          .insertOnConflictUpdate(
            EncounterRowsCompanion.insert(
              id: encounter.id,
              patientId: patientId,
              payload: jsonEncode(encounter.toJson()),
              date: encounter.date,
              updatedAt: ts,
              dirty: const Value(true),
            ),
          );
    });

    await _outbox.enqueue(
      entity: SyncEntity.encounter,
      entityId: encounter.id,
      op: SyncOp.create,
      payload: encounter.toJson(),
    );
    await _audit.record(
      AuditAction.logEncounter,
      entity: 'encounter',
      entityId: encounter.id,
    );

    return encounter;
  }

  Future<void> replaceAll(List<Patient> patients) async {
    await _db.transaction(() async {
      await _db.delete(_db.patientRows).go();
      for (final p in patients) {
        await _upsert(p, dirty: false);
      }
    });
  }

  Future<bool> get isEmpty async {
    final row = await (_db.selectOnly(
      _db.patientRows,
    )..addColumns([_db.patientRows.id.count()])).getSingle();
    return (row.read(_db.patientRows.id.count()) ?? 0) == 0;
  }

  Future<void> _upsert(Patient p, {required bool dirty}) => _db
      .into(_db.patientRows)
      .insertOnConflictUpdate(
        PatientRowsCompanion.insert(
          id: p.id,
          payload: jsonEncode(p.toJson()),
          searchName: p.name.toLowerCase(),
          dob: p.dobIso,
          risk: p.risk.label,
          followUp: Value(p.followUp),
          nextFollowUp: Value(p.nextFollowUp),
          updatedAt: p.updatedAt ?? DateTime.now(),
          dirty: Value(dirty),
        ),
      );

  Patient _decode(String payload) =>
      Patient.fromJson(jsonDecode(payload) as Map<String, dynamic>);

  static String? _blankToNull(String? s) =>
      (s == null || s.trim().isEmpty) ? null : s.trim();
}
