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
    // To v2 only: the steps after it are their own tests', and the file's app version moves on.
    LocalDatabase.migrate(db, target: 2, sqliteVersion: '3.42.0');
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

  // Phase 5 (design 6.1): the team's presets, a server copy, in a table of their own. Written
  // ahead of P2-local-db's `_v3`, which makes them pass.
  group('the presets table (v3)', () {
    /// Each column of the presets table, and whether it is the primary key.
    Map<String, Object?> presetColumns(Database db) => {
      for (final c in db.select('PRAGMA table_info(presets)')) c['name']! as String: c['pk'],
    };
    const columns = {'kind': 0, 'id': 1, 'version': 0, 'state': 0, 'origin_key': 0, 'body_json': 0};
    int count(Database db, String table) => db.select('SELECT count(*) AS n FROM $table').first['n']! as int;

    test('a version 2 file opens with its work kept and an empty presets table', () {
      const patient = 'c0000000-0000-4000-8000-00000000000c';
      final v2 = openRaw(path);
      LocalDatabase.migrate(v2, target: 2);
      expect(version(v2), 2);
      v2
        ..execute(
          'INSERT INTO outbox (change_id, seq, entity, record_id, op, value_json, value_hash, base_version, '
          "device_time, clock_verified, category, state, created_at, patient_id) VALUES ('c1', 1, 'patient', ?, "
          "'create', '{}', 'h', 0, 0, 1, 'patients', 'pending', 0, ?)",
          [patient, patient],
        )
        ..execute(
          'INSERT INTO records (id, entity, status, attributes_json, open, origin, created_at, updated_at, patient_id) '
          "VALUES (?, 'patient', 'active', '{}', 0, 'local', 0, 0, ?)",
          [patient, patient],
        )
        ..execute(
          "INSERT INTO team_index (patient_id, entry_json) VALUES ('c0000000-0000-4000-8000-00000000000d', '{}')",
        )
        ..execute("INSERT INTO kv (key, value) VALUES ('seq', '1'), ('index.version', '7.idx1')");
      v2.close();

      final db = LocalDatabase.open(path, key);
      addTearDown(db.close);
      expect(version(db.db), LocalDatabase.schemaVersion);
      // The work and the server copies it held are as they were.
      expect([count(db.db, 'outbox'), count(db.db, 'records'), count(db.db, 'team_index')], [1, 1, 1]);
      expect([db.kvGet('seq'), db.kvGet('index.version')], ['1', '7.idx1']);
      expect(presetColumns(db.db), columns, reason: 'each preset is put by its id');
      expect(count(db.db, 'presets'), 0);
      // The store reads the upgraded file as its own.
      final store = LocalStore(
        db,
        userId: userId,
        stamp: () => ClockStamp(deviceTime: DateTime.utc(2026), correctedTime: null, verified: false),
      );
      expect(store.outbox().map((e) => e.changeId), ['c1']);
    });

    test('a new file is made with the presets table', () {
      final db = LocalDatabase.open(path, key);
      addTearDown(db.close);
      expect(version(db.db), LocalDatabase.schemaVersion);
      expect(presetColumns(db.db), columns);
    });
  });

  // Review finding S2: what a receipt hook keeps of a record lives in a table keyed by the record,
  // and goes with it, whichever path deletes the record.
  group('what a receipt hook keeps (v4)', () {
    const held = 'f0000000-0000-4000-8000-000000000001';
    const gone = 'f0000000-0000-4000-8000-000000000002';
    const problem = 'f0000000-0000-4000-8000-000000000003';
    const goneProblem = 'f0000000-0000-4000-8000-000000000004';

    void insertRecord(Database db, String id, String entity) => db.execute(
      'INSERT INTO records (id, entity, status, attributes_json, open, origin, created_at, updated_at) '
      "VALUES (?, ?, 'active', '{}', 0, 'server', 0, 0)",
      [id, entity],
    );
    List<List<Object?>> keptRows(Database db) => [
      for (final r in db.select('SELECT record_id, kind, value FROM receipt_kept ORDER BY record_id, kind'))
        [r['record_id'], r['kind'], r['value']],
    ];

    test('a version 3 file moves the kept rows of the records it holds, and drops the rest', () {
      final v3 = openRaw(path);
      LocalDatabase.migrate(v3, target: 3);
      expect(version(v3), 3);
      insertRecord(v3, held, 'patient_flag_change');
      insertRecord(v3, problem, 'problem');
      v3.execute('INSERT INTO kv (key, value) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)', [
        'flagChange.$held',
        '{"at":1,"receivedAt":2}',
        'flagChange.$gone',
        '{"at":3,"receivedAt":4}',
        'statusCheck.$problem',
        '5',
        'statusCheck.$goneProblem',
        '6',
        'seq',
        '7',
      ]);
      v3.close();

      final db = LocalDatabase.open(path, key);
      addTearDown(db.close);
      expect(version(db.db), 4);
      expect(keptRows(db.db), [
        [held, 'flagChange', '{"at":1,"receivedAt":2}'],
        [problem, 'statusCheck', '5'],
      ]);
      expect([for (final r in db.db.select('SELECT key FROM kv ORDER BY key')) r['key']], ['seq']);
    });

    test('a kept row goes with its record, by the cascade, and a record can’t gain one it doesn’t hold', () {
      final db = LocalDatabase.open(path, key);
      addTearDown(db.close);
      insertRecord(db.db, held, 'patient_flag_change');
      insertRecord(db.db, problem, 'problem');
      db.db
        ..execute("INSERT INTO receipt_kept (record_id, kind, value) VALUES (?, 'flagChange', '{}')", [held])
        ..execute("INSERT INTO receipt_kept (record_id, kind, value) VALUES (?, 'statusCheck', '1')", [problem]);
      db.db.execute('DELETE FROM records WHERE id = ?', [held]);
      expect(keptRows(db.db), [
        [problem, 'statusCheck', '1'],
      ]);
      expect(
        () => db.db.execute("INSERT INTO receipt_kept (record_id, kind, value) VALUES (?, 'flagChange', '{}')", [gone]),
        throwsA(isA<SqliteException>()),
        reason: 'the record must be here',
      );
    });
  });

  test('a file from a newer app is refused', () {
    final raw = openRaw(path);
    LocalDatabase.migrate(raw);
    raw.execute('PRAGMA user_version = ${LocalDatabase.schemaVersion + 1}');
    raw.close();
    expect(() => LocalDatabase.open(path, key), throwsStateError);
  });
}
