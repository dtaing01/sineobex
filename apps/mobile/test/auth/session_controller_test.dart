import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
import 'package:sineobex_field/auth/session_controller.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';

import 'fakes.dart';

void main() {
  late FakeAuth auth;
  late MemorySecureStore store;
  late MemorySecureStore bio;
  late SessionController session;
  var teams = 1;

  SessionController build() => SessionController(
    auth: auth,
    vault: KeyVault(store: store, biometricStore: bio, pbkdf2Iterations: 1000),
    store: store,
    fetchMe: (token) async {
      expect(token, startsWith('access-aal2'));
      return demoUser(teams: teams);
    },
  );

  setUp(() async {
    teams = 1;
    auth = FakeAuth();
    store = MemorySecureStore();
    bio = MemorySecureStore();
    session = build();
    await session.start();
  });

  Future<void> signInAndSetPin() async {
    await session.signIn('Clinician@Example.com', validPassword);
    await session.verifyCode(validCode);
    await session.setPin('482913');
  }

  test('starts signed out on a fresh phone', () {
    expect(session.state, isA<SignedOut>());
  });

  test('password, then code, then a PIN, then unlocked with the one team chosen', () async {
    await session.signIn('Clinician@Example.com', validPassword);
    expect(session.state, isA<AwaitingMfa>());
    await expectLater(session.verifyCode('000000'), throwsA(isA<AuthException>()));
    await session.verifyCode(validCode);
    expect(session.state, isA<NeedsPin>());
    await session.setPin('482913');
    final s = session.state as Unlocked;
    expect(s.user.team?.name, 'Demo Team 0');
    expect(session.databaseKey, hasLength(32));
  });

  test('people without an authenticator are sent to set one up', () async {
    auth.enrolled = false;
    await session.signIn('clinician@example.com', validPassword);
    expect(session.state, isA<AwaitingEnrollment>());
    await session.beginEnrollment();
    expect((session.state as AwaitingEnrollment).enrollment?.uri, startsWith('otpauth://'));
    await session.verifyCode(validCode);
    expect(session.state, isA<NeedsPin>());
  });

  test('locking drops the key; the PIN brings it back; a restart starts locked', () async {
    await signInAndSetPin();
    final key = session.databaseKey;
    await session.lock();
    expect(session.state, isA<Locked>());
    expect(session.databaseKey, isNull);
    await session.unlockWithPin('482913');
    expect(session.databaseKey, key);

    final restarted = build();
    await restarted.start();
    expect(restarted.state, isA<Locked>());
    expect((restarted.state as Locked).user.displayName, 'Jordan Lee (demo)');
  });

  test('a fresh online sign-in never skips the PIN on data already on the phone', () async {
    await signInAndSetPin();
    await session.lock();
    final again = build();
    await again.start();
    again.restartSignIn();
    await again.signIn('clinician@example.com', validPassword);
    await again.verifyCode(validCode);
    expect(again.state, isA<Locked>());
  });

  test('ten wrong PINs erase the phone and say why', () async {
    await signInAndSetPin();
    await session.lock();
    for (var i = 0; i < KeyVault.maxPinFailures - 1; i++) {
      await expectLater(session.unlockWithPin('000001'), throwsA(isA<WrongPin>()));
    }
    expect((session.state as Locked).attemptsLeft, 1);
    await session.unlockWithPin('000001');
    expect(session.state, isA<SignedOut>());
    expect((session.state as SignedOut).notice, contains('erased'));
    expect(store.values.keys.where((k) => k.startsWith('u:user-1:')), isEmpty);
  });

  test('refreshes the access token with the sealed refresh token, and only when unlocked', () async {
    await signInAndSetPin();
    // The token from sign-in expires in 30 seconds, inside the refresh margin.
    final token = await session.accessToken();
    expect(token, 'access-refreshed-1');
    expect(await session.accessToken(), 'access-refreshed-1');
    expect(auth.refreshes, 1);
    expect(store.values['u:user-1:refresh']!.contains('refresh-refreshed-1'), isFalse, reason: 'stored sealed');
    await session.lock();
    await expectLater(session.accessToken(), throwsA(isA<AuthException>()));
  });

  test('biometric unlock works once enabled and falls back to the PIN when cancelled', () async {
    await signInAndSetPin();
    await session.enableBiometric();
    await session.lock();
    expect((session.state as Locked).biometric, isTrue);
    expect(await session.unlockWithBiometric(), isTrue);
    await session.lock();
    bio.failReads = true;
    expect(await session.unlockWithBiometric(), isFalse);
    expect(session.state, isA<Locked>());
  });

  test('several teams: the person chooses, and the choice is remembered', () async {
    teams = 2;
    await signInAndSetPin();
    expect((session.state as Unlocked).user.team, isNull);
    await session.selectTeam('team-1');
    await session.lock();
    final restarted = build();
    await restarted.start();
    expect((restarted.state as Locked).user.teamId, 'team-1');
  });

  test('signing out forgets the person on this phone', () async {
    await signInAndSetPin();
    await session.signOut();
    expect(session.state, isA<SignedOut>());
    expect(store.values, isEmpty);
  });
}
