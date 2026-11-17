/// Who may read what in a note (phase 4 design, lifecycle 6.4; forms 6.6 and 7.1): one function,
/// applied wherever a note is read by someone, on the server and on the phone. The phone applies it
/// before it shows a note, so a teammate's draft opened to help shows what the server would show
/// (rule 6). What a reader may not see is absent, with nothing left that hints at it, never blanked.
/// packages/forms/src/interp/visible.ts gives the same answers: a difference is a leak or a loss.
library;

import 'conditions.dart';
import 'definition.dart';
import 'effective.dart';
import 'field_at.dart';
import 'sensitive_exams.dart';

/// A range of the sensitive diagnosis codes, as phase 3 lists them
/// (lib/patients/generated/sensitive_codes.dart, `sensitiveCodeRanges`).
typedef SensitiveCodeRange = ({String from, String to});

/// Six facts about the person reading, worked out by the caller from their keys and credential,
/// and the sensitive code ranges.
class NoteReader {
  const NoteReader({
    required this.actsAsAuthor,
    required this.viewSensitive,
    required this.viewSensitiveExams,
    required this.readsMedical,
    required this.chartsMedical,
    required this.ordersMedications,
    required this.sensitiveCodes,
  });

  /// Acts as the note's author (lifecycle 3.8): sees all of it.
  final bool actsAsAuthor;

  /// patients.view_sensitive.
  final bool viewSensitive;

  /// patients.view_sensitive_exams.
  final bool viewSensitiveExams;

  /// patients.view with encounters.chart or billing.view_codes: may read a Medical note.
  final bool readsMedical;

  /// A credential with chartMedical.
  final bool chartsMedical;

  /// A credential that orders medications. A `needs` section is shown to every reader: `needs`
  /// decides who may change an answer (lifecycle 6.4 rule 5), so this changes nothing here.
  final bool ordersMedications;

  /// The sensitive diagnosis codes.
  final List<SensitiveCodeRange> sensitiveCodes;
}

/// The answers that count (effectiveAnswers) that [reader] may see, in the same order, or null when
/// they may not see the note at all: a Medical note (offered for Medical only) to a reader who does
/// not read Medical notes, or a sensitive note type to a reader without view_sensitive. Whoever acts
/// as the author sees every answer that counts. Otherwise:
///
///  - without view_sensitive_exams, everything a sensitive exam put there (sensitive_exams.dart);
///  - without view_sensitive and a clinical credential, every answer of a `treatmentRecord` section;
///  - without view_sensitive, a diagnosis whose code is sensitive, with what the note asks about
///    it: its entry, or outside a repeating section its section.
///
/// Which answers count is worked out on the whole note first, so a reader never sees an answer that
/// does not count for the author.
Map<String, Object>? visibleAnswers(NoteTypeDef definition, Answers answers, NoteReader reader) {
  final counted = effectiveAnswers(definition, answers);
  if (reader.actsAsAuthor) return counted;
  if (!definition.kinds.contains(NoteKind.nonMedical) && !reader.readsMedical) return null;
  if (definition.sensitivity == Sensitivity.sensitive && !reader.viewSensitive) return null;

  final seen = reader.viewSensitiveExams ? counted : withoutSensitiveExams(definition, counted);
  final treatment = reader.viewSensitive && reader.chartsMedical;
  final hidden = reader.viewSensitive
      ? const <String>[]
      : _sensitiveDiagnoses(definition, counted, reader.sensitiveCodes);
  return {
    for (final MapEntry(key: path, value: value) in seen.entries)
      if ((treatment || !(fieldAt(definition, path)?.section.treatmentRecord ?? false)) && !hidden.any(path.startsWith))
        path: value,
  };
}

/// Where each sensitive diagnosis's answers are: the start of every path of its entry or section.
List<String> _sensitiveDiagnoses(
  NoteTypeDef definition,
  Map<String, Object> counted,
  List<SensitiveCodeRange> ranges,
) => [
  for (final MapEntry(key: path, value: value) in counted.entries)
    if (fieldAt(definition, path) case final target?
        when target.field is ProblemDef && target.part == AnswerPart.code && isSensitiveCode(value as String, ranges))
      target.entry == null ? '${target.section.id}.' : '${target.section.id}.${target.entry}.',
];

/// Phase 3's rule (lib/patients/problems.dart and services/api problem.ts, isSensitiveCode), with
/// the ranges given: a code is sensitive when its first characters, as many as the range's `from`
/// has, sort between `from` and `to`, by UTF-16 code unit as JavaScript compares. Only the code
/// decides, as on the problem list: a diagnosis with no code is not sensitive.
bool isSensitiveCode(String code, List<SensitiveCodeRange> ranges) => ranges.any((range) {
  final head = code.length > range.from.length ? code.substring(0, range.from.length) : code;
  return head.compareTo(range.from) >= 0 && head.compareTo(range.to) <= 0;
});
