/// Whether one answer fits its definition (phase 4 design, forms 7.1): the phone calls it before it
/// saves an answer, and the server calls packages/forms/src/interp/check-answer.ts on every answer
/// it is sent (lifecycle 4.4). The two give the same answers, held together by
/// packages/contract/test-vectors/forms-conformance.json, so an answer the phone saves is never a
/// rejected change. It sees one answer and no other: an answer in a field hidden now is still taken.
library;

import '../sync/entities.dart' show icd10cmCode;
import 'definition.dart';
import 'field_at.dart';
import 'paths.dart';

/// What is wrong with an answer, in the order the checks run. [code] is the wire value.
enum AnswerProblem {
  unknownPath('unknown_path'),
  wrongType('wrong_type'),
  unknownOption('unknown_option'),
  outOfRange('out_of_range'),
  tooLong('too_long'),
  excludedPair('excluded_pair'),
  exclusiveWithOthers('exclusive_with_others');

  const AnswerProblem(this.code);
  final String code;
}

/// A problem label is copied from the problem code list: phase 3's limit for a code's display text.
const maxProblemLabel = 300;

final _date = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final _time = RegExp(r'^([01]\d|2[0-3]):[0-5]\d$');

/// An entry's `entryAt`: a UTC time, as `toUtc().toIso8601String()` writes it.
final _entryAt = RegExp(r'^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$');

/// Null when [value] may be stored at [path] of a note on [definition], or the one problem with it:
/// the first check that fails, in the order of [AnswerProblem]. Null is the clear of an answer and
/// passes wherever an answer is stored. [value] is as JSON decodes it.
AnswerProblem? checkAnswer(NoteTypeDef definition, String path, Object? value) {
  final holds = fieldAt(definition, path)?.holds;
  if (holds == null) return AnswerProblem.unknownPath;
  if (value == null) return null;
  switch (holds) {
    case CodesHolds(many: false):
      if (value is! String) return AnswerProblem.wrongType;
      return holds.options.any((o) => o.code == value) ? null : AnswerProblem.unknownOption;
    case CodesHolds():
      return _checkMany(holds, value);
    case TextHolds(:final maxLength):
      return _checkText(value, maxLength);
    case NumberHolds(:final min, :final max, :final decimals):
      if (value is! num) return AnswerProblem.wrongType;
      // A value at more decimals than the field's is not one of its values (the validator's
      // number_range_empty reads the range the same way). Its shortest decimal form is what the
      // person typed.
      if (value < min || value > max || double.parse(value.toStringAsFixed(decimals)) != value) {
        return AnswerProblem.outOfRange;
      }
      return null;
    case DurationHolds(:final max):
      return _checkDuration(value, max);
    case DateHolds():
      // The range (past, future) is the picker's: there is no clock here, and an answer made in range
      // must still be taken when it syncs days later.
      final m = value is String ? _date.firstMatch(value) : null;
      return m != null && _isRealDate(m[1]!, m[2]!, m[3]!) ? null : AnswerProblem.wrongType;
    case SimpleHolds(:final kind):
      return switch (kind) {
        // A tick and a removal store true; each is undone by clearing it.
        SimpleKind.flag || SimpleKind.entryRemoved => value == true ? null : AnswerProblem.wrongType,
        SimpleKind.time => value is String && _time.hasMatch(value) ? null : AnswerProblem.wrongType,
        // ICD-10-CM by its shape only, as phase 3 checks it, so a code-set update never refuses an answer.
        SimpleKind.problemCode => value is String && icd10cmCode.hasMatch(value) ? null : AnswerProblem.wrongType,
        SimpleKind.problemLabel => _checkText(value, maxProblemLabel),
        SimpleKind.entryAt => _checkEntryAt(value),
      };
  }
}

AnswerProblem? _checkMany(CodesHolds holds, Object value) {
  if (value is! List || !value.every((code) => code is String)) return AnswerProblem.wrongType;
  final codes = value.cast<String>();
  if (codes.toSet().length != codes.length) return AnswerProblem.wrongType;
  final order = {for (final (i, o) in holds.options.indexed) o.code: i};
  if (!codes.every(order.containsKey)) return AnswerProblem.unknownOption;
  // In the definition's order (2.3), so one set of picks is one stored value, and hashes as one.
  for (var i = 1; i < codes.length; i++) {
    if (order[codes[i]]! < order[codes[i - 1]]!) return AnswerProblem.wrongType;
  }
  final held = codes.toSet();
  if (holds.excludes.any((pair) => held.contains(pair.$1) && held.contains(pair.$2))) {
    return AnswerProblem.excludedPair;
  }
  if (codes.length > 1 && holds.options.any((o) => o.exclusive && held.contains(o.code))) {
    return AnswerProblem.exclusiveWithOthers;
  }
  return null;
}

AnswerProblem? _checkText(Object value, int maxLength) {
  if (value is! String) return AnswerProblem.wrongType;
  // Postgres stores no NUL and no half of a surrogate pair, so the server's sync check refuses both
  // (services/api/src/sync/records.ts, jsonProblem); refused here too, the phone never saves one.
  // runes walks by code point, so a half with no partner is the only one in the surrogate range.
  var length = 0;
  for (final point in value.runes) {
    if (point == 0 || (point >= 0xd800 && point <= 0xdfff)) return AnswerProblem.wrongType;
    length++;
  }
  // Characters, not UTF-16 units: an emoji is one character to the person typing it.
  return length > maxLength ? AnswerProblem.tooLong : null;
}

AnswerProblem? _checkDuration(Object value, int max) {
  // A whole number of days. JSON may write one as 3.0, which is the number 3.
  if (value is! num || (value is double && (!value.isFinite || value != value.truncateToDouble()))) {
    return AnswerProblem.wrongType;
  }
  return value < 0 || value > max ? AnswerProblem.outOfRange : null;
}

AnswerProblem? _checkEntryAt(Object value) {
  final m = value is String ? _entryAt.firstMatch(value) : null;
  final d = m == null ? null : _date.firstMatch(m[1]!);
  return d != null && _isRealDate(d[1]!, d[2]!, d[3]!) ? null : AnswerProblem.wrongType;
}

bool _isRealDate(String year, String month, String day) {
  final (y, m, d) = (int.parse(year), int.parse(month), int.parse(day));
  final leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
  if (m < 1 || m > 12) return false;
  final days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d >= 1 && d <= days;
}
