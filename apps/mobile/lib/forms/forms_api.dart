import '../api/generated/api.dart';
import '../sync/sync_engine.dart';
import 'definition.dart';
import 'definition_store.dart';

/// The two forms routes (phase 4 design, forms 3.3), through the generated client, as the
/// signed-in person in one team. Neither holds patient data.
class FormsApi {
  FormsApi(this.api);

  /// The API as the signed-in person in the team.
  final SineobexApi api;

  /// The team's list: each key's newest version and its hash.
  Future<List<ListedVersion>> list() async => [
    for (final e in (await api.listNoteTypes()).noteTypes) ListedVersion(key: e.key, version: e.version, hash: e.hash),
  ];

  /// One version of a note type, resolved, with the hash the server gives it. Nothing here is
  /// checked: the store checks what it keeps.
  Future<({ListedVersion listed, Map<String, Object?> definition})> version(String key, int version) async {
    final answer = await api.getNoteTypeDefinition(key: key, version: '$version');
    return (
      listed: ListedVersion(key: answer.key, version: answer.version, hash: answer.hash),
      definition: answer.definition,
    );
  }
}

/// Brings a team's note types on the phone up to date (forms 3.4): right after sign-in, for every
/// team, and at each sync, for the open one.
///
/// The list comes first. Each version it names that the phone holds neither in its presets nor in
/// its files is then downloaded and kept only when it is the version listed, with the listed hash.
/// The list itself is kept last, and only when every version it names is held, so a fetch that
/// fails part way, or brings a definition the phone refuses, leaves the list it had before and
/// every note type it offered. What did check out stays, and the next fetch skips it.
class DefinitionSync {
  DefinitionSync(this.store);

  final DefinitionStore store;

  /// Fetches in progress, by person, team and [DefinitionStore.generation]: a sync's fetch and a
  /// sign-in's for the same team share one, but a fetch begun before the team's files were deleted
  /// is shared by nothing begun after (it can keep nothing).
  final _running = <String, Future<void>>{};

  /// Throws what stopped it ([DefinitionRefused], an API or network error, or a [StateError] when
  /// the team's files were deleted meanwhile); nothing it didn't finish is kept.
  ///
  /// [generation] is the store's for the team when the caller began, when that was before this
  /// call (a sign-in's fetch of every team, one after another): a sign-out since then asks nothing
  /// more, so a later person's token never fetches for this one.
  Future<void> refresh(String userId, String teamId, FormsApi api, {int? generation}) async {
    final began = generation ?? store.generation(userId, teamId);
    if (began != store.generation(userId, teamId)) throw StateError('Deleted since this fetch began.');
    final id = '$userId\n$teamId\n$began';
    await (_running[id] ??= _once(id, userId, teamId, api, began));
  }

  Future<void> _once(String id, String userId, String teamId, FormsApi api, int generation) async {
    try {
      await _refresh(userId, teamId, api, generation);
    } finally {
      // Not remove(), which hands back this run's own future for nothing to wait on.
      _running.removeWhere((key, _) => key == id);
    }
  }

  Future<void> _refresh(String userId, String teamId, FormsApi api, int generation) async {
    final listed = await api.list();
    DefinitionRefused? refused;
    for (final v in listed) {
      if (await store.holds(userId, teamId, v)) continue;
      final answer = await api.version(v.key, v.version);
      try {
        if (answer.listed.key != v.key || answer.listed.version != v.version || answer.listed.hash != v.hash) {
          throw DefinitionRefused(v.key, v.version, 'the answer is not the version listed');
        }
        // The store checks the definition against the listed hash, not the answer's own.
        await store.keep(userId, teamId, v, answer.definition, generation: generation);
      } on DefinitionRefused catch (e) {
        // The rest are still fetched, so the next try has less to do; the list waits.
        refused ??= e;
      }
    }
    if (refused != null) throw refused;
    await store.keepList(userId, teamId, listed, generation: generation);
  }

  /// The team's definition of [key] at [version], downloaded when the phone doesn't hold it: for
  /// a note held on a version the list no longer names (an old draft after a sign-in again). With
  /// no list entry to check it against, the answer is kept only when its definition has the hash
  /// the server gives it, names that key and version, and the phone can read it.
  Future<NoteTypeDef> fetchVersion(String userId, String teamId, String key, int version, FormsApi api) async {
    final held = await store.definition(userId, teamId, key, version);
    if (held != null) return held;
    final generation = store.generation(userId, teamId);
    final answer = await api.version(key, version);
    final asked = ListedVersion(key: key, version: version, hash: answer.listed.hash);
    return store.keep(userId, teamId, asked, answer.definition, generation: generation);
  }
}

/// Fetches the open team's note types whenever the sync engine runs its refreshers: at open,
/// after each sync that reached the server, on the controller's timer and on pull to refresh. A
/// failure is the engine's to swallow (it never becomes the sync's outcome) and the next run's to
/// retry.
class DefinitionRefresher implements AfterSyncRefresher {
  DefinitionRefresher(this.sync, this.api, {required this.userId, required this.teamId});

  final DefinitionSync sync;
  final FormsApi api;
  final String userId;
  final String teamId;

  @override
  Future<void> refresh(RefreshReason reason) => sync.refresh(userId, teamId, api);
}
