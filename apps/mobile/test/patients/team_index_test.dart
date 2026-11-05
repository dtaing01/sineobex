import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' as api;
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/team_index.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The team index on the phone (design section 6, tests 13.5): staged pages swapped whole, a
/// cut-off download resumed, `unchanged`, the 7-day expiry by corrected time, a clock wound back,
/// the 403, cached permissions, the authoritative redirect list, and a 2,000-entry swap.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  final start = DateTime.utc(2026, 10, 22, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  late TestPhone phone;
  late PatientServices services;
  late TeamIndexRefresher refresher;

  PatientServices servicesFor(List<String> permissions) => PatientServices(
    OpenTeam(
      userId: alex,
      teamId: team,
      store: phone.store,
      api: phone.engine.api,
      clock: phone.clock,
      permissions: permissions,
    ),
    copy: (_) async => true,
    wallNow: () => phone.wall,
  );

  setUp(() async {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
    phone = TestPhone(userId: alex, teamId: team, transport: () => server.transportFor(alex, team), wall: start);
    services = servicesFor(FakeSyncServer.healthcareStaff.toList());
    refresher = TeamIndexRefresher(services.index, phone.engine.api, wallNow: () => phone.wall, maxPageLimit: 100);
    // A push gives the phone its clock reference.
    await phone.engine.syncAll();
  });
  tearDown(() => phone.close());

  LocalStore store() => phone.store;
  int indexRows() => phone.db.db.select('SELECT count(*) AS n FROM team_index').first['n']! as int;
  int stagedPages() => phone.db.db.select('SELECT count(*) AS n FROM team_index_staging').first['n']! as int;

  void advance(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  List<String> seed(int n) => [for (var i = 0; i < n; i++) server.seedPatient(preferredName: 'Demo $i')];

  /// The phone loses signal once [pages] index pages have been answered. (The fake checks `offline`
  /// before it calls `onRequest`, so the page being asked for is still answered.)
  void cutAfter(int pages) {
    var served = 0;
    server.onRequest = (path) {
      if (path == '/v1/patients/index' && ++served == pages) server.offline = true;
    };
  }

  test('pages are staged and swapped whole; a cut-off download resumes from its last page', () async {
    final ids = seed(250);
    await refresher.refresh(RefreshReason.manual);
    expect(server.indexPages, 3);
    expect([indexRows(), stagedPages(), services.index.state.count], [250, 0, 250]);
    final v1 = services.index.state.version;

    server.serverEdit(ids[200], 'preferredName', 'Quorvelline', by: 'someone-else');
    cutAfter(1);
    await refresher.refresh(RefreshReason.manual);
    expect(stagedPages(), 1);
    expect(services.index.state.downloading, isTrue);
    // The old copy stands whole until the new one is complete.
    expect([indexRows(), services.index.state.version], [250, v1]);
    expect(services.search.searchOnPhone('Quorvelline').hits, isEmpty);

    server
      ..offline = false
      ..onRequest = null;
    final before = server.indexPages;
    await refresher.refresh(RefreshReason.manual);
    expect(server.indexPages, before + 2);
    expect([indexRows(), stagedPages()], [250, 0]);
    expect(services.index.state.version, isNot(v1));
    expect(services.search.searchOnPhone('Quorvelline').hits.first.patientId, ids[200]);
  });

  test('staging older than an hour is discarded, not resumed', () async {
    seed(150);
    cutAfter(1);
    await refresher.refresh(RefreshReason.manual);
    expect(stagedPages(), 1);
    server
      ..offline = false
      ..onRequest = null;
    advance(const Duration(hours: 2));
    final before = server.indexPages;
    await refresher.refresh(RefreshReason.manual);
    expect(server.indexPages, before + 2);
    expect(indexRows(), 150);
  });

  test('unchanged only moves the time the copy was confirmed current', () async {
    seed(3);
    await refresher.refresh(RefreshReason.manual);
    final first = services.index.state.refreshedAt!;
    advance(const Duration(hours: 1));
    final pages = server.indexPages;
    await refresher.refresh(RefreshReason.manual);
    expect(server.indexPages, pages);
    expect(services.index.state.refreshedAt, first.add(const Duration(hours: 1)));
  });

  test('after syncs the index is checked at most every 2 minutes; at an unlock only when 15 minutes old', () async {
    seed(3);
    await refresher.refresh(RefreshReason.afterSync);
    final pages = server.indexPages;
    server.seedPatient(preferredName: 'Late');
    await refresher.refresh(RefreshReason.afterSync);
    await refresher.refresh(RefreshReason.opened);
    expect(server.indexPages, pages);
    advance(const Duration(minutes: 16));
    await refresher.refresh(RefreshReason.opened);
    expect(server.indexPages, pages + 1);
  });

  test('7 days without a refresh: the index and every server copy go, by corrected time', () async {
    final ids = seed(3);
    await refresher.refresh(RefreshReason.manual);
    await services.patients.open(ids.first);
    server.offline = true;
    advance(const Duration(days: 7, minutes: 1));
    expect(services.search.searchOnPhone('Demo').hits, isEmpty);
    expect(services.index.state.removed, IndexRemoval.expired);
    expect([indexRows(), store().kv('index.version')], [0, null]);
    expect(store().record(ids.first), isNull);
    expect(phone.db.db.select("SELECT 1 FROM patient_names WHERE origin IN ('index', 'cache')"), isEmpty);
  });

  test('a phone clock wound back counts as expired when nothing corrects it', () async {
    seed(3);
    await refresher.refresh(RefreshReason.manual);
    final at = services.index.state.refreshedAt!;
    // With a clock reference, the phone's own clock can't move the corrected time.
    phone.wall = at.subtract(const Duration(days: 2));
    await refresher.refresh(RefreshReason.timer);
    expect(services.index.state.present, isTrue);
    // After a restart there is no reference until the next sync: the wound-back clock decides.
    phone.boot.reboot();
    await phone.clock.check();
    server.offline = true;
    await refresher.refresh(RefreshReason.timer);
    expect(services.index.state.removed, IndexRemoval.expired);
    expect(indexRows(), 0);
  });

  // Review P6: after a restart nothing corrects the clock, and a clock wound back to a day after
  // the refresh kept a week-old index.
  test('a clock wound back after a restart, to after the refresh, still counts as wound back', () async {
    seed(3);
    await refresher.refresh(RefreshReason.manual);
    final at = services.index.state.refreshedAt!;
    server.offline = true;
    advance(const Duration(days: 3));
    expect(services.index.expireIfStale(), isFalse);
    expect(services.index.state.present, isTrue);
    phone.boot.reboot();
    phone.wall = at.add(const Duration(days: 1));
    await phone.clock.check();
    expect(phone.clock.stamp().correctedTime, isNull, reason: 'nothing corrects the clock yet');
    expect(services.index.expireIfStale(), isTrue);
    expect([services.index.state.removed, indexRows()], [IndexRemoval.expired, 0]);
  });

  test('403 index_not_permitted deletes the index and every server copy without local work', () async {
    final ids = seed(3);
    await refresher.refresh(RefreshReason.manual);
    await services.patients.open(ids[0]);
    await services.patients.open(ids[1]);
    server.offline = true;
    services.patients.addAlias(ids[1], 'Ziggy');
    server
      ..offline = false
      ..permissions[alex] = {'patients.view', 'billing.view_codes'};
    await refresher.refresh(RefreshReason.manual);
    expect(services.index.state.removed, IndexRemoval.notPermitted);
    expect(indexRows(), 0);
    expect(store().record(ids[0]), isNull);
    expect(store().record(ids[1]), isNotNull);
  });

  // Review P4: staging was dropped only inside a later download, and notPermitted cleared only a
  // complete index, so a role that lost the index kept a cut-off download's names for good.
  test('a cut-off first download goes when the role loses the index, staged names and all', () async {
    seed(150);
    cutAfter(1);
    await refresher.refresh(RefreshReason.manual);
    expect([stagedPages(), indexRows()], [1, 0]);
    server
      ..offline = false
      ..onRequest = null;
    // The role changes to one that may not hold the index (Billing/Data).
    const billing = ['patients.view', 'billing.view_codes'];
    final theirs = servicesFor(billing);
    await TeamIndexRefresher(theirs.index, phone.engine.api, wallNow: () => phone.wall).refresh(RefreshReason.manual);
    expect(stagedPages(), 0);
    expect(phone.db.db.select("SELECT 1 FROM kv WHERE key LIKE 'index.%'"), isEmpty);
    expect(theirs.index.state.downloading, isFalse);
  });

  test('a 403 for the index drops a cut-off download’s staged pages', () async {
    seed(150);
    cutAfter(1);
    await refresher.refresh(RefreshReason.manual);
    expect(stagedPages(), 1);
    server
      ..offline = false
      ..onRequest = null
      ..permissions[alex] = {'patients.view', 'billing.view_codes'};
    // The phone still thinks it may hold the index; the server says otherwise.
    await refresher.refresh(RefreshReason.manual);
    expect(stagedPages(), 0);
  });

  test('staging expires after an hour without a download to discard it, whatever the role', () async {
    seed(150);
    cutAfter(1);
    await refresher.refresh(RefreshReason.manual);
    expect(stagedPages(), 1);
    final theirs = servicesFor(const ['patients.view', 'billing.view_codes']);
    advance(const Duration(minutes: 59));
    expect(theirs.index.expireIfStale(), isFalse);
    expect(stagedPages(), 1);
    advance(const Duration(minutes: 2));
    expect(theirs.index.expireIfStale(), isFalse, reason: 'no index went');
    expect(stagedPages(), 0);
  });

  test('a role the cached permissions say may not hold it never asks, and an old index goes', () async {
    seed(3);
    await refresher.refresh(RefreshReason.manual);
    final billing = servicesFor(const ['patients.view', 'billing.view_codes']);
    final theirs = TeamIndexRefresher(billing.index, phone.engine.api, wallNow: () => phone.wall);
    final pages = server.indexPages;
    await theirs.refresh(RefreshReason.manual);
    expect(server.indexPages, pages);
    expect([indexRows(), billing.index.state.removed], [0, IndexRemoval.notPermitted]);
    expect(billing.index.state.eligible, isFalse);
  });

  test('the swap replaces every redirect, whatever its origin, with the first page’s list', () async {
    final ids = seed(4);
    server.merge(ids[1], ids[0]);
    // A receipt-learned redirect for a merge since undone, and one the server never had.
    store().replaceRedirects(const [], origin: 'index');
    phone.db.db.execute("INSERT INTO patient_redirects VALUES (?, ?, NULL, 'receipt')", [ids[2], ids[3]]);
    await refresher.refresh(RefreshReason.manual);
    final redirects = store().redirects();
    expect(redirects.keys, [ids[1]]);
    expect([redirects[ids[1]]!.survivorId, redirects[ids[1]]!.origin], [ids[0], 'index']);
    expect(store().canonicalPatient(ids[2]), ids[2]);
  });

  test('2,000 entries: staged size and the swap with FTS5 secure-delete on', () {
    api.IndexEntry entry(int i) => api.IndexEntry.fromJson({
      'patientId': 'e0e00000-0000-4000-8000-${i.toString().padLeft(12, '0')}',
      'preferredName': 'Demo ${String.fromCharCode(65 + i % 26)}$i',
      'aliases': [
        {'id': 'e1e00000-0000-4000-8000-${i.toString().padLeft(12, '0')}', 'alias': 'Street $i', 'kind': 'alias'},
      ],
      'visualDescriptor': 'Demo: tall, red cap, number $i',
      'birth': {'precision': 'year', 'year': 1940 + i % 60},
      'usualArea': 'Demo: corner $i',
      'lastSeenOn': '2026-10-03',
      'allergyScreen': 'not_asked',
      'allergies': [
        {
          'id': 'e2e00000-0000-4000-8000-${i.toString().padLeft(12, '0')}',
          'substance': 'penicillin',
          'category': 'drug',
          'severity': 'severe',
        },
      ],
      'idLinks': <Object?>[],
      'duplicate': null,
      'reviews': <Object?>[],
      'versions': {'preferredName': 1, 'visualDescriptor': 1, 'usualArea': 1, 'allergyScreen': 1},
    });
    final pages = [
      for (var p = 0; p < 4; p++)
        api.TeamIndexPage(
          entries: [for (var i = p * 500; i < (p + 1) * 500; i++) entry(i)],
          generatedAt: serverTime,
          next: p == 3 ? null : 'e0e00000-0000-4000-8000-${((p + 1) * 500 - 1).toString().padLeft(12, '0')}',
          projection: 'idx1',
          redirects: const [],
          status: api.TeamIndexPageStatus.page,
          version: '9.idx1',
        ),
    ];
    for (final (i, page) in pages.indexed) {
      services.index.stage(i == 0 ? '' : pages[i - 1].next!, page);
    }
    final staged =
        phone.db.db.select('SELECT sum(length(entries_json)) AS n FROM team_index_staging').first['n']! as int;
    // About 350 bytes of JSON an entry (6.4), with room for this entry's longer demo text.
    expect(staged, lessThan(2000 * 700));
    final resumed = services.index.staged()!;
    expect([resumed.pages.length, resumed.resumeAfter], [4, null]);
    final watch = Stopwatch()..start();
    services.index.swap(resumed.pages);
    expect(watch.elapsed, lessThan(const Duration(seconds: 2)));
    expect([indexRows(), stagedPages(), services.index.state.count], [2000, 0, 2000]);
    expect(phone.db.db.select("SELECT v FROM patient_names_config WHERE k = 'secure-delete'").single['v'], 1);
  });
}
