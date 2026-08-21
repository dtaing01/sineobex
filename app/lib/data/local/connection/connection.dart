import 'package:drift/drift.dart';

import 'unsupported.dart'
    if (dart.library.ffi) 'native.dart'
    if (dart.library.js_interop) 'web.dart' as impl;

/// Opens the local database for whichever platform this build targets.
///
/// **Mobile/desktop** (`dart:ffi`): SQLCipher, encrypted at rest with a key
/// held in the OS keystore. This is the supported configuration for PHI.
///
/// **Web** (`dart:js_interop`): SQLite compiled to WebAssembly, held **in
/// memory only**. SQLCipher has no web build, and an unencrypted IndexedDB
/// copy of a patient chart sitting in a shared browser profile is not
/// something to ship. So the web build keeps nothing at rest: it is a live
/// view of the API, and closing the tab discards everything. Web is the
/// secondary target and it is deliberately the less capable one.
QueryExecutor openConnection() => impl.openConnection();

/// Whether this platform stores PHI on the device. False on web, which drives
/// the "online only" messaging in the UI.
bool get supportsOfflinePhi => impl.supportsOfflinePhi;
