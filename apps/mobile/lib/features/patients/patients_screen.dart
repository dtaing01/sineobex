import 'dart:async';
import 'dart:math' as math;

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
import '../../patients/flags.dart' show FlagView;
import '../../patients/patient_providers.dart';
import '../../patients/patient_search.dart';
import '../../patients/team_index.dart';
import '../../presets/models.dart' show FlagTier;
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_engine.dart' show RefreshReason;
import 'flag_sheet.dart';
import 'patient_labels.dart';
import 'patient_row.dart';
import 'patient_widgets.dart';
import 'sheet_gate.dart' show DialogGate, SheetGate;

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

  /// The **Risk level** and **Conditions** filters (phase 5 design 8.2; section 11, row 37): a flag
  /// ID each, from the team index on this phone. They narrow a search, and with nothing typed list
  /// the patients on this phone who carry them ([_flagged]).
  String? _riskFilter;
  Set<String> _conditionFilter = const {};

  /// The patients the filters list with nothing typed, read (and audited) once per choice, and again
  /// a page at a time by Show more.
  List<FoundPatient>? _flagged;

  /// How many more on this phone carry the filters' flags than [_flagged] shows.
  int _flaggedMore = 0;

  /// The row Show more puts focus on ([_rowFocus]), for someone who was on the button.
  String? _focusRow;
  final _rowFocus = FocusNode();
  final _moreFocus = FocusNode();

  /// The filter row's focus nodes, by control: a chooser and the chip that takes its place share
  /// one ('born', 'risk'), so focus stays on the control there after the swap (review finding X2).
  final _nodes = <String, FocusNode>{};
  FocusNode _node(String key) => _nodes[key] ??= FocusNode();

  static const _quiet = Duration(milliseconds: 600);

  PatientServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _s.addListener(_indexChanged);
    if (widget.focusSearch) WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
    _loadEmpty();
  }

  @override
  void didUpdateWidget(_PatientsBody old) {
    super.didUpdateWidget(old);
    if (!identical(old.services, widget.services)) {
      old.services.removeListener(_indexChanged);
      widget.services.addListener(_indexChanged);
      _run = null;
      _riskFilter = null;
      _conditionFilter = const {};
      _flagged = null;
      _flaggedMore = 0;
      _loadEmpty();
    }
    if (widget.focusSearch && !old.focusSearch) _focus.requestFocus();
  }

  @override
  void dispose() {
    _s.removeListener(_indexChanged);
    _debounce?.cancel();
    _query.dispose();
    _focus.dispose();
    _rowFocus.dispose();
    _moreFocus.dispose();
    for (final node in _nodes.values) {
      node.dispose();
    }
    super.dispose();
  }

  /// After the frame, for someone who was on a control that went or changed ([follow]), focus goes to
  /// the first of [nodes] the frame put on screen, as the timeline's Show earlier does (review X2).
  void _focusAfterFrame(bool follow, List<FocusNode> nodes) {
    if (!follow) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (nodes.where((n) => n.context?.mounted ?? false).firstOrNull case final to?) focusInView(to);
    });
  }

  bool get _emptyQuery => _query.text.trim().isEmpty && _born is! BirthDate;

  /// "Opened recently on this phone": a list of patients, so audited (by the call) once each time
  /// the empty state is shown, never per rebuild.
  void _loadEmpty() {
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
        if (_filtering) {
          _listFlagged();
        } else {
          _loadEmpty();
        }
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
      final run = await _s.search.search(_query.text, birth: _born, more: more, flagIds: _filterIds);
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
    final follow = focusFollows(context, _node('born'));
    final birth = await showModalBottomSheet<Birth>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => SheetGate.patients(
        services: _s,
        child: _BornSheet(today: today, initial: _born),
      ),
    );
    if (birth == null || !mounted) return;
    setState(() => _born = birth);
    _focusAfterFrame(follow, [_node('born')]);
    unawaited(_search());
  }

  void _clearBorn() {
    final follow = focusFollows(context, _node('born.clear'));
    setState(() => _born = null);
    _focusAfterFrame(follow, [_node('born')]);
    _typed(_query.text);
    if (!_emptyQuery) unawaited(_search());
  }

  Future<void> _discardDraft() async {
    final yes = await confirm(
      context,
      title: 'Discard the patient you were adding?',
      body: 'What was typed is deleted from this phone. Nothing was sent.',
      yes: 'Discard',
      // It goes with the store, as its Cancel would (D125).
      gate: (dialog) => DialogGate<bool>.patients(services: _s, child: dialog),
    );
    if (!yes || !mounted) return;
    _s.patients.discardDraft();
    setState(() {});
  }

  void _open(FoundPatient p) => unawaited(context.push('/patients/${p.patientId}'));

  /// The filters narrow only from the team index (6.1): a role that holds none (D38), or a phone
  /// whose index hasn't downloaded yet, would see every list emptied by them, so they aren't offered
  /// there, and one chosen before the index went counts for nothing.
  bool get _indexHeld => _s.index.state.eligible && _s.index.state.present;

  bool get _filtering => _indexHeld && (_riskFilter != null || _conditionFilter.isNotEmpty);

  /// The flags a search is narrowed by: the filters', while they count ([_filtering]).
  Set<String> get _filterIds => _filtering ? {?_riskFilter, ..._conditionFilter} : const {};

  /// The team index stopped being held (its expiry, or a 403 that took it): a filter chosen from it
  /// narrows nothing now, so it goes with the list it gave, as if the person had cleared it, and the
  /// tab shows its empty state again (review finding X1).
  void _indexChanged() {
    if (_indexHeld || (_riskFilter == null && _conditionFilter.isEmpty)) return;
    setState(() {
      _riskFilter = null;
      _conditionFilter = const {};
      _filtersChanged();
    });
  }

  /// A filter chosen or cleared: with nothing typed, the list of who carries the flags; with a search
  /// typed, the search again, narrowed by them as it runs, so it logs only the patients it shows (a
  /// narrowing of its last list would have logged everyone that list found).
  void _filtersChanged() {
    _listFlagged();
    if (!_emptyQuery) unawaited(_search());
  }

  /// The patients on this phone carrying the filters' flags, as the index gives them: one list, one
  /// audit entry naming who it shows and never a flag. Only with nothing typed, where it shows: a
  /// search is narrowed by them as it runs instead ([_filterIds]). With no filter, the empty state
  /// again.
  void _listFlagged() {
    if (!_filtering || !_emptyQuery) {
      _flagged = null;
      _flaggedMore = 0;
      if (!_filtering && _emptyQuery) _loadEmpty();
      return;
    }
    _flagged = const [];
    _flaggedMore = 0;
    _focusRow = null;
    _nextFlagged();
  }

  /// Show more under the flag list: the next page of who carries the flags, one list of its own,
  /// audited as what it adds (TeamIndex.withFlags). For someone on the button, which goes at the last
  /// page, focus goes to the first row the page added, or with none added to the last row, where the
  /// button was.
  void _moreFlagged() {
    final follow = focusFollows(context, _moreFocus);
    final before = _flagged?.length ?? 0;
    setState(() {
      _nextFlagged();
      final shown = _flagged ?? const <FoundPatient>[];
      _focusRow = follow && shown.isNotEmpty ? shown[math.min(before, shown.length - 1)].patientId : null;
    });
    _focusAfterFrame(follow, [_rowFocus]);
  }

  void _nextFlagged() {
    final shown = _flagged ?? const <FoundPatient>[];
    try {
      final page = _s.index.withFlags(riskLevel: _riskFilter, conditions: _conditionFilter, after: shown.length);
      final listed = {for (final p in shown) p.patientId};
      _flagged = [
        ...shown,
        for (final p in page.patients)
          if (!listed.contains(p.patientId)) p,
      ];
      _flaggedMore = page.more;
      _problem = null;
    } on ChartingPaused catch (e) {
      // What can't be logged isn't shown (D21).
      _flagged = null;
      _flaggedMore = 0;
      _problem = e.message;
    }
  }

  Future<void> _chooseRiskLevel() async {
    final follow = focusFollows(context, _node('risk'));
    final chosen = await showRiskLevelChooser(
      context,
      _s,
      levels: _s.flags.teamFlags(FlagTier.primary),
      current: _riskFilter,
      offerNone: false,
    );
    if (chosen == null || !mounted) return;
    setState(() {
      _riskFilter = chosen.flagId;
      _filtersChanged();
    });
    _focusAfterFrame(follow, [_node('risk')]);
  }

  /// Conditions chosen, from their chooser or from the chip of [from]: focus goes back to that chip
  /// while it is still chosen, else to the chooser, which stays.
  Future<void> _chooseConditions({String? from}) async {
    final opener = from == null ? _node('conditions') : _node('condition.$from');
    final follow = focusFollows(context, opener);
    final chosen = await showConditionsChooser(
      context,
      _s,
      conditions: _s.flags.teamFlags(FlagTier.secondary),
      ticked: _conditionFilter,
    );
    if (chosen == null || !mounted) return;
    setState(() {
      _conditionFilter = Set.unmodifiable(chosen);
      _filtersChanged();
    });
    _focusAfterFrame(follow, [opener, _node('conditions')]);
  }

  /// The risk level taken off: for someone on its clear button, focus goes to Risk level, the
  /// chooser that takes the chip's place.
  void _clearRiskLevel() {
    final follow = focusFollows(context, _node('risk.clear'));
    setState(() {
      _riskFilter = null;
      _filtersChanged();
    });
    _focusAfterFrame(follow, [_node('risk')]);
  }

  /// One chosen condition taken off, the others kept: for someone on its clear button, focus goes to
  /// Conditions, the chooser that stands beside them.
  void _clearCondition(String id) {
    final follow = focusFollows(context, _node('condition.$id.clear'));
    setState(() {
      _conditionFilter = Set.unmodifiable({..._conditionFilter}..remove(id));
      _filtersChanged();
    });
    _focusAfterFrame(follow, [
      _node('conditions'),
      for (final other in _conditionFilter) _node('condition.$other'),
      _node('born'),
    ]);
  }

  /// [p]'s risk level as its row shows it; none once the store froze under the read.
  FlagView? _riskLevelOf(FoundPatient p) {
    try {
      return _s.flags.riskLevelOf(p.patientId);
    } on ChartingPaused {
      return null;
    }
  }

  /// "1 patient found on this phone", once per list, never per keystroke. A search the filters
  /// narrowed to no one says they are why, and how to search everyone or add someone new, in the
  /// same live region: New patient with this name waits for a search no filter narrows (review W3).
  Widget _found(int n, {required bool onPhone, bool filtered = false}) {
    final text = Theme.of(context).textTheme;
    if (n == 0 && filtered) {
      final said = onPhone
          ? 'No one found on this phone with every flag chosen.'
          : 'No one found with every flag chosen.';
      return Semantics(
        liveRegion: true,
        container: true,
        label: '$said $_clearFlagsToSearch',
        excludeSemantics: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(said, style: text.titleMedium),
            Text(_clearFlagsToSearch, style: text.bodyLarge),
          ],
        ),
      );
    }
    return Semantics(
      liveRegion: true,
      child: Text(
        n == 0
            ? (onPhone ? 'No one found on this phone.' : 'No one found.')
            : '${n == 1 ? '1 patient' : '$n patients'} found${onPhone ? ' on this phone' : ''}',
        style: text.titleMedium,
      ),
    );
  }

  static const _clearFlagsToSearch = 'Clear the flags to search everyone, or to add someone new.';

  /// The filters' chips, beside Born: each tier's only where the team's list offers the person a flag
  /// of it, so a team without flags, or a phone without its setup, shows none; and none where the
  /// phone holds no team index to narrow by ([_indexHeld]). Each chosen flag is a chip of its own,
  /// whole at any text size, that clears alone (review finding X4); Conditions stays to choose more.
  List<Widget> _filterChips() {
    if (!_indexHeld) return const [];
    final levels = _s.flags.teamFlags(FlagTier.primary);
    final conditions = _s.flags.teamFlags(FlagTier.secondary);
    FlagView? flagOf(String id, List<FlagView> flags) => flags.where((f) => f.flagId == id).firstOrNull;
    String named(FlagView? f, {required bool spoken}) => switch (f) {
      final f? => spoken ? flagSpoken(f) : flagWords(f),
      null => flagArchivedText.toLowerCase(),
    };
    Widget conditionChip(String id) {
      final f = flagOf(id, conditions);
      return ChosenFilterChip(
        key: ValueKey('condition.$id'),
        label: '$_conditionLabel: ${named(f, spoken: false)}',
        spoken: '$_conditionLabel: ${named(f, spoken: true)}',
        clearTooltip: f == null ? 'Clear this condition' : 'Clear ${f.name}',
        onPressed: () => unawaited(_chooseConditions(from: id)),
        onCleared: () => _clearCondition(id),
        focusNode: _node('condition.$id'),
        clearFocusNode: _node('condition.$id.clear'),
      );
    }

    return [
      if (levels.isNotEmpty || _riskFilter != null)
        if (_riskFilter case final id?)
          ChosenFilterChip(
            label: '$riskLevelLabel: ${named(flagOf(id, levels), spoken: false)}',
            spoken: '$riskLevelLabel: ${named(flagOf(id, levels), spoken: true)}',
            clearTooltip: 'Clear risk level',
            onPressed: () => unawaited(_chooseRiskLevel()),
            onCleared: _clearRiskLevel,
            focusNode: _node('risk'),
            clearFocusNode: _node('risk.clear'),
          )
        else
          ActionChip(
            focusNode: _node('risk'),
            avatar: const Icon(LucideIcons.flag, size: 18),
            label: const Text(riskLevelLabel),
            tooltip: 'Find patients by risk level',
            onPressed: () => unawaited(_chooseRiskLevel()),
          ),
      if (conditions.isNotEmpty)
        ActionChip(
          focusNode: _node('conditions'),
          avatar: const Icon(LucideIcons.flag, size: 18),
          label: const Text(conditionsLabel),
          tooltip: 'Find patients by condition',
          onPressed: () => unawaited(_chooseConditions()),
        ),
      for (final id in _conditionFilter) conditionChip(id),
    ];
  }

  /// One chosen condition, as its chip names it.
  static const _conditionLabel = 'Condition';

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
          if (unreadable(sync, _s) case final instead?) return instead;
          final run = _run;
          // Narrowed by the filters as the search ran, and logged as shown.
          final hits = run?.hits ?? const <FoundPatient>[];
          final onPhone = run?.source == ListSource.phone;
          return RefreshIndicator(
            onRefresh: () => sync.refreshNow(reason: RefreshReason.manual),
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(FieldSpace.s4, FieldSpace.s4, FieldSpace.s4, FieldSpace.s3),
                  sliver: SliverToBoxAdapter(
                    child: _IndexStatus(state: _s.index.state, offline: sync.snapshot.offline || onPhone, now: now),
                  ),
                ),
                // The search box stays at the top while the results scroll under it, so a long list, or
                // one at a large text size, never takes it out of reach.
                PinnedHeaderSliver(
                  child: ColoredBox(
                    color: Theme.of(context).scaffoldBackgroundColor,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s2),
                      child: PhiField(
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
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(FieldSpace.s4, 0, FieldSpace.s4, FieldSpace.s4),
                  sliver: SliverList.list(
                    children: [
                      Wrap(
                        spacing: FieldSpace.s2,
                        runSpacing: FieldSpace.s2,
                        children: [
                          if (_born == null)
                            ActionChip(
                              focusNode: _node('born'),
                              avatar: const Icon(LucideIcons.calendar, size: 18),
                              label: const Text('Born'),
                              tooltip: 'Search by year or date of birth',
                              onPressed: () => unawaited(_chooseBorn()),
                            )
                          else
                            ChosenFilterChip(
                              label: 'Born ${_bornText(_born!)}',
                              spoken: 'Born ${_bornText(_born!)}',
                              clearTooltip: 'Clear born',
                              onPressed: () => unawaited(_chooseBorn()),
                              onCleared: _clearBorn,
                              focusNode: _node('born'),
                              clearFocusNode: _node('born.clear'),
                            ),
                          ..._filterChips(),
                        ],
                      ),
                      const SizedBox(height: FieldSpace.s3),
                      if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
                      if (run != null && !_emptyQuery) ...[
                        // Once per run, never per keystroke.
                        _found(hits.length, onPhone: onPhone, filtered: _filtering),
                        const SizedBox(height: FieldSpace.s2),
                        for (final p in hits) ...[
                          PatientRow(patient: p, today: today, riskLevel: _riskLevelOf(p), onTap: () => _open(p)),
                          const SizedBox(height: FieldSpace.s2),
                        ],
                        if (run.truncated && !run.more)
                          WideButton(
                            label: 'Show more',
                            onPressed: _searching ? null : () => unawaited(_search(more: true)),
                          ),
                        if (run.truncated && run.more)
                          Text(
                            'More people match. Add letters or a birth year to narrow it down.',
                            style: text.bodyLarge,
                          ),
                        // Only where the search found no one at all: under a filter, someone it leaves out may
                        // still be there.
                        if (run.hits.isEmpty && !_filtering && _s.mayEdit && _query.text.trim().isNotEmpty) ...[
                          const SizedBox(height: FieldSpace.s2),
                          WideButton(
                            label: 'New patient with this name',
                            icon: LucideIcons.userPlus,
                            onPressed: () =>
                                unawaited(context.push('/patients/new', extra: IntakeStart(name: _query.text.trim()))),
                          ),
                        ],
                      ] else if (_emptyQuery && _flagged != null) ...[
                        // The filters with nothing typed: who on this phone carries the flags.
                        _found(_flagged!.length, onPhone: true),
                        const SizedBox(height: FieldSpace.s2),
                        for (final p in _flagged!) ...[
                          PatientRow(
                            patient: p,
                            today: today,
                            riskLevel: _riskLevelOf(p),
                            onTap: () => _open(p),
                            focusNode: p.patientId == _focusRow ? _rowFocus : null,
                          ),
                          const SizedBox(height: FieldSpace.s2),
                        ],
                        // Everyone who carries the flags can be listed, a page at a time.
                        if (_flaggedMore > 0) ...[
                          Text(
                            _flaggedMore == 1
                                ? '1 more patient on this phone matches.'
                                : '$_flaggedMore more patients on this phone match.',
                            style: text.bodyLarge,
                          ),
                          const SizedBox(height: FieldSpace.s2),
                          WideButton(label: 'Show more', onPressed: _moreFlagged, focusNode: _moreFocus),
                        ],
                      ] else if (_emptyQuery) ...[
                        if (_s.mayEdit && _s.patients.draft() != null) ...[
                          StatusBanner(
                            icon: LucideIcons.squarePen,
                            tone: ChipTone.info,
                            text: 'Continue the patient you were adding?',
                            action: Wrap(
                              spacing: FieldSpace.s2,
                              runSpacing: FieldSpace.s2,
                              children: [
                                FilledButton(
                                  onPressed: () => unawaited(
                                    context.push('/patients/new', extra: const IntakeStart(fromDraft: true)),
                                  ),
                                  child: const Text('Continue'),
                                ),
                                OutlinedButton(
                                  onPressed: () => unawaited(_discardDraft()),
                                  child: const Text('Discard'),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: FieldSpace.s3),
                        ],
                        if (_recent case final recent? when recent.isNotEmpty) ...[
                          const SectionHeading('Opened recently on this phone'),
                          for (final p in recent) ...[
                            PatientRow(patient: p, today: today, riskLevel: _riskLevelOf(p), onTap: () => _open(p)),
                            const SizedBox(height: FieldSpace.s2),
                          ],
                        ],
                      ] else if (_searching)
                        const Center(child: CircularProgressIndicator()),
                    ],
                  ),
                ),
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

/// A filter the person chose, beside the choosers: its words, then its clear button, in the chips'
/// look. Material's chips draw a label on one line and fade the rest, and lay out a label of more
/// lines at the height of fewer, so a chosen flag's words were cut off at 200% text (review finding
/// X4): this chip's words wrap, whole, at any text size and width. Pressing them opens their chooser
/// again. Heard as an InputChip is: a button of [spoken], and a button named [clearTooltip].
class ChosenFilterChip extends StatelessWidget {
  const ChosenFilterChip({
    super.key,
    required this.label,
    required this.spoken,
    required this.clearTooltip,
    required this.onPressed,
    required this.onCleared,
    this.focusNode,
    this.clearFocusNode,
  });

  final String label;
  final String spoken;
  final String clearTooltip;
  final VoidCallback onPressed;
  final VoidCallback onCleared;

  /// The words' button's: the chooser this chip took the place of hands its node on (review X2).
  final FocusNode? focusNode;
  final FocusNode? clearFocusNode;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final style = ChipTheme.of(context).labelStyle ?? Theme.of(context).textTheme.bodyLarge;
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(FieldRadius.md),
        side: BorderSide(color: c.lineStrong, width: 1.5),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            // The press is this node's own, so Switch Access and Voice Access can activate it.
            child: Semantics(
              container: true,
              button: true,
              label: spoken,
              child: InkWell(
                focusNode: focusNode,
                onTap: onPressed,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minHeight: FieldTap.min),
                  child: Padding(
                    padding: const EdgeInsetsDirectional.fromSTEB(
                      FieldSpace.s3,
                      FieldSpace.s2,
                      FieldSpace.s1,
                      FieldSpace.s2,
                    ),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      widthFactor: 1,
                      child: ExcludeSemantics(child: Text(label, style: style)),
                    ),
                  ),
                ),
              ),
            ),
          ),
          IconButton(
            focusNode: clearFocusNode,
            tooltip: clearTooltip,
            onPressed: onCleared,
            icon: Icon(LucideIcons.x, size: 18, color: c.inkMuted),
          ),
        ],
      ),
    );
  }
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
