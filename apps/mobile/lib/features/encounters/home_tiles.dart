import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api/generated/api.dart' as wire;
import '../../app_providers.dart' show syncControllerProvider;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../encounters/encounter_api.dart' show HomeTiles, SecondAct;
import '../../encounters/encounter_services.dart';
import '../../sync/local_store.dart' show ChartingPaused;
import '../../sync/sync_controller.dart' show SyncController;
import 'encounter_labels.dart';
import 'encounter_widgets.dart' show encountersOpen;
import 'notes_to_finish_screen.dart' show notesToFinishLocation;
import 'queue_screen.dart' show queueLocation;

/// Home's tiles under Needs attention (lifecycle 9.9): **Notes to finish** while the person has a
/// draft they act as the author of, and **Waiting for your co-signature** and **Waiting for
/// attestation** to a role that charts with a credential that signs, or attests, with the server's
/// numbers when online and "Connect to see notes waiting for you" offline.
///
/// Numbers only: no patient is named, so nothing is logged (5.6). The server's counts are asked when
/// Home shows, after each sync, and when Home is on top again; a change made here counts the
/// person's drafts again against the server's last answer, asking it nothing.
class EncounterTiles extends ConsumerWidget {
  const EncounterTiles({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final services = ref.watch(encounterServicesProvider);
    final sync = ref.watch(syncControllerProvider);
    if (services == null || !encountersOpen(sync, services)) return const SizedBox.shrink();
    // New services for another team or person: the tiles start again.
    return _Tiles(key: ObjectKey(services), services: services);
  }
}

class _Tiles extends ConsumerStatefulWidget {
  const _Tiles({super.key, required this.services});
  final EncounterServices services;

  @override
  ConsumerState<_Tiles> createState() => _TilesState();
}

class _TilesState extends ConsumerState<_Tiles> {
  late final SyncController _sync;
  HomeTiles? _tiles;

  /// The server's last counts: null offline, or before it answered.
  wire.HomeCounts? _counts;

  /// A sync was running at the last change: its end asks the server again.
  bool _syncing = false;
  bool _covered = false;
  int _seq = 0;

  EncounterServices get _s => widget.services;

  @override
  void initState() {
    super.initState();
    _sync = ref.read(syncControllerProvider);
    _syncing = _sync.snapshot.syncing;
    _s.addListener(_changed);
    _sync.addListener(_changed);
    unawaited(_ask());
  }

  @override
  void dispose() {
    _s.removeListener(_changed);
    _sync.removeListener(_changed);
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final current = ModalRoute.of(context)?.isCurrent ?? true;
    if (current && _covered) unawaited(_ask());
    _covered = !current;
  }

  /// A sync that finished asks the server again; any other change counts the phone's drafts again.
  void _changed() {
    if (!mounted || !encountersOpen(_sync, _s)) return;
    final syncing = _sync.snapshot.syncing;
    final ended = _syncing && !syncing;
    _syncing = syncing;
    if (ended) return unawaited(_ask());
    final tiles = _tiles;
    if (tiles == null) return;
    try {
      final notes = _s.notesToFinish.count(_counts);
      if (notes != tiles.notesToFinish) {
        setState(
          () => _tiles = HomeTiles(
            online: tiles.online,
            notesToFinish: notes,
            showsCosign: tiles.showsCosign,
            cosignWaiting: tiles.cosignWaiting,
            showsAttestation: tiles.showsAttestation,
            attestationWaiting: tiles.attestationWaiting,
          ),
        );
      }
    } on ChartingPaused {
      setState(() => _tiles = null);
    }
  }

  Future<void> _ask() async {
    final seq = ++_seq;
    if (!encountersOpen(_sync, _s)) return;
    try {
      final tiles = await _s.api.homeTiles(
        notesToFinish: (counts) {
          if (seq == _seq) _counts = counts;
          return _s.notesToFinish.count(counts);
        },
      );
      if (mounted && seq == _seq) setState(() => _tiles = tiles);
    } on ChartingPaused {
      // Nothing about the person's notes shows while the store is frozen.
      if (mounted && seq == _seq) setState(() => _tiles = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tiles = _tiles;
    if (tiles == null || _s.store.frozen) return const SizedBox.shrink();
    final (:notes, :overdue) = tiles.notesToFinish;
    String waiting(int? count) => count == null ? connectForQueueTile : visitsWaitingText(count);
    final shown = [
      if (notes > 0)
        _Tile(
          icon: LucideIcons.squarePen,
          title: notesToFinishText(notes, overdue),
          warn: overdue > 0,
          onOpen: () => unawaited(context.push(notesToFinishLocation)),
        ),
      if (tiles.showsCosign)
        _Tile(
          icon: LucideIcons.penLine,
          title: cosignQueueTitle,
          subtitle: waiting(tiles.cosignWaiting),
          count: tiles.cosignWaiting,
          onOpen: () => unawaited(context.push(queueLocation(SecondAct.cosign))),
        ),
      if (tiles.showsAttestation)
        _Tile(
          icon: LucideIcons.badgeCheck,
          title: attestationQueueTitle,
          subtitle: waiting(tiles.attestationWaiting),
          count: tiles.attestationWaiting,
          onOpen: () => unawaited(context.push(queueLocation(SecondAct.attest))),
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final t in shown) ...[t, const SizedBox(height: FieldSpace.s4)],
      ],
    );
  }
}

/// A Home tile, as Needs attention's is drawn: one button, its words in full.
class _Tile extends StatelessWidget {
  const _Tile({
    required this.icon,
    required this.title,
    required this.onOpen,
    this.subtitle,
    this.count,
    this.warn = false,
  });
  final IconData icon;
  final String title;
  final String? subtitle;
  final int? count;
  final bool warn;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final n = count;
    return Material(
      color: warn ? c.warningSoft : c.infoSoft,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: warn ? c.warning : c.info, width: 1.5),
        borderRadius: BorderRadius.circular(FieldRadius.lg),
      ),
      child: ListTile(
        minTileHeight: FieldTap.large,
        leading: ExcludeSemantics(child: Icon(icon, color: warn ? c.warning : c.info)),
        title: Text(title, style: Theme.of(context).textTheme.titleMedium),
        subtitle: subtitle == null ? null : Text(subtitle!),
        // The number is in the subtitle's words; the badge only repeats it.
        trailing: n == null || n == 0 ? null : ExcludeSemantics(child: Badge(label: Text('$n'))),
        onTap: onOpen,
      ),
    );
  }
}
