/// What hangs off a note, as one reader may see it (phase 4 design, lifecycle 5.1, 6.4 rules 2 and
/// 6): a correction's old and new values give away the answers they change, so a correction is
/// shown whole or not at all. The server's rule, copied: services/api/src/sync/records.ts
/// `answerHidden` and services/api/src/encounters/read.ts `hiddenCorrections`. The phone applies it
/// to what it holds, so a role lowered since the phone downloaded a note shows no more than the
/// server would now.
library;

import '../forms/conditions.dart' show Answers;
import '../forms/definition.dart';
import '../forms/effective.dart';
import '../forms/field_at.dart';
import '../forms/paths.dart' show CodesHolds;
import '../forms/visible.dart';
import '../sync/canonical_json.dart';

/// One change of a correction: [field] is `data.<path>`. [oldValue] is null for one made here,
/// which the server has not answered yet.
typedef CorrectionChangeValues = ({String field, Object? oldValue, Object? newValue});

/// A correction as the read rules see it.
class StoredCorrection {
  const StoredCorrection({required this.id, required this.outcome, required this.changes});
  final String id;

  /// The server's outcome; null while the phone does not know it.
  final String? outcome;
  final List<CorrectionChangeValues> changes;
}

/// The outcomes that wrote the note (read.ts WROTE).
const _wrote = {'corrected', 'draft_edit'};

const _data = 'data.';

/// Whether [reader] may not see [value] as the answer at [path] of a note holding [answers]: the
/// note, its section, or what visibleAnswers makes of the value. An answer that does not count is
/// told by what it would be if it counted: any answer of its entry, or of its section outside a
/// repeating one, is a sensitive diagnosis, counting or not; or it picks a sensitive exam's option.
bool answerHidden(NoteTypeDef type, Answers answers, String path, Object? value, NoteReader reader) {
  if (reader.actsAsAuthor) return false;
  final placed = {...answers, path: value};
  final seen = visibleAnswers(type, placed, reader);
  if (seen == null) return true;
  final target = fieldAt(type, path);
  final section = target?.section;
  if ((section?.sensitiveExam ?? false) && !reader.viewSensitiveExams) return true;
  if ((section?.treatmentRecord ?? false) && !(reader.viewSensitive && reader.chartsMedical)) return true;
  final counted = effectiveAnswers(type, placed);
  if (counted.containsKey(path)) {
    return !seen.containsKey(path) || canonicalJson(seen[path]) != canonicalJson(counted[path]);
  }
  if (target == null) return false;
  final scope = target.entry == null ? '${target.section.id}.' : '${target.section.id}.${target.entry}.';
  if (!reader.viewSensitive) {
    for (final MapEntry(key: p, value: v) in placed.entries) {
      if (!p.startsWith(scope) || v is! String) continue;
      final at = fieldAt(type, p);
      if (at?.field is ProblemDef && at?.part == AnswerPart.code && isSensitiveCode(v, reader.sensitiveCodes)) {
        return true;
      }
    }
  }
  final holds = target.holds;
  if (reader.viewSensitiveExams || holds is! CodesHolds) return false;
  final picked = value is String
      ? {value}
      : value is List
      ? value.toSet()
      : const <Object?>{};
  return holds.options.any((o) => o.sensitiveExam && picked.contains(o.code));
}

/// The IDs of [corrections] (in the order they were applied) hidden from [reader]: those whose old
/// or new value, at any field they change, [answerHidden] would hide in any state the note has held.
/// Asked of the note now ([answers]); of the note with the later corrections undone, in order; and,
/// since corrections received in one push share their time, of the note now with each one's old
/// values, or its new values, put back. Asked only of the note now, a correction made while its
/// entry held a sensitive diagnosis showed once a later one moved the code off the list (review
/// finding LRD-1). A rule the definition breaks hides the correction.
Set<String> hiddenCorrections(
  NoteTypeDef type,
  Answers answers,
  NoteReader reader,
  List<StoredCorrection> corrections,
) {
  Answers placed(Answers on, Iterable<(String, Object?)> values) {
    final out = {...on};
    for (final (field, value) in values) {
      final path = field.substring(_data.length);
      if (value == null) {
        out.remove(path);
      } else {
        out[path] = value;
      }
    }
    return out;
  }

  final states = <Answers>[answers];
  var after = answers;
  for (final c in corrections.reversed) {
    if (!_wrote.contains(c.outcome)) continue;
    after = placed(after, [for (final x in c.changes) (x.field, x.oldValue)]);
    states.add(after);
  }
  for (final c in corrections) {
    states
      ..add(placed(answers, [for (final x in c.changes) (x.field, x.oldValue)]))
      ..add(placed(answers, [for (final x in c.changes) (x.field, x.newValue)]));
  }
  return {
    for (final c in corrections)
      if (!c.changes.every((x) {
        final path = x.field.substring(_data.length);
        try {
          return states.every(
            (state) =>
                !answerHidden(type, state, path, x.oldValue, reader) &&
                !answerHidden(type, state, path, x.newValue, reader),
          );
          // The interpreter's own faults are Errors as well as Exceptions (records.ts byDefinition).
          // ignore: avoid_catches_without_on_clauses
        } catch (_) {
          return false;
        }
      }))
        c.id,
  };
}
