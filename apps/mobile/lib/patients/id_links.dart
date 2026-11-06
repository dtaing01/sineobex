import 'dart:convert';
import 'dart:math';

import 'package:sqlite3/sqlite3.dart' show Row;

import '../api/generated/api.dart' show IdLinkSummary, IndexEntryIdLinksItem, IdLinkStatus;
import '../security/secure_copy.dart';
import '../sync/entities.dart' show idLinkReasons;
import '../sync/local_store.dart';
import 'chart_cache.dart' show patientGroup;
import 'id_link_token.dart';

/// Street Medicine ID cards on the phone (design 10.4, 10.5; D31, D39).
///
/// The phone makes a card the same way online or offline: an `id_link` sync create, which confirms
/// within seconds when there is signal. Making one blocks, here and at once, every card of the
/// patient's group this phone knows (the new card works on this phone straight away; other phones
/// keep the old ones until they refresh). The server's handshake decides which card stays when two
/// were made: the receipt says `linkOutcome` `active` or `retired`, with the winner and every card
/// it retired, and this file applies that inside the confirmation's transaction.
///
/// Tokens are on the phone only for cards made here and in cached charts for `patients.edit`, and
/// go with the chart (the store's purge deletes this table's rows of a chart it removes). The index
/// carries card IDs only, so a lost phone can't print anyone's card.

/// The states of design 10.5.
enum IdCardState {
  /// Made here, not confirmed yet. Works on this phone now.
  pending,

  /// Confirmed, or downloaded with a chart.
  active,

  /// Lost to another card, or replaced.
  retired,

  /// An older card this phone replaced, until the handshake settles it.
  blocked,

  /// Refused by the server: never copyable. The fix is a new card ([IdLinks.replaceRejected]).
  rejected,
}

/// One card, as this phone knows it. Never holds the token: [IdLinks.copy] puts the link on the
/// clipboard without the screen ever reading it.
class IdCard {
  const IdCard({
    required this.id,
    required this.issuedOn,
    required this.state,
    required this.effectiveAt,
    required this.madeHere,
    required this.copyable,
    required this.inReview,
    this.changeId,
    this.replaces,
  });

  final String id;

  /// The patient record the card was issued on (a merged record's card opens the combined chart).
  final String issuedOn;
  final IdCardState state;
  final DateTime? effectiveAt;

  /// Made on this phone (its change is or was in the outbox).
  final bool madeHere;

  /// Copy link works: the phone holds the token and the card is pending or active.
  final bool copyable;

  /// Held by the server for a Program Admin (made without patients.edit).
  final bool inReview;

  /// The card's create, while it is in the outbox (for Needs attention).
  final String? changeId;
  final String? replaces;

  /// Opens the chart, as far as this phone knows.
  bool get working => state == IdCardState.pending || state == IdCardState.active;
}

/// How a copy went.
enum CopyOutcome {
  copied,

  /// The platform refused, or has no secure clipboard (nothing was copied).
  failed,

  /// No token here, or the card doesn't work any more.
  notCopyable,

  /// The phone doesn't know yet where links point (it learns at the next connection).
  unknownBase,
}

/// "Another new card was made after yours; that card is the valid one" (design 10.4, step 6).
const noticeCardSuperseded = 'id_link_superseded';

/// Why a card is made (`IdLinkCreate.reason`): the chips of design 10.4.
const cardReasons = idLinkReasons;

/// Cards on this phone, for one team's store.
class IdLinks {
  IdLinks(this.store, {this._copy = secureCopy, DateTime Function()? now, this._random}) : _now = now ?? DateTime.now;

  final LocalStore store;
  final SecureCopy _copy;
  final DateTime Function() _now;

  /// Tests only: anything but [Random.secure] would make tokens guessable.
  final Random? _random;

  static const _baseKey = 'idLinks.baseUrl';

  /// Where card links point: `/v1/me` `idLinkBaseUrl`, kept in the team's database so a card made
  /// offline, after a restart, carries the same URL the portal shows.
  static String? baseUrlOf(LocalStore store) {
    final v = store.kv(_baseKey);
    return v == null || v.isEmpty ? null : v;
  }

  static void rememberBaseUrl(LocalStore store, String url) {
    if (url.isNotEmpty && baseUrlOf(store) != url) store.setKv(_baseKey, url);
  }

  /// Registers the receipt hook. Called once per store.
  void install() => store.onConfirmed.add(_onConfirmed);

  // ---- reading ----

  List<Row> _rows(Iterable<String> patientIds) {
    final ids = patientIds.toList();
    if (ids.isEmpty) return const [];
    return store.database.select(
      'SELECT * FROM id_links WHERE patient_id IN (${List.filled(ids.length, '?').join(', ')}) '
      'ORDER BY coalesce(effective_at, 0) DESC, id',
      ids,
    );
  }

  IdCard _card(Row r) {
    final changeId = r['change_id'] as String?;
    final entry = changeId == null ? null : store.entry(changeId);
    var state = IdCardState.values.byName(r['state'] as String);
    // A refusal arrives as a rejected outbox entry; the card shows it until a new card replaces it.
    if (state == IdCardState.pending &&
        entry != null &&
        (entry.state == ChangeState.rejected || entry.state == ChangeState.superseded)) {
      state = IdCardState.rejected;
    }
    final inReview =
        changeId != null &&
        store.database.select('SELECT 1 FROM in_review WHERE change_id = ?', [changeId]).isNotEmpty &&
        state == IdCardState.pending;
    return IdCard(
      id: r['id'] as String,
      issuedOn: r['patient_id'] as String,
      state: state,
      effectiveAt: r['effective_at'] == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(r['effective_at'] as int, isUtc: true),
      madeHere: changeId != null,
      copyable: r['token'] != null && (state == IdCardState.pending || state == IdCardState.active),
      inReview: inReview,
      changeId: entry == null ? null : changeId,
      replaces: r['replaces'] as String?,
    );
  }

  /// Every card of [patientId]'s group this phone knows, newest first.
  List<IdCard> cards(String patientId) => [for (final r in _rows(patientGroup(store, patientId))) _card(r)];

  /// The cards that open the chart now, as far as this phone knows: usually one; two after a merge
  /// until the next new card (D39).
  List<IdCard> workingCards(String patientId) => [
    for (final c in cards(patientId))
      if (c.working) c,
  ];

  // ---- making a card ----

  /// The newest card this phone sees working for the group: what a new card replaces
  /// (`replacesLinkId`), or null when it sees none.
  String? _replaces(Set<String> group) {
    final working = [
      for (final r in _rows(group))
        if (r['state'] == 'active' || r['state'] == 'pending') r,
    ];
    return working.isEmpty ? null : working.first['id'] as String;
  }

  /// Makes a new card (design 10.4, step 3) for [patientId]'s group, with [reason] (one of
  /// [cardReasons]; `first_card` for the first). In one transaction: the token, the sync create
  /// naming the newest card it replaces, the pending card, and every working card of the group
  /// blocked here. The new card can be copied at once. Throws [ChartingPaused] while the clock
  /// check fails (D35: card conflicts are decided by device time).
  String makeCard(String patientId, {required String reason}) {
    if (!cardReasons.contains(reason)) throw ArgumentError('unknown card reason');
    final canonical = store.canonicalPatient(patientId);
    final group = patientGroup(store, canonical);
    final token = newIdLinkToken(_random);
    return store.transaction(() {
      final replaces = _replaces(group);
      final linkId = store.createRecord(entityIdLink, {
        'patientId': canonical,
        'token': token,
        'replacesLinkId': replaces,
        'reason': reason,
      });
      final changeId = store.outbox().lastWhere((e) => e.recordId == linkId && e.op == 'create').changeId;
      final ids = group.toList();
      store.database
        ..execute(
          "UPDATE id_links SET state = 'blocked', updated_at = ? WHERE state IN ('active', 'pending') "
          'AND patient_id IN (${List.filled(ids.length, '?').join(', ')})',
          [_nowMs, ...ids],
        )
        ..execute(
          'INSERT INTO id_links (id, patient_id, token, state, replaces, change_id, effective_at, updated_at) '
          "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
          [linkId, canonical, token, replaces, changeId, _nowMs, _nowMs],
        );
      return linkId;
    });
  }

  /// "Make a new card" on a refused card (design 10.4, Rejections): a new card for the patient's
  /// chart as it stands now (a merged patient's survivor), sent as the fix of the refused create.
  /// The refused card stays unusable.
  String replaceRejected(String changeId, {required String reason}) {
    final refused = store.entry(changeId);
    if (refused == null || refused.entity != entityIdLink || refused.op != 'create') {
      throw StateError('not a card');
    }
    if (!cardReasons.contains(reason)) throw ArgumentError('unknown card reason');
    final value = refused.value! as Map<String, Object?>;
    final canonical = store.canonicalPatient(value['patientId']! as String);
    final group = patientGroup(store, canonical);
    final token = newIdLinkToken(_random);
    return store.transaction(() {
      final replaces = _replaces(group);
      final linkId = store.replaceRejected(
        changeId,
        entity: entityIdLink,
        value: {'patientId': canonical, 'token': token, 'replacesLinkId': replaces, 'reason': reason},
      );
      final fix = store.outbox().lastWhere((e) => e.recordId == linkId && e.op == 'create').changeId;
      final ids = group.toList();
      store.database
        ..execute("UPDATE id_links SET state = 'rejected', updated_at = ? WHERE id = ?", [_nowMs, refused.recordId])
        ..execute(
          "UPDATE id_links SET state = 'blocked', updated_at = ? WHERE state IN ('active', 'pending') "
          'AND patient_id IN (${List.filled(ids.length, '?').join(', ')})',
          [_nowMs, ...ids],
        )
        ..execute(
          'INSERT INTO id_links (id, patient_id, token, state, replaces, change_id, effective_at, updated_at) '
          "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
          [linkId, canonical, token, replaces, fix, _nowMs, _nowMs],
        );
      return linkId;
    });
  }

  int get _nowMs => _now().toUtc().millisecondsSinceEpoch;

  // ---- copying ----

  /// Copy link (design 10.4, step 4): appends `id_link.copied` (the card's ID, never the token),
  /// then puts `{base}/c#<token>` on the clipboard through [secureCopy]. What can't be logged isn't
  /// copied: a frozen store throws [ChartingPaused] before anything reaches the clipboard.
  Future<CopyOutcome> copy(String linkId) async {
    final row = store.database.select('SELECT * FROM id_links WHERE id = ?', [linkId]).firstOrNull;
    if (row == null) return CopyOutcome.notCopyable;
    final card = _card(row);
    final token = row['token'] as String?;
    if (!card.copyable || token == null) return CopyOutcome.notCopyable;
    final base = baseUrlOf(store);
    if (base == null) return CopyOutcome.unknownBase;
    store.transaction(
      () => store.appendAudit(
        'id_link.copied',
        entity: entityIdLink,
        entityId: linkId,
        patientId: store.canonicalPatient(card.issuedOn),
      ),
    );
    return await _copy(idLinkUrl(base, token)) ? CopyOutcome.copied : CopyOutcome.failed;
  }

  // ---- receipts ----

  /// The handshake's answer (design 10.4, step 6), in the confirmation's transaction: the card made
  /// here is active or retired, the winner is active, and every card the server retired is retired
  /// here. A card that lost tells its maker.
  void _onConfirmed(OutboxEntry e, AcceptedReceipt receipt) {
    if (e.entity != entityIdLink || e.op != 'create' || receipt.inReview) return;
    final db = store.database;
    final mine = e.recordId;
    final value = e.value! as Map<String, Object?>;
    final group = patientGroup(store, value['patientId']! as String).toList();
    final d = receipt.details ?? const {};
    final won = d['linkOutcome'] != 'retired';
    final winner = won ? mine : d['activeLinkId'] as String?;
    final retired = [...?(d['retiredLinkIds'] as List<Object?>?)?.cast<String>()];
    for (final id in retired) {
      db.execute("UPDATE id_links SET state = 'retired', updated_at = ? WHERE id = ?", [_nowMs, id]);
    }
    // A newer card made here since still blocks this one until its own receipt.
    final newer = db.select(
      "SELECT 1 FROM id_links WHERE state = 'pending' AND id <> ? AND coalesce(effective_at, 0) >= "
      '(SELECT coalesce(effective_at, 0) FROM id_links WHERE id = ?) '
      'AND patient_id IN (${List.filled(group.length, '?').join(', ')})',
      [mine, mine, ...group],
    ).isNotEmpty;
    db.execute('UPDATE id_links SET state = ?, updated_at = ? WHERE id = ?', [
      won ? (newer ? 'blocked' : 'active') : 'retired',
      _nowMs,
      mine,
    ]);
    if (!won && winner != null) {
      final exists = db.select('SELECT 1 FROM id_links WHERE id = ?', [winner]).isNotEmpty;
      if (exists) {
        db.execute('UPDATE id_links SET state = ?, updated_at = ? WHERE id = ?', [
          newer ? 'blocked' : 'active',
          _nowMs,
          winner,
        ]);
      } else {
        db.execute('INSERT INTO id_links (id, patient_id, state, updated_at) VALUES (?, ?, ?, ?)', [
          winner,
          store.canonicalPatient(value['patientId']! as String),
          newer ? 'blocked' : 'active',
          _nowMs,
        ]);
      }
      store.addNotice(noticeCardSuperseded, patientId: value['patientId'] as String?, recordId: mine);
    }
    // Every other card this phone had blocked for the group is no longer active on the server: the
    // winner retired it, or it was retired before.
    db.execute(
      "UPDATE id_links SET state = 'retired', updated_at = ? WHERE state = 'blocked' AND id NOT IN (?, ?) "
      'AND patient_id IN (${List.filled(group.length, '?').join(', ')})${newer ? ' AND 0' : ''}',
      [_nowMs, mine, winner ?? mine, ...group],
    );
  }

  // ---- what charts and the index say ----

  /// The token in a card link's fragment, if it is one.
  static String? tokenOf(String url) {
    final i = url.indexOf('/c#');
    if (i < 0) return null;
    final token = url.substring(i + 3);
    return isIdLinkToken(token) ? token : null;
  }

  /// A downloaded chart's active cards (design 7.1): the server's list for the group. A card it no
  /// longer lists was retired elsewhere; a card this phone blocked stays blocked while the new card
  /// made here is still pending. Tokens come with the link (patients.edit only).
  static void importChartLinks(LocalStore store, String canonical, List<IdLinkSummary> links) {
    final cards = [
      for (final l in links)
        if (l.status == IdLinkStatus.active)
          (id: l.id, issuedOn: l.issuedOn, effectiveAt: l.effectiveAt, token: l.url == null ? null : tokenOf(l.url!)),
    ];
    _importActive(store, canonical, cards);
  }

  /// An index entry's active card IDs (no tokens), when it is opened as a partial copy.
  static void importIndexLinks(LocalStore store, String canonical, List<IndexEntryIdLinksItem> links) => _importActive(
    store,
    canonical,
    [for (final l in links) (id: l.id, issuedOn: canonical, effectiveAt: l.effectiveAt, token: null)],
  );

  static void _importActive(
    LocalStore store,
    String canonical,
    List<({String id, String issuedOn, DateTime effectiveAt, String? token})> active,
  ) {
    final db = store.database;
    final now = DateTime.now().toUtc().millisecondsSinceEpoch;
    final group = patientGroup(store, canonical).toList();
    final inGroup = 'patient_id IN (${List.filled(group.length, '?').join(', ')})';
    store.transaction(() {
      final madeHere = db.select("SELECT 1 FROM id_links WHERE state = 'pending' AND $inGroup", group).isNotEmpty;
      final listed = {for (final c in active) c.id};
      for (final c in active) {
        final row = db.select('SELECT state FROM id_links WHERE id = ?', [c.id]).firstOrNull;
        final state = madeHere && (row == null || row['state'] == 'blocked') ? 'blocked' : 'active';
        if (row == null) {
          db.execute(
            'INSERT INTO id_links (id, patient_id, token, state, effective_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [c.id, c.issuedOn, c.token, state, c.effectiveAt.toUtc().millisecondsSinceEpoch, now],
          );
        } else if (row['state'] != 'pending') {
          db.execute(
            'UPDATE id_links SET state = ?, token = coalesce(?, token), effective_at = ?, updated_at = ? WHERE id = ?',
            [state, c.token, c.effectiveAt.toUtc().millisecondsSinceEpoch, now, c.id],
          );
        }
      }
      for (final r in db.select("SELECT id FROM id_links WHERE state IN ('active', 'blocked') AND $inGroup", group)) {
        if (!listed.contains(r['id'])) {
          db.execute("UPDATE id_links SET state = 'retired', updated_at = ? WHERE id = ?", [now, r['id']]);
        }
      }
    });
  }

  /// The card IDs an index entry lists for [patientId] (for a patient this phone has no rows for).
  static List<String> indexLinkIds(LocalStore store, String patientId) {
    final row = store.database.select('SELECT entry_json FROM team_index WHERE patient_id = ?', [
      store.canonicalPatient(patientId),
    ]).firstOrNull;
    if (row == null) return const [];
    final links = (jsonDecode(row['entry_json'] as String) as Map<String, Object?>)['idLinks'] as List<Object?>?;
    return [for (final l in links ?? const []) (l! as Map<String, Object?>)['id']! as String];
  }
}
