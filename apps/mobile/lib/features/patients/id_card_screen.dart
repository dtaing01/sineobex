import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/id_links.dart';
import '../../patients/patient_providers.dart';
import '../../patients/patient_repository.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalNotice;
import 'patient_labels.dart';
import 'patient_screen.dart' show copyOutcomeText;
import 'patient_widgets.dart';

/// The Street Medicine ID card (design 10.4): the card's state as a sentence with an icon, the
/// conflict message first when another card won, **Copy link** (announced "Link copied. It clears
/// in 60 seconds."), **Make a new card** with its reason, and the printing guidance.
class IdCardScreen extends StatelessWidget {
  const IdCardScreen({super.key, required this.patientId});
  final String patientId;

  @override
  Widget build(BuildContext context) => PatientsGate(
    title: 'ID card',
    builder: (context, services) => _IdCard(services: services, patientId: patientId),
  );
}

class _IdCard extends ConsumerStatefulWidget {
  const _IdCard({required this.services, required this.patientId});
  final PatientServices services;
  final String patientId;

  @override
  ConsumerState<_IdCard> createState() => _IdCardState();
}

class _IdCardState extends ConsumerState<_IdCard> {
  String? _announce;
  String? _problem;

  PatientServices get _s => widget.services;

  Future<void> _copy(IdCard card) async {
    try {
      final outcome = await _s.idLinks.copy(card.id);
      if (mounted) setState(() => _announce = copyOutcomeText(outcome));
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _announce = e.message);
    }
  }

  Future<void> _make(PatientView v) async {
    final first = v.cards.isEmpty;
    if (first && v.idCardChoice == 'declined') {
      final yes = await confirm(
        context,
        title: 'They declined a card. Make one anyway?',
        body: 'Make a card only if they’ve changed their mind.',
        yes: 'Make a card',
      );
      if (!yes || !mounted) return;
    }
    final String? reason;
    if (first) {
      reason = 'first_card';
    } else {
      reason = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => _ReasonSheet(working: v.workingCards.length),
      );
    }
    if (reason == null || !mounted) return;
    try {
      _s.idLinks.makeCard(v.canonicalId, reason: reason);
      _s.changed();
      setState(() {
        _problem = null;
        _announce = 'New card made. It works on this phone now.';
      });
    } on ChartingPaused catch (e) {
      setState(() => _problem = e.message);
    }
  }

  void _dismiss(LocalNotice n) {
    _s.store.markNoticeRead(n.id);
    _s.changed();
  }

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final today = todayOf(ref);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('ID card')),
      body: ListenableBuilder(
        listenable: Listenable.merge([sync, _s]),
        builder: (context, _) {
          final v = _s.patients.read(widget.patientId);
          if (v == null) {
            return const Padding(padding: EdgeInsets.all(FieldSpace.s4), child: NoticeMessage('Open the chart first.'));
          }
          final paused = sync.snapshot.clock.paused;
          final mayEdit = _s.mayEdit && v.mergedInto == null;
          final working = v.workingCards;
          final group = {v.canonicalId, ...v.cards.map((c) => c.issuedOn)};
          final cardIds = {for (final c in v.cards) c.id};
          // A card conflict's outcome, for one of this chart's cards: the message comes first
          // (10.4 step 6), worded from this phone's own cards, never from the notice.
          final notices = [
            for (final n in _s.store.notices(unreadOnly: true))
              if (_cardNoticeKinds.contains(n.kind) && (group.contains(n.patientId) || cardIds.contains(n.recordId))) n,
          ];
          final others = [
            for (final c in v.cards)
              if (!c.working) c,
          ];
          return ListView(
            padding: const EdgeInsets.all(FieldSpace.s4),
            children: [
              for (final n in notices) ...[_noticeMessage(v, n, today, mayEdit), const SizedBox(height: FieldSpace.s3)],
              if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
              const SectionHeading('Cards that open this chart'),
              if (working.length > 1) ...[
                StatusBanner(
                  icon: LucideIcons.merge,
                  tone: ChipTone.info,
                  text: '${working.length} cards open this chart (two records were merged)',
                  detail: 'Copy either link. Making a new card stops both.',
                ),
                const SizedBox(height: FieldSpace.s2),
              ],
              for (final card in working) ...[
                _CardState(
                  card: card,
                  today: today,
                  onCopy: mayEdit && card.copyable ? () => unawaited(_copy(card)) : null,
                ),
                const SizedBox(height: FieldSpace.s2),
              ],
              if (working.isEmpty)
                StatusBanner(
                  icon: v.cardWanted && paused ? LucideIcons.clockAlert : LucideIcons.idCard,
                  tone: v.cardWanted && paused ? ChipTone.warning : ChipTone.neutral,
                  text: v.cardWanted
                      ? 'Make the card once the phone’s clock is right'
                      : v.idCardChoice == 'declined'
                      ? 'Declined a card'
                      : 'No card yet',
                ),
              if (_announce != null) ...[
                const SizedBox(height: FieldSpace.s2),
                Semantics(liveRegion: true, child: Text(_announce!, style: text.titleMedium)),
              ],
              if (mayEdit) ...[
                const SizedBox(height: FieldSpace.s4),
                if (paused)
                  Padding(
                    padding: const EdgeInsets.only(bottom: FieldSpace.s2),
                    child: Text('Cards can be made once the phone’s clock is right.', style: text.bodyLarge),
                  ),
                WideButton(
                  label: working.isEmpty && v.cards.isEmpty ? 'Make a card' : 'Card lost or damaged? Make a new card',
                  icon: LucideIcons.idCard,
                  filled: working.isEmpty,
                  onPressed: paused ? null : () => unawaited(_make(v)),
                ),
              ],
              const SizedBox(height: FieldSpace.s4),
              const StatusBanner(
                icon: LucideIcons.info,
                tone: ChipTone.info,
                text: 'Print only the code and your team’s contact line.',
                detail: 'Don’t print the person’s name, birth date or health details on the card.',
              ),
              if (others.isNotEmpty) ...[
                const SectionHeading('Earlier cards'),
                for (final card in others) ...[
                  _CardState(card: card, today: today, onCopy: null),
                  const SizedBox(height: FieldSpace.s2),
                ],
              ],
            ],
          );
        },
      ),
    );
  }

  /// A card conflict's outcome (design 10.4): for the losing maker, "Another new card for Del was
  /// made at 2:14 PM, after yours at 1:50 PM. That card is the valid one; the card you printed won't
  /// open the chart."; for the winning maker, that theirs stands; for an admin, which card is valid.
  Widget _noticeMessage(PatientView v, LocalNotice n, DateTime today, bool mayEdit) {
    final mine = v.cards.where((c) => c.id == n.recordId).firstOrNull;
    final winner = v.workingCards.firstOrNull;
    String at(DateTime? t) => t == null ? '' : ' at ${TimeOfDay.fromDateTime(t.toLocal()).format(context)}';
    String on(DateTime? t) => t == null ? '' : ' on ${shortDate(t, today)}${at(t)}';
    final name = v.preferredName ?? 'this patient';
    final done = TextButton(onPressed: () => _dismiss(n), child: const Text('Got it'));
    return switch (n.kind) {
      noticeCardKept => StatusBanner(
        icon: LucideIcons.circleCheck,
        tone: ChipTone.good,
        text: 'Another new card for $name was made at about the same time as yours. Yours is the valid one.',
        action: done,
      ),
      noticeCardConflict => StatusBanner(
        icon: LucideIcons.info,
        tone: ChipTone.info,
        text: 'Two new cards were made for one patient. The card made${on(winner?.effectiveAt)} is the valid one.',
        action: done,
      ),
      _ => StatusBanner(
        icon: LucideIcons.triangleAlert,
        tone: ChipTone.warning,
        text:
            'Another new card for $name was made${at(winner?.effectiveAt)}, after yours${at(mine?.effectiveAt)}. '
            'That card is the valid one; the card you printed won’t open the chart.',
        action: Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s2,
          children: [
            if (winner != null && winner.copyable && mayEdit)
              FilledButton(onPressed: () => unawaited(_copy(winner)), child: const Text('Copy the valid link')),
            if (mayEdit) OutlinedButton(onPressed: () => unawaited(_make(v)), child: const Text('Make a new card')),
            done,
          ],
        ),
      ),
    };
  }
}

/// The notices of a card conflict (design 10.4 step 3), kind and card ID only.
const noticeCardKept = 'id_link_kept';
const noticeCardConflict = 'id_link_conflict';
const _cardNoticeKinds = {noticeCardSuperseded, noticeCardKept, noticeCardConflict};

/// One card as a sentence with an icon (design 10.4 step 1).
class _CardState extends StatelessWidget {
  const _CardState({required this.card, required this.today, required this.onCopy});
  final IdCard card;
  final DateTime today;
  final VoidCallback? onCopy;

  @override
  Widget build(BuildContext context) {
    final since = card.effectiveAt == null ? '' : ' since ${shortDate(card.effectiveAt!, today)}';
    final (icon, tone, sentence) = switch (card.state) {
      IdCardState.pending when card.inReview => (
        LucideIcons.clock,
        ChipTone.info,
        'Sent for admin review. If the new card doesn’t open the chart, make another once this is sorted.',
      ),
      IdCardState.pending => (
        LucideIcons.clock,
        ChipTone.info,
        'Pending: works on this phone now; other phones learn it after this phone syncs',
      ),
      IdCardState.active => (LucideIcons.circleCheck, ChipTone.good, 'Active$since'),
      IdCardState.retired => (LucideIcons.ban, ChipTone.neutral, 'Not valid: another card was made'),
      IdCardState.blocked => (LucideIcons.ban, ChipTone.warning, 'Blocked: make a new card'),
      IdCardState.rejected => (LucideIcons.circleX, ChipTone.critical, 'Not accepted: make a new card'),
    };
    return StatusBanner(
      icon: icon,
      tone: tone,
      text: sentence,
      action: onCopy == null
          ? null
          : FilledButton.icon(onPressed: onCopy, icon: const Icon(LucideIcons.copy), label: const Text('Copy link')),
    );
  }
}

/// Why a new card: a radio group, nothing preselected, and the consequence in words.
class _ReasonSheet extends StatefulWidget {
  const _ReasonSheet({required this.working});
  final int working;

  @override
  State<_ReasonSheet> createState() => _ReasonSheetState();
}

class _ReasonSheetState extends State<_ReasonSheet> {
  String? _reason;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text('Make a new card', style: text.titleLarge)),
            const SizedBox(height: FieldSpace.s2),
            Text(
              widget.working > 1
                  ? 'Both old cards stop working on this phone now, and on every phone after this syncs.'
                  : 'The old card stops working on this phone now, and on every phone after this syncs.',
              style: text.bodyLarge,
            ),
            const SizedBox(height: FieldSpace.s3),
            RadioChips<String>(
              label: 'Why?',
              options: cardReasonLabels,
              selected: _reason,
              onSelected: (v) => setState(() => _reason = v),
            ),
            const SizedBox(height: FieldSpace.s4),
            FilledButton(
              onPressed: _reason == null ? null : () => Navigator.of(context).pop(_reason),
              child: const Text('Make the new card'),
            ),
          ],
        ),
      ),
    );
  }
}
