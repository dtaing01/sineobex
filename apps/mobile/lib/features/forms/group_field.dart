import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';

/// Draws one field inside a group: the form's field host for it, or null when the form hides it.
/// [enabled] is false where the group is read-only, or a set flag beside the field clears it.
typedef GroupChildBuilder = Widget? Function(FieldDef field, {required bool enabled});

/// The narrowest a field of a row is drawn, at 100% text. Below it the row takes another line.
const groupRowMinWidth = 160.0;

/// The IDs of the fields among [fields] that a flag beside them clears while it is set (forms 2.3):
/// they do not count, and their widgets are read-only. [ticked] says whether a flag is set.
Set<String> clearedBy(List<FieldDef> fields, bool Function(FlagDef flag) ticked) => {
  for (final f in fields)
    if (f is FlagDef && f.clears.isNotEmpty && ticked(f)) ...f.clears,
};

/// A group (forms 2.2 `group`, 8.2): its fields one under another (`stack`) or side by side
/// (`row`: blood pressure as two numbers), the row taking as many lines as the width and the text
/// size need, so it never scrolls sideways. A collapsed group is closed until its header is
/// tapped. It stores nothing itself: each field is drawn by [child] at its own path.
///
/// While a flag in the group is set, the fields it clears are read-only (2.3). Clearing writes
/// nothing to them: they count again once the flag is unticked. A flag in a section's own fields
/// is the form's to apply, and one in a grid's cell is applied by the cell's group, row by row.
class GroupField extends StatefulWidget {
  const GroupField({
    super.key,
    required this.field,
    required this.child,
    this.ticked = _none,
    this.filled = false,
    this.enabled = true,
  });

  final GroupDef field;
  final GroupChildBuilder child;

  /// Whether a flag of this group is set, where this group is.
  final bool Function(FlagDef flag) ticked;

  /// Something in the group is answered: a collapsed group then opens with it showing, so what was
  /// charted is never out of sight. PLAN-OPEN: whether a collapsed group or grid opens by itself
  /// (forms 10.1 #50): only when it holds an answer; otherwise it stays closed until tapped.
  final bool filled;

  /// False: every field in it is read-only. A collapsed group still opens, to be read.
  final bool enabled;

  @override
  State<GroupField> createState() => _GroupFieldState();
}

bool _none(FlagDef flag) => false;

class _GroupFieldState extends State<GroupField> {
  late bool _open = !widget.field.collapsed || widget.filled;

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    final cleared = clearedBy(f.fields, widget.ticked);
    final children = [for (final c in f.fields) ?widget.child(c, enabled: widget.enabled && !cleared.contains(c.id))];
    final body = f.layout == 'row' ? FieldsInRow(children: children) : FieldsInStack(children: children);
    if (!f.collapsed) {
      // Named, so a screen reader hears "Systolic" as blood pressure's. The field host shows the label.
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

/// Fields one under another.
class FieldsInStack extends StatelessWidget {
  const FieldsInStack({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (i, c) in children.indexed) ...[if (i > 0) const SizedBox(height: FieldSpace.s4), c],
    ],
  );
}

/// Fields side by side, equally wide, as many to a line as fit at [groupRowMinWidth] scaled by the
/// text size: two on a phone, one at 320 px or at 200% text.
class FieldsInRow extends StatelessWidget {
  const FieldsInRow({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final least = MediaQuery.textScalerOf(context).scale(groupRowMinWidth);
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = FieldSpace.s3;
        final fit = ((constraints.maxWidth + gap) / (least + gap)).floor();
        final perLine = fit.clamp(1, children.isEmpty ? 1 : children.length);
        final width = (constraints.maxWidth - gap * (perLine - 1)) / perLine;
        return Wrap(
          spacing: gap,
          runSpacing: FieldSpace.s4,
          children: [for (final c in children) SizedBox(width: width, child: c)],
        );
      },
    );
  }
}

/// A part of the form closed until its header is tapped (forms 2.2 `collapsed`): the header is a
/// button that says its label and whether it is open, and the help, when there is some, is under it.
class Collapsible extends StatelessWidget {
  const Collapsible({
    super.key,
    required this.label,
    required this.open,
    required this.onToggle,
    required this.child,
    this.help,
  });

  final String label;
  final String? help;
  final bool open;
  final VoidCallback onToggle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          button: true,
          expanded: open,
          label: label,
          onTap: onToggle,
          excludeSemantics: true,
          child: InkWell(
            onTap: onToggle,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: FieldTap.min),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: FieldSpace.s2),
                child: Row(
                  children: [
                    Expanded(child: Text(label, style: text.titleMedium)),
                    const SizedBox(width: FieldSpace.s2),
                    Icon(open ? LucideIcons.chevronUp : LucideIcons.chevronDown),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (help != null) ...[
          Text(help!, style: text.bodyMedium?.copyWith(color: context.field.inkMuted)),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (open) ...[
          const SizedBox(height: FieldSpace.s2),
          // Heard right after the header that names it.
          Semantics(container: true, explicitChildNodes: true, child: child),
        ],
      ],
    );
  }
}
