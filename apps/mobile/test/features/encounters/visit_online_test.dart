import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:sineobex_field/features/encounters/visit_screen.dart' show visitLocation;
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
        // The server's answer for the reader (5.1 as built for L6): an attending who sees all of it
        // may act on what waits; one who can't open a part of it is told so.
        canCosign: status == 'completed' && contentHash != null,
        canAttest: attestation == 'waiting' && contentHash != null,
        heldBecause: contentHash == null ? 'cannot_see_all' : null,
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

  testWidgets('while the server’s read is on its way, a screen reader finds that the visit is loading (review '
      'finding PX-7)', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    final slow = Completer<Object?>();
    routes.on('GET', '/v1/encounters/$visit', (_) => slow.future);
    h.server.offline = false;
    final context = tester.element(find.byType(Navigator).first);
    unawaited(GoRouter.of(context).push(visitLocation(visit)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.bySemanticsLabel('Loading the visit'), findsOneWidget);
    slow.complete(signedVisit());
    await settle(tester);
    expect(find.bySemanticsLabel('Loading the visit'), findsNothing);
    handle.dispose();
  });

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
    // Said once, as a live region (review finding PX-6).
    final handle = tester.ensureSemantics();
    expect(
      tester.getSemantics(find.bySemanticsLabel('This visit changed. Read it again.')),
      isSemantics(isLiveRegion: true),
    );
    handle.dispose();
    expect(
      [for (final a in routes.asked) '${a.method} ${a.path}'],
      ['GET /v1/encounters/$visit', 'POST /v1/encounters/$visit/cosign', 'GET /v1/encounters/$visit'],
    );
  });

  // Review findings C-5 and VX-7: each of the visit screen's refusals is a live region, and the same
  // refusal on a second press is a new node, so it is said again.
  group('the visit screen’s refusals, pressed twice', () {
    Future<void> saidTwice(WidgetTester tester, String said, Future<void> Function() press) async {
      await press();
      final refusal = find.bySemanticsLabel(said);
      await expectShown(tester, refusal);
      final first = tester.getSemantics(refusal);
      expect(first, isSemantics(isLiveRegion: true));
      await press();
      await expectShown(tester, refusal);
      final second = tester.getSemantics(refusal);
      expect(second, isSemantics(isLiveRegion: true));
      expect(second.id, isNot(first.id));
    }

    testWidgets('Co-sign’s refusal', (tester) async {
      final handle = tester.ensureSemantics();
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
      await saidTwice(
        tester,
        'This visit changed. Read it again.',
        () => tapOn(tester, find.widgetWithText(FilledButton, 'Co-sign')),
      );
      handle.dispose();
    });

    // A teammate's visit and the person's own draft read from the server, which this phone can't
    // bring onto it: the server gives neither record.
    Map<String, Object?> elsewhere() => visitJson(
      encounterId: visit,
      patientId: p1Id,
      status: 'draft',
      notes: [
        visitNoteJson(
          noteId: note,
          author: meRef,
          key: 'general_primary_care',
          title: 'General / primary care',
          status: 'draft',
          completedAt: null,
        ),
      ],
    );

    testWidgets('Add or remove notes’ refusal, under the notes', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      h.server.offline = false;
      routes.on('GET', '/v1/encounters/$visit', (_) => elsewhere());
      await openVisitScreen(tester, visit);
      expect(h.sync.store!.record(visit), isNull);
      await saidTwice(
        tester,
        'This visit isn’t on this phone. Connect to open it.',
        () => tapOn(tester, find.bySemanticsLabel(RegExp('^Add or remove notes'))),
      );
      handle.dispose();
    });

    testWidgets('a note’s own refusal, under the note', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      h.server.offline = false;
      routes.on('GET', '/v1/encounters/$visit', (_) => elsewhere());
      await openVisitScreen(tester, visit);
      expect(h.sync.store!.record(note), isNull);
      await saidTwice(
        tester,
        'This note isn’t on this phone. Connect to open it.',
        () => tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note')),
      );
      handle.dispose();
    });
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

  testWidgets('a queue row for a visit the phone holds, without the teammate’s note: the server’s read shows it, '
      'with Co-sign, and the person’s own draft drawn over it', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final routes = await withEncounterRoutes(tester, h);
    // The person started the visit and keeps a draft of their own in it.
    final held = startVisit(h);
    final mine = await chart(tester, h, held, 'social_needs', {
      'needs.needs': ['food'],
    });
    await syncAndRefresh(tester, h);
    // A student completed a note of the visit on their own phone: the phone never fetches it.
    h.server.credentials[blair] = 'student';
    final theirs = h.server.seed(entityNote, {
      'encounterId': held,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {'reason.concern': 'Demo: cough'},
    }, by: blair);
    h.server.finishNote(theirs);
    await syncAndRefresh(tester, h);
    expect(h.sync.store!.record(theirs), isNull);
    routes
      ..on(
        'GET',
        '/v1/team/cosign-queue',
        (_) => {
          'rows': [
            {
              'encounterId': held,
              'patientId': p1Id,
              'preferredName': 'Del',
              'startedAt': '2026-10-20T15:00:00.000Z',
              'notes': [
                {
                  'noteId': theirs,
                  'noteTypeKey': 'general_primary_care',
                  'author': blairRef,
                  'completedAt': '2026-10-20T16:00:00.000Z',
                  'signedBefore': null,
                  'attestedBefore': null,
                  'canAct': true,
                },
              ],
            },
          ],
        },
      )
      ..on(
        'GET',
        '/v1/encounters/$held',
        (_) => visitJson(
          encounterId: held,
          patientId: p1Id,
          status: 'draft',
          notes: [
            visitNoteJson(
              noteId: theirs,
              author: blairRef,
              key: 'general_primary_care',
              title: 'General / primary care',
              contentHash: hash,
              sections: [concern],
              signoffs: [signoffJson(id: signoff, signer: blairRef)],
              canCosign: true,
            ),
          ],
        ),
      );
    Object? sent;
    routes.on('POST', '/v1/encounters/$held/cosign', (body) {
      sent = body;
      return {
        'notes': [
          {'noteId': theirs, 'status': 'signed', 'attestation': 'not_needed'},
        ],
      };
    });
    await go(tester, '/queues/cosign');
    await tapOn(tester, find.bySemanticsLabel(RegExp('^Del, Visit started October 20')));
    expect(location(tester), visitLocation(held));
    expect(routes.asked.map((a) => '${a.method} ${a.path}'), contains('GET /v1/encounters/$held'));
    await expectShown(tester, find.text('General / primary care'));
    await expectShown(tester, find.bySemanticsLabel(RegExp(r'^Replaced: Demo: cough\n')));
    // The person's own draft, which the server's read leaves out, opens as its form.
    await expectShown(tester, find.text('Social needs'));
    await expectShown(tester, find.bySemanticsLabel('Open the note, Social needs'));
    expect(find.text('This is the copy on this phone. What others added since may be missing.'), findsNothing);
    // One tap: what was read is what is signed.
    await tapOn(tester, find.widgetWithText(FilledButton, 'Co-sign'));
    expect(sent, {
      'notes': [
        {'noteId': theirs, 'contentHash': hash},
      ],
      'statementVersion': 'cosign-2026-11',
    });
    expect(mine, isNotNull);
  });

  testWidgets('a patient the phone doesn’t hold is named by the read’s preferred name; “On another chart now” '
      'is the read’s own answer', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    const stranger = 'd0000000-0000-4000-8000-0000000000b5';
    const problem = 'c0000000-0000-4000-8000-0000000000a7';
    const referral = 'c1000000-0000-4000-8000-0000000000a8';
    routes.on(
      'GET',
      '/v1/encounters/$visit',
      (_) => {
        ...signedVisit(),
        'patientId': stranger,
        'preferredName': 'Demo Wren',
        // By the patients' canonical charts: the problem, under an ID the phone can't tell is merged
        // away, is on another chart; the referral, under a merged ID of the visit's own, is not.
        'recordsOnAnotherChart': [problem],
      },
    );
    await openVisitScreen(tester, visit);
    expect(find.bySemanticsLabel(RegExp(r'^Demo Wren, Medical visit, Started ')), findsOneWidget);
    await expectShown(tester, find.bySemanticsLabel('Problem: Demo: chest cold, On another chart now'));
    await expectShown(tester, find.bySemanticsLabel('Referral, October 19, 2026: Demo: chest x-ray'));
    expect(referral, isNotEmpty);
  });

  testWidgets('the person’s own draft read from the server opens once it is brought to the phone', (tester) async {
    final h = await signInToChart(tester, offline: false);
    final routes = await withEncounterRoutes(tester, h);
    // Started on the person's other phone: this phone holds neither the visit nor the note.
    final serverVisit = h.server.seed(entityEncounter, {'kind': 'medical', 'patientId': p1Id}, by: me);
    final serverNote = h.server.seed(entityNote, {
      'encounterId': serverVisit,
      'noteTypeKey': 'general_primary_care',
      'noteTypeVersion': 1,
      'data': {'reason.concern': 'Demo: cough'},
    }, by: me);
    routes.on(
      'GET',
      '/v1/encounters/$serverVisit',
      (_) => visitJson(
        encounterId: serverVisit,
        patientId: p1Id,
        status: 'draft',
        notes: [
          visitNoteJson(
            noteId: serverNote,
            author: meRef,
            key: 'general_primary_care',
            title: 'General / primary care',
            status: 'draft',
            completedAt: null,
            sections: [concern],
          ),
        ],
      ),
    );
    await openVisitScreen(tester, serverVisit);
    expect(h.sync.store!.record(serverNote), isNull);
    final open = find.bySemanticsLabel('Open the note, General / primary care');
    await expectShown(tester, open);
    expect(tester.getSemantics(open), isSemantics(isButton: true, hasTapAction: true));
    await tapOn(tester, find.widgetWithText(OutlinedButton, 'Open the note'));
    expectNoteOpened(tester, serverNote);
    expect(h.sync.store!.record(serverNote), isNotNull);
  });

  testWidgets('a note assigned to someone else names who acts as its author, never its writer (D108)', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    h.server.offline = false;
    routes.on(
      'GET',
      '/v1/encounters/$visit',
      (_) => visitJson(
        encounterId: visit,
        patientId: p1Id,
        status: 'draft',
        notes: [
          visitNoteJson(
            noteId: note,
            author: blairRef,
            actingAuthor: userRef('a0000000-0000-4000-8000-0000000000c7', 'Demo Avery'),
            key: 'general_primary_care',
            title: 'General / primary care',
            status: 'draft',
            completedAt: null,
          ),
        ],
      ),
    );
    await openVisitScreen(tester, visit);
    await expectShown(tester, find.text('By Demo Avery'));
    expect(find.textContaining('Demo Blair', skipOffstage: false), findsNothing);
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

    testWidgets('when the server’s read failed as it opened, Co-sign reads it there first, then signs what was read', (
      tester,
    ) async {
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      final held = await heldWaiting(tester, h);
      final heldNote = noteOfType(h, held, 'general_primary_care')!.id;
      // The server fails the read the screen asks for as it opens: the phone's copy shows, saying what
      // others added may be missing.
      routes.refuse('GET', '/v1/encounters/$held', 500, 'internal');
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
      expect([for (final a in routes.asked) a.method], ['GET']);
      await expectShown(tester, find.text('This is the copy on this phone. What others added since may be missing.'));
      routes.asked.clear();
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
              canCosign: true,
            ),
          ],
        ),
      );
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

    testWidgets('a note drawn under the person’s own assessment, not sent yet, is not co-signed: it says to send '
        'first (review finding PA-5)', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      h.server.offline = false;
      final held = startVisit(h);
      await syncAndRefresh(tester, h);
      // The person's own words for the visit, waiting here: every note's hash covers the assessment.
      h.sync.store!.setField(held, 'summary', 'Demo: my assessment, not sent');
      // Demo Blair's note, completed by them as a student, then brought to the phone.
      h.server.credentials[blair] = 'student';
      final heldNote = h.server.seed(entityNote, {
        'encounterId': held,
        'noteTypeKey': 'general_primary_care',
        'noteTypeVersion': 1,
        'data': {'reason.concern': 'Demo: cough'},
      }, by: blair);
      h.server.finishNote(heldNote);
      expect(await tester.runAsync(() => h.sync.engine!.openServerRecord(entityNote, heldNote)), isTrue);
      expect(h.sync.store!.record(held)!.fields['summary']!.pendingChange, isNotNull);
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
              canCosign: true,
            ),
          ],
        ),
      );
      await openVisitScreen(tester, held);
      await expectShown(tester, find.text('Demo: my assessment, not sent'));
      await expectShown(tester, find.text('Send your changes first, then read the visit again.'));
      expect(find.widgetWithText(FilledButton, 'Co-sign'), findsNothing);
      expect(routes.asked.where((a) => a.method == 'POST'), isEmpty);
      await expectScreenOk(tester);
      handle.dispose();
    });

    testWidgets('online, the server’s read comes first: a co-signature made elsewhere shows on a note the phone '
        'holds, and offline the phone’s copy says what may be missing', (tester) async {
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      final held = await heldWaiting(tester, h);
      final heldNote = noteOfType(h, held, 'general_primary_care')!.id;
      // Demo Avery, an attending, co-signed it on the portal: the phone holds the student's Complete only.
      routes.on(
        'GET',
        '/v1/encounters/$held',
        (_) => visitJson(
          encounterId: held,
          patientId: p1Id,
          status: 'signed',
          notes: [
            visitNoteJson(
              noteId: heldNote,
              author: blairRef,
              key: 'general_primary_care',
              title: 'General / primary care',
              status: 'signed',
              contentHash: hash,
              sections: [concern],
              signoffs: [
                signoffJson(id: signoff, signer: blairRef),
                signoffJson(
                  id: 'f4000000-0000-4000-8000-0000000000b1',
                  signer: userRef('a0000000-0000-4000-8000-0000000000b2', 'Demo Avery'),
                  act: 'cosign',
                  effect: 'signed',
                  credential: 'attending',
                  signedAt: '2026-10-22T15:00:00.000Z',
                ),
              ],
              canCosign: false,
            ),
          ],
        ),
      );
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await openVisitScreen(tester, held);
      expect([for (final a in routes.asked) '${a.method} ${a.path}'], ['GET /v1/encounters/$held']);
      await expectShown(tester, find.textContaining(RegExp(r'^Co-signed by Demo Avery, Attending physician, ')));
      expect(find.text('This is the copy on this phone. What others added since may be missing.'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Co-sign'), findsNothing);
      // The server logged its read; the phone logged nothing of it again, having nothing of its own waiting.
      expect(auditEvents(store).skip(before), isEmpty);
      // A change reads the phone's copy again under it: still nothing logged again.
      h.encounters.changed();
      await settle(tester);
      expect(auditEvents(store).skip(before), isEmpty);

      // Offline: the phone's copy, without what was added elsewhere, and it says so.
      await back(tester);
      h.server.offline = true;
      await tester.runAsync(() => h.sync.syncNow());
      routes.asked.clear();
      await openVisitScreen(tester, held);
      expect(routes.asked, isEmpty);
      await expectShown(tester, find.text('This is the copy on this phone. What others added since may be missing.'));
      expect(find.textContaining('Co-signed by Demo Avery'), findsNothing);
      await expectShown(tester, find.text('General / primary care'));
      await expectScreenOk(tester);
    });

    testWidgets('a server that doesn’t answer in time: the phone’s copy shows, saying what may be missing', (
      tester,
    ) async {
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      final held = await heldWaiting(tester, h);
      final never = Completer<Object?>();
      routes.on('GET', '/v1/encounters/$held', (_) => never.future);
      final context = tester.element(find.byType(Navigator).first);
      unawaited(GoRouter.of(context).push(visitLocation(held)));
      await tester.pump();
      expect(find.text('General / primary care'), findsNothing);
      await tester.pump(const Duration(seconds: 7));
      await settle(tester);
      await expectShown(tester, find.text('This is the copy on this phone. What others added since may be missing.'));
      await expectShown(tester, find.text('General / primary care'));
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
