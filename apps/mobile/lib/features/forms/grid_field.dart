import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../../forms/layout.dart' show sideLabels;
import '../../forms/paths.dart' show sideNames;
import 'choice_field.dart' show pickedCodes;
import 'group_field.dart' show Collapsible;

/// Draws a grid's cell in one row, for one side (null where the grid has none): the form's field
/// host for the cell at [cellPath], bare, since the row's label stands for the cell's.
typedef GridCellBuilder = Widget Function(OptionDef row, String? side);

/// The narrowest a side of a row is drawn, at 100% text. Below twice that, the sides go one under
/// the other.
const gridSideMinWidth = 280.0;

/// The rows a grid shows: its own, or the options picked in the choose-many its rows are picked in
/// ([options], the [picked] answer as stored), in that field's order (forms 2.3).
List<OptionDef> gridRows(GridDef field, {List<OptionDef> options = const [], Object? picked}) {
  if (field.rows case final rows?) return rows;
  final codes = picked is List ? pickedCodes(picked) : const <String>[];
  return [
    for (final o in options)
      if (codes.contains(o.code)) o,
  ];
}

/// Where a grid's cells are answered: right then left where it has sides, otherwise once (null).
/// A region or a problem is never sided in a grid (D80): it has a side of its own, and the path
/// model gives it none. The validator refuses such a grid; were one let through, it is drawn as the
/// paths are.
List<String?> gridSides(GridDef field) => field.sides && !_holdsWhole(field.cell) ? sideNames : const [null];

bool _holdsWhole(FieldDef f) => f is RegionDef || f is ProblemDef || (f is GroupDef && f.fields.any(_holdsWhole));

/// The path of a cell (2.3): the grid's path, the row's code, then the side. A group cell's fields
/// add their IDs after the row's code.
String cellPath(String gridPath, String row, [String? side]) =>
    side == null ? '$gridPath.$row' : '$gridPath.$row.$side';

/// A grid (forms 2.2 `grid`, 8.2): one [cell] for each row, rows one per line in their order, each
/// named by its label for a screen reader; with sides, a Right and a Left in each row, side by
/// side where both fit and one under the other on a phone, at 320 px and at 200% text, so it never
/// scrolls sideways. A collapsed grid is closed until tapped. It stores nothing itself.
///
/// [rows] are worked out by the form ([gridRows]): picked rows follow what is picked, and a row
/// whose option is unpicked no longer counts (2.3), so it is not drawn.
class GridField extends StatefulWidget {
  const GridField({super.key, required this.field, required this.rows, required this.cell, this.filled = false});

  final GridDef field;
  final List<OptionDef> rows;
  final GridCellBuilder cell;

  /// Something in the grid is answered: a collapsed grid then opens with it showing.
  final bool filled;

  @override
  State<GridField> createState() => _GridFieldState();
}

class _GridFieldState extends State<GridField> {
  late bool _open = !widget.field.collapsed || widget.filled;

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    final text = Theme.of(context).textTheme;
    final sides = gridSides(f);
    final Widget body;
    if (widget.rows.isEmpty) {
      body = Text('Each one picked above gets its own line here.', style: text.bodyLarge);
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, row) in widget.rows.indexed) ...[
            if (i > 0) Divider(height: FieldSpace.s5, color: context.field.line),
            _Row(row: row, sides: sides, cell: widget.cell),
          ],
        ],
      );
    }
    if (!f.collapsed) {
      return Semantics(container: true, explicitChildNodes: true, label: f.label, child: body);
    }
    return Collapsible(
      label: f.label,
      help: f.help,
      open: _open,
      onToggle: () => setState(() => _open = !_open),
      child: body,
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.row, required this.sides, required this.cell});
  final OptionDef row;
  final List<String?> sides;
  final GridCellBuilder cell;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final Widget cells;
    if (sides.length == 1) {
      cells = cell(row, sides.single);
    } else {
      final least = MediaQuery.textScalerOf(context).scale(gridSideMinWidth);
      cells = LayoutBuilder(
        builder: (context, constraints) {
          final blocks = [for (final side in sides) _Side(side: sideLabels[side]!, child: cell(row, side))];
          if (constraints.maxWidth < least * 2 + FieldSpace.s4) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (i, b) in blocks.indexed) ...[if (i > 0) const SizedBox(height: FieldSpace.s3), b],
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final (i, b) in blocks.indexed) ...[
                if (i > 0) const SizedBox(width: FieldSpace.s4),
                Expanded(child: b),
              ],
            ],
          );
        },
      );
    }
    // The row's label stands for the cell's (forms 7.1), so a screen reader hears "Radial, Right, 2+".
    return Semantics(
      container: true,
      explicitChildNodes: true,
      label: row.label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ExcludeSemantics(child: Text(row.label, style: text.titleSmall)),
          const SizedBox(height: FieldSpace.s2),
          cells,
        ],
      ),
    );
  }
}

class _Side extends StatelessWidget {
  const _Side({required this.side, required this.child});
  final String side;
  final Widget child;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    explicitChildNodes: true,
    label: side,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ExcludeSemantics(child: Text(side, style: Theme.of(context).textTheme.labelLarge)),
        const SizedBox(height: FieldSpace.s1),
        child,
      ],
    ),
  );
}
