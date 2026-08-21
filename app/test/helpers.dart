import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:sineobex/data/local/database.dart';

/// An unencrypted in-memory database for tests.
///
/// Production always goes through `AppDatabase.platform()`, which is
/// SQLCipher-backed. Tests deliberately bypass that: there is no keystore in
/// a test VM, and no test data is real PHI.
AppDatabase testDatabase() => AppDatabase(NativeDatabase.memory());

/// Silences drift's multiple-database warning across test files.
void suppressDriftWarnings() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
}
