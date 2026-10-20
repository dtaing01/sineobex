import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_providers.dart';
import '../../auth/session_controller.dart';
import '../../design/tokens.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final state = session.state;
    if (state is! Unlocked) return const SizedBox.shrink();
    final text = Theme.of(context).textTheme;
    final team = state.user.team;
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: ListView(
        padding: const EdgeInsets.all(FieldSpace.s4),
        children: [
          Semantics(
            header: true,
            child: Text('Hello, ${state.user.displayName.split(' ').first}', style: text.headlineSmall),
          ),
          const SizedBox(height: FieldSpace.s2),
          if (team != null) Text('${team.name} · ${team.roleName}', style: text.bodyLarge),
          const SizedBox(height: FieldSpace.s5),
          if (state.user.teams.length > 1)
            OutlinedButton(onPressed: () => session.selectTeam(null), child: const Text('Switch team')),
          const SizedBox(height: FieldSpace.s3),
          OutlinedButton(onPressed: session.lock, child: const Text('Lock now')),
          const SizedBox(height: FieldSpace.s3),
          TextButton(onPressed: session.signOut, child: const Text('Sign out')),
        ],
      ),
    );
  }
}
