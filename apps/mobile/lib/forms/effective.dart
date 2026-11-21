/// The answers that count (phase 4 design, forms 7.1): those of visible fields, in entries that are
/// there, by the rules of conditions.dart. Every other function of the interpreter reads a note
/// through them, a finished note keeps only them, and the hash a signer sends is taken over them
/// (lifecycle 4.5). packages/forms/src/interp/effective.ts gives the same map, key for key.
library;

import 'conditions.dart';
import 'definition.dart';

/// A new map of path to value, holding each answer of [answers] that counts, as stored (a list
/// copied, not shared). A blank is no answer and is left out, as is an answer checkAnswer refuses,
/// so the content hash's own blank rule changes nothing here. An entry that is there keeps its
/// `entryAt`. The paths are in UTF-16 code-unit order, the order canonical JSON writes keys in, so
/// the same answers always give the same map, key for key.
Map<String, Object> effectiveAnswers(NoteTypeDef definition, Answers answers) {
  final reading = NoteReading(definition, answers);
  final kept = <(String, Object)>[];
  for (final path in answers.keys) {
    final value = reading.counting(path);
    if (value != null) kept.add((path, value is List ? List<Object?>.of(value) : value));
  }
  // String.compareTo orders by UTF-16 code unit, as TypeScript's < does.
  kept.sort((a, b) => a.$1.compareTo(b.$1));
  return {for (final (path, value) in kept) path: value};
}
