/// Which answers of a note count, and whether a condition holds (phase 4 design, forms 2.2, 2.3 and
/// 7.1). The rules every function of the interpreter shares are here and nowhere else:
///
///  - An answer counts while its field shows: its section's condition holds, and the condition of
///    each group and grid around it, and its own. A hidden answer is not deleted: it counts again
///    when its field shows again.
///  - While a flag with `clears` is set and counts, the fields it names do not count, nor anything
///    in them.
///  - In a grid with rows `{ pickedIn }`, a row counts only while its option is picked.
///  - In a repeating section, an entry is there while its `entryAt` answer is and its
///    `entryRemoved` is not true; the answers of an entry that is not there do not count.
///  - The text of an Other option counts only while an Other option is picked beside it.
///  - A blank (null, "", [] or {}, lifecycle 4.5) is no answer, and so is an answer [checkAnswer]
///    refuses: the server and the phone never store one (7.1), so this only decides what a note
///    that somehow held one would mean, the same way on both sides.
///  - A condition reads only answers that count: `filled` holds on an answer that counts, and `is`
///    on a code that counts. `not` of either holds where there is no such answer.
///
/// packages/forms/src/interp/conditions.ts holds the same rules, and the conformance vectors hold
/// the two together. Whether a field shows can hang on other answers, and theirs on others again.
/// The validator refuses a definition where that comes round to itself (validate.condition_cycle),
/// so each is worked out once, when it is first asked for, in the order the conditions need them.
library;

import 'check_answer.dart';
import 'definition.dart';
import 'field_at.dart';
import 'paths.dart';

/// A note's answers: a flat map from a path to a value (2.3), as JSON decodes it.
typedef Answers = Map<String, Object?>;

/// No answer: absent, null, "", [] or {}, the blanks of lifecycle 4.5. A field filled in and then
/// cleared is a field never touched, to a condition, to Complete and to the content hash alike.
bool isBlank(Object? value) =>
    value == null || value == '' || (value is List && value.isEmpty) || (value is Map && value.isEmpty);

const _other = '_other';
const _entryAt = '.entryAt';

/// The answers a field stores itself, at each row and side: what Complete waits for and one-tap
/// Normal fills. Not the text of an Other option, which the option asks for, and nothing of the
/// fields in a group or a grid's cell, which are fields of their own.
List<Leaf> ownLeaves(FieldNode node) => [
  for (final leaf in node.leaves)
    if (leaf.node == node && leaf.fieldPath != null) leaf,
];

/// A note's answers read against its definition: what shows, what counts, which entries are there.
class NoteReading {
  NoteReading(this.definition, this._answers) : model = definitionModel(definition);

  final NoteTypeDef definition;
  final Answers _answers;
  final PathModel model;
  final _shows = <String, bool>{};
  final _working = <String>{};
  final _values = <String, Object?>{};
  final _live = <SectionNode, List<String>>{};

  /// Where the answer of a leaf is in a note: in a repeating section the entry's ID is the second part.
  String pathOf(Leaf leaf, String? entry) {
    if (leaf.node.section.section.repeat == null) return leaf.key;
    return [leaf.parts.first, entry ?? '', ...leaf.parts.skip(1)].join('.');
  }

  /// What is stored at a path, as the note holds it: blank, refused, counting or not.
  Object? stored(String path) => _answers[path];

  /// The answer at a path, counting or not: null where there is none, where it is blank and where
  /// [checkAnswer] refuses it.
  Object? answer(String path) {
    if (_values.containsKey(path)) return _values[path];
    final value = _answers[path];
    return _values[path] = isBlank(value) || checkAnswer(definition, path, value) != null ? null : value;
  }

  /// The answer at a path if it counts, else null.
  Object? counting(String path) {
    final value = answer(path);
    return value != null && counts(path) ? value : null;
  }

  /// Whether the answer at a path would count, were there one: its field shows there and nothing clears it.
  bool counts(String path) {
    final target = fieldAt(definition, path);
    if (target == null || target.holds == null) return false;
    final section = model.sections.firstWhere((s) => s.section == target.section);
    if (target.points == Points.entry) return sectionShows(section) && _isLive(section, target.entry!);
    return leafCounts(target.leaf!, target.entry);
  }

  /// The entries of a repeating section that are there, in the order they were added: by `entryAt`
  /// as a time, then by ID, so two entries added in one instant still have one order. Empty for a
  /// section that does not repeat.
  List<String> entries(SectionNode section) {
    final known = _live[section];
    if (known != null) return known;
    final found = <(String, String)>[];
    if (section.section.repeat != null) {
      final prefix = '${section.section.id}.';
      for (final path in _answers.keys) {
        // `wounds.entryAt` both starts and ends so, and holds no entry ID at all.
        if (path.length < prefix.length + _entryAt.length) continue;
        if (!path.startsWith(prefix) || !path.endsWith(_entryAt)) continue;
        final id = path.substring(prefix.length, path.length - _entryAt.length);
        final at = answer(path);
        if (!entryId.hasMatch(id) || at == null) continue;
        if (answer('$prefix$id.entryRemoved') == true) continue;
        found.add((id, _instant(at as String)));
      }
    }
    // String.compareTo orders by UTF-16 code unit, as TypeScript's < does.
    found.sort((a, b) {
      final byTime = a.$2.compareTo(b.$2);
      return byTime != 0 ? byTime : a.$1.compareTo(b.$1);
    });
    return _live[section] = [for (final (id, _) in found) id];
  }

  /// Whether a section's own condition holds.
  bool sectionShows(SectionNode section) {
    final condition = section.section.showWhen;
    // A section's condition cannot start with ./ (2.2), so it reads no entry and no row.
    return _once(section.at, () => condition == null || holds(condition, null, null, null));
  }

  /// Whether a field's answers count in a row (in a grid's cell) and an entry (in a repeating
  /// section): it shows there, and no flag clears it or anything around it.
  bool fieldCounts(FieldNode node, String? row, String? entry) => _once('${node.at} ${row ?? ''} ${entry ?? ''}', () {
    final section = node.section;
    if (!sectionShows(section)) return false;
    if (section.section.repeat != null ? entry == null || !_isLive(section, entry) : entry != null) return false;
    final around = <FieldNode>[];
    for (FieldNode? at = node; at != null; at = at.parent) {
      around.insert(0, at);
    }
    for (final at in around) {
      // Only what is inside a grid's cell is in a row. The grid's own condition is read from outside.
      final inRow = at.grid != null ? row : null;
      final showWhen = at.field.showWhen;
      if (showWhen != null && !holds(showWhen, at, inRow, entry)) return false;
      // A row of picked rows is there while its option is picked.
      final parent = at.parent;
      final picked = parent != null && parent.cell == at ? parent.picked : null;
      if (picked != null && (inRow == null || !_picks(picked, entry, [inRow]))) return false;
      for (final flag in at.siblings) {
        final field = flag.field;
        if (flag == at || field is! FlagDef || !field.clears.contains(at.field.id)) continue;
        if (flag.leaves.any((leaf) => leaf.row == inRow && _filled(leaf, entry))) return false;
      }
    }
    return true;
  });

  /// Whether the answer at a leaf, in an entry, would count. An entry outside its section is ignored.
  bool leafCounts(Leaf leaf, String? entry) {
    final node = leaf.node;
    final at = node.section.section.repeat != null ? entry : null;
    if (!fieldCounts(node, leaf.row, at)) return false;
    // Only the text of an Other option has no field path (paths.dart, Leaf.fieldPath).
    final field = node.field;
    if (leaf.fieldPath != null || field is! ChoiceDef) return true;
    // Its answer is at the same path with `_other` taken off the field's own part, before any side.
    final sided = field.sides || (node.grid?.field.sides ?? false);
    final parts = [...leaf.parts];
    final own = parts.length - (sided ? 2 : 1);
    parts[own] = parts[own].substring(0, parts[own].length - _other.length);
    final choice = model.leaves[parts.join('.')];
    final others = [
      for (final option in field.options)
        if (option.other) option.code,
    ];
    return choice != null && _picks(choice, at, others);
  }

  /// Whether a condition holds, read from where it is written: [carrier] is the field that carries
  /// it, null for a section's own condition, in a row and an entry.
  bool holds(Condition condition, FieldNode? carrier, String? row, String? entry) {
    switch (condition) {
      case AllCondition(:final all):
        return all.every((c) => holds(c, carrier, row, entry));
      case AnyCondition(any: final some):
        return some.any((c) => holds(c, carrier, row, entry));
      case NotCondition(:final not):
        return !holds(not, carrier, row, entry);
      case FilledCondition(:final field):
        // The validator refuses a condition that names no answer; were one let through, it would read none.
        final leaf = leafAt(model, field, carrier, row).leaf;
        return leaf != null && _filled(leaf, entry);
      case IsCondition(:final field, :final codes):
        final leaf = leafAt(model, field, carrier, row).leaf;
        return leaf != null && _picks(leaf, entry, codes);
    }
  }

  bool _isLive(SectionNode section, String entry) => entries(section).contains(entry);

  /// The leaf holds an answer that counts.
  bool _filled(Leaf leaf, String? entry) => leafCounts(leaf, entry) && answer(pathOf(leaf, entry)) != null;

  /// The leaf holds, and counts with, one of these codes: as its one code, or among its list.
  bool _picks(Leaf leaf, String? entry, List<String> codes) {
    if (!leafCounts(leaf, entry)) return false;
    final value = answer(pathOf(leaf, entry));
    if (value is String) return codes.contains(value);
    return value is List && value.any(codes.contains);
  }

  bool _once(String key, bool Function() work) {
    final known = _shows[key];
    if (known != null) return known;
    if (!_working.add(key)) {
      throw StateError('whether $key shows hangs on itself: the definition did not pass the validator');
    }
    try {
      return _shows[key] = work();
    } finally {
      _working.remove(key);
    }
  }
}

/// An `entryAt` ([checkAnswer] has taken it: a UTC time, with up to nine digits of a second) as text
/// that sorts as the time does. Compared as written, 10:00:00Z would sort after 10:00:00.5Z.
String _instant(String entryAt) {
  final fraction = entryAt.length > 20 ? entryAt.substring(20, entryAt.length - 1) : '';
  return entryAt.substring(0, 19) + fraction.padRight(9, '0');
}
