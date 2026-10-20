import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../sync/clock.dart';
import '../../sync/sync_controller.dart';
import 'sync_labels.dart';

class _Card extends StatelessWidget {
  const _Card({required this.icon, required this.color, required this.soft, required this.children});
  final IconData icon;
  final Color color;
  final Color soft;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    child: Container(
      padding: const EdgeInsets.all(FieldSpace.s4),
      decoration: BoxDecoration(
        color: soft,
        border: Border.all(color: color, width: 1.5),
        borderRadius: BorderRadius.circular(FieldRadius.lg),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(child: Icon(icon, color: color, size: 24)),
          const SizedBox(width: FieldSpace.s3),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
          ),
        ],
      ),
    ),
  );
}

/// Whether everything is on the server, and if not, what happens next.
class SyncStatusCard extends StatelessWidget {
  const SyncStatusCard({super.key, required this.snapshot, required this.onSyncNow});
  final SyncSnapshot snapshot;
  final VoidCallback? onSyncNow;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final waiting = snapshot.unsynced.total;
    final String title;
    final String detail;
    if (waiting == 0) {
      title = 'All saved to the server';
      detail = snapshot.lastSyncedAt == null
          ? 'Nothing is waiting on this phone.'
          : 'Last synced at ${timeOfDay(context, snapshot.lastSyncedAt!)}.';
    } else if (snapshot.syncing) {
      title = 'Syncing';
      detail = '${plural(waiting, 'change')} left to send.';
    } else if (snapshot.offline) {
      title = 'No connection';
      detail =
          '${plural(waiting, 'change')} saved on this phone. ${waiting == 1 ? 'It syncs' : 'They sync'} when you’re back in signal.';
    } else {
      title = '${plural(waiting, 'change')} waiting to sync';
      final next = snapshot.nextAttempt;
      detail = next == null
          ? 'Saved on this phone.'
          : 'Saved on this phone. Trying again at ${timeOfDay(context, next)}.';
    }
    final done = waiting == 0;
    return _Card(
      icon: done ? LucideIcons.cloudCheck : (snapshot.offline ? LucideIcons.cloudOff : LucideIcons.cloudUpload),
      color: done ? c.good : c.info,
      soft: done ? c.goodSoft : c.infoSoft,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(title, style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
        const SizedBox(height: FieldSpace.s1),
        Text(detail, style: text.bodyLarge),
        if (snapshot.clock.state == ClockState.unverified && !done) ...[
          const SizedBox(height: FieldSpace.s1),
          Text('Times are checked against the server at the next sync.', style: text.bodyMedium),
        ],
        if (snapshot.inReview > 0) ...[
          const SizedBox(height: FieldSpace.s2),
          Text(
            '${plural(snapshot.inReview, 'record was', 'records were')} sent to a Program Admin to review.',
            style: text.bodyMedium,
          ),
        ],
        if (!done) ...[
          const SizedBox(height: FieldSpace.s3),
          OutlinedButton(onPressed: snapshot.syncing ? null : onSyncNow, child: const Text('Sync now')),
        ],
      ],
    );
  }
}

/// Module 9 (decided Oct 12): charting pauses while the clock is more than 5 minutes off, and the
/// person is shown how to fix it. Saved data keeps syncing.
class ClockPausedCard extends StatelessWidget {
  const ClockPausedCard({super.key, required this.status, required this.onCheckAgain});
  final ClockStatus status;
  final VoidCallback onCheckAgain;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final offset = status.offset ?? Duration.zero;
    return _Card(
      icon: LucideIcons.clockAlert,
      color: c.critical,
      soft: c.criticalSoft,
      children: [
        Semantics(
          liveRegion: true,
          header: true,
          child: Text('Charting is paused', style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ),
        const SizedBox(height: FieldSpace.s1),
        Text(
          'This phone’s clock is ${offsetText(offset)} the server. Medication times must be exact, so new charting '
          'waits until the clock is right. Records already saved keep syncing.',
          style: text.bodyLarge,
        ),
        const SizedBox(height: FieldSpace.s2),
        Text('Open Settings, then Date & time, and turn on “Set automatically”.', style: text.bodyLarge),
        const SizedBox(height: FieldSpace.s3),
        FilledButton(onPressed: onCheckAgain, child: const Text('Check again')),
      ],
    );
  }
}

/// The Home badge for rejections and conflicts (module 9: "The app badges the Home screen while
/// anything sits in Needs attention").
class NeedsAttentionTile extends StatelessWidget {
  const NeedsAttentionTile({super.key, required this.count, required this.onOpen});
  final int count;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    return Material(
      color: c.warningSoft,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: c.warning, width: 1.5),
        borderRadius: BorderRadius.circular(FieldRadius.lg),
      ),
      child: ListTile(
        minTileHeight: FieldTap.large,
        leading: ExcludeSemantics(child: Icon(LucideIcons.triangleAlert, color: c.warning)),
        title: Text('Needs attention', style: Theme.of(context).textTheme.titleMedium),
        subtitle: Text(plural(count, 'item')),
        trailing: Badge(label: Text('$count')),
        onTap: onOpen,
      ),
    );
  }
}
