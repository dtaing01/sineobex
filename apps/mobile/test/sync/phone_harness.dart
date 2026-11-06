import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/security/secure_store.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/device_identity.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

/// A boot clock the test drives: [elapsed] counts through "sleep", [reboot] starts a new boot.
class FakeBootClock implements BootClock {
  FakeBootClock({this.live});

  /// Against the real API, time since boot follows real time.
  final Stopwatch? live;
  String bootId = 'boot-1';
  Duration _elapsed = const Duration(hours: 3);
  bool available = true;

  Duration get elapsed => _elapsed + (live?.elapsed ?? Duration.zero);
  set elapsed(Duration d) => _elapsed = d - (live?.elapsed ?? Duration.zero);

  void advance(Duration d) => _elapsed += d;

  void reboot() {
    bootId = 'boot-${int.parse(bootId.split('-').last) + 1}';
    elapsed = const Duration(seconds: 40);
  }

  @override
  Future<BootReading?> read() async => available ? BootReading(bootId, elapsed) : null;
}

/// One phone: its encrypted database, clock, device key and sync engine, for one user and team.
/// [restart] kills and relaunches the app, keeping only what a real phone keeps on disk.
class TestPhone {
  TestPhone({
    required this.userId,
    required this.teamId,
    required this.transport,
    DateTime? wall,
    this.realTime,
    Directory? dir,
  }) : _wall = wall ?? DateTime.utc(2026),
       boot = FakeBootClock(live: realTime == null ? null : (Stopwatch()..start())),
       dir = dir ?? Directory.systemTemp.createTempSync('phone') {
    _launch();
  }

  final String userId;
  final String teamId;
  final ApiTransport Function() transport;
  final Directory dir;
  final secure = MemorySecureStore();
  final FakeBootClock boot;
  final key = Uint8List.fromList(List<int>.generate(32, (i) => (i * 31 + 7) % 256));

  /// Against the real API: the phone's clock is real time plus [skew].
  final DateTime Function()? realTime;
  Duration skew = Duration.zero;
  DateTime _wall;

  /// The phone's own clock (what the person could set wrong).
  DateTime get wall => realTime == null ? _wall : realTime!().toUtc().add(skew);
  set wall(DateTime t) => _wall = t;

  late LocalDatabase db;
  late LocalStore store;
  late ClockSync clock;
  late DeviceIdentity device;
  late SyncEngine engine;

  String get path => LocalDatabase.fileFor(dir.path, userId, teamId);

  void _launch() {
    db = LocalDatabase.open(path, key);
    clock = ClockSync(
      boot: boot,
      references: DatabaseClockReferences(db),
      wallNow: () => wall,
      monotonic: () => boot.elapsed,
    );
    store = LocalStore(
      db,
      userId: userId,
      stamp: clock.stamp,
      chartingPaused: () => clock.status.paused,
      now: () => wall,
    );
    device = DeviceIdentity(store: secure, userId: userId, random: Random(userId.hashCode));
    engine = SyncEngine(
      store: store,
      api: SineobexApi(transport()),
      device: device,
      clock: clock,
      teamId: teamId,
      platform: RegisterDevicePlatform.android,
      appVersion: '0.2.0-test',
      now: () => wall,
      random: Random(1),
    );
  }

  /// The app is killed and opened again: memory is gone, the database and keystore remain.
  Future<void> restart() async {
    db.close();
    _launch();
    await clock.check();
  }

  void advance(Duration d) {
    _wall = _wall.add(d);
    boot.advance(d);
  }

  void close() {
    db.close();
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  }
}
