import 'package:drift/drift.dart';
import 'package:drift/wasm.dart';
import 'package:sqlite3/wasm.dart';
import 'package:flutter/foundation.dart';

/// In-memory SQLite-on-WebAssembly for the secondary web target.
///
/// Nothing is persisted. The database lives in the tab's heap, so no patient
/// data is written to IndexedDB, OPFS, or localStorage, and it is gone when
/// the tab closes. That is intentional: SQLCipher has no web build, and an
/// unencrypted browser-side copy of a chart is a worse outcome than
/// re-fetching from the API.
QueryExecutor openConnection() {
  return LazyDatabase(() async {
    final sqlite3 = await WasmSqlite3.loadFromUrl(Uri.parse('sqlite3.wasm'));
    sqlite3.registerVirtualFileSystem(InMemoryFileSystem(), makeDefault: true);
    if (kDebugMode) {
      debugPrint('Web build: in-memory database, no PHI stored at rest.');
    }
    return WasmDatabase.inMemory(sqlite3);
  });
}

bool get supportsOfflinePhi => false;
