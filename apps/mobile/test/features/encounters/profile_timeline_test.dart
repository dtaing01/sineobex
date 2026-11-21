import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/encounters/encounter_labels.dart' show referralsHeading;
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/sync/local_store.dart' show entityAudit;

import '../../sync/fake_server.dart' show FakeSyncServer;
import 'encounter_kit.dart';

/// The patient profile's phase 4 parts (lifecycle 9.1; card L5-profile-timeline): **+ Encounter** and
/// **+ Referral** among the quick actions, each to a role that may use it; the **Timeline**, the
/// chart's visits and referrals merged with the visits the phone holds, newest first, each note with
/// its state in words, "Waiting to send" until confirmed; the type filter; a row opening the visit or
/// the Referrals sheet; and **Show earlier visits**, online only. Read offline from the chart the
/// phone keeps; three themes, 200% text, 320 wide.
void main() {
  const v1 = 'e0000000-0000-4000-8000-0000000000b1';
  const v2 = 'e0000000-0000-4000-8000-0000000000b2';
  const n1 = 'f0000000-0000-4000-8000-0000000000b3';
  const n2 = 'f0000000-0000-4000-8000-0000000000b4';
  const n3 = 'f0000000-0000-4000-8000-0000000000b5';
  const r1 = 'f0000000-0000-4000-8000-0000000000b6';

  /// A time as the screens word one: a date, "at", a time.
  const at = r' at \d{1,2}:\d{2}\s?[AP]M';

  /// The chart's timeline as the server reads it: a Medical visit signed by Demo Blair and waiting for
  /// attestation, a referral, and an earlier outreach visit.
  Map<String, Object?> timeline() => {
    'timeline': {
      'encounters': [
        timelineVisit(
          v1,
          '2026-10-20T15:00:00.000Z',
          status: 'signed',
          notes: [
            timelineNote(n1, 'general_primary_care', status: 'signed', attestation: 'waiting'),
            timelineNote(n2, 'red_flags_disposition', status: 'signed'),
          ],
        ),
        timelineVisit(
          v2,
          '2026-10-15T15:00:00.000Z',
          kind: 'non_medical',
          notes: [timelineNote(n3, 'outreach', group: 'outreach')],
        ),
      ],
      'referrals': [referralSnapshot(r1, p1Id, referredOn: '2026-10-18', details: 'Demo: dental clinic')],
    },
  };

  Finder row(String pattern) => find.bySemanticsLabel(RegExp(pattern));

  for (final run in runs) {
    testWidgets('the timeline: the chart’s visits and the phone’s own, newest first (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      await cacheChart(tester, h, p1Id, timeline());
      final mine = startVisit(h);
      await chart(tester, h, mine, 'general_primary_care', {'reason.concern': 'Demo: cough'});
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      await go(tester, '/patients/$p1Id');
      expect(find.byType(PatientScreen), findsOneWidget);

      // The quick actions, first among them, each read as what it opens.
      await expectShown(tester, find.bySemanticsLabel('New encounter'));
      await expectShown(tester, find.bySemanticsLabel('Add a referral'));
      expect(find.text('Encounter'), findsOneWidget);
      expect(find.text('Referral'), findsOneWidget);

      final heading = find.text('Timeline');
      await expectShown(tester, heading);
      expect(tester.getSemantics(heading), isSemantics(isHeader: true));
      for (final chip in ['Clinical', 'Psych', 'Social', 'Referrals', 'Outreach', 'Harm reduction', 'Wound']) {
        await expectShown(tester, find.widgetWithText(FilterChip, chip));
      }
      // Newest first: the visit started here, Blair's, the referral, the outreach visit.
      final ours = row(
        '^October 22, 2026$at, Medical visit, Waiting to send, General / primary care: Waiting to send\$',
      );
      final theirs = row(
        '^October 20, 2026$at, Medical visit, General / primary care: Waiting for attestation, '
        'Red flags and disposition: Signed\$',
      );
      final referral = row('^Referral, October 18, 2026: Demo: dental clinic\\. Recorded by a teammate\$');
      final outreach = row('^October 15, 2026$at, Non-Medical visit, Outreach: Complete\$');
      final rows = [ours, theirs, referral, outreach];
      for (final r in rows) {
        await expectShown(tester, r);
        expect(tester.getSemantics(r), isSemantics(isButton: true, hasTapAction: true));
      }
      for (var i = 1; i < rows.length; i++) {
        expect(tester.getTopLeft(rows[i - 1]).dy, lessThan(tester.getTopLeft(rows[i]).dy));
      }
      // The empty Red flags note the app added is no row's chip (3.1).
      expect(find.text('Red flags and disposition: Draft'), findsNothing);
      await expectScreenOk(tester);
      expectNoLegalName(tester);

      // Part of the chart's logged read (phase 3), as its problem list is: the timeline logs nothing
      // of its own, at first or read again.
      expect(auditEvents(store).skip(before).toSet(), {'patient.viewed'});
      final logged = auditEvents(store).length;
      h.encounters.changed();
      await settle(tester);
      expect(auditEvents(store), hasLength(logged));
      handle.dispose();
    });
  }

  testWidgets('the type filter shows the rows of the types chosen, and a row opens the visit', (tester) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, timeline());
    await go(tester, '/patients/$p1Id');
    final referral = row('^Referral, October 18, 2026: Demo: dental clinic');
    final outreach = row('^October 15, 2026$at, Non-Medical visit');
    final signed = row('^October 20, 2026$at, Medical visit');
    await tapOn(tester, find.widgetWithText(FilterChip, 'Referrals'));
    expect(tester.widget<FilterChip>(find.widgetWithText(FilterChip, 'Referrals')).selected, isTrue);
    await expectShown(tester, referral);
    expect(signed, findsNothing);
    expect(outreach, findsNothing);
    await tapOn(tester, find.widgetWithText(FilterChip, 'Outreach'));
    await expectShown(tester, outreach);
    expect(signed, findsNothing);
    await tapOn(tester, find.widgetWithText(FilterChip, 'Psych'));
    await tapOn(tester, find.widgetWithText(FilterChip, 'Referrals'));
    await tapOn(tester, find.widgetWithText(FilterChip, 'Outreach'));
    await expectShown(tester, find.text('Nothing of these types.'));
    await tapOn(tester, find.widgetWithText(FilterChip, 'Psych'));
    await expectShown(tester, signed);

    // A visit's row opens the visit (9.7), by its ID only.
    await tapOn(tester, signed);
    expect(location(tester), '/encounters/$v1/visit');
    await back(tester);

    // A referral's row opens the Referrals sheet, where the read of each referral is logged.
    final store = h.sync.store!;
    final before = auditEvents(store).length;
    await tapOn(tester, referral);
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(referralsHeading)), findsOneWidget);
    await revealInSheet(tester, find.text('Demo: dental clinic'));
    final read = [
      for (final e in store.outbox())
        if (e.entity == entityAudit && (e.value! as Map)['entity'] == 'referral') e.value! as Map,
    ];
    expect(read.single['entityId'], r1);
    expect(auditEvents(store).skip(before), ['patient.viewed']);
  });

  testWidgets('a chart opened from the team’s list shows the phone’s visits, and says the rest come with the '
      'full chart', (tester) async {
    final handle = tester.ensureSemantics();
    final h = await signInToChart(tester);
    final mine = startVisit(h, kind: VisitKind.nonMedical);
    await chart(tester, h, mine, 'outreach', {'outreach.type': 'outreach'});
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('Visits recorded elsewhere show with the full chart.'));
    // The heading is read alone, the sentence after it.
    expect(
      readingOrder(tester),
      containsAllInOrder(['[H] Timeline', 'Visits recorded elsewhere show with the full chart.']),
    );
    handle.dispose();
    await expectShown(tester, row('Non-Medical visit, Waiting to send, Outreach: Waiting to send\$'));
    expect(find.text(showEarlierVisitsText), findsNothing);
  });

  testWidgets('Show earlier visits asks the server for the next 50, and says when it can’t', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    final page = [
      for (var i = 0; i < 50; i++)
        timelineVisit(
          'e0000000-0000-4000-8000-0000000001${i.toString().padLeft(2, '0')}',
          DateTime.utc(2026, 10, 20).subtract(Duration(days: i)).toIso8601String(),
          kind: 'non_medical',
          notes: [timelineNote('f0000000-0000-4000-8000-0000000001${i.toString().padLeft(2, '0')}', 'outreach')],
        ),
    ];
    await cacheChart(tester, h, p1Id, {
      'timeline': {'encounters': page, 'referrals': <Object?>[]},
    });
    const earlier = 'e0000000-0000-4000-8000-000000000201';
    routes.on(
      'GET',
      '/v1/patients/$p1Id/timeline',
      (_) => {
        'encounters': [timelineVisit(earlier, '2026-08-01T15:00:00.000Z', kind: 'non_medical')],
      },
    );
    await go(tester, '/patients/$p1Id');
    final more = find.widgetWithText(OutlinedButton, showEarlierVisitsText);
    await tapOn(tester, more);
    await expectShown(tester, find.text('Connect to see earlier visits.'));
    expect(routes.asked, isEmpty);

    h.server.offline = false;
    await tapOn(tester, more);
    expect(routes.asked.single.path, '/v1/patients/$p1Id/timeline');
    await expectShown(tester, row('^August 1, 2026$at, Non-Medical visit\$'));
    expect(find.text('Connect to see earlier visits.'), findsNothing);
    // The server's page was not full: there are no more.
    expect(find.widgetWithText(OutlinedButton, showEarlierVisitsText), findsNothing);
  });

  group('Show earlier visits says what came and keeps focus somewhere (review findings PX-1, PX-2)', () {
    List<Map<String, Object?>> pageOf(int n) => [
      for (var i = 0; i < n; i++)
        timelineVisit(
          'e0000000-0000-4000-8000-0000000001${i.toString().padLeft(2, '0')}',
          DateTime.utc(2026, 10, 20).subtract(Duration(days: i)).toIso8601String(),
          kind: 'non_medical',
        ),
    ];

    for (final next in [0, 1]) {
      testWidgets('a next page of $next: said once, and focus moves to what came or to the heading', (tester) async {
        final handle = tester.ensureSemantics();
        final h = await signInToChart(tester);
        final routes = await withEncounterRoutes(tester, h);
        await cacheChart(tester, h, p1Id, {
          'timeline': {'encounters': pageOf(50), 'referrals': <Object?>[]},
        });
        routes.on(
          'GET',
          '/v1/patients/$p1Id/timeline',
          (_) => {
            'encounters': [
              if (next == 1)
                timelineVisit('e0000000-0000-4000-8000-000000000201', '2026-08-01T15:00:00.000Z', kind: 'non_medical'),
            ],
          },
        );
        await go(tester, '/patients/$p1Id');
        final more = find.widgetWithText(OutlinedButton, 'Show earlier visits');
        await reveal(tester, more);
        h.server.offline = false;
        Focus.of(tester.element(find.text('Show earlier visits'))).requestFocus();
        await tester.pump();
        tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
        await settle(tester);
        await settle(tester);
        // The page was not full, so the button went.
        expect(more, findsNothing);
        final said = next == 0 ? 'No earlier visits.' : '1 earlier visit shown.';
        await expectShown(tester, find.text(said));
        expect(tester.getSemantics(find.bySemanticsLabel(said)), isSemantics(isLiveRegion: true));
        expect(FocusManager.instance.primaryFocus?.debugLabel, next == 0 ? 'timeline heading' : 'first earlier visit');
        handle.dispose();
      });
    }

    // Review finding VX-4: what is said counts what came that the filter shows and that was not
    // shown already; a page the filter hides all of is said in its own words.
    testWidgets('with a type filter on, a page it hides is said as hidden, and focus goes to the heading', (
      tester,
    ) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      await cacheChart(tester, h, p1Id, {
        'timeline': {
          'encounters': pageOf(50),
          'referrals': [
            referralSnapshot(
              'f0000000-0000-4000-8000-0000000000c1',
              p1Id,
              referredOn: '2026-10-18',
              details: 'Demo: dental clinic',
            ),
          ],
        },
      });
      routes.on(
        'GET',
        '/v1/patients/$p1Id/timeline',
        (_) => {
          'encounters': [
            timelineVisit('e0000000-0000-4000-8000-000000000201', '2026-08-01T15:00:00.000Z', kind: 'non_medical'),
          ],
        },
      );
      await go(tester, '/patients/$p1Id');
      await tapOn(tester, find.widgetWithText(FilterChip, 'Referrals'));
      await reveal(tester, find.widgetWithText(OutlinedButton, 'Show earlier visits'));
      h.server.offline = false;
      Focus.of(tester.element(find.text('Show earlier visits'))).requestFocus();
      await tester.pump();
      tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
      await settle(tester);
      await settle(tester);
      expect(find.text('1 earlier visit shown.'), findsNothing);
      await expectShown(tester, find.text('Earlier visits were found. The filter hides them.'));
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'timeline heading');
      handle.dispose();
    });

    testWidgets('a page holding a visit already shown counts only the new one', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      final first = pageOf(50);
      await cacheChart(tester, h, p1Id, {
        'timeline': {'encounters': first, 'referrals': <Object?>[]},
      });
      routes.on(
        'GET',
        '/v1/patients/$p1Id/timeline',
        (_) => {
          'encounters': [
            first.last,
            timelineVisit('e0000000-0000-4000-8000-000000000201', '2026-08-01T15:00:00.000Z', kind: 'non_medical'),
          ],
        },
      );
      await go(tester, '/patients/$p1Id');
      await reveal(tester, find.widgetWithText(OutlinedButton, 'Show earlier visits'));
      h.server.offline = false;
      tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
      await settle(tester);
      await settle(tester);
      await expectShown(tester, find.text('1 earlier visit shown.'));
      expect(find.text('2 earlier visits shown.'), findsNothing);
      handle.dispose();
    });

    // Review finding VX-7: two full pages in a row say the same words, each as a new live region.
    testWidgets('two full pages in a row are each said, as a new live region', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      final routes = await withEncounterRoutes(tester, h);
      await cacheChart(tester, h, p1Id, {
        'timeline': {'encounters': pageOf(50), 'referrals': <Object?>[]},
      });
      var pages = 0;
      routes.on('GET', '/v1/patients/$p1Id/timeline', (_) {
        pages++;
        return {
          'encounters': [
            for (var i = 0; i < 50; i++)
              timelineVisit(
                'e0000000-0000-4000-8000-0000000${pages}0${i.toString().padLeft(2, '0')}',
                DateTime.utc(2026, 6, 1).subtract(Duration(days: pages * 60 + i)).toIso8601String(),
                kind: 'non_medical',
              ),
          ],
        };
      });
      await go(tester, '/patients/$p1Id');
      h.server.offline = false;
      Future<SemanticsNode> press() async {
        await reveal(tester, find.widgetWithText(OutlinedButton, 'Show earlier visits'));
        tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
        await settle(tester);
        await settle(tester);
        final said = find.bySemanticsLabel('50 earlier visits shown.');
        await reveal(tester, said);
        return tester.getSemantics(said);
      }

      final first = await press();
      expect(first, isSemantics(isLiveRegion: true));
      final second = await press();
      expect(second, isSemantics(isLiveRegion: true));
      expect(second.id, isNot(first.id));
      handle.dispose();
    });

    testWidgets('offline, a second press says its refusal again, as a new live region', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester);
      await withEncounterRoutes(tester, h);
      await cacheChart(tester, h, p1Id, {
        'timeline': {'encounters': pageOf(50), 'referrals': <Object?>[]},
      });
      await go(tester, '/patients/$p1Id');
      await reveal(tester, find.widgetWithText(OutlinedButton, 'Show earlier visits'));
      tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
      await settle(tester);
      final refusal = find.bySemanticsLabel('Connect to see earlier visits.');
      final first = tester.getSemantics(refusal);
      expect(first, isSemantics(isLiveRegion: true));
      tester.semantics.tap(find.semantics.byLabel('Show earlier visits'));
      await settle(tester);
      final second = tester.getSemantics(refusal);
      expect(second, isSemantics(isLiveRegion: true));
      expect(second.id, isNot(first.id));
      handle.dispose();
    });
  });

  // Review finding VX-3: the heading is where focus goes after Show earlier visits, and never a Tab
  // stop, as the portal's heading is tabIndex=-1.
  testWidgets('the Timeline heading takes focus only when sent there, never by Tab', (tester) async {
    final h = await signInToChart(tester);
    await cacheChart(tester, h, p1Id, {
      'timeline': {
        'encounters': [
          timelineVisit('e0000000-0000-4000-8000-000000000101', '2026-10-20T15:00:00.000Z', kind: 'non_medical'),
        ],
        'referrals': <Object?>[],
      },
    });
    await go(tester, '/patients/$p1Id');
    await expectShown(tester, find.text('Timeline'));
    final heading = FocusManager.instance.rootScope.descendants.firstWhere((n) => n.debugLabel == 'timeline heading');
    expect(heading.nearestScope!.traversalDescendants, isNot(contains(heading)));
    for (var i = 0; i < 80; i++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus, isNot(heading), reason: 'Tab $i');
    }
  });

  testWidgets('+ Encounter starts a visit for the patient; each quick action shows only to a role that may use it', (
    tester,
  ) async {
    final h = await signInToChart(tester);
    await go(tester, '/patients/$p1Id');
    await tapOn(tester, find.bySemanticsLabel('New encounter'));
    expect(location(tester), '/patients/$p1Id/encounters/new');
    await back(tester);
    await tapOn(tester, find.bySemanticsLabel('Add a referral'));
    expect(find.descendant(of: find.byType(BottomSheet), matching: find.text(referralsHeading)), findsOneWidget);
    await back(tester);

    // A community health worker makes referrals and never charts (lifecycle 7).
    await remakeServices(tester, h, credential: 'chw', permissions: FakeSyncServer.chw.toList());
    await settle(tester);
    expect(find.bySemanticsLabel('New encounter'), findsNothing);
    await expectShown(tester, find.bySemanticsLabel('Add a referral'));

    // A role that neither charts nor makes referrals sees neither.
    await remakeServices(tester, h, permissions: ['patients.view', 'patients.edit']);
    await settle(tester);
    expect(find.bySemanticsLabel('New encounter'), findsNothing);
    expect(find.bySemanticsLabel('Add a referral'), findsNothing);
  });
}

const showEarlierVisitsText = 'Show earlier visits';
