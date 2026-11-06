import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'secure_store.dart';

/// Holds each user's database key on this phone (module 9, "Data at rest").
///
/// - The key is 256 random bits, made on the phone, one per user, never sent anywhere.
/// - At rest it exists only wrapped: under a key derived from the user's PIN (AES-256-GCM over
///   PBKDF2-HMAC-SHA256), in the platform keystore marked this-device-only; and optionally as a
///   second copy in a keystore item the OS releases only after a biometric check.
/// - Ten wrong PINs in a row destroy both copies, which makes the local data unreadable before
///   anyone deletes it (module 9: "10 wrong PIN attempts destroy the key on the phone itself").
class KeyVault {
  KeyVault({
    required this._store,
    required SecureStore biometricStore,
    Random? random,
    this.pbkdf2Iterations = defaultIterations,
  }) : _bio = biometricStore,
       _random = random ?? Random.secure();

  /// PBKDF2 work factor. The wrapped key sits in the keystore, so an attacker must first defeat
  /// the platform's own protection; this slows a brute force after that. Tests lower it.
  static const defaultIterations = 120000;
  static const maxPinFailures = 10;
  static const minPinLength = 6;

  final SecureStore _store;
  final SecureStore _bio;
  final Random _random;
  final int pbkdf2Iterations;
  final _aes = AesGcm.with256bits();

  String _k(String userId, String name) => 'u:$userId:$name';

  Future<bool> hasVault(String userId) async => await _store.read(_k(userId, 'dbkey.pin')) != null;

  Future<bool> hasBiometric(String userId) async => await _store.read(_k(userId, 'bio.enabled')) == 'true';

  Future<int> failures(String userId) async => int.tryParse(await _store.read(_k(userId, 'pin.failures')) ?? '') ?? 0;

  /// Rules for a PIN people can remember but strangers can't guess quickly.
  static String? pinProblem(String pin) {
    if (!RegExp(r'^\d+$').hasMatch(pin)) return 'Use digits only.';
    if (pin.length < minPinLength) return 'Use at least $minPinLength digits.';
    if (RegExp(r'^(\d)\1+$').hasMatch(pin)) return 'Don’t repeat one digit.';
    const ascending = '01234567890';
    const descending = '09876543210';
    if (ascending.contains(pin) || descending.contains(pin)) return 'Don’t use a sequence like 123456.';
    return null;
  }

  Uint8List _randomBytes(int n) => Uint8List.fromList(List<int>.generate(n, (_) => _random.nextInt(256)));

  Future<SecretKey> _kek(String pin, List<int> salt) => Pbkdf2(
    macAlgorithm: Hmac.sha256(),
    iterations: pbkdf2Iterations,
    bits: 256,
  ).deriveKey(secretKey: SecretKey(utf8.encode(pin)), nonce: salt);

  Future<String> _wrap(List<int> dbKey, String pin) async {
    final salt = _randomBytes(16);
    final box = await _aes.encrypt(dbKey, secretKey: await _kek(pin, salt));
    return jsonEncode({
      'v': 1,
      'kdf': 'pbkdf2-sha256',
      'iter': pbkdf2Iterations,
      'salt': base64Encode(salt),
      'nonce': base64Encode(box.nonce),
      'ct': base64Encode(box.cipherText),
      'mac': base64Encode(box.mac.bytes),
    });
  }

  /// Creates the user's database key, wrapped under [pin]. Returns the key for this session.
  Future<Uint8List> create(String userId, String pin) async {
    final problem = pinProblem(pin);
    if (problem != null) throw ArgumentError(problem);
    if (await hasVault(userId)) throw StateError('vault already exists');
    final dbKey = _randomBytes(32);
    await _store.write(_k(userId, 'dbkey.pin'), await _wrap(dbKey, pin));
    await _store.write(_k(userId, 'pin.failures'), '0');
    return dbKey;
  }

  /// Unlocks with the PIN. Throws [WrongPin] (with attempts left) or [VaultWiped].
  Future<Uint8List> unlockWithPin(String userId, String pin) async {
    final wrapped = await _store.read(_k(userId, 'dbkey.pin'));
    if (wrapped == null) throw const VaultWiped();
    // Count the attempt before trying it, so killing the app mid-attempt can't skip the count.
    final attempt = await failures(userId) + 1;
    await _store.write(_k(userId, 'pin.failures'), '$attempt');
    final j = jsonDecode(wrapped) as Map<String, Object?>;
    final iterations = (j['iter'] as num).toInt();
    final kek = await Pbkdf2(
      macAlgorithm: Hmac.sha256(),
      iterations: iterations,
      bits: 256,
    ).deriveKey(secretKey: SecretKey(utf8.encode(pin)), nonce: base64Decode(j['salt'] as String));
    try {
      final key = await _aes.decrypt(
        SecretBox(
          base64Decode(j['ct'] as String),
          nonce: base64Decode(j['nonce'] as String),
          mac: Mac(base64Decode(j['mac'] as String)),
        ),
        secretKey: kek,
      );
      await _store.write(_k(userId, 'pin.failures'), '0');
      return Uint8List.fromList(key);
    } on SecretBoxAuthenticationError {
      if (attempt >= maxPinFailures) {
        await destroy(userId);
        throw const VaultWiped();
      }
      throw WrongPin(maxPinFailures - attempt);
    }
  }

  /// Stores a second copy of the key behind the OS biometric gate.
  Future<void> enableBiometric(String userId, List<int> dbKey) async {
    await _bio.write(_k(userId, 'dbkey.bio'), base64Encode(dbKey));
    await _store.write(_k(userId, 'bio.enabled'), 'true');
  }

  Future<void> disableBiometric(String userId) async {
    await _bio.delete(_k(userId, 'dbkey.bio'));
    await _store.delete(_k(userId, 'bio.enabled'));
  }

  /// Asks the OS for the biometric copy. Null when cancelled, unavailable or invalidated (for
  /// example after a new fingerprint was enrolled); the PIN still works.
  Future<Uint8List?> unlockWithBiometric(String userId) async {
    try {
      final v = await _bio.read(_k(userId, 'dbkey.bio'));
      if (v == null) return null;
      await _store.write(_k(userId, 'pin.failures'), '0');
      return base64Decode(v);
    } catch (_) {
      return null;
    }
  }

  Future<void> changePin(String userId, String oldPin, String newPin) async {
    final problem = pinProblem(newPin);
    if (problem != null) throw ArgumentError(problem);
    final key = await unlockWithPin(userId, oldPin);
    await _store.write(_k(userId, 'dbkey.pin'), await _wrap(key, newPin));
  }

  /// Destroys every copy of the user's key. Remote wipe and the tenth wrong PIN end here.
  Future<void> destroy(String userId) async {
    await _store.delete(_k(userId, 'dbkey.pin'));
    await _store.delete(_k(userId, 'pin.failures'));
    await _store.delete(_k(userId, 'bio.enabled'));
    try {
      await _bio.delete(_k(userId, 'dbkey.bio'));
    } catch (_) {
      // The biometric item may already be invalid; deleting the PIN copy is what matters.
    }
  }

  /// Encrypts a small secret (the refresh token) with the database key, so it is usable only
  /// after the app is unlocked, not merely while the phone is.
  Future<String> seal(List<int> dbKey, String plaintext) async {
    final box = await _aes.encrypt(utf8.encode(plaintext), secretKey: SecretKey(dbKey));
    return base64Encode(box.concatenation());
  }

  Future<String> open(List<int> dbKey, String sealed) async {
    final box = SecretBox.fromConcatenation(base64Decode(sealed), nonceLength: 12, macLength: 16);
    return utf8.decode(await _aes.decrypt(box, secretKey: SecretKey(dbKey)));
  }
}

class WrongPin implements Exception {
  const WrongPin(this.attemptsLeft);
  final int attemptsLeft;
}

class VaultWiped implements Exception {
  const VaultWiped();
}
