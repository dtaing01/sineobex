import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart' show SineobexApi;
import 'package:sineobex_field/encounters/credentials.dart';
import 'package:sineobex_field/encounters/encounter_api.dart';
import 'package:sineobex_field/encounters/encounter_models.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/features/encounters/visit_screen.dart' show withWaiting;
import 'package:sineobex_field/forms/answer_state.dart';
import 'package:sineobex_field/forms/definition.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import '../sync/test_note_types.dart';
import 'scripted_api.dart';

/// The visit screen online draws what the phone holds and has not sent over the server's read
/// (withWaiting, lifecycle 9.7). Co-sign and Attest send the server's hash of the note as the server
/// holds it (5.3, 5.4), so a note drawn from the phone's own copy, or under the phone's own patient
/// or assessment, is offered neither act (the coordinator's decision on review finding PA-5).
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const attending = 'a0000000-0000-4000-8000-00000000000a';
  const student = 'b0000000-0000-4000-8000-00000000000b';
  const visitId = 'e0000000-0000-4000-8000-000000000002';
  const noteId = 'f0000000-0000-4000-8000-000000000001';
  final serverHash = List.filled(64, 'a').join();
  final start = DateTime.utc(2026, 10, 20, 15);
  final medical = NoteTypeDef.fromJson(testNoteTypes.firstWhere((d) => d['key'] == testMedical.key));

  NoteView note({
    required NoteStatus status,
    Attestation attestation = Attestation.notNeeded,
    required Map<String, Object?> answers,
    Set<String> pendingPaths = const {},
    Map<String, AnswerConflict> conflicts = const {},
    String? contentHash,
    bool canCosign = false,
    bool canAttest = false,
  }) => NoteView(
    noteId: noteId,
    encounterId: visitId,
    noteTypeKey: medical.key,
    noteTypeVersion: medical.version,
    definition: medical,
    author: const PersonRef(student, name: 'Demo Student'),
    actingAuthor: const PersonRef(student, name: 'Demo Student'),
    actsAsAuthor: false,
    status: status,
    attestation: attestation,
    waitingToSend: false,
    sentForReview: false,
    editable: false,
    answers: answers,
    pendingPaths: pendingPaths,
    read: null,
    recap: const [],
    signoffs: const [],
    addenda: const [],
    corrections: const [],
    attestations: const [],
    notSynced: false,
    contentHash: contentHash,
    conflicts: conflicts,
    canCosign: canCosign,
    canAttest: canAttest,
  );
  VisitView visit(
    VisitSource source,
    List<NoteView> notes, {
    String? summary,
    String? patientId,
    Set<String> pendingFields = const {},
  }) => VisitView(
    encounterId: visitId,
    source: source,
    patientId: patientId,
    kind: VisitKind.medical,
    status: notes.firstOrNull?.status ?? NoteStatus.draft,
    startedAt: start,
    clockVerified: true,
    locationText: null,
    summary: summary,
    summaryHidden: false,
    envelopeLocked: false,
    addenda: const [],
    notes: notes,
    notSynced: false,
    pendingFields: pendingFields,
  );

  late EncounterApi api;
  setUp(() {
    final p = TestPhone(
      userId: attending,
      teamId: team,
      transport: () => FakeSyncServer(now: () => start).transportFor(attending, team),
      wall: start,
    );
    addTearDown(p.close);
    api = EncounterApi(
      SineobexApi(ScriptedApi()),
      p.store,
      user: EncounterUser(
        userId: attending,
        displayName: 'Demo Attending',
        credential: 'attending',
        permissions: FakeSyncServer.healthcareStaff,
      ),
      definitions: NoteDefinitions(held: (key, version) async => null),
    );
  });

  // The server: the student completed the note with their plan; the attending may co-sign it.
  final waitingCosign = visit(VisitSource.server, [
    note(
      status: NoteStatus.completed,
      answers: {'care.plan': 'Demo: student plan'},
      contentHash: serverHash,
      canCosign: true,
    ),
  ]);
  // The server: signed by a resident, waiting for the attending's attestation.
  final waitingAttest = visit(VisitSource.server, [
    note(
      status: NoteStatus.signed,
      attestation: Attestation.waiting,
      answers: {'care.plan': 'Demo: resident plan'},
      contentHash: serverHash,
      canAttest: true,
    ),
  ]);

  test('Co-sign: a note drawn from the phone’s copy, with the person’s choice still open, is not co-signed with the '
      'server’s hash, and says why', () {
    final held = visit(VisitSource.phone, [
      note(
        status: NoteStatus.completed,
        answers: {'care.plan': 'Demo: attending plan'},
        conflicts: {'care.plan': const AnswerConflict(theirs: 'Demo: student plan', by: ConflictBy.teammate)},
      ),
    ]);
    final shown = withWaiting(waitingCosign, held);
    final n = shown.notes.single;
    expect(n.answers['care.plan'], 'Demo: attending plan');
    expect([n.canCosign, n.contentHash, n.sendFirst], [false, null, true]);
    expect(api.cosignPlan(shown), isNull);
  });

  test('Attest: a note drawn from the phone’s copy, with an answer waiting to send, is not attested with the server’s '
      'hash, and says why', () {
    final held = visit(VisitSource.phone, [
      note(
        status: NoteStatus.signed,
        attestation: Attestation.waiting,
        answers: {'care.plan': 'Demo: attending addition'},
        pendingPaths: {'care.plan'},
      ),
    ]);
    final shown = withWaiting(waitingAttest, held);
    final n = shown.notes.single;
    expect([n.canAttest, n.contentHash, n.sendFirst], [false, null, true]);
    expect(api.attestPlan(shown), isNull);
  });

  test(
    'a note under the phone’s own assessment, waiting to send, is offered neither act; the server’s copy alone is',
    () {
      // The phone does not hold the note at all, but holds an assessment of the visit not sent yet.
      final mine = visit(VisitSource.phone, [], summary: 'Demo: my assessment', pendingFields: {'summary'});
      for (final (base, plan) in [(waitingCosign, api.cosignPlan), (waitingAttest, api.attestPlan)]) {
        final shown = withWaiting(base, mine);
        expect(shown.summary, 'Demo: my assessment');
        expect([shown.notes.single.contentHash, shown.notes.single.sendFirst], [null, true]);
        expect(plan(shown), isNull);
        // With nothing of the person's waiting, the server's note and its hash stand.
        final plain = withWaiting(base, visit(VisitSource.phone, []));
        expect([plain.notes.single.contentHash, plain.notes.single.sendFirst], [serverHash, false]);
        expect(plan(plain)!.notes, [(noteId: noteId, contentHash: serverHash)]);
      }
    },
  );

  // Review finding VS-2: the patient branch of the same rule. Every note's hash covers the visit's
  // patient, so one chosen on the phone and not sent yet takes both acts away too.
  test('a note under a patient chosen on the phone, waiting to send, is offered neither act', () {
    final mine = visit(
      VisitSource.phone,
      [],
      patientId: 'c0000000-0000-4000-8000-00000000c0de',
      pendingFields: {'patientId'},
    );
    for (final (base, plan) in [(waitingCosign, api.cosignPlan), (waitingAttest, api.attestPlan)]) {
      final shown = withWaiting(base, mine);
      final n = shown.notes.single;
      expect([n.canCosign, n.canAttest, n.contentHash, n.sendFirst], [false, false, null, true]);
      expect(plan(shown), isNull);
    }
  });
}
