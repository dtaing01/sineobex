import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show FetchChartsReason;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/chart_cache.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/patients/id_links.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Answers no chart request asking for more than [maxCharts] (a weak uplink that times out on a
/// big answer, after the server did its work).
class _Narrow implements ApiTransport {
  _Narrow(this.inner);
  final ApiTransport inner;
  int maxCharts = 1000;
  bool offline = false;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    final result = await inner.send(method, path, query: query, body: body);
    if (path == '/v1/patients/charts' &&
        ((body! as Map<String, Object?>)['patientIds']! as List<Object?>).length > maxCharts) {
      throw const NetworkException('timeout');
    }
    return result;
  }
}

/// Charts kept on the phone (design section 7, tests 13.5): each scope's expiry, local work,
/// refreshes that never extend, redirects that move scopes, the D24 batches, and the purge of a
/// chart's names, tokens and trigrams. Also: the chart meta field never travels.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  final start = DateTime.utc(2026, 10, 22, 15);
  const legal = {'given': 'Ysolde', 'family': 'Varrowick'};

  late DateTime serverTime;
  late FakeSyncServer server;
  late _Narrow link;
  late TestPhone phone;
  late PatientServices services;

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
    link = _Narrow(server.transportFor(alex, team));
    phone = TestPhone(userId: alex, teamId: team, transport: () => link, wall: start);
    services = PatientServices(
      OpenTeam(
        userId: alex,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: FakeSyncServer.healthcareStaff.toList(),
      ),
      idLinkBaseUrl: 'http://localhost:3100',
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  });
  tearDown(() => phone.close());

  LocalStore store() => phone.store;

  void advance(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  /// A patient with a legal name, a street name and a card.
  String seedChart({String name = 'Zee', String alias = 'Quorvelline'}) {
    final p = server.seedPatient(preferredName: name, legalName: legal);
    server
      ..seed(entityAlias, {'patientId': p, 'alias': alias})
      ..seed(entityIdLink, {'patientId': p, 'token': newIdLinkToken(), 'replacesLinkId': null, 'reason': 'first_card'});
    return p;
  }

  List<String> names(String patientId, String origin) => [
    for (final r in phone.db.db.select(
      'SELECT name FROM patient_names WHERE patient_id = ? AND origin = ? ORDER BY name',
      [patientId, origin],
    ))
      r['name']! as String,
  ];

  /// Whether a trigram of [norm] that no remaining name has is in the FTS5 segments.
  bool onDisk(String norm) {
    final live = [for (final r in phone.db.db.select('SELECT name FROM patient_names')) r['name']! as String];
    return [
      for (var i = 0; i + 3 <= norm.length; i++)
        if (!live.any((n) => n.contains(norm.substring(i, i + 3)))) norm.substring(i, i + 3),
    ].any(
      (t) =>
          phone.db.db.select('SELECT count(*) AS n FROM patient_names_data WHERE instr(block, ?) > 0', [
            Uint8List.fromList(utf8.encode(t)),
          ]).first['n'] !=
          0,
    );
  }

  int links(String patientId) =>
      phone.db.db.select('SELECT count(*) AS n FROM id_links WHERE patient_id = ?', [patientId]).first['n']! as int;

  test('an opened chart stays 24 hours; then it goes with its names, its card tokens and its trigrams', () async {
    final p = seedChart();
    final view = (await services.patients.open(p))!;
    expect(view.copy, ChartCopy.full);
    expect(view.legalName, (given: 'Ysolde', family: 'Varrowick'));
    expect(names(p, 'cache'), ['quorvelline', 'zee']);
    expect(view.workingCards.single.copyable, isTrue);
    expect(store().scopes().single.kind, scopeOpened);

    advance(const Duration(hours: 23));
    store().purge();
    expect(store().record(p), isNotNull);

    advance(const Duration(hours: 2));
    store().purge();
    expect(store().record(p), isNull);
    expect(chartMetaOf(store(), p), isNull);
    expect(names(p, 'cache'), isEmpty);
    expect(links(p), 0);
    expect(onDisk('quorvelline'), isFalse);
    expect(services.search.searchOnPhone('Ysolde Varrowick').hits, isEmpty);
  });

  test('local work keeps a chart past its 24 hours, until it is confirmed', () async {
    final p = seedChart();
    await services.patients.open(p);
    link.offline = true;
    services.patients.addAlias(p, 'Ziggy');
    advance(const Duration(hours: 30));
    // The alias create extended the scope to 24 hours after it was made; past that, the waiting
    // change still keeps the chart.
    store().purge();
    expect(store().record(p), isNotNull);
    expect(links(p), 1);
    link.offline = false;
    await phone.engine.syncAll(force: true);
    expect(store().outbox(), isEmpty);
    advance(const Duration(hours: 1));
    store().purge();
    expect(store().record(p), isNull);
    expect(links(p), 0);
  });

  test('a refresh downloads charts with local work again and never extends their scope', () async {
    final p = seedChart();
    await services.patients.open(p);
    final opened = store().scopes().single.expiresAt;
    link.offline = true;
    services.patients
      ..startEditing(p)
      ..update(p, {'usualArea': 'Demo: north lot'});
    final edited = store().scopes().single.expiresAt;
    expect(edited.isAfter(opened) || edited == opened, isTrue);
    link.offline = false;
    server.serverEdit(p, 'visualDescriptor', 'Demo: green coat', by: 'someone-else');
    advance(const Duration(hours: 3));
    final before = server.chartRequests.length;
    await phone.engine.runRefreshers(RefreshReason.timer);
    expect(server.chartRequests.length, before + 1);
    expect(services.patients.read(p)!.visualDescriptor, 'Demo: green coat');
    expect(store().scopes().single.expiresAt, edited);
  });

  test('a chart bundle’s redirects move scopes to the survivor', () async {
    final kept = seedChart(name: 'Del', alias: 'Smitty');
    final merged = seedChart(name: 'Delly', alias: 'Dee');
    await services.patients.open(merged);
    server.merge(merged, kept);
    await services.charts.fetch([merged], reason: FetchChartsReason.refresh);
    expect(store().canonicalPatient(merged), kept);
    expect(store().redirects()[merged]!.origin, 'chart');
    expect(store().scopes().map((s) => s.patientId), [kept]);
    final view = services.patients.read(merged)!;
    expect([view.canonicalId, view.mergedInto?.survivorId], [kept, kept]);
    // Both cards still open the combined chart (D39).
    expect(view.workingCards, hasLength(2));
  });

  test('batches start at 10, halve on a timeout down to 1, and double after each answer', () async {
    final ids = [for (var i = 0; i < 30; i++) server.seedPatient(preferredName: 'Demo $i')];
    link.maxCharts = 3;
    final got = await services.charts.fetch(ids, reason: FetchChartsReason.opened, opened: true);
    expect(got.imported, ids.toSet());
    expect(server.chartRequests.take(4), [10, 5, 2, 4]);
    // Every request after a timeout asked for half; after an answer, for twice as many.
    expect(server.chartRequests.where((n) => n > 4), [10, 5]);

    // One chart that times out alone waits for a later run; the rest arrive.
    final more = [for (var i = 0; i < 3; i++) server.seedPatient(preferredName: 'Late $i')];
    link.maxCharts = 0;
    final stuck = await services.charts.fetch([more.first], reason: FetchChartsReason.opened);
    expect(stuck.failed, {more.first});
    expect(services.charts.downloadFailed(more.first), isTrue);
    expect(services.patients.openOnPhone(more.first), isNull);
    link.maxCharts = 1000;
    await services.charts.fetch([more.first], reason: FetchChartsReason.opened);
    expect(services.charts.downloadFailed(more.first), isFalse);
  });

  test('a dead zone keeps the batches that already arrived', () async {
    final ids = [for (var i = 0; i < 25; i++) server.seedPatient(preferredName: 'Demo $i')];
    var calls = 0;
    server.onRequest = (path) {
      // The first answer arrives; the phone loses signal before the next request.
      if (path == '/v1/patients/charts' && ++calls == 1) link.offline = true;
    };
    final got = await services.charts.fetch(ids, reason: FetchChartsReason.opened, opened: true);
    expect(got.offline, isTrue);
    expect(got.imported, hasLength(10));
    expect([
      for (final id in ids)
        if (store().record(id) != null) id,
    ], hasLength(10));
  });

  test('the chart meta field never enters the outbox: import, an edit, the purge', () async {
    final p = seedChart();
    bool travels() => [
      for (final e in store().outbox()) jsonEncode([e.field, e.value]),
    ].any((s) => s.contains(chartMetaField));
    await services.patients.open(p);
    expect(store().record(p)!.fields[chartMetaField]!.confirmed, isTrue);
    expect(travels(), isFalse);
    link.offline = true;
    services.patients
      ..startEditing(p)
      ..update(p, {'usualArea': 'Demo: north lot', 'preferredName': 'Zed'})
      ..finishEditing(p);
    services.patients.addAlias(p, 'Ziggy');
    expect(store().outbox().map((e) => e.field).nonNulls.toSet(), {'usualArea', 'preferredName'});
    expect(travels(), isFalse);
    expect(store().record(p)!.fields[chartMetaField]!.confirmed, isTrue);
    advance(const Duration(hours: 30));
    store().purge();
    expect(travels(), isFalse);
    link.offline = false;
    await phone.engine.syncAll(force: true);
    expect(store().outbox(), isEmpty);
    expect(server.records[p]!.fields.keys, isNot(contains(chartMetaField)));
    // The server never heard of it: every change it stored names a real field.
    expect(server.history.map((h) => h['field']), isNot(contains(chartMetaField)));
  });

  group('opened recently', () {
    test('lists opened charts newest first, audited before it returns, with no legal name', () async {
      final a = seedChart(name: 'Ada');
      final b = seedChart(name: 'Bo');
      await services.patients.open(a);
      advance(const Duration(minutes: 10));
      await services.patients.open(b);
      link.offline = true;
      final rows = services.search.openedRecently();
      expect(rows.map((r) => r.patientId), [b, a]);
      expect(rows.map((r) => r.preferredName), ['Bo', 'Ada']);
      expect(
        jsonEncode([
          for (final r in rows) [r.preferredName, r.aliases, r.visualDescriptor],
        ]),
        isNot(contains('Ysolde')),
      );
      final audit = store().outbox().last;
      expect(audit.value, {
        'action': 'patient.searched',
        'patientIds': [b, a],
        'resultCount': 2,
        'criteria': <Object?>[],
        'source': 'cache',
      });
    });

    test('a merged record is listed once, as its survivor', () async {
      final kept = seedChart(name: 'Del', alias: 'Smitty');
      final merged = seedChart(name: 'Delly', alias: 'Dee');
      await services.patients.open(kept);
      await services.patients.open(merged);
      server.merge(merged, kept);
      await services.charts.fetch([merged, kept], reason: FetchChartsReason.refresh);
      expect(services.search.openedRecently().map((r) => r.patientId), [kept]);
    });

    test('a frozen store lists nothing', () async {
      await services.patients.open(seedChart());
      store().freeze('Your access to this team ended.');
      expect(() => services.search.openedRecently(), throwsA(isA<ChartingPaused>()));
    });
  });

  test('the card link base comes from /v1/me and survives a restart', () async {
    expect(IdLinks.baseUrlOf(store()), 'http://localhost:3100');
    await phone.restart();
    expect(IdLinks.baseUrlOf(phone.store), 'http://localhost:3100');
  });
}
