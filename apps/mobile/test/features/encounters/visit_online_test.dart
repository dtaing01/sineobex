import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/chart_cache.dart' show chartMetaField;
import 'package:sineobex_field/sync/entities.dart' show entityAddendum, entityEncounter, entityNote;
import 'package:sineobex_field/sync/local_store.dart' show ServerField, ServerRecord, entityPatient;

import '../../encounters/scripted_api.dart' show signoffJson, userRef, visitJson, visitNoteJson;
import 'encounter_kit.dart';

/// The visit read from the server (lifecycle 9.7, 5.1; cards L5-visit-envelope, L5-visit-trail and
/// L5-visit-actions): what hangs off each note in time order, a corrected answer struck through, the
/// records made at the visit with "On another chart now", an addendum made to it from the phone;
/// and Co-sign and Attest (3.7, 5.3, 5.4, 9.9), online only, on a visit read from the server, with
/// the sentence the person signs above the button. The phone's test server has no encounter routes:
/// each test answers them as the API does. Three themes, 200% text, 320 wide.
void main() {
  const visit = 'e0000000-0000-4000-8000-0000000000a1';
  const note = 'f0000000-0000-4000-8000-0000000000a2';
  const signoff = 'f1000000-0000-4000-8000-0000000000a3';
  const elsewhere = 'd0000000-0000-4000-8000-0000000000a4';
  const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  final blairRef = userRef(blair, blairName);
  const myName = 'Jordan Lee (demo)';
  final meRef = userRef(me, myName);

  final concern = <String, Object?>{
    'id': 'reason',
    'title': 'Reason for encounter',
    'items': [
      {
        'path': 'reason.concern',
        'labels': ['Chief concern'],
        'value': 'Demo: cough and a fever',
        'corrections': [
          {
            'path': 'reason.concern',
            'old': 'Demo: cough',
            'by': blairName,
            'credential': 'attending',
            'at': '2026-10-19T17:00:00.000Z',
            'reason': 'Demo: the fever was missed',
          },
        ],
      },
    ],
  };

  Map<String, Object?> snapshot(String entity, String id, Map<String, Object?> attributes) => {
    'entity': entity,
    'id': id,
    'status': 'active',
    'authorUserId': blair,
    'createdAt': '2026-10-19T16:00:00.000Z',
    'updatedAt': '2026-10-19T16:00:00.000Z',
    'version': 1,
    'attributes': attributes,
    'fields': <String, Object?>{},
  };

  /// Demo Blair's General / primary care note, signed, then corrected and added to by them.
  Map<String, Object?> signedVisit() => visitJson(
    encounterId: visit,
    patientId: p1Id,
    status: 'signed',
    clockVerified: false,
    locationText: 'Demo: under the bridge',
    summary: 'Demo: better by evening',
    notes: [
      visitNoteJson(
        noteId: note,
        author: blairRef,
        key: 'general_primary_care',
        title: 'General / primary care',
        status: 'signed',
        sections: [concern],
        recap: [
          {'section': 'reason', 'text': 'Chief concern: Demo: cough and a fever'},
        ],
        // Given out of order: the screen puts them in the order made.
        addenda: [
          {
            'id': 'f2000000-0000-4000-8000-0000000000a5',
            'noteId': note,
            'author': blairRef,
            'credential': 'attending',
            'text': 'Demo: the swab came back clear',
            'writtenAt': '2026-10-20T18:00:00.000Z',
            'clockVerified': true,
          },
        ],
        corrections: [
          {
            'id': 'f3000000-0000-4000-8000-0000000000a6',
            'corrector': blairRef,
            'credential': 'attending',
            'fields': ['data.reason.concern'],
            'outcome': 'corrected',
            'reason': 'Demo: the fever was missed',
            'requestedByPatient': false,
            'correctedAt': '2026-10-19T17:00:00.000Z',
            'clockVerified': true,
          },
        ],
        signoffs: [
          signoffJson(
            id: signoff,
            signer: blairRef,
            act: 'sign',
            effect: 'signed',
            credential: 'attending',
            signedAt: '2026-10-19T16:00:00.000Z',
          ),
        ],
      ),
    ],
    records: [
      snapshot('problem', 'c0000000-0000-4000-8000-0000000000a7', {
        'patientId': p1Id,
        'title': 'Demo: chest cold',
        'code': null,
        'sensitive': false,
      }),
      // Made for someone this visit no longer belongs to.
      snapshot('referral', 'c1000000-0000-4000-8000-0000000000a8', {
        'patientId': elsewhere,
        'referredOn': '2026-10-19',
        'details': 'Demo: chest x-ray',
        'encounterId': visit,
      }),
    ],
  );

  /// Demo Blair's note completed by a student, waiting for a co-signer, with [hash] for a reader who
  /// sees every answer of it (5.1), and [extra] sign-offs after the student's Complete.
  Map<String, Object?> waitingVisit({
    String status = 'completed',
    String attestation = 'not_needed',
    String? contentHash = hash,
    List<Map<String, Object?>> extra = const [],
    List<Map<String, Object?>> attestations = const [],
  }) => visitJson(
    encounterId: visit,
    patientId: p1Id,
    status: status,
    notes: [
      visitNoteJson(
        noteId: note,
        author: blairRef,
        key: 'general_primary_care',
        title: 'General / primary care',
        status: status,
        attestation: attestation,
        contentHash: contentHash,
        sections: [concern],
        signoffs: [
          signoffJson(id: signoff, signer: blairRef, credential: status == 'completed' ? 'student' : 'resident'),
          ...extra,
        ],
        attestations: attestations,
      ),
    ],
  );

  for (final run in runs) {
    testWidgets(
      'read from the server: the trail in time order, a correction struck through, the records (${runName(run)})',
      (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signInToChart(tester, run: run);
        final routes = await withEncounterRoutes(tester, h);
        routes.on('GET', '/v1/encounters/$visit', (_) => signedVisit());
        h.server.offline = false;
        final store = h.sync.store!;
        final before = auditEvents(store).length;
        await openVisitScreen(tester, visit);
        expect(routes.asked.map((a) => a.path), ['/v1/encounters/$visit']);

        // The envelope, the time not verified said in words.
        expect(
          find.bySemanticsLabel(
            RegExp(r'^Del, Medical visit, Started .*, time not verified, Where: Demo: under the bridge$'),
          ),
          findsOneWidget,
        );
        await expectShown(tester, find.text('Demo: better by evening'));
        // The corrected answer: the new value, the old one struck through, read as replaced.
        await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Replaced: Demo: cough\n')));
        // Signed, then corrected, then the addendum: the order made.
        final lines = [
          find.textContaining(RegExp(r'^Signed by Demo Blair, Attending physician, October 19, 2026 at ')),
          find.textContaining(
            RegExp(r'^Corrected by Demo Blair, Attending physician, October 19, 2026 at .*: Chief concern$'),
          ),
          find.textContaining(RegExp(r'^Addendum by Demo Blair, Attending physician, October 20, 2026 at ')),
        ];
        for (final line in lines) {
          await expectShown(tester, line);
        }
        expect(tester.getTopLeft(lines[0]).dy, lessThan(tester.getTopLeft(lines[1]).dy));
        expect(tester.getTopLeft(lines[1]).dy, lessThan(tester.getTopLeft(lines[2]).dy));
        // A teammate's note: nothing to correct or reopen; an addendum may be added.
        expect(find.bySemanticsLabel(RegExp('^Correct ')), findsNothing);
        expect(find.text('Reopen'), findsNothing);
        await expectShown(tester, find.bySemanticsLabel('Add addendum to General / primary care'));

        // The records made at the visit, one on another chart now.
        await expectShown(tester, find.bySemanticsLabel('Problem: Demo: chest cold'));
        await expectShown(
          tester,
          find.bySemanticsLabel('Referral, October 19, 2026: Demo: chest x-ray, On another chart now'),
        );
        await expectScreenOk(tester);
        expectNoLegalName(tester);
        // The server logged its read; the phone logged nothing of it again.
        expect(auditEvents(store).skip(before), isEmpty);
        handle.dispose();
      },
    );
  }

  testWidgets('an addendum to a visit read from the server: the note brought to the phone, sent, read again', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    // The visit and the note are the test server's own, by a teammate: the addendum needs them.
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final routes = await withEncounterRoutes(tester, h);
    final serverVisit = h.server.seed(entityEncounter, {
      'kind': 'non_medical',
      'patientId': p1Id,
      'locationText': 'Demo: by the river',
    }, by: blair);
    final serverNote = h.server.seed(entityNote, {
      'encounterId': serverVisit,
      'noteTypeKey': 'social_needs',
      'noteTypeVersion': 1,
      'data': {
        'needs.needs': ['food'],
      },
    }, by: blair);
    h.server.finishNote(serverNote);
    Map<String, Object?> read({List<Map<String, Object?>> addenda = const []}) => visitJson(
      encounterId: serverVisit,
      patientId: p1Id,
      kind: 'non_medical',
      notes: [
        visitNoteJson(
          noteId: serverNote,
          author: blairRef,
          key: 'social_needs',
          title: 'Social needs',
          group: 'social',
          addenda: addenda,
          signoffs: [signoffJson(id: signoff, signer: blairRef, credential: 'chw')],
        ),
      ],
    );
    routes.on('GET', '/v1/encounters/$serverVisit', (_) => read());
    await openVisitScreen(tester, serverVisit);
    expect(h.sync.store!.record(serverNote), isNull);

    await tapOn(tester, find.bySemanticsLabel('Add addendum to Social needs'));
    await revealInSheet(tester, find.byKey(const ValueKey('phi.addendum')));
    await tester.enterText(find.byKey(const ValueKey('phi.addendum')), 'Demo: food bank card given');
    await tester.pump();
    // Sent at once with signal; the server's read then carries it.
    routes.on(
      'GET',
      '/v1/encounters/$serverVisit',
      (_) => read(
        addenda: [
          {
            'id': h.server.records.values.firstWhere((r) => r.entity == entityAddendum).id,
            'noteId': serverNote,
            'author': meRef,
            'credential': 'attending',
            'text': 'Demo: food bank card given',
            'writtenAt': '2026-10-22T15:00:00.000Z',
            'clockVerified': true,
          },
        ],
      ),
    );
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Add addendum'));
    await settle(tester);
    expect(h.sync.store!.outbox().where((e) => e.entity == entityAddendum), isEmpty);
    expect(routes.asked.where((a) => a.method == 'GET'), hasLength(2));
    await expectShown(
      tester,
      find.textContaining(RegExp('^Addendum by ${RegExp.escape(myName)}, Attending physician, ')),
    );
    await expectShown(tester, find.text('Demo: food bank card given'));
    // The rest of the visit as the server read it: its note's sign-off is still there.
    await expectShown(tester, find.textContaining(RegExp('^Completed by Demo Blair, Community health worker, ')));
  });

  for (final run in runs) {
    testWidgets(
      'Co-sign: the sentence above it, one tap for the waiting notes, the visit read again (${runName(run)})',
      (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signInToChart(tester, run: run);
        final routes = await withEncounterRoutes(tester, h);
        h.server.offline = false;
        routes.on('GET', '/v1/encounters/$visit', (_) => waitingVisit());
        Object? sent;
        routes.on('POST', '/v1/encounters/$visit/cosign', (body) {
          sent = body;
          routes.on(
            'GET',
            '/v1/encounters/$visit',
            (_) => waitingVisit(
              status: 'signed',
              extra: [
                signoffJson(
                  id: 'f4000000-0000-4000-8000-0000000000a9',
                  signer: meRef,
                  act: 'cosign',
                  effect: 'signed',
                  credential: 'attending',
                  signedAt: '2026-10-22T15:00:00.000Z',
                ),
              ],
            ),
          );
          return {
            'notes': [
              {'noteId': note, 'status': 'signed', 'attestation': 'not_needed'},
            ],
          };
        });
        await openVisitScreen(tester, visit);
        await expectShown(tester, find.text('I reviewed this note and agree with it.'));
        final cosign = find.widgetWithText(FilledButton, 'Co-sign');
        await expectShown(tester, cosign);
        expect(
          tester.getTopLeft(find.text('I reviewed this note and agree with it.')).dy,
          lessThan(tester.getTopLeft(cosign).dy),
        );
        expect(find.widgetWithText(FilledButton, 'Attest'), findsNothing);
        await expectScreenOk(tester);

        await tapOn(tester, cosign);
        expect(sent, {
          'notes': [
            {'noteId': note, 'contentHash': hash},
          ],
          'statementVersion': 'cosign-2026-11',
        });
        expect(find.text('Co-signed'), findsOneWidget);
        // Read again: co-signed by the person, and nothing more to co-sign.
        await expectShown(
          tester,
          find.textContaining(RegExp('^Co-signed by ${RegExp.escape(myName)}, Attending physician, ')),
        );
        expect(find.widgetWithText(FilledButton, 'Co-sign'), findsNothing);
        handle.dispose();
      },
    );
  }

  testWidgets('a note changed since the visit was read: says so, and reads it again', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    routes
      ..on('GET', '/v1/encounters/$visit', (_) => waitingVisit())
      ..refuse(
        'POST',
        '/v1/encounters/$visit/cosign',
        409,
        'content_changed',
        details: {
          'noteIds': [note],
        },
      );
    await openVisitScreen(tester, visit);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Co-sign'));
    await expectShown(tester, find.text('This visit changed. Read it again.'));
    expect(
      [for (final a in routes.asked) '${a.method} ${a.path}'],
      ['GET /v1/encounters/$visit', 'POST /v1/encounters/$visit/cosign', 'GET /v1/encounters/$visit'],
    );
  });

  testWidgets('a note with a part the person can’t open says so, and offers nothing to sign', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    // No hash: the reader may co-sign but doesn't see every answer that counts (5.1).
    routes.on('GET', '/v1/encounters/$visit', (_) => waitingVisit(contentHash: null));
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('This note has a part you can’t open. Ask a Program Admin.'));
    expect(find.widgetWithText(FilledButton, 'Co-sign'), findsNothing);
    expect(find.text('I reviewed this note and agree with it.'), findsNothing);
  });

  testWidgets('Attest: a signature that waits, attested by the person, the attestation shown', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    final signedByResident = signoffJson(
      id: signoff,
      signer: blairRef,
      act: 'sign',
      effect: 'signed',
      credential: 'resident',
    );
    routes.on('GET', '/v1/encounters/$visit', (_) => waitingVisit(status: 'signed', attestation: 'waiting'));
    Object? sent;
    routes.on('POST', '/v1/encounters/$visit/attest', (body) {
      sent = body;
      routes.on(
        'GET',
        '/v1/encounters/$visit',
        (_) => visitJson(
          encounterId: visit,
          patientId: p1Id,
          status: 'signed',
          notes: [
            visitNoteJson(
              noteId: note,
              author: blairRef,
              key: 'general_primary_care',
              title: 'General / primary care',
              status: 'signed',
              attestation: 'attested',
              sections: [concern],
              signoffs: [signedByResident],
              attestations: [
                {
                  'id': 'f5000000-0000-4000-8000-0000000000aa',
                  'signoffId': signoff,
                  'attending': meRef,
                  'attestedAt': '2026-10-22T15:00:00.000Z',
                  'statementVersion': 'attest-2026-11',
                },
              ],
            ),
          ],
        ),
      );
      return {
        'notes': [
          {'noteId': note, 'status': 'signed', 'attestation': 'attested'},
        ],
      };
    });
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('I reviewed this note and agree with the assessment and plan.'));
    expect(find.widgetWithText(FilledButton, 'Co-sign'), findsNothing);
    await tapOn(tester, find.widgetWithText(FilledButton, 'Attest'));
    expect(sent, {
      'notes': [
        {'noteId': note, 'contentHash': hash},
      ],
      'statementVersion': 'attest-2026-11',
    });
    await expectShown(
      tester,
      find.textContaining(RegExp('^Attested by ${RegExp.escape(myName)}, October 22, 2026 at ')),
    );
    expect(find.widgetWithText(FilledButton, 'Attest'), findsNothing);
  });

  testWidgets('a visit the server doesn’t give is not asked for again at every change', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    routes.refuse('GET', '/v1/encounters/$visit', 404, 'not_found');
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('This visit can’t be found.'));
    h.encounters.changed();
    await syncAndRefresh(tester, h);
    await settle(tester);
    expect(routes.asked, hasLength(1));
  });

  testWidgets('what the person added to a visit read from the server shows, waiting, until it is sent', (tester) async {
    final h = await signInToChart(tester);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final routes = await withEncounterRoutes(tester, h);
    final serverVisit = h.server.seed(entityEncounter, {'kind': 'non_medical', 'patientId': p1Id}, by: blair);
    final serverNote = h.server.seed(entityNote, {
      'encounterId': serverVisit,
      'noteTypeKey': 'social_needs',
      'noteTypeVersion': 1,
      'data': {
        'needs.needs': ['food'],
      },
    }, by: blair);
    h.server.finishNote(serverNote);
    routes.on(
      'GET',
      '/v1/encounters/$serverVisit',
      (_) => visitJson(
        encounterId: serverVisit,
        patientId: p1Id,
        kind: 'non_medical',
        notes: [
          visitNoteJson(
            noteId: serverNote,
            author: blairRef,
            key: 'social_needs',
            title: 'Social needs',
            group: 'social',
            signoffs: [signoffJson(id: signoff, signer: blairRef, credential: 'chw')],
          ),
        ],
      ),
    );
    await openVisitScreen(tester, serverVisit);
    // The push is lost on the way back: the addendum waits on the phone, and the server's read
    // doesn't have it.
    h.server.dropPushResponses = 1;
    await tapOn(tester, find.bySemanticsLabel('Add addendum to Social needs'));
    await revealInSheet(tester, find.byKey(const ValueKey('phi.addendum')));
    await tester.enterText(find.byKey(const ValueKey('phi.addendum')), 'Demo: food bank card given');
    await tester.pump();
    await tapInSheet(tester, find.widgetWithText(FilledButton, 'Add addendum'));
    await settle(tester);
    expect(h.sync.store!.outbox().where((e) => e.entity == entityAddendum), hasLength(1));
    expect(routes.asked.where((a) => a.method == 'GET'), hasLength(2));
    await expectShown(tester, find.text('Demo: food bank card given'));
    await expectShown(tester, find.text('Waiting to send'));
    await expectShown(tester, find.textContaining(RegExp('^Completed by Demo Blair, Community health worker, ')));
  });

  testWidgets('Correct on the person’s own note read from the server starts from its answers', (tester) async {
    final h = await signInToChart(tester);
    h.server.offline = false;
    await syncAndRefresh(tester, h);
    final routes = await withEncounterRoutes(tester, h);
    final serverVisit = h.server.seed(entityEncounter, {'kind': 'medical', 'patientId': p1Id}, by: me);
    final serverNote = h.server.seed(entityNote, {
      'encounterId': serverVisit,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {'reason.concern': 'Demo: cough'},
    }, by: me);
    h.server.finishNote(serverNote, status: 'signed');
    routes.on(
      'GET',
      '/v1/encounters/$serverVisit',
      (_) => visitJson(
        encounterId: serverVisit,
        patientId: p1Id,
        status: 'signed',
        notes: [
          visitNoteJson(
            noteId: serverNote,
            author: meRef,
            key: 'general_primary_care',
            title: 'General / primary care',
            status: 'signed',
            sections: [
              {
                'id': 'reason',
                'title': 'Reason for encounter',
                'items': [
                  {
                    'path': 'reason.concern',
                    'labels': ['Chief concern'],
                    'value': 'Demo: cough',
                    'corrections': <Object?>[],
                  },
                ],
              },
            ],
            signoffs: [signoffJson(id: signoff, signer: meRef, act: 'sign', effect: 'signed', credential: 'attending')],
          ),
        ],
      ),
    );
    await openVisitScreen(tester, serverVisit);
    expect(h.sync.store!.record(serverNote), isNull);
    await tapOn(tester, find.bySemanticsLabel('Correct Chief concern'));
    // Brought to the phone, with the visit: the input starts from what the note says.
    expect(h.sync.store!.record(serverNote), isNotNull);
    final box = find.descendant(of: find.byType(BottomSheet), matching: find.byKey(const ValueKey('phi.form.concern')));
    await revealInSheet(tester, box);
    expect(tester.widget<TextField>(box).controller!.text, 'Demo: cough');
  });

  testWidgets('one of the chart’s recent visits opens offline, logged here, and Co-sign waits for a connection', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    await withEncounterRoutes(tester, h);
    // The chart the phone keeps carries its last visits in full (lifecycle 5.2), as a chart read online
    // leaves it.
    final store = h.sync.store!;
    final p = h.server.records[p1Id]!;
    store.importServerRecord(
      ServerRecord(
        entity: entityPatient,
        id: p1Id,
        status: p.status,
        authorUserId: p.author,
        attributes: p.attributes,
        fields: {
          for (final MapEntry(:key, :value) in p.fields.entries)
            key: ServerField(value: value.value, version: value.version),
          chartMetaField: ServerField(
            value: {
              'partial': false,
              'downloadedAt': fixtureNow.toIso8601String(),
              'recentVisits': [waitingVisit()],
            },
            version: 0,
          ),
        },
      ),
      open: false,
    );
    await tester.runAsync(() => h.sync.syncNow());
    final before = auditEvents(store).length;
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('General / primary care'));
    await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Replaced: Demo: cough\n')));
    // Logged here, as the server logs a read: the visit, the note and its sign-off.
    expect(auditEvents(store).skip(before), ['encounter.viewed', 'note.viewed', 'note.viewed']);
    // Nothing is signed from a chart's copy: it is read from the server first, which needs signal.
    final greyed = find.widgetWithText(FilledButton, 'Connect to co-sign');
    await expectShown(tester, greyed);
    expect(tester.widget<FilledButton>(greyed).onPressed, isNull);
  });

  group('a visit read from the phone, which holds a teammate’s note waiting for a co-signer', () {
    /// The person's visit with Demo Blair's General / primary care note, completed by them as a
    /// student, brought to the phone as a sync brings it.
    Future<String> heldWaiting(WidgetTester tester, AppHarness h) async {
      h.server.offline = false;
      final held = startVisit(h);
      await syncAndRefresh(tester, h);
      h.server.credentials[blair] = 'student';
      final id = h.server.seed(entityNote, {
        'encounterId': held,
        'noteTypeKey': 'general_primary_care',
        'noteTypeVersion': 1,
        'data': {'reason.concern': 'Demo: cough'},
      }, by: blair);
      h.server.finishNote(id);
      expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, id)), isTrue);
      return held;
    }

    testWidgets('Co-sign reads the visit from the server first, then signs what was read', (tester) async {
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      final held = await heldWaiting(tester, h);
      final heldNote = noteOfType(h, held, 'general_primary_care')!.id;
      routes.on(
        'GET',
        '/v1/encounters/$held',
        (_) => visitJson(
          encounterId: held,
          patientId: p1Id,
          notes: [
            visitNoteJson(
              noteId: heldNote,
              author: blairRef,
              key: 'general_primary_care',
              title: 'General / primary care',
              contentHash: hash,
              sections: [concern],
              signoffs: [signoffJson(id: signoff, signer: blairRef)],
            ),
          ],
        ),
      );
      Object? sent;
      routes.on('POST', '/v1/encounters/$held/cosign', (body) {
        sent = body;
        return {
          'notes': [
            {'noteId': heldNote, 'status': 'signed', 'attestation': 'not_needed'},
          ],
        };
      });
      await openVisitScreen(tester, held);
      expect(routes.asked, isEmpty);
      // The first tap reads it there, and the person reads it: nothing is signed yet.
      await tapOn(tester, find.widgetWithText(FilledButton, 'Co-sign'));
      expect([for (final a in routes.asked) a.method], ['GET']);
      await expectShown(tester, find.text('This is the visit as it is now. Read it, then co-sign.'));
      await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Replaced: Demo: cough\n')));
      await tapOn(tester, find.widgetWithText(FilledButton, 'Co-sign'));
      expect(sent, {
        'notes': [
          {'noteId': heldNote, 'contentHash': hash},
        ],
        'statementVersion': 'cosign-2026-11',
      });
    });

    testWidgets('offline, Co-sign is greyed: Connect to co-sign', (tester) async {
      final h = await signInToChart(tester);
      await withEncounterRoutes(tester, h);
      final held = await heldWaiting(tester, h);
      h.server.offline = true;
      await tester.runAsync(() => h.sync.syncNow());
      await openVisitScreen(tester, held);
      final greyed = find.widgetWithText(FilledButton, 'Connect to co-sign');
      await expectShown(tester, greyed);
      expect(tester.widget<FilledButton>(greyed).onPressed, isNull);
      await expectShown(tester, find.text('I reviewed this note and agree with it.'));
      await expectScreenOk(tester);
    });
  });
}
