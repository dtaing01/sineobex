import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_models.dart' show VisitKind;
import 'package:sineobex_field/features/encounters/notes_to_finish_screen.dart';
import 'package:sineobex_field/sync/entities.dart' show entityEncounter, entityNote;

import 'encounter_kit.dart';

/// Home's **Notes to finish** tile and its list (lifecycle 9.9, 5.6; card L5-notes-to-finish): the
/// drafts the person acts as the author of, oldest visit first, each with the patient's preferred
/// name, the note type and when the visit started, "Older than a day" a day after; a row opens the
/// note. Offline the list is the phone's own and says so; online the server's list adds the drafts
/// not on this phone, which open only with signal. The list logs what it shows; the tile names no
/// one. Three themes, 200% text, 320 wide.
void main() {
  /// A time as the screens word one: a date, "at", a time.
  const at = r' at \d{1,2}:\d{2}\s?[AP]M';

  Future<void> home(WidgetTester tester) async {
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')));
    await settle(tester);
  }

  /// A day and an hour pass, by the phone's clock and its time since boot alike.
  void dayPasses(AppHarness h) {
    const d = Duration(hours: 25);
    h.wall = h.wall.add(d);
    h.boot.advance(d);
  }

  for (final run in runs) {
    testWidgets('the tile, the list and a row opening its note, offline (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInToChart(tester, run: run);
      final first = startVisit(h);
      final general = await chart(tester, h, first, 'general_primary_care', {'reason.concern': 'Demo: cough'});
      dayPasses(h);
      final second = startVisit(h, kind: VisitKind.nonMedical, noPatient: true);
      await chart(tester, h, second, 'outreach', {'outreach.type': 'outreach'});
      // The app's own empty Red flags note is no note to finish (3.1).
      await home(tester);

      final tile = find.text('2 notes to finish. 1 is older than a day.');
      await expectShown(tester, tile);
      await expectScreenOk(tester);
      final store = h.sync.store!;
      final before = auditEvents(store).length;
      // The tile names no one, so it logs nothing (5.6).
      expect(auditEvents(store), hasLength(before));

      await tapOn(tester, tile);
      expect(location(tester), notesToFinishLocation);
      expect(find.widgetWithText(AppBar, 'Notes to finish'), findsOneWidget);
      await expectShown(tester, find.text('Showing the notes on this phone. Connect to see the rest.'));
      final old = find.bySemanticsLabel(
        RegExp(
          '^Del, General / primary care, Visit started October 22, 2026$at, Older than a day, On this phone only\$',
        ),
      );
      final none = find.bySemanticsLabel(
        RegExp('^No patient, Outreach, Visit started October 23, 2026$at, On this phone only\$'),
      );
      await expectShown(tester, old);
      expect(tester.getSemantics(old), isSemantics(isButton: true, hasTapAction: true));
      await expectShown(tester, none);
      // Oldest visit first.
      await reveal(tester, old);
      if (none.evaluate().isNotEmpty) expect(tester.getTopLeft(old).dy, lessThan(tester.getTopLeft(none).dy));
      await expectScreenOk(tester);
      expectNoLegalName(tester);
      // The list's read is logged once, naming the patients it shows (10.1).
      expect(auditEvents(store).skip(before), ['notes_to_finish.viewed']);

      await tapOn(tester, old);
      expectNoteOpened(tester, general);
      await back(tester);
      expect(location(tester), notesToFinishLocation);
      // On top again: read again, logging nothing it showed before.
      expect(auditEvents(store).where((e) => e == 'notes_to_finish.viewed'), hasLength(1));
      handle.dispose();
    });
  }

  testWidgets('online, the server’s list adds a draft not on this phone, which opens once fetched', (tester) async {
    final h = await signInToChart(tester);
    final routes = await withEncounterRoutes(tester, h);
    final mine = startVisit(h);
    await chart(tester, h, mine, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    // A draft of the person's own that another phone of theirs made, on the server only.
    final elsewhere = h.server.seed(entityEncounter, {'kind': 'non_medical', 'patientId': p1Id}, by: me);
    final theirs = h.server.seed(entityNote, {
      'encounterId': elsewhere,
      'noteTypeKey': 'social_needs',
      'noteTypeVersion': 1,
      'data': {
        'needs.needs': ['food'],
      },
    }, by: me);
    routes
      ..on(
        'GET',
        '/v1/me/notes-to-finish',
        (_) => {
          'notes': [
            {
              'noteId': theirs,
              'encounterId': elsewhere,
              'patientId': p1Id,
              'noteTypeKey': 'social_needs',
              'startedAt': '2026-10-19T15:00:00.000Z',
              'overdue': true,
            },
          ],
        },
      )
      // The server counts the draft it holds and, once this phone's sync has sent it, the phone's too.
      ..on('GET', '/v1/me/counts', (_) => {'notesToFinish': 2, 'notesOverdue': 1});

    // Offline, the tile counts the phone's own.
    await home(tester);
    await expectShown(tester, find.text('1 note to finish.'));

    h.server.offline = false;
    await syncAndRefresh(tester, h);
    await expectShown(tester, find.text('2 notes to finish. 1 is older than a day.'));
    await tapOn(tester, find.text('2 notes to finish. 1 is older than a day.'));
    expect(find.text('Showing the notes on this phone. Connect to see the rest.'), findsNothing);
    final remote = find.bySemanticsLabel(
      RegExp('^Del, Social needs, Visit started October 19, 2026$at, Older than a day, Opens with a connection\$'),
    );
    await expectShown(tester, remote);
    // Oldest visit first: the server's draft from three days ago, then the phone's own.
    final local = find.bySemanticsLabel(RegExp('^Del, General / primary care, Visit started October 22, 2026'));
    await expectShown(tester, local);
    expect(tester.getTopLeft(remote).dy, lessThan(tester.getTopLeft(local).dy));

    // Without signal it can't be fetched, and the list says so.
    h.server.offline = true;
    await tapOn(tester, remote);
    expect(location(tester), notesToFinishLocation);
    await expectShown(tester, find.text('This note isn’t on this phone. Connect to open it.'));
    expect(h.sync.store!.record(theirs), isNull);

    h.server.offline = false;
    await tapOn(tester, remote);
    expectNoteOpened(tester, theirs);
    expect(h.sync.store!.record(theirs), isNotNull);
  });

  testWidgets('no tile while there is nothing to finish, and nothing while the store is frozen', (tester) async {
    final h = await signInToChart(tester);
    await home(tester);
    expect(find.textContaining('to finish'), findsNothing);
    final visit = startVisit(h);
    await chart(tester, h, visit, 'general_primary_care', {'reason.concern': 'Demo: cough'});
    await settle(tester);
    await expectShown(tester, find.text('1 note to finish.'));
    h.sync.store!.freeze('Demo: handing over');
    h.encounters.changed();
    await settle(tester);
    expect(find.text('1 note to finish.'), findsNothing);
    h.sync.store!.unfreeze();
  });
}
