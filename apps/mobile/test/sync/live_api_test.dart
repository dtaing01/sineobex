import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/auth/auth_provider.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_engine.dart';

import 'phone_harness.dart';

/// The Phase 2 done-when scenarios against the real API and Postgres: the same engine as
/// sync_scenarios_test.dart, with the real server instead of the in-memory one. It proves the
/// fake's rules match, and checks what only a real round trip can: canonical JSON hashed alike in
/// Dart and TypeScript, and Ed25519 signatures made in Dart and verified in Node.
///
/// CI's "Phone sync against the real API" job starts the API and the dev identity provider on a
/// seeded database (tools/e2e-db.sh) and sets:
///   SINEOBEX_LIVE_API=http://localhost:8787  SINEOBEX_LIVE_IDP=http://localhost:8790
void main() {
  final apiUrl = Platform.environment['SINEOBEX_LIVE_API'];
  final idpUrl = Platform.environment['SINEOBEX_LIVE_IDP'];
  final skip = apiUrl == null || idpUrl == null ? 'set SINEOBEX_LIVE_API and SINEOBEX_LIVE_IDP to run' : null;
  // CI sets this, so a missing variable fails the job instead of passing it with nothing run.
  if (Platform.environment['SINEOBEX_LIVE_REQUIRED'] == '1' && skip != null) {
    test('the live API is configured', () => fail(skip));
    return;
  }

  // The made-up demo team and two of its clinicians (db/seed/seed.ts).
  const team = '0d3e6f00-0000-4000-8000-000000000001';
  final client = http.Client();
  final phones = <TestPhone>[];

  Future<({String userId, Tokens tokens})> signIn(String email) async {
    final auth = DevAuthProvider(url: Uri.parse(idpUrl!), client: client);
    final challenge = await auth.signIn(email, 'sineobex-demo') as MfaChallenge;
    final tokens = await auth.verifyMfa(challenge.tokens, challenge.factorId, '000000');
    final me = await HttpTransport(
      baseUrl: Uri.parse(apiUrl!),
      client: client,
      accessToken: () => tokens.accessToken,
    ).send('GET', '/v1/me');
    return (userId: ((me! as Map<String, Object?>)['user']! as Map<String, Object?>)['id']! as String, tokens: tokens);
  }

  Future<(TestPhone, _Network)> phone(String email) async {
    final who = await signIn(email);
    final network = _Network(
      HttpTransport(
        baseUrl: Uri.parse(apiUrl!),
        client: client,
        accessToken: () => who.tokens.accessToken,
        teamId: () => team,
      ),
    );
    final p = TestPhone(userId: who.userId, teamId: team, transport: () => network, realTime: DateTime.now);
    phones.add(p);
    return (p, network);
  }

  tearDownAll(() {
    for (final p in phones) {
      p.close();
    }
    client.close();
  });

  ({String encounter, String note}) chartVisit(TestPhone p) {
    final encounter = p.store.createEncounter(kind: 'medical', location: {'lat': 42.33, 'lng': -83.05});
    final note = p.store.createNote(encounterId: encounter, noteTypeKey: 'vitals', data: {'temp_c': 38.0});
    p.store.setField(note, 'data.pulse', 96);
    p.store.setField(note, 'data.temp_c', 38.4);
    p.store.appendAudit('patient.viewed', entity: 'patient', entityId: encounter);
    return (encounter: encounter, note: note);
  }

  Future<Map<String, Object?>> serverFields(TestPhone reader, String note) async {
    expect(await reader.engine.openServerRecord(entityNote, note), isTrue);
    return {for (final MapEntry(:key, :value) in reader.store.record(note)!.fields.entries) key: value.value};
  }

  test('the device key registers, and a Dart signature verifies in Node', () async {
    final (p, _) = await phone('clinician@example.com');
    expect(await p.engine.syncAll(), isA<SyncDone>());
    final status = await p.engine.signedStatus();
    expect(status!.status.wire, 'active');
    expect(status.access.wire, 'active');
  }, skip: skip);

  test('charting in airplane mode, then every change confirmed by hash and purged', () async {
    final (p, net) = await phone('clinician@example.com');
    final (reader, _) = await phone('resident@example.com');
    net.offline = true;
    final visit = chartVisit(p);
    expect(await p.engine.syncAll(), isA<SyncOffline>());
    p.store.closeRecord(visit.note);
    p.store.closeRecord(visit.encounter);
    net.offline = false;
    final done = await p.engine.syncAll(force: true) as SyncDone;
    expect(done.confirmed, 5);
    expect(p.store.outbox(), isEmpty);
    expect(p.store.record(visit.note), isNull);
    // 38.0 typed on the phone is 38 everywhere; the hashes matched or nothing would be confirmed.
    expect(await serverFields(reader, visit.note), containsPair('data.temp_c', 38.4));
  }, skip: skip);

  test('killing the app mid-sync: the committed batch is recovered by its receipts, applied once', () async {
    final (p, net) = await phone('clinician@example.com');
    final (reader, _) = await phone('resident@example.com');
    final visit = chartVisit(p);
    net.dropPushes = 1;
    expect(await p.engine.syncAll(), isA<SyncOffline>());
    expect(p.store.outbox(), hasLength(5));
    await p.restart();
    expect(await p.engine.syncAll(force: true), isA<SyncDone>());
    expect(p.store.outbox(), isEmpty);
    expect(reader.store.record(visit.note), isNull);
    await reader.engine.openServerRecord(entityNote, visit.note);
    expect(reader.store.record(visit.note)!.fields['data.temp_c']!.serverVersion, 2);
  }, skip: skip);

  test('two people editing the same draft: merge, side-by-side conflict, explicit choice', () async {
    final (a, _) = await phone('clinician@example.com');
    final (b, bNet) = await phone('resident@example.com');
    final visit = chartVisit(a);
    await a.engine.syncAll();
    await b.engine.openServerRecord(entityNote, visit.note);
    a.store.setField(visit.note, 'data.plan', '');
    a.store.setField(visit.note, 'data.temp_c', 38.6);
    await a.engine.syncAll(force: true);
    bNet.offline = true;
    b.store.setField(visit.note, 'data.temp_c', 39.0);
    b.store.setField(visit.note, 'data.plan', 'recheck Friday');
    b.store.setField(visit.note, 'data.allergies', 'penicillin');
    bNet.offline = false;
    final res = await b.engine.syncAll(force: true) as SyncDone;
    expect(res.conflicts, 1);
    final shown = b.store.needsAttention().single;
    expect([shown.field, shown.value, shown.server!.value], ['data.temp_c', 39.0, 38.6]);
    expect(b.store.resolveConflict(shown.changeId, keepMine: true), isTrue);
    await b.engine.syncAll(force: true);
    expect(b.store.outbox(), isEmpty);
    await a.engine.syncAll(force: true);
    final fields = a.store.record(visit.note)!.fields;
    expect(fields['data.temp_c']!.value, 39.0);
    expect(fields['data.plan']!.value, 'recheck Friday');
    expect(fields['data.allergies']!.value, 'penicillin');
  }, skip: skip);

  test('a 7-minute clock offset pauses charting; saved data still syncs; fixing the clock resumes', () async {
    final (p, _) = await phone('clinician@example.com');
    final visit = chartVisit(p);
    p.skew = const Duration(minutes: -7);
    await p.engine.syncAll();
    expect(p.clock.status.state, ClockState.off);
    expect(p.store.outbox(), isEmpty);
    expect(() => p.store.setField(visit.note, 'data.pulse', 100), throwsA(isA<ChartingPaused>()));
    p.skew = Duration.zero;
    expect((await p.clock.check()).state, ClockState.verified);
    p.store.setField(visit.note, 'data.pulse', 100);
    await p.engine.syncAll(force: true);
    expect(p.store.outbox(), isEmpty);
  }, skip: skip);

  test('a rejection waits with what depends on it, and the fix confirms both', () async {
    final (p, _) = await phone('clinician@example.com');
    // A note for an encounter the server doesn't have (deleted elsewhere, or a bad reference).
    final note = p.store.createNote(
      encounterId: '0d3e6f00-0000-4000-8000-0000000000ff',
      noteTypeKey: 'vitals',
      data: {'temp_c': 38.1},
    );
    p.store.setField(note, 'data.pulse', 88);
    // Sent in one batch, the edit is refused with its create; a later one would be held.
    final first = await p.engine.syncAll(force: true) as SyncDone;
    expect(first.rejected, 2);
    expect(p.store.needsAttention().map((e) => e.reason), everyElement('stale_reference'));
    p.store.setField(note, 'data.plan', 'fluids');
    expect(p.store.heldCount(), 1);
    final encounter = p.store.createEncounter(kind: 'medical');
    await p.engine.syncAll(force: true);
    final create = p.store.needsAttention().firstWhere((e) => e.op == 'create');
    p.store.fixRejected(create.changeId, {'encounterId': encounter, 'noteTypeKey': 'vitals'});
    expect(p.store.needsAttention(), isEmpty);
    await p.engine.syncAll(force: true);
    expect(p.store.outbox(), isEmpty);
    final (reader, _) = await phone('resident@example.com');
    expect(
      await serverFields(reader, note),
      allOf(containsPair('data.temp_c', 38.1), containsPair('data.pulse', 88), containsPair('data.plan', 'fluids')),
    );
  }, skip: skip);

  test('a refused note too large for one create is fixed as a create and edits sent with it', () async {
    final (p, _) = await phone('clinician@example.com');
    final note = p.store.createNote(encounterId: '0d3e6f00-0000-4000-8000-0000000000fe', noteTypeKey: 'vitals');
    final history = 'Demo history ${'h' * 40000}';
    final plan = 'Demo plan ${'p' * 30000}';
    p.store.setField(note, 'data.history', history);
    p.store.setField(note, 'data.plan', plan);
    final first = await p.engine.syncAll(force: true) as SyncDone;
    expect(first.rejected, 3);
    // Together the fields are over the API's 64 KiB for one value: one follows the fixed create
    // in the same push, as a field new to the note (version 0).
    final encounter = p.store.createEncounter(kind: 'medical');
    p.store.fixRejected(p.store.needsAttention().first.changeId, {'encounterId': encounter, 'noteTypeKey': 'vitals'});
    expect(p.store.sendable().map((e) => e.op), ['create', 'create', 'set']);
    final done = await p.engine.syncAll(force: true) as SyncDone;
    expect([done.confirmed, done.rejected, done.conflicts], [3, 0, 0]);
    expect(p.store.outbox(), isEmpty);
    final (reader, _) = await phone('resident@example.com');
    expect(
      await serverFields(reader, note),
      allOf(containsPair('data.history', history), containsPair('data.plan', plan)),
    );
  }, skip: skip);

  test('keeping the server’s value: a value that changed again since must be chosen again', () async {
    final (a, _) = await phone('clinician@example.com');
    final (b, _) = await phone('resident@example.com');
    final visit = chartVisit(a);
    await a.engine.syncAll();
    await b.engine.openServerRecord(entityNote, visit.note);
    a.store.setField(visit.note, 'data.temp_c', 38.6);
    await a.engine.syncAll(force: true);
    b.store.setField(visit.note, 'data.temp_c', 39.0);
    await b.engine.syncAll(force: true);
    final first = b.store.needsAttention().single;
    a.store.setField(visit.note, 'data.temp_c', 38.8);
    await a.engine.syncAll(force: true);
    // B keeps the 38.6 they saw; the server holds 38.8 now, so B is asked again.
    expect(b.store.resolveConflict(first.changeId, keepMine: false), isTrue);
    await b.engine.syncAll(force: true);
    final again = b.store.needsAttention().single;
    expect(again.server!.value, 38.8);
    expect(b.store.resolveConflict(again.changeId, keepMine: false), isTrue);
    await b.engine.syncAll(force: true);
    expect(b.store.outbox(), isEmpty);
    expect(b.store.record(visit.note)!.fields['data.temp_c']!.value, 38.8);
  }, skip: skip);

  test('numbers past 2^53 hash alike in Dart and TypeScript, so they are confirmed', () async {
    final (p, _) = await phone('clinician@example.com');
    final encounter = p.store.createEncounter(kind: 'medical');
    p.store.createNote(
      encounterId: encounter,
      noteTypeKey: 'vitals',
      data: {'big': 1152921504606846976.0, 'bigger': 123456789012345680000.0, 'tiny': 5e-324},
    );
    final done = await p.engine.syncAll(force: true) as SyncDone;
    expect([done.confirmed, done.unanswered], [2, 0]);
    expect(p.store.outbox(), isEmpty);
  }, skip: skip);

  test('a slow, flaky network: timeouts after commit and a damaged hash never confirm wrongly', () async {
    final (p, net) = await phone('clinician@example.com');
    chartVisit(p);
    final id = p.store.createEncounter(kind: 'non_medical');
    p.db.db.execute('UPDATE outbox SET value_hash = ? WHERE record_id = ?', ['0' * 64, id]);
    net
      ..dropPushes = 2
      ..delay = const Duration(milliseconds: 300);
    for (var i = 0; i < 3; i++) {
      await p.engine.syncAll(force: true);
    }
    // Everything else confirmed; the damaged one stays unconfirmed, never rejected or purged.
    expect(p.store.outbox().map((e) => e.recordId), [id]);
    expect(p.store.needsAttention(), isEmpty);
  }, skip: skip);
}

/// The real API behind a switchable network.
class _Network implements ApiTransport {
  _Network(this.inner);
  final ApiTransport inner;
  bool offline = false;
  int dropPushes = 0;
  Duration delay = Duration.zero;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) async {
    if (offline) throw const NetworkException('offline');
    if (delay > Duration.zero) await Future<void>.delayed(delay);
    final result = await inner.send(method, path, query: query, body: body);
    if (path == '/v1/sync/push' && dropPushes > 0) {
      dropPushes--;
      throw const NetworkException('timeout');
    }
    return result;
  }
}
