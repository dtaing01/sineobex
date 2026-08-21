import 'dart:convert';

import 'package:drift/drift.dart';

import '../local/database.dart';
import '../models/models.dart';

/// Server-owned reference data: partner facilities and geographic clusters.
/// The device reads these; the cron jobs recompute them.
class FieldRepository {
  FieldRepository(this._db);

  final AppDatabase _db;

  Stream<List<FieldResource>> watchResources() => _db
      .select(_db.resourceRows)
      .watch()
      .map(
        (rows) => rows
            .map(
              (r) => FieldResource.fromJson(
                jsonDecode(r.payload) as Map<String, dynamic>,
              ),
            )
            .toList(growable: false),
      );

  Future<List<FieldResource>> resources() async {
    final rows = await _db.select(_db.resourceRows).get();
    return rows
        .map(
          (r) => FieldResource.fromJson(
            jsonDecode(r.payload) as Map<String, dynamic>,
          ),
        )
        .toList(growable: false);
  }

  Stream<List<Hotspot>> watchHotspots() => _db
      .select(_db.hotspotRows)
      .watch()
      .map(
        (rows) => rows
            .map(
              (r) => Hotspot.fromJson(
                jsonDecode(r.payload) as Map<String, dynamic>,
              ),
            )
            .toList(growable: false),
      );

  /// The heatmap layer shows clinical and unmet-need clusters; the inventory
  /// layer shows supply draw. They are disjoint.
  Stream<List<Hotspot>> watchClinicalHotspots() =>
      watchHotspots().map((all) => all.where((h) => !h.type.isSupply).toList());

  Stream<List<Hotspot>> watchSupplyHotspots() =>
      watchHotspots().map((all) => all.where((h) => h.type.isSupply).toList());

  Future<void> replaceResources(List<FieldResource> items) async {
    await _db.transaction(() async {
      await _db.delete(_db.resourceRows).go();
      for (final r in items) {
        await _db
            .into(_db.resourceRows)
            .insertOnConflictUpdate(
              ResourceRowsCompanion.insert(
                id: r.id,
                payload: jsonEncode(r.toJson()),
                type: r.type.label,
              ),
            );
      }
    });
  }

  Future<void> replaceHotspots(List<Hotspot> items) async {
    await _db.transaction(() async {
      await _db.delete(_db.hotspotRows).go();
      for (final h in items) {
        await _db
            .into(_db.hotspotRows)
            .insertOnConflictUpdate(
              HotspotRowsCompanion.insert(
                id: h.id,
                payload: jsonEncode(h.toJson()),
                type: h.type.label,
              ),
            );
      }
    });
  }

  Future<bool> get isEmpty async {
    final count = _db.resourceRows.id.count();
    final row = await (_db.selectOnly(
      _db.resourceRows,
    )..addColumns([count])).getSingle();
    return (row.read(count) ?? 0) == 0;
  }
}
