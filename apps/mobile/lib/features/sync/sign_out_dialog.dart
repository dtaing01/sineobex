import 'dart:async';

import 'package:flutter/material.dart';

import '../../auth/session_controller.dart';
import '../../design/tokens.dart';
import '../../sync/sync_controller.dart';
import 'sync_labels.dart';

/// Signing out with unsynced work (module 9, revised Oct 7): progress by category, then Wait or
/// Sign out anyway. Signing out anyway never deletes the unsynced data.
///
/// The session makes the final call: it erases nothing unless every team database on the phone
/// is fully synced, so this dialog only decides whether the person waits for the open team.
Future<void> signOutWithSync(BuildContext context, SessionController session, SyncController sync) async {
  final snapshot = sync.snapshot;
  if (!snapshot.open || snapshot.unsynced.total == 0) {
    await session.signOut();
    return;
  }
  final choice = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _SignOutDialog(sync: sync),
  );
  if (choice == null) return;
  // true: everything synced while waiting. false: "Sign out anyway".
  await session.signOut(keepUnsynced: !choice);
}

class _SignOutDialog extends StatefulWidget {
  const _SignOutDialog({required this.sync});
  final SyncController sync;

  @override
  State<_SignOutDialog> createState() => _SignOutDialogState();
}

class _SignOutDialogState extends State<_SignOutDialog> {
  late final Map<String, int> _initial = Map.of(widget.sync.snapshot.unsynced.counts);
  bool _waiting = false;

  @override
  void initState() {
    super.initState();
    widget.sync.addListener(_changed);
  }

  @override
  void dispose() {
    widget.sync.removeListener(_changed);
    super.dispose();
  }

  bool _finished = false;

  /// Closes the dialog exactly once: both the sync finishing and the listener can end it. Null
  /// cancels the sign-out.
  void _finish(bool? synced) {
    if (_finished || !mounted) return;
    _finished = true;
    Navigator.of(context).pop(synced);
  }

  void _changed() {
    if (_finished || !mounted) return;
    final snapshot = widget.sync.snapshot;
    // The app locked and closed the database: what's left can't be known, so nothing is
    // decided. (Read as "0 left", this used to sign out and erase everything unsynced.)
    if (!snapshot.open) {
      _finish(null);
      return;
    }
    if (_waiting && snapshot.unsynced.total == 0) {
      _finish(true);
      return;
    }
    setState(() {});
  }

  Future<void> _wait() async {
    setState(() => _waiting = true);
    await widget.sync.syncNow();
    final snapshot = widget.sync.snapshot;
    if (snapshot.open && snapshot.unsynced.total == 0) _finish(true);
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final snapshot = widget.sync.snapshot;
    final remaining = snapshot.unsynced.counts;
    return AlertDialog(
      title: const Text('Some records haven’t synced'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Signing out won’t delete them. They stay encrypted on this phone and finish syncing the next '
              'time you sign in here. Nobody else who signs in on this phone can see them.',
              style: text.bodyLarge,
            ),
            const SizedBox(height: FieldSpace.s4),
            for (final MapEntry(key: category, value: total) in _initial.entries) ...[
              _Progress(label: categoryLabel(category), total: total, left: remaining[category] ?? 0),
              const SizedBox(height: FieldSpace.s3),
            ],
            if (snapshot.offline && _waiting) Text('No connection. Waiting keeps trying.', style: text.bodyMedium),
            if (snapshot.attention.isNotEmpty)
              Text(
                '${plural(snapshot.attention.length, 'item needs', 'items need')} attention before it can sync.',
                style: text.bodyMedium,
              ),
            if (snapshot.elsewhere != 0) ...[
              const SizedBox(height: FieldSpace.s2),
              Text(elsewhereText(snapshot.elsewhere), style: text.bodyMedium),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => _finish(false), child: const Text('Sign out anyway')),
        FilledButton(onPressed: snapshot.syncing ? null : () => unawaited(_wait()), child: const Text('Wait')),
      ],
    );
  }
}

class _Progress extends StatelessWidget {
  const _Progress({required this.label, required this.total, required this.left});
  final String label;
  final int total;
  final int left;

  @override
  Widget build(BuildContext context) {
    final done = total == 0 ? 1.0 : ((total - left).clamp(0, total) / total);
    final percent = (done * 100).round();
    return Semantics(
      label: '$label: $percent percent synced',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$label: $percent%', style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: FieldSpace.s1),
          LinearProgressIndicator(value: done, minHeight: 8),
        ],
      ),
    );
  }
}
