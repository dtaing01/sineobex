/// The team presets a phone holds (phase 5 design 4.4, 5.3; D128): the body of each kind, read as
/// the server's schemas read it (packages/presets/src/schemas.ts).
/// packages/contract/test-vectors/preset-bodies.json pins both sides.
///
/// [parsePreset] reads a body the server sent: every field this phone knows, with a default filled
/// in where the body leaves out a field that has one (a bundle's prompt, a flag's criteria). A
/// field it does not know is ignored, so an older phone reads a body a later phase grew; a kind it
/// does not know is skipped. A body the server's schema would refuse is refused, by where it is at
/// fault and never by what it holds: an admin can type anything into a name (12.1, risk 7).
library;

import '../sync/entities.dart' show icd10cmCode, isUuid;

/// The eight kinds, in the order the pages list them. Phase 10 adds `billing_code_map`, which no
/// phone reads.
enum PresetKind {
  orderCategory('order_category'),
  item('item'),
  bundle('bundle'),
  flag('flag'),
  fieldSupplyMap('field_supply_map'),
  conditionSupplyMap('condition_supply_map'),
  bag('bag'),
  settings('settings');

  const PresetKind(this.code);

  /// Its name on the wire and in the `presets` table: `order_category`.
  final String code;

  /// The kind named [code] on the wire (`order_category`), or null for one this phone does not
  /// know.
  static PresetKind? byCode(String code) => values.where((k) => k.code == code).firstOrNull;
}

/// A preset is active, or archived and kept for its name (5.1). The names are the wire values.
enum PresetState {
  active,
  archived;

  /// The state named [code] on the wire, or null for one this phone does not know.
  static PresetState? byCode(String code) => values.asNameMap()[code];
}

/// The eight colours a flag may have, in the palette's order (PLAN-OPEN TM-36 in schemas.ts). A
/// flag is never shown by its colour alone: a pill reads the colour's plain name, then the flag's
/// ("Red · High").
enum FlagColor {
  red('Red'),
  orange('Orange'),
  yellow('Yellow'),
  green('Green'),
  teal('Teal'),
  blue('Blue'),
  purple('Purple'),
  grey('Grey');

  const FlagColor(this.colorName);

  /// The plain name a pill shows before the flag's own: `Red`.
  final String colorName;

  /// The colour whose key is [code] (`red`), or null for one this phone does not know.
  static FlagColor? byCode(String code) => values.asNameMap()[code];

  /// The key a flag's body holds: `red`.
  String get code => name;
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
  Map<String, Object?> toJson() => {'name': name, 'behaviour': behaviour.name, 'sort': sort};
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

  // `result` is never left out: null says the item records none.
  @override
  Map<String, Object?> toJson() => {
    'name': name,
    'categoryId': categoryId,
    'unit': unit,
    'medical': medical,
    'captureLot': captureLot,
    'result': result?.toJson(),
  };
}

/// What a lab test records (PLAN-OPEN BM-66 in schemas.ts).
sealed class LabResult {
  const LabResult();

  Map<String, Object?> toJson();
}

/// `{type: 'choice', options}`: one of 2 to 12 options.
final class ChoiceResult extends LabResult {
  const ChoiceResult(this.options);
  final List<String> options;

  @override
  Map<String, Object?> toJson() => {
    'type': 'choice',
    'options': [...options],
  };
}

/// `{type: 'number', unit}`.
final class NumberResult extends LabResult {
  const NumberResult(this.unit);
  final String unit;

  @override
  Map<String, Object?> toJson() => {'type': 'number', 'unit': unit};
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
  Map<String, Object?> toJson() => {
    'name': name,
    'medical': medical,
    'prompt': prompt,
    'lines': [for (final l in lines) l.toJson()],
  };
}

/// A bundle's line: a core line is checked when the bundle is applied, an optional one is not.
final class BundleItem {
  const BundleItem({required this.itemId, required this.qty, required this.core});
  final String itemId;
  final int qty;
  final bool core;

  Map<String, Object?> toJson() => {'itemId': itemId, 'qty': qty, 'core': core};
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
  Map<String, Object?> toJson() => {
    'name': name,
    'tier': tier.name,
    'criteria': criteria,
    'color': color.code,
    'rank': rank,
    'sensitive': sensitive,
  };
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
  Map<String, Object?> toJson() => {
    'name': name,
    'noteTypeKey': noteTypeKey,
    'path': ?path,
    'when': ?when?.toJson(),
    'lines': [for (final l in lines) l.toJson()],
  };
}

/// What a field supply map fires on at its path: exactly one test.
sealed class MapWhen {
  const MapWhen();

  Map<String, Object?> toJson();
}

/// `{equals: value}`: an option code, a number, or `true`.
final class WhenEquals extends MapWhen {
  const WhenEquals(this.value);
  final Object value;

  @override
  Map<String, Object?> toJson() => {'equals': value};
}

/// `{includes: code}`.
final class WhenIncludes extends MapWhen {
  const WhenIncludes(this.code);
  final String code;

  @override
  Map<String, Object?> toJson() => {'includes': code};
}

/// `{answered: true}`.
final class WhenAnswered extends MapWhen {
  const WhenAnswered();

  @override
  Map<String, Object?> toJson() => {'answered': true};
}

/// A field supply map's line.
final class FieldMapLine {
  const FieldMapLine({required this.itemId, required this.qty});
  final String itemId;
  final FieldMapQty qty;

  Map<String, Object?> toJson() => {'itemId': itemId, 'qty': qty.toJson()};
}

/// How many a field supply map's line suggests.
sealed class FieldMapQty {
  const FieldMapQty();

  /// As a body holds it: a number, or `{fromPath}`.
  Object toJson();
}

/// A count of its own, 1 to 99.
final class FixedQty extends FieldMapQty {
  const FixedQty(this.count);
  final int count;

  @override
  Object toJson() => count;
}

/// `{fromPath}`: a whole number the note holds, read where the map fires.
final class QtyFromPath extends FieldMapQty {
  const QtyFromPath(this.path);
  final String path;

  @override
  Object toJson() => {'fromPath': path};
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
  Map<String, Object?> toJson() => {
    'name': name,
    'codes': [...codes],
    'lines': [for (final l in lines) l.toJson()],
  };
}

/// A condition supply map's line.
final class ConditionMapLine {
  const ConditionMapLine({required this.itemId, required this.qtyPerPatient});
  final String itemId;
  final int qtyPerPatient;

  Map<String, Object?> toJson() => {'itemId': itemId, 'qtyPerPatient': qtyPerPatient};
}

/// `bag`.
final class BagBody extends PresetBody {
  const BagBody({required this.name, required this.minimums});

  @override
  final String name;

  /// 0 to 200, each naming its item once.
  final List<Minimum> minimums;

  @override
  Map<String, Object?> toJson() => {
    'name': name,
    'minimums': [for (final m in minimums) m.toJson()],
  };
}

/// What a bag holds at least of an item: 1 to 999.
final class Minimum {
  const Minimum({required this.itemId, required this.min});
  final String itemId;
  final int min;

  Map<String, Object?> toJson() => {'itemId': itemId, 'min': min};
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
  Map<String, Object?> toJson() => {
    'name': name,
    'bagMinimumsOn': bagMinimumsOn,
    'newBagMinimums': [for (final m in newBagMinimums) m.toJson()],
    'problemCheckDays': problemCheckDays,
  };
}

/// Reads the body of a preset of [kind] (the wire name) as the server's schema for it reads it:
/// the kind's body class, its defaults filled in and a field this phone does not know ignored.
/// Null for a kind this phone does not know, which is skipped. Throws [PresetBodyRefused] for a body
/// the schema would refuse. [json] is left as it was.
PresetBody? parsePreset(String kind, Object? json) {
  final known = PresetKind.byCode(kind);
  if (known == null) return null;
  final body = _Fields(json, '');
  return switch (known) {
    PresetKind.orderCategory => OrderCategoryBody(
      name: body.name(),
      behaviour: body.oneOf('behaviour', CategoryBehaviour.values),
      sort: body.whole('sort', 0, 1000000),
    ),
    PresetKind.item => ItemBody(
      name: body.name(),
      categoryId: body.id('categoryId'),
      unit: body.text('unit', 1, 20),
      medical: body.boolean('medical'),
      captureLot: body.boolean('captureLot'),
      result: _labResult(body, 'result'),
    ),
    PresetKind.bundle => BundleBody(
      name: body.name(),
      medical: body.boolean('medical'),
      prompt: body.has('prompt') ? body.text('prompt', 0, 300) : '',
      lines: _oncePerItem(
        body.objects(
          'lines',
          1,
          40,
          (line) => BundleItem(itemId: line.id('itemId'), qty: line.whole('qty', 1, 99), core: line.boolean('core')),
        ),
        body.at('lines'),
        (line) => line.itemId,
      ),
    ),
    PresetKind.flag => FlagBody(
      name: body.name(),
      tier: body.oneOf('tier', FlagTier.values),
      criteria: body.has('criteria') ? body.text('criteria', 0, 500) : '',
      color: body.oneOf('color', FlagColor.values),
      rank: body.whole('rank', 0, 1000000),
      sensitive: body.boolean('sensitive'),
    ),
    PresetKind.fieldSupplyMap => _fieldSupplyMap(body),
    PresetKind.conditionSupplyMap => ConditionSupplyMapBody(
      name: body.name(),
      codes: List.unmodifiable([
        for (final (i, code) in body.list('codes', 1, 20).indexed)
          _matching(code, '${body.at('codes')}.$i', icd10cmCode),
      ]),
      lines: body.objects(
        'lines',
        1,
        10,
        (line) => ConditionMapLine(itemId: line.id('itemId'), qtyPerPatient: line.whole('qtyPerPatient', 1, 99)),
      ),
    ),
    PresetKind.bag => BagBody(name: body.name(), minimums: _minimums(body, 'minimums')),
    PresetKind.settings => SettingsBody(
      // One settings preset per team, never removed, so its name is no choice.
      name: body.value('name') == _settingsName ? _settingsName : throw body.refused('name', 'not the settings name'),
      bagMinimumsOn: body.boolean('bagMinimumsOn'),
      newBagMinimums: _minimums(body, 'newBagMinimums'),
      // PLAN-OPEN (BM-76) in schemas.ts: 7 to 365 days.
      problemCheckDays: body.whole('problemCheckDays', 7, 365),
    ),
  };
}

const _settingsName = 'Team settings';

// The patterns of packages/forms/src/types.ts that schemas.ts reads: a note type key, an option code
// and one part of an answer path.
final _noteTypeKey = RegExp(r'^[a-z][a-z0-9_]{1,60}$');
final _optionCode = RegExp(r'^[a-z][a-z0-9_]{0,40}$');

/// A field's or a grid cell's answer path, 2 to 4 parts, written without an entry part as `mapsTo`
/// writes one: a map names a field of the note type, whichever entry holds the answer (forms 2.2).
final _answerPath = RegExp(r'^[a-z][a-zA-Z0-9_]{0,60}(?:\.[a-z][a-zA-Z0-9_]{0,60}){1,3}$');

LabResult? _labResult(_Fields body, String key) {
  // Never left out: null says the item records none.
  final json = body.value(key);
  if (json == null) return null;
  final result = _Fields(json, body.at(key));
  return switch (result.value('type')) {
    'choice' => ChoiceResult(_options(result)),
    'number' => NumberResult(result.text('unit', 1, 20)),
    _ => throw result.refused('type', 'not a result type'),
  };
}

/// A choice result's options: two a person cannot tell apart on a result screen are one, and the
/// later of them is refused.
List<String> _options(_Fields result) {
  final at = result.at('options');
  final options = [for (final (i, option) in result.list('options', 2, 12).indexed) _text(option, '$at.$i', 1, 40)];
  final seen = <String>{};
  for (final (i, option) in options.indexed) {
    if (!seen.add(_folded(option))) throw PresetBodyRefused('$at.$i', 'option twice');
  }
  return List.unmodifiable(options);
}

/// An option as schemas.ts folds it to tell two apart, with JavaScript's `toLowerCase`, so that two
/// options the server tells apart are never one here and no body it stores is refused. Dart's
/// `toLowerCase` folds as JavaScript's does but for two letters: the dotted capital I ('İ'), which
/// JavaScript lowers to 'i' and a combining dot, as this does; and the capital sigma, which
/// JavaScript lowers by its place in a word, so it is left as it is. Dart also leaves some letters
/// JavaScript folds (Cherokee among them): two such options are one on the server and two here.
String _folded(String option) =>
    [for (final part in option.split('\u03a3')) part.replaceAll('\u0130', 'i\u0307').toLowerCase()].join('\u03a3');

FieldSupplyMapBody _fieldSupplyMap(_Fields body) {
  final name = body.name();
  final noteTypeKey = body.matching('noteTypeKey', _noteTypeKey);
  final path = body.has('path') ? body.matching('path', _answerPath) : null;
  final when = body.has('when') ? _when(_Fields(body.value('when'), body.at('when'))) : null;
  final lines = body.objects(
    'lines',
    1,
    10,
    (line) => FieldMapLine(itemId: line.id('itemId'), qty: _quantity(line, 'qty')),
  );
  // Both there, or both left out: left out, the map fires once for every note of the type.
  if (path != null && when == null) throw body.refused('when', 'a path without a when');
  if (when != null && path == null) throw body.refused('path', 'a when without a path');
  return FieldSupplyMapBody(name: name, noteTypeKey: noteTypeKey, path: path, when: when, lines: lines);
}

/// Exactly one test: two together are no test at all, as the server's union of objects reads them.
MapWhen _when(_Fields when) {
  final tests = [
    for (final test in const ['equals', 'includes', 'answered'])
      if (when.has(test)) test,
  ];
  if (tests.length != 1) throw when.refused('', tests.isEmpty ? 'no test' : 'more than one test');
  return switch (tests.single) {
    'equals' => WhenEquals(switch (when.value('equals')) {
      final String code when _optionCode.hasMatch(code) => code,
      final num n when n.isFinite => n,
      true => true,
      _ => throw when.refused('equals', 'not a code, a number or true'),
    }),
    'includes' => WhenIncludes(when.matching('includes', _optionCode)),
    _ => when.value('answered') == true ? const WhenAnswered() : throw when.refused('answered', 'not true'),
  };
}

/// A count of its own, or a number the note holds, read where the map fires (supplies.dart).
FieldMapQty _quantity(_Fields line, String key) {
  final json = line.value(key);
  if (json is Map<String, Object?>) return QtyFromPath(_Fields(json, line.at(key)).matching('fromPath', _answerPath));
  return FixedQty(_whole(json, line.at(key), 1, 99));
}

/// What a bag holds at least; the settings' template for a new bag is the same list.
List<Minimum> _minimums(_Fields body, String key) => _oncePerItem(
  body.objects(key, 0, 200, (minimum) => Minimum(itemId: minimum.id('itemId'), min: minimum.whole('min', 1, 999))),
  body.at(key),
  (minimum) => minimum.itemId,
);

/// [lines] as read, each naming its item at most once: the later line naming one is refused at its
/// `itemId`, as schemas.ts refuses it.
List<T> _oncePerItem<T>(List<T> lines, String at, String Function(T line) itemId) {
  final seen = <String>{};
  for (final (i, line) in lines.indexed) {
    if (!seen.add(itemId(line))) throw PresetBodyRefused('$at.$i.itemId', 'item twice');
  }
  return lines;
}

/// One object of a body, read as the schemas read it: a key is there or not, and null is a value
/// there, never one left out (a prompt of null is refused, not filled in). A key the schemas do not
/// name is never read.
final class _Fields {
  _Fields(Object? json, this.path)
    : json = json is Map<String, Object?> ? json : throw PresetBodyRefused(path, 'not an object');

  final Map<String, Object?> json;

  /// Where the object is in the body, '' for the body itself.
  final String path;

  String at(String key) => key.isEmpty ? path : (path.isEmpty ? key : '$path.$key');
  PresetBodyRefused refused(String key, String problem) => PresetBodyRefused(at(key), problem);

  bool has(String key) => json.containsKey(key);
  Object? value(String key) => json.containsKey(key) ? json[key] : throw refused(key, 'missing');

  String name() => text('name', 1, 80);
  String text(String key, int min, int max) => _text(value(key), at(key), min, max);
  String matching(String key, RegExp pattern) => _matching(value(key), at(key), pattern);

  /// Another preset of the same team: a UUID as the server's `z.string().uuid()` takes one.
  String id(String key) => switch (value(key)) {
    final String id when isUuid(id) => id,
    _ => throw refused(key, 'not an id'),
  };

  bool boolean(String key) => switch (value(key)) {
    final bool b => b,
    _ => throw refused(key, 'not true or false'),
  };

  int whole(String key, int min, int max) => _whole(value(key), at(key), min, max);

  /// One of [values], by its wire name.
  T oneOf<T extends Enum>(String key, List<T> values) => switch (value(key)) {
    final String code => values.asNameMap()[code] ?? (throw refused(key, 'not one of its values')),
    _ => throw refused(key, 'not one of its values'),
  };

  List<Object?> list(String key, int min, int max) {
    final list = switch (value(key)) {
      final List<Object?> list => list,
      _ => throw refused(key, 'not a list'),
    };
    if (list.length < min) throw refused(key, 'too few');
    if (list.length > max) throw refused(key, 'too many');
    return list;
  }

  /// A list of objects, each read by [read] at its index.
  List<T> objects<T>(String key, int min, int max, T Function(_Fields item) read) =>
      List.unmodifiable([for (final (i, item) in list(key, min, max).indexed) read(_Fields(item, '${at(key)}.$i'))]);
}

/// A text as a body holds it: [min] to [max] code points, as zod and the database's length() count
/// them (a lone surrogate is one), and never starting or ending with white space: the schemas refuse
/// such a text, never trim it.
String _text(Object? json, String at, int min, int max) {
  if (json is! String) throw PresetBodyRefused(at, 'not text');
  final length = json.runes.length;
  if (length < min) throw PresetBodyRefused(at, 'too short');
  if (length > max) throw PresetBodyRefused(at, 'too long');
  if (json.isNotEmpty && (_space(json.codeUnitAt(0)) || _space(json.codeUnitAt(json.length - 1)))) {
    throw PresetBodyRefused(at, 'starts or ends with a space');
  }
  return json;
}

/// The white space and line ends JavaScript's `trim` takes off: Dart's `trim` also takes U+0085,
/// which the server keeps.
bool _space(int unit) =>
    (unit >= 0x09 && unit <= 0x0d) ||
    unit == 0x20 ||
    unit == 0xa0 ||
    unit == 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit == 0x2028 ||
    unit == 0x2029 ||
    unit == 0x202f ||
    unit == 0x205f ||
    unit == 0x3000 ||
    unit == 0xfeff;

String _matching(Object? json, String at, RegExp pattern) => switch (json) {
  final String s when pattern.hasMatch(s) => s,
  _ => throw PresetBodyRefused(at, 'not in its format'),
};

/// A whole number from [min] to [max], as zod's `int()` takes one: JavaScript reads `3.0` and `1e2`
/// as the whole numbers they are, where Dart's jsonDecode reads doubles.
int _whole(Object? json, String at, int min, int max) {
  if (json is! num || !json.isFinite || (json is double && json != json.truncateToDouble())) {
    throw PresetBodyRefused(at, 'not a whole number');
  }
  if (json < min || json > max) throw PresetBodyRefused(at, 'out of range');
  return json.toInt();
}
