import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/sync/local_db.dart';
import 'package:sineobex_field/sync/local_store.dart';

const userId = '7d1c1b9e-5f6a-4c1e-9d3a-2b4c6d8e0f12';
final key = Uint8List.fromList(List<int>.generate(32, (i) => i * 7 % 256));

/// The phone store's patient-side rules (phase 3 design 2.9, tests 13.5): parents held behind a
/// refusal, receipts that carry the chart's value, scopes and the purge, clearing server data,
/// secure deletes, where a legal name may rest, re-entrant transactions and the clock pause.
void main() {
  late Directory dir;
  late LocalDatabase db;
  late LocalStore store;
  var paused = false;
  var now = DateTime.utc(2026, 10, 20, 15);
  var ids = 0;

  ClockStamp stamp() => ClockStamp(deviceTime: now, correctedTime: now, verified: true);
  String uuid() => 'c0c00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

  setUp(() {
    dir = Directory.systemTemp.createTempSync('patients');
    db = LocalDatabase.open(LocalDatabase.fileFor(dir.path, userId, 'team-1'), key);
    paused = false;
    now = DateTime.utc(2026, 10, 20, 15);
    store = LocalStore(db, userId: userId, stamp: stamp, chartingPaused: () => paused, now: () => now);
  });
  tearDown(() {
    db.close();
    dir.deleteSync(recursive: true);
  });

  Map<String, Object?> intake({
    String? preferred = 'Del',
    Map<String, Object?>? legalName,
    String? descriptor,
    Map<String, Object?>? birth,
    String? idCardChoice,
  }) => {
    'preferredName': ?preferred,
    'legalName': ?legalName,
    'visualDescriptor': ?descriptor,
    'birth': ?birth,
    'idCardChoice': ?idCardChoice,
    'consent': {'id': uuid(), 'decision': 'given', 'method': 'verbal', 'scriptVersion': '2026-10-1', 'language': 'en'},
    'privacyNotice': {'id': uuid(), 'decision': 'acknowledged'},
  };

  OutboxEntry createOf(String recordId) => store.outbox().firstWhere((e) => e.recordId == recordId && e.op == 'create');
  void confirmAll() {
    for (final e in store.outbox()) {
      store.confirm(e, serverVersion: 1);
    }
  }

  String patient({Map<String, Object?>? value}) {
    final id = store.createRecord(entityPatient, value ?? intake());
    store.confirm(createOf(id), serverVersion: 1);
    return id;
  }

  String link(String patientId, {String? replaces}) => store.createRecord(entityIdLink, {
    'patientId': patientId,
    'token': 'AAAAAAAAAAAAAAAAAAAAAA',
    'replacesLinkId': replaces,
    'reason': replaces == null ? 'first_card' : 'lost',
  });

  void addName(String patientId, String name, {String source = 'preferred', String origin = 'cache'}) => db.db.execute(
    'INSERT INTO patient_names (name, patient_id, source, origin) VALUES (?, ?, ?, ?)',
    [name, patientId, source, origin],
  );
  List<String> namesOf(String patientId) => [
    for (final r in db.db.select('SELECT origin FROM patient_names WHERE patient_id = ? ORDER BY origin', [patientId]))
      r['origin'] as String,
  ];
  void addLink(String patientId, {String state = 'active', String? token = 'BBBBBBBBBBBBBBBBBBBBBB'}) => db.db.execute(
    'INSERT INTO id_links (id, patient_id, token, state, updated_at) VALUES (?, ?, ?, ?, 0)',
    [uuid(), patientId, token, state],
  );
  int linksOf(String patientId) =>
      db.db.select('SELECT count(*) AS n FROM id_links WHERE patient_id = ?', [patientId]).first['n']! as int;

  /// A chart as a download imports it: the patient, a street name, and closed (scopes keep it).
  String cachedChart({Map<String, Object?> legalName = const {'given': 'Zorvath', 'family': 'Quillby'}}) {
    final id = uuid();
    store.importServerRecord(
      ServerRecord(
        entity: entityPatient,
        id: id,
        status: 'active',
        authorUserId: userId,
        attributes: const {},
        fields: {
          'preferredName': const ServerField(value: 'Zee', version: 1),
          'legalName': ServerField(value: legalName, version: 1),
          'usualArea': const ServerField(value: 'Demo: north lot', version: 1),
        },
      ),
      open: false,
    );
    store.importServerRecord(
      ServerRecord(
        entity: entityAlias,
        id: uuid(),
        status: 'active',
        authorUserId: userId,
        attributes: {'patientId': id, 'alias': 'Zed'},
        fields: const {'removal': ServerField(value: null, version: 0)},
      ),
      open: false,
    );
    store.addScope(id);
    addName(id, 'zee');
    addName(id, 'zed', source: 'alias');
    addLink(id);
    return id;
  }

  /// Whether any trigram of [norm] (FTS5's: every three characters in a row) is still in the FTS5
  /// index's segments, its shadow table.
  bool onDisk(String norm) => [for (var i = 0; i + 3 <= norm.length; i++) norm.substring(i, i + 3)].any(
    (t) =>
        db.db.select('SELECT count(*) AS n FROM patient_names_data WHERE instr(block, ?) > 0', [
          Uint8List.fromList(utf8.encode(t)),
        ]).first['n']! !=
        0,
  );

  group('parents', () {
    test('a refused intake holds everything on that patient, and its fix releases them once confirmed', () {
      final p = store.createRecord(entityPatient, intake());
      store.createRecord(entityAlias, {'patientId': p, 'alias': 'Dee'});
      store.createRecord(entityAllergy, {'patientId': p, 'substance': 'penicillin'});
      store.createRecord(entityConsent, {
        'patientId': p,
        'kind': 'privacy_notice',
        'decision': 'acknowledged',
        'method': 'verbal',
        'scriptVersion': '2026-10-1',
        'language': 'en',
      });
      final problem = store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
      store.createRecord(entityProblemNote, {'problemId': problem, 'text': 'Worse at night.'});
      link(p);
      store.createEncounter(kind: 'medical', patientId: p);
      expect(store.sendable(), hasLength(8));

      store.reject(createOf(p), reason: 'validation', details: const {'problem': 'birth_in_future'});
      expect(store.sendable(), isEmpty);
      expect(store.heldCount(), 7);

      store.fixRejected(createOf(p).changeId, intake(preferred: 'Delbert'));
      // The fix sits after what waited on the refused create: they go only once it is confirmed.
      expect(store.sendable().map((e) => e.recordId), [p]);
      store.confirm(store.sendable().single, serverVersion: 1);
      expect(store.sendable(), hasLength(7));
      expect(store.heldCount(), 0);
    });

    test('a problem status naming an encounter refused, or created later in the outbox, waits for it', () {
      final p = patient();
      final problem = store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
      store.confirm(createOf(problem), serverVersion: 1);
      final encounter = store.createEncounter(kind: 'medical', patientId: p);
      store.setField(problem, 'status', {'status': 'ongoing', 'encounterId': encounter});
      final status = store.outbox().last;
      expect(store.sendable().map((e) => e.changeId), contains(status.changeId));

      store.reject(createOf(encounter), reason: 'stale_reference', details: const {'problem': 'patient_missing'});
      expect(store.sendable(), isEmpty);
      // A later status of the same problem waits behind the held one, keeping their order.
      store.setField(problem, 'status', {'status': 'resolved', 'encounterId': null});
      expect(store.sendable(), isEmpty);

      // Fixed, the encounter's create is now after the status: still held until it is confirmed.
      store.fixRejected(createOf(encounter).changeId, {'kind': 'medical'});
      expect(store.sendable().map((e) => e.recordId), [encounter]);
      store.confirm(store.sendable().single, serverVersion: 1);
      expect(store.sendable().map((e) => e.changeId).first, status.changeId);
    });
  });

  group('receipts', () {
    test('kept both: the field shows the chart’s value unless a newer edit of it waits, and the person is told', () {
      final p = patient();
      store.setField(p, 'usualArea', 'Demo: under the bridge');
      store.setField(p, 'usualArea', 'Demo: by the river');
      final [first, second] = store.outbox();
      expect(second.follows, first.changeId);
      const chart = ServerField(value: 'Demo: Fifth Street', version: 1);
      final details = {'outcome': 'kept_both', 'reviewId': uuid()};

      store.confirm(first, serverVersion: 1, server: chart, details: details);
      var field = store.record(p)!.fields['usualArea']!;
      expect([field.value, field.pendingChange], ['Demo: by the river', second.changeId]);

      store.confirm(second, serverVersion: 1, server: chart, details: details);
      field = store.record(p)!.fields['usualArea']!;
      expect([field.value, field.serverVersion, field.pendingChange], ['Demo: Fifth Street', 1, null]);
      expect(store.notices().map((n) => (n.kind, n.patientId, n.field)), [
        (noticeKeptBoth, p, 'usualArea'),
        (noticeKeptBoth, p, 'usualArea'),
      ]);
      expect(store.outbox(), isEmpty);
    });

    test('history only with nothing to recognise keeps the name here too, with a notice', () {
      final p = patient(value: intake(descriptor: 'Demo: green jacket'));
      store.setField(p, 'preferredName', null);
      store.confirm(
        store.outbox().single,
        serverVersion: 2,
        server: const ServerField(value: 'Del', version: 2),
        details: const {'outcome': 'history_only', 'problem': 'nothing_to_recognise'},
      );
      expect(store.record(p)!.fields['preferredName']!.value, 'Del');
      expect(store.notices().single.kind, noticeNothingToRecognise);
    });

    test('a set redirected to a merged patient’s survivor leaves a provisional redirect; a problem’s does not', () {
      final p = patient();
      const survivor = 'c0c00000-0000-4000-8000-0000000000aa';
      store.setField(p, 'usualArea', 'Demo: south lot');
      store.confirm(store.outbox().single, serverVersion: 3, details: {'redirectedTo': survivor, 'mergeId': uuid()});
      expect(store.redirects()[p]?.survivorId, survivor);
      expect(store.redirects()[p]?.origin, 'receipt');
      expect(store.canonicalPatient(p), survivor);

      final problem = store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
      store.confirm(createOf(problem), serverVersion: 1);
      store.setField(problem, 'status', {'status': 'ongoing', 'encounterId': null});
      store.confirm(store.outbox().single, serverVersion: 2, details: const {'redirectedTo': 'some-problem'});
      expect(store.redirects().keys, [p]);
    });

    test('a possible duplicate and a note on a retracted problem are told; hooks see every receipt', () {
      final seen = <(String, Object?)>[];
      store.onConfirmed.add((e, r) => seen.add((e.entity, r.details?['linkOutcome'])));
      store.onConfirmed.add((e, r) => throw StateError('a broken hook'));
      final p = store.createRecord(entityPatient, intake());
      store.confirm(createOf(p), serverVersion: 1, details: const {'possibleDuplicate': true});
      final cardId = link(p);
      store.confirm(
        createOf(cardId),
        serverVersion: 1,
        details: {
          'linkOutcome': 'retired',
          'activeLinkId': uuid(),
          'retiredLinkIds': [cardId],
        },
      );
      expect(seen, [(entityPatient, null), (entityIdLink, 'retired')]);
      expect(store.notices().map((n) => (n.kind, n.patientId)), [(noticePossibleDuplicate, p)]);
      // The broken hook lost only its own work: both changes left the phone.
      expect(store.outbox(), isEmpty);
    });

    test('a hook writes in the confirmation’s transaction', () {
      store.onConfirmed.add((e, r) {
        if (e.entity == entityIdLink) {
          db.db.execute("UPDATE id_links SET state = 'active' WHERE id = ?", [e.recordId]);
        }
      });
      final p = patient();
      final cardId = link(p);
      db.db.execute("INSERT INTO id_links (id, patient_id, state, updated_at) VALUES (?, ?, 'pending', 0)", [
        cardId,
        p,
      ]);
      store.confirm(createOf(cardId), serverVersion: 1, details: const {'linkOutcome': 'active'});
      expect(db.db.select('SELECT state FROM id_links WHERE id = ?', [cardId]).single['state'], 'active');
    });

    test('a refused card is replaced by a new one on the kept chart, and settles with it', () {
      final p = patient();
      final survivor = patient();
      final refused = link(p);
      store.reject(
        createOf(refused),
        reason: 'stale_reference',
        details: {'problem': 'patient_merged', 'survivorId': survivor},
      );
      final card = store.replaceRejected(
        createOf(refused).changeId,
        entity: entityIdLink,
        value: {
          'patientId': survivor,
          'token': 'CCCCCCCCCCCCCCCCCCCCCC',
          'replacesLinkId': null,
          'reason': 'first_card',
        },
      );
      expect(store.record(refused), isNull);
      expect(store.needsAttention(), isEmpty);
      final fix = store.sendable().single;
      expect([fix.recordId, fix.supersedes, fix.patientId], [card, createOf(refused).changeId, survivor]);
      store.confirm(fix, serverVersion: 1);
      expect(store.outbox(), isEmpty);
    });
  });

  group('hard stops the server would refuse', () {
    test('the last name or description of someone can’t be cleared here', () {
      final p = patient(value: intake(descriptor: 'Demo: red cap'));
      store.setField(p, 'preferredName', null);
      expect(
        () => store.setField(p, 'visualDescriptor', null),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'nothing_to_recognise')),
      );
    });

    test('a recorded legal name or birth is only filled here; an estimate may be refined with a warning', () {
      final p = patient(
        value: intake(
          legalName: const {'given': 'Delbert', 'family': null},
          birth: const {'precision': 'estimated', 'year': 1980},
        ),
      );
      store.setField(p, 'legalName', const {'given': 'Delbert', 'family': 'Quillby'});
      expect(
        () => store.setField(p, 'legalName', const {'given': 'Delmer', 'family': 'Quillby'}),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'identity_admin_only')),
      );
      store.setField(p, 'birth', const {'precision': 'year', 'year': 1990});
      expect(
        () => store.setField(p, 'birth', null),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'identity_admin_only')),
      );
      expect(
        () => store.setField(p, 'birth', const {'precision': 'day', 'date': '2026-10-23'}),
        throwsA(isA<LocalValidationError>()),
      );
    });

    test('a problem’s status never goes back here', () {
      final p = patient();
      final problem = store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'ongoing'});
      expect(
        () => store.setField(problem, 'status', const {'status': 'new', 'encounterId': null}),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'status_backwards')),
      );
      store.setField(problem, 'status', const {'status': 'resolved', 'encounterId': null});
      expect(store.record(problem)!.status, 'resolved');
      expect(
        () => store.setField(problem, 'status', const {'status': 'ongoing', 'encounterId': null}),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'resolved_needs_admin')),
      );
    });

    test('values are checked as the server does: untrimmed text, unknown keys, a future birth', () {
      expect(
        () => store.createRecord(entityPatient, intake(preferred: ' Del')),
        throwsA(isA<LocalValidationError>().having((e) => e.paths, 'paths', {'preferredName'})),
      );
      expect(
        () => store.createRecord(entityPatient, intake(preferred: null)),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'nothing_to_recognise')),
      );
      expect(
        () => store.createRecord(entityPatient, intake(birth: const {'precision': 'year', 'year': 2027})),
        throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'birth_in_future')),
      );
      expect(
        () => store.createRecord(entityAlias, {'patientId': uuid(), 'alias': 'Dee', 'x': 1}),
        throwsA(isA<LocalValidationError>()),
      );
      expect(() => store.createRecord(entityAudit, const {}), throwsArgumentError);
      expect(store.outbox(), isEmpty);
    });
  });

  test('the clock pause stops problems, their notes and ID links, never registering someone (D35)', () {
    paused = true;
    final p = store.createRecord(entityPatient, intake(idCardChoice: 'wants'));
    store.setField(p, 'usualArea', 'Demo: east lot');
    store.createRecord(entityAlias, {'patientId': p, 'alias': 'Dee'});
    final allergy = store.createRecord(entityAllergy, {'patientId': p, 'substance': 'latex'});
    store.setField(allergy, 'enteredInError', const {'reason': 'Wrong patient'});
    expect(store.chartingPaused, isTrue);
    expect(() => link(p), throwsA(isA<ChartingPaused>()));
    expect(
      () => store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'}),
      throwsA(isA<ChartingPaused>()),
    );
    // An intake that wants a card saves without it; the card waits for the clock.
    expect(store.record(p)!.fields['idCardChoice']!.value, 'wants');
    expect(store.outbox().where((e) => e.entity == entityIdLink), isEmpty);
    expect(store.unsynced().counts, {'patients': 5});

    paused = false;
    final problem = store.createRecord(entityProblem, {'patientId': p, 'title': 'Cough', 'status': 'new'});
    paused = true;
    expect(
      () => store.setField(problem, 'status', const {'status': 'ongoing', 'encounterId': null}),
      throwsA(isA<ChartingPaused>()),
    );
    expect(
      () => store.createRecord(entityProblemNote, {'problemId': problem, 'text': 'x'}),
      throwsA(isA<ChartingPaused>()),
    );
  });

  group('charts kept here', () {
    test('a chart stays while its scope or local work covers it, then goes with its names and links', () {
      final p = cachedChart();
      addName(p, 'zee', origin: 'index');
      now = now.add(const Duration(hours: 23));
      store.purge();
      expect(store.recordIdsOfPatient(p), hasLength(2));

      // Worked on: kept while the change waits, whatever the scope says.
      store.setField(p, 'usualArea', 'Demo: west lot');
      now = now.add(const Duration(hours: 25));
      store.purge();
      expect(store.record(p)!.fields['usualArea']!.value, 'Demo: west lot');
      expect(namesOf(p), ['cache', 'cache', 'index']);
      expect(linksOf(p), 1);

      store.confirm(store.outbox().single, serverVersion: 2);
      expect(store.recordIdsOfPatient(p), isEmpty);
      expect(namesOf(p), ['index']);
      expect(linksOf(p), 0);
      expect(onDisk('zed'), isFalse);
    });

    test('local edits and creates keep the chart for 24 hours from the edit', () {
      final p = cachedChart();
      now = now.add(const Duration(hours: 20));
      store.createRecord(entityAlias, {'patientId': p, 'alias': 'Zip'});
      expect(store.scopes().single.expiresAt, now.add(serverCopyLifetime));
      confirmAll();
      now = now.add(const Duration(hours: 23));
      store.purge();
      expect(store.recordIdsOfPatient(p), hasLength(3));
      now = now.add(const Duration(hours: 2));
      store.purge();
      expect(store.recordIdsOfPatient(p), isEmpty);
    });

    test('a chart kept for a patient merged since stays under the survivor; an undo lets it go', () {
      final merged = cachedChart();
      final survivor = uuid();
      store.replaceRedirects([PatientRedirect(mergedId: merged, survivorId: survivor)], origin: 'index');
      expect(store.scopes().single.patientId, survivor);
      store.purge();
      expect(store.recordIdsOfPatient(merged), hasLength(2));
      // Undone: the index's next list no longer holds it, and nothing keeps the merged chart.
      store.replaceRedirects(const [], origin: 'index');
      store.purge();
      expect(store.recordIdsOfPatient(merged), isEmpty);
    });

    test('the server’s redirect lists replace what they cover, whatever its origin (D27)', () {
      final a = uuid(), b = uuid(), c = uuid(), s = uuid();
      db.db.execute("INSERT INTO patient_redirects VALUES (?, ?, NULL, 'receipt'), (?, ?, NULL, 'receipt')", [
        a,
        s,
        b,
        s,
      ]);
      // A chart bundle for c and s covers redirects into s: b's merge was undone.
      store.replaceRedirects(
        [PatientRedirect(mergedId: a, survivorId: s, mergedAt: now)],
        origin: 'chart',
        covering: [c, s],
      );
      expect(store.redirects().map((k, v) => MapEntry(k, v.origin)), {a: 'chart'});
      db.db.execute("INSERT INTO patient_redirects VALUES (?, ?, NULL, 'receipt')", [c, s]);
      store.replaceRedirects(const [], origin: 'chart', covering: [b]);
      expect(store.redirects().keys, unorderedEquals([a, c]));
      store.replaceRedirects([PatientRedirect(mergedId: b, survivorId: s)], origin: 'index');
      expect(store.redirects().map((k, v) => MapEntry(k, v.origin)), {b: 'index'});
    });
  });

  group('clearing server data', () {
    test('deletes the index, cached charts, redirects and scopes, and keeps local work and its charts', () {
      final cached = cachedChart();
      final worked = cachedChart();
      store.setField(worked, 'usualArea', 'Demo: pier');
      final madeHere = patient();
      addName(madeHere, 'del', origin: 'local');
      final waiting = store.createRecord(entityPatient, intake(preferred: 'Pim'));
      addName(waiting, 'pim', origin: 'local');
      db.db.execute("INSERT INTO team_index (patient_id, entry_json) VALUES (?, '{}')", [uuid()]);
      db.db.execute("INSERT INTO team_index_staging VALUES ('', 'v1', '[]', 0)");
      addName(uuid(), 'quorvel', origin: 'index');
      db.db.execute("INSERT INTO patient_redirects VALUES (?, ?, NULL, 'index')", [uuid(), cached]);
      store.setKv('index.version', '7.idx1');
      store.setKv('intake.draft', '{}');
      final outbox = store.outbox().map((e) => e.changeId).toList();

      store.clearServerData();
      int rows(String table) => db.db.select('SELECT count(*) AS n FROM $table').first['n']! as int;
      expect(
        [rows('team_index'), rows('team_index_staging'), rows('patient_redirects'), rows('cache_scopes')],
        [0, 0, 0, 0],
      );
      expect(store.recordIdsOfPatient(cached), isEmpty);
      expect(store.recordIdsOfPatient(madeHere), isEmpty);
      expect(store.recordIdsOfPatient(worked), hasLength(2));
      expect(store.recordIdsOfPatient(waiting), [waiting]);
      expect(
        [namesOf(cached), namesOf(worked), namesOf(madeHere), namesOf(waiting)],
        [
          <String>[],
          <String>[],
          <String>[],
          ['local'],
        ],
      );
      expect([linksOf(cached), linksOf(worked)], [0, 1]);
      expect(store.kv('index.version'), isNull);
      expect(store.kv('intake.draft'), '{}');
      expect(store.outbox().map((e) => e.changeId), outbox);
      for (final name in ['zee', 'zed', 'quorvel', 'del']) {
        expect(onDisk(name), isFalse, reason: name);
      }
    });

    test('FTS5 secure-delete leaves no trigram of a removed name in the file', () {
      final p = cachedChart();
      addName(p, 'quorvelline');
      expect(onDisk('quorvelline'), isTrue);
      now = now.add(const Duration(hours: 25));
      store.purge();
      expect(onDisk('quorvelline'), isFalse);
    });
  });

  test('a legal name rests only in its chart’s fields and the person’s own unsynced work (D40)', () {
    const legal = {'given': 'Ysolde', 'family': 'Varrowick'};

    /// Every table, shadow tables included, whose text holds either part of the name.
    Set<String> holding() {
      final found = <String>{};
      for (final t in db.db.select("SELECT name FROM sqlite_master WHERE type = 'table'")) {
        final table = t['name'] as String;
        for (final row in db.db.select('SELECT * FROM "$table"')) {
          for (final v in row.values) {
            final text = v is String ? v : (v is Uint8List ? String.fromCharCodes(v) : null);
            if (text != null && RegExp('ysolde|varrowick|olde|rowi', caseSensitive: false).hasMatch(text)) {
              found.add(table);
            }
          }
        }
      }
      return found;
    }

    final p = store.createRecord(entityPatient, intake(legalName: legal));
    addName(p, 'del', origin: 'local');
    expect(holding(), {'outbox', 'fields'});
    store.confirm(createOf(p), serverVersion: 1, details: const {'possibleDuplicate': true});
    expect(holding(), {'fields'});
    now = now.add(const Duration(hours: 25));
    store.purge();
    expect(holding(), isEmpty);

    final chart = cachedChart(legalName: legal);
    expect(holding(), {'fields'});
    store.setField(chart, 'usualArea', 'Demo: depot');
    store.clearServerData();
    expect(holding(), {'fields'});
    confirmAll();
    store.clearServerData();
    expect(holding(), isEmpty);
  });

  group('transactions', () {
    late String conflictId;
    setUp(() {
      final enc = store.createEncounter(kind: 'medical');
      confirmAll();
      store.setField(enc, 'location', {'lat': 1.0, 'lng': 2.0});
      store.conflict(store.outbox().single, const ServerField(value: {'lat': 3, 'lng': 4}, version: 2));
      conflictId = store.outbox().single.changeId;
    });
    void searchAndChoose({bool fail = false}) => store.transaction(() {
      store.appendAudit(
        'patient.searched',
        patientIds: [uuid(), uuid()],
        resultCount: 2,
        criteria: const ['name'],
        source: 'team_index',
      );
      store.resolveConflict(conflictId, keepMine: true);
      if (fail) throw StateError('the screen went away');
    });

    test('an audit entry and a conflict choice made inside one transaction commit together', () {
      searchAndChoose();
      expect(store.outbox().map((e) => (e.entity, e.state)), [
        (entityEncounter, ChangeState.superseded),
        (entityAudit, ChangeState.pending),
        (entityEncounter, ChangeState.pending),
      ]);
    });

    test('a throw after them rolls both back, and a caught throw undoes only its own part', () {
      expect(() => searchAndChoose(fail: true), throwsStateError);
      expect(store.outbox().map((e) => (e.entity, e.state)), [(entityEncounter, ChangeState.conflict)]);
      store.transaction(() {
        store.appendAudit('patient.viewed', patientId: uuid());
        try {
          store.transaction(() {
            store.appendAudit('patient.viewed', patientId: uuid());
            throw StateError('inner');
          });
        } on StateError {
          // The inner part is gone; the outer goes on.
        }
      });
      expect(store.outbox().where((e) => e.entity == entityAudit), hasLength(1));
      // The connection is usable afterwards: no transaction was left open.
      expect(db.db.autocommit, isTrue);
    });

    test('the audit mirror refuses what the API would: 51 patients, unknown criteria', () {
      expect(
        () => store.appendAudit('patient.searched', patientIds: [for (var i = 0; i < 51; i++) uuid()]),
        throwsArgumentError,
      );
      expect(() => store.appendAudit('patient.searched', criteria: const ['name', 'smell']), throwsArgumentError);
      store.appendAudit('patient.searched', patientIds: [for (var i = 0; i < 50; i++) uuid()], resultCount: 55);
      store.appendAudit('patient.match_checked', checkId: uuid(), source: 'local');
      store.appendAudit('id_link.copied', entity: 'id_link', entityId: uuid());
      expect(store.unsynced().counts['activity'], 3);
    });
  });

  test('a chart record downloaded closed belongs to its patient and takes the server’s state', () {
    final p = cachedChart();
    final alias = store.recordIdsOfPatient(p).last;
    store.importServerRecord(
      ServerRecord(
        entity: entityAlias,
        id: alias,
        status: 'removed',
        authorUserId: userId,
        attributes: {'patientId': p, 'alias': 'Zed'},
        fields: const {
          'removal': ServerField(value: {'reason': 'Wrong patient'}, version: 1),
        },
      ),
      open: false,
    );
    final rec = store.record(alias)!;
    expect([rec.patientId, rec.status, rec.open, rec.origin], [p, 'removed', false, 'server']);
  });
}
