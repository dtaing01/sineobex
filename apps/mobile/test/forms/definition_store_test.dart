import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sineobex_field/forms/definition_store.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

import 'forms_fake.dart';

/// The phone's copy of its teams' note type definitions (phase 4 design, forms 3.4): the bundled
/// presets first, then plain JSON files, one per team, key and version. What it keeps is checked
/// against the hash the team's list gives; it survives a restart, so a phone with no network still
/// has what it fetched last; and it goes, per person or per team, at sign-out and at a wipe.
void main() {
  const userId = 'user-1';
  const teamId = 'team-0';
  late Directory dir;
  late List<Version> bundled;
  late DefinitionStore store;

  DefinitionStore open() => DefinitionStore(directory: () async => dir.path, presets: () async => bundled);

  ListedVersion listed(Version v) =>
      ListedVersion(key: v['key']! as String, version: v['version']! as int, hash: v['hash']! as String);

  Future<void> keep(Version v, {String user = userId, String team = teamId}) => store.keep(
    user,
    team,
    listed(v),
    v['definition']! as Map<String, Object?>,
    generation: store.generation(user, team),
  );

  Future<void> keepList(List<Version> versions, {String user = userId, String team = teamId}) =>
      store.keepList(user, team, [for (final v in versions) listed(v)], generation: store.generation(user, team));

  List<String> files() =>
      [for (final f in dir.listSync(recursive: true).whereType<File>()) p.relative(f.path, from: dir.path)]..sort();

  final checks = sampleVersion('checks_demo', 1);
  final full = sampleVersion('full_demo', 1);
  final visit = sampleVersion('demo_visit', 1);
  final quick1 = sampleVersion('demo_quick', 1);
  final quick2 = sampleVersion('demo_quick', 2);

  setUp(() {
    dir = Directory.systemTemp.createTempSync('definitions');
    bundled = [checks, full];
    store = open();
  });
  tearDown(() => dir.deleteSync(recursive: true));

  test('a team with no list yet has none: Start asks to connect once', () async {
    expect(await store.team(userId, teamId), isNull);
    expect(await store.definition(userId, teamId, 'checks_demo', 1), isNull);
  });

  test('starts from the bundled presets: a listed preset is read from them and not copied', () async {
    expect(await store.holds(userId, teamId, listed(checks)), isTrue);
    expect(await store.holds(userId, teamId, listed(visit)), isFalse);
    await keepList([checks, full]);
    final team = (await store.team(userId, teamId))!;
    expect([for (final d in team.listed) '${d.key} v${d.version}'], ['checks_demo v1', 'full_demo v1']);
    // Each version file names the team's hash; the definition stays in the app's own asset.
    for (final f in files()) {
      expect((jsonDecode(File(p.join(dir.path, f)).readAsStringSync()) as Map).containsKey('definition'), isFalse);
    }
  });

  // A widget test signs in on its fake clock, then syncs in real time (runAsync): the presets the
  // sign-in read must not be reached through a future of the zone that read them, whose callbacks
  // run only when that zone is pumped. Once the nine were released this hung every patient screen
  // test.
  test('presets read in one zone are held for another that never runs the first one’s callbacks', () async {
    final parked = <void Function()>[];
    final reader = Zone.current.fork(
      specification: ZoneSpecification(scheduleMicrotask: (self, parent, zone, f) => parked.add(() => zone.run(f))),
    );
    var read = false;
    unawaited(reader.run(() => store.holds(userId, teamId, listed(checks)).then((_) => read = true)));
    while (!read) {
      final now = [...parked];
      parked.clear();
      for (final run in now) {
        run();
      }
      await Future<void>.delayed(Duration.zero);
    }
    // The reading zone's callbacks are never run again.
    expect(await store.holds(userId, teamId, listed(full)).timeout(const Duration(seconds: 5)), isTrue);
  });

  test('a bundled preset whose hash is not its definition’s is not used', () async {
    bundled = [edited(checks, 'Demo: changed')..['hash'] = checks['hash']];
    store = open();
    expect(await store.holds(userId, teamId, listed(checks)), isFalse);
  });

  test('a definition whose hash is not the one the list gives is refused and not kept', () async {
    final changed = edited(visit, 'Demo: not what was listed');
    await expectLater(
      store.keep(
        userId,
        teamId,
        listed(visit),
        changed['definition']! as Map<String, Object?>,
        generation: store.generation(userId, teamId),
      ),
      throwsA(isA<DefinitionRefused>()),
    );
    expect(files(), isEmpty);
    expect(await store.holds(userId, teamId, listed(visit)), isFalse);
  });

  test('a definition for another key or version than the one listed is refused', () async {
    // Its own hash is right: it is just not the version asked for.
    await expectLater(
      store.keep(
        userId,
        teamId,
        ListedVersion(key: 'demo_quick', version: 2, hash: quick1['hash']! as String),
        quick1['definition']! as Map<String, Object?>,
        generation: store.generation(userId, teamId),
      ),
      throwsA(isA<DefinitionRefused>()),
    );
    expect(files(), isEmpty);
  });

  test('a definition the phone cannot read is refused, whatever its hash', () async {
    final unreadable = {...visit['definition']! as Map<String, Object?>, 'sections': 'none'};
    await expectLater(
      store.keep(
        userId,
        teamId,
        ListedVersion(key: 'demo_visit', version: 1, hash: valueHash(unreadable)),
        unreadable,
        generation: store.generation(userId, teamId),
      ),
      throwsA(isA<DefinitionRefused>()),
    );
    expect(files(), isEmpty);
  });

  test('a list is kept only once every definition it names is held, and the last one stays', () async {
    await keep(visit);
    await keepList([checks, visit]);
    await expectLater(keepList([checks, visit, quick1]), throwsStateError);
    final team = (await store.team(userId, teamId))!;
    expect([for (final d in team.listed) d.key], ['checks_demo', 'demo_visit']);
  });

  test('a phone starts a note only on a key and version from the team’s list', () async {
    await keep(quick1);
    await keepList([checks, quick1]);
    await keep(quick2);
    await keepList([checks, quick2]);
    final team = (await store.team(userId, teamId))!;
    expect(team.startable('demo_quick', 2)?.version, 2);
    expect(team.startable('demo_quick', 1), isNull, reason: 'an older version is not offered');
    expect(team.startable('full_demo', 1), isNull, reason: 'a preset the team does not list is not offered');
    expect(team.startable('demo_visit', 1), isNull);
    // The phone keeps every version it held, so an old draft still opens.
    expect((await store.definition(userId, teamId, 'demo_quick', 1))?.version, 1);
    expect((await store.definition(userId, teamId, 'checks_demo', 1))?.key, 'checks_demo');
    expect(await store.definition(userId, teamId, 'full_demo', 1), isNull, reason: 'never on this team’s list');
  });

  test('a team’s own version is told apart from a bundled preset of the same key and version', () async {
    final own = edited(checks, 'Demo: the team’s own');
    await keep(own);
    await keepList([own]);
    final team = (await store.team(userId, teamId))!;
    expect(team.startable('checks_demo', 1)?.title, 'Demo: the team’s own');
    expect((await store.definition(userId, teamId, 'checks_demo', 1))?.title, 'Demo: the team’s own');
  });

  test('offline after a restart, the phone has the bundled presets and what it fetched last', () async {
    await keep(visit);
    await keepList([checks, visit]);
    final restarted = open();
    final team = (await restarted.team(userId, teamId))!;
    expect([for (final d in team.listed) d.key], ['checks_demo', 'demo_visit']);
    expect(team.startable('demo_visit', 1)?.title, (visit['definition']! as Map<String, Object?>)['title']);
  });

  test('a file changed on disk is not used, and the next fetch can replace it', () async {
    await keep(visit);
    await keepList([visit]);
    final path = files().singleWhere((f) => f.endsWith('demo_visit.1.json'));
    final file = File(p.join(dir.path, path));
    final json = jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    file.writeAsStringSync(jsonEncode({...json, 'definition': edited(visit, 'Demo: altered')['definition']}));
    final restarted = open();
    expect((await restarted.team(userId, teamId))!.listed, isEmpty);
    expect(await restarted.holds(userId, teamId, listed(visit)), isFalse);
    expect(await restarted.definition(userId, teamId, 'demo_visit', 1), isNull);
  });

  test('each person and each team has its own copy; the person is not named on disk', () async {
    await keep(visit);
    await keepList([visit]);
    expect(await store.team('user-2', teamId), isNull);
    expect(await store.team(userId, 'team-1'), isNull);
    expect(await store.holds('user-2', teamId, listed(visit)), isFalse);
    expect(files().where((f) => f.contains(userId)), isEmpty);
  });

  test('forgetting a person deletes their files, every team, and only theirs', () async {
    for (final (user, team) in [(userId, teamId), (userId, 'team-1'), ('user-2', teamId)]) {
      await keep(visit, user: user, team: team);
      await keepList([checks, visit], user: user, team: team);
    }
    await store.forgetUser(userId);
    expect(await store.team(userId, teamId), isNull);
    expect(await store.team(userId, 'team-1'), isNull);
    expect(await store.team('user-2', teamId), isNotNull);
    expect(await open().team(userId, teamId), isNull);
    expect(await open().team('user-2', teamId), isNotNull);
  });

  test('forgetting a team deletes only that team’s files', () async {
    for (final team in [teamId, 'team-1']) {
      await keep(visit, team: team);
      await keepList([visit], team: team);
    }
    await store.forgetTeam(userId, teamId);
    expect(await store.team(userId, teamId), isNull);
    expect(await store.definition(userId, teamId, 'demo_visit', 1), isNull);
    expect(await store.team(userId, 'team-1'), isNotNull);
    expect(await open().team(userId, teamId), isNull);
  });

  test('a fetch that began before its person was forgotten writes nothing back', () async {
    final before = store.generation(userId, teamId);
    await store.forgetUser(userId);
    await expectLater(
      store.keep(userId, teamId, listed(visit), visit['definition']! as Map<String, Object?>, generation: before),
      throwsStateError,
    );
    await expectLater(store.keepList(userId, teamId, [listed(checks)], generation: before), throwsStateError);
    expect(files(), isEmpty);
    expect(await store.team(userId, teamId), isNull);
  });

  test('a list kept tells the listeners; forgetting does too', () async {
    var told = 0;
    store.addListener(() => told++);
    await keepList([checks]);
    expect(told, 1);
    await store.forgetUser(userId);
    expect(told, 2);
  });

  test('a definition kept tells the listeners, so a screen waiting on an old draft’s version opens it', () async {
    var told = 0;
    store.addListener(() => told++);
    await keep(quick1);
    expect(told, 1);
  });

  test('a wipe of one team stops no fetch of another', () async {
    final began = store.generation(userId, teamId);
    await store.forgetTeam(userId, 'team-1');
    expect(store.generation(userId, teamId), began);
    await store.keep(userId, teamId, listed(visit), visit['definition']! as Map<String, Object?>, generation: began);
    await store.keepList(userId, teamId, [listed(visit)], generation: began);
    expect(await store.team(userId, teamId), isNotNull);
    await store.forgetUser(userId);
    expect(store.generation(userId, teamId), isNot(began), reason: 'a sign-out stops every team’s');
  });

  group('a list read while a newer one is kept, or the files deleted, is not what the screens get', () {
    late Completer<void> slow;

    /// A restarted store whose presets come in only when [slow] completes, so a read of the list
    /// waits part way.
    DefinitionStore restarted() {
      slow = Completer<void>();
      return DefinitionStore(
        directory: () async => dir.path,
        presets: () async {
          await slow.future;
          return bundled;
        },
      );
    }

    setUp(() async {
      await keep(quick1);
      await keep(visit);
      await keepList([checks, quick1, visit]);
      await keep(quick2);
    });

    test('a newer list', () async {
      store = restarted();
      // The old list names more versions than the new one, so its read finishes last.
      final reading = store.team(userId, teamId);
      final keeping = keepList([quick2]);
      slow.complete();
      await Future.wait([reading, keeping]);
      final team = (await store.team(userId, teamId))!;
      expect(team.startable('demo_quick', 2), isNotNull);
      expect(team.startable('demo_quick', 1), isNull);
    });

    test('a sign-out', () async {
      store = restarted();
      final reading = store.team(userId, teamId);
      await Future<void>.delayed(Duration.zero);
      final forgetting = store.forgetUser(userId);
      slow.complete();
      await Future.wait([reading, forgetting]);
      expect(files(), isEmpty);
      expect(await store.team(userId, teamId), isNull, reason: 'nothing held: Start asks to connect once');
    });
  });

  test('a key or a team that could leave its folder is refused', () async {
    await expectLater(store.team(userId, '../x'), throwsArgumentError);
    await expectLater(
      store.holds(userId, teamId, ListedVersion(key: '../demo', version: 1, hash: visit['hash']! as String)),
      throwsArgumentError,
    );
  });
}
