import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show MatchBand, MatchReason;
import 'package:sineobex_field/patients/chart_cache.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/patients/patient_search.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The phase 3 done-when against the in-memory server (design 13.1): a made-up patient is found
/// offline by a misspelled alias, edited, and flagged as a likely duplicate at intake. The same
/// fixture drives live_patients_test.dart and the API's patients-done-when.test.ts.
void main() {
  final fixture = jsonDecode(
    File('../../packages/contract/test-vectors/done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final p1 = fixture['p1']! as Map<String, Object?>;
  final p1Id = p1['id']! as String;
  final team = fixture['teamId']! as String;
  final search = fixture['search']! as Map<String, Object?>;
  final edit = fixture['edit']! as Map<String, Object?>;
  final intake = fixture['intake']! as Map<String, Object?>;
  final match = (fixture['match']! as Map<String, Object?>)['expected']! as Map<String, Object?>;
  const clinician = 'c0000000-0000-4000-8000-0000000000c1';
  final today = DateTime.parse('${fixture['today']}T15:00:00Z');

  late DateTime serverTime;
  late FakeSyncServer server;
  late TestPhone phone;
  late PatientServices services;

  void attach() {
    services = PatientServices(
      OpenTeam(
        userId: clinician,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: FakeSyncServer.healthcareStaff.toList(),
      ),
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  }

  void advance(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  /// P1 as db/seed/seed.ts inserts it from the same fixture.
  void seedP1() {
    final birth = p1['birth']! as Map<String, Object?>;
    server.seed(entityPatient, {
      'preferredName': p1['preferredName'],
      'legalName': p1['legalName'],
      'birth': birth,
      'visualDescriptor': p1['visualDescriptor'],
      'usualArea': p1['usualArea'],
      'livingSituation': p1['livingSituation'],
      'preferredLanguage': p1['preferredLanguage'],
      'consent': {
        'id': '5eed0c00-0000-4000-8000-000000000001',
        'decision': 'given',
        'method': 'verbal',
        'scriptVersion': consentScriptVersion,
        'language': 'en',
      },
      'privacyNotice': {'id': '5eed0c00-0000-4000-8000-000000000002', 'decision': 'acknowledged'},
    }, id: p1Id);
    for (final a in (p1['aliases']! as List<Object?>).cast<Map<String, Object?>>()) {
      server.seed(entityAlias, {'patientId': p1Id, 'alias': a['alias']}, id: a['id']! as String);
    }
    for (final a in (p1['allergies']! as List<Object?>).cast<Map<String, Object?>>()) {
      server.seed(entityAllergy, {
        'patientId': p1Id,
        'substance': a['substance'],
        'category': a['category'],
        'severity': a['severity'],
      }, id: a['id']! as String);
    }
  }

  setUp(() {
    serverTime = today;
    server = FakeSyncServer(now: () => serverTime);
    phone = TestPhone(
      userId: clinician,
      teamId: team,
      transport: () => server.transportFor(clinician, team),
      wall: today,
    );
    attach();
  });
  tearDown(() => phone.close());

  List<String> namesOf(String patientId, {String? origin}) => [
    for (final r in phone.db.db.select(
      'SELECT name FROM patient_names WHERE patient_id = ? ${origin == null ? '' : 'AND origin = ?'} ORDER BY name',
      [patientId, ?origin],
    ))
      r['name']! as String,
  ];

  /// Whether a trigram of [norm] that no name in the table still has is in the FTS5 segments
  /// (secure-delete, D29): what only a removed (or never written) name could have left.
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

  /// Every table (shadow tables included) whose text matches [pattern].
  Set<String> tablesHolding(RegExp pattern) => {
    for (final t in phone.db.db.select("SELECT name FROM sqlite_master WHERE type = 'table'"))
      for (final row in phone.db.db.select('SELECT * FROM "${t['name']}"'))
        for (final v in row.values)
          if ((v is String ? v : (v is Uint8List ? String.fromCharCodes(v) : null))?.contains(pattern) ?? false)
            t['name']! as String,
  };

  test('found offline by a misspelled alias, edited, and flagged as a likely duplicate at intake', () async {
    seedP1();

    // 1. Online sync: the index arrives in one page, without the legal name.
    expect(await phone.engine.syncAll(), isA<SyncDone>());
    expect(phone.store.kv('index.version'), isNotNull);
    final entry = services.index.entry(p1Id)!;
    expect(entry.allergies.single.substance, 'penicillin');
    expect(entry.idLinks, isEmpty);
    expect(namesOf(p1Id, origin: 'index'), [...(p1['phoneSearchRows']! as List<Object?>).cast<String>()]..sort());
    for (final never in (p1['neverOnThePhone']! as List<Object?>).cast<String>()) {
      expect(phone.db.db.select('SELECT 1 FROM patient_names WHERE name LIKE ?', ['%$never%']), isEmpty);
    }
    final downloaded = server.serverAudit.where((a) => a['action'] == 'patient.index_downloaded').single;
    expect(downloaded['details'], containsPair('after', null));
    expect(downloaded['details'], containsPair('next', null));

    // 2. Airplane mode.
    server.offline = true;

    // 3. Search "Smity": P1 first, through the alias, audited before it renders, the text never stored.
    final run = await services.search.search(search['text']! as String);
    expect(run.source, ListSource.phone);
    final first = run.hits.first;
    final expected = search['expected']! as Map<String, Object?>;
    expect(first.patientId, expected['first']);
    expect(first.reasons.map((r) => r.wire), expected['reasons']);
    expect(first.score, closeTo(expected['phoneScore']! as double, 1e-9));
    expect([first.preferredName, ...first.aliases].join(' '), isNot(contains('Delbert')));
    final searched = phone.store.outbox().single;
    expect(searched.entity, 'audit');
    expect(searched.value, {
      'action': 'patient.searched',
      'patientIds': [for (final h in run.hits) h.patientId],
      'resultCount': run.hits.length,
      'criteria': search['criteria'],
      'source': 'team_index',
    });
    expect(phone.db.db.select("SELECT 1 FROM outbox WHERE lower(value_json) LIKE '%smit%'"), isEmpty);

    // 4. Open P1 from the index and edit Usually found.
    final view = (await services.patients.open(p1Id))!;
    expect(view.copy, ChartCopy.partial);
    expect(view.legalName, isNull);
    final viewed = phone.store.outbox().last;
    expect(viewed.value, containsPair('action', 'patient.viewed'));
    expect(viewed.value, containsPair('source', 'team_index'));
    services.patients
      ..startEditing(p1Id)
      ..update(p1Id, {edit['field']! as String: edit['value']})
      ..finishEditing(p1Id);
    final sets = [
      for (final e in phone.store.outbox())
        if (e.op == 'set') e,
    ];
    expect(sets, hasLength(1));
    expect(
      [sets.single.entity, sets.single.recordId, sets.single.field, sets.single.baseVersion],
      [edit['entity'], edit['recordId'], edit['field'], edit['baseVersion']],
    );

    // 5. A new patient, still offline: the read-back asks to confirm, P1 is likely, Not them.
    final parsed = parseBirth(intake['typedBirth']! as String, BirthMode.date, today) as ParsedBirth;
    expect(parsed.readBack, intake['readBack']);
    expect(parsed.needsConfirmation, intake['needsConfirmation']);
    expect(parsed.birth.toJson(), intake['birth']);
    final legal = intake['legalName']! as Map<String, Object?>;
    final check = await services.search.checkMatches(
      MatchInput(
        preferredName: intake['preferredName']! as String,
        legalGiven: legal['given'] as String?,
        legalFamily: legal['family'] as String?,
        birth: parsed.birth,
      ),
    );
    expect(check.source, ListSource.phone);
    final candidate = check.candidates.single;
    expect(candidate.patientId, match['candidate']);
    expect(candidate.band, MatchBand.likely);
    expect(candidate.reasons.map((r) => r.wire), match['reasons']);
    expect(candidate.score, closeTo(match['phoneScore']! as double, match['tolerance']! as double));
    expect(candidate.matchedLegalName, isFalse);
    final created = services.patients.createPatient(
      Intake(
        consent: const ConsentAnswer.given(),
        preferredName: intake['preferredName']! as String,
        legalGiven: legal['given'] as String?,
        birth: parsed.birth,
        matchCheck: check.matchCheck(dismissed: (intake['dismissed']! as List<Object?>).cast<String>()),
      ),
    );
    final p2 = created.patientId;
    final tail = phone.store.outbox().reversed.take(2).toList().reversed.toList();
    expect(tail.first.value, {
      'action': 'patient.match_checked',
      'checkId': check.checkId,
      'patientIds': [p1Id],
      'resultCount': 1,
      'source': 'team_index',
    });
    expect([tail.last.entity, tail.last.op, tail.last.recordId], [entityPatient, 'create', p2]);
    final createValue = tail.last.value! as Map<String, Object?>;
    expect(createValue['matchCheck'], {
      'checkId': check.checkId,
      'where': 'phone',
      'indexVersion': phone.store.kv('index.version'),
      'shown': [p1Id],
      'dismissed': [p1Id],
    });
    expect(createValue['consent'], containsPair('decision', 'given'));
    expect(createValue['privacyNotice'], containsPair('decision', 'acknowledged'));
    // Its legal given name "Del" is not in the search table (D40).
    expect(namesOf(p2), intake['phoneSearchRows']);

    // 6. The app is killed and opened again: the outbox is the same, change for change.
    final before = [for (final e in phone.store.outbox()) (e.changeId, e.valueHash)];
    await phone.restart();
    attach();
    expect([for (final e in phone.store.outbox()) (e.changeId, e.valueHash)], before);

    // 7. Reconnect and sync: every change confirmed by hash, the edit and the pair on the server.
    advance(const Duration(minutes: 5));
    server.offline = false;
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    expect(phone.store.outbox(), isEmpty);
    final serverP1 = server.records[p1Id]!.fields[edit['field']]!;
    expect([serverP1.value, serverP1.version], [edit['value'], 2]);
    expect(
      server.history.any((h) => h['recordId'] == p1Id && h['field'] == edit['field'] && h['kind'] == 'set'),
      isTrue,
    );
    expect(server.records[p2]!.status, 'active');
    expect(server.openPair(p1Id, p2)!.status, 'open');
    expect(phone.store.notices().where((n) => n.kind == noticePossibleDuplicate), isEmpty);
    expect(server.audit.map((a) => a['action']), ['patient.searched', 'patient.viewed', 'patient.match_checked']);
    final details = jsonEncode(server.audit).toLowerCase();
    for (final never in (fixture['neverInAuditDetails']! as List<Object?>).cast<String>()) {
      expect(details, isNot(contains(never)));
    }

    // 8. The refresh after that sync: both entries carry the hint; P2 is an index entry and its own
    // search rows are gone.
    expect(services.index.entry(p1Id)!.duplicate?.status.wire, 'open');
    expect(services.index.entry(p2)!.duplicate?.status.wire, 'open');
    expect(namesOf(p2, origin: 'local'), isEmpty);
    expect(namesOf(p2, origin: 'index'), ['smitty']);

    // 25 hours on: the purge takes the partial chart of P1 and P2's records, their own search rows
    // and card rows; the index stays.
    advance(const Duration(hours: 25));
    phone.store.purge();
    expect(phone.store.record(p1Id), isNull);
    expect(phone.store.record(p2), isNull);
    expect(chartMetaOf(phone.store, p1Id), isNull);
    expect(phone.db.db.select("SELECT 1 FROM patient_names WHERE origin IN ('cache', 'local')"), isEmpty);
    expect(phone.db.db.select('SELECT 1 FROM id_links'), isEmpty);
    expect(namesOf(p1Id, origin: 'index'), isNotEmpty);
    expect(onDisk('delbert'), isFalse);
    expect(onDisk('smithfield'), isFalse);
    // P1's legal name never reached this phone: only its own chart could have held it (D40).
    expect(tablesHolding(RegExp('Delbert|Smithfield', caseSensitive: false)), isEmpty);
  });

  test('the legal name of a downloaded chart rests only in its fields, and leaves with the chart (D40)', () async {
    seedP1();
    await phone.engine.syncAll();
    final view = (await services.patients.open(p1Id))!;
    expect(view.copy, ChartCopy.full);
    expect(view.legalName, (given: 'Delbert', family: 'Smithfield'));
    expect(tablesHolding(RegExp('Delbert|Smithfield')), {'fields'});
    expect(namesOf(p1Id, origin: 'cache'), [...(p1['phoneSearchRows']! as List<Object?>).cast<String>()]..sort());
    // Offline, the typed legal name finds the cached chart in memory, and the result shows no legal name.
    server.offline = true;
    final hit = (await services.search.search('Delbert Smithfield')).hits.single;
    expect(hit.patientId, p1Id);
    expect(hit.reasons, contains(MatchReason.legalName));
    expect(hit.matchedLegalName, isTrue);
    advance(const Duration(hours: 25));
    phone.store.purge();
    expect(tablesHolding(RegExp('Delbert|Smithfield', caseSensitive: false)), isEmpty);
    // The index's names may still score; the legal name no longer can.
    expect(services.search.searchOnPhone('Delbert Smithfield').hits.where((h) => h.matchedLegalName), isEmpty);
  });
}
