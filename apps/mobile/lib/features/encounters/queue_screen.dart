import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/form_bits.dart' show NoticeMessage;
import '../../encounters/encounter_api.dart' show EncounterRequestFailed, QueueRow, SecondAct;
import '../../encounters/encounter_services.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_controller.dart' show SyncController;
import '../patients/patient_labels.dart' show longDate;
import '../patients/patient_widgets.dart' show FrozenNotice, WideButton;
import '../sync/sync_labels.dart' show timeOfDay;
import 'encounter_labels.dart';
import 'encounter_widgets.dart';
import 'visit_screen.dart' show visitLocation;

/// Where each queue is: no patient in it (lifecycle 10.2).
String queueLocation(SecondAct act) => switch (act) {
  SecondAct.cosign => '/queues/cosign',
  SecondAct.attest => '/queues/attestation',
};

/// A queue's fixed title (10.2).
String queueTitle(SecondAct act) => switch (act) {
  SecondAct.cosign => cosignQueueTitle,
  SecondAct.attest => attestationQueueTitle,
};

/// **Waiting for your co-signature** and **Waiting for attestation** (lifecycle 5.4, 9.9): one row per
/// visit, oldest first, with the patient's preferred name, the note types that wait, each by its
/// author, and when the visit started. A row opens the visit (9.7), where **Co-sign** or **Attest**
/// acts on every waiting note of it the person may act on. A note the person can't act on says why
/// as far as the queue can tell: theirs, or for a reason the visit shows.
///
/// Online only: the server lists the queue and logs the patients it shows (`cosign_queue.viewed`,
/// `attestation_queue.viewed`) in its own transaction. It is asked when the screen opens, when the
/// screen is on top again (back from a visit just signed), and on pull to refresh.
class QueueScreen extends StatelessWidget {
  const QueueScreen({super.key, required this.act});
  final SecondAct act;

  @override
  Widget build(BuildContext context) => EncountersGate(
    title: queueTitle(act),
    builder: (context, services) => _Queue(services: services, act: act),
  );
}

class _Queue extends ConsumerStatefulWidget {
  const _Queue({required this.services, required this.act});
  final EncounterServices services;
  final SecondAct act;

  @override
  ConsumerState<_Queue> createState() => _QueueState();
}

class _QueueState extends ConsumerState<_Queue> {
  late final SyncController _sync;
  List<QueueRow>? _rows;
  String? _problem;

  /// Each answer counts, so a second identical refusal is a new live region (review finding PX-2).
  int _tries = 0;
  String? _refused;
  bool _asking = false;
  bool _covered = false;
  int _seq = 0;

  /// The team's listed note types' titles, by key.
  var _titles = <String, String>{};

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    unawaited(_ask());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final current = ModalRoute.of(context)?.isCurrent ?? true;
    if (current && _covered) unawaited(_ask());
    _covered = !current;
  }

  Future<void> _ask() async {
    final seq = ++_seq;
    if (!encountersOpen(_sync, _s)) return;
    setState(() => _asking = true);
    try {
      _titles = {for (final t in await _s.noteTypes()) t.key: t.title};
      final rows = await (widget.act == SecondAct.cosign ? _s.api.cosignQueue() : _s.api.attestationQueue());
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = rows;
        _problem = null;
        _refused = null;
      });
    } on EncounterRequestFailed catch (e) {
      if (!mounted || seq != _seq) return;
      // What was listed before stays only while it can be read again: without signal it goes.
      setState(() {
        _rows = null;
        _problem = e.message;
        _tries++;
      });
    } on ChartingPaused catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = null;
        _refused = e.message;
      });
    } finally {
      if (mounted && seq == _seq) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final rows = _rows;
    Widget body;
    if (!encountersOpen(_sync, _s)) {
      body = const SizedBox.shrink();
    } else if (_s.store.frozenMessage ?? _refused case final frozen?) {
      body = FrozenNotice(frozen);
    } else if (rows == null && _problem == null) {
      body = const Center(child: CircularProgressIndicator(semanticsLabel: loadingList));
    } else {
      body = RefreshIndicator(
        onRefresh: _ask,
        child: ListView(
          padding: const EdgeInsets.all(FieldSpace.s4),
          children: [
            if (_problem case final problem?) ...[
              Semantics(key: ValueKey('queue.problem.$_tries'), liveRegion: true, child: NoticeMessage(problem)),
              const SizedBox(height: FieldSpace.s3),
              WideButton(label: tryAgainAction, onPressed: _asking ? null : () => unawaited(_ask())),
            ] else if (rows!.isEmpty)
              Text(noVisitsWaiting, style: text.bodyLarge)
            else
              for (final row in rows) ...[
                _QueueRow(
                  row: row,
                  act: widget.act,
                  me: _s.user.userId,
                  titles: _titles,
                  onOpen: () => unawaited(context.push(visitLocation(row.encounterId))),
                ),
                const SizedBox(height: FieldSpace.s2),
              ],
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(queueTitle(widget.act))),
      body: body,
    );
  }
}

/// One visit of a queue: the patient, when the visit started, and each waiting note by its author,
/// with who signed or attested it before a correction sent it back, and why the person can't act on
/// it where they can't.
class _QueueRow extends StatelessWidget {
  const _QueueRow({required this.row, required this.act, required this.me, required this.titles, required this.onOpen});
  final QueueRow row;
  final SecondAct act;
  final String me;
  final Map<String, String> titles;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final name = row.preferredName ?? noNameRecorded;
    final when = visitStartedText('${longDate(row.startedAt)} at ${timeOfDay(context, row.startedAt)}');
    final notes = [
      for (final n in row.notes)
        [
          queueNoteText(titles[n.noteTypeKey] ?? untitledNote, n.author),
          if (n.signedBefore case final p?) signedBeforeText(p),
          if (n.attestedBefore case final p?) attestedBeforeText(p),
          // Why someone else has to, as the server says, in the visit screen's words (5.4).
          if (!n.canAct)
            heldBecauseText(n.heldBecause, cosign: act == SecondAct.cosign) ??
                cantActText(act == SecondAct.cosign ? cosignAction : attestAction),
        ],
    ];
    return Semantics(
      container: true,
      button: true,
      label: [name, when, for (final n in notes) n.join('. ')].join(', '),
      hint: visitOpensHint,
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
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: text.titleMedium),
                  Text(when, style: text.bodyMedium?.copyWith(color: c.inkMuted)),
                  for (final n in notes) ...[
                    const SizedBox(height: FieldSpace.s1),
                    Text(n.first, style: text.bodyLarge),
                    for (final line in n.skip(1)) Text(line, style: text.bodyMedium),
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
