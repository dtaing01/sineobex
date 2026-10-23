import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/security/key_vault.dart';
import 'package:sineobex_field/security/secure_store.dart';

void main() {
  late MemorySecureStore store;
  late MemorySecureStore bio;
  late KeyVault vault;

  setUp(() {
    store = MemorySecureStore();
    bio = MemorySecureStore();
    // A low work factor keeps tests fast; production uses KeyVault.defaultIterations.
    vault = KeyVault(store: store, biometricStore: bio, pbkdf2Iterations: 1000);
  });

  test('creates a 256-bit key and unlocks it with the same PIN', () async {
    final key = await vault.create('u1', '482913');
    expect(key, hasLength(32));
    expect(await vault.unlockWithPin('u1', '482913'), key);
  });

  test('never stores the key or the PIN in the clear', () async {
    final key = await vault.create('u1', '482913');
    final everything = store.values.values.join();
    expect(everything.contains('482913'), isFalse);
    expect(everything.contains(String.fromCharCodes(key)), isFalse);
  });

  test('rejects guessable PINs', () {
    expect(KeyVault.pinProblem('12345'), contains('at least 6'));
    expect(KeyVault.pinProblem('111111'), contains('repeat'));
    expect(KeyVault.pinProblem('123456'), contains('sequence'));
    expect(KeyVault.pinProblem('987654'), contains('sequence'));
    expect(KeyVault.pinProblem('48a913'), contains('digits'));
    expect(KeyVault.pinProblem('482913'), isNull);
  });

  test('counts wrong PINs and erases the key on the tenth', () async {
    await vault.create('u1', '482913');
    for (var i = 1; i < KeyVault.maxPinFailures; i++) {
      await expectLater(
        vault.unlockWithPin('u1', '000001'),
        throwsA(isA<WrongPin>().having((e) => e.attemptsLeft, 'attemptsLeft', KeyVault.maxPinFailures - i)),
      );
    }
    await expectLater(vault.unlockWithPin('u1', '000001'), throwsA(isA<VaultWiped>()));
    expect(await vault.hasVault('u1'), isFalse);
    // Even the right PIN can't bring it back.
    await expectLater(vault.unlockWithPin('u1', '482913'), throwsA(isA<VaultWiped>()));
  });

  test('a right PIN resets the count', () async {
    await vault.create('u1', '482913');
    await expectLater(vault.unlockWithPin('u1', '000001'), throwsA(isA<WrongPin>()));
    await vault.unlockWithPin('u1', '482913');
    expect(await vault.failures('u1'), 0);
  });

  test('counts an attempt even if the app dies before the PIN is checked', () async {
    await vault.create('u1', '482913');
    // Simulate a crash mid-attempt: the counter was written first, the result never arrived.
    store.values['u:u1:pin.failures'] = '9';
    await expectLater(vault.unlockWithPin('u1', '000001'), throwsA(isA<VaultWiped>()));
  });

  test('biometric unlock returns the same key, and fails closed', () async {
    final key = await vault.create('u1', '482913');
    await vault.enableBiometric('u1', key);
    expect(await vault.hasBiometric('u1'), isTrue);
    expect(await vault.unlockWithBiometric('u1'), key);
    bio.failReads = true; // cancelled prompt or changed biometrics
    expect(await vault.unlockWithBiometric('u1'), isNull);
  });

  test('keeps users on a shared phone apart', () async {
    await vault.create('u1', '482913');
    await vault.create('u2', '739104');
    await expectLater(vault.unlockWithPin('u2', '482913'), throwsA(isA<WrongPin>()));
    expect(await vault.failures('u1'), 0);
  });

  test('changing the PIN keeps the key', () async {
    final key = await vault.create('u1', '482913');
    await vault.changePin('u1', '482913', '739104');
    expect(await vault.unlockWithPin('u1', '739104'), key);
    await expectLater(vault.unlockWithPin('u1', '482913'), throwsA(isA<WrongPin>()));
  });

  test('seals small secrets so only the key opens them', () async {
    final key = await vault.create('u1', '482913');
    final sealed = await vault.seal(key, 'refresh-token-value');
    expect(sealed.contains('refresh-token-value'), isFalse);
    expect(await vault.open(key, sealed), 'refresh-token-value');
    final other = await vault.create('u2', '739104');
    await expectLater(vault.open(other, sealed), throwsA(anything));
  });
}
