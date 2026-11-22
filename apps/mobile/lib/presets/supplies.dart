/// The supplies a note suggests, and the lines a bundle applies (phase 5 design 5.3; PRD main
/// 424-431, 441-442): the phone's copies of packages/presets/src/supplies.ts, which
/// packages/contract/test-vectors/supply-suggest.json pins with them. Phase 6 calls both.
///
/// What a note suggests is read from the answers the suggesting person may see, through the phone's
/// own interpreter (fieldAt, as supplies.ts reads them through the forms package's): a supply line
/// suggested from an answer hidden from them would tell them what was found.
library;

import '../forms/definition.dart';
import '../forms/field_at.dart';
import '../forms/paths.dart' show CodesHolds, NumberHolds, SimpleHolds, SimpleKind;
import 'models.dart';

/// One suggestion: an item, how many, and the map it came from.
typedef SupplySuggestion = ({String itemId, int qty, String mapId});

/// One line of a bundle as it is applied: its item, how many, and whether it starts checked.
typedef BundleLine = ({String itemId, int qty, bool checked});

/// A field supply map as [suggestSupplies] reads it: its preset id and its body.
typedef SupplyMap = ({String id, FieldSupplyMapBody body});

/// Where a map fired: once for the note (null), or in one entry of a repeating section.
typedef _Firing = ({String section, String entry});

/// What a note suggests: one suggestion for each map and item, the quantities of that map's lines
/// naming the item summed over every place the map fires; a sum of 0 is no suggestion. Maps come
/// in the order given, each map's items in the order its lines first name them; two maps naming one
/// item give a suggestion each, so whoever confirms them can tell what each came from.
///
/// [maps] are the team's active field supply maps, [items] the state of each of the team's items
/// by id (a line whose item is archived, or not among them, is skipped), [definition] the note's
/// own version, and [answers] what the suggesting person may see of the note, as `visibleAnswers`
/// (forms/visible.dart; forms 7.1) gives it them; where it gives null, for a note they may not see
/// at all, nothing is suggested. An answer hidden from them, or in a field a condition hides, is not
/// there to fire a map, nor to give a quantity, even to a map with no path. Nothing given is
/// changed.
List<SupplySuggestion> suggestSupplies({
  required List<SupplyMap> maps,
  required Map<String, PresetState> items,
  required String noteTypeKey,
  required NoteTypeDef definition,
  required Map<String, Object?> answers,
}) {
  final suggestions = <SupplySuggestion>[];
  for (final (:id, body: map) in maps) {
    if (map.noteTypeKey != noteTypeKey) continue;
    // With no path a map fires once for the note, whatever its answers ("wound care → 1 bandage").
    final firings = switch ((map.path, map.when)) {
      (null, _) => const <_Firing?>[null],
      (final path?, final test?) => _firingsOf(definition, answers, path, test),
      _ => const <_Firing?>[],
    };
    final totals = <String, int>{};
    for (final firing in firings) {
      for (final line in map.lines) {
        if (!_active(items, line.itemId)) continue;
        final qty = switch (line.qty) {
          FixedQty(:final count) => count,
          QtyFromPath(:final path) => _quantityAt(definition, answers, path, firing),
        };
        totals[line.itemId] = (totals[line.itemId] ?? 0) + qty;
      }
    }
    for (final MapEntry(key: itemId, value: qty) in totals.entries) {
      if (qty > 0) suggestions.add((itemId: itemId, qty: qty, mapId: id));
    }
  }
  return suggestions;
}

/// [bundle]'s lines given [multiplier] times ("- 2 kits +"), in order: a core line checked, an
/// optional one not, a line whose item is archived or not among [items] left out.
List<BundleLine> bundleLines(BundleBody bundle, Map<String, PresetState> items, int multiplier) => [
  for (final line in bundle.lines)
    if (_active(items, line.itemId)) (itemId: line.itemId, qty: line.qty * multiplier, checked: line.core),
];

bool _active(Map<String, PresetState> items, String id) => items[id] == PresetState.active;

/// Each place the note holds an answer at the map's path that passes its test: one in a note, or one
/// in each entry of a repeating section, so each wound dressed is its own firing. Only a field's or
/// a grid cell's answer fires, never an Other option's text or an entry's own time, and a path this
/// version of the note type lacks names no answer, so it never fires.
List<_Firing?> _firingsOf(NoteTypeDef definition, Map<String, Object?> answers, String path, MapWhen when) => [
  for (final MapEntry(key: at, :value) in answers.entries)
    if (fieldAt(definition, at) case final target?
        when (target.points == Points.field || target.points == Points.cell) &&
            target.key == path &&
            _passes(target, value, when))
      switch (target.entry) {
        final entry? => (section: target.section.id, entry: entry),
        null => null,
      },
];

/// `includes` a code: a choose-many holding it, or a choose-one that is it. `equals`: a choose-one
/// that is the value, a choose-many holding it alone, a number equal to it, a tick when it is true.
bool _passes(PathTarget target, Object? value, MapWhen when) {
  final holds = target.holds;
  if (when is WhenAnswered) return true;
  if (holds is CodesHolds) {
    final codes = value is List<Object?> ? value : [value];
    return switch (when) {
      WhenIncludes(:final code) => codes.contains(code),
      WhenEquals(value: final equals) => codes.length == 1 && codes.single == equals,
      WhenAnswered() => true,
    };
  }
  if (when is! WhenEquals) return false;
  return (holds is NumberHolds || (holds is SimpleHolds && holds.kind == SimpleKind.flag)) && value == when.value;
}

/// A quantity read from the note: the whole number from 0 to 99 at [fromPath], in the entry the map
/// fired in when the path is in its repeating section; anything else, or no answer, is 0.
int _quantityAt(NoteTypeDef definition, Map<String, Object?> answers, String fromPath, _Firing? firing) {
  final [section, ...rest] = fromPath.split('.');
  var at = fromPath;
  if (definition.sections.where((s) => s.id == section).firstOrNull?.repeat != null) {
    // validatePreset lets a map read a repeating section only from within the same one.
    if (firing == null || firing.section != section) return 0;
    at = [section, firing.entry, ...rest].join('.');
  }
  return switch (answers[at]) {
    final int n when n >= 0 && n <= 99 => n,
    // A whole number JSON wrote with a fraction (2.0), as JavaScript's Number.isInteger takes it.
    final double n when n == n.truncateToDouble() && n >= 0 && n <= 99 => n.toInt(),
    _ => 0,
  };
}
