import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/conditions.dart';
import '../../forms/definition.dart';
import '../../forms/paths.dart';
import 'action_field.dart';
import 'field_host.dart';
import 'grid_field.dart';
import 'group_field.dart';

/// A note's form (phase 4 design, forms 8.1; lifecycle 9.5): its sections as an accordion in the
/// definition's order, one open at a time, each drawing its fields with the field host.
///
/// Only what shows is drawn, as the interpreter reads the note (conditions.dart): a section or a
/// field whose condition doesn't hold is not drawn, and its stored answer is left alone, so it is
/// back if the field shows again (forms 7.1: each clear would be a change to sync). A grid has a
/// row for each option picked where its rows are picked. While a set flag counts, the fields it
/// clears are read-only (2.3). A section that `needs` a capability is drawn only for a credential
/// that has it (6.2: the Quick encounter's Medication).
///
/// Nothing here touches the store (8.1). The form takes the note's answers as stored and hands
/// each change to [NoteForm.onChanged], one answer at a time; the domain layer checks it
/// (`checkAnswer`) and saves it, and the screen draws the form again with the answers as it now
/// holds them, so what shows follows each answer at once.
class NoteForm extends StatefulWidget {
  const NoteForm({
    super.key,
    required this.definition,
    required this.answers,
    required this.onChanged,
    this.pending = const {},
    this.conflicts = const {},
    this.capabilities = const {},
    this.actions,
    this.enabled = true,
    this.openSection,
  });

  /// The note type version the note is written on.
  final NoteTypeDef definition;

  /// The note's answers by path, as stored.
  final Answers answers;

  /// One answer changed: its path (entry part included) and the value to store, null to clear it.
  /// It may be called in a microtask after the form has left the screen (a text box saves what
  /// was typed when Save & Close takes it away), so the screen must not need the form mounted.
  final void Function(String path, Object? value) onChanged;

  /// The answers saved on this phone that the server hasn't confirmed: "Waiting to send".
  final Set<String> pending;

  /// The answers two people changed, by path, with phase 2's choice.
  final Map<String, AnswerConflict> conflicts;

  /// What the person's credential may do, as a section's `needs` names it (`orderMedications`).
  final Set<String> capabilities;

  /// What the screen does for an action field; an action it gives nothing to do is not drawn.
  final ActionHandler? actions;

  /// False for a finished note or a frozen store: everything is read-only, and the sections still
  /// open to be read.
  final bool enabled;

  /// The section to open, by its ID (the summary's "jumps to it", lifecycle 9.6). Without one the
  /// first section that shows is open.
  final String? openSection;

  @override
  State<NoteForm> createState() => _NoteFormState();
}

class _NoteFormState extends State<NoteForm> implements FormAnswers {
  // PLAN-OPEN: which section a form opens at. The first that shows, unless the screen names one;
  // one open at a time, so a long exam doesn't become one long page.
  late String? _open = widget.openSection;
  bool _chose = false;
  final _keys = <String, GlobalKey>{};

  @override
  void initState() {
    super.initState();
    _chose = widget.openSection != null;
    if (_chose) _reveal(widget.openSection!);
  }

  @override
  void didUpdateWidget(NoteForm old) {
    super.didUpdateWidget(old);
    final asked = widget.openSection;
    if (asked != null && asked != old.openSection) {
      _open = asked;
      _chose = true;
      _reveal(asked);
    }
  }

  // The field host's view of the answers. A change made as a field leaves the screen still
  // reaches the screen: `widget` stays the last one given.
  @override
  AnswerState at(String path) => AnswerState(
    value: widget.answers[path],
    pending: widget.pending.contains(path),
    conflict: widget.conflicts[path],
  );

  @override
  void change(String path, Object? value) => widget.onChanged(path, value);

  GlobalKey _keyOf(String section) => _keys.putIfAbsent(section, GlobalKey.new);

  /// Brings a section's header into view once it is drawn.
  void _reveal(String section) => WidgetsBinding.instance.addPostFrameCallback((_) {
    final at = _keys[section]?.currentContext;
    if (at != null && at.mounted) Scrollable.ensureVisible(at, duration: const Duration(milliseconds: 200));
  });

  void _toggle(String section) {
    setState(() {
      _chose = true;
      _open = _open == section ? null : section;
    });
    if (_open != null) _reveal(section);
  }

  @override
  Widget build(BuildContext context) {
    final reading = NoteReading(widget.definition, widget.answers);
    final shown = [
      for (final s in reading.model.sections)
        if (reading.sectionShows(s) && (s.section.needs == null || widget.capabilities.contains(s.section.needs))) s,
    ];
    final open = _chose ? _open : shown.firstOrNull?.section.id;
    final draw = _Drawing(this, reading);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, s) in shown.indexed) ...[
          if (i > 0) const SizedBox(height: FieldSpace.s3),
          _Section(
            key: _keyOf(s.section.id),
            section: s.section,
            open: open == s.section.id,
            onToggle: () => _toggle(s.section.id),
            child: open == s.section.id ? draw.section(s) : null,
          ),
        ],
      ],
    );
  }
}

/// Draws a section's fields from the note as it is now read.
class _Drawing {
  _Drawing(this.form, this.reading);
  final _NoteFormState form;
  final NoteReading reading;

  NoteForm get widget => form.widget;

  Widget section(SectionNode s) {
    final repeat = s.section.repeat;
    if (repeat == null) return fields(s, null);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (i, entry) in reading.entries(s).indexed) ...[
          if (i > 0) const SizedBox(height: FieldSpace.s5),
          fields(s, entry),
        ],
      ],
    );
  }

  /// The section's own fields, in an entry of a repeating section. A set flag among them makes the
  /// fields it clears read-only; a group applies its own flags.
  Widget fields(SectionNode s, String? entry) {
    final base = entry == null ? s.section.id : '${s.section.id}.$entry';
    final cleared = clearedBy([for (final n in s.nodes) n.field], (flag) => _ticked('$base.${flag.id}'));
    return FieldsInStack(
      children: [
        for (final n in s.nodes)
          ?field(n, '$base.${n.field.id}', entry: entry, enabled: widget.enabled && !cleared.contains(n.field.id)),
      ],
    );
  }

  /// A flag that is set and counts.
  bool _ticked(String path) => reading.counting(path) == true;

  /// One field at [path] (entry part included, no side), or null where it isn't drawn: its
  /// condition doesn't hold, or it is an action the screen gives nothing to do. [row] is the grid
  /// row it is in, and [side] the side a grid's sides give it.
  Widget? field(FieldNode node, String path, {String? entry, String? row, String? side, required bool enabled}) {
    final f = node.field;
    // Read from where it is written: `./` starts from the row in a grid's cell, else the entry.
    final showWhen = f.showWhen;
    if (showWhen != null && !reading.holds(showWhen, node, node.grid != null ? row : null, entry)) return null;
    final sided = side == null ? '' : '.$side';
    switch (f) {
      case GroupDef():
        return _labelled(
          f,
          GroupField(
            key: ValueKey('form.$path$sided'),
            field: f,
            enabled: enabled,
            filled: _holdsAny(node, entry, row),
            ticked: (flag) => _ticked('$path.${flag.id}$sided'),
            child: (c, {required enabled}) => field(
              node.children.firstWhere((n) => n.field == c),
              '$path.${c.id}',
              entry: entry,
              row: row,
              side: side,
              enabled: enabled,
            ),
          ),
        );
      case GridDef():
        return _labelled(
          f,
          GridField(
            key: ValueKey('form.$path'),
            field: f,
            rows: _rows(node, f, entry),
            filled: _holdsAny(node, entry, row),
            cell: (r, s) =>
                field(node.cell!, cellPath(path, r.code), entry: entry, row: r.code, side: s, enabled: enabled) ??
                const SizedBox.shrink(),
          ),
        );
      case ActionDef():
        final handler = enabled ? widget.actions?.call(f, path) : null;
        if (handler == null) return null;
        return ActionField(key: ValueKey('form.$path'), field: f, onPressed: handler);
      default:
        return FieldHost(
          key: ValueKey('host.$path$sided'),
          field: f,
          path: '$path$sided',
          answers: form,
          enabled: enabled,
        );
    }
  }

  /// A grid's rows: its own, or the options picked, where they count, in the field its rows are
  /// picked in.
  List<OptionDef> _rows(FieldNode node, GridDef f, String? entry) {
    final picked = node.picked;
    if (f.rows != null || picked == null) return gridRows(f);
    final holds = picked.holds;
    return gridRows(
      f,
      options: holds is CodesHolds ? holds.options : const [],
      picked: reading.counting(reading.pathOf(picked, entry)),
    );
  }

  /// Something is stored in the field (in that row): a collapsed group or grid then opens with it
  /// showing, so what was charted is never out of sight.
  bool _holdsAny(FieldNode node, String? entry, String? row) => node.leaves.any(
    (leaf) => (row == null || leaf.row == row) && !isBlank(reading.stored(reading.pathOf(leaf, entry))),
  );

  /// A group's or a grid's label and help above it, as the field host shows a field's. A collapsed
  /// one shows them in its header.
  Widget _labelled(FieldDef f, Widget body) {
    final collapsed = (f is GroupDef && f.collapsed) || (f is GridDef && f.collapsed);
    if (collapsed) return body;
    return Builder(
      builder: (context) {
        final text = Theme.of(context).textTheme;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The group or grid is named by its label for a screen reader, so the words are heard once.
            ExcludeSemantics(child: Text(f.label, style: text.titleMedium)),
            if (f.help != null) ...[
              const SizedBox(height: FieldSpace.s1),
              Text(f.help!, style: text.bodyMedium?.copyWith(color: context.field.inkMuted)),
            ],
            const SizedBox(height: FieldSpace.s2),
            body,
          ],
        );
      },
    );
  }
}

/// One section of the accordion: a header that opens and closes it, and its fields while open.
class _Section extends StatelessWidget {
  const _Section({super.key, required this.section, required this.open, required this.onToggle, this.child});
  final SectionDef section;
  final bool open;
  final VoidCallback onToggle;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    // A Material, not a decorated box: a tick's tile and every ink splash paint on it.
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: open ? c.lineStrong : c.line),
        borderRadius: BorderRadius.circular(FieldRadius.md),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            key: ValueKey('form.section.${section.id}'),
            button: true,
            expanded: open,
            label: section.title,
            onTap: onToggle,
            excludeSemantics: true,
            child: InkWell(
              onTap: onToggle,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: FieldTap.large),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s4, vertical: FieldSpace.s3),
                  child: Row(
                    children: [
                      Expanded(child: Text(section.title, style: text.titleLarge)),
                      const SizedBox(width: FieldSpace.s2),
                      Icon(open ? LucideIcons.chevronUp : LucideIcons.chevronDown),
                    ],
                  ),
                ),
              ),
            ),
          ),
          if (child != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s4),
              // Heard right after the header that names it.
              child: Semantics(container: true, explicitChildNodes: true, child: child),
            ),
        ],
      ),
    );
  }
}
