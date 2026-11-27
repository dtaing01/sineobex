import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/tokens.dart';
import '../../patients/patient_providers.dart';
import '../encounters/home_tiles.dart';
import '../patients/patient_labels.dart' show ago;
import '../presets/team_setup_screen.dart' show TeamSetupRow;
import '../sync/sign_out_dialog.dart';
import '../sync/sync_cards.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final sync = ref.watch(syncControllerProvider);
    final services = ref.watch(patientServicesProvider);
    final state = session.state;
    if (state is! Unlocked) return const SizedBox.shrink();
    final text = Theme.of(context).textTheme;
    final team = state.user.team;
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: ListenableBuilder(
        listenable: Listenable.merge([sync, ?services]),
        builder: (context, _) {
          final snapshot = sync.snapshot;
          // Notices need no fix, but they wait in Needs attention until read.
          final notices = sync.store?.notices(unreadOnly: true).length ?? 0;
          final waiting = snapshot.attention.length + notices;
          // Services whose database a lock just closed (Home under another screen) read nothing.
          final index = services != null && identical(services.store, sync.store) ? services.index.state : null;
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
              if (waiting > 0) ...[
                NeedsAttentionTile(count: waiting, onOpen: () => context.push('/attention')),
                const SizedBox(height: FieldSpace.s4),
              ],
              // Phase 4 (lifecycle 9.9): notes to finish and the queues, under Needs attention.
              const EncounterTiles(),
              if (snapshot.open) ...[
                SyncStatusCard(snapshot: snapshot, onSyncNow: () => unawaited(sync.syncNow())),
                if (index != null && index.eligible) ...[
                  const SizedBox(height: FieldSpace.s2),
                  Text(
                    index.present && index.refreshedAt != null
                        ? 'Patient list: updated ${ago(index.refreshedAt!, ref.read(wallClockProvider)())}'
                        : 'Patient list: not on this phone',
                    style: text.bodyLarge,
                  ),
                ],
                const SizedBox(height: FieldSpace.s5),
              ],
              if (state.user.teams.length > 1)
                OutlinedButton(onPressed: () => session.selectTeam(null), child: const Text('Switch team')),
              const SizedBox(height: FieldSpace.s3),
              // Phase 5 (design 8.2): the team's setup, below the tiles with the team's own actions, so
              // what phase 2 placed above keeps its place. Nothing of the team's shows while it is
              // handed over.
              if (snapshot.open && snapshot.frozen == null) ...[
                const TeamSetupRow(),
                const SizedBox(height: FieldSpace.s3),
              ],
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
