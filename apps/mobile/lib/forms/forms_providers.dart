import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart' show syncControllerProvider;
import '../sync/sync_controller.dart';
import 'definition.dart';
import 'definition_store.dart';

/// What Start says in a team the phone holds no list for (forms 3.4). After a normal sign-in,
/// which is online, every team has one.
const connectOnceMessage = 'Connect once to load your team’s note types.';

/// The person and team whose database is open, or null.
({String userId, String teamId})? _openTeam(SyncController sync) {
  final store = sync.store;
  final engine = sync.engine;
  return store == null || engine == null ? null : (userId: store.userId, teamId: engine.teamId);
}

/// Recomputes the provider when the open team changes or the store keeps or forgets a list.
DefinitionStore? _watch(Ref ref) {
  final sync = ref.watch(syncControllerProvider);
  final definitions = sync.definitions;
  final open = _openTeam(sync);
  void teamChanged() {
    if (_openTeam(sync) != open) ref.invalidateSelf();
  }

  sync.addListener(teamChanged);
  definitions?.addListener(ref.invalidateSelf);
  ref.onDispose(() {
    sync.removeListener(teamChanged);
    definitions?.removeListener(ref.invalidateSelf);
  });
  return definitions;
}

/// The open team's note types, each listed version with its definition, from the presets and
/// what the phone fetched last: offline too. Null while no team is open, and in a team the phone
/// holds no list for, where Start shows [connectOnceMessage]. A new note starts only on
/// [TeamNoteTypes.startable].
final teamNoteTypesProvider = FutureProvider<TeamNoteTypes?>((ref) async {
  final definitions = _watch(ref);
  final open = _openTeam(ref.read(syncControllerProvider));
  if (definitions == null || open == null) return null;
  return definitions.team(open.userId, open.teamId);
});

/// The open team's definition of a key at a version, listed now or not, for a note the phone
/// holds (an old draft opens offline). Null when the phone doesn't hold it or no team is open.
final noteTypeDefinitionProvider = FutureProvider.family<NoteTypeDef?, ({String key, int version})>((ref, at) async {
  final definitions = _watch(ref);
  final open = _openTeam(ref.read(syncControllerProvider));
  if (definitions == null || open == null) return null;
  return definitions.definition(open.userId, open.teamId, at.key, at.version);
});
