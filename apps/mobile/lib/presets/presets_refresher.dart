/// Keeps the open team's copy of its presets current (phase 5 design 6.1): one
/// `GET /v1/presets?since=&epoch=` at each open of the team's database, after each sync that
/// reached the server, and on pull to refresh, made with the team's other refreshers in
/// `appRefreshers` (app_providers.dart).
///
/// Written ahead of its code (P2-tests): every body that throws is P2-store's.
library;

import '../api/generated/api.dart' show SineobexApi;
import '../sync/local_store.dart';
import '../sync/sync_controller.dart' show OpenTeam;
import '../sync/sync_engine.dart' show AfterSyncRefresher, RefreshReason;
import 'preset_store.dart';

/// Pulls the presets changed since the revision [presets] holds, under the epoch it holds (neither
/// sent when none is held), and writes the answer with [PresetStore.apply]. A 403 clears the copy
/// ([PresetStore.clear]); any other failure leaves it as it was, for the next run to ask again.
/// Nothing is asked while the store is frozen.
///
/// An answer, a 403 included, is written only while [current] says the database it was asked for
/// is still the one the controller holds open, for the same sign-in, and the store is not frozen;
/// any other answer is dropped (phase 3's review P3).
class PresetsRefresher implements AfterSyncRefresher {
  PresetsRefresher(this.presets, this.api, {required this.current});

  final PresetStore presets;

  /// The API as the signed-in person in the team [presets] belongs to.
  final SineobexApi api;

  /// Whether [presets]' database is still the one the controller holds open, for the sign-in that
  /// asked.
  final bool Function() current;

  @override
  Future<void> refresh(RefreshReason reason) async => throw UnimplementedError('P2-store');
}

/// For the sync controller's refresher factory (`appRefreshers`, and the test harness's copy of
/// it): [team]'s [PresetsRefresher], over a [PresetStore] of [team]'s store, whose answers are
/// written only while [openStore] (the controller's open store) is that same store.
List<AfterSyncRefresher> presetRefreshers(OpenTeam team, {required LocalStore? Function() openStore}) =>
    throw UnimplementedError('P2-store');
