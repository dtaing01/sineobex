import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Key-value storage in the platform keystore. Two instances exist: one for ordinary secrets and
/// one whose items the OS releases only after a biometric check (see [biometricSecureStore]).
abstract interface class SecureStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
  Future<Map<String, String>> readAll();
}

class PlatformSecureStore implements SecureStore {
  PlatformSecureStore(this._storage);
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);
  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: key);
  @override
  Future<Map<String, String>> readAll() => _storage.readAll();
}

/// Ordinary secrets: readable only while the phone itself is unlocked, never synced to iCloud or
/// Google backups, never restored to another device (module 9: "marked this-device-only").
SecureStore deviceSecureStore() => PlatformSecureStore(
  const FlutterSecureStorage(
    aOptions: AndroidOptions(),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.unlocked_this_device, synchronizable: false),
  ),
);

/// Items here are released by the OS only after a biometric check against the biometrics enrolled
/// now; enrolling a new fingerprint or face invalidates them. The check happens in the Secure
/// Enclave or the Android Keystore, not in app code.
SecureStore biometricSecureStore() => PlatformSecureStore(
  const FlutterSecureStorage(
    // Separate namespace and service, so reading ordinary secrets never triggers a prompt and
    // the two cipher setups never share a preferences file.
    aOptions: AndroidOptions.biometric(
      enforceBiometrics: true,
      requireBiometricsPerOperation: true,
      storageNamespace: 'sineobex_biometric',
      biometricPromptTitle: 'Unlock Sineobex',
      biometricPromptSubtitle: 'Confirm it is you to open patient records',
    ),
    iOptions: IOSOptions(
      accountName: 'org.sineobex.field.biometric',
      accessibility: KeychainAccessibility.passcode,
      synchronizable: false,
      accessControlFlags: [AccessControlFlag.biometryCurrentSet],
    ),
  ),
);

/// In-memory store for tests.
class MemorySecureStore implements SecureStore {
  final Map<String, String> values = {};
  bool failReads = false;

  @override
  Future<String?> read(String key) async {
    if (failReads) throw StateError('biometric check cancelled');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
  @override
  Future<Map<String, String>> readAll() async => Map.of(values);
}
