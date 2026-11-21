import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/encounters/encounter_services.dart';
import 'package:sineobex_field/features/encounters/encounter_screen.dart';
import 'package:sineobex_field/features/encounters/new_encounter_screen.dart';
import 'package:sineobex_field/features/encounters/note_type_list.dart';
import 'package:sineobex_field/features/encounters/notes_to_finish_screen.dart';
import 'package:sineobex_field/features/encounters/start_sheet.dart';
import 'package:sineobex_field/features/encounters/summary_screen.dart';
import 'package:sineobex_field/features/forms/note_read_view.dart';
import 'package:sineobex_field/features/patients/patient_screen.dart';
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/sync/entities.dart' show entityEncounter, entityPatient, entitySignoff;
import 'package:sineobex_field/sync/local_store.dart' show OutboxEntry;
import 'package:sineobex_field/sync/sync_controller.dart' show OpenTeam;

import 'encounter_kit.dart';

/// The phase 4 Done when through the screens (lifecycle 11.1, card L7-screens): "A resident charts a
/// medical, wound and social visit as one encounter offline, saves and closes it, completes it later,
/// and an attending attests it." The resident's half, offline then synced, on the app harness as the
/// screens' own tests run: Start, New encounter, the note types, each note's form, Save & Close, the
/// app started again, Home's Notes to finish, the summary, Complete and sign, and the chart's "Waiting
/// to send", with the story's patient, people and answers from encounters-done-when.json. Every screen
/// the story passes through is checked in Day, Night run and High contrast, at 200% text and 320 wide.
/// The attending's half is the portal's (attestation.spec.ts) and the live test's; the audit events
/// of step 5, which the phone's test server doesn't write, are the live test's and the API's.
void main() {
  final story = jsonDecode(
    File('../../packages/contract/test-vectors/encounters-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final resident = (story['people']! as Map<String, Object?>)['resident']! as Map<String, Object?>;
  final patient = story['patient']! as Map<String, Object?>;
  final patientId = patient['id']! as String;
  final preferred = patient['preferredName']! as String;
  final encounter = story['encounter']! as Map<String, Object?>;
  final assessment = story['assessment']! as String;
  final notes = (story['notes']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> byRef(String ref) => notes.singleWhere((n) => n['ref'] == ref);
  Map<String, Object?> storyAnswers(Map<String, Object?> n) => n['answers']! as Map<String, Object?>;
  Map<String, Object?> finalAnswers(Map<String, Object?> n) => {
    ...storyAnswers(n),
    ...(n['answersAtStep4']! as Map<String, Object?>),
  };
  Map<String, Object?> expectAt(int n, String side) =>
      ((story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n)['expect']!
              as Map<String, Object?>)[side]!
          as Map<String, Object?>;

  /// The story's [answers] as the screens write them: a wound entry at the ID the form made for it
  /// and the time it was added ([entry]), in place of the domain tests' fixed ones.
  Map<String, Object?> written(Map<String, Object?> answers, ({String id, String at}) entry) => {
    for (final MapEntry(:key, :value) in answers.entries)
      key.replaceFirst('edone001', entry.id): key.endsWith('.entryAt') ? entry.at : value,
  };

  /// The open team's encounter services made again for the story's resident, by their credential and
  /// name, as the app makes them for them (the harness signs everyone in as an attending), their
  /// refreshers in place of the ones made as the team opened.
  Future<void> asResident(WidgetTester tester, AppHarness h) async {
    final engine = h.sync.engine!;
    final made = h.encounters;
    final before = made.user;
    final services = EncounterServices(
      OpenTeam(
        userId: me,
        teamId: engine.teamId,
        store: engine.store,
        api: engine.api,
        clock: engine.clock,
        permissions: before.permissions.toList(),
      ),
      credential: resident['credential']! as String,
      displayName: resident['displayName']! as String,
      definitionStore: h.sync.definitions,
      openServerRecord: engine.openServerRecord,
    );
    engine.refreshers
      ..removeWhere(made.refreshers.contains)
      ..addAll(services.refreshers);
    // The screens find the open team's services through the controller: it tells them after a sync.
    await syncAndRefresh(tester, h);
    expect(identical(h.encounters, services), isTrue);
  }

  /// The story's people and patient on the app harness: the team's released note types, the patient
  /// registered on the server and in the phone's index, and the person charting the story's resident,
  /// by their credential and name, as the server has them too. Then the phone goes offline.
  Future<AppHarness> signInAsResident(WidgetTester tester, Run run) async {
    final h = await signIn(tester, theme: run.theme, scale: run.scale, narrow: run.narrow);
    // Each read of the server's clock is a microsecond on: the API writes each change of a push in its
    // own transaction, so the notes of one push are made at times of their own, which order a visit's
    // notes (created_at, D108), where one clock for the whole push would tie them.
    var reads = 0;
    h.server.now = () => h.wall.add(h.serverAhead).add(Duration(microseconds: reads++));
    for (final v in AppHarness.bundledPresets.cast<Map<String, Object?>>()) {
      h.server.noteTypes[(v['key']! as String, v['version']! as int)] = v['definition']! as Map<String, Object?>;
    }
    h.server
      ..credentials[me] = resident['credential']! as String
      ..names[me] = resident['displayName']! as String
      ..seed(entityPatient, {
        'preferredName': preferred,
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
    await syncAndRefresh(tester, h);
    await asResident(tester, h);
    h.server.offline = true;
    return h;
  }

  /// The app killed and started again, as near as the harness comes: the screens torn down, the team's
  /// database closed and the session's key dropped, as a lock drops them; then the app built afresh at
  /// its PIN screen, whose unlock opens the database from disk and makes the team's services anew.
  Future<void> killAndStart(WidgetTester tester, AppHarness h) async {
    final closed = h.sync.store!;
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(h.session.lock);
    await settle(tester);
    expect(h.sync.store, isNull);
    await tester.pumpWidget(h.build());
    await settle(tester);
    expect(tester.takeException(), isNull);
    await enter(tester, 'PIN', '482913');
    await tapText(tester, 'Unlock');
    await tester.runAsync(h.sync.ready);
    await settle(tester);
    expect(identical(h.sync.store, closed), isFalse);
    await asResident(tester, h);
  }

  /// Every change [pushed] held reached the server, which accepted it and answered with the hash the
  /// phone sent; nothing waits or was refused.
  void expectHashConfirmed(AppHarness h, int step, List<OutboxEntry> pushed) {
    expect(expectAt(step, 'receipts'), {'status': 'accepted', 'hashConfirmed': true});
    expect(pushed, isNotEmpty);
    for (final e in pushed) {
      final receipt = h.server.receipts[e.changeId];
      expect([receipt?.status, receipt?.hash], ['accepted', e.valueHash], reason: '${e.entity} ${e.op} ${e.field}');
    }
    expect([h.sync.store!.outbox(), h.sync.store!.needsAttention()], [isEmpty, isEmpty]);
  }

  /// Taps the chip [label] of the field [field], as a screen reader finds it, scrolled to first.
  Future<void> pick(WidgetTester tester, String field, String label) async {
    await reveal(tester, find.text(field));
    final chip = find.bySemanticsLabel(label);
    await reveal(tester, chip);
    await tester.tap(chip.last);
    await settle(tester);
  }

  /// The section [id]'s header, tapped to open it.
  Future<void> openSection(WidgetTester tester, String id) => tapOn(tester, find.byKey(ValueKey('form.section.$id')));

  /// Types into the form's box for [id], then lets a typing pause pass, so it is saved.
  Future<void> typeIn(WidgetTester tester, String id, String text) async {
    final box = find.byKey(ValueKey('phi.form.$id'));
    await reveal(tester, box);
    await tester.enterText(box, text);
    await tester.pump(const Duration(seconds: 2));
    await settle(tester);
  }

  /// Back to the tabs, as the system's back takes the person there, then Home.
  Future<void> home(WidgetTester tester) async {
    for (var i = 0; i < 5 && find.byType(NavigationBar).hitTestable().evaluate().isEmpty; i++) {
      await back(tester);
    }
    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')));
    await settle(tester);
  }

  for (final run in runs) {
    testWidgets('the Done when through the screens, offline then synced (${runName(run)})', (tester) async {
      final handle = tester.ensureSemantics();
      final h = await signInAsResident(tester, run);
      // The open team's database; another object once the app has started again.
      var store = h.sync.store!;

      // 1. Offline. Start, New encounter: the patient, the place, Medical.
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Start')));
      await settle(tester);
      expect(find.byType(StartSheet), findsOneWidget);
      await expectScreenOk(tester);
      await tapOn(tester, find.bySemanticsLabel('New encounter. Chart a visit, with or without a registered patient.'));
      expect(find.byType(NewEncounterScreen), findsOneWidget);
      await expectScreenOk(tester);
      await type(tester, 'visitSearch', preferred);
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Search'));
      await expectScreenOk(tester);
      await tapOn(tester, find.bySemanticsLabel(RegExp('^$preferred,')));
      await expectShown(tester, find.text('For $preferred'));
      await type(tester, 'locationText', encounter['locationText']! as String);
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Next'));
      await expectScreenOk(tester);
      await tapOn(tester, find.bySemanticsLabel('Medical: clinical notes, orders, signing'));
      final visit = visits(h).single.id;
      expect(find.byType(EncounterScreen), findsOneWidget);
      expect(
        [
          for (final f in ['kind', 'patientId', 'locationText']) store.record(visit)!.fields[f]?.value,
        ],
        [encounter['kind'], patientId, encounter['locationText']],
      );
      await expectScreenOk(tester);

      // General / primary care from the visit's list of note types, which brings the Red flags note.
      final ids = <String, String>{};
      await tapOn(tester, find.bySemanticsLabel(byRef('general')['title']! as String));
      ids['general'] = noteOfType(h, visit, 'general_primary_care')!.id;
      ids['redFlags'] = noteOfType(h, visit, 'red_flags_disposition')!.id;
      expectNoteOpened(tester, ids['general']!);
      await expectShown(tester, find.bySemanticsLabel('$preferred, General / primary care'));
      await pick(tester, 'Reason for encounter', 'New concern');
      // The person's taps and typing; what they store is checked against the story's answers below.
      await typeIn(tester, 'concern', storyAnswers(byRef('general'))['reason.concern']! as String);
      await openSection(tester, 'exam');
      await pick(tester, 'What did you examine?', 'Pulmonary');
      await expectScreenOk(tester);
      await back(tester);
      expect(find.byType(EncounterScreen), findsOneWidget);
      await expectShown(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
      await expectScreenOk(tester);

      // Wound care, from Add another note type: one wound.
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
      expect(find.byType(NoteTypesScreen), findsOneWidget);
      await expectScreenOk(tester);
      await tapOn(tester, find.bySemanticsLabel(byRef('wound')['title']! as String));
      ids['wound'] = noteOfType(h, visit, 'wound_care')!.id;
      expectNoteOpened(tester, ids['wound']!);
      final adding = DateTime.now().toUtc();
      await tapOn(tester, find.text('Add wound'));
      // One entry, added now: the form stamps it with the phone's own clock.
      final entry = [
        for (final MapEntry(:key, :value) in answersOf(h, ids['wound']!).entries)
          if (RegExp(r'^wound\.(e[a-z0-9]{7})\.entryAt$').firstMatch(key) case final m?)
            (id: m[1]!, at: value! as String),
      ].single;
      final entryAt = DateTime.parse(entry.at);
      expect(entryAt.isUtc, isTrue);
      expect(entryAt.difference(adding).inSeconds, inInclusiveRange(0, 60));
      await pick(tester, 'Location', 'Lower Body');
      await pick(tester, 'Front or back', 'Posterior');
      await pick(tester, 'Wound type', 'Pressure');
      await typeIn(tester, 'length', '${storyAnswers(byRef('wound'))['wound.edone001.measurements.length']}');
      await pick(tester, 'Dressing', 'Mepilex');
      await expectScreenOk(tester);
      await back(tester);

      // Social needs, a Non-Medical note in the Medical visit.
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Add another note type'));
      await tapOn(tester, find.bySemanticsLabel(byRef('social')['title']! as String));
      ids['social'] = noteOfType(h, visit, 'social_needs')!.id;
      expectNoteOpened(tester, ids['social']!);
      // One visit and its four draft notes on the phone; nothing has reached the server.
      final step1 = expectAt(1, 'phone');
      expect(visits(h), hasLength(step1['encounters']! as int));
      expect(notesOf(h, visit), hasLength(step1['notes']! as int));
      for (final id in ids.values) {
        expect(store.noteState(id)!.status.name, step1['noteStatus']);
      }
      expect(step1['sent'], 0);
      expect([h.server.records[visit], for (final id in ids.values) h.server.records[id]], everyElement(isNull));
      await pick(tester, 'Current needs', 'Food');
      await pick(tester, 'Housing status', 'Unsheltered');
      await expectScreenOk(tester);

      // Continue to the summary, which asks for the Red flags note: its disposition and follow-up
      // answered now, the red-flag question left for later.
      await tapOn(tester, find.widgetWithText(FilledButton, 'Continue'));
      expect(find.byType(SummaryScreen), findsOneWidget);
      final stop = find.bySemanticsLabel(
        'Red flags and disposition: Red flags, “Does the patient require emergency evaluation?” needs an answer.',
      );
      await expectShown(tester, stop);
      await expectScreenOk(tester);
      await tapOn(tester, stop);
      expectNoteOpened(tester, ids['redFlags']!);
      await openSection(tester, 'disposition');
      await pick(tester, 'Disposition', 'Follow-up');
      await openSection(tester, 'follow_up');
      await pick(tester, 'Follow up', 'PRN');
      await expectScreenOk(tester);

      // 2. Save & Close: the chart opens, and says so; nothing reached the server.
      await tapOn(tester, find.widgetWithText(OutlinedButton, 'Save & Close'));
      await settle(tester);
      expect(location(tester), '/patients/$patientId');
      expect(find.byType(PatientScreen), findsOneWidget);
      expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Saved as a draft')), findsOneWidget);
      await expectScreenOk(tester);
      final saved = [for (final e in store.outbox()) (e.changeId, e.valueHash)];

      // The app is killed and started again, still offline: the drafts are on the phone with every
      // answer, and the changes still wait to send, as they were.
      await killAndStart(tester, h);
      store = h.sync.store!;
      expect(location(tester), '/');
      expect([for (final e in store.outbox()) (e.changeId, e.valueHash)], saved);
      final step2 = expectAt(2, 'phone');
      expect(step2['sent'], 0);
      expect(visits(h), hasLength(step2['encounters']! as int));
      expect(notesOf(h, visit), hasLength(step2['notes']! as int));
      expect(ids.keys.toSet(), {for (final n in notes) n['ref']});
      for (final n in notes) {
        final id = ids[n['ref']]!;
        expect(store.noteState(id)!.status.name, step2['noteStatus']);
        final held = {for (final MapEntry(:key, :value) in answersOf(h, id).entries) key: ?value};
        expect(held, written(storyAnswers(n), entry), reason: n['ref'] as String);
      }
      expect(h.server.records[visit], isNull);
      expect(h.encounters.notesToFinish.count(null).notes, step2['notesToFinish']);

      // Home, where the app starts: Notes to finish says 4, and lists them, the phone's own.
      expect(find.byType(NavigationBar), findsOneWidget);
      final tile = find.text('${step2['notesToFinish']} notes to finish.');
      await expectShown(tester, tile);
      await expectScreenOk(tester);
      await tapOn(tester, tile);
      expect(location(tester), notesToFinishLocation);
      expect(find.byType(NotesToFinishScreen), findsOneWidget);
      for (final n in notes) {
        await expectShown(
          tester,
          find.bySemanticsLabel(RegExp('^$preferred, ${RegExp.escape(n['title']! as String)}, ')),
        );
      }
      await expectScreenOk(tester);

      // 3. The phone reconnects: the server holds the visit and its four drafts, every answer as
      // written; the drafts stay on the phone.
      h.server.offline = false;
      final firstPush = store.outbox();
      await syncAndRefresh(tester, h);
      expectHashConfirmed(h, 3, firstPush);
      final step3 = expectAt(3, 'server');
      expect(
        [
          for (final r in h.server.records.values)
            if (r.entity == entityEncounter && r.fields['patientId']?.value == patientId) r.id,
        ],
        [visit],
      );
      expect(
        h.server.records.values.where((r) => r.attributes['encounterId'] == visit),
        hasLength(step3['notes']! as int),
      );
      expect(h.server.records[visit]!.status, step3['encounterStatus']);
      for (final n in notes) {
        final id = ids[n['ref']]!;
        final onServer = h.server.records[id]!;
        expect([onServer.fields['status']?.value, onServer.attestation], [step3['noteStatus'], step3['attestation']]);
        expect(
          {
            for (final MapEntry(:key, :value) in onServer.fields.entries)
              if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
          },
          written(storyAnswers(n), entry),
          reason: n['ref'] as String,
        );
        expect(store.noteState(id)!.status.name, expectAt(3, 'phone')['noteStatus']);
      }
      expect(notesOf(h, visit), hasLength(expectAt(3, 'phone')['notes']! as int));

      // 4. Offline again, later. The visit opened from Notes to finish, the red-flag question
      // answered, the assessment written, Complete and sign.
      h.server.offline = true;
      const later = Duration(hours: 3);
      h.wall = h.wall.add(later);
      h.boot.advance(later);
      await home(tester);
      await tapOn(tester, tile);
      await tapOn(tester, find.bySemanticsLabel(RegExp('^$preferred, General / primary care, ')));
      expectNoteOpened(tester, ids['general']!);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Continue'));
      expect(location(tester), '/encounters/$visit/summary');
      expect(find.byType(SummaryScreen), findsOneWidget);
      await expectShown(tester, stop);
      await expectScreenOk(tester);
      await tapOn(tester, stop);
      expectNoteOpened(tester, ids['redFlags']!);
      await pick(tester, 'Does the patient require emergency evaluation?', 'NO');
      await expectScreenOk(tester);
      await tapOn(tester, find.widgetWithText(FilledButton, 'Continue'));
      expect(find.byType(SummaryScreen), findsOneWidget);
      await typeIn(tester, 'summary', assessment);
      final step4 = expectAt(4, 'phone');
      final complete = find.widgetWithText(FilledButton, step4['button']! as String);
      await expectShown(tester, complete);
      await expectShown(
        tester,
        find.text('By completing, you sign this note as ${resident['displayName']}, Resident.'),
      );
      expect(find.textContaining('needs an answer'), findsNothing);
      await expectScreenOk(tester);
      await tapOn(tester, complete);
      await settle(tester);

      // Four sign-offs wait to send, in the order the store sends them.
      final planned = (step4['outbox']! as List<Object?>).cast<Map<String, Object?>>();
      final signoffs = [
        for (final e in store.outbox())
          if (e.entity == entitySignoff) e,
      ];
      expect(
        [
          for (final e in signoffs)
            ((e.value! as Map<String, Object?>)['noteId'], (e.value! as Map<String, Object?>)['act']),
        ],
        [for (final p in planned) (ids[p['note']], p['act'])],
      );
      expect(store.record(visit)!.fields['summary']?.value, assessment);
      for (final n in notes) {
        final id = ids[n['ref']]!;
        expect({
          for (final MapEntry(:key, :value) in answersOf(h, id).entries) key: ?value,
        }, written(finalAnswers(n), entry));
      }
      // The chart opens with the visit marked "Waiting to send".
      expect(step4['opens'], 'chart');
      expect(location(tester), '/patients/$patientId');
      expect(find.descendant(of: find.byType(SnackBar), matching: find.text('Signed')), findsOneWidget);
      final waiting = find.bySemanticsLabel(RegExp('Medical visit, ${step4['visitLabel']}, '));
      await expectShown(tester, waiting);
      await expectScreenOk(tester);
      // The notes are read-only: each opens as its read view.
      expect(step4['readOnly'], isTrue);
      for (final n in notes) {
        await openNote(tester, ids[n['ref']]!);
        await expectShown(tester, find.byType(NoteReadView));
        expect(find.byType(TextField), findsNothing);
        expect(find.text('Save & Close'), findsNothing);
        await expectScreenOk(tester);
        await back(tester);
      }

      // 5 and 6. The phone reconnects: the server signs the Medical notes and completes Social
      // needs; the visit and its notes leave the phone, and nothing is left to finish.
      h.server.offline = false;
      final secondPush = store.outbox();
      await syncAndRefresh(tester, h);
      expectHashConfirmed(h, 5, secondPush);
      final step5 = expectAt(5, 'server');
      expect(h.server.records[visit]!.status, step5['encounterStatus']);
      final effects = <String, int>{};
      for (final r in h.server.records.values) {
        if (r.entity == entitySignoff && ids.values.contains(r.attributes['noteId'])) {
          effects.update(r.attributes['effect']! as String, (c) => c + 1, ifAbsent: () => 1);
        }
      }
      expect(effects, step5['effects']);
      expect(effects.values.fold(0, (a, b) => a + b), step5['signoffs']);
      for (final (i, s) in signoffs.indexed) {
        final n = byRef(planned[i]['note']! as String);
        expect(h.server.records[s.recordId]!.attributes['effect'], n['effect'], reason: n['ref'] as String);
        expect(h.server.receipts[s.changeId]!.details, containsPair('effect', n['effect']));
      }
      for (final n in notes) {
        final r = h.server.records[ids[n['ref']]]!;
        final after = n['afterStep5']! as Map<String, Object?>;
        expect([r.fields['status']?.value, r.attestation], [after['status'], after['attestation']]);
        expect(
          {
            for (final MapEntry(:key, :value) in r.fields.entries)
              if (key.startsWith('data.') && value.value != null) key.substring('data.'.length): value.value,
          },
          written(finalAnswers(n), entry),
          reason: n['ref'] as String,
        );
      }
      final step6 = expectAt(6, 'phone');
      expect(visits(h), hasLength(step6['encounters']! as int));
      expect(notesOf(h, visit), hasLength(step6['notes']! as int));
      expect(store.record(visit), isNull);
      expect(h.encounters.notesToFinish.count(null).notes, step6['notesToFinish']);
      expect(find.bySemanticsLabel(RegExp('Waiting to send')), findsNothing);
      await home(tester);
      expect(find.textContaining('to finish'), findsNothing);
      await expectScreenOk(tester);
      handle.dispose();
    });
  }
}
