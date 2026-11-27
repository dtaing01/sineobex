import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' as api;
import 'package:sineobex_field/api/generated/api.dart' show MatchReason;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/chart_cache.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/match_constants.dart';
import 'package:sineobex_field/patients/patient_search.dart';
import 'package:sineobex_field/patients/team_index.dart';
import 'package:sineobex_field/sync/entities.dart' show auditIssues;
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';

const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 11 % 256));

/// No network: every search here is the phone's own.
class _Offline implements ApiTransport {
  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async =>
      throw const NetworkException('offline');
}

/// The phone's search over FTS5 (design 5.5, tests 13.5): the exact candidate statements on the
/// bundled SQLite, the scorer's verdict, Show more and its audit, legal names held only in cached
/// charts, and the 2,000-patient budget.
void main() {
  late Directory dir;
  late LocalDatabase db;
  late LocalStore store;
  late TeamIndex index;
  late PatientSearcher search;
  final now = DateTime.utc(2026, 10, 22, 15);
  var ids = 0;
  String uuid() => 'f0f00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

  setUp(() {
    dir = Directory.systemTemp.createTempSync('fts');
    db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-1'), key);
    store = LocalStore(
      db,
      userId: userId,
      stamp: () => ClockStamp(deviceTime: now, correctedTime: now, verified: true),
      now: () => now,
    );
    index = TeamIndex(store, permissions: const ['patients.view', 'patients.edit'], now: () => now);
    search = PatientSearcher(store, api.SineobexApi(_Offline()), index: index);
  });
  tearDown(() {
    db.close();
    dir.deleteSync(recursive: true);
  });

  api.IndexEntry entry(
    String id, {
    String? preferred,
    List<String> aliases = const [],
    String? descriptor,
    Map<String, Object?>? birth,
    String? lastSeen,
  }) => api.IndexEntry.fromJson({
    'patientId': id,
    'preferredName': preferred,
    'aliases': [
      for (final a in aliases) {'id': uuid(), 'alias': a, 'kind': 'alias'},
    ],
    'visualDescriptor': descriptor,
    'birth': birth,
    'usualArea': null,
    'lastSeenOn': lastSeen,
    'allergyScreen': 'not_asked',
    'allergies': <Object?>[],
    'idLinks': <Object?>[],
    'duplicate': null,
    'reviews': <Object?>[],
    'versions': {'preferredName': 1, 'visualDescriptor': 1, 'usualArea': 1, 'allergyScreen': 1},
  });

  void swapIn(List<api.IndexEntry> entries) => index.swap([
    api.TeamIndexPage(
      entries: entries,
      generatedAt: now,
      next: null,
      projection: 'idx1',
      redirects: const [],
      status: api.TeamIndexPageStatus.page,
      version: '1.idx1',
    ),
  ]);

  Map<String, Object?> field(Object? value) => {'value': value, 'version': 1, 'changedAt': null, 'changedBy': null};

  /// A chart as the charts route sends it: a patient with a legal name, kept by an `opened` scope.
  void cacheChart(String id, {String? preferred, Map<String, Object?>? legal}) => importChart(
    store,
    api.PatientChart.fromJson({
      'patient': {
        'entity': 'patient',
        'id': id,
        'version': 1,
        'status': 'active',
        'authorUserId': userId,
        'createdAt': now.toIso8601String(),
        'updatedAt': now.toIso8601String(),
        'attributes': <String, Object?>{},
        'fields': {'preferredName': field(preferred), 'legalName': field(legal)},
      },
      'canonicalId': id,
      'mergedFrom': <Object?>[],
      'aliases': <Object?>[],
      'allergies': <Object?>[],
      'consents': <Object?>[],
      'idLinks': <Object?>[],
      'reviews': <Object?>[],
      'duplicate': null,
      'projection': 'c1',
    }),
    opened: true,
    now: now,
  );

  List<Map<String, Object?>> audits() => [
    for (final e in store.outbox())
      if (e.entity == 'audit') e.value! as Map<String, Object?>,
  ];

  group('the statements of design 5.5', () {
    test('a trigram OR finds a typo ("Smity") and a substring ("mitt"); the scorer decides', () {
      final smitty = uuid();
      swapIn([
        entry(smitty, preferred: 'Del', aliases: ['Smitty']),
        entry(uuid(), preferred: 'Rosa'),
      ]);
      expect(ftsTerms(['smity']), ['"smi"', '"mit"', '"ity"']);
      expect(ftsCandidates(db.db, ftsTerms(['smity'])).map((c) => c.patientId), [smitty]);
      expect(ftsCandidates(db.db, ftsTerms(['mitt'])).map((c) => c.patientId), [smitty]);
      final hit = search.searchOnPhone('Smity').hits.single;
      expect(hit.reasons, [MatchReason.alias, MatchReason.typo]);
      expect(hit.score, closeTo(1 - 1 / 6, 1e-9));
    });

    test('one or two letters ("Al") search by prefix, at the start of any word', () {
      final al = uuid(), big = uuid(), alma = uuid();
      swapIn([
        entry(al, preferred: 'Al'),
        entry(big, preferred: 'Big Al'),
        entry(alma, preferred: 'Alma'),
        entry(uuid(), preferred: 'Sal'),
      ]);
      // Too short for a trigram; its nickname partners (Albert, Alfred) still give terms.
      expect(shortTokens(['al']), ['al']);
      expect(likeCandidates(db.db, shortTokens(['al'])).map((c) => c.patientId).toSet(), {al, big, alma});
    });

    test('rows group by patient with the best rank and every origin', () {
      final p = uuid();
      swapIn([entry(p, preferred: 'Smitty')]);
      cacheChart(p, preferred: 'Smitty');
      final c = ftsCandidates(db.db, ftsTerms(['smitty'])).single;
      expect(c.patientId, p);
      expect(c.origins, {'index', 'cache'});
      expect(c.rank, isNotNull);
    });

    test('nickname partners are search terms ("Mike" finds Michael)', () {
      final michael = uuid();
      swapIn([entry(michael, preferred: 'Michael')]);
      expect(search.searchOnPhone('Mike').hits.single.reasons, contains(MatchReason.nickname));
    });

    test('a birth date in a name search enters the score but never adds a candidate', () {
      final a = uuid(), b = uuid(), other = uuid();
      final born = {'precision': 'day', 'date': '1946-03-07'};
      swapIn([
        entry(a, preferred: 'Rosa', birth: {'precision': 'day', 'date': '1960-01-01'}),
        entry(b, preferred: 'Rosa', birth: born),
        entry(other, preferred: 'Quentin', birth: born),
      ]);
      final hits = search.searchOnPhone('Rosa', birth: const BirthDate(1946, 3, 7)).hits;
      expect(hits.map((h) => h.patientId), [b, a]);
    });

    test('a full date alone finds that date, the swapped one and nearby years; a year alone finds nothing', () {
      final exact = uuid(), swapped = uuid(), year = uuid(), far = uuid(), otherDay = uuid();
      swapIn([
        entry(exact, preferred: 'One', birth: {'precision': 'day', 'date': '1946-03-07'}),
        entry(swapped, preferred: 'Two', birth: {'precision': 'day', 'date': '1946-07-03'}),
        entry(year, preferred: 'Three', birth: {'precision': 'year', 'year': 1947}),
        entry(far, preferred: 'Four', birth: {'precision': 'year', 'year': 1960}),
        entry(otherDay, preferred: 'Five', birth: {'precision': 'day', 'date': '1946-03-09'}),
      ]);
      expect(birthCandidates(db.db, const BirthDate(1946, 3, 7)), [exact, swapped, year]);
      final hits = search.searchOnPhone(null, birth: const BirthDate(1946, 3, 7)).hits;
      expect(hits.first.patientId, exact);
      expect(hits.map((h) => h.patientId), isNot(contains(far)));
      expect(search.searchOnPhone(null, birth: const BirthYear(1946)).hits, isEmpty);
      expect(audits(), hasLength(1));
      expect(audits().single['criteria'], ['birth_full']);
    });

    test('candidates are cut at the limit, after ranking', () {
      swapIn([for (var i = 0; i < 40; i++) entry(uuid(), preferred: 'Smitty $i')]);
      expect(ftsCandidates(db.db, ftsTerms(['smitty']), limit: 25), hasLength(25));
    });
  });

  test('60 patients, 55 of them Mike: 20 shown and audited; Show more shows 50, audited again', () {
    final mikes = [for (var i = 0; i < 55; i++) uuid()];
    swapIn([
      for (final (i, id) in mikes.indexed) entry(id, preferred: 'Mike ${String.fromCharCode(97 + i % 26)}$i'),
      for (var i = 0; i < 5; i++) entry(uuid(), preferred: 'Rosa $i'),
    ]);
    final first = search.searchOnPhone('Mike');
    expect([first.hits.length, first.truncated, first.more], [searchLimit, true, false]);
    final more = search.searchOnPhone('Mike', more: true);
    expect([more.hits.length, more.truncated, more.more], [searchMax, true, true]);
    final logged = audits();
    expect(logged, hasLength(2));
    expect(logged.first['patientIds'], [for (final h in first.hits) h.patientId]);
    expect(logged.last['patientIds'], [for (final h in more.hits) h.patientId]);
    expect(logged.last['resultCount'], 50);
    for (final a in logged) {
      expect(auditIssues(a), isEmpty, reason: 'the AuditAppend mirror accepts it');
      expect(a.keys, isNot(contains('text')));
    }
  });

  test('a legal name typed offline finds a cached chart in memory, and is never a search row (D40)', () {
    final cached = uuid();
    swapIn([entry(cached, preferred: 'Zee')]);
    cacheChart(cached, preferred: 'Zee', legal: {'given': 'Ysolde', 'family': 'Varrowick'});
    expect(db.db.select("SELECT 1 FROM patient_names WHERE name LIKE '%ysolde%' OR name LIKE '%varrowick%'"), isEmpty);
    final hit = search.searchOnPhone('Ysolde Varrowick').hits.single;
    expect(hit.patientId, cached);
    expect(hit.matchedLegalName, isTrue);
    expect(hit.preferredName, 'Zee');
    // An index entry alone never matches by a legal name: the index has none.
    final indexOnly = uuid();
    swapIn([entry(indexOnly, preferred: 'Zee')]);
    expect(search.searchOnPhone('Ysolde Varrowick').hits.where((h) => h.patientId == indexOnly), isEmpty);
  });

  test('a frozen store shows nothing: the search can’t be logged', () {
    swapIn([entry(uuid(), preferred: 'Smitty')]);
    store.freeze('Your access to this team ended.');
    expect(() => search.searchOnPhone('Smitty'), throwsA(isA<ChartingPaused>()));
    expect(store.outbox(), isEmpty);
  });

  test('2,000 patients: a search is two indexed queries and a few hundred scores, under 100 ms', () {
    const given = ['Del', 'Rosa', 'Mike', 'Ana', 'Jun', 'Kofi', 'Lena', 'Omar', 'Pita', 'Quinn'];
    const street = ['Smitty', 'Red', 'Shorty', 'Doc', 'Sunny', 'Tex', 'Ace', 'Kid', 'Blue', 'Moss'];
    swapIn([
      for (var i = 0; i < 2000; i++)
        entry(
          uuid(),
          preferred: '${given[i % 10]} ${String.fromCharCode(65 + i % 26)}${i ~/ 26}',
          aliases: ['${street[(i ~/ 10) % 10]}$i'],
          descriptor: 'Demo: patient $i',
          birth: {'precision': 'year', 'year': 1940 + i % 60},
        ),
    ]);
    search.searchOnPhone('Smity'); // warm up
    // The median of several runs, so one pause of a shared test machine doesn't decide it.
    final times = <int>[];
    for (var i = 0; i < 7; i++) {
      final watch = Stopwatch()..start();
      final run = search.searchOnPhone(i.isEven ? 'Smity' : 'Rosa');
      times.add(watch.elapsedMilliseconds);
      expect(run.hits, isNotEmpty);
    }
    times.sort();
    expect(times[times.length ~/ 2], lessThan(100));
  });
}
