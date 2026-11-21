/// The automatic recap (phase 4 design, lifecycle 8.1; forms 6.6 and 7.1): one short line for each
/// section that has an answer, worked out every time it is shown and never stored, from the note
/// type version the note was written on. It shows in a section's collapsed header, on the summary
/// screen and on the visit, and so on the patient's overview: nothing from a sensitive exam is in
/// it, for any reader (lifecycle 6.4 rules 3 and 8). packages/forms/src/interp/recap.ts writes the
/// same lines, word for word.
library;

import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'layout.dart';
import 'paths.dart';
import 'sensitive_exams.dart';

/// The recap of one section, by its id.
class RecapLine {
  const RecapLine({required this.section, required this.text});
  final String section;
  final String text;

  Map<String, String> toJson() => {'section': section, 'text': text};
}

/// The lines of the sections with an answer that counts, in the definition's order. Each item is
/// its labels joined by ', ', then ': ' and its value, as the read model writes them (layout.dart);
/// items are joined by '; '. In a repeating section each entry with an answer is its title
/// (`itemTitle`, {n} its number), ': ' and its items, and entries are joined by '. '.
///
/// Left out: what a sensitive exam put there (sensitive_exams.dart), and a field marked
/// `recap: false` with everything in it. Who may read the rest is visibleAnswers' rule: the caller
/// passes the answers the reader may see.
List<RecapLine> recapLines(NoteTypeDef definition, Answers answers) {
  final shown = withoutSensitiveExams(definition, effectiveAnswers(definition, answers));
  return [
    for (final LaidOutSection(:section, :items, :entries) in layOut(definition, shown, skip: _leftOut))
      RecapLine(
        section: section.id,
        text: entries != null
            ? entries.map((entry) => '${entry.title}: ${_joined(entry.items)}').join('. ')
            : _joined(items),
      ),
  ];
}

bool _leftOut(FieldNode node) => !node.field.recap;

String _joined(List<Item> items) => items.map((item) => '${item.labels.join(', ')}: ${item.value}').join('; ');
