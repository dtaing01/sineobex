import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../patients/patient_providers.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import '../../sync/sync_controller.dart' show SyncController;

/// Pieces every patient screen shares.

/// Today by the phone's clock, as a date (ages and "born 1946 · 80").
DateTime todayOf(WidgetRef ref) {
  final now = ref.read(wallClockProvider)();
  return DateTime(now.year, now.month, now.day);
}

/// A text field that may hold a patient's details: never in the keyboard's learned words, never
/// autocorrected (design 11.1). Its key starts `phi.`, which is how the tests find every one of
/// them (design 13.5).
class PhiField extends StatelessWidget {
  const PhiField({
    super.key,
    required this.name,
    required this.label,
    required this.controller,
    this.focusNode,
    this.hint,
    this.helper,
    this.error,
    this.maxLength,
    this.maxLines = 1,
    this.minLines,
    this.onChanged,
    this.onSubmitted,
    this.textInputAction = TextInputAction.next,
    this.keyboardType,
    this.prefixIcon,
    this.suffix,
    this.enabled = true,
    this.capitalization = TextCapitalization.words,
    this.showCounter = true,
  });

  /// The key is `phi.<name>`.
  final String name;
  final String label;
  final TextEditingController controller;
  final FocusNode? focusNode;
  final String? hint;
  final String? helper;
  final String? error;
  final int? maxLength;
  final int? maxLines;
  final int? minLines;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final TextInputAction textInputAction;
  final TextInputType? keyboardType;
  final Widget? prefixIcon;
  final Widget? suffix;
  final bool enabled;
  final TextCapitalization capitalization;

  /// Material's "12/200" counter under a field with [maxLength]. It is a live region while the
  /// field has focus, read at every keystroke; a screen with its own counter turns it off.
  final bool showCounter;

  @override
  Widget build(BuildContext context) => TextField(
    key: ValueKey('phi.$name'),
    controller: controller,
    focusNode: focusNode,
    enabled: enabled,
    autocorrect: false,
    enableSuggestions: false,
    enableIMEPersonalizedLearning: false,
    textCapitalization: capitalization,
    textInputAction: textInputAction,
    keyboardType: keyboardType ?? (maxLines == 1 ? TextInputType.text : TextInputType.multiline),
    maxLength: maxLength,
    buildCounter: showCounter ? null : _noCounter,
    maxLines: maxLines,
    minLines: minLines,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
    // The focused field scrolls above the keyboard (design 12.1).
    scrollPadding: const EdgeInsets.all(FieldSpace.s7 * 2),
    contextMenuBuilder: _privateMenu,
    decoration: InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      helperMaxLines: 4,
      errorText: error,
      errorMaxLines: 4,
      prefixIcon: prefixIcon,
      suffixIcon: suffix,
    ),
  );
}

/// What a private box's selection menu offers: the platform's own cut, copy, paste and select all,
/// and nothing that sends its text out of the app (lifecycle 10.2; the coordinator's decision on
/// review finding PP-3). The platforms' Share, Search Web and Look Up, Android's text-processing
/// apps (a translator) and iOS's Live Text are left out.
Widget _privateMenu(BuildContext context, EditableTextState state) => AdaptiveTextSelectionToolbar.buttonItems(
  anchors: state.contextMenuAnchors,
  buttonItems: [
    for (final item in state.contextMenuButtonItems)
      if (privateMenuItems.contains(item.type)) item,
  ],
);

/// The only items a private box's selection menu holds.
const privateMenuItems = {
  ContextMenuButtonType.cut,
  ContextMenuButtonType.copy,
  ContextMenuButtonType.paste,
  ContextMenuButtonType.selectAll,
};

Widget? _noCounter(
  BuildContext context, {
  required int currentLength,
  required int? maxLength,
  required bool isFocused,
}) => null;

/// A section heading, read as a heading.
class SectionHeading extends StatelessWidget {
  const SectionHeading(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final heading = Semantics(header: true, child: Text(text, style: Theme.of(context).textTheme.titleLarge));
    return Padding(
      padding: const EdgeInsets.only(top: FieldSpace.s5, bottom: FieldSpace.s2),
      child: trailing == null
          ? heading
          : Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: FieldSpace.s2,
              children: [heading, trailing!],
            ),
    );
  }
}

/// Chips of which at most one is on, announced as a radio group (design 12.1:
/// `Semantics(inMutuallyExclusiveGroup: true, selected:)`). Nothing is preselected unless
/// [selected] says so; tapping the chosen one again leaves it on.
class RadioChips<T> extends StatelessWidget {
  const RadioChips({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.label,
    this.spoken,
    this.enabled = true,
  });

  /// Value and its words, in the order shown.
  final Map<T, String> options;
  final T? selected;
  final ValueChanged<T> onSelected;

  /// The group's name, read before the chips.
  final String? label;

  /// A chip's spoken label when it differs from its text ("Other, text box below"; "selected"
  /// comes from the flag, so it is never said twice).
  final String Function(T value, bool selected)? spoken;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final chips = Wrap(
      spacing: FieldSpace.s2,
      runSpacing: FieldSpace.s2,
      children: [
        for (final MapEntry(key: value, value: text) in options.entries)
          // One node per chip: the group flag and the state on the button itself, not on a node
          // around it.
          Semantics(
            container: true,
            button: true,
            inMutuallyExclusiveGroup: true,
            selected: value == selected,
            enabled: enabled,
            label: spoken?.call(value, value == selected) ?? text,
            onTap: enabled ? () => onSelected(value) : null,
            excludeSemantics: true,
            child: ChoiceChip(
              label: Text(text),
              selected: value == selected,
              showCheckmark: true,
              onSelected: enabled ? (_) => onSelected(value) : null,
            ),
          ),
      ],
    );
    if (label == null) return chips;
    return Semantics(
      container: true,
      label: label,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(child: Text(label!, style: Theme.of(context).textTheme.bodyLarge)),
          const SizedBox(height: FieldSpace.s2),
          chips,
        ],
      ),
    );
  }
}

/// A full-width button of the minimum target size.
class WideButton extends StatelessWidget {
  const WideButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.filled = false,
    this.focusNode,
  });
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool filled;
  final FocusNode? focusNode;

  @override
  Widget build(BuildContext context) {
    final child = Text(label, textAlign: TextAlign.center);
    final button = filled
        ? (icon == null
              ? FilledButton(onPressed: onPressed, focusNode: focusNode, child: child)
              : FilledButton.icon(onPressed: onPressed, focusNode: focusNode, icon: Icon(icon), label: child))
        : (icon == null
              ? OutlinedButton(onPressed: onPressed, focusNode: focusNode, child: child)
              : OutlinedButton.icon(onPressed: onPressed, focusNode: focusNode, icon: Icon(icon), label: child));
    return SizedBox(width: double.infinity, child: button);
  }
}

/// Whether focus should follow a control that is about to go to what replaces it. Someone on
/// [from] with a keyboard or a switch, or using a screen reader, would be left nowhere when it goes.
/// A finger, with the keyboard up for a field, keeps typing where it was.
bool focusFollows(BuildContext context, FocusNode from) => from.hasFocus || MediaQuery.accessibleNavigationOf(context);

/// Gives [node] the focus and brings it on screen: the control that took the place of one that
/// went. Call it after the frame that put it there; a control that isn't there is left alone.
void focusInView(FocusNode node) {
  final target = node.context;
  // A control the frame took away (a list that became another) is left alone too: asking for its
  // place would look up a widget no longer there (review finding PX-5).
  if (target == null || !target.mounted) return;
  node.requestFocus();
  for (final edge in [
    ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
    ScrollPositionAlignmentPolicy.keepVisibleAtStart,
  ]) {
    unawaited(Scrollable.ensureVisible(target, alignmentPolicy: edge));
  }
}

/// "Saved" and the like: never a patient detail (design 12).
void showDone(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

/// The message of an error a patient screen can show: fixed strings only.
String errorText(Object e) => switch (e) {
  LocalValidationError(:final message) => message,
  ChartingPaused(:final message) => message,
  _ => 'That didn’t work. Try again.',
};

/// A question in a dialog whose buttons end its body and scroll with it: an AlertDialog's own row of
/// actions stays put below the words, and at 200% text on a small phone it runs off the screen
/// (phase 4's review, SAX-9 and SAX-10). Every button can be reached, at any text size.
class AskDialog extends StatelessWidget {
  const AskDialog({super.key, required this.title, required this.content, required this.actions});
  final String title;
  final Widget content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: Text(title),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        content,
        const SizedBox(height: FieldSpace.s4),
        OverflowBar(
          alignment: MainAxisAlignment.end,
          spacing: FieldSpace.s2,
          overflowSpacing: FieldSpace.s2,
          overflowAlignment: OverflowBarAlignment.end,
          children: actions,
        ),
      ],
    ),
  );
}

/// Asks yes or no; true for yes. A question that names something of a chart sits in [gate] (a
/// `DialogGate`, phase 3's V1).
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String yes,
  String no = 'Cancel',
  Widget Function(Widget dialog)? gate,
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => _gated(
      gate,
      AskDialog(
        title: title,
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(no)),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(yes)),
        ],
      ),
    ),
  );
  return answer ?? false;
}

/// Asks for a short reason (3 to 300 characters), with quick choices; null when cancelled. A
/// question that names something of a chart sits in [gate] (a `DialogGate`, phase 3's V1).
Future<String?> askReason(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
  List<String> quick = const [],
  Widget Function(Widget dialog)? gate,
}) => showDialog<String>(
  context: context,
  builder: (context) => _gated(gate, _ReasonDialog(title: title, body: body, action: action, quick: quick)),
);

Widget _gated(Widget Function(Widget dialog)? gate, Widget dialog) => gate == null ? dialog : gate(dialog);

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.title, required this.body, required this.action, required this.quick});
  final String title;
  final String body;
  final String action;
  final List<String> quick;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final r = _reason.text.trim();
    if (r.length < 3 || r.length > 300) {
      setState(() => _error = 'Give a short reason (3 to 300 characters).');
      return;
    }
    Navigator.of(context).pop(r);
  }

  @override
  Widget build(BuildContext context) => AskDialog(
    title: widget.title,
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.body),
        if (widget.quick.isNotEmpty) ...[
          const SizedBox(height: FieldSpace.s3),
          Wrap(
            spacing: FieldSpace.s2,
            runSpacing: FieldSpace.s2,
            children: [
              for (final q in widget.quick)
                ActionChip(
                  label: Text(q),
                  onPressed: () => setState(() {
                    _reason.text = q;
                    _error = null;
                  }),
                ),
            ],
          ),
        ],
        const SizedBox(height: FieldSpace.s3),
        PhiField(
          name: 'reason',
          label: 'Reason',
          controller: _reason,
          error: _error,
          maxLength: 300,
          capitalization: TextCapitalization.sentences,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submit(),
        ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(onPressed: _submit, child: Text(widget.action)),
    ],
  );
}

/// [services] still read the database the controller holds open. A lock, a sign-out or a team switch
/// closes it, and a screen under another one rebuilds before its route goes: it must read nothing.
bool servicesOpen(SyncController sync, PatientServices services) => identical(sync.store, services.store);

/// What a patient screen's body shows in place of reading the store, or null when it may read:
/// nothing when the database closed under it, and the reason while the store is frozen for a
/// hand-over. A frozen store can log no view, so nothing from it is shown (D21) and the chart's
/// `read` refuses. Every builder that reads asks this first, whatever made it rebuild: the gate
/// above hears only the controller, and a screen also rebuilds for its services and its own state.
Widget? unreadable(SyncController sync, PatientServices services) {
  if (!servicesOpen(sync, services)) return const SizedBox.shrink();
  final frozen = services.store.frozenMessage;
  return frozen == null ? null : FrozenNotice(frozen);
}

/// Why nothing of the team's patients shows: its store is frozen (the person's access ended).
class FrozenNotice extends StatelessWidget {
  const FrozenNotice(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.all(FieldSpace.s4), child: ErrorMessage(message));
}

/// The open team's patient services and what to show when there are none: locked, no team, or a
/// role without patient records. While the team's store is frozen for a hand-over nothing from it
/// shows: a frozen store can't log a view, and what can't be logged isn't shown (D21).
class PatientsGate extends ConsumerWidget {
  const PatientsGate({super.key, required this.title, required this.builder});
  final String title;
  final Widget Function(BuildContext context, PatientServices services) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final services = ref.watch(patientServicesProvider);
    if (services == null) {
      return Scaffold(
        appBar: AppBar(title: Text(title)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (!services.permissions.contains('patients.view')) {
      return Scaffold(
        appBar: AppBar(title: Text(title)),
        body: const Padding(
          padding: EdgeInsets.all(FieldSpace.s4),
          child: NoticeMessage('Your role in this team doesn’t include patient records.'),
        ),
      );
    }
    // The controller itself, not the provider: a screen under another one still hears it, and a
    // chart already on screen goes when the store freezes. The screen's own state goes with it,
    // so lists read before the freeze (Opened recently, a search run) are never shown again.
    final sync = ref.watch(syncControllerProvider);
    return ListenableBuilder(
      listenable: sync,
      builder: (context, _) {
        // A lock or sign-out closed the database these services read; the route goes next frame.
        if (!servicesOpen(sync, services)) return const SizedBox.shrink();
        final frozen = services.store.frozenMessage;
        if (frozen != null) {
          return Scaffold(
            appBar: AppBar(title: Text(title)),
            body: FrozenNotice(frozen),
          );
        }
        return builder(context, services);
      },
    );
  }
}

/// What the intake starts from: a name typed in a search that found no one, or the saved draft.
class IntakeStart {
  const IntakeStart({this.name, this.fromDraft = false, this.returnsPatient = false});
  final String? name;
  final bool fromDraft;

  /// Opened from New encounter (phase 4, lifecycle 9.2): a save ends by going back with the new
  /// patient's ID, and so does opening the chart of someone found already there, so the visit goes
  /// on at Where for them, instead of their chart opening.
  final bool returnsPatient;
}

/// What a worker typed at intake before finding that the person already has a chart (design 8.1,
/// **This is them** → **Add what you typed**): street names, where they're usually found and
/// their living situation. Travels to the profile in memory, never in a route.
class TypedDetails {
  const TypedDetails({this.aliases = const [], this.usualArea, this.livingSituation});
  final List<String> aliases;
  final String? usualArea;

  /// The sync value `{kind, other?}`.
  final Map<String, Object?>? livingSituation;

  bool get isEmpty => aliases.isEmpty && usualArea == null && livingSituation == null;
}
