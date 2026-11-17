import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/tokens.dart';
import '../../forms/definition.dart';
import '../patients/patient_labels.dart' show isoDay, longDate;
import 'text_field.dart' show ReadOnlyAnswer;

/// How far back and ahead a date may be picked when its range allows. PLAN-OPEN: how far a note's
/// date picker reaches (a hundred years back, ten ahead here); the definition bounds only the side
/// of today (forms 2.2).
const datePickerYearsBack = 100;
const datePickerYearsAhead = 10;

/// `YYYY-MM-DD` of [day].
String isoDate(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

/// A date answer (forms 2.2 `date`), stored as `YYYY-MM-DD`. Its range bounds the picker only:
/// `past` is today or earlier, `future` today or later, both including today. `checkAnswer` has no
/// clock, so a stored date outside the range now (a follow-up date that has passed) is still shown
/// as it is.
///
/// The date is picked on the calendar only: a date is a patient detail, and the picker's typing
/// mode is a text box that the keyboard would learn from.
class DateField extends StatelessWidget {
  const DateField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.today,
  });

  final DateDef field;
  final String? value;

  /// `YYYY-MM-DD`, or `null` to clear it.
  final ValueChanged<String?> onChanged;
  final bool enabled;

  /// The phone's day; null reads the clock when the picker opens.
  final DateTime? today;

  Future<void> _pick(BuildContext context) async {
    final now = today ?? DateTime.now();
    final day = DateTime(now.year, now.month, now.day);
    final first = field.range == 'future' ? day : DateTime(day.year - datePickerYearsBack, day.month, day.day);
    final last = field.range == 'past' ? day : DateTime(day.year + datePickerYearsAhead, day.month, day.day);
    var initial = isoDay(value) ?? day;
    if (initial.isBefore(first)) initial = first;
    if (initial.isAfter(last)) initial = last;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
      currentDate: day,
      helpText: field.label,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) onChanged(isoDate(picked));
  }

  @override
  Widget build(BuildContext context) {
    final day = isoDay(value);
    final shown = value == null ? null : (day == null ? value! : longDate(day));
    if (!enabled) return ReadOnlyAnswer(label: field.label, value: shown, showLabel: false);
    void pick() => unawaited(_pick(context));
    return Wrap(
      spacing: FieldSpace.s2,
      runSpacing: FieldSpace.s2,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Semantics(
          container: true,
          button: true,
          label: '${field.label}: ${shown ?? 'no date'}',
          hint: shown == null ? 'Choose a date' : 'Change the date',
          onTap: pick,
          excludeSemantics: true,
          child: OutlinedButton.icon(
            onPressed: pick,
            icon: const Icon(LucideIcons.calendar),
            label: Text(shown ?? 'Choose a date'),
          ),
        ),
        if (value != null)
          Semantics(
            container: true,
            button: true,
            label: 'Clear ${field.label}',
            onTap: () => onChanged(null),
            excludeSemantics: true,
            child: TextButton(onPressed: () => onChanged(null), child: const Text('Clear')),
          ),
      ],
    );
  }
}
