/// What stops Complete (phase 4 design, forms 7.1; lifecycle 3.3 and 4.6): a visible required field
/// that is empty. The phone asks it before it makes a sign-off, and the server asks
/// packages/forms/src/interp/finish.ts again before it finishes a note or takes a correction; the
/// conformance vectors hold the two to the same list.
library;

import 'conditions.dart';
import 'definition.dart';

/// A visible required field holds no answer at [path], in [section]. `required` is the only problem.
class FinishProblem {
  const FinishProblem({required this.section, required this.path});
  final String section;
  final String path;

  /// The wire value.
  String get problem => 'required';

  Map<String, String> toJson() => {'section': section, 'path': path, 'problem': problem};
}

/// One problem for each answer a visible required field is missing: a field with sides is recorded
/// once for each side, and a field in a grid's cell once for each row that counts, so each is asked
/// for. Inside a repeating section the check is made in each entry that is there; a section with
/// no entry asks for nothing. A field that does not count (hidden, cleared by a set flag, in a row
/// not picked) is not asked for.
///
/// Empty is the same for every kind that may be required (choice, text, number, flag, date, time,
/// duration): no answer that checkAnswer takes, or a blank (null, "", []). So 0 fills a number or a
/// duration, a lone exclusive None fills a choose-many, a choice of Other fills it without its text,
/// a text of spaces fills it, and a flag is filled only when ticked.
///
/// In the definition's order: section by section, entries in the order they were added, fields as
/// written, rows in their order, right before left.
List<FinishProblem> finishCheck(NoteTypeDef definition, Answers answers) {
  final reading = NoteReading(definition, answers);
  final problems = <FinishProblem>[];
  for (final section in reading.model.sections) {
    final nodes = [
      for (final node in reading.model.nodes)
        if (node.section == section && node.field.required) node,
    ];
    final List<String?> entries = section.section.repeat != null ? reading.entries(section) : const [null];
    for (final entry in entries) {
      for (final node in nodes) {
        for (final leaf in ownLeaves(node)) {
          final path = reading.pathOf(leaf, entry);
          if (reading.fieldCounts(node, leaf.row, entry) && reading.answer(path) == null) {
            problems.add(FinishProblem(section: section.section.id, path: path));
          }
        }
      }
    }
  }
  return problems;
}
