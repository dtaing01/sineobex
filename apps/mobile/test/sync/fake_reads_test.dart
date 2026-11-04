import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';

/// The fake's patient read routes (design 3.1, 6, 7: services/api/src/patients/{team-index,
/// charts,search,match}.ts), decoded by the generated client as the phone will read them.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  late FakeSyncServer server;
  late SineobexApi api;
  final now = DateTime.utc(2026, 10, 22, 15);

  setUp(() {
    server = FakeSyncServer(now: () => now);
    api = SineobexApi(server.transportFor(alex, team));
  });

  const legal = {'given': 'Ysolde', 'family': 'Varrowick'};

  /// A patient with a street name, an allergy, a problem and a card.
  String chart() {
    final p = server.seedPatient(
      preferredName: 'Smitty',
      legalName: legal,
      visualDescriptor: 'Demo: red scarf',
      birth: const {'precision': 'day', 'date': '1970-05-06'},
    );
    server.seed(entityAlias, {'patientId': p, 'alias': 'Smitts'});
    server.seed(entityAllergy, {'patientId': p, 'substance': 'penicillin', 'severity': 'severe'});
    server.seed(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
    server.seed(entityProblem, {
      'patientId': p,
      'title': 'Low mood',
      'status': 'ongoing',
      'code': {'system': 'icd10cm', 'code': 'F32.9'},
    });
    server.seed(entityIdLink, {
      'patientId': p,
      'token': 'EEEEEEEEEEEEEEEEEEEEEE',
      'replacesLinkId': null,
      'reason': 'first_card',
    });
    return p;
  }

  group('the team index', () {
    test('holds the PRD’s list and bookkeeping, never a legal name, and pages by patient ID', () async {
      final p = chart();
      final merged = server.seedPatient(preferredName: 'Smit');
      server.merge(merged, p);
      for (var i = 0; i < 149; i++) {
        server.seedPatient(preferredName: 'Demo $i');
      }
      final raw = await server.handle(alex, team, 'POST', '/v1/patients/index', {'limit': 100});
      expect(jsonEncode(raw), isNot(matches(RegExp('Ysolde|Varrowick|ysolde|varrowick'))));
      final first = await api.downloadTeamIndex(body: const TeamIndexRequest(limit: 100));
      expect([first.status, first.entries.length, first.projection], [TeamIndexPageStatus.page, 100, 'idx1']);
      expect(first.redirects.single.mergedId, merged);
      final second = await api.downloadTeamIndex(body: TeamIndexRequest(after: first.next, limit: 100));
      expect([second.entries.length, second.next, second.redirects], [50, null, isEmpty]);
      final entry = [...first.entries, ...second.entries].firstWhere((e) => e.patientId == p);
      expect(entry.aliases.map((a) => (a.alias, a.kind, a.id == null)), [
        ('Smitts', IndexEntryAliasesItemKind.alias, false),
        ('Smit', IndexEntryAliasesItemKind.mergedName, true),
      ]);
      expect(entry.allergies.single.severity, AllergySeverity.severe);
      expect(entry.idLinks, hasLength(1));
      expect(entry.versions.preferredName, 1);
    });

    test('`have` the current version answers unchanged; any change moves it', () async {
      final p = chart();
      final v1 = (await api.downloadTeamIndex(body: const TeamIndexRequest())).version;
      final same = await api.downloadTeamIndex(body: TeamIndexRequest(have: v1));
      expect([same.status, same.entries], [TeamIndexPageStatus.unchanged, isEmpty]);
      server.serverEdit(p, 'usualArea', 'Demo: pier', by: alex);
      final moved = await api.downloadTeamIndex(body: TeamIndexRequest(have: v1));
      expect(moved.status, TeamIndexPageStatus.page);
      expect(moved.version, isNot(v1));
    });

    test('a role without a field permission gets 403 index_not_permitted', () async {
      server.permissions[alex] = {'patients.view', 'billing.view_codes'};
      expect(
        () => api.downloadTeamIndex(body: const TeamIndexRequest()),
        throwsA(isA<ApiException>().having((e) => e.code, 'code', 'index_not_permitted')),
      );
    });
  });

  group('charts', () {
    test('a merged ID answers its survivor’s chart with the redirects into it; unknown IDs are missing', () async {
      final p = chart();
      final merged = server.seedPatient(preferredName: 'Smit');
      server.merge(merged, p);
      const unknown = 'f0000000-0000-4000-8000-00000000000f';
      final bundle = await api.fetchCharts(
        body: const FetchCharts(patientIds: [unknown], reason: FetchChartsReason.opened).copyWithIds([merged, unknown]),
      );
      final c = bundle.charts.single;
      expect(
        [c.canonicalId, c.mergedFrom.single.patientId, bundle.missing],
        [
          p,
          merged,
          [unknown],
        ],
      );
      expect(bundle.redirects.single.survivorId, p);
      expect(c.patient.fields['legalName']!.value, legal);
      expect(c.aliases.single.attributes['alias'], 'Smitts');
      expect(c.problems!.map((r) => r.attributes['title']), unorderedEquals(['Cough', 'Low mood']));
      expect(c.idLinks.single.url, endsWith('/c#EEEEEEEEEEEEEEEEEEEEEE'));
      expect(server.serverAudit.single['details'], {'source': 'cache', 'reason': 'opened'});
    });

    test('the projection: no problem list without its permissions, sensitive ones only with view_sensitive', () async {
      final p = chart();
      server.permissions[alex] = FakeSyncServer.chw;
      var c = (await api.fetchCharts(
        body: FetchCharts(patientIds: [p], reason: FetchChartsReason.refresh),
      )).charts.single;
      expect([c.problems, c.problemNotes], [null, null]);
      expect(c.idLinks.single.url, isNotNull);
      server.permissions[alex] = {'patients.view', 'encounters.chart'};
      c = (await api.fetchCharts(
        body: FetchCharts(patientIds: [p], reason: FetchChartsReason.refresh),
      )).charts.single;
      expect(c.problems!.map((r) => r.attributes['title']), ['Cough']);
      expect(c.idLinks.single.url, isNull);
    });
  });

  test('search finds a misspelled street name and shows no legal name on the phone', () async {
    final p = chart();
    server.seedPatient(preferredName: 'Bartholomew');
    final res = await api.searchPatients(
      body: const PatientSearch(name: 'Smity', surface: Surface.phone),
    );
    expect(res.hits.first.patientId, p);
    expect(res.hits.first.summary.legalName, isNull);
    expect(res.hits.first.summary.aliases, ['Smitts']);
    final portal = await api.searchPatients(
      body: const PatientSearch(name: 'Varrowick', surface: Surface.portal),
    );
    expect(portal.hits.single.summary.legalName?.family, 'Varrowick');
    expect(server.serverAudit.map((a) => a['action']), ['patient.searched', 'patient.searched']);
  });

  test('the match check finds the likely same person and leaves out the patient’s own group', () async {
    final p = chart();
    final res = await api.matchPatients(
      body: const PatientMatchRequest(
        legalName: LegalNameInput(given: 'Ysolde', family: 'Varrowick'),
        birth: BirthInput(precision: BirthPrecision.day, date: '1970-05-06'),
        surface: Surface.phone,
      ),
    );
    expect(res.candidates.single.patientId, p);
    expect(res.candidates.single.band, MatchBand.likely);
    final own = await api.matchPatients(
      body: PatientMatchRequest(preferredName: 'Smitty', excludePatientId: p, surface: Surface.phone),
    );
    expect(own.candidates, isEmpty);
  });

  test('card notices go to their issuers and are marked read', () async {
    final p = server.seedPatient();
    server.seed(entityIdLink, {
      'patientId': p,
      'token': 'FFFFFFFFFFFFFFFFFFFFFF',
      'replacesLinkId': null,
      'reason': 'first_card',
    }, by: 'b0000000-0000-4000-8000-00000000000b');
    // Made later on alex's phone without seeing that card: the newer wins.
    server.seed(
      entityIdLink,
      {'patientId': p, 'token': 'GGGGGGGGGGGGGGGGGGGGGG', 'replacesLinkId': null, 'reason': 'first_card'},
      by: alex,
      at: now.add(const Duration(minutes: 1)),
    );
    final mine = await api.listNotices();
    expect(mine.single.kind, 'id_link_kept');
    await api.markNoticeRead(noticeId: mine.single.id);
    expect((await api.listNotices()).single.readAt, isNotNull);
  });
}

extension on FetchCharts {
  FetchCharts copyWithIds(List<String> ids) => FetchCharts(patientIds: ids, reason: reason);
}
