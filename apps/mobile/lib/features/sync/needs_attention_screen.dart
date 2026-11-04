import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/patient_providers.dart';
import '../../sync/local_store.dart';
import '../patients/patient_labels.dart' show problemStatusText, shortDate;
import '../patients/patient_picker.dart';
import '../patients/patient_widgets.dart' show errorText, todayOf;
import 'sync_labels.dart';

/// Rejected changes and conflicts, until someone resolves them (module 9 "Rejections", Oct 19
/// reconciliation rule), then the notices that need no fix. Nothing here is ever dropped by the app.
/// Titles never hold a value: field and record names only.
class NeedsAttentionScreen extends ConsumerWidget {
  const NeedsAttentionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncControllerProvider);
    final session = ref.watch(sessionProvider);
    final services = ref.watch(patientServicesProvider);
    final me = switch (session.state) {
      Unlocked(:final user) => user.userId,
      _ => null,
    };
    return ListenableBuilder(
      listenable: Listenable.merge([sync, ?services]),
      builder: (context, _) {
        final snapshot = sync.snapshot;
        final items = snapshot.attention;
        final store = sync.store;
        final notices = store?.notices(unreadOnly: true) ?? const <LocalNotice>[];
        final messenger = ScaffoldMessenger.of(context);
        void outOfDate() =>
            messenger.showSnackBar(const SnackBar(content: Text('The other value changed. Check both values again.')));
        final cards = <Widget>[
          for (final e in items)
            if (e.state == ChangeState.conflict && store != null && e.entity == entityProblem && e.field == 'status')
              _ProblemConflictCard(
                entry: e,
                mine: store.myValue(e),
                me: me,
                title: services?.problems.problem(e.recordId)?.title,
                today: todayOf(ref),
                onChoose: snapshot.clock.paused || services == null
                    ? null
                    : (choice) async {
                        final done = switch (choice) {
                          _ProblemChoice.keepResolved => services.problems.keepServer(e.changeId),
                          _ProblemChoice.cameBack =>
                            services.problems.keepServerAndAdd(e.changeId, cameBack: true) != null,
                          _ProblemChoice.mistake =>
                            services.problems.keepServerAndAdd(e.changeId, cameBack: false) != null,
                        };
                        services.changed();
                        if (!done) return outOfDate();
                        await sync.syncNow();
                      },
              )
            else if (e.state == ChangeState.conflict && store != null)
              _ConflictCard(
                entry: e,
                mine: store.myValue(e),
                me: me,
                // A choice writes to the chart, so it waits like the rest of charting.
                onChoose: snapshot.clock.paused
                    ? null
                    : (keepMine) async {
                        if (!await sync.resolveConflict(e.changeId, keepMine: keepMine)) outOfDate();
                      },
              )
            else
              _RejectionCard(entry: e, services: services, paused: snapshot.clock.paused),
          if (snapshot.held > 0)
            Text(
              '${plural(snapshot.held, 'later change waits', 'later changes wait')} until these are resolved.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          if (notices.isNotEmpty) ...[
            Semantics(header: true, child: Text('For your information', style: Theme.of(context).textTheme.titleLarge)),
            for (final n in notices)
              _NoticeCard(
                notice: n,
                onOpen: _opener(context, n, services),
                onDone: () {
                  store!.markNoticeRead(n.id);
                  services?.changed();
                },
              ),
          ],
        ];
        return Scaffold(
          appBar: AppBar(title: const Text('Needs attention')),
          body: items.isEmpty && notices.isEmpty
              ? const Center(
                  child: Padding(padding: EdgeInsets.all(FieldSpace.s4), child: Text('Nothing needs attention.')),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(FieldSpace.s4),
                  itemCount: cards.length,
                  separatorBuilder: (_, _) => const SizedBox(height: FieldSpace.s4),
                  itemBuilder: (context, i) => cards[i],
                ),
        );
      },
    );
  }
}

/// Where a notice's "Open" goes, from this phone's own data: the patient it names, or the problem
/// it names when the phone holds it. Null when the phone has neither.
VoidCallback? _opener(BuildContext context, LocalNotice n, PatientServices? services) {
  if (services == null) return null;
  if (n.patientId case final patient?) return () => unawaited(context.push('/patients/$patient'));
  if (n.kind == 'problem_reversal_decided' && n.recordId != null) {
    final problem = services.problems.problem(n.recordId!);
    if (problem != null) {
      return () => unawaited(context.push('/patients/${problem.patientId}/problems/${problem.id}'));
    }
  }
  return null;
}

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({required this.entry, required this.mine, required this.me, required this.onChoose});
  final OutboxEntry entry;

  /// What the person has in the field now: exactly what "Use my value" sends.
  final Object? mine;
  final String? me;

  /// Null while charting is paused for the clock.
  final Future<void> Function(bool keepMine)? onChoose;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final server = entry.server!;
    final choose = onChoose;
    final who = _who(server, me);
    final when = server.changedAt == null ? '' : ' at ${timeOfDay(context, server.changedAt!)}';
    Widget side(String heading, Object? value) => Expanded(
      child: Semantics(
        container: true,
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
              Text(heading, style: text.labelLarge?.copyWith(color: c.inkMuted)),
              const SizedBox(height: FieldSpace.s1),
              Text(valueText(value), style: text.titleMedium),
            ],
          ),
        ),
      ),
    );
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(fieldLabel(entry.field!), style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Text('This field already had a different value. Choose which one to keep.', style: text.bodyLarge),
          const SizedBox(height: FieldSpace.s3),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                side('Your value', mine),
                const SizedBox(width: FieldSpace.s3),
                side('$who$when', server.value),
              ],
            ),
          ),
          const SizedBox(height: FieldSpace.s3),
          FilledButton(onPressed: choose == null ? null : () => choose(true), child: const Text('Use my value')),
          const SizedBox(height: FieldSpace.s2),
          OutlinedButton(
            onPressed: choose == null ? null : () => choose(false),
            child: Text('Keep ${who == 'On the server' ? 'the server’s' : 'theirs'}'),
          ),
          const SizedBox(height: FieldSpace.s1),
          if (choose == null) ...[
            Text('You can choose once the phone’s clock is right.', style: text.bodyMedium),
            const SizedBox(height: FieldSpace.s1),
          ],
          Text('Both values stay in the record’s history either way.', style: text.bodyMedium),
        ],
      ),
    );
  }
}

String _who(ServerField server, String? me) => server.changedBy == null
    ? 'On the server'
    : server.changedBy == me
    ? 'You, from another phone'
    : 'A teammate';

enum _ProblemChoice { keepResolved, cameBack, mistake }

/// A problem marked Resolved on the server while this phone marked it otherwise (design 9.3).
/// "Use mine" would reverse a Resolved problem, which is a Program Admin's, so the three choices
/// all keep Resolved; two also add a new entry. Each keeps the person's status in the history.
class _ProblemConflictCard extends StatelessWidget {
  const _ProblemConflictCard({
    required this.entry,
    required this.mine,
    required this.me,
    required this.title,
    required this.today,
    required this.onChoose,
  });
  final OutboxEntry entry;
  final Object? mine;
  final String? me;
  final String? title;
  final DateTime today;
  final Future<void> Function(_ProblemChoice choice)? onChoose;

  static String? _status(Object? v) => v is Map<String, Object?> ? v['status'] as String? : null;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final server = entry.server!;
    String when(DateTime? t) => t == null ? '' : ' on ${shortDate(t, today)} at ${timeOfDay(context, t)}';
    final theirs = problemStatusText(_status(server.value) ?? 'resolved');
    final yours = problemStatusText(_status(mine) ?? 'ongoing');
    final who = switch (_who(server, me)) {
      'On the server' => 'Someone',
      final w => w,
    };
    final choose = onChoose;
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(title ?? 'Problem', style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Text(
            '$who marked it $theirs${when(server.changedAt)}. '
            'You marked it $yours on this phone${when(entry.correctedTime ?? entry.deviceTime)}.',
            style: text.bodyLarge,
          ),
          const SizedBox(height: FieldSpace.s3),
          FilledButton(
            onPressed: choose == null ? null : () => unawaited(choose(_ProblemChoice.keepResolved)),
            child: Text('Keep $theirs'),
          ),
          const SizedBox(height: FieldSpace.s2),
          OutlinedButton(
            onPressed: choose == null ? null : () => unawaited(choose(_ProblemChoice.cameBack)),
            child: const Text('It came back: add as a new problem'),
          ),
          const SizedBox(height: FieldSpace.s2),
          OutlinedButton(
            onPressed: choose == null ? null : () => unawaited(choose(_ProblemChoice.mistake)),
            child: const Text('Resolved by mistake: ask an admin'),
          ),
          const SizedBox(height: FieldSpace.s1),
          if (choose == null) ...[
            Text('You can choose once the phone’s clock is right.', style: text.bodyMedium),
            const SizedBox(height: FieldSpace.s1),
          ],
          Text('Your status stays in the problem’s history either way.', style: text.bodyMedium),
        ],
      ),
    );
  }
}

class _RejectionCard extends ConsumerWidget {
  const _RejectionCard({required this.entry, required this.services, required this.paused});
  final OutboxEntry entry;
  final PatientServices? services;
  final bool paused;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final e = entry;
    final problem = e.details?['problem'] as String?;
    final what = e.field != null ? fieldLabel(e.field!) : entityLabel(e.entity);
    final s = services;
    final patientSide = e.entity != entityEncounter && e.entity != entityNote;
    final card = e.entity == entityIdLink && e.op == 'create';
    final attach =
        !card &&
        e.op == 'create' &&
        (problem == 'patient_missing') &&
        const {entityAlias, entityAllergy, entityConsent, entityProblem}.contains(e.entity);
    final messenger = ScaffoldMessenger.of(context);

    Future<void> makeCard() async {
      try {
        final reason = (e.value as Map<String, Object?>?)?['reason'] as String? ?? 'other';
        s!.idLinks.replaceRejected(e.changeId, reason: reason);
        s.changed();
        await ref.read(syncControllerProvider).syncNow();
      } on Exception catch (x) {
        messenger.showSnackBar(SnackBar(content: Text(errorText(x))));
      }
    }

    Future<void> attachTo() async {
      final patientId = await pickPatient(context, s!, today: todayOf(ref));
      if (patientId == null) return;
      try {
        s.patients.attachToPatient(e.changeId, patientId);
        s.changed();
        await ref.read(syncControllerProvider).syncNow();
      } on Exception catch (x) {
        messenger.showSnackBar(SnackBar(content: Text(errorText(x))));
      }
    }

    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(header: true, child: Text(what, style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Text(problemLabel(problem) ?? reasonLabel(e.reason), style: text.titleMedium),
          if (problemLabel(problem) == null && e.message != null) ...[
            const SizedBox(height: FieldSpace.s1),
            Text(e.message!, style: text.bodyLarge),
          ],
          const SizedBox(height: FieldSpace.s1),
          Text(
            patientSide
                ? 'It stays on this phone until it is fixed, with what depends on it.'
                : 'It stays on this phone until it is fixed. Open the record to fix it.',
            style: text.bodyMedium,
          ),
          if (s != null && patientSide) ...[
            const SizedBox(height: FieldSpace.s2),
            Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              children: [
                if (card && s.mayEdit)
                  FilledButton(
                    onPressed: paused ? null : () => unawaited(makeCard()),
                    child: Text(
                      problem == 'patient_merged' ? 'Make a new card from the kept chart' : 'Make a new card',
                    ),
                  ),
                if (attach)
                  FilledButton(onPressed: () => unawaited(attachTo()), child: const Text('Attach to another patient')),
                if (e.patientId != null && !attach)
                  OutlinedButton(
                    onPressed: () => unawaited(context.push('/patients/${e.patientId}')),
                    child: const Text('Open the chart'),
                  ),
              ],
            ),
            if (card && paused) ...[
              const SizedBox(height: FieldSpace.s1),
              Text('Cards can be made once the phone’s clock is right.', style: text.bodyMedium),
            ],
          ],
        ],
      ),
    );
  }
}

class _NoticeCard extends StatelessWidget {
  const _NoticeCard({required this.notice, required this.onOpen, required this.onDone});
  final LocalNotice notice;
  final VoidCallback? onOpen;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) => StatusBanner(
    icon: notice.kind == 'id_link_superseded' ? LucideIcons.idCard : LucideIcons.info,
    tone: notice.kind == 'id_link_superseded' ? ChipTone.warning : ChipTone.info,
    text: noticeLabel(notice.kind, notice.field),
    action: Wrap(
      spacing: FieldSpace.s2,
      runSpacing: FieldSpace.s2,
      children: [
        if (onOpen != null)
          OutlinedButton(
            onPressed: onOpen,
            child: Text(notice.patientId == null ? 'Open the problem' : 'Open the chart'),
          ),
        TextButton(onPressed: onDone, child: const Text('Got it')),
      ],
    ),
  );
}
