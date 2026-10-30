import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sqlite3/sqlite3.dart';

const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));

/// A database file as phase 2's app left it: schema version 1, keyed like LocalDatabase.open.
Database openRaw(String path) {
  final db = sqlite3.open(path);
  final hex = key.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  db.execute("PRAGMA key = \"x'$hex'\"");
  return db;
}

void main() {
  late Directory dir;
  late String path;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('db');
    path = LocalDatabase.fileFor(dir.path, userId, 'team-1');
  });
  tearDown(() => dir.deleteSync(recursive: true));

  int version(Database db) => db.select('PRAGMA user_version').first.values.first! as int;
  bool hasTable(Database db, String name) => db.select('SELECT 1 FROM sqlite_master WHERE name = ?', [name]).isNotEmpty;

  test('a phase 2 file upgrades to v2 and keeps its outbox, with the patient each change names', () {
    const patient = 'c0000000-0000-4000-8000-00000000000c';
    final v1 = openRaw(path);
    LocalDatabase.migrate(v1, target: 1);
    expect(version(v1), 1);
    void change(String id, int seq, String op, String? field, String value) => v1.execute(
      'INSERT INTO outbox (change_id, seq, entity, record_id, op, field, value_json, value_hash, base_version, '
      "device_time, clock_verified, category, state, created_at) VALUES (?, ?, 'encounter', 'e1', ?, ?, ?, 'h', 0, "
      "0, 1, 'encounters', 'pending', 0)",
      [id, seq, op, field, value],
    );
    change('c1', 1, 'create', null, '{"kind":"medical","patientId":"$patient"}');
    change('c2', 2, 'set', 'patientId', '"$patient"');
    change('c3', 3, 'set', 'location', '{"lat":1,"lng":2}');
    change('c4', 4, 'set', 'patientId', 'null');
    v1.close();

    final db = LocalDatabase.open(path, key);
    addTearDown(db.close);
    expect(version(db.db), LocalDatabase.schemaVersion);
    final rows = db.db.select('SELECT change_id, patient_id FROM outbox ORDER BY seq');
    expect([for (final r in rows) r['change_id']], ['c1', 'c2', 'c3', 'c4']);
    expect([for (final r in rows) r['patient_id']], [patient, patient, null, null]);
    for (final table in ['cache_scopes', 'patient_redirects', 'team_index', 'team_index_staging', 'patient_names']) {
      expect(hasTable(db.db, table), isTrue, reason: table);
    }
    expect(hasTable(db.db, 'id_links') && hasTable(db.db, 'local_notices'), isTrue);
    // The store reads the upgraded file as its own.
    final store = LocalStore(
      db,
      userId: userId,
      stamp: () => ClockStamp(deviceTime: DateTime.utc(2026), correctedTime: null, verified: false),
    );
    expect(store.outbox().map((e) => e.patientId), [patient, patient, null, null]);
  });

  test('v2 refuses to run on SQLite older than 3.42, and the file stays at v1', () {
    expect(LocalDatabase.supportsSecureDelete('3.42.0'), isTrue);
    expect(LocalDatabase.supportsSecureDelete('3.53.4'), isTrue);
    expect(LocalDatabase.supportsSecureDelete('4.0'), isTrue);
    expect(LocalDatabase.supportsSecureDelete('3.41.2'), isFalse);
    expect(LocalDatabase.supportsSecureDelete('2.99'), isFalse);
    final db = openRaw(path);
    addTearDown(db.close);
    LocalDatabase.migrate(db, target: 1);
    expect(() => LocalDatabase.migrate(db, sqliteVersion: '3.41.2'), throwsStateError);
    expect(version(db), 1);
    expect(hasTable(db, 'patient_names'), isFalse);
    LocalDatabase.migrate(db, sqliteVersion: '3.42.0');
    expect(version(db), 2);
  });

  test('FTS5 secure-delete is on in every file, and put back at open if it is missing', () {
    var db = LocalDatabase.open(path, key);
    String? option() =>
        db.db.select("SELECT v FROM patient_names_config WHERE k = 'secure-delete'").firstOrNull?['v']?.toString();
    expect(option(), '1');
    db.db.execute("DELETE FROM patient_names_config WHERE k = 'secure-delete'");
    db.close();
    db = LocalDatabase.open(path, key);
    addTearDown(db.close);
    expect(option(), '1');
  });

  test('a file from a newer app is refused', () {
    final raw = openRaw(path);
    LocalDatabase.migrate(raw);
    raw.execute('PRAGMA user_version = ${LocalDatabase.schemaVersion + 1}');
    raw.close();
    expect(() => LocalDatabase.open(path, key), throwsStateError);
  });
}
