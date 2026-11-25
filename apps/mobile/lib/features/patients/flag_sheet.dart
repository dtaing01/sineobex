/// The **Change flags** sheet (phase 5 design 8.2): a patient's risk level (one, or None) and
/// conditions (several), a reason box, required, and Save; then the history of their changes (the
/// flag, set or cleared, who, when, why), with Entered in error on a change of the person's own, or
/// on anyone's for a Program Admin. It writes through the flags domain class
/// (lib/patients/flags.dart), never the store. Opened from the profile's flags row through
/// `SheetGate.patients` (D125), its choosers through `DialogGate`, its reason box a `PrivateBox`
/// (D126). Works offline; shown only with `patients.edit`.
///
/// The pieces every flag screen draws a carried flag with ([FlagMark]) and chooses one with
/// ([showRiskLevelChooser], [showConditionsChooser]) live here too: the profile, intake's risk level,
/// the patient list's filters and Needs attention use them.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/flag_pill.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/flags.dart';
import '../../patients/patient_providers.dart';
import '../../presets/models.dart' show FlagTier;
import '../../sync/entities.dart' show flagReasonMax;
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import '../encounters/encounter_labels.dart' show waitingToSend;
import '../forms/text_field.dart' show limitCodePoints;
import '../presets/team_setup_screen.dart' show setupNotDownloaded;
import '../sync/sync_labels.dart' show timeOfDay;
import 'patient_labels.dart' show count, longDate, shortDate;
import 'patient_widgets.dart';
import 'sheet_gate.dart';

/// The profile's flags row: its button, which opens the sheet, and where focus returns after Save.
const changeFlagsAction = 'Change flags';

/// The sheet's heading.
const changeFlagsTitle = 'Change flags';

/// The risk level's chooser: a button opening a dialog of None and each level the person may set.
const chooseRiskLevelAction = 'Choose a risk level';

/// The conditions' chooser: a button opening a dialog of a checkbox for each condition, and Done.
const chooseConditionsAction = 'Choose conditions';

/// A risk level of none, in the sheet and its chooser.
const noRiskLevelText = 'None';

/// The conditions chooser's button that keeps what is ticked.
const conditionsDoneAction = 'Done';

/// A history row's words for a set and for a clear.
const flagSetText = 'Set';
const flagClearedText = 'Cleared';

/// A history row's action on a change the person may mark, and the question's button.
const flagEnteredInErrorAction = 'Entered in error';
const markFlagChangeAction = 'Mark entered in error';

/// The two tiers' names, as the sheet, intake and the patient list's filters head them.
const riskLevelLabel = 'Risk level';
const conditionsLabel = 'Conditions';

/// No condition chosen, in the sheet.
const noConditionsText = 'No conditions';

/// Said on the profile after each Save (8.2), in a live region keyed to the press.
const flagsSavedText = 'Flags saved.';

/// Beside the pill of an archived flag a patient carries (5.1; note 2 of the second part): it stays
/// on them, and can only be cleared.
const flagArchivedText = 'No longer on the team’s list';

/// A change of this phone's a Program Admin holds (6.2): not counted in the patient's flags yet.
const flagSentForReviewText = 'Sent for review';

/// Save found nothing different from the patient's flags.
const flagsNothingToSave = 'Nothing changed. Choose a risk level or conditions first.';

/// Said in the sheet once a change was marked.
const flagChangeMarkedText = 'Marked entered in error.';

/// The words a pill shows for [flag] ("Red · High"), and what a screen reader hears ("Red, High"):
/// its name alone for a flag the phone knows from a chart's history row only, whose colour it
/// doesn't know.
String flagWords(FlagView flag) => flag.colorName.isEmpty ? flag.name : '${flag.colorName} · ${flag.name}';
String flagSpoken(FlagView flag) => flag.colorName.isEmpty ? flag.name : '${flag.colorName}, ${flag.name}';

/// A flag a patient carries, as every phone screen draws it: its pill, never colour alone, and for
/// an archived one [flagArchivedText] as a status chip beside it, the two heard together as one
/// node. A flag known only by name (a chart's history row) is drawn as words alone.
class FlagMark extends StatelessWidget {
  const FlagMark({super.key, required this.flag});
  final FlagView flag;

  @override
  Widget build(BuildContext context) {
    final f = flag;
    final pill = f.colorName.isEmpty
        ? Text(f.name, style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700))
        : FlagPill(name: f.name, colorName: f.colorName, color: f.color);
    return Semantics(
      container: true,
      child: f.archived
          ? Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                pill,
                const StatusChip(label: flagArchivedText, icon: LucideIcons.archive),
              ],
            )
          : pill,
    );
  }
}

/// What a risk level chooser gives: the level chosen, or null for None. A chooser closed without
/// a choice gives no [RiskLevelChoice] at all.
typedef RiskLevelChoice = ({String? flagId});

/// Asks for a risk level in a dialog: None, then each of [levels] by its pill, [current] chosen.
/// In a [DialogGate] over [services], so a freeze closes it. Null when it was closed without one.
Future<RiskLevelChoice?> showRiskLevelChooser(
  BuildContext context,
  PatientServices services, {
  required List<FlagView> levels,
  required String? current,
  bool offerNone = true,
}) => showDialog<RiskLevelChoice>(
  context: context,
  builder: (context) => DialogGate<RiskLevelChoice>.patients(
    services: services,
    child: _RiskLevelDialog(levels: levels, current: current, offerNone: offerNone),
  ),
);

/// Asks for conditions in a dialog: a checkbox for each of [conditions] by its pill, [ticked]
/// ticked, then Done. An archived one is offered only because the patient carries it, so it can
/// be cleared. In a [DialogGate] over [services], so a freeze closes it. Null when cancelled.
Future<Set<String>?> showConditionsChooser(
  BuildContext context,
  PatientServices services, {
  required List<FlagView> conditions,
  required Set<String> ticked,
}) => showDialog<Set<String>>(
  context: context,
  builder: (context) => DialogGate<Set<String>>.patients(
    services: services,
    child: _ConditionsDialog(conditions: conditions, ticked: ticked),
  ),
);

/// Opens the sheet for [patientId], gated by [services]' store: once it freezes, nothing of the
/// sheet is drawn, and what was typed goes with it. True when Save wrote the patient's flags.
Future<bool> showFlagSheet(BuildContext context, PatientServices services, {required String patientId}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => SheetGate.patients(
      services: services,
      child: FlagSheet(services: services, patientId: patientId),
    ),
  );
  return saved ?? false;
}

/// The sheet's body.
class FlagSheet extends ConsumerStatefulWidget {
  const FlagSheet({super.key, required this.services, required this.patientId});

  final PatientServices services;
  final String patientId;

  @override
  ConsumerState<FlagSheet> createState() => _FlagSheetState();
}

class _FlagSheetState extends ConsumerState<FlagSheet> {
  final _reason = TextEditingController();

  /// The risk level chosen, once one is: until then Save keeps the patient's as it is then.
  RiskLevelChoice? _level;

  /// Conditions ticked (true) or unticked (false) here, by flag ID: Save applies them to the
  /// patient's conditions as they are then, so a change that arrives while the sheet is open is
  /// never undone by it.
  final _ticked = <String, bool>{};

  /// Presses of Save and marks made, so each sentence is a new node, said again.
  int _tries = 0;
  String? _problem;
  String? _said;

  PatientServices get _s => widget.services;
  PatientFlags get _flags => _s.flags;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String? _levelOf(PatientFlagsView now) => _level == null ? now.riskLevel?.flagId : _level!.flagId;

  Set<String> _conditionsOf(PatientFlagsView now) {
    final ids = {for (final f in now.conditions) f.flagId};
    for (final MapEntry(key: id, value: on) in _ticked.entries) {
      on ? ids.add(id) : ids.remove(id);
    }
    return ids;
  }

  Future<void> _chooseLevel(PatientFlagsView now) async {
    final chosen = await showRiskLevelChooser(
      context,
      _s,
      levels: _flags.offered(widget.patientId, FlagTier.primary),
      current: _levelOf(now),
    );
    if (chosen == null || !mounted) return;
    setState(() {
      _level = chosen;
      _problem = null;
    });
  }

  Future<void> _chooseConditions(PatientFlagsView now) async {
    final shown = _conditionsOf(now);
    final chosen = await showConditionsChooser(
      context,
      _s,
      conditions: _flags.offered(widget.patientId, FlagTier.secondary),
      ticked: shown,
    );
    if (chosen == null || !mounted) return;
    final Set<String> carried;
    try {
      carried = {for (final f in _flags.flagsOf(widget.patientId).conditions) f.flagId};
    } on ChartingPaused {
      // The sheet goes with the store.
      return;
    }
    setState(() {
      for (final id in {...shown, ...chosen}) {
        if (shown.contains(id) == chosen.contains(id)) continue;
        // Back as the patient has it: no change of the person's to apply.
        if (chosen.contains(id) == carried.contains(id)) {
          _ticked.remove(id);
        } else {
          _ticked[id] = chosen.contains(id);
        }
      }
      _problem = null;
    });
  }

  void _save() {
    _tries++;
    final List<String> saved;
    try {
      final now = _flags.flagsOf(widget.patientId);
      saved = _flags.save(
        widget.patientId,
        riskLevel: _levelOf(now),
        conditions: _conditionsOf(now),
        reason: _reason.text,
      );
    } on LocalValidationError catch (e) {
      return setState(() => _problem = e.message);
    } on ChartingPaused catch (e) {
      return setState(() => _problem = e.message);
    }
    if (saved.isEmpty) return setState(() => _problem = flagsNothingToSave);
    Navigator.of(context).pop(true);
  }

  /// Asks for the reason, and marks the change in the dialog, which shows a refusal and stays.
  Future<void> _enterInError(FlagChangeView change) async {
    // It holds the typed reason: it closes on a freeze (D125).
    final marked = await showDialog<bool>(
      context: context,
      builder: (_) => DialogGate<bool>.patients(
        services: _s,
        cancel: false,
        child: _MarkDialog(
          mark: (reason) {
            try {
              _flags.enterInError(change.changeId, reason);
              return null;
            } on LocalValidationError catch (e) {
              return e.message;
            } on ChartingPaused catch (e) {
              return e.message;
            } on StateError {
              return flagChangeGone;
            }
          },
        ),
      ),
    );
    if (marked == true && mounted) {
      setState(() {
        _tries++;
        _said = flagChangeMarkedText;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    return ListenableBuilder(
      listenable: Listenable.merge([sync, _s]),
      builder: (context, _) {
        // A lock, a sign-out or a team switch closed the database the sheet reads.
        if (!servicesOpen(sync, _s)) return const SizedBox.shrink();
        final PatientFlagsView now;
        try {
          now = _flags.flagsOf(widget.patientId);
        } on ChartingPaused catch (e) {
          return SafeArea(child: FrozenNotice(e.message));
        }
        return _sheet(context, now, paused: sync.snapshot.clock.paused);
      },
    );
  }

  Widget _sheet(BuildContext context, PatientFlagsView now, {required bool paused}) {
    final text = Theme.of(context).textTheme;
    final today = todayOf(ref);
    final held = _flags.presetsHeld;
    final levelId = _levelOf(now);
    final conditionIds = _conditionsOf(now);
    final offeredLevels = held ? _flags.offered(widget.patientId, FlagTier.primary) : const <FlagView>[];
    final offeredConditions = held ? _flags.offered(widget.patientId, FlagTier.secondary) : const <FlagView>[];
    FlagView? named(String id, List<FlagView> offered, Iterable<FlagView> carried) =>
        offered.where((f) => f.flagId == id).firstOrNull ?? carried.where((f) => f.flagId == id).firstOrNull;
    final level = levelId == null ? null : named(levelId, offeredLevels, [?now.riskLevel]);
    final conditions = [for (final id in conditionIds) ?named(id, offeredConditions, now.conditions)];
    final canSave = held && !paused && _reason.text.trim().isNotEmpty;
    // The choices, the reason and the history scroll; Save stays under them, in reach at any text
    // size, with what stops it said beside it.
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s2),
                children: [
                  Semantics(header: true, child: Text(changeFlagsTitle, style: text.titleLarge)),
                  const SizedBox(height: FieldSpace.s3),
                  if (_said case final said?) ...[
                    KeyedSubtree(
                      key: ValueKey('flags.said.$_tries'),
                      child: Semantics(liveRegion: true, container: true, child: NoticeMessage(said)),
                    ),
                    const SizedBox(height: FieldSpace.s3),
                  ],
                  if (!held) ...[const NoticeMessage(setupNotDownloaded), const SizedBox(height: FieldSpace.s3)],

                  // ---- risk level: one, or None ----
                  Semantics(header: true, child: Text(riskLevelLabel, style: text.titleMedium)),
                  const SizedBox(height: FieldSpace.s2),
                  if (level != null) FlagMark(flag: level) else Text(noRiskLevelText, style: text.bodyLarge),
                  if (held) ...[
                    const SizedBox(height: FieldSpace.s2),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton(
                        onPressed: () => unawaited(_chooseLevel(now)),
                        child: const Text(chooseRiskLevelAction),
                      ),
                    ),
                  ],
                  const SizedBox(height: FieldSpace.s4),

                  // ---- conditions: several ----
                  Semantics(header: true, child: Text(conditionsLabel, style: text.titleMedium)),
                  const SizedBox(height: FieldSpace.s2),
                  if (conditions.isEmpty)
                    Text(noConditionsText, style: text.bodyLarge)
                  else
                    Wrap(
                      spacing: FieldSpace.s2,
                      runSpacing: FieldSpace.s2,
                      children: [for (final f in conditions) FlagMark(flag: f)],
                    ),
                  if (held) ...[
                    const SizedBox(height: FieldSpace.s2),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton(
                        onPressed: () => unawaited(_chooseConditions(now)),
                        child: const Text(chooseConditionsAction),
                      ),
                    ),
                    const SizedBox(height: FieldSpace.s4),
                    FlagReasonBox(controller: _reason, onChanged: (_) => setState(() {})),
                  ],

                  // ---- the history ----
                  const SizedBox(height: FieldSpace.s5),
                  Semantics(header: true, child: Text('History', style: text.titleMedium)),
                  const SizedBox(height: FieldSpace.s2),
                  if (now.history.isEmpty) Text('No changes on this phone.', style: text.bodyLarge),
                  for (final change in now.history)
                    _HistoryRow(
                      change: change,
                      me: _s.userId,
                      today: today,
                      onEnterInError: !paused && _flags.mayEnterInError(change)
                          ? () => unawaited(_enterInError(change))
                          : null,
                    ),
                ],
              ),
            ),
            if (held)
              Padding(
                padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s4),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (paused) ...[
                      Text(flagsClockPaused, style: text.bodyLarge),
                      const SizedBox(height: FieldSpace.s2),
                    ],
                    if (_problem case final problem?) ...[
                      ErrorMessage(problem, key: ValueKey('flags.problem.$_tries')),
                      const SizedBox(height: FieldSpace.s2),
                    ],
                    FilledButton(onPressed: canSave ? _save : null, child: const Text('Save')),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A change the sheet listed that the phone no longer holds by the time it was marked (a purge).
const flagChangeGone = 'This change isn’t on this phone any more. Open the flags again.';

/// A flag change's reason box, in the flags sheet, intake and Needs attention: a private box (D126)
/// named `phi.<name>`, whose text is cut at [flagReasonMax] code points as it is typed, as the store
/// and the server count it, with its count under it.
class FlagReasonBox extends StatelessWidget {
  const FlagReasonBox({
    super.key,
    required this.controller,
    this.name = 'flagReason',
    this.label = 'Reason',
    this.onChanged,
    this.focusNode,
  });
  final TextEditingController controller;
  final String name;
  final String label;

  /// Called with the text as kept, after a cut.
  final ValueChanged<String>? onChanged;
  final FocusNode? focusNode;

  void _typed(String typed) {
    final limited = limitCodePoints(typed, flagReasonMax);
    if (limited != typed) {
      controller.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    onChanged?.call(limited);
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      PhiField(
        name: name,
        label: label,
        controller: controller,
        focusNode: focusNode,
        maxLines: 4,
        minLines: 2,
        showCounter: false,
        capitalization: TextCapitalization.sentences,
        textInputAction: TextInputAction.newline,
        onChanged: _typed,
      ),
      const SizedBox(height: FieldSpace.s1),
      ListenableBuilder(
        listenable: controller,
        builder: (context, _) => Text(
          '${count(controller.text.runes.length)} of ${count(flagReasonMax)} characters',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ),
    ],
  );
}

/// One change of the history: the flag in words and set or cleared, who and when, why; struck
/// through once entered in error, with who marked it, when and, to its author and Program Admins,
/// why; "Waiting to send" or "Sent for review" while it is; then **Entered in error** where the
/// person may mark it.
class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.change, required this.me, required this.today, required this.onEnterInError});
  final FlagChangeView change;
  final String me;
  final DateTime today;
  final VoidCallback? onEnterInError;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final ch = change;
    final did = ch.action == 'clear' ? flagClearedText : flagSetText;
    final who = ch.authorId == me ? 'You' : ch.authorName ?? 'A teammate';
    final at = ch.at;
    final when = at == null ? null : '${shortDate(at, today)} at ${timeOfDay(context, at)}';
    final mark = ch.enteredInError;
    final markWords = mark == null
        ? null
        : [
            'Entered in error',
            if (mark.byName != null) 'by ${mark.byName}',
            if (mark.at != null) 'on ${shortDate(mark.at!, today)}',
          ].join(' ');
    final state = (mark?.waiting ?? false)
        ? waitingToSend
        : switch (ch.state) {
            FlagChangeState.waiting => waitingToSend,
            FlagChangeState.inReview => flagSentForReviewText,
            _ => null,
          };
    final struck = mark != null;
    final spoken = [
      '$did ${flagSpoken(ch.flag)}',
      [who, if (at != null) '${longDate(at)} at ${timeOfDay(context, at)}'].join(', '),
      ?ch.reason,
      if (markWords != null) [markWords, ?mark!.reason].join(': '),
      ?state,
    ].join('. ');
    final strike = TextDecoration.lineThrough;
    return Padding(
      padding: const EdgeInsets.only(bottom: FieldSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            container: true,
            label: spoken,
            excludeSemantics: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$did ${flagWords(ch.flag)}',
                  style: text.titleMedium?.copyWith(
                    decoration: struck ? strike : null,
                    color: struck ? c.inkMuted : c.ink,
                  ),
                ),
                Text([who, ?when].join(' · '), style: text.bodyMedium?.copyWith(color: c.inkMuted)),
                if (ch.reason case final reason?)
                  Text(reason, style: text.bodyLarge?.copyWith(decoration: struck ? strike : null)),
                if (markWords != null)
                  Text(
                    [markWords, ?mark!.reason].join(': '),
                    style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                if (state != null) ...[
                  const SizedBox(height: FieldSpace.s1),
                  StatusChip(
                    label: state,
                    icon: state == flagSentForReviewText ? LucideIcons.send : LucideIcons.smartphone,
                    tone: ChipTone.info,
                  ),
                ],
              ],
            ),
          ),
          if (onEnterInError case final mark?)
            TextButton(
              onPressed: mark,
              child: Semantics(
                label: 'Mark ${did.toLowerCase()} ${flagSpoken(ch.flag)} entered in error',
                excludeSemantics: true,
                child: const Text(flagEnteredInErrorAction),
              ),
            ),
        ],
      ),
    );
  }
}

/// **Entered in error**'s reason (section 11, row 23): quick choices or a few words, 3 to 300
/// characters. [mark] marks the change and gives the refusal's words, which show here while the
/// dialog stays (`PatientFlags` checks the reason).
class _MarkDialog extends StatefulWidget {
  const _MarkDialog({required this.mark});
  final String? Function(String reason) mark;

  @override
  State<_MarkDialog> createState() => _MarkDialogState();
}

class _MarkDialogState extends State<_MarkDialog> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _submit() {
    final refused = widget.mark(_reason.text);
    if (refused == null) return Navigator.of(context).pop(true);
    setState(() => _error = refused);
  }

  @override
  Widget build(BuildContext context) => AskDialog(
    title: 'Mark this change entered in error?',
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'It leaves the patient’s flags and stays in the history. Only you and Program Admins see the reason.',
        ),
        const SizedBox(height: FieldSpace.s3),
        Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s2,
          children: [
            for (final q in const ['Wrong patient', 'Set by mistake'])
              ActionChip(
                label: Text(q),
                onPressed: () => setState(() {
                  _reason.text = q;
                  _error = null;
                }),
              ),
          ],
        ),
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
      TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
      FilledButton(onPressed: _submit, child: const Text(markFlagChangeAction)),
    ],
  );
}

/// The risk level chooser: None (where offered) and each level by its pill, one chosen; a choice
/// closes it.
class _RiskLevelDialog extends StatelessWidget {
  const _RiskLevelDialog({required this.levels, required this.current, required this.offerNone});
  final List<FlagView> levels;
  final String? current;
  final bool offerNone;

  /// None's value in the group: no flag ID is empty.
  static const _none = '';

  @override
  Widget build(BuildContext context) => SimpleDialog(
    title: const Text(riskLevelLabel),
    children: [
      RadioGroup<String>(
        groupValue: current ?? (offerNone ? _none : null),
        onChanged: (v) => Navigator.of(context).pop((flagId: v == null || v == _none ? null : v)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (offerNone) const RadioListTile<String>(value: _none, title: Text(noRiskLevelText)),
            for (final f in levels)
              RadioListTile<String>(
                value: f.flagId,
                title: Align(
                  alignment: Alignment.centerLeft,
                  child: FlagMark(flag: f),
                ),
              ),
          ],
        ),
      ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: FieldSpace.s4),
        child: Align(
          alignment: Alignment.centerRight,
          child: TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        ),
      ),
    ],
  );
}

/// The conditions chooser: a checkbox for each by its pill, then Done.
class _ConditionsDialog extends StatefulWidget {
  const _ConditionsDialog({required this.conditions, required this.ticked});
  final List<FlagView> conditions;
  final Set<String> ticked;

  @override
  State<_ConditionsDialog> createState() => _ConditionsDialogState();
}

class _ConditionsDialogState extends State<_ConditionsDialog> {
  late final _ticked = {...widget.ticked};

  /// The words scroll and Cancel and Done stay under them, in reach at any text size and however
  /// many conditions the team lists.
  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: true,
    title: const Text(conditionsLabel),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.conditions.isEmpty) const Text('Your team has no conditions on its list.'),
        for (final f in widget.conditions)
          CheckboxListTile(
            value: _ticked.contains(f.flagId),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: Align(
              alignment: Alignment.centerLeft,
              child: FlagPill(name: f.name, colorName: f.colorName, color: f.color),
            ),
            subtitle: f.archived ? const Text('$flagArchivedText. It can only be cleared.') : null,
            onChanged: (on) => setState(() => on == true ? _ticked.add(f.flagId) : _ticked.remove(f.flagId)),
          ),
      ],
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(onPressed: () => Navigator.of(context).pop(_ticked), child: const Text(conditionsDoneAction)),
    ],
  );
}
