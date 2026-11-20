import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/close_sweep.dart';
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/encounter_repository.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/notes_to_finish.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/sync/entities.dart' show entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// The phase 4 Done when against the phone's test server (lifecycle 11.1, steps 1 to 6, card
/// L7-phone): "A resident charts a medical, wound and social visit as one encounter offline, saves
/// and closes it, completes it later, and an attending attests it." Through the domain layer, as the
/// screens drive it: the story, its people and its answers come from encounters-done-when.json,
/// which live_encounters_test.dart (steps 1 to 7 on the real API), the screens' done_when_flow_test
/// and the API's encounters-done-when.test.ts read too. The attending's step 7 needs the API's online
/// routes, which the test server lacks: the live test and the API's test run it.
void main() {
  final story = jsonDecode(
    File('../../packages/contract/test-vectors/encounters-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final people = story['people']! as Map<String, Object?>;
  final residentPerson = people['resident']! as Map<String, Object?>;
  final patient = story['patient']! as Map<String, Object?>;
  final patientId = patient['id']! as String;
  final encounter = story['encounter']! as Map<String, Object?>;
  final statements = (story['statementVersions']! as Map<String, Object?>).cast<String, String>();
  final assessment = story['assessment']! as String;
  final notes = (story['notes']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> byRef(String ref) => notes.singleWhere((n) => n['ref'] == ref);
  Map<String, Object?> expectAt(int n, String side) =>
      ((story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n)['expect']!
              as Map<String, Object?>)[side]!
          as Map<String, Object?>;
  Map<String, Object?> answersOf(Map<String, Object?> n) => (n['answers']! as Map<String, Object?>);
  Map<String, Object?> finalAnswers(Map<String, Object?> n) => {
    ...answersOf(n),
    ...(n['answersAtStep4']! as Map<String, Object?>),
  };

  const team = 'd04e0000-0000-4000-8000-0000000000a1';
  const resident = 'd04e0000-0000-4000-8000-0000000000b1';
  final start = DateTime.utc(2026, 11, 19, 15);

  // The released note types, as the phone bundles them and the API installs them in every team.
  final presets = (jsonDecode(File('assets/forms/presets.json').readAsStringSync()) as List<Object?>)
      .cast<Map<String, Object?>>();
  final released = {
    for (final p in presets)
      (p['key']! as String, p['version']! as int): NoteTypeDef.fromJson(p['definition']! as Map<String, Object?>),
  };
  NoteTypeDef typeOf(Map<String, Object?> n) => released[(n['noteTypeKey']! as String, n['noteTypeVersion']! as int)]!;

  late DateTime serverTime;
  late FakeSyncServer server;
  late TestPhone phone;
  late PatientServices patients;
  late EncounterRepository repo;
  late NotesToFinish toFinish;
  late CloseSweep sweep;

  final user = EncounterUser(
    userId: resident,
    displayName: residentPerson['displayName']! as String,
    credential: residentPerson['credential']! as String,
    permissions: FakeSyncServer.healthcareStaff,
  );

  /// The services as the app makes them when the team's database opens: the patient services, then
  /// the visits and notes with the close sweep among the refreshers (encounter_services.dart).
  void attach() {
    patients = PatientServices(
      OpenTeam(
        userId: resident,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: user.permissions.toList(),
      ),
      copy: (_) async => true,
      wallNow: () => phone.wall,
    );
    final definitions = NoteDefinitions(held: (key, version) async => released[(key, version)]);
    repo = EncounterRepository(
      phone.store,
      user: user,
      definitions: definitions,
      noteTypes: () async => released.values,
      openServerRecord: phone.engine.openServerRecord,
    );
    toFinish = NotesToFinish(
      phone.store,
      user: user,
      api: EncounterApi(phone.engine.api, phone.store, user: user, definitions: definitions),
      titleOf: (key) => released.values.where((d) => d.key == key).firstOrNull?.title,
      patientName: (id) => patients.index.entry(id)?.preferredName,
      now: () => phone.wall,
    );
    sweep = CloseSweep(phone.store, now: () => phone.clock.stamp().correctedTime);
    phone.engine.refreshers
      ..clear()
      ..addAll([...patients.refreshers, sweep]);
  }

  /// Time passes on the phone and on the server alike, so the clock check still holds.
  void later(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  setUp(() {
    serverTime = start;
    // Each read of the server's clock is a microsecond on: the API writes each change of a push in
    // its own transaction, so the notes of one push are made at times of their own, which order a
    // visit's notes (created_at, D108), where one clock for the whole push would tie them.
    server = FakeSyncServer(now: () => serverTime = serverTime.add(const Duration(microseconds: 1)));
    for (final p in presets) {
      server.noteTypes[(p['key']! as String, p['version']! as int)] = p['definition']! as Map<String, Object?>;
    }
    server.credentials[resident] = user.credential;
    server.names[resident] = user.displayName;
    // The made-up patient, registered before the story starts.
    server.seed(entityPatient, {
      'preferredName': patient['preferredName'],
      'visualDescriptor': patient['visualDescriptor'],
      'usualArea': patient['usualArea'],
      'livingSituation': patient['livingSituation'],
      'preferredLanguage': patient['preferredLanguage'],
      'consent': {
        'id': 'd04e0c00-0000-4000-8000-000000000001',
        'decision': 'given',
        'method': 'verbal',
        'scriptVersion': consentScriptVersion,
        'language': 'en',
      },
      'privacyNotice': {'id': 'd04e0c00-0000-4000-8000-000000000002', 'decision': 'acknowledged'},
    }, id: patientId);
    phone = TestPhone(
      userId: resident,
      teamId: team,
      transport: () => server.transportFor(resident, team),
      wall: start,
    );
    attach();
  });
  tearDown(() => phone.close());

  List<LocalRecord> held(String entity) => [
    for (final id in phone.store.recordIds())
      if (phone.store.record(id)!.entity == entity) phone.store.record(id)!,
  ];

  /// A note's answers as the phone holds them, by path.
  Map<String, Object?> onPhone(String noteId) => {
    for (final MapEntry(:key, :value) in phone.store.record(noteId)!.fields.entries)
      if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
  };

  /// A record's answers as the server holds them, by path.
  Map<String, Object?> onServer(String noteId) => {
    for (final MapEntry(:key, :value) in server.records[noteId]!.fields.entries)
      if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
  };

  /// Every change [outbox] held was received, accepted, and its receipt names the hash the phone sent.
  void expectHashConfirmed(int step, List<OutboxEntry> outbox) {
    expect(expectAt(step, 'receipts'), {'status': 'accepted', 'hashConfirmed': true});
    expect(outbox, isNotEmpty);
    for (final e in outbox) {
      final receipt = server.receipts[e.changeId];
      expect([receipt?.status, receipt?.hash], ['accepted', e.valueHash], reason: '${e.entity} ${e.op} ${e.field}');
    }
    expect(phone.store.outbox(), isEmpty);
    expect(phone.store.needsAttention(), isEmpty);
  }

  test('a resident charts a medical, wound and social visit as one encounter offline, saves and closes it, and '
      'completes it later (lifecycle 11.1, steps 1 to 6)', () async {
    // The patient's index entry arrives online, before the story.
    expect(await phone.engine.syncAll(), isA<SyncDone>());
    expect(patients.index.entry(patientId)?.preferredName, patient['preferredName']);

    // 1. Offline. A Medical visit for the patient at the place typed; General / primary care, Wound
    // care and Social needs added in that order. The app adds the Red flags and disposition note
    // with the first Medical one.
    server.offline = true;
    final step1 = expectAt(1, 'phone');
    final visit = repo.startEncounter(
      kind: VisitKind.fromCode(encounter['kind']),
      patientId: patientId,
      locationText: encounter['locationText']! as String,
    );
    final ids = <String, String>{};
    for (final n in notes.where((n) => n['addedBy'] == 'resident')) {
      final added = await repo.addNote(visit, typeOf(n));
      expect(added.existing, isFalse);
      ids[n['ref']! as String] = added.noteId;
      for (final app in notes.where((a) => a['addedBy'] == 'app' && a['addedWith'] == n['ref'])) {
        ids[app['ref']! as String] = (await repo.ownRedFlagsNote(visit))!;
      }
    }
    expect(ids.keys, [for (final n in notes) n['ref']]);
    // The creates queued in the visit's order, the Red flags note straight after General's.
    expect(
      [
        for (final e in phone.store.outbox())
          if (e.op == 'create') e.recordId,
      ],
      [visit, for (final n in notes) ids[n['ref']]],
    );
    expect(held(entityEncounter).map((r) => r.id), [visit]);
    expect(held(entityEncounter), hasLength(step1['encounters']! as int));
    expect(held(entityNote).map((r) => r.id).toSet(), ids.values.toSet());
    expect(held(entityNote), hasLength(step1['notes']! as int));
    for (final n in notes) {
      expect(phone.store.noteState(ids[n['ref']]!)!.status.name, step1['noteStatus'], reason: n['ref'] as String);
      expect(phone.store.record(ids[n['ref']]!)!.attributes['noteTypeKey'], n['noteTypeKey']);
    }
    // Nothing sent: the server has none of it.
    void expectNothingSent(Map<String, Object?> expected) {
      expect(expected['sent'], 0);
      expect(server.records[visit], isNull);
      for (final id in ids.values) {
        expect(server.records[id], isNull);
      }
      expect([for (final e in phone.store.outbox()) server.receipts[e.changeId]], everyElement(isNull));
    }

    expectNothingSent(step1);

    // 2. Each note's answers, as the form saves them, then Save & Close: nothing more is saved, and
    // the sync it asks for finds no signal.
    final step2 = expectAt(2, 'phone');
    for (final n in notes) {
      final id = ids[n['ref']]!;
      await repo.openNote(id);
      for (final MapEntry(:key, :value) in answersOf(n).entries) {
        expect(repo.saveAnswer(id, key, value), isTrue, reason: key);
      }
    }
    final saved = [for (final e in phone.store.outbox()) (e.changeId, e.valueHash)];
    expect(await phone.engine.syncAll(force: true), isA<SyncOffline>());

    // The app is killed and started again, still offline: the database's opening sweeps, and the
    // drafts stay on their author's phone (3.2), every answer with them.
    await phone.restart();
    attach();
    await phone.engine.runRefreshers(RefreshReason.opened);
    expect([for (final e in phone.store.outbox()) (e.changeId, e.valueHash)], saved);
    expect(held(entityEncounter), hasLength(step2['encounters']! as int));
    expect(held(entityNote), hasLength(step2['notes']! as int));
    expect(step2['answers'], 'answers');
    for (final n in notes) {
      final id = ids[n['ref']]!;
      final view = (await repo.openNote(id))!;
      expect([view.status.name, view.editable, view.actsAsAuthor], [step2['noteStatus'], true, true]);
      expect(onPhone(id), answersOf(n), reason: n['ref'] as String);
    }
    // Notes to finish says 4: every note holds an answer, the Red flags note included.
    final listed = toFinish.read();
    expect(listed.online, isFalse);
    expect({for (final r in listed.rows) r.noteId}, ids.values.toSet());
    expect(listed.rows, hasLength(step2['notesToFinish']! as int));
    expect(listed.rows.every((r) => r.encounterId == visit && r.patientId == patientId && r.onPhone), isTrue);
    expect(toFinish.count(null).notes, step2['notesToFinish']);
    expectNothingSent(step2);

    // 3. The phone reconnects: every change confirmed by hash; the server holds one draft visit with
    // four draft notes; the drafts are still on the phone.
    later(const Duration(minutes: 20));
    server.offline = false;
    final firstPush = phone.store.outbox();
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    expectHashConfirmed(3, firstPush);
    final step3 = expectAt(3, 'server');
    final serverVisits = [
      for (final r in server.records.values)
        if (r.entity == entityEncounter && r.fields['patientId']?.value == patientId) r,
    ];
    expect(serverVisits.map((r) => r.id), [visit]);
    expect(serverVisits, hasLength(step3['encounters']! as int));
    expect(
      [serverVisits.single.status, serverVisits.single.fields['kind']?.value],
      [step3['encounterStatus'], encounter['kind']],
    );
    expect(serverVisits.single.fields['locationText']?.value, encounter['locationText']);
    final serverNotes = [
      for (final r in server.records.values)
        if (r.entity == entityNote && r.attributes['encounterId'] == visit) r,
    ];
    expect(serverNotes, hasLength(step3['notes']! as int));
    expect(step3['answers'], 'answers');
    for (final n in notes) {
      final id = ids[n['ref']]!;
      final r = server.records[id]!;
      expect(
        [r.attributes['noteTypeKey'], r.fields['status']?.value, r.attestation, r.author],
        [n['noteTypeKey'], step3['noteStatus'], step3['attestation'], resident],
        reason: n['ref'] as String,
      );
      expect(onServer(id), answersOf(n), reason: n['ref'] as String);
    }
    final step3Phone = expectAt(3, 'phone');
    expect(held(entityEncounter), hasLength(step3Phone['encounters']! as int));
    expect(held(entityNote), hasLength(step3Phone['notes']! as int));
    for (final id in ids.values) {
      expect(phone.store.noteState(id)!.status.name, step3Phone['noteStatus']);
    }
    // The phone's list is the same four (the server's is the API test's to read).
    expect(toFinish.read().rows, hasLength(step3['notesToFinish']! as int));

    // 4. Offline again, later. The visit opened from Notes to finish, the red-flag question answered,
    // the assessment written, Complete and sign.
    later(const Duration(hours: 3));
    server.offline = true;
    final step4 = expectAt(4, 'phone');
    final list = await toFinish.open();
    expect(list.online, isFalse);
    final row = list.rows.firstWhere((r) => r.noteId == ids['general']);
    expect(row.encounterId, visit);
    final opened = (await repo.openVisit(row.encounterId))!;
    expect({for (final n in opened.notes) n.noteId}, ids.values.toSet());
    for (final n in notes) {
      final id = ids[n['ref']]!;
      await repo.openNote(id);
      for (final MapEntry(:key, :value) in (n['answersAtStep4']! as Map<String, Object?>).entries) {
        expect(repo.saveAnswer(id, key, value), isTrue, reason: key);
      }
    }
    expect(repo.saveSummary(visit, assessment), isTrue);
    final plan = (await repo.openComplete(visit))!;
    expect(plan.stops.map((s) => s.message), isEmpty);
    expect(step4['button'], 'Complete and sign');
    expect(plan.button, CompleteButton.completeAndSign);
    expect(plan.signingSentence, contains(user.displayName));
    expect({for (final n in plan.notes) n.noteId: n.act.name}, {for (final n in notes) ids[n['ref']]: n['act']});
    final before = phone.store.outbox().length;
    repo.complete(plan);

    // Four sign-offs wait in the outbox, the Red flags note's first: `sign` for the three Medical
    // notes, `complete` for Social needs, a Non-Medical note.
    final signoffs = [
      for (final e in phone.store.outbox().skip(before))
        if (e.entity == entitySignoff) e,
    ];
    final planned = (step4['outbox']! as List<Object?>).cast<Map<String, Object?>>();
    expect(
      [
        for (final s in signoffs)
          ((s.value! as Map<String, Object?>)['noteId'], (s.value! as Map<String, Object?>)['act']),
      ],
      [for (final p in planned) (ids[p['note']], p['act'])],
    );
    for (final (i, s) in signoffs.indexed) {
      final n = byRef(planned[i]['note']! as String);
      final value = s.value! as Map<String, Object?>;
      expect(value['act'], n['act']);
      expect(value['statementVersion'], statements[n['act']]);
      expect(value['claimedCredential'], n['act'] == 'sign' ? user.credential : isNull);
      expect(value['contentHash'], plan.notes.singleWhere((p) => p.noteId == ids[n['ref']]).shownHash);
      expect(s.op, 'create');
    }
    expect(signoffs, hasLength(planned.length));
    // The notes are read-only now.
    expect(step4['readOnly'], isTrue);
    for (final n in notes) {
      final id = ids[n['ref']]!;
      final view = repo.readNote(id)!;
      expect([view.editable, view.waitingToSend], [false, true], reason: n['ref'] as String);
      expect(view.status.name, (n['afterStep5']! as Map<String, Object?>)['status']);
      // Clearing an answer is a change the form allows any draft; a finished note refuses it.
      final queued = phone.store.outbox().length;
      expect(() => repo.saveAnswer(id, answersOf(n).keys.first, null), throwsA(isA<RecordLocked>()));
      expect(phone.store.outbox(), hasLength(queued));
      expect(onPhone(id), finalAnswers(n), reason: n['ref'] as String);
    }
    // The patient's chart opens, offline, with the visit marked "Waiting to send".
    expect(step4['opens'], 'chart');
    expect(step4['visitLabel'], 'Waiting to send');
    expect(await patients.patients.open(patientId), isNotNull);
    final timeline = await repo.openTimeline(patientId);
    final visitRow = timeline.rows.whereType<TimelineVisitRow>().single;
    expect(
      [visitRow.encounterId, visitRow.waitingToSend, visitRow.onPhone, visitRow.status],
      [visit, true, true, NoteStatus.signed],
    );
    expect({for (final c in visitRow.notes) c.noteId: c.waitingToSend}, {for (final id in ids.values) id: true});

    // 5. The phone reconnects: every change confirmed by hash; four sign-offs on the server, three
    // signed and one completed; the Medical notes wait for an attending; the visit is signed.
    later(const Duration(minutes: 10));
    server.offline = false;
    final secondPush = phone.store.outbox();
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    expectHashConfirmed(5, secondPush);
    final step5 = expectAt(5, 'server');
    final serverSignoffs = [
      for (final r in server.records.values)
        if (r.entity == entitySignoff && ids.values.contains(r.attributes['noteId'])) r,
    ];
    expect(serverSignoffs, hasLength(step5['signoffs']! as int));
    final effects = <String, int>{};
    for (final s in serverSignoffs) {
      effects.update(s.attributes['effect']! as String, (c) => c + 1, ifAbsent: () => 1);
    }
    expect(effects, step5['effects']);
    expect(step5['notes'], 'afterStep5');
    for (final (i, s) in signoffs.indexed) {
      final n = byRef(planned[i]['note']! as String);
      final id = ids[n['ref']]!;
      final r = server.records[id]!;
      final after = n['afterStep5']! as Map<String, Object?>;
      expect(
        [r.fields['status']?.value, r.attestation],
        [after['status'], after['attestation']],
        reason: n['ref'] as String,
      );
      expect(server.records[s.recordId]!.attributes['effect'], n['effect']);
      // A signed note names the sign-off that signs it; a completed one names none.
      expect(r.signoffId, n['effect'] == 'signed' ? s.recordId : isNull);
      expect(server.receipts[s.changeId]!.details, containsPair('effect', n['effect']));
      expect(onServer(id), finalAnswers(n), reason: n['ref'] as String);
    }
    expect(server.records[visit]!.status, step5['encounterStatus']);
    expect(server.records[visit]!.fields['summary']?.value, assessment);
    // The reads the phone made offline joined the chain, holding nothing of the patient.
    expect(server.audit.map((a) => a['action']), contains('notes_to_finish.viewed'));
    final logged = jsonEncode(server.audit);
    for (final never in (story['neverInAuditDetails']! as List<Object?>).cast<String>()) {
      expect(logged, isNot(contains(never)));
    }

    // 6. The phone's sync finishes: its refresh brings the notes as the server made them, and the
    // close sweep lets the visit and its notes go. Notes to finish is empty.
    final step6 = expectAt(6, 'phone');
    expect(held(entityEncounter), hasLength(step6['encounters']! as int));
    expect(held(entityNote), hasLength(step6['notes']! as int));
    expect(phone.store.record(visit), isNull);
    expect(toFinish.read().rows, hasLength(step6['notesToFinish']! as int));
    expect(toFinish.count(null).notes, step6['notesToFinish']);
    // The chart still shows the visit, from the server's timeline now (8.2): nothing waits to send.
    expect(
      (await repo.openTimeline(patientId)).rows.whereType<TimelineVisitRow>().where((r) => r.waitingToSend),
      isEmpty,
    );
    // The sign-offs name the patient, so they stay with the chart opened at step 4 and leave with it
    // when its scope ends (phase 3's purge): then nothing of the visit is on the phone.
    expect(held(entitySignoff), hasLength(planned.length));
    later(const Duration(hours: 25));
    phone.store.purge();
    expect(held(entitySignoff), isEmpty);
  });
}
