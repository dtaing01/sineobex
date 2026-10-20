import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/tokens.dart';
import '../sync/sign_out_dialog.dart';
import '../sync/sync_cards.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final sync = ref.watch(syncControllerProvider);
    final state = session.state;
    if (state is! Unlocked) return const SizedBox.shrink();
    final text = Theme.of(context).textTheme;
    final team = state.user.team;
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: ListenableBuilder(
        listenable: sync,
        builder: (context, _) {
          final snapshot = sync.snapshot;
          return ListView(
            padding: const EdgeInsets.all(FieldSpace.s4),
            children: [
              Semantics(
                header: true,
                child: Text('Hello, ${state.user.displayName.split(' ').first}', style: text.headlineSmall),
              ),
              const SizedBox(height: FieldSpace.s2),
              if (team != null) Text('${team.name} · ${team.roleName}', style: text.bodyLarge),
              const SizedBox(height: FieldSpace.s5),
              if (snapshot.clock.paused) ...[
                ClockPausedCard(status: snapshot.clock, onCheckAgain: () => unawaited(sync.checkClock(fresh: true))),
                const SizedBox(height: FieldSpace.s4),
              ],
              if (snapshot.attention.isNotEmpty) ...[
                NeedsAttentionTile(count: snapshot.attention.length, onOpen: () => context.push('/attention')),
                const SizedBox(height: FieldSpace.s4),
              ],
              if (snapshot.open) ...[
                SyncStatusCard(snapshot: snapshot, onSyncNow: () => unawaited(sync.syncNow())),
                const SizedBox(height: FieldSpace.s5),
              ],
              if (state.user.teams.length > 1)
                OutlinedButton(onPressed: () => session.selectTeam(null), child: const Text('Switch team')),
              const SizedBox(height: FieldSpace.s3),
              OutlinedButton(onPressed: session.lock, child: const Text('Lock now')),
              const SizedBox(height: FieldSpace.s3),
              TextButton(
                onPressed: () => unawaited(signOutWithSync(context, session, sync)),
                child: const Text('Sign out'),
              ),
            ],
          );
        },
      ),
    );
  }
}
