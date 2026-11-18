import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'fake_server.dart';
import 'test_note_types.dart';

/// The fake's patient read routes (design 3.1, 6, 7: services/api/src/patients/{team-index,
/// charts,search,match}.ts), decoded by the generated client as the phone will read them; and the
/// sync read of a note and what hangs off it (phase 4 lifecycle 4.9 rule 16), each case named after
/// the test in services/api/test/sync-reads.test.ts that holds the same rule.
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

    test('a Not sure pair shows in the index without its note; the chart keeps the note', () async {
      // Review finding P7: the note is free text, which can hold a legal name (D40).
      final p = chart();
      final other = server.seedPatient(preferredName: 'Demo Wren');
      server.pairs.add(
        FakePair('f1000000-0000-4000-8000-000000000001', p, other, 0.9, ['staff'])
          ..status = 'not_sure'
          ..note = 'Demo: Ysolde, check the card',
      );
      final raw = await server.handle(alex, team, 'POST', '/v1/patients/index', const <String, Object?>{});
      expect(jsonEncode(raw), isNot(contains('check the card')));
      // IndexDuplicateHint: the status, and nothing else.
      final entries = ((raw! as Map<String, Object?>)['entries']! as List<Object?>).cast<Map<String, Object?>>();
      expect(entries.firstWhere((e) => e['patientId'] == p)['duplicate'], {'status': 'not_sure'});
      final index = await api.downloadTeamIndex(body: const TeamIndexRequest());
      expect(index.entries.firstWhere((e) => e.patientId == p).duplicate?.status, DuplicateHintStatus.notSure);
      final open = await api.getPatient(patientId: p);
      expect(open.duplicate?.note, 'Demo: Ysolde, check the card');
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
      // The chart, and the card link it carries (design 10.6).
      expect(server.serverAudit.map((a) => (a['action'], (a['details']! as Map)['source'])), [
        ('patient.viewed', 'cache'),
        ('id_link.viewed', 'cache'),
      ]);
      expect((server.serverAudit.last['details']! as Map)['tokenRef'], idLinkTokenRef('EEEEEEEEEEEEEEEEEEEEEE'));
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
      // Without a link to show, no link was read.
      expect(server.serverAudit.where((a) => a['action'] == 'id_link.viewed'), hasLength(1));
      await api.getPatient(patientId: p);
      expect(server.serverAudit.last['action'], 'patient.viewed');
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

  // Rule 16: services/api/test/sync-reads.test.ts. Alex (Ana there) is an attending and the author;
  // Ben holds no credential; Sky is a student; Dee has a custom role with patients.view and
  // encounters.chart only; Eli encounters.chart alone; the admin holds every key and no credential.
  group('phase 4: who may read what in a note (lifecycle 4.4, 6.4)', () {
    const ben = 'b0000000-0000-4000-8000-0000000000be';
    const sky = 'c0000000-0000-4000-8000-0000000000c5';
    const dee = 'd0000000-0000-4000-8000-0000000000de';
    const eli = 'e0000000-0000-4000-8000-0000000000e1';
    const admin = 'ad000000-0000-4000-8000-0000000000ad';
    const chw = 'c0000000-0000-4000-8000-0000000000c0';
    const e1 = 'e0000001';
    const e2 = 'e0000002';
    const at = '2026-10-20T14:50:00Z';
    const answers = <String, Object?>{
      'general.notes': 'Demo: walked over from the shelter',
      'exam.findings': 'Demo: no lesions seen',
      'moud.dose': 'Demo: 8 mg',
      'meds.given': 'Demo: none today',
      'systems.seen': ['heart', 'gu'],
      // A diagnosis whose code is on the sensitive list, and one whose code is not.
      'dx.$e1.entryAt': at,
      'dx.$e1.diagnosis.code': 'F11.20',
      'dx.$e1.diagnosis.label': 'Demo: opioid use',
      'dx.$e1.note': 'Demo: talk again next week',
      'dx.$e2.entryAt': at,
      'dx.$e2.diagnosis.code': 'J02.9',
      'dx.$e2.diagnosis.label': 'Demo: sore throat',
    };
    final all = [for (final path in answers.keys) 'data.$path']..sort();
    List<String> without(List<String> gone) => [
      for (final field in all)
        if (!gone.any((g) => field == 'data.$g' || field.startsWith('data.$g.'))) field,
    ];
    late String patient;

    setUp(() {
      for (final d in [...restrictedNoteTypes, redFlagsNoteType]) {
        server.noteTypes[(d['key']! as String, d['version']! as int)] = d;
      }
      patient = server.seedPatient();
      server.credentials
        ..[ben] = 'none'
        ..[sky] = 'student'
        ..[dee] = 'none'
        ..[eli] = 'none'
        ..[admin] = 'none'
        ..[chw] = 'chw';
      server.permissions
        ..[dee] = {'patients.view', 'encounters.chart'}
        ..[eli] = {'encounters.chart'}
        ..[admin] = {
          ...FakeSyncServer.healthcareStaff,
          'patients.view_sensitive_exams',
          'patients.correct_identity',
          'billing.view_codes',
        }
        ..[chw] = FakeSyncServer.chw;
    });

    String visit({String by = alex}) => server.seed(entityEncounter, {'kind': 'medical', 'patientId': patient}, by: by);
    String noteOn(String encounterId, TestNoteType type, Map<String, Object?> data, {String by = alex}) => server.seed(
      entityNote,
      {'encounterId': encounterId, 'noteTypeKey': type.key, 'noteTypeVersion': type.version, 'data': data},
      by: by,
    );
    Future<FetchRecordsResult> read(String user, List<(String, String)> refs) =>
        SineobexApi(server.transportFor(user, team)).fetchRecords(
          body: FetchRecords(
            records: [for (final (entity, id) in refs) RecordRef(entity: RecordEntity.fromJson(entity), id: id)],
          ),
        );
    Future<RecordSnapshot> noteAs(String user, String note) async =>
        (await read(user, [(entityNote, note)])).records.single;
    List<String> answerFields(RecordSnapshot s) => [
      for (final f in s.fields.keys)
        if (f.startsWith('data.')) f,
    ]..sort();

    /// A sign-off made by [by] on the note as they hold it, seeded as their phone would send it.
    String finish(String note, String act, {String by = alex, Map<String, Object?>? held}) {
      final n = server.records[note]!;
      final visit = server.records[n.attributes['encounterId']]!;
      return server.seed(entitySignoff, {
        'noteId': note,
        'act': act,
        'contentHash': noteContentHash(
          noteId: note,
          encounterId: visit.id,
          patientId: visit.fields['patientId']?.value as String?,
          summary: visit.fields['summary']?.value as String?,
          definition: NoteTypeDef.fromJson(
            server.noteTypes[(n.attributes['noteTypeKey'], n.attributes['noteTypeVersion'])]!,
          ),
          answers:
              held ??
              {
                for (final MapEntry(:key, :value) in n.fields.entries)
                  if (key.startsWith('data.')) key.substring(5): value.value,
              },
        ),
        'claimedCredential': act == 'sign' ? server.credentialOf(by) : null,
        'statementVersion': act == 'sign' ? 'sign-2026-11' : 'complete-2026-11',
      }, by: by);
    }

    test(
      'a teammate’s copy lists only the answers they may see: one they may not leaves no value, version or mark',
      () async {
        final n = noteOn(visit(), testRestricted, answers);
        // Whoever acts as the author reads all of it.
        expect(answerFields(await noteAs(alex, n)), all);
        // No key for sensitive exams, and no treatment record without a credential that charts
        // Medical. The picker keeps what it may show, at the answer's version.
        final bens = await noteAs(ben, n);
        expect(answerFields(bens), without(['exam', 'moud']));
        final seen = bens.fields['data.systems.seen']!;
        expect(
          [seen.value, seen.version, seen.changedBy, seen.changedAt],
          [
            ['heart'],
            1,
            alex,
            isNotNull,
          ],
        );
        // A section an ordering credential changes is read by everyone (6.4, rule 5).
        expect(bens.fields['data.meds.given']!.value, answers['meds.given']);
        expect(bens.status, 'draft');
        // A student charts Medical: the treatment record, not the exam.
        expect(answerFields(await noteAs(sky, n)), without(['exam']));
        // The Program Admin holds every key and no clinical credential: the exam, not the treatment record.
        final admins = await noteAs(admin, n);
        expect(answerFields(admins), without(['moud']));
        expect(admins.fields['data.systems.seen']!.value, ['heart', 'gu']);
        // Without patients.view_sensitive a sensitive diagnosis takes its whole entry with it.
        expect(answerFields(await noteAs(dee, n)), without(['exam', 'moud', 'dx.$e1']));
      },
    );

    test(
      'a teammate’s copy is versioned and dated by what it shows: a change only to a hidden answer moves neither',
      () async {
        final n = noteOn(visit(), testRestricted, answers);
        Future<(int, String)> stamp(String user) async {
          final s = await noteAs(user, n);
          return (s.version, s.updatedAt.toUtc().toIso8601String());
        }

        // As a set by the author writes them: the answer at its next version, by Alex, at its time.
        void write(String path, Object? value, String at) =>
            server.records[n]!.fields['data.$path'] = FakeField(value, 2, alex, at, 'c-$path');
        final before = await stamp(ben);
        // Alex edits only the exam, which Ben may not see (RD-6): his copy has no mark that it changed.
        final later = now.add(const Duration(minutes: 5));
        write('exam.findings', 'Demo: a small rash', later.toIso8601String());
        expect(await stamp(ben), before);
        // A change Ben is shown moves both: to that field's version and time, which his copy shows.
        final shown = now.add(const Duration(minutes: 10)).toIso8601String();
        write('general.notes', 'Demo: came by bus', shown);
        expect(await stamp(ben), (2, shown));
      },
    );

    test('the author’s own draft is sent whole, hidden answers included; everyone else, and a finished note, gets what counts', () async {
      final held = <String, Object?>{
        'care.plan': 'Demo: rest and fluids',
        'care.followup': '',
        'more.none': true,
        // Hidden while more.none is ticked: kept, and shown again once it is not.
        'more.detail': 'Demo: kept for later',
      };
      final n = noteOn(visit(), testNote, held);
      final own = await noteAs(alex, n);
      expect(answerFields(own), ['data.care.followup', 'data.care.plan', 'data.more.detail', 'data.more.none']);
      expect(
        [own.fields['data.more.detail']!.value, own.fields['data.more.detail']!.version],
        ['Demo: kept for later', 1],
      );
      // A blank is no answer, and a hidden one does not count.
      expect(answerFields(await noteAs(ben, n)), ['data.care.plan', 'data.more.none']);
      finish(n, 'complete', held: held);
      expect(answerFields(await noteAs(alex, n)), ['data.care.plan', 'data.more.none']);
    });

    test('whoever acts as the author once a note is assigned reads and sets its hidden answers; the first author no longer does', () async {
      // The set is held in fake_parity_test.dart; here, the read (review finding RD-9).
      server.credentials[alex] = 'attending';
      server.permissions[alex] = FakeSyncServer.healthcareStaff;
      final n = noteOn(visit(), testRestricted, answers);
      expect(answerFields(await noteAs(alex, n)), all);
      expect(answerFields(await noteAs(ben, n)), without(['exam', 'moud']));
      server.records[n]!.assignedTo = ben;
      expect(answerFields(await noteAs(ben, n)), all);
      expect(answerFields(await noteAs(alex, n)), without(['exam']));
    });

    test('a note the reader may not read is missing, like one the team does not have', () async {
      final v = visit();
      final talk = noteOn(v, testSensitive, const {'talk.notes': 'Demo: talked about sleep'});
      final medical = noteOn(v, testMedical, const {'care.plan': 'Demo: fluids'});
      final both = [(entityNote, talk), (entityNote, medical)];
      expect((await read(ben, both)).records.map((r) => r.id), [talk, medical]);
      // A sensitive note type needs patients.view_sensitive.
      final dees = await read(dee, both);
      expect(
        [dees.records.map((r) => r.id), dees.missing.map((r) => r.id)],
        [
          [medical],
          [talk],
        ],
      );
      // A Medical note needs patients.view, as the problem list does (D37).
      final elis = await read(eli, both);
      expect(
        [elis.records, elis.missing.map((r) => r.id)],
        [
          isEmpty,
          [talk, medical],
        ],
      );
      // The community health worker preset charts nothing, so reads no note at all.
      await expectLater(read(chw, both), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)));
    });

    test('a note whose definition the server cannot read is missing: what it would hide cannot be told', () async {
      final v = visit();
      // A note naming a version the team does not hold, from before any check: none can be made now.
      final stray = noteOn(v, testNote, const {});
      server.records[stray]!.attributes['noteTypeVersion'] = 9;
      // A definition the interpreter throws on: two fields that each show only while the other is filled.
      server.noteTypes[('test_looped_read', 1)] = {
        ...testNoteTypes.first,
        'key': 'test_looped_read',
        'sections': [
          {
            'id': 'loop',
            'title': 'Loop',
            'fields': [
              for (final (field, other) in [('a', 'b'), ('b', 'a')])
                {
                  'id': field,
                  'kind': 'text',
                  'label': field.toUpperCase(),
                  'lines': 'one',
                  'maxLength': 200,
                  'showWhen': {'field': 'loop.$other', 'filled': true},
                },
            ],
          },
        ],
      };
      final loop = server.seed(entityNote, {
        'encounterId': v,
        'noteTypeKey': 'test_looped_read',
        'noteTypeVersion': 1,
      }, by: alex);
      server.serverEdit(loop, 'data.loop.a', 'Demo: round and round', by: alex);
      final refs = [(entityNote, stray), (entityNote, loop)];
      final bens = await read(ben, refs);
      expect(
        [bens.records, bens.missing.map((r) => r.id)],
        [
          isEmpty,
          [stray, loop],
        ],
      );
      // Its author's draft is sent as stored, which reads no definition; one the team lacks is missing.
      final alexs = await read(alex, refs);
      expect(
        [alexs.records.map((r) => r.id), alexs.missing.map((r) => r.id)],
        [
          [loop],
          [stray],
        ],
      );
    });

    test('a note’s snapshot shows its state: attestation, who acts as its author, when it was finished and the signature it names', () async {
      const res = 'f0000000-0000-4000-8000-0000000000f5';
      server.credentials[res] = 'resident';
      server.names[res] = 'Res (demo)';
      final v = visit(by: res);
      final flags = noteOn(v, testRedFlags, const {'flags.any': 'no'}, by: res);
      expect((await noteAs(res, flags)).attributes, {
        'encounterId': v,
        'noteTypeKey': 'test_red_flags',
        'noteTypeVersion': 1,
        'createdAt': now.toIso8601String(),
        'attestation': 'not_needed',
        'actingAuthorId': res,
        'actingAuthorName': 'Res (demo)',
        'everSigned': false,
        'completedAt': null,
        'signoffId': null,
      });
      final signoff = finish(flags, 'sign', by: res);
      final signed = await noteAs(res, flags);
      expect(signed.status, 'signed');
      expect(signed.attributes, {
        'encounterId': v,
        'noteTypeKey': 'test_red_flags',
        'noteTypeVersion': 1,
        'createdAt': now.toIso8601String(),
        'attestation': 'waiting',
        'actingAuthorId': res,
        'actingAuthorName': 'Res (demo)',
        'everSigned': true,
        'completedAt': server.records[flags]!.completedAt,
        'signoffId': signoff,
      });
      expect(server.records[flags]!.completedAt, isNotNull);
      // Signed once and no longer (a student's correction of a co-signed note, 3.6): the phone must
      // not offer the reopen the server keeps in history.
      server.records[flags]!
        ..signoffId = null
        ..attestation = 'not_needed';
      server.finishNote(flags, status: 'completed');
      expect(
        (await noteAs(res, flags)).attributes,
        allOf(containsPair('everSigned', true), containsPair('signoffId', null)),
      );
      // Assigned by an admin once the author has left (3.8): the assignee acts as the author.
      server.records[flags]!.assignedTo = alex;
      server.names[alex] = 'Alex (demo)';
      expect(
        (await noteAs(alex, flags)).attributes,
        allOf(containsPair('actingAuthorId', alex), containsPair('actingAuthorName', 'Alex (demo)')),
      );
    });

    test('a note’s snapshot says when the server made it, the order the visit read gives a visit’s notes in', () async {
      // The phone keeps a record's attributes and not the snapshot's own times, so a visit's notes
      // read offline are put in the server's order by this (D108). The fake serves no visit read:
      // the API's test holds that read's order to the same time.
      final v = visit();
      // Written on the phone an hour before it reached the server: the server's time, not the phone's.
      final first = server.seed(
        entityNote,
        {
          'encounterId': v,
          'noteTypeKey': testNote.key,
          'noteTypeVersion': testNote.version,
          'data': const {'care.plan': 'Demo: socks'},
        },
        by: ben,
        at: now.subtract(const Duration(hours: 1)),
      );
      final later = now.add(const Duration(minutes: 1));
      server.now = () => later;
      final second = noteOn(v, testNote, const {'care.plan': 'Demo: water'});
      final snapshots = (await read(alex, [(entityNote, second), (entityNote, first)])).records;
      expect(
        [for (final s in snapshots) (s.id, s.attributes['createdAt'])],
        [(second, later.toIso8601String()), (first, now.toIso8601String())],
      );
      // Dated the same for a reader shown less of it.
      expect((await noteAs(dee, first)).attributes['createdAt'], now.toIso8601String());
    });

    test(
      'a visit’s snapshot says whether a note the reader is shown is finished, as the envelope lock reads it',
      () async {
        // Review finding SLK-1, worked out over the notes the reader is shown (LRD-2).
        final v = visit();
        Future<RecordSnapshot> visitAs(String user) async => (await read(user, [(entityEncounter, v)])).records.single;
        final talk = noteOn(v, testSensitive, const {'talk.notes': 'Demo: talked about sleep'});
        expect((await visitAs(alex)).attributes, containsPair('hasFinishedNote', false));
        finish(talk, 'complete');
        expect(
          [(await visitAs(alex)).status, (await visitAs(alex)).attributes['hasFinishedNote']],
          ['completed', true],
        );
        // A teammate's draft beside it: the visit is a draft, its envelope locked all the same.
        noteOn(v, testNote, const {'care.plan': 'Demo: housing list'}, by: ben);
        expect([(await visitAs(alex)).status, (await visitAs(alex)).attributes['hasFinishedNote']], ['draft', true]);
        // Dee may not read the sensitive note: nothing says it is there.
        expect([(await visitAs(dee)).status, (await visitAs(dee)).attributes['hasFinishedNote']], ['draft', false]);
      },
    );

    group('what hangs off a note, and referrals (6.4 rule 7)', () {
      String correctionOf(String note, String path, Object? newValue, [int baseVersion = 1, String by = alex]) =>
          server.seed(entityCorrection, {
            'noteId': note,
            'changes': [
              {'field': 'data.$path', 'newValue': newValue, 'baseVersion': baseVersion},
            ],
            'reason': 'Demo: the wrong field was picked',
            'requestedByPatient': false,
            'declined': false,
            'claimedCredential': null,
            'signoffId': null,
          }, by: by);

      test('a note names who acts as its author by their name now; a sign-off its signer and a correction its corrector by theirs then; none goes to a reader the record is not shown', () async {
        // The phone shows who wrote, signed and corrected a note (lifecycle 9.4, 9.6, 9.7), and the
        // sync read gave only their IDs (D108). Kept as they were then where the record keeps it,
        // as an addendum's author is; staff names, not patient details.
        const lou = 'f0000000-0000-4000-8000-0000000001a0';
        server.names[lou] = 'Lou (demo)';
        final v = visit(by: lou);
        final n = noteOn(v, testNote, const {'care.plan': 'Demo: socks and water'}, by: lou);
        final signoff = finish(n, 'complete', by: lou);
        final correction = correctionOf(n, 'care.plan', 'Demo: socks, water and a blanket', 1, lou);
        expect(server.records[correction]!.status, 'corrected');
        final refs = [(entityNote, n), (entitySignoff, signoff), (entityCorrection, correction)];
        Future<List<List<Object?>>> named(String user) async => [
          for (final r in (await read(user, refs)).records)
            [
              r.entity.toJson(),
              r.entity == RecordEntity.encounterNote ? r.attributes['actingAuthorId'] : r.authorUserId,
              r.attributes['actingAuthorName'] ?? r.attributes['signerName'] ?? r.attributes['correctorName'],
            ],
        ];
        expect(await named(ben), [
          [entityNote, lou, 'Lou (demo)'],
          [entitySignoff, lou, 'Lou (demo)'],
          [entityCorrection, lou, 'Lou (demo)'],
        ]);

        // Renamed since: the note follows who acts as its author now; what they signed and corrected
        // keeps the name they did it under.
        server.names[lou] = 'Lou Rowe (demo)';
        expect(await named(ben), [
          [entityNote, lou, 'Lou Rowe (demo)'],
          [entitySignoff, lou, 'Lou (demo)'],
          [entityCorrection, lou, 'Lou (demo)'],
        ]);
        // Assigned once the author has left (3.8): the assignee is named.
        server.records[n]!.assignedTo = alex;
        server.names[alex] = 'Alex (demo)';
        expect((await named(ben)).first, [entityNote, alex, 'Alex (demo)']);

        // A note the reader may not read is missing with what hangs off it, and so are their names.
        final talk = noteOn(v, testSensitive, const {'talk.notes': 'Demo: talked about sleep'}, by: lou);
        final talkSignoff = finish(talk, 'complete', by: lou);
        final talkFix = correctionOf(talk, 'talk.notes', 'Demo: talked about sleep and food', 1, lou);
        expect(server.records[talkFix]!.status, 'corrected');
        final hidden = await server.handle(dee, team, 'POST', '/v1/sync/records', {
          'records': [
            {'entity': entityNote, 'id': talk},
            {'entity': entitySignoff, 'id': talkSignoff},
            {'entity': entityCorrection, 'id': talkFix},
          ],
        });
        expect((hidden! as Map<String, Object?>)['records'], isEmpty);
        expect(jsonEncode(hidden), isNot(contains('Lou')));
      });

      test(
        'a Medical visit’s summary and its own addenda are Medical content: read with patients.view, as its notes are',
        () async {
          // Eli charts but has no patients.view, so every Medical note is missing for him (RD-7).
          ({String visit, String addendum}) visitWith(String kind, String summary) {
            final v = server.seed(entityEncounter, {'kind': kind, 'patientId': patient}, by: alex);
            server.records[v]!.fields['summary'] = FakeField(summary, 1, alex, at, 'c-summary-$kind');
            final addendum = server.seed(entityAddendum, {
              'encounterId': v,
              'noteId': null,
              'text': 'Demo: called back',
              'signoffId': null,
            }, by: alex);
            return (visit: v, addendum: addendum);
          }

          final medical = visitWith('medical', 'Demo: likely pneumonia; started antibiotics');
          final outreach = visitWith('non_medical', 'Demo: dropped off socks');
          // Eli: the visit without its summary, and no addendum to it.
          final elis = await read(eli, [(entityEncounter, medical.visit), (entityAddendum, medical.addendum)]);
          expect([for (final r in elis.records) r.id], [medical.visit]);
          expect([for (final m in elis.missing) m.id], [medical.addendum]);
          expect(elis.records.single.fields.keys.toList()..sort(), ['kind', 'location', 'locationText', 'patientId']);
          // A Non-Medical visit is his to read whole.
          final plain = await read(eli, [(entityEncounter, outreach.visit), (entityAddendum, outreach.addendum)]);
          expect([for (final r in plain.records) r.id], [outreach.visit, outreach.addendum]);
          expect(plain.records.first.fields['summary']!.value, 'Demo: dropped off socks');
          // Ben reads Medical notes, and so the Medical visit whole.
          final bens = await read(ben, [(entityEncounter, medical.visit), (entityAddendum, medical.addendum)]);
          expect([for (final r in bens.records) r.id], [medical.visit, medical.addendum]);
          expect(bens.records.first.fields['summary']!.value, 'Demo: likely pneumonia; started antibiotics');
        },
      );

      test('a sign-off, an addendum and a correction are read by whoever may read their note; a referral with patients.view', () async {
        final v = visit();
        final talk = noteOn(v, testSensitive, const {'talk.notes': 'Demo: talked about sleep'});
        final signoff = finish(talk, 'complete');
        final addendum = server.seed(entityAddendum, {
          'encounterId': v,
          'noteId': talk,
          'text': 'Demo: called back',
          'signoffId': null,
        }, by: alex);
        final onVisit = server.seed(entityAddendum, {
          'encounterId': v,
          'noteId': null,
          'text': 'Demo: the van ran late',
          'signoffId': null,
        }, by: alex);
        final correction = correctionOf(talk, 'talk.notes', 'Demo: talked about sleep and food');
        expect(server.records[correction]!.status, 'corrected');
        final referral = server.seed(entityReferral, {
          'patientId': patient,
          'referredOn': '2026-10-20',
          'details': 'Demo: dental clinic on Main St',
          'encounterId': v,
        }, by: alex);
        final offNote = [(entitySignoff, signoff), (entityAddendum, addendum), (entityCorrection, correction)];
        final refs = [...offNote, (entityAddendum, onVisit)];
        server.serverAudit.clear();
        expect((await read(ben, refs)).records.map((r) => r.id), [for (final (_, id) in refs) id]);
        expect(
          [
            for (final a in server.serverAudit) [a['action'], a['patientId']],
          ],
          [
            for (final _ in refs) ['note.viewed', patient],
          ],
        );
        // Without patients.view_sensitive the note is not read, and nothing that hangs off it; an
        // addendum to the visit itself is read with the visit.
        final dees = await read(dee, refs);
        expect(
          [dees.records.map((r) => r.id), dees.missing.map((r) => r.id)],
          [
            [onVisit],
            [for (final (_, id) in offNote) id],
          ],
        );
        // A sign-off, an addendum and a correction need encounters.chart, as their note does.
        for (final ref in refs) {
          await expectLater(read(chw, [ref]), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)));
        }
        // A referral is a patient's record: read with patients.view, logged as a view of the patient.
        server.serverAudit.clear();
        expect((await read(chw, [(entityReferral, referral)])).records.map((r) => r.id), [referral]);
        expect(
          [
            for (final a in server.serverAudit) [a['action'], a['patientId']],
          ],
          [
            ['patient.viewed', patient],
          ],
        );
        await expectLater(
          read(eli, [(entityReferral, referral)]),
          throwsA(isA<ApiException>().having((e) => e.status, 'status', 403)),
        );
      });

      test('a sign-off’s content hash goes only to whoever acts as the author, its signer, and a reader who sees every answer of any note', () async {
        const wes = 'f0000000-0000-4000-8000-0000000000e5';
        server.credentials[wes] = 'attending';
        server.permissions[wes] = {
          'patients.view',
          'encounters.chart',
          'patients.view_sensitive',
          'patients.view_sensitive_exams',
        };
        final v = visit();
        // One note with a GU exam, one with none: whether a reader gets the hash says nothing of which.
        final gu = noteOn(v, testRestricted, const {
          'general.notes': 'Demo: walked over',
          'systems.seen': ['heart', 'gu'],
        });
        final plain = noteOn(v, testRestricted, const {
          'general.notes': 'Demo: walked over',
          'systems.seen': ['heart'],
        });
        final signoffs = [finish(gu, 'complete'), finish(plain, 'complete')];
        final refs = [for (final s in signoffs) (entitySignoff, s)];
        Future<List<Object?>> hashes(String user) async => [
          for (final r in (await read(user, refs)).records) r.attributes['contentHash'],
        ];
        final signed = [for (final s in signoffs) server.records[s]!.attributes['contentHash']];
        expect(signed, everyElement(isNotNull));
        expect(await hashes(alex), signed);
        expect(await hashes(wes), signed);
        // Shown [heart] on both, Ben could hash each guess of what is hidden against it.
        expect(await hashes(ben), [null, null]);
        expect(await hashes(dee), [null, null]);
        // The admin holds every key and no credential that charts Medical: a treatment record is hidden.
        expect(await hashes(admin), [null, null]);
        // The rest of the sign-off is read as it was.
        expect(
          [
            for (final r in (await read(ben, refs)).records) [r.id, r.attributes['effect'], r.attributes['act']],
          ],
          [
            for (final s in signoffs) [s, 'completed', 'complete'],
          ],
        );
        // Its signer reads it whole, whoever acts as the author now (3.8).
        server.records[gu]!.assignedTo = sky;
        expect((await hashes(alex)).first, signed.first);
        expect((await hashes(sky)).first, signed.first);
      });

      // encounters-read.test.ts, 'nor in the sync read, for an author whose role charts but no longer
      // reads Medical notes' (review finding LRD-5): the hash covers the summary withheld from them.
      test('no sign-off’s hash over a visit’s summary the reader may not read, their own included', () async {
        final n = noteOn(visit(), testRestricted, const {'general.notes': 'Demo: walked over'});
        final refs = [(entitySignoff, finish(n, 'complete'))];
        Future<List<Object?>> hashes() async => [
          for (final r in (await read(alex, refs)).records) r.attributes['contentHash'],
        ];
        expect(await hashes(), [isNotNull]);
        server.permissions[alex] = {'encounters.chart'};
        expect(await hashes(), [null]);
      });

      test(
        'a correction is missing for a reader who may not see an answer it changes, in its old value or its new',
        () async {
          final n = noteOn(visit(), testRestricted, answers);
          finish(n, 'complete');
          final plain = correctionOf(n, 'general.notes', 'Demo: walked over from the park');
          final exam = correctionOf(n, 'exam.findings', 'Demo: a small rash');
          // Takes GU away: the new value shows nothing sensitive, the old one does.
          final picker = correctionOf(n, 'systems.seen', ['heart']);
          final dx = correctionOf(n, 'dx.$e1.note', 'Demo: talk again in two weeks');
          // Puts it back: now the old value shows nothing sensitive, the new one does.
          final back = correctionOf(n, 'systems.seen', ['heart', 'gu'], 2);
          final made = [plain, exam, picker, dx, back];
          expect([for (final c in made) server.records[c]!.status], List.filled(5, 'corrected'));
          Future<List<String>> seen(String user) async => [
            for (final r in (await read(user, [for (final c in made) (entityCorrection, c)])).records) r.id,
          ];
          expect(await seen(alex), made);
          expect(await seen(admin), made);
          expect(await seen(ben), [plain, dx]);
          expect(await seen(dee), [plain]);
        },
      );
    });
  });

  group('field reviews and history (review finding P10: the routes the phone calls)', () {
    const blair = 'b0000000-0000-4000-8000-00000000000b';
    const admin = 'ad000000-0000-4000-8000-0000000000ad';
    var seq = 0;
    var ids = 0;
    String id() => 'e0e00000-0000-4000-8000-${(++ids).toString().padLeft(12, '0')}';

    setUp(() {
      seq = 0;
      server.permissions[admin] = {...FakeSyncServer.healthcareStaff, 'patients.correct_identity'};
    });

    /// A set pushed by [user] that never saw the chart's value (baseVersion 0).
    Future<Map<String, Object?>> unseen(
      String user,
      String recordId,
      String field,
      Object? value, {
      String entity = entityPatient,
    }) async {
      final device = 'dev-$user';
      await server.handle(user, team, 'POST', '/v1/devices', {
        'deviceId': device,
        'platform': 'android',
        'appVersion': 'test',
        'publicKey': 'key-$user',
      });
      final at = now.toIso8601String();
      final res = await server.handle(user, team, 'POST', '/v1/sync/push', {
        'deviceId': device,
        'clock': {'deviceTime': at},
        'unsynced': {'counts': <String, Object?>{}},
        'changes': [
          {
            'changeId': id(),
            'seq': ++seq,
            'entity': entity,
            'recordId': recordId,
            'op': 'set',
            'field': field,
            'value': value,
            'valueHash': valueHash(value),
            'baseVersion': 0,
            'deviceTime': at,
            'clockVerified': true,
          },
        ],
      }) as Map<String, Object?>;
      return (res['results']! as List<Object?>).single! as Map<String, Object?>;
    }

    Future<ApiException> refused(Future<Object?> call) async {
      try {
        await call;
      } on ApiException catch (e) {
        return e;
      }
      fail('expected a refusal');
    }

    SineobexApi as(String user) => SineobexApi(server.transportFor(user, team));

    test('a decision keeps an alternate as its author’s, approved by the reviewer, once', () async {
      final p = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
      final kept = await unseen(blair, p, 'usualArea', 'Demo: Oak Street lot');
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      final chart = await api.getPatient(patientId: p);
      final open = chart.reviews.single;
      expect([open.id, open.patientId, open.current.version], [reviewId, p, 1]);
      final alternate = open.alternates.single;

      final stale = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: DecideFieldReview(
            keep: DecideFieldReviewKeep.alternate,
            historyId: alternate.historyId,
            baseVersion: 0,
          ),
        ),
      );
      expect(
        [stale.status, stale.code, stale.details],
        [
          409,
          'field_changed',
          {'field': 'usualArea', 'version': 1},
        ],
      );
      final unreadable = await refused(
        server.handle(alex, team, 'POST', '/v1/team/field-reviews/$reviewId/decision', {
          'keep': 'alternate',
          'baseVersion': 1,
        }),
      );
      expect(
        [unreadable.status, (unreadable.details!['fields']! as List).single],
        [
          422,
          {'path': 'historyId', 'problem': 'custom'},
        ],
      );
      final notOne = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: const DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: '1', baseVersion: 1),
        ),
      );
      expect([notOne.status, notOne.code], [422, 'not_an_alternate']);

      final decided = await api.decideFieldReview(
        reviewId: reviewId,
        body: DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: alternate.historyId, baseVersion: 1),
      );
      expect(
        [decided.status, decided.patientId, decided.current.value, decided.current.version],
        [FieldReviewViewStatus.decided, p, 'Demo: Oak Street lot', 2],
      );
      expect([decided.current.changedBy, decided.currentBy?.userId, decided.patient], [blair, blair, null]);
      expect((await api.getPatient(patientId: p)).reviews, isEmpty);
      final again = await refused(
        api.decideFieldReview(
          reviewId: reviewId,
          body: const DecideFieldReview(keep: DecideFieldReviewKeep.current, baseVersion: 2),
        ),
      );
      expect([again.status, again.code], [409, 'already_decided']);
      final logged = server.serverAudit.where((a) => a['action'] == 'field_review.decided').single;
      expect(logged['patientId'], p);
      expect(logged['details'], {
        'reviewId': reviewId,
        'field': 'usualArea',
        'kept': 'alternate',
        'historyId': alternate.historyId,
        'version': 2,
      });

      final history = await api.getPatientHistory(patientId: p, field: 'usualArea');
      expect(history.entries.map((e) => (e.kind, e.version, e.changedBy.userId, e.approvedBy?.userId)), [
        (HistoryKind.reviewDecided, 2, blair, alex),
        (HistoryKind.keptBoth, 1, blair, null),
        (HistoryKind.created, 1, 'seed-user', null),
      ]);
      expect(history.entries.first.reviewId, reviewId);
    });

    test('a decision and the match check need patients.view too; a decision names who recorded the value', () async {
      // Review findings S5 (R2, 03b38d8) and W1 (R2, b99733e), mirrored.
      const editOnly = 'c0000000-0000-4000-8000-00000000000c';
      server.permissions[editOnly] = const {'patients.edit'};
      final p = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
      final kept = await unseen(blair, p, 'usualArea', 'Demo: Oak Street lot');
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      const body = {'keep': 'current', 'baseVersion': 1};
      final path = '/v1/team/field-reviews/$reviewId/decision';
      for (final call in [
        server.handle(editOnly, team, 'POST', path, body),
        server.handle(editOnly, team, 'POST', '/v1/patients/match', const {
          'preferredName': 'Demo',
          'surface': 'phone',
        }),
      ]) {
        final e = await refused(call);
        expect([e.status, e.code], [403, 'forbidden']);
      }
      expect(server.reviews[reviewId]!.status, 'open');

      // A chart's reviews are the chart's: no recorder there.
      final chart = await server.handle(alex, team, 'GET', '/v1/patients/$p', null) as Map<String, Object?>;
      expect((chart['reviews']! as List<Object?>).single, isNot(contains('currentBy')));
      final decided = await server.handle(alex, team, 'POST', path, body) as Map<String, Object?>;
      expect(decided['currentBy'], {'userId': 'seed-user', 'displayName': 'Demo user'});
      expect(FieldReviewView.fromJson(decided).status, FieldReviewViewStatus.decided);
    });

    test('a merge undo takes the merged record’s values out of the kept chart’s reviews and reopens its own', () async {
      // Review finding S1 (R2, 0ca21e5), mirrored for the merge and undo hooks.
      const casey = 'c0000000-0000-4000-8000-00000000000c';
      String reviewOf(Map<String, Object?> r) => (r['details']! as Map<String, Object?>)['reviewId']! as String;
      final kept = server.seedPatient(usualArea: 'Demo: Elm Street underpass');
      final merged = server.seedPatient(preferredName: 'Smit', usualArea: 'Demo: river path');
      final own = reviewOf(await unseen(blair, merged, 'usualArea', 'Demo: bus shelter'));
      final mergeId = server.merge(merged, kept);
      expect(server.reviews[own]!.status, 'obsolete');

      final area = reviewOf(await unseen(casey, kept, 'usualArea', 'Demo: Oak Street lot'));
      // Sent to the merged record, kept beside the kept chart's values.
      expect(reviewOf(await unseen(blair, merged, 'usualArea', 'Demo: south lot')), area);
      final name = reviewOf(await unseen(blair, merged, 'preferredName', 'Smitty'));
      final fromMerged = server.history.lastWhere((h) => h['value'] == 'Demo: south lot')['id']! as String;

      server.undoMerge(mergeId);
      final chart = await api.getPatient(patientId: kept);
      expect(chart.reviews.single.id, area);
      expect(chart.reviews.single.alternates.map((a) => a.value), ['Demo: Oak Street lot']);
      expect([server.reviews[name]!.status, server.reviews[own]!.status], ['obsolete', 'open']);
      final withdrawn = await refused(
        api.decideFieldReview(
          reviewId: area,
          body: DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: fromMerged, baseVersion: 1),
        ),
      );
      expect([withdrawn.status, withdrawn.code], [422, 'not_an_alternate']);
      expect((await api.getPatient(patientId: merged)).reviews.single.id, own);
    });

    test('legal name and birth: the review’s own permission, a recent sign-in and a comment', () async {
      final p = server.seedPatient(legalName: const {'given': 'Ysolde', 'family': null});
      final kept = await unseen(blair, p, 'legalName', const {'given': 'Ysolda', 'family': 'Varrowick'});
      final reviewId = (kept['details']! as Map<String, Object?>)['reviewId']! as String;
      final historyId = server.history.last['id']! as String;
      final body = DecideFieldReview(keep: DecideFieldReviewKeep.alternate, historyId: historyId, baseVersion: 1);

      final staff = await refused(api.decideFieldReview(reviewId: reviewId, body: body));
      expect([staff.status, staff.code], [403, 'forbidden']);
      server.staleSignIn.add(admin);
      final stale = await refused(as(admin).decideFieldReview(reviewId: reviewId, body: body));
      expect([stale.status, stale.code], [403, 'reauth_required']);
      server.staleSignIn.clear();
      final bare = await refused(as(admin).decideFieldReview(reviewId: reviewId, body: body));
      expect([bare.status, bare.code], [422, 'comment_required']);
      final missing = await refused(
        as(admin).decideFieldReview(reviewId: 'f0000000-0000-4000-8000-00000000000f', body: body),
      );
      expect([missing.status, missing.code], [404, 'not_found']);

      final decided = await as(admin).decideFieldReview(
        reviewId: reviewId,
        body: DecideFieldReview(
          keep: DecideFieldReviewKeep.alternate,
          historyId: historyId,
          baseVersion: 1,
          comment: '  Patient showed a card  ',
        ),
      );
      expect(decided.current.value, {'given': 'Ysolda', 'family': 'Varrowick'});
      final entry = (await as(admin).getPatientHistory(patientId: p, field: 'legalName')).entries.first;
      expect(
        [entry.kind, entry.approvedBy?.userId, entry.correctionId, entry.deviceTime],
        [HistoryKind.reviewDecided, admin, isNotNull, null],
      );
      final details =
          server.serverAudit.lastWhere((a) => a['action'] == 'field_review.decided')['details']!
              as Map<String, Object?>;
      expect(details['commentSha256'], hasLength(64));
      expect(details['correctionId'], entry.correctionId);
    });

    test(
      'history: the group’s records, problems with their permissions, never a card, newest first in pages',
      () async {
        final p = chart();
        final merged = server.seedPatient(preferredName: 'Smit');
        server.merge(merged, p);
        final allergy = server.records.values.singleWhere((r) => r.entity == entityAllergy).id;
        await unseen(blair, allergy, 'enteredInError', const {
          'reason': 'Demo: another patient',
        }, entity: entityAllergy);
        // Each is kept both on the survivor: 60 history rows of the group.
        for (var i = 0; i < 60; i++) {
          await unseen(blair, merged, 'preferredName', 'Smit $i');
        }
        final first = await api.getPatientHistory(patientId: merged);
        expect(first.entries, hasLength(FakeSyncServer.historyPage));
        final ids = [for (final e in first.entries) int.parse(e.id)];
        expect(ids, [...ids]..sort((a, b) => b.compareTo(a)));
        final rest = await api.getPatientHistory(patientId: p, afterId: first.nextAfterId);
        expect(rest.nextAfterId, isNull);
        final all = [...first.entries, ...rest.entries];
        // Both records' created fields, two problems, the allergy's retraction and the 60 kept.
        expect(all, hasLength(9 + 9 + 2 + 1 + 60));
        expect(all.map((e) => e.entity).toSet(), {entityPatient, entityAllergy, entityProblem});
        expect(all.where((e) => e.kind == HistoryKind.keptBoth).map((e) => e.recordId).toSet(), {p});
        expect(
          jsonEncode(await server.handle(alex, team, 'GET', '/v1/patients/$p/history', null)),
          isNot(contains('EEEE')),
        );
        final audited = server.serverAudit.where((a) => a['action'] == 'patient.history_viewed').toList();
        expect(audited.map((a) => a['patientId']).toSet(), {p});
        expect((audited.first['details']! as Map<String, Object?>)['count'], FakeSyncServer.historyPage);

        // A role without view_sensitive gets no sensitive problem; one without the problem list none.
        expect((await api.getPatientHistory(patientId: p, field: 'status')).entries, hasLength(2));
        server.permissions[alex] = FakeSyncServer.healthcareStaff.difference({'patients.view_sensitive'});
        var page = await api.getPatientHistory(patientId: p, field: 'status');
        expect(page.entries.map((e) => e.recordId).toSet(), hasLength(1));
        server.permissions[alex] = FakeSyncServer.chw;
        page = await api.getPatientHistory(patientId: p, field: 'status');
        expect(page.entries, isEmpty);
        server.permissions[alex] = const {'checkins.create'};
        expect((await refused(api.getPatientHistory(patientId: p))).status, 403);
        server.permissions.remove(alex);
        expect((await refused(api.getPatientHistory(patientId: 'f0000000-0000-4000-8000-00000000000f'))).status, 404);
      },
    );
  });
}

extension on FetchCharts {
  FetchCharts copyWithIds(List<String> ids) => FetchCharts(patientIds: ids, reason: reason);
}
