import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:sqlite3/sqlite3.dart' show SqliteException;

import '../api/generated/api.dart';
import '../api/transport.dart';
import '../auth/auth_provider.dart';
import 'clock.dart';
import 'device_identity.dart';
import 'local_store.dart';

/// What one sync attempt ended with.
sealed class SyncOutcome {
  const SyncOutcome();
}

class SyncDone extends SyncOutcome {
  const SyncDone({
    required this.sent,
    required this.confirmed,
    required this.rejected,
    required this.conflicts,
    this.unanswered = 0,
  });
  final int sent;
  final int confirmed;
  final int rejected;
  final int conflicts;

  /// Sent but not confirmed (no answer, or a hash that didn't match): sent again after a backoff.
  final int unanswered;
}

/// No answer (airplane mode, a dead zone, a timeout). Nothing is lost; it tries again later.
class SyncOffline extends SyncOutcome {
  const SyncOffline(this.reason);
  final String reason;
}

/// The server refused this person (removed, disabled, team suspended, or the session ended). The
/// phone checks with its device key whether to hand its work to quarantine and wipe.
class SyncAccessLost extends SyncOutcome {
  const SyncAccessLost(this.code);
  final String code;
}

/// A Program Admin asked to wipe this phone. Nothing more is sent.
class SyncWipeRequested extends SyncOutcome {
  const SyncWipeRequested();
}

/// Waiting out a backoff after failures.
class SyncWaiting extends SyncOutcome {
  const SyncWaiting(this.until);
  final DateTime until;
}

class SyncFailed extends SyncOutcome {
  const SyncFailed(this.code);
  final String code;
}

/// Sends the outbox and applies receipts (module 9 "Sync protocol").
///
/// 1. Unconfirmed changes go in small batches, oldest first.
/// 2. The server answers each one: accepted (with its hash), rejected (with a reason) or conflict.
/// 3. A matching hash confirms the change and the purge runs; a mismatch or no answer leaves it
///    unconfirmed, to be sent again after a backoff.
///
/// Every batch is safe to send twice: the server returns the stored receipt for a change ID it
/// already has, so a response lost after the server committed (app killed, network dropped) is
/// recovered by sending the same batch again.
class SyncEngine {
  SyncEngine({
    required this.store,
    required this.api,
    required this.device,
    required this.clock,
    required this.teamId,
    required this.platform,
    required this.appVersion,
    DateTime Function()? now,
    Random? random,
  }) : _now = now ?? DateTime.now,
       _random = random ?? Random();

  final LocalStore store;
  final SineobexApi api;
  final DeviceIdentity device;
  final ClockSync clock;
  final String teamId;
  final RegisterDevicePlatform platform;
  final String appVersion;
  final DateTime Function() _now;
  final Random _random;

  static const batchSize = 100;
  static const firstBackoff = Duration(seconds: 5);
  static const maxBackoff = Duration(minutes: 10);

  int _failures = 0;
  DateTime? _nextAttempt;
  DateTime? get nextAttempt => _nextAttempt;

  /// 5 s, 10 s, 20 s ... up to 10 minutes, each with up to half taken off at random so a team's
  /// phones coming back into signal don't all retry at once.
  Duration _backoff() {
    final exp = firstBackoff * pow(2, min(_failures - 1, 16)).toInt();
    final capped = exp > maxBackoff ? maxBackoff : exp;
    return capped * (0.5 + _random.nextDouble() * 0.5);
  }

  SyncOutcome _fail(SyncOutcome outcome) {
    _failures++;
    _nextAttempt = _now().add(_backoff());
    return outcome;
  }

  void _succeed() {
    _failures = 0;
    _nextAttempt = null;
  }

  /// Sends everything that may go now, batch after batch, stopping at the first batch that wasn't
  /// fully answered (its backoff then applies). [force] ignores a backoff ("Sync now").
  Future<SyncOutcome> syncAll({bool force = false, int maxBatches = 50}) async {
    var sent = 0, confirmed = 0, rejected = 0, conflicts = 0, unanswered = 0;
    for (var i = 0; i < maxBatches; i++) {
      final outcome = await syncOnce(force: force || i > 0);
      if (outcome is! SyncDone) {
        if (i == 0) return outcome;
        break;
      }
      sent += outcome.sent;
      confirmed += outcome.confirmed;
      rejected += outcome.rejected;
      conflicts += outcome.conflicts;
      unanswered += outcome.unanswered;
      // Stop at anything unanswered. Otherwise go on while something is sendable: confirming a
      // fixed create releases the notes that waited for it, which go in the next batch.
      if (outcome.unanswered > 0 || outcome.sent == 0) break;
      if (store.sendable(limit: 1).isEmpty) break;
    }
    await _refreshOpenRecords();
    return SyncDone(sent: sent, confirmed: confirmed, rejected: rejected, conflicts: conflicts, unanswered: unanswered);
  }

  Future<SyncOutcome> syncOnce({bool force = false}) async {
    final wait = _nextAttempt;
    if (!force && wait != null && _now().isBefore(wait)) return SyncWaiting(wait);
    try {
      return await _syncOnce();
    } on NetworkException catch (e) {
      return _fail(SyncOffline(e.reason));
    } on AuthException catch (e) {
      // Refreshing the session needs the network too; "unavailable" is just being offline.
      return e.code == AuthErrorCode.unavailable ? _fail(const SyncOffline('offline')) : SyncAccessLost(e.code.name);
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) return SyncAccessLost(e.code);
      if (e.code == 'device_not_registered') {
        await device.clearRegistration(teamId);
        return _fail(SyncFailed(e.code));
      }
      return _fail(SyncFailed(e.code));
    } on SqliteException {
      // A full disk, most likely. The exception's text carries the statement's bound values,
      // which can be clinical, so it goes no further than this.
      return _fail(const SyncFailed('storage'));
    }
  }

  /// The API refuses request bodies over 1 MiB (app.ts). Changes are added in order until the
  /// next would pass this, leaving room for the rest of the request; one always goes, since a
  /// single change is at most [maxValueBytes] plus its fields.
  static const maxBatchBytes = 900 * 1024;

  List<OutboxEntry> _fit(List<OutboxEntry> entries) {
    var bytes = 0;
    final out = <OutboxEntry>[];
    for (final e in entries) {
      bytes += utf8.encode(jsonEncode(_wire(e).toJson())).length + 1;
      if (out.isNotEmpty && bytes > maxBatchBytes) break;
      out.add(e);
    }
    return out;
  }

  Future<void> _ensureRegistered(String deviceId) async {
    if (await device.isRegistered(teamId)) return;
    await api.registerDevice(
      body: RegisterDevice(
        deviceId: deviceId,
        platform: platform,
        appVersion: appVersion,
        publicKey: await device.publicKey(),
      ),
    );
    await device.markRegistered(teamId);
  }

  Future<SyncOutcome> _syncOnce() async {
    final deviceId = await device.deviceId(teamId);
    await _ensureRegistered(deviceId);
    final batch = _fit(store.sendable(limit: batchSize));
    final unsynced = store.unsynced();
    final before = await clock.boot.read();
    final wallBefore = _now().toUtc();
    if (batch.isNotEmpty) store.recordAttempt(batch);
    final SyncPushResult res;
    try {
      res = await api.syncPush(
        body: SyncPush(
          deviceId: deviceId,
          clock: SyncPushClock(deviceTime: wallBefore),
          unsynced: SyncPushUnsynced(counts: unsynced.counts, oldest: unsynced.oldest),
          changes: batch.map(_wire).toList(),
        ),
      );
    } on ApiException catch (e) {
      final malformed = _malformed(e, batch.length);
      if (malformed.isEmpty) rethrow;
      // The server read none of the batch because of these, and would refuse it the same way
      // every time: they become rejections the person can see, and the rest goes again.
      for (final i in malformed) {
        store.reject(
          batch[i],
          reason: 'validation',
          message: 'This change can’t be read by the server.',
          details: const {'problem': 'malformed'},
        );
      }
      return SyncDone(
        sent: batch.length,
        confirmed: 0,
        rejected: malformed.length,
        conflicts: 0,
        unanswered: batch.length - malformed.length,
      );
    }
    final after = await clock.boot.read();
    await clock.recordServerTime(
      serverTime: res.serverTime,
      before: before,
      after: after,
      wallBefore: wallBefore,
      wallAfter: _now().toUtc(),
    );
    switch (res.device.status) {
      case DeviceStatus.active:
        break;
      case DeviceStatus.wipeRequested || DeviceStatus.wiped:
        return const SyncWipeRequested();
      case DeviceStatus.unknown:
        // A state this app version doesn't know: keep everything and stop until an update. The
        // server keeps what it applied; its receipts come back on the next try.
        return _fail(const SyncFailed('device_status_unknown'));
    }

    final byId = {for (final r in res.results) r.changeId: r};
    var confirmed = 0, rejected = 0, conflicts = 0, unanswered = 0;
    for (final e in batch) {
      final r = byId[e.changeId];
      if (r == null) {
        unanswered++;
        continue;
      }
      switch (r.status) {
        case SyncResultStatus.accepted:
          // A receipt confirms only the exact value: the server's hash must match ours.
          if (r.hash == e.valueHash) {
            store.confirm(e, serverVersion: r.serverVersion ?? 0);
            confirmed++;
          } else {
            unanswered++;
          }
        case SyncResultStatus.rejected:
          if (r.reason == RejectReason.hashMismatch) {
            unanswered++;
          } else if (r.quarantined == true && r.hash == e.valueHash) {
            // Held by the server for a Program Admin: stored there, so it can leave the phone.
            store.confirm(e, serverVersion: r.serverVersion ?? 0, inReview: true);
            confirmed++;
          } else {
            store.reject(e, reason: r.reason?.wire ?? 'validation', message: r.message, details: r.details);
            rejected++;
          }
        case SyncResultStatus.conflict:
          final s = r.server;
          if (s == null) {
            unanswered++;
          } else {
            store.conflict(
              e,
              ServerField(value: s.value, version: s.version, changedBy: s.changedBy, changedAt: s.changedAt),
            );
            conflicts++;
          }
        case SyncResultStatus.unknown:
          unanswered++;
      }
    }
    final done = SyncDone(
      sent: batch.length,
      confirmed: confirmed,
      rejected: rejected,
      conflicts: conflicts,
      unanswered: unanswered,
    );
    // Changes the server didn't answer stay unconfirmed and go again after a backoff.
    if (unanswered > 0) return _fail(done);
    _succeed();
    return done;
  }

  /// The batch positions a 422 names (`changes.3.field`), or none if it names something else.
  static Set<int> _malformed(ApiException e, int batchLength) {
    if (e.status != 422) return const {};
    final fields = e.details?['fields'];
    if (fields is! List<Object?>) return const {};
    final out = <int>{};
    for (final f in fields) {
      final path = f is Map<String, Object?> ? f['path'] : null;
      final m = path is String ? RegExp(r'^changes\.(\d+)(\.|$)').firstMatch(path) : null;
      final i = m == null ? null : int.parse(m.group(1)!);
      if (i == null || i >= batchLength) return const {};
      out.add(i);
    }
    return out;
  }

  SyncChange _wire(OutboxEntry e) => SyncChange(
    changeId: e.changeId,
    seq: e.seq,
    entity: ChangeEntity.fromJson(e.entity),
    recordId: e.recordId,
    op: SyncChangeOp.fromJson(e.op),
    field: e.field,
    value: e.value,
    valueHash: e.valueHash,
    baseVersion: e.baseVersion,
    follows: e.follows,
    supersedes: e.supersedes,
    conflictOf: e.conflictOf,
    resolution: e.resolution == null ? null : SyncChangeResolution.fromJson(e.resolution!),
    deviceTime: e.deviceTime,
    correctedTime: e.correctedTime,
    clockVerified: e.clockVerified,
  );

  /// Takes the server's newer values for records open here (someone else's edits to a shared
  /// draft). Fields with local edits waiting keep the person's value.
  Future<void> _refreshOpenRecords() async {
    final waiting = {for (final e in store.outbox().where((e) => e.op == 'create')) e.recordId};
    final ids = store.recordIds(openOnly: true).where((id) => !waiting.contains(id)).toList();
    for (var i = 0; i < ids.length; i += 50) {
      final chunk = ids.sublist(i, min(i + 50, ids.length));
      final refs = [
        for (final id in chunk)
          if (store.record(id) case final r?) RecordRef(entity: RecordEntity.fromJson(r.entity), id: id),
      ];
      if (refs.isEmpty) continue;
      try {
        final res = await api.fetchRecords(body: FetchRecords(records: refs));
        for (final s in res.records) {
          store.importServerRecord(serverRecordFrom(s));
        }
      } on Exception {
        return; // Refreshing is best effort; the next sync tries again.
      }
    }
  }

  /// Opens the server's copy of a record to work on here (a teammate's draft). False if the
  /// server doesn't have it.
  Future<bool> openServerRecord(String entity, String id) async {
    final res = await api.fetchRecords(
      body: FetchRecords(
        records: [RecordRef(entity: RecordEntity.fromJson(entity), id: id)],
      ),
    );
    if (res.records.isEmpty) return false;
    store.importServerRecord(serverRecordFrom(res.records.first));
    return true;
  }

  /// Asks the server for its time ("Check again"), so a clock the person just fixed is seen
  /// without waiting for something to sync. Offline, the stored reference is checked again.
  Future<ClockStatus> refreshClock() async {
    try {
      final before = await clock.boot.read();
      final wallBefore = _now().toUtc();
      final res = await api.getServerTime();
      final after = await clock.boot.read();
      return await clock.recordServerTime(
        serverTime: res.serverTime,
        before: before,
        after: after,
        wallBefore: wallBefore,
        wallAfter: _now().toUtc(),
      );
    } on Exception {
      return clock.check();
    }
  }

  /// Hands a removed user's unsynced work to quarantine, signed with the device key (module 9:
  /// "It is sent to a quarantine queue for a Program Admin to review, so no care record is
  /// lost"). Returns the change IDs the server now holds with a matching hash, or null when the
  /// phone has no device key to sign with.
  Future<Set<String>?> uploadToQuarantine() async {
    final deviceId = await device.existingDeviceId(teamId);
    if (deviceId == null) return null;
    var entries = store.handOver();
    final held = <String>{};
    while (entries.isNotEmpty) {
      final chunk = _fit(entries.take(batchSize).toList());
      entries = entries.sublist(chunk.length);
      final payload = SignedQuarantinePayload(
        deviceId: deviceId,
        purpose: 'quarantine',
        changes: chunk.map(_wire).toList(),
      );
      final res = await api.uploadQuarantine(
        deviceId: deviceId,
        body: SignedQuarantine(payload: payload, signature: await device.sign(payload.toJson())),
      );
      final byId = {for (final r in res.results) r.changeId: r};
      for (final e in chunk) {
        final r = byId[e.changeId];
        // Held for a Program Admin, or (an activity log entry) recorded in the audit chain.
        final kept =
            r?.status == QuarantineReceiptResultsItemStatus.quarantined ||
            r?.status == QuarantineReceiptResultsItemStatus.recorded;
        if (kept && r!.hash == e.valueHash) held.add(e.changeId);
      }
    }
    return held;
  }

  /// Asks, with the device key, whether this phone must wipe or its user lost access.
  Future<DeviceStatusResult?> signedStatus() async {
    final deviceId = await device.existingDeviceId(teamId);
    if (deviceId == null) return null;
    return DeviceRequests(api: api, device: device, now: _now).status(deviceId);
  }

  /// Reports a finished wipe, so the admin's device page shows it.
  Future<void> confirmWiped(String deviceId) =>
      DeviceRequests(api: api, device: device, now: _now).confirmWiped(deviceId);
}

/// Requests a phone signs with its device key instead of a sign-in.
class DeviceRequests {
  DeviceRequests({required this.api, required this.device, DateTime Function()? now}) : _now = now ?? DateTime.now;
  final SineobexApi api;
  final DeviceIdentity device;
  final DateTime Function() _now;

  Future<DeviceStatusResult> status(String deviceId) async {
    final payload = SignedStatusPayload(deviceId: deviceId, purpose: 'status', sentAt: _now().toUtc());
    return api.deviceStatus(
      deviceId: deviceId,
      body: SignedStatus(payload: payload, signature: await device.sign(payload.toJson())),
    );
  }

  Future<void> confirmWiped(String deviceId) async {
    final payload = SignedWipedPayload(deviceId: deviceId, purpose: 'wiped', wipedAt: _now().toUtc());
    await api.confirmWiped(
      deviceId: deviceId,
      body: SignedWiped(payload: payload, signature: await device.sign(payload.toJson())),
    );
  }
}

ServerRecord serverRecordFrom(RecordSnapshot s) => ServerRecord(
  entity: s.entity.wire,
  id: s.id,
  status: s.status,
  authorUserId: s.authorUserId,
  attributes: s.attributes,
  fields: {
    for (final MapEntry(key: name, value: f) in s.fields.entries)
      name: ServerField(value: f.value, version: f.version, changedBy: f.changedBy, changedAt: f.changedAt),
  },
);
