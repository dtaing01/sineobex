import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show HomeCounts, SineobexApi;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/notes_to_finish.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/local_store.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart';

/// Notes to finish on the phone (lifecycle 3.9, 5.6, 9.9; card L4-notes-to-finish): the person's own
/// drafts, worked out offline from what the phone holds, merged with the server's list of their
/// drafts when online; the list logged as it is read; and Home's tile counted from both without
/// naming a patient.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const elsewhere = 'e0000000-0000-4000-8000-000000000009';
  const remoteNote = 'f0000000-0000-4000-8000-000000000009';
  const remotePatient = 'e0000000-0000-4000-8000-000000000008';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;

  late FakeSyncServer server;
  late ScriptedApi api;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    server = FakeSyncServer(now: () => start);
    api = ScriptedApi();
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {
    for (final d in [...testNoteTypes, redFlagsNoteType])
      (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };
  final titles = {for (final d in definitions.values) d.key: d.title};

  NotesToFinish notes(TestPhone p, {Set<String> permissions = staff}) {
    final user = EncounterUser(
      userId: p.userId,
      displayName: 'Demo Charter',
      credential: 'attending',
      permissions: permissions,
    );
    return NotesToFinish(
      p.store,
      user: user,
      api: EncounterApi(
        SineobexApi(api),
        p.store,
        user: user,
        definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
      ),
      titleOf: (key) => titles[key],
      patientName: (id) => id == remotePatient ? 'Demo Remote' : null,
      now: () => p.wall,
    );
  }

  List<Map<String, Object?>> audits(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity == entityAudit) e.value! as Map<String, Object?>,
  ];

  String note(TestPhone p, String visit, [Map<String, Object?> data = const {}]) =>
      p.store.createNote(encounterId: visit, noteTypeKey: testNote.key, noteTypeVersion: testNote.version, data: data);

  void complete(TestPhone p, String noteId) => p.store.finishNotes(
    [
      NoteToFinish(
        noteId: noteId,
        shownHash: p.store.contentHashOf(noteId, definitions[(testNote.key, testNote.version)]!),
        act: SignoffAct.complete,
        statementVersion: 'complete-2026-11',
      ),
    ],
    signer: const Signer(credential: 'attending', canSign: true, needsAttestation: false),
    definitionOf: (key, version) => definitions[(key, version)],
  );

  /// A patient's chart on the phone, as a download leaves it: the preferred name the list shows.
  void chartOnPhone(TestPhone p, String patientId) => p.store.importServerRecord(
    ServerRecord(
      entity: entityPatient,
      id: patientId,
      status: 'active',
      authorUserId: blair,
      attributes: const {},
      fields: {'preferredName': const ServerField(value: 'Demo Patient', version: 1)},
    ),
    open: false,
  );

  group('the phone’s own drafts (lifecycle 3.9, 9.9)', () {
    test('each draft the person acts as the author of, not empty, not finished here; overdue after a day', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      chartOnPhone(p, patient);
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final draft = note(p, visit, {'vitals.pulse': 80});
      note(p, visit);
      final finished = note(p, visit, {'vitals.pulse': 90});
      complete(p, finished);

      // A teammate's draft the phone holds is theirs to finish, not the person's.
      final theirVisit = server.seed('encounter', {'kind': 'non_medical', 'patientId': patient}, by: blair);
      final theirs = server.seed('encounter_note', {
        'encounterId': theirVisit,
        'noteTypeKey': testNote.key,
        'noteTypeVersion': testNote.version,
        'data': {'vitals.pulse': 70},
      }, by: blair);
      expect(await p.engine.openServerRecord('encounter', theirVisit), isTrue);
      expect(await p.engine.openServerRecord('encounter_note', theirs), isTrue);

      final n = notes(p);
      final list = n.read();
      expect(list.online, isFalse);
      final row = list.rows.single;
      expect(
        [row.noteId, row.encounterId, row.patientId, row.patientName, row.noteTypeKey, row.title, row.onPhone],
        [draft, visit, patient, 'Demo Patient', testNote.key, titles[testNote.key], true],
      );
      expect([row.startedAt, row.overdue, row.notSynced, list.overdue], [start, false, true, 0]);
      expect(n.count(null), (notes: 1, overdue: 0));

      // A day later it is overdue (3.9): worked out when read, from when the visit started.
      p.advance(const Duration(hours: 24, minutes: 1));
      expect([n.read().rows.single.overdue, n.read().overdue], [true, 1]);
      expect(n.count(null), (notes: 1, overdue: 1));
    });

    test('the list is logged as it is read; Home’s count is not; nothing is read while frozen', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final first = note(p, visit, {'vitals.pulse': 80});
      final n = notes(p);
      n.count(null);
      expect(audits(p), isEmpty);
      final shown = n.read();
      expect(audits(p), [
        {
          'action': 'notes_to_finish.viewed',
          'patientIds': [patient],
          'resultCount': 1,
        },
      ]);

      // Read again as it is on screen: only what it adds is logged.
      n.read(shownBefore: {for (final r in shown.rows) r.noteId});
      expect(audits(p), hasLength(1));
      final other = server.seedPatient(preferredName: 'Demo Other');
      final second = note(p, p.store.createEncounter(kind: 'non_medical', patientId: other), {'vitals.pulse': 60});
      n.read(shownBefore: {first});
      expect(audits(p).last, {
        'action': 'notes_to_finish.viewed',
        'patientIds': [other],
        'resultCount': 1,
      });
      expect(n.read(shownBefore: {first, second}).rows, hasLength(2));
      expect(audits(p), hasLength(2));

      // A long list writes as many entries as it takes to name every patient.
      final many = [for (var i = 0; i < 50; i++) server.seedPatient(preferredName: 'Demo $i')];
      final added = [
        for (final m in many) note(p, p.store.createEncounter(kind: 'non_medical', patientId: m), {'vitals.pulse': 70}),
      ];
      n.read(shownBefore: {first});
      final entries = audits(p).skip(2).toList();
      expect([for (final e in entries) (e['patientIds']! as List).length], [50, 1]);
      expect([for (final e in entries) e['resultCount']], [51, 51]);
      expect({for (final e in entries) ...e['patientIds']! as List}, {other, ...many});
      expect(added, hasLength(50));

      p.store.freeze('Demo: handing over');
      final before = p.store.outbox().length;
      expect(() => n.read(), throwsA(isA<ChartingPaused>()));
      // Not even what is on screen already, which a read would not log again.
      expect(() => n.read(shownBefore: {first, second, ...added}), throwsA(isA<ChartingPaused>()));
      expect(() => n.count(null), throwsA(isA<ChartingPaused>()));
      await expectLater(n.open(), throwsA(isA<ChartingPaused>()));
      expect(p.store.outbox(), hasLength(before));
      expect(api.asked, isEmpty);
    });
  });

  group('merged with the server’s list (lifecycle 5.6, 9.9)', () {
    test('online, drafts not on this phone join the list; the server’s word on overdue wins', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      chartOnPhone(p, patient);
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final draft = note(p, visit, {'vitals.pulse': 80});
      final finished = note(p, visit, {'vitals.pulse': 90});
      await p.engine.syncAll(force: true);
      // Completed here and not sent yet: the server still has it as a draft.
      complete(p, finished);

      Map<String, Object?> row(String noteId, String encounterId, String patientId, {required bool overdue}) => {
        'noteId': noteId,
        'encounterId': encounterId,
        'patientId': patientId,
        'noteTypeKey': testNote.key,
        'startedAt': '2026-10-18T15:00:00.000Z',
        'overdue': overdue,
      };
      api.on(
        'GET',
        '/v1/me/notes-to-finish',
        (_) => {
          'notes': [
            row(remoteNote, elsewhere, remotePatient, overdue: true),
            row(draft, visit, patient, overdue: true),
            row(finished, visit, patient, overdue: false),
          ],
        },
      );
      final n = notes(p);
      final list = await n.open();
      expect(list.online, isTrue);
      expect([for (final r in list.rows) r.noteId], [remoteNote, draft]);
      final remote = list.rows.first;
      expect(
        [remote.encounterId, remote.patientName, remote.title, remote.onPhone, remote.overdue, remote.startedAt],
        [elsewhere, 'Demo Remote', titles[testNote.key], false, true, DateTime.utc(2026, 10, 18, 15)],
      );
      // On the phone and in the server's list: the phone's copy, with the server's overdue, which
      // knows when it received a visit whose start the phone could not verify (3.9).
      expect(
        [list.rows.last.onPhone, list.rows.last.overdue, list.rows.last.patientName],
        [true, true, 'Demo Patient'],
      );
      expect(audits(p).last, {
        'action': 'notes_to_finish.viewed',
        'patientIds': [remotePatient, patient],
        'resultCount': 2,
      });

      // Sent for review (the credential was lowered on the server, 4.2): the server has it as a
      // draft, and the phone knows a Program Admin decides it; nothing for the person to finish.
      server.noteTypes[(testRedFlags.key, testRedFlags.version)] = redFlagsNoteType;
      final medical = p.store.createEncounter(kind: 'medical', patientId: patient);
      final flags = p.store.createNote(
        encounterId: medical,
        noteTypeKey: testRedFlags.key,
        noteTypeVersion: testRedFlags.version,
        data: {'flags.any': 'no'},
      );
      await p.engine.syncAll(force: true);
      server.changeCredential(alex, 'chw');
      p.store.finishNotes(
        [
          NoteToFinish(
            noteId: flags,
            shownHash: p.store.contentHashOf(flags, definitions[(testRedFlags.key, testRedFlags.version)]!),
            act: SignoffAct.sign,
            statementVersion: 'sign-2026-11',
          ),
        ],
        signer: const Signer(credential: 'attending', canSign: true, needsAttestation: false),
        definitionOf: (key, version) => definitions[(key, version)],
      );
      await p.engine.syncAll(force: true);
      expect(p.store.sentForReview(flags), isTrue);
      api.on(
        'GET',
        '/v1/me/notes-to-finish',
        (_) => {
          'notes': [row(draft, visit, patient, overdue: true), row(flags, medical, patient, overdue: false)],
        },
      );
      expect([for (final r in (await n.open()).rows) r.noteId], [draft]);

      // Without signal, the phone's own.
      api.offline = true;
      final offline = await n.open();
      expect(
        [
          offline.online,
          [for (final r in offline.rows) r.noteId],
        ],
        [
          false,
          [draft],
        ],
      );
    });

    test('Home’s tile counts what the list would show, from the server’s count and the phone’s own', () async {
      final p = phone(alex);
      final patient = server.seedPatient();
      final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
      final finished = note(p, visit, {'vitals.pulse': 90});
      final done = note(p, visit, {'vitals.pulse': 100});
      note(p, visit);
      complete(p, done);
      await p.engine.syncAll(force: true);
      // Completed and confirmed: the server counts it no more than the phone does.
      expect(p.store.noteState(done)!.status, NoteStatus.completed);
      complete(p, finished);
      // Made after the sync: the server can't have counted it.
      note(p, visit, {'vitals.pulse': 80});
      p.advance(const Duration(hours: 25));

      // The server counts a draft not on this phone and the one completed here, both overdue.
      final n = notes(p);
      expect(n.count(const HomeCounts(notesToFinish: 2, notesOverdue: 2)), (notes: 2, overdue: 2));
      expect(n.count(null), (notes: 1, overdue: 1));
      // A count the server does not give (a role without encounters.chart) is the phone's own.
      expect(n.count(const HomeCounts()), (notes: 1, overdue: 1));
      expect(audits(p), isEmpty);
    });
  });
}
