import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/problems.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// **Add to the problem list** under a diagnosis of a note (lifecycle 8.3; card F7-problem-button):
/// the diagnosis made a problem through phase 3's path, naming the visit, at the status the note
/// gives it (PLAN-OPEN 12.1 #16). Each runs offline first, then syncs to the phone's test server.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  final start = DateTime.utc(2026, 10, 20, 15);
  const staff = FakeSyncServer.healthcareStaff;
  const entry = 'e0000001';
  const diagnosis = 'problems.$entry.diagnosis';
  const scalp = (code: 'S01.01XA', title: 'Laceration without foreign body of scalp, initial encounter');
  const syphilis = (code: 'A53.9', title: 'Syphilis, unspecified');

  final presets = {
    for (final p in (jsonDecode(
      File('assets/forms/presets.json').readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>())
      (p['key']! as String, p['version']! as int): p['definition']! as Map<String, Object?>,
  };
  final definitions = {for (final MapEntry(:key, :value) in presets.entries) key: NoteTypeDef.fromJson(value)};
  final general = definitions[('general_primary_care', 1)]!;

  late FakeSyncServer server;
  final phones = <TestPhone>[];

  TestPhone phone(String user) {
    final p = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start);
    phones.add(p);
    return p;
  }

  setUp(() {
    server = FakeSyncServer(now: () => start);
    for (final MapEntry(:key, :value) in presets.entries) {
      server.noteTypes[key] = value;
    }
  });
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  EncounterRepository repo(TestPhone p, {String credential = 'attending', Set<String> permissions = staff}) =>
      EncounterRepository(
        p.store,
        user: EncounterUser(
          userId: p.userId,
          displayName: 'Demo Charter',
          credential: credential,
          permissions: permissions,
        ),
        definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
        noteTypes: () async => definitions.values,
      );

  Future<SyncOutcome> sync(TestPhone p) => p.engine.syncAll(force: true);

  /// A General note whose assessment holds one diagnosis, [code], with the note's [status].
  Future<({String visit, String note})> assessed(
    EncounterRepository r,
    String patient,
    ({String code, String title}) code, {
    String? status,
  }) async {
    final visit = r.startEncounter(kind: VisitKind.medical, patientId: patient);
    final note = (await r.addNote(visit, general)).noteId;
    await r.openNote(note);
    r.saveAnswer(note, 'problems.$entry.entryAt', '2026-10-20T15:01:00.000Z');
    r.saveAnswer(note, '$diagnosis.code', code.code);
    r.saveAnswer(note, '$diagnosis.label', code.title);
    if (status != null) r.saveAnswer(note, 'problems.$entry.status', status);
    return (visit: visit, note: note);
  }

  test('a diagnosis goes on the list naming the visit, at the status the note gives it', () async {
    final p = phone(alex);
    final patient = server.seedPatient();
    server.offline = true;
    final r = repo(p);
    final at = await assessed(r, patient, scalp, status: 'chronic');
    expect(r.problemListPlace(at.note, diagnosis), (listed: false, status: 'ongoing'));
    var changed = 0;
    r.onChanged = () => changed++;
    final problem = r.addToProblemList(at.note, diagnosis, status: 'ongoing');
    expect(changed, 1);
    final view = Problems(p.store, permissions: staff.toList()).problem(problem)!;
    expect(
      [view.title, view.code?.code, view.code?.display, view.status, view.encounterId, view.atVisit],
      [scalp.title, scalp.code, scalp.title, 'ongoing', at.visit, true],
    );
    // Once it is there, it says so rather than offer a second.
    expect(r.problemListPlace(at.note, diagnosis), (listed: true, status: 'ongoing'));

    server.offline = false;
    await sync(p);
    expect(p.store.outbox(), isEmpty);
    expect(p.store.needsAttention(), isEmpty);
    expect(
      [server.records[problem]!.attributes['source'], server.records[problem]!.attributes['createdEncounterId']],
      ['encounter', at.visit],
    );
  });

  test('the note’s status maps to the list’s, and with none the person chooses', () async {
    final p = phone(alex);
    final patient = server.seedPatient();
    final r = repo(p);
    for (final (status, mapped) in [('new', 'new'), ('improving', 'ongoing'), ('worse', 'ongoing'), (null, null)]) {
      final at = await assessed(r, patient, scalp, status: status);
      expect(r.problemListPlace(at.note, diagnosis), (listed: false, status: mapped), reason: '$status');
    }
    final at = await assessed(r, patient, syphilis);
    // A sensitive code goes on the list marked sensitive, as phase 3's Add problem marks it.
    final problem = r.addToProblemList(at.note, diagnosis, status: 'new');
    expect(Problems(p.store, permissions: staff.toList()).problem(problem)!.sensitive, isTrue);
    expect(() => r.addToProblemList(at.note, diagnosis, status: 'resolved'), throwsA(isA<LocalValidationError>()));
    await sync(p);
    expect(p.store.needsAttention(), isEmpty);
  });

  test('not offered without a diagnosis picked, or to a role that doesn’t chart; nothing written then', () async {
    final p = phone(alex);
    final patient = server.seedPatient();
    final r = repo(p);
    final at = await assessed(r, patient, scalp, status: 'new');
    expect(r.problemListPlace(at.note, 'problems.e0000002.diagnosis'), isNull);
    final reader = repo(p, permissions: staff.difference({'encounters.chart'}).union({'billing.view_codes'}));
    expect(reader.problemListPlace(at.note, diagnosis), isNull);
    final before = p.store.outbox().length;
    expect(
      () => reader.addToProblemList(at.note, diagnosis, status: 'new'),
      throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', 'not_charting')),
    );
    expect(() => r.addToProblemList(at.note, 'problems.e0000002.diagnosis', status: 'new'), throwsStateError);
    expect(p.store.outbox(), hasLength(before));

    // While the clock check fails, and while the store is frozen.
    await sync(p);
    server.offline = true;
    p.wall = p.wall.add(const Duration(minutes: 10));
    expect(() => r.addToProblemList(at.note, diagnosis, status: 'new'), throwsA(isA<ChartingPaused>()));
    p.wall = p.wall.subtract(const Duration(minutes: 10));
    p.store.freeze('Demo: handing over');
    expect(() => r.problemListPlace(at.note, diagnosis), throwsA(isA<ChartingPaused>()));
    expect(() => r.addToProblemList(at.note, diagnosis, status: 'new'), throwsA(isA<ChartingPaused>()));
    expect(p.store.outbox(), isEmpty);
  });
}
