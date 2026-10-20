import 'package:flutter/foundation.dart';

/// An exception's text can carry patient data: a database error prints the values it was
/// writing, a format error the text it couldn't read. Release builds log only the error's type
/// ("No PHI in logs"); debug builds keep Flutter's full report for developers on demo data.
void redactErrors({bool release = kReleaseMode, void Function(String)? log}) {
  if (!release) return;
  final write = log ?? (String line) => debugPrint(line);
  FlutterError.onError = (details) => write('Unhandled ${details.exception.runtimeType}');
  PlatformDispatcher.instance.onError = (error, stack) {
    write('Unhandled ${error.runtimeType}');
    return true;
  };
}
