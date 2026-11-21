import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' show RecordSnapshot;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../encounters/encounter_models.dart' show Sending;
import '../../encounters/encounter_services.dart';
import '../../encounters/referrals.dart' show ReferralView;
import '../../patients/chart_cache.dart' show chartMetaOf;
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_controller.dart' show SyncController;
import '../../forms/definition.dart' show DateDef;
import '../forms/date_field.dart' show DateField, isoDate;
import '../forms/text_field.dart' show limitCodePoints;
import '../patients/patient_labels.dart' show count, isoDay, longDate;
import '../patients/patient_widgets.dart' show AskDialog, PhiField, WideButton, showDone, todayOf;
import 'encounter_labels.dart';
import '../patients/sheet_gate.dart' show DialogGate, DialogGateScope;
import 'encounter_widgets.dart' show SheetGate, encountersOpen;

/// Most characters a referral's details hold (lifecycle 7, 9.10).
const referralDetailsMax = 2000;

const referralDetailsLabel = 'Details';
const referralDateLabel = 'Date referred';
const referralDateMissing = 'Type the date of the referral, or choose it on the calendar.';
const referralDateUnsaved = 'Fix the date first: what’s typed can’t be saved.';
const referralAdded = 'Referral added';
const addReferralButton = 'Add referral';

/// **Add referral** (lifecycle 9.10), from a note's `add_referral` action (forms 6.8) or the summary
/// (9.6): a date, today by default, and a details box of up to 2,000 characters, made at the visit
/// [encounterId] when given. `Referrals.add` holds every rule and words every refusal; the sheet shows
/// them. Returns the referral's ID, or null when the sheet was closed without one.
///
/// The patient's past referrals, with Entered in error, are the Referrals sheet's ([showReferrals]).
Future<String?> showAddReferral(
  BuildContext context,
  EncounterServices services, {
  required String patientId,
  String? encounterId,
}) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => SheetGate(
    services: services,
    child: SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            _AddReferral(
              services: services,
              patientId: patientId,
              encounterId: encounterId,
              onAdded: (id) {
                showDone(context, referralAdded);
                Navigator.of(context).pop(id);
              },
            ),
          ],
        ),
      ),
    ),
  ),
);

/// **The Referrals sheet** (lifecycle 7, 9.10), from the profile's **+ Referral** and a referral's
/// row on the timeline: the patient's referrals, newest first, each with who recorded it, "At a
/// visit" and "Waiting to send" where they apply, one marked entered in error struck through with its
/// reason; then **Add referral**, to a role that may add one. A row's **Entered in error** asks for a
/// reason. `Referrals` holds every rule and words every refusal: [Referrals.mayAdd] and
/// [Referrals.mayEnterInError] say what the sheet offers.
///
/// The list is the referrals the phone holds for the patient's merged group and those the chart the
/// phone keeps lists (5.2), each logged as it first shows (`openReferrals`), so a read that can't be
/// logged shows nothing. From a visit's summary, [encounterId] is the visit a referral added here is
/// made at (9.6, 9.10). The sheet sits in [SheetGate] too, so it hears a freeze whichever of the
/// team's services tells of it first (phase 3's V1).
Future<void> showReferrals(
  BuildContext context,
  EncounterServices services, {
  required String patientId,
  String? encounterId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => SheetGate(
    services: services,
    child: _ReferralsSheet(services: services, patientId: patientId, encounterId: encounterId),
  ),
);

class _ReferralsSheet extends ConsumerStatefulWidget {
  const _ReferralsSheet({required this.services, required this.patientId, this.encounterId});
  final EncounterServices services;
  final String patientId;
  final String? encounterId;

  @override
  ConsumerState<_ReferralsSheet> createState() => _ReferralsSheetState();
}

class _ReferralsSheetState extends ConsumerState<_ReferralsSheet> {
  late final SyncController _sync;
  final _shown = <String>{};
  List<ReferralView>? _referrals;
  String? _refused;

  /// What was just done, said in the sheet, which stays open: a SnackBar would be drawn under it,
  /// neither seen nor heard (review SAX-6). [added] under Add referral, else under the heading.
  ({String text, bool added})? _said;

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _s.addListener(_read);
    _sync.addListener(_read);
    _read();
  }

  @override
  void dispose() {
    _s.removeListener(_read);
    _sync.removeListener(_read);
    super.dispose();
  }

  /// The chart's own list, from the copy the phone keeps.
  List<RecordSnapshot> get _chart =>
      chartMetaOf(_s.store, _s.store.canonicalPatient(widget.patientId))?.referrals ?? const [];

  /// Reads the list again, logging only the referrals not shown before; after a change made here or
  /// a sync (a receipt ends "Waiting to send").
  void _read() {
    if (!mounted || !encountersOpen(_sync, _s)) return;
    try {
      final list = _s.referrals.openReferrals(widget.patientId, chart: _chart, shownBefore: {..._shown});
      _shown.addAll(list.map((r) => r.id));
      setState(() {
        _referrals = list;
        _refused = null;
      });
    } on ChartingPaused catch (e) {
      // What can't be logged isn't shown (D21).
      setState(() {
        _referrals = null;
        _refused = e.message;
      });
    }
  }

  /// Asks for the reason, and marks the referral in the dialog, which shows a refusal and stays.
  Future<void> _enterInError(ReferralView r) async {
    // It holds the typed reason: it closes on a freeze (D125; review finding PP-1).
    final marked = await showDialog<bool>(
      context: context,
      builder: (_) => DialogGate<bool>(
        services: _s,
        cancel: false,
        child: _ReasonDialog(
          mark: (reason) {
            try {
              _s.referrals.enterInError(r.id, reason, chart: _chart);
              return null;
            } on Exception catch (e) {
              return encounterErrorText(e);
            }
          },
        ),
      ),
    );
    if (marked == true && mounted) setState(() => _said = (text: referralMarked, added: false));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    if (!encountersOpen(_sync, _s)) return const SizedBox.shrink();
    final frozen = _s.store.frozenMessage ?? _refused;
    final referrals = frozen == null ? _referrals : null;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          children: [
            Semantics(header: true, child: Text(referralsHeading, style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s3),
            if (_said case (:final text, added: false)) ...[_Said(text), const SizedBox(height: FieldSpace.s3)],
            if (frozen != null)
              ErrorMessage(frozen)
            else if (referrals != null) ...[
              if (referrals.isEmpty) Text(noReferrals, style: text.bodyLarge),
              for (final r in referrals)
                _ReferralLine(
                  referral: r,
                  onEnterInError: _s.referrals.mayEnterInError(r) ? () => unawaited(_enterInError(r)) : null,
                ),
              if (_s.referrals.mayAdd) ...[
                const Divider(height: FieldSpace.s6),
                _AddReferral(
                  services: _s,
                  patientId: widget.patientId,
                  encounterId: widget.encounterId,
                  onAdded: (_) => setState(() => _said = (text: referralAdded, added: true)),
                ),
                if (_said case (:final text, added: true)) ...[const SizedBox(height: FieldSpace.s3), _Said(text)],
              ],
            ],
          ],
        ),
      ),
    );
  }
}

/// A referral's date in words; the stored text when it isn't a date.
String referralDate(String referredOn) => switch (isoDay(referredOn)) {
  final DateTime d => longDate(d),
  null => referredOn,
};

/// What a referral's row says under its details: who recorded it, "At a visit", and where it is.
List<String> referralFacts(ReferralView r) => [
  recordedByText(r.recordedBy),
  if (r.atVisit) atAVisit,
  if (r.sending == Sending.refused)
    inNeedsAttention
  else if (r.sending == Sending.waiting || r.markWaiting)
    waitingToSend,
  if (r.enteredInError case final reason?) inErrorText(reason),
];

/// One referral of the sheet: its date, its details (struck through once entered in error), who
/// recorded it and where it is, then **Entered in error** where the person may mark it.
class _ReferralLine extends StatelessWidget {
  const _ReferralLine({required this.referral, required this.onEnterInError});
  final ReferralView referral;
  final VoidCallback? onEnterInError;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final r = referral;
    final date = referralDate(r.referredOn);
    final struck = r.enteredInError != null;
    final facts = referralFacts(r);
    final mark = onEnterInError;
    return Padding(
      padding: const EdgeInsets.only(bottom: FieldSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            container: true,
            label: referralSpoken(date: date, details: r.details, rest: facts),
            excludeSemantics: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(date, style: text.titleMedium),
                Text(
                  r.details,
                  style: text.bodyLarge?.copyWith(
                    decoration: struck ? TextDecoration.lineThrough : null,
                    color: struck ? c.inkMuted : c.ink,
                  ),
                ),
                const SizedBox(height: FieldSpace.s1),
                Text(
                  [recordedByText(r.recordedBy), if (r.atVisit) atAVisit].join(' · '),
                  style: text.bodyMedium?.copyWith(color: c.inkMuted),
                ),
                if (r.enteredInError case final reason?) Text(inErrorText(reason), style: text.bodyMedium),
                if (r.sending != Sending.sent || r.markWaiting) ...[
                  const SizedBox(height: FieldSpace.s1),
                  StatusChip(
                    label: r.sending == Sending.refused ? inNeedsAttention : waitingToSend,
                    icon: r.sending == Sending.refused ? LucideIcons.triangleAlert : LucideIcons.smartphone,
                    tone: r.sending == Sending.refused ? ChipTone.warning : ChipTone.info,
                  ),
                ],
              ],
            ),
          ),
          if (mark != null)
            TextButton(
              onPressed: mark,
              child: Semantics(
                label: referralInErrorSpoken(date),
                excludeSemantics: true,
                child: const Text(referralInErrorAction),
              ),
            ),
        ],
      ),
    );
  }
}

/// **Add referral**'s date and details, and its button: [onAdded] takes the new referral's ID. The
/// form starts again empty after each, so the Referrals sheet stays open on its list.
class _AddReferral extends ConsumerStatefulWidget {
  const _AddReferral({required this.services, required this.patientId, required this.onAdded, this.encounterId});
  final EncounterServices services;
  final String patientId;
  final String? encounterId;
  final ValueChanged<String> onAdded;

  @override
  ConsumerState<_AddReferral> createState() => _AddReferralState();
}

class _AddReferralState extends ConsumerState<_AddReferral> {
  final _details = TextEditingController();

  /// The date, `YYYY-MM-DD`, or null once its boxes are cleared.
  late String? _on = isoDate(todayOf(ref));

  /// The date's boxes hold one not saved: typed, half typed or refused.
  bool _dateUnsaved = false;
  String? _problem;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  /// Cut at the limit as the form's text boxes cut theirs: in code points, as the server counts.
  void _typed(String typed) {
    final limited = limitCodePoints(typed, referralDetailsMax);
    if (limited != typed) {
      _details.value = TextEditingValue(
        text: limited,
        selection: TextSelection.collapsed(offset: limited.length),
      );
    }
    setState(() {});
  }

  Future<void> _add() async {
    // A date being typed is saved as its boxes are left, so it is the one added.
    FocusManager.instance.primaryFocus?.unfocus();
    await Future<void>.delayed(Duration.zero);
    if (!mounted) return;
    final on = isoDay(_on);
    if (_dateUnsaved || on == null) {
      return setState(() => _problem = _dateUnsaved ? referralDateUnsaved : referralDateMissing);
    }
    try {
      final id = widget.services.referrals.add(
        widget.patientId,
        referredOn: on,
        details: _details.text,
        encounterId: widget.encounterId,
      );
      _details.clear();
      setState(() {
        _problem = null;
        _on = isoDate(todayOf(ref));
      });
      widget.onAdded(id);
    } on Exception catch (e) {
      setState(() => _problem = encounterErrorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(header: true, child: Text(addReferralAction, style: text.titleLarge)),
        const SizedBox(height: FieldSpace.s3),
        // The boxes and the calendar's button say the label themselves, so it is heard once.
        ExcludeSemantics(child: Text(referralDateLabel, style: text.titleMedium)),
        const SizedBox(height: FieldSpace.s2),
        // Typed in three private boxes, or picked on the calendar alone, as a note's date is (D92;
        // the coordinator's decision on review finding PX-3); the calendar closes on a freeze, in the
        // sheet's gate (D125). As far back as a note's dates reach (forms 10.1 #43), never ahead.
        DialogGateScope(
          services: widget.services,
          child: DateField(
            field: _referralDate,
            value: _on,
            today: todayOf(ref),
            onChanged: (iso) {
              if (mounted) setState(() => _on = iso);
            },
            onUnsaved: (unsaved) {
              if (mounted) setState(() => _dateUnsaved = unsaved);
            },
          ),
        ),
        const SizedBox(height: FieldSpace.s3),
        PhiField(
          name: 'referralDetails',
          label: referralDetailsLabel,
          controller: _details,
          maxLines: 8,
          minLines: 3,
          showCounter: false,
          capitalization: TextCapitalization.sentences,
          textInputAction: TextInputAction.newline,
          onChanged: _typed,
        ),
        const SizedBox(height: FieldSpace.s1),
        Text('${count(_details.text.runes.length)} of ${count(referralDetailsMax)} characters', style: text.bodyMedium),
        if (_problem != null) ...[const SizedBox(height: FieldSpace.s2), ErrorMessage(_problem!)],
        const SizedBox(height: FieldSpace.s3),
        WideButton(label: addReferralButton, filled: true, onPressed: () => unawaited(_add())),
      ],
    );
  }
}

/// A referral's date: today or earlier, which the server takes on a clock it has measured.
final _referralDate = DateDef.outside(id: 'referredOn', label: referralDateLabel);

const changeReferralDateAction = 'Change the date';

/// **Change the date** of a referral the server refused for its date, from Needs attention (review
/// finding PS-3): a sheet whose date is typed in three private boxes or picked on the calendar alone,
/// as Add referral's is (D92; the coordinator's decision on review finding PX-3), [today] by
/// default. A sheet, as Add referral is, since a dialog sizes its content in a way the typed date's
/// layout can't be; in [SheetGate], so a freeze takes it, and the calendar over it closes (D125).
/// Gives the date chosen, or null when it was closed without one.
Future<DateTime?> askReferralDate(BuildContext context, EncounterServices services, {required DateTime today}) async {
  final iso = await showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => SheetGate(
      services: services,
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
            children: [
              DialogGateScope(
                services: services,
                child: _ReferralDateForm(today: today),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  return isoDay(iso);
}

class _ReferralDateForm extends StatefulWidget {
  const _ReferralDateForm({required this.today});
  final DateTime today;

  @override
  State<_ReferralDateForm> createState() => _ReferralDateFormState();
}

class _ReferralDateFormState extends State<_ReferralDateForm> {
  late String? _on = isoDate(widget.today);
  bool _unsaved = false;
  String? _problem;

  Future<void> _change() async {
    // A date being typed is saved as its boxes are left, so it is the one sent.
    FocusManager.instance.primaryFocus?.unfocus();
    await Future<void>.delayed(Duration.zero);
    if (!mounted) return;
    if (_unsaved || _on == null) return setState(() => _problem = _unsaved ? referralDateUnsaved : referralDateMissing);
    Navigator.of(context).pop(_on);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(header: true, child: Text(changeReferralDateAction, style: text.titleLarge)),
        const SizedBox(height: FieldSpace.s3),
        ExcludeSemantics(child: Text(referralDateLabel, style: text.titleMedium)),
        const SizedBox(height: FieldSpace.s2),
        DateField(
          field: _referralDate,
          value: _on,
          today: widget.today,
          onChanged: (iso) {
            if (mounted) setState(() => _on = iso);
          },
          onUnsaved: (unsaved) {
            if (mounted) setState(() => _unsaved = unsaved);
          },
        ),
        if (_problem != null) ...[const SizedBox(height: FieldSpace.s2), ErrorMessage(_problem!)],
        const SizedBox(height: FieldSpace.s3),
        WideButton(label: changeReferralDateAction, filled: true, onPressed: () => unawaited(_change())),
      ],
    );
  }
}

/// **Entered in error**'s reason (lifecycle 7): quick choices or a few words. [mark] marks the
/// referral and gives the refusal's words, which show here while the dialog stays (`Referrals`
/// checks the reason). Phase 3's reason dialog does not scroll as a whole, and at 200% text its title
/// and buttons leave its box no room on a phone; this one scrolls.
class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.mark});
  final String? Function(String reason) mark;

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
    final refused = widget.mark(_reason.text);
    if (refused == null) return Navigator.of(context).pop(true);
    setState(() => _error = refused);
  }

  @override
  Widget build(BuildContext context) => AskDialog(
    title: referralInErrorTitle,
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(referralInErrorBody),
        const SizedBox(height: FieldSpace.s3),
        Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s2,
          children: [
            for (final q in referralInErrorQuick)
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
          name: 'referralReason',
          label: correctionReasonLabel,
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
      FilledButton(onPressed: _submit, child: const Text(referralInErrorYes)),
    ],
  );
}

/// What the sheet just did, in words, once: a live region a screen reader speaks as it appears.
class _Said extends StatelessWidget {
  const _Said(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Semantics(liveRegion: true, container: true, child: NoticeMessage(text));
}
