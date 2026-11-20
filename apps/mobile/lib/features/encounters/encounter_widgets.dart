import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/transport.dart' show ApiException;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/allergy_badge.dart';
import '../../design/widgets/form_bits.dart' show ErrorMessage, NoticeMessage;
import '../../design/widgets/status_chip.dart';
import '../../encounters/encounter_api.dart' show EncounterRequestFailed;
import '../../encounters/encounter_models.dart';
import '../../encounters/encounter_services.dart';
import '../../patients/chart_cache.dart' show ChartMeta, chartMetaField, patientGroup;
import '../../patients/display.dart';
import '../../patients/patient_providers.dart';
import '../../patients/patient_search.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalStore, entityAllergy, entityEncounter, entityNote;
import '../../sync/sync_controller.dart' show SyncController;
import '../patients/patient_row.dart' show PatientRow;
import '../patients/patient_widgets.dart' show FrozenNotice, PhiField, WideButton, todayOf;
import 'encounter_labels.dart';

// The sheets' gate: phase 3's patient picker needs it too, so it lives with the patient screens.
export '../patients/sheet_gate.dart' show SheetGate;

/// Pieces the encounter screens share (lifecycle 9).

/// The open team's encounter services, and what to show when there are none: locked, signed out or
/// no team, or the team's store closed or frozen under the screen. A frozen store can log no read,
/// and what can't be logged isn't shown (D21), so nothing of a visit shows while it is frozen.
class EncountersGate extends ConsumerWidget {
  const EncountersGate({super.key, required this.title, required this.builder});
  final String title;
  final Widget Function(BuildContext context, EncounterServices services) builder;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final services = ref.watch(encounterServicesProvider);
    if (services == null) {
      return Scaffold(
        appBar: AppBar(title: Text(title)),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    // The controller itself: a screen under another one still hears a lock or a freeze.
    final sync = ref.watch(syncControllerProvider);
    return ListenableBuilder(
      listenable: sync,
      builder: (context, _) {
        // A lock or sign-out closed the database these services read; the route goes next frame.
        if (!encountersOpen(sync, services)) return const SizedBox.shrink();
        if (services.store.frozenMessage case final frozen?) {
          return Scaffold(
            appBar: AppBar(title: Text(title)),
            body: FrozenNotice(frozen),
          );
        }
        return builder(context, services);
      },
    );
  }
}

/// [services] still read the database the controller holds open.
bool encountersOpen(SyncController sync, EncounterServices services) => identical(sync.store, services.store);

/// Reads the visit [encounterId] from the phone's copy for a screen, at first and again after every
/// change the services or a sync make, so a note just added, removed or brought in shows. Each read
/// logs only what it adds to what the screen showed before (`shownBefore`, lifecycle 9.7). While
/// another screen covers it (a note's form, saving at each answer), it reads again once it is on top,
/// not at each change: it shows nothing meanwhile, so it logs nothing meanwhile. The visit is kept
/// open on the phone while the screen is there (the close sweep's `showing`, 8.2).
mixin VisitReading<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  EncounterServices get services;
  String get encounterId;

  /// One read of the visit, logging what is not in [shownBefore]: the phone's copy here; the visit
  /// screen reads wherever the visit is (9.7). An [EncounterRequestFailed] says why there is none.
  Future<VisitView?> readOnce(Set<String> shownBefore) =>
      services.repository.openVisit(encounterId, shownBefore: shownBefore);

  /// Whether a change the services or a sync make calls for reading again: a read of the phone's
  /// copy, never a request of the server's at each change.
  bool get rereadsOnChange => true;

  /// The visit as the person may see it; null before the first read, or when the phone holds no such
  /// visit ([visitMissing]).
  VisitView? visit;
  bool opening = true;
  bool visitMissing = false;

  /// Why there is no visit to show, in the domain layer's words, when it gave some ("This visit
  /// isn't on this phone. Connect to open it.").
  String? missingText;

  /// Why the read was refused (a frozen store: it couldn't be logged, so nothing is shown).
  String? readRefused;

  /// Every record the screen's reads logged, so a read logs only what it adds; a screen that reads
  /// more for what it shows (the records made at the visit) adds theirs.
  Set<String> get shownSoFar => _shown;

  final _shown = <String>{};
  int _seq = 0;
  late final SyncController _sync;
  ModalRoute<Object?>? _route;

  /// Something changed while another screen covered this one.
  bool _stale = false;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    services.sweep.showing.add(encounterId);
    services.addListener(_reload);
    _sync.addListener(_reload);
    unawaited(reread());
  }

  @override
  void dispose() {
    services.removeListener(_reload);
    _sync.removeListener(_reload);
    services.sweep.showing.remove(encounterId);
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
    if (_stale && (_route?.isCurrent ?? true)) {
      _stale = false;
      unawaited(reread());
    }
  }

  void _reload() {
    if (!mounted || !rereadsOnChange) return;
    if (!(_route?.isCurrent ?? true)) {
      _stale = true;
      return;
    }
    unawaited(reread());
  }

  /// Reads the visit again. A read that a later one overtook shows nothing; what it logged stays
  /// logged, and the later read may log it again: a double log is safer than a missing one.
  Future<void> reread() async {
    final seq = ++_seq;
    if (!encountersOpen(_sync, services)) return;
    // Nothing can be logged: what was read before goes ([instead] says why).
    if (services.store.frozen) return setState(() => visit = null);
    try {
      final view = await readOnce({..._shown});
      if (!mounted || seq != _seq) return;
      if (view != null) _shown.addAll(view.shownIds);
      setState(() {
        visit = view;
        visitMissing = view == null;
        missingText = null;
        opening = false;
        readRefused = null;
      });
    } on EncounterRequestFailed catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        visit = null;
        visitMissing = true;
        missingText = e.message;
        opening = false;
      });
    } on ChartingPaused catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        visit = null;
        opening = false;
        readRefused = e.message;
      });
    }
  }

  /// What shows in place of the visit, or null when [visit] can be drawn. Asked at every build,
  /// whatever caused it: nothing read before the database closed or froze is shown again (phase 3's
  /// review, V1).
  Widget? instead() {
    if (!encountersOpen(_sync, services)) return const SizedBox.shrink();
    if (services.store.frozenMessage case final frozen?) return FrozenNotice(frozen);
    if (readRefused case final message?) return FrozenNotice(message);
    if (visit != null) return null;
    if (opening) return const Center(child: CircularProgressIndicator());
    return Padding(padding: const EdgeInsets.all(FieldSpace.s4), child: NoticeMessage(missingText ?? visitNotOnPhone));
  }
}

/// Online, the finished Red flags note the server's read of a visit shows (lifecycle 8.2, D113, the
/// coordinator's decision on SFL-5 and SRD-8), asked once for a screen and kept: one read serves the
/// screen, whatever it then adds or completes. A screen passes whether there is one as
/// `redFlagsFinished` to `addNote`, `openComplete`, `addRedFlagsNote` and `expand`, so a teammate's
/// note the phone does not hold makes the person's own needless. Offline, and for a visit made here
/// that has not reached the server, nothing is asked: the phone's own copy decides, as the server
/// tolerates.
class RedFlagsOnline {
  RedFlagsOnline(this.services, this.encounterId, this.sync);
  final EncounterServices services;
  final String encounterId;
  final SyncController sync;
  Future<String?>? _asked;

  /// The note's ID; null when the server shows none, or was not asked.
  Future<String?> get note => _asked ??= _ask();

  /// Whether the server shows one: what the domain layer takes as `redFlagsFinished`.
  Future<bool> get finished async => await note != null;

  Future<String?> _ask() async {
    if (sync.snapshot.offline || !services.repository.othersMayHaveAdded(encounterId)) return null;
    return services.api.finishedRedFlags(encounterId);
  }
}

/// Whether "On this phone only" goes beside a note's state: never where the state says "Waiting to
/// send", which says the same thing.
bool showsOnThisPhoneOnly(NoteView note) => note.notSynced && !note.waitingToSend;

/// A note's state in words with an icon (lifecycle 9.1): never colour alone.
class NoteStateChip extends StatelessWidget {
  const NoteStateChip({super.key, required this.note});
  final NoteView note;

  @override
  Widget build(BuildContext context) {
    final (icon, tone) = note.sentForReview
        ? (LucideIcons.shieldAlert, ChipTone.warning)
        : note.waitingToSend
        ? (LucideIcons.smartphone, ChipTone.info)
        : switch (note.shown) {
            NoteShown.draft => (LucideIcons.squarePen, ChipTone.neutral),
            NoteShown.waitingForCosigner || NoteShown.waitingForAttestation => (LucideIcons.clock, ChipTone.info),
            NoteShown.complete || NoteShown.signed || NoteShown.attested => (LucideIcons.circleCheck, ChipTone.good),
          };
    return StatusChip(label: noteStateText(note), icon: icon, tone: tone);
  }
}

/// The name a visit's patient goes by, as the team's index or the chart the phone holds names them,
/// never a legal name; [noNameRecorded] when neither gives one. For a screen that shows the visit,
/// whose read logged it on the patient (lifecycle 10.1), or a screen opened from their chart.
String visitPatientName(LocalStore store, String patientId) {
  final entry = PatientServices.of(store)?.index.entry(patientId);
  final record = store.record(store.canonicalPatient(patientId));
  String? named(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
  return named(entry?.preferredName) ??
      named(record?.fields['preferredName']?.value) ??
      named(entry?.visualDescriptor) ??
      named(record?.fields['visualDescriptor']?.value) ??
      noNameRecorded;
}

/// A choice on a step: an icon, its name, and a line under it, one button whose label reads both.
class ChoiceTile extends StatelessWidget {
  const ChoiceTile({super.key, required this.icon, required this.label, required this.line, required this.onTap});
  final IconData icon;
  final String label;
  final String line;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    // The tap is on this node itself, so Switch Access and Voice Access can activate it.
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: '$label. $line',
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.lineStrong),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(icon, color: c.ink),
                  const SizedBox(width: FieldSpace.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(label, style: text.titleMedium),
                        Text(line, style: text.bodyLarge),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Phase 3's search for a patient, as its picker runs it (design 5.6): each search a run of its own,
/// audited before it shows, its count said once per run, never per keystroke. [onChosen] takes the
/// person tapped.
class PatientFinder extends ConsumerStatefulWidget {
  const PatientFinder({super.key, required this.patients, required this.onChosen});
  final PatientServices patients;
  final ValueChanged<FoundPatient> onChosen;

  @override
  ConsumerState<PatientFinder> createState() => _PatientFinderState();
}

class _PatientFinderState extends ConsumerState<PatientFinder> {
  final _query = TextEditingController();
  SearchRun? _run;
  String? _problem;
  bool _searching = false;
  int _seq = 0;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _search({bool more = false}) async {
    if (_query.text.trim().isEmpty) return;
    final seq = ++_seq;
    setState(() => _searching = true);
    try {
      final run = await widget.patients.search.search(_query.text, more: more);
      if (!mounted || seq != _seq) return;
      setState(() {
        _run = run;
        _problem = null;
      });
    } on ChartingPaused catch (e) {
      // What can't be logged isn't shown (D21).
      if (mounted && seq == _seq) {
        setState(() {
          _run = null;
          _problem = e.message;
        });
      }
    } on ApiException {
      if (mounted && seq == _seq) {
        setState(() {
          _run = null;
          _problem = searchUnavailable;
        });
      }
    } finally {
      if (mounted && seq == _seq) setState(() => _searching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // A freeze for a hand-over: the results read before it go at the next build (phase 3's V1).
    if (widget.patients.store.frozenMessage case final frozen?) return ErrorMessage(frozen);
    final run = _run;
    final hits = run?.hits ?? const <FoundPatient>[];
    final today = todayOf(ref);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PhiField(
          name: 'visitSearch',
          label: patientSearchLabel,
          controller: _query,
          textInputAction: TextInputAction.search,
          prefixIcon: const Icon(LucideIcons.search),
          onSubmitted: (_) => unawaited(_search()),
        ),
        const SizedBox(height: FieldSpace.s2),
        OutlinedButton(onPressed: _searching ? null : () => unawaited(_search()), child: const Text(searchAction)),
        const SizedBox(height: FieldSpace.s3),
        if (_problem != null) ErrorMessage(_problem!),
        if (run != null)
          Semantics(
            liveRegion: true,
            child: Text(
              foundText(hits.length, onPhone: run.source == ListSource.phone),
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
        for (final p in hits) ...[
          const SizedBox(height: FieldSpace.s2),
          PatientRow(patient: p, today: today, onTap: () => widget.onChosen(p)),
        ],
        if (run != null && run.truncated) ...[
          const SizedBox(height: FieldSpace.s2),
          if (run.more)
            Text(narrowSearch, style: Theme.of(context).textTheme.bodyLarge)
          else
            WideButton(label: showMoreAction, onPressed: _searching ? null : () => unawaited(_search(more: true))),
        ],
      ],
    );
  }
}

/// Asks who a visit is for, with phase 3's search (Switch to Medical on a visit with no patient,
/// lifecycle 3.10); null when the sheet is closed without a choice.
Future<FoundPatient?> choosePatient(BuildContext context, PatientServices patients, {required String line}) =>
    showModalBottomSheet<FoundPatient>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
            children: [
              Semantics(header: true, child: Text(whoHeading, style: Theme.of(context).textTheme.titleLarge)),
              const SizedBox(height: FieldSpace.s2),
              Text(line, style: Theme.of(context).textTheme.bodyLarge),
              const SizedBox(height: FieldSpace.s3),
              PatientFinder(patients: patients, onChosen: (p) => Navigator.of(context).pop(p)),
            ],
          ),
        ),
      ),
    );

/// The allergy badge of a visit's patient (lifecycle 9.5), by phase 3's one rule (`allergyBadge`):
/// the active allergies of the patient's merged group that the phone holds, as the chart the phone
/// keeps lists them, with its own unsent ones; for a patient the phone holds no record of, the
/// team's index entry. For a screen that shows the visit's note, whose read logged it on the patient.
AllergyBadge visitAllergyBadge(LocalStore store, String patientId) {
  final canonical = store.canonicalPatient(patientId);
  final group = patientGroup(store, canonical);
  final records = [for (final id in group) ?store.record(id)];
  final meta = switch (store.record(canonical)?.fields[chartMetaField]?.value) {
    final Map<String, Object?> json => ChartMeta(json),
    _ => null,
  };
  final listed = meta?.allergyIds.toSet();
  final active = <BadgeAllergy>[];
  var held = records.isNotEmpty;
  for (final p in group) {
    for (final id in store.recordIdsOfPatient(p)) {
      final r = store.record(id);
      if (r == null || r.entity != entityAllergy) continue;
      // A chart the phone keeps says which of its allergies the reader is shown; one made here waits.
      if (listed != null && !listed.contains(id) && r.origin != 'local') continue;
      held = true;
      if (r.status == 'active' && r.fields['enteredInError']?.value == null) {
        active.add((
          substance: r.attributes['substance'] as String? ?? '',
          severity: r.attributes['severity'] as String?,
        ));
      }
    }
  }
  String? screen = [for (final r in records) r.fields['allergyScreen']?.value].whereType<String>().firstOrNull;
  if (!held) {
    final entry = PatientServices.of(store)?.index.entry(canonical);
    if (entry != null) {
      active.addAll([for (final a in entry.allergies) (substance: a.substance, severity: a.severity.toJson())]);
      screen = entry.allergyScreen.toJson();
    }
  }
  return allergyBadge(active, screen: screen);
}

/// Who a visit is for, above its note or its summary (lifecycle 9.5): the patient's preferred name,
/// never a legal name, and phase 3's allergy badge; "No patient" for a visit with none. [line] goes
/// under the name (the note type, or the visit's kind), read with it as one heading.
class VisitPatientHeader extends StatelessWidget {
  const VisitPatientHeader({super.key, required this.store, required this.patientId, required this.line});
  final LocalStore store;
  final String? patientId;
  final String line;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final id = patientId;
    final name = id == null ? noPatientText : visitPatientName(store, id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          container: true,
          header: true,
          label: '$name, $line',
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, style: text.headlineSmall),
              Text(line, style: text.titleMedium),
            ],
          ),
        ),
        if (id != null) ...[
          const SizedBox(height: FieldSpace.s2),
          Semantics(container: true, child: AllergyBadgeView(badge: visitAllergyBadge(store, id))),
        ],
      ],
    );
  }
}

/// The routes of a visit's screens: New encounter, the encounter, its note types, a note, the summary
/// and the handoff. By their patterns, which carry IDs only (10.2).
bool _visitRoute(String? pattern) =>
    pattern != null &&
    (pattern.startsWith('/encounters/') || pattern.startsWith('/notes/') || pattern.endsWith('/encounters/new'));

/// Leaves a visit's screens for the patient's chart: Save & Close (lifecycle 3.2) and after Complete
/// (8.2: "the app replaces the encounter screens with the patient profile"). The visit's screens go;
/// the chart is the one under them when it is this patient's, else it opens. A visit with no patient
/// returns to Home. Nothing is closed in the store: a draft stays on the phone until it is finished
/// (3.2), and the close sweep lets go of what is done with (8.2).
void leaveVisit(BuildContext context, LocalStore store, String? patientId) {
  final router = GoRouter.of(context);
  Route<Object?>? landed;
  Navigator.of(context).popUntil((route) {
    final settings = route.settings;
    // A sheet or a dialog over the visit goes with it.
    final stays = route.isFirst || (settings is Page && !_visitRoute(settings.name));
    if (stays) landed = route;
    return stays;
  });
  if (patientId == null) return router.go('/');
  final under = landed?.settings;
  final onChart = switch (under) {
    Page(name: '/patients/:id', arguments: {'id': final String id}) =>
      store.canonicalPatient(id) == store.canonicalPatient(patientId),
    _ => false,
  };
  if (!onChart) unawaited(router.push('/patients/$patientId'));
}

/// Brings the note [noteId] onto the phone when it is not there, with its visit ([encounterId] when
/// known, else the one the note names), as the visit screen brings one (8.2): Notes to finish's draft
/// that another phone made, and the note a Needs attention notice names (9.9, 9.13). False without
/// signal, or when the server has no such note for the person: the screen says the note needs a
/// connection.
Future<bool> fetchNote(EncounterServices services, String noteId, {String? encounterId}) async {
  final store = services.store;
  if (store.record(noteId) != null) return true;
  final fetch = services.repository.openServerRecord;
  if (fetch == null) return false;
  try {
    if (encounterId != null && store.record(encounterId) == null && !await fetch(entityEncounter, encounterId)) {
      return false;
    }
    if (!await fetch(entityNote, noteId)) return false;
    final visit = store.record(noteId)?.attributes['encounterId'];
    if (visit is String && store.record(visit) == null) await fetch(entityEncounter, visit);
    return true;
  } on Exception {
    return false;
  }
}
