import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sineobex_field/api/generated/api.dart'
    show AuditEntry, AuditSearch, FetchRecords, Me, RecordEntity, RecordRef, RecordSnapshot, SineobexApi;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
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
import 'package:sineobex_field/patients/patient_repository.dart';
import 'package:sineobex_field/sync/entities.dart' show entitySignoff;
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/phone_harness.dart';

/// The phase 4 Done when against the real API and Postgres (lifecycle 11.1, steps 1 to 7, card
/// L7-live): "A resident charts a medical, wound and social visit as one encounter offline, saves
/// and closes it, completes it later, and an attending attests it." The same domain layer and story
/// as done_when_test.dart (encounters-done-when.json), with the real server in place of the phone's
/// test server, and step 7's attending online through the API's queue and attest routes.
/// tools/live-sync.sh runs it last, on the seeded demo team: the story's people are its staff, and its
/// note types the released ones the phone bundles. The patient is registered by the resident's phone
/// with the story's details, under the ID the phone gives it, so the file runs again on the same
/// database. What only the server can see, a change's receipt and the audit chain, is read from the
/// push's answers and through the Program Admin's audit search.
void main() {
  final apiUrl = Platform.environment['SINEOBEX_LIVE_API'];
  final idpUrl = Platform.environment['SINEOBEX_LIVE_IDP'];
  final skip = apiUrl == null || idpUrl == null ? 'set SINEOBEX_LIVE_API and SINEOBEX_LIVE_IDP to run' : null;
  if (Platform.environment['SINEOBEX_LIVE_REQUIRED'] == '1' && skip != null) {
    test('the live API is configured', () => fail(skip));
    return;
  }

  final story = jsonDecode(
    File('../../packages/contract/test-vectors/encounters-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final people = (story['people']! as Map<String, Object?>).cast<String, Map<String, Object?>>();
  final patient = story['patient']! as Map<String, Object?>;
  final encounter = story['encounter']! as Map<String, Object?>;
  final statements = (story['statementVersions']! as Map<String, Object?>).cast<String, String>();
  final assessment = story['assessment']! as String;
  final notes = (story['notes']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> byRef(String ref) => notes.singleWhere((n) => n['ref'] == ref);
  Map<String, Object?> expectAt(int n, String side) =>
      ((story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n)['expect']!
              as Map<String, Object?>)[side]!
          as Map<String, Object?>;
  Map<String, Object?> answersOf(Map<String, Object?> n) => n['answers']! as Map<String, Object?>;
  Map<String, Object?> finalAnswers(Map<String, Object?> n) => {
    ...answersOf(n),
    ...(n['answersAtStep4']! as Map<String, Object?>),
  };

  // The made-up demo team (db/seed/seed.ts).
  const team = '0d3e6f00-0000-4000-8000-000000000001';
  final client = http.Client();
  final phones = <_LivePhone>[];

  // The released note types, as the phone bundles them and the seed installs them.
  final released = {
    for (final p in (jsonDecode(
      File('assets/forms/presets.json').readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>())
      (p['key']! as String, p['version']! as int): NoteTypeDef.fromJson(p['definition']! as Map<String, Object?>),
  };
  NoteTypeDef typeOf(Map<String, Object?> n) => released[(n['noteTypeKey']! as String, n['noteTypeVersion']! as int)]!;

  Future<({String userId, Tokens tokens, Me me})> signIn(String email) async {
    final auth = DevAuthProvider(url: Uri.parse(idpUrl!), client: client);
    final challenge = await auth.signIn(email, 'sineobex-demo') as MfaChallenge;
    final tokens = await auth.verifyMfa(challenge.tokens, challenge.factorId, '000000');
    final me = await SineobexApi(
      HttpTransport(baseUrl: Uri.parse(apiUrl!), client: client, accessToken: () => tokens.accessToken),
    ).getMe();
    return (userId: me.user.id, tokens: tokens, me: me);
  }

  /// The API as [email], online (the portal's screens, a reader beside the story).
  Future<SineobexApi> as(String email) async {
    final who = await signIn(email);
    return SineobexApi(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
  }

  /// The story's [person] on a phone, signed in as the seeded staff member of that email, who is
  /// the person the story names: their name and credential are the story's.
  Future<_LivePhone> phone(Map<String, Object?> person) async {
    final who = await signIn(person['email']! as String);
    final membership = who.me.teams.singleWhere((t) => t.teamId == team);
    expect(
      [who.me.user.displayName, membership.credential.wire],
      [person['displayName'], person['credential']],
      reason: 'the story’s people are the seeded staff',
    );
    final network = _Network(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
    final p = _LivePhone(
      TestPhone(userId: who.userId, teamId: team, transport: () => network, realTime: DateTime.now),
      network,
      EncounterUser(
        userId: who.userId,
        displayName: who.me.user.displayName,
        credential: membership.credential.wire,
        permissions: [for (final k in membership.permissions) k.wire],
      ),
      released,
    );
    phones.add(p);
    await p.sync();
    return p;
  }

  tearDownAll(() {
    for (final p in phones) {
      p.phone.close();
    }
    client.close();
  });

  test('the Done when: a resident charts a medical, wound and social visit as one encounter offline, saves and '
      'closes it, completes it later, and an attending attests it (lifecycle 11.1, steps 1 to 7)', () async {
    final admin = await as(people['programAdmin']!['email']! as String);

    /// Every audit entry written after [mark], newest first, through the Program Admin's search.
    Future<List<AuditEntry>> auditAfter(BigInt mark) async {
      final found = <AuditEntry>[];
      String? before;
      while (true) {
        final page = await admin.searchAudit(body: AuditSearch(limit: 200, beforeId: before));
        for (final e in page.entries) {
          if (BigInt.parse(e.id) <= mark) return found;
          found.add(e);
        }
        before = page.nextBeforeId;
        if (before == null) return found;
      }
    }

    Future<BigInt> auditMark() async =>
        BigInt.parse((await admin.searchAudit(body: const AuditSearch(limit: 1))).entries.single.id);

    /// The notes' records as the server's sync read gives them to the Program Admin.
    Future<Map<String, RecordSnapshot>> serverNotes(Iterable<String> ids) async => {
      for (final r in (await admin.fetchRecords(
        body: FetchRecords(
          records: [for (final id in ids) RecordRef(entity: RecordEntity.fromJson(entityNote), id: id)],
        ),
      )).records)
        r.id: r,
    };
    Map<String, Object?> answersIn(RecordSnapshot r) => {
      for (final MapEntry(:key, :value) in r.fields.entries)
        if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
    };

    final resident = await phone(people['resident']!);
    final attending = await phone(people['attending']!);

    // Before the story: the made-up patient, registered by the resident's phone with the story's
    // details and pushed at once.
    final mark0 = await auditMark();
    final countsBefore = (await resident.phone.engine.api.getHomeCounts()).notesToFinish!;
    final patientId = resident.patients.patients
        .createPatient(
          Intake(
            consent: const ConsentAnswer.given(),
            preferredName: patient['preferredName']! as String,
            visualDescriptor: patient['visualDescriptor']! as String,
            usualArea: patient['usualArea']! as String,
            livingSituation: (patient['livingSituation']! as Map<String, Object?>)['kind']! as String,
            preferredLanguage: patient['preferredLanguage']! as String,
          ),
        )
        .patientId;
    await resident.sync();
    expect([resident.store.outbox(), resident.store.needsAttention()], [isEmpty, isEmpty]);
    final deviceId = await resident.phone.device.deviceId(team);

    // 1. Offline. A Medical visit for the patient at the place typed; General / primary care, Wound
    // care and Social needs added in that order. The app adds the Red flags and disposition note
    // with the first Medical one.
    resident.network.offline = true;
    final step1 = expectAt(1, 'phone');
    final visit = resident.repo.startEncounter(
      kind: VisitKind.fromCode(encounter['kind']),
      patientId: patientId,
      locationText: encounter['locationText']! as String,
    );
    final ids = <String, String>{};
    for (final n in notes.where((n) => n['addedBy'] == 'resident')) {
      final added = await resident.repo.addNote(visit, typeOf(n));
      expect(added.existing, isFalse);
      ids[n['ref']! as String] = added.noteId;
      for (final app in notes.where((a) => a['addedBy'] == 'app' && a['addedWith'] == n['ref'])) {
        ids[app['ref']! as String] = (await resident.repo.ownRedFlagsNote(visit))!;
      }
    }
    expect(ids.keys, [for (final n in notes) n['ref']]);
    expect(
      [
        for (final e in resident.store.outbox())
          if (e.op == 'create') e.recordId,
      ],
      [visit, for (final n in notes) ids[n['ref']]],
    );
    expect(resident.held(entityEncounter).map((r) => r.id), [visit]);
    expect(resident.held(entityEncounter), hasLength(step1['encounters']! as int));
    expect(resident.held(entityNote).map((r) => r.id).toSet(), ids.values.toSet());
    expect(resident.held(entityNote), hasLength(step1['notes']! as int));
    for (final n in notes) {
      expect(resident.store.noteState(ids[n['ref']]!)!.status.name, step1['noteStatus'], reason: n['ref'] as String);
    }
    // Nothing sent: no push reached the server, which has no such visit.
    Future<void> expectNothingSent(Map<String, Object?> expected) async {
      expect(expected['sent'], 0);
      expect([
        for (final e in resident.store.outbox())
          if (resident.network.pushed.contains(e.changeId)) e,
      ], isEmpty);
      await expectLater(
        admin.getEncounter(encounterId: visit),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 404)),
      );
      expect((await serverNotes(ids.values)).keys, isEmpty);
    }

    await expectNothingSent(step1);

    // 2. Each note's answers, as the form saves them, then Save & Close, whose sync finds no signal.
    // The app is killed and started again, still offline: the drafts stay with every answer.
    final step2 = expectAt(2, 'phone');
    for (final n in notes) {
      final id = ids[n['ref']]!;
      await resident.repo.openNote(id);
      for (final MapEntry(:key, :value) in answersOf(n).entries) {
        expect(resident.repo.saveAnswer(id, key, value), isTrue, reason: key);
      }
    }
    final saved = [for (final e in resident.store.outbox()) (e.changeId, e.valueHash)];
    expect(await resident.phone.engine.syncAll(force: true), isA<SyncOffline>());
    await resident.phone.restart();
    resident.attach();
    await resident.phone.engine.runRefreshers(RefreshReason.opened);
    expect([for (final e in resident.store.outbox()) (e.changeId, e.valueHash)], saved);
    expect(resident.held(entityEncounter), hasLength(step2['encounters']! as int));
    expect(resident.held(entityNote), hasLength(step2['notes']! as int));
    expect(step2['answers'], 'answers');
    for (final n in notes) {
      final id = ids[n['ref']]!;
      final view = (await resident.repo.openNote(id))!;
      expect([view.status.name, view.editable], [step2['noteStatus'], true]);
      expect(resident.answersOnPhone(id), answersOf(n), reason: n['ref'] as String);
    }
    final offlineList = await resident.toFinish.open();
    expect(offlineList.online, isFalse);
    expect({for (final r in offlineList.rows) r.noteId}, ids.values.toSet());
    expect(offlineList.rows, hasLength(step2['notesToFinish']! as int));
    expect(resident.toFinish.count(null).notes, step2['notesToFinish']);
    await expectNothingSent(step2);

    // 3. The phone reconnects: every change has a receipt that accepts it and names its hash; the
    // server holds one draft visit with four draft notes, every answer as written; the drafts stay.
    resident.network.offline = false;
    final firstPush = resident.store.outbox();
    expect(await resident.sync(), isA<SyncDone>());
    resident.expectHashConfirmed(expectAt(3, 'receipts'), firstPush);
    final step3 = expectAt(3, 'server');
    final read3 = await admin.getEncounter(encounterId: visit);
    expect(
      [read3.patientId, read3.kind.wire, read3.status.wire, read3.locationText],
      [patientId, encounter['kind'], step3['encounterStatus'], encounter['locationText']],
    );
    expect(read3.notes, hasLength(step3['notes']! as int));
    // In the visit's order: the order the phone made them in.
    expect([for (final n in read3.notes) n.noteId], [for (final n in notes) ids[n['ref']]]);
    for (final n in read3.notes) {
      expect([n.status.wire, n.attestation.wire], [step3['noteStatus'], step3['attestation']]);
    }
    expect(step3['answers'], 'answers');
    final drafts = await serverNotes(ids.values);
    for (final n in notes) {
      final r = drafts[ids[n['ref']]]!;
      expect([r.status, r.authorUserId], [step3['noteStatus'], resident.user.userId], reason: n['ref'] as String);
      expect(answersIn(r), answersOf(n), reason: n['ref'] as String);
    }
    // Notes to finish on the server: the four drafts, none of them empty.
    final listed3 = [
      for (final n in await resident.api.notesToFinish())
        if (n.encounterId == visit) n.noteId,
    ];
    expect(listed3.toSet(), ids.values.toSet());
    expect(listed3, hasLength(step3['notesToFinish']! as int));
    expect((await resident.phone.engine.api.getHomeCounts()).notesToFinish, countsBefore + listed3.length);
    final step3Phone = expectAt(3, 'phone');
    expect(resident.held(entityEncounter), hasLength(step3Phone['encounters']! as int));
    expect(resident.held(entityNote), hasLength(step3Phone['notes']! as int));
    for (final id in ids.values) {
      expect(resident.store.noteState(id)!.status.name, step3Phone['noteStatus']);
    }

    // 4. Offline again, later. The visit opened from Notes to finish, the red-flag question answered,
    // the assessment written, Complete and sign.
    resident.network.offline = true;
    final step4 = expectAt(4, 'phone');
    final list = await resident.toFinish.open();
    expect(list.online, isFalse);
    final row = list.rows.firstWhere((r) => r.noteId == ids['general']);
    final opened = (await resident.repo.openVisit(row.encounterId))!;
    expect(
      [
        opened.encounterId,
        {for (final n in opened.notes) n.noteId},
      ],
      [visit, ids.values.toSet()],
    );
    for (final n in notes) {
      final id = ids[n['ref']]!;
      await resident.repo.openNote(id);
      for (final MapEntry(:key, :value) in (n['answersAtStep4']! as Map<String, Object?>).entries) {
        expect(resident.repo.saveAnswer(id, key, value), isTrue, reason: key);
      }
    }
    expect(resident.repo.saveSummary(visit, assessment), isTrue);
    final plan = (await resident.repo.openComplete(visit))!;
    expect(plan.stops.map((s) => s.message), isEmpty);
    expect(step4['button'], 'Complete and sign');
    expect(plan.button, CompleteButton.completeAndSign);
    final before = resident.store.outbox().length;
    resident.repo.complete(plan);
    final signoffs = [
      for (final e in resident.store.outbox().skip(before))
        if (e.entity == entitySignoff) e,
    ];
    final planned = (step4['outbox']! as List<Object?>).cast<Map<String, Object?>>();
    Map<String, Object?> valueOf(OutboxEntry e) => e.value! as Map<String, Object?>;
    expect(
      [for (final s in signoffs) (valueOf(s)['noteId'], valueOf(s)['act'])],
      [for (final p in planned) (ids[p['note']], p['act'])],
    );
    for (final (i, s) in signoffs.indexed) {
      final n = byRef(planned[i]['note']! as String);
      expect(valueOf(s)['statementVersion'], statements[n['act']]);
      expect(valueOf(s)['claimedCredential'], n['act'] == 'sign' ? resident.user.credential : isNull);
    }
    expect(step4['readOnly'], isTrue);
    for (final n in notes) {
      final id = ids[n['ref']]!;
      expect([resident.repo.readNote(id)!.editable, resident.repo.readNote(id)!.waitingToSend], [false, true]);
      expect(() => resident.repo.saveAnswer(id, answersOf(n).keys.first, null), throwsA(isA<RecordLocked>()));
    }
    // The patient's chart opens, offline, with the visit marked "Waiting to send".
    expect([step4['opens'], step4['visitLabel']], ['chart', 'Waiting to send']);
    expect(await resident.patients.patients.open(patientId), isNotNull);
    final visitRow = (await resident.repo.openTimeline(patientId)).rows
        .whereType<TimelineVisitRow>()
        .singleWhere((r) => r.encounterId == visit);
    expect([visitRow.waitingToSend, visitRow.onPhone, visitRow.status], [true, true, NoteStatus.signed]);

    // 5. The phone reconnects: every change confirmed by hash; four sign-offs, three signed and one
    // completed; the Medical notes wait for an attending; the visit is signed; one event per sign-off.
    final mark5 = await auditMark();
    resident.network.offline = false;
    final secondPush = resident.store.outbox();
    expect(await resident.sync(), isA<SyncDone>());
    resident.expectHashConfirmed(expectAt(5, 'receipts'), secondPush);
    final step5 = expectAt(5, 'server');
    for (final (i, s) in signoffs.indexed) {
      expect(
        resident.network.receipts[s.changeId]!['details'],
        containsPair('effect', byRef(planned[i]['note']! as String)['effect']),
      );
    }
    final read5 = await admin.getEncounter(encounterId: visit);
    expect(read5.status.wire, step5['encounterStatus']);
    expect(read5.summary, assessment);
    final made = [for (final n in read5.notes) ...n.signoffs];
    expect(made, hasLength(step5['signoffs']! as int));
    final effects = <String, int>{};
    for (final s in made) {
      effects.update(s.effect.wire, (c) => c + 1, ifAbsent: () => 1);
    }
    expect(effects, step5['effects']);
    expect(step5['notes'], 'afterStep5');
    for (final (i, s) in signoffs.indexed) {
      final n = byRef(planned[i]['note']! as String);
      final note = read5.notes.singleWhere((x) => x.noteId == ids[n['ref']]);
      final after = n['afterStep5']! as Map<String, Object?>;
      expect(
        [note.status.wire, note.attestation.wire],
        [after['status'], after['attestation']],
        reason: n['ref'] as String,
      );
      final signoff = note.signoffs.single;
      expect(
        [signoff.id, signoff.act.wire, signoff.effect.wire, signoff.signer.userId, signoff.credential.wire],
        [s.recordId, n['act'], n['effect'], resident.user.userId, resident.user.credential],
      );
      expect(signoff.statementVersion, statements[n['act']]);
    }
    final finished = await serverNotes(ids.values);
    for (final n in notes) {
      expect(answersIn(finished[ids[n['ref']]]!), finalAnswers(n), reason: n['ref'] as String);
    }
    // One event per sign-off, on its note, naming the sign-off, from the resident's phone.
    final events5 = [
      for (final e in await auditAfter(mark5))
        if (e.action == 'note.signed' || e.action == 'note.completed') e,
    ];
    final counted = <String, int>{};
    for (final e in events5) {
      counted.update(e.action, (c) => c + 1, ifAbsent: () => 1);
    }
    expect(counted, step5['events']);
    for (final (i, s) in signoffs.indexed) {
      final n = byRef(planned[i]['note']! as String);
      final e = events5.singleWhere((e) => e.entityId == ids[n['ref']]);
      expect(
        [e.action, e.entity, e.patientId, e.actor.userId, e.deviceId, e.details['signoffId'], e.details['effect']],
        [n['event'], entityNote, patientId, resident.user.userId, deviceId, s.recordId, n['effect']],
      );
    }

    // 6. The phone's sync finishes: the visit and its notes have left the phone, and Notes to finish
    // is empty, on the phone and on the server.
    final step6 = expectAt(6, 'phone');
    expect(resident.store.record(visit), isNull);
    for (final id in ids.values) {
      expect(resident.store.record(id), isNull);
    }
    expect([
      for (final r in resident.held(entityEncounter))
        if (r.id == visit) r,
    ], hasLength(step6['encounters']! as int));
    expect([
      for (final r in resident.held(entityNote))
        if (r.attributes['encounterId'] == visit) r,
    ], hasLength(step6['notes']! as int));
    final step6Server = expectAt(6, 'server');
    final online6 = await resident.toFinish.open();
    expect(online6.online, isTrue);
    expect(online6.rows.where((r) => r.encounterId == visit), hasLength(step6['notesToFinish']! as int));
    expect(
      (await resident.api.notesToFinish()).where((n) => n.encounterId == visit),
      hasLength(step6Server['notesToFinish']! as int),
    );
    expect((await resident.phone.engine.api.getHomeCounts()).notesToFinish, countsBefore);

    // 7. An attending, online, opens the attestation queue and attests the visit in one action.
    final step7 = expectAt(7, 'server');
    final mark7 = await auditMark();
    final queueBefore = step7['queueBefore']! as Map<String, Object?>;
    final rows = (await attending.api.attestationQueue()).where((r) => r.encounterId == visit).toList();
    expect(rows, hasLength(queueBefore['visits']! as int));
    expect(rows.single.patientId, patientId);
    expect(
      [for (final n in rows.single.notes) n.noteId],
      [for (final ref in (queueBefore['notes']! as List<Object?>)) ids[ref]],
    );
    expect(rows.single.notes.every((n) => n.canAct), isTrue);
    final view = await attending.api.readVisit(visit);
    final attestPlan = attending.api.attestPlan(view)!;
    final attest = step7['attest']! as Map<String, Object?>;
    expect([attestPlan.canAct, attestPlan.cannotSeeAll], [true, isEmpty]);
    // The three, in the order the phone draws the visit: the Red flags note last (forms 6.2).
    expect(attestPlan.noteIds.toSet(), {for (final ref in (attest['notes']! as List<Object?>)) ids[ref]});
    expect(attestPlan.noteIds.last, ids['redFlags']);
    final done = await attending.api.secondAct(attestPlan);
    expect(done.keys, attestPlan.noteIds);
    expect(step7['notes'], 'afterStep7');
    final read7 = await admin.getEncounter(encounterId: visit);
    expect(read7.status.wire, step7['encounterStatus']);
    var attestations = 0;
    for (final n in notes) {
      final note = read7.notes.singleWhere((x) => x.noteId == ids[n['ref']]);
      final after = n['afterStep7']! as Map<String, Object?>;
      expect(
        [note.status.wire, note.attestation.wire],
        [after['status'], after['attestation']],
        reason: n['ref'] as String,
      );
      attestations += note.attestations.length;
      if ((attest['notes']! as List<Object?>).contains(n['ref'])) {
        final a = note.attestations.single;
        expect(
          [a.attending.userId, a.signoffId, a.statementVersion],
          [attending.user.userId, note.signoffs.single.id, statements['attest']],
        );
      } else {
        expect(note.attestations, isEmpty);
      }
    }
    expect(attestations, step7['attestations']);
    // The queue's view and one note.attested per note, logged; the patient's name in none.
    final events7 = await auditAfter(mark7);
    final expectedEvents = (step7['events']! as Map<String, Object?>).cast<String, int>();
    final viewed = events7.where((e) => e.action == 'attestation_queue.viewed').toList();
    expect(viewed, hasLength(expectedEvents['attestation_queue.viewed']!));
    expect(
      [viewed.single.actor.userId, viewed.single.details['patientIds']],
      [attending.user.userId, contains(patientId)],
    );
    final attested = events7.where((e) => e.action == 'note.attested').toList();
    expect(attested, hasLength(expectedEvents['note.attested']!));
    expect({for (final e in attested) e.entityId}, attestPlan.noteIds.toSet());
    expect(attested.every((e) => e.actor.userId == attending.user.userId && e.patientId == patientId), isTrue);
    // The resident has one note_attested notice for the visit.
    final notices = (step7['notices']! as Map<String, Object?>)['resident']! as Map<String, Object?>;
    for (final MapEntry(key: kind, value: count) in notices.entries) {
      expect(
        (await resident.phone.engine.api.listNotices()).where((x) => x.kind == kind && x.recordId == visit),
        hasLength(count! as int),
      );
    }
    // Then none.
    final queueAfter = step7['queueAfter']! as Map<String, Object?>;
    expect(
      (await attending.api.attestationQueue()).where((r) => r.encounterId == visit),
      hasLength(queueAfter['visits']! as int),
    );

    // Nothing the story wrote is in an audit event's details: no name, no answer in words.
    final details = jsonEncode([for (final e in await auditAfter(mark0)) e.details]);
    for (final never in (story['neverInAuditDetails']! as List<Object?>).cast<String>()) {
      expect(details, isNot(contains(never)));
    }
  }, skip: skip);
}

/// One phone on the real API: its patient services and the domain layer for visits and notes, made
/// as the app makes them when the team's database opens, and made again after a restart.
class _LivePhone {
  _LivePhone(this.phone, this.network, this.user, this.released) {
    attach();
  }

  final TestPhone phone;
  final _Network network;
  final EncounterUser user;
  final Map<(String, int), NoteTypeDef> released;
  late PatientServices patients;
  late EncounterRepository repo;
  late EncounterApi api;
  late NotesToFinish toFinish;
  late CloseSweep sweep;

  LocalStore get store => phone.store;

  void attach() {
    patients = PatientServices(
      OpenTeam(
        userId: phone.userId,
        teamId: phone.teamId,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: user.permissions.toList(),
      ),
      copy: (_) async => true,
    );
    final definitions = NoteDefinitions(held: (key, version) async => released[(key, version)]);
    repo = EncounterRepository(
      phone.store,
      user: user,
      definitions: definitions,
      noteTypes: () async => released.values,
      openServerRecord: phone.engine.openServerRecord,
    );
    api = EncounterApi(phone.engine.api, phone.store, user: user, definitions: definitions);
    toFinish = NotesToFinish(
      phone.store,
      user: user,
      api: api,
      titleOf: (key) => released.values.where((d) => d.key == key).firstOrNull?.title,
      patientName: (id) => patients.index.entry(id)?.preferredName,
    );
    sweep = CloseSweep(phone.store, now: () => phone.clock.stamp().correctedTime);
    phone.engine.refreshers
      ..clear()
      ..addAll([...patients.refreshers, sweep]);
  }

  Future<SyncOutcome> sync() => phone.engine.syncAll(force: true);

  List<LocalRecord> held(String entity) => [
    for (final id in store.recordIds())
      if (store.record(id)!.entity == entity) store.record(id)!,
  ];

  /// A note's answers as the phone holds them, by path.
  Map<String, Object?> answersOnPhone(String noteId) => {
    for (final MapEntry(:key, :value) in store.record(noteId)!.fields.entries)
      if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
  };

  /// Every change [outbox] held reached the server, which accepted it and answered with the hash the
  /// phone sent; nothing waits or was refused.
  void expectHashConfirmed(Map<String, Object?> expected, List<OutboxEntry> outbox) {
    expect(expected, {'status': 'accepted', 'hashConfirmed': true});
    expect(outbox, isNotEmpty);
    for (final e in outbox) {
      final receipt = network.receipts[e.changeId];
      expect(
        [receipt?['status'], receipt?['hash']],
        ['accepted', e.valueHash],
        reason: '${e.entity} ${e.op} ${e.field}',
      );
    }
    expect([store.outbox(), store.needsAttention()], [isEmpty, isEmpty]);
  }
}

/// The real API behind a switchable network, keeping each push's answers.
class _Network implements ApiTransport {
  _Network(this.inner);
  final ApiTransport inner;
  bool offline = false;

  /// The changes each push that reached the server carried, by change ID.
  final pushed = <String>[];

  /// The server's answer to each change, by change ID.
  final receipts = <String, Map<String, Object?>>{};

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    final answer = await inner.send(method, path, query: query, body: body);
    if (method == 'POST' && path == '/v1/sync/push') {
      final sent = jsonDecode(jsonEncode(body)) as Map<String, Object?>;
      pushed.addAll([
        for (final c in (sent['changes']! as List<Object?>).cast<Map<String, Object?>>()) c['changeId']! as String,
      ]);
      for (final r in ((answer! as Map<String, Object?>)['results']! as List<Object?>).cast<Map<String, Object?>>()) {
        receipts[r['changeId']! as String] = r;
      }
    }
    return answer;
  }
}
