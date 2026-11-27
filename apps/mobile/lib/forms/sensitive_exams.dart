/// What a sensitive exam leaves behind when it is taken out of a note's answers (phase 4 design,
/// lifecycle 6.4 rules 3 and 8, forms 6.6): visibleAnswers takes it out for a reader without
/// patients.view_sensitive_exams, and recapLines for everyone, so nothing says the exam was done.
/// packages/forms/src/interp/sensitive-exams.ts takes out the same answers.
library;

import 'definition.dart';
import 'field_at.dart';
import 'paths.dart';

const _other = '_other';

/// The answers less everything a sensitive exam put there: every answer of a section marked
/// `sensitiveExam`; an option marked `sensitiveExam` from a code answer, the answer itself when
/// nothing else is left in it; every answer in a grid row whose option is marked; a region whose
/// region is marked, with its side and surface; and the Other text of a field whose picked Other
/// option was taken out (a field has one Other option: validate.other_twice).
///
/// An entry of a repeating section that held answers and is left with none goes too, its entryAt
/// with it, as an entry with a sensitive diagnosis does for visibleAnswers.
///
/// [answers] are answers that count (effectiveAnswers): an answer taken out here changes no other
/// answer's showing, because no condition outside a sensitive exam reads one
/// (validate.condition_reads_restricted). The order of the paths is kept, and a list is a new copy.
Map<String, Object> withoutSensitiveExams(NoteTypeDef definition, Map<String, Object> answers) {
  final kept = <(String, Object)>[];
  // The paths of the choices whose picked Other option was taken out.
  final lostOther = <String>{};
  final texts = <String>[];
  for (final MapEntry(key: path, value: value) in answers.entries) {
    final target = fieldAt(definition, path);
    if (target == null || target.section.sensitiveExam || _inSensitiveRow(target)) continue;
    final field = target.field;
    if (field is RegionDef && _sensitive(field.options, answers[_sibling(path, 'region')])) continue;
    if (target.points == Points.option) {
      texts.add(path);
      kept.add((path, value));
      continue;
    }
    final holds = target.holds;
    if (holds is! CodesHolds) {
      kept.add((path, value));
      continue;
    }
    final picked = value is String ? [value] : (value as List<Object?>);
    final marked = {
      for (final option in holds.options)
        if (option.sensitiveExam) option.code,
    };
    final left = [
      for (final code in picked)
        if (!marked.contains(code)) code,
    ];
    if (holds.options.any((o) => o.other && marked.contains(o.code) && picked.contains(o.code))) lostOther.add(path);
    if (left.length == picked.length) {
      kept.add((path, value is List ? List<Object?>.of(value) : value));
    } else if (left.isNotEmpty) {
      kept.add((path, left));
    }
  }
  final dropped = {
    for (final path in texts)
      if (lostOther.contains(_choiceOf(definition, path))) path,
  };
  final left = [
    for (final pair in kept)
      if (!dropped.contains(pair.$1)) pair,
  ];
  // An entry the exam was all of goes whole: its entryAt alone would show an empty entry where the
  // exam was, and number the rest around it. An entry that held nothing keeps its entryAt.
  Set<String> held(Iterable<String> paths) => {
    for (final path in paths)
      if (fieldAt(definition, path) case final target? when target.entry != null && target.points != Points.entry)
        '${target.section.id}.${target.entry}',
  };
  final before = held(answers.keys);
  final after = held([for (final (path, _) in left) path]);
  return {
    for (final (path, value) in left)
      if (_keepsEntry(definition, path, before, after)) path: value,
  };
}

/// Whether an answer survives its entry being emptied: only an entry's own answers can go here.
bool _keepsEntry(NoteTypeDef definition, String path, Set<String> before, Set<String> after) {
  final target = fieldAt(definition, path);
  if (target?.points != Points.entry || target!.entry == null) return true;
  final entry = '${target.section.id}.${target.entry}';
  return after.contains(entry) || !before.contains(entry);
}

/// A row of a grid whose option is marked `sensitiveExam`: its fixed row, or the option picked for it.
bool _inSensitiveRow(PathTarget target) {
  final grid = target.leaf?.node.grid;
  final field = grid?.field;
  if (grid == null || target.row == null || field is! GridDef) return false;
  final picked = grid.picked?.holds;
  final rows = field.rows ?? (picked is CodesHolds ? picked.options : const <OptionDef>[]);
  return rows.any((row) => row.code == target.row && row.sensitiveExam);
}

bool _sensitive(List<OptionDef> options, Object? code) => options.any((o) => o.code == code && o.sensitiveExam);

/// The path of another answer of the same region: its last part replaced.
String _sibling(String path, String part) => '${path.substring(0, path.lastIndexOf('.'))}.$part';

/// The choice an Other text belongs to: `_other` taken off the field's own part, before any side.
String _choiceOf(NoteTypeDef definition, String path) {
  final target = fieldAt(definition, path)!;
  final parts = path.split('.');
  final own = parts.length - (target.side != null ? 2 : 1);
  parts[own] = parts[own].substring(0, parts[own].length - _other.length);
  return parts.join('.');
}
