/// The team presets a phone holds (phase 5 design 4.4, 5.3; D128): the body of each kind, read as
/// the server's schemas read it (packages/presets/src/schemas.ts).
/// packages/contract/test-vectors/preset-bodies.json pins both sides.
///
/// [parsePreset] reads a body the server sent: every field this phone knows, with a default filled
/// in where the body leaves out a field that has one (a bundle's prompt, a flag's criteria). A
/// field it does not know is ignored, so an older phone reads a body a later phase grew; a kind it
/// does not know is skipped. A body the server's schema would refuse is refused, by where it is at
/// fault and never by what it holds: an admin can type anything into a name (12.1, risk 7).
///
/// Written ahead of its code (P2-tests): every body that throws is P2-models'.
library;

/// The eight kinds, in the order the pages list them. Phase 10 adds `billing_code_map`, which no
/// phone reads.
enum PresetKind {
  orderCategory,
  item,
  bundle,
  flag,
  fieldSupplyMap,
  conditionSupplyMap,
  bag,
  settings;

  /// The kind named [code] on the wire (`order_category`), or null for one this phone does not
  /// know.
  static PresetKind? byCode(String code) => throw UnimplementedError('P2-models');

  /// Its name on the wire and in the `presets` table: `order_category`.
  String get code => throw UnimplementedError('P2-models');
}

/// A preset is active, or archived and kept for its name (5.1). The names are the wire values.
enum PresetState {
  active,
  archived;

  /// The state named [code] on the wire, or null for one this phone does not know.
  static PresetState? byCode(String code) => throw UnimplementedError('P2-models');
}

/// The eight colours a flag may have, in the palette's order (PLAN-OPEN TM-36 in schemas.ts). A
/// flag is never shown by its colour alone: a pill reads the colour's plain name, then the flag's
/// ("Red · High").
enum FlagColor {
  red,
  orange,
  yellow,
  green,
  teal,
  blue,
  purple,
  grey;

  /// The colour whose key is [code] (`red`), or null for one this phone does not know.
  static FlagColor? byCode(String code) => throw UnimplementedError('P2-models');

  /// The key a flag's body holds: `red`.
  String get code => throw UnimplementedError('P2-models');

  /// The plain name a pill shows before the flag's own: `Red`.
  String get colorName => throw UnimplementedError('P2-models');
}

/// What an order category's items are. The names are the wire values.
enum CategoryBehaviour { supply, medication, lab }

/// A flag's tier: a risk level (one at a time) or a condition (several). The names are the wire
/// values.
enum FlagTier { primary, secondary }

/// A body [parsePreset] refuses: the server's schema for its kind would refuse it. [path] names the
/// field at fault as the vectors write one (its parts joined by dots, an array index as its number,
/// '' for the body itself); [problem] says what is wrong in a few words. Neither ever holds what
/// the body holds.
class PresetBodyRefused implements Exception {
  const PresetBodyRefused(this.path, this.problem);

  final String path;
  final String problem;

  @override
  String toString() => 'PresetBodyRefused(${path.isEmpty ? 'body' : path}: $problem)';
}

/// The body of a preset of any kind.
sealed class PresetBody {
  const PresetBody();

  /// The preset's name, which its head copies.
  String get name;

  /// The body as the server's schema parses it: every field this phone knows, defaults filled in,
  /// an optional field left out where the body has none.
  Map<String, Object?> toJson();
}

/// `order_category`.
final class OrderCategoryBody extends PresetBody {
  const OrderCategoryBody({required this.name, required this.behaviour, required this.sort});

  @override
  final String name;

  /// Fixed at creation: a lab records a result, a medication makes an item Medical.
  final CategoryBehaviour behaviour;

  /// Where the pages list it, lowest first: 0 to 1,000,000.
  final int sort;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// `item`.
final class ItemBody extends PresetBody {
  const ItemBody({
    required this.name,
    required this.categoryId,
    required this.unit,
    required this.medical,
    required this.captureLot,
    required this.result,
  });

  @override
  final String name;
  final String categoryId;

  /// The dispensing unit it is counted in, fixed at creation.
  final String unit;
  final bool medical;

  /// Lot and expiry are recorded when it is given.
  final bool captureLot;

  /// What a lab test records; null for every item that records none.
  final LabResult? result;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// What a lab test records (PLAN-OPEN BM-66 in schemas.ts).
sealed class LabResult {
  const LabResult();
}

/// `{type: 'choice', options}`: one of 2 to 12 options.
final class ChoiceResult extends LabResult {
  const ChoiceResult(this.options);
  final List<String> options;
}

/// `{type: 'number', unit}`.
final class NumberResult extends LabResult {
  const NumberResult(this.unit);
  final String unit;
}

/// `bundle`.
final class BundleBody extends PresetBody {
  const BundleBody({required this.name, required this.medical, required this.prompt, required this.lines});

  @override
  final String name;

  /// The Medical or Non-Medical tag.
  final bool medical;

  /// Asked before the bundle is applied; '' asks nothing (the default).
  final String prompt;

  /// 1 to 40, each naming its item once.
  final List<BundleItem> lines;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// A bundle's line: a core line is checked when the bundle is applied, an optional one is not.
final class BundleItem {
  const BundleItem({required this.itemId, required this.qty, required this.core});
  final String itemId;
  final int qty;
  final bool core;
}

/// `flag`.
final class FlagBody extends PresetBody {
  const FlagBody({
    required this.name,
    required this.tier,
    required this.criteria,
    required this.color,
    required this.rank,
    required this.sensitive,
  });

  @override
  final String name;
  final FlagTier tier;

  /// Text for people; '' when none (the default).
  final String criteria;
  final FlagColor color;

  /// Its place in its tier, lowest first: 0 to 1,000,000.
  final int rank;

  /// Hidden from whoever may not see a sensitive problem; never on a primary flag.
  final bool sensitive;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// `field_supply_map`.
final class FieldSupplyMapBody extends PresetBody {
  const FieldSupplyMapBody({
    required this.name,
    required this.noteTypeKey,
    required this.path,
    required this.when,
    required this.lines,
  });

  @override
  final String name;
  final String noteTypeKey;

  /// The answer path it fires on, written without an entry part; null with [when] null: the map
  /// fires once for every note of the type.
  final String? path;
  final MapWhen? when;

  /// 1 to 10; an item may be named twice.
  final List<FieldMapLine> lines;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// What a field supply map fires on at its path: exactly one test.
sealed class MapWhen {
  const MapWhen();
}

/// `{equals: value}`: an option code, a number, or `true`.
final class WhenEquals extends MapWhen {
  const WhenEquals(this.value);
  final Object value;
}

/// `{includes: code}`.
final class WhenIncludes extends MapWhen {
  const WhenIncludes(this.code);
  final String code;
}

/// `{answered: true}`.
final class WhenAnswered extends MapWhen {
  const WhenAnswered();
}

/// A field supply map's line.
final class FieldMapLine {
  const FieldMapLine({required this.itemId, required this.qty});
  final String itemId;
  final FieldMapQty qty;
}

/// How many a field supply map's line suggests.
sealed class FieldMapQty {
  const FieldMapQty();
}

/// A count of its own, 1 to 99.
final class FixedQty extends FieldMapQty {
  const FixedQty(this.count);
  final int count;
}

/// `{fromPath}`: a whole number the note holds, read where the map fires.
final class QtyFromPath extends FieldMapQty {
  const QtyFromPath(this.path);
  final String path;
}

/// `condition_supply_map`.
final class ConditionSupplyMapBody extends PresetBody {
  const ConditionSupplyMapBody({required this.name, required this.codes, required this.lines});

  @override
  final String name;

  /// 1 to 20 ICD-10-CM codes, exact codes only.
  final List<String> codes;

  /// 1 to 10.
  final List<ConditionMapLine> lines;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// A condition supply map's line.
final class ConditionMapLine {
  const ConditionMapLine({required this.itemId, required this.qtyPerPatient});
  final String itemId;
  final int qtyPerPatient;
}

/// `bag`.
final class BagBody extends PresetBody {
  const BagBody({required this.name, required this.minimums});

  @override
  final String name;

  /// 0 to 200, each naming its item once.
  final List<Minimum> minimums;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// What a bag holds at least of an item: 1 to 999.
final class Minimum {
  const Minimum({required this.itemId, required this.min});
  final String itemId;
  final int min;
}

/// `settings`: the team's one settings preset.
final class SettingsBody extends PresetBody {
  const SettingsBody({
    required this.name,
    required this.bagMinimumsOn,
    required this.newBagMinimums,
    required this.problemCheckDays,
  });

  /// Always `Team settings`.
  @override
  final String name;
  final bool bagMinimumsOn;

  /// A new bag's minimums, as a bag's are.
  final List<Minimum> newBagMinimums;

  /// When a New or Ongoing problem is due a status check: 7 to 365 days.
  final int problemCheckDays;

  @override
  Map<String, Object?> toJson() => throw UnimplementedError('P2-models');
}

/// Reads the body of a preset of [kind] (the wire name) as the server's schema for it reads it:
/// the kind's body class, its defaults filled in and a field this phone does not know ignored.
/// Null for a kind this phone does not know, which is skipped. Throws [PresetBodyRefused] for a body
/// the schema would refuse. [json] is left as it was.
PresetBody? parsePreset(String kind, Object? json) => throw UnimplementedError('P2-models');
