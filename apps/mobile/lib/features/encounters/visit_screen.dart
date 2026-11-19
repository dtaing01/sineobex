import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' as wire show RecordSnapshot, VisitRead;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../encounters/credentials.dart' show credentialText;
import '../../encounters/encounter_api.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_repository.dart' hide Expanded;
import '../../encounters/encounter_services.dart';
import '../../encounters/rules.dart' show ReopenEffect;
import '../../encounters/visit_records.dart';
import '../../forms/field_at.dart' show fieldAt;
import '../../forms/read_model.dart' show ReadItem;
import '../../patients/chart_cache.dart' show chartMetaOf, patientGroup;
import '../../sync/local_store.dart' show ChartingPaused, LocalStore, entityEncounter, entityNote, entityPatient;
import '../../sync/sync_controller.dart' show SyncController;
import '../forms/note_read_view.dart';
import '../forms/text_field.dart' show ReadOnlyAnswer;
import '../patients/patient_labels.dart' show isoDay, longDate;
import '../patients/patient_widgets.dart' show SectionHeading, WideButton, confirm, showDone;
import '../sync/sync_labels.dart' show timeOfDay;
import 'addendum_sheet.dart';
import 'correction_sheet.dart';
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'note_type_list.dart' show noteLocation;

/// Where the visit screen of [encounterId] is: UUIDs only (10.2).
String visitLocation(String encounterId) => '/encounters/$encounterId/visit';

/// What the visit screen offers a second person on [visit] (lifecycle 3.7, 9.7, 9.9): **Co-sign** and
/// **Attest**, each null where it is not offered, each with the notes it acts on and those the person
/// may not act on because each holds a part they can't open. The one place the screen decides them:
/// the domain layer's plans today, asked as the server asks it; once the visit read carries the
/// server's own answer for the reader (its can-co-sign and can-attest, and why a waiting note can't be
/// signed by them), it is read here instead.
({SecondActPlan? cosign, SecondActPlan? attest}) secondActOffers(EncounterServices services, VisitView visit) =>
    (cosign: services.api.cosignPlan(visit), attest: services.api.attestPlan(visit));

/// [base], a visit read from the server or a chart (9.7), with what this phone made of it that has not
/// reached the server yet, from the phone's own read [held]: each note's sign-offs, addenda and
/// corrections waiting here, and the visit's own addenda. The server's read has none of them until
/// they are sent, and the phone may hold only part of the visit (what an addendum or a correction
/// brought onto it), so nothing else of [held] is shown: the server's read stays what is read, and
/// what Co-sign and Attest sign.
VisitView withWaiting(VisitView base, VisitView held) {
  List<T> add<T>(List<T> shown, List<T> mine, String Function(T x) id, Sending Function(T x) sending) {
    final ids = {for (final x in shown) id(x)};
    return [
      ...shown,
      for (final x in mine)
        if (sending(x) != Sending.sent && !ids.contains(id(x))) x,
    ];
  }

  final heldNotes = {for (final n in held.notes) n.noteId: n};
  return VisitView(
    encounterId: base.encounterId,
    source: base.source,
    patientId: base.patientId,
    kind: base.kind,
    status: base.status,
    startedAt: base.startedAt,
    clockVerified: base.clockVerified,
    locationText: base.locationText,
    summary: base.summary,
    summaryHidden: base.summaryHidden,
    envelopeLocked: base.envelopeLocked,
    addenda: base.summaryHidden ? base.addenda : add(base.addenda, held.addenda, (a) => a.id, (a) => a.sending),
    notes: [
      for (final n in base.notes)
        if (heldNotes[n.noteId] case final mine?)
          NoteView(
            noteId: n.noteId,
            encounterId: n.encounterId,
            noteTypeKey: n.noteTypeKey,
            noteTypeVersion: n.noteTypeVersion,
            definition: n.definition,
            author: n.author,
            actingAuthor: n.actingAuthor,
            actsAsAuthor: n.actsAsAuthor,
            status: n.status,
            attestation: n.attestation,
            waitingToSend: n.waitingToSend,
            sentForReview: n.sentForReview,
            editable: n.editable,
            answers: n.answers,
            pendingPaths: n.pendingPaths,
            read: n.read,
            recap: n.recap,
            signoffs: add(n.signoffs, mine.signoffs, (s) => s.id, (s) => s.sending),
            addenda: add(n.addenda, mine.addenda, (a) => a.id, (a) => a.sending),
            corrections: add(n.corrections, mine.corrections, (c) => c.id, (c) => c.sending),
            attestations: n.attestations,
            notSynced: n.notSynced,
            title: n.title,
            contentHash: n.contentHash,
            conflicts: n.conflicts,
          )
        else
          n,
    ],
    notSynced: base.notSynced,
    pendingFields: base.pendingFields,
    records: base.records,
  );
}

/// The visit (lifecycle 9.7), opened from the chart's timeline, from Notes to finish or from a queue:
/// read wherever it is (`EncounterApi.openVisit`), the phone's own copy, else the chart's recent visit,
/// else the server's, each read logged before it shows (10.1). From the top:
///
/// - **The envelope**: who it is for, Medical or Non-Medical, when it started ("time not verified"
///   when the phone's clock wasn't checked), the place, the assessment and the visit's own addenda.
/// - **Each note**: its state and its recap, then its sections as the read view lays them out, a
///   corrected answer under its new value struck through with who, when and why; a draft the person
///   may change opens as its form instead. Below it, in time order, its sign-offs, attestations,
///   addenda and corrections.
/// - **The records made at the visit**, whichever chart each is on now, "On another chart now" for
///   one whose visit has moved to someone else (8.4), each opening where it can be entered in error.
/// - **The actions**, each offered only where the domain layer says the server would take it:
///   **Add addendum** below a finished note and on the visit; **Correct** under an answer, for whoever
///   acts as the note's author (the correction sheet); **Reopen**, for a note waiting for a co-signer
///   that was never signed; and, at the end, **Co-sign** and **Attest** with the sentence the person
///   signs, online only ([secondActOffers]). A visit not read from the server is read there first,
///   so what is signed is what was read.
///
/// A visit read from the phone is read again after every change, logging only what a read adds; one
/// read from the server or a chart is read again from the server once what the person added there
/// has been sent (9.7, 8.2), with what still waits on the phone shown beside it ([withWaiting]). The
/// title is fixed and the route carries the visit's ID only (10.2).
class VisitScreen extends StatelessWidget {
  const VisitScreen({super.key, required this.encounterId});
  final String encounterId;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: visitTitle,
    builder: (context, services) => _Visit(services: services, encounterId: encounterId),
  );
}

class _Visit extends ConsumerStatefulWidget {
  const _Visit({required this.services, required this.encounterId});
  final EncounterServices services;
  final String encounterId;

  @override
  ConsumerState<_Visit> createState() => _VisitState();
}

class _VisitState extends ConsumerState<_Visit> with VisitReading<_Visit> {
  /// The visit as the server or a chart read it, when the phone did not hold it at the first read.
  VisitView? _base;

  /// The records made at the visit, for a visit read from the phone (`VisitRecords.madeAt`); a visit
  /// read elsewhere carries the server's ([VisitView.records]).
  List<MadeAtVisit> _madeAt = const [];

  /// The last refusal and where it shows: under a note (its ID), or above a second act (its name).
  ({String at, String message})? _problem;

  /// The second act the visit was read from the server for, until it is done.
  SecondAct? _readFor;
  bool _busy = false;

  late final SyncController _syncing = ref.read(syncControllerProvider);

  @override
  EncounterServices get services => widget.services;
  @override
  String get encounterId => widget.encounterId;

  @override
  Future<VisitView?> readOnce(Set<String> shownBefore) async {
    final base = _base;
    if (base != null) {
      final held = services.store.record(encounterId) == null
          ? null
          : await services.repository.openVisit(encounterId, shownBefore: shownBefore);
      return held == null ? base : withWaiting(base, held);
    }
    final read = await services.api.openVisit(
      encounterId,
      phone: services.repository,
      recent: _recent(services.store, encounterId),
      shownBefore: shownBefore,
    );
    if (read.source == VisitSource.phone) {
      final made = services.visitRecords.madeAt(encounterId, shownBefore: shownBefore);
      shownSoFar.addAll([for (final r in made) r.id]);
      _madeAt = made;
    } else {
      _base = read;
    }
    return read;
  }

  /// Only what the phone holds of the visit is read again at a change: the server is asked when the
  /// screen opens, and again only after the person acted on what it read.
  @override
  bool get rereadsOnChange => services.store.record(encounterId) != null;

  // ---- reading from the server ----

  /// Reads the visit from the server again (5.1): the server logs the read.
  Future<void> _readServer() async {
    final read = await services.api.readVisit(encounterId);
    _base = read;
    await reread();
  }

  /// After the person added to a visit read elsewhere: once a sync has sent it, the server's read
  /// shows it. Offline, what was added shows from the phone, waiting to send.
  Future<void> _afterChange() async {
    await _syncing.syncNow();
    if (!mounted || _base == null) return;
    try {
      await _readServer();
    } on EncounterRequestFailed {
      return;
    } on ChartingPaused {
      return;
    }
  }

  // ---- the actions ----

  void _refused(String at, Object error) {
    if (mounted) setState(() => _problem = (at: at, message: encounterErrorText(error)));
  }

  Future<void> _addAddendum(String? noteId, String to) async {
    setState(() => _problem = null);
    final id = await showAddendumSheet(context, services, encounterId: encounterId, noteId: noteId, to: to);
    if (id != null) unawaited(_afterChange());
  }

  Future<void> _reopen(NoteView note) async {
    setState(() => _problem = null);
    final yes = await confirm(context, title: reopenTitle, body: reopenBody, yes: reopenYes);
    if (!yes || !mounted) return;
    try {
      final effect = await services.repository.reopen(note.noteId);
      // Reopened to be changed: its form opens (9.5).
      if (mounted && effect == ReopenEffect.apply) unawaited(context.push(noteLocation(note.noteId)));
    } on Exception catch (e) {
      _refused(note.noteId, e);
    }
  }

  Future<void> _correct(NoteView note, ReadItem item) async {
    setState(() => _problem = null);
    final NoteView? held;
    try {
      held = await _heldNote(note);
    } on Exception catch (e) {
      return _refused(note.noteId, e);
    }
    if (!mounted) return;
    if (held == null) return setState(() => _problem = (at: note.noteId, message: noteNotOnPhone));
    final id = await showCorrectionSheet(context, services, note: held, path: item.path);
    if (id != null) unawaited(_afterChange());
  }

  /// [note] as this phone holds it, with its answers, so the correction starts from them and from the
  /// versions the person reads (3.6 as built); one that has left the phone is brought from the server
  /// first, with its visit, as the correction itself would bring it (4.8, 8.2). Its read logs only
  /// what the screen has not shown.
  Future<NoteView?> _heldNote(NoteView note) async {
    final store = services.store;
    if (store.record(note.noteId) == null) {
      final open = services.repository.openServerRecord;
      if (open == null) return null;
      if (store.record(encounterId) == null && !await open(entityEncounter, encounterId)) return null;
      if (!await open(entityNote, note.noteId)) return null;
    }
    final held = await services.repository.openNote(note.noteId, shownBefore: {...shownSoFar});
    if (held != null) shownSoFar.addAll(held.shownIds);
    return held;
  }

  /// **Co-sign** or **Attest** (3.7, 5.3, 5.4, 9.9): on a visit not read from the server, the first
  /// tap reads it there, and the person reads it before signing; then one tap acts on every note of
  /// the plan, each with the hash of the note as they read it. A note changed since says so and the
  /// visit is read again.
  Future<void> _act(SecondActPlan plan) async {
    final at = plan.act.name;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      if (plan.readOnline) {
        await _readServer();
        if (mounted) setState(() => _readFor = plan.act);
        return;
      }
      await services.api.secondAct(plan);
      if (!mounted) return;
      showDone(context, plan.act == SecondAct.cosign ? cosignedDone : attestedDone);
      setState(() => _readFor = null);
      unawaited(_syncing.syncNow());
      try {
        await _readServer();
      } on EncounterRequestFailed {
        // Done all the same: the visit shows as it was read until it is read again.
      }
    } on EncounterRequestFailed catch (e) {
      final message = switch (e.problem) {
        EncounterProblem.offline => '${plan.act == SecondAct.cosign ? connectToCosign : connectToAttest}.',
        _ => e.message,
      };
      if (mounted) setState(() => _problem = (at: at, message: message));
      if (e.problem == EncounterProblem.changed) {
        try {
          await _readServer();
        } on Exception {
          // The sentence stays: the person reads the visit again when there is signal.
        }
      }
    } on Exception catch (e) {
      _refused(at, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // ---- drawing ----

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text(visitTitle)),
    body: SafeArea(child: instead() ?? _body(context, visit!)),
  );

  /// A time, as the read view words one, with "time not verified" when it wasn't checked.
  String? _when(DateTime? at, {required bool verified}) =>
      at == null ? null : whenText(longDate(at), timeOfDay(context, at), verified: verified);

  Widget _body(BuildContext context, VisitView visit) {
    final repo = services.repository;
    final offers = secondActOffers(services, visit);
    final cantOpen = {...?offers.cosign?.cannotSeeAll, ...?offers.attest?.cannotSeeAll};
    final cantOpenMessage = (offers.cosign ?? offers.attest)?.cannotSeeAllMessage;
    final visitAddenda = !visit.summaryHidden && (visit.addenda.isNotEmpty || repo.mayAddVisitAddendum(visit));
    final records = _recordRows(visit);
    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        _envelope(context, visit),
        if (!visit.summaryHidden) ...[
          const SectionHeading(assessmentHeading),
          ReadOnlyAnswer(label: assessmentLabel, value: visit.summary, showLabel: false),
        ],
        if (visitAddenda) ...[
          const SectionHeading(visitAddendaHeading),
          for (final a in visit.addenda) ...[_addendum(context, a), const SizedBox(height: FieldSpace.s2)],
          if (repo.mayAddVisitAddendum(visit))
            _SpokenButton(
              label: addAddendumAction,
              spoken: addVisitAddendumSpoken,
              icon: LucideIcons.messageSquarePlus,
              onPressed: () => unawaited(_addAddendum(null, addendumToVisit)),
            ),
        ],
        const SectionHeading(notesHeading),
        for (final note in visit.notes) ...[
          _note(context, note, cantOpen: cantOpen.contains(note.noteId) ? cantOpenMessage : null),
          const SizedBox(height: FieldSpace.s4),
        ],
        if (records.isNotEmpty) ...[
          const SectionHeading(madeAtVisitHeading),
          for (final r in records) ...[r, const SizedBox(height: FieldSpace.s2)],
        ],
        for (final plan in [offers.cosign, offers.attest])
          if (plan != null && plan.notes.isNotEmpty) _secondAct(context, visit, plan),
      ],
    );
  }

  /// Who the visit is for, its kind, when it started and where, read as one heading.
  Widget _envelope(BuildContext context, VisitView visit) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final patient = visit.patientId == null ? noPatientText : visitPatientName(services.store, visit.patientId!);
    final when = _when(visit.startedAt, verified: visit.clockVerified);
    final place = visit.locationText;
    final lines = [visitKindText(visit.kind), if (when != null) startedText(when), if (place != null) whereText(place)];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          container: true,
          header: true,
          label: [patient, ...lines].join(', '),
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(patient, style: text.headlineSmall),
              Text(lines.first, style: text.titleMedium),
              for (final line in lines.skip(1)) Text(line, style: text.bodyLarge?.copyWith(color: c.ink)),
            ],
          ),
        ),
        if (visit.notSynced) ...[
          const SizedBox(height: FieldSpace.s2),
          const StatusChip(label: onThisPhoneOnly, icon: LucideIcons.smartphone, tone: ChipTone.info),
        ],
      ],
    );
  }

  /// A note: its state and recap, then its sections or its form's button, then what hangs off it in
  /// time order, then what may be done to it.
  Widget _note(BuildContext context, NoteView note, {required String? cantOpen}) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final repo = services.repository;
    final title = note.title ?? untitledNote;
    final correct = repo.mayCorrect(note);
    final read = note.read;
    return Container(
      padding: const EdgeInsets.all(FieldSpace.s3),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border.all(color: c.line),
        borderRadius: BorderRadius.circular(FieldRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(title, style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Wrap(
            spacing: FieldSpace.s2,
            runSpacing: FieldSpace.s1,
            children: [
              NoteStateChip(note: note),
              if (note.notSynced)
                const StatusChip(label: onThisPhoneOnly, icon: LucideIcons.smartphone, tone: ChipTone.info),
            ],
          ),
          if (!note.actsAsAuthor) ...[
            const SizedBox(height: FieldSpace.s1),
            Text(byText(note.actingAuthor), style: text.bodyLarge),
          ],
          // The recap (8.1): a line per section with an answer that counts, only what the reader may
          // see, nothing from a sensitive exam.
          if (note.recap.isNotEmpty) ...[
            const SizedBox(height: FieldSpace.s2),
            for (final l in note.recap) Text(l.text, style: text.bodyLarge),
          ],
          const SizedBox(height: FieldSpace.s3),
          if (note.editable)
            _SpokenButton(
              label: openNoteAction,
              spoken: openNoteSpoken(title),
              icon: LucideIcons.squarePen,
              onPressed: () => unawaited(context.push(noteLocation(note.noteId))),
            )
          else if (read != null)
            NoteReadView(
              model: read,
              itemAction: correct ? (item) => _correctButton(note, item, _labelsOf(item)) : null,
            )
          else
            const NoticeMessage(noteFormNotOnPhone),
          if (cantOpen != null) ...[const SizedBox(height: FieldSpace.s3), NoticeMessage(cantOpen)],
          ..._trail(context, note),
          if (_problem case (at: final at, :final message) when at == note.noteId) ...[
            const SizedBox(height: FieldSpace.s3),
            ErrorMessage(message),
          ],
          if (repo.mayAddAddendum(note)) ...[
            const SizedBox(height: FieldSpace.s3),
            _SpokenButton(
              label: addAddendumAction,
              spoken: addAddendumSpoken(title),
              icon: LucideIcons.messageSquarePlus,
              onPressed: () => unawaited(_addAddendum(note.noteId, title)),
            ),
          ],
          if (repo.mayReopen(note.noteId)) ...[
            const SizedBox(height: FieldSpace.s2),
            _SpokenButton(
              label: reopenAction,
              spoken: reopenSpoken(title),
              icon: LucideIcons.undo2,
              onPressed: () => unawaited(_reopen(note)),
            ),
          ],
        ],
      ),
    );
  }

  static String _labelsOf(ReadItem item) => item.labels.join(', ');

  /// **Correct** under an answer, read with the answer's labels.
  Widget _correctButton(NoteView note, ReadItem item, String labels) => Align(
    alignment: AlignmentDirectional.centerStart,
    child: Semantics(
      container: true,
      button: true,
      label: correctSpoken(labels),
      excludeSemantics: true,
      onTap: () => unawaited(_correct(note, item)),
      child: TextButton.icon(
        onPressed: () => unawaited(_correct(note, item)),
        icon: const Icon(LucideIcons.pencil),
        label: const Text(correctAction),
      ),
    ),
  );

  /// What hangs off [note], in the order made (9.7 as built, D108): those the server holds by when
  /// each was made, then those confirmed with no time known yet, then those waiting here.
  List<Widget> _trail(BuildContext context, NoteView note) {
    final entries = <({int rank, DateTime? at, Widget widget})>[];
    int rank(Sending sending, DateTime? at) => sending != Sending.sent ? 2 : (at == null ? 1 : 0);
    for (final s in note.signoffs) {
      entries.add((
        rank: rank(s.sending, s.signedAt),
        at: s.signedAt,
        widget: _TrailEntry(
          line: signoffText(
            act: s.act,
            effect: s.effect,
            who: whoText(s.signer, s.credential == null ? null : credentialText(s.credential!)),
            when: _when(s.signedAt, verified: s.clockVerified),
          ),
          sending: s.sending,
        ),
      ));
      for (final a in note.attestations.where((a) => a.signoffId == s.id)) {
        entries.add((rank: 0, at: a.attestedAt, widget: _attestation(context, a)));
      }
    }
    final signoffIds = {for (final s in note.signoffs) s.id};
    for (final a in note.attestations.where((a) => !signoffIds.contains(a.signoffId))) {
      entries.add((rank: 0, at: a.attestedAt, widget: _attestation(context, a)));
    }
    for (final a in note.addenda) {
      entries.add((rank: rank(a.sending, a.writtenAt), at: a.writtenAt, widget: _addendum(context, a)));
    }
    for (final c in note.corrections) {
      entries.add((
        rank: rank(c.sending, c.correctedAt),
        at: c.correctedAt,
        widget: _TrailEntry(
          line: correctionText(
            outcome: c.outcome,
            requestedByPatient: c.requestedByPatient,
            declined: c.declined,
            who: whoText(c.corrector, c.credential == null ? null : credentialText(c.credential!)),
            when: _when(c.correctedAt, verified: c.clockVerified),
            answers: _answersNamed(note, c.fields),
          ),
          detail: reasonText(c.reason),
          sending: c.sending,
        ),
      ));
    }
    final ordered = [for (final (i, e) in entries.indexed) (i: i, e: e)]
      ..sort((a, b) {
        final byRank = a.e.rank.compareTo(b.e.rank);
        if (byRank != 0) return byRank;
        final at = a.e.at, bt = b.e.at;
        final byTime = at == null || bt == null ? 0 : at.compareTo(bt);
        return byTime != 0 ? byTime : a.i.compareTo(b.i);
      });
    return [
      for (final o in ordered) ...[const SizedBox(height: FieldSpace.s3), o.e.widget],
    ];
  }

  Widget _attestation(BuildContext context, AttestationItem a) => _TrailEntry(
    line: attestedText(who: whoText(a.attending, null), when: _when(a.attestedAt, verified: true)!),
    sending: Sending.sent,
  );

  Widget _addendum(BuildContext context, AddendumItem a) => _TrailEntry(
    line: addendumByText(
      who: whoText(a.author, a.credential == null ? null : credentialText(a.credential!)),
      when: _when(a.writtenAt, verified: a.clockVerified),
    ),
    detail: a.text,
    sending: a.sending,
  );

  /// The answers a correction names (`data.<path>`), by the labels the note's read view gives them,
  /// else their field's own; one this phone can't name is left out rather than shown as a path.
  static List<String> _answersNamed(NoteView note, List<String> fields) {
    final items = readItems(note.read);
    final named = <String>[];
    for (final field in fields) {
      if (!field.startsWith('data.')) continue;
      final path = field.substring('data.'.length);
      final item = items.where((i) => path == i.path || path.startsWith('${i.path}.')).firstOrNull;
      final definition = note.definition;
      final label = item != null
          ? _labelsOf(item)
          : (definition == null ? null : fieldAt(definition, path)?.field?.label);
      if (label != null && !named.contains(label)) named.add(label);
    }
    return named;
  }

  // ---- the records made at the visit (8.4, 9.7) ----

  List<Widget> _recordRows(VisitView visit) {
    final store = services.store;
    if (visit.source == VisitSource.phone) {
      return [
        for (final r in _madeAt)
          switch (r) {
            ReferralMadeAt(:final referral) => _RecordRow(
              text: referralMadeText(_day(referral.referredOn), referral.details),
              onAnotherChart: r.onAnotherChart,
              enteredInError: referral.enteredInError != null,
              onOpen: () => _open('/patients/${referral.patientId}'),
            ),
            ProblemMadeAt(:final problem) => _RecordRow(
              text: problemMadeText(problem.title),
              onAnotherChart: r.onAnotherChart,
              enteredInError: problem.enteredInError != null,
              onOpen: () => _open('/patients/${problem.patientId}/problems/${problem.id}'),
            ),
            AllergyMadeAt(:final allergy, :final patientId) => _RecordRow(
              text: allergyMadeText(allergy.substance),
              onAnotherChart: r.onAnotherChart,
              enteredInError: allergy.enteredInErrorReason != null,
              onOpen: () => _open('/patients/$patientId'),
            ),
            ProblemNoteMadeAt(:final note, :final problemId, :final problemTitle, :final patientId) => _RecordRow(
              text: problemNoteMadeText(problemTitle, note.text),
              onAnotherChart: r.onAnotherChart,
              enteredInError: false,
              onOpen: () => _open('/patients/$patientId/problems/$problemId'),
            ),
          },
      ];
    }
    final group = visit.patientId == null ? const <String>{} : patientGroup(store, visit.patientId!);
    return [for (final r in visit.records) ?_snapshotRow(store, r, visit.records, group)];
  }

  /// A record the server's read gives (`VisitView.records`), as the phone's own are drawn; "On another
  /// chart now" when its patient is not the visit's, as far as the phone knows the visit's merged group.
  Widget? _snapshotRow(LocalStore store, wire.RecordSnapshot r, List<wire.RecordSnapshot> all, Set<String> group) {
    final a = r.attributes;
    final patientId = patientOfMadeAt(r, all, store);
    final moved = patientId != null && !group.contains(store.canonicalPatient(patientId));
    final error = r.fields['enteredInError']?.value != null;
    String? text(Object? v) => v is String ? v : null;
    final (String line, String? location) = switch (r.entity.wire) {
      'referral' => (
        referralMadeText(_day(text(a['referredOn']) ?? ''), text(a['details']) ?? ''),
        patientId == null ? null : '/patients/$patientId',
      ),
      'problem' => (
        problemMadeText(text(a['title']) ?? ''),
        patientId == null ? null : '/patients/$patientId/problems/${r.id}',
      ),
      'patient_allergy' => (
        allergyMadeText(text(a['substance']) ?? ''),
        patientId == null ? null : '/patients/$patientId',
      ),
      'problem_note' => (
        problemNoteMadeText(_problemTitle(store, all, text(a['problemId'])), text(a['text']) ?? ''),
        patientId == null || a['problemId'] is! String ? null : '/patients/$patientId/problems/${a['problemId']}',
      ),
      _ => ('', null),
    };
    if (line.isEmpty) return null;
    return _RecordRow(
      text: line,
      onAnotherChart: moved,
      enteredInError: error,
      onOpen: location == null ? null : () => _open(location),
    );
  }

  static String _problemTitle(LocalStore store, List<wire.RecordSnapshot> all, String? problemId) {
    if (problemId == null) return aProblem;
    for (final r in all) {
      if (r.id == problemId && r.attributes['title'] is String) return r.attributes['title']! as String;
    }
    return store.record(problemId)?.attributes['title'] as String? ?? aProblem;
  }

  static String _day(String iso) => switch (isoDay(iso)) {
    final DateTime d => longDate(d),
    null => iso,
  };

  void _open(String location) => unawaited(context.push(location));

  // ---- Co-sign and Attest ----

  /// The sentence the person signs (3.5) above the button, the button greyed offline (9.7).
  Widget _secondAct(BuildContext context, VisitView visit, SecondActPlan plan) {
    final text = Theme.of(context).textTheme;
    final cosign = plan.act == SecondAct.cosign;
    final action = cosign ? cosignAction : attestAction;
    // A visit read from the server was read with signal; one read here needs it to be read there.
    final offline = plan.readOnline && _syncing.snapshot.offline;
    return Padding(
      padding: const EdgeInsets.only(top: FieldSpace.s5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_readFor == plan.act && plan.canAct) ...[
            NoticeMessage(readThenText(action)),
            const SizedBox(height: FieldSpace.s3),
          ],
          Text(plan.sentence, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: FieldSpace.s3),
          if (_problem case (at: final at, :final message) when at == plan.act.name) ...[
            ErrorMessage(message),
            const SizedBox(height: FieldSpace.s2),
          ],
          WideButton(
            label: offline ? (cosign ? connectToCosign : connectToAttest) : action,
            icon: cosign ? LucideIcons.penLine : LucideIcons.badgeCheck,
            filled: true,
            onPressed: offline || _busy ? null : () => unawaited(_act(plan)),
          ),
        ],
      ),
    );
  }
}

/// The recent visits of the charts the phone keeps (5.2), read lazily: `openVisit` looks among them
/// only when the phone holds no copy of the visit, and stops at the first that is [encounterId].
Iterable<wire.VisitRead> _recent(LocalStore store, String encounterId) sync* {
  for (final id in store.recordIds()) {
    if (store.record(id)?.entity != entityPatient) continue;
    for (final v in chartMetaOf(store, id)?.recentVisits ?? const <wire.VisitRead>[]) {
      if (v.encounterId == encounterId) yield v;
    }
  }
}

/// A sign-off, an attestation, an addendum or a correction below its note: one block for a screen
/// reader, with "Waiting to send" while it waits here and "In Needs attention" once refused.
class _TrailEntry extends StatelessWidget {
  const _TrailEntry({required this.line, required this.sending, this.detail});
  final String line;
  final String? detail;
  final Sending sending;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Semantics(
      container: true,
      child: Container(
        padding: const EdgeInsets.only(left: FieldSpace.s3),
        decoration: BoxDecoration(
          border: Border(left: BorderSide(color: c.lineStrong, width: 2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(line, style: text.bodyLarge),
            if (detail != null) ...[const SizedBox(height: FieldSpace.s1), Text(detail!, style: text.bodyLarge)],
            if (sending != Sending.sent) ...[
              const SizedBox(height: FieldSpace.s1),
              switch (sending) {
                Sending.refused => const StatusChip(
                  label: inNeedsAttention,
                  icon: LucideIcons.circleAlert,
                  tone: ChipTone.warning,
                ),
                _ => const StatusChip(label: waitingToSend, icon: LucideIcons.smartphone, tone: ChipTone.info),
              },
            ],
          ],
        ),
      ),
    );
  }
}

/// A record made at the visit: a button that opens it where it can be entered in error, with "On
/// another chart now" and "Entered in error" in words.
class _RecordRow extends StatelessWidget {
  const _RecordRow({
    required this.text,
    required this.onAnotherChart,
    required this.enteredInError,
    required this.onOpen,
  });
  final String text;
  final bool onAnotherChart;
  final bool enteredInError;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final style = Theme.of(context).textTheme;
    final spoken = [text, if (onAnotherChart) onAnotherChartNow, if (enteredInError) enteredInErrorText].join(', ');
    return Semantics(
      container: true,
      button: onOpen != null,
      label: spoken,
      hint: onOpen == null ? null : recordOpensHint,
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
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(text, style: style.bodyLarge),
                        if (onAnotherChart || enteredInError) ...[
                          const SizedBox(height: FieldSpace.s1),
                          Wrap(
                            spacing: FieldSpace.s2,
                            runSpacing: FieldSpace.s1,
                            children: [
                              if (onAnotherChart)
                                const StatusChip(
                                  label: onAnotherChartNow,
                                  icon: LucideIcons.arrowRightLeft,
                                  tone: ChipTone.warning,
                                ),
                              if (enteredInError)
                                const StatusChip(
                                  label: enteredInErrorText,
                                  icon: LucideIcons.ban,
                                  tone: ChipTone.neutral,
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  if (onOpen != null) ...[
                    const SizedBox(width: FieldSpace.s2),
                    Icon(LucideIcons.chevronRight, color: c.ink),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A wide button whose spoken name says what it acts on, its visible words first.
class _SpokenButton extends StatelessWidget {
  const _SpokenButton({required this.label, required this.spoken, required this.icon, required this.onPressed});
  final String label;
  final String spoken;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    button: true,
    enabled: onPressed != null,
    label: spoken,
    excludeSemantics: true,
    onTap: onPressed,
    child: WideButton(label: label, icon: icon, onPressed: onPressed),
  );
}
