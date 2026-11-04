import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart' show syncControllerProvider;
import '../security/secure_copy.dart';
import '../sync/local_store.dart';
import '../sync/sync_controller.dart';
import '../sync/sync_engine.dart';
import 'access.dart';
import 'chart_cache.dart';
import 'id_links.dart';
import 'patient_repository.dart';
import 'patient_search.dart';
import 'problems.dart';
import 'team_index.dart';

/// Everything about patients for the open team (design section 15, P2), made once per opened
/// database by the sync controller's refresher factory ([patientRefreshers]), so the refreshers it
/// runs and the screens share one index, one chart cache and one card hook.
///
/// Screens listen to it (and to the sync controller) for changes: an index swap, a chart download,
/// a change made through [patients].
class PatientServices extends ChangeNotifier {
  PatientServices(OpenTeam team, {SecureCopy copy = secureCopy, DateTime Function()? wallNow})
    : store = team.store,
      userId = team.userId,
      teamId = team.teamId,
      permissions = List.unmodifiable(team.permissions) {
    DateTime corrected() {
      final s = team.clock.stamp();
      return s.correctedTime ?? s.deviceTime;
    }

    index = TeamIndex(store, permissions: permissions, now: corrected)..onChanged = notifyListeners;
    charts = ChartCache(store, team.api, now: corrected)..onChanged = notifyListeners;
    idLinks = IdLinks(store, copy: copy, now: corrected)..install();
    problems = Problems(store, permissions: permissions);
    search = PatientSearcher(store, team.api, index: index);
    patients = PatientRepository(
      store,
      index: index,
      charts: charts,
      idLinks: idLinks,
      problems: problems,
      now: corrected,
    )..onChanged = notifyListeners;
    refreshers = [TeamIndexRefresher(index, team.api, wallNow: wallNow), ChartCacheRefresher(charts, now: wallNow)];
    _byStore[store] = this;
  }

  final LocalStore store;
  final String userId;
  final String teamId;

  /// The person's permission keys in the team, as /v1/me last reported them.
  final List<String> permissions;

  late final TeamIndex index;
  late final ChartCache charts;
  late final IdLinks idLinks;
  late final Problems problems;
  late final PatientSearcher search;
  late final PatientRepository patients;

  /// The index refresher, then the chart cache's (the engine runs them after syncs, on its timer,
  /// at an unlock and on pull to refresh).
  late final List<AfterSyncRefresher> refreshers;

  static final _byStore = Expando<PatientServices>('PatientServices');

  /// The services made for [store] when its team opened; null when the controller has no
  /// [patientRefreshers].
  static PatientServices? of(LocalStore store) => _byStore[store];

  /// Re-read after a change made elsewhere (a store call a screen made directly, a problem moved).
  void changed() => notifyListeners();

  // ---- what the role may do (D37; the server still decides) ----

  /// Holds the team index (field roles).
  bool get holdsIndex => mayHoldTeamIndex(permissions);

  /// Registers people, edits their details, street names, allergies, consents and cards.
  bool get mayEdit => permissions.contains('patients.edit');

  /// Sees the problem list.
  bool get seesProblems => mayViewProblems(permissions);

  /// Adds problems, moves them, adds notes, marks allergies and problems entered in error.
  bool get mayChart => permissions.contains('encounters.chart');
}

/// For `SyncController(refreshers: patientRefreshers)`: makes the open team's [PatientServices]
/// and returns its refreshers.
List<AfterSyncRefresher> patientRefreshers(OpenTeam team) => PatientServices(team).refreshers;

/// The open team's [PatientServices]; null while no team is open (locked, signed out, no team
/// chosen) or when the controller was built without [patientRefreshers].
final patientServicesProvider = NotifierProvider<OpenPatientServices, PatientServices?>(OpenPatientServices.new);

class OpenPatientServices extends Notifier<PatientServices?> {
  @override
  PatientServices? build() {
    final sync = ref.watch(syncControllerProvider);
    PatientServices? current() {
      final s = sync.store;
      return s == null ? null : PatientServices.of(s);
    }

    void update() {
      final next = current();
      if (!identical(next, state)) state = next;
    }

    sync.addListener(update);
    ref.onDispose(() => sync.removeListener(update));
    return current();
  }
}

/// The curated problem codes (assets/problem_codes.json), loaded once.
final problemCodesProvider = FutureProvider<ProblemCodes>((ref) => ProblemCodes.load());

/// The index state for the Patients tab's status line, or null with no team open.
TeamIndexState? indexStateOf(PatientServices? s) => s?.index.state;

/// Whether a chart the phone holds is only the index's partial copy.
bool isPartialChart(LocalStore store, String patientId) =>
    chartMetaOf(store, store.canonicalPatient(patientId))?.partial ?? false;
