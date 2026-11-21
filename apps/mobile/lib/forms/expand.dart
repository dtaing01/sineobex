/// Expand on the Quick encounter (phase 4 design, forms 6.4 and 7.1): the answers the phone writes
/// into the full note it creates, as ordinary changes, so nothing the person filled in is typed
/// again. The quick note keeps its own answers. packages/forms/src/interp/expand.ts writes the same
/// answers at the same paths and leaves out the same ones.
library;

import 'check_answer.dart';
import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'field_at.dart';
import 'paths.dart';

/// For each repeating section of the full note, by its id, the entry Expand writes into: the ID the
/// phone made for it and the time it is added, its `entryAt`. A pure function makes neither.
typedef NewEntries = Map<String, ({String id, String at})>;

/// A quick answer Expand did not write, for the person to see: where it is, where it would go, why not.
class LeftOut {
  const LeftOut({required this.path, required this.target, required this.problem});

  /// The quick note's path.
  final String path;

  /// The full note's path, without an entry's part, as `mapsTo` writes it.
  final String target;
  final AnswerProblem problem;

  Map<String, String> toJson() => {'path': path, 'target': target, 'problem': problem.code};
}

class Expansion {
  const Expansion({required this.answers, required this.leftOut});

  /// Path to value in the full note, in code-unit key order, an entry's `entryAt` among them: the
  /// order the phone writes them in as changes.
  final Map<String, Object> answers;

  /// In the quick definition's order.
  final List<LeftOut> leftOut;

  Map<String, Object> toJson() => {
    'answers': answers,
    'leftOut': [for (final l in leftOut) l.toJson()],
  };
}

/// What Expand writes into a new note on [fullDefinition], from [answers] of a quick note on
/// [quickDefinition], the draft's own version: each answer that counts of a field whose `mapsTo`
/// names this full note type, at the target's path, with what follows the field's own path (a side,
/// `_other`, a region's part) kept. A target in a repeating section goes into the entry
/// [newEntryIds] gives for that section, and that entry's `entryAt` is written with the first
/// answer that goes into it; an entry nothing goes into is not made.
///
/// The validator holds the newest quick version to the newest full one, but a draft on an older
/// quick version is not (6.4). PLAN-OPEN: what Expand does with such a draft (forms.md 10.1 #12).
/// The default built, for every draft alike: an answer is written only where the full version takes
/// it (checkAnswer) and is otherwise left out and listed. A choose-many is written in the full
/// field's order of options, the order a stored value must have. A number in another unit than the
/// full field's is left out as wrong_type: the stored number would be read in the full field's
/// unit, which checkAnswer cannot see.
///
/// Throws an [ArgumentError] when an answer goes into a repeating section that [newEntryIds] gives
/// no usable entry for: the caller makes one for every repeating section of the full note.
Expansion expandQuick(
  NoteTypeDef quickDefinition,
  Answers answers,
  NoteTypeDef fullDefinition,
  NewEntries newEntryIds,
) {
  final counted = effectiveAnswers(quickDefinition, answers);
  final full = definitionModel(fullDefinition);
  final written = <(String, Object)>[];
  final leftOut = <LeftOut>[];
  final entered = <String>{};

  for (final node in definitionModel(quickDefinition).nodes) {
    final mapsTo = node.field.mapsTo;
    final own = node.base?.join('.');
    // The validator lets no grid cell and no field of a repeating section map (6.4).
    if (mapsTo == null || own == null || node.section.section.repeat != null) continue;
    final colon = mapsTo.indexOf(':');
    if (colon < 0 || mapsTo.substring(0, colon) != fullDefinition.key) continue;
    final base = mapsTo.substring(colon + 1);
    final section = full.nodes.where((n) => n.base?.join('.') == base).firstOrNull?.section.section;
    final repeat = section?.repeat != null ? section!.id : null;

    for (final leaf in node.leaves) {
      final answer = counted[leaf.key];
      if (answer == null) continue;
      final target = base + leaf.key.substring(own.length);
      final entry = repeat == null ? null : _entryOf(fullDefinition, repeat, newEntryIds);
      final path = entry == null ? target : '$repeat.$entry${target.substring(repeat!.length)}';
      final holds = fieldAt(fullDefinition, path)?.holds;
      final value = _inOrder(holds, answer);
      final problem = _otherUnit(leaf.holds, holds)
          ? AnswerProblem.wrongType
          : checkAnswer(fullDefinition, path, value);
      if (problem != null) {
        leftOut.add(LeftOut(path: leaf.key, target: target, problem: problem));
        continue;
      }
      written.add((path, value));
      if (repeat != null && entered.add(repeat)) written.add(('$repeat.$entry.entryAt', newEntryIds[repeat]!.at));
    }
  }
  // String.compareTo orders by UTF-16 code unit, as TypeScript's < does. No two answers share a path.
  written.sort((a, b) => a.$1.compareTo(b.$1));
  return Expansion(answers: {for (final (path, value) in written) path: value}, leftOut: leftOut);
}

/// The new entry's ID in a repeating section, once its ID and time are ones the server takes.
String _entryOf(NoteTypeDef definition, String section, NewEntries entries) {
  final entry = entries[section];
  if (entry == null || checkAnswer(definition, '$section.${entry.id}.entryAt', entry.at) != null) {
    throw ArgumentError('expandQuick: no usable new entry for the repeating section "$section"');
  }
  return entry.id;
}

/// A choose-many's codes in the full field's order of options; a code it lacks goes last, as it
/// was. A list is a new copy either way.
Object _inOrder(Holds? holds, Object value) {
  if (value is! List<Object?>) return value;
  if (holds is! CodesHolds || !holds.many) return List<Object?>.of(value);
  final order = {for (final (index, option) in holds.options.indexed) option.code: index};
  int place(Object? code) => order[code] ?? order.length;
  // Dart's sort is not stable, as JavaScript's is: the codes the full field lacks keep their order.
  final indexed = [...value.indexed]
    ..sort((a, b) {
      final by = place(a.$2) - place(b.$2);
      return by != 0 ? by : a.$1 - b.$1;
    });
  return [for (final (_, code) in indexed) code];
}

/// Two numbers stored in different units (or one with a unit and one without).
bool _otherUnit(Holds from, Holds? to) => from is NumberHolds && to is NumberHolds && from.unit != to.unit;
