import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/status_chip.dart';
import '../../forms/definition.dart';
import '../../forms/layout.dart' show displayValue, sideLabels;
import '../../forms/paths.dart';
import '../patients/patient_labels.dart' show isoDay, longDate;
import '../sync/sync_labels.dart' show timeOfDay, valueText;
import 'date_field.dart';
import 'duration_field.dart';
import 'flag_field.dart';
import 'info_field.dart';
import 'photo_field.dart';
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
  const FieldHost({super.key, required this.field, required this.path, required this.answers, this.enabled = true});

  final FieldDef field;

  /// The field's own path, the entry part included and no side: `wound.e0000001.length`.
  final String path;
  final FormAnswers answers;

  /// False for a finished note, a frozen store, or a field a set flag clears: read-only.
  final bool enabled;

  /// The kinds that show their own label (a text box's, a tick's, a button's) and their own help.
  bool get _ownLabel => field is TextDef || field is FlagDef || field is ActionDef;

  @override
  Widget build(BuildContext context) {
    final f = field;
    // Guidance: its label is the text, and it stores nothing.
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
          if (paths.length == 1) _answer(context, p) else _side(context, sideLabels[p.split('.').last]!, p),
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
        _answer(context, p),
      ],
    ),
  );

  Widget _answer(BuildContext context, String p) {
    final state = answers.at(p);
    final value = state.value;
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
      final PhotoDef f => PhotoField(key: key, field: f),
      // Each of these is its own card of unit F5, which puts its widget here.
      InfoDef() ||
      ChoiceDef() ||
      NumberDef() ||
      GroupDef() ||
      GridDef() ||
      RegionDef() ||
      ProblemDef() ||
      ActionDef() => _NotYet(field: field),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        widget,
        if (state.pending) ...[
          const SizedBox(height: FieldSpace.s1),
          const Align(
            alignment: AlignmentDirectional.centerStart,
            child: StatusChip(label: 'Waiting to send', icon: LucideIcons.smartphone, tone: ChipTone.info),
          ),
        ],
        if (state.conflict case final conflict?) ...[
          const SizedBox(height: FieldSpace.s2),
          _ConflictChoice(field: field, mine: value, conflict: conflict, enabled: enabled),
        ],
      ],
    );
  }
}

/// A kind whose widget isn't built yet.
class _NotYet extends StatelessWidget {
  const _NotYet({required this.field});
  final FieldDef field;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: field.label,
    child: Text('This can’t be answered on this phone yet.', style: Theme.of(context).textTheme.bodyMedium),
  );
}

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
