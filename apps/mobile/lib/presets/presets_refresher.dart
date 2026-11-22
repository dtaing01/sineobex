/// Keeps the open team's copy of its presets current (phase 5 design 6.1): one
/// `GET /v1/presets?since=&epoch=` each time the sync engine runs its refreshers (at each open of
/// the team's database, after each sync that reached the server, on the controller's timer and on
/// pull to refresh), made with the team's other refreshers in `appRefreshers` (app_providers.dart).
library;

import '../api/generated/api.dart' show PresetsPull, SineobexApi;
import '../api/transport.dart' show ApiException;
import '../sync/local_store.dart';
import '../sync/sync_controller.dart' show OpenTeam;
import '../sync/sync_engine.dart' show AfterSyncRefresher, RefreshReason;
import 'preset_store.dart';

/// Pulls the presets changed since the revision [presets] holds, under the epoch it holds (neither
/// sent when none is held), and writes the answer with [PresetStore.apply]. A 403 `not_a_member`
/// clears the copy ([PresetStore.clear]); any other failure, another 403 included, leaves it as it
/// was, for the next run to ask again. Nothing is asked while the store is frozen. An answer that
/// is no reset is written only over the copy it was asked from: the revision and the epoch held
/// still those the pull sent.
///
/// An answer, a removal's 403 included, is written only into [presets]' own store, and only while
/// [current] says that store is still the one the controller holds open, for the same sign-in, and
/// it is not frozen; any other answer is dropped. The controller also closes a store before a
/// sign-out clears it (phase 3's review P3), so a write that got past this would fail closed, as
/// the index's do.
class PresetsRefresher implements AfterSyncRefresher {
  PresetsRefresher(this.presets, this.api, {required this.current});

  final PresetStore presets;

  /// The API as the signed-in person in the team [presets] belongs to.
  final SineobexApi api;

  /// Whether [presets]' database is still the one the controller holds open, for the sign-in that
  /// asked.
  final bool Function() current;

  /// Every run pulls, as the team's note type list is fetched (`DefinitionRefresher`): an answer
  /// with nothing new is small, and only a pull brings what an admin changed at the desk.
  @override
  Future<void> refresh(RefreshReason reason) async {
    if (!_writable) return;
    final since = presets.revision;
    final epoch = presets.epoch;
    final PresetsPull answer;
    try {
      answer = await api.pullPresets(since: since?.toString(), epoch: epoch);
    } on ApiException catch (e) {
      // No longer a member of the team (teamScope's 403 not_a_member): its presets go, and the next
      // pull asks for everything. Any other refusal keeps the copy for the next run: a sign-in to
      // renew or to finish, terms to accept, a fault, a page from something in front of the API,
      // and a team suspended, whose data the controller's device check decides about.
      if (e.status == 403 && e.code == 'not_a_member' && _writable) presets.clear();
      return;
    }
    // Answered after a sign-out, a lock, a switch of team, a freeze or a sign-in again, it goes
    // nowhere.
    if (!_writable) return;
    // An answer that is no reset holds only what changed since [since]. Over a copy that went
    // meanwhile (a search found the team index too old and cleared every server copy), it would
    // stand for the whole team under a revision no later pull goes back before: it is dropped, and
    // the next pull asks from what the copy holds now.
    if (!answer.reset && (presets.revision != since || presets.epoch != epoch)) return;
    presets.apply(answer);
  }

  /// [presets]' database is the one the controller holds open for the sign-in that asked, and it
  /// is not frozen (a removal's hand-over: the team's data is no longer this person's).
  bool get _writable => current() && !presets.store.frozen;
}

/// For the sync controller's refresher factory (`appRefreshers`, and the test harness's copy of
/// it): [team]'s [PresetsRefresher], over a [PresetStore] of [team]'s store, whose answers are
/// written only while [openStore] (the controller's open store) is that same store. Each open
/// makes a store of its own, so a lock, a sign-out, a switch of team and a sign-in again each
/// leave the refresher's store behind, as the screens' `servicesOpen` reads it.
List<AfterSyncRefresher> presetRefreshers(OpenTeam team, {required LocalStore? Function() openStore}) => [
  PresetsRefresher(
    // "Updated" is only shown, and expires nothing: dated by the phone's own clock, as Home dates
    // the last sync (SyncController.lastSyncedAt) and as Team setup judges "today", so the two
    // screens name one time for one sync even while the phone's clock is off from the server's.
    PresetStore(team.store, now: () => team.clock.stamp().deviceTime),
    team.api,
    current: () => identical(openStore(), team.store),
  ),
];
