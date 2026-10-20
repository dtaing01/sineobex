import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../security/key_vault.dart';
import '../security/secure_store.dart';
import 'auth_provider.dart';

/// A team the signed-in person belongs to, as /v1/me reports it.
@immutable
class TeamRef {
  const TeamRef({
    required this.id,
    required this.name,
    required this.roleName,
    required this.credential,
    required this.permissions,
  });

  factory TeamRef.fromJson(Map<String, Object?> j) => TeamRef(
    id: j['id'] as String,
    name: j['name'] as String,
    roleName: j['roleName'] as String,
    credential: j['credential'] as String,
    permissions: (j['permissions'] as List<Object?>).cast<String>(),
  );

  final String id;
  final String name;
  final String roleName;
  final String credential;
  final List<String> permissions;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'roleName': roleName,
    'credential': credential,
    'permissions': permissions,
  };
}

/// The person using this phone. Stored in the keystore so the lock screen can greet them offline.
@immutable
class LocalUser {
  const LocalUser({
    required this.userId,
    required this.email,
    required this.displayName,
    required this.teams,
    this.teamId,
  });

  factory LocalUser.fromJson(Map<String, Object?> j) => LocalUser(
    userId: j['userId'] as String,
    email: j['email'] as String,
    displayName: j['displayName'] as String,
    teams: (j['teams'] as List<Object?>).map((t) => TeamRef.fromJson(t! as Map<String, Object?>)).toList(),
    teamId: j['teamId'] as String?,
  );

  final String userId;
  final String email;
  final String displayName;
  final List<TeamRef> teams;
  final String? teamId;

  TeamRef? get team => teams.where((t) => t.id == teamId).firstOrNull;

  LocalUser withTeam(String? id) =>
      LocalUser(userId: userId, email: email, displayName: displayName, teams: teams, teamId: id);

  Map<String, Object?> toJson() => {
    'userId': userId,
    'email': email,
    'displayName': displayName,
    'teams': teams.map((t) => t.toJson()).toList(),
    'teamId': teamId,
  };
}

/// What the app should show. The router follows this.
sealed class SessionState {
  const SessionState();
}

class Starting extends SessionState {
  const Starting();
}

class SignedOut extends SessionState {
  const SignedOut({this.notice});
  final String? notice;
}

class AwaitingMfa extends SessionState {
  const AwaitingMfa({required this.email});
  final String email;
}

class AwaitingEnrollment extends SessionState {
  const AwaitingEnrollment({required this.email, this.enrollment});
  final String email;
  final Enrollment? enrollment;
}

class NeedsPin extends SessionState {
  const NeedsPin(this.user);
  final LocalUser user;
}

class Locked extends SessionState {
  const Locked(this.user, {required this.attemptsLeft, required this.biometric});
  final LocalUser user;
  final int attemptsLeft;
  final bool biometric;
}

class Unlocked extends SessionState {
  const Unlocked(this.user, {required this.biometric});
  final LocalUser user;
  final bool biometric;
}

/// Loads the signed-in person and their teams with a fresh access token.
typedef FetchMe = Future<LocalUser> Function(String accessToken);

/// The encrypted records this phone holds for a user, in one database per team (module 9). The
/// session asks before it forgets anyone, because only a remote wipe may delete what the server
/// hasn't confirmed: "Log out anyway never deletes the unsynced data."
abstract interface class LocalData {
  /// Whether any of the user's team databases is on this phone.
  Future<bool> hasAny(String userId);

  /// Changes the server hasn't confirmed, across every team database the user has here, read
  /// with [key]. Null when a database can't be read, which must count as unsynced.
  Future<int?> unsynced(String userId, Uint8List key);

  /// Deletes every database the user has here.
  Future<void> erase(String userId);
}

/// [LocalData] found when first used, for an owner created after the session (the sync
/// controller, which itself listens to the session).
class DeferredLocalData implements LocalData {
  DeferredLocalData(this._find);
  final LocalData Function() _find;

  @override
  Future<bool> hasAny(String userId) => _find().hasAny(userId);

  @override
  Future<int?> unsynced(String userId, Uint8List key) => _find().unsynced(userId, key);

  @override
  Future<void> erase(String userId) => _find().erase(userId);
}

/// Sign-in, PIN setup, lock and unlock (module 1 "Offline sign-in", module 9 "Device security").
///
/// Cognito and Supabase access tokens last about an hour, so the phone unlocks locally with a PIN
/// or biometric while offline, and renews its session with the refresh token when it can. The
/// refresh token is sealed with the user's database key, so it is usable only after the app is
/// unlocked, not merely while the phone is.
class SessionController extends ChangeNotifier {
  SessionController({
    required this.auth,
    required this.vault,
    required this.store,
    required this.fetchMe,
    this.localData,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final AuthProvider auth;
  final KeyVault vault;
  final SecureStore store;
  final FetchMe fetchMe;

  /// The user's databases on this phone. Erased when the user is forgotten here: a sign-out or
  /// wipe that leaves nothing unsynced behind, or the tenth wrong PIN (whose key is gone).
  final LocalData? localData;
  final DateTime Function() _now;

  SessionState _state = const Starting();
  SessionState get state => _state;

  // Only ever in memory, and only while unlocked (or mid sign-in).
  Uint8List? _dbKey;
  Tokens? _tokens;
  String? _factorId;
  Tokens? _pendingTokens;
  String? _pendingEmail;
  LocalUser? _pendingUser;

  Uint8List? get databaseKey => _dbKey;

  void _set(SessionState s) {
    _state = s;
    notifyListeners();
  }

  static const _current = 'current.user';
  String _k(String userId, String name) => 'u:$userId:$name';

  Future<void> start() async {
    final userId = await store.read(_current);
    if (userId == null) return _set(const SignedOut());
    final profile = await store.read(_k(userId, 'profile'));
    if (profile == null || !await vault.hasVault(userId)) return _set(const SignedOut());
    final user = LocalUser.fromJson(jsonDecode(profile) as Map<String, Object?>);
    await _toLocked(user);
  }

  Future<void> _toLocked(LocalUser user) async {
    _set(
      Locked(
        user,
        attemptsLeft: KeyVault.maxPinFailures - await vault.failures(user.userId),
        biometric: await vault.hasBiometric(user.userId),
      ),
    );
  }

  Future<void> signIn(String email, String password) async {
    final normalized = email.trim().toLowerCase();
    final result = await auth.signIn(normalized, password);
    _pendingTokens = result.tokens;
    _pendingEmail = normalized;
    switch (result) {
      case MfaChallenge(:final factorId):
        _factorId = factorId;
        _set(AwaitingMfa(email: normalized));
      case MfaEnrollment():
        _set(AwaitingEnrollment(email: normalized));
    }
  }

  Future<void> beginEnrollment() async {
    final pending = _pendingTokens;
    if (pending == null) return _set(const SignedOut());
    final enrollment = await auth.startEnrollment(pending);
    _factorId = enrollment.factorId;
    _set(AwaitingEnrollment(email: _pendingEmail!, enrollment: enrollment));
  }

  /// Proves the authenticator code. Then either sets up a PIN (first time on this phone) or asks
  /// for the existing PIN, so a fresh sign-in never bypasses the lock on data already here.
  Future<void> verifyCode(String code) async {
    final pending = _pendingTokens;
    final factorId = _factorId;
    if (pending == null || factorId == null) return _set(const SignedOut());
    final tokens = await auth.verifyMfa(pending, factorId, code);
    final user = await fetchMe(tokens.accessToken);
    final withTeam = user.teams.length == 1 ? user.withTeam(user.teams.first.id) : user;
    _pendingTokens = tokens;
    _pendingUser = withTeam;
    if (await vault.hasVault(user.userId)) {
      await store.write(_current, user.userId);
      await _toLocked(withTeam);
    } else {
      _set(NeedsPin(withTeam));
    }
  }

  Future<void> setPin(String pin) async {
    final user = _pendingUser;
    final tokens = _pendingTokens;
    if (user == null || tokens == null) return _set(const SignedOut());
    final key = await vault.create(user.userId, pin);
    await _adopt(user, key, tokens);
    _set(Unlocked(user, biometric: false));
  }

  Future<void> _adopt(LocalUser user, Uint8List key, Tokens tokens) async {
    _dbKey = key;
    _tokens = tokens;
    await store.write(_current, user.userId);
    await store.write(_k(user.userId, 'profile'), jsonEncode(user.toJson()));
    await store.write(_k(user.userId, 'refresh'), await vault.seal(key, tokens.refreshToken));
    if (_factorId != null) await store.write(_k(user.userId, 'factor'), _factorId!);
    _pendingTokens = null;
    _pendingUser = null;
    _pendingEmail = null;
  }

  Future<void> _afterUnlock(LocalUser user, Uint8List key) async {
    _dbKey = key;
    final pending = _pendingTokens;
    final pendingUser = _pendingUser;
    if (pending != null && pendingUser != null) {
      await _adopt(pendingUser, key, pending);
      user = pendingUser;
    } else {
      _factorId = await store.read(_k(user.userId, 'factor'));
    }
    _set(Unlocked(user, biometric: await vault.hasBiometric(user.userId)));
  }

  /// Throws [WrongPin]; on [VaultWiped] the phone forgets the user and shows why.
  Future<void> unlockWithPin(String pin) async {
    final s = _state;
    if (s is! Locked) return;
    try {
      final key = await vault.unlockWithPin(s.user.userId, pin);
      await _afterUnlock(s.user, key);
    } on WrongPin catch (e) {
      _set(Locked(s.user, attemptsLeft: e.attemptsLeft, biometric: s.biometric));
      rethrow;
    } on VaultWiped {
      await _forget(s.user.userId);
      _set(const SignedOut(notice: 'Too many wrong PINs. The data on this phone was erased. Sign in again.'));
    }
  }

  /// Returns false when the person cancelled or biometrics changed; the PIN still works.
  Future<bool> unlockWithBiometric() async {
    final s = _state;
    if (s is! Locked) return false;
    final key = await vault.unlockWithBiometric(s.user.userId);
    if (key == null) return false;
    await _afterUnlock(s.user, key);
    return true;
  }

  Future<void> enableBiometric() async {
    final s = _state;
    if (s is! Unlocked || _dbKey == null) return;
    await vault.enableBiometric(s.user.userId, _dbKey!);
    _set(Unlocked(s.user, biometric: true));
  }

  Future<void> disableBiometric() async {
    final s = _state;
    if (s is! Unlocked) return;
    await vault.disableBiometric(s.user.userId);
    _set(Unlocked(s.user, biometric: false));
  }

  /// [teamId] null goes back to the team picker.
  Future<void> selectTeam(String? teamId) async {
    final s = _state;
    if (s is! Unlocked) return;
    if (teamId != null && !s.user.teams.any((t) => t.id == teamId)) return;
    final user = s.user.withTeam(teamId);
    await store.write(_k(user.userId, 'profile'), jsonEncode(user.toJson()));
    _set(Unlocked(user, biometric: s.biometric));
  }

  /// Forgets a team this person no longer has access to (removed while offline, or wiped), so
  /// the team picker stops offering it.
  Future<void> dropTeam(String teamId) async {
    final s = _state;
    final user = switch (s) {
      Unlocked(:final user) || Locked(:final user) => user,
      _ => null,
    };
    if (user == null) return;
    final remaining = user.teams.where((t) => t.id != teamId).toList();
    final next = LocalUser(
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      teams: remaining,
      teamId: user.teamId == teamId ? (remaining.length == 1 ? remaining.first.id : null) : user.teamId,
    );
    await store.write(_k(user.userId, 'profile'), jsonEncode(next.toJson()));
    _set(switch (s) {
      Unlocked(:final biometric) => Unlocked(next, biometric: biometric),
      Locked(:final attemptsLeft, :final biometric) => Locked(next, attemptsLeft: attemptsLeft, biometric: biometric),
      _ => s,
    });
  }

  /// Drops the database key and tokens from memory. Idle timeout and backgrounding call this.
  Future<void> lock() async {
    final s = _state;
    if (s is! Unlocked) return;
    _dbKey = null;
    _tokens = null;
    await _toLocked(s.user);
  }

  /// A valid access token, refreshed with the sealed refresh token when it is close to expiry.
  /// Throws [AuthException] when offline or when the provider ended the session.
  Future<String> accessToken() async {
    final s = _state;
    if (s is! Unlocked || _dbKey == null) throw const AuthException(AuthErrorCode.sessionExpired, 'Unlock first.');
    final current = _tokens;
    if (current != null && current.expiresAt.isAfter(_now().add(const Duration(seconds: 60)))) {
      return current.accessToken;
    }
    final sealed = await store.read(_k(s.user.userId, 'refresh'));
    if (sealed == null) throw const AuthException(AuthErrorCode.sessionExpired, 'Sign in again.');
    final refreshed = await auth.refresh(await vault.open(_dbKey!, sealed));
    _tokens = refreshed;
    await store.write(_k(s.user.userId, 'refresh'), await vault.seal(_dbKey!, refreshed.refreshToken));
    return refreshed.accessToken;
  }

  /// Signs out of the provider. The user is forgotten on this phone, and their local data
  /// erased, only when every team database is known to hold nothing unsynced. Otherwise, or with
  /// [keepUnsynced] (module 9: "Log out anyway never deletes the unsynced data"), the PIN-wrapped
  /// key and the encrypted databases stay, locked to this user: signing in again here asks for
  /// the same PIN and syncing finishes. Nobody else who signs in here can read them.
  ///
  /// From the lock screen the databases can't be read (the key is not in memory), so whatever
  /// is on the phone stays.
  Future<void> signOut({bool keepUnsynced = false}) async {
    final s = _state;
    final tokens = _tokens;
    if (tokens != null) await auth.signOut(tokens);
    final userId = switch (s) {
      Unlocked(:final user) || Locked(:final user) => user.userId,
      _ => await store.read(_current),
    };
    var kept = false;
    if (userId != null) {
      if (!keepUnsynced && await _nothingUnsynced(userId)) {
        await _forget(userId);
      } else {
        await _forgetSession(userId);
        kept = await localData?.hasAny(userId) ?? false;
      }
    }
    _clearMemory();
    _set(
      SignedOut(
        notice: kept
            ? 'You have signed out. Records that haven’t synced stay encrypted on this phone and finish syncing when you sign in again.'
            : 'You have signed out.',
      ),
    );
  }

  /// After a remote wipe or removal from the last team. The wiped team's database is already
  /// gone; the user is forgotten here unless another database of theirs still holds unsynced
  /// work (a team dropped while offline), which keeps its key like a sign-out would.
  Future<void> endAfterWipe(String notice) async {
    final userId = switch (_state) {
      Unlocked(:final user) || Locked(:final user) => user.userId,
      _ => await store.read(_current),
    };
    if (userId != null) {
      if (await _nothingUnsynced(userId)) {
        await _forget(userId);
      } else {
        await _forgetSession(userId);
      }
    }
    _clearMemory();
    _set(SignedOut(notice: notice));
  }

  /// True only when nothing on this phone could be lost by erasing the user's data: no database
  /// at all, or every one read with the key in memory and fully synced.
  Future<bool> _nothingUnsynced(String userId) async {
    final data = localData;
    if (data == null || !await data.hasAny(userId)) return true;
    final key = _dbKey;
    if (key == null) return false;
    return await data.unsynced(userId, key) == 0;
  }

  void _clearMemory() {
    _dbKey = null;
    _tokens = null;
    _pendingTokens = null;
    _pendingUser = null;
  }

  Future<void> _forget(String userId) async {
    await vault.destroy(userId);
    await localData?.erase(userId);
    await _forgetSession(userId);
  }

  /// Forgets the sign-in (tokens, profile) but not the key or the data.
  Future<void> _forgetSession(String userId) async {
    for (final name in ['profile', 'refresh', 'factor']) {
      await store.delete(_k(userId, name));
    }
    if (await store.read(_current) == userId) await store.delete(_current);
  }

  /// Back to the start of sign-in (for "Use a different account").
  void restartSignIn() {
    _pendingTokens = null;
    _pendingUser = null;
    _pendingEmail = null;
    _set(const SignedOut());
  }
}
