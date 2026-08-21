import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Generates and stores the SQLCipher passphrase.
///
/// The key lives in the iOS Keychain / Android Keystore-backed
/// EncryptedSharedPreferences — never in the app bundle, never in source, and
/// never written to the database file it protects.
class DbKey {
  const DbKey._();

  static const _storageKey = 'sineobex.db.key.v1';

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  /// Returns the existing key, or generates one on first launch.
  static Future<String> obtain() async {
    final existing = await _storage.read(key: _storageKey);
    if (existing != null && existing.isNotEmpty) return existing;

    final generated = _generate();
    await _storage.write(key: _storageKey, value: generated);
    return generated;
  }

  /// Destroys the key, rendering the encrypted database unreadable. Used as
  /// the crypto-erase half of a remote wipe.
  static Future<void> destroy() => _storage.delete(key: _storageKey);

  static String _generate() {
    final rng = Random.secure();
    final bytes = List<int>.generate(32, (_) => rng.nextInt(256));
    return base64UrlEncode(bytes);
  }
}
