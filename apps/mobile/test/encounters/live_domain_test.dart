import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sineobex_field/api/generated/api.dart' show Me, SineobexApi;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
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
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/phone_harness.dart';

/// The phone's domain layer for visits and notes (lifecycle 4.8, 5, 9) against the real API and
/// Postgres: what the phone's test server stands in for everywhere else. A quick note expanded into
/// its full note types and completed with the Red flags note the app adds, synced; and every online
/// call of `EncounterApi` (the visit read, co-sign, attest, notes to finish, Home's counts, earlier
/// visits) on the real routes, with the answers and refusals the screens turn into words.
/// tools/live-sync.sh runs it last, on the seeded demo team, whose note types are the released ones
/// the phone bundles. Every patient is made by a phone push, with a name unique to this run.
void main() {
  final apiUrl = Platform.environment['SINEOBEX_LIVE_API'];
  final idpUrl = Platform.environment['SINEOBEX_LIVE_IDP'];
  final skip = apiUrl == null || idpUrl == null ? 'set SINEOBEX_LIVE_API and SINEOBEX_LIVE_IDP to run' : null;
  if (Platform.environment['SINEOBEX_LIVE_REQUIRED'] == '1' && skip != null) {
    test('the live API is configured', () => fail(skip));
    return;
  }

  // The made-up demo team (db/seed/seed.ts).
  const team = '0d3e6f00-0000-4000-8000-000000000001';
  final client = http.Client();
  final phones = <_LivePhone>[];
  final run = Random().nextInt(1 << 30).toRadixString(36);

  // The released note types, as the phone bundles them and the seed installs them.
  final released = {
    for (final p in (jsonDecode(
      File('assets/forms/presets.json').readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>())
      (p['key']! as String, p['version']! as int): NoteTypeDef.fromJson(p['definition']! as Map<String, Object?>),
  };
  NoteTypeDef type(String key) => released[(key, 1)]!;

  Future<({String userId, Tokens tokens, Me me})> signIn(String email) async {
    final auth = DevAuthProvider(url: Uri.parse(idpUrl!), client: client);
    final challenge = await auth.signIn(email, 'sineobex-demo') as MfaChallenge;
    final tokens = await auth.verifyMfa(challenge.tokens, challenge.factorId, '000000');
    final me = await SineobexApi(
      HttpTransport(baseUrl: Uri.parse(apiUrl!), client: client, accessToken: () => tokens.accessToken),
    ).getMe();
    return (userId: me.user.id, tokens: tokens, me: me);
  }

  /// A phone signed in as [email], with its saved profile's credential, or [credential] when the
  /// profile it holds is older than the server's.
  Future<_LivePhone> phone(String email, {String? credential}) async {
    final who = await signIn(email);
    final network = _Network(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
    final membership = who.me.teams.singleWhere((t) => t.teamId == team);
    final p = _LivePhone(
      TestPhone(userId: who.userId, teamId: team, transport: () => network, realTime: DateTime.now),
      network,
      EncounterUser(
        userId: who.userId,
        displayName: who.me.user.displayName,
        credential: credential ?? membership.credential.wire,
        permissions: [for (final k in membership.permissions) k.wire],
      ),
      NoteDefinitions(held: (key, version) async => released[(key, version)]),
      released.values,
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

  /// A patient made by [p] and pushed at once.
  Future<String> registered(_LivePhone p, String base) async {
    final id = p.patients.patients
        .createPatient(
          Intake(consent: const ConsentAnswer.given(), preferredName: '$base$run', visualDescriptor: 'Demo: grey coat'),
        )
        .patientId;
    await p.sync();
    return id;
  }

  /// A note of [key] added to [visit] through the domain layer, its [answers] saved as the form saves
  /// them.
  Future<String> charted(_LivePhone p, String visit, String key, Map<String, Object?> answers) async {
    final id = (await p.repo.addNote(visit, type(key), another: true)).noteId;
    await p.repo.openNote(id);
    for (final MapEntry(:key, :value) in answers.entries) {
      p.repo.saveAnswer(id, key, value);
    }
    return id;
  }

  /// The Red flags note the app added to [visit] with its first Medical note, answered: no emergency.
  /// An empty draft, which no list shows (3.1), until then.
  Future<String> redFlagsAnswered(_LivePhone p, String visit) async {
    final flags = (await p.repo.ownRedFlagsNote(visit))!;
    await p.repo.openNote(flags);
    p.repo.saveAnswer(flags, 'red_flags.emergency', 'no');
    return flags;
  }

  /// Complete on the summary screen: nothing stops it, and every one of [notes] is finished.
  Future<void> completed(_LivePhone p, String visit, Set<String> notes, {required SignoffAct act}) async {
    final plan = (await p.repo.openComplete(visit))!;
    expect(plan.stops, isEmpty);
    expect({for (final n in plan.notes) n.noteId}, notes);
    expect({for (final n in plan.notes) n.act}, {act});
    p.repo.complete(plan);
  }

  Matcher failed(EncounterProblem problem, [String? message]) => throwsA(
    isA<EncounterRequestFailed>()
        .having((e) => e.problem, 'problem', problem)
        .having((e) => e.message, 'message', message ?? isNotEmpty),
  );

  test('a quick note expanded into General and Wound care, completed offline with the Red flags note the '
      'app added, reaches the server signed, every answer as written', () async {
    final a = await phone('clinician@example.com');
    final reader = await phone('resident@example.com');
    final patient = await registered(a, 'Quix');
    a.network.offline = true;
    final visit = a.repo.startEncounter(kind: VisitKind.medical, patientId: patient);
    final quick = await charted(a, visit, 'quick_encounter', {
      'visit.parts': ['general', 'wound'],
      'general.concern': 'Demo: cough for a week',
      'general.hpi': 'yes',
      'general.hpi_details': 'Demo: worse at night',
      'general.bp.systolic': 128,
      'general.bp.diastolic': 82,
      'general.hr': 96,
      'general.temp': 99.1,
      'wound.type': 'abscess',
      'wound.location.region': 'legs',
      'wound.location.side': 'left',
      'wound.dimensions.length': 2.5,
      'wound.dimensions.width': 1.5,
      'wound.drainage': 'small',
      'wound.dressing': ['gauze'],
    });
    final general = await a.repo.expand(quick, type('general_primary_care'));
    final wound = await a.repo.expand(quick, type('wound_care'));
    expect([general.leftOut, wound.leftOut], [isEmpty, isEmpty]);
    final flags = await redFlagsAnswered(a, visit);
    // One Red flags note, the app's, came with the quick note: Expand adds no second.
    expect((await a.repo.openVisit(visit))!.notes.where((n) => n.noteTypeKey == 'red_flags_disposition'), hasLength(1));
    await completed(a, visit, {quick, general.noteId, wound.noteId, flags}, act: SignoffAct.sign);

    a.network.offline = false;
    await a.sync();
    expect([a.store.outbox(), a.store.needsAttention()], [isEmpty, isEmpty]);

    // The server's read of the visit (5.1): four notes, each signed by an attending, nothing to attest.
    final read = await a.api.readVisit(visit);
    expect(read.source, VisitSource.server);
    expect(
      {for (final n in read.notes) n.noteId: (n.noteTypeKey, n.status, n.attestation)},
      {
        quick: ('quick_encounter', NoteStatus.signed, Attestation.notNeeded),
        general.noteId: ('general_primary_care', NoteStatus.signed, Attestation.notNeeded),
        wound.noteId: ('wound_care', NoteStatus.signed, Attestation.notNeeded),
        flags: ('red_flags_disposition', NoteStatus.signed, Attestation.notNeeded),
      },
    );
    // Every expanded answer reached the server as the phone wrote it.
    for (final (id, written) in [(general.noteId, general.written), (wound.noteId, wound.written)]) {
      expect(await reader.phone.engine.openServerRecord(entityNote, id), isTrue);
      final onServer = {
        for (final MapEntry(:key, :value) in reader.store.record(id)!.fields.entries)
          if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
      };
      expect(onServer, written, reason: id);
    }
  }, skip: skip);

  test('co-sign online: notes completed for a co-signer, read from the server and co-signed with their '
      'hashes; the same act again is refused as changed', () async {
    // The resident's phone still holds a student's profile (the credential changed since it last
    // asked): Complete sends `complete`, and the server keeps each note for a co-signer (3.4).
    final r = await phone('resident@example.com', credential: 'student');
    final c = await phone('clinician@example.com');
    final patient = await registered(r, 'Cosq');
    final visit = r.repo.startEncounter(kind: VisitKind.medical, patientId: patient);
    final general = await charted(r, visit, 'general_primary_care', {'reason.concern': 'Demo: sore throat'});
    final flags = await redFlagsAnswered(r, visit);
    await completed(r, visit, {general, flags}, act: SignoffAct.complete);
    await r.sync();
    expect([r.store.outbox(), r.store.needsAttention()], [isEmpty, isEmpty]);

    // Home's count and the queue show it to an attending; the resident's own read offers no co-sign of
    // what they completed.
    final tiles = await c.api.homeTiles(notesToFinish: (_) => (notes: 0, overdue: 0));
    expect([tiles.online, tiles.showsCosign, tiles.cosignWaiting], [true, true, greaterThanOrEqualTo(1)]);
    final row = (await c.api.cosignQueue()).singleWhere((q) => q.encounterId == visit);
    expect({for (final n in row.notes) n.noteId: n.canAct}, {general: true, flags: true});
    expect(r.api.cosignPlan(await r.api.readVisit(visit)), isNull);

    final view = await c.api.readVisit(visit);
    expect({for (final n in view.notes) n.status}, {NoteStatus.completed});
    final plan = c.api.cosignPlan(view)!;
    expect(
      [plan.canAct, plan.noteIds.toSet(), plan.cannotSeeAll],
      [
        true,
        {general, flags},
        isEmpty,
      ],
    );
    final done = await c.api.secondAct(plan);
    expect(done, {
      general: (status: NoteStatus.signed, attestation: Attestation.notNeeded),
      flags: (status: NoteStatus.signed, attestation: Attestation.notNeeded),
    });
    expect((await c.api.cosignQueue()).where((q) => q.encounterId == visit), isEmpty);
    // Acting on the old read: nothing waits any more, so the screen reads the visit again.
    await expectLater(c.api.secondAct(plan), failed(EncounterProblem.changed));
  }, skip: skip);

  test('attest online: a resident’s signed notes, attested by an attending from the server’s read', () async {
    final r = await phone('resident@example.com');
    final c = await phone('clinician@example.com');
    final patient = await registered(r, 'Attq');
    final visit = r.repo.startEncounter(kind: VisitKind.medical, patientId: patient);
    final general = await charted(r, visit, 'general_primary_care', {'reason.concern': 'Demo: rash'});
    final flags = await redFlagsAnswered(r, visit);
    await completed(r, visit, {general, flags}, act: SignoffAct.sign);
    await r.sync();
    expect([r.store.outbox(), r.store.needsAttention()], [isEmpty, isEmpty]);

    final tiles = await c.api.homeTiles(notesToFinish: (_) => (notes: 0, overdue: 0));
    expect([tiles.showsAttestation, tiles.attestationWaiting], [true, greaterThanOrEqualTo(1)]);
    expect((await r.api.homeTiles(notesToFinish: (_) => (notes: 0, overdue: 0))).showsAttestation, isFalse);
    final row = (await c.api.attestationQueue()).singleWhere((q) => q.encounterId == visit);
    expect({for (final n in row.notes) n.noteId}, {general, flags});

    final view = await c.api.readVisit(visit);
    expect({for (final n in view.notes) (n.status, n.attestation)}, {(NoteStatus.signed, Attestation.waiting)});
    // A resident attests nothing, nor co-signs what is signed already.
    expect([r.api.attestPlan(view), c.api.cosignPlan(view)], [null, null]);
    final plan = c.api.attestPlan(view)!;
    expect(plan.noteIds.toSet(), {general, flags});
    final done = await c.api.secondAct(plan);
    expect({for (final v in done.values) v.attestation}, {Attestation.attested});
    expect((await c.api.attestationQueue()).where((q) => q.encounterId == visit), isEmpty);
    final again = await c.api.readVisit(visit);
    expect({for (final n in again.notes) n.attestation}, {Attestation.attested});
    expect(again.notes.firstWhere((n) => n.noteId == general).attestations.single.attending.userId, c.user.userId);
  }, skip: skip);

  test('notes to finish, Home’s counts and earlier visits from the server; offline, each says so', () async {
    final r = await phone('resident@example.com');
    final patient = await registered(r, 'Finq');
    final older = r.repo.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
    final social = await charted(r, older, 'social_needs', {
      'needs.needs': ['food'],
    });
    await completed(r, older, {social}, act: SignoffAct.complete);
    final newer = r.repo.startEncounter(kind: VisitKind.nonMedical, patientId: patient);
    final draft = await charted(r, newer, 'social_needs', {
      'needs.needs': ['phone'],
    });
    await r.sync();
    expect([r.store.outbox(), r.store.needsAttention()], [isEmpty, isEmpty]);

    // The server's list of the resident's drafts, and the phone's merged with it.
    final listed = await r.api.notesToFinish();
    expect([for (final n in listed) n.noteId], allOf(contains(draft), isNot(contains(social))));
    expect(listed.singleWhere((n) => n.noteId == draft).encounterId, newer);
    final merged = await NotesToFinish(r.store, user: r.user, api: r.api).open();
    expect(merged.online, isTrue);
    expect([for (final row in merged.rows) row.noteId], contains(draft));

    final tiles = await r.api.homeTiles(
      notesToFinish: (server) => (notes: server?.notesToFinish ?? -1, overdue: server?.notesOverdue ?? -1),
    );
    expect([tiles.online, tiles.notesToFinish.notes], [true, greaterThanOrEqualTo(1)]);

    // Show earlier visits: the visits before the newer one, newest first.
    expect([for (final v in await r.api.earlierVisits(patient, before: newer)) v.encounterId], [older]);
    expect(await r.api.earlierVisits(patient, before: older), isEmpty);

    // Offline: the phone's own list, Home's numbers without the server's, and the sentences.
    r.network.offline = true;
    expect((await NotesToFinish(r.store, user: r.user, api: r.api).open()).online, isFalse);
    final offline = await r.api.homeTiles(notesToFinish: (server) => (notes: server == null ? 0 : -1, overdue: 0));
    expect([offline.online, offline.cosignWaiting, offline.notesToFinish.notes], [false, null, 0]);
    await expectLater(r.api.notesToFinish(), failed(EncounterProblem.offline));
    await expectLater(r.api.earlierVisits(patient, before: newer), failed(EncounterProblem.offline));
    await expectLater(
      r.api.readVisit(older),
      failed(EncounterProblem.offline, 'This visit isn’t on this phone. Connect to open it.'),
    );
    r.network.offline = false;

    // A visit the team does not have, and a route the role may not use, refused in words.
    await expectLater(r.api.readVisit('00000000-0000-4000-8000-0000000000aa'), failed(EncounterProblem.notFound));
    final chw = await phone('chw@example.com');
    await expectLater(chw.api.notesToFinish(), failed(EncounterProblem.notAllowed));
  }, skip: skip);
}

/// One phone on the real API, with its patient services and the domain layer for visits and notes.
class _LivePhone {
  _LivePhone(this.phone, this.network, this.user, NoteDefinitions definitions, Iterable<NoteTypeDef> listed) {
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
    phone.engine.refreshers.addAll(patients.refreshers);
    repo = EncounterRepository(
      phone.store,
      user: user,
      definitions: definitions,
      noteTypes: () async => listed,
      openServerRecord: phone.engine.openServerRecord,
    );
    api = EncounterApi(phone.engine.api, phone.store, user: user, definitions: definitions);
  }

  final TestPhone phone;
  final _Network network;
  final EncounterUser user;
  late final PatientServices patients;
  late final EncounterRepository repo;
  late final EncounterApi api;

  LocalStore get store => phone.store;

  Future<void> sync() => phone.engine.syncAll(force: true);
}

/// The real API behind a switchable network.
class _Network implements ApiTransport {
  _Network(this.inner);
  final ApiTransport inner;
  bool offline = false;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    return inner.send(method, path, query: query, body: body);
  }
}
