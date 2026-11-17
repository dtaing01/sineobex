import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/status_chip.dart';
import '../../forms/conditions.dart' show isBlank;
import '../../forms/definition.dart';
import '../../forms/layout.dart' show displayValue, sideLabels;
import '../../forms/paths.dart';
import '../patients/patient_labels.dart' show isoDay, longDate;
import '../sync/sync_labels.dart' show timeOfDay, valueText;
import 'action_field.dart';
import 'choice_field.dart';
import 'date_field.dart';
import 'duration_field.dart';
import 'flag_field.dart';
import 'grid_field.dart';
import 'group_field.dart';
import 'info_field.dart';
import 'number_field.dart';
import 'photo_field.dart';
import 'problem_field.dart';
import 'region_field.dart';
import 'text_field.dart';
import 'time_field.dart';

/// One field of a note form (phase 4 design, forms 8.1): the widget for its kind, its label and
/// help, and for each answer it stores "Waiting to send" while the server hasn't confirmed it and
/// phase 2's choice when two people changed it (lifecycle 9.5). A field with sides is answered
/// once for the right and once for the left.
///
/// Nothing here touches the store: the form hands the answers in ([FormAnswers]) and takes each
/// change back; the domain layer checks it (`checkAnswer`) and saves it.

/// What the form has of one answer.
class AnswerState {
  const AnswerState({this.value, this.pending = false, this.conflict});

  /// As stored: what JSON decodes.
  final Object? value;

  /// Saved on this phone and not yet confirmed by the server.
  final bool pending;
  final AnswerConflict? conflict;
}

/// Who holds the other value of a conflict, in phase 2's words.
enum ConflictBy { teammate, youElsewhere, server }

/// Two people changed one answer: the value on the server beside the one on this phone, until the
/// person chooses (the draft rule, lifecycle 1.2; phase 2's choice, PRD main 100).
class AnswerConflict {
  const AnswerConflict({required this.theirs, required this.by, this.at, this.onChoose});

  /// The value on the server.
  final Object? theirs;
  final ConflictBy by;
  final DateTime? at;

  /// True keeps the value on this phone. Null while the person can't choose (charting is paused
  /// for the phone's clock).
  final Future<void> Function(bool keepMine)? onChoose;
}

/// The answers of the note open in the form, by path (entry part included), and where a change
/// goes. The form gives one; a widget's change reaches it as `change(path, value)`, `null` being
/// the clear of an answer.
abstract interface class FormAnswers {
  AnswerState at(String path);
  void change(String path, Object? value);
}

/// The paths a field stores its own answer at: its path, or its path with each side added.
List<String> answerPaths(FieldDef field, String path) =>
    // A grid's sides go after its rows: the grid lays them out itself.
    field.sides && field is! GridDef ? [for (final side in sideNames) '$path.$side'] : [path];

class FieldHost extends StatelessWidget {
  const FieldHost({
    super.key,
    required this.field,
    required this.path,
    required this.answers,
    this.enabled = true,
    this.rows,
    this.actions,
    this.cell,
  });

  final FieldDef field;

  /// The field's own path, the entry part included and no side: `wound.e0000001.length`.
  final String path;
  final FormAnswers answers;

  /// False for a finished note, a frozen store, or a field a set flag clears: read-only.
  final bool enabled;

  /// The rows of a grid whose rows are picked in a choose-many ([gridRows]), which the form works
  /// out from the definition. Null for any other field: a grid's own rows are its definition's.
  final List<OptionDef>? rows;

  /// What the screen does for an action field; an action it gives nothing to do is not offered.
  /// Passed on to the fields of a group.
  final ActionHandler? actions;

  /// In a grid's cell: the row's path, without a side. The cell is drawn bare, its row's label
  /// standing for its own (forms 7.1), and a choice's Other text is kept beside the row's path,
  /// before the side (2.3: `<grid>.<row>_other.right`).
  final String? cell;

  /// The kinds that show their own label (a text box's, a number's, a tick's, a button's, a
  /// diagnosis's search box, the header of a collapsed group or grid) and their own help.
  bool get _ownLabel => switch (field) {
    TextDef() || NumberDef() || FlagDef() || ActionDef() || ProblemDef() => true,
    GroupDef(:final collapsed) || GridDef(:final collapsed) => collapsed,
    _ => false,
  };

  @override
  Widget build(BuildContext context) {
    final f = field;
    // Guidance: its label is the text, and it stores nothing.
    if (cell != null) return _answer(context, f, cell!, path);
    if (f is InfoDef) return InfoField(field: f);
    final text = Theme.of(context).textTheme;
    final paths = answerPaths(f, path);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!_ownLabel) ...[
          // Each control says the field's label itself, so a screen reader hears it once.
          ExcludeSemantics(child: Text(f.label, style: text.titleMedium)),
          if (f.help != null) ...[
            const SizedBox(height: FieldSpace.s1),
            Text(f.help!, style: text.bodyMedium?.copyWith(color: context.field.inkMuted)),
          ],
          const SizedBox(height: FieldSpace.s2),
        ],
        for (final (i, p) in paths.indexed) ...[
          if (i > 0) const SizedBox(height: FieldSpace.s3),
          if (paths.length == 1)
            _answer(context, field, path, p)
          else
            _side(context, sideLabels[p.split('.').last]!, p),
        ],
      ],
    );
  }

  Widget _side(BuildContext context, String side, String p) => Semantics(
    container: true,
    label: side,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ExcludeSemantics(child: Text(side, style: Theme.of(context).textTheme.labelLarge)),
        const SizedBox(height: FieldSpace.s1),
        _answer(context, field, path, p),
      ],
    ),
  );

  /// Whether [field] at [p] holds an answer: a collapsed group or grid that does opens with it
  /// showing.
  bool _holdsAny(FieldDef field, String p) => switch (field) {
    GroupDef(:final fields) => fields.any((c) => _holdsAny(c, '$p.${c.id}')),
    GridDef(:final cell) => [
      for (final row in (identical(field, this.field) ? rows : null) ?? gridRows(field))
        for (final side in gridSides(field)) cellPath(p, row.code, side),
    ].any((at) => _holdsAny(cell, at)),
    RegionDef() => regionParts.any((part) => !isBlank(answers.at('$p.$part').value)),
    ProblemDef() => problemParts.any((part) => !isBlank(answers.at('$p.$part').value)),
    _ => answerPaths(field, p).any((at) => !isBlank(answers.at(at).value)),
  };

  /// The widget of [field] for its answer at [p], with "Waiting to send" and the conflict choice of
  /// each answer it shows. [fieldPath] is the field's path without a side: a grid's cell's is its
  /// row's.
  Widget _answer(BuildContext context, FieldDef field, String fieldPath, String p) {
    final state = answers.at(p);
    final value = state.value;
    // A region's and a diagnosis's answers are their parts; a group or a grid shows its fields' in
    // each field.
    final shown = switch (field) {
      RegionDef() => [for (final part in regionParts) '$p.$part'],
      ProblemDef() => [for (final part in problemParts) '$p.$part'],
      _ => [p],
    };
    final states = [for (final at in shown) answers.at(at)];
    void change(Object? v) => answers.change(p, v);
    // Keyed by its path: a widget's typing never moves to another answer.
    final key = ValueKey('form.$p');
    final widget = switch (field) {
      final TextDef f => NoteTextField(
        key: key,
        field: f,
        value: value is String ? value : null,
        onChanged: change,
        enabled: enabled,
      ),
      final FlagDef f => FlagField(key: key, field: f, value: value == true, onChanged: change, enabled: enabled),
      final DateDef f => DateField(
        key: key,
        field: f,
        value: value is String ? value : null,
        onChanged: change,
        enabled: enabled,
      ),
      final TimeDef f => TimeField(
        key: key,
        field: f,
        value: value is String ? value : null,
        onChanged: change,
        enabled: enabled,
      ),
      final DurationDef f => DurationField(
        key: key,
        field: f,
        value: value is num && value == value.truncate() ? value.toInt() : null,
        onChanged: change,
        enabled: enabled,
      ),
      final ChoiceDef f => ChoiceField(
        key: key,
        field: f,
        value: value,
        onChanged: change,
        other: switch (answers.at(otherTextPath(fieldPath, p)).value) {
          final String text => text,
          _ => null,
        },
        onOtherChanged: (v) => answers.change(otherTextPath(fieldPath, p), v),
        enabled: enabled,
      ),
      final NumberDef f => NumberField(
        key: key,
        field: f,
        value: value is num ? value : null,
        onChanged: change,
        enabled: enabled,
      ),
      final GroupDef f => GroupField(
        key: key,
        field: f,
        enabled: enabled,
        filled: _holdsAny(f, p),
        ticked: (flag) => answers.at('$p.${flag.id}').value == true,
        child: (c, {required enabled}) =>
            FieldHost(field: c, path: '$p.${c.id}', answers: answers, enabled: enabled, actions: actions),
      ),
      final GridDef f => GridField(
        key: key,
        field: f,
        rows: rows ?? gridRows(f),
        filled: _holdsAny(f, p),
        // The row's label stands for the cell's, so the cell is drawn bare.
        cell: (row, side) => _answer(context, f.cell, cellPath(p, row.code), cellPath(p, row.code, side)),
      ),
      final RegionDef f => RegionField(
        key: key,
        field: f,
        value: regionAnswer((part) => answers.at('$p.$part').value),
        onChanged: (part, code) => answers.change('$p.$part', code),
        enabled: enabled,
      ),
      final ProblemDef f => ProblemField(
        key: key,
        field: f,
        value: problemAnswer((part) => answers.at('$p.$part').value),
        // A code and its label are one diagnosis: both are written together.
        onChanged: (v) {
          answers.change('$p.code', v.code);
          answers.change('$p.label', v.label);
        },
        enabled: enabled,
      ),
      final PhotoDef f => PhotoField(key: key, field: f),
      final ActionDef f => ActionField(key: key, field: f, onPressed: actions?.call(f, p), enabled: enabled),
      // A guidance line inside a group is hosted on its own; one in a grid's cell is drawn here.
      final InfoDef f => InfoField(key: key, field: f),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        widget,
        if (states.any((s) => s.pending)) ...[
          const SizedBox(height: FieldSpace.s1),
          const Align(
            alignment: AlignmentDirectional.centerStart,
            child: StatusChip(label: 'Waiting to send', icon: LucideIcons.smartphone, tone: ChipTone.info),
          ),
        ],
        if (field is ProblemDef && states.where((s) => s.conflict != null).length > 1)
        // A code and its label are one diagnosis: one choice keeps both of one side, so a code is
        // never kept with the other's label.
        ...[
          const SizedBox(height: FieldSpace.s2),
          _ConflictChoice(
            field: field,
            mine: _problemOf(states, theirs: false),
            conflict: _oneConflict(states),
            enabled: enabled,
          ),
        ] else
          for (final s in states)
            if (s.conflict case final conflict?) ...[
              const SizedBox(height: FieldSpace.s2),
              _ConflictChoice(field: field, mine: s.value, conflict: conflict, enabled: enabled),
            ],
      ],
    );
  }
}

/// A diagnosis written out from its parts' states ([problemParts]), as this phone holds it or, with
/// [theirs], as the other side of each conflict holds it.
String? _problemOf(List<AnswerState> parts, {required bool theirs}) {
  String? at(int i) => switch (theirs ? (parts[i].conflict?.theirs ?? parts[i].value) : parts[i].value) {
    final String t when t.isNotEmpty => t,
    _ => null,
  };
  return problemText((code: at(0), label: at(1)));
}

/// The conflicts on a diagnosis's code and label as one: choosing keeps both parts of one side.
/// It can be chosen only when each part's can.
AnswerConflict _oneConflict(List<AnswerState> parts) {
  final conflicts = [for (final s in parts) ?s.conflict];
  final choosers = [for (final c in conflicts) c.onChoose];
  return AnswerConflict(
    theirs: _problemOf(parts, theirs: true),
    by: conflicts.first.by,
    at: conflicts.first.at,
    onChoose: choosers.contains(null)
        ? null
        : (keepMine) async {
            for (final choose in choosers) {
              await choose!(keepMine);
            }
          },
  );
}

/// Where the Other text of the choice at [answerPath] is kept (forms 2.3): `_other` on the field's
/// own part, before its side. [fieldPath] is the field's path without a side.
String otherTextPath(String fieldPath, String answerPath) =>
    '${fieldPath}_other${answerPath.substring(fieldPath.length)}';

/// One answer written out for a person, as the read view writes it ("(blank)" for none, as phase
/// 2's choice does). A value of the wrong type for its field is shown as stored.
String answerText(FieldDef field, Object? value) {
  if (value == null || value == '') return valueText(null);
  final Holds? holds = switch (field) {
    TextDef(:final maxLength) when value is String => TextHolds(maxLength),
    FlagDef() when value == true => const SimpleHolds(SimpleKind.flag),
    TimeDef() when value is String => const SimpleHolds(SimpleKind.time),
    DurationDef(:final max) when value is num && value == value.truncate() => DurationHolds(max ?? maxDurationDays),
    NumberDef(:final min, :final max, :final decimals, :final unit) when value is num => NumberHolds(
      min: min,
      max: max,
      decimals: decimals,
      unit: unit,
    ),
    ChoiceDef(:final many, :final options)
        when (many ? value is List<Object?> && value.every((c) => c is String) : value is String) =>
      CodesHolds(many: many, options: options),
    _ => null,
  };
  // One part of a region: its label in whichever of the region's lists holds it.
  if (field is RegionDef && value is String) {
    final options = [...field.options, ...?field.side, ...?field.surface];
    return options.where((o) => o.code == value).firstOrNull?.label ?? value;
  }
  if (field is DateDef && value is String) {
    final day = isoDay(value);
    return day == null ? value : longDate(day);
  }
  return holds == null ? valueText(value) : displayValue(holds, value, field);
}

/// Phase 2's choice, on the field: both values side by side, and which to keep.
class _ConflictChoice extends StatelessWidget {
  const _ConflictChoice({required this.field, required this.mine, required this.conflict, required this.enabled});
  final FieldDef field;
  final Object? mine;
  final AnswerConflict conflict;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final choose = enabled ? conflict.onChoose : null;
    final who = switch (conflict.by) {
      ConflictBy.teammate => 'A teammate',
      ConflictBy.youElsewhere => 'You, from another phone',
      ConflictBy.server => 'On the server',
    };
    final when = conflict.at == null ? '' : ' at ${timeOfDay(context, conflict.at!)}';
    Widget side(String heading, Object? value) => Expanded(
      child: Semantics(
        container: true,
        child: Container(
          padding: const EdgeInsets.all(FieldSpace.s3),
          decoration: BoxDecoration(
            color: c.surface,
            border: Border.all(color: c.lineStrong),
            borderRadius: BorderRadius.circular(FieldRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(heading, style: text.labelLarge?.copyWith(color: c.inkMuted)),
              const SizedBox(height: FieldSpace.s1),
              Text(answerText(field, value), style: text.titleMedium),
            ],
          ),
        ),
      ),
    );
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.all(FieldSpace.s3),
        decoration: BoxDecoration(
          color: c.warningSoft,
          border: Border.all(color: c.warning, width: 1.5),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'This field already had a different value. Choose which one to keep.',
              style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: FieldSpace.s3),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  side('Your value', mine),
                  const SizedBox(width: FieldSpace.s2),
                  side('$who$when', conflict.theirs),
                ],
              ),
            ),
            const SizedBox(height: FieldSpace.s3),
            FilledButton(
              onPressed: choose == null ? null : () => unawaited(choose(true)),
              child: const Text('Use my value'),
            ),
            const SizedBox(height: FieldSpace.s2),
            OutlinedButton(
              onPressed: choose == null ? null : () => unawaited(choose(false)),
              child: Text('Keep ${conflict.by == ConflictBy.server ? 'the server’s' : 'theirs'}'),
            ),
            const SizedBox(height: FieldSpace.s1),
            if (enabled && conflict.onChoose == null) ...[
              Text('You can choose once the phone’s clock is right.', style: text.bodyMedium),
              const SizedBox(height: FieldSpace.s1),
            ],
            Text('Both values stay in the note’s history either way.', style: text.bodyMedium),
          ],
        ),
      ),
    );
  }
}
