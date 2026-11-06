import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/api.dart' show SineobexApi;
import '../api/transport.dart';
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
///
/// [idLinkBaseUrl] is `/v1/me`'s `idLinkBaseUrl` (where card links point), kept in the team's
/// database so an offline restart still has it; null keeps what the database holds.
class PatientServices extends ChangeNotifier {
  PatientServices(OpenTeam team, {String? idLinkBaseUrl, SecureCopy copy = secureCopy, DateTime Function()? wallNow})
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
    if (idLinkBaseUrl != null) IdLinks.rememberBaseUrl(store, idLinkBaseUrl);
    problems = Problems(store, permissions: permissions);
    search = PatientSearcher(store, team.api, index: index, now: corrected);
    patients = PatientRepository(
      store,
      index: index,
      charts: charts,
      idLinks: idLinks,
      problems: problems,
      now: corrected,
    )..onChanged = notifyListeners;
    notices = ServerNotices(store, team.api)..onChanged = notifyListeners;
    refreshers = [
      TeamIndexRefresher(index, team.api, wallNow: wallNow),
      ChartCacheRefresher(charts, now: wallNow),
      NoticesRefresher(notices, now: wallNow),
    ];
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
  late final ServerNotices notices;

  /// The index refresher, the chart cache's, then the notices' (the engine runs them after syncs,
  /// on its timer, at an unlock and on pull to refresh).
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

/// For `SyncController(refreshers: (team) => patientRefreshers(team, idLinkBaseUrl: ...))`: makes
/// the open team's [PatientServices] and returns its refreshers. [idLinkBaseUrl] is `/v1/me`'s.
List<AfterSyncRefresher> patientRefreshers(OpenTeam team, {String? idLinkBaseUrl}) =>
    PatientServices(team, idLinkBaseUrl: idLinkBaseUrl).refreshers;

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

// ------------------------------------------------------------------------------------------------
// Notices from the server
// ------------------------------------------------------------------------------------------------

/// "Someone kept the server's value; yours is in history" (phase 2).
const noticeConflictResolved = 'conflict_resolved';

/// "Your new card is the valid one" (design 10.4: two cards were made for one patient).
const noticeCardKept = 'id_link_kept';

/// To members who manage users: two new cards were made for one patient.
const noticeCardConflict = 'id_link_conflict';

/// A Program Admin decided a "Resolved by mistake" request (design 9.4).
const noticeReversalDecided = 'problem_reversal_decided';

/// The person's notices from the server (`GET /v1/team/notices`: kind, entity and record ID only),
/// kept with the phone's own ([LocalStore.notices]), and read on the phone and on the server alike.
///
/// The server's notice IDs live in `kv` with the local notice each became and its entity (IDs only,
/// no PHI), so a notice is stored once however often it is fetched. A notice the phone already
/// made from a receipt (the same kind about the same record, a card that lost) is that notice, not
/// a second one. A read on the phone reaches the server at the next contact; offline reads wait in
/// `kv` by notice ID.
class ServerNotices {
  ServerNotices(this.store, this.client);

  final LocalStore store;
  final SineobexApi client;

  /// Called after notices arrive or are read, so screens re-read.
  void Function()? onChanged;

  static const _mapKey = 'notices.server';
  static const _queueKey = 'notices.readQueue';

  Map<String, Map<String, Object?>> _map() {
    final v = store.kv(_mapKey);
    if (v == null || v.isEmpty) return {};
    return {
      for (final MapEntry(:key, :value) in (jsonDecode(v) as Map<String, Object?>).entries)
        key: {...value! as Map<String, Object?>},
    };
  }

  void _saveMap(Map<String, Map<String, Object?>> m) => store.setKv(_mapKey, jsonEncode(m));

  List<String> _queue() {
    final v = store.kv(_queueKey);
    return v == null || v.isEmpty ? [] : (jsonDecode(v) as List<Object?>).cast<String>();
  }

  void _saveQueue(List<String> q) => store.setKv(_queueKey, jsonEncode(q));

  String? _serverIdOf(String localId) =>
      _map().entries.where((e) => e.value['local'] == localId).map((e) => e.key).firstOrNull;

  /// Whether [localId] came from the server.
  bool fromServer(String localId) => _serverIdOf(localId) != null;

  /// The entity a server notice names (`id_link`, `problem`, `encounter_note`, ...); null for the
  /// phone's own notices.
  String? entityOf(String localId) {
    final id = _serverIdOf(localId);
    return id == null ? null : _map()[id]?['entity'] as String?;
  }

  /// The person read [localId]: read here now, and on the server at the next contact.
  void markRead(String localId) {
    store.transaction(() {
      store.markNoticeRead(localId);
      final id = _serverIdOf(localId);
      final queue = _queue();
      if (id != null && !queue.contains(id) && _map()[id]?['acked'] != true) _saveQueue([...queue, id]);
    });
    onChanged?.call();
  }

  /// Sends the reads made here, then fetches the server's notices. Nothing while the store is frozen
  /// (a removal's hand-over: the team's data is no longer this person's to download).
  Future<void> sync() async {
    if (store.frozen) return;
    if (!await _sendReads()) return;
    final fetched = await client.listNotices();
    var added = false;
    store.transaction(() {
      final map = _map();
      final local = {for (final n in store.notices()) n.id: n};
      final linked = {for (final e in map.values) e['local']};
      for (final n in fetched) {
        final entry = map[n.id];
        if (entry != null) {
          // Read elsewhere (the portal): read here too.
          final mine = local[entry['local']];
          if (n.readAt != null && mine != null && mine.readAt == null) store.markNoticeRead(mine.id);
          if (n.readAt != null) entry['acked'] = true;
          continue;
        }
        if (n.readAt != null) continue;
        final same = local.values
            .where((l) => l.kind == n.kind && l.recordId == n.recordId && n.recordId != null && !linked.contains(l.id))
            .firstOrNull;
        final id =
            same?.id ?? store.addNotice(n.kind, recordId: n.recordId, patientId: _patientOf(n.entity, n.recordId));
        linked.add(id);
        map[n.id] = {'local': id, 'entity': n.entity, 'acked': false};
        added = true;
      }
      _saveMap(map);
    });
    if (added) onChanged?.call();
  }

  /// Marks on the server what was read here. False when the phone lost the network part way (what
  /// is left stays queued).
  Future<bool> _sendReads() async {
    final map = _map();
    final read = {
      for (final n in store.notices())
        if (n.readAt != null) n.id,
    };
    final pending = {
      ..._queue(),
      for (final MapEntry(:key, :value) in map.entries)
        if (value['acked'] != true && read.contains(value['local'])) key,
    };
    for (final id in pending) {
      try {
        await client.markNoticeRead(noticeId: id);
      } on NetworkException {
        return false;
      } on ApiException catch (e) {
        if (e.status != 404) rethrow;
      }
      store.transaction(() {
        final m = _map();
        m[id]?['acked'] = true;
        _saveMap(m);
        _saveQueue([
          for (final q in _queue())
            if (q != id) q,
        ]);
      });
    }
    return true;
  }

  /// The patient a notice is about, when the phone holds its record (a card, a problem).
  String? _patientOf(String? entity, String? recordId) {
    if (recordId == null) return null;
    if (entity == entityIdLink) {
      final row = store.database.select('SELECT patient_id FROM id_links WHERE id = ?', [recordId]).firstOrNull;
      if (row != null) return store.canonicalPatient(row['patient_id']! as String);
    }
    final p = store.record(recordId)?.patientId;
    return p == null ? null : store.canonicalPatient(p);
  }
}

/// Pulls the person's notices after syncs (at most every [minInterval]), on the controller's timer,
/// at an unlock and on pull to refresh, sending the reads made here first.
class NoticesRefresher implements AfterSyncRefresher {
  NoticesRefresher(this.notices, {this.minInterval = const Duration(minutes: 2), DateTime Function()? now})
    : _now = now ?? DateTime.now;

  final ServerNotices notices;
  final Duration minInterval;
  final DateTime Function() _now;
  DateTime? _last;

  @override
  Future<void> refresh(RefreshReason reason) async {
    if (notices.store.frozen) return;
    final now = _now();
    final last = _last;
    if (reason == RefreshReason.afterSync && last != null && now.difference(last) < minInterval) return;
    _last = now;
    await notices.sync();
  }
}
