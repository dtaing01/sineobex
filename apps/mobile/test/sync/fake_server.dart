import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/sync/canonical_json.dart';

/// An in-memory server with the API's sync rules (services/api/src/sync), for engine tests. The
/// live test (live_api_test.dart) runs the same scenarios against the real API in CI, which keeps
/// this fake honest.
class FakeSyncServer {
  FakeSyncServer({required this.now});

  /// The server's own clock.
  DateTime Function() now;

  final devices = <String, _Device>{};
  final records = <String, _Record>{};
  final receipts = <String, _Receipt>{};
  final quarantine = <String, Map<String, Object?>>{};
  final audit = <Map<String, Object?>>[];
  final history = <Map<String, Object?>>[];
  final removedUsers = <String>{};
  final cannotChart = <String>{};

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

  ApiTransport transportFor(String userId, String teamId) => _Transport(this, userId, teamId);

  /// Someone else changes a field on the server.
  void serverEdit(String recordId, String field, Object? value, {required String by}) {
    final record = records[recordId]!;
    final current = record.fields[field];
    record.fields[field] = _Field(value, (current?.version ?? 0) + 1, by, now().toUtc().toIso8601String(), null);
  }

  Future<Object?> handle(String userId, String teamId, String method, String path, Object? rawBody) async {
    if (offline) throw const NetworkException('offline');
    onRequest?.call(path);
    // Round-trip through JSON, as HTTP would.
    final body = rawBody == null ? null : jsonDecode(jsonEncode(rawBody)) as Map<String, Object?>;
    final signed = RegExp(r'^/v1/devices/([^/]+)/(status|quarantine|wiped)$').firstMatch(path);
    final Object? result;
    if (signed != null) {
      result = await _signed(signed.group(1)!, signed.group(2)!, body!);
    } else {
      if (removedUsers.contains(userId)) {
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
    device.unsynced = Map.of((b['unsynced']! as Map<String, Object?>)['counts']! as Map<String, Object?>);
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

  Map<String, Object?> _one(String userId, String deviceId, Map<String, Object?> c) {
    final id = c['changeId']! as String;
    final hash = valueHash(c['value']);
    if (!c.containsKey('value')) return _store(userId, deviceId, c, hash, _rejected('validation'));
    if (hash != c['valueHash']) return {'changeId': id, 'status': 'rejected', 'reason': 'hash_mismatch'};
    final existing = receipts[id];
    if (existing != null) return existing.result(this);
    if (c['entity'] == 'audit') {
      if (!_auditOk(c['value'])) return _store(userId, deviceId, c, hash, _rejected('validation'));
      audit.add({
        'action': (c['value']! as Map<String, Object?>)['action'],
        'deviceTime': c['deviceTime'],
        'changeId': id,
      });
      return _store(userId, deviceId, c, hash, {'status': 'accepted', 'serverVersion': 1, 'hash': hash});
    }
    if (cannotChart.contains(userId)) {
      quarantine[id] = c;
      return _store(userId, deviceId, c, hash, {
        'status': 'rejected',
        'reason': 'permission',
        'quarantined': true,
        'hash': hash,
      });
    }
    final outcome = c['op'] == 'create' ? _create(userId, c) : _set(userId, c);
    return _store(userId, deviceId, c, hash, outcome..putIfAbsent('hash', () => hash));
  }

  Map<String, Object?> _rejected(String reason, [Map<String, Object?>? details]) => {
    'status': 'rejected',
    'reason': reason,
    'message': 'rejected: $reason',
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
      recordId: c['recordId']! as String,
      field: c['field'] as String?,
      status: o['status']! as String,
      serverVersion: o['serverVersion'] as int?,
      reason: o['reason'] as String?,
      hash: hash,
      quarantined: o['quarantined'] == true,
    );
    if (o['status'] == 'accepted') {
      for (final linked in [c['supersedes'], c['conflictOf']].whereType<String>()) {
        receipts[linked]?.resolved = true;
      }
      // A fixed create also settles the record's other rejections by this person.
      if (c['op'] == 'create' && c['supersedes'] != null) {
        for (final r in receipts.values) {
          if (r.recordId == c['recordId'] && r.userId == userId && r.status == 'rejected') r.resolved = true;
        }
      }
    }
    return receipts[id]!.result(this);
  }

  Map<String, Object?> _create(String userId, Map<String, Object?> c) {
    final recordId = c['recordId']! as String;
    final value = c['value'];
    if (value is! Map<String, Object?>) return _rejected('validation');
    if (records.containsKey(recordId)) return _rejected('validation', {'problem': 'record_exists'});
    final at = c['correctedTime'] as String? ?? c['deviceTime']! as String;
    final fields = <String, _Field>{};
    void put(String name, Object? v) => fields[name] = _Field(v, 1, userId, at, c['changeId']! as String);
    if (c['entity'] == 'encounter') {
      if (value['kind'] != 'medical' && value['kind'] != 'non_medical') return _rejected('validation');
      if (!value.keys.every({'kind', 'patientId', 'location'}.contains) ||
          !_nullOr(value['patientId'], _isUuid) ||
          !_nullOr(value['location'], _isLocation)) {
        return _rejected('validation');
      }
      put('patientId', value['patientId']);
      put('location', value['location']);
      put('status', 'draft');
    } else {
      final data = value['data'];
      final version = value['noteTypeVersion'];
      if (!value.keys.every({'encounterId', 'noteTypeKey', 'noteTypeVersion', 'data'}.contains) ||
          !_isUuid(value['encounterId']) ||
          value['noteTypeKey'] is! String ||
          !_noteTypeKey.hasMatch(value['noteTypeKey']! as String) ||
          !(version == null || (version is int && version >= 1)) ||
          !(data == null || (data is Map<String, Object?> && data.keys.every(_dataPath.hasMatch)))) {
        return _rejected('validation');
      }
      final encounter = records[value['encounterId']];
      if (encounter == null) return _rejected('stale_reference', {'problem': 'encounter_missing'});
      if (encounter.fields['status']?.value == 'signed') return _rejected('record_locked');
      put('status', 'draft');
      for (final MapEntry(:key, :value) in ((value['data'] as Map<String, Object?>?) ?? {}).entries) {
        put('data.$key', value);
      }
    }
    records[recordId] = _Record(
      entity: c['entity']! as String,
      author: userId,
      attributes: {...value}..remove('data'),
      fields: fields,
    );
    return {'status': 'accepted', 'serverVersion': 1};
  }

  Map<String, Object?> _set(String userId, Map<String, Object?> c) {
    final record = records[c['recordId']];
    if (record == null) return _rejected('stale_reference', {'problem': 'record_missing'});
    if (record.fields['status']?.value == 'signed') return _rejected('record_locked');
    final name = c['field']! as String;
    final value = c['value'];
    final valid = switch ((record.entity, name)) {
      (_, 'status') => value == 'draft' || value == 'completed',
      ('encounter', 'patientId') => _nullOr(value, _isUuid),
      ('encounter', 'location') => _nullOr(value, _isLocation),
      ('encounter_note', _) when name.startsWith('data.') => _dataPath.hasMatch(name.substring(5)),
      _ => null,
    };
    if (valid == null) return _rejected('validation', {'problem': 'unknown_field'});
    if (!valid) return _rejected('validation');
    final current = record.fields[name] ?? _Field(null, 0, null, null, null);
    final serverState = {
      'value': current.value,
      'version': current.version,
      'changedBy': current.by,
      'changedAt': current.at,
    };
    final follows = c['follows'] as String?;
    final prev = follows == null ? null : receipts[follows];
    final sawCurrent =
        c['baseVersion'] == current.version ||
        (follows != null && current.changeId == follows && current.by == userId) ||
        (prev != null &&
            prev.status == 'accepted' &&
            prev.userId == userId &&
            prev.recordId == c['recordId'] &&
            prev.field == name &&
            prev.serverVersion == current.version);
    if (c['resolution'] == 'keep_server') {
      if (!sawCurrent) return {'status': 'conflict', 'serverVersion': current.version, 'server': serverState};
      history.add({'field': name, 'kind': 'kept_both', 'value': value, 'previous': current.value});
      return {'status': 'accepted', 'serverVersion': current.version};
    }
    if (canonicalJson(current.value) == canonicalJson(value)) {
      return {'status': 'accepted', 'serverVersion': current.version};
    }
    String kind;
    if (c['resolution'] == 'replace') {
      if (!sawCurrent) return {'status': 'conflict', 'serverVersion': current.version, 'server': serverState};
      kind = 'replaced_after_review';
    } else if (sawCurrent) {
      kind = 'set';
    } else if (_isBlank(current.value)) {
      kind = 'filled_blank';
    } else {
      return {'status': 'conflict', 'serverVersion': current.version, 'server': serverState};
    }
    final version = current.version + 1;
    record.fields[name] = _Field(
      value,
      version,
      userId,
      c['correctedTime'] as String? ?? c['deviceTime']! as String,
      c['changeId']! as String,
    );
    history.add({'field': name, 'kind': kind, 'value': value, 'previous': current.value, 'by': userId});
    return {'status': 'accepted', 'serverVersion': version};
  }

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
        'status': r.fields['status']?.value ?? 'draft',
        'authorUserId': r.author,
        'createdAt': at,
        'updatedAt': at,
        'attributes': r.attributes,
        'fields': {
          for (final MapEntry(:key, :value) in r.fields.entries)
            key: {'value': value.value, 'version': value.version, 'changedBy': value.by, 'changedAt': value.at},
        },
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
    final access = removedUsers.contains(device.userId) ? 'removed' : 'active';
    switch (purpose) {
      case 'status':
        return {'status': device.status, 'access': access, 'serverTime': now().toUtc().toIso8601String()};
      case 'quarantine':
        if (device.status == 'active' && access == 'active') {
          throw const ApiException(409, 'use_sync', 'This phone can still sync normally.');
        }
        final results = <Object?>[];
        for (final c in (payload['changes']! as List<Object?>).cast<Map<String, Object?>>()) {
          final hash = valueHash(c['value']);
          if (hash != c['valueHash']) {
            results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'hash_mismatch'});
            continue;
          }
          quarantine[c['changeId']! as String] = c;
          results.add({'changeId': c['changeId'], 'status': 'quarantined', 'hash': hash});
        }
        return {'results': results};
      default:
        device.status = 'wiped';
        return {'ok': true};
    }
  }
}

final _uuid = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$');
final _noteTypeKey = RegExp(r'^[a-z][a-z0-9_]{1,60}$');
final _dataPath = RegExp(r'^[a-z][a-zA-Z0-9_]{0,60}(\.[a-z][a-zA-Z0-9_]{0,60}){0,3}$');
const _auditActions = {'patient.viewed', 'patient.searched', 'encounter.viewed', 'note.viewed'};

bool _isUuid(Object? v) => v is String && _uuid.hasMatch(v);
bool _nullOr(Object? v, bool Function(Object?) ok) => v == null || ok(v);

/// records.ts Location: strict, lat and lng in range, accuracyM optional but never null.
bool _isLocation(Object? v) {
  if (v is! Map<String, Object?> || !v.keys.every({'lat', 'lng', 'accuracyM'}.contains)) return false;
  final lat = v['lat'], lng = v['lng'], accuracy = v['accuracyM'];
  return lat is num &&
      lng is num &&
      lat.abs() <= 90 &&
      lng.abs() <= 180 &&
      (!v.containsKey('accuracyM') || (accuracy is num && accuracy >= 0 && accuracy <= 100000));
}

/// apply.ts AuditAppend.
bool _auditOk(Object? v) {
  if (v is! Map<String, Object?> || !_auditActions.contains(v['action'])) return false;
  if (!v.keys.every({'action', 'entity', 'entityId', 'patientId', 'resultCount'}.contains)) return false;
  final entity = v['entity'], count = v['resultCount'];
  return (entity == null || (entity is String && RegExp(r'^[a-z_]{1,40}$').hasMatch(entity))) &&
      _nullOr(v['entityId'], _isUuid) &&
      _nullOr(v['patientId'], _isUuid) &&
      (count == null || (count is int && count >= 0 && count <= 100000));
}

/// records.ts isBlank: an empty object is blank too.
bool _isBlank(Object? v) => v == null || v == '' || (v is List && v.isEmpty) || (v is Map && v.isEmpty);

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
}

class _Field {
  _Field(this.value, this.version, this.by, this.at, this.changeId);
  final Object? value;
  final int version;
  final String? by;
  final String? at;
  final String? changeId;
}

class _Record {
  _Record({required this.entity, required this.author, required this.attributes, required this.fields});
  final String entity;
  final String author;
  final Map<String, Object?> attributes;
  final Map<String, _Field> fields;
}

class _Receipt {
  _Receipt({
    required this.userId,
    required this.deviceId,
    required this.recordId,
    required this.field,
    required this.status,
    required this.serverVersion,
    required this.reason,
    required this.hash,
    required this.quarantined,
  });
  final String userId;
  final String deviceId;
  final String recordId;
  final String? field;
  final String status;
  final int? serverVersion;
  final String? reason;
  final String hash;
  final bool quarantined;
  bool resolved = false;

  /// The answer for this change, as the API gives it (conflicts show the current server value).
  Map<String, Object?> result(FakeSyncServer s) {
    final changeId = s.receipts.entries.firstWhere((e) => identical(e.value, this)).key;
    switch (status) {
      case 'accepted':
        return {'changeId': changeId, 'status': 'accepted', 'serverVersion': serverVersion, 'hash': hash};
      case 'conflict':
        final f = s.records[recordId]?.fields[field];
        return {
          'changeId': changeId,
          'status': 'conflict',
          'serverVersion': f?.version ?? 0,
          'server': {'value': f?.value, 'version': f?.version ?? 0, 'changedBy': f?.by, 'changedAt': f?.at},
        };
      default:
        return {
          'changeId': changeId,
          'status': 'rejected',
          'reason': reason,
          'message': 'rejected: $reason',
          if (quarantined) ...{'quarantined': true, 'hash': hash},
        };
    }
  }
}
