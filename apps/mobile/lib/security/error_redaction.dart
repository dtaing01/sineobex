import 'package:flutter/foundation.dart';

/// An exception's text can carry patient data: a database error prints the values it was
/// writing, a format error the text it couldn't read. Release builds write nothing to the device
/// log ("No PHI in logs"; device logs reach bug reports and other apps); [report], when given
/// (a future crash reporter), gets the error's type and nothing else. Debug builds keep Flutter's
/// full report for developers working on demo data.
void redactErrors({bool release = kReleaseMode, void Function(String type)? report}) {
  if (!release) return;
  FlutterError.onError = (details) => report?.call(details.exception.runtimeType.toString());
  PlatformDispatcher.instance.onError = (error, stack) {
    report?.call(error.runtimeType.toString());
    return true;
  };
}
