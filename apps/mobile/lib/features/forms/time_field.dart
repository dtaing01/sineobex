import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/tokens.dart';
import '../../forms/definition.dart';
import 'text_field.dart' show ReadOnlyAnswer;
import '../patients/sheet_gate.dart' show DialogGate;

final _hhmm = RegExp(r'^([01]\d|2[0-3]):([0-5]\d)$');

/// The time of a stored `HH:MM`, or null.
TimeOfDay? timeOf(String? value) {
  final m = _hhmm.firstMatch(value ?? '');
  return m == null ? null : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!));
}

/// `HH:MM` of [time], on the 24-hour clock.
String hhmm(TimeOfDay time) => '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';

/// A time of day (forms 2.2 `time`: "Time EMS called"), stored as `HH:MM` from `00:00` to `23:59`
/// and shown as the phone shows times. Picked on the dial only: the picker's typing mode is a
/// text box that the keyboard would learn from.
class TimeField extends StatelessWidget {
  const TimeField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.now,
  });

  final TimeDef field;
  final String? value;

  /// `HH:MM`, or `null` to clear it.
  final ValueChanged<String?> onChanged;
  final bool enabled;

  /// Where the dial starts with no time yet; null reads the clock when it opens.
  final DateTime? now;

  Future<void> _pick(BuildContext context) async {
    // It closes with the screen's gate when the store freezes (D125; review finding PP-1).
    final gate = DialogGate.over<TimeOfDay>(context);
    final picked = await showTimePicker(
      context: context,
      initialTime: timeOf(value) ?? TimeOfDay.fromDateTime(now ?? DateTime.now()),
      helpText: field.label,
      initialEntryMode: TimePickerEntryMode.dialOnly,
      builder: (_, child) => gate(child!),
    );
    if (picked != null) onChanged(hhmm(picked));
  }

  @override
  Widget build(BuildContext context) {
    final time = timeOf(value);
    final shown = value == null
        ? null
        : (time == null ? value! : MaterialLocalizations.of(context).formatTimeOfDay(time));
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
          label: '${field.label}: ${shown ?? 'no time'}',
          hint: shown == null ? 'Choose a time' : 'Change the time',
          onTap: pick,
          excludeSemantics: true,
          child: OutlinedButton.icon(
            onPressed: pick,
            icon: const Icon(LucideIcons.clock),
            label: Text(shown ?? 'Choose a time'),
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
