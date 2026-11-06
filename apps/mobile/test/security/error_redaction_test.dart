import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/security/error_redaction.dart';

void main() {
  test('release builds pass on an unhandled error’s type, never its text', () {
    final flutterBefore = FlutterError.onError;
    final platformBefore = PlatformDispatcher.instance.onError;
    addTearDown(() {
      FlutterError.onError = flutterBefore;
      PlatformDispatcher.instance.onError = platformBefore;
    });
    final lines = <String>[];
    redactErrors(release: true, report: lines.add);
    const secret = 'Demo patient note: allergic to penicillin';
    FlutterError.onError!(FlutterErrorDetails(exception: StateError(secret)));
    expect(PlatformDispatcher.instance.onError!(const FormatException(secret), StackTrace.empty), isTrue);
    expect(lines, ['StateError', 'FormatException']);
  });
}
