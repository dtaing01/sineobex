/// One-tap Normal (phase 4 design, forms 6.3 and 7.1): the answers it would add to one section, or
/// to one entry of a repeating section. The phone writes each answer returned, one change each, so a
/// finding already charted is never overwritten. packages/forms/src/interp/normal.ts gives the same
/// answers, held together by the conformance vectors.
library;

import 'conditions.dart';
import 'definition.dart';
import 'paths.dart';

/// The answers Normal would add, as a new map of path to value in code-unit key order. Nothing for
/// a section that does not offer Normal (`normal: true`), that is hidden, that repeats when no entry
/// that is there is named, or that does not repeat when an entry is named.
///
/// A field is filled when it shows, no set flag clears it, it holds no answer (a blank, or a value
/// checkAnswer refuses, is none: finishCheck asks for it too), and neither it nor a group or grid
/// around it is `noNormal` or `collapsed`. A collapsed part is optional: only the clinician says it
/// was examined, so Normal fills nothing in it, a grid's cells included, even once it is opened and
/// partly charted. A choose-one takes its normal option, a choose-many every normal option in the
/// definition's order (the validator holds that one answer takes them: normal_conflict), a number
/// its `normal` value; each side and each counting row is filled on its own. Other kinds have no
/// normal.
///
/// Visible means visible once Normal's answers are in: every normal is put in at once, and only
/// those that count with all of them in are kept. A follow-up that a normal answer hides is not
/// filled (6.3: the cranial nerve groups that stay hidden while the screen is Grossly intact), one
/// that a normal answer shows is, and the order the fields are written in decides nothing.
///
/// Normal never makes an answer that counts stop counting: a finding already charted in a follow-up
/// stays, and the normal that would hide it is not filled. When the normals all in at once would
/// hide one, they are taken one at a time, in the definition's order (fields as written, rows in
/// their order, right before left), each kept when, with those kept before it, it hides no answer
/// that counts; those passed over are tried again, in order, until a round keeps none. Only the kept
/// ones that count with all of them in are returned.
Map<String, Object> normalAnswers(NoteTypeDef definition, String sectionId, Answers answers, [String? entryId]) {
  final reading = NoteReading(definition, answers);
  final section = reading.model.sections.where((s) => s.section.id == sectionId).firstOrNull;
  if (section == null || !section.section.normal || (section.section.repeat != null) != (entryId != null)) return {};

  final offered = <(String, Object)>[];
  for (final node in reading.model.nodes) {
    if (node.section != section || _leftAlone(node)) continue;
    for (final leaf in ownLeaves(node)) {
      final value = _normalOf(leaf);
      final path = reading.pathOf(leaf, entryId);
      if (value != null && reading.answer(path) == null) offered.add((path, value));
    }
  }

  // The answers that count now, which no normal may hide.
  final counted = [
    for (final path in answers.keys)
      if (reading.counting(path) != null) path,
  ];
  bool hides(Map<String, Object> added) {
    final after = NoteReading(definition, {...answers, ...added});
    return counted.any((path) => after.counting(path) == null);
  }

  var added = {for (final (path, value) in offered) path: value};
  if (hides(added)) {
    added = {};
    var waiting = offered;
    for (;;) {
      final passed = <(String, Object)>[];
      for (final (path, value) in waiting) {
        if (hides({...added, path: value})) {
          passed.add((path, value));
        } else {
          added[path] = value;
        }
      }
      if (passed.length == waiting.length) break;
      waiting = passed;
    }
  }
  final after = NoteReading(definition, {...answers, ...added});
  // String.compareTo orders by UTF-16 code unit, as TypeScript's sort does.
  final kept = [
    for (final path in added.keys)
      if (after.counts(path)) path,
  ]..sort();
  return {for (final path in kept) path: added[path]!};
}

/// `noNormal` on the field or on a group or grid it is in, or `collapsed` on such a group or grid.
bool _leftAlone(FieldNode node) {
  for (FieldNode? at = node; at != null; at = at.parent) {
    final field = at.field;
    if (field.noNormal || (field is GroupDef && field.collapsed) || (field is GridDef && field.collapsed)) return true;
  }
  return false;
}

/// What Normal fills at a leaf, or null where the field has no normal.
Object? _normalOf(Leaf leaf) {
  final holds = leaf.holds;
  if (holds is CodesHolds) {
    final codes = [
      for (final option in holds.options)
        if (option.normal) option.code,
    ];
    if (codes.isEmpty) return null;
    return holds.many ? codes : codes.first;
  }
  final field = leaf.node.field;
  return field is NumberDef ? field.normal : null;
}
