import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

/// The encrypted database on the phone (module 9, "Data at rest").
///
/// One SQLCipher file per user and team, keyed with the user's random 256-bit key from the
/// [KeyVault]. The key is passed raw, so no slow key derivation runs on unlock, and a database
/// opened with the wrong key fails immediately rather than on first use. Opening refuses to run
/// without SQLCipher: patient data is never written to a plain SQLite file.
class LocalDatabase {
  LocalDatabase._(this.db, this.path);

  final Database db;
  final String path;

  static const schemaVersion = 1;

  static LocalDatabase open(String path, Uint8List key) {
    if (key.length != 32) throw ArgumentError('the database key must be 32 bytes');
    final db = sqlite3.open(path);
    try {
      if (db.select('PRAGMA cipher_version').isEmpty) {
        throw StateError('SQLCipher is not available; refusing to store patient data unencrypted');
      }
      final hex = key.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
      db.execute("PRAGMA key = \"x'$hex'\"");
      // Reading the schema proves the key now (SqliteException on a wrong key).
      db.select('SELECT count(*) FROM sqlite_master');
      db
        ..execute('PRAGMA foreign_keys = ON')
        // Purged values are overwritten on disk, not just unlinked from the page tree.
        ..execute('PRAGMA secure_delete = ON')
        // Every committed change survives the app being killed or the battery dying.
        ..execute('PRAGMA synchronous = FULL');
      _migrate(db);
    } catch (_) {
      db.close();
      rethrow;
    }
    return LocalDatabase._(db, path);
  }

  void close() => db.close();

  String? kvGet(String key) => db.select('SELECT value FROM kv WHERE key = ?', [key]).firstOrNull?['value'] as String?;

  void kvSet(String key, String value) => db.execute(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value],
  );

  /// The file for one user and team. The user ID is hashed so file names say nothing about who.
  static String fileFor(String directory, String userId, String teamId) {
    final who = sha256.convert(userId.codeUnits).toString().substring(0, 16);
    return p.join(directory, 'sx_${who}_$teamId.db');
  }

  /// The team a database file belongs to (see [fileFor]).
  static String teamOf(String path) {
    final name = p.basename(path);
    return name.substring('sx_'.length + 17, name.length - '.db'.length);
  }

  /// Every database file this user has on the phone.
  static List<String> filesForUser(String directory, String userId) {
    final who = sha256.convert(userId.codeUnits).toString().substring(0, 16);
    final dir = Directory(directory);
    if (!dir.existsSync()) return const [];
    return dir
        .listSync()
        .whereType<File>()
        .map((f) => f.path)
        .where((path) => p.basename(path).startsWith('sx_${who}_') && path.endsWith('.db'))
        .toList();
  }

  /// Deletes a database and its side files. Used by remote wipe, wrong-PIN wipe and sign-out
  /// with nothing left to sync.
  static void deleteFiles(String path) {
    for (final suffix in ['', '-journal', '-wal', '-shm']) {
      final f = File('$path$suffix');
      if (f.existsSync()) f.deleteSync();
    }
  }

  static void _migrate(Database db) {
    final version = db.select('PRAGMA user_version').first.values.first! as int;
    if (version > schemaVersion) throw StateError('database is newer than this app');
    if (version < 1) {
      db.execute('BEGIN');
      db.execute(_v1);
      db.execute('PRAGMA user_version = 1');
      db.execute('COMMIT');
    }
  }
}

/// Times are UTC epoch milliseconds. JSON columns hold the exact value that was hashed.
const _v1 = '''
-- Every edit made on this phone, as an immutable change entry (module 9 "Change log"). A row is
-- deleted when its receipt confirms it; anything still here is unconfirmed.
CREATE TABLE outbox (
  change_id      TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL UNIQUE,
  entity         TEXT NOT NULL,
  record_id      TEXT NOT NULL,
  op             TEXT NOT NULL CHECK (op IN ('create', 'set', 'append')),
  field          TEXT,
  value_json     TEXT NOT NULL,
  value_hash     TEXT NOT NULL,
  base_version   INTEGER NOT NULL,
  follows        TEXT,
  supersedes     TEXT,
  conflict_of    TEXT,
  resolution     TEXT,
  device_time    INTEGER NOT NULL,
  corrected_time INTEGER,
  clock_verified INTEGER NOT NULL,
  category       TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN ('pending', 'rejected', 'conflict', 'superseded')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  reason         TEXT,
  message        TEXT,
  details_json   TEXT,
  server_json    TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX outbox_state ON outbox (state, seq);
CREATE INDEX outbox_record ON outbox (record_id, field, seq);

-- Records the person works on: made here, or a server copy opened to edit.
CREATE TABLE records (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL,
  status          TEXT NOT NULL,
  author_user_id  TEXT,
  attributes_json TEXT NOT NULL,
  open            INTEGER NOT NULL,
  origin          TEXT NOT NULL CHECK (origin IN ('local', 'server')),
  downloaded_at   INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- What the person sees in each field. server_version is the server version their edits build on;
-- pending_change is the newest local change not yet confirmed (null: the value is on the server).
CREATE TABLE fields (
  record_id      TEXT NOT NULL REFERENCES records (id) ON DELETE CASCADE,
  field          TEXT NOT NULL,
  value_json     TEXT NOT NULL,
  server_version INTEGER NOT NULL,
  pending_change TEXT,
  PRIMARY KEY (record_id, field)
);

-- Changes the server holds for a Program Admin to review (no values, only that they exist).
CREATE TABLE in_review (
  change_id   TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
''';
