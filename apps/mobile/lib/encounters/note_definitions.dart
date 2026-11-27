/// A note's definition, by the note's own key and version (phase 4 design, forms 3.4; lifecycle 4.5,
/// 4.8): a note keeps the version it was written on, and is read, checked and hashed by that one,
/// never by the version the team lists now.
library;

import '../api/transport.dart';
import '../auth/auth_provider.dart' show AuthException;
import '../forms/definition.dart';
import '../forms/definition_store.dart';
import '../forms/forms_api.dart';
import '../sync/local_store.dart';

/// A definition by key and version; null when there is none to be had.
typedef DefinitionLookup = Future<NoteTypeDef?> Function(String key, int version);

/// The definitions a phone's screens and Complete read notes by: the phone's own files (the bundled
/// presets and what it fetched for the team), offline too; and, for a version the phone lacks, the
/// server, while there is signal. Without either, a lookup is null, and the note is read without
/// its form: listed for whoever acts as its author with nothing of its answers, left out for
/// everyone else, as the server leaves out a note it cannot lay out (lifecycle 5.1; NoteView).
///
/// What [load] found stays for [loaded], so Complete's `definitionOf`, which is synchronous, reads
/// the same definitions the screen was drawn with. A miss is not remembered: the next [load] asks
/// again, so a note opened offline gets its form once there is signal.
class NoteDefinitions {
  NoteDefinitions({required this._held, this._fetch});

  /// The open team's: [store]'s files, and [api] for what they lack (none when null: only the
  /// files are read).
  factory NoteDefinitions.team(DefinitionStore store, {required String userId, required String teamId, FormsApi? api}) {
    final sync = DefinitionSync(store);
    return NoteDefinitions(
      held: (key, version) => store.definition(userId, teamId, key, version),
      fetch: api == null ? null : (key, version) => sync.fetchVersion(userId, teamId, key, version, api),
    );
  }

  final DefinitionLookup _held;
  final DefinitionLookup? _fetch;
  final _loaded = <(String, int), NoteTypeDef>{};

  /// [key] at [version]: held, else fetched, else null.
  Future<NoteTypeDef?> load(String key, int version) async {
    final known = _loaded[(key, version)];
    if (known != null) return known;
    final def = await _held(key, version) ?? await _fetched(key, version);
    if (def != null) _loaded[(key, version)] = def;
    return def;
  }

  Future<NoteTypeDef?> _fetched(String key, int version) async {
    final fetch = _fetch;
    if (fetch == null) return null;
    try {
      return await fetch(key, version);
    } on NetworkException {
      return null;
    } on AuthException {
      return null;
    } on ApiException {
      // Not the team's (404), or the server failed: the note opens without its form.
      return null;
    } on DefinitionRefused {
      // Not the version asked for, or not one this app can read: kept nowhere.
      return null;
    } on StateError {
      // The team's files were deleted meanwhile (a sign-out): nothing is kept, nothing is shown.
      return null;
    }
  }

  /// [load] for each of [versions], one after another.
  Future<void> loadAll(Iterable<NoteTypeVersion> versions) async {
    for (final v in versions.toSet()) {
      await load(v.key, v.version);
    }
  }

  /// What [load] found for [key] at [version] in this lookup's life; null when it found nothing or
  /// was not asked.
  NoteTypeDef? loaded(String key, int version) => _loaded[(key, version)];
}

/// The note type versions the notes on this phone are written on, each once: the sync controller
/// fetches each one the phone lacks with the team's list (forms 3.4), so a draft on a version the
/// list no longer names still opens offline after "Log out anyway" and a sign-in again. A note
/// written before note types had versions names none.
Iterable<NoteTypeVersion> heldNoteTypes(LocalStore store) => {
  for (final id in store.recordIds())
    if (store.record(id) case LocalRecord(entity: entityNote, :final attributes)
        when attributes['noteTypeKey'] is String && attributes['noteTypeVersion'] is int)
      (key: attributes['noteTypeKey']! as String, version: attributes['noteTypeVersion']! as int),
};
