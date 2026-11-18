import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../forms/definition.dart';

/// A tick (forms 2.2 `flag`: "Unable to measure", "Patient consented"). Ticked stores `true`;
/// unticking clears the answer with `null`, never `false`, which `checkAnswer` refuses (2.3). The
/// fields a set flag clears are disabled by the form, not here: a widget sees only its own field.
class FlagField extends StatelessWidget {
  const FlagField({super.key, required this.field, required this.value, required this.onChanged, this.enabled = true});

  final FlagDef field;

  /// Ticked.
  final bool value;

  /// `true` or `null`.
  final ValueChanged<bool?> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) => CheckboxListTile(
    value: value,
    onChanged: enabled ? (ticked) => onChanged(ticked == true ? true : null) : null,
    // Styled here: a disabled tile dims its words, and a finished note's tick must stay readable.
    title: Text(field.label, style: Theme.of(context).textTheme.bodyLarge),
    subtitle: field.help == null
        ? null
        : Text(field.help!, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: context.field.inkMuted)),
    controlAffinity: ListTileControlAffinity.leading,
    contentPadding: EdgeInsets.zero,
  );
}
