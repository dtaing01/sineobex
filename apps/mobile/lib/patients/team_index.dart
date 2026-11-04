import 'dart:convert';

import '../api/generated/api.dart' as api;
import '../api/transport.dart';
import '../sync/local_store.dart';
import '../sync/sync_engine.dart';
import 'access.dart';
import 'patient_search.dart' show writeSearchNames;

/// The team search index on the phone (design section 6): every active patient's preferred name,
/// street names, description, birth, usual area, last-seen date and allergies, so a field worker
/// finds someone with no signal. Never a legal name or anything derived from one (D40), no tokens.
///
/// Replaced whole, never patched: the phone downloads pages into staging and swaps them in with one
/// SQLite transaction, so a search never sees half of one. A download cut off by a dead zone
/// resumes from its last staged page. Only roles that meet patients in person hold it (D37); it is
/// removed after 7 days without a refresh, at sign-out, and when the server says the role may not
/// hold it.

// PLAN-OPEN: index timing and lifetime (design 14.1, #22): pages of 500 (100 after timeouts), checked
// after syncs (at most every 2 minutes) and every 15 minutes, removed after 7 days.

/// The fewest minutes between two checks after syncs.
const indexMinInterval = Duration(minutes: 2);

/// How old the index may be at an unlock before it is checked.
const indexCheckInterval = Duration(minutes: 15);

/// How long an index may be kept without a refresh.
const indexLifetime = Duration(days: 7);

/// Staged pages older than this are discarded, not resumed.
const stagingLifetime = Duration(hours: 1);

/// A phone clock this far behind the index's refresh counts as wound back (the clock check allows 5
/// minutes of skew before charting pauses).
const clockSkewAllowance = Duration(minutes: 5);

const indexPageLimit = 500;
const indexMinPageLimit = 100;

/// Why the list on this phone was removed, shown on the Patients tab until a new one arrives.
enum IndexRemoval {
  /// "The patient list on this phone was more than 7 days old and was removed. Connect to download
  /// it again."
  expired,

  /// The role may not hold it (changed, or a field permission removed).
  notPermitted,
}

/// What the Patients tab says about the list on this phone.
class TeamIndexState {
  const TeamIndexState({
    required this.eligible,
    required this.present,
    this.count = 0,
    this.refreshedAt,
    this.version,
    this.removed,
    this.downloading = false,
  });

  /// The role may hold the index (`mayHoldTeamIndex`); others search only charts they opened.
  final bool eligible;
  final bool present;

  /// "1,204 patients".
  final int count;

  /// When the server last confirmed this copy is current ("updated 2 hours ago").
  final DateTime? refreshedAt;
  final String? version;
  final IndexRemoval? removed;

  /// Part of a new copy is staged, waiting for the rest.
  final bool downloading;
}

/// The team index of one team's store.
class TeamIndex {
  TeamIndex(this.store, {required this.permissions, required this._now});

  final LocalStore store;

  /// The person's permission keys in the team, as /v1/me last reported them.
  final List<String> permissions;

  /// Clock-corrected now: a phone clock set back can't keep an index.
  final DateTime Function() _now;

  /// Called after the index changed (a swap, a removal), so screens re-read.
  void Function()? onChanged;

  static const _removedKey = 'patients.indexRemoved';

  bool get eligible => mayHoldTeamIndex(permissions);

  TeamIndexState get state {
    final version = store.kv('index.version');
    final at = store.kv('index.refreshedAt');
    final removed = store.kv(_removedKey);
    return TeamIndexState(
      eligible: eligible,
      present: version != null,
      count: int.tryParse(store.kv('index.count') ?? '') ?? 0,
      refreshedAt: at == null ? null : DateTime.parse(at),
      version: version,
      removed: version != null || removed == null || removed.isEmpty ? null : IndexRemoval.values.byName(removed),
      downloading: store.database.select('SELECT 1 FROM team_index_staging LIMIT 1').isNotEmpty,
    );
  }

  /// The index's entry for [patientId]'s canonical patient.
  api.IndexEntry? entry(String patientId) {
    final row = store.database.select('SELECT entry_json FROM team_index WHERE patient_id = ?', [
      store.canonicalPatient(patientId),
    ]).firstOrNull;
    return row == null
        ? null
        : api.IndexEntry.fromJson(jsonDecode(row['entry_json']! as String) as Map<String, Object?>);
  }

  /// Checked at open, on every timer tick and before every search (6.3): an index not refreshed for
  /// [indexLifetime], or refreshed "later" than the phone's corrected clock (wound back), goes with
  /// every server copy on the phone. Returns whether it went now.
  bool expireIfStale() {
    final at = state.refreshedAt;
    if (at == null) return false;
    final now = _now();
    if (now.difference(at) <= indexLifetime && !now.isBefore(at.subtract(clockSkewAllowance))) return false;
    _remove(IndexRemoval.expired);
    return true;
  }

  void _remove(IndexRemoval why) {
    store.clearServerData();
    store.setKv(_removedKey, why.name);
    onChanged?.call();
  }

  /// The server refused the index to this role (403 `index_not_permitted`), or the cached
  /// permissions say it may not hold one: the index and every server copy without local work go.
  void notPermitted() {
    if (state.present || store.database.select('SELECT 1 FROM team_index LIMIT 1').isNotEmpty) {
      _remove(IndexRemoval.notPermitted);
    }
  }

  // ---- staging and the swap ----

  /// A downloaded page, staged under the cursor it was asked with ('' for the first).
  void stage(String after, api.TeamIndexPage page) {
    store.transaction(
      () => store.database.execute(
        'INSERT INTO team_index_staging (after, version, entries_json, staged_at) VALUES (?, ?, ?, ?) '
        'ON CONFLICT (after) DO UPDATE SET version = excluded.version, entries_json = excluded.entries_json, '
        'staged_at = excluded.staged_at',
        [after, page.version, jsonEncode(page.toJson()), _now().toUtc().millisecondsSinceEpoch],
      ),
    );
  }

  /// The staged download: its pages in order, and the cursor to resume from (null when complete).
  /// Staging older than [stagingLifetime], or without its first page, is discarded.
  ({List<api.TeamIndexPage> pages, String? resumeAfter})? staged() {
    final db = store.database;
    final rows = db.select('SELECT after, staged_at, entries_json FROM team_index_staging');
    if (rows.isEmpty) return null;
    final oldest = rows.map((r) => r['staged_at']! as int).reduce((a, b) => a < b ? a : b);
    final byAfter = {for (final r in rows) r['after']! as String: r['entries_json']! as String};
    if (_now().toUtc().millisecondsSinceEpoch - oldest > stagingLifetime.inMilliseconds || !byAfter.containsKey('')) {
      store.transaction(() => db.execute('DELETE FROM team_index_staging'));
      return null;
    }
    final pages = <api.TeamIndexPage>[];
    String? cursor = '';
    while (cursor != null && byAfter.containsKey(cursor)) {
      final page = api.TeamIndexPage.fromJson(jsonDecode(byAfter[cursor]!) as Map<String, Object?>);
      pages.add(page);
      cursor = page.next;
    }
    return (pages: pages, resumeAfter: cursor);
  }

  /// Swaps in a complete download (6.2), in one transaction: the entries and their search names
  /// (preferred name, street names, description; never a legal name), the patients made here that
  /// the index now has lose their own names (unless work on them still waits), the redirect list of
  /// the first page replaces every redirect the phone holds (D27), the bookkeeping, and the purge.
  void swap(List<api.TeamIndexPage> pages) {
    final first = pages.first;
    final db = store.database;
    store.transaction(() {
      db
        ..execute('DELETE FROM team_index')
        ..execute("DELETE FROM patient_names WHERE origin = 'index'");
      final insert = db.prepare(
        'INSERT OR REPLACE INTO team_index (patient_id, entry_json, preferred, birth_year, birth_date, last_seen) '
        'VALUES (?, ?, ?, ?, ?, ?)',
      );
      var count = 0;
      try {
        for (final page in pages) {
          for (final e in page.entries) {
            final birth = e.birth;
            final date = birth?.date;
            insert.execute([
              e.patientId,
              jsonEncode(e.toJson()),
              e.preferredName,
              birth?.year ?? (date == null ? null : int.parse(date.substring(0, 4))),
              date,
              e.lastSeenOn,
            ]);
            writeSearchNames(
              db,
              e.patientId,
              'index',
              preferred: e.preferredName,
              aliases: [for (final a in e.aliases) a.alias],
              descriptor: e.visualDescriptor,
            );
            count++;
          }
        }
      } finally {
        insert.close();
      }
      final working = store.localWorkPatients();
      for (final r in db.select(
        'SELECT DISTINCT n.patient_id FROM patient_names n JOIN team_index t ON t.patient_id = n.patient_id '
        "WHERE n.origin = 'local'",
      )) {
        final id = r['patient_id']! as String;
        if (!working.contains(id)) {
          db.execute("DELETE FROM patient_names WHERE patient_id = ? AND origin = 'local'", [id]);
        }
      }
      store.replaceRedirects([
        for (final r in first.redirects)
          PatientRedirect(mergedId: r.mergedId, survivorId: r.survivorId, mergedAt: r.mergedAt, origin: 'index'),
      ], origin: 'index');
      store
        ..setKv('index.version', first.version)
        ..setKv('index.refreshedAt', first.generatedAt.toUtc().toIso8601String())
        ..setKv('index.projection', first.projection)
        ..setKv('index.count', '$count')
        ..setKv(_removedKey, '');
      db.execute('DELETE FROM team_index_staging');
      store.purge();
    });
    onChanged?.call();
  }

  /// The server confirmed this copy is current (`unchanged`).
  void confirmedCurrent(DateTime generatedAt) {
    store.setKv('index.refreshedAt', generatedAt.toUtc().toIso8601String());
    onChanged?.call();
  }
}

/// Keeps the index current (6.2): after every sync that reached the server (at most every
/// [indexMinInterval]), on the controller's 15-minute timer, at an unlock when older than
/// [indexCheckInterval], and on pull to refresh. Skipped while the store is frozen (the engine
/// doesn't run refreshers then). Pages halve after a timeout down to [indexMinPageLimit] and double
/// back after each answer (the D24 pattern).
class TeamIndexRefresher implements AfterSyncRefresher {
  TeamIndexRefresher(this.index, this.client, {DateTime Function()? wallNow}) : _wall = wallNow ?? DateTime.now;

  final TeamIndex index;
  final api.SineobexApi client;
  final DateTime Function() _wall;
  DateTime? _lastCheck;
  int _limit = indexPageLimit;

  /// The page size the next request asks for.
  int get pageLimit => _limit;

  @override
  Future<void> refresh(RefreshReason reason) async {
    final store = index.store;
    if (store.frozen) return;
    if (index.expireIfStale()) return refresh(reason);
    if (!index.eligible) {
      // The phone checks its cached permissions first and doesn't ask; an index kept from an
      // earlier role goes.
      index.notPermitted();
      return;
    }
    final now = _wall();
    final last = _lastCheck;
    final at = index.state.refreshedAt;
    switch (reason) {
      case RefreshReason.afterSync:
        if (last != null && now.difference(last) < indexMinInterval) return;
      case RefreshReason.opened:
        if (at != null && index._now().difference(at) < indexCheckInterval && index.state.present) return;
      case RefreshReason.timer || RefreshReason.manual:
        break;
    }
    _lastCheck = now;
    try {
      await _download();
    } on ApiException catch (e) {
      if (e.status == 403 && e.code == 'index_not_permitted') index.notPermitted();
    }
  }

  Future<void> _download() async {
    final resumed = index.staged();
    final pages = [...?resumed?.pages];
    String? after;
    if (resumed == null || pages.isEmpty) {
      final first = await _page(api.TeamIndexRequest(have: index.store.kv('index.version'), limit: _limit));
      if (first == null) return;
      if (first.status == api.TeamIndexPageStatus.unchanged) {
        index.confirmedCurrent(first.generatedAt);
        return;
      }
      index.stage('', first);
      pages.add(first);
      after = first.next;
    } else {
      after = resumed.resumeAfter;
    }
    while (after != null) {
      final page = await _page(api.TeamIndexRequest(after: after, limit: _limit));
      if (page == null) return;
      index.stage(after, page);
      pages.add(page);
      after = page.next;
    }
    index.swap(pages);
  }

  /// One page, halving the page size after each timeout; null when the phone gave up for now (the
  /// staged pages wait for the next run).
  Future<api.TeamIndexPage?> _page(api.TeamIndexRequest request) async {
    var r = request;
    while (true) {
      try {
        final page = await client.downloadTeamIndex(body: r);
        _limit = (_limit * 2).clamp(indexMinPageLimit, indexPageLimit);
        return page;
      } on NetworkException catch (e) {
        if (e.reason != 'timeout' || _limit <= indexMinPageLimit) return null;
        _limit = (_limit ~/ 2).clamp(indexMinPageLimit, indexPageLimit);
        r = api.TeamIndexRequest(have: r.have, after: r.after, limit: _limit);
      }
    }
  }
}
