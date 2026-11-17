/// The paths of a definition (phase 4 design, forms 2.3): where a note written on it stores each
/// answer, and what may be stored there. packages/forms/src/paths.ts works out the same model; the
/// conformance vectors hold the two together. The faults that file reports to the validator (an id
/// used twice, a path too long) are not looked for here: a definition reaches the phone only once
/// the validator passed it. Where one is there all the same, the model is the same as TypeScript's:
/// the first of two things at one path wins.
library;

import 'dart:collection';

import 'definition.dart';

/// An entry's own answers in a repeating section (2.3). No field may take their place.
const reservedIds = ['entryAt', 'entryRemoved'];

/// Right and left: the last part of the path of a field with `sides`.
const sideNames = ['right', 'left'];

/// The text of an Other option is at most this long (2.3).
const maxOtherText = 200;

const _otherText = TextHolds(maxOtherText);

/// What an answer at a path may be.
sealed class Holds {
  const Holds();
}

/// One code ([many] false) or a list of codes in the order of [options].
class CodesHolds extends Holds {
  const CodesHolds({required this.many, required this.options, this.excludes = const []});
  final bool many;
  final List<OptionDef> options;
  final List<(String, String)> excludes;
}

class TextHolds extends Holds {
  const TextHolds(this.maxLength);
  final int maxLength;
}

class NumberHolds extends Holds {
  const NumberHolds({required this.min, required this.max, required this.decimals, this.unit});
  final num min;
  final num max;
  final int decimals;
  final String? unit;
}

class DateHolds extends Holds {
  const DateHolds(this.range);
  final String range;
}

/// The answers that need nothing more than their kind to be checked. An entry's own answers
/// ([entryAt], [entryRemoved]) are never a field's: field_at.dart gives them for an entry's path.
enum SimpleKind { flag, time, duration, problemCode, problemLabel, entryAt, entryRemoved }

class SimpleHolds extends Holds {
  const SimpleHolds(this.kind);
  final SimpleKind kind;
}

/// A section, with the fields written directly in it.
class SectionNode {
  SectionNode(this.section, this.at);
  final SectionDef section;

  /// Its place in the resolved definition: `$.sections[0]`.
  final String at;
  List<FieldNode> nodes = const [];
}

/// A field at its place in the definition's tree.
class FieldNode {
  FieldNode({
    required this.field,
    required this.at,
    required this.section,
    required this.parent,
    required this.siblings,
    required this.grid,
  });
  final FieldDef field;

  /// Its place in the resolved definition: `$.sections[0].fields[2].cell`.
  final String at;
  final SectionNode section;

  /// The group or grid it is written in; null for a field of the section itself.
  final FieldNode? parent;

  /// The fields written beside it, itself among them. A grid's cell stands alone.
  final List<FieldNode> siblings;

  /// The grid whose cell it is, or is in. Such a field stores once for each row.
  final FieldNode? grid;

  /// A group's fields.
  List<FieldNode> children = const [];

  /// A grid's cell.
  FieldNode? cell;

  /// The path of the field itself, an entry part left out. Null in a grid's cell, where the path
  /// depends on the row.
  List<String>? base;

  /// A grid's row codes. Empty until they are known, and when they cannot be.
  List<String> rows = const [];

  /// The choose-many answer a grid's rows are picked in.
  Leaf? picked;

  /// Every answer stored by it or inside it.
  final List<Leaf> leaves = [];
}

/// One path a note on this definition can have an answer at (2.3).
class Leaf {
  Leaf({
    required this.key,
    required this.parts,
    required this.node,
    required this.row,
    required this.holds,
    required this.optionsAt,
    required this.fieldPath,
  });

  /// The path, the entry part of a repeating section left out: what a condition and a mapsTo write.
  final String key;
  final List<String> parts;

  /// The field that stores it.
  final FieldNode node;

  /// The row it is in, for an answer in a grid.
  final String? row;
  final Holds holds;

  /// Where the options of a code answer are written, in the resolved definition.
  final String? optionsAt;

  /// The path of the field whose label says what this answer is: without a side, and without a
  /// region's or a problem's own part. Null for the text of an Other option, which the option names.
  final String? fieldPath;
}

class PathModel {
  PathModel(this.definition);
  final NoteTypeDef definition;
  final List<SectionNode> sections = [];

  /// Every field at every depth, in the order written.
  final List<FieldNode> nodes = [];

  /// Every answer's path, in the order the fields are written; a grid whose rows are picked
  /// elsewhere comes after every other path.
  final Map<String, Leaf> leaves = {};
}

PathModel pathModel(NoteTypeDef definition) {
  final model = PathModel(definition);
  final sectionIds = <String>{};
  for (final (index, section) in definition.sections.indexed) {
    // A second section with one id would store at the first one's paths.
    if (!sectionIds.add(section.id)) continue;
    final node = SectionNode(section, '\$.sections[$index]');
    node.nodes = _fieldNodes(model, section.fields, node.at, node, null);
    model.sections.add(node);
  }

  // The rows of a grid can be the options of a field elsewhere, so those grids wait for every other
  // path. They do not wait for each other: rows are never picked in a grid of picked rows.
  final waiting = <FieldNode>[];
  for (final section in model.sections) {
    for (final node in section.nodes) {
      _storePaths(model, node, [section.section.id, node.field.id], waiting);
    }
  }
  final fixed = Map.of(model.leaves);
  for (final grid in waiting) {
    final found = _leafIn(model.sections, fixed, (grid.field as GridDef).pickedIn!, grid, null);
    final holds = found.leaf?.holds;
    if (holds is! CodesHolds || !holds.many) continue;
    grid.picked = found.leaf;
    grid.rows = [for (final option in holds.options) option.code];
    _storeRows(model, grid, grid.base!, grid.field.sides);
  }
  return model;
}

List<FieldNode> _fieldNodes(PathModel model, List<FieldDef> fields, String at, SectionNode section, FieldNode? parent) {
  final siblings = <FieldNode>[];
  final ids = <String>{};
  for (final (index, field) in fields.indexed) {
    if (!ids.add(field.id)) continue;
    siblings.add(_fieldNode(model, field, '$at.fields[$index]', section, parent, siblings));
  }
  return siblings;
}

FieldNode _fieldNode(
  PathModel model,
  FieldDef field,
  String at,
  SectionNode section,
  FieldNode? parent,
  List<FieldNode> siblings,
) {
  final grid = parent == null ? null : (parent.field is GridDef ? parent : parent.grid);
  final node = FieldNode(field: field, at: at, section: section, parent: parent, siblings: siblings, grid: grid);
  model.nodes.add(node);
  switch (field) {
    case GroupDef(:final fields):
      node.children = _fieldNodes(model, fields, at, section, node);
    case GridDef(:final cell):
      final alone = <FieldNode>[];
      final cellNode = _fieldNode(model, cell, '$at.cell', section, node, alone);
      alone.add(cellNode);
      node.cell = cellNode;
    default:
  }
  return node;
}

/// Works out every path stored by a field and what is in it. [base] is the path of the field itself.
void _storePaths(
  PathModel model,
  FieldNode node,
  List<String> base,
  List<FieldNode> waiting, {
  String? row,
  bool sided = false,
}) {
  final field = node.field;
  if (node.grid == null) node.base = base;
  // Right and left are the last part of a path. A grid's sides are its cells'.
  final sides = sided || field.sides;
  void store(List<String> parts, Holds holds, {bool otherText = false}) {
    if (sides) {
      for (final side in sideNames) {
        _storeLeaf(model, node, [...parts, side], row, holds, sided: true, otherText: otherText);
      }
    } else {
      _storeLeaf(model, node, parts, row, holds, otherText: otherText);
    }
  }

  switch (field) {
    case ChoiceDef():
      store(base, CodesHolds(many: field.many, options: field.options, excludes: field.excludes));
      // The text is stored beside the answer: at the same path, with `_other` added to its last part.
      if (field.options.any((option) => option.other)) {
        store([...base.sublist(0, base.length - 1), '${base.last}_other'], _otherText, otherText: true);
      }
    case TextDef():
      store(base, TextHolds(field.maxLength));
    case NumberDef():
      store(base, NumberHolds(min: field.min, max: field.max, decimals: field.decimals, unit: field.unit));
    case DateDef():
      store(base, DateHolds(field.range));
    case FlagDef():
      store(base, const SimpleHolds(SimpleKind.flag));
    case TimeDef():
      store(base, const SimpleHolds(SimpleKind.time));
    case DurationDef():
      store(base, const SimpleHolds(SimpleKind.duration));
    case GroupDef():
      for (final child in node.children) {
        _storePaths(model, child, [...base, child.field.id], waiting, row: row, sided: sided);
      }
    case GridDef():
      final rows = field.rows;
      if (rows == null) {
        // In a grid's own cell there is no path yet to wait for.
        if (node.grid == null) waiting.add(node);
        return;
      }
      node.rows = [for (final option in rows) option.code];
      _storeRows(model, node, base, sides);
    case RegionDef():
      // Never sided: a region has a side of its own.
      _storeLeaf(model, node, [...base, 'region'], row, CodesHolds(many: false, options: field.options));
      if (field.side case final side?) {
        _storeLeaf(
          model,
          node,
          [...base, 'side'],
          row,
          CodesHolds(many: false, options: side),
          optionsAt: '${node.at}.side',
        );
      }
      if (field.surface case final surface?) {
        _storeLeaf(
          model,
          node,
          [...base, 'surface'],
          row,
          CodesHolds(many: false, options: surface),
          optionsAt: '${node.at}.surface',
        );
      }
    case ProblemDef():
      _storeLeaf(model, node, [...base, 'code'], row, const SimpleHolds(SimpleKind.problemCode));
      _storeLeaf(model, node, [...base, 'label'], row, const SimpleHolds(SimpleKind.problemLabel));
    case PhotoDef() || ActionDef() || InfoDef():
      return;
  }
}

/// One cell for each row, at the grid's path and then the row's code. The cell's own id is no path part.
void _storeRows(PathModel model, FieldNode grid, List<String> base, bool sided) {
  // A code used twice would only repeat the first row's paths.
  for (final row in LinkedHashSet.of(grid.rows)) {
    _storePaths(model, grid.cell!, [...base, row], [], row: row, sided: sided);
  }
}

void _storeLeaf(
  PathModel model,
  FieldNode node,
  List<String> parts,
  String? row,
  Holds holds, {
  String? optionsAt,
  bool sided = false,
  bool otherText = false,
}) {
  final key = parts.join('.');
  // The field's own path: a side, a region's and a problem's own parts left out. The text of an
  // Other option is the option's, not the field's.
  final own = sided || node.field is RegionDef || node.field is ProblemDef ? parts.sublist(0, parts.length - 1) : parts;
  final leaf = Leaf(
    key: key,
    parts: parts,
    node: node,
    row: row,
    holds: holds,
    optionsAt: optionsAt ?? (holds is CodesHolds ? '${node.at}.options' : null),
    fieldPath: otherText ? null : own.join('.'),
  );
  for (FieldNode? above = node; above != null; above = above.parent) {
    above.leaves.add(leaf);
  }
  model.leaves.putIfAbsent(key, () => leaf);
}

/// Why a path a condition or a grid names has no answer.
enum PathFault { unknownField, relativeOutsideEntry, pathIntoRepeat }

/// The answer a condition's (or a grid's) path names, read from where it is written: [carrier] is
/// the field that carries it, null for a section's own condition. `./` starts from the row inside
/// the cell of a grid, and otherwise from the entry of a repeating section (2.2).
({Leaf? leaf, PathFault? fault}) leafAt(PathModel model, String path, FieldNode? carrier, String? row) =>
    _leafIn(model.sections, model.leaves, path, carrier, row);

({Leaf? leaf, PathFault? fault}) _leafIn(
  List<SectionNode> sections,
  Map<String, Leaf> leaves,
  String path,
  FieldNode? carrier,
  String? row,
) {
  var key = path;
  if (path.startsWith('./')) {
    final List<String> from;
    final grid = carrier?.grid;
    if (grid != null) {
      final base = grid.base;
      if (base == null || row == null) return (leaf: null, fault: PathFault.unknownField);
      from = [...base, row];
    } else if (carrier != null && carrier.section.section.repeat != null) {
      from = [carrier.section.section.id];
    } else {
      return (leaf: null, fault: PathFault.relativeOutsideEntry);
    }
    key = [...from, path.substring(2)].join('.');
  } else {
    final id = path.split('.').first;
    for (final section in sections) {
      if (section.section.id == id) {
        if (section.section.repeat != null) return (leaf: null, fault: PathFault.pathIntoRepeat);
        break;
      }
    }
  }
  final leaf = leaves[key];
  return leaf == null ? (leaf: null, fault: PathFault.unknownField) : (leaf: leaf, fault: null);
}
