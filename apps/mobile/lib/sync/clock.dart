import 'dart:convert';

import 'package:flutter/services.dart';

import 'device_channel.dart';
import 'local_db.dart';
import 'local_store.dart';

/// A reading of the phone's boot clock: time since boot, counting deep sleep, plus an ID that
/// changes when the phone restarts.
class BootReading {
  const BootReading(this.bootId, this.elapsed);
  final String bootId;
  final Duration elapsed;
}

abstract interface class BootClock {
  /// Null when the platform can't say; the clock check then treats times as unverified.
  Future<BootReading?> read();
}

/// Android: SystemClock.elapsedRealtime and Settings.Global.BOOT_COUNT. iOS: CLOCK_MONOTONIC (which
/// counts sleep on Darwin) and kern.bootsessionuuid. Dart's own Stopwatch stops while the phone
/// sleeps, so a phone left in a pocket would look like its clock drifted and pause charting.
class PlatformBootClock implements BootClock {
  @override
  Future<BootReading?> read() async {
    try {
      final m = await deviceChannel.invokeMapMethod<String, Object?>('bootClock');
      final id = m?['bootId'];
      final ms = m?['elapsedMs'];
      if (id is! String || ms is! num) return null;
      return BootReading(id, Duration(milliseconds: ms.toInt()));
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}

enum ClockState {
  /// The phone's clock agrees with the server's within the limit.
  verified,

  /// No server reference since the phone restarted (or ever). Times are saved as device time and
  /// flagged unverified; charting goes on (plan section 6: pausing would block care on every
  /// offline reboot).
  unverified,

  /// More than [ClockSync.limit] off the server. Charting pauses until it is fixed.
  off,
}

class ClockStatus {
  const ClockStatus(this.state, this.offset);
  final ClockState state;

  /// Server time minus phone time; null when unverified.
  final Duration? offset;
  bool get paused => state == ClockState.off;
}

/// Stores the clock reference with the rest of the local data.
abstract interface class ClockReferenceStore {
  String? readClockReference();
  void writeClockReference(String json);
}

/// The reference lives with the rest of the person's local data for the team.
class DatabaseClockReferences implements ClockReferenceStore {
  DatabaseClockReferences(this.db);
  final LocalDatabase db;
  static const _key = 'clock.reference';
  @override
  String? readClockReference() => db.kvGet(_key);
  @override
  void writeClockReference(String json) => db.kvSet(_key, json);
}

/// The clock check (module 9, decided Oct 12): "The phone compares its clock with the server time
/// from its last sync plus its own uptime since then, so the check works offline."
class ClockSync {
  ClockSync({required this.boot, required this.references, DateTime Function()? wallNow})
    : _wall = wallNow ?? DateTime.now;

  static const limit = Duration(minutes: 5);

  final BootClock boot;
  final ClockReferenceStore references;
  final DateTime Function() _wall;
  ClockStatus _status = const ClockStatus(ClockState.unverified, null);

  ClockStatus get status => _status;

  /// Called by sync with the server's time, measured at the midpoint of the request so a slow
  /// network halves its own error.
  Future<ClockStatus> recordServerTime({
    required DateTime serverTime,
    required BootReading? before,
    required BootReading? after,
    required DateTime wallBefore,
    required DateTime wallAfter,
  }) async {
    if (before == null || after == null || before.bootId != after.bootId) return check();
    final midElapsed = (before.elapsed + after.elapsed) ~/ 2;
    references.writeClockReference(
      jsonEncode({
        'bootId': after.bootId,
        'elapsedMs': midElapsed.inMilliseconds,
        'serverMs': serverTime.toUtc().millisecondsSinceEpoch,
      }),
    );
    return check();
  }

  /// Compares the phone's clock with the reference. Runs on unlock, on resume, after each sync
  /// and every few seconds while charting; [stamp] uses the result.
  Future<ClockStatus> check() async {
    final raw = references.readClockReference();
    final now = await boot.read();
    if (raw == null || now == null) return _status = const ClockStatus(ClockState.unverified, null);
    final ref = jsonDecode(raw) as Map<String, Object?>;
    final elapsedMs = (ref['elapsedMs']! as num).toInt();
    if (ref['bootId'] != now.bootId || now.elapsed.inMilliseconds < elapsedMs) {
      // The phone restarted since the last sync: no reference until the next one.
      return _status = const ClockStatus(ClockState.unverified, null);
    }
    final serverNow = (ref['serverMs']! as num).toInt() + now.elapsed.inMilliseconds - elapsedMs;
    final offset = Duration(milliseconds: serverNow - _wall().toUtc().millisecondsSinceEpoch);
    return _status = ClockStatus(offset.abs() > limit ? ClockState.off : ClockState.verified, offset);
  }

  /// The time stamped on a change: the phone's own clock, and corrected by the last offset when
  /// there is a reference. Both are stored; the server keeps both too.
  ClockStamp stamp() {
    final device = _wall().toUtc();
    final offset = _status.offset;
    return ClockStamp(
      deviceTime: device,
      correctedTime: offset == null ? null : device.add(offset),
      verified: offset != null,
    );
  }
}
