import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/design/widgets/flag_pill.dart';
import 'package:sineobex_field/features/presets/team_setup_screen.dart' show conditionsHeading, riskLevelHeading;
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/flags.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show Intake;
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/presets/presets_refresher.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange, entityPatient;
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';
import 'platform_presets.dart';

/// The phone's test server behind a recorder of the presets pulls: each one's query and its answer,
/// as JSON carried them.
class _Pulls implements ApiTransport {
  _Pulls(this.inner);
  final ApiTransport inner;
  final pulls = <({Map<String, String> query, Map<String, Object?> answer})>[];

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    final answer = await inner.send(method, path, query: query, body: body);
    if (method == 'GET' && path == '/v1/presets') {
      pulls.add((query: {...?query}, answer: jsonDecode(jsonEncode(answer)) as Map<String, Object?>));
    }
    return answer;
  }
}

/// The phase 5 Done when against the phone's test server (design 10.1, steps 1, 6, 7 and 8, card
/// P6-phone): "An admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three
/// after its next sync." Through the domain layer, as the screens drive it, with the story, its people
/// and its names from presets-done-when.json, which the API's presets-done-when.test.ts (steps 2 to
/// 5), the screens' done_when_screens_test.dart, live_presets_test.dart (steps 1 to 8 on the real API)
/// and the portal's presets.spec.ts and patient-flags.spec.ts read too. The test server holds no
/// installer and no admin routes: the team is given every platform preset as the installer gives a new
/// team its copies (platform_presets.dart), and steps 2 to 4's presets are written into it as the admin
/// routes leave them, each under the team's next revision. Step 5's refusals, and the audit events of
/// steps 2 to 8, are the API's to hold.
void main() {
  final story = jsonDecode(
    File('../../packages/contract/test-vectors/presets-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final staffPerson = (story['people']! as Map<String, Object?>)['staff']! as Map<String, Object?>;
  final patient = story['patient']! as Map<String, Object?>;
  final presets = (story['presets']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> presetOf(String ref) => presets.singleWhere((p) => p['ref'] == ref);
  Map<String, Object?> stepOf(int n) =>
      (story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n);
  Map<String, Object?> expectAt(int n) => stepOf(n)['expect']! as Map<String, Object?>;
  String nameOf(String ref) => (presetOf(ref)['body']! as Map<String, Object?>)['name']! as String;

  const team = 'd05e0000-0000-4000-8000-0000000000a1';
  const staff = 'd05e0000-0000-4000-8000-0000000000b1';
  final start = DateTime.utc(2026, 11, 24, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  late _Pulls network;
  late TestPhone phone;
  late PatientServices services;

  /// The team's ID of each platform preset, by origin key, as the installer gave them.
  late Map<String, String> platformIds;

  /// The ID of each preset the story's steps made, by its ref.
  final made = <String, String>{};

  /// A body of the story as the team holds it: each {platform: originKey} the team's copy of that
  /// platform preset and each {preset: ref} the preset an earlier step made, by ID (the story's note).
  Object? asHeld(Object? value) => switch (value) {
    final List<Object?> list => [for (final v in list) asHeld(v)],
    {'platform': final String key} => platformIds[key],
    {'preset': final String ref} => made[ref],
    final Map<String, Object?> map => {for (final MapEntry(:key, :value) in map.entries) key: asHeld(value)},
    _ => value,
  };

  setUp(() {
    serverTime = start;
    made.clear();
    server = FakeSyncServer(now: () => serverTime)
      ..permissions[staff] = FakeSyncServer.healthcareStaff
      ..names[staff] = staffPerson['displayName']! as String;
    expect(staffPerson['role'], 'healthcare_staff');
    platformIds = givePlatformPresets(server, team);
    network = _Pulls(server.transportFor(staff, team));
    phone = TestPhone(userId: staff, teamId: team, transport: () => network, wall: start);
    final open = OpenTeam(
      userId: staff,
      teamId: team,
      store: phone.store,
      api: phone.engine.api,
      clock: phone.clock,
      permissions: FakeSyncServer.healthcareStaff.toList(),
    );
    services = PatientServices(open, copy: (_) async => true, wallNow: () => phone.wall);
    // As the app wires them (app_providers.dart appRefreshers): the patient services, then the
    // team's presets, after the index.
    phone.engine.refreshers
      ..clear()
      ..addAll([...services.refreshers, ...presetRefreshers(open, openStore: () => phone.store)]);
  });
  tearDown(() => phone.close());

  /// Time passes on the phone and on the server alike, so the clock check still holds.
  void later(Duration d) {
    phone.advance(d);
    serverTime = serverTime.add(d);
  }

  /// The phone's copy as its table holds it, by ID: each row's kind, version, state, origin key and
  /// body as the server sent it.
  Map<String, ({String kind, int version, String state, String? originKey, Object? body})> copy() => {
    for (final r in phone.store.database.select('SELECT id, kind, version, state, origin_key, body_json FROM presets'))
      r['id']! as String: (
        kind: r['kind']! as String,
        version: r['version']! as int,
        state: r['state']! as String,
        originKey: r['origin_key'] as String?,
        body: jsonDecode(r['body_json']! as String),
      ),
  };

  test('an admin adds a Labs item, a bundle and a secondary flag, and the phone sees all three after its next '
      'sync, then flags the patient with the new flag offline (design 10.1, steps 1, 6, 7 and 8)', () async {
    final copyOf = PresetStore(phone.store);

    // 1. The staff member's phone, signed in to the team, registers the patient and syncs; its first
    // pull asks with no revision of its own. Then it goes offline.
    final step1 = expectAt(1);
    expect([stepOf(1)['by'], stepOf(1)['online'], stepOf(1)['then']], ['staff', true, 'offline']);
    final patientId = services.patients
        .createPatient(
          Intake(
            consent: const ConsentAnswer.given(),
            preferredName: patient['preferredName']! as String,
            visualDescriptor: patient['visualDescriptor']! as String,
            usualArea: patient['usualArea']! as String,
            livingSituation: (patient['livingSituation']! as Map<String, Object?>)['kind']! as String,
            preferredLanguage: patient['preferredLanguage']! as String,
          ),
        )
        .patientId;
    expect(await phone.engine.syncAll(), isA<SyncDone>());
    expect(server.records[patientId]?.entity, entityPatient, reason: 'the patient is on the server');
    expect(phone.store.outbox(), isEmpty);

    // R is the team's revision once step 1 has run, which every revision of the story counts from.
    final r = server.presetsOf(team).revision;
    final pull1 = step1['pull']! as Map<String, Object?>;
    final first = network.pulls.single;
    expect(first.query, isEmpty, reason: 'no revision and no epoch of its own');
    expect([first.answer['reset'], first.answer['revision']], [pull1['reset'], r + (pull1['revision']! as int)]);
    final epoch = first.answer['epoch']! as String;
    expect(epoch, server.presetsOf(team).epoch);
    // It holds every platform preset, by origin key, at its newest version, naming the team's presets
    // by their IDs, each read by this phone's readers.
    final phone1 = step1['phone']! as Map<String, Object?>;
    expect(phone1['holds'], startsWith('every platform preset'));
    final newest = newestPlatformPresets();
    final held = copy();
    expect({for (final row in held.values) row.originKey}, {for (final e in newest) e['originKey']});
    expect(held, hasLength(newest.length));
    for (final e in newest) {
      final key = e['originKey']! as String;
      final row = held[platformIds[key]]!;
      final kind = e['kind']! as String;
      expect(
        [row.kind, row.version, row.state, row.body],
        [kind, 1, 'active', platformBodyWithIds(kind, e['body']! as Map<String, Object?>, platformIds)],
        reason: key,
      );
    }
    expect(copyOf.presets(), hasLength(newest.length), reason: 'every body is one the phone reads');
    expect([copyOf.revision, copyOf.epoch], [r + (phone1['revision']! as int), epoch]);
    expect(server.presetsOf(team).revision, r + ((step1['server']! as Map<String, Object?>)['revision']! as int));
    server.offline = true;

    // 2 to 4. Online at the desk, the Program Admin adds the item, the bundle and the flag, each written
    // into the test server as the admin routes leave it: version 1, under the team's next revision.
    for (final n in [2, 3, 4]) {
      final step = stepOf(n);
      final preset = presetOf(step['adds']! as String);
      final expected = step['expect']! as Map<String, Object?>;
      final head = expected['head']! as Map<String, Object?>;
      final id = server.addPreset(team, preset['kind']! as String, asHeld(preset['body']) as Map<String, Object?>);
      made[preset['ref']! as String] = id;
      final written = server.presetsOf(team).heads[id]!;
      expect(
        [written.state, written.currentVersion, written.revision, written.originKey],
        [head['state'], head['version'], r + (head['revision']! as int), null],
        reason: 'step $n',
      );
      expect(server.presetsOf(team).revision, r + ((expected['server']! as Map<String, Object?>)['revision']! as int));
    }
    // Nothing reached the phone: it is offline.
    expect(network.pulls, hasLength(1));
    expect(copyOf.revision, r);

    // 6. The phone comes online and syncs: one pull, with the revision and the epoch it holds, which
    // answers exactly the three.
    later(const Duration(minutes: 30));
    server.offline = false;
    final step6 = expectAt(6);
    final pull6 = step6['pull']! as Map<String, Object?>;
    expect(stepOf(6)['by'], 'staff');
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    final next = network.pulls.skip(1).single;
    expect(next.query, {'since': '${r + (pull6['since']! as int)}', 'epoch': epoch});
    expect(next.answer['reset'], pull6['reset']);
    expect(pull6['exactly'], isTrue);
    final answered = (next.answer['presets']! as List<Object?>).cast<Map<String, Object?>>();
    String? refOf(Object? id) => made.entries.where((m) => m.value == id).firstOrNull?.key;
    expect([
      for (final p in answered)
        {
          'ref': refOf(p['id']),
          'kind': p['kind'],
          'name': (p['body']! as Map<String, Object?>)['name'],
          'version': p['version'],
          'state': p['state'],
        },
    ], pull6['presets']);
    for (final p in answered) {
      expect([p['originKey'], p['body']], [null, asHeld(presetOf(refOf(p['id'])!)['body'])]);
    }
    expect(next.answer['revision'], r + (pull6['revision']! as int));
    // The phone holds revision R+3, the three with every platform preset.
    expect(copyOf.revision, r + ((step6['phone']! as Map<String, Object?>)['revision']! as int));
    expect(copy(), hasLength(newest.length + 3));
    for (final ref in made.keys) {
      expect(copyOf.preset(made[ref]!)?.state, PresetState.active, reason: ref);
    }

    // 7. Offline, the staff member opens Team setup: the phone's copy as Team setup reads it, its
    // active presets, each item under its category, each bundle line by its item, each flag under its
    // tier for whom the flag rule shows it.
    server.offline = true;
    final step7 = (expectAt(7)['teamSetup']! as Map<String, Object?>);
    final permissions = FakeSyncServer.healthcareStaff.toList();
    final active = {
      for (final p in copyOf.presets())
        if (p.state == PresetState.active) p.id: p,
    };
    String? nameIn(String? id) => active[id]?.body.name;
    final items = [
      for (final p in active.values)
        if (p.body case final ItemBody item) {'under': nameIn(item.categoryId), 'shows': item.name},
    ];
    for (final want in (step7['items']! as List<Object?>).cast<Map<String, Object?>>()) {
      expect(items, contains(equals(want)));
    }
    final bundles = [
      for (final p in active.values)
        if (p.body case final BundleBody bundle)
          {
            'shows': bundle.name,
            'lines': [for (final line in bundle.lines) nameIn(line.itemId)],
          },
    ];
    for (final want in (step7['bundles']! as List<Object?>).cast<Map<String, Object?>>()) {
      expect(bundles, contains(equals(want)));
    }
    final tiers = {FlagTier.primary: riskLevelHeading, FlagTier.secondary: conditionsHeading};
    final flags = [
      for (final p in active.values)
        if (p.body case final FlagBody flag when !flagHidden(permissions, flag))
          {'under': tiers[flag.tier], 'shows': flag.name, 'pill': FlagPill.of(flag).text},
    ];
    for (final want in (step7['flags']! as List<Object?>).cast<Map<String, Object?>>()) {
      expect(flags, contains(equals(want)));
    }

    // 8. Still offline, the staff member sets Demo: Frost risk on the patient with a reason, through the
    // flags domain class; then the phone syncs.
    final step8 = stepOf(8);
    final change = step8['flagChange']! as Map<String, Object?>;
    final expected8 = step8['expect']! as Map<String, Object?>;
    expect([step8['by'], step8['online'], step8['then']], ['staff', false, 'online']);
    expect(change['patient'], patient['id'], reason: 'the story’s patient, as this phone registered it');
    final frost = made[change['flag']]!;
    later(const Duration(minutes: 10));
    final changeId = services.flags.record(
      patientId,
      flagId: frost,
      action: change['action']! as String,
      reason: change['reason']! as String,
    );
    final queued = phone.store.outbox().where((e) => e.entity == entityFlagChange).single;
    expect(
      [queued.recordId, queued.op, queued.value],
      [
        changeId,
        'create',
        {'patientId': patientId, 'flagId': frost, 'action': change['action'], 'reason': change['reason']},
      ],
    );
    // Offline, the patient carries it at once, waiting to send.
    final waiting = services.flags.flagsOf(patientId);
    expect([waiting.riskLevel, for (final f in waiting.conditions) f.flagId], [null, frost]);
    expect(waiting.history.single.state, FlagChangeState.waiting);
    expect(server.records[changeId], isNull, reason: 'nothing reached the server');

    later(const Duration(minutes: 5));
    server.offline = false;
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    // Accepted, its receipt naming the hash the phone sent.
    expect(expected8['receipts'], {'status': 'accepted', 'hashConfirmed': true});
    final receipt = server.receipts[queued.changeId];
    expect([receipt?.status, receipt?.hash], ['accepted', queued.valueHash]);
    expect([phone.store.outbox(), phone.store.needsAttention()], [isEmpty, isEmpty]);
    // The test server's chart shows the flag, as the story gives it.
    final chart = await server.transportFor(staff, team).send('GET', '/v1/patients/$patientId') as Map<String, Object?>;
    final onChart = chart['flags']! as Map<String, Object?>;
    final want = expected8['chart']! as Map<String, Object?>;
    final wantFlags = want['flags']! as Map<String, Object?>;
    final server8 = expected8['server']! as Map<String, Object?>;
    final current = server8['currentFlags']! as Map<String, Object?>;
    expect(onChart['primary'], current['primary']);
    expect(onChart['primary'], wantFlags['primary']);
    expect(
      [for (final f in (onChart['secondary']! as List<Object?>).cast<Map<String, Object?>>()) f['flagId']],
      [for (final ref in (current['secondary']! as List<Object?>).cast<String>()) made[ref]],
    );
    expect(onChart['secondary'], [
      for (final f in (wantFlags['secondary']! as List<Object?>).cast<Map<String, Object?>>())
        {'flagId': made[f['flag']], ...f}..remove('flag'),
    ]);
    expect(
      [
        for (final row in (onChart['history']! as List<Object?>).cast<Map<String, Object?>>())
          [row['flagId'], row['action'], row['authorName'], row['reason']],
      ],
      [
        for (final row in (want['history']! as List<Object?>).cast<Map<String, Object?>>())
          [
            made[row['flag']],
            row['action'],
            ((story['people']! as Map<String, Object?>)[row['by']]! as Map<String, Object?>)['displayName'],
            row['holdsTheReason'] == true ? change['reason'] : null,
          ],
      ],
    );
    // And the phone's own view of the patient: the pill the story gives, the change sent.
    final sent = services.flags.flagsOf(patientId);
    expect(
      [sent.riskLevel, for (final f in sent.conditions) FlagPill(name: f.name, colorName: f.colorName).text],
      [null, want['pill']],
    );
    expect(want['pill'], 'Teal · ${nameOf(change['flag']! as String)}');
    expect(sent.history.single.state, FlagChangeState.sent);
  });
}
