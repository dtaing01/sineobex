import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart' show syncControllerProvider;
import '../auth/session_controller.dart' show LocalUser;
import '../forms/definition.dart';
import '../forms/definition_store.dart';
import '../forms/forms_api.dart';
import '../patients/patient_providers.dart' show PatientServices;
import '../sync/local_store.dart';
import '../sync/sync_controller.dart';
import '../sync/sync_engine.dart' show AfterSyncRefresher, RefreshReason;
import 'close_sweep.dart';
import 'credentials.dart';
import 'encounter_api.dart';
import 'encounter_repository.dart';
import 'note_definitions.dart';
import 'notes_to_finish.dart';
import 'referrals.dart';
import 'visit_records.dart';

/// Visits and notes for the open team (phase 4 design, lifecycle 4.8, 8.2, 9), made once per opened
/// database by the sync controller's refresher factory ([encounterRefreshers]), beside phase 3's
/// [PatientServices], so the screens and the close sweep share one repository, one set of
/// definitions and one record of what is on screen.
///
/// The person is the one the session unlocked, in this team: their credential and name from the
/// session's profile, their permission keys as the sync controller opened the team with them
/// ([OpenTeam.permissions], the same profile's). Another team or another person opens another
/// database, and with it another [EncounterServices].
///
/// Screens listen to it (and to the sync controller) for changes made through [repository] and
/// [referrals].
class EncounterServices extends ChangeNotifier {
  EncounterServices(
    OpenTeam team, {
    required String credential,
    required String displayName,
    DefinitionStore? definitionStore,
    Future<bool> Function(String entity, String id)? openServerRecord,
  }) : store = team.store,
       teamId = team.teamId,
       _definitionStore = definitionStore {
    DateTime corrected() {
      final s = team.clock.stamp();
      return s.correctedTime ?? s.deviceTime;
    }

    user = EncounterUser(
      userId: team.userId,
      displayName: displayName,
      credential: credential,
      permissions: team.permissions,
    );
    definitions = definitionStore == null
        ? NoteDefinitions(held: (_, _) async => null)
        : NoteDefinitions.team(definitionStore, userId: team.userId, teamId: team.teamId, api: FormsApi(team.api));
    repository = EncounterRepository(
      store,
      user: user,
      definitions: definitions,
      noteTypes: noteTypes,
      openServerRecord: openServerRecord,
    )..onChanged = notifyListeners;
    api = EncounterApi(team.api, store, user: user, definitions: definitions);
    notesToFinish = NotesToFinish(
      store,
      user: user,
      api: api,
      titleOf: (key) => _titles[key],
      patientName: (patientId) => PatientServices.of(store)?.index.entry(patientId)?.preferredName,
      now: corrected,
    );
    referrals = Referrals(store, user: user)..onChanged = notifyListeners;
    visitRecords = VisitRecords(store, user: user);
    // Only a verified clock counts a draft's 7 days: a phone restarted offline has no reference,
    // and its own clock may be days ahead.
    sweep = CloseSweep(store, now: () => team.clock.stamp().correctedTime);
    refreshers = [_NoteTypesRefresher(this), sweep];
    _byStore[store] = this;
  }

  final LocalStore store;
  final String teamId;
  final DefinitionStore? _definitionStore;

  /// The person charting, as the session's profile has them in this team.
  late final EncounterUser user;

  /// The notes' own definitions, from the phone's files and fetched with the team's API.
  late final NoteDefinitions definitions;
  late final EncounterRepository repository;

  /// The online routes, as the person in this team.
  late final EncounterApi api;
  late final NotesToFinish notesToFinish;
  late final Referrals referrals;

  /// The records made at a visit the phone holds, for the visit screen (lifecycle 9.7).
  late final VisitRecords visitRecords;

  /// Closes what is done with, at the database's opening and after every sync (lifecycle 8.2). The
  /// screens add what they show to its `showing`, and take it out when they close.
  late final CloseSweep sweep;

  /// The team's note type list read first, then [sweep] (the engine runs them after syncs, on its
  /// timer, at an unlock and on pull to refresh).
  late final List<AfterSyncRefresher> refreshers;

  /// Each listed note type's title, by key, from the last read of the list.
  final _titles = <String, String>{};

  /// The team's listed note types (`TeamNoteTypes.listed`), from the phone's files, offline too;
  /// none while the phone holds no list for the team. The repository finds the Red flags note type
  /// among them; the notes-to-finish list takes its titles from them.
  Future<List<NoteTypeDef>> noteTypes() async {
    final listed = (await _definitionStore?.team(user.userId, teamId))?.listed ?? const <NoteTypeDef>[];
    _titles
      ..clear()
      ..addAll({for (final d in listed) d.key: d.title});
    return listed;
  }

  static final _byStore = Expando<EncounterServices>('EncounterServices');

  /// The services made for [store] when its team opened; null when the controller has no
  /// [encounterRefreshers].
  static EncounterServices? of(LocalStore store) => _byStore[store];

  /// Re-read after a change made elsewhere (a store call a screen made directly).
  void changed() => notifyListeners();
}

/// For the sync controller's refresher factory: makes the open team's [EncounterServices] for
/// [person], the session's unlocked profile, and returns its refreshers. The credential and the
/// name are the profile's for [team]; a profile that is not the team's person (which the controller
/// never opens a database for) gets no credential and no name, so nothing is offered that the
/// server might refuse. [openServerRecord] is the engine's for [team].
List<AfterSyncRefresher> encounterRefreshers(
  OpenTeam team, {
  required LocalUser? person,
  DefinitionStore? definitionStore,
  Future<bool> Function(String entity, String id)? openServerRecord,
}) {
  final membership = person?.userId == team.userId ? person!.teams.where((t) => t.id == team.teamId).firstOrNull : null;
  return EncounterServices(
    team,
    credential: membership?.credential ?? 'none',
    displayName: membership == null ? '' : person!.displayName,
    definitionStore: definitionStore,
    openServerRecord: openServerRecord,
  ).refreshers;
}

/// Reads the team's note type list after it may have changed, so its titles are at hand.
class _NoteTypesRefresher implements AfterSyncRefresher {
  _NoteTypesRefresher(this.services);
  final EncounterServices services;

  @override
  Future<void> refresh(RefreshReason reason) => services.noteTypes();
}

/// The open team's [EncounterServices]; null while no team is open (locked, signed out, no team
/// chosen) or when the controller was built without [encounterRefreshers].
final encounterServicesProvider = NotifierProvider<OpenEncounterServices, EncounterServices?>(
  OpenEncounterServices.new,
);

class OpenEncounterServices extends Notifier<EncounterServices?> {
  @override
  EncounterServices? build() {
    final sync = ref.watch(syncControllerProvider);
    EncounterServices? current() {
      final s = sync.store;
      return s == null ? null : EncounterServices.of(s);
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
