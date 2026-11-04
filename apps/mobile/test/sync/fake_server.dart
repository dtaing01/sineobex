import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/generated/sensitive_codes.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/patients/match_constants.dart';
import 'package:sineobex_field/patients/matching.dart';
import 'package:sineobex_field/patients/recognisable.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

/// An in-memory server with the API's sync rules (services/api/src/sync), for engine tests. The
/// live tests (live_api_test.dart, and lib/patients/'s) run the same scenarios against the real
/// API in CI, which keeps this fake honest.
///
/// Phase 3 (design 2.10, S1's list in the design's Status): values are checked with the phone's
/// entity registry (lib/sync/entities.dart), which sync-values.json pins to the API's Zod schemas;
/// permissions per entity; parents of creates and sets; the field classes (keep both, identity,
/// set once, the problem status rule) with their accepted outcomes; receipts that carry `server`
/// and `details`, replayed the same; redirects for merged patients and problems; caps; the ID link
/// handshake over the group; and duplicate matching with the phone's own scorer.
class FakeSyncServer {
  FakeSyncServer({required this.now});

  /// The server's own clock.
  DateTime Function() now;

  final devices = <String, _Device>{};
  final records = <String, FakeRecord>{};
  final receipts = <String, _Receipt>{};
  final quarantine = <String, Map<String, Object?>>{};

  /// Whose each change in [quarantine] is and why it is held. Nothing here is decided: it waits,
  /// unless a test accepts it ([acceptHeld]).
  final held = <String, ({String userId, String reason})>{};

  /// Offline reads appended to the audit chain (AuditAppend entries), with their fields.
  final audit = <Map<String, Object?>>[];

  /// Field history: `kind` is created, set, filled_blank, replaced_after_review, kept_both,
  /// confirmed, redirected, cleared_by_allergy or entered_in_error.
  final history = <Map<String, Object?>>[];
  final removedUsers = <String>{};

  /// 'userId/teamId': removed from one team only.
  final removedFromTeam = <String>{};

  /// Each person's permission keys in the team (D37); [healthcareStaff] for anyone not listed.
  final permissions = <String, Set<String>>{};

  /// The Healthcare Staff role of 0002.
  static const healthcareStaff = {
    'patients.view',
    'patients.edit',
    'patients.view_sensitive',
    'encounters.chart',
    'checkins.create',
    'referrals.create',
    'routes.view',
    'inventory.view',
  };

  /// The CHW preset (design 4.2): registers patients, never charts.
  static const chw = {'patients.view', 'patients.edit', 'checkins.create'};

  Set<String> permissionsOf(String userId) => permissions[userId] ?? healthcareStaff;

  /// Open field reviews (a value kept both), by ID.
  final reviews = <String, FakeReview>{};

  /// Pairs flagged as possible duplicates.
  final pairs = <FakePair>[];

  /// Merges, by ID ([merge], [undoMerge]).
  final merges = <String, FakeMerge>{};

  /// ID links, by ID.
  final idLinks = <String, FakeIdLink>{};

  /// Notices for people (user_notices): kind, entity and record ID only.
  final notices = <({String userId, String kind, String entity, String recordId})>[];

  /// Network conditions for the next requests.
  bool offline = false;

  /// Refuses the sign-in with this 403 code (team suspended, MFA needed) without touching what
  /// the device-key check says.
  String? refuseCode;

  /// The server commits a push, then the answer never arrives (killed app, dropped connection).
  int dropPushResponses = 0;

  /// Process only this many changes, then stop (a server failure mid-batch).
  int? stopAfter;

  /// Called with each request before it is handled (to advance clocks in tests).
  void Function(String path)? onRequest;

  int pushes = 0;

  /// Change IDs the request schema refuses (an app fault), failing the whole push with 422.
  final malformed = <String>{};

  final _random = Random(7);
  int _received = 0;

  ApiTransport transportFor(String userId, String teamId) => _Transport(this, userId, teamId);

  String _uuid() {
    String hex(int n) => [for (var i = 0; i < n; i++) _random.nextInt(16).toRadixString(16)].join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}';
  }

  String get _today => now().toUtc().toIso8601String().substring(0, 10);

  // ---- test hooks ----

  /// Someone else changes a field on the server (online, as the portal does): the field's next
  /// version, and what the field decides about its record (a problem's status, a retraction).
  void serverEdit(String recordId, String field, Object? value, {required String by}) {
    final record = records[recordId]!;
    final current = record.fields[field];
    _write(record, field, value, (current?.version ?? 0) + 1, by, now().toUtc().toIso8601String(), null);
  }

  /// A record made online (or seeded): [entity]'s create applied with every permission, as an
  /// admin's online action would be. Returns its ID; throws when the create is refused.
  String seed(String entity, Map<String, Object?> value, {String? id, String by = 'seed-user', DateTime? at}) {
    final recordId = id ?? _uuid();
    final when = (at ?? now()).toUtc().toIso8601String();
    final c = <String, Object?>{
      'changeId': _uuid(),
      'seq': 0,
      'entity': entity,
      'recordId': recordId,
      'op': 'create',
      'value': value,
      'baseVersion': 0,
      'deviceTime': when,
      'correctedTime': when,
      'clockVerified': true,
    };
    final o = _decide(_Actor(by, 'seed-device', _allPermissions, holdForReview: false), c);
    if (o['status'] != 'accepted') throw StateError('seed refused: ${o['reason']} ${o['details']}');
    return recordId;
  }

  /// A patient made online, with the consent every create carries.
  String seedPatient({
    String? id,
    String? preferredName = 'Demo Patient',
    Map<String, Object?>? legalName,
    String? visualDescriptor,
    Map<String, Object?>? birth,
    String? usualArea,
    String by = 'seed-user',
  }) => seed(
    entityPatient,
    {
      'preferredName': ?preferredName,
      'legalName': ?legalName,
      'visualDescriptor': ?visualDescriptor,
      'birth': ?birth,
      'usualArea': ?usualArea,
      'consent': {
        'id': _uuid(),
        'decision': 'given',
        'method': 'verbal',
        'scriptVersion': '2026-10-1',
        'language': 'en',
      },
      'privacyNotice': {'id': _uuid(), 'decision': 'acknowledged'},
    },
    id: id,
    by: by,
  );

  /// Merges [mergedId] into [intoId] (design 3.4): nothing moves, the merged record points at the
  /// survivor, and every record of its group now belongs to the survivor's. Open pairs naming it
  /// are superseded, and the survivor is matched again. Returns the merge's ID.
  String merge(String mergedId, String intoId) {
    final merged = records[mergedId]!;
    final survivor = canonicalOf(intoId);
    merged
      ..status = 'merged'
      ..mergedInto = survivor;
    final id = _uuid();
    merges[id] = FakeMerge(id, mergedId, survivor, now().toUtc());
    for (final p in pairs) {
      if ((p.a == mergedId || p.b == mergedId) && (p.status == 'open' || p.status == 'not_sure')) {
        p.status = 'superseded';
      }
    }
    _rematch(survivor, 'merge_rematch');
    return id;
  }

  /// Undoes a merge: the merged record is its own again, with everything stored under its ID,
  /// late arrivals included; its cards are its own again (they were never retired).
  void undoMerge(String mergeId) {
    final m = merges[mergeId]!;
    if (m.undoneAt != null) throw StateError('already_undone');
    m.undoneAt = now().toUtc();
    records[m.mergedId]!
      ..status = 'active'
      ..mergedInto = null;
  }

  /// A problem entry merged into another (an admin's problem merge, design 9.4).
  void mergeProblem(String mergedId, String intoId) => records[mergedId]!.mergedInto = intoId;

  /// "Not the same person" (design 8.6): the pair is decided, and never flagged again.
  void keepSeparate(String a, String b) {
    final ca = canonicalOf(a), cb = canonicalOf(b);
    final pair = _pairOf(ca, cb);
    if (pair == null) {
      pairs.add(FakePair(_uuid(), ca, cb, 0, ['staff'])..status = 'kept_separate');
    } else {
      pair.status = 'kept_separate';
    }
  }

  /// A Program Admin accepts a change held for review (review.ts decideQuarantine): applied with the
  /// whole catalog, and the receipt the push got is replaced. Returns what applying it answered.
  Map<String, Object?> acceptHeld(String changeId) {
    final c = quarantine[changeId]!;
    final h = held[changeId]!;
    final outcome = _decide(_Actor(h.userId, 'admin', _allPermissions, holdForReview: false), c);
    if (outcome['status'] != 'accepted') return outcome;
    quarantine.remove(changeId);
    held.remove(changeId);
    final previous = receipts[changeId];
    receipts[changeId] = _Receipt(
      userId: h.userId,
      deviceId: previous?.deviceId ?? 'quarantine',
      seq: c['seq']! as int,
      entity: c['entity']! as String,
      recordId: c['recordId']! as String,
      field: c['field'] as String?,
      supersedes: c['supersedes'] as String?,
      conflictOf: c['conflictOf'] as String?,
      status: 'accepted',
      serverVersion: outcome['serverVersion'] as int?,
      reason: null,
      hash: valueHash(c['value']),
      quarantined: false,
      details: outcome['details'] as Map<String, Object?>?,
    );
    return outcome;
  }

  /// The patient whose chart holds [patientId] now (its canonical ID).
  String canonicalOf(String patientId) {
    var id = patientId;
    for (var hops = 0; hops < 20; hops++) {
      final next = records[id]?.mergedInto;
      if (next == null) return id;
      id = next;
    }
    return id;
  }

  /// Every patient record whose chart is [canonicalId]'s (itself and those merged into it).
  Iterable<FakeRecord> groupOf(String canonicalId) =>
      records.values.where((r) => r.entity == entityPatient && canonicalOf(r.id) == canonicalId);

  /// The open or not-sure pair of two canonical patients, if any.
  FakePair? openPair(String a, String b) {
    final p = _pairOf(canonicalOf(a), canonicalOf(b));
    return p != null && (p.status == 'open' || p.status == 'not_sure') ? p : null;
  }

  FakePair? _pairOf(String a, String b) => pairs.where((p) => {p.a, p.b}.containsAll([a, b])).firstOrNull;

  // ---- requests ----

  Future<Object?> handle(String userId, String teamId, String method, String path, Object? rawBody) async {
    if (offline) throw const NetworkException('offline');
    onRequest?.call(path);
    // Round-trip through JSON, as HTTP would, with the API's body limit (app.ts).
    final encoded = rawBody == null ? null : jsonEncode(rawBody);
    if (encoded != null && utf8.encode(encoded).length > 1024 * 1024) {
      throw const ApiException(413, 'payload_too_large', 'The request is too large.');
    }
    final body = encoded == null ? null : jsonDecode(encoded) as Map<String, Object?>;
    final signed = RegExp(r'^/v1/devices/([^/]+)/(status|quarantine|wiped)$').firstMatch(path);
    final Object? result;
    if (signed != null) {
      result = await _signed(signed.group(1)!, signed.group(2)!, body!);
    } else {
      if (removedUsers.contains(userId) || removedFromTeam.contains('$userId/$teamId')) {
        throw const ApiException(403, 'not_a_member', 'You are not a member of this team.');
      }
      if (refuseCode != null) throw ApiException(403, refuseCode!, 'Refused.');
      result = switch ((method, path)) {
        ('POST', '/v1/devices') => _register(userId, teamId, body!),
        ('POST', '/v1/sync/push') => _push(userId, teamId, body!),
        ('POST', '/v1/sync/records') => _fetch(body!),
        ('GET', '/v1/team/notices') => <Object?>[],
        ('GET', '/v1/time') => {'epochMs': now().millisecondsSinceEpoch, 'serverTime': now().toUtc().toIso8601String()},
        _ => throw ApiException(404, 'not_found', 'no route $method $path'),
      };
    }
    if (path == '/v1/sync/push' && dropPushResponses > 0) {
      dropPushResponses--;
      throw const NetworkException('timeout');
    }
    return result;
  }

  Map<String, Object?> _register(String userId, String teamId, Map<String, Object?> b) {
    final id = b['deviceId']! as String;
    final existing = devices[id];
    if (existing != null && (existing.userId != userId || existing.publicKey != b['publicKey'])) {
      throw const ApiException(409, 'device_exists', 'registered');
    }
    devices[id] ??= _Device(userId, teamId, b['publicKey']! as String);
    return {'id': id, 'status': devices[id]!.status, 'registeredAt': now().toUtc().toIso8601String()};
  }

  Map<String, Object?> _push(String userId, String teamId, Map<String, Object?> b) {
    pushes++;
    final device = devices[b['deviceId']];
    if (device == null || device.userId != userId) {
      throw const ApiException(409, 'device_not_registered', 'Register this phone before syncing.');
    }
    final deviceTime = DateTime.parse((b['clock']! as Map<String, Object?>)['deviceTime']! as String);
    final offsetMs = now().difference(deviceTime).inMilliseconds;
    // Every push replaces the phone's report, as push.ts does: the admin's devices page shows it.
    final unsynced = b['unsynced']! as Map<String, Object?>;
    device
      ..unsynced = Map.of(unsynced['counts']! as Map<String, Object?>)
      ..oldestUnsynced = unsynced['oldest'] as String?;
    final base = {
      'serverTime': now().toUtc().toIso8601String(),
      'clock': {'offsetMs': offsetMs, 'flagged': offsetMs.abs() > 5 * 60000},
      'device': {'status': device.status},
    };
    if (device.status != 'active') return {...base, 'results': <Object?>[]};
    final changes = (b['changes']! as List<Object?>).cast<Map<String, Object?>>();
    _validatePush(changes);
    changes.sort((x, y) => (x['seq']! as int).compareTo(y['seq']! as int));
    final results = <Map<String, Object?>>[];
    for (final c in changes) {
      if (stopAfter != null && results.length >= stopAfter!) break;
      results.add(_one(userId, b['deviceId']! as String, c));
    }
    return {...base, 'results': results};
  }

  /// SyncChange's request schema: one bad change fails the whole push with 422, as the API does.
  void _validatePush(List<Map<String, Object?>> changes) {
    final problems = <Object?>[
      for (final (i, c) in changes.indexed)
        if (malformed.contains(c['changeId']) || (c['field'] is String && (c['field']! as String).length > 200))
          {'path': 'changes.$i.field', 'problem': 'too_big'},
    ];
    if (problems.isNotEmpty) {
      throw ApiException(
        422,
        'validation_failed',
        'Some fields are missing or invalid.',
        details: {'fields': problems},
      );
    }
  }

  /// apply.ts precheck, then the stored receipt for a change it already has, then decide().
  Map<String, Object?> _one(String userId, String deviceId, Map<String, Object?> c) {
    final id = c['changeId']! as String;
    final hash = valueHash(c['value']);
    if (!c.containsKey('value')) return _store(userId, deviceId, c, hash, _invalid('value_missing'));
    final unstorable = storableProblem(c['value']);
    if (unstorable != null) {
      return _store(userId, deviceId, c, hash, _invalid(unstorable == 'too large' ? 'too_large' : 'unstorable_value'));
    }
    if (hash != c['valueHash']) return {'changeId': id, 'status': 'rejected', 'reason': 'hash_mismatch'};
    final existing = receipts[id];
    if (existing != null) return existing.result(this, id);
    final outcome = _decide(_Actor(userId, deviceId, permissionsOf(userId), holdForReview: true), c);
    return _store(userId, deviceId, c, hash, outcome);
  }

  static final _allPermissions = {...healthcareStaff, 'patients.reverse_resolved', 'patients.correct_identity'};

  /// apply.ts decide: an activity log entry, or the entity's permission, then its create or set,
  /// and a refusal the person can't fix held for review with what it waits on.
  Map<String, Object?> _decide(_Actor actor, Map<String, Object?> c) {
    final rules = rulesFor(c['entity']! as String);
    if (rules == null) {
      if (c['op'] != 'append') return _invalid('audit_is_append_only');
      final issues = auditIssues(c['value']);
      if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
      final v = c['value']! as Map<String, Object?>;
      audit.add({...v, 'deviceTime': c['deviceTime'], 'changeId': c['changeId'], 'userId': actor.userId});
      return {'status': 'accepted', 'serverVersion': 1};
    }
    final op = c['op'];
    if (!actor.permissions.contains(rules.permission(op == 'set' ? 'set' : 'create', c['field'] as String?))) {
      return actor.holdForReview ? _hold(actor.userId, c, 'permission') : _rejected('permission');
    }
    if (op != 'create' && op != 'set') return _invalid('append_only_for_audit');
    final outcome = op == 'create' ? _create(actor, c, rules) : _set(actor, c, rules);
    if (actor.holdForReview && outcome['status'] == 'rejected') {
      // Known only once the record is: a problem marked entered in error by someone else.
      if (outcome['reason'] == 'permission') return _hold(actor.userId, c, 'permission');
      if (outcome['reason'] == 'stale_reference') {
        final waitsOn = _heldCreate(actor.userId, c, rules);
        if (waitsOn != null) return _hold(actor.userId, c, 'awaiting_review', {'waitsOn': waitsOn});
      }
    }
    return outcome;
  }

  Map<String, Object?> _hold(String userId, Map<String, Object?> c, String reason, [Map<String, Object?>? details]) {
    quarantine[c['changeId']! as String] = c;
    held[c['changeId']! as String] = (userId: userId, reason: reason);
    return {'status': 'rejected', 'reason': reason, 'quarantined': true, 'details': ?details};
  }

  /// The person's own create, held for review, of a record [c] needs: the record it changes, or a
  /// parent it names (a whole intake held, its street names with it). Its change ID.
  String? _heldCreate(String userId, Map<String, Object?> c, EntityRules rules) {
    final needs = <ParentRef>[
      if (c['op'] == 'set') (entity: rules.entity, id: c['recordId']! as String),
      ...parentsOf(entity: rules.entity, op: c['op']! as String, field: c['field'] as String?, value: c['value']),
    ];
    for (final need in needs) {
      for (final q in quarantine.entries) {
        if (held[q.key]?.userId == userId &&
            q.value['op'] == 'create' &&
            q.value['entity'] == need.entity &&
            q.value['recordId'] == need.id) {
          return q.key;
        }
      }
    }
    return null;
  }

  Map<String, Object?> _rejected(String reason, [Map<String, Object?>? details]) => {
    'status': 'rejected',
    'reason': reason,
    'message': 'rejected: $reason',
    'details': ?details,
  };

  Map<String, Object?> _invalid(String problem, [Map<String, Object?> more = const {}]) =>
      _rejected('validation', {'problem': problem, ...more});

  /// Paths and codes only, as apply.ts `issues` reports a schema failure: never a value.
  Map<String, Object?> _problems(Set<String> paths) => {
    'problems': [
      for (final p in paths) {'path': p, 'code': 'invalid'},
    ],
  };

  static Map<String, Object?> _accepted(int version, {Map<String, Object?>? server, Map<String, Object?>? details}) => {
    'status': 'accepted',
    'serverVersion': version,
    'server': ?server,
    'details': ?details,
  };

  Map<String, Object?> _store(
    String userId,
    String deviceId,
    Map<String, Object?> c,
    String hash,
    Map<String, Object?> o,
  ) {
    final id = c['changeId']! as String;
    receipts[id] = _Receipt(
      userId: userId,
      deviceId: deviceId,
      seq: c['seq']! as int,
      entity: c['entity']! as String,
      recordId: c['recordId']! as String,
      field: c['field'] as String?,
      supersedes: c['supersedes'] as String?,
      conflictOf: c['conflictOf'] as String?,
      status: o['status']! as String,
      serverVersion: o['serverVersion'] as int?,
      reason: o['reason'] as String?,
      hash: hash,
      quarantined: o['quarantined'] == true,
      details: o['details'] as Map<String, Object?>?,
    );
    if (o['status'] == 'accepted' && (c['supersedes'] != null || c['conflictOf'] != null)) {
      _settle(id, create: c['op'] == 'create');
    }
    return receipts[id]!.result(this, id);
  }

  /// What an accepted fix or choice covers (apply.ts settle): what the phone folded into it (its
  /// earlier unsettled changes to the field, or a fixed create's record's rejections), then, by
  /// the person's own links, what each of those fixed or resolved in turn.
  void _settle(String id, {required bool create}) {
    final fix = receipts[id]!;
    bool open(_Receipt r) => !r.resolved && !r.quarantined && (r.status == 'rejected' || r.status == 'conflict');
    final queue = [
      id,
      for (final MapEntry(:key, value: r) in receipts.entries)
        if (r.userId == fix.userId &&
            r.recordId == fix.recordId &&
            open(r) &&
            (create ? r.status == 'rejected' : r.deviceId == fix.deviceId && r.field == fix.field && r.seq < fix.seq))
          key,
    ];
    final seen = <String>{};
    while (queue.isNotEmpty) {
      final next = queue.removeLast();
      final r = receipts[next];
      if (r == null || r.userId != fix.userId || !seen.add(next)) continue;
      if (next != id && open(r)) r.resolved = true;
      queue.addAll([r.supersedes, r.conflictOf].whereType<String>());
    }
  }

  static String _when(Map<String, Object?> c) => c['correctedTime'] as String? ?? c['deviceTime']! as String;

  bool _exists(ParentRef p) => p.entity == entityIdLink ? idLinks.containsKey(p.id) : records[p.id]?.entity == p.entity;

  // ---- creates (design 2.2 step 3, 2.3) ----

  Map<String, Object?> _create(_Actor actor, Map<String, Object?> c, EntityRules rules) {
    final value = c['value'];
    final issues = rules.createIssues(value);
    if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
    final v = value! as Map<String, Object?>;
    final problem = rules.valueProblem('create', null, v, _today);
    if (problem != null) return _invalid(problem);
    for (final p in rules.parentsOfCreate(v)) {
      if (!_exists(p)) return _rejected('stale_reference', {'problem': '${p.entity}_missing'});
    }
    final recordId = c['recordId']! as String;
    final at = _when(c);
    final changeId = c['changeId']! as String;
    if (rules.entity == entityIdLink) return _idLinkHandshake(actor, c, v);

    // The entity's own checks, before the insert (storeCreate's `check`).
    switch (rules.entity) {
      case entityNote:
        if (records[v['encounterId']]?.fields['status']?.value == 'signed') return _rejected('record_locked');
      case entityPatient:
        final consent = (v['consent']! as Map<String, Object?>)['id'];
        final notice = (v['privacyNotice']! as Map<String, Object?>)['id'];
        if (consent == notice || records.containsKey(consent) || records.containsKey(notice)) {
          return _invalid('record_exists');
        }
      case entityAlias:
        if (_active(entityAlias, v['patientId']) >= 20) return _invalid('too_many_aliases');
      case entityAllergy:
        if (_active(entityAllergy, v['patientId']) >= 30) return _invalid('too_many_allergies');
      case entityProblem:
        final origin = (v['recurrenceOf'] ?? v['resolvedInErrorOf']) as String?;
        if (origin != null) {
          final earlier = records[origin]!;
          final sameGroup =
              canonicalOf(earlier.patientId!) == canonicalOf(v['patientId']! as String) && earlier.status == 'resolved';
          if (!sameGroup) return _invalid('not_resolved');
        }
    }
    if (records.containsKey(recordId)) return _invalid('record_exists');

    final initial = rules.createdFields(v);
    final record = records[recordId] = FakeRecord(
      id: recordId,
      entity: rules.entity,
      author: actor.userId,
      attributes: rules.attributes(v),
      status: rules.initialStatus(v),
      patientId: switch (rules.entity) {
        entityProblemNote => records[v['problemId']]!.patientId,
        entityNote => null,
        _ => rules.patientOfCreate(recordId, v),
      },
      fields: {
        for (final MapEntry(:key, :value) in initial.entries) key: FakeField(value, 1, actor.userId, at, changeId),
      },
    );
    for (final MapEntry(:key, :value) in initial.entries) {
      _history(record, key, 1, value, null, 'created', actor, c);
    }
    Map<String, Object?>? details;
    switch (rules.entity) {
      case entityPatient:
        for (final name in ['consent', 'privacyNotice']) {
          final decision = v[name]! as Map<String, Object?>;
          final id = decision['id']! as String;
          records[id] = FakeRecord(
            id: id,
            entity: entityConsent,
            author: actor.userId,
            attributes: {
              'patientId': recordId,
              'kind': name == 'consent' ? 'care_and_record' : 'privacy_notice',
              ...decision,
            },
            status: 'recorded',
            patientId: recordId,
            fields: {},
          );
        }
        // The server sees legal names and patients the phone's index lacks; a pair flagged against
        // someone the creator wasn't shown is worth telling them about.
        final check = v['matchCheck'] as Map<String, Object?>?;
        final flagged = _rematch(
          recordId,
          'sync',
          shown: ((check?['shown'] as List<Object?>?) ?? const []).cast<String>(),
          dismissed: ((check?['dismissed'] as List<Object?>?) ?? const []).cast<String>(),
        );
        if (flagged) details = {'possibleDuplicate': true};
      case entityAlias:
        _rematch(v['patientId']! as String, 'edit');
      case entityAllergy:
        _clearNoKnownAllergies(actor, c, v['patientId']! as String);
      case entityProblem:
        record
          ..checkedAt = DateTime.parse(at)
          ..attributes['sensitive'] = v['sensitive'] == true || _sensitiveCode(v['code'])
          ..attributes['reversalRequest'] = v['resolvedInErrorOf'] == null ? null : 'open';
      case entityProblemNote:
        // Stored as sent, with the problem it names, retracted or merged since (review finding 7).
        if (records[v['problemId']]!.retracted) details = {'problemRetracted': true};
    }
    return _accepted(1, details: details);
  }

  int _active(String entity, Object? patientId) =>
      records.values.where((r) => r.entity == entity && r.patientId == patientId && r.status == 'active').length;

  /// problem.ts isSensitiveCode: the code's first characters sort inside a listed range.
  static bool _sensitiveCode(Object? code) {
    if (code is! Map<String, Object?>) return false;
    final c = code['code']! as String;
    return sensitiveCodeRanges.any((r) {
      final head = c.substring(0, min(c.length, r.from.length));
      return head.compareTo(r.from) >= 0 && head.compareTo(r.to) <= 0;
    });
  }

  /// "No known allergies" never stands beside an allergy (design 2.3): the group's screen goes back
  /// to "not asked", as the allergy's author, under its change ID.
  void _clearNoKnownAllergies(_Actor actor, Map<String, Object?> c, String patientId) {
    final patient = records[canonicalOf(patientId)]!;
    final cur = patient.fields['allergyScreen'];
    if (cur?.value != 'none_known') return;
    final version = cur!.version + 1;
    _write(patient, 'allergyScreen', 'not_asked', version, actor.userId, _when(c), c['changeId'] as String?);
    _history(patient, 'allergyScreen', version, 'not_asked', 'none_known', 'cleared_by_allergy', actor, c);
  }

  // ---- the ID link handshake (design 10.4) ----

  Map<String, Object?> _idLinkHandshake(_Actor actor, Map<String, Object?> c, Map<String, Object?> v) {
    final patientId = v['patientId']! as String;
    final patient = records[patientId]!;
    // A card is made on the chart that is kept: the phone makes a new one from the survivor.
    if (patient.status != 'active') {
      return _rejected('stale_reference', {'problem': 'patient_merged', 'survivorId': canonicalOf(patientId)});
    }
    final linkId = c['recordId']! as String;
    if (idLinks.containsKey(linkId)) return _invalid('record_exists');
    final effectiveAt = DateTime.parse(_when(c));
    final active = idLinks.values.where((l) => l.status == 'active' && canonicalOf(l.patientId) == patientId).toList()
      ..sort(
        (a, b) => b.effectiveAt != a.effectiveAt
            ? b.effectiveAt.compareTo(a.effectiveAt)
            : (b.received != a.received ? b.received - a.received : a.id.compareTo(b.id)),
      );
    final named = v['replacesLinkId'] != null && active.any((l) => l.id == v['replacesLinkId']);
    final rival = active.isNotEmpty && !named ? active.first : null;
    final won = rival == null || !effectiveAt.isBefore(rival.effectiveAt);
    final tokenHash = idLinkTokenHash(v['token']! as String);
    // Taken by a link in some team (2^-128): nothing retired or stored.
    if (idLinks.values.any((l) => l.tokenHash == tokenHash)) return _invalid('token_taken');
    final retiring = won ? active : const <FakeIdLink>[];
    for (final l in retiring) {
      l
        ..status = 'retired'
        ..retiredReason = rival == null ? 'regenerated' : 'superseded_by_newer';
    }
    idLinks[linkId] = FakeIdLink(
      id: linkId,
      patientId: patientId,
      token: v['token']! as String,
      tokenHash: tokenHash,
      status: won ? 'active' : 'retired',
      effectiveAt: effectiveAt,
      received: ++_received,
      issuedBy: actor.userId,
      replaces: v['replacesLinkId'] as String?,
    )..retiredReason = won ? null : 'superseded_by_newer';
    if (rival != null) {
      final (winner, loser) = won ? (linkId, rival.id) : (rival.id, linkId);
      notices
        ..add((
          userId: won ? rival.issuedBy : actor.userId,
          kind: 'id_link_superseded',
          entity: entityIdLink,
          recordId: loser,
        ))
        ..add((
          userId: won ? actor.userId : rival.issuedBy,
          kind: 'id_link_kept',
          entity: entityIdLink,
          recordId: winner,
        ));
    }
    return _accepted(
      1,
      details: {
        'linkOutcome': won ? 'active' : 'retired',
        'activeLinkId': won ? linkId : rival.id,
        'retiredLinkIds': won ? [for (final l in retiring) l.id] : [linkId],
      },
    );
  }

  // ---- sets (design 2.2 step 4, 2.4) ----

  Map<String, Object?> _set(_Actor actor, Map<String, Object?> c, EntityRules rules) {
    final field = c['field'] as String?;
    if (field == null) return _invalid('field_missing');
    final cls = rules.fieldClass(field);
    final issues = rules.fieldIssues(field, c['value']);
    if (issues == null || cls == null) return _invalid('unknown_field');
    if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
    final value = c['value'];
    final problem = rules.valueProblem('set', field, value, _today);
    if (problem != null) return _invalid(problem);
    final named = records[c['recordId']];
    if (named == null || named.entity != rules.entity) {
      return _rejected('stale_reference', {'problem': 'record_missing'});
    }
    for (final p in rules.parentsOfSet(field, value)) {
      if (!_exists(p)) return _rejected('stale_reference', {'problem': '${p.entity}_missing'});
    }
    // Entered in error: the problem's author, or someone who may reverse a resolution (design 9.5).
    if (rules.entity == entityProblem &&
        field == 'enteredInError' &&
        named.author != actor.userId &&
        !actor.permissions.contains('patients.reverse_resolved')) {
      return _rejected('permission');
    }
    // A set naming a merged record applies to its survivor, as one that never saw the survivor's
    // value (design 2.7).
    final redirect = _redirect(named, field);
    final rec = redirect == null ? named : records[redirect['redirectedTo']]!;
    final cur = rec.state(field);
    final saw =
        redirect == null &&
        (c['baseVersion'] == cur['version'] || _followsCurrent(actor, c, rec, field, cur['version']! as int));
    final s = _SetContext(actor, c, rules, rec, field, value, cur, saw, redirect);
    final outcome = switch (cls) {
      FieldClass.draft => _draftSet(s),
      FieldClass.keepBoth => _keepBothSet(s),
      FieldClass.identity => _identitySet(s),
      FieldClass.setOnce => _setOnceSet(s),
      FieldClass.status => _statusSet(s),
    };
    if (redirect != null && outcome['status'] == 'accepted') {
      return {
        ...outcome,
        'details': {...?outcome['details'] as Map<String, Object?>?, ...redirect},
      };
    }
    return outcome;
  }

  /// A merged patient's survivor, for any of its fields; a merged problem's, for its status only
  /// (a retraction stays on the record it names).
  Map<String, Object?>? _redirect(FakeRecord rec, String field) {
    if (rec.entity == entityPatient && rec.status == 'merged') {
      final merge = merges.values.where((m) => m.mergedId == rec.id && m.undoneAt == null).firstOrNull;
      return {'redirectedTo': canonicalOf(rec.id), 'mergeId': ?merge?.id};
    }
    if (rec.entity == entityProblem && field == 'status' && rec.mergedInto != null) {
      var to = rec;
      for (var hops = 0; to.mergedInto != null && hops < 20; hops++) {
        to = records[to.mergedInto]!;
      }
      return {'redirectedTo': to.id};
    }
    return null;
  }

  /// D16, with the exception of design 2.2 step 7: a change that follows the person's own earlier
  /// one saw the current value only when that one reached the chart as sent.
  bool _followsCurrent(_Actor actor, Map<String, Object?> c, FakeRecord rec, String field, int version) {
    final follows = c['follows'] as String?;
    if (follows == null) return false;
    final meta = rec.fields[field];
    if (meta != null && meta.changeId == follows && meta.by == actor.userId) return true;
    final prev = receipts[follows];
    final details = prev?.details;
    final keptNotApplied =
        details?['outcome'] == 'kept_both' || details?['outcome'] == 'history_only' || details?['redirectedTo'] != null;
    return prev != null &&
        prev.status == 'accepted' &&
        !keptNotApplied &&
        prev.userId == actor.userId &&
        prev.recordId == c['recordId'] &&
        prev.field == field &&
        prev.serverVersion == version;
  }

  /// Writes the value: the field's next version and its history (`redirected` for a redirected
  /// change), then what the write sets off (matching again on a name).
  Map<String, Object?> _writeValue(_SetContext s, String kind) {
    final version = (s.cur['version']! as int) + 1;
    _write(s.rec, s.field, s.value, version, s.actor.userId, _when(s.c), s.c['changeId'] as String?);
    _history(s.rec, s.field, version, s.value, s.cur['value'], s.redirect != null ? 'redirected' : kind, s.actor, s.c);
    if (s.rec.entity == entityPatient && const {'preferredName', 'legalName', 'birth'}.contains(s.field)) {
      _rematch(s.rec.id, 'edit');
    }
    if (s.rec.entity == entityAlias) _rematch(s.rec.patientId!, 'edit');
    return _accepted(version);
  }

  /// One field write and what it decides about its record.
  void _write(FakeRecord rec, String field, Object? value, int version, String by, String at, String? changeId) {
    rec.fields[field] = FakeField(value, version, by, at, changeId);
    switch ((rec.entity, field)) {
      case (entityAlias, 'removal'):
        rec.status = 'removed';
      case (entityAllergy, 'enteredInError'):
        rec.status = 'entered_in_error';
      case (entityProblem, 'enteredInError'):
        rec.retracted = true;
      case (entityProblem, 'status'):
        rec.status = (value! as Map<String, Object?>)['status']! as String;
        // A confirmation moves only the check date, and it never moves back.
        final when = DateTime.parse(at);
        if (rec.checkedAt == null || when.isAfter(rec.checkedAt!)) rec.checkedAt = when;
    }
  }

  void _history(
    FakeRecord rec,
    String field,
    int version,
    Object? value,
    Object? previous,
    String kind,
    _Actor actor,
    Map<String, Object?> c, {
    String? reviewId,
  }) => history.add({
    'entity': rec.entity,
    'recordId': rec.id,
    'field': field,
    'version': version,
    'kind': kind,
    'value': value,
    'previous': previous,
    'by': actor.userId,
    'changeId': c['changeId'],
    'reviewId': ?reviewId,
  });

  /// Kept in history, not applied: the other value of an open review ([needs]), or history only
  /// (a stale observation, a second retraction, a clear that would leave nobody recognisable).
  /// Accepted at the field's version, and the receipt carries the chart's value (design 2.5).
  Map<String, Object?> _keepInHistory(_SetContext s, {String? needs, String? problem}) {
    String? reviewId;
    if (needs != null) {
      final open = reviews.values
          .where((r) => r.status == 'open' && r.entity == s.rec.entity && r.recordId == s.rec.id && r.field == s.field)
          .firstOrNull;
      reviewId = open?.id ?? _uuid();
      reviews[reviewId] ??= FakeReview(reviewId, s.rec.entity, s.rec.id, s.field, needs);
    }
    _history(
      s.rec,
      s.field,
      s.cur['version']! as int,
      s.value,
      s.cur['value'],
      'kept_both',
      s.actor,
      s.c,
      reviewId: reviewId,
    );
    return _accepted(
      s.cur['version']! as int,
      server: s.cur,
      details: reviewId != null
          ? {'outcome': 'kept_both', 'reviewId': reviewId}
          : {'outcome': 'history_only', 'problem': ?problem},
    );
  }

  /// The person looked at both values and kept the server's: theirs is kept in history.
  Map<String, Object?> _keepServer(_SetContext s) {
    if (!s.saw) return _conflict(s);
    _history(s.rec, s.field, s.cur['version']! as int, s.value, s.cur['value'], 'kept_both', s.actor, s.c);
    return _accepted(s.cur['version']! as int);
  }

  Map<String, Object?> _conflict(_SetContext s) => {
    'status': 'conflict',
    'serverVersion': s.cur['version'],
    'server': s.cur,
  };

  bool _same(Object? a, Object? b) => canonicalJson(a) == canonicalJson(b);

  /// The draft rule (D9): encounters and notes.
  Map<String, Object?> _draftSet(_SetContext s) {
    if (s.rec.fields['status']?.value == 'signed') return _rejected('record_locked');
    final dataFields = s.rec.fields.keys.where((f) => f.startsWith('data.')).length;
    if (s.field.startsWith('data.') && !s.rec.fields.containsKey(s.field) && dataFields >= maxNoteFields) {
      return _invalid('too_many_fields');
    }
    final resolution = s.c['resolution'];
    if (resolution == 'keep_server') return _keepServer(s);
    if (_same(s.cur['value'], s.value)) return _accepted(s.cur['version']! as int);
    if (resolution == 'replace') return s.saw ? _writeValue(s, 'replaced_after_review') : _conflict(s);
    if (s.saw) return _writeValue(s, 'set');
    if (isBlankValue(s.cur['value'])) return _writeValue(s, 'filled_blank');
    // "A field that already holds a different value is never overwritten silently."
    return _conflict(s);
  }

  /// Patient demographics (keep both).
  Map<String, Object?> _keepBothSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (_same(s.cur['value'], s.value)) return _accepted(s.cur['version']! as int);
    // An allergy outranks "No known allergies", whichever arrives first; nothing to review.
    if (s.field == 'allergyScreen' && s.value == 'none_known' && _groupHasActiveAllergy(s.rec.id)) {
      return _keepInHistory(s);
    }
    if (s.saw || isBlankField(s.field, s.cur['value'])) {
      return _writeUnlessUnrecognisable(s, s.saw ? 'set' : 'filled_blank');
    }
    return _keepInHistory(s, needs: 'patients.edit');
  }

  bool _groupHasActiveAllergy(String canonicalId) => records.values.any(
    (r) => r.entity == entityAllergy && r.status == 'active' && canonicalOf(r.patientId!) == canonicalId,
  );

  /// Someone must stay recognisable (design 2.3, D42).
  Map<String, Object?> _writeUnlessUnrecognisable(_SetContext s, String kind) {
    final values = {for (final MapEntry(:key, :value) in s.rec.fields.entries) key: value.value};
    if (!recognisableAfter(values, s.field, s.value)) return _keepInHistory(s, problem: 'nothing_to_recognise');
    return _writeValue(s, kind);
  }

  /// Legal name and birth (identity): a fill only from someone who saw the current value, or into
  /// a blank; anything else is an admin's correction, or a kept alternate for one.
  Map<String, Object?> _identitySet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    final cur = s.cur['value'];
    if (_same(cur, s.value)) return _accepted(s.cur['version']! as int);
    if (isBlankValue(cur)) return _writeUnlessUnrecognisable(s, 'filled_blank');
    if (!s.saw) return _keepInHistory(s, needs: 'patients.correct_identity');
    if (fills(s.field, cur, s.value)) return _writeUnlessUnrecognisable(s, 'filled_blank');
    if (s.field == 'birth' && refinedOutOfRange(cur, s.value)) {
      return _keepInHistory(s, needs: 'patients.correct_identity');
    }
    return _invalid('identity_admin_only');
  }

  /// Retractions: the first is written, a later one kept in history. Never un-set.
  Map<String, Object?> _setOnceSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (!isBlankValue(s.cur['value'])) return _keepInHistory(s);
    return _writeValue(s, s.field == 'enteredInError' ? 'entered_in_error' : 'set');
  }

  /// A problem's status (design 9.2): every observation counts, the latest by corrected device time
  /// wins, and only an admin moves a problem out of Resolved.
  Map<String, Object?> _statusSet(_SetContext s) {
    // Kept, and the problem stays retracted: nothing for the worker to fix.
    if (s.rec.retracted) return _keepInHistory(s);
    final resolution = s.c['resolution'];
    if (resolution == 'keep_server') return _keepServer(s);
    if (resolution == 'replace' && !s.saw) return _conflict(s);
    final cur = (s.cur['value']! as Map<String, Object?>)['status'];
    final next = (s.value! as Map<String, Object?>)['status'];
    final forward = problemStatusRank(next) > problemStatusRank(cur);
    if (s.saw) {
      if (next == cur) return _writeValue(s, 'confirmed');
      if (forward) return _writeValue(s, 'set');
      return _invalid(cur == 'resolved' ? 'resolved_needs_admin' : 'status_backwards');
    }
    // Older than the observation the chart holds: history, even when it agrees.
    final observedAt = s.rec.fields['status']?.at;
    if (observedAt != null && DateTime.parse(_when(s.c)).isBefore(DateTime.parse(observedAt))) {
      return _keepInHistory(s);
    }
    if (next == cur) return _writeValue(s, 'confirmed');
    if (forward) return _writeValue(s, 'set');
    if (cur == 'resolved') return _conflict(s);
    return _keepInHistory(s);
  }

  // ---- duplicate matching (design 8.2), with the phone's scorer and no sound-alike term ----

  /// The names of a canonical patient's group, as the server's patient_name_keys hold them.
  List<NameKey> _keysOf(String canonicalId) {
    final group = groupOf(canonicalId).toList();
    final ids = {for (final r in group) r.id};
    return [
      for (final r in group) ...[
        NameKey.of(NameSource.preferred, r.fields['preferredName']?.value as String?),
        if (r.fields['legalName']?.value case final Map<String, Object?> legal)
          NameKey.legal(legal['given'] as String?, legal['family'] as String?),
      ],
      for (final a in records.values)
        if (a.entity == entityAlias && a.status == 'active' && ids.contains(a.patientId))
          NameKey.of(NameSource.alias, a.attributes['alias'] as String?),
    ].nonNulls.toList();
  }

  /// Re-runs matching for [patientId]'s group: every other active patient at or above the queue
  /// threshold is flagged (a decided pair is left alone). True when a pair names a patient the
  /// creator was not shown at intake ([shown], [dismissed]).
  bool _rematch(String patientId, String source, {List<String> shown = const [], List<String> dismissed = const []}) {
    final self = canonicalOf(patientId);
    final names = _keysOf(self);
    if (names.isEmpty) return false;
    final subject = MatchSubject(names: names, birth: Birth.fromJson(records[self]!.fields['birth']?.value));
    final exclude = {
      self,
      for (final p in pairs)
        if (p.status == 'kept_separate' && (p.a == self || p.b == self)) p.a == self ? p.b : p.a,
    };
    final candidates = [
      for (final r in records.values)
        if (r.entity == entityPatient && r.status == 'active' && !exclude.contains(r.id))
          CandidateGroup(
            patientId: r.id,
            keys: _keysOf(r.id),
            births: [for (final g in groupOf(r.id)) Birth.fromJson(g.fields['birth']?.value)],
          ),
    ];
    final seen = {...shown, ...dismissed}.map(canonicalOf).toSet();
    var flaggedUnseen = false;
    for (final m in rankMatches(
      subject,
      candidates,
      exclude: exclude,
      minScore: queueThreshold,
      limit: candidateLimit,
    )) {
      final other = m.group.patientId;
      final existing = _pairOf(self, other);
      if (existing == null) {
        pairs.add(FakePair(_uuid(), self, other, m.score.score, [source]));
      } else if (existing.status == 'open' || existing.status == 'not_sure') {
        existing
          ..score = max(existing.score, m.score.score)
          ..sources = {...existing.sources, source}.toList();
      } else {
        continue;
      }
      if (!seen.contains(other)) flaggedUnseen = true;
    }
    return flaggedUnseen;
  }

  // ---- reads ----

  Map<String, Object?> _fetch(Map<String, Object?> b) {
    final out = <Object?>[];
    final missing = <Object?>[];
    for (final ref in (b['records']! as List<Object?>).cast<Map<String, Object?>>()) {
      final r = records[ref['id']];
      if (r == null) {
        missing.add(ref);
        continue;
      }
      final at = now().toUtc().toIso8601String();
      out.add({
        'entity': r.entity,
        'id': ref['id'],
        'version': 1,
        'status': r.entity == entityEncounter || r.entity == entityNote
            ? r.fields['status']?.value ?? 'draft'
            : r.status,
        'authorUserId': r.author,
        'createdAt': at,
        'updatedAt': at,
        'attributes': r.attributes,
        'fields': {for (final name in r.fields.keys) name: r.state(name)},
      });
    }
    return {'records': out, 'missing': missing};
  }

  Future<Map<String, Object?>> _signed(String deviceId, String purpose, Map<String, Object?> b) async {
    final payload = b['payload']! as Map<String, Object?>;
    final device = devices[deviceId];
    if (device == null || payload['purpose'] != purpose || payload['deviceId'] != deviceId) {
      throw const ApiException(401, 'device_signature_invalid', 'This phone could not be verified.');
    }
    final ok = await Ed25519().verify(
      utf8.encode(canonicalJson(payload)),
      signature: Signature(
        base64Url.decode(base64Url.normalize(b['signature']! as String)),
        publicKey: SimplePublicKey(base64Url.decode(base64Url.normalize(device.publicKey)), type: KeyPairType.ed25519),
      ),
    );
    if (!ok) throw const ApiException(401, 'device_signature_invalid', 'This phone could not be verified.');
    final removed =
        removedUsers.contains(device.userId) || removedFromTeam.contains('${device.userId}/${device.teamId}');
    final access = removed ? 'removed' : 'active';
    switch (purpose) {
      case 'status':
        return {'status': device.status, 'access': access, 'serverTime': now().toUtc().toIso8601String()};
      case 'quarantine':
        if (device.status == 'wipe_requested') throw const ApiException(409, 'wipe_requested', 'Wipe this phone.');
        if (device.status == 'active' && access == 'active') {
          throw const ApiException(409, 'use_sync', 'This phone can still sync normally.');
        }
        final results = <Object?>[];
        final changes = (payload['changes']! as List<Object?>).cast<Map<String, Object?>>();
        // The same SyncChange schema as a push: one unreadable change refuses the whole upload.
        _validatePush(changes);
        for (final c in changes) {
          final hash = valueHash(c['value']);
          if (hash != c['valueHash']) {
            results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'hash_mismatch'});
            continue;
          }
          if (c['entity'] == entityAudit) {
            // An offline read joins the audit chain as the person's, not anyone's to approve.
            if (auditIssues(c['value']).isNotEmpty) {
              results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'validation'});
              continue;
            }
            if (!audit.any((a) => a['changeId'] == c['changeId'])) {
              audit.add({
                ...c['value']! as Map<String, Object?>,
                'deviceTime': c['deviceTime'],
                'changeId': c['changeId'],
                'userId': device.userId,
                'afterRemoval': true,
              });
            }
            results.add({'changeId': c['changeId'], 'status': 'recorded', 'hash': hash});
            continue;
          }
          _hold(device.userId, c, 'access_removed');
          results.add({'changeId': c['changeId'], 'status': 'quarantined', 'hash': hash});
        }
        return {'results': results};
      default:
        device.status = 'wiped';
        return {'ok': true};
    }
  }
}

class _Actor {
  _Actor(this.userId, this.deviceId, this.permissions, {required this.holdForReview});
  final String userId;
  final String deviceId;
  final Set<String> permissions;

  /// A push holds what it may not apply; an admin's accept fails instead.
  final bool holdForReview;
}

class _SetContext {
  _SetContext(this.actor, this.c, this.rules, this.rec, this.field, this.value, this.cur, this.saw, this.redirect);
  final _Actor actor;
  final Map<String, Object?> c;
  final EntityRules rules;

  /// The record the change applies to: the survivor when it was redirected.
  final FakeRecord rec;
  final String field;
  final Object? value;

  /// The field as the server holds it (a FieldState).
  final Map<String, Object?> cur;
  final bool saw;
  final Map<String, Object?>? redirect;
}

class _Transport implements ApiTransport {
  _Transport(this.server, this.userId, this.teamId);
  final FakeSyncServer server;
  final String userId;
  final String teamId;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) =>
      server.handle(userId, teamId, method, path, body);
}

class _Device {
  _Device(this.userId, this.teamId, this.publicKey);
  final String userId;
  final String teamId;
  final String publicKey;
  String status = 'active';
  Map<String, Object?> unsynced = {};
  String? oldestUnsynced;
}

/// One field as the server holds it: its value, version, who and when (corrected device time) last
/// wrote it, and the change that did.
class FakeField {
  FakeField(this.value, this.version, this.by, this.at, this.changeId);
  final Object? value;
  final int version;
  final String? by;
  final String? at;
  final String? changeId;
}

/// A synced record on the fake server.
class FakeRecord {
  FakeRecord({
    required this.id,
    required this.entity,
    required this.author,
    required this.attributes,
    required this.fields,
    this.status = 'active',
    this.patientId,
  });
  final String id;
  final String entity;
  final String author;
  final Map<String, Object?> attributes;
  final Map<String, FakeField> fields;

  /// active, merged (a patient), removed (a street name), entered_in_error (an allergy), a
  /// problem's status, recorded (a consent, a problem note).
  String status;

  /// The patient a patient-side record names, as stored (a merged one included).
  final String? patientId;

  /// A merged patient's or problem's survivor.
  String? mergedInto;

  /// A problem marked entered in error.
  bool retracted = false;

  /// When a problem's status was last observed; never moves back.
  DateTime? checkedAt;

  /// The field as a FieldState: version 0 and no value when never written.
  Map<String, Object?> state(String field) {
    final f = fields[field];
    return {'value': f?.value, 'version': f?.version ?? 0, 'changedBy': f?.by, 'changedAt': f?.at};
  }
}

class FakeReview {
  FakeReview(this.id, this.entity, this.recordId, this.field, this.needs);
  final String id;
  final String entity;
  final String recordId;
  final String field;
  final String needs;
  String status = 'open';
}

class FakePair {
  FakePair(this.id, String x, String y, this.score, this.sources)
    : a = x.compareTo(y) < 0 ? x : y,
      b = x.compareTo(y) < 0 ? y : x;
  final String id;
  final String a;
  final String b;
  double score;
  List<String> sources;

  /// open, not_sure, kept_separate, merged or superseded.
  String status = 'open';
}

class FakeMerge {
  FakeMerge(this.id, this.mergedId, this.survivorId, this.mergedAt);
  final String id;
  final String mergedId;
  final String survivorId;
  final DateTime mergedAt;
  DateTime? undoneAt;
}

class FakeIdLink {
  FakeIdLink({
    required this.id,
    required this.patientId,
    required this.token,
    required this.tokenHash,
    required this.status,
    required this.effectiveAt,
    required this.received,
    required this.issuedBy,
    this.replaces,
  });
  final String id;

  /// The record it was issued on (the canonical one at the time).
  final String patientId;
  final String token;
  final String tokenHash;

  /// active or retired.
  String status;
  String? retiredReason;
  final DateTime effectiveAt;

  /// Receipt order: a tie on effective time goes to the later receipt.
  final int received;
  final String issuedBy;
  final String? replaces;
}

class _Receipt {
  _Receipt({
    required this.userId,
    required this.deviceId,
    required this.seq,
    required this.entity,
    required this.recordId,
    required this.field,
    required this.supersedes,
    required this.conflictOf,
    required this.status,
    required this.serverVersion,
    required this.reason,
    required this.hash,
    required this.quarantined,
    required this.details,
  });
  final String userId;
  final String deviceId;
  final int seq;
  final String entity;
  final String recordId;
  final String? field;
  final String? supersedes;
  final String? conflictOf;
  final String status;
  final int? serverVersion;
  final String? reason;
  final String hash;
  final bool quarantined;

  /// What an accepted change carried (kept both, redirected, a card's outcome), or a refusal's.
  final Map<String, Object?>? details;
  bool resolved = false;

  /// The answer for this change, as the API gives it: a conflict, and a value kept but not applied,
  /// show the field as the server holds it now (apply.ts resultFromReceipt).
  Map<String, Object?> result(FakeSyncServer s, String changeId) {
    Map<String, Object?> current(String id) =>
        s.records[id]?.state(field ?? '') ?? {'value': null, 'version': 0, 'changedBy': null, 'changedAt': null};
    switch (status) {
      case 'accepted':
        final kept = details?['outcome'] == 'kept_both' || details?['outcome'] == 'history_only';
        final on = details?['redirectedTo'] as String? ?? recordId;
        return {
          'changeId': changeId,
          'status': 'accepted',
          'serverVersion': serverVersion,
          'hash': hash,
          if (kept) 'server': current(on),
          'details': ?details,
        };
      case 'conflict':
        final f = current(recordId);
        return {'changeId': changeId, 'status': 'conflict', 'serverVersion': f['version'], 'server': f};
      default:
        return {
          'changeId': changeId,
          'status': 'rejected',
          'reason': reason,
          'message': 'rejected: $reason',
          'details': ?details,
          if (quarantined) ...{'quarantined': true, 'hash': hash},
        };
    }
  }
}
