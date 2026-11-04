import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' show DecideFieldReview, DecideFieldReviewKeep, DuplicateHintStatus, FieldReviewView;
import '../../api/transport.dart' show ApiException, NetworkException;
import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/allergy_badge.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/consent_script.dart';
import '../../patients/display.dart';
import '../../patients/id_links.dart';
import '../../patients/patient_providers.dart';
import '../../patients/patient_repository.dart';
import '../../patients/problems.dart';
import '../../security/secure_copy.dart' show secureCopyLifetime;
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import 'field_review_sheet.dart';
import 'patient_labels.dart';
import 'patient_widgets.dart';

/// A patient's profile (design 12.1): the header read first as one summary, the banners most urgent
/// first, the quick actions, then problems, allergies, street names, consent, the ID card and, when
/// online, history. The app bar never names the patient (the app switcher shows it).
class PatientScreen extends StatelessWidget {
  const PatientScreen({super.key, required this.patientId, this.typed});
  final String patientId;

  /// What the intake had typed when the worker found this chart (8.1, **Add what you typed**).
  final TypedDetails? typed;

  @override
  Widget build(BuildContext context) => PatientsGate(
    title: 'Patient',
    builder: (context, services) => _Profile(services: services, patientId: patientId, typed: typed),
  );
}

class _Profile extends ConsumerStatefulWidget {
  const _Profile({required this.services, required this.patientId, required this.typed});
  final PatientServices services;
  final String patientId;
  final TypedDetails? typed;

  @override
  ConsumerState<_Profile> createState() => _ProfileState();
}

class _ProfileState extends ConsumerState<_Profile> {
  bool _opening = true;
  bool _missing = false;
  String? _problem;
  String? _copied;
  TypedDetails? _typed;
  bool _resolvedOpen = false;

  PatientServices get _s => widget.services;
  String get _id => widget.patientId;

  @override
  void initState() {
    super.initState();
    _typed = widget.typed;
    unawaited(_open());
  }

  /// One audited open (online by the server, offline here); rebuilds only re-read.
  Future<void> _open() async {
    try {
      final view = await _s.patients.open(_id);
      if (!mounted) return;
      setState(() {
        _opening = false;
        _missing = view == null;
      });
    } on ChartingPaused catch (e) {
      if (mounted) {
        setState(() {
          _opening = false;
          _problem = e.message;
        });
      }
    } on ApiException {
      if (mounted) {
        setState(() {
          _opening = false;
          _missing = true;
        });
      }
    }
  }

  Future<void> _run(String done, void Function() change) async {
    try {
      change();
      if (mounted) showDone(context, done);
    } on LocalValidationError catch (e) {
      if (mounted) setState(() => _problem = e.message);
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _problem = e.message);
    }
  }

  Future<void> _copy(PatientView v) async {
    final cards = [
      for (final c in v.workingCards)
        if (c.copyable) c,
    ];
    if (cards.isEmpty) return;
    var card = cards.first;
    if (cards.length > 1) {
      final today = todayOf(ref);
      final chosen = await showDialog<IdCard>(
        context: context,
        builder: (context) => SimpleDialog(
          title: const Text('Copy which card’s link?'),
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: FieldSpace.s5),
              child: Text('Two records were merged, so both cards open this chart.'),
            ),
            for (final c in cards)
              SimpleDialogOption(
                onPressed: () => Navigator.of(context).pop(c),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: FieldTap.min),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(c.effectiveAt == null ? 'Card' : 'Card made ${shortDate(c.effectiveAt!, today)}'),
                  ),
                ),
              ),
          ],
        ),
      );
      if (chosen == null) return;
      card = chosen;
    }
    try {
      final outcome = await _s.idLinks.copy(card.id);
      if (!mounted) return;
      setState(() => _copied = copyOutcomeText(outcome));
    } on ChartingPaused catch (e) {
      if (mounted) setState(() => _copied = e.message);
    }
  }

  Future<void> _addTyped(PatientView v, TypedDetails t) async {
    await _run('Added to the chart', () {
      final have = {for (final a in v.aliases) a.alias.toLowerCase()};
      for (final a in t.aliases) {
        if (!have.contains(a.toLowerCase())) _s.patients.addAlias(_id, a);
      }
      final changes = <String, Object?>{
        if (t.usualArea != null && t.usualArea != v.usualArea && v.editableFields.contains('usualArea'))
          'usualArea': t.usualArea,
        if (t.livingSituation != null && v.editableFields.contains('livingSituation'))
          'livingSituation': t.livingSituation,
      };
      if (changes.isNotEmpty) _s.patients.update(_id, changes);
    });
    if (mounted) setState(() => _typed = null);
  }

  Future<void> _addAlias() async {
    final alias = await showDialog<String>(context: context, builder: (_) => const _AliasDialog());
    if (alias == null || !mounted) return;
    await _run('Street name added', () => _s.patients.addAlias(_id, alias));
  }

  Future<void> _removeAlias(AliasView a) async {
    final reason = await askReason(
      context,
      title: 'Remove “${a.alias}”?',
      body: 'Say why. The street name stays in the chart’s history.',
      action: 'Remove',
      quick: const ['Wrong patient', 'Typed by mistake', 'They don’t use it'],
    );
    if (reason == null || !mounted) return;
    await _run('Street name removed', () => _s.patients.removeAlias(a.id!, reason));
  }

  Future<void> _addAllergy() async {
    final allergy = await showModalBottomSheet<NewAllergy>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _AllergySheet(),
    );
    if (allergy == null || !mounted) return;
    await _run('Allergy added', () => _s.patients.addAllergy(_id, allergy));
  }

  Future<void> _allergyInError(AllergyView a) async {
    final reason = await askReason(
      context,
      title: 'Mark “${a.substance}” entered in error?',
      body: 'It leaves the allergy badge and stays in the chart’s history with your reason.',
      action: 'Mark entered in error',
      quick: const ['Wrong patient', 'Typed by mistake', 'Not an allergy'],
    );
    if (reason == null || !mounted) return;
    await _run('Marked entered in error', () => _s.patients.allergyEnteredInError(a.id, reason));
  }

  Future<void> _recordConsent() async {
    final answer = await showDialog<ConsentAnswer>(context: context, builder: (_) => const _ConsentDialog());
    if (answer == null || !mounted) return;
    await _run('Consent recorded', () => _s.patients.recordConsent(_id, answer));
  }

  Future<void> _chooseReview(FieldReviewView review, {required bool online}) async {
    final api = _s.charts.api;
    final decided = await showFieldReviewSheet(
      context,
      review: review,
      mayDecide: _s.mayEdit,
      online: online,
      today: todayOf(ref),
      onSave: (keep, historyId) async {
        await api.decideFieldReview(
          reviewId: review.id,
          body: DecideFieldReview(
            keep: keep ? DecideFieldReviewKeep.current : DecideFieldReviewKeep.alternate,
            historyId: historyId,
            baseVersion: review.current.version,
          ),
        );
      },
    );
    if (decided == true && mounted) {
      showDone(context, 'Choice saved');
      unawaited(_open());
    }
  }

  Future<void> _history(PatientView v) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HistorySheet(services: _s, patientId: v.canonicalId, today: todayOf(ref)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final session = ref.watch(sessionProvider);
    final teamName = switch (session.state) {
      Unlocked(:final user) => user.team?.name,
      _ => null,
    };
    return Scaffold(
      appBar: AppBar(title: const Text('Patient')),
      body: ListenableBuilder(
        listenable: Listenable.merge([sync, _s]),
        builder: (context, _) {
          final view = _opening || _missing ? null : _s.patients.read(_id);
          if (_opening && view == null) return const Center(child: CircularProgressIndicator());
          if (view == null) {
            return Padding(
              padding: const EdgeInsets.all(FieldSpace.s4),
              child: _problem != null
                  ? ErrorMessage(_problem!)
                  : const NoticeMessage(
                      'This patient isn’t on this phone. Search again when the phone is back online.',
                    ),
            );
          }
          return _body(context, view, sync.snapshot.offline, sync.snapshot.clock.paused, teamName);
        },
      ),
    );
  }

  Widget _body(BuildContext context, PatientView v, bool offline, bool paused, String? teamName) {
    final today = todayOf(ref);
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final merged = v.mergedInto != null;
    final mayEdit = _s.mayEdit && !merged;
    final mayChart = _s.mayChart && !merged;
    final legal = v.legalName;
    final legalText = legal == null ? null : [legal.given, legal.family].nonNulls.join(' ').trim();
    final name = v.preferredName ?? (legalText?.isNotEmpty ?? false ? legalText : null) ?? v.visualDescriptor ?? 'No name recorded';
    final birth = v.birth == null ? null : birthLabel(v.birth!, today);
    final seen = isoDay(v.lastSeenOn);
    final summary = [
      name,
      if (birth != null) birth.spoken,
      v.badge.spoken.replaceFirst('Allergies:', 'allergies:').replaceFirst('Allergy:', 'allergy:'),
    ].join(', ');
    final reviewsByField = {for (final r in v.reviews) r.field: r};
    final copyable = v.workingCards.where((c) => c.copyable).toList();
    final problems = v.problems;

    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        // ---- header ----
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Phase 8 adds the photo; an empty slot is never read out.
            ExcludeSemantics(
              child: Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(color: c.surfaceSunken, borderRadius: BorderRadius.circular(FieldRadius.md)),
                child: Icon(LucideIcons.user, color: c.inkMuted),
              ),
            ),
            const SizedBox(width: FieldSpace.s3),
            Expanded(
              child: Semantics(
                header: true,
                label: summary,
                excludeSemantics: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: text.headlineSmall),
                    if (birth != null) Text(birth.text, style: text.bodyLarge),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: FieldSpace.s2),
        AllergyBadgeView(badge: v.badge),
        const SizedBox(height: FieldSpace.s2),
        if (legalText != null && legalText.isNotEmpty && legalText != name)
          Text('Legal name: $legalText', style: text.bodyLarge),
        if (v.visualDescriptor != null && v.visualDescriptor != name) Text(v.visualDescriptor!, style: text.bodyLarge),
        if (v.usualArea != null) Text('Usually found: ${v.usualArea}', style: text.bodyLarge),
        if (v.copy != ChartCopy.partial) Text('Living situation: ${livingSituationText(v.livingSituation)}', style: text.bodyLarge),
        if (v.preferredLanguage != null) Text('Language: ${languageText(v.preferredLanguage)}', style: text.bodyLarge),
        if (teamName != null) Text('Team: $teamName', style: text.bodyMedium?.copyWith(color: c.inkMuted)),
        if (seen != null) Text('Last seen ${shortDate(seen, today)}', style: text.bodyMedium?.copyWith(color: c.inkMuted)),
        const SizedBox(height: FieldSpace.s3),

        // ---- banners, most urgent first ----
        if (v.mergedInto case final m?) ...[
          StatusBanner(
            icon: LucideIcons.merge,
            tone: ChipTone.warning,
            text:
                'This chart was merged into another${m.mergedAt == null ? '' : ' on ${shortDate(m.mergedAt!, today)}'}. '
                'Open the combined chart.',
            action: OutlinedButton(
              onPressed: () => context.pushReplacement('/patients/${v.canonicalId}'),
              child: const Text('Open the combined chart'),
            ),
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (v.consentNotRecorded) ...[
          StatusBanner(
            icon: LucideIcons.circleAlert,
            tone: ChipTone.critical,
            text: 'Consent not recorded yet. Ask at the next visit.',
            action: mayEdit
                ? OutlinedButton(onPressed: () => unawaited(_recordConsent()), child: const Text('Record consent now'))
                : null,
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (v.duplicate case final d?) ...[
          StatusBanner(
            icon: LucideIcons.users,
            tone: ChipTone.warning,
            text: 'Possible duplicate under review',
            detail: d.status == DuplicateHintStatus.notSure && d.note != null ? 'Reviewer’s note: ${d.note}' : null,
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        for (final field in v.reviewFields) ...[
          StatusBanner(
            icon: LucideIcons.listChecks,
            tone: ChipTone.info,
            text: 'Two values for ${patientFieldLabels[field] ?? field}',
            detail: reviewsByField[field] == null
                ? 'Someone who knows this person will choose. The values show with the full chart.'
                : null,
            action: reviewsByField[field] == null
                ? null
                : OutlinedButton(
                    onPressed: () => unawaited(_chooseReview(reviewsByField[field]!, online: !offline)),
                    child: Semantics(
                      label: 'Choose the value for ${patientFieldLabels[field] ?? field}',
                      excludeSemantics: true,
                      child: const Text('Choose'),
                    ),
                  ),
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (v.copy == ChartCopy.partial) ...[
          const StatusBanner(
            icon: LucideIcons.cloudOff,
            tone: ChipTone.info,
            text: 'List only: the full chart opens when the phone reconnects.',
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (v.downloadFailed) ...[
          const StatusBanner(
            icon: LucideIcons.cloudOff,
            tone: ChipTone.warning,
            text: 'Part of this chart hasn’t downloaded yet.',
          ),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (v.notSynced) ...[
          const StatusBanner(icon: LucideIcons.smartphone, tone: ChipTone.info, text: 'Not synced yet'),
          const SizedBox(height: FieldSpace.s2),
        ],
        if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s2)],
        if (_typed case final t? when mayEdit) ...[
          StatusBanner(
            icon: LucideIcons.squarePen,
            tone: ChipTone.info,
            text: 'Add what you typed?',
            detail: [
              if (t.aliases.isNotEmpty) 'Street names: ${t.aliases.join(', ')}',
              if (t.usualArea != null) 'Usually found: ${t.usualArea}',
              if (t.livingSituation != null)
                'Living situation: ${livingSituationText((kind: t.livingSituation!['kind']! as String, other: t.livingSituation!['other'] as String?))}',
            ].join('\n'),
            action: Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              children: [
                FilledButton(onPressed: () => unawaited(_addTyped(v, t)), child: const Text('Add what you typed')),
                OutlinedButton(onPressed: () => setState(() => _typed = null), child: const Text('Not now')),
              ],
            ),
          ),
          const SizedBox(height: FieldSpace.s2),
        ],

        // ---- quick actions ----
        Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s2,
          children: [
            if (copyable.isNotEmpty && _s.mayEdit)
              FilledButton.icon(
                onPressed: () => unawaited(_copy(v)),
                icon: const Icon(LucideIcons.copy),
                label: const Text('Copy ID link'),
              ),
            if (mayEdit)
              OutlinedButton.icon(
                onPressed: () => unawaited(context.push('/patients/${v.patientId}/edit')),
                icon: const Icon(LucideIcons.pencil),
                label: const Text('Edit'),
              ),
          ],
        ),
        if (_copied != null) ...[
          const SizedBox(height: FieldSpace.s2),
          Semantics(liveRegion: true, child: Text(_copied!, style: text.bodyLarge)),
        ],

        // ---- problems ----
        if (_s.seesProblems) ...[
          SectionHeading(
            'Problems',
            trailing: mayChart && problems != null
                ? TextButton.icon(
                    onPressed: () => unawaited(context.push('/patients/${v.canonicalId}/problems/new')),
                    icon: const Icon(LucideIcons.plus),
                    label: const Text('Add problem'),
                  )
                : null,
          ),
          if (problems == null)
            const Text('The problem list opens with the full chart.')
          else ...[
            if (!problems.any((p) => p.open)) const Text('No open problems.'),
            for (final p in problems.where((p) => p.open)) _ProblemRow(problem: p, patientId: v.canonicalId),
            if (problems.any((p) => !p.open))
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                initiallyExpanded: _resolvedOpen,
                onExpansionChanged: (open) => _resolvedOpen = open,
                title: Text('Resolved (${problems.where((p) => !p.open).length})', style: text.titleMedium),
                children: [
                  for (final p in problems.where((p) => !p.open)) _ProblemRow(problem: p, patientId: v.canonicalId),
                ],
              ),
          ],
        ],

        // ---- allergies ----
        SectionHeading(
          'Allergies',
          trailing: mayEdit
              ? TextButton.icon(
                  onPressed: () => unawaited(_addAllergy()),
                  icon: const Icon(LucideIcons.plus),
                  label: const Text('Add allergy'),
                )
              : null,
        ),
        if (v.allergies.isEmpty) Text(v.badge.text, style: text.bodyLarge),
        for (final a in v.allergies)
          _Line(
            text: [
              a.substance,
              if (a.category != null) allergyCategoryLabels[a.category],
              if (a.severity != null) allergySeverityLabels[a.severity],
              ?a.reaction,
            ].join(' · '),
            detail: !a.active
                ? 'Entered in error${a.enteredInErrorReason == null ? '' : ': ${a.enteredInErrorReason}'}'
                : (a.pending ? 'Not synced yet' : null),
            muted: !a.active,
            action: a.active && mayChart && v.copy != ChartCopy.partial
                ? TextButton(
                    onPressed: () => unawaited(_allergyInError(a)),
                    child: Semantics(
                      label: 'Mark allergy ${a.substance} entered in error',
                      excludeSemantics: true,
                      child: const Text('Entered in error'),
                    ),
                  )
                : null,
          ),

        // ---- street names ----
        SectionHeading(
          'Street names',
          trailing: mayEdit
              ? TextButton.icon(
                  onPressed: () => unawaited(_addAlias()),
                  icon: const Icon(LucideIcons.plus),
                  label: const Text('Add street name'),
                )
              : null,
        ),
        if (v.aliases.isEmpty) const Text('None recorded.'),
        for (final a in v.aliases)
          _Line(
            text: a.alias,
            detail: !a.active
                ? 'Removed${a.removedReason == null ? '' : ': ${a.removedReason}'}'
                : a.mergedName
                ? 'Name on a merged record'
                : (a.pending ? 'Not synced yet' : null),
            muted: !a.active,
            action: a.active && !a.mergedName && mayEdit
                ? TextButton(
                    onPressed: () => unawaited(_removeAlias(a)),
                    child: Semantics(label: 'Remove street name ${a.alias}', excludeSemantics: true, child: const Text('Remove')),
                  )
                : null,
          ),

        // ---- consent ----
        const SectionHeading('Consent'),
        if (v.consents.isEmpty) const Text('No consent decisions on this phone.'),
        for (final r in v.consents)
          _Line(
            text: consentText(r.kind, r.decision),
            detail: [
              if (r.recordedAt != null) shortDate(r.recordedAt!, today),
              ?r.recordedByName,
              if (r.pending) 'not synced yet',
            ].join(' · '),
          ),

        // ---- ID card ----
        const SectionHeading('Street Medicine ID card'),
        Text(cardSummary(v, today, paused: paused), style: text.bodyLarge),
        const SizedBox(height: FieldSpace.s2),
        WideButton(
          label: 'Open ID card',
          icon: LucideIcons.idCard,
          onPressed: () => unawaited(context.push('/patients/${v.canonicalId}/card')),
        ),

        // ---- history, online ----
        const SectionHeading('History'),
        if (offline)
          const Text('History shows when the phone is online.')
        else
          WideButton(label: 'Show what changed', icon: LucideIcons.history, onPressed: () => unawaited(_history(v))),
        const SizedBox(height: FieldSpace.s6),
      ],
    );
  }
}

/// The ID card line on the profile: what the card screen leads with.
String cardSummary(PatientView v, DateTime today, {required bool paused}) {
  final working = v.workingCards;
  if (working.length > 1) return '${working.length} cards open this chart (two records were merged).';
  if (working.length == 1) {
    final card = working.single;
    if (card.state == IdCardState.pending) return 'Pending: works on this phone now.';
    return card.effectiveAt == null ? 'Active' : 'Active since ${shortDate(card.effectiveAt!, today)}';
  }
  if (v.cardWanted) return 'Make the card once the phone’s clock is right.';
  if (v.idCardChoice == 'declined') return 'Declined a card.';
  return 'No card yet.';
}

/// What a Copy link outcome says, as a fixed sentence.
String copyOutcomeText(CopyOutcome o) => switch (o) {
  CopyOutcome.copied => 'Link copied. It clears in ${secureCopyLifetime.inSeconds} seconds.',
  CopyOutcome.failed => 'The link couldn’t be copied. Try again.',
  CopyOutcome.notCopyable => 'This card’s link isn’t on this phone.',
  CopyOutcome.unknownBase => 'The phone doesn’t know the card address yet. Connect once, then try again.',
};

class _ProblemRow extends StatelessWidget {
  const _ProblemRow({required this.problem, required this.patientId});
  final ProblemView problem;
  final String patientId;

  @override
  Widget build(BuildContext context) {
    final p = problem;
    final text = Theme.of(context).textTheme;
    final status = problemStatusText(p.status);
    final label = [
      p.title,
      status,
      if (p.hasCode) 'code ${p.code!.code}' else 'No code: won’t add supplies to route bags',
      if (p.sensitive) 'sensitive',
      if (p.notSynced) 'not synced yet',
    ].join(', ');
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: InkWell(
        onTap: () => unawaited(context.push('/patients/$patientId/problems/${p.id}')),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: FieldTap.min),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: FieldSpace.s2),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.title, style: text.titleMedium),
                const SizedBox(height: FieldSpace.s1),
                Wrap(
                  spacing: FieldSpace.s2,
                  runSpacing: FieldSpace.s1,
                  children: [
                    ProblemStatusChip(status: p.status),
                    if (p.sensitive) const StatusChip(label: 'Sensitive', icon: LucideIcons.lock),
                    if (p.notSynced || p.statusPending)
                      const StatusChip(label: 'Not synced yet', icon: LucideIcons.smartphone, tone: ChipTone.info),
                  ],
                ),
                const SizedBox(height: FieldSpace.s1),
                Text(
                  p.hasCode ? 'Code ${p.code!.code}' : 'No code: won’t add supplies to route bags',
                  style: text.bodyMedium,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A problem's status in words with its own icon.
class ProblemStatusChip extends StatelessWidget {
  const ProblemStatusChip({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) => StatusChip(
    label: problemStatusText(status),
    icon: switch (status) {
      'new' => LucideIcons.circleDot,
      'ongoing' => LucideIcons.refreshCw,
      _ => LucideIcons.circleCheck,
    },
    tone: switch (status) {
      'new' => ChipTone.warning,
      'ongoing' => ChipTone.info,
      _ => ChipTone.good,
    },
  );
}

/// A line of a profile list, with an optional action.
class _Line extends StatelessWidget {
  const _Line({required this.text, this.detail, this.action, this.muted = false});
  final String text;
  final String? detail;
  final Widget? action;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final c = context.field;
    return Padding(
      padding: const EdgeInsets.only(bottom: FieldSpace.s2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: MergeSemantics(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text,
                    style: t.bodyLarge?.copyWith(
                      decoration: muted ? TextDecoration.lineThrough : null,
                      color: muted ? c.inkMuted : c.ink,
                    ),
                  ),
                  if (detail != null && detail!.isNotEmpty) Text(detail!, style: t.bodyMedium?.copyWith(color: c.inkMuted)),
                ],
              ),
            ),
          ),
          ?action,
        ],
      ),
    );
  }
}

class _AliasDialog extends StatefulWidget {
  const _AliasDialog();
  @override
  State<_AliasDialog> createState() => _AliasDialogState();
}

class _AliasDialogState extends State<_AliasDialog> {
  final _alias = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _alias.dispose();
    super.dispose();
  }

  void _submit() {
    final a = _alias.text.trim();
    if (a.isEmpty || a.length > 60) {
      setState(() => _error = 'A street name is 1 to 60 characters.');
      return;
    }
    Navigator.of(context).pop(a);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add a street name'),
    content: PhiField(
      name: 'newAlias',
      label: 'Street name',
      controller: _alias,
      error: _error,
      textInputAction: TextInputAction.done,
      onSubmitted: (_) => _submit(),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(onPressed: _submit, child: const Text('Add')),
    ],
  );
}

class _AllergySheet extends StatefulWidget {
  const _AllergySheet();
  @override
  State<_AllergySheet> createState() => _AllergySheetState();
}

class _AllergySheetState extends State<_AllergySheet> {
  final _substance = TextEditingController();
  final _reaction = TextEditingController();
  String? _category;
  String? _severity;
  String? _error;

  @override
  void dispose() {
    _substance.dispose();
    _reaction.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        FieldSpace.s4,
        0,
        FieldSpace.s4,
        FieldSpace.s4 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text('Add allergy', style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: FieldSpace.s3),
          PhiField(name: 'allergySubstance', label: 'Allergic to', controller: _substance, error: _error),
          const SizedBox(height: FieldSpace.s3),
          RadioChips<String>(
            label: 'Kind',
            options: allergyCategoryLabels,
            selected: _category,
            onSelected: (v) => setState(() => _category = v),
          ),
          const SizedBox(height: FieldSpace.s3),
          RadioChips<String>(
            label: 'How bad',
            options: allergySeverityLabels,
            selected: _severity,
            onSelected: (v) => setState(() => _severity = v),
          ),
          const SizedBox(height: FieldSpace.s3),
          PhiField(
            name: 'allergyReaction',
            label: 'Reaction (optional)',
            controller: _reaction,
            maxLength: 200,
            capitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: FieldSpace.s3),
          FilledButton(
            onPressed: () {
              if (_substance.text.trim().isEmpty) {
                setState(() => _error = 'Name the allergy.');
                return;
              }
              Navigator.of(context).pop(
                NewAllergy(
                  substance: _substance.text.trim(),
                  category: _category,
                  severity: _severity,
                  reaction: _reaction.text.trim().isEmpty ? null : _reaction.text.trim(),
                ),
              );
            },
            child: const Text('Add allergy'),
          ),
        ],
      ),
    ),
  );
}

/// **Record consent now** (11.2): a later care-and-record decision.
class _ConsentDialog extends StatefulWidget {
  const _ConsentDialog();
  @override
  State<_ConsentDialog> createState() => _ConsentDialogState();
}

class _ConsentDialogState extends State<_ConsentDialog> {
  bool? _agrees;
  UnableReason? _reason;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Record consent'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('“${consentScriptFor('en').text}”'),
          const SizedBox(height: FieldSpace.s3),
          RadioChips<bool>(
            label: 'Do they agree?',
            options: const {true: 'Agrees', false: 'Still unable'},
            selected: _agrees,
            onSelected: (v) => setState(() => _agrees = v),
          ),
          if (_agrees == false) ...[
            const SizedBox(height: FieldSpace.s3),
            RadioChips<UnableReason>(
              label: 'Why not now?',
              options: {for (final r in UnableReason.values) r: r.label},
              selected: _reason,
              onSelected: (v) => setState(() => _reason = v),
            ),
          ],
        ],
      ),
    ),
    actions: [
      TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
      FilledButton(
        onPressed: _agrees == true || (_agrees == false && _reason != null)
            ? () => Navigator.of(context).pop(
                _agrees! ? const ConsentAnswer.given() : ConsentAnswer.unable(_reason!.label),
              )
            : null,
        child: const Text('Save'),
      ),
    ],
  );
}

/// Every change to the chart's fields, from the server (design 11.7). Online only.
class _HistorySheet extends StatefulWidget {
  const _HistorySheet({required this.services, required this.patientId, required this.today});
  final PatientServices services;
  final String patientId;
  final DateTime today;

  @override
  State<_HistorySheet> createState() => _HistorySheetState();
}

class _HistorySheetState extends State<_HistorySheet> {
  late final Future<List<String>> _lines = _load();

  Future<List<String>> _load() async {
    final page = await widget.services.charts.api.getPatientHistory(patientId: widget.patientId);
    return [
      for (final e in page.entries)
        [
          '${patientFieldLabels[e.field] ?? e.field}: '
              '${patientValueText(e.field, e.previousValue, widget.today)} → '
              '${patientValueText(e.field, e.value, widget.today)}',
          e.changedBy.displayName,
          shortDate(e.recordedAt, widget.today),
          if (e.deviceTime != null) 'on a phone',
        ].join(' · '),
    ];
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
      child: FutureBuilder<List<String>>(
        future: _lines,
        builder: (context, snap) {
          final text = Theme.of(context).textTheme;
          return ListView(
            shrinkWrap: true,
            children: [
              Semantics(header: true, child: Text('What changed', style: text.titleLarge)),
              const SizedBox(height: FieldSpace.s3),
              if (snap.connectionState != ConnectionState.done)
                const Center(child: CircularProgressIndicator())
              else if (snap.hasError)
                ErrorMessage(
                  snap.error is NetworkException
                      ? 'History needs a connection. Try again when the phone is online.'
                      : 'History couldn’t be loaded. Try again.',
                )
              else if (snap.data!.isEmpty)
                const Text('No changes recorded yet.')
              else
                for (final l in snap.data!)
                  Padding(padding: const EdgeInsets.only(bottom: FieldSpace.s2), child: Text(l, style: text.bodyLarge)),
            ],
          );
        },
      ),
    ),
  );
}
