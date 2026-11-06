import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
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

  static const schemaVersion = 2;

  /// The oldest SQLite whose FTS5 has the `secure-delete` option (3.42). Without it a deleted
  /// name's trigrams stay in the search table's segments on disk (D29), so v2 refuses to run.
  static const minSqlite = [3, 42, 0];

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
      migrate(db);
      _requireSecureDelete(db);
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
        .toList()
      ..sort();
  }

  /// Deletes a database and its side files. Used by remote wipe, wrong-PIN wipe and sign-out
  /// with nothing left to sync.
  static void deleteFiles(String path) {
    for (final suffix in ['', '-journal', '-wal', '-shm']) {
      final f = File('$path$suffix');
      if (f.existsSync()) f.deleteSync();
    }
  }

  /// Brings the file to [target] (the app's [schemaVersion]), each step in one transaction with
  /// its version, so a phone holding phase 2 work keeps it whatever stops the upgrade.
  /// [sqliteVersion] stands in for the library's own in tests.
  @visibleForTesting
  static void migrate(Database db, {int target = schemaVersion, String? sqliteVersion}) {
    final version = db.select('PRAGMA user_version').first.values.first! as int;
    if (version > schemaVersion) throw StateError('database is newer than this app');
    if (version < 1 && target >= 1) _step(db, _v1, 1);
    if (version < 2 && target >= 2) {
      final sqlite = sqliteVersion ?? db.select('SELECT sqlite_version() AS v').first['v']! as String;
      if (!supportsSecureDelete(sqlite)) {
        throw StateError('SQLite $sqlite can’t securely delete search rows; 3.42 or newer is needed');
      }
      _step(db, _v2, 2);
    }
  }

  static void _step(Database db, String sql, int version) {
    db.execute('BEGIN');
    try {
      db.execute(sql);
      db.execute('PRAGMA user_version = $version');
      db.execute('COMMIT');
    } catch (_) {
      db.execute('ROLLBACK');
      rethrow;
    }
  }

  /// Whether [version] ("3.45.1") is at least [minSqlite].
  static bool supportsSecureDelete(String version) {
    final parts = version.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    for (var i = 0; i < minSqlite.length; i++) {
      final have = i < parts.length ? parts[i] : 0;
      if (have != minSqlite[i]) return have > minSqlite[i];
    }
    return true;
  }

  /// The option is stored in the table itself and survives restarts; checked at every open so a
  /// file that somehow lost it never deletes a name only from the page tree.
  static void _requireSecureDelete(Database db) {
    final on = db.select("SELECT v FROM patient_names_config WHERE k = 'secure-delete'").firstOrNull?['v'];
    if (on != 1) db.execute("INSERT INTO patient_names (patient_names, rank) VALUES ('secure-delete', 1)");
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

/// Phase 3 (patients), additive: a phase 2 file keeps every row.
const _v2 = '''
-- Patient-side records: the patient each belongs to (its own ID for a patient), which decides when
-- a cached chart may go (design 2.9-6).
ALTER TABLE records ADD COLUMN patient_id TEXT;
CREATE INDEX records_patient ON records (patient_id);

-- The patient a change is work on, so that patient's chart stays while it waits. Phase 2 changes
-- name one only through an encounter.
ALTER TABLE outbox ADD COLUMN patient_id TEXT;
CREATE INDEX outbox_patient ON outbox (patient_id);
UPDATE outbox SET patient_id = json_extract(value_json, '\$.patientId')
  WHERE entity = 'encounter' AND op = 'create' AND json_type(value_json, '\$.patientId') = 'text';
UPDATE outbox SET patient_id = json_extract(value_json, '\$')
  WHERE entity = 'encounter' AND op = 'set' AND field = 'patientId' AND json_type(value_json) = 'text';

-- Why a server copy of a chart may stay on this phone (section 7): charts a person opened or
-- worked on, and in phase 7 their route. Local work keeps a chart too, without a row here.
CREATE TABLE cache_scopes (
  patient_id TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('opened', 'route')),
  ref        TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (patient_id, kind, ref)
);
CREATE INDEX cache_scopes_expiry ON cache_scopes (expires_at);

-- Merged patients this phone knows of. Never rewrites the outbox. The server's lists are
-- authoritative (D27): the index swap and each chart bundle replace the rows they cover, whatever
-- their origin; 'receipt' rows are provisional hints until then.
CREATE TABLE patient_redirects (
  merged_id   TEXT PRIMARY KEY,
  survivor_id TEXT NOT NULL,
  merged_at   INTEGER,
  origin      TEXT NOT NULL CHECK (origin IN ('index', 'chart', 'receipt'))
);

-- The team search index (section 6): server data, replaced whole, never a legal name (D40).
CREATE TABLE team_index (
  patient_id TEXT PRIMARY KEY,
  entry_json TEXT NOT NULL,
  preferred  TEXT,
  birth_year INTEGER,
  birth_date TEXT,
  last_seen  TEXT
);
CREATE INDEX team_index_birth ON team_index (birth_year);
CREATE TABLE team_index_staging (
  after        TEXT PRIMARY KEY,
  version      TEXT NOT NULL,
  entries_json TEXT NOT NULL,
  staged_at    INTEGER NOT NULL
);

-- Names for fuzzy search, normalized: the index's, cached charts' and patients made here. source is
-- 'preferred', 'alias' or 'descriptor', never a legal name or anything derived from one (D40).
-- Rows of origin 'cache' and 'local' go with their chart.
CREATE VIRTUAL TABLE patient_names USING fts5(
  name, patient_id UNINDEXED, source UNINDEXED, origin UNINDEXED, tokenize = 'trigram'
);
-- PRAGMA secure_delete doesn't reach FTS5 segments: a deleted row's trigrams stay in
-- patient_names_data until this option is on (D29).
INSERT INTO patient_names (patient_names, rank) VALUES ('secure-delete', 1);

-- ID links made or known here (10.5). Deleted with their chart, tokens included.
CREATE TABLE id_links (
  id           TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL,
  token        TEXT,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'active', 'retired', 'blocked', 'rejected')),
  replaces     TEXT,
  change_id    TEXT,
  effective_at INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX id_links_patient ON id_links (patient_id);

-- Things to tell the person that are not rejections (kept both, a possible duplicate, a card's
-- outcome). Kinds, fields and IDs only.
CREATE TABLE local_notices (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  patient_id TEXT,
  record_id  TEXT,
  field      TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
''';
