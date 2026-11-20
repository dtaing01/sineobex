import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' as wire;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart' show ErrorMessage;
import '../../design/widgets/status_chip.dart';
import '../../encounters/encounter_api.dart' show EncounterRequestFailed;
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_repository.dart'
    show
        PatientTimeline,
        TimelineNoteChip,
        TimelineReferralRow,
        TimelineRow,
        TimelineView,
        TimelineVisitRow,
        timelineGroups;
import '../../encounters/encounter_services.dart';
import '../../encounters/referrals.dart' show ReferralView;
import '../../forms/definition.dart' show NoteTypeDef;
import '../../patients/chart_cache.dart' show chartMetaOf;
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_controller.dart' show SyncController;
import '../patients/patient_labels.dart' show longDate;
import '../patients/patient_widgets.dart' show SectionHeading, WideButton;
import '../sync/sync_labels.dart' show timeOfDay;
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show encountersOpen;
import 'referrals_sheet.dart';
import 'visit_screen.dart' show visitLocation;

/// The patient profile's **Timeline** (lifecycle 9.1): one row per visit and per referral, newest
/// first, under a row of type filter chips with the PRD's seven names. A visit's row shows its date,
/// Medical or Non-Medical, and its notes as chips with each note's state in words, and opens the
/// visit (9.7); a referral's row opens the Referrals sheet. Under a full page of the server's visits,
/// **Show earlier visits** asks for the next 50 (5.2).
///
/// The chart's own list, from the copy the phone keeps (5.2 as built), is merged with the visits the
/// phone holds by the domain layer (`openTimeline`), which knows better of a note done here. The
/// timeline is part of the chart, whose open logged the read (phase 3's chart lists its problems the
/// same way), so it logs nothing of its own; opening a visit or the Referrals sheet from it does.
class TimelineSection extends ConsumerStatefulWidget {
  const TimelineSection({super.key, required this.services, required this.patientId});
  final EncounterServices services;

  /// The chart's patient, as the profile opened them (their merged group's canonical record).
  final String patientId;

  @override
  ConsumerState<TimelineSection> createState() => _TimelineSectionState();
}

class _TimelineSectionState extends ConsumerState<TimelineSection> with AutomaticKeepAliveClientMixin {
  late final SyncController _sync;
  TimelineView? _view;
  String? _refused;

  /// The pages Show earlier visits brought, kept while the profile is open; the server logged each.
  final _earlier = <List<wire.TimelineVisit>>[];
  bool _fetching = false;
  String? _earlierProblem;

  /// The filter's chips that are on: none shows every row.
  final _groups = <String>{};

  /// The team's listed note types, by key, for a note's title and whether it is Medical.
  var _types = <String, NoteTypeDef>{};
  int _seq = 0;

  EncounterServices get _s => widget.services;

  /// The pages fetched and the filter chosen stay while the profile scrolls past the section.
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _s.addListener(_reread);
    _sync.addListener(_reread);
    _reread();
  }

  @override
  void dispose() {
    _s.removeListener(_reread);
    _sync.removeListener(_reread);
    super.dispose();
  }

  void _reread() => unawaited(_read());

  /// Reads the timeline again: after a change made here, a sync (a receipt ends "Waiting to send"),
  /// or a page of earlier visits. A read a later one overtook shows nothing.
  Future<void> _read() async {
    final seq = ++_seq;
    if (!mounted || !encountersOpen(_sync, _s)) return;
    try {
      _types = {for (final t in await _s.noteTypes()) t.key: t};
      if (!mounted || seq != _seq || !encountersOpen(_sync, _s)) return;
      final view = await _s.repository.openTimeline(
        widget.patientId,
        chart: chartMetaOf(_s.store, widget.patientId)?.timeline,
        earlier: _earlier,
        typeOf: (key) => _types[key],
      );
      if (!mounted || seq != _seq) return;
      setState(() {
        _view = view;
        _refused = null;
      });
    } on ChartingPaused catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _view = null;
        _refused = e.message;
      });
    }
  }

  Future<void> _showEarlier(String before) async {
    setState(() {
      _fetching = true;
      _earlierProblem = null;
    });
    try {
      final page = await _s.api.earlierVisits(widget.patientId, before: before);
      if (!mounted) return;
      _earlier.add(page);
      await _read();
    } on EncounterRequestFailed catch (e) {
      if (mounted) setState(() => _earlierProblem = e.message);
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _earlierProblem = e.message);
    } finally {
      if (mounted) setState(() => _fetching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final text = Theme.of(context).textTheme;
    if (!encountersOpen(_sync, _s)) return const SizedBox.shrink();
    final meta = chartMetaOf(_s.store, widget.patientId);
    final view = _view;
    final rows = view?.filtered(_groups) ?? const <TimelineRow>[];
    final before = view?.earlierBefore;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeading(timelineHeading),
        if (_refused case final message?)
          ErrorMessage(message)
        else if (view == null)
          const Center(child: CircularProgressIndicator())
        else ...[
          Semantics(
            container: true,
            label: timelineFilterSpoken,
            child: Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              children: [
                for (final g in timelineGroups)
                  FilterChip(
                    label: Text(timelineGroupText(g)),
                    selected: _groups.contains(g),
                    onSelected: (on) => setState(() => on ? _groups.add(g) : _groups.remove(g)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: FieldSpace.s3),
          // Nodes of their own, so the heading above doesn't take them in (review SAX-5).
          if (meta == null || meta.partial || meta.timeline == null) ...[
            Semantics(container: true, child: Text(timelineNeedsChart, style: text.bodyLarge)),
            const SizedBox(height: FieldSpace.s2),
          ],
          if (rows.isEmpty)
            Semantics(
              container: true,
              child: Text(view.rows.isEmpty ? noTimeline : noTimelineFiltered, style: text.bodyLarge),
            ),
          for (final row in rows) ...[
            switch (row) {
              TimelineVisitRow() => _VisitRow(
                row: row,
                onOpen: () => unawaited(context.push(visitLocation(row.encounterId))),
              ),
              TimelineReferralRow(:final referral) => _ReferralRow(
                referral: referral,
                onOpen: () => unawaited(showReferrals(context, _s, patientId: widget.patientId)),
              ),
            },
            const SizedBox(height: FieldSpace.s2),
          ],
          if (before != null) ...[
            if (_earlierProblem != null) ...[ErrorMessage(_earlierProblem!), const SizedBox(height: FieldSpace.s2)],
            WideButton(
              label: showEarlierVisits,
              icon: LucideIcons.history,
              onPressed: _fetching ? null : () => unawaited(_showEarlier(before)),
            ),
          ],
        ],
      ],
    );
  }
}

/// A row of the timeline: a card that is one button, read as [spoken].
class _RowCard extends StatelessWidget {
  const _RowCard({required this.spoken, required this.hint, required this.onOpen, required this.children});
  final String spoken;
  final String hint;
  final VoidCallback onOpen;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    // The tap is on this node itself, so Switch Access and Voice Access can activate it.
    return Semantics(
      container: true,
      button: true,
      label: spoken,
      hint: hint,
      excludeSemantics: true,
      onTap: onOpen,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: onOpen,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
            ),
          ),
        ),
      ),
    );
  }
}

/// A visit's row (9.1): its date, its kind, "Waiting to send" while something done here waits, and
/// its notes as chips, each with its state in words.
class _VisitRow extends StatelessWidget {
  const _VisitRow({required this.row, required this.onOpen});
  final TimelineVisitRow row;
  final VoidCallback onOpen;

  static String _state(TimelineNoteChip n) => n.sentForReview
      ? sentForReview
      : n.waitingToSend
      ? waitingToSend
      : noteShownText(n.shown);

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final when = switch (row.startedAt) {
      final DateTime at => '${longDate(at)} at ${timeOfDay(context, at)}',
      null => startedHere,
    };
    final chips = [for (final n in row.notes) noteChipText(n.title ?? untitledNote, _state(n))];
    return _RowCard(
      spoken: [when, visitKindText(row.kind), if (row.waitingToSend) waitingToSend, ...chips].join(', '),
      hint: visitOpensHint,
      onOpen: onOpen,
      children: [
        Text(when, style: text.titleMedium),
        Text(visitKindText(row.kind), style: text.bodyLarge),
        if (row.waitingToSend || row.notes.isNotEmpty) ...[
          const SizedBox(height: FieldSpace.s1),
          Wrap(
            spacing: FieldSpace.s2,
            runSpacing: FieldSpace.s1,
            children: [
              if (row.waitingToSend)
                const StatusChip(label: waitingToSend, icon: LucideIcons.smartphone, tone: ChipTone.info),
              for (final (i, n) in row.notes.indexed) StatusChip(label: chips[i], icon: _icon(n), tone: _tone(n)),
            ],
          ),
        ],
      ],
    );
  }

  static IconData _icon(TimelineNoteChip n) => n.sentForReview
      ? LucideIcons.shieldAlert
      : n.waitingToSend
      ? LucideIcons.smartphone
      : switch (n.shown) {
          NoteShown.draft => LucideIcons.squarePen,
          NoteShown.waitingForCosigner || NoteShown.waitingForAttestation => LucideIcons.clock,
          _ => LucideIcons.circleCheck,
        };

  static ChipTone _tone(TimelineNoteChip n) => n.sentForReview
      ? ChipTone.warning
      : n.waitingToSend
      ? ChipTone.info
      : switch (n.shown) {
          NoteShown.draft => ChipTone.neutral,
          NoteShown.waitingForCosigner || NoteShown.waitingForAttestation => ChipTone.info,
          _ => ChipTone.good,
        };
}

/// A referral's row (7, 9.1): its date and details, who recorded it, "At a visit", and where it is;
/// struck through once entered in error.
class _ReferralRow extends StatelessWidget {
  const _ReferralRow({required this.referral, required this.onOpen});
  final ReferralView referral;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final r = referral;
    final date = referralDate(r.referredOn);
    final struck = r.enteredInError != null;
    final facts = referralFacts(r);
    return _RowCard(
      spoken: referralSpoken(date: date, details: r.details, rest: facts),
      hint: referralOpensHint,
      onOpen: onOpen,
      children: [
        Text('$referralQuickAction, $date', style: text.titleMedium),
        Text(
          r.details,
          style: text.bodyLarge?.copyWith(
            decoration: struck ? TextDecoration.lineThrough : null,
            color: struck ? c.inkMuted : c.ink,
          ),
        ),
        Text(facts.join(' · '), style: text.bodyMedium?.copyWith(color: c.inkMuted)),
      ],
    );
  }
}
