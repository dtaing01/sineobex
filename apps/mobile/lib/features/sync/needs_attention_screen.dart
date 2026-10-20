import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/theme.dart';
import '../../design/tokens.dart';
import '../../sync/local_store.dart';
import 'sync_labels.dart';

/// Rejected changes and conflicts, until someone resolves them (module 9 "Rejections", Oct 19
/// reconciliation rule). Nothing here is ever dropped by the app.
class NeedsAttentionScreen extends ConsumerWidget {
  const NeedsAttentionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sync = ref.watch(syncControllerProvider);
    final session = ref.watch(sessionProvider);
    final me = switch (session.state) {
      Unlocked(:final user) => user.userId,
      _ => null,
    };
    return ListenableBuilder(
      listenable: sync,
      builder: (context, _) {
        final snapshot = sync.snapshot;
        final items = snapshot.attention;
        return Scaffold(
          appBar: AppBar(title: const Text('Needs attention')),
          body: items.isEmpty
              ? const Center(
                  child: Padding(padding: EdgeInsets.all(FieldSpace.s4), child: Text('Nothing needs attention.')),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(FieldSpace.s4),
                  itemCount: items.length + (snapshot.held > 0 ? 1 : 0),
                  separatorBuilder: (_, _) => const SizedBox(height: FieldSpace.s4),
                  itemBuilder: (context, i) {
                    if (i == items.length) {
                      return Text(
                        '${plural(snapshot.held, 'later change waits', 'later changes wait')} until these are resolved.',
                        style: Theme.of(context).textTheme.bodyLarge,
                      );
                    }
                    final e = items[i];
                    final store = sync.store;
                    if (e.state != ChangeState.conflict || store == null) return _RejectionCard(entry: e);
                    return _ConflictCard(
                      entry: e,
                      mine: store.myValue(e),
                      me: me,
                      onChoose: (keepMine) async {
                        final messenger = ScaffoldMessenger.of(context);
                        if (!await sync.resolveConflict(e.changeId, keepMine: keepMine)) {
                          messenger.showSnackBar(
                            const SnackBar(content: Text('The other value changed. Check both values again.')),
                          );
                        }
                      },
                    );
                  },
                ),
        );
      },
    );
  }
}

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({required this.entry, required this.mine, required this.me, required this.onChoose});
  final OutboxEntry entry;

  /// What the person has in the field now: exactly what "Use my value" sends.
  final Object? mine;
  final String? me;
  final Future<void> Function(bool keepMine) onChoose;

  @override
  Widget build(BuildContext context) {
    final c = context.field;
    final text = Theme.of(context).textTheme;
    final server = entry.server!;
    final who = server.changedBy == null
        ? 'On the server'
        : server.changedBy == me
        ? 'You, from another phone'
        : 'A teammate';
    final when = server.changedAt == null ? '' : ' at ${timeOfDay(context, server.changedAt!)}';
    Widget side(String heading, Object? value) => Expanded(
      child: Semantics(
        container: true,
        child: Container(
          padding: const EdgeInsets.all(FieldSpace.s3),
          decoration: BoxDecoration(
            color: c.surface,
            border: Border.all(color: c.lineStrong),
            borderRadius: BorderRadius.circular(FieldRadius.md),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(heading, style: text.labelLarge?.copyWith(color: c.inkMuted)),
              const SizedBox(height: FieldSpace.s1),
              Text(valueText(value), style: text.titleMedium),
            ],
          ),
        ),
      ),
    );
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(header: true, child: Text(fieldLabel(entry.field!), style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Text('This field already had a different value. Choose which one to keep.', style: text.bodyLarge),
          const SizedBox(height: FieldSpace.s3),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                side('Your value', mine),
                const SizedBox(width: FieldSpace.s3),
                side('$who$when', server.value),
              ],
            ),
          ),
          const SizedBox(height: FieldSpace.s3),
          FilledButton(onPressed: () => onChoose(true), child: const Text('Use my value')),
          const SizedBox(height: FieldSpace.s2),
          OutlinedButton(
            onPressed: () => onChoose(false),
            child: Text('Keep ${who == 'On the server' ? 'the server’s' : 'theirs'}'),
          ),
          const SizedBox(height: FieldSpace.s1),
          Text('Both values stay in the record’s history either way.', style: text.bodyMedium),
        ],
      ),
    );
  }
}

class _RejectionCard extends StatelessWidget {
  const _RejectionCard({required this.entry});
  final OutboxEntry entry;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final what = entry.field != null
        ? fieldLabel(entry.field!)
        : (entry.entity == entityNote ? 'A note' : 'An encounter');
    return Semantics(
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(header: true, child: Text(what, style: text.titleLarge)),
          const SizedBox(height: FieldSpace.s1),
          Text(reasonLabel(entry.reason), style: text.titleMedium),
          if (entry.message != null) ...[
            const SizedBox(height: FieldSpace.s1),
            Text(entry.message!, style: text.bodyLarge),
          ],
          const SizedBox(height: FieldSpace.s1),
          Text('It stays on this phone until it is fixed. Open the record to fix it.', style: text.bodyMedium),
        ],
      ),
    );
  }
}
