import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' as wire;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart' show ErrorMessage, NoticeMessage;
import '../../design/widgets/status_chip.dart';
import '../../encounters/encounter_api.dart' show EncounterRequestFailed;
import '../../encounters/encounter_services.dart';
import '../../encounters/notes_to_finish.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_controller.dart' show SyncController;
import '../patients/patient_labels.dart' show longDate;
import '../patients/patient_widgets.dart' show FrozenNotice;
import '../sync/sync_labels.dart' show timeOfDay;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'note_type_list.dart' show noteLocation;

/// Where Notes to finish is: no patient in it (lifecycle 10.2).
const notesToFinishLocation = '/notes-to-finish';

/// **Notes to finish** (lifecycle 9.9, 5.6; Home's first tile): the drafts the person acts as the
/// author of, oldest visit first, each with the patient's preferred name, the note type and when the
/// visit started; a row opens the note. Online, the server's list adds the drafts that are not on
/// this phone, which open only with signal; offline the list is the phone's own and says so.
///
/// `NotesToFinish` holds the list's rules and logs what each read adds (`notes_to_finish.viewed`) in
/// the read's transaction, so a read that can't be logged shows nothing. The server is asked when
/// the screen opens and when it is on top again; a change made here or a sync reads the phone's copy
/// again with the server's last answer, asking the server nothing.
class NotesToFinishScreen extends StatelessWidget {
  const NotesToFinishScreen({super.key});

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: notesToFinishTitle,
    builder: (context, services) => _NotesToFinish(services: services),
  );
}

class _NotesToFinish extends ConsumerStatefulWidget {
  const _NotesToFinish({required this.services});
  final EncounterServices services;

  @override
  ConsumerState<_NotesToFinish> createState() => _NotesToFinishState();
}

class _NotesToFinishState extends ConsumerState<_NotesToFinish> {
  late final SyncController _sync;
  NotesToFinishList? _list;

  /// The server's last answer: null offline, or before it answered.
  List<wire.NoteToFinish>? _server;
  String? _refused;
  String? _problem;
  final _shown = <String>{};
  bool _covered = false;
  bool _opening = false;
  int _seq = 0;

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _s.addListener(_reread);
    _sync.addListener(_reread);
    unawaited(_ask());
  }

  @override
  void dispose() {
    _s.removeListener(_reread);
    _sync.removeListener(_reread);
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // On top again (back from a note): the server is asked again, as at the open.
    final current = ModalRoute.of(context)?.isCurrent ?? true;
    if (current && _covered) unawaited(_ask());
    _covered = !current;
  }

  /// The server's list, then the read; without signal, or refused, the phone's own.
  Future<void> _ask() async {
    final seq = ++_seq;
    if (!encountersOpen(_sync, _s)) return;
    List<wire.NoteToFinish>? server;
    try {
      server = await _s.api.notesToFinish();
    } on EncounterRequestFailed {
      server = null;
    } on ChartingPaused {
      server = null;
    }
    if (!mounted || seq != _seq) return;
    _server = server;
    _read();
  }

  void _reread() {
    if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) return;
    _read();
  }

  void _read() {
    if (!encountersOpen(_sync, _s)) return;
    try {
      final list = _s.notesToFinish.read(server: _server, shownBefore: {..._shown});
      _shown.addAll(list.rows.map((r) => r.noteId));
      setState(() {
        _list = list;
        _refused = null;
      });
    } on ChartingPaused catch (e) {
      // What can't be logged isn't shown (D21).
      setState(() {
        _list = null;
        _refused = e.message;
      });
    }
  }

  /// Opens [row]'s note; one that is not on this phone is brought from the server first, with its
  /// visit, as the visit screen brings one (9.9: it needs a connection).
  Future<void> _open(NoteToFinishRow row) async {
    if (_s.store.record(row.noteId) == null) {
      setState(() {
        _opening = true;
        _problem = null;
      });
      final found = await fetchNote(_s, row.noteId, encounterId: row.encounterId);
      if (!mounted) return;
      setState(() => _opening = false);
      if (!found) return setState(() => _problem = noteNotOnPhone);
    }
    if (mounted) unawaited(context.push(noteLocation(row.noteId)));
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final list = _list;
    Widget body;
    if (!encountersOpen(_sync, _s)) {
      body = const SizedBox.shrink();
    } else if (_s.store.frozenMessage ?? _refused case final frozen?) {
      body = FrozenNotice(frozen);
    } else if (list == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = RefreshIndicator(
        onRefresh: _ask,
        child: ListView(
          padding: const EdgeInsets.all(FieldSpace.s4),
          children: [
            if (!list.online) ...[const NoticeMessage(onlyThisPhone), const SizedBox(height: FieldSpace.s3)],
            if (_problem != null) ...[ErrorMessage(_problem!), const SizedBox(height: FieldSpace.s3)],
            if (list.rows.isEmpty) Text(noNotesToFinish, style: text.bodyLarge),
            for (final row in list.rows) ...[
              _NoteRow(row: row, onOpen: _opening ? null : () => unawaited(_open(row))),
              const SizedBox(height: FieldSpace.s2),
            ],
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text(notesToFinishTitle)),
      body: body,
    );
  }
}

/// One note to finish: the patient by preferred name, the note type, when the visit started, and
/// "Older than a day", "On this phone only" or "Opens with a connection" where they apply.
class _NoteRow extends StatelessWidget {
  const _NoteRow({required this.row, required this.onOpen});
  final NoteToFinishRow row;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final name = row.patientId == null ? noPatientText : (row.patientName ?? noNameRecorded);
    final title = row.title ?? untitledNote;
    final when = switch (row.startedAt) {
      final DateTime at => visitStartedText('${longDate(at)} at ${timeOfDay(context, at)}'),
      null => startNotKnown,
    };
    final marks = [
      if (row.overdue) olderThanADay,
      if (row.notSynced) onThisPhoneOnly,
      if (!row.onPhone) opensWithConnection,
    ];
    final open = onOpen;
    // The tap is on this node itself, so Switch Access and Voice Access can activate it.
    return Semantics(
      container: true,
      button: true,
      enabled: open != null,
      label: [name, title, when, ...marks].join(', '),
      excludeSemantics: true,
      onTap: open,
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(FieldRadius.md),
          onTap: open,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: FieldTap.large),
            child: Padding(
              padding: const EdgeInsets.all(FieldSpace.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: text.titleMedium),
                  Text(title, style: text.bodyLarge),
                  Text(when, style: text.bodyMedium?.copyWith(color: c.inkMuted)),
                  if (marks.isNotEmpty) ...[
                    const SizedBox(height: FieldSpace.s1),
                    Wrap(
                      spacing: FieldSpace.s2,
                      runSpacing: FieldSpace.s1,
                      children: [
                        if (row.overdue)
                          const StatusChip(label: olderThanADay, icon: LucideIcons.clockAlert, tone: ChipTone.warning),
                        if (row.notSynced)
                          const StatusChip(label: onThisPhoneOnly, icon: LucideIcons.smartphone, tone: ChipTone.info),
                        if (!row.onPhone)
                          const StatusChip(label: opensWithConnection, icon: LucideIcons.cloud, tone: ChipTone.info),
                      ],
                    ),
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
