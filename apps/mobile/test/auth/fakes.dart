import 'package:sineobex_field/auth/auth_provider.dart';
import 'package:sineobex_field/auth/session_controller.dart';

const validPassword = 'correct horse';
const validCode = '246810';

class FakeAuth implements AuthProvider {
  FakeAuth({this.enrolled = true});
  bool enrolled;
  int refreshes = 0;
  bool offline = false;
  final DateTime Function() now = DateTime.now;

  Tokens _t(String tag, {Duration ttl = const Duration(hours: 1)}) =>
      Tokens(accessToken: 'access-$tag', refreshToken: 'refresh-$tag', expiresAt: now().add(ttl));

  @override
  Future<SignInResult> signIn(String email, String password) async {
    if (offline) throw const AuthException(AuthErrorCode.unavailable, 'offline');
    if (password != validPassword) {
      throw const AuthException(AuthErrorCode.invalidCredentials, 'That email and password don’t match.');
    }
    return enrolled ? MfaChallenge(_t('aal1'), 'factor-1') : MfaEnrollment(_t('aal1'));
  }

  @override
  Future<Enrollment> startEnrollment(Tokens tokens) async => const Enrollment(
    factorId: 'factor-new',
    secret: 'ABCDEFGHIJKLMNOP',
    uri: 'otpauth://totp/Sineobex?secret=ABCDEFGHIJKLMNOP',
  );

  @override
  Future<Tokens> verifyMfa(Tokens tokens, String factorId, String code) async {
    if (code != validCode) throw const AuthException(AuthErrorCode.invalidCode, 'That code didn’t work.');
    return _t('aal2', ttl: const Duration(seconds: 30));
  }

  @override
  Future<Tokens> refresh(String refreshToken) async {
    if (offline) throw const AuthException(AuthErrorCode.unavailable, 'offline');
    refreshes++;
    return _t('refreshed-$refreshes');
  }

  @override
  Future<void> signOut(Tokens tokens) async {}
}

LocalUser demoUser({int teams = 1}) => LocalUser(
  userId: 'user-1',
  email: 'clinician@example.com',
  displayName: 'Jordan Lee (demo)',
  teams: [
    for (var i = 0; i < teams; i++)
      TeamRef(
        id: 'team-$i',
        name: 'Demo Team $i',
        roleName: 'Healthcare Staff',
        credential: 'attending',
        permissions: const ['encounters.chart'],
      ),
  ],
);
