/// The supplies a note suggests, and the lines a bundle applies (phase 5 design 5.3; PRD main
/// 424-431, 441-442): the phone's copies of packages/presets/src/supplies.ts, which
/// packages/contract/test-vectors/supply-suggest.json pins with them. Phase 6 calls both.
///
/// Written ahead of its code (P2-tests): every body that throws is P2-supplies'.
library;

import '../forms/definition.dart';
import 'models.dart';

/// One suggestion: an item, how many, and the map it came from.
typedef SupplySuggestion = ({String itemId, int qty, String mapId});

/// One line of a bundle as it is applied: its item, how many, and whether it starts checked.
typedef BundleLine = ({String itemId, int qty, bool checked});

/// A field supply map as [suggestSupplies] reads it: its preset id and its body.
typedef SupplyMap = ({String id, FieldSupplyMapBody body});

/// What a note suggests: one suggestion for each map and item, the quantities of that map's lines
/// naming the item summed over every place the map fires; a sum of 0 is no suggestion. Maps come
/// in the order given, each map's items in the order its lines first name them; two maps naming one
/// item give a suggestion each.
///
/// [maps] are the team's active field supply maps, [items] the state of each of the team's items
/// by id (a line whose item is archived, or not among them, is skipped), [definition] the note's
/// own version, and [answers] what the suggesting person may see of the note (`visibleAnswers`,
/// forms 7.1): an answer hidden from them is not there to fire a map. Nothing given is changed.
List<SupplySuggestion> suggestSupplies({
  required List<SupplyMap> maps,
  required Map<String, PresetState> items,
  required String noteTypeKey,
  required NoteTypeDef definition,
  required Map<String, Object?> answers,
}) => throw UnimplementedError('P2-supplies');

/// [bundle]'s lines given [multiplier] times ("- 2 kits +"), in order: a core line checked, an
/// optional one not, a line whose item is archived or not among [items] left out.
List<BundleLine> bundleLines(BundleBody bundle, Map<String, PresetState> items, int multiplier) =>
    throw UnimplementedError('P2-supplies');
