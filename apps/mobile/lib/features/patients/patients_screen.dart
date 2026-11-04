import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/transport.dart' show ApiException;
import '../../app_providers.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/birth_field.dart';
import '../../design/widgets/form_bits.dart';
import '../../design/widgets/status_chip.dart';
import '../../patients/dob.dart';
import '../../patients/patient_providers.dart';
import '../../patients/patient_search.dart';
import '../../patients/team_index.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_engine.dart' show RefreshReason;
import 'patient_labels.dart';
import 'patient_row.dart';
import 'patient_widgets.dart';

/// The Patients tab (design 12.1): find someone on or off line, or start a new patient.
///
/// A search run is a list shown after 600 ms without typing, or on submit; each is audited before
/// it renders (5.6), by the server online or in the phone's own transaction offline. The count is
/// announced once per run, never per keystroke, and the field keeps focus while results change.
class PatientsScreen extends ConsumerWidget {
  const PatientsScreen({super.key, this.focusSearch = false});

  /// The `extra` of a tap on the Patients tab: the search takes focus.
  static const fromTabBar = 'patients-tab';

  final bool focusSearch;

  @override
  Widget build(BuildContext context, WidgetRef ref) => PatientsGate(
    title: 'Patients',
    builder: (context, services) => _PatientsBody(services: services, focusSearch: focusSearch),
  );
}

class _PatientsBody extends ConsumerStatefulWidget {
  const _PatientsBody({required this.services, required this.focusSearch});
  final PatientServices services;
  final bool focusSearch;

  @override
  ConsumerState<_PatientsBody> createState() => _PatientsBodyState();
}

class _PatientsBodyState extends ConsumerState<_PatientsBody> {
  final _query = TextEditingController();
  final _focus = FocusNode();
  Timer? _debounce;
  Birth? _born;

  SearchRun? _run;
  int _seq = 0;
  bool _searching = false;
  String? _problem;

  /// "Opened recently on this phone", read (and audited) once each time the empty state shows.
  List<FoundPatient>? _recent;
  bool _hasDraft = false;

  static const _quiet = Duration(milliseconds: 600);

  PatientServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    if (widget.focusSearch) WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
    _loadEmpty();
  }

  @override
  void didUpdateWidget(_PatientsBody old) {
    super.didUpdateWidget(old);
    if (!identical(old.services, widget.services)) {
      _run = null;
      _loadEmpty();
    }
    if (widget.focusSearch && !old.focusSearch) _focus.requestFocus();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    _focus.dispose();
    super.dispose();
  }

  bool get _emptyQuery => _query.text.trim().isEmpty && _born is! BirthDate;

  void _loadEmpty() {
    _hasDraft = _s.mayEdit && _s.patients.draft() != null;
    try {
      _recent = _s.search.openedRecently();
      _problem = null;
    } on ChartingPaused catch (e) {
      _recent = const [];
      _problem = e.message;
    }
  }

  void _typed(String _) {
    _debounce?.cancel();
    if (_emptyQuery) {
      setState(() {
        _seq++;
        _run = null;
        _searching = false;
        _loadEmpty();
      });
      return;
    }
    _debounce = Timer(_quiet, _search);
  }

  Future<void> _search({bool more = false}) async {
    _debounce?.cancel();
    if (_emptyQuery) return _typed('');
    final seq = ++_seq;
    setState(() => _searching = true);
    try {
      final run = await _s.search.search(_query.text, birth: _born, more: more);
      if (!mounted || seq != _seq) return;
      setState(() {
        _run = run;
        _problem = null;
        _searching = false;
      });
    } on ChartingPaused catch (e) {
      if (!mounted || seq != _seq) return;
      // What can't be logged isn't shown (D21).
      setState(() {
        _run = null;
        _problem = e.message;
        _searching = false;
      });
    } on ApiException {
      if (!mounted || seq != _seq) return;
      setState(() {
        _run = null;
        _problem = 'Search isn’t available right now. Try again in a moment.';
        _searching = false;
      });
    }
  }

  Future<void> _chooseBorn() async {
    final today = todayOf(ref);
    final birth = await showModalBottomSheet<Birth>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _BornSheet(today: today, initial: _born),
    );
    if (birth == null || !mounted) return;
    setState(() => _born = birth);
    unawaited(_search());
  }

  void _clearBorn() {
    setState(() => _born = null);
    _typed(_query.text);
    if (!_emptyQuery) unawaited(_search());
  }

  Future<void> _discardDraft() async {
    final yes = await confirm(
      context,
      title: 'Discard the patient you were adding?',
      body: 'What was typed is deleted from this phone. Nothing was sent.',
      yes: 'Discard',
    );
    if (!yes || !mounted) return;
    _s.patients.discardDraft();
    setState(() => _hasDraft = false);
  }

  void _open(FoundPatient p) => unawaited(context.push('/patients/${p.patientId}'));

  @override
  Widget build(BuildContext context) {
    final sync = ref.watch(syncControllerProvider);
    final now = ref.read(wallClockProvider)();
    final today = todayOf(ref);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Patients')),
      bottomNavigationBar: _s.mayEdit
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s2, FieldSpace.s4, FieldSpace.s2),
                child: SizedBox(
                  height: FieldTap.large,
                  child: FilledButton.icon(
                    onPressed: () => unawaited(context.push('/patients/new')),
                    icon: const Icon(LucideIcons.userPlus),
                    label: const Text('New patient'),
                  ),
                ),
              ),
            )
          : null,
      body: ListenableBuilder(
        listenable: Listenable.merge([sync, _s]),
        builder: (context, _) {
          final run = _run;
          final hits = run?.hits ?? const <FoundPatient>[];
          final onPhone = run?.source == ListSource.phone;
          return RefreshIndicator(
            onRefresh: () => sync.refreshNow(reason: RefreshReason.manual),
            child: ListView(
              padding: const EdgeInsets.all(FieldSpace.s4),
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                _IndexStatus(state: _s.index.state, offline: sync.snapshot.offline || onPhone, now: now),
                const SizedBox(height: FieldSpace.s3),
                PhiField(
                  name: 'search',
                  label: 'Search by name, street name or what they look like',
                  controller: _query,
                  focusNode: _focus,
                  textInputAction: TextInputAction.search,
                  prefixIcon: const Icon(LucideIcons.search),
                  onChanged: _typed,
                  onSubmitted: (_) => unawaited(_search()),
                  suffix: _query.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          icon: const Icon(LucideIcons.x),
                          onPressed: () {
                            _query.clear();
                            _typed('');
                            _focus.requestFocus();
                          },
                        ),
                ),
                const SizedBox(height: FieldSpace.s2),
                Wrap(
                  spacing: FieldSpace.s2,
                  children: [
                    if (_born == null)
                      ActionChip(
                        avatar: const Icon(LucideIcons.calendar, size: 18),
                        label: const Text('Born'),
                        tooltip: 'Search by year or date of birth',
                        onPressed: () => unawaited(_chooseBorn()),
                      )
                    else
                      InputChip(
                        label: Text('Born ${_bornText(_born!)}'),
                        onPressed: () => unawaited(_chooseBorn()),
                        onDeleted: _clearBorn,
                        deleteButtonTooltipMessage: 'Clear born',
                      ),
                  ],
                ),
                const SizedBox(height: FieldSpace.s3),
                if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
                if (run != null && !_emptyQuery) ...[
                  // Once per run, never per keystroke.
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      hits.isEmpty
                          ? (onPhone ? 'No one found on this phone.' : 'No one found.')
                          : '${hits.length == 1 ? '1 patient' : '${hits.length} patients'} found'
                                '${onPhone ? ' on this phone' : ''}',
                      style: text.titleMedium,
                    ),
                  ),
                  const SizedBox(height: FieldSpace.s2),
                  for (final p in hits) ...[
                    PatientRow(patient: p, today: today, onTap: () => _open(p)),
                    const SizedBox(height: FieldSpace.s2),
                  ],
                  if (run.truncated && !run.more)
                    WideButton(label: 'Show more', onPressed: _searching ? null : () => unawaited(_search(more: true))),
                  if (run.truncated && run.more)
                    Text('More people match. Add letters or a birth year to narrow it down.', style: text.bodyLarge),
                  if (hits.isEmpty && _s.mayEdit && _query.text.trim().isNotEmpty) ...[
                    const SizedBox(height: FieldSpace.s2),
                    WideButton(
                      label: 'New patient with this name',
                      icon: LucideIcons.userPlus,
                      onPressed: () =>
                          unawaited(context.push('/patients/new', extra: IntakeStart(name: _query.text.trim()))),
                    ),
                  ],
                ] else if (_emptyQuery) ...[
                  if (_hasDraft) ...[
                    StatusBanner(
                      icon: LucideIcons.squarePen,
                      tone: ChipTone.info,
                      text: 'Continue the patient you were adding?',
                      action: Wrap(
                        spacing: FieldSpace.s2,
                        runSpacing: FieldSpace.s2,
                        children: [
                          FilledButton(
                            onPressed: () =>
                                unawaited(context.push('/patients/new', extra: const IntakeStart(fromDraft: true))),
                            child: const Text('Continue'),
                          ),
                          OutlinedButton(onPressed: () => unawaited(_discardDraft()), child: const Text('Discard')),
                        ],
                      ),
                    ),
                    const SizedBox(height: FieldSpace.s3),
                  ],
                  if (_recent case final recent? when recent.isNotEmpty) ...[
                    const SectionHeading('Opened recently on this phone'),
                    for (final p in recent) ...[
                      PatientRow(patient: p, today: today, onTap: () => _open(p)),
                      const SizedBox(height: FieldSpace.s2),
                    ],
                  ],
                ] else if (_searching)
                  const Center(child: CircularProgressIndicator()),
              ],
            ),
          );
        },
      ),
    );
  }

  static String _bornText(Birth b) => switch (b) {
    BirthDate(:final year, :final month, :final day) => '${monthNames[month - 1].substring(0, 3)} $day, $year',
    _ => '${b.year}',
  };
}

/// "Patient list updated 2 hours ago · 1,204 patients", the offline form, or why there is none.
class _IndexStatus extends StatelessWidget {
  const _IndexStatus({required this.state, required this.offline, required this.now});
  final TeamIndexState state;
  final bool offline;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final style = Theme.of(context).textTheme.bodyLarge?.copyWith(color: c.ink);
    final at = state.refreshedAt;
    final String line;
    var icon = offline ? LucideIcons.cloudOff : LucideIcons.listChecks;
    if (!state.eligible) {
      line = 'Your role searches only charts opened on this phone.';
    } else if (state.removed == IndexRemoval.expired) {
      return const NoticeMessage(
        'The patient list on this phone was more than 7 days old and was removed. Connect to download it again.',
      );
    } else if (state.removed == IndexRemoval.notPermitted) {
      return const NoticeMessage(
        'The patient list was removed from this phone: your role no longer keeps it. Search finds charts '
        'opened on this phone.',
      );
    } else if (!state.present) {
      line = state.downloading
          ? 'Downloading the patient list…'
          : 'The patient list isn’t on this phone yet. It downloads when the phone connects.';
      icon = LucideIcons.cloudOff;
    } else if (offline) {
      line = 'Offline · searching the list on this phone (updated ${at == null ? 'earlier' : ago(at, now)})';
    } else {
      line =
          'Patient list updated ${at == null ? 'earlier' : ago(at, now)} · '
          '${state.count == 1 ? '1 patient' : '${count(state.count)} patients'}';
    }
    return Semantics(
      container: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(child: Icon(icon, size: 20, color: c.inkMuted)),
          const SizedBox(width: FieldSpace.s2),
          Expanded(child: Text(line, style: style)),
        ],
      ),
    );
  }
}

/// The Born filter: a year or a date, the intake's parser and read-back.
class _BornSheet extends StatefulWidget {
  const _BornSheet({required this.today, required this.initial});
  final DateTime today;
  final Birth? initial;

  @override
  State<_BornSheet> createState() => _BornSheetState();
}

class _BornSheetState extends State<_BornSheet> {
  BirthEntry _entry = const BirthEntry();

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: EdgeInsets.fromLTRB(
        FieldSpace.s4,
        0,
        FieldSpace.s4,
        FieldSpace.s4 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text('Born', style: Theme.of(context).textTheme.titleLarge)),
            const SizedBox(height: FieldSpace.s2),
            const Text('A year finds no one alone: add a name too. A full date can search by itself.'),
            const SizedBox(height: FieldSpace.s3),
            BirthField(
              today: widget.today,
              allowAge: false,
              fieldKey: const ValueKey('phi.born'),
              onChanged: (e) => setState(() => _entry = e),
            ),
            const SizedBox(height: FieldSpace.s3),
            FilledButton(
              onPressed: _entry.birth != null && _entry.ready ? () => Navigator.of(context).pop(_entry.birth) : null,
              child: const Text('Use this'),
            ),
          ],
        ),
      ),
    ),
  );
}
