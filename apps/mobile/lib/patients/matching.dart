import 'dart:math';

import '../api/generated/api.dart' show MatchBand, MatchReason;
import 'dob.dart';
import 'generated/nicknames.dart';
import 'match_constants.dart';
import 'normalize.dart';
import 'trigram.dart';

/// The search and duplicate-matching score (design 5.2): one formula, implemented here and in the
/// server's services/api/src/patients/matching.ts. SQL and the phone's FTS5 table only find
/// candidates; this decides. packages/contract/test-vectors/match.json pins the two to each other:
/// every case records the phone's answer (this file: no sound-alike term, design 14.1 #10) and the
/// server's (with Double Metaphone codes from Postgres), scores to 1e-9, bands and reasons exactly.
///
/// Everything that could depend on the order of the inputs (which string is "best", which reason is
/// given on a tie) is decided over a fixed order: names by source (preferred, legal, alias,
/// descriptor) then text, births by precision then value, and a later candidate replaces an earlier
/// one only when strictly better.

/// Where a name string came from, in the order ties are decided.
enum NameSource {
  /// What they go by.
  preferred,

  /// "given family". On the phone only from a chart held under a scope (D40).
  legal,

  alias,

  /// What they look like: searched (weighted), never matched.
  descriptor,
}

/// One searchable string of a patient, normalized once for scoring against many.
class NameKey {
  /// From [norm], already normalized (the phone's search table stores names normalized).
  NameKey.normalized(NameSource source, String norm) : this._(source, norm, scoringTokens(norm));

  NameKey._(this.source, this.norm, this.tokens) : _joined = trigrams(tokens.join(' '));

  /// [text] as typed or stored; null when nothing of it is left after normalizing.
  static NameKey? of(NameSource source, String? text) {
    final norm = normalizeName(text);
    return norm == null ? null : NameKey.normalized(source, norm);
  }

  /// A legal name as the scorer reads it: "given family", either part possibly absent.
  static NameKey? legal(String? given, String? family) => of(NameSource.legal, [given, family].nonNulls.join(' '));

  final NameSource source;

  /// `normalize_name` of the text.
  final String norm;

  /// The words scored: weak words dropped unless nothing else is left.
  final List<String> tokens;
  final Set<String> _joined;
}

/// A canonical patient and every record merged into it, as scoring sees them: the strings the
/// caller may search, and the births.
class CandidateGroup {
  CandidateGroup({
    required this.patientId,
    required Iterable<NameKey> keys,
    Iterable<Birth?> births = const [],
    this.lastSeen,
  }) : keys = _sortedKeys(keys),
       births = _sortedBirths(births);

  /// The canonical ID.
  final String patientId;
  final List<NameKey> keys;
  final List<Birth> births;

  /// Orders equal scores: the most recently seen first.
  final DateTime? lastSeen;
}

/// Someone being registered (or a stored patient, at the fake server's re-run): legal "given
/// family", preferred name, street names, and a birth. A description never matches.
class MatchSubject {
  MatchSubject({required Iterable<NameKey> names, this.birth}) : names = _sortedKeys(names);

  /// The subject of an intake form, from what was typed.
  factory MatchSubject.of({
    String? preferredName,
    ({String? given, String? family})? legalName,
    Iterable<String> aliases = const [],
    Birth? birth,
  }) => MatchSubject(
    names: [
      NameKey.of(NameSource.preferred, preferredName),
      if (legalName != null) NameKey.legal(legalName.given, legalName.family),
      for (final a in aliases) NameKey.of(NameSource.alias, a),
    ].nonNulls,
    birth: birth,
  );

  final List<NameKey> names;
  final Birth? birth;
}

/// A year and month to search by, which no recorded birth is (`BirthQuery` without a day).
typedef BirthMonth = ({int year, int month});

/// What a person typed into search: a name, street name or description, and a birth.
class SearchQuery {
  SearchQuery({String? text, this.birth}) : norm = normalizeName(text), month = null;

  /// A search by a year and month (the portal's form allows it; the phone's Born field gives a
  /// [Birth]).
  SearchQuery.yearMonth({String? text, required BirthMonth this.month}) : norm = normalizeName(text), birth = null;

  /// The normalized search text; null for a search by birth date alone.
  final String? norm;
  final Birth? birth;
  final BirthMonth? month;

  /// Nothing to search by: no name, and no full birth date (a year never browses the list).
  bool get isEmpty => norm == null && birth is! BirthDate;
}

/// A score and why.
class MatchScore {
  const MatchScore(this.score, this.reasons);
  final double score;

  /// Why, as the closed list the screens put in words, in [MatchReason]'s order; never a name.
  final List<MatchReason> reasons;

  MatchBand get band => bandOf(score);
}

/// likely ≥ [matchLikely] > possible ≥ [matchPossible] > weak.
MatchBand bandOf(double score) => score >= matchLikely
    ? MatchBand.likely
    : score >= matchPossible
    ? MatchBand.possible
    : MatchBand.weak;

List<NameKey> _sortedKeys(Iterable<NameKey> keys) => [...keys]
  ..sort((a, b) {
    final s = a.source.index - b.source.index;
    return s != 0 ? s : a.norm.compareTo(b.norm);
  });

// --------------------------------------------------------------------------------------------
// Nicknames
// --------------------------------------------------------------------------------------------

final Map<String, List<int>> _groupsOf = () {
  final index = <String, List<int>>{};
  for (var i = 0; i < nicknameGroups.length; i++) {
    for (final t in nicknameGroups[i].split(' ')) {
      (index[t] ??= []).add(i);
    }
  }
  return index;
}();

/// Two different tokens on one line of the nickname list ("mike" and "michael").
bool areNicknames(String a, String b) {
  if (a == b) return false;
  final ga = _groupsOf[a];
  final gb = _groupsOf[b];
  return ga != null && gb != null && ga.any(gb.contains);
}

/// Every token that shares a line with [t], sorted. Expanded at query time only, so no reindex.
List<String> nicknamePartners(String t) =>
    ({for (final g in _groupsOf[t] ?? const <int>[]) ...nicknameGroups[g].split(' ')}..remove(t)).toList()..sort();

/// The tokens candidate retrieval looks for (the FTS query's terms): the scoring tokens of every
/// query string plus their nickname partners, sorted.
List<String> retrievalTokens(Iterable<String> norms) => ({
  for (final n in norms)
    for (final t in scoringTokens(n)) ...[t, ...nicknamePartners(t)],
}).toList()..sort();

// --------------------------------------------------------------------------------------------
// Tokens
// --------------------------------------------------------------------------------------------

/// Optimal string alignment distance: insertions, deletions, substitutions, adjacent swaps.
int osaDistance(String a, String b) {
  final m = a.length;
  final n = b.length;
  final d = [for (var i = 0; i <= m; i++) List<int>.generate(n + 1, (j) => i == 0 ? j : (j == 0 ? i : 0))];
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      final cost = a[i - 1] == b[j - 1] ? 0 : 1;
      var v = min(min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) v = min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[m][n];
}

/// How two tokens matched. [exact] and [prefix] give no reason of their own; the phone never
/// finds a sound-alike.
enum How { exact, nickname, typo, initial, prefix }

typedef TokenMatch = ({double sim, How? how});

/// `tokSim(q, c)`: 1 when equal, else the best of nickname, edit distance, trigrams, an initial
/// and (in [search]) a prefix ("smi" finds Smitty). Evaluated in that order; a later term wins only
/// when strictly higher.
TokenMatch tokSim(String q, String c, {required bool search}) {
  if (q == c) return (sim: 1.0, how: How.exact);
  TokenMatch best = (sim: 0.0, how: null);
  void consider(double sim, How how) {
    if (sim > best.sim) best = (sim: sim, how: how);
  }

  if (areNicknames(q, c)) consider(nicknameSim, How.nickname);
  final shorter = min(q.length, c.length);
  final longer = max(q.length, c.length);
  if (shorter >= 3) consider(1 - osaDistance(q, c) / longer, How.typo);
  consider(trigramSimilarity(q, c), How.typo);
  if ((q.length == 1 && c.startsWith(q)) || (c.length == 1 && q.startsWith(c))) consider(initialSim, How.initial);
  if (search && q.length >= 3 && c.startsWith(q)) consider(prefixSim, How.prefix);
  return best;
}

/// A token match counts toward the reasons only when it is at least a weak name match.
bool _counts(TokenMatch m) => m.sim >= nameFloor;

TokenMatch _bestOf(String q, List<String> cs, {required bool search}) {
  TokenMatch best = (sim: 0.0, how: null);
  for (final c in cs) {
    final m = tokSim(q, c, search: search);
    if (m.sim > best.sim) best = m;
  }
  return best;
}

typedef Similarity = ({double sim, List<How> hows});

/// `coverage(Q, C)`: the mean over the typed tokens of their best match, so every typed word is
/// found.
Similarity coverage(List<String> qs, List<String> cs, {required bool search}) {
  if (qs.isEmpty || cs.isEmpty) return (sim: 0.0, hows: const []);
  var sum = 0.0;
  final hows = <How>[];
  for (final q in qs) {
    final m = _bestOf(q, cs, search: search);
    sum += m.sim;
    if (m.how != null && _counts(m)) hows.add(m.how!);
  }
  return (sim: sum / qs.length, hows: hows);
}

/// `symSim(A, B)`: coverage both ways, weighted by the number of tokens on each side.
Similarity symSim(List<String> as, List<String> bs) {
  if (as.isEmpty || bs.isEmpty) return (sim: 0.0, hows: const []);
  var sum = 0.0;
  final hows = <How>[];
  for (final (xs, ys) in [(as, bs), (bs, as)]) {
    for (final x in xs) {
      final m = _bestOf(x, ys, search: false);
      sum += m.sim;
      if (m.how != null && _counts(m)) hows.add(m.how!);
    }
  }
  return (sim: sum / (as.length + bs.length), hows: hows);
}

/// `nameSim(a, b)`: the whole strings' trigram similarity, or [symSim] of their tokens, whichever
/// is higher.
Similarity nameSim(NameKey a, NameKey b) {
  final sym = symSim(a.tokens, b.tokens);
  final whole = trigramSetSimilarity(a._joined, b._joined);
  return whole > sym.sim ? (sim: whole, hows: whole >= nameFloor ? const [How.typo] : const []) : sym;
}

// --------------------------------------------------------------------------------------------
// Births
// --------------------------------------------------------------------------------------------

/// How two births agree; [reason] is null when they disagree (sim 0).
typedef DobMatch = ({double sim, MatchReason? reason});

const DobMatch _disagree = (sim: 0.0, reason: null);

/// 1946/1964: the digits with one adjacent pair swapped.
bool _digitsTransposed(int a, int b) {
  final x = a.toString();
  final y = b.toString();
  if (x.length != y.length || x == y) return false;
  for (var i = 0; i + 1 < x.length; i++) {
    if (x[i] == y[i + 1] &&
        x[i + 1] == y[i] &&
        x.substring(0, i) == y.substring(0, i) &&
        x.substring(i + 2) == y.substring(i + 2)) {
      return true;
    }
  }
  return false;
}

/// Years 1, 10 or 100 apart, or with two digits transposed: a slip of the pen.
bool _yearSlip(int a, int b) => const {1, 10, 100}.contains((a - b).abs()) || _digitsTransposed(a, b);

DobMatch _yearRule(int a, int b) => a == b
    ? (sim: yearSame, reason: MatchReason.dobYear)
    : (a - b).abs() == 1
    ? (sim: yearNear, reason: MatchReason.dobYear)
    : _disagree;

/// `dobSim(x, y)`: null when either is unknown. [x] is the query or the new patient, [y] a stored
/// birth.
DobMatch? dobSim(Birth? x, Birth? y) {
  if (x == null || y == null) return null;
  if (x is BirthEstimate || y is BirthEstimate) {
    return (x.year - y.year).abs() <= estimateRange ? (sim: estimateNear, reason: MatchReason.dobEstimate) : _disagree;
  }
  if (x is! BirthDate || y is! BirthDate) return _yearRule(x.year, y.year);
  final a = x;
  final b = y;
  if (a == b) return (sim: 1.0, reason: MatchReason.dobExact);
  if (a.year == b.year && a.day <= 12 && a.day != a.month && a.month == b.day && a.day == b.month) {
    return (sim: dobSwapped, reason: MatchReason.dobSwapped);
  }
  if (a.year == b.year && a.month == b.month) return (sim: dobMonthYear, reason: MatchReason.dobMonthYear);
  if (a.month == b.month && a.day == b.day && _yearSlip(a.year, b.year)) {
    return (sim: dobYearSlip, reason: MatchReason.dobYearSlip);
  }
  if (a.year == b.year) return (sim: dobYear, reason: MatchReason.dobYear);
  return _disagree;
}

/// A year and month searched against a stored birth: against a full date, the same year and
/// month [dobMonthYear], the same year only [dobYear], otherwise 0; against a year it is a year.
DobMatch? dobSimMonth(BirthMonth x, Birth? y) {
  if (y == null) return null;
  if (y is BirthEstimate) {
    return (x.year - y.year).abs() <= estimateRange ? (sim: estimateNear, reason: MatchReason.dobEstimate) : _disagree;
  }
  if (y is! BirthDate) return _yearRule(x.year, y.year);
  if (x.year == y.year && x.month == y.month) return (sim: dobMonthYear, reason: MatchReason.dobMonthYear);
  if (x.year == y.year) return (sim: dobYear, reason: MatchReason.dobYear);
  return _disagree;
}

String _birthKey(Birth b) => b is BirthDate ? b.iso : b.year.toString().padLeft(4, '0');

int _precisionOrder(Birth b) => switch (b) {
  BirthDate() => 0,
  BirthYear() => 1,
  BirthEstimate() => 2,
};

/// Births in a fixed order, unknown ones dropped.
List<Birth> _sortedBirths(Iterable<Birth?> births) => [...births.nonNulls]
  ..sort((a, b) {
    final p = _precisionOrder(a) - _precisionOrder(b);
    return p != 0 ? p : _birthKey(a).compareTo(_birthKey(b));
  });

DobMatch? _best(Iterable<DobMatch?> matches) {
  DobMatch? best;
  for (final m in matches) {
    if (m != null && (best == null || m.sim > best.sim)) best = m;
  }
  return best;
}

/// The best [dobSim] against any of the group's births; null when nothing can be compared.
DobMatch? bestDob(Birth? x, List<Birth> births) => _best(births.map((y) => dobSim(x, y)));

// --------------------------------------------------------------------------------------------
// Scores
// --------------------------------------------------------------------------------------------

MatchReason _sourceReason(NameSource s) => switch (s) {
  NameSource.preferred => MatchReason.name,
  NameSource.legal => MatchReason.legalName,
  NameSource.alias => MatchReason.alias,
  NameSource.descriptor => MatchReason.descriptor,
};

void _addHows(Set<MatchReason> out, List<How> hows) {
  for (final h in hows) {
    switch (h) {
      case How.nickname:
        out.add(MatchReason.nickname);
      case How.typo:
        out.add(MatchReason.typo);
      case How.initial:
        out.add(MatchReason.initial);
      case How.exact || How.prefix:
        break;
    }
  }
}

List<MatchReason> _ordered(Set<MatchReason> reasons) => [
  for (final r in MatchReason.values)
    if (reasons.contains(r)) r,
];

/// The search score of one candidate group (design 5.2, "Search"): the best of its strings by
/// [coverage] of the typed words (a description weighted by [descriptorWeight]), blended with the
/// birth when the query has one and the group has one. A search by birth date alone scores the
/// birth. Reasons: the best string's source and how its words matched, when the name counts at all
/// ([nameFloor]), and the birth's reason. The caller passes only the strings the role may search.
MatchScore scoreSearch(SearchQuery q, CandidateGroup group) {
  final reasons = <MatchReason>{};
  var text = 0.0;
  ({NameKey key, List<How> hows})? best;
  final norm = q.norm;
  if (norm != null) {
    final qs = scoringTokens(norm);
    for (final key in group.keys) {
      final cov = coverage(qs, key.tokens, search: true);
      final s = cov.sim * (key.source == NameSource.descriptor ? descriptorWeight : 1);
      if (s > text) {
        text = s;
        best = (key: key, hows: cov.hows);
      }
    }
    if (best != null && text >= nameFloor) {
      reasons.add(_sourceReason(best.key.source));
      _addHows(reasons, best.hows);
    }
  }
  final month = q.month;
  final dob = month != null ? _best(group.births.map((y) => dobSimMonth(month, y))) : bestDob(q.birth, group.births);
  final score = norm == null
      ? (dob?.sim ?? 0.0)
      : (dob != null ? (1 - searchDobWeight) * text + searchDobWeight * dob.sim : text);
  if (dob?.reason case final r?) reasons.add(r);
  return MatchScore(score, _ordered(reasons));
}

/// The match score (design 5.2, "Match"): the best name pair N (an alias on either side weighs
/// [aliasWeight]), the best birth D, the blend, and the three caps that keep a birth alone, one
/// shared street name or two different full dates from flagging anyone. Reasons: every name pair
/// that would be a possible match on its own (weighted ≥ [matchPossible]) and the best pair when it
/// counts (≥ [nameFloor]), each as its stored source (an alias on either side is `alias`) and how
/// its words matched; then the birth's reason.
MatchScore scoreMatch(MatchSubject subject, CandidateGroup group) {
  final mine = subject.names.where((k) => k.source != NameSource.descriptor);
  final theirs = group.keys.where((k) => k.source != NameSource.descriptor).toList();
  final pairs = <({double s, MatchReason reason, List<How> hows, bool single})>[];
  var bestIndex = -1;
  for (final a in mine) {
    for (final b in theirs) {
      final alias = a.source == NameSource.alias || b.source == NameSource.alias;
      final sim = nameSim(a, b);
      final pair = (
        s: sim.sim * (alias ? aliasWeight : 1),
        reason: alias ? MatchReason.alias : _sourceReason(b.source),
        hows: sim.hows,
        single: a.tokens.length == 1 && b.tokens.length == 1,
      );
      if (bestIndex < 0 || pair.s > pairs[bestIndex].s) bestIndex = pairs.length;
      pairs.add(pair);
    }
  }
  final best = bestIndex < 0 ? null : pairs[bestIndex];
  final n = best?.s ?? 0.0;
  final dob = bestDob(subject.birth, group.births);
  var total = dob != null ? wName * n + wDob * dob.sim : n * noDobFactor;
  if (dob == null && (best?.single ?? false)) total = min(total, singleNameCap);
  if (dob != null && dob.sim == 0 && subject.birth is BirthDate && group.births.any((b) => b is BirthDate)) {
    total = min(total, dobConflictCap);
  }
  if (n < nameFloor) total = min(total, dobOnlyCap);

  final reasons = <MatchReason>{};
  for (final (i, p) in pairs.indexed) {
    if (p.s >= matchPossible || (i == bestIndex && n >= nameFloor)) {
      reasons.add(p.reason);
      _addHows(reasons, p.hows);
    }
  }
  if (dob?.reason case final r?) reasons.add(r);
  return MatchScore(total, _ordered(reasons));
}

// --------------------------------------------------------------------------------------------
// Ranking
// --------------------------------------------------------------------------------------------

/// A scored candidate group.
class RankedGroup {
  const RankedGroup(this.group, this.score);
  final CandidateGroup group;
  final MatchScore score;
}

/// Score desc, then the most recently seen, then canonical ID: the server's order.
int byRank(RankedGroup a, RankedGroup b) {
  if (a.score.score != b.score.score) return b.score.score.compareTo(a.score.score);
  final sa = a.group.lastSeen;
  final sb = b.group.lastSeen;
  if (sa != sb) {
    if (sa == null) return 1;
    if (sb == null) return -1;
    return sb.compareTo(sa);
  }
  return a.group.patientId.compareTo(b.group.patientId);
}

/// Search hits at or above [searchMin], best first: at most [limit], and whether more scored that
/// high (Show more).
({List<RankedGroup> hits, bool truncated}) rankSearch(
  SearchQuery query,
  Iterable<CandidateGroup> groups, {
  int limit = searchLimit,
}) {
  if (query.isEmpty) return (hits: const [], truncated: false);
  final ranked = [
    for (final g in groups)
      if (scoreSearch(query, g) case final s when s.score >= searchMin) RankedGroup(g, s),
  ]..sort(byRank);
  return (hits: ranked.take(limit).toList(), truncated: ranked.length > limit);
}

/// Candidates for someone being registered, at or above [minScore], best first, at most [limit].
/// [exclude] holds canonical IDs left out: the patient's own group when editing, and pairs a
/// person kept separate.
List<RankedGroup> rankMatches(
  MatchSubject subject,
  Iterable<CandidateGroup> groups, {
  Set<String> exclude = const {},
  double minScore = matchPossible,
  int limit = matchLimit,
}) {
  final ranked = [
    for (final g in groups)
      if (!exclude.contains(g.patientId))
        if (scoreMatch(subject, g) case final s when s.score >= minScore) RankedGroup(g, s),
  ]..sort(byRank);
  return ranked.take(limit).toList();
}
