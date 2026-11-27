import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../forms/definition.dart';

/// What the screen around a note form does for the action field at an answer path, or null where
/// that action can't be taken there: an `open_note_type` only where its note type can be started
/// in the visit (not a Medical-only note type in a Non-Medical visit, forms 10.1 #39), the hand-off
/// and a referral only where the screen offers them. The form passes it to every field host.
typedef ActionHandler = FutureOr<void> Function()? Function(ActionDef field, String path);

/// An action (forms 2.2 `action`): a button that asks the screen around the form to open a note
/// type, show the EMS hand-off or add a referral. It stores nothing. It is offered only where the
/// screen gives it something to do ([onPressed]), and not on a read-only note; otherwise nothing
/// is drawn, not even its label, so no one is shown a step they can't take.
class ActionField extends StatefulWidget {
  const ActionField({super.key, required this.field, required this.onPressed, this.enabled = true});

  final ActionDef field;

  /// What the action does; null where the screen says it can't be taken. While a future it returns
  /// runs, another tap does nothing (one tap opens one note).
  final FutureOr<void> Function()? onPressed;

  /// False on a read-only note: nothing is offered.
  final bool enabled;

  @override
  State<ActionField> createState() => _ActionFieldState();
}

class _ActionFieldState extends State<ActionField> {
  bool _busy = false;

  Future<void> _run(FutureOr<void> Function() action) async {
    final running = action();
    if (running is! Future<void>) return;
    setState(() => _busy = true);
    try {
      await running;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final action = widget.onPressed;
    // PLAN-OPEN: whether a finished note offers its actions (forms 10.1 #51): no; an action is drawn
    // only on a form that can be changed, and only where the screen gives it something to do. Show
    // handoff, a read, is the exception: the form offers it on a note the person may read but not
    // change now (review SRD-2), and the visit screen offers it for a finished note.
    if (action == null || !widget.enabled) return const SizedBox.shrink();
    final f = widget.field;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          onPressed: _busy ? null : () => unawaited(_run(action)),
          icon: Icon(switch (f.action) {
            'show_handoff' => LucideIcons.clipboardList,
            'add_referral' => LucideIcons.send,
            _ => LucideIcons.arrowRight,
          }),
          label: Text(f.label),
        ),
        if (f.help != null) ...[
          const SizedBox(height: FieldSpace.s1),
          Text(f.help!, style: text.bodyMedium?.copyWith(color: context.field.inkMuted)),
        ],
      ],
    );
  }
}
