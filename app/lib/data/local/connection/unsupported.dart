import 'package:drift/drift.dart';

/// Neither `dart:ffi` nor `dart:js_interop` is available. There is no platform
/// Flutter targets where this is reached; it exists so the conditional import
/// has a default.
QueryExecutor openConnection() => throw UnsupportedError(
      'No database implementation is available for this platform.',
    );

bool get supportsOfflinePhi => false;
