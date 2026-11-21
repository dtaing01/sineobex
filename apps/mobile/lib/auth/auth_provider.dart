import 'dart:convert';

import 'package:http/http.dart' as http;

/// The phone's one sign-in interface (Build plan: any OIDC provider; Supabase Auth in the preview,
/// Cognito in production). Talks to the provider's REST endpoints directly; the app never uses a
/// Supabase client library, so it can't reach Supabase tables.
class Tokens {
  const Tokens({required this.accessToken, required this.refreshToken, required this.expiresAt});
  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
}

sealed class SignInResult {
  const SignInResult(this.tokens);
  final Tokens tokens;
}

class MfaChallenge extends SignInResult {
  const MfaChallenge(super.tokens, this.factorId);
  final String factorId;
}

class MfaEnrollment extends SignInResult {
  const MfaEnrollment(super.tokens);
}

class Enrollment {
  const Enrollment({required this.factorId, required this.secret, required this.uri});
  final String factorId;
  final String secret;

  /// otpauth:// link that opens an authenticator app on this phone.
  final String uri;
}

enum AuthErrorCode { invalidCredentials, invalidCode, sessionExpired, unavailable }

class AuthException implements Exception {
  const AuthException(this.code, this.message);
  final AuthErrorCode code;
  final String message;
  @override
  String toString() => 'AuthException($code)';
}

abstract interface class AuthProvider {
  Future<SignInResult> signIn(String email, String password);
  Future<Enrollment> startEnrollment(Tokens tokens);
  Future<Tokens> verifyMfa(Tokens tokens, String factorId, String code);
  Future<Tokens> refresh(String refreshToken);
  Future<void> signOut(Tokens tokens);
}

const _unavailable = AuthException(AuthErrorCode.unavailable, 'Can’t reach sign-in. Check your connection.');

Future<(int, Map<String, Object?>)> _post(
  http.Client client,
  Uri url, {
  Map<String, String> headers = const {},
  Object? body,
}) async {
  try {
    final res = await client
        .post(url, headers: {'content-type': 'application/json', ...headers}, body: jsonEncode(body ?? {}))
        .timeout(const Duration(seconds: 20));
    final decoded = res.body.isEmpty ? <String, Object?>{} : jsonDecode(res.body);
    return (res.statusCode, decoded is Map<String, Object?> ? decoded : <String, Object?>{});
  } on Exception {
    throw _unavailable;
  }
}

Tokens _tokens(Map<String, Object?> j, DateTime Function() now) => Tokens(
  accessToken: j['access_token'] as String,
  refreshToken: j['refresh_token'] as String,
  expiresAt: now().add(Duration(seconds: (j['expires_in'] as num).toInt())),
);

class SupabaseAuthProvider implements AuthProvider {
  SupabaseAuthProvider({required Uri url, required this.anonKey, required this.client, DateTime Function()? now})
    : _base = url.replace(path: '${url.path.replaceAll(RegExp(r'/$'), '')}/auth/v1'),
      _now = now ?? DateTime.now;

  final Uri _base;
  final String anonKey;
  final http.Client client;
  final DateTime Function() _now;

  Uri _u(String path, [Map<String, String>? query]) =>
      _base.replace(path: '${_base.path}$path', queryParameters: query);
  Map<String, String> _h([String? token]) => {'apikey': anonKey, if (token != null) 'authorization': 'Bearer $token'};

  @override
  Future<SignInResult> signIn(String email, String password) async {
    final (status, j) = await _post(
      client,
      _u('/token', {'grant_type': 'password'}),
      headers: _h(),
      body: {'email': email, 'password': password},
    );
    if (status == 400 || status == 401) {
      throw const AuthException(AuthErrorCode.invalidCredentials, 'That email and password don’t match.');
    }
    if (status != 200) throw _unavailable;
    final tokens = _tokens(j, _now);
    final factors = ((j['user'] as Map<String, Object?>?)?['factors'] as List<Object?>?) ?? const [];
    for (final f in factors.whereType<Map<String, Object?>>()) {
      if (f['factor_type'] == 'totp' && f['status'] == 'verified') return MfaChallenge(tokens, f['id'] as String);
    }
    return MfaEnrollment(tokens);
  }

  @override
  Future<Enrollment> startEnrollment(Tokens tokens) async {
    final (status, j) = await _post(
      client,
      _u('/factors'),
      headers: _h(tokens.accessToken),
      body: {'factor_type': 'totp', 'friendly_name': 'Sineobex phone'},
    );
    final totp = j['totp'] as Map<String, Object?>?;
    if (status != 200 || totp == null) throw _unavailable;
    return Enrollment(factorId: j['id'] as String, secret: totp['secret'] as String, uri: totp['uri'] as String);
  }

  @override
  Future<Tokens> verifyMfa(Tokens tokens, String factorId, String code) async {
    final id = Uri.encodeComponent(factorId);
    final (cs, challenge) = await _post(client, _u('/factors/$id/challenge'), headers: _h(tokens.accessToken));
    if (cs != 200) throw const AuthException(AuthErrorCode.sessionExpired, 'Your sign-in expired. Start again.');
    final (vs, verified) = await _post(
      client,
      _u('/factors/$id/verify'),
      headers: _h(tokens.accessToken),
      body: {'challenge_id': challenge['id'], 'code': code},
    );
    if (vs != 200) {
      throw const AuthException(
        AuthErrorCode.invalidCode,
        'That code didn’t work. Try the newest code in your authenticator app.',
      );
    }
    return _tokens(verified, _now);
  }

  @override
  Future<Tokens> refresh(String refreshToken) async {
    final (status, j) = await _post(
      client,
      _u('/token', {'grant_type': 'refresh_token'}),
      headers: _h(),
      body: {'refresh_token': refreshToken},
    );
    if (status != 200) throw const AuthException(AuthErrorCode.sessionExpired, 'Your session ended. Sign in again.');
    return _tokens(j, _now);
  }

  @override
  Future<void> signOut(Tokens tokens) async {
    try {
      await _post(client, _u('/logout', {'scope': 'local'}), headers: _h(tokens.accessToken));
    } on AuthException {
      // Offline sign-out still clears the phone; the server session expires on its own.
    }
  }
}

/// tools/dev-idp.mjs, for local development only.
class DevAuthProvider implements AuthProvider {
  DevAuthProvider({required this.url, required this.client, DateTime Function()? now}) : _now = now ?? DateTime.now;
  final Uri url;
  final http.Client client;
  final DateTime Function() _now;

  Uri _u(String path) => url.replace(path: path);

  @override
  Future<SignInResult> signIn(String email, String password) async {
    final (status, j) = await _post(
      client,
      _u('/token'),
      body: {'grant_type': 'password', 'email': email, 'password': password},
    );
    if (status != 200) {
      throw const AuthException(AuthErrorCode.invalidCredentials, 'That email and password don’t match.');
    }
    return MfaChallenge(_tokens(j, _now), 'dev-totp');
  }

  @override
  Future<Enrollment> startEnrollment(Tokens tokens) async => const Enrollment(
    factorId: 'dev-totp',
    secret: 'DEVDEVDEVDEVDEVD',
    uri: 'otpauth://totp/Sineobex:dev?secret=DEVDEVDEVDEVDEVD',
  );

  @override
  Future<Tokens> verifyMfa(Tokens tokens, String factorId, String code) async {
    final (status, j) = await _post(
      client,
      _u('/mfa/verify'),
      body: {'access_token': tokens.accessToken, 'code': code},
    );
    if (status != 200) {
      throw const AuthException(
        AuthErrorCode.invalidCode,
        'That code didn’t work. Try the newest code in your authenticator app.',
      );
    }
    return _tokens(j, _now);
  }

  @override
  Future<Tokens> refresh(String refreshToken) async {
    final (status, j) = await _post(
      client,
      _u('/token'),
      body: {'grant_type': 'refresh_token', 'refresh_token': refreshToken},
    );
    if (status != 200) throw const AuthException(AuthErrorCode.sessionExpired, 'Your session ended. Sign in again.');
    return _tokens(j, _now);
  }

  @override
  Future<void> signOut(Tokens tokens) async {}
}
