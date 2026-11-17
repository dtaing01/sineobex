/// The EMS handoff summary (phase 4 design, lifecycle 5.7 and 9.8; forms 6.2, 7.1 and 10.1 #6):
/// what the medic is shown full-screen on the phone, and what the portal's PDF prints, built the
/// same way on both from the notes of one visit. packages/forms/src/interp/handoff.ts writes the
/// same lines, word for word.
library;

import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'layout.dart';
import 'paths.dart';
import 'recap.dart';
import 'sensitive_exams.dart';

/// What a line is. The names are the wire values.
enum HandoffKind {
  /// An answer of a field marked `handoff`.
  field,

  /// A line of a note's recap.
  recap,
}

class HandoffLine {
  const HandoffLine({
    required this.kind,
    required this.note,
    required this.section,
    required this.label,
    required this.value,
  });
  final HandoffKind kind;

  /// The note's place in the lists given: the screen heads each note with its definition's title.
  final int note;

  /// The section's id.
  final String section;

  /// A field line: the answer's labels; a recap line: the section's title.
  final String label;
  final String value;

  Map<String, Object> toJson() => {'kind': kind.name, 'note': note, 'section': section, 'label': label, 'value': value};
}

/// The handoff of the notes `definitions[i]` and `answersByNote[i]` describe, each note its own
/// version's definition. Each note's answers are those its reader may see (visibleAnswers, applied
/// by the caller), so a handoff never shows a reader a note they may not open; null, a note they
/// may not see at all, gives no line and keeps its place. Lists of different lengths throw.
///
/// PLAN-OPEN: the content of the summary (forms.md 10.1 #6). The default built: first the answers
/// that count of every field marked `handoff` (with everything in it), less what a sensitive exam
/// put there, note by note in the order given, each laid out and written as the read model writes
/// it, its labels joined by ', ', an entry's title first in a repeating section; then each note's
/// recap (recapLines), in the same order of notes. The patient's name, age and allergies come from
/// the chart, not from here.
List<HandoffLine> handoffLines(List<NoteTypeDef> definitions, List<Answers?> answersByNote) {
  if (definitions.length != answersByNote.length) {
    throw ArgumentError('handoffLines: ${definitions.length} definitions for ${answersByNote.length} notes');
  }
  final fields = <HandoffLine>[];
  final recaps = <HandoffLine>[];
  for (final (note, definition) in definitions.indexed) {
    final answers = answersByNote[note];
    if (answers == null) continue;
    void line(String section, List<String> labels, String value) => fields.add(
      HandoffLine(kind: HandoffKind.field, note: note, section: section, label: labels.join(', '), value: value),
    );
    // The summary is shown to EMS, so nothing a sensitive exam put there is in it, as in the recap
    // (lifecycle 6.4 rule 8); the validator keeps a handoff field out of a restricted section.
    final shown = withoutSensitiveExams(definition, effectiveAnswers(definition, answers));
    for (final LaidOutSection(:section, :items, :entries) in layOut(definition, shown, skip: (n) => !_marked(n))) {
      // Nothing is struck here, so every item has a value.
      for (final item in items) {
        line(section.id, item.labels, item.value!);
      }
      for (final entry in entries ?? const <LaidOutEntry>[]) {
        for (final item in entry.items) {
          line(section.id, [entry.title, ...item.labels], item.value!);
        }
      }
    }
    for (final RecapLine(:section, :text) in recapLines(definition, answers)) {
      recaps.add(
        HandoffLine(
          kind: HandoffKind.recap,
          note: note,
          section: section,
          label: definition.sections.firstWhere((s) => s.id == section).title,
          value: text,
        ),
      );
    }
  }
  return [...fields, ...recaps];
}

/// Whether a field is in the handoff, or holds a field that is: it, or a group or grid around it,
/// is marked; or a field in it is, which then goes in alone.
bool _marked(FieldNode node) {
  for (FieldNode? at = node; at != null; at = at.parent) {
    if (at.field.handoff) return true;
  }
  return _holdsMarked(node);
}

bool _holdsMarked(FieldNode node) =>
    [...node.children, ?node.cell].any((child) => child.field.handoff || _holdsMarked(child));
