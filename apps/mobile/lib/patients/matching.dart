import 'dart:math';

import '../api/generated/api.dart' show MatchBand, MatchReason;
import 'dob.dart';
import 'generated/nicknames.dart';
import 'match_constants.dart';
import 'normalize.dart';
import 'trigram.dart';

/// The search and duplicate-match score (design 5.2), the phone's copy of
/// services/api/src/patients/matching.ts. SQL and FTS5 only find candidates; this decides. The
/// phone has no sound-alike term (Double Metaphone is server only, design 14.1 #10), so its score
/// can be lower than the server's for the same pair; match.json records both.

/// Where a name string came from.
enum NameSource {
  /// What they go by.
  preferred,

  /// "given family". On the phone only from a chart held under a scope (D40).
  legal,

  alias,

  /// What they look like; searched (weighted), never matched.
  descriptor,
}

/// One name string, normalized once for scoring against many.
class MatchName {
  factory MatchName(NameSource source, String? text) {
    final norm = normalizeName(text) ?? '';
    final tokens = scoringTokens(nameTokens(norm));
    return MatchName._(source, norm, tokens, trigrams(norm), [for (final t in tokens) trigrams(t)]);
  }

  /// A legal name as the scorer reads it: "given family", either part possibly absent.
  factory MatchName.legal(String? given, String? family) =>
      MatchName(NameSource.legal, [given, family].nonNulls.join(' '));

  MatchName._(this.source, this.norm, this.tokens, this.trigramSet, this._tokenTrigrams);

  final NameSource source;

  /// `normalize_name`, or '' when nothing is left.
  final String norm;

  /// The tokens scored: weak words dropped unless nothing else is left.
  final List<String> tokens;
  final Set<String> trigramSet;
  final List<Set<String>> _tokenTrigrams;

  bool get isEmpty => tokens.isEmpty;
}

/// A patient as the scorer sees it: for a stored patient, every name string and birth of its group
/// (a canonical patient and everything merged into it); for an intake, what was typed.
class MatchPatient {
  MatchPatient({this.patientId, required Iterable<MatchName> names, Iterable<Birth> births = const [], this.lastSeen})
    : names = [
        for (final n in names)
          if (!n.isEmpty) n,
      ],
      births = List.unmodifiable(births);

  /// The canonical ID; null for an intake not yet saved.
  final String? patientId;
  final List<MatchName> names;
  final List<Birth> births;

  /// Orders equal scores, most recently seen first.
  final DateTime? lastSeen;
}

class MatchScore {
  const MatchScore(this.score, this.reasons);

  final double score;

  /// Why, as the closed list the screens put in words, in [MatchReason] order.
  final List<MatchReason> reasons;

  /// likely ≥ [matchLikely] > possible ≥ [matchPossible] > weak.
  MatchBand get band => score >= matchLikely
      ? MatchBand.likely
      : score >= matchPossible
      ? MatchBand.possible
      : MatchBand.weak;
}

// --------------------------------------------------------------------------------------------
// Tokens
// --------------------------------------------------------------------------------------------

final Map<String, Set<int>> _nicknameIndex = () {
  final index = <String, Set<int>>{};
  for (var i = 0; i < nicknameGroups.length; i++) {
    for (final name in nicknameGroups[i].split(' ')) {
      (index[name] ??= {}).add(i);
    }
  }
  return index;
}();

/// Two tokens share a line of the nickname data (José/Pepe, Mike/Michael).
bool areNicknames(String a, String b) {
  if (a == b) return false;
  final ga = _nicknameIndex[a];
  final gb = _nicknameIndex[b];
  return ga != null && gb != null && ga.any(gb.contains);
}

/// Every token that shares a nickname line with [token]; the phone's FTS query ORs their trigrams.
Set<String> nicknamesOf(String token) =>
    {for (final g in _nicknameIndex[token] ?? const <int>{}) ...nicknameGroups[g].split(' ')}..remove(token);

/// Optimal string alignment distance: insertions, deletions, substitutions and adjacent
/// transpositions, each substring edited once.
int osaDistance(String a, String b) {
  final n = a.length;
  final m = b.length;
  var prev2 = List<int>.filled(m + 1, 0);
  var prev = List<int>.generate(m + 1, (j) => j);
  for (var i = 1; i <= n; i++) {
    final cur = List<int>.filled(m + 1, 0)..[0] = i;
    for (var j = 1; j <= m; j++) {
      final cost = a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1) ? 0 : 1;
      var d = min(min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + cost);
      if (i > 1 && j > 1 && a.codeUnitAt(i - 1) == b.codeUnitAt(j - 2) && a.codeUnitAt(i - 2) == b.codeUnitAt(j - 1)) {
        d = min(d, prev2[j - 2] + 1);
      }
      cur[j] = d;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/// How a token matched, for the reasons.
enum _How { exact, nickname, typo, initial, prefix, none }

typedef _TokMatch = ({double sim, _How how});

_TokMatch _tok(String q, Set<String> qt, String c, Set<String> ct, {required bool search}) {
  if (q == c) return (sim: 1.0, how: _How.exact);
  _TokMatch best = (sim: 0.0, how: _How.none);
  void consider(double sim, _How how) {
    if (sim > best.sim) best = (sim: sim, how: how);
  }

  if (areNicknames(q, c)) consider(nicknameSim, _How.nickname);
  final longest = max(q.length, c.length);
  if (min(q.length, c.length) >= 3) consider(1 - osaDistance(q, c) / longest, _How.typo);
  consider(trigramSetSimilarity(qt, ct), _How.typo);
  if ((q.length == 1 && c.startsWith(q)) || (c.length == 1 && q.startsWith(c))) consider(initialSim, _How.initial);
  if (search && q.length >= 3 && c.startsWith(q)) consider(prefixSim, _How.prefix);
  return best;
}

/// `tokSim(q, c)`: how close a query token is to a stored one, from 0 to 1. [search] allows the
/// prefix term (typing "smi").
double tokSim(String q, String c, {bool search = false}) => _tok(q, trigrams(q), c, trigrams(c), search: search).sim;

/// For each token of [from], its best match among [to].
List<_TokMatch> _bestEach(MatchName from, MatchName to, {required bool search}) => [
  for (var i = 0; i < from.tokens.length; i++)
    [
      for (var j = 0; j < to.tokens.length; j++)
        _tok(from.tokens[i], from._tokenTrigrams[i], to.tokens[j], to._tokenTrigrams[j], search: search),
    ].fold<_TokMatch>((sim: 0.0, how: _How.none), (a, b) => b.sim > a.sim ? b : a),
];

double _mean(Iterable<double> xs, int n) => n == 0 ? 0 : xs.fold<double>(0, (a, b) => a + b) / n;

/// `coverage(Q, C)`: every typed token is found. The mean over the query's tokens of their best
/// [tokSim] against the stored string's.
double coverage(MatchName query, MatchName stored, {bool search = true}) =>
    stored.isEmpty ? 0 : _mean(_bestEach(query, stored, search: search).map((m) => m.sim), query.tokens.length);

/// `symSim(A, B)`: each side's tokens found in the other, averaged over both.
double symSim(MatchName a, MatchName b) {
  if (a.isEmpty || b.isEmpty) return 0;
  final ab = _bestEach(a, b, search: false).fold<double>(0, (s, m) => s + m.sim);
  final ba = _bestEach(b, a, search: false).fold<double>(0, (s, m) => s + m.sim);
  return (ab + ba) / (a.tokens.length + b.tokens.length);
}

/// `nameSim(a, b)`: the whole strings' trigram similarity or the token alignment, whichever is
/// higher.
double nameSim(MatchName a, MatchName b) => max(trigramSetSimilarity(a.trigramSet, b.trigramSet), symSim(a, b));

// --------------------------------------------------------------------------------------------
// Births
// --------------------------------------------------------------------------------------------

/// `dobSim(x, y)`, with the reason it gives; null when either birth is unknown.
({double sim, MatchReason? reason})? dobSim(Birth? x, Birth? y) {
  if (x == null || y == null) return null;
  ({double sim, MatchReason? reason}) give(double sim, MatchReason reason) =>
      sim > 0 ? (sim: sim, reason: reason) : (sim: 0.0, reason: null);
  final dy = (x.year - y.year).abs();
  switch ((x, y)) {
    case (BirthEstimate(), _) || (_, BirthEstimate()):
      return give(dy <= estimateRange ? estimateNear : 0, MatchReason.dobEstimate);
    case (final BirthDate a, final BirthDate b):
      if (a == b) return (sim: 1.0, reason: MatchReason.dobExact);
      if (a.year == b.year && a.month == b.day && a.day == b.month && a.month <= 12 && a.day <= 12) {
        return (sim: dobSwapped, reason: MatchReason.dobSwapped);
      }
      if (a.year == b.year && a.month == b.month) return (sim: dobMonthYear, reason: MatchReason.dobMonthYear);
      if (a.month == b.month && a.day == b.day && (const {1, 10, 100}.contains(dy) || _transposed(a.year, b.year))) {
        return (sim: dobYearSlip, reason: MatchReason.dobYearSlip);
      }
      return give(a.year == b.year ? dobYear : 0, MatchReason.dobYear);
    default:
      // A year against a year or a date.
      return give(dy == 0 ? yearSame : (dy == 1 ? yearNear : 0), MatchReason.dobYear);
  }
}

/// Two years whose digits differ by one swap of neighbours (1946/1964).
bool _transposed(int a, int b) {
  final x = a.toString();
  final y = b.toString();
  if (x.length != y.length || x == y) return false;
  for (var i = 0; i + 1 < x.length; i++) {
    if (x[i] != y[i]) {
      return x[i] == y[i + 1] && x[i + 1] == y[i] && x.substring(i + 2) == y.substring(i + 2);
    }
  }
  return false;
}

({double sim, MatchReason? reason})? _bestBirth(Birth? x, List<Birth> ys) {
  ({double sim, MatchReason? reason})? best;
  for (final y in ys) {
    final d = dobSim(x, y);
    if (d != null && (best == null || d.sim > best.sim)) best = d;
  }
  return best;
}

// --------------------------------------------------------------------------------------------
// Search and match
// --------------------------------------------------------------------------------------------

/// What a person typed into search: a name, street name or description, and a birth.
class SearchQuery {
  SearchQuery({String? text, this.birth}) : name = MatchName(NameSource.preferred, text);
  final MatchName name;
  final Birth? birth;

  /// Nothing to search by: no name, and no full birth date.
  bool get isEmpty => name.isEmpty && birth is! BirthDate;
}

MatchReason _sourceReason(NameSource s) => switch (s) {
  NameSource.preferred => MatchReason.name,
  NameSource.legal => MatchReason.legalName,
  NameSource.alias => MatchReason.alias,
  NameSource.descriptor => MatchReason.descriptor,
};

MatchReason? _howReason(_How h) => switch (h) {
  _How.nickname => MatchReason.nickname,
  _How.typo => MatchReason.typo,
  _How.initial => MatchReason.initial,
  _How.exact || _How.prefix || _How.none => null,
};

List<MatchReason> _ordered(Set<MatchReason> reasons) => [
  for (final r in MatchReason.values)
    if (reasons.contains(r)) r,
];

/// The search score (Patients tab): the best of the candidate's strings by [coverage], a
/// description weighted by [descriptorWeight], blended with the birth when the query has one. A
/// birth-date-only search scores the birth alone. Shown when the score is at least [searchMin].
MatchScore scoreSearch(SearchQuery query, MatchPatient candidate) {
  final reasons = <MatchReason>{};
  var text = 0.0;
  if (!query.name.isEmpty) {
    MatchName? best;
    List<_TokMatch>? bestTokens;
    for (final s in candidate.names) {
      final tokens = _bestEach(query.name, s, search: true);
      final weight = s.source == NameSource.descriptor ? descriptorWeight : 1.0;
      final score = _mean(tokens.map((m) => m.sim), tokens.length) * weight;
      if (score > text) {
        text = score;
        best = s;
        bestTokens = tokens;
      }
    }
    if (best != null) {
      reasons.add(_sourceReason(best.source));
      reasons.addAll(bestTokens!.map((m) => _howReason(m.how)).nonNulls);
    }
  }
  final dob = query.birth == null ? null : _bestBirth(query.birth, candidate.births);
  if (dob?.reason case final r?) reasons.add(r);
  final double score;
  if (query.name.isEmpty) {
    score = query.birth is BirthDate ? (dob?.sim ?? 0) : 0;
  } else {
    score = dob == null ? text : (1 - searchDobWeight) * text + searchDobWeight * dob.sim;
  }
  return MatchScore(score, _ordered(reasons));
}

/// The duplicate-match score (intake before saving, and the fake server's re-run): the best pair
/// of name strings, an alias pair weighted by [aliasWeight], with the best birth agreement, and
/// the caps that keep a birth alone, one shared street name, or two different full dates from
/// flagging anyone. The description never takes part.
MatchScore scoreMatch(MatchPatient subject, MatchPatient stored) {
  final reasons = <MatchReason>{};
  var n = 0.0;
  var bestSingle = false;
  for (final a in subject.names) {
    if (a.source == NameSource.descriptor) continue;
    var aBest = 0.0;
    MatchName? aMatch;
    for (final b in stored.names) {
      if (b.source == NameSource.descriptor) continue;
      final w = a.source == NameSource.alias || b.source == NameSource.alias ? aliasWeight : 1.0;
      final s = nameSim(a, b) * w;
      if (s > aBest) {
        aBest = s;
        aMatch = b;
      }
      if (s > n) {
        n = s;
        bestSingle = a.tokens.length == 1 && b.tokens.length == 1;
      }
    }
    if (aMatch != null && aBest >= nameFloor) {
      reasons.add(_sourceReason(aMatch.source));
      reasons.addAll(_bestEach(a, aMatch, search: false).map((m) => _howReason(m.how)).nonNulls);
    }
  }
  final births = subject.births.isEmpty ? null : _bestOver(subject.births, stored.births);
  if (births?.reason case final r?) reasons.add(r);
  var total = births == null ? n * noDobFactor : wName * n + wDob * births.sim;
  if (births == null && bestSingle) total = min(total, singleNameCap);
  if (births != null &&
      births.sim == 0 &&
      subject.births.every((b) => b is BirthDate) &&
      stored.births.every((b) => b is BirthDate)) {
    total = min(total, dobConflictCap);
  }
  if (n < nameFloor) total = min(total, dobOnlyCap);
  return MatchScore(total, _ordered(reasons));
}

({double sim, MatchReason? reason})? _bestOver(List<Birth> xs, List<Birth> ys) {
  ({double sim, MatchReason? reason})? best;
  for (final x in xs) {
    final d = _bestBirth(x, ys);
    if (d != null && (best == null || d.sim > best.sim)) best = d;
  }
  return best;
}

/// A scored candidate.
class RankedPatient {
  const RankedPatient(this.patient, this.score);
  final MatchPatient patient;
  final MatchScore score;
}

int _byRank(RankedPatient a, RankedPatient b) {
  final s = b.score.score.compareTo(a.score.score);
  if (s != 0) return s;
  final la = a.patient.lastSeen;
  final lb = b.patient.lastSeen;
  if (la != lb) {
    if (la == null) return 1;
    if (lb == null) return -1;
    final l = lb.compareTo(la);
    if (l != 0) return l;
  }
  return (a.patient.patientId ?? '').compareTo(b.patient.patientId ?? '');
}

/// Scores, keeps what reaches [searchMin], sorts like the server (score, then most recently seen,
/// then ID) and cuts to [limit].
List<RankedPatient> rankSearch(SearchQuery query, Iterable<MatchPatient> candidates, {int limit = searchLimit}) {
  if (query.isEmpty) return const [];
  final hits = [
    for (final c in candidates)
      if (scoreSearch(query, c) case final s when s.score >= searchMin) RankedPatient(c, s),
  ]..sort(_byRank);
  return hits.take(limit).toList();
}

/// Scores [subject] against each candidate except its own group, keeps what reaches
/// [matchPossible], sorts like [rankSearch] and cuts to [limit]. Suppressed pairs ("Not the same
/// person") are the caller's to leave out.
List<RankedPatient> rankMatches(MatchPatient subject, Iterable<MatchPatient> candidates, {int limit = matchLimit}) {
  final hits = [
    for (final c in candidates)
      if (subject.patientId == null || c.patientId != subject.patientId)
        if (scoreMatch(subject, c) case final s when s.score >= matchPossible) RankedPatient(c, s),
  ]..sort(_byRank);
  return hits.take(limit).toList();
}
