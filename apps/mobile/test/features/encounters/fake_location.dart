import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';

/// The phone's location as **Use my location** asks it (lifecycle 9.2), in place of the plugin's
/// platform side: whether location is on, the permission and what the person answers when asked,
/// and the fix. Every call is recorded, so a test can tell nothing was asked before the tap.
class FakeLocation extends GeolocatorPlatform {
  /// Puts a fake in the plugin's place for this test.
  static FakeLocation install() {
    final before = GeolocatorPlatform.instance;
    final fake = FakeLocation();
    GeolocatorPlatform.instance = fake;
    addTearDown(() => GeolocatorPlatform.instance = before);
    return fake;
  }

  final calls = <String>[];

  /// Location on for the whole phone.
  bool serviceOn = true;

  /// The app's permission now, and what the person answers when it is asked for.
  LocationPermission permission = LocationPermission.denied;
  LocationPermission answer = LocationPermission.whileInUse;

  /// The fix the phone gives, or [error] thrown in its place. With [hold] set, the fix waits until
  /// [release].
  Position? fix = demoFix();
  Object? error;
  bool hold = false;
  final _held = <Completer<void>>[];

  /// The fix's settings, as the app asked for it.
  LocationSettings? asked;

  void release() {
    for (final c in _held) {
      c.complete();
    }
    _held.clear();
  }

  @override
  Future<bool> isLocationServiceEnabled() async {
    calls.add('service');
    return serviceOn;
  }

  @override
  Future<LocationPermission> checkPermission() async {
    calls.add('check');
    return permission;
  }

  @override
  Future<LocationPermission> requestPermission() async {
    calls.add('request');
    return permission = answer;
  }

  @override
  Future<Position> getCurrentPosition({LocationSettings? locationSettings}) async {
    calls.add('position');
    asked = locationSettings;
    if (hold) {
      final wait = Completer<void>();
      _held.add(wait);
      await wait.future;
    }
    if (error case final e?) throw e;
    return fix!;
  }

  @override
  Future<bool> openAppSettings() async {
    calls.add('app settings');
    return true;
  }

  @override
  Future<bool> openLocationSettings() async {
    calls.add('location settings');
    return true;
  }
}

/// A made-up fix, in the open Pacific: nowhere a visit could be, with decimals that show the
/// coordinates travel as the phone gives them.
Position demoFix({double lat = 10.123456, double lng = -150.654321, double accuracy = 12.5}) => Position(
  latitude: lat,
  longitude: lng,
  accuracy: accuracy,
  timestamp: DateTime.utc(2026, 10, 20, 15),
  altitude: 0,
  altitudeAccuracy: 0,
  heading: 0,
  headingAccuracy: 0,
  speed: 0,
  speedAccuracy: 0,
);
