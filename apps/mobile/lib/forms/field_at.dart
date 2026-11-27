/// What a path of a note's answers points at (phase 4 design, forms 7.1): a field, a cell of a
/// grid's row, the Other option whose text is stored there, or an entry's own answers. The paths
/// themselves are worked out once, in paths.dart (2.3); this only looks them up, with the entry's
/// part of a repeating section taken out first.
///
/// packages/forms/src/interp/field-at.ts gives the same answers, held together by
/// packages/contract/test-vectors/forms-conformance.json.
library;

import 'definition.dart';
import 'paths.dart';

/// An entry's ID: the letter e and seven characters from a-z0-9, made on the phone (2.3).
final entryId = RegExp(r'^e[a-z0-9]{7}$');

/// What a path points at. The names are the wire values.
enum Points {
  /// A field outside a grid's cell, at its own path or an answer of it.
  field,

  /// In a grid's row: the cell, or a field of a group cell.
  cell,

  /// The text of an Other option.
  option,

  /// An entry's `entryAt` or `entryRemoved`.
  entry,
}

/// The part of a path a field's kind adds after its own path, other than a side. The names are the
/// wire values.
enum AnswerPart { region, side, surface, code, label, entryAt, entryRemoved }

class PathTarget {
  const PathTarget({
    required this.points,
    required this.at,
    required this.section,
    required this.field,
    required this.option,
    required this.entry,
    required this.row,
    required this.side,
    required this.part,
    required this.key,
    required this.leaf,
    required this.holds,
  });

  final Points points;

  /// Where it is written in the definition: the field, the Other option, or an entry's section.
  final String at;
  final SectionDef section;

  /// The field, or the field whose Other option it is; null for an entry's own answers.
  final FieldDef? field;

  /// The Other option whose text is stored here. A field may mark more than one option Other; they
  /// share the one text, and this is the first of them.
  final OptionDef? option;

  /// The entry's ID in a repeating section.
  final String? entry;

  /// The row's code in a grid.
  final String? row;

  /// `right` or `left`, for a field with sides: the path's last part.
  final String? side;
  final AnswerPart? part;

  /// The path with the entry's part left out: what a condition and a `mapsTo` write.
  final String key;

  /// The answer stored here, from the path model; null for an entry's own answers and where nothing
  /// is stored.
  final Leaf? leaf;

  /// What an answer here may be; null where the path names a field but nothing is stored.
  final Holds? holds;

  PathTarget _inEntry(String? entry) => PathTarget(
    points: points,
    at: at,
    section: section,
    field: field,
    option: option,
    entry: entry,
    row: row,
    side: side,
    part: part,
    key: key,
    leaf: leaf,
    holds: holds,
  );
}

class _Index {
  _Index(this.model);
  final PathModel model;
  final Map<String, SectionNode> sections = {};

  /// Every place a path can point at, before the entry is known.
  final Map<String, PathTarget> places = {};
}

// A definition does not change once read, and every answer of a note is looked up in it.
final _indexes = Expando<_Index>('field_at');

/// The field, option or cell [path] points at in a note on [definition], or null when it names none.
PathTarget? fieldAt(NoteTypeDef definition, String path) {
  final index = _indexOf(definition);
  final rest = path.split('.');
  final sectionId = rest.removeAt(0);
  final section = index.sections[sectionId];
  if (section == null) return null;
  String? entry;
  if (section.section.repeat != null) {
    // Every path of a repeating section carries its entry's ID second (2.3).
    if (rest.isEmpty || !entryId.hasMatch(rest.first)) return null;
    entry = rest.removeAt(0);
    if (rest.length == 1 && reservedIds.contains(rest.single)) {
      final part = AnswerPart.values.byName(rest.single);
      return PathTarget(
        points: Points.entry,
        at: section.at,
        section: section.section,
        field: null,
        option: null,
        entry: entry,
        row: null,
        side: null,
        part: part,
        key: '$sectionId.${part.name}',
        leaf: null,
        holds: SimpleHolds(part == AnswerPart.entryAt ? SimpleKind.entryAt : SimpleKind.entryRemoved),
      );
    }
  }
  if (rest.isEmpty) return null;
  return index.places[[sectionId, ...rest].join('.')]?._inEntry(entry);
}

/// The definition's path model (paths.dart), built once per definition and shared by the
/// interpreter, so a leaf [fieldAt] returns is the same object the other functions walk from.
PathModel definitionModel(NoteTypeDef definition) => _indexOf(definition).model;

_Index _indexOf(NoteTypeDef definition) {
  final known = _indexes[definition];
  if (known != null) return known;
  final index = _Index(pathModel(definition));
  for (final section in index.model.sections) {
    index.sections[section.section.id] = section;
  }
  for (final leaf in index.model.leaves.values) {
    index.places[leaf.key] = _fromLeaf(leaf);
  }
  // A field's own path names it even where nothing is stored: a group, a grid, a region, a problem,
  // a field with sides, and the kinds that store nothing (photo, action, info).
  for (final node in index.model.nodes) {
    for (final (key, row) in _ownPaths(node)) {
      index.places.putIfAbsent(key, () => _place(node, key, row, null, null, null, null));
    }
  }
  _indexes[definition] = index;
  return index;
}

/// A field's own paths, with the row of each: one in each row for a field in a grid's cell.
List<(String, String?)> _ownPaths(FieldNode node) {
  if (node.base case final base?) return [(base.join('.'), null)];
  final grid = node.grid;
  final gridBase = grid?.base;
  if (grid == null || gridBase == null) return const [];
  // The cell's own id is no path part; the ids of the fields in a group cell are (2.3).
  final below = <String>[];
  for (var at = node; at != grid.cell; at = at.parent!) {
    below.insert(0, at.field.id);
  }
  return [
    for (final row in grid.rows) ([...gridBase, row, ...below].join('.'), row),
  ];
}

PathTarget _fromLeaf(Leaf leaf) {
  final node = leaf.node;
  final sided = node.field.sides || (node.grid?.field.sides ?? false);
  final side = sided ? leaf.parts.last : null;
  final field = node.field;
  // Only the text of an Other option has no field path of its own (paths.dart, Leaf.fieldPath).
  if (leaf.fieldPath == null && field is ChoiceDef) {
    final index = field.options.indexWhere((o) => o.other);
    return PathTarget(
      points: Points.option,
      at: '${node.at}.options[$index]',
      section: node.section.section,
      field: field,
      option: field.options[index],
      entry: null,
      row: leaf.row,
      side: side,
      part: null,
      key: leaf.key,
      leaf: leaf,
      holds: leaf.holds,
    );
  }
  final part = field is RegionDef || field is ProblemDef ? AnswerPart.values.byName(leaf.parts.last) : null;
  return _place(node, leaf.key, leaf.row, side, part, leaf, leaf.holds);
}

PathTarget _place(FieldNode node, String key, String? row, String? side, AnswerPart? part, Leaf? leaf, Holds? holds) =>
    PathTarget(
      points: node.grid != null ? Points.cell : Points.field,
      at: node.at,
      section: node.section.section,
      field: node.field,
      option: null,
      entry: null,
      row: row,
      side: side,
      part: part,
      key: key,
      leaf: leaf,
      holds: holds,
    );
