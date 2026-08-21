import 'dart:convert';

import 'package:drift/drift.dart';

import 'connection/connection.dart';

part 'database.g.dart';

/// Records are stored as typed columns for anything queried or sorted, and as
/// a JSON payload for nested structures (encounter history, movement
/// patterns) that are always read whole.
@DataClassName('PatientRow')
class PatientRows extends Table {
  TextColumn get id => text()();
  TextColumn get payload => text()();
  TextColumn get searchName => text()();
  TextColumn get dob => text()();
  TextColumn get risk => text()();
  BoolColumn get followUp => boolean().withDefault(const Constant(false))();
  DateTimeColumn get nextFollowUp => dateTime().nullable()();
  DateTimeColumn get updatedAt => dateTime()();
  BoolColumn get dirty => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('EncounterRow')
class EncounterRows extends Table {
  TextColumn get id => text()();
  TextColumn get patientId => text()();
  TextColumn get payload => text()();
  DateTimeColumn get date => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  BoolColumn get dirty => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('InventoryRow')
class InventoryRows extends Table {
  TextColumn get id => text()();
  TextColumn get payload => text()();
  TextColumn get name => text()();
  TextColumn get category => text()();
  IntColumn get stock => integer()();
  IntColumn get minLevel => integer()();
  DateTimeColumn get updatedAt => dateTime()();
  BoolColumn get dirty => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('ResourceRow')
class ResourceRows extends Table {
  TextColumn get id => text()();
  TextColumn get payload => text()();
  TextColumn get type => text()();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('HotspotRow')
class HotspotRows extends Table {
  TextColumn get id => text()();
  TextColumn get payload => text()();
  TextColumn get type => text()();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('SupplyLogRow')
class SupplyLogRows extends Table {
  TextColumn get id => text()();
  TextColumn get payload => text()();
  DateTimeColumn get at => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

@DataClassName('KeyValueRow')
class KeyValueRows extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

/// The offline write queue. Every local mutation appends here and is drained
/// when connectivity returns.
@DataClassName('OutboxRow')
class OutboxRows extends Table {
  IntColumn get seq => integer().autoIncrement()();
  TextColumn get entity => text()();
  TextColumn get entityId => text()();
  TextColumn get op => text()();
  TextColumn get payload => text()();
  DateTimeColumn get queuedAt => dateTime()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
}

/// Local mirror of the server audit trail, so that PHI access performed while
/// offline is still accounted for once the device syncs.
@DataClassName('AuditRow')
class AuditRows extends Table {
  IntColumn get seq => integer().autoIncrement()();
  TextColumn get actor => text()();
  TextColumn get action => text()();
  TextColumn get entity => text()();
  TextColumn get entityId => text()();
  DateTimeColumn get at => dateTime()();
  BoolColumn get synced => boolean().withDefault(const Constant(false))();
}

@DriftDatabase(
  tables: [
    PatientRows,
    EncounterRows,
    InventoryRows,
    ResourceRows,
    HotspotRows,
    SupplyLogRows,
    KeyValueRows,
    OutboxRows,
    AuditRows,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e);

  /// The platform's real database: SQLCipher on mobile/desktop, in-memory
  /// WASM on web. See `connection/connection.dart`.
  AppDatabase.platform() : super(openConnection());

  @override
  int get schemaVersion => 1;

  Future<void> putKeyValue(String key, Object? value) => into(keyValueRows)
      .insertOnConflictUpdate(
        KeyValueRowsCompanion.insert(key: key, value: jsonEncode(value)),
      );

  Future<T?> getKeyValue<T>(String key) async {
    final row = await (select(
      keyValueRows,
    )..where((t) => t.key.equals(key))).getSingleOrNull();
    if (row == null) return null;
    return jsonDecode(row.value) as T?;
  }

  /// Removes every row holding PHI. Called on sign-out and after repeated
  /// failed unlock attempts.
  Future<void> wipePhi() => transaction(() async {
    await delete(patientRows).go();
    await delete(encounterRows).go();
    await delete(supplyLogRows).go();
    await delete(outboxRows).go();
    await delete(auditRows).go();
  });
}
