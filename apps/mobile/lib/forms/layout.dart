/// A note's answers laid out for a person to read (phase 4 design, forms 7.1; lifecycle 5.1, 8.1 and
/// 9.7): the items of each section and entry, each with its labels and its value written out. The
/// read model and the recap are both made from it, so they say the same thing in the same words.
/// packages/forms/src/interp/layout.ts writes every value the same way, character for character:
/// the conformance vectors hold the two together.
library;

import 'conditions.dart';
import 'definition.dart';
import 'paths.dart';

/// One thing a reader sees: an answer, or the answers of a region, a problem or a choice and its
/// Other text.
class Item {
  const Item({required this.path, required this.labels, required this.value, required this.covers});

  /// The answer's path in the note; for a region or a problem, the field's own path.
  final String path;

  /// The labels along the path: the groups', the grid's, the row's, the field's, then Right or Left.
  final List<String> labels;

  /// Written out; null for an answer a correction took away (`struck`), which holds none now.
  final String? value;

  /// Every answer path the item shows.
  final List<String> covers;
}

/// An entry of a repeating section that has an item, with its title.
class LaidOutEntry {
  const LaidOutEntry({required this.id, required this.title, required this.items});
  final String id;
  final String title;
  final List<Item> items;
}

class LaidOutSection {
  const LaidOutSection({required this.section, required this.items, required this.entries});
  final SectionDef section;

  /// A section that does not repeat.
  final List<Item> items;

  /// A repeating section's entries that have an item, each with its number among the entries that
  /// are there; null for a section that does not repeat.
  final List<LaidOutEntry>? entries;
}

/// The words for the two sides (forms 2.3: right before left).
const sideLabels = {'right': 'Right', 'left': 'Left'};

/// The sections of [answers] in the definition's order, with only the sections and entries that
/// have an item. [answers] are answers that count (effectiveAnswers, perhaps less what a reader may
/// not see): each is shown as it is, and nothing here works out a condition again. [skip] leaves a
/// field out, and everything in it.
///
/// An entry's number is its place among the entries that are there (entryAt, in the order added),
/// as the form numbers them; an entry with nothing to show is not listed, and keeps its number.
///
/// [struck] are paths not in [answers] that are laid out all the same, at their place, with no
/// value: the read model's answers a correction cleared or hid, whose old value it shows struck
/// through. Only a path in an entry that is there can be laid out.
List<LaidOutSection> layOut(
  NoteTypeDef definition,
  Answers answers, {
  bool Function(FieldNode node)? skip,
  Set<String> struck = const {},
}) {
  final reading = NoteReading(definition, answers);
  final laid = <LaidOutSection>[];
  for (final section in reading.model.sections) {
    List<Item> itemsOf(String? entry) {
      final items = <Item>[];
      final walker = _Walker(reading, answers, entry, skip ?? (_) => false, struck, items);
      for (final node in section.nodes) {
        walker.walk(node, const [], null);
      }
      return items;
    }

    final repeat = section.section.repeat;
    if (repeat == null) {
      final items = itemsOf(null);
      if (items.isNotEmpty) laid.add(LaidOutSection(section: section.section, items: items, entries: null));
      continue;
    }
    final entries = [
      for (final (index, id) in reading.entries(section).indexed)
        LaidOutEntry(id: id, title: repeat.itemTitle.replaceAll('{n}', '${index + 1}'), items: itemsOf(id)),
    ].where((entry) => entry.items.isNotEmpty).toList();
    if (entries.isNotEmpty) laid.add(LaidOutSection(section: section.section, items: const [], entries: entries));
  }
  return laid;
}

class _Walker {
  _Walker(this.reading, this.answers, this.entry, this.skip, this.struck, this.items);
  final NoteReading reading;
  final Answers answers;
  final String? entry;
  final bool Function(FieldNode node) skip;
  final Set<String> struck;
  final List<Item> items;

  /// An answer is laid out when it is there, or when it is struck.
  bool _shown(String path) => answers.containsKey(path) || struck.contains(path);

  /// [labels] are those above the field; [row] is the grid row it is in, if any.
  void walk(FieldNode node, List<String> labels, String? row) {
    if (skip(node)) return;
    final field = node.field;
    // A grid's cell has no path part of its own, so no label: the row's stands for it.
    final own = node.parent?.cell == node ? labels : [...labels, field.label];
    switch (field) {
      case GroupDef():
        for (final child in node.children) {
          walk(child, own, row);
        }
      case GridDef(:final rows):
        final picked = node.picked?.holds;
        final options = rows ?? (picked is CodesHolds ? picked.options : const <OptionDef>[]);
        for (final code in node.rows) {
          final label = options.where((o) => o.code == code).firstOrNull?.label ?? code;
          walk(node.cell!, [...own, label], code);
        }
      case RegionDef() || ProblemDef():
        _whole(node, own, row);
      case PhotoDef() || ActionDef() || InfoDef():
        return;
      default:
        for (final leaf in ownLeaves(node)) {
          if (leaf.row == row) _answer(node, leaf, own);
        }
    }
  }

  /// One answer, and for a choice the Other text beside it, on the same side.
  void _answer(FieldNode node, Leaf leaf, List<String> labels) {
    final path = reading.pathOf(leaf, entry);
    final sided = node.field.sides || (node.grid?.field.sides ?? false);
    final side = sided ? leaf.parts.last : null;
    final other = node.leaves
        .where(
          (l) => l.node == node && l.fieldPath == null && l.row == leaf.row && (side == null || l.parts.last == side),
        )
        .firstOrNull;
    final otherPath = other != null ? reading.pathOf(other, entry) : null;
    // An Other text is laid out with its choice, so a struck text alone marks the choice's item.
    if (!_shown(path) && !(otherPath != null && struck.contains(otherPath))) return;
    final covers = [path];
    String? text;
    if (otherPath != null && _shown(otherPath)) {
      covers.add(otherPath);
      if (answers.containsKey(otherPath)) text = answers[otherPath]! as String;
    }
    final holds = leaf.holds;
    final String? value;
    if (!answers.containsKey(path)) {
      value = null;
    } else if (holds is CodesHolds) {
      value = _codeLabels(holds.options, answers[path], text);
    } else {
      value = displayValue(holds, answers[path], node.field);
    }
    items.add(
      Item(path: path, labels: side == null ? labels : [...labels, sideLabels[side]!], value: value, covers: covers),
    );
  }

  /// A region's region, side and surface, or a problem's code and label: one item at the field's path.
  void _whole(FieldNode node, List<String> labels, String? row) {
    final leaves = [
      for (final leaf in node.leaves)
        if (leaf.node == node && leaf.row == row) (leaf: leaf, path: reading.pathOf(leaf, entry)),
    ];
    final held = [
      for (final l in leaves)
        if (answers.containsKey(l.path)) l,
    ];
    final struckHere = [
      for (final l in leaves)
        if (!answers.containsKey(l.path) && struck.contains(l.path)) l,
    ];
    if (held.isEmpty && struckHere.isEmpty) return;
    final at = (held.isNotEmpty ? held.first : struckHere.first).path;
    String? shown(String part) {
      final found = held.where((l) => l.leaf.parts.last == part).firstOrNull;
      return found == null ? null : displayValue(found.leaf.holds, answers[found.path], node.field);
    }

    final String? value;
    if (held.isEmpty) {
      value = null;
    } else if (node.field is ProblemDef) {
      final (code, label) = (shown('code'), shown('label'));
      value = code != null && label != null ? '$label ($code)' : (label ?? code)!;
    } else {
      value = [for (final l in held) displayValue(l.leaf.holds, answers[l.path], node.field)].join(', ');
    }
    items.add(
      Item(
        path: at.substring(0, at.lastIndexOf('.')),
        labels: labels,
        value: value,
        covers: [
          for (final l in [...held, ...struckHere]) l.path,
        ],
      ),
    );
  }
}

/// The labels of the options picked, in the definition's order, joined by ', '. The Other text,
/// when there is one, follows the first Other option picked: `Other: <text>`.
String _codeLabels(List<OptionDef> options, Object? value, [String? text]) {
  final picked = value is String ? [value] : (value! as List<Object?>);
  var placed = text == null;
  final labels = <String>[];
  for (final option in options) {
    if (!picked.contains(option.code)) continue;
    if (placed || !option.other) {
      labels.add(option.label);
    } else {
      placed = true;
      labels.add('${option.label}: $text');
    }
  }
  return labels.join(', ');
}

/// One answer written out, as the holds of its path say: a code's label, several labels joined by
/// ', '; a number at its field's decimals, "n of max" when it is shown out of a maximum, then its
/// unit after a space; Yes for a tick; a duration in weeks and days; anything else as stored.
String displayValue(Holds holds, Object? value, FieldDef? field) {
  switch (holds) {
    case CodesHolds(:final options):
      return _codeLabels(options, value);
    case NumberHolds(:final decimals, :final max, :final unit):
      String shown(num n) => _fixed(n, decimals);
      final number = field is NumberDef && field.display == 'outOf'
          ? '${shown(value! as num)} of ${shown(max)}'
          : shown(value! as num);
      return unit == null ? number : '$number $unit';
    case SimpleHolds(kind: SimpleKind.flag):
      return 'Yes';
    case DurationHolds():
      return _duration((value! as num).toInt());
    default:
      return value! as String;
  }
}

/// A number at [decimals] places, as JavaScript's toFixed writes it. Dart writes a negative zero
/// with its sign, which toFixed drops.
String _fixed(num n, int decimals) => (n == 0 ? 0 : n).toStringAsFixed(decimals);

/// Whole days as weeks, then days, each only when not zero: "0 days", "1 day", "2 weeks 3 days".
String _duration(int days) {
  final weeks = days ~/ 7;
  final rest = days % 7;
  return [
    if (weeks > 0) weeks == 1 ? '1 week' : '$weeks weeks',
    if (rest > 0 || weeks == 0) rest == 1 ? '1 day' : '$rest days',
  ].join(' ');
}
