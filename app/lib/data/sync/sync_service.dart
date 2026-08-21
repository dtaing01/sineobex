import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

import '../local/database.dart';
import '../remote/api_client.dart';
import 'outbox.dart';

enum SyncState { idle, syncing, offline, error }

class SyncStatus {
  const SyncStatus({
    required this.state,
    required this.pending,
    this.lastSyncedAt,
    this.message,
  });

  final SyncState state;
  final int pending;
  final DateTime? lastSyncedAt;
  final String? message;

  static const initial = SyncStatus(state: SyncState.idle, pending: 0);
}

/// Drains the outbox whenever connectivity returns.
///
/// Conflict policy:
///  - Scalar fields (risk, location, stock) resolve last-writer-wins.
///  - Encounters are **append-only**. A clinical note written in the field is
///    never overwritten or dropped by a concurrent edit; the server keeps
///    both and flags the pair for review.
class SyncService {
  SyncService(this._db, this._outbox, this._api, {Connectivity? connectivity})
    : _connectivity = connectivity ?? Connectivity();

  final AppDatabase _db;
  final Outbox _outbox;
  final ApiClient _api;
  final Connectivity _connectivity;

  final _controller = StreamController<SyncStatus>.broadcast();
  StreamSubscription<List<ConnectivityResult>>? _connSub;
  Timer? _retryTimer;
  bool _draining = false;
  DateTime? _lastSyncedAt;

  /// Entity ids the server rejected outright. Surfaced so a coordinator can
  /// see that a record did not make it, rather than it vanishing quietly.
  final _rejected = <String>{};

  Set<String> get rejectedIds => Set.unmodifiable(_rejected);

  Stream<SyncStatus> get status => _controller.stream;

  void start() {
    _connSub = _connectivity.onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online) {
        unawaited(drain());
      } else {
        _emit(SyncState.offline);
      }
    });
    unawaited(drain());
  }

  Future<void> dispose() async {
    _retryTimer?.cancel();
    await _connSub?.cancel();
    await _controller.close();
  }

  Future<void> drain() async {
    if (_draining) return;
    if (!_api.isConfigured) {
      // No backend wired up yet — everything stays local, which is a valid
      // state, not an error.
      _emit(SyncState.idle);
      return;
    }
    _draining = true;
    _emit(SyncState.syncing);

    try {
      var batch = await _outbox.pending();
      while (batch.isNotEmpty) {
        for (final row in batch) {
          try {
            await _push(row);
            await _outbox.markDone(row.seq);
          } on ApiException catch (e) {
            if (e.isAuthFailure) {
              // The token needs refreshing, not the payload. Stop the pass and
              // let the next one retry with a fresh token — never discard a
              // clinical record because a session expired mid-shift.
              await _outbox.markFailed(row.seq, e);
              _scheduleRetry(row.attempts + 1);
              _emit(SyncState.error, message: 'Sign-in required to sync');
              return;
            }
            if (e.isPermanent) {
              // The server rejected this payload and always will. Dropping it
              // is a real data loss, so it is surfaced rather than silent.
              debugPrint(
                'Server permanently rejected ${row.entity}/${row.entityId}: '
                '${e.statusCode}',
              );
              await _outbox.markDone(row.seq);
              _rejected.add(row.entityId);
            } else {
              await _outbox.markFailed(row.seq, e);
              _scheduleRetry(row.attempts + 1);
              _emit(SyncState.error, message: e.message);
              return;
            }
          } catch (e) {
            // Anything else — a socket dying mid-write, a JSON error — is
            // treated as transient, but the attempt counter must still grow or
            // the retry timer spins at its floor forever with this row
            // blocking every write behind it.
            await _outbox.markFailed(row.seq, e);
            _scheduleRetry(row.attempts + 1);
            _emit(SyncState.error, message: e.toString());
            return;
          }
        }
        batch = await _outbox.pending();
      }
      await _pullReferenceData();
      _lastSyncedAt = DateTime.now();
      _emit(SyncState.idle);
    } catch (e) {
      _emit(SyncState.error, message: e.toString());
      _scheduleRetry(1);
    } finally {
      _draining = false;
    }
  }

  Future<void> _push(OutboxRow row) async {
    final payload = jsonDecode(row.payload) as Map<String, dynamic>;
    final entity = SyncEntity.values.byName(row.entity);
    final op = SyncOp.values.byName(row.op);
    await _api.pushMutation(
      entity: entity.name,
      entityId: row.entityId,
      op: op.name,
      payload: payload,
    );
  }

  /// Reference data — resources, hotspots, analytics — is server-owned and
  /// refreshed by the cron jobs. The device only reads it.
  Future<void> _pullReferenceData() async {
    final refreshed = await _api.fetchReferenceData();
    if (refreshed == null) return;
    await _db.putKeyValue(
      'reference.refreshedAt',
      DateTime.now().toUtc().toIso8601String(),
    );
  }

  void _scheduleRetry(int attempts) {
    _retryTimer?.cancel();
    _retryTimer = Timer(Outbox.backoffFor(attempts), () => unawaited(drain()));
  }

  void _emit(SyncState state, {String? message}) {
    if (_controller.isClosed) return;
    unawaited(
      _outbox.pendingCount().then((pending) {
        if (_controller.isClosed) return;
        _controller.add(
          SyncStatus(
            state: state,
            pending: pending,
            lastSyncedAt: _lastSyncedAt,
            message: message,
          ),
        );
      }),
    );
  }
}
