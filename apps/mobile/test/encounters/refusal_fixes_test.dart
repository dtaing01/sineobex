import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/sync/entities.dart' show entityAudit, entityReferral;
import 'package:sineobex_field/sync/local_store.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';

/// Needs attention's fixes the domain layer gives (lifecycle 4.1, 8.4, 9.13; decided item B6), on
/// what the screen tests don't reach: a refusal received before the phone learns why, a visit of
/// someone else chosen, a patient other than the visit's own, a type the team lists no other version
/// of, and a frozen store. Each refusal is the receipt the server sends, applied to the store.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  final start = DateTime.utc(2026, 10, 20, 15);

  late FakeSyncServer server;
  final phones = <TestPhone>[];

  setUp(() => server = FakeSyncServer(now: () => start));
  tearDown(() {
    for (final p in phones) {
      p.close();
    }
    phones.clear();
  });

  final definitions = {
    for (final d in testNoteTypes) (d['key']! as String, d['version']! as int): NoteTypeDef.fromJson(d),
  };

  ({TestPhone p, EncounterRepository r}) phone({Iterable<NoteTypeDef>? listed}) {
    final p = TestPhone(userId: alex, teamId: team, transport: () => server.transportFor(alex, team), wall: start);
    phones.add(p);
    final r = EncounterRepository(
      p.store,
      user: EncounterUser(
        userId: alex,
        displayName: 'Demo Charter',
        credential: 'attending',
        permissions: FakeSyncServer.healthcareStaff,
      ),
      definitions: NoteDefinitions(held: (key, version) async => definitions[(key, version)]),
      noteTypes: () async => listed ?? definitions.values,
    );
    return (p: p, r: r);
  }

  Matcher refused(String problem) => throwsA(isA<LocalValidationError>().having((e) => e.problem, 'problem', problem));

  OutboxEntry refuse(TestPhone p, String recordId, String reason, String problem) {
    final create = p.store.outbox().singleWhere((e) => e.recordId == recordId && e.op == 'create');
    p.store.reject(create, reason: reason, details: {'problem': problem});
    return p.store.entry(create.changeId)!;
  }

  List<OutboxEntry> sent(TestPhone p) => [
    for (final e in p.store.outbox())
      if (e.entity != entityAudit) e,
  ];

  test('Choose a visit leaves out the visit the refusal names, and refuses one of someone else', () {
    final (:p, :r) = phone();
    final patient = server.seedPatient();
    final other = server.seedPatient(preferredName: 'Demo Other');
    final named = p.store.createEncounter(kind: 'non_medical', patientId: patient);
    final second = p.store.createEncounter(kind: 'non_medical', patientId: patient);
    final elsewhere = p.store.createEncounter(kind: 'non_medical', patientId: other);
    final referral = p.store.createRecord(entityReferral, {
      'patientId': patient,
      'referredOn': '2026-10-20',
      'details': 'Demo: dental clinic',
      'encounterId': named,
    });
    // Refused before a pull tells the phone the visit moved: its copy still says it is the patient's.
    final x = refuse(p, referral, 'stale_reference', 'encounter_other_patient');
    expect(settledByVisit(x), isTrue);
    expect([for (final v in r.visitsToChoose(x.changeId)) v.encounterId], [second]);

    final before = sent(p).length;
    expect(() => r.moveToVisit(x.changeId, elsewhere), refused('encounter_other_patient'));
    expect(sent(p), hasLength(before));
    r.moveToVisit(x.changeId, second);
    expect(p.store.outbox().last.value, containsPair('encounterId', second));
  });

  test('Choose a patient keeps the patient a visit names already, and only sends the note again', () {
    final (:p, :r) = phone();
    final patient = server.seedPatient();
    final other = server.seedPatient(preferredName: 'Demo Other');
    final visit = p.store.createEncounter(kind: 'medical', patientId: patient);
    final note = p.store.createNote(encounterId: visit, noteTypeKey: testMedical.key, noteTypeVersion: 1);
    final x = refuse(p, note, 'validation', 'medical_note_needs_patient');
    final before = sent(p).length;
    expect(() => r.choosePatientFor(x.changeId, other), throwsArgumentError);
    expect(sent(p), hasLength(before));
    r.choosePatientFor(x.changeId, patient);
    final fix = sent(p).last;
    expect([fix.recordId, fix.op, fix.supersedes], [note, 'create', x.changeId]);
    expect(sent(p).where((e) => e.recordId == visit && e.op == 'set'), isEmpty);
  });

  test(
    'Remove this note needs another version of its type on the team’s list, and writes nothing without one',
    () async {
      final (:p, :r) = phone(listed: [definitions[(testNote.key, testNote.version)]!]);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final note = p.store.createNote(
        encounterId: visit,
        noteTypeKey: testNote.key,
        noteTypeVersion: 1,
        data: {'care.plan': 'Demo: rest'},
      );
      final x = refuse(p, note, 'validation', 'unknown_note_type');
      expect(settledByRemoving(x), isTrue);
      final before = sent(p).length;
      await expectLater(r.removeRefusedNote(x.changeId), refused('definition_error'));
      expect(sent(p), hasLength(before));
      expect(p.store.entry(x.changeId)!.state, ChangeState.rejected);
    },
  );

  // Review finding VS-3: a version is a carrier only if it takes every answer the note holds, as
  // the server checks each; one that merely has each path may refuse the create, with no fix.
  test('Remove this note sends the note only on a version that takes every answer it holds', () async {
    NoteTypeDef versionOf(int version, int followupLength) {
      final json =
          jsonDecode(jsonEncode(testNoteTypes.firstWhere((d) => d['key'] == testNote.key))) as Map<String, Object?>;
      final care = (json['sections']! as List<Object?>).cast<Map<String, Object?>>().firstWhere(
        (s) => s['id'] == 'care',
      );
      (care['fields']! as List<Object?>).cast<Map<String, Object?>>().firstWhere(
        (f) => f['id'] == 'followup',
      )['maxLength'] = followupLength;
      return NoteTypeDef.fromJson({...json, 'version': version});
    }

    final narrower = versionOf(2, 5);
    final wide = versionOf(3, 200);
    final held = {'care.plan': 'Demo: rest', 'care.followup': 'Demo: recheck in a week'};
    Future<({TestPhone p, EncounterRepository r, OutboxEntry x})> refusedNote(List<NoteTypeDef> listed) async {
      final (:p, :r) = phone(listed: listed);
      final visit = p.store.createEncounter(kind: 'non_medical');
      final note = p.store.createNote(encounterId: visit, noteTypeKey: testNote.key, noteTypeVersion: 1, data: held);
      return (p: p, r: r, x: refuse(p, note, 'validation', 'unknown_note_type'));
    }

    // Version 2 has every path, but takes no follow-up that long: no carrier, and nothing written.
    final none = await refusedNote([narrower]);
    expect(await none.r.canRemoveRefusedNote(none.x.changeId), isFalse);
    final before = sent(none.p).length;
    await expectLater(none.r.removeRefusedNote(none.x.changeId), refused('definition_error'));
    expect(sent(none.p), hasLength(before));
    expect(none.p.store.entry(none.x.changeId)!.state, ChangeState.rejected);

    // Version 3 takes them: the note goes on it, carrying them.
    final some = await refusedNote([narrower, wide]);
    expect(await some.r.canRemoveRefusedNote(some.x.changeId), isTrue);
    await some.r.removeRefusedNote(some.x.changeId);
    final fix = sent(some.p).firstWhere((e) => e.supersedes == some.x.changeId);
    expect(fix.value, allOf(containsPair('noteTypeVersion', 3), containsPair('data', held)));
  });

  test('nothing is read or sent while the store is frozen', () async {
    final (:p, :r) = phone();
    final patient = server.seedPatient();
    final visit = p.store.createEncounter(kind: 'non_medical', patientId: patient);
    final referral = p.store.createRecord(entityReferral, {
      'patientId': patient,
      'referredOn': '2026-10-20',
      'details': 'Demo: dental clinic',
      'encounterId': '7e570000-0000-4000-8000-0000000000f1',
    });
    final x = refuse(p, referral, 'stale_reference', 'encounter_missing');
    final before = p.store.outbox().length;
    p.store.freeze('Your access to this team ended.');
    expect(r.hasVisitsToChoose(x.changeId), isFalse);
    expect(() => r.visitsToChoose(x.changeId), throwsA(isA<ChartingPaused>()));
    expect(() => r.moveToVisit(x.changeId, visit), throwsA(isA<ChartingPaused>()));
    expect(() => r.sendWithoutVisit(x.changeId), throwsA(isA<ChartingPaused>()));
    expect(p.store.outbox(), hasLength(before));
  });
}
