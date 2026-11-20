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
import '../../encounters/encounter_repository.dart' show NoteActions;
import '../../encounters/encounter_services.dart';
import '../../forms/definition.dart' show ChoiceDef;
import '../../forms/field_at.dart' show fieldAt;
import '../../forms/forms_api.dart' show NoteTypeVersion;
import '../../patients/patient_providers.dart';
import '../../sync/entities.dart' show entityCorrection, entitySignoff;
import '../../sync/local_store.dart';
import '../encounters/encounter_labels.dart' show encounterErrorText, noteNotOnPhone, openNoteAction;
import '../encounters/encounter_widgets.dart' show encountersOpen, fetchNote;
import '../encounters/note_type_list.dart' show noteLocation;
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
    final watched = ref.watch(patientServicesProvider);
    final watchedEncounters = ref.watch(encounterServicesProvider);
    final me = switch (session.state) {
      Unlocked(:final user) => user.userId,
      _ => null,
    };
    return ListenableBuilder(
      listenable: Listenable.merge([sync, ?watched, ?watchedEncounters]),
      builder: (context, _) {
        final snapshot = sync.snapshot;
        final items = snapshot.attention;
        final store = sync.store;
        // Services whose database a lock or a team switch just closed read nothing.
        final services = watched != null && identical(watched.store, store) ? watched : null;
        final encounters = watchedEncounters != null && encountersOpen(sync, watchedEncounters)
            ? watchedEncounters
            : null;
        final notices = store?.notices(unreadOnly: true) ?? const <LocalNotice>[];
        if (encounters != null) _loadDefinitions(encounters, items);
        final messenger = ScaffoldMessenger.of(context);
        void outOfDate() =>
            messenger.showSnackBar(const SnackBar(content: Text('The other value changed. Check both values again.')));
        // A choice the store refuses (the clock check failed since the card was drawn, or the store
        // froze for a hand-over) says why. The cards don't wait for it, so without this nobody would.
        Future<void> choosing(Future<void> Function() choice) async {
          try {
            await choice();
          } on Exception catch (x) {
            messenger.showSnackBar(SnackBar(content: Text(errorText(x))));
          }
        }

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
                    : (choice) => choosing(() async {
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
                      }),
              )
            else if (e.state == ChangeState.conflict && store != null)
              _ConflictCard(
                entry: e,
                mine: store.myValue(e),
                me: me,
                // A note's answer, named and worded as its form words it, never by its key or its
                // option codes; and Open the note, where the form shows the choice too (review SAX-3).
                words: e.entity == entityNote && encounters != null ? noteAnswerWords(encounters, e) : null,
                onOpenNote: e.entity == entityNote && encounters != null
                    ? () => unawaited(_openNote(context, encounters, e.recordId))
                    : null,
                // A choice writes to the chart, so it waits like the rest of charting.
                onChoose: snapshot.clock.paused
                    ? null
                    : (keepMine) => choosing(() async {
                        if (!await sync.resolveConflict(e.changeId, keepMine: keepMine)) outOfDate();
                      }),
              )
            else
              _RejectionCard(entry: e, services: services, encounters: encounters, paused: snapshot.clock.paused),
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
                onOpenNote: switch (_noteOf(n)) {
                  final note? when encounters != null => () => unawaited(_openNote(context, encounters, note)),
                  _ => null,
                },
                onOpen: _opener(context, n, services),
                // Read here now, and on the server at the next contact.
                onDone: () => services != null ? services.notices.markRead(n.id) : store!.markNoticeRead(n.id),
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

/// The note a notice of a note's life asks the person to open (lifecycle 9.13): the one a
/// `signoff_not_applied` names beside its sign-off (D104), the one `finished_differently` is about.
String? _noteOf(LocalNotice n) => switch (n.kind) {
  noticeSignoffNotApplied => n.noteId,
  noticeFinishedDifferently => n.recordId,
  _ => null,
};

/// **Open the note** (lifecycle 9.13): the note's form, or its read view once finished, fetched
/// first when this phone does not hold it (a second phone, or one a synced sign-out erased; 4.8). It
/// settles nothing: completing it again does.
Future<void> _openNote(BuildContext context, EncounterServices services, String noteId) async {
  final messenger = ScaffoldMessenger.of(context);
  final router = GoRouter.of(context);
  if (!await fetchNote(services, noteId)) {
    messenger.showSnackBar(const SnackBar(content: Text(noteNotOnPhone)));
    return;
  }
  unawaited(router.push(noteLocation(noteId)));
}

/// Where a notice's "Open" goes, from this phone's own data: the patient it names, or the problem
/// it names when the phone holds it. Null when the phone has neither.
VoidCallback? _opener(BuildContext context, LocalNotice n, PatientServices? services) {
  if (services == null) return null;
  if (n.patientId case final patient?) return () => unawaited(context.push('/patients/$patient'));
  if (n.kind == noticeReversalDecided && n.recordId != null) {
    final problem = services.problems.problem(n.recordId!);
    if (problem != null) {
      return () => unawaited(context.push('/patients/${problem.patientId}/problems/${problem.id}'));
    }
  }
  return null;
}

/// The note type and version of the note [e] changes, by the phone's record or the change itself.
NoteTypeVersion? _versionOf(EncounterServices services, OutboxEntry e) {
  final rec = services.store.record(e.recordId);
  final value = e.value is Map<String, Object?> ? e.value! as Map<String, Object?> : const <String, Object?>{};
  final key = rec?.attributes['noteTypeKey'] ?? value['noteTypeKey'];
  final version = rec?.attributes['noteTypeVersion'] ?? value['noteTypeVersion'];
  return key is String && version is int ? (key: key, version: version) : null;
}

/// The note types of the notes [entries] change that the services have not loaded: loaded once for
/// the screen, which then words their answers ([noteAnswerWords]).
final _askedDefinitions = Expando<Set<NoteTypeVersion>>();
void _loadDefinitions(EncounterServices services, Iterable<OutboxEntry> entries) {
  final asked = _askedDefinitions[services] ??= {};
  final missing = {
    for (final e in entries)
      if (e.entity == entityNote)
        if (_versionOf(services, e) case final v? when services.definitions.loaded(v.key, v.version) == null) v,
  }.difference(asked);
  if (missing.isEmpty) return;
  asked.addAll(missing);
  unawaited(services.definitions.loadAll(missing).then((_) => services.changed(), onError: (Object _) {}));
}

/// A note's answer as its form names and words it (lifecycle 9.13; review SAX-3, SFL-1): the answer's
/// label and the note's type ("Current needs, in Social needs"), and a value with each option's label
/// in place of its code. The note's type alone, and the value as stored, for an answer the phone's
/// copy of the definition doesn't name; null while the phone holds no definition of the note.
({String heading, String Function(Object? value) value})? noteAnswerWords(EncounterServices services, OutboxEntry e) {
  final v = _versionOf(services, e);
  final definition = v == null ? null : services.definitions.loaded(v.key, v.version);
  if (definition == null) return null;
  final field = e.field;
  final path = field != null && field.startsWith('data.') ? field.substring('data.'.length) : null;
  final target = path == null ? null : fieldAt(definition, path)?.field;
  String words(Object? value) {
    if (target is ChoiceDef) {
      String label(Object? code) => target.options.where((o) => o.code == code).firstOrNull?.label ?? '$code';
      return switch (value) {
        null || '' => valueText(value),
        final List<Object?> codes => codes.isEmpty ? valueText(null) : codes.map(label).join(', '),
        _ => label(value),
      };
    }
    return value is Map || value is List ? openTheNoteToSee : valueText(value);
  }

  return (heading: target == null ? definition.title : '${target.label}, in ${definition.title}', value: words);
}

/// [noteAnswerWords]' heading, else the change's own field or record words.
String noteAnswerHeading(EncounterServices services, OutboxEntry e) =>
    noteAnswerWords(services, e)?.heading ?? (e.field != null ? fieldLabel(e.field!) : entityLabel(e.entity));

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({
    required this.entry,
    required this.mine,
    required this.me,
    required this.onChoose,
    this.words,
    this.onOpenNote,
  });
  final OutboxEntry entry;

  /// A note's answer named and worded as its form does ([noteAnswerWords]).
  final ({String heading, String Function(Object? value) value})? words;
  final VoidCallback? onOpenNote;

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
              Text(words?.value(value) ?? valueText(value), style: text.titleMedium),
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
          Semantics(header: true, child: Text(words?.heading ?? fieldLabel(entry.field!), style: text.titleLarge)),
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
          if (onOpenNote case final open?) ...[
            const SizedBox(height: FieldSpace.s2),
            OutlinedButton(onPressed: open, child: const Text(openNoteAction)),
          ],
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
  const _RejectionCard({required this.entry, required this.services, required this.encounters, required this.paused});
  final OutboxEntry entry;
  final PatientServices? services;
  final EncounterServices? encounters;
  final bool paused;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    final e = entry;
    final problem = e.details?['problem'] as String?;
    final s = services;
    final n = encounters;
    final patientSide = e.entity != entityEncounter && e.entity != entityNote;
    final what = n != null && e.entity == entityNote
        ? noteAnswerHeading(n, e)
        : e.field != null
        ? fieldLabel(e.field!)
        : entityLabel(e.entity);
    final card = e.entity == entityIdLink && e.op == 'create';
    final attach =
        !card &&
        e.op == 'create' &&
        (problem == 'patient_missing') &&
        const {entityAlias, entityAllergy, entityConsent, entityProblem}.contains(e.entity);
    final messenger = ScaffoldMessenger.of(context);
    // A note's life (lifecycle 9.13): the note a refused sign-off, correction or answer is about.
    final value = e.value is Map<String, Object?> ? e.value! as Map<String, Object?> : const <String, Object?>{};
    final noteId = switch (e.entity) {
      entityNote => e.recordId,
      entitySignoff || entityCorrection => value['noteId'] as String?,
      _ => null,
    };
    final opensNote =
        n != null &&
        noteId != null &&
        problem != 'definition_error' &&
        problem != 'unknown_note_type' &&
        (e.entity != entitySignoff || const {'content_changed', 'incomplete', 'red_flags_first'}.contains(problem));
    // A refused correction: Correct again sends it at the versions now seen; Leave it abandons it,
    // changing nothing, so the refusal settles (3.6, D109). Correct again only where someone else's
    // correction got there first; one that left the note missing something needs other answers.
    final correction = n != null && e.entity == entityCorrection && e.op == 'create';
    final visitId = switch (e.entity) {
      entityEncounter => e.recordId,
      entityNote =>
        value['encounterId'] as String? ?? n?.store.record(e.recordId)?.attributes['encounterId'] as String?,
      _ => null,
    };

    Future<void> settle(Future<void> Function() fix) async {
      try {
        await fix();
        await ref.read(syncControllerProvider).syncNow();
      } on Exception catch (x) {
        messenger.showSnackBar(SnackBar(content: Text(encounterErrorText(x))));
      }
    }

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
          if (opensNote || correction || (n != null && visitId != null && problem == 'unknown_note_type')) ...[
            const SizedBox(height: FieldSpace.s2),
            Wrap(
              spacing: FieldSpace.s2,
              runSpacing: FieldSpace.s2,
              children: [
                if (correction && problem == 'field_changed')
                  FilledButton(
                    onPressed: paused ? null : () => unawaited(settle(() => n.repository.correctAgain(e.changeId))),
                    child: const Text(correctAgainAction),
                  ),
                if (opensNote)
                  OutlinedButton(
                    onPressed: () => unawaited(_openNote(context, n, noteId)),
                    child: const Text(openNoteAction),
                  ),
                if (visitId != null && problem == 'unknown_note_type')
                  OutlinedButton(
                    onPressed: () => unawaited(context.push('/encounters/$visitId/note-types')),
                    child: const Text(chooseNoteTypeAction),
                  ),
                if (correction)
                  OutlinedButton(
                    onPressed: paused ? null : () => unawaited(settle(() => n.repository.leaveIt(e.changeId))),
                    child: const Text(leaveItAction),
                  ),
              ],
            ),
            if (correction && paused) ...[
              const SizedBox(height: FieldSpace.s1),
              Text('You can choose once the phone’s clock is right.', style: text.bodyMedium),
            ],
          ],
          if (s != null && patientSide && !opensNote && !correction) ...[
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
  const _NoticeCard({required this.notice, required this.onOpenNote, required this.onOpen, required this.onDone});
  final LocalNotice notice;

  /// **Open the note**, for a notice of a note's life (lifecycle 9.13).
  final VoidCallback? onOpenNote;
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
        if (onOpenNote != null)
          OutlinedButton(onPressed: onOpenNote, child: const Text(openNoteAction))
        else if (onOpen != null)
          OutlinedButton(
            onPressed: onOpen,
            child: Text(notice.patientId == null ? 'Open the problem' : 'Open the chart'),
          ),
        TextButton(onPressed: onDone, child: const Text('Got it')),
      ],
    ),
  );
}

const correctAgainAction = 'Correct again';

/// A note's answer whose value is more than a few words: the form shows it.
const openTheNoteToSee = 'Open the note to see it';
const leaveItAction = 'Leave it';
const chooseNoteTypeAction = 'Choose a note type';
