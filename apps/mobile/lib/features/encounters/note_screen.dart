import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart';
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_repository.dart' hide Expanded;
import '../../encounters/encounter_services.dart';
import '../../forms/answer_state.dart';
import '../../forms/definition.dart';
import '../../forms/field_at.dart' show fieldAt;
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError, entityEncounter;
import '../../sync/sync_controller.dart' show SyncController;
import '../forms/note_form.dart';
import '../forms/note_read_view.dart';
import '../forms/problem_field.dart';
import '../patients/patient_widgets.dart' show FrozenNotice, WideButton, showDone;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'note_type_list.dart' show noteLocation;
import 'referrals_sheet.dart';

/// A note of a visit (lifecycle 9.5): the frame around the forms part's renderer. The header names
/// the patient by their preferred name, with phase 3's allergy badge, and the note's type and state.
/// A draft the person may change is its form ([NoteForm]), every answer saved as it is entered
/// (`saveAnswer`) and the form drawn again with the answers the store then holds; what waits to send
/// and what two people changed show on their fields, a choice on a conflict made in the store and
/// followed by a sync. **Save & Close** and **Continue** (to the summary, 9.6) sit at the bottom. A
/// finished note opens read-only, as its read view (9.7); a draft the person may read but not change
/// now, as the form with nothing to change.
///
/// The form's actions (forms 6, F7): `open_note_type` adds or opens a note of that type in the visit
/// (`addNote`; the Red flags note through `addRedFlagsNote`, a teammate's finished one opening
/// read-only); `add_referral` adds a referral made at the visit; `show_handoff` opens the EMS handoff.
/// Expand on a quick note's part (forms 6.4) and **Add to the problem list** under a diagnosis
/// (lifecycle 8.3) are the domain layer's, offered as it says.
///
/// Read from the phone's copy (`openNote`), each read logged in its own transaction (10.1) and only
/// what a read adds logged again; the note and its visit stay on the phone while it shows (8.2). The
/// route carries the note's ID only, and the title is fixed (10.2).
class NoteScreen extends StatelessWidget {
  const NoteScreen({super.key, required this.noteId, this.openSection});
  final String noteId;

  /// The section to open: the summary's jump to what stops Complete (9.6).
  final String? openSection;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: noteTitle,
    builder: (context, services) => _Note(services: services, noteId: noteId, openSection: openSection),
  );
}

class _Note extends ConsumerStatefulWidget {
  const _Note({required this.services, required this.noteId, required this.openSection});
  final EncounterServices services;
  final String noteId;
  final String? openSection;

  @override
  ConsumerState<_Note> createState() => _NoteState();
}

class _NoteState extends ConsumerState<_Note> {
  NoteView? _note;
  bool _opening = true;
  String? _readRefused;

  /// The team's listed note types, for the actions and Expand.
  List<NoteTypeDef> _listed = const [];

  /// Expand's offers on each part of a quick note, by section, worked out after each read.
  Map<String, List<ExpandOffer>> _offers = const {};

  /// What the domain layer last refused, in its words.
  String? _problem;

  /// Drawn again from what the store holds after a refused answer: the form keeps what was last
  /// tapped or typed until then, and that answer was not saved.
  int _generation = 0;
  String? _reopen;

  final _shown = <String>{};
  int _seq = 0;
  late final SyncController _sync;
  ModalRoute<Object?>? _route;
  bool _stale = false;
  String? _visitShown;

  EncounterServices get _s => widget.services;
  EncounterRepository get _repo => _s.repository;

  /// Online, whether the visit already has a finished Red flags note the phone lacks (8.2, D113):
  /// asked at the first action that adds a note, once for the screen.
  RedFlagsOnline? _redFlagsRead;
  RedFlagsOnline _redFlags(String encounterId) => _redFlagsRead ??= RedFlagsOnline(_s, encounterId, _sync);

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _s.sweep.showing.add(widget.noteId);
    _s.addListener(_reload);
    _sync.addListener(_reload);
    unawaited(_loadTypes());
    unawaited(_read());
  }

  @override
  void dispose() {
    _s.removeListener(_reload);
    _sync.removeListener(_reload);
    _s.sweep.showing.remove(widget.noteId);
    if (_visitShown != null) _s.sweep.showing.remove(_visitShown);
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    if (_stale && (_route?.isCurrent ?? true)) {
      _stale = false;
      unawaited(_read());
    }
  }

  /// A change made here or brought in by a sync: read again, or, under another screen, once on top.
  void _reload() {
    if (!mounted) return;
    if (!(_route?.isCurrent ?? true)) {
      _stale = true;
      return;
    }
    unawaited(_read());
  }

  Future<void> _loadTypes() async {
    final listed = await _s.noteTypes();
    if (!mounted) return;
    setState(() => _listed = listed);
    await _workOutOffers();
  }

  /// Reads the note again, logging only what this read adds (lifecycle 9.7).
  Future<void> _read() async {
    final seq = ++_seq;
    if (!encountersOpen(_sync, _s)) return;
    if (_s.store.frozen) return setState(() => _note = null);
    try {
      final note = await _repo.openNote(widget.noteId, shownBefore: {..._shown});
      if (!mounted || seq != _seq) return;
      if (note != null) {
        _shown.addAll(note.shownIds);
        if (_visitShown == null) {
          // Its visit stays on the phone with it: the summary and the other notes read it (8.2).
          _visitShown = note.encounterId;
          _s.sweep.showing.add(note.encounterId);
        }
      }
      setState(() {
        _note = note;
        _opening = false;
        _readRefused = null;
      });
      await _workOutOffers();
    } on ChartingPaused catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _note = null;
        _opening = false;
        _readRefused = e.message;
      });
    }
  }

  /// The visit's record on the phone: its patient and its kind, for the header and the actions.
  ({String? patientId, VisitKind kind})? _visit(NoteView note) {
    final rec = _s.store.record(note.encounterId);
    if (rec == null || rec.entity != entityEncounter) return null;
    return (patientId: rec.fields['patientId']?.value as String?, kind: VisitKind.fromCode(rec.fields['kind']?.value));
  }

  NoteTypeDef? _listedType(String key) => _listed.where((t) => t.key == key).firstOrNull;

  /// A note of [type] can be started in the visit (forms 8.1, 10.1 #39): the note types list offers
  /// it, or, for the Red flags note the app adds, a Medical visit with a patient takes the person's
  /// Medical notes; and a Medical note needs the visit's patient (3.10).
  bool _startable(NoteTypeDef type, ({String? patientId, VisitKind kind}) visit) {
    final medical = isMedicalType(type);
    if (medical && (visit.kind != VisitKind.medical || visit.patientId == null)) return false;
    if (type.auto == 'medical') return _s.user.charts && _s.user.can.chartMedical;
    return _repo.noteTypesOffered(_listed, visit.kind).any((t) => t.key == type.key);
  }

  // ---- saving ----

  /// One answer from the form, saved by the domain layer, which checks it and refuses what the
  /// server would refuse or hold (9.5). It may come after the form has gone (Save & Close while
  /// typing), and is saved all the same.
  void _save(String path, Object? value) {
    try {
      _repo.saveAnswer(widget.noteId, path, value);
      if (mounted && _problem != null) setState(() => _problem = null);
    } on Exception catch (e) {
      if (!mounted) return;
      final definition = _note?.definition;
      setState(() {
        _problem = encounterErrorText(e);
        // The form shows what was tapped until it is drawn again: draw it from what is stored.
        _generation++;
        _reopen = definition == null ? null : fieldAt(definition, path)?.section.id;
      });
    }
  }

  /// The note's conflicts, each choice made in the store and followed by a sync, as Needs attention
  /// does (9.5 as built); a choice made out of date says so and changes nothing.
  Map<String, AnswerConflict> _conflicts(NoteView note) => {
    for (final MapEntry(key: path, value: c) in note.conflicts.entries)
      path: AnswerConflict(
        theirs: c.theirs,
        mine: c.mine,
        by: c.by,
        at: c.at,
        onChoose: c.onChoose == null
            ? null
            : (keepMine) async {
                try {
                  await c.onChoose!(keepMine);
                } on Exception catch (e) {
                  if (mounted) setState(() => _problem = encounterErrorText(e));
                  return;
                }
                if (mounted && _problem != null) setState(() => _problem = null);
                unawaited(_sync.syncNow());
              },
      ),
  };

  /// What a box being typed in holds is saved as it loses focus, before the screen goes.
  Future<void> _flushTyping() async {
    FocusManager.instance.primaryFocus?.unfocus();
    await Future<void>.delayed(Duration.zero);
  }

  /// **Save & Close** (lifecycle 3.2): every answer is saved as it is entered, so nothing more is
  /// saved; the visit's screens go, the patient's chart shows, and a sync is asked for now. The draft
  /// stays on the phone until it is finished.
  Future<void> _saveAndClose(NoteView note) async {
    await _flushTyping();
    if (!mounted) return;
    final said = ScaffoldMessenger.of(context);
    leaveVisit(context, _s.store, _visit(note)?.patientId);
    said
      ..removeCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text(savedAsDraftDone)));
    unawaited(_sync.syncNow());
  }

  /// **Continue**: the visit's summary (9.6).
  Future<void> _continue(NoteView note) async {
    await _flushTyping();
    if (mounted) unawaited(context.push('/encounters/${note.encounterId}/summary'));
  }

  // ---- the form's actions (forms 6, 8.1; F7) ----

  /// What the screen does for an action field, or null where it can't be done here, so the form
  /// draws nothing for it.
  FutureOr<void> Function()? _action(ActionDef field, String path) {
    final note = _note;
    final visit = note == null ? null : _visit(note);
    if (note == null || visit == null) return null;
    switch (field.action) {
      case 'open_note_type':
        final type = field.noteType == null ? null : _listedType(field.noteType!);
        if (type == null || !_startable(type, visit)) return null;
        return type.auto == 'medical' ? () => _openRedFlags(note) : () => _openType(note, type);
      case 'add_referral':
        final patientId = visit.patientId;
        if (patientId == null || !_s.referrals.mayAdd) return null;
        return () => _addReferral(patientId, note.encounterId);
      case 'show_handoff':
        return () => context.push('/encounters/${note.encounterId}/handoff');
    }
    return null;
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _problem = null);
    try {
      await action();
    } on Exception catch (e) {
      if (mounted) setState(() => _problem = encounterErrorText(e));
    }
  }

  /// `open_note_type` (forms 6.7): the visit's draft of that type, or a new one (`addNote`).
  Future<void> _openType(NoteView note, NoteTypeDef type) => _run(() async {
    final flags = await _redFlags(note.encounterId).finished;
    final added = await _repo.addNote(note.encounterId, type, redFlagsFinished: flags);
    if (mounted) unawaited(context.push(noteLocation(added.noteId)));
  });

  /// `open_note_type` naming the Red flags note (forms 6.2 as built): the person's own, through
  /// `addRedFlagsNote`, so no second one is made once theirs is finished; when a teammate's finished
  /// one makes it needless, that note opens, read-only: the phone's, found without a read that would
  /// log notes nothing shows (review SRD-7), else the server's, brought to the phone first.
  Future<void> _openRedFlags(NoteView note) => _run(() async {
    final online = _redFlags(note.encounterId);
    final theirs = await online.note;
    var id = await _repo.addRedFlagsNote(note.encounterId, redFlagsFinished: theirs != null);
    id ??= await _repo.finishedRedFlagsNote(note.encounterId);
    if (id == null && theirs != null && await fetchNote(_s, theirs, encounterId: note.encounterId)) id = theirs;
    if (id == null) throw const LocalValidationError(noteNotOnPhone);
    if (mounted) unawaited(context.push(noteLocation(id)));
  });

  /// `add_referral` (forms 6.8): a referral made at this visit.
  Future<void> _addReferral(String patientId, String encounterId) => _run(() async {
    await showAddReferral(context, _s, patientId: patientId, encounterId: encounterId);
  });

  // ---- Expand (forms 6.4) and Add to the problem list (lifecycle 8.3) ----

  /// Each part's Expands, with whether a tap opens a note already in the visit (`expandOpensAsItIs`):
  /// only full note types that can be started in the visit.
  Future<void> _workOutOffers() async {
    final note = _note;
    final visit = note == null ? null : _visit(note);
    if (note == null || visit == null || _listed.isEmpty || !_repo.mayExpand(note)) {
      if (_offers.isNotEmpty && mounted) setState(() => _offers = const {});
      return;
    }
    final offers = <String, List<ExpandOffer>>{};
    try {
      for (final target in expandTargets(note.definition!)) {
        final full = _listedType(target.noteTypeKey);
        if (full == null || !_startable(full, visit)) continue;
        final existing = await _repo.expandOpensAsItIs(note.noteId, full);
        (offers[target.section] ??= []).add(
          ExpandOffer(into: full.title, opensExisting: existing, onPressed: () => _expand(note, full)),
        );
      }
    } on ChartingPaused {
      return;
    }
    if (mounted) setState(() => _offers = offers);
  }

  Future<void> _expand(NoteView note, NoteTypeDef full) => _run(() async {
    final flags = await _redFlags(note.encounterId).finished;
    final done = await _repo.expand(note.noteId, full, redFlagsFinished: flags);
    if (!mounted) return;
    final labels = [
      for (final l in done.leftOut) l.label,
      for (final path in done.notCopied) _labelOf(note.definition!, path),
    ];
    if (labels.isNotEmpty) {
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text(notCopiedTitle),
          content: SingleChildScrollView(child: Text(notCopiedBody(labels))),
          actions: [FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text(notCopiedOk))],
        ),
      );
    }
    if (mounted) unawaited(context.push(noteLocation(done.noteId)));
  });

  static String _labelOf(NoteTypeDef definition, String path) => fieldAt(definition, path)?.field?.label ?? path;

  /// What shows under a diagnosis the person picked: the button, or "On the problem list".
  ProblemListOffer? _problemOffer(String path, ProblemAnswer diagnosis) {
    final ProblemListPlace? place;
    try {
      place = _repo.problemListPlace(widget.noteId, path);
    } on Exception {
      return null;
    }
    if (place == null) return null;
    if (place.listed) return const ProblemListOffer.listed();
    return ProblemListOffer.add(
      status: place.status,
      resolvedTitle: place.resolved?.title,
      onAdd: (status, sameComingBack) => _run(() async {
        _repo.addToProblemList(widget.noteId, path, status: status, sameComingBack: sameComingBack);
        if (mounted) showDone(context, addedToProblemList);
      }),
    );
  }

  // ---- drawing ----

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text(noteTitle)),
    body: SafeArea(child: _instead() ?? _body(context, _note!)),
    bottomNavigationBar: _bar(),
  );

  /// What shows in place of the note: asked at every build, so nothing read before the database
  /// closed or froze is shown again.
  Widget? _instead() {
    if (!encountersOpen(_sync, _s)) return const SizedBox.shrink();
    if (_s.store.frozenMessage case final frozen?) return FrozenNotice(frozen);
    if (_readRefused case final message?) return FrozenNotice(message);
    if (_note != null) return null;
    if (_opening) return const Center(child: CircularProgressIndicator());
    return const Padding(padding: EdgeInsets.all(FieldSpace.s4), child: NoticeMessage(noteNotOnPhone));
  }

  /// Whether Save & Close and Continue close the note's list instead of standing in a bar: at large
  /// text on a short screen (two times on most phones), where a bar would hold a fifth of the screen
  /// or more and leave the form little room. What was last refused stays in a bar, to be seen.
  bool get _actionsInList => MediaQuery.sizeOf(context).height / MediaQuery.textScalerOf(context).scale(1) < 480;

  /// Save & Close and Continue, under a draft the person may change, with what was last refused.
  Widget? _bar() {
    final note = _note;
    if (note == null || _instead() != null || !note.editable) return null;
    final inList = _actionsInList;
    if (inList && _problem == null) return null;
    return SafeArea(
      child: Material(
        color: context.field.surface,
        elevation: 4,
        // Never more than a third of the screen, whatever the text size or the sentence: the form
        // keeps the rest, and a long refusal scrolls in its place.
        child: LayoutBuilder(
          builder: (context, space) => ConstrainedBox(
            constraints: BoxConstraints(maxHeight: space.maxHeight / 3),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s3),
              child: inList ? ErrorMessage(_problem!) : _actions(note),
            ),
          ),
        ),
      ),
    );
  }

  Widget _actions(NoteView note) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_problem != null && !_actionsInList) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s2)],
      _Buttons(
        left: WideButton(label: saveAndCloseAction, onPressed: () => unawaited(_saveAndClose(note))),
        right: WideButton(
          label: continueAction,
          icon: LucideIcons.arrowRight,
          filled: true,
          onPressed: () => unawaited(_continue(note)),
        ),
      ),
    ],
  );

  Widget _body(BuildContext context, NoteView note) {
    final text = Theme.of(context).textTheme;
    final visit = _visit(note);
    final title = note.title ?? untitledNote;
    final paused = _s.store.chartingPaused;
    final definition = note.definition;
    return ListView(
      padding: const EdgeInsets.all(FieldSpace.s4),
      children: [
        VisitPatientHeader(store: _s.store, patientId: visit?.patientId, line: title),
        const SizedBox(height: FieldSpace.s2),
        Wrap(
          spacing: FieldSpace.s2,
          runSpacing: FieldSpace.s1,
          children: [NoteStateChip(note: note)],
        ),
        if (!note.actsAsAuthor) ...[
          const SizedBox(height: FieldSpace.s1),
          Text(byText(note.actingAuthor), style: text.bodyLarge),
        ],
        const SizedBox(height: FieldSpace.s3),
        if (paused && note.editable) ...[const ErrorMessage(chartingPaused), const SizedBox(height: FieldSpace.s3)],
        // A note with nothing to change offers nothing to save, so a refusal shows here.
        if (!note.editable && _problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
        if (note.finished && note.read != null)
          NoteReadView(model: note.read!)
        else if (definition == null)
          const NoticeMessage(noteFormNotOnPhone)
        else ...[
          if (!note.editable) ...[const NoticeMessage(readOnlyNote), const SizedBox(height: FieldSpace.s3)],
          ProblemListScope(
            handler: _problemOffer,
            child: NoteForm(
              key: ValueKey(_generation),
              definition: definition,
              answers: note.answers,
              onChanged: _save,
              pending: note.pendingPaths,
              conflicts: _conflicts(note),
              capabilities: {if (_s.user.can.orderMedications) 'orderMedications'},
              actions: _action,
              expand: _repo.mayExpand(note) ? (section) => _offers[section.id] ?? const [] : null,
              enabled: note.editable && !paused,
              openSection: _reopen ?? widget.openSection,
            ),
          ),
        ],
        if (note.editable && _actionsInList) ...[const SizedBox(height: FieldSpace.s4), _actions(note)],
      ],
    );
  }
}

/// Two buttons side by side where both fit their words, one under the other at large text.
class _Buttons extends StatelessWidget {
  const _Buttons({required this.left, required this.right});
  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width / MediaQuery.textScalerOf(context).scale(1) >= 340;
    if (!wide) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          right,
          const SizedBox(height: FieldSpace.s2),
          left,
        ],
      );
    }
    return Row(
      children: [
        Expanded(child: left),
        const SizedBox(width: FieldSpace.s2),
        Expanded(child: right),
      ],
    );
  }
}
