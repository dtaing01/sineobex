import 'dart:async';
import 'dart:convert';

import 'package:sqlite3/sqlite3.dart' show Database;
import 'package:uuid/data.dart';
import 'package:uuid/rng.dart';
import 'package:uuid/uuid.dart';

import '../api/generated/api.dart' as api;
import '../api/generated/api.dart' show DuplicateHint, MatchBand, MatchReason, Surface;
import '../api/transport.dart';
import '../sync/local_store.dart';
import 'chart_cache.dart';
import 'display.dart';
import 'dob.dart';
import 'match_constants.dart';
import 'matching.dart';
import 'normalize.dart';
import 'team_index.dart';

/// Finding patients on the phone (design section 5): the team search, Show more, and the intake's
/// duplicate check, online through the server and offline over what the phone holds.
///
/// FTS5 and SQL only find candidates; P0's scorer (matching.dart) decides, without the sound-alike
/// term. Every displayed list is audited before it renders (D21: what can't be logged can't be
/// shown): online by the server's own event, offline by an `AuditAppend` in the same SQLite
/// transaction as the read. An entry names the patients shown and the kinds of terms used, never
/// the terms (D41).
///
/// The search table (`patient_names`) holds preferred names, street names and descriptions,
/// normalized: never a legal name or anything derived from one (D40). A typed legal name still
/// finds someone offline: the scan below scores, in memory, the legal names held in the fields of
/// the charts this phone keeps under a scope or local work, and no result ever shows one.

// ------------------------------------------------------------------------------------------------
// The search table
// ------------------------------------------------------------------------------------------------

/// Replaces [patientId]'s search names of [origin] (`index`, `cache` or `local`) with these, each
/// normalized. A legal name is never passed here (D40).
void writeSearchNames(
  Database db,
  String patientId,
  String origin, {
  String? preferred,
  Iterable<String> aliases = const [],
  String? descriptor,
}) {
  db.execute('DELETE FROM patient_names WHERE patient_id = ? AND origin = ?', [patientId, origin]);
  addSearchName(db, patientId, origin, 'preferred', preferred);
  for (final a in aliases) {
    addSearchName(db, patientId, origin, 'alias', a);
  }
  addSearchName(db, patientId, origin, 'descriptor', descriptor);
}

/// Adds one search name (normalized), unless that patient already has it from [origin].
void addSearchName(Database db, String patientId, String origin, String source, String? text) {
  assert(source != 'legal', 'a legal name never enters the search table (D40)');
  final norm = normalizeName(text);
  if (norm == null) return;
  final exists = db.select(
    'SELECT 1 FROM patient_names WHERE patient_id = ? AND origin = ? AND source = ? AND name = ?',
    [patientId, origin, source, norm],
  ).isNotEmpty;
  if (exists) return;
  db.execute('INSERT INTO patient_names (name, patient_id, source, origin) VALUES (?, ?, ?, ?)', [
    norm,
    patientId,
    source,
    origin,
  ]);
}

// ------------------------------------------------------------------------------------------------
// Candidates (design 5.5): these statements exactly, which fts_search_test runs
// ------------------------------------------------------------------------------------------------

/// The FTS5 terms of a search: the trigrams of the query's scoring tokens and their nickname
/// partners, each double-quoted (normalized text is `[a-z0-9 ]`, so nothing needs escaping), at most
/// [maxTerms]. Tokens under three characters have no trigram: [shortTokens] finds those.
List<String> ftsTerms(Iterable<String> norms, {int maxTerms = 60}) {
  final ordered = <String>[for (final n in norms) ...scoringTokens(n), ...retrievalTokens(norms)];
  final terms = <String>{};
  for (final t in ordered) {
    if (t.length < 3) continue;
    for (var i = 0; i + 3 <= t.length; i++) {
      terms.add('"${t.substring(i, i + 3)}"');
      if (terms.length == maxTerms) return terms.toList();
    }
  }
  return terms.toList();
}

/// The query's tokens too short for a trigram ("Al", "Jo").
List<String> shortTokens(Iterable<String> norms) => [
  for (final n in norms)
    for (final t in scoringTokens(n))
      if (t.length < 3) t,
];

/// One candidate from the search table: the patient its row names, the best rank, and where its
/// names came from.
typedef NameCandidate = ({String patientId, double? rank, Set<String> origins});

/// `≥ 3 characters`: an OR of the terms; the hidden rank column ranks them (an FTS5 auxiliary
/// function can't be used in an aggregate).
List<NameCandidate> ftsCandidates(Database db, List<String> terms, {int limit = candidateLimit}) {
  if (terms.isEmpty) return const [];
  return [
    for (final r in db.select(
      'SELECT patient_id, min(rank) AS r, group_concat(DISTINCT origin) AS origins FROM patient_names '
      'WHERE patient_names MATCH ? GROUP BY patient_id ORDER BY r LIMIT ?',
      [terms.join(' OR '), limit],
    ))
      (
        patientId: r['patient_id'] as String,
        rank: (r['r'] as num).toDouble(),
        origins: (r['origins'] as String).split(',').toSet(),
      ),
  ];
}

/// `1–2 characters`: FTS5 scans for short LIKE patterns, fine at a few thousand rows.
List<NameCandidate> likeCandidates(Database db, List<String> tokens, {int limit = candidateLimit}) {
  if (tokens.isEmpty) return const [];
  final where = [for (final _ in tokens) "(name LIKE ? || '%' OR name LIKE '% ' || ? || '%')"].join(' OR ');
  return [
    for (final r in db.select(
      'SELECT patient_id, group_concat(DISTINCT origin) AS origins FROM patient_names WHERE $where '
      'GROUP BY patient_id ORDER BY patient_id LIMIT ?',
      [
        for (final t in tokens) ...[t, t],
        limit,
      ],
    ))
      (patientId: r['patient_id'] as String, rank: null, origins: (r['origins'] as String).split(',').toSet()),
  ];
}

/// A full birth date and no name: the index's day-precision births on that date or with day and
/// month swapped, then year-only or estimated births within [estimateRange], exact first; never a
/// year alone (review finding 4).
List<String> birthCandidates(Database db, BirthDate birth, {int limit = candidateLimit}) {
  final swapped = birth.day <= 12 && birth.day != birth.month
      ? BirthDate(birth.year, birth.day, birth.month).iso
      : birth.iso;
  return [
    for (final r in db.select(
      'SELECT patient_id FROM team_index WHERE birth_year BETWEEN ? AND ? '
      'AND (birth_date = ? OR birth_date = ? OR birth_date IS NULL) '
      'ORDER BY (birth_date = ?) DESC, (birth_date IS NOT NULL) DESC, abs(birth_year - ?), patient_id LIMIT ?',
      [birth.year - estimateRange, birth.year + estimateRange, birth.iso, swapped, birth.iso, birth.year, limit],
    ))
      r['patient_id'] as String,
  ];
}

// ------------------------------------------------------------------------------------------------
// What a result shows
// ------------------------------------------------------------------------------------------------

/// One patient in a result list or the duplicate panel: what the role may see, and why it matched.
/// Never a legal name (D40): when [matchedLegalName], the screen says "Close to the legal name on a
/// chart you opened".
class FoundPatient {
  const FoundPatient({
    required this.patientId,
    required this.score,
    required this.band,
    required this.reasons,
    this.preferredName,
    this.aliases = const [],
    this.visualDescriptor,
    this.birth,
    this.usualArea,
    this.lastSeenOn,
    this.badge,
    this.allergyCount = 0,
    this.severeAllergy = false,
    this.possibleDuplicate = false,
    this.duplicate,
    this.notSynced = false,
  });

  /// The canonical patient (what new work names).
  final String patientId;
  final double score;
  final MatchBand band;

  /// Why, as the closed list the screen puts in words.
  final List<MatchReason> reasons;
  final String? preferredName;

  /// Street names (and a merged record's preferred name), at most five.
  final List<String> aliases;
  final String? visualDescriptor;
  final Birth? birth;
  final String? usualArea;

  /// YYYY-MM-DD.
  final String? lastSeenOn;

  /// The allergy badge when the phone knows the allergies (the index or a chart); a server-only
  /// result gives [allergyCount] and [severeAllergy] instead.
  final AllergyBadge? badge;
  final int allergyCount;
  final bool severeAllergy;

  /// "Possible duplicate under review".
  final bool possibleDuplicate;

  /// The hint with the reviewer's Not sure note, when the phone has it.
  final DuplicateHint? duplicate;

  /// "On this phone only": made here and not synced yet.
  final bool notSynced;

  bool get matchedLegalName => reasons.contains(MatchReason.legalName);
}

/// Where a list came from.
enum ListSource {
  /// The server answered (its own audit event).
  server,

  /// The phone's own data (audited here).
  phone,

  /// Both: the server's list and patients only this phone knows.
  both,
}

/// One displayed search run.
class SearchRun {
  const SearchRun({
    required this.hits,
    required this.truncated,
    required this.source,
    required this.more,
    this.listUpdatedAt,
  });

  static const empty = SearchRun(hits: [], truncated: false, source: ListSource.phone, more: false);

  final List<FoundPatient> hits;

  /// More scored high enough than shown: Show more (or, after it, "add letters or a birth year").
  final bool truncated;
  final ListSource source;

  /// This run was Show more ([searchMax] results).
  final bool more;

  /// When the phone's patient list was last updated, for "searching the list on this phone
  /// (updated yesterday)".
  final DateTime? listUpdatedAt;
}

/// What an intake has typed so far, for the duplicate check (design 8.1).
class MatchInput {
  const MatchInput({
    this.preferredName,
    this.legalGiven,
    this.legalFamily,
    this.aliases = const [],
    this.birth,
    this.excludePatientId,
  });
  final String? preferredName;
  final String? legalGiven;
  final String? legalFamily;
  final List<String> aliases;
  final Birth? birth;

  /// The patient being edited: never their own match.
  final String? excludePatientId;

  bool get hasName => [preferredName, legalGiven, legalFamily, ...aliases].any((s) => normalizeName(s) != null);
}

/// One displayed duplicate check.
class MatchRun {
  const MatchRun({
    required this.checkId,
    required this.candidates,
    required this.source,
    this.indexVersion,
    this.listUpdatedAt,
  });

  final String checkId;

  /// At or above [matchPossible], likely ones first, at most [matchLimit].
  final List<FoundPatient> candidates;
  final ListSource source;

  /// The index version the phone checked against.
  final String? indexVersion;
  final DateTime? listUpdatedAt;

  /// The patient create's `matchCheck`: which check, where, against which index, what was shown and
  /// what the person dismissed with Not them. The server then won't flag a pair it showed.
  Map<String, Object?> matchCheck({Iterable<String> dismissed = const []}) => {
    'checkId': checkId,
    'where': switch (source) {
      ListSource.server => 'server',
      ListSource.phone => 'phone',
      ListSource.both => 'both',
    },
    'indexVersion': indexVersion,
    'shown': [for (final c in candidates.take(10)) c.patientId],
    'dismissed': dismissed.take(10).toList(),
  };
}

// ------------------------------------------------------------------------------------------------
// The searcher
// ------------------------------------------------------------------------------------------------

/// Searches and duplicate checks for one team's store.
class PatientSearcher {
  PatientSearcher(this.store, this.client, {required this.index, this.wait = const Duration(seconds: 3)});

  final LocalStore store;
  final api.SineobexApi client;
  final TeamIndex index;

  /// How long the phone waits for the server before showing its own list (5.6, 8.1).
  final Duration wait;

  static const _uuid = Uuid(goptions: GlobalOptions(CryptoRNG()));

  void _refuseIfFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  static List<String> _criteria(String? norm, Birth? birth) => [
    if (norm != null) 'name',
    if (birth != null) birth is BirthDate ? 'birth_full' : 'birth_year',
  ];

  String get _source => index.state.present ? 'team_index' : 'cache';

  /// One search run (5.6): the server's search when it answers within [wait], merged with patients
  /// made here and not synced yet; otherwise the phone's own list, audited here. [more] is Show more
  /// (up to [searchMax], a run of its own). An empty query, or a year without a name, searches
  /// nothing (no browsing).
  Future<SearchRun> search(String? text, {Birth? birth, bool more = false}) async {
    _refuseIfFrozen();
    final query = SearchQuery(text: text, birth: birth);
    if (query.isEmpty) return SearchRun.empty;
    index.expireIfStale();
    final limit = more ? searchMax : searchLimit;
    final api.PatientSearchResult result;
    try {
      result = await client
          .searchPatients(
            body: api.PatientSearch(
              name: _cut(text, 100),
              birth: birth == null
                  ? null
                  : birth is BirthDate
                  ? api.BirthQuery(year: birth.year, month: birth.month, day: birth.day)
                  : api.BirthQuery(year: birth.year),
              limit: limit,
              surface: Surface.phone,
            ),
          )
          .timeout(wait);
    } on Object catch (e) {
      if (!_offline(e)) rethrow;
      return searchOnPhone(text, birth: birth, more: more);
    }
    final hits = [for (final h in result.hits) _fromServer(h)];
    final shown = {for (final h in hits) h.patientId};
    // Patients made here and not synced yet: the person's own work, which the server can't know.
    final local = _rank(query, _localOnly().difference(shown), limit: limit);
    final merged = [...hits, ...local.hits]..sort((a, b) => b.score.compareTo(a.score));
    return SearchRun(
      hits: merged.take(limit).toList(),
      truncated: result.truncated || merged.length > limit,
      source: local.hits.isEmpty ? ListSource.server : ListSource.both,
      more: more,
      listUpdatedAt: index.state.refreshedAt,
    );
  }

  /// The phone's own search (5.5): candidates from the search table, the index's births and the
  /// cached charts' legal names, scored, then audited in the same transaction as the read, before
  /// anything is shown. Throws [ChartingPaused] when the store is frozen: nothing is shown.
  SearchRun searchOnPhone(String? text, {Birth? birth, bool more = false}) {
    _refuseIfFrozen();
    final query = SearchQuery(text: text, birth: birth);
    if (query.isEmpty) return SearchRun.empty;
    index.expireIfStale();
    final limit = more ? searchMax : searchLimit;
    return store.transaction(() {
      final ranked = _rank(query, _candidates(query), limit: limit);
      store.appendAudit(
        'patient.searched',
        patientIds: [for (final h in ranked.hits) h.patientId],
        resultCount: ranked.hits.length,
        criteria: _criteria(query.norm, birth),
        source: _source,
      );
      return SearchRun(
        hits: ranked.hits,
        truncated: ranked.truncated,
        source: ListSource.phone,
        more: more,
        listUpdatedAt: index.state.refreshedAt,
      );
    });
  }

  /// The duplicate check at intake (8.1): the phone's check at once, the server's in parallel when
  /// online (it also sees legal names, sound-alikes and patients not yet in this phone's list); the
  /// lists merge by patient, keeping the higher score. The phone waits at most [wait]. Each
  /// displayed candidate set is audited by whoever produced it: the server for its list, the phone
  /// (in the same transaction as its read) for what only it found.
  Future<MatchRun> checkMatches(MatchInput input) async {
    _refuseIfFrozen();
    if (!input.hasName) return MatchRun(checkId: _uuid.v4(), candidates: const [], source: ListSource.phone);
    final local = _localMatches(input);
    final api.PatientMatchResult result;
    try {
      result = await client
          .matchPatients(
            body: api.PatientMatchRequest(
              preferredName: _cut(input.preferredName, 80),
              legalName: _cut(input.legalGiven, 80) == null && _cut(input.legalFamily, 80) == null
                  ? null
                  : api.LegalNameInput(given: _cut(input.legalGiven, 80), family: _cut(input.legalFamily, 80)),
              aliases: [
                for (final a in input.aliases.take(10))
                  if (_cut(a, 60) != null) _cut(a, 60)!,
              ],
              birth: input.birth == null ? null : api.BirthInput.fromJson(input.birth!.toJson()),
              excludePatientId: input.excludePatientId,
              surface: Surface.phone,
            ),
          )
          .timeout(wait);
    } on Object catch (e) {
      if (!_offline(e)) rethrow;
      return _auditMatches(_uuid.v4(), local, source: ListSource.phone);
    }
    final byId = <String, FoundPatient>{for (final c in result.candidates) c.patientId: _fromServer(c)};
    for (final c in local) {
      final theirs = byId[c.patientId];
      if (theirs == null || c.score > theirs.score) byId[c.patientId] = c;
    }
    final merged = byId.values.toList()..sort((a, b) => b.score.compareTo(a.score));
    final shown = merged.take(matchLimit).toList();
    final serverIds = {for (final c in result.candidates) c.patientId};
    final onlyHere = [
      for (final c in shown)
        if (!serverIds.contains(c.patientId)) c,
    ];
    if (onlyHere.isEmpty) {
      return MatchRun(
        checkId: result.checkId,
        candidates: shown,
        source: ListSource.server,
        indexVersion: index.state.version,
        listUpdatedAt: index.state.refreshedAt,
      );
    }
    store.transaction(
      () => store.appendAudit(
        'patient.match_checked',
        checkId: result.checkId,
        patientIds: [for (final c in onlyHere) c.patientId],
        resultCount: onlyHere.length,
        source: _source,
      ),
    );
    return MatchRun(
      checkId: result.checkId,
      candidates: shown,
      source: ListSource.both,
      indexVersion: index.state.version,
      listUpdatedAt: index.state.refreshedAt,
    );
  }

  /// The phone's duplicate check alone, audited here.
  MatchRun checkOnPhone(MatchInput input) {
    _refuseIfFrozen();
    if (!input.hasName) return MatchRun(checkId: _uuid.v4(), candidates: const [], source: ListSource.phone);
    return store.transaction(() => _auditMatches(_uuid.v4(), _localMatches(input), source: ListSource.phone));
  }

  MatchRun _auditMatches(String checkId, List<FoundPatient> found, {required ListSource source}) =>
      store.transaction(() {
        store.appendAudit(
          'patient.match_checked',
          checkId: checkId,
          patientIds: [for (final c in found) c.patientId],
          resultCount: found.length,
          source: _source,
        );
        return MatchRun(
          checkId: checkId,
          candidates: found,
          source: source,
          indexVersion: index.state.version,
          listUpdatedAt: index.state.refreshedAt,
        );
      });

  List<FoundPatient> _localMatches(MatchInput input) {
    final subject = MatchSubject.of(
      preferredName: input.preferredName,
      legalName: normalizeName(input.legalGiven) == null && normalizeName(input.legalFamily) == null
          ? null
          : (given: input.legalGiven, family: input.legalFamily),
      aliases: input.aliases,
      birth: input.birth,
    );
    if (subject.names.isEmpty) return const [];
    final norms = [for (final k in subject.names) k.norm];
    final raw = <String>{
      for (final c in ftsCandidates(store.database, ftsTerms(norms))) c.patientId,
      for (final c in likeCandidates(store.database, shortTokens(norms))) c.patientId,
      ..._withLegalNames(),
    };
    final groups = _groupsOf(raw);
    final own = input.excludePatientId;
    final ranked = rankMatches(
      subject,
      [for (final g in groups.values) g.group],
      exclude: {if (own != null) store.canonicalPatient(own)},
    );
    return [for (final r in ranked) _view(r, groups)];
  }

  // ---- candidates and groups ----

  /// Raw patient IDs worth scoring for [q].
  Set<String> _candidates(SearchQuery q) {
    final db = store.database;
    final norm = q.norm;
    if (norm == null) {
      final birth = q.birth! as BirthDate;
      return {...birthCandidates(db, birth), ..._withBirths()};
    }
    return {
      for (final c in ftsCandidates(db, ftsTerms([norm]))) c.patientId,
      for (final c in likeCandidates(db, shortTokens([norm]))) c.patientId,
      ..._withLegalNames(),
    };
  }

  /// Patient records here holding a legal name: only charts kept under a scope or local work (the
  /// purge removes the rest), so this scan is bounded by what this phone may hold (D40).
  Set<String> _withLegalNames() => {
    for (final r in store.database.select(
      "SELECT r.id FROM records r JOIN fields f ON f.record_id = r.id AND f.field = 'legalName' "
      "WHERE r.entity = 'patient' AND f.value_json <> 'null'",
    ))
      r['id'] as String,
  };

  Set<String> _withBirths() => {
    for (final r in store.database.select(
      "SELECT r.id FROM records r JOIN fields f ON f.record_id = r.id AND f.field = 'birth' "
      "WHERE r.entity = 'patient' AND f.value_json <> 'null'",
    ))
      r['id'] as String,
  };

  /// Patients made here whose create hasn't been confirmed: unknown to the server.
  Set<String> _localOnly() => {
    for (final e in store.outbox())
      if (e.entity == entityPatient && e.op == 'create' && e.state != ChangeState.superseded) e.recordId,
  };

  ({List<FoundPatient> hits, bool truncated}) _rank(SearchQuery q, Set<String> raw, {required int limit}) {
    if (raw.isEmpty) return (hits: const [], truncated: false);
    final groups = _groupsOf(raw);
    final ranked = rankSearch(q, [for (final g in groups.values) g.group], limit: limit);
    return (hits: [for (final r in ranked.hits) _view(r, groups)], truncated: ranked.truncated);
  }

  /// The candidate groups of [raw] IDs: each canonical patient with every record merged into it,
  /// its search names, the legal names of its records held here (scored, never shown), and births.
  Map<String, _Group> _groupsOf(Set<String> raw) {
    final redirects = store.redirects();
    String canonical(String id) {
      var c = id;
      for (var i = 0; i < 20; i++) {
        final next = redirects[c]?.survivorId;
        if (next == null || next == c) break;
        c = next;
      }
      return c;
    }

    final members = <String, Set<String>>{};
    for (final id in raw) {
      members.putIfAbsent(canonical(id), () => {});
    }
    for (final c in members.keys) {
      members[c]!.add(c);
    }
    for (final m in redirects.keys) {
      members[canonical(m)]?.add(m);
    }
    final all = {for (final s in members.values) ...s}.toList();
    final names = <String, List<NameKey>>{};
    final fields = <String, Map<String, Object?>>{};
    final entries = <String, Map<String, Object?>>{};
    for (var i = 0; i < all.length; i += 500) {
      final chunk = all.sublist(i, i + 500 > all.length ? all.length : i + 500);
      final marks = List.filled(chunk.length, '?').join(', ');
      for (final r in store.database.select(
        'SELECT patient_id, name, source FROM patient_names WHERE patient_id IN ($marks)',
        chunk,
      )) {
        final source = switch (r['source']) {
          'preferred' => NameSource.preferred,
          'alias' => NameSource.alias,
          _ => NameSource.descriptor,
        };
        (names[r['patient_id']! as String] ??= []).add(NameKey.normalized(source, r['name']! as String));
      }
      for (final r in store.database.select(
        "SELECT r.id, f.field, f.value_json FROM records r JOIN fields f ON f.record_id = r.id WHERE r.entity = 'patient' "
        "AND f.field IN ('preferredName', 'legalName', 'visualDescriptor', 'birth', 'usualArea', 'allergyScreen', "
        "'$chartMetaField') AND r.id IN ($marks)",
        chunk,
      )) {
        (fields[r['id']! as String] ??= {})[r['field']! as String] = jsonDecode(r['value_json']! as String);
      }
      for (final r in store.database.select(
        'SELECT patient_id, entry_json FROM team_index WHERE patient_id IN ($marks)',
        chunk,
      )) {
        entries[r['patient_id']! as String] = jsonDecode(r['entry_json']! as String) as Map<String, Object?>;
      }
    }
    return {
      for (final MapEntry(key: c, value: ids) in members.entries)
        c: _Group(
          CandidateGroup(
            patientId: c,
            keys: {for (final id in ids) ...?names[id], for (final id in ids) ..._recordKeys(fields[id])},
            births: [
              for (final id in ids) Birth.fromJson(fields[id]?['birth']),
              for (final id in ids) Birth.fromJson(entries[id]?['birth']),
              for (final id in ids) Birth.fromJson(_meta(fields[id])?.indexBirth),
            ],
            lastSeen: _lastSeen(entries[c]?['lastSeenOn'] as String? ?? _meta(fields[c])?.lastSeenOn),
          ),
          entry: entries[c],
          fields: fields[c] ?? (ids.map((id) => fields[id]).nonNulls.firstOrNull ?? const {}),
          ids: ids,
        ),
    };
  }

  static ChartMeta? _meta(Map<String, Object?>? f) =>
      f?[chartMetaField] is Map<String, Object?> ? ChartMeta(f![chartMetaField]! as Map<String, Object?>) : null;

  static DateTime? _lastSeen(String? day) => day == null ? null : DateTime.tryParse(day);

  /// A record's own names (its fields as the phone has them, edits made here included), and its
  /// legal name for scoring only.
  static Iterable<NameKey> _recordKeys(Map<String, Object?>? f) sync* {
    if (f == null) return;
    final preferred = NameKey.of(NameSource.preferred, f['preferredName'] as String?);
    if (preferred != null) yield preferred;
    final descriptor = NameKey.of(NameSource.descriptor, f['visualDescriptor'] as String?);
    if (descriptor != null) yield descriptor;
    final legal = f['legalName'];
    if (legal is Map<String, Object?>) {
      final key = NameKey.legal(legal['given'] as String?, legal['family'] as String?);
      if (key != null) yield key;
    }
  }

  // ---- views ----

  FoundPatient _view(RankedGroup r, Map<String, _Group> groups) {
    final g = groups[r.group.patientId]!;
    final e = g.entry;
    final f = g.fields;
    final meta = _meta(f);
    String? pick(String field) => f.containsKey(field) ? f[field] as String? : e?[field] as String?;
    final aliases = <String>[];
    final active = <BadgeAllergy>[];
    var hasRecords = false;
    for (final id in g.ids) {
      for (final rid in store.recordIdsOfPatient(id)) {
        final rec = store.record(rid);
        if (rec == null || rec.status != 'active') continue;
        if (rec.entity == entityAlias) {
          hasRecords = true;
          final a = rec.attributes['alias'];
          if (a is String && rec.fields['removal']?.value == null) aliases.add(a);
        } else if (rec.entity == entityAllergy) {
          hasRecords = true;
          if (rec.fields['enteredInError']?.value == null) {
            active.add((
              substance: rec.attributes['substance']! as String,
              severity: rec.attributes['severity'] as String?,
            ));
          }
        }
      }
    }
    if (!hasRecords && e != null) {
      for (final a in (e['aliases'] as List<Object?>? ?? const []).cast<Map<String, Object?>>()) {
        aliases.add(a['alias']! as String);
      }
      for (final a in (e['allergies'] as List<Object?>? ?? const []).cast<Map<String, Object?>>()) {
        active.add((substance: a['substance']! as String, severity: a['severity'] as String?));
      }
    }
    aliases.addAll(meta?.mergedNames ?? const []);
    final screen = (f['allergyScreen'] ?? e?['allergyScreen']) as String?;
    final duplicate = e?['duplicate'] is Map<String, Object?>
        ? DuplicateHint.fromJson(e!['duplicate']! as Map<String, Object?>)
        : meta?.duplicate;
    final notSynced = store.outbox().any(
      (x) => x.entity == entityPatient && x.op == 'create' && g.ids.contains(x.recordId),
    );
    return FoundPatient(
      patientId: r.group.patientId,
      score: r.score.score,
      band: r.score.band,
      reasons: r.score.reasons,
      preferredName: pick('preferredName'),
      aliases: {...aliases}.take(5).toList(),
      visualDescriptor: pick('visualDescriptor'),
      birth: Birth.fromJson(f['birth'] ?? e?['birth'] ?? meta?.indexBirth),
      usualArea: pick('usualArea'),
      lastSeenOn: e?['lastSeenOn'] as String? ?? meta?.lastSeenOn,
      badge: allergyBadge(active, screen: screen),
      allergyCount: active.length,
      severeAllergy: active.any((a) => a.severity == 'severe'),
      possibleDuplicate: duplicate != null,
      duplicate: duplicate,
      notSynced: notSynced,
    );
  }

  /// A server result, with what the phone knows of the patient (the allergy names, the reviewer's
  /// note) filled in from its own list.
  FoundPatient _fromServer(api.PatientHit h) {
    final here = _groupsOf({h.patientId});
    final mine = here[h.patientId];
    final local = mine == null || (mine.entry == null && mine.fields.isEmpty)
        ? null
        : _view(RankedGroup(mine.group, MatchScore(h.score, h.reasons)), here);
    final s = h.summary;
    return FoundPatient(
      patientId: h.patientId,
      score: h.score,
      band: h.band,
      reasons: h.reasons,
      preferredName: s.preferredName,
      aliases: s.aliases ?? local?.aliases ?? const [],
      visualDescriptor: s.visualDescriptor,
      birth: s.birth == null ? null : Birth.fromJson(s.birth!.toJson()),
      usualArea: s.usualArea,
      lastSeenOn: s.lastSeenOn,
      badge: local?.badge,
      allergyCount: s.allergy?.count ?? local?.allergyCount ?? 0,
      severeAllergy: s.allergy?.severe ?? local?.severeAllergy ?? false,
      possibleDuplicate: s.duplicateHint ?? local?.possibleDuplicate ?? false,
      duplicate: local?.duplicate,
      notSynced: false,
    );
  }

  static String? _cut(String? s, int max) {
    final t = s?.trim();
    if (t == null || t.isEmpty) return null;
    return t.length > max ? t.substring(0, max).trim() : t;
  }

  /// No answer in time, or no network: the phone's own list stands.
  static bool _offline(Object e) =>
      e is TimeoutException || e is NetworkException || (e is ApiException && e.status >= 500);
}

class _Group {
  _Group(this.group, {required this.entry, required this.fields, required this.ids});
  final CandidateGroup group;
  final Map<String, Object?>? entry;
  final Map<String, Object?> fields;
  final Set<String> ids;
}
