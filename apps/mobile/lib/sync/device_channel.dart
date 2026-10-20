import 'package:flutter/services.dart';

/// The app's own native code (android MainActivity.kt, ios AppDelegate.swift).
const deviceChannel = MethodChannel('org.sineobex.field/device');

/// Keeps a directory out of iCloud and iTunes backups (module 9: "Excluded from device backups").
/// Application Support is backed up by default on iOS; Caches is not, but the system may empty it
/// when storage runs low, which would lose unsynced records. Android needs nothing here: the
/// manifest sets allowBackup="false" and the data extraction rules exclude every domain.
Future<void> excludeFromBackup(String path) async {
  try {
    await deviceChannel.invokeMethod<void>('excludeFromBackup', {'path': path});
  } on MissingPluginException {
    // Tests and desktop builds.
  }
}
