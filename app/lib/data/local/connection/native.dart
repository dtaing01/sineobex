import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlcipher_flutter_libs/sqlcipher_flutter_libs.dart';
import 'package:sqlite3/open.dart';

import '../../../core/security/db_key.dart';

/// SQLCipher-backed storage for iOS, Android, and desktop.
QueryExecutor openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'sineobex.db'));

    if (Platform.isAndroid) {
      await applyWorkaroundToOpenSqlCipherOnOldAndroidVersions();
    }
    open.overrideFor(OperatingSystem.android, openCipherOnAndroid);

    final key = await DbKey.obtain();

    return NativeDatabase.createInBackground(
      file,
      isolateSetup: () async {
        open.overrideFor(OperatingSystem.android, openCipherOnAndroid);
      },
      setup: (db) {
        // Must run before any other statement touches the database.
        final escaped = key.replaceAll("'", "''");
        db.execute("PRAGMA key = '$escaped';");

        final cipher = db.select('PRAGMA cipher_version;');
        if (cipher.isEmpty) {
          throw StateError(
            'SQLCipher is not active — refusing to store PHI in a plaintext '
            'database. Check that sqlcipher_flutter_libs is linked.',
          );
        }
        db.execute('PRAGMA foreign_keys = ON;');
        if (kDebugMode) {
          debugPrint('SQLCipher ${cipher.first.values.first} active');
        }
      },
    );
  });
}

bool get supportsOfflinePhi => true;
