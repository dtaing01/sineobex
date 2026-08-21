import 'dart:async';

import 'package:amazon_cognito_identity_dart_2/cognito.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../app/providers.dart';
import '../../core/env/app_config.dart';
import '../../core/security/db_key.dart';
import '../../data/models/models.dart';
import '../../data/repositories/audit_log.dart';

enum SessionState {
  /// Checking for a stored session on launch.
  restoring,

  /// No valid session — show the sign-in screen.
  signedOut,

  /// Signed in and unlocked.
  active,

  /// Signed in but locked by inactivity; needs biometric or password re-auth.
  locked,

  /// Cognito requires a new password before the account can be used.
  newPasswordRequired,
}

class Session {
  const Session({required this.state, this.user, this.error});

  final SessionState state;
  final AppUser? user;
  final String? error;

  Session copyWith({SessionState? state, AppUser? user, String? error}) =>
      Session(
        state: state ?? this.state,
        user: user ?? this.user,
        error: error,
      );
}

/// Cognito-backed authentication with an inactivity lock.
///
/// The prototype had no authentication at all — it hardcoded
/// `{ name: 'Sarah Chen, RN', isAdmin: true }`. For a system holding real PHI
/// that is not a gap to port faithfully, so this is additive: unauthenticated
/// access is simply not reachable.
///
/// When no Cognito pool is configured (`SINEOBEX_COGNITO_POOL_ID` unset), the
/// controller runs in local mode: the app is usable with the demo identity,
/// but the sign-in screen states plainly that authentication is not enforced.
class SessionController extends StateNotifier<Session> {
  SessionController(this._ref)
      : super(const Session(state: SessionState.restoring)) {
    unawaited(_restore());
  }

  final Ref _ref;

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static const _sessionKey = 'sineobex.session.v1';

  CognitoUserPool? _pool;
  CognitoUser? _cognitoUser;
  CognitoUserSession? _cognitoSession;
  Timer? _inactivityTimer;

  bool get isConfigured =>
      AppConfig.cognitoUserPoolId.isNotEmpty &&
      AppConfig.cognitoClientId.isNotEmpty;

  CognitoUserPool get _userPool => _pool ??= CognitoUserPool(
        AppConfig.cognitoUserPoolId,
        AppConfig.cognitoClientId,
      );

  Future<void> _restore() async {
    if (!isConfigured) {
      // Local mode. Usable, but honest about what it is.
      state = Session(
        state: SessionState.active,
        user: _ref.read(teamRepositoryProvider).placeholderUser,
      );
      _resetInactivityTimer();
      return;
    }

    final username = await _storage.read(key: _sessionKey);
    if (username == null) {
      state = const Session(state: SessionState.signedOut);
      return;
    }

    try {
      final user = CognitoUser(username, _userPool);
      final session = await user.getSession();
      if (session != null && session.isValid()) {
        _cognitoUser = user;
        _cognitoSession = session;
        // A restored session still starts locked: possession of the device is
        // not proof of identity after it has been out of the operator's hands.
        state = Session(state: SessionState.locked, user: _userFrom(session));
        return;
      }
    } catch (e) {
      debugPrint('Session restore failed: $e');
    }
    state = const Session(state: SessionState.signedOut);
  }

  Future<bool> signIn(String username, String password) async {
    if (!isConfigured) {
      state = Session(
        state: SessionState.active,
        user: _ref.read(teamRepositoryProvider).placeholderUser,
      );
      return true;
    }

    state = state.copyWith(state: SessionState.restoring);
    try {
      final user = CognitoUser(username, _userPool);
      final details = AuthenticationDetails(
        username: username,
        password: password,
      );
      final session = await user.authenticateUser(details);
      if (session == null) {
        state = const Session(
          state: SessionState.signedOut,
          error: 'Sign-in failed.',
        );
        return false;
      }

      _cognitoUser = user;
      _cognitoSession = session;
      await _storage.write(key: _sessionKey, value: username);

      final appUser = _userFrom(session);
      _ref.read(currentUserProvider.notifier).state = appUser;
      _ref.read(auditLogProvider)
        ..setActor(appUser.id)
        ..record(AuditAction.signIn, entity: 'session', entityId: appUser.id);

      state = Session(state: SessionState.active, user: appUser);
      _resetInactivityTimer();
      return true;
    } on CognitoUserNewPasswordRequiredException {
      state = const Session(state: SessionState.newPasswordRequired);
      return false;
    } on CognitoClientException catch (e) {
      state = Session(
        state: SessionState.signedOut,
        error: e.message ?? 'Sign-in failed.',
      );
      return false;
    } catch (e) {
      state = Session(
        state: SessionState.signedOut,
        error: 'Sign-in failed: $e',
      );
      return false;
    }
  }

  /// Called by the auth interceptor when a request comes back 401.
  Future<String?> accessToken({bool forceRefresh = false}) async {
    if (!isConfigured) return null;
    final session = _cognitoSession;
    if (session == null) return null;
    if (!forceRefresh && session.isValid()) {
      return session.getAccessToken().getJwtToken();
    }
    try {
      final refreshed =
          await _cognitoUser?.refreshSession(session.getRefreshToken()!);
      if (refreshed == null) return null;
      _cognitoSession = refreshed;
      return refreshed.getAccessToken().getJwtToken();
    } catch (e) {
      debugPrint('Token refresh failed: $e');
      await signOut();
      return null;
    }
  }

  /// Locks the UI without discarding the session or the local data.
  void lock() {
    if (state.state != SessionState.active) return;
    _inactivityTimer?.cancel();
    state = state.copyWith(state: SessionState.locked);
  }

  void unlock() {
    if (state.state != SessionState.locked) return;
    final user = state.user;
    if (user != null) {
      _ref.read(auditLogProvider).record(
            AuditAction.unlock,
            entity: 'session',
            entityId: user.id,
          );
    }
    state = state.copyWith(state: SessionState.active);
    _resetInactivityTimer();
  }

  /// Any user interaction pushes the lock deadline back.
  void noteActivity() {
    if (state.state != SessionState.active) return;
    _resetInactivityTimer();
  }

  void _resetInactivityTimer() {
    _inactivityTimer?.cancel();
    _inactivityTimer = Timer(AppConfig.inactivityLockTimeout, lock);
  }

  /// Signs out and destroys every trace of PHI on the device.
  ///
  /// Two independent erasures: the rows are deleted, and the SQLCipher key is
  /// destroyed so any residual file blocks are unreadable even if recovered.
  Future<void> signOut() async {
    _inactivityTimer?.cancel();

    final user = state.user;
    if (user != null) {
      await _ref.read(auditLogProvider).record(
            AuditAction.signOut,
            entity: 'session',
            entityId: user.id,
          );
    }

    try {
      await _cognitoUser?.signOut();
    } catch (e) {
      debugPrint('Cognito sign-out failed: $e');
    }

    await _ref.read(databaseProvider).wipePhi();
    await DbKey.destroy();
    await _storage.delete(key: _sessionKey);

    _cognitoUser = null;
    _cognitoSession = null;
    state = const Session(state: SessionState.signedOut);
  }

  /// Maps Cognito ID-token claims onto the app's user model. The
  /// `cognito:groups` claim carries the access tier that gates admin
  /// functions.
  AppUser _userFrom(CognitoUserSession session) {
    final claims = session.getIdToken().payload;
    final groups = (claims['cognito:groups'] as List?)?.cast<String>() ?? [];

    final access = groups.contains('full-admin')
        ? AccessTier.fullAdmin
        : groups.contains('standard')
            ? AccessTier.standard
            : AccessTier.viewOnly;

    return AppUser(
      id: claims['sub'] as String? ?? 'unknown',
      name: claims['name'] as String? ?? claims['email'] as String? ?? 'User',
      role: claims['custom:role'] as String? ?? access.label,
      email: claims['email'] as String? ?? '',
      agency: claims['custom:agency'] as String? ?? '',
      team: claims['custom:team'] as String? ?? '',
      access: access,
    );
  }

  @override
  void dispose() {
    _inactivityTimer?.cancel();
    super.dispose();
  }
}

final sessionControllerProvider =
    StateNotifierProvider<SessionController, Session>(
  SessionController.new,
);
