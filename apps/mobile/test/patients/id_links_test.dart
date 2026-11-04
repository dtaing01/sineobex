import 'package:flutter_test/flutter_test.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/patients/id_links.dart';
import 'package:sineobex_field/patients/patient_providers.dart';
import 'package:sineobex_field/sync/clock.dart';
import 'package:sineobex_field/sync/local_store.dart';
import 'package:sineobex_field/sync/sync_controller.dart';

import '../sync/fake_server.dart';
import '../sync/phone_harness.dart';

/// Street Medicine ID cards on the phone (design 10.4, 10.5, tests 13.5) against the fake's
/// handshake: a card made offline works at once and blocks the group's others; both outcomes of
/// the handshake; a refused card stays unusable; two cards after a merge; copying.
void main() {
  const team = '5a1f0c2e-8b7d-4e6a-9c3b-1d2e3f4a5b6c';
  const alex = 'a0000000-0000-4000-8000-00000000000a';
  const blair = 'b0000000-0000-4000-8000-00000000000b';
  const base = 'http://localhost:3100';
  final start = DateTime.utc(2026, 10, 22, 15);

  late DateTime serverTime;
  late FakeSyncServer server;
  final phones = <_Phone>[];

  _Phone phone(String user) {
    final p = _Phone(server, user, team, start);
    phones.add(p);
    return p;
  }

  setUp(() {
    serverTime = start;
    server = FakeSyncServer(now: () => serverTime);
  });
  tearDown(() {
    for (final p in phones) {
      p.phone.close();
    }
    phones.clear();
  });

  String seedCard(String patientId) {
    final id = '1d1d0000-0000-4000-8000-${(server.idLinks.length + 1).toString().padLeft(12, '0')}';
    server.seed(entityIdLink, {
      'patientId': patientId,
      'token': newIdLinkToken(),
      'replacesLinkId': null,
      'reason': 'first_card',
    }, id: id);
    return id;
  }

  test('a card made offline works here at once, and blocks the group’s other cards here', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    final old = seedCard(p);
    await a.services.patients.open(p);
    expect(a.services.idLinks.workingCards(p).single.id, old);
    server.offline = true;
    final card = a.services.idLinks.makeCard(p, reason: 'lost');
    final cards = {for (final c in a.services.idLinks.cards(p)) c.id: c};
    expect(cards[card]!.state, IdCardState.pending);
    expect(cards[card]!.copyable, isTrue);
    expect(cards[card]!.replaces, old);
    expect(cards[old]!.state, IdCardState.blocked);
    expect(cards[old]!.copyable, isFalse);
    final create = a.phone.store.outbox().last;
    expect((create.value! as Map<String, Object?>)['replacesLinkId'], old);
    expect(await a.services.idLinks.copy(card), CopyOutcome.copied);
    expect(a.copied.single, startsWith('$base/c#'));
    expect(isIdLinkToken(a.copied.single.split('#').last), isTrue);
  });

  test('the handshake: my card wins and retires the old one', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    final old = seedCard(p);
    await a.services.patients.open(p);
    final card = a.services.idLinks.makeCard(p, reason: 'damaged');
    await a.phone.engine.syncAll();
    final cards = {for (final c in a.services.idLinks.cards(p)) c.id: c.state};
    expect(cards, {card: IdCardState.active, old: IdCardState.retired});
    expect(server.idLinks[old]!.status, 'retired');
  });

  test('the handshake: a newer card made elsewhere wins; mine is retired and I am told', () async {
    final a = phone(alex), b = phone(blair);
    final p = server.seedPatient(preferredName: 'Del');
    final old = seedCard(p);
    await a.services.patients.open(p);
    await b.services.patients.open(p);
    server.offline = true;
    final mine = a.services.idLinks.makeCard(p, reason: 'lost');
    a.phone.advance(const Duration(minutes: 1));
    b.phone.advance(const Duration(minutes: 2));
    final theirs = b.services.idLinks.makeCard(p, reason: 'lost');
    server.offline = false;
    await b.phone.engine.syncAll(force: true);
    await a.phone.engine.syncAll(force: true);
    final cards = {for (final c in a.services.idLinks.cards(p)) c.id: c.state};
    expect(cards, {mine: IdCardState.retired, theirs: IdCardState.active, old: IdCardState.retired});
    expect(a.phone.store.notices().where((n) => n.kind == noticeCardSuperseded).single.recordId, mine);
    expect(await a.services.idLinks.copy(mine), CopyOutcome.notCopyable);
    // The valid card's link reaches this phone with the next chart download.
    await a.services.charts.open(p);
    expect(await a.services.idLinks.copy(theirs), CopyOutcome.copied);
  });

  test('a card for a merged patient is refused and unusable; a new card on the kept chart fixes it', () async {
    final a = phone(alex);
    final kept = server.seedPatient(preferredName: 'Del');
    final merged = server.seedPatient(preferredName: 'Delly');
    final old = seedCard(merged);
    await a.services.patients.open(merged);
    server.offline = true;
    final card = a.services.idLinks.makeCard(merged, reason: 'lost');
    server.merge(merged, kept);
    server.offline = false;
    await a.phone.engine.syncAll(force: true);
    final refused = a.phone.store.needsAttention().single;
    expect([refused.reason, refused.details?['problem']], ['stale_reference', 'patient_merged']);
    final cards = {for (final c in a.services.idLinks.cards(merged)) c.id: c};
    expect(cards[card]!.state, IdCardState.rejected);
    expect(cards[card]!.copyable, isFalse);
    expect(cards[old]!.state, IdCardState.blocked);
    expect(await a.services.idLinks.copy(card), CopyOutcome.notCopyable);

    // The phone learns the merge, and the fix is a card on the kept chart.
    await a.services.charts.open(merged);
    final fixed = a.services.idLinks.replaceRejected(refused.changeId, reason: 'lost');
    expect((a.phone.store.outbox().last.value! as Map<String, Object?>)['patientId'], kept);
    await a.phone.engine.syncAll(force: true);
    expect(a.phone.store.outbox(), isEmpty);
    expect(server.idLinks[fixed]!.status, 'active');
    expect(server.idLinks[old]!.status, 'retired');
    expect(a.services.idLinks.workingCards(kept).single.id, fixed);
  });

  test('two cards after a merge both open the combined chart and both copy (D39)', () async {
    final a = phone(alex);
    final kept = server.seedPatient(preferredName: 'Del');
    final merged = server.seedPatient(preferredName: 'Delly');
    final one = seedCard(kept), two = seedCard(merged);
    server.merge(merged, kept);
    await a.services.patients.open(kept);
    final working = a.services.idLinks.workingCards(kept);
    expect(working.map((c) => c.id).toSet(), {one, two});
    expect(working.every((c) => c.copyable), isTrue);
    // A new card stops both.
    a.services.idLinks.makeCard(kept, reason: 'patient_request');
    expect(a.services.idLinks.cards(kept).where((c) => c.state == IdCardState.blocked), hasLength(2));
    await a.phone.engine.syncAll();
    expect([server.idLinks[one]!.status, server.idLinks[two]!.status], ['retired', 'retired']);
    expect(a.services.idLinks.workingCards(kept), hasLength(1));
  });

  test('copy logs first, never the token, and says when it can’t copy', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    await a.services.patients.open(p);
    final card = a.services.idLinks.makeCard(p, reason: 'first_card');
    await a.services.idLinks.copy(card);
    final logged = a.phone.store.outbox().last.value! as Map<String, Object?>;
    expect(logged, {'action': 'id_link.copied', 'entity': 'id_link', 'entityId': card, 'patientId': p});
    a.refuse = true;
    expect(await a.services.idLinks.copy(card), CopyOutcome.failed);
    a.phone.store.setKv('idLinks.baseUrl', '');
    expect(await a.services.idLinks.copy(card), CopyOutcome.unknownBase);
    IdLinks.rememberBaseUrl(a.phone.store, base);
    a.phone.store.freeze('Your access to this team ended.');
    a.refuse = false;
    final copies = a.copied.length;
    await expectLater(a.services.idLinks.copy(card), throwsA(isA<ChartingPaused>()));
    expect(a.copied, hasLength(copies));
  });

  test('a card waits for the clock: none is made while charting is paused', () async {
    final a = phone(alex);
    final p = server.seedPatient(preferredName: 'Del');
    await a.services.patients.open(p);
    // A push gives the phone its clock reference; then its own clock drifts 7 minutes.
    await a.phone.engine.syncAll();
    a.phone.skewClock(const Duration(minutes: 7));
    await a.phone.clock.check();
    expect(a.phone.clock.status.state, ClockState.off);
    expect(() => a.services.idLinks.makeCard(p, reason: 'first_card'), throwsA(isA<ChartingPaused>()));
    expect(a.services.idLinks.cards(p), isEmpty);
  });
}

/// One phone with its patient services and a clipboard the test reads.
class _Phone {
  _Phone(FakeSyncServer server, String user, String team, DateTime start)
    : phone = TestPhone(userId: user, teamId: team, transport: () => server.transportFor(user, team), wall: start) {
    services = PatientServices(
      OpenTeam(
        userId: user,
        teamId: team,
        store: phone.store,
        api: phone.engine.api,
        clock: phone.clock,
        permissions: FakeSyncServer.healthcareStaff.toList(),
      ),
      idLinkBaseUrl: 'http://localhost:3100',
      copy: (text) async {
        if (refuse) return false;
        copied.add(text);
        return true;
      },
      wallNow: () => phone.wall,
    );
    phone.engine.refreshers.addAll(services.refreshers);
  }

  final TestPhone phone;
  late final PatientServices services;
  final copied = <String>[];
  bool refuse = false;
}

extension on TestPhone {
  /// The phone's own clock moved off by [d] (the server's time doesn't move).
  void skewClock(Duration d) => wall = wall.add(d);
}
