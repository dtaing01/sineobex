import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show MatchBand, MatchReason;
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/match_constants.dart';
import 'package:sineobex_field/patients/matching.dart';

/// The server's scorer wrote match.json; the phone must give every `phone` answer (no sound-alike
/// term), scores to the file's tolerance, bands and reasons exactly. A phone that scored
/// differently would warn about different people than the server queues.
void main() {
  Map<String, Object?> read(String name) =>
      jsonDecode(File('../../packages/contract/test-vectors/$name').readAsStringSync()) as Map<String, Object?>;
  final vectors = read('match.json');
  final tolerance = (vectors['tolerance']! as num).toDouble();
  List<Map<String, Object?>> list(String key) => (vectors[key]! as List<Object?>).cast<Map<String, Object?>>();

  NameSource source(Object? s) => NameSource.values.byName(s! as String);

  CandidateGroup groupOf(Map<String, Object?> g) => CandidateGroup(
    patientId: 'g',
    keys: [
      for (final k in (g['keys']! as List<Object?>).cast<Map<String, Object?>>())
        NameKey.of(source(k['source']), k['text']! as String),
    ].nonNulls,
    births: [for (final b in g['births']! as List<Object?>) Birth.fromJson(b)],
  );

  SearchQuery query(Map<String, Object?> q) {
    final text = q['text'] as String?;
    final b = q['birth'] as Map<String, Object?>?;
    if (b == null) return SearchQuery(text: text);
    final year = b['year']! as int;
    final month = b['month'] as int?;
    final day = b['day'] as int?;
    if (month != null && day != null) return SearchQuery(text: text, birth: BirthDate(year, month, day));
    if (month != null) return SearchQuery.yearMonth(text: text, month: (year: year, month: month));
    return SearchQuery(text: text, birth: BirthYear(year));
  }

  MatchSubject subject(Map<String, Object?> s) {
    final legal = s['legalName'] as Map<String, Object?>?;
    return MatchSubject.of(
      preferredName: s['preferredName'] as String?,
      legalName: legal == null ? null : (given: legal['given'] as String?, family: legal['family'] as String?),
      aliases: ((s['aliases'] as List<Object?>?) ?? const []).cast<String>(),
      birth: Birth.fromJson(s['birth']),
    );
  }

  void expectAnswer(MatchScore got, Map<String, Object?> want, String why) {
    expect(got.score, closeTo((want['score']! as num).toDouble(), tolerance), reason: '$why: score');
    expect(got.band.wire, want['band'], reason: '$why: band');
    expect([for (final r in got.reasons) r.wire], want['reasons'], reason: '$why: reasons');
  }

  test('every constant equals the server’s (the phone scores 300 candidates)', () {
    final dart = <String, num>{
      'SEARCH_MIN': searchMin,
      'SEARCH_LIMIT': searchLimit,
      'SEARCH_MAX': searchMax,
      'MATCH_POSSIBLE': matchPossible,
      'QUEUE_THRESHOLD': queueThreshold,
      'MATCH_LIKELY': matchLikely,
      'MATCH_LIMIT': matchLimit,
      'CANDIDATE_LIMIT': candidateLimit,
      'CANDIDATE_BRANCH_LIMIT': candidateBranchLimit,
      'CANDIDATE_TRGM': candidateTrgm,
      'CANDIDATE_WORD_TRGM': candidateWordTrgm,
      'NICKNAME_SIM': nicknameSim,
      'INITIAL_SIM': initialSim,
      'PREFIX_SIM': prefixSim,
      'PHONETIC_SIM': phoneticSim,
      'ALIAS_WEIGHT': aliasWeight,
      'DESCRIPTOR_WEIGHT': descriptorWeight,
      'W_NAME': wName,
      'W_DOB': wDob,
      'SEARCH_DOB_WEIGHT': searchDobWeight,
      'NO_DOB_FACTOR': noDobFactor,
      'DOB_SWAPPED': dobSwapped,
      'DOB_MONTH_YEAR': dobMonthYear,
      'DOB_YEAR_SLIP': dobYearSlip,
      'DOB_YEAR': dobYear,
      'YEAR_SAME': yearSame,
      'YEAR_NEAR': yearNear,
      'ESTIMATE_NEAR': estimateNear,
      'ESTIMATE_RANGE': estimateRange,
      'SINGLE_NAME_CAP': singleNameCap,
      'DOB_CONFLICT_CAP': dobConflictCap,
      'NAME_FLOOR': nameFloor,
      'DOB_ONLY_CAP': dobOnlyCap,
    };
    final server = vectors['constants']! as Map<String, Object?>;
    expect(dart.keys, unorderedEquals(server.keys));
    for (final MapEntry(:key, :value) in dart.entries) {
      expect(value, key == 'CANDIDATE_LIMIT' ? 300 : server[key], reason: key);
    }
  });

  test('gives every token similarity the phone gives', () {
    for (final t in list('tokens')) {
      final q = t['q']! as String;
      final c = t['c']! as String;
      final want = t['phone']! as Map<String, Object?>;
      final got = tokSim(q, c, search: t['mode'] == 'search');
      final why = '$q / $c (${t['mode']})';
      expect(got.sim, closeTo((want['sim']! as num).toDouble(), tolerance), reason: why);
      expect(got.how?.name, want['how'], reason: why);
    }
  });

  test('gives every birth agreement', () {
    for (final d in list('dob')) {
      final x = d['x'] as Map<String, Object?>?;
      final y = Birth.fromJson(d['y']);
      final got = x?['precision'] == 'month'
          ? dobSimMonth((year: x!['year']! as int, month: x['month']! as int), y)
          : dobSim(Birth.fromJson(x), y);
      final want = d['expected'] as Map<String, Object?>?;
      final why = '${jsonEncode(x)} / ${jsonEncode(d['y'])}';
      if (want == null) {
        expect(got, isNull, reason: why);
      } else {
        expect(got?.sim, closeTo((want['sim']! as num).toDouble(), tolerance), reason: why);
        expect(got?.reason?.wire, want['reason'], reason: why);
      }
    }
  });

  test('gives every search score, band and reason the phone gives', () {
    final searches = list('searches');
    expect(searches, hasLength(greaterThan(10)));
    for (final s in searches) {
      final q = query(s['query']! as Map<String, Object?>);
      expectAnswer(
        scoreSearch(q, groupOf(s['group']! as Map<String, Object?>)),
        s['phone']! as Map<String, Object?>,
        s['name']! as String,
      );
    }
  });

  test('gives every match score, band and reason the phone gives', () {
    final matches = list('matches');
    expect(matches, hasLength(greaterThan(10)));
    for (final m in matches) {
      expectAnswer(
        scoreMatch(subject(m['subject']! as Map<String, Object?>), groupOf(m['group']! as Map<String, Object?>)),
        m['phone']! as Map<String, Object?>,
        m['name']! as String,
      );
    }
  });

  group('the done-when', () {
    final doneWhen = read('done-when.json');
    final p1 = doneWhen['p1']! as Map<String, Object?>;
    // The phone's index: preferred name, street names and description; never the legal name (D40).
    final del = CandidateGroup(
      patientId: p1['id']! as String,
      keys: [
        NameKey.of(NameSource.preferred, p1['preferredName']! as String),
        for (final a in (p1['aliases']! as List<Object?>).cast<Map<String, Object?>>())
          NameKey.of(NameSource.alias, a['alias']! as String),
        NameKey.of(NameSource.descriptor, p1['visualDescriptor']! as String),
      ].nonNulls,
      births: [Birth.fromJson(p1['birth'])],
    );

    test('"Smity" finds Del through his street name', () {
      final search = doneWhen['search']! as Map<String, Object?>;
      final expected = search['expected']! as Map<String, Object?>;
      final ranked = rankSearch(SearchQuery(text: search['text']! as String), [del]);
      expect(ranked.hits.single.group.patientId, expected['first']);
      expect(ranked.hits.single.score.score, closeTo(expected['phoneScore']! as double, 1e-9));
      expect([for (final r in ranked.hits.single.score.reasons) r.wire], expected['reasons']);
    });

    test('the intake is likely Del', () {
      final intake = doneWhen['intake']! as Map<String, Object?>;
      final expected = (doneWhen['match']! as Map<String, Object?>)['expected']! as Map<String, Object?>;
      final legal = intake['legalName']! as Map<String, Object?>;
      final s = MatchSubject.of(
        preferredName: intake['preferredName']! as String,
        legalName: (given: legal['given'] as String?, family: legal['family'] as String?),
        birth: Birth.fromJson(intake['birth']),
      );
      final ranked = rankMatches(s, [del]);
      expect(ranked.single.group.patientId, expected['candidate']);
      expect(ranked.single.score.score, closeTo(expected['phoneScore']! as double, expected['tolerance']! as double));
      expect(ranked.single.score.band.wire, expected['band']);
      expect([for (final r in ranked.single.score.reasons) r.wire], expected['reasons']);
      expect(rankMatches(s, [del], exclude: {p1['id']! as String}), isEmpty);
    });
  });

  group('ranking', () {
    CandidateGroup named(String id, String name, {DateTime? seen}) =>
        CandidateGroup(patientId: id, keys: [NameKey.of(NameSource.preferred, name)!], lastSeen: seen);

    test('by score, then most recently seen, then ID, cut with a flag for Show more', () {
      final seen = DateTime.utc(2026, 10, 1);
      final groups = [
        named('c', 'Smitty'),
        named('b', 'Smitty', seen: seen),
        named('a', 'Smitty'),
        named('d', 'Smity', seen: seen.add(const Duration(days: 9))),
        named('e', 'Rosa'),
      ];
      final all = rankSearch(SearchQuery(text: 'smitty'), groups);
      expect([for (final r in all.hits) r.group.patientId], ['b', 'a', 'c', 'd']);
      expect(all.truncated, isFalse);
      final cut = rankSearch(SearchQuery(text: 'smitty'), groups, limit: 2);
      expect([for (final r in cut.hits) r.group.patientId], ['b', 'a']);
      expect(cut.truncated, isTrue);
    });

    test('a year never browses the list; a full date alone does', () {
      final p = CandidateGroup(patientId: 'p', keys: const [], births: const [BirthDate(1946, 3, 7)]);
      expect(rankSearch(SearchQuery(birth: const BirthYear(1946)), [p]).hits, isEmpty);
      final byDate = rankSearch(SearchQuery(birth: const BirthDate(1946, 3, 7)), [p]).hits.single.score;
      expect(byDate.score, 1);
      expect(byDate.reasons, [MatchReason.dobExact]);
    });

    test('a match below possible is not shown', () {
      final s = MatchSubject.of(preferredName: 'Mike');
      final mike = CandidateGroup(patientId: 'm', keys: [NameKey.legal('Michael', 'Jones')!]);
      expect(scoreMatch(s, mike).band, MatchBand.weak);
      expect(rankMatches(s, [mike]), isEmpty);
    });
  });

  test('nickname partners and retrieval tokens are sorted and leave out the token itself', () {
    expect(nicknamePartners('chuy'), ['chucho', 'jesus']);
    expect(areNicknames('pepe', 'jose'), isTrue);
    expect(areNicknames('jose', 'jose'), isFalse);
    expect(retrievalTokens(['big chuy']), ['chucho', 'chuy', 'jesus']);
  });
}
