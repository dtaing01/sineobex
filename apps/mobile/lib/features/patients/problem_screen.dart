import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/patient_providers.dart';
import '../../patients/problems.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError;
import 'patient_labels.dart';
import 'patient_screen.dart' show ProblemStatusChip;
import 'patient_widgets.dart';

/// One problem (design 9.1, 12.1): its status in words, only the moves allowed (forward; Resolved
/// asks once), **Still ongoing** to confirm the status at a visit, **Still has this?** on a
/// Resolved problem, the timeline of status changes and notes, and **Add note**.
class ProblemScreen extends StatelessWidget {
  const ProblemScreen({super.key, required this.patientId, required this.problemId});
  final String patientId;
  final String problemId;

  @override
  Widget build(BuildContext context) => PatientsGate(
    title: 'Problem',
    builder: (context, services) => _Problem(services: services, problemId: problemId),
  );
}

class _Problem extends ConsumerStatefulWidget {
  const _Problem({required this.services, required this.problemId});
  final PatientServices services;
  final String problemId;

  @override
  ConsumerState<_Problem> createState() => _ProblemState();
}

class _ProblemState extends ConsumerState<_Problem> {
  final _note = TextEditingController();
  String? _problem;
  String? _done;

  static const _noteMax = 4000;

  PatientServices get _s => widget.services;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  void _do(String done, void Function() change) {
    try {
      change();
      _s.changed();
      setState(() {
        _problem = null;
        _done = done;
      });
    } on LocalValidationError catch (e) {
      setState(() => _problem = e.message);
    } on ChartingPaused catch (e) {
      setState(() => _problem = e.message);
    }
  }

  Future<void> _move(ProblemView p, String to) async {
    if (to == 'resolved') {
      final yes = await confirm(
        context,
        title: 'Mark as Resolved?',
        body: 'It stops counting toward route supplies, and only a Program Admin can undo it.',
        yes: 'Mark as Resolved',
      );
      if (!yes || !mounted) return;
    }
    _do('Status changed to ${problemStatusText(to)}', () => _s.problems.move(p.id, to));
  }

  Future<void> _stillHasThis(ProblemView p) async {
    final cameBack = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(header: true, child: Text('Still has this?', style: Theme.of(context).textTheme.titleLarge)),
              const SizedBox(height: FieldSpace.s2),
              const Text('Either way a new entry is added as New, so care and supplies carry on now.'),
              const SizedBox(height: FieldSpace.s3),
              WideButton(label: 'It came back (a new episode)', onPressed: () => Navigator.of(context).pop(true)),
              const SizedBox(height: FieldSpace.s2),
              WideButton(
                label: 'It never went away (marked Resolved by mistake)',
                onPressed: () => Navigator.of(context).pop(false),
              ),
            ],
          ),
        ),
      ),
    );
    if (cameBack == null || !mounted) return;
    String? added;
    _do(
      cameBack ? 'Added as a new episode' : 'Added, and a Program Admin is asked to check the Resolved one',
      () => added = _s.problems.stillHasThis(p.id, cameBack: cameBack),
    );
    if (added != null && mounted) context.pushReplacement('/patients/${p.patientId}/problems/$added');
  }

  Future<void> _enteredInError(ProblemView p) async {
    final reason = await askReason(
      context,
      title: 'Mark this problem entered in error?',
      body: 'It leaves the problem list and stays in the chart’s history with your reason.',
      action: 'Mark entered in error',
      quick: const ['Wrong patient', 'Typed by mistake', 'Added twice'],
    );
    if (reason == null || !mounted) return;
    _do('Marked entered in error', () => _s.problems.enteredInError(p.id, reason));
    if (_problem == null && mounted) context.pop();
  }

  void _addNote(ProblemView p) {
    _do('Note added', () => _s.problems.addNote(p.id, _note.text));
    if (_problem == null) _note.clear();
  }

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final today = todayOf(ref);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Problem')),
      body: ListenableBuilder(
        listenable: Listenable.merge([sync, _s]),
        builder: (context, _) {
          final p = _s.problems.problem(widget.problemId);
          if (p == null) {
            return const Padding(
              padding: EdgeInsets.all(FieldSpace.s4),
              child: NoticeMessage('This problem isn’t on this phone.'),
            );
          }
          final mayChart = _s.mayChart && p.enteredInError == null;
          final earlier = p.recurrenceOf == null ? null : _s.problems.problem(p.recurrenceOf!);
          final earlierResolved = earlier?.history.where((e) => e.status == 'resolved').firstOrNull?.at;
          return ListView(
            padding: const EdgeInsets.all(FieldSpace.s4),
            children: [
              Semantics(header: true, child: Text(p.title, style: text.headlineSmall)),
              const SizedBox(height: FieldSpace.s2),
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
              const SizedBox(height: FieldSpace.s2),
              Text(
                p.hasCode
                    ? 'Code ${p.code!.code}${p.code!.display == null ? '' : ' · ${p.code!.display}'}'
                    : 'No code: won’t add supplies to route bags',
                style: text.bodyLarge,
              ),
              if (isoDay(p.onsetDate) case final onset?)
                Text('Started ${shortDate(onset, today)}', style: text.bodyLarge),
              if (p.recurrenceOf != null)
                Text(
                  'Came back · earlier episode'
                  '${earlierResolved == null ? '' : ' resolved ${shortDate(earlierResolved, today)}'}',
                  style: text.bodyLarge,
                ),
              if (p.resolvedInErrorOf != null)
                Text('Asked a Program Admin to check the Resolved entry', style: text.bodyLarge),
              if (p.enteredInError != null) ...[
                const SizedBox(height: FieldSpace.s2),
                StatusBanner(
                  icon: LucideIcons.ban,
                  tone: ChipTone.neutral,
                  text: 'Entered in error',
                  detail: p.enteredInError,
                ),
              ],
              if (_problem != null) ...[const SizedBox(height: FieldSpace.s3), ErrorMessage(_problem!)],
              if (_done != null) ...[
                const SizedBox(height: FieldSpace.s2),
                Semantics(liveRegion: true, child: Text(_done!, style: text.bodyLarge)),
              ],

              // ---- status ----
              const SectionHeading('Status'),
              _StatusGroup(
                status: p.status,
                moves: mayChart ? p.moves : const [],
                onMove: (to) => unawaited(_move(p, to)),
              ),
              if (mayChart && p.open) ...[
                const SizedBox(height: FieldSpace.s2),
                WideButton(
                  label: p.status == 'ongoing' ? 'Still ongoing' : 'Still new',
                  icon: LucideIcons.check,
                  onPressed: () => _do('Status confirmed for today', () => _s.problems.confirmStatus(p.id)),
                ),
                if (p.statusCheckedAt != null)
                  Padding(
                    padding: const EdgeInsets.only(top: FieldSpace.s1),
                    child: Text('Last checked ${shortDate(p.statusCheckedAt!, today)}', style: text.bodyMedium),
                  ),
              ],
              if (mayChart && p.status == 'resolved') ...[
                const SizedBox(height: FieldSpace.s2),
                WideButton(label: 'Still has this?', onPressed: () => unawaited(_stillHasThis(p))),
              ],
              if (sync.snapshot.clock.paused && mayChart)
                Padding(
                  padding: const EdgeInsets.only(top: FieldSpace.s2),
                  child: Text('Changes wait until the phone’s clock is right.', style: text.bodyLarge),
                ),

              // ---- notes ----
              const SectionHeading('Add note'),
              if (mayChart) ...[
                ListenableBuilder(
                  listenable: _note,
                  builder: (context, _) {
                    final n = _note.text.length;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        PhiField(
                          name: 'problemNote',
                          label: 'Note',
                          controller: _note,
                          maxLines: 6,
                          minLines: 3,
                          maxLength: _noteMax,
                          capitalization: TextCapitalization.sentences,
                          textInputAction: TextInputAction.newline,
                        ),
                        // The counter is announced only near the limit (design 12.1: at 90%).
                        if (n >= _noteMax * 0.9)
                          Semantics(
                            liveRegion: true,
                            child: Text('${count(n)} of 4,000 characters', style: text.bodyMedium),
                          ),
                        const SizedBox(height: FieldSpace.s2),
                        FilledButton(
                          onPressed: _note.text.trim().isEmpty ? null : () => _addNote(p),
                          child: const Text('Add note'),
                        ),
                      ],
                    );
                  },
                ),
              ] else
                const Text('Your role reads problems; it doesn’t add notes.'),

              // ---- timeline ----
              const SectionHeading('Timeline'),
              _Timeline(problem: p, today: today),

              if (mayChart && p.enteredInError == null) ...[
                const SizedBox(height: FieldSpace.s5),
                WideButton(
                  label: 'Entered in error',
                  icon: LucideIcons.ban,
                  onPressed: () => unawaited(_enteredInError(p)),
                ),
              ],
              const SizedBox(height: FieldSpace.s6),
            ],
          );
        },
      ),
    );
  }
}

/// The status as a radio group: the current one selected, only forward moves enabled.
class _StatusGroup extends StatelessWidget {
  const _StatusGroup({required this.status, required this.moves, required this.onMove});
  final String status;
  final List<String> moves;
  final ValueChanged<String> onMove;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final s in problemStatusLabels.keys)
          if (s == status || moves.contains(s))
            Semantics(
              inMutuallyExclusiveGroup: true,
              checked: s == status,
              enabled: moves.contains(s),
              label: s == status ? '${problemStatusLabels[s]}, current status' : 'Move to ${problemStatusLabels[s]}',
              excludeSemantics: true,
              onTap: moves.contains(s) ? () => onMove(s) : null,
              child: InkWell(
                onTap: moves.contains(s) ? () => onMove(s) : null,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: FieldTap.min),
                  child: Row(
                    children: [
                      Icon(s == status ? LucideIcons.circleDot : LucideIcons.circle, color: c.ink),
                      const SizedBox(width: FieldSpace.s3),
                      Expanded(
                        child: Text(
                          s == status ? '${problemStatusLabels[s]} (now)' : 'Move to ${problemStatusLabels[s]}',
                          style: text.bodyLarge,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
      ],
    );
  }
}

/// Status changes and notes, newest first, dates read in full.
class _Timeline extends StatelessWidget {
  const _Timeline({required this.problem, required this.today});
  final ProblemView problem;
  final DateTime today;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final items = <({DateTime? at, String line, String spoken})>[
      for (final n in problem.notes)
        (
          at: n.writtenAt,
          line:
              '${n.text}\n${n.authorName ?? 'You'} · ${n.writtenAt == null ? 'not synced yet' : shortDate(n.writtenAt!, today)}',
          spoken:
              'Note by ${n.authorName ?? 'you'}, ${n.writtenAt == null ? 'not synced yet' : longDate(n.writtenAt!)}: ${n.text}',
        ),
      for (final e in problem.history)
        (
          at: e.at,
          line:
              '${problemStatusText(e.status)}${e.kind == 'confirmed' ? ' (confirmed)' : ''} · ${e.byName} · '
              '${shortDate(e.at, today)} · ${e.encounterId == null ? 'from the patient profile' : 'at a visit'}',
          spoken:
              '${problemStatusText(e.status)}${e.kind == 'confirmed' ? ', confirmed' : ''}, by ${e.byName}, '
              '${longDate(e.at)}, ${e.encounterId == null ? 'from the patient profile' : 'at a visit'}',
        ),
    ]..sort((a, b) => (b.at ?? DateTime(9999)).compareTo(a.at ?? DateTime(9999)));
    if (items.isEmpty) {
      return Text('Nothing yet. The history shows once the chart is downloaded.', style: text.bodyLarge);
    }
    return Semantics(
      container: true,
      label: 'Timeline, ${items.length} entries',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final i in items)
            Padding(
              padding: const EdgeInsets.only(bottom: FieldSpace.s3),
              child: Semantics(
                label: i.spoken,
                excludeSemantics: true,
                child: Text(i.line, style: text.bodyLarge),
              ),
            ),
        ],
      ),
    );
  }
}
