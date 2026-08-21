import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:uuid/uuid.dart';

import '../local/database.dart';
import '../models/models.dart';
import '../sync/outbox.dart';

const _uuid = Uuid();

class InventoryRepository {
  InventoryRepository(this._db, this._outbox);

  final AppDatabase _db;
  final Outbox _outbox;

  Stream<List<InventoryItem>> watchAll() =>
      (_db.select(
        _db.inventoryRows,
      )..orderBy([(t) => OrderingTerm.asc(t.name)])).watch().map(
        (rows) => rows.map((r) => _decode(r.payload)).toList(growable: false),
      );

  Future<List<InventoryItem>> all() async {
    final rows = await (_db.select(
      _db.inventoryRows,
    )..orderBy([(t) => OrderingTerm.asc(t.name)])).get();
    return rows.map((r) => _decode(r.payload)).toList(growable: false);
  }

  Future<InventoryItem?> byId(String id) async {
    final row = await (_db.select(
      _db.inventoryRows,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
    return row == null ? null : _decode(row.payload);
  }

  /// Marks an item as ordered, stamping who ordered it and when — matching the
  /// prototype's `handleOrder`, but persisted.
  Future<void> markOrdered(String id, String orderedBy, {DateTime? now}) async {
    final item = await byId(id);
    if (item == null) return;
    final updated = item.copyWith(
      orderedAt: now ?? DateTime.now(),
      orderedBy: orderedBy,
      updatedAt: now ?? DateTime.now(),
    );
    await _persist(updated, SyncOp.update);
  }

  /// Receives a delivery.
  ///
  /// The prototype set `stock = max(stock, min + 10)` — an arbitrary quantity
  /// with no input (plan defect D7). The received amount is now a parameter,
  /// defaulting to the same figure so existing behaviour is preserved when the
  /// caller has nothing better.
  Future<void> markReceived(String id, {int? quantity, DateTime? now}) async {
    final item = await byId(id);
    if (item == null) return;
    final resolved = quantity == null
        ? (item.stock > item.min + 10 ? item.stock : item.min + 10)
        : item.stock + quantity;
    final updated = item.copyWith(
      stock: resolved,
      clearOrder: true,
      updatedAt: now ?? DateTime.now(),
    );
    await _persist(updated, SyncOp.update);
  }

  /// Debits stock for supplies handed out during an encounter, and writes the
  /// field usage log entries the Inventory screen displays.
  ///
  /// Supply strings carry free-text detail — "Gauze (2)", "Socks (1 pair)" —
  /// so matching is by name prefix, and an unrecognised string is logged
  /// without a decrement rather than silently dropped.
  Future<void> consume({
    required List<String> supplies,
    required String location,
    DateTime? now,
  }) async {
    if (supplies.isEmpty) return;
    final ts = now ?? DateTime.now();
    final items = await all();

    for (final supply in supplies) {
      final match = _matchItem(items, supply);
      if (match != null && match.stock > 0) {
        final updated = match.copyWith(stock: match.stock - 1, updatedAt: ts);
        await _persist(updated, SyncOp.update);
      }
      await _db
          .into(_db.supplyLogRows)
          .insertOnConflictUpdate(
            SupplyLogRowsCompanion.insert(
              id: _uuid.v4(),
              payload: jsonEncode(
                SupplyUsageLog(
                  id: _uuid.v4(),
                  item: match?.name ?? supply,
                  quantityLabel: _quantityLabel(supply, match),
                  location: location,
                  at: ts,
                ).toJson(),
              ),
              at: ts,
            ),
          );
    }
  }

  Stream<List<SupplyUsageLog>> watchUsageLog({int limit = 20}) =>
      (_db.select(_db.supplyLogRows)
            ..orderBy([(t) => OrderingTerm.desc(t.at)])
            ..limit(limit))
          .watch()
          .map(
            (rows) => rows
                .map(
                  (r) => SupplyUsageLog.fromJson(
                    jsonDecode(r.payload) as Map<String, dynamic>,
                  ),
                )
                .toList(growable: false),
          );

  Future<void> replaceAll(List<InventoryItem> items) async {
    await _db.transaction(() async {
      await _db.delete(_db.inventoryRows).go();
      for (final i in items) {
        await _write(i, dirty: false);
      }
    });
  }

  Future<bool> get isEmpty async {
    final count = _db.inventoryRows.id.count();
    final row = await (_db.selectOnly(
      _db.inventoryRows,
    )..addColumns([count])).getSingle();
    return (row.read(count) ?? 0) == 0;
  }

  /// Longest-prefix match, so "Amoxicillin 500mg (1 tab twice daily…)" binds to
  /// "Amoxicillin 500mg" rather than to a shorter accidental substring.
  static InventoryItem? _matchItem(List<InventoryItem> items, String supply) {
    final needle = supply.toLowerCase();
    InventoryItem? best;
    for (final item in items) {
      final name = item.name.toLowerCase();
      if (needle.startsWith(name) || needle.contains(name)) {
        if (best == null || item.name.length > best.name.length) best = item;
      }
    }
    return best;
  }

  /// Pulls "(2)" or "(1 pair)" out of the supply string for the usage log.
  static String _quantityLabel(String supply, InventoryItem? item) {
    final match = RegExp(r'\(([^)]*)\)').firstMatch(supply);
    if (match != null) return match.group(1)!.trim();
    return item == null ? '1' : '1 ${item.unit}';
  }

  Future<void> _persist(InventoryItem item, SyncOp op) async {
    await _write(item, dirty: true);
    await _outbox.enqueue(
      entity: SyncEntity.inventory,
      entityId: item.id,
      op: op,
      payload: item.toJson(),
    );
  }

  Future<void> _write(InventoryItem i, {required bool dirty}) => _db
      .into(_db.inventoryRows)
      .insertOnConflictUpdate(
        InventoryRowsCompanion.insert(
          id: i.id,
          payload: jsonEncode(i.toJson()),
          name: i.name,
          category: i.category.label,
          stock: i.stock,
          minLevel: i.min,
          updatedAt: i.updatedAt ?? DateTime.now(),
          dirty: Value(dirty),
        ),
      );

  InventoryItem _decode(String payload) =>
      InventoryItem.fromJson(jsonDecode(payload) as Map<String, dynamic>);
}
