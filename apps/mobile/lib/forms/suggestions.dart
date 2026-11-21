/// The summary screen's suggested next steps (phase 4 design, lifecycle 9.6; forms 2.2 and 7.1):
/// the note types that the options picked in a note suggest, each a chip that adds one.
/// packages/forms/src/interp/suggestions.ts gives the same keys in the same order.
library;

import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'field_at.dart';
import 'paths.dart';

/// The `suggests` keys of the options picked in answers that count, each once, in the order the
/// definition lists them: fields as written, a field's options as listed. That order does not hang
/// on which entry picked an option, nor on when, so two phones show the same chips.
///
/// Only a stored code is picked: a choice's, a region's region, side or surface, a choice in a
/// grid's cell. A grid's fixed row is not picked, so a `suggests` on one suggests nothing. Every key
/// is given, the note's own type and the visit's other note types among them: the summary screen
/// leaves out those already in the visit.
List<String> suggestions(NoteTypeDef definition, Answers answers) {
  final picked = <Leaf, Set<String>>{};
  for (final MapEntry(key: path, value: value) in effectiveAnswers(definition, answers).entries) {
    final leaf = fieldAt(definition, path)?.leaf;
    if (leaf == null || leaf.holds is! CodesHolds) continue;
    picked.putIfAbsent(leaf, () => {}).addAll(value is String ? [value] : (value as List<Object?>).cast<String>());
  }
  final keys = <String>[];
  for (final node in definitionModel(definition).nodes) {
    for (final leaf in node.leaves) {
      // A group's or a grid's leaves are its fields'; each is read once, at its own field.
      final holds = leaf.holds;
      final codes = picked[leaf];
      if (leaf.node != node || holds is! CodesHolds || codes == null) continue;
      for (final option in holds.options) {
        if (option.suggests case final key? when codes.contains(option.code) && !keys.contains(key)) keys.add(key);
      }
    }
  }
  return keys;
}
