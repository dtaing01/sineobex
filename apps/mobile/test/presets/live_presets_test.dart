import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sineobex_field/api/generated/api.dart' show AuditEntry, AuditSearch, Me, SineobexApi;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
import 'package:sineobex_field/design/widgets/flag_pill.dart';
import 'package:sineobex_field/features/presets/team_setup_screen.dart' show conditionsHeading, riskLevelHeading;
import 'package:sineobex_field/patients/consent_script.dart';
import 'package:sineobex_field/patients/flags.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/patients/patient_repository.dart' show Intake;
import 'package:sineobex_field/presets/models.dart';
import 'package:sineobex_field/presets/preset_store.dart';
import 'package:sineobex_field/presets/presets_refresher.dart';
import 'package:sineobex_field/sync/entities.dart' show entityFlagChange;
import 'package:sineobex_field/sync/sync_controller.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import '../sync/phone_harness.dart';
import 'platform_presets.dart';

/// The phase 5 Done when against the real API and Postgres (design 10.1, steps 1 to 8, card P6-live):
/// "An admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three after its
/// next sync." The same story as done_when_presets_test.dart (presets-done-when.json), with the real
/// server in place of the phone's test server: the staff member's phone through the domain layer,
/// and the Program Admin at the desk through the real admin routes, signed in just now, as the live
/// tests sign people in. tools/live-sync.sh runs it last, on the seeded demo team: the story's people
/// are its staff, and the names are new to it, so it runs once on a freshly seeded database. Every
/// body a pull returns is read with the phone's readers, and one refused fails the run. What only
/// the server can see, a write's receipt and the audit chain, is read from the push's answers and
/// through the Program Admin's audit search.
///
/// Step 5's second attempt, the admin with a sign-in older than 15 minutes, is left to the API's
/// presets-done-when.test.ts: the identity provider live-sync.sh starts dates every sign-in now, and
/// only the portal's runs turn on its hook that dates one back (tools/dev-idp.mjs).
void main() {
  final apiUrl = Platform.environment['SINEOBEX_LIVE_API'];
  final idpUrl = Platform.environment['SINEOBEX_LIVE_IDP'];
  final skip = apiUrl == null || idpUrl == null ? 'set SINEOBEX_LIVE_API and SINEOBEX_LIVE_IDP to run' : null;
  if (Platform.environment['SINEOBEX_LIVE_REQUIRED'] == '1' && skip != null) {
    test('the live API is configured', () => fail(skip));
    return;
  }

  final story = jsonDecode(
    File('../../packages/contract/test-vectors/presets-done-when.json').readAsStringSync(),
  ) as Map<String, Object?>;
  final people = (story['people']! as Map<String, Object?>).cast<String, Map<String, Object?>>();
  final patient = story['patient']! as Map<String, Object?>;
  final presets = (story['presets']! as List<Object?>).cast<Map<String, Object?>>();
  Map<String, Object?> presetOf(String ref) => presets.singleWhere((p) => p['ref'] == ref);
  Map<String, Object?> stepOf(int n) =>
      (story['steps']! as List<Object?>).cast<Map<String, Object?>>().singleWhere((s) => s['n'] == n);
  Map<String, Object?> expectAt(int n) => stepOf(n)['expect']! as Map<String, Object?>;
  final neverInAuditDetails = (story['neverInAuditDetails']! as List<Object?>).cast<String>();

  // The made-up demo team (db/seed/seed.ts).
  const team = '0d3e6f00-0000-4000-8000-000000000001';
  final client = http.Client();
  final phones = <TestPhone>[];
  tearDownAll(() {
    for (final p in phones) {
      p.close();
    }
    client.close();
  });

  /// The story's [person], signed in just now as the seeded staff member of that email, who is the
  /// person the story names: their name and role are the story's.
  Future<({String userId, String token, Me me})> signIn(Map<String, Object?> person) async {
    final auth = DevAuthProvider(url: Uri.parse(idpUrl!), client: client);
    final challenge = await auth.signIn(person['email']! as String, 'sineobex-demo') as MfaChallenge;
    final tokens = await auth.verifyMfa(challenge.tokens, challenge.factorId, '000000');
    final me = await SineobexApi(
      HttpTransport(baseUrl: Uri.parse(apiUrl!), client: client, accessToken: () => tokens.accessToken),
    ).getMe();
    final membership = me.teams.singleWhere((t) => t.teamId == team);
    expect(
      [me.user.displayName, membership.roleKey],
      [person['displayName'], person['role']],
      reason: 'the story’s people are the seeded staff',
    );
    return (userId: me.user.id, token: tokens.accessToken, me: me);
  }

  /// A request at the desk, as the portal makes it: its status and its answer's JSON.
  Future<({int status, Object? body})> desk(String token, String method, String path, [Object? json]) async {
    final request = http.Request(method, Uri.parse('$apiUrl$path'))
      ..headers.addAll({
        'authorization': 'Bearer $token',
        'x-team-id': team,
        'accept': 'application/json',
        if (json != null) 'content-type': 'application/json',
      });
    if (json != null) request.body = jsonEncode(json);
    final answer = await http.Response.fromStream(await client.send(request));
    return (status: answer.statusCode, body: answer.body.isEmpty ? null : jsonDecode(answer.body));
  }

  test('the Done when: an admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three after '
      'its next sync, then flags the patient with the new flag offline (design 10.1, steps 1 to 8)', () async {
    final staffPerson = people['staff']!;
    final adminPerson = people['programAdmin']!;
    final admin = await signIn(adminPerson);
    final adminApi = SineobexApi(
      HttpTransport(baseUrl: Uri.parse(apiUrl!), client: client, accessToken: () => admin.token, teamId: () => team),
    );

    /// Every audit entry written after [mark], newest first, through the Program Admin's search.
    Future<List<AuditEntry>> auditAfter(BigInt mark) async {
      final found = <AuditEntry>[];
      String? before;
      while (true) {
        final page = await adminApi.searchAudit(body: AuditSearch(limit: 200, beforeId: before));
        for (final e in page.entries) {
          if (BigInt.parse(e.id) <= mark) return found;
          found.add(e);
        }
        before = page.nextBeforeId;
        if (before == null) return found;
      }
    }

    /// The newest audit entry's ID; 0 while the chain holds none (a database just seeded).
    Future<BigInt> auditMark() async {
      final newest = (await adminApi.searchAudit(body: const AuditSearch(limit: 1))).entries;
      return newest.isEmpty ? BigInt.zero : BigInt.parse(newest.single.id);
    }

    final mark0 = await auditMark();

    // The staff member's phone, as the app makes it when the team's database opens: the patient
    // services, then the team's presets (app_providers.dart appRefreshers).
    final staff = await signIn(staffPerson);
    final permissions = [for (final k in staff.me.teams.singleWhere((t) => t.teamId == team).permissions) k.wire];
    final network = _Network(
      HttpTransport(baseUrl: Uri.parse(apiUrl), client: client, accessToken: () => staff.token, teamId: () => team),
    );
    final phone = TestPhone(userId: staff.userId, teamId: team, transport: () => network, realTime: DateTime.now);
    phones.add(phone);
    final open = OpenTeam(
      userId: staff.userId,
      teamId: team,
      store: phone.store,
      api: phone.engine.api,
      clock: phone.clock,
      permissions: permissions,
    );
    final services = PatientServices(open, copy: (_) async => true);
    phone.engine.refreshers
      ..clear()
      ..addAll([...services.refreshers, ...presetRefreshers(open, openStore: () => phone.store)]);
    final copyOf = PresetStore(phone.store);

    /// Each body of [pull] read with the phone's readers: a kind, a state and a body each refuses fails.
    void readEvery(Map<String, Object?> pull) {
      final pulled = (pull['presets']! as List<Object?>).cast<Map<String, Object?>>();
      expect(pulled, isNotEmpty);
      for (final p in pulled) {
        final what = '${p['kind']} ${p['originKey'] ?? p['id']}';
        expect(PresetKind.byCode(p['kind']! as String), isNotNull, reason: what);
        expect(PresetState.byCode(p['state']! as String), isNotNull, reason: what);
        expect(() => parsePreset(p['kind']! as String, p['body']), returnsNormally, reason: what);
        expect(parsePreset(p['kind']! as String, p['body']), isNotNull, reason: what);
      }
    }

    // 1. The phone registers the patient and syncs; its first pull asks with no revision of its own,
    // and it holds every platform preset at its newest version. Then it goes offline.
    final step1 = expectAt(1);
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
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    expect([phone.store.outbox(), phone.store.needsAttention()], [isEmpty, isEmpty]);
    final pull1 = step1['pull']! as Map<String, Object?>;
    final first = network.pulls.single;
    expect(first.query, isEmpty, reason: 'no revision and no epoch of its own');
    expect(first.answer['reset'], pull1['reset']);
    readEvery(first.answer);
    // The revision the phone holds: the greatest a preset carries. The story's R is the team's, which
    // no read gives; a write's answer does (step 2). Here it can be above the phone's: a note type
    // write takes the team's revisions too (design 4.3), and the seed's test note types took its last.
    final held1 = first.answer['revision']! as int;
    final epoch = first.answer['epoch']! as String;
    expect([copyOf.revision, copyOf.epoch], [held1, epoch]);
    final pulled1 = (first.answer['presets']! as List<Object?>).cast<Map<String, Object?>>();
    expect(copyOf.presets(), hasLength(pulled1.length), reason: 'the phone holds every preset it was sent');
    final platformIds = {
      for (final p in pulled1)
        if (p['originKey'] case final String key) key: p['id']! as String,
    };
    expect((step1['phone']! as Map<String, Object?>)['holds'], startsWith('every platform preset'));
    for (final e in newestPlatformPresets()) {
      final key = e['originKey']! as String;
      final kind = e['kind']! as String;
      final p = pulled1.singleWhere((x) => x['originKey'] == key);
      expect(
        [p['kind'], p['state'], p['version'], p['body']],
        [kind, 'active', 1, platformBodyWithIds(kind, e['body']! as Map<String, Object?>, platformIds)],
        reason: key,
      );
    }
    // The story's names are new to the team.
    for (final preset in presets) {
      final name = (preset['body']! as Map<String, Object?>)['name'];
      expect(pulled1.where((p) => p['kind'] == preset['kind'] && (p['body']! as Map)['name'] == name), isEmpty);
    }
    network.offline = true;

    // 2 to 4. At the desk, the Program Admin, signed in just now, adds the item, the bundle and the
    // flag through the admin routes, each with a reason.
    final made = <String, String>{};
    Object? asHeld(Object? value) => switch (value) {
      final List<Object?> list => [for (final v in list) asHeld(v)],
      {'platform': final String key} => platformIds[key],
      {'preset': final String ref} => made[ref],
      final Map<String, Object?> map => {for (final MapEntry(:key, :value) in map.entries) key: asHeld(value)},
      _ => value,
    };
    late int r;
    for (final n in [2, 3, 4]) {
      final step = stepOf(n);
      expect([step['by'], step['signedInMinutesAgo']], ['programAdmin', 0]);
      final preset = presetOf(step['adds']! as String);
      final kind = preset['kind']! as String;
      final expected = step['expect']! as Map<String, Object?>;
      final mark = await auditMark();
      final body = asHeld(preset['body']);
      final added = await desk(admin.token, 'POST', '/v1/admin/presets/$kind', {
        'body': body,
        'reason': preset['reason'],
      });
      expect(added.status, expected['status'], reason: 'step $n: ${jsonEncode(added.body)}');
      final answer = added.body! as Map<String, Object?>;
      final id = answer['id']! as String;
      made[preset['ref']! as String] = id;
      // R, the team's revision once step 1 has run, from the first write's answer: the story counts
      // every revision from it.
      if (n == 2) {
        r = (answer['revision']! as int) - (expected['revision']! as int);
        expect(held1, lessThanOrEqualTo(r + (pull1['revision']! as int)), reason: 'no pull answers above R');
      }
      expect(answer, {'id': id, 'version': expected['version'], 'revision': r + (expected['revision']! as int)});
      // Its head as the admin's list shows it, and its one event, holding the reason, by the admin.
      final head = expected['head']! as Map<String, Object?>;
      final row = (await adminApi.listPresets(kind: kind)).singleWhere((p) => p.id == id);
      expect(
        [row.state.wire, row.version, row.customized, row.name, row.body],
        [head['state'], head['version'], head['customized'], (preset['body']! as Map<String, Object?>)['name'], body],
      );
      final event = expected['event']! as Map<String, Object?>;
      final stored = expected['storedVersion']! as Map<String, Object?>;
      final history = await adminApi.getPresetHistory(kind: kind, id: id);
      expect(
        [
          for (final e in history) [e.act.wire, e.version, e.source.wire, e.by?.userId, e.reason],
        ],
        [
          [event['act'], event['version'], stored['source'], admin.userId, preset['reason']],
        ],
      );
      // Its one audit event, by the admin, holding its kind, version and revision, never the reason.
      final audit = expected['audit']! as Map<String, Object?>;
      final logged = [
        for (final e in await auditAfter(mark))
          if (e.action == audit['action']) e,
      ];
      expect(logged, hasLength(audit['count']! as int));
      expect(
        [logged.single.entity, logged.single.entityId, logged.single.actor.userId, logged.single.patientId],
        [audit['entity'], id, admin.userId, null],
      );
      expect(logged.single.details, containsPair('revision', r + (expected['revision']! as int)));
      expect(logged.single.details, containsPair('kind', kind));
      expect(audit['holdsTheReason'], isFalse);
      expect(jsonEncode(logged.single.details), isNot(contains(preset['reason'])));
    }

    // 5. The staff member tries step 2's write: refused, and logged once, naming the permission.
    // (The admin's attempt with a sign-in older than 15 minutes is the API's test's; see above.)
    final attempt = (stepOf(5)['attempts']! as List<Object?>).cast<Map<String, Object?>>().first;
    expect([attempt['by'], attempt['signedInMinutesAgo'], attempt['repeats']], ['staff', 0, 'glucoseTest']);
    final refusal = attempt['expect']! as Map<String, Object?>;
    final mark5 = await auditMark();
    final repeated = presetOf('glucoseTest');
    final refused = await desk(staff.token, 'POST', '/v1/admin/presets/${repeated['kind']}', {
      'body': asHeld(repeated['body']),
      'reason': repeated['reason'],
    });
    expect(
      [refused.status, ((refused.body as Map<String, Object?>?)?['error'] as Map<String, Object?>?)?['code']],
      [refusal['status'], refusal['code']],
    );
    final denied = refusal['audit']! as Map<String, Object?>;
    final deniedLogged = [
      for (final e in await auditAfter(mark5))
        if (e.action == denied['action'] && e.actor.userId == staff.userId) e,
    ];
    expect(deniedLogged, hasLength(denied['count']! as int));
    for (final MapEntry(:key, :value) in (denied['details']! as Map<String, Object?>).entries) {
      expect(deniedLogged.single.details, containsPair(key, value));
    }
    // Nothing written: one item of the story's name, the one step 2 added.
    expect(
      (await adminApi.listPresets(kind: repeated['kind']! as String))
          .where((p) => p.name == (repeated['body']! as Map<String, Object?>)['name']),
      hasLength(1),
    );

    // 6. The phone comes online and syncs: one pull, with the revision and the epoch it holds, which
    // answers exactly the three, at R+3.
    network.offline = false;
    final step6 = expectAt(6);
    final pull6 = step6['pull']! as Map<String, Object?>;
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    final next = network.pulls.skip(1).single;
    // The revision it holds, step 1's answer: R, or below it where a note type write took the team's last.
    expect(next.query, {'since': '$held1', 'epoch': epoch});
    expect(next.answer['reset'], pull6['reset']);
    readEvery(next.answer);
    expect(pull6['exactly'], isTrue);
    String? refOf(Object? id) => made.entries.where((m) => m.value == id).firstOrNull?.key;
    final answered = (next.answer['presets']! as List<Object?>).cast<Map<String, Object?>>();
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
    expect(copyOf.revision, r + ((step6['phone']! as Map<String, Object?>)['revision']! as int));
    expect(copyOf.presets(), hasLength(pulled1.length + 3));

    // 7. Offline, Team setup: the phone's copy as Team setup reads it.
    network.offline = true;
    final step7 = expectAt(7)['teamSetup']! as Map<String, Object?>;
    final active = {
      for (final p in copyOf.presets())
        if (p.state == PresetState.active) p.id: p,
    };
    String? nameIn(String? id) => active[id]?.body.name;
    final tiers = {FlagTier.primary: riskLevelHeading, FlagTier.secondary: conditionsHeading};
    final shown = {
      'items': [
        for (final p in active.values)
          if (p.body case final ItemBody item) {'under': nameIn(item.categoryId), 'shows': item.name},
      ],
      'bundles': [
        for (final p in active.values)
          if (p.body case final BundleBody bundle)
            {
              'shows': bundle.name,
              'lines': [for (final line in bundle.lines) nameIn(line.itemId)],
            },
      ],
      'flags': [
        for (final p in active.values)
          if (p.body case final FlagBody flag when !flagHidden(permissions, flag))
            {'under': tiers[flag.tier], 'shows': flag.name, 'pill': FlagPill.of(flag).text},
      ],
    };
    for (final part in ['items', 'bundles', 'flags']) {
      for (final want in (step7[part]! as List<Object?>).cast<Map<String, Object?>>()) {
        expect(shown[part], contains(equals(want)), reason: part);
      }
    }

    // 8. Still offline, the staff member sets the flag on the patient with a reason; then the phone
    // syncs.
    final step8 = stepOf(8);
    final change = step8['flagChange']! as Map<String, Object?>;
    final expected8 = step8['expect']! as Map<String, Object?>;
    final frost = made[change['flag']]!;
    final changeId = services.flags.record(
      patientId,
      flagId: frost,
      action: change['action']! as String,
      reason: change['reason']! as String,
    );
    final queued = phone.store.outbox().singleWhere((e) => e.entity == entityFlagChange);
    expect([queued.recordId, queued.op], [changeId, 'create']);
    expect([for (final f in services.flags.flagsOf(patientId).conditions) f.flagId], [frost]);
    final mark8 = await auditMark();
    // The team index the phone holds was downloaded before the change was made.
    final heldIndex = phone.store.kv('index.version');
    expect(heldIndex, isNotNull);
    network.offline = false;
    expect(await phone.engine.syncAll(force: true), isA<SyncDone>());
    // Accepted, its receipt naming the hash the phone sent.
    expect(expected8['receipts'], {'status': 'accepted', 'hashConfirmed': true});
    final receipt = network.receipts[queued.changeId];
    expect([receipt?['status'], receipt?['hash']], ['accepted', queued.valueHash]);
    // It names the team index's counter just after the change too, which the phone keeps beside the
    // times (6.1, review finding VR1): above the counter of the index the phone held, which the change
    // wasn't in.
    final counter = (receipt?['details'] as Map<String, Object?>?)?['indexVersion'];
    expect(counter, isA<int>());
    expect(counter! as int, greaterThan(int.parse(heldIndex!.split('.').first)));
    final kept = jsonDecode(phone.store.receiptKept(changeId, 'flagChange')!) as Map<String, Object?>;
    expect(kept['serverIndexVersion'], counter);
    expect([phone.store.outbox(), phone.store.needsAttention()], [isEmpty, isEmpty]);
    // One audit event of the change, on its patient, by the staff member: its action and tier, never
    // its flag or its reason.
    final server8 = expected8['server']! as Map<String, Object?>;
    final audit8 = server8['audit']! as Map<String, Object?>;
    final changed = [
      for (final e in await auditAfter(mark8))
        if (e.action == audit8['action']) e,
    ];
    expect(changed, hasLength(audit8['count']! as int));
    expect(
      [changed.single.entity, changed.single.entityId, changed.single.patientId, changed.single.actor.userId],
      [entityFlagChange, changeId, patientId, staff.userId],
    );
    for (final MapEntry(:key, :value) in (audit8['details']! as Map<String, Object?>).entries) {
      expect(changed.single.details, containsPair(key, value));
    }
    expect(changed.single.details.containsKey('flagId'), isFalse);
    expect(audit8['holdsTheReason'], isFalse);
    for (final never in [frost, change['reason']! as String]) {
      expect(jsonEncode(changed.single.details), isNot(contains(never)));
    }
    // The chart as the portal reads it: the flag among the conditions, no risk level, its change in the
    // history by the staff member with the reason.
    final read = await desk(admin.token, 'GET', '/v1/patients/$patientId');
    expect(read.status, 200);
    final onChart = (read.body! as Map<String, Object?>)['flags']! as Map<String, Object?>;
    final chart = expected8['chart']! as Map<String, Object?>;
    final wantFlags = chart['flags']! as Map<String, Object?>;
    final current = server8['currentFlags']! as Map<String, Object?>;
    expect([onChart['primary'], wantFlags['primary']], [current['primary'], current['primary']]);
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
        for (final row in (chart['history']! as List<Object?>).cast<Map<String, Object?>>())
          [
            made[row['flag']],
            row['action'],
            people[row['by']]!['displayName'],
            row['holdsTheReason'] == true ? change['reason'] : null,
          ],
      ],
    );
    final now = services.flags.flagsOf(patientId);
    expect(
      [now.riskLevel, for (final f in now.conditions) FlagPill(name: f.name, colorName: f.colorName).text],
      [null, chart['pill']],
    );
    expect(now.history.single.state, FlagChangeState.sent);

    // Nothing the story wrote is in an audit event's details: no name, no reason, nothing of the patient.
    final details = jsonEncode([for (final e in await auditAfter(mark0)) e.details]);
    for (final never in neverInAuditDetails) {
      expect(details, isNot(contains(never)));
    }
  }, skip: skip);
}

/// The real API behind a switchable network, keeping each presets pull's query and answer and each
/// push's answers, as JSON carried them.
class _Network implements ApiTransport {
  _Network(this.inner);
  final ApiTransport inner;
  bool offline = false;

  final pulls = <({Map<String, String> query, Map<String, Object?> answer})>[];

  /// The server's answer to each change, by change ID.
  final receipts = <String, Map<String, Object?>>{};

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    final answer = await inner.send(method, path, query: query, body: body);
    if (method == 'GET' && path == '/v1/presets') {
      pulls.add((query: {...?query}, answer: jsonDecode(jsonEncode(answer)) as Map<String, Object?>));
    }
    if (method == 'POST' && path == '/v1/sync/push') {
      for (final r in ((answer! as Map<String, Object?>)['results']! as List<Object?>).cast<Map<String, Object?>>()) {
        receipts[r['changeId']! as String] = r;
      }
    }
    return answer;
  }
}
