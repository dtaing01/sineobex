import 'package:flutter/services.dart';

/// The app's own native code (android MainActivity.kt, ios AppDelegate.swift).
const deviceChannel = MethodChannel('org.sineobex.field/device');

/// Keeps a directory out of iCloud and iTunes backups (module 9: "Excluded from device backups").
/// Application Support is backed up by default on iOS; Caches is not, but the system may empty it
/// when storage runs low, which would lose unsynced records. Android needs nothing here: the
/// manifest sets allowBackup="false" and the data extraction rules exclude every domain.
///
/// Returns false when the system refused. The app carries on: a backed-up copy is SQLCipher
/// ciphertext whose key never leaves this phone's keychain (this-device-only), while refusing to
/// open the database would stop offline charting altogether. It is tried again at every open.
Future<bool> excludeFromBackup(String path) async {
  try {
    await deviceChannel.invokeMethod<void>('excludeFromBackup', {'path': path});
    return true;
  } on MissingPluginException {
    return true; // Tests and desktop builds.
  } on PlatformException {
    return false;
  }
}
