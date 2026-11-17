import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/generated/api.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/forms/forms_api.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'forms_fake.dart';

/// The two forms routes through the generated client, and a team's note types brought up to date
/// from them (phase 4 design, forms 3.3 and 3.4): the list, then each definition the phone holds
/// neither in its presets nor in its files. A definition whose hash is not the listed one is
/// refused, and a fetch that fails changes nothing.
void main() {
  const userId = 'user-1';
  const teamId = 'team-0';
  late Directory dir;
  late FakeFormsServer server;
  late DefinitionStore store;
  late DefinitionSync sync;
  late FormsApi api;

  final checks = sampleVersion('checks_demo', 1);
  final visit = sampleVersion('demo_visit', 1);
  final wound = sampleVersion('demo_wound', 1);
  final quick1 = sampleVersion('demo_quick', 1);
  final quick2 = sampleVersion('demo_quick', 2);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('forms_api');
    server = FakeFormsServer();
    store = DefinitionStore(directory: () async => dir.path, presets: () async => [checks]);
    sync = DefinitionSync(store);
    api = FormsApi(SineobexApi(server.transportFor(teamId)));
  });
  tearDown(() => dir.deleteSync(recursive: true));

  Future<List<String>> listed() async => [
    for (final d in (await store.team(userId, teamId))?.listed ?? const <NoteTypeDef>[]) '${d.key} v${d.version}',
  ];

  test('asks for the list and one version at their routes', () async {
    server.teams[teamId] = [checks, quick1, quick2];
    final list = await api.list();
    expect(
      [for (final v in list) '${v.key} v${v.version} ${v.hash}'],
      ['checks_demo v1 ${checks['hash']}', 'demo_quick v2 ${quick2['hash']}'],
    );
    final one = await api.version('demo_quick', 1);
    expect(one.listed.hash, quick1['hash']);
    expect(one.definition, quick1['definition']);
    expect(server.requests, ['/v1/forms/note-types', '/v1/forms/note-types/demo_quick/1']);
  });

  test('downloads only what neither the presets nor the files hold', () async {
    server.teams[teamId] = [checks, visit, quick1];
    await sync.refresh(userId, teamId, api);
    expect(await listed(), ['checks_demo v1', 'demo_quick v1', 'demo_visit v1']);
    expect(server.versionRequests, ['demo_quick/1', 'demo_visit/1']);

    // Each sync asks for the list again; what is held is not downloaded again.
    server.teams[teamId] = [checks, visit, quick1, quick2];
    await sync.refresh(userId, teamId, api);
    expect(server.listRequests, 2);
    expect(server.versionRequests, ['demo_quick/1', 'demo_visit/1', 'demo_quick/2']);
    expect(await listed(), ['checks_demo v1', 'demo_quick v2', 'demo_visit v1']);
    // The version the list moved on from stays, for the drafts started on it.
    expect((await store.definition(userId, teamId, 'demo_quick', 1))?.version, 1);
  });

  test('a definition whose hash is not the listed one is refused; the list kept before stays', () async {
    server.teams[teamId] = [checks, visit];
    await sync.refresh(userId, teamId, api);
    server.teams[teamId] = [checks, visit, wound, quick1];
    server.answers['demo_wound/1'] = {...wound, 'definition': edited(wound, 'Demo: altered')['definition']};
    await expectLater(sync.refresh(userId, teamId, api), throwsA(isA<DefinitionRefused>()));
    expect(await listed(), ['checks_demo v1', 'demo_visit v1']);
    expect(await store.definition(userId, teamId, 'demo_wound', 1), isNull);
    // What did check out is kept: the next fetch need not download it again.
    expect((await store.definition(userId, teamId, 'demo_quick', 1))?.version, 1);
  });

  test('an answer for another version, or with another hash than listed, is refused', () async {
    server.teams[teamId] = [visit, quick2];
    server.answers['demo_quick/2'] = quick1;
    await expectLater(sync.refresh(userId, teamId, api), throwsA(isA<DefinitionRefused>()));
    server.answers['demo_quick/2'] = {...quick2, 'hash': quick1['hash']};
    await expectLater(sync.refresh(userId, teamId, api), throwsA(isA<DefinitionRefused>()));
    expect(await store.team(userId, teamId), isNull);
  });

  test('a fetch that fails changes nothing: offline, or a version the server doesn’t answer', () async {
    server.teams[teamId] = [checks, visit];
    await sync.refresh(userId, teamId, api);
    server.teams[teamId] = [checks, quick1];
    server.offline = true;
    await expectLater(sync.refresh(userId, teamId, api), throwsA(isA<NetworkException>()));
    expect(await listed(), ['checks_demo v1', 'demo_visit v1']);
    server.offline = false;
    server.answers['demo_quick/1'] = const ApiException(404, 'not_found', 'Not found.');
    await expectLater(sync.refresh(userId, teamId, api), throwsA(isA<ApiException>()));
    expect(await listed(), ['checks_demo v1', 'demo_visit v1']);
  });

  test('a team the server refuses keeps no list: the phone asks to connect once, as the API leaves it', () async {
    await expectLater(
      sync.refresh(userId, teamId, api),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'not_a_member')),
    );
    expect(await store.team(userId, teamId), isNull);
    server.teams[teamId] = [];
    await sync.refresh(userId, teamId, api);
    expect(await listed(), isEmpty, reason: 'an empty list the server gives is kept');
  });

  test('a phone with no network still has the presets and what it fetched last', () async {
    server.teams[teamId] = [checks, visit];
    await sync.refresh(userId, teamId, api);
    server.offline = true;
    final restarted = DefinitionStore(directory: () async => dir.path, presets: () async => [checks]);
    await expectLater(DefinitionSync(restarted).refresh(userId, teamId, api), throwsA(isA<NetworkException>()));
    final team = (await restarted.team(userId, teamId))!;
    expect(team.startable('checks_demo', 1), isNotNull);
    expect(team.startable('demo_visit', 1), isNotNull);
  });

  test('two fetches for one team at once ask once', () async {
    server.teams[teamId] = [checks, visit];
    server.holds['/v1/forms/note-types'] = Completer<void>();
    final first = sync.refresh(userId, teamId, api);
    final second = sync.refresh(userId, teamId, api);
    server.holds.values.single.complete();
    await Future.wait([first, second]);
    expect(server.listRequests, 1);
    // Once that one is done, the next asks again.
    await sync.refresh(userId, teamId, api);
    expect(server.listRequests, 2);
  });

  test('a download on its way when the person is forgotten writes nothing back', () async {
    server.teams[teamId] = [checks, visit];
    server.holds['/v1/forms/note-types/demo_visit/1'] = Completer<void>();
    final run = sync.refresh(userId, teamId, api).then<Object?>((_) => null, onError: (Object e) => e);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await store.forgetUser(userId);
    server.holds.values.single.complete();
    expect(await run, isA<StateError>());
    expect(dir.listSync(recursive: true).whereType<File>(), isEmpty);
    expect(await store.team(userId, teamId), isNull);
  });

  test('a list on its way when the person is forgotten writes nothing back either', () async {
    server.teams[teamId] = [checks, visit];
    server.holds['/v1/forms/note-types'] = Completer<void>();
    final run = sync.refresh(userId, teamId, api).then<Object?>((_) => null, onError: (Object e) => e);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await store.forgetUser(userId);
    server.holds.values.single.complete();
    expect(await run, isA<StateError>());
    expect(dir.listSync(recursive: true).whereType<File>(), isEmpty);
  });

  test('a fetch handed a generation from before a sign-out asks nothing and keeps nothing', () async {
    server.teams[teamId] = [checks, visit];
    final began = store.generation(userId, teamId);
    await store.forgetUser(userId);
    await expectLater(sync.refresh(userId, teamId, api, generation: began), throwsStateError);
    expect(server.requests, isEmpty);
    expect(await store.team(userId, teamId), isNull);
  });

  test('a fetch begun after a sign-out is not joined to one begun before it, which keeps nothing', () async {
    server.teams[teamId] = [checks, visit];
    final hold = server.holds['/v1/forms/note-types'] = Completer<void>();
    final before = sync.refresh(userId, teamId, api).then<Object?>((_) => null, onError: (Object e) => e);
    await Future<void>.delayed(const Duration(milliseconds: 10));
    await store.forgetUser(userId);
    final after = sync.refresh(userId, teamId, api);
    hold.complete();
    expect(await before, isA<StateError>());
    await after;
    expect(await listed(), ['checks_demo v1', 'demo_visit v1']);
  });

  test('a version a note holds but the list no longer names is downloaded and checked', () async {
    server.teams[teamId] = [checks, quick1, quick2];
    expect((await sync.fetchVersion(userId, teamId, 'demo_quick', 1, api)).version, 1);
    expect((await store.definition(userId, teamId, 'demo_quick', 1))?.version, 1);
    // Held now: not downloaded again.
    await sync.fetchVersion(userId, teamId, 'demo_quick', 1, api);
    expect(server.versionRequests, ['demo_quick/1']);
    // An answer whose definition is not its hash's is refused.
    server.answers['demo_quick/2'] = {...quick2, 'definition': edited(quick2, 'Demo: altered')['definition']};
    await expectLater(sync.fetchVersion(userId, teamId, 'demo_quick', 2, api), throwsA(isA<DefinitionRefused>()));
    expect(await store.definition(userId, teamId, 'demo_quick', 2), isNull);
  });

  test('the refresher brings the team up to date for every reason, and leaves failures to the engine', () async {
    server.teams[teamId] = [checks, visit];
    final refresher = DefinitionRefresher(sync, api, userId: userId, teamId: teamId);
    for (final reason in RefreshReason.values) {
      await refresher.refresh(reason);
    }
    expect(server.listRequests, RefreshReason.values.length);
    expect(await listed(), ['checks_demo v1', 'demo_visit v1']);
    server.offline = true;
    await expectLater(refresher.refresh(RefreshReason.afterSync), throwsA(isA<NetworkException>()));
  });
}
