import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/app_providers.dart';
import 'package:sineobex_field/sync/device_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Review finding: on iOS the exclusion ran before the folder existed, failed, and the database
  // never opened.
  test('the database folder exists before it is excluded from backups, and a refusal doesn’t stop the app', () async {
    final root = Directory.systemTemp.createTempSync('support');
    addTearDown(() => root.deleteSync(recursive: true));
    final existed = <bool>[];
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(deviceChannel, (call) async {
      existed.add(Directory((call.arguments as Map<Object?, Object?>)['path']! as String).existsSync());
      // What AppDelegate.swift answers when the system refuses.
      throw PlatformException(code: 'exclude_failed');
    });
    addTearDown(() => messenger.setMockMethodCallHandler(deviceChannel, null));

    final dir = await databaseDirectory(base: () async => root);
    expect(existed, [true]);
    expect(Directory(dir).existsSync(), isTrue);
  });
}
