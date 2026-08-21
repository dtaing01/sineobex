import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/local/database.dart';
import 'package:sineobex/data/remote/api_client.dart';
import 'package:sineobex/data/sync/outbox.dart';

import 'helpers.dart';

void main() {
  setUpAll(suppressDriftWarnings);

  group('ApiException classification', () {
    // The drain loop DELETES rows it considers permanently failed, so
    // misclassifying an auth failure destroys unsynced clinical records.
    test('401 and 403 are retryable, not permanent', () {
      expect(ApiException('x', statusCode: 401).isPermanent, isFalse);
      expect(ApiException('x', statusCode: 403).isPermanent, isFalse);
    });

    test('401 and 403 are flagged as auth failures', () {
      expect(ApiException('x', statusCode: 401).isAuthFailure, isTrue);
      expect(ApiException('x', statusCode: 403).isAuthFailure, isTrue);
      expect(ApiException('x', statusCode: 422).isAuthFailure, isFalse);
    });

    test('timeouts, rate limits, and conflicts are retryable', () {
      for (final code in [408, 409, 425, 429]) {
        expect(
          ApiException('x', statusCode: code).isPermanent,
          isFalse,
          reason: '$code should be retryable',
        );
      }
    });

    test('a genuinely rejected payload is permanent', () {
      expect(ApiException('x', statusCode: 400).isPermanent, isTrue);
      expect(ApiException('x', statusCode: 422).isPermanent, isTrue);
    });

    test('server errors and unknown failures are retryable', () {
      expect(ApiException('x', statusCode: 500).isPermanent, isFalse);
      expect(ApiException('x', statusCode: 503).isPermanent, isFalse);
      expect(ApiException('x').isPermanent, isFalse);
    });
  });

  group('Outbox.backoffFor', () {
    test('grows with the attempt count', () {
      final first = Outbox.backoffFor(1);
      final third = Outbox.backoffFor(3);
      expect(third, greaterThan(first));
    });

    test('is zero before the first failure', () {
      expect(Outbox.backoffFor(0), Duration.zero);
    });

    test('caps so a device out of range all day does not hammer the API', () {
      expect(Outbox.backoffFor(100).inSeconds, lessThanOrEqualTo(1800));
    });
  });

  group('Outbox', () {
    late AppDatabase db;
    late Outbox outbox;

    setUp(() {
      db = testDatabase();
      outbox = Outbox(db);
    });

    tearDown(() => db.close());

    test('markFailed increments attempts rather than resetting them', () async {
      await outbox.enqueue(
        entity: SyncEntity.patient,
        entityId: 'p1',
        op: SyncOp.update,
        payload: const {'a': 1},
      );

      final row = (await outbox.pending()).single;
      expect(row.attempts, 0);

      await outbox.markFailed(row.seq, 'boom');
      expect((await outbox.pending()).single.attempts, 1);

      await outbox.markFailed(row.seq, 'boom again');
      expect((await outbox.pending()).single.attempts, 2);
    });

    test('preserves FIFO order', () async {
      for (final id in ['a', 'b', 'c']) {
        await outbox.enqueue(
          entity: SyncEntity.encounter,
          entityId: id,
          op: SyncOp.create,
          payload: const {},
        );
      }
      final ids = (await outbox.pending()).map((r) => r.entityId).toList();
      expect(ids, ['a', 'b', 'c']);
    });

    test('markDone removes only the row named', () async {
      await outbox.enqueue(
        entity: SyncEntity.patient,
        entityId: 'keep',
        op: SyncOp.update,
        payload: const {},
      );
      await outbox.enqueue(
        entity: SyncEntity.patient,
        entityId: 'drop',
        op: SyncOp.update,
        payload: const {},
      );

      final drop = (await outbox.pending()).firstWhere(
        (r) => r.entityId == 'drop',
      );
      await outbox.markDone(drop.seq);

      final remaining = await outbox.pending();
      expect(remaining.map((r) => r.entityId), ['keep']);
    });

    test('pendingCount tracks the queue', () async {
      expect(await outbox.pendingCount(), 0);
      await outbox.enqueue(
        entity: SyncEntity.inventory,
        entityId: 'i1',
        op: SyncOp.update,
        payload: const {},
      );
      expect(await outbox.pendingCount(), 1);
    });
  });
}
