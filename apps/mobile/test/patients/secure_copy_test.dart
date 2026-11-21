import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/security/secure_copy.dart';
import 'package:sineobex_field/sync/device_channel.dart';

/// Copy link's Dart half (design 10.4, review P9): the native side gets the link and how long it may
/// stay, 60 seconds, which is what the screen announces. Clearing it then, only if it is still the
/// link on the clipboard, is MainActivity.kt's and AppDelegate.swift's; nothing here can run them.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(deviceChannel, null));

  test('the link goes to the native side with 60 seconds to live', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(deviceChannel, (call) async {
      calls.add(call);
      return true;
    });
    expect(secureCopyLifetime, const Duration(seconds: 60));
    expect(await secureCopy('http://localhost:3100/c#AAAAAAAAAAAAAAAAAAAAAA'), isTrue);
    expect(calls.single.method, 'secureCopy');
    expect(calls.single.arguments, {'text': 'http://localhost:3100/c#AAAAAAAAAAAAAAAAAAAAAA', 'expiresAfterMs': 60000});
  });

  test('nothing is copied, and the screen is told so, when the platform refuses or has no native side', () async {
    messenger.setMockMethodCallHandler(deviceChannel, (call) async => throw PlatformException(code: 'refused'));
    expect(await secureCopy('http://localhost:3100/c#AAAAAAAAAAAAAAAAAAAAAA'), isFalse);
    messenger.setMockMethodCallHandler(deviceChannel, null);
    expect(await secureCopy('http://localhost:3100/c#AAAAAAAAAAAAAAAAAAAAAA'), isFalse);
    messenger.setMockMethodCallHandler(deviceChannel, (call) async => null);
    expect(await secureCopy('http://localhost:3100/c#AAAAAAAAAAAAAAAAAAAAAA'), isFalse);
  });
}
