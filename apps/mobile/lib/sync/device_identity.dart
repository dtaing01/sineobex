import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import '../security/secure_store.dart';
import 'canonical_json.dart';

/// This phone's identity to the server (module 9, plan §164.312(d)).
///
/// One Ed25519 key per installation, kept in the keystore (this device only, readable while the
/// phone is unlocked, not behind the app's PIN), so a phone can still prove itself after its user
/// was removed and has no valid sign-in: to learn it must wipe, to hand unsynced work to
/// quarantine, and to confirm the wipe. Each user and team gets its own device ID.
class DeviceIdentity {
  DeviceIdentity({required this._store, required this.userId, Random? random, Uuid? uuid})
    : _random = random ?? Random.secure(),
      _uuid = uuid ?? const Uuid(goptions: GlobalOptions(CryptoRNG()));

  final SecureStore _store;
  final String userId;
  final Random _random;
  final Uuid _uuid;
  final _ed25519 = Ed25519();

  static const _seedKey = 'device.key';
  String _deviceKey(String teamId) => 'u:$userId:device:$teamId';
  String _registeredKey(String teamId) => 'u:$userId:device:$teamId:registered';

  Future<SimpleKeyPair> _keyPair() async {
    var seed = await _store.read(_seedKey);
    if (seed == null) {
      seed = base64Encode(Uint8List.fromList(List<int>.generate(32, (_) => _random.nextInt(256))));
      await _store.write(_seedKey, seed);
    }
    return _ed25519.newKeyPairFromSeed(base64Decode(seed));
  }

  /// The ID this phone uses for [teamId], made once.
  Future<String> deviceId(String teamId) async {
    final existing = await _store.read(_deviceKey(teamId));
    if (existing != null) return existing;
    final id = _uuid.v4();
    await _store.write(_deviceKey(teamId), id);
    return id;
  }

  /// The device ID for [teamId] if this phone ever made one.
  Future<String?> existingDeviceId(String teamId) => _store.read(_deviceKey(teamId));

  Future<bool> isRegistered(String teamId) async => await _store.read(_registeredKey(teamId)) == 'true';
  Future<void> markRegistered(String teamId) => _store.write(_registeredKey(teamId), 'true');
  Future<void> clearRegistration(String teamId) => _store.delete(_registeredKey(teamId));

  /// After a wipe the team gets a fresh device ID next time, so the wiped one stays wiped.
  Future<void> forgetTeam(String teamId) async {
    await _store.delete(_deviceKey(teamId));
    await _store.delete(_registeredKey(teamId));
  }

  /// Raw Ed25519 public key, unpadded base64url.
  Future<String> publicKey() async {
    final pk = await (await _keyPair()).extractPublicKey();
    return _b64u(pk.bytes);
  }

  /// Signs the canonical JSON of [payload], as the server verifies it.
  Future<String> sign(Map<String, Object?> payload) async {
    final sig = await _ed25519.sign(utf8.encode(canonicalJson(payload)), keyPair: await _keyPair());
    return _b64u(sig.bytes);
  }

  static String _b64u(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');
}
