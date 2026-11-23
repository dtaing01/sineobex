import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/encounters/note_definitions.dart';
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/forms/finish.dart';
import 'package:sineobex_field/forms/forms_api.dart';

import 'forms_fake.dart';

/// A note stays on the version it began on (PRD main 387; forms 2.6; phase 5 design 5.4 rule 4, 6.4),
/// on the phone: a team's publish moves the list a phone starts new notes from, never the version a
/// draft opens, completes and is corrected on, offline too; another phone opens such a draft by
/// downloading that version; and a note type the team removed leaves the list while its drafts still
/// open and finish (the fake's rule, card P4-offered). The server's half is
/// services/api/test/note-type-versions.test.ts.
void main() {
  const userId = 'a0000000-0000-4000-8000-00000000000a';
  const teamId = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  late Directory dir;
  late FakeFormsServer server;

  final quick1 = sampleVersion('demo_quick', 1);
  final quick2 = sampleVersion('demo_quick', 2);
  final social = sampleVersion('demo_social', 1);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('note_type_version');
    server = FakeFormsServer();
  });
  tearDown(() => dir.deleteSync(recursive: true));

  /// A phone: its own files, its own fetch, the same team's server.
  ({DefinitionStore store, DefinitionSync sync, FormsApi api}) phone(String folder) {
    final store = DefinitionStore(
      directory: () async => Directory('${dir.path}/$folder').create(recursive: true).then((d) => d.path),
      presets: () async => const [],
    );
    return (store: store, sync: DefinitionSync(store), api: FormsApi(SineobexApi(server.transportFor(teamId))));
  }

  test('a draft begun on version 1 opens on version 1, offline too, once the list moves to version 2', () async {
    final a = phone('a');
    server.teams[teamId] = [quick1];
    await a.sync.refresh(userId, teamId, a.api);
    expect((await a.store.team(userId, teamId))!.startable('demo_quick', 1), isNotNull);

    // The team publishes version 2: new notes start on it.
    server.teams[teamId] = [quick1, quick2];
    await a.sync.refresh(userId, teamId, a.api);
    final team = (await a.store.team(userId, teamId))!;
    expect(team.startable('demo_quick', 2), isNotNull);
    expect(team.startable('demo_quick', 1), isNull, reason: 'a new note starts on the newest version only');

    // The draft opens on its own version, from the phone's files, with no network.
    server.offline = true;
    final defs = NoteDefinitions.team(a.store, userId: userId, teamId: teamId, api: a.api);
    final draft = await defs.load('demo_quick', 1);
    expect([draft?.key, draft?.version], ['demo_quick', 1]);
    // A field version 2 left out is still asked of the draft, and answered there.
    final spo2 = draft!.sections.expand((s) => s.fields).where((f) => f.id == 'spo2');
    expect(spo2, isNotEmpty, reason: 'version 1 holds what version 2 hid');
    expect(finishCheck(draft, const {}), isA<List<FinishProblem>>());
  });

  test('another phone opens a note on version 1 though its list names version 2: it downloads that one', () async {
    server.teams[teamId] = [quick1, quick2];
    final b = phone('b');
    await b.sync.refresh(userId, teamId, b.api);
    expect(server.versionRequests, ['demo_quick/2'], reason: 'the list names version 2 alone');
    final defs = NoteDefinitions.team(b.store, userId: userId, teamId: teamId, api: b.api);
    final draft = await defs.load('demo_quick', 1);
    expect([draft?.key, draft?.version], ['demo_quick', 1]);
    expect(server.versionRequests, ['demo_quick/2', 'demo_quick/1']);
    // Kept: offline, it opens again from this phone's files.
    server.offline = true;
    expect((await b.store.definition(userId, teamId, 'demo_quick', 1))?.version, 1);
  });

  test('a removed note type leaves the list, while a draft on it still opens and finishes, offline too', () async {
    final a = phone('a');
    server.teams[teamId] = [quick2, social];
    await a.sync.refresh(userId, teamId, a.api);
    expect((await a.store.team(userId, teamId))!.startable('demo_social', 1), isNotNull);

    server.archive(teamId, 'demo_social');
    await a.sync.refresh(userId, teamId, a.api);
    final team = (await a.store.team(userId, teamId))!;
    expect([for (final d in team.listed) d.key], ['demo_quick']);
    expect(team.startable('demo_social', 1), isNull, reason: 'no new note is offered on it');

    server.offline = true;
    final defs = NoteDefinitions.team(a.store, userId: userId, teamId: teamId, api: a.api);
    final draft = await defs.load('demo_social', 1);
    expect([draft?.key, draft?.version], ['demo_social', 1]);
    expect(finishCheck(draft!, const {}), isA<List<FinishProblem>>());

    // Another phone that never held it downloads it: every version of a removed type still serves.
    server.offline = false;
    final b = phone('b');
    await b.sync.refresh(userId, teamId, b.api);
    final other = NoteDefinitions.team(b.store, userId: userId, teamId: teamId, api: b.api);
    expect((await other.load('demo_social', 1))?.version, 1);
  });
}
