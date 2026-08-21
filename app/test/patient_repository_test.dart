import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/local/database.dart';
import 'package:sineobex/data/models/models.dart';
import 'package:sineobex/data/repositories/audit_log.dart';
import 'package:sineobex/data/repositories/patient_repository.dart';
import 'package:sineobex/data/sync/outbox.dart';

import 'helpers.dart';

void main() {
  late AppDatabase db;
  late Outbox outbox;
  late PatientRepository repo;

  setUpAll(suppressDriftWarnings);

  setUp(() {
    db = testDatabase();
    outbox = Outbox(db);
    repo = PatientRepository(db, outbox, AuditLog(db)..setActor('test'));
  });

  tearDown(() => db.close());

  Future<Patient> enrollJane() => repo.enroll(
        firstName: 'Jane',
        lastName: 'Doe',
        dob: DateTime(1992, 8, 24),
        risk: RiskLevel.moderate,
        loc: 'Cass Corridor',
        lat: 42.345,
        lng: -83.06,
        primaryDoctor: 'Dr. Smith',
      );

  group('enroll', () {
    test('persists the patient', () async {
      final created = await enrollJane();
      final loaded = await repo.byId(created.id);

      expect(loaded, isNotNull);
      expect(loaded!.name, 'Jane Doe');
      expect(loaded.risk, RiskLevel.moderate);
      expect(loaded.primaryDoctor, 'Dr. Smith');
    });

    test('assigns a UUID, not a random base-36 string', () async {
      final created = await enrollJane();
      expect(
        created.id,
        matches(
          RegExp(
            r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-'
            r'[0-9a-f]{12}$',
          ),
        ),
      );
    });

    test('seeds a first movement observation at the enrollment location',
        () async {
      final created = await enrollJane();
      expect(created.commonLocations, hasLength(1));
      expect(created.commonLocations.first.name, 'Cass Corridor');
      expect(created.commonLocations.first.lat, 42.345);
    });

    test('normalises blank optional fields to null', () async {
      final created = await repo.enroll(
        firstName: 'John',
        lastName: 'Roe',
        dob: DateTime(1980),
        risk: RiskLevel.low,
        loc: 'Downtown',
        lat: 42.33,
        lng: -83.04,
        phone: '   ',
        insuranceName: '',
      );
      expect(created.phone, isNull);
      expect(created.insuranceName, isNull);
    });

    test('queues the create for sync', () async {
      await enrollJane();
      final pending = await outbox.pending();
      expect(pending, hasLength(1));
      expect(pending.single.entity, 'patient');
      expect(pending.single.op, 'create');
    });
  });

  group('logEncounter', () {
    test('persists notes, supplies, and the follow-up flag', () async {
      final patient = await enrollJane();

      await repo.logEncounter(
        patientId: patient.id,
        provider: 'Sarah Chen, RN',
        notes: 'Wound cleaned and dressed.',
        needs: 'Chronic Wound Care',
        encounterLoc: 'Cass Park (North)',
        supplies: ['Gauze', 'Saline'],
        followUpSet: true,
        followUpDate: DateTime(2026, 5, 1),
      );

      final loaded = await repo.byId(patient.id);
      expect(loaded!.history, hasLength(1));

      final encounter = loaded.history.single;
      expect(encounter.notes, 'Wound cleaned and dressed.');
      expect(encounter.needs, 'Chronic Wound Care');
      expect(encounter.supplies, ['Gauze', 'Saline']);
      expect(encounter.followUpSet, isTrue);
      expect(encounter.followUpDate, DateTime(2026, 5, 1));
    });

    test('lifts the follow-up flag and date onto the patient', () async {
      final patient = await enrollJane();
      expect(patient.followUp, isFalse);

      await repo.logEncounter(
        patientId: patient.id,
        provider: 'Sarah Chen, RN',
        notes: 'BP check',
        needs: 'BP Check',
        encounterLoc: 'Eastern Market',
        supplies: const [],
        followUpSet: true,
        followUpDate: DateTime(2026, 5, 19),
      );

      final loaded = await repo.byId(patient.id);
      expect(loaded!.followUp, isTrue);
      expect(loaded.nextFollowUp, DateTime(2026, 5, 19));
    });

    test('clears the follow-up when the flag is not set', () async {
      final patient = await enrollJane();
      await repo.logEncounter(
        patientId: patient.id,
        provider: 'RN',
        notes: 'first',
        needs: 'check',
        encounterLoc: 'A',
        supplies: const [],
        followUpSet: true,
        followUpDate: DateTime(2026, 5, 19),
      );
      await repo.logEncounter(
        patientId: patient.id,
        provider: 'RN',
        notes: 'resolved',
        needs: 'check',
        encounterLoc: 'A',
        supplies: const [],
        followUpSet: false,
      );

      final loaded = await repo.byId(patient.id);
      expect(loaded!.followUp, isFalse);
      expect(loaded.nextFollowUp, isNull);
    });

    test('records the encounter location as a movement observation', () async {
      final patient = await enrollJane();

      await repo.logEncounter(
        patientId: patient.id,
        provider: 'RN',
        notes: 'seen here',
        needs: 'check',
        encounterLoc: 'St. Peter Church',
        supplies: const [],
        followUpSet: false,
      );

      final loaded = await repo.byId(patient.id);
      expect(loaded!.commonLocations.first.name, 'St. Peter Church');
      expect(loaded.commonLocations, hasLength(2));
    });

    test('keeps history newest-first across multiple encounters', () async {
      final patient = await enrollJane();

      for (final day in [1, 15, 8]) {
        await repo.logEncounter(
          patientId: patient.id,
          provider: 'RN',
          notes: 'visit $day',
          needs: 'check',
          encounterLoc: 'Cass Park',
          supplies: const [],
          followUpSet: false,
          now: DateTime(2026, 4, day),
        );
      }

      final loaded = await repo.byId(patient.id);
      final dates = loaded!.history.map((h) => h.date.day).toList();
      expect(dates, [15, 8, 1]);
    });

    test('caps movement observations at eight', () async {
      final patient = await enrollJane();
      for (var i = 1; i <= 12; i++) {
        await repo.logEncounter(
          patientId: patient.id,
          provider: 'RN',
          notes: 'v$i',
          needs: 'check',
          encounterLoc: 'Location $i',
          supplies: const [],
          followUpSet: false,
        );
      }
      final loaded = await repo.byId(patient.id);
      expect(loaded!.commonLocations.length, 8);
      expect(loaded.commonLocations.first.name, 'Location 12');
    });

    test('falls back to the patient location when none is given', () async {
      final patient = await enrollJane();
      await repo.logEncounter(
        patientId: patient.id,
        provider: 'RN',
        notes: 'note',
        needs: 'check',
        encounterLoc: '   ',
        supplies: const [],
        followUpSet: false,
      );
      final loaded = await repo.byId(patient.id);
      expect(loaded!.history.single.encounterLoc, 'Cass Corridor');
    });

    test('refuses to log against an unknown patient', () async {
      expect(
        () => repo.logEncounter(
          patientId: 'does-not-exist',
          provider: 'RN',
          notes: '',
          needs: '',
          encounterLoc: '',
          supplies: const [],
          followUpSet: false,
        ),
        throwsStateError,
      );
    });

    test('queues the encounter for sync', () async {
      final patient = await enrollJane();
      await repo.logEncounter(
        patientId: patient.id,
        provider: 'RN',
        notes: 'note',
        needs: 'check',
        encounterLoc: 'Cass Park',
        supplies: const [],
        followUpSet: false,
      );

      final pending = await outbox.pending();
      expect(pending.map((r) => r.entity), containsAll(['patient', 'encounter']));
    });
  });

  group('watchAll', () {
    test('emits patients sorted by name', () async {
      await repo.enroll(
        firstName: 'Zoe',
        lastName: 'Adams',
        dob: DateTime(1985),
        risk: RiskLevel.low,
        loc: 'A',
        lat: 0,
        lng: 0,
      );
      await repo.enroll(
        firstName: 'Aaron',
        lastName: 'Baker',
        dob: DateTime(1985),
        risk: RiskLevel.low,
        loc: 'B',
        lat: 0,
        lng: 0,
      );

      final patients = await repo.watchAll().first;
      expect(patients.map((p) => p.firstName), ['Aaron', 'Zoe']);
    });
  });
}
