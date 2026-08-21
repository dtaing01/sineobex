import '../../core/util/formatting.dart';
import 'enums.dart';

class InventoryItem {
  const InventoryItem({
    required this.id,
    required this.name,
    required this.stock,
    required this.min,
    required this.unit,
    required this.category,
    this.orderedAt,
    this.orderedBy,
    this.updatedAt,
  });

  final String id;
  final String name;
  final int stock;
  final int min;
  final String unit;
  final SupplyCategory category;
  final DateTime? orderedAt;
  final String? orderedBy;
  final DateTime? updatedAt;

  bool get isOutOfStock => stock == 0;

  /// The prototype's low-stock test is `stock < min`, which is also true when
  /// stock is 0; the UI checks out-of-stock first.
  bool get isLow => stock < min;

  bool get isOnOrder => orderedAt != null;

  StockStatus get status {
    if (isOutOfStock) return StockStatus.out;
    if (isLow) return StockStatus.low;
    return StockStatus.inStock;
  }

  /// `Math.min(100, (item.stock / (item.min * 1.5)) * 100)`
  double get fillPercent {
    if (min <= 0) return 100;
    final pct = (stock / (min * 1.5)) * 100;
    return pct.clamp(0, 100).toDouble();
  }

  String get orderedAtLabel =>
      orderedAt == null ? '' : Fmt.orderStamp(orderedAt!);

  InventoryItem copyWith({
    String? name,
    int? stock,
    int? min,
    String? unit,
    SupplyCategory? category,
    DateTime? orderedAt,
    String? orderedBy,
    bool clearOrder = false,
    DateTime? updatedAt,
  }) => InventoryItem(
    id: id,
    name: name ?? this.name,
    stock: stock ?? this.stock,
    min: min ?? this.min,
    unit: unit ?? this.unit,
    category: category ?? this.category,
    orderedAt: clearOrder ? null : (orderedAt ?? this.orderedAt),
    orderedBy: clearOrder ? null : (orderedBy ?? this.orderedBy),
    updatedAt: updatedAt ?? this.updatedAt,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'stock': stock,
    'min': min,
    'unit': unit,
    'category': category.label,
    'orderedAt': orderedAt?.toIso8601String(),
    'orderedBy': orderedBy,
    'updatedAt': updatedAt?.toIso8601String(),
  };

  factory InventoryItem.fromJson(Map<String, dynamic> j) => InventoryItem(
    id: j['id'] as String,
    name: j['name'] as String,
    stock: (j['stock'] as num).toInt(),
    min: (j['min'] as num).toInt(),
    unit: j['unit'] as String,
    category: SupplyCategory.fromLabel(j['category'] as String?),
    orderedAt: Fmt.tryParseIso(j['orderedAt'] as String?),
    orderedBy: j['orderedBy'] as String?,
    updatedAt: Fmt.tryParseIso(j['updatedAt'] as String?),
  );
}

/// One line of the Field Usage Log. In the prototype this was three hardcoded
/// literals; here it is derived from encounters that recorded supplies.
class SupplyUsageLog {
  const SupplyUsageLog({
    required this.id,
    required this.item,
    required this.quantityLabel,
    required this.location,
    required this.at,
  });

  final String id;
  final String item;
  final String quantityLabel;
  final String location;
  final DateTime at;

  /// Renders as "10:45" today, "Yesterday" for the previous day, else a date —
  /// matching the prototype's mixed-format log.
  String relativeLabel({DateTime? now}) {
    final n = now ?? DateTime.now();
    final today = DateTime(n.year, n.month, n.day);
    final day = DateTime(at.year, at.month, at.day);
    final diff = today.difference(day).inDays;
    if (diff == 0) return Fmt.time24(at);
    if (diff == 1) return 'Yesterday';
    return Fmt.isoDate(at);
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'item': item,
    'quantityLabel': quantityLabel,
    'location': location,
    'at': at.toIso8601String(),
  };

  factory SupplyUsageLog.fromJson(Map<String, dynamic> j) => SupplyUsageLog(
    id: j['id'] as String,
    item: j['item'] as String,
    quantityLabel: j['quantityLabel'] as String,
    location: j['location'] as String,
    at: DateTime.parse(j['at'] as String),
  );
}
