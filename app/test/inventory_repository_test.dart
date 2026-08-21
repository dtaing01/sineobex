import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex/data/local/database.dart';
import 'package:sineobex/data/models/models.dart';
import 'package:sineobex/data/repositories/inventory_repository.dart';
import 'package:sineobex/data/sync/outbox.dart';

import 'helpers.dart';

void main() {
  late AppDatabase db;
  late Outbox outbox;
  late InventoryRepository repo;

  setUpAll(suppressDriftWarnings);

  setUp(() async {
    db = testDatabase();
    outbox = Outbox(db);
    repo = InventoryRepository(db, outbox);
    await repo.replaceAll([
      const InventoryItem(
        id: 's1',
        name: 'Gauze',
        stock: 15,
        min: 20,
        unit: 'packs',
        category: SupplyCategory.medical,
      ),
      const InventoryItem(
        id: 's2',
        name: 'Amoxicillin 500mg',
        stock: 12,
        min: 15,
        unit: 'bottles',
        category: SupplyCategory.medical,
      ),
      const InventoryItem(
        id: 's3',
        name: 'Socks',
        stock: 45,
        min: 15,
        unit: 'pairs',
        category: SupplyCategory.clothing,
      ),
      const InventoryItem(
        id: 's4',
        name: 'Tetanus Vaccines',
        stock: 0,
        min: 10,
        unit: 'doses',
        category: SupplyCategory.medical,
      ),
    ]);
  });

  tearDown(() => db.close());

  group('order lifecycle', () {
    test('markOrdered stamps the time and the actor', () async {
      await repo.markOrdered(
        's1',
        'Sarah Chen, RN',
        now: DateTime(2026, 4, 11, 9),
      );

      final item = await repo.byId('s1');
      expect(item!.isOnOrder, isTrue);
      expect(item.orderedBy, 'Sarah Chen, RN');
      expect(item.orderedAtLabel, '2026-04-11 09:00');
    });

    test('markReceived with a quantity adds to existing stock', () async {
      await repo.markOrdered('s1', 'RN');
      await repo.markReceived('s1', quantity: 30);

      final item = await repo.byId('s1');
      expect(item!.stock, 45);
      expect(item.isOnOrder, isFalse);
      expect(item.orderedBy, isNull);
    });

    test(
      'markReceived without a quantity keeps the prototype default',
      () async {
        // The prototype set stock = max(stock, min + 10) with no input (D7).
        await repo.markOrdered('s1', 'RN');
        await repo.markReceived('s1');
        expect((await repo.byId('s1'))!.stock, 30);
      },
    );

    test('markReceived never lowers stock in the default case', () async {
      await repo.markReceived('s3');
      expect((await repo.byId('s3'))!.stock, 45);
    });

    test('queues each change for sync', () async {
      await repo.markOrdered('s1', 'RN');
      await repo.markReceived('s1', quantity: 5);

      final pending = await outbox.pending();
      expect(pending, hasLength(2));
      expect(pending.every((r) => r.entity == 'inventory'), isTrue);
    });
  });

  group('consume', () {
    test('debits stock for a matched supply', () async {
      await repo.consume(supplies: ['Gauze'], location: 'Cass Park');
      expect((await repo.byId('s1'))!.stock, 14);
    });

    test('matches a supply string carrying dosage detail', () async {
      await repo.consume(
        supplies: ['Amoxicillin 500mg (1 tab twice daily for 7 days)'],
        location: 'Cass Park',
      );
      expect((await repo.byId('s2'))!.stock, 11);
    });

    test('prefers the longest matching item name', () async {
      // 'Amoxicillin 500mg' must win over a shorter accidental substring.
      await repo.consume(
        supplies: ['Amoxicillin 500mg (2)'],
        location: 'Cass Park',
      );
      expect((await repo.byId('s2'))!.stock, 11);
      expect((await repo.byId('s1'))!.stock, 15);
    });

    test('never drives stock below zero', () async {
      await repo.consume(supplies: ['Tetanus Vaccines'], location: 'Clinic');
      expect((await repo.byId('s4'))!.stock, 0);
    });

    test('logs an unrecognised supply without decrementing anything', () async {
      final before = await repo.all();
      await repo.consume(
        supplies: ['Improvised Splint'],
        location: 'Underpass',
      );
      final after = await repo.all();

      expect(
        after.map((i) => i.stock).toList(),
        before.map((i) => i.stock).toList(),
      );

      final log = await repo.watchUsageLog().first;
      expect(log.single.item, 'Improvised Splint');
    });

    test('writes a usage log entry with the parsed quantity', () async {
      await repo.consume(supplies: ['Socks (1 pair)'], location: 'Beacon Park');
      final log = await repo.watchUsageLog().first;

      expect(log.single.item, 'Socks');
      expect(log.single.quantityLabel, '1 pair');
      expect(log.single.location, 'Beacon Park');
    });

    test('falls back to the item unit when no quantity is written', () async {
      await repo.consume(supplies: ['Gauze'], location: 'Cass Park');
      final log = await repo.watchUsageLog().first;
      expect(log.single.quantityLabel, '1 packs');
    });

    test('an empty supply list is a no-op', () async {
      await repo.consume(supplies: const [], location: 'Anywhere');
      expect(await repo.watchUsageLog().first, isEmpty);
    });
  });

  group('SupplyUsageLog.relativeLabel', () {
    test('shows a clock time for today', () {
      final log = SupplyUsageLog(
        id: '1',
        item: 'Gauze',
        quantityLabel: '2',
        location: 'Bridge',
        at: DateTime(2026, 4, 11, 10, 45),
      );
      expect(log.relativeLabel(now: DateTime(2026, 4, 11, 18)), '10:45');
    });

    test('shows "Yesterday" for the previous day', () {
      final log = SupplyUsageLog(
        id: '1',
        item: 'Saline',
        quantityLabel: '1',
        location: 'Library',
        at: DateTime(2026, 4, 10, 9),
      );
      expect(log.relativeLabel(now: DateTime(2026, 4, 11, 8)), 'Yesterday');
    });

    test('shows a date further back', () {
      final log = SupplyUsageLog(
        id: '1',
        item: 'Water',
        quantityLabel: '12',
        location: 'Park',
        at: DateTime(2026, 4, 1),
      );
      expect(log.relativeLabel(now: DateTime(2026, 4, 11)), '2026-04-01');
    });
  });
}
