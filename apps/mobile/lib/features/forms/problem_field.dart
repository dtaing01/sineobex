import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/status_chip.dart';
import '../../forms/check_answer.dart' show maxProblemLabel;
import '../../forms/definition.dart';
import '../../patients/patient_providers.dart' show problemCodesProvider;
import '../../patients/problems.dart' show ProblemCode, isSensitiveCode;
import '../patients/patient_widgets.dart';
import '../patients/sheet_gate.dart' show DialogGate;
import 'field_host.dart' show FieldHost;
import 'text_field.dart' show ReadOnlyAnswer, limitCodePoints;

/// What a diagnosis holds: its code and its label, each stored at its own part (forms 2.3).
typedef ProblemAnswer = ({String? code, String? label});

/// The parts a diagnosis stores at, after the field's path.
const problemParts = ['code', 'label'];

/// How many matches the search lists, as phase 3's Add problem does.
const problemMatchLimit = 8;

/// The parts of a diagnosis as stored: [stored] gives what is at each part. Anything but text is none.
ProblemAnswer problemAnswer(Object? Function(String part) stored) {
  String? text(String part) => switch (stored(part)) {
    final String t when t.isNotEmpty => t,
    _ => null,
  };
  return (code: text('code'), label: text('label'));
}

/// A diagnosis written out as the read view writes it: "label (code)", or whichever part is held.
String? problemText(ProblemAnswer value) => switch (value) {
  (code: final code?, label: final label?) => '$label ($code)',
  (code: final code, label: final label) => label ?? code,
};

/// What the screen offers under a picked diagnosis (lifecycle 8.3): **Add to the problem list**, or
/// that it is there already.
class ProblemListOffer {
  /// Add it: [onAdd] takes the problem list's status, `new` or `ongoing`, and the answer to "Is
  /// this the same problem coming back?" (null when it was not asked), and says itself what stops it
  /// (the clock, a visit of someone else). [status] is the one the note's own status beside the
  /// diagnosis gives; without one the person chooses first, as on Add problem. [resolvedTitle] names
  /// the Resolved problem on the list it may be coming back as: the person is asked then, as phase
  /// 3's Add problem asks.
  const ProblemListOffer.add({
    required FutureOr<void> Function(String status, bool? sameComingBack) this.onAdd,
    this.status,
    this.resolvedTitle,
  }) : listed = false;

  /// The patient's problem list holds it already: "On the problem list".
  const ProblemListOffer.listed() : onAdd = null, status = null, resolvedTitle = null, listed = true;

  final FutureOr<void> Function(String status, bool? sameComingBack)? onAdd;
  final String? status;
  final String? resolvedTitle;
  final bool listed;
}

/// What the screen offers under the diagnosis picked at [path] (its whole path, entry part
/// included), or null where it offers nothing (a visit with no patient, a role that can't add a
/// problem).
typedef ProblemListHandler = ProblemListOffer? Function(String path, ProblemAnswer diagnosis);

/// Gives each diagnosis below it the screen's [handler]: a note screen puts it around its form,
/// since the field host gives a widget only its field, its value and its callback.
class ProblemListScope extends InheritedWidget {
  const ProblemListScope({super.key, required this.handler, required super.child});

  final ProblemListHandler handler;

  static ProblemListHandler? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ProblemListScope>()?.handler;

  @override
  bool updateShouldNotify(ProblemListScope oldWidget) => handler != oldWidget.handler;
}

/// A diagnosis (forms 2.2 `problem`): a search of the problem code list the phone holds from phase
/// 3, offline, by word or by code. Picking a match stores its code and its label together; what
/// was typed to search is never stored. A code on phase 3's sensitive list is marked Sensitive, as
/// the problem list marks it; only the code decides, so a label alone is not marked.
///
/// The field labels itself: the search box carries its label and help, and so does the diagnosis
/// once picked.
///
/// Under a picked diagnosis on a note that can be changed, **Add to the problem list** (lifecycle
/// 8.3), where the screen offers it through a [ProblemListScope]; once the list holds it, "On the
/// problem list" instead. The field stores nothing for it: the screen's domain layer adds the
/// problem.
///
/// PLAN-OPEN: a diagnosis not on the phone's list (forms 10.1 #46; phase 3 lets a problem have no
/// code). Until the team decides, only a code from the list can be picked: a typed label would
/// carry no code, and so could never be marked or kept from a reader as sensitive.
class ProblemField extends ConsumerStatefulWidget {
  const ProblemField({
    super.key,
    required this.field,
    required this.value,
    required this.onChanged,
    this.enabled = true,
    this.path,
  });

  final ProblemDef field;
  final ProblemAnswer value;

  /// The diagnosis picked, or both parts null to clear it.
  final ValueChanged<ProblemAnswer> onChanged;

  /// False: shown read-only, said so to a screen reader.
  final bool enabled;

  /// The diagnosis's whole path, for Add to the problem list; the field host's around it when null.
  final String? path;

  @override
  ConsumerState<ProblemField> createState() => _ProblemFieldState();
}

class _ProblemFieldState extends ConsumerState<ProblemField> {
  final _query = TextEditingController();
  bool _adding = false;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _pick(ProblemCode c) {
    _query.clear();
    widget.onChanged((code: c.code, label: limitCodePoints(c.title, maxProblemLabel)));
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.field;
    final shown = problemText(widget.value);
    final sensitive = widget.value.code != null && isSensitiveCode(widget.value.code!);
    if (!widget.enabled) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ReadOnlyAnswer(label: f.label, value: shown),
          if (sensitive) ...[
            const SizedBox(height: FieldSpace.s1),
            const Align(alignment: AlignmentDirectional.centerStart, child: _Sensitive()),
          ],
        ],
      );
    }
    if (shown != null) return _picked(context, shown, sensitive);
    return _search(context);
  }

  Widget _picked(BuildContext context, String shown, bool sensitive) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final f = widget.field;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          container: true,
          label: f.label,
          value: shown,
          excludeSemantics: true,
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
                Text(f.label, style: text.labelLarge?.copyWith(color: c.inkMuted)),
                const SizedBox(height: FieldSpace.s1),
                Text(shown, style: text.bodyLarge),
              ],
            ),
          ),
        ),
        if (sensitive) ...[
          const SizedBox(height: FieldSpace.s1),
          const Align(alignment: AlignmentDirectional.centerStart, child: _Sensitive()),
        ],
        const SizedBox(height: FieldSpace.s2),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            onPressed: () => widget.onChanged((code: null, label: null)),
            icon: const Icon(LucideIcons.x),
            label: Semantics(
              label: 'Remove ${widget.value.label ?? shown}',
              excludeSemantics: true,
              child: const Text('Remove'),
            ),
          ),
        ),
        ?_problemList(context, widget.value.label ?? shown),
      ],
    );
  }

  /// Add to the problem list, or that it is there, where the screen offers either.
  Widget? _problemList(BuildContext context, String name) {
    final path = widget.path ?? context.findAncestorWidgetOfExactType<FieldHost>()?.path;
    final offer = path == null ? null : ProblemListScope.of(context)?.call(path, widget.value);
    if (offer == null) return null;
    final Widget shown;
    if (offer.listed) {
      shown = const Align(
        alignment: AlignmentDirectional.centerStart,
        child: StatusChip(label: 'On the problem list', icon: LucideIcons.listChecks),
      );
    } else {
      void tap() => unawaited(_add(offer));
      shown = Align(
        alignment: AlignmentDirectional.centerStart,
        child: Semantics(
          container: true,
          button: true,
          enabled: !_adding,
          // The words on the button first, then the diagnosis (WCAG 2.5.3, Label in Name).
          label: 'Add to the problem list: $name',
          onTap: _adding ? null : tap,
          excludeSemantics: true,
          child: OutlinedButton.icon(
            onPressed: _adding ? null : tap,
            icon: const Icon(LucideIcons.listPlus),
            label: const Text('Add to the problem list'),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: FieldSpace.s2),
      child: shown,
    );
  }

  /// Adds it at the status the note gives, or the one the person chooses when it gives none, once
  /// they say whether it is a Resolved problem coming back, when there is one. A tap while it is
  /// being added does nothing.
  Future<void> _add(ProblemListOffer offer) async {
    if (_adding) return;
    final status = offer.status ?? await _chooseStatus();
    if (status == null || !mounted) return;
    bool? again;
    if (offer.resolvedTitle case final title?) {
      again = await _askComingBack(title);
      if (again == null || !mounted) return;
    }
    final adding = offer.onAdd!(status, again);
    if (adding is! Future<void>) return;
    setState(() => _adding = true);
    try {
      await adding;
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  /// New or Ongoing, as Add problem asks (Resolved is not offered when a problem is added); null
  /// when the person cancels.
  Future<String?> _chooseStatus() => showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      // Its words and three buttons outgrow a small phone at large text: it scrolls.
      scrollable: true,
      title: const Text('Add as New or Ongoing?'),
      content: const Text('The note gives this diagnosis no status. Choose one for the problem list.'),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.of(context).pop('ongoing'), child: const Text('Ongoing')),
        FilledButton(onPressed: () => Navigator.of(context).pop('new'), child: const Text('New')),
      ],
    ),
  );

  /// Phase 3's recurrence question, in Add problem's words: true for a new episode of the Resolved
  /// problem named [title], false for a different problem; null when the person cancels, or when the
  /// store freezes while it is asked (it names the chart's problem, phase 3's V1). Neither answer is
  /// put forward.
  Future<bool?> _askComingBack(String title) {
    final gate = DialogGate.over<bool>(context);
    return showDialog<bool>(
      context: context,
      builder: (context) => gate(
        AlertDialog(
          scrollable: true,
          title: const Text('Is this the same problem coming back?'),
          content: Text('“$title” is on the list as Resolved.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('No, a different problem')),
            TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Yes, it came back')),
          ],
        ),
      ),
    );
  }

  Widget _search(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final f = widget.field;
    final codes = ref.watch(problemCodesProvider);
    final query = _query.text.trim();
    final matches = switch (codes) {
      AsyncData(:final value) => value.search(query, limit: problemMatchLimit),
      _ => const <ProblemCode>[],
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PhiField(
          name: 'form.${f.id}',
          label: f.label,
          hint: 'Search by word or code',
          helper: f.help,
          controller: _query,
          prefixIcon: const Icon(LucideIcons.search),
          capitalization: TextCapitalization.none,
          textInputAction: TextInputAction.search,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: FieldSpace.s2),
        for (final c in matches) _Match(code: c, onTap: () => _pick(c)),
        if (query.isNotEmpty && matches.isEmpty && codes is AsyncData)
          Text('No code on this phone’s list matches.', style: text.bodyLarge),
        if (codes is AsyncError) Text('This phone’s code list couldn’t be read.', style: text.bodyLarge),
      ],
    );
  }
}

/// One match: its title and code, and Sensitive when the code is on the list. One button.
class _Match extends StatelessWidget {
  const _Match({required this.code, required this.onTap});
  final ProblemCode code;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final sensitive = isSensitiveCode(code.code);
    return Semantics(
      button: true,
      label: '${code.title}, code ${code.code}${sensitive ? ', sensitive' : ''}',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: FieldTap.min),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: FieldSpace.s2),
            child: Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('${code.title} (${code.code})', style: Theme.of(context).textTheme.bodyLarge),
                if (sensitive) const _Sensitive(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The problem list's mark of a sensitive diagnosis (phase 3: patient and problem screens).
class _Sensitive extends StatelessWidget {
  const _Sensitive();

  @override
  Widget build(BuildContext context) => const StatusChip(label: 'Sensitive', icon: LucideIcons.lock);
}
