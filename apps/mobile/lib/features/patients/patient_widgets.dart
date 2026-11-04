import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../patients/patient_providers.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;

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
    maxLines: maxLines,
    minLines: minLines,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
    // The focused field scrolls above the keyboard (design 12.1).
    scrollPadding: const EdgeInsets.all(FieldSpace.s7 * 2),
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

  /// A chip's spoken label when it differs from its text ("Other, selected, text box below").
  final String Function(T value, bool selected)? spoken;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final chips = Wrap(
      spacing: FieldSpace.s2,
      runSpacing: FieldSpace.s2,
      children: [
        for (final MapEntry(key: value, value: text) in options.entries)
          Semantics(
            inMutuallyExclusiveGroup: true,
            selected: value == selected,
            label: spoken?.call(value, value == selected),
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
  const WideButton({super.key, required this.label, required this.onPressed, this.icon, this.filled = false});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final child = Text(label, textAlign: TextAlign.center);
    final button = filled
        ? (icon == null
              ? FilledButton(onPressed: onPressed, child: child)
              : FilledButton.icon(onPressed: onPressed, icon: Icon(icon), label: child))
        : (icon == null
              ? OutlinedButton(onPressed: onPressed, child: child)
              : OutlinedButton.icon(onPressed: onPressed, icon: Icon(icon), label: child));
    return SizedBox(width: double.infinity, child: button);
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

/// Asks yes or no; true for yes.
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String yes,
  String no = 'Cancel',
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: SingleChildScrollView(child: Text(body)),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text(no)),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: Text(yes)),
      ],
    ),
  );
  return answer ?? false;
}

/// Asks for a short reason (3 to 300 characters), with quick choices; null when cancelled.
Future<String?> askReason(
  BuildContext context, {
  required String title,
  required String body,
  required String action,
  List<String> quick = const [],
}) => showDialog<String>(
  context: context,
  builder: (context) => _ReasonDialog(title: title, body: body, action: action, quick: quick),
);

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
  Widget build(BuildContext context) => AlertDialog(
    title: Text(widget.title),
    content: SingleChildScrollView(
      child: Column(
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
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(onPressed: _submit, child: Text(widget.action)),
    ],
  );
}

/// The open team's patient services and what to show when there are none: locked, no team, or a
/// role without patient records.
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
    return builder(context, services);
  }
}

/// What the intake starts from: a name typed in a search that found no one, or the saved draft.
class IntakeStart {
  const IntakeStart({this.name, this.fromDraft = false});
  final String? name;
  final bool fromDraft;
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
