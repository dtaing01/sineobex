import 'dart:convert';
import 'dart:math' show max;

import '../api/generated/api.dart' as api;
import '../api/transport.dart';
import '../presets/current_flags.dart' show CurrentFlags;
import '../presets/models.dart' show FlagBody, PresetKind;
import '../presets/preset_store.dart';
import '../sync/local_store.dart';
import '../sync/sync_engine.dart';
import 'access.dart';
import 'display.dart' show allergyBadge;
import 'dob.dart' show Birth;
import 'flags.dart' show flagHidden;
import 'match_constants.dart' show searchMax;
import 'patient_search.dart' show FoundPatient, searchNamesOf;

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

  /// [patientId]'s current flags as the index gives them (phase 5 design 6.1), through the person's
  /// flag rule (`flagHidden`, lib/patients/flags.dart): a flag the person may not see, or one the
  /// phone's copy of the presets doesn't hold, is left out, whatever projection the index was
  /// downloaded under. Null when the index holds no entry for the patient's canonical patient; an
  /// entry from before flags holds none.
  CurrentFlags? flagsOf(String patientId) {
    final e = entry(patientId);
    return e == null ? null : _shown(e.flags?.toJson(), _flagBodies());
  }

  /// Whether [patientId] carries every flag of [flagIds] among its current flags, either tier, as
  /// [flagsOf] gives them: what the server's search keeps of its hits for `flagIds` (search.ts), so a
  /// search narrowed by the Patients tab's filters lists, and logs, the same patients offline.
  bool carriesAll(String patientId, Iterable<String> flagIds) {
    final held = flagsOf(patientId);
    return held != null && flagIds.every((id) => held.primary == id || held.secondary.contains(id));
  }

  /// The team's flags the phone's copy of the presets holds, archived ones included, by ID: what the
  /// flag rule reads of each.
  Map<String, FlagBody> _flagBodies() => {
    for (final p in PresetStore(store).presets(kind: PresetKind.flag))
      if (p.body case final FlagBody body) p.id: body,
  };

  /// An entry's `flags` (`{primary, secondary}`, flag IDs) less every flag the person's flag rule
  /// hides ([flagHidden]), with [bodies] the flags the phone holds: the server's order kept. An entry
  /// from before flags carries none.
  CurrentFlags _shown(Object? flags, Map<String, FlagBody> bodies) {
    bool shown(Object? id) => id is String && !flagHidden(permissions, bodies[id]);
    final f = flags is Map<String, Object?> ? flags : const <String, Object?>{};
    final primary = f['primary'];
    return (
      primary: shown(primary) ? primary! as String : null,
      secondary: [
        for (final id in f['secondary'] as List<Object?>? ?? const [])
          if (shown(id)) id! as String,
      ],
    );
  }

  /// The Patients tab's **Risk level** and **Conditions** filters (8.2; section 11, row 37), offline
  /// from the index: its patients carrying [riskLevel] (a primary flag's ID) and every one of
  /// [conditions] (secondary flags' IDs), as [flagsOf] gives each, as search rows (never a legal
  /// name, D40). A list of patients, so audited before it returns, in the same transaction as the
  /// read (D21): `patient.searched` from the team index, naming the patients shown and never a flag.
  /// Empty with neither (no browsing), and for a flag the person may not see. Throws
  /// [ChartingPaused] while the store is frozen.
  ///
  /// Most recently seen first, then by preferred name, at most [searchMax] a list (what one audit
  /// entry names, as search's Show more lists), with how many more carry the flags: Show more asks
  /// for the next [searchMax] [after] the patients shown, a list of its own, audited as what it
  /// shows, so everyone who carries a flag can be listed (a cold night's Frost risk round). The index
  /// is the server's word as of its last refresh: a change made on this phone moves a patient in or
  /// out of a list once it has synced and the index has been downloaded again.
  FlaggedList withFlags({String? riskLevel, Set<String> conditions = const {}, int after = 0}) {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
    if (riskLevel == null && conditions.isEmpty) return FlaggedList.none;
    expireIfStale();
    final bodies = _flagBodies();
    if ([?riskLevel, ...conditions].any((id) => flagHidden(permissions, bodies[id]))) return FlaggedList.none;
    if (!state.present) return FlaggedList.none;
    return store.transaction(() {
      final matched = <(String, Map<String, Object?>)>[];
      for (final row in store.database.select('SELECT patient_id, entry_json FROM team_index')) {
        final id = row['patient_id']! as String;
        // A record the phone knows was merged since is its survivor's to list, as [flagsOf] reads it.
        if (store.canonicalPatient(id) != id) continue;
        final e = jsonDecode(row['entry_json']! as String) as Map<String, Object?>;
        final flags = _shown(e['flags'], bodies);
        if (riskLevel != null && flags.primary != riskLevel) continue;
        if (!conditions.every(flags.secondary.contains)) continue;
        matched.add((id, e));
      }
      matched.sort((a, b) => _seenFirst(a.$1, a.$2, b.$1, b.$2));
      final shown = [for (final (id, e) in matched.skip(after).take(searchMax)) _row(id, e)];
      // Show more past the end shows no one, so nothing is logged.
      if (after > 0 && shown.isEmpty) return FlaggedList.none;
      store.appendAudit(
        'patient.searched',
        patientIds: [for (final r in shown) r.patientId],
        resultCount: shown.length,
        // Which flags were chosen is never logged (CO-14): the list names the patients shown only.
        criteria: const [],
        source: 'team_index',
      );
      return FlaggedList(shown, more: max(0, matched.length - after - shown.length));
    });
  }

  /// Index entries [x] of [a] and [y] of [b], most recently seen first (unseen last), then by preferred
  /// name whatever its case, then by ID.
  static int _seenFirst(String a, Map<String, Object?> x, String b, Map<String, Object?> y) {
    final seen = (y['lastSeenOn'] as String? ?? '').compareTo(x['lastSeenOn'] as String? ?? '');
    if (seen != 0) return seen;
    String name(Map<String, Object?> e) => (e['preferredName'] as String? ?? '').toLowerCase();
    final byName = name(x).compareTo(name(y));
    return byName != 0 ? byName : a.compareTo(b);
  }

  /// One index entry [e] as a search row: the patient record's own fields where the phone holds them
  /// (an edit made here is newer than the index), else the entry's; its street names, allergies and
  /// duplicate hint from the entry, never the reviewer's note (D40, review P7). No legal name is read.
  FoundPatient _row(String patientId, Map<String, Object?> e) {
    final held = store.record(patientId)?.fields ?? const <String, LocalField>{};
    String? pick(String field) => held.containsKey(field) ? held[field]!.value as String? : e[field] as String?;
    List<Map<String, Object?>> listOf(String key) => [...?(e[key] as List<Object?>?)?.cast<Map<String, Object?>>()];
    final allergies = [
      for (final a in listOf('allergies')) (substance: a['substance']! as String, severity: a['severity'] as String?),
    ];
    final hint = e['duplicate'];
    final duplicate = hint is Map<String, Object?> ? api.DuplicateHint.fromJson({...hint}..remove('note')) : null;
    return FoundPatient(
      patientId: patientId,
      score: 0,
      band: api.MatchBand.weak,
      reasons: const [],
      preferredName: pick('preferredName'),
      aliases: [for (final a in listOf('aliases')) a['alias']! as String].take(5).toList(),
      visualDescriptor: pick('visualDescriptor'),
      birth: Birth.fromJson(held['birth']?.value ?? e['birth']),
      usualArea: pick('usualArea'),
      lastSeenOn: e['lastSeenOn'] as String?,
      badge: allergyBadge(allergies, screen: (held['allergyScreen']?.value ?? e['allergyScreen']) as String?),
      allergyCount: allergies.length,
      severeAllergy: allergies.any((a) => a.severity == 'severe'),
      possibleDuplicate: duplicate != null,
      duplicate: duplicate,
    );
  }

  /// Checked at open, on every timer tick and before every search (6.3): an index not refreshed for
  /// [indexLifetime], or refreshed "later" than the phone's corrected clock (wound back), goes with
  /// every server copy on the phone. Staged pages older than [stagingLifetime] go too, whatever the
  /// role and whether or not an index is here. Returns whether the index went now.
  ///
  /// "Later than the clock" counts the latest time a check has seen too ([_seenKey]): after a
  /// restart nothing corrects the phone's clock until the next sync, and a clock wound back to a
  /// day after the refresh would otherwise keep a week-old index (review P6).
  bool expireIfStale() {
    _dropStaleStaging();
    final at = state.refreshedAt;
    if (at == null) return false;
    final now = _now();
    final seen = DateTime.tryParse(store.kv(_seenKey) ?? '');
    final latest = seen != null && seen.isAfter(at) ? seen : at;
    if (now.difference(at) <= indexLifetime && !now.isBefore(latest.subtract(clockSkewAllowance))) {
      // Moved on in steps of a minute, so a search doesn't write each time.
      if (now.difference(latest) >= const Duration(minutes: 1)) store.setKv(_seenKey, now.toUtc().toIso8601String());
      return false;
    }
    _remove(IndexRemoval.expired);
    return true;
  }

  /// The latest time [expireIfStale] has seen, in `kv` with the index's bookkeeping (it goes with
  /// the index).
  static const _seenKey = '${indexKvPrefix}latestSeenAt';

  void _remove(IndexRemoval why) {
    store.clearServerData();
    store.setKv(_removedKey, why.name);
    onChanged?.call();
  }

  /// The server refused the index to this role (403 `index_not_permitted`), or the cached
  /// permissions say it may not hold one: the index and every server copy without local work go.
  /// With no index here, a download the role started earlier and never finished goes: its staged
  /// pages hold patients' names (review P4).
  void notPermitted() {
    if (state.present || store.database.select('SELECT 1 FROM team_index LIMIT 1').isNotEmpty) {
      _remove(IndexRemoval.notPermitted);
    } else {
      _dropStaging();
    }
  }

  /// Deletes every staged page and the index's bookkeeping in `kv`.
  void _dropStaging() => store.transaction(() {
    store.database
      ..execute('DELETE FROM team_index_staging')
      ..execute("DELETE FROM kv WHERE key LIKE '$indexKvPrefix%'");
  });

  /// Staging is a download in progress: older than [stagingLifetime] (or staged "later" than the
  /// phone's clock, which was wound back) it is never resumed, so it goes now rather than wait for
  /// a download that may never come (a role that lost the index, a phone that stays offline).
  void _dropStaleStaging() {
    final row = store.database
        .select('SELECT min(staged_at) AS oldest, max(staged_at) AS newest FROM team_index_staging')
        .first;
    final oldest = row['oldest'] as int?, newest = row['newest'] as int?;
    if (oldest == null || newest == null) return;
    final now = _now().toUtc().millisecondsSinceEpoch;
    if (now - oldest > stagingLifetime.inMilliseconds || newest - now > clockSkewAllowance.inMilliseconds) {
      store.transaction(() => store.database.execute('DELETE FROM team_index_staging'));
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
        [
          after,
          page.version,
          jsonEncode({
            ...page.toJson(),
            'entries': [for (final e in page.entries) indexEntryJson(e)],
          }),
          _now().toUtc().millisecondsSinceEpoch,
        ],
      ),
    );
  }

  /// An index entry as the phone keeps it: the duplicate hint without the reviewer's Not sure note,
  /// free text that can carry a legal name (D40, review P7). The server leaves it out of the index;
  /// the phone drops it as well, whatever a server sends. The note shows from a full chart only.
  static Map<String, Object?> indexEntryJson(api.IndexEntry e) {
    final json = e.toJson();
    final hint = json['duplicate'];
    if (hint is Map<String, Object?>) json['duplicate'] = {...hint}..remove('note');
    return json;
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
      final names = db.prepare(
        "INSERT INTO patient_names (name, patient_id, source, origin) VALUES (?, ?, ?, 'index')",
      );
      var count = 0;
      try {
        for (final page in pages) {
          for (final e in page.entries) {
            final birth = e.birth;
            final date = birth?.date;
            insert.execute([
              e.patientId,
              jsonEncode(indexEntryJson(e)),
              e.preferredName,
              birth?.year ?? (date == null ? null : int.parse(date.substring(0, 4))),
              date,
              e.lastSeenOn,
            ]);
            for (final n in searchNamesOf(
              preferred: e.preferredName,
              aliases: [for (final a in e.aliases) a.alias],
              descriptor: e.visualDescriptor,
            )) {
              names.execute([n.name, e.patientId, n.source]);
            }
            count++;
          }
        }
      } finally {
        insert.close();
        names.close();
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
  TeamIndexRefresher(this.index, this.client, {DateTime Function()? wallNow, this.maxPageLimit = indexPageLimit})
    : _wall = wallNow ?? DateTime.now,
      _limit = maxPageLimit;

  /// The page size asked for while answers come (smaller in tests).
  final int maxPageLimit;

  final TeamIndex index;
  final api.SineobexApi client;
  final DateTime Function() _wall;
  DateTime? _lastCheck;
  int _limit;

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
        _limit = (_limit * 2).clamp(indexMinPageLimit, maxPageLimit);
        return page;
      } on NetworkException catch (e) {
        if (e.reason != 'timeout' || _limit <= indexMinPageLimit) return null;
        _limit = (_limit ~/ 2).clamp(indexMinPageLimit, maxPageLimit);
        r = api.TeamIndexRequest(have: r.have, after: r.after, limit: _limit);
      }
    }
  }
}

/// One list of the patients carrying the filters' flags: those it shows, and how many more on this
/// phone carry them.
class FlaggedList {
  const FlaggedList(this.patients, {required this.more});

  static const none = FlaggedList([], more: 0);

  final List<FoundPatient> patients;
  final int more;
}
