import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app_providers.dart' show sessionProvider, syncControllerProvider, wallClockProvider;
import '../../auth/session_controller.dart' show Unlocked;
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../design/widgets/flag_pill.dart';
import '../../design/widgets/form_bits.dart' show NoticeMessage;
import '../../design/widgets/status_chip.dart';
import '../../patients/access.dart' show mayViewProblems;
import '../../presets/models.dart';
import '../../presets/preset_store.dart';
import '../../sync/sync_engine.dart' show RefreshReason;
import '../patients/patient_labels.dart' show shortDate;
import '../patients/patient_widgets.dart' show FrozenNotice;
import '../sync/sync_labels.dart' show timeOfDay;

/// Where Team setup is: fixed words, no patient.
const teamSetupLocation = '/team-setup';

const teamSetupTitle = 'Team setup';

/// Where the phone holds no copy of the team's presets (phase 5 design 6.1): a team first opened
/// offline. Team setup, the flags sheet and intake's risk level each say it.
const setupNotDownloaded = 'Your team’s setup hasn’t downloaded yet. Connect to finish.';

const teamSetupRowDetail = 'Orders, bundles and flags';
const ordersHeading = 'Orders';
const bundlesHeading = 'Bundles';
const flagsHeading = 'Flags';

/// The two tiers' names, as the portal's Flags page and the flags sheet name them.
const riskLevelHeading = 'Risk level';
const conditionsHeading = 'Conditions';

const noItemsText = 'No items on your team’s list.';
const noBundlesText = 'No bundles on your team’s list.';
const noRiskLevelsText = 'No risk levels on your team’s list.';
const noConditionsText = 'No conditions on your team’s list.';

/// The heading of the items whose category this phone doesn't hold.
const otherItemsHeading = 'Other items';

/// A bundle's line naming an item this phone doesn't hold.
const itemNotHeldText = 'An item not on this phone';

/// A bundle's line whose item was removed: applying the bundle leaves it out.
const itemRemovedText = 'no longer on the team’s list';
const sensitiveFlagText = 'Sensitive';

/// "Updated 10:42 AM" today, "Updated Nov 20 at 10:42 AM" another day: how old the copy is
/// (12.1, risk 4).
String updatedText(BuildContext context, DateTime at, DateTime now) {
  final local = at.toLocal();
  final today = now.toLocal();
  final sameDay = local.year == today.year && local.month == today.month && local.day == today.day;
  return sameDay ? 'Updated ${timeOfDay(context, at)}' : 'Updated ${shortDate(at, today)} at ${timeOfDay(context, at)}';
}

/// **Team setup** (phase 5 design 8.2; a row on Home): the team's presets as this phone holds
/// them, read only. The Orders items by category, the bundles with their lines and the flags by
/// tier, each active one; a removed preset is held only for its name, and shows only where an
/// active one names it. Presets name no patient, so opening it logs nothing. Offline it shows the
/// copy held, with when it was updated; before the team's first pull it says to connect. Pull to
/// refresh runs the team's refreshers, the presets' pull among them.
///
/// A sensitive flag is listed only to a person who may see a sensitive problem, by the flag rule
/// that hides one from every other read (6.2, D136).
class TeamSetupScreen extends ConsumerWidget {
  const TeamSetupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncControllerProvider);
    final session = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text(teamSetupTitle)),
      body: ListenableBuilder(
        listenable: sync,
        builder: (context, _) {
          final store = sync.store;
          // A lock or a sign-out closed the team's database; the route goes next frame.
          if (store == null) return const SizedBox.shrink();
          // The team's data is no longer this person's while it is handed over: none of it shows.
          if (store.frozenMessage case final frozen?) return FrozenNotice(frozen);
          final permissions = switch (session.state) {
            Unlocked(:final user) => user.team?.permissions ?? const <String>[],
            _ => const <String>[],
          };
          final copy = PresetStore(store);
          return RefreshIndicator(
            onRefresh: () => sync.refreshNow(reason: RefreshReason.manual),
            child: ListView(
              padding: const EdgeInsets.all(FieldSpace.s4),
              physics: const AlwaysScrollableScrollPhysics(),
              children: copy.downloaded
                  ? _Setup(
                      copy.presets(),
                      updatedAt: copy.updatedAt,
                      now: ref.read(wallClockProvider)(),
                      seesSensitive: _seesSensitiveFlags(permissions),
                    ).children(context)
                  : const [NoticeMessage(setupNotDownloaded)],
            ),
          );
        },
      ),
    );
  }
}

/// Home's row to Team setup, below phase 4's tiles with the team's own actions: a button with its
/// words in full.
class TeamSetupRow extends StatelessWidget {
  const TeamSetupRow({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: c.lineStrong, width: 1.5),
        borderRadius: BorderRadius.circular(FieldRadius.lg),
      ),
      child: ListTile(
        minTileHeight: FieldTap.large,
        leading: ExcludeSemantics(child: Icon(LucideIcons.clipboardList, color: c.ink)),
        title: Text(teamSetupTitle, style: Theme.of(context).textTheme.titleMedium),
        subtitle: const Text(teamSetupRowDetail),
        trailing: ExcludeSemantics(child: Icon(LucideIcons.chevronRight, color: c.ink)),
        onTap: () => unawaited(context.push(teamSetupLocation)),
      ),
    );
  }
}

/// Whether a person with [permissions] sees a sensitive flag: the flag rule's reader half (6.2,
/// D136), the server's projection for a sensitive problem (`mayViewProblems` and
/// `patients.view_sensitive`).
bool _seesSensitiveFlags(List<String> permissions) =>
    mayViewProblems(permissions) && permissions.contains('patients.view_sensitive');

/// A to Z by name whatever its case, then by ID, so the order never rests on the copy's.
int _byName((HeldPreset, PresetBody) a, (HeldPreset, PresetBody) b) {
  final byName = a.$2.name.toLowerCase().compareTo(b.$2.name.toLowerCase());
  return byName != 0 ? byName : a.$1.id.compareTo(b.$1.id);
}

/// Categories in their place in the list, as the pages list them.
int _byPlace((HeldPreset, OrderCategoryBody) a, (HeldPreset, OrderCategoryBody) b) =>
    a.$2.sort != b.$2.sort ? a.$2.sort.compareTo(b.$2.sort) : _byName(a, b);

/// Flags in their place in their tier, highest risk first.
int _byRank((HeldPreset, FlagBody) a, (HeldPreset, FlagBody) b) =>
    a.$2.rank != b.$2.rank ? a.$2.rank.compareTo(b.$2.rank) : _byName(a, b);

/// What the screen lists, read from the copy once per build.
class _Setup {
  _Setup(List<HeldPreset> held, {required this.updatedAt, required this.now, required this.seesSensitive})
    : byId = {for (final p in held) p.id: p},
      active = [
        for (final p in held)
          if (p.state == PresetState.active) p,
      ];

  final Map<String, HeldPreset> byId;
  final List<HeldPreset> active;
  final DateTime? updatedAt;
  final DateTime now;
  final bool seesSensitive;

  Iterable<(HeldPreset, B)> _of<B extends PresetBody>() sync* {
    for (final p in active) {
      if (p.body case final B body) yield (p, body);
    }
  }

  /// The active items by category, A to Z: the categories in their place, each that holds an
  /// active item, then under "Other items" any whose category this phone doesn't hold as an
  /// active one, so no item is left out.
  List<({String id, String heading, List<(HeldPreset, ItemBody)> items})> get orders {
    final byCategory = <String, List<(HeldPreset, ItemBody)>>{};
    for (final item in _of<ItemBody>()) {
      (byCategory[item.$2.categoryId] ??= []).add(item);
    }
    final categories = [
      for (final category in _of<OrderCategoryBody>())
        if (byCategory.containsKey(category.$1.id)) category,
    ]..sort(_byPlace);
    final placed = {for (final (p, _) in categories) p.id};
    final other = [
      for (final MapEntry(key: id, value: items) in byCategory.entries)
        if (!placed.contains(id)) ...items,
    ];
    return [
      for (final (p, body) in categories) (id: p.id, heading: body.name, items: byCategory[p.id]!..sort(_byName)),
      if (other.isNotEmpty) (id: 'other', heading: otherItemsHeading, items: other..sort(_byName)),
    ];
  }

  List<(HeldPreset, BundleBody)> get bundles => _of<BundleBody>().toList()..sort(_byName);

  /// The active flags of [tier] this person may see.
  List<(HeldPreset, FlagBody)> flags(FlagTier tier) => [
    for (final (p, body) in _of<FlagBody>())
      if (body.tier == tier && (!body.sensitive || seesSensitive)) (p, body),
  ]..sort(_byRank);

  List<Widget> children(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final c = context.field;
    final orders = this.orders;
    final bundles = this.bundles;
    final updated = updatedAt;
    return [
      if (updated != null) Text(updatedText(context, updated, now), style: text.bodyLarge?.copyWith(color: c.inkMuted)),
      const SizedBox(height: FieldSpace.s4),
      const _Heading(ordersHeading),
      if (orders.isEmpty) const _Empty(noItemsText),
      for (final group in orders)
        _Group(
          key: ValueKey('teamSetup.category.${group.id}'),
          heading: group.heading,
          rows: [for (final (p, item) in group.items) _ItemRow(key: ValueKey('teamSetup.item.${p.id}'), item: item)],
        ),
      const SizedBox(height: FieldSpace.s5),
      const _Heading(bundlesHeading),
      if (bundles.isEmpty) const _Empty(noBundlesText),
      for (final (p, bundle) in bundles)
        _BundleCard(key: ValueKey('teamSetup.bundle.${p.id}'), bundle: bundle, items: byId),
      const SizedBox(height: FieldSpace.s5),
      const _Heading(flagsHeading),
      for (final (tier, heading, empty) in [
        (FlagTier.primary, riskLevelHeading, noRiskLevelsText),
        (FlagTier.secondary, conditionsHeading, noConditionsText),
      ])
        _Group(
          key: ValueKey('teamSetup.flags.${tier.name}'),
          heading: heading,
          empty: empty,
          rows: [for (final (p, flag) in flags(tier)) _FlagRow(key: ValueKey('teamSetup.flag.${p.id}'), flag: flag)],
        ),
    ];
  }
}

/// A section's heading: Orders, Bundles, Flags.
class _Heading extends StatelessWidget {
  const _Heading(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: FieldSpace.s2),
    child: Semantics(container: true, header: true, child: Text(text, style: Theme.of(context).textTheme.titleLarge)),
  );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;

  @override
  Widget build(BuildContext context) =>
      Semantics(container: true, child: Text(text, style: Theme.of(context).textTheme.bodyLarge));
}

/// A heading of its own (a category, a tier) over a card of rows, or [empty] when there are none.
class _Group extends StatelessWidget {
  const _Group({super.key, required this.heading, required this.rows, this.empty});
  final String heading;
  final List<Widget> rows;
  final String? empty;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(top: FieldSpace.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(container: true, header: true, child: Text(heading, style: text.titleMedium)),
          const SizedBox(height: FieldSpace.s2),
          if (rows.isEmpty)
            _Empty(empty ?? '')
          else
            DecoratedBox(
              decoration: BoxDecoration(
                color: c.surface,
                border: Border.all(color: c.line),
                borderRadius: BorderRadius.circular(FieldRadius.md),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final (i, row) in rows.indexed) ...[
                    if (i > 0) const Divider(),
                    Padding(padding: const EdgeInsets.all(FieldSpace.s3), child: row),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// An item: its name, then what it is in a line, as the portal's list says it ("Counted in tablet
/// · Medical · Lot and expiry · Records a number in mg/dL").
class _ItemRow extends StatelessWidget {
  const _ItemRow({super.key, required this.item});
  final ItemBody item;

  List<String> get _parts => [
    'Counted in ${item.unit}',
    item.medical ? 'Medical' : 'Non-Medical',
    if (item.captureLot) 'Lot and expiry',
    ...switch (item.result) {
      null => const <String>[],
      ChoiceResult() => const ['Records a choice'],
      NumberResult(:final unit) => ['Records a number in $unit'],
    },
  ];

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final parts = _parts;
    return Semantics(
      container: true,
      label: [item.name, ...parts].join(', '),
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(item.name, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w700)),
          Text(parts.join(' · '), style: text.bodyMedium?.copyWith(color: context.field.inkMuted)),
        ],
      ),
    );
  }
}

/// A bundle: its name, what it is in a line as the portal's list says it ("Medical · 2 items, 1
/// optional · Asks before applying"), then each line with its item, quantity and Core ("Gauze ×
/// 2, core").
class _BundleCard extends StatelessWidget {
  const _BundleCard({super.key, required this.bundle, required this.items});
  final BundleBody bundle;
  final Map<String, HeldPreset> items;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final n = bundle.lines.length;
    final optional = bundle.lines.where((l) => !l.core).length;
    final summary = [
      bundle.medical ? 'Medical' : 'Non-Medical',
      '$n ${n == 1 ? 'item' : 'items'}${optional > 0 ? ', $optional optional' : ''}',
      if (bundle.prompt.isNotEmpty) 'Asks before applying',
    ];
    return Padding(
      padding: const EdgeInsets.only(top: FieldSpace.s3),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: c.surface,
          border: Border.all(color: c.line),
          borderRadius: BorderRadius.circular(FieldRadius.md),
        ),
        child: Padding(
          padding: const EdgeInsets.all(FieldSpace.s3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(container: true, header: true, child: Text(bundle.name, style: text.titleMedium)),
              Semantics(
                container: true,
                label: summary.join(', '),
                excludeSemantics: true,
                child: Text(summary.join(' · '), style: text.bodyMedium?.copyWith(color: c.inkMuted)),
              ),
              const SizedBox(height: FieldSpace.s2),
              for (final line in bundle.lines) _line(context, line),
            ],
          ),
        ),
      ),
    );
  }

  Widget _line(BuildContext context, BundleItem line) {
    final item = items[line.itemId];
    final name = switch (item?.body) {
      ItemBody(:final name) => name,
      _ => itemNotHeldText,
    };
    final role = line.core ? 'core' : 'optional';
    final removed = item?.state == PresetState.archived;
    return Semantics(
      container: true,
      label: '$name, quantity ${line.qty}, $role${removed ? ', $itemRemovedText' : ''}',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(top: FieldSpace.s1),
        child: Text(
          '$name × ${line.qty}, $role${removed ? ' · $itemRemovedText' : ''}',
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }
}

/// A flag: its pill, "Sensitive" on a sensitive one, and its criteria, the team's words for when
/// it is set.
class _FlagRow extends StatelessWidget {
  const _FlagRow({super.key, required this.flag});
  final FlagBody flag;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // The pill and its mark heard together, then the criteria.
        Semantics(
          container: true,
          child: Wrap(
            spacing: FieldSpace.s2,
            runSpacing: FieldSpace.s1,
            children: [
              FlagPill.of(flag),
              if (flag.sensitive) const StatusChip(label: sensitiveFlagText, icon: LucideIcons.eyeOff),
            ],
          ),
        ),
        if (flag.criteria.isNotEmpty) ...[
          const SizedBox(height: FieldSpace.s1),
          Semantics(container: true, child: Text(flag.criteria, style: text.bodyMedium)),
        ],
      ],
    );
  }
}
