import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

import '../api/generated/api.dart' show ProblemNoteView, ProblemStatusEvent;
import '../sync/entities.dart' show icd10cmCode, problemStatusRank;
import '../sync/local_store.dart';
import 'access.dart';
import 'chart_cache.dart';
import 'generated/sensitive_codes.dart';

/// The problem list (design section 9): New, Ongoing, Resolved. Only New and Ongoing count toward
/// the bag check (phases 6–7). On the phone a problem moves only forward; Resolved back to Ongoing
/// is a Program Admin's (9.4), which the phone asks for with a new entry. Title and code never
/// change after creation: a wrong one is marked entered in error and added again.
///
/// Seeing problems needs `mayViewProblems`; adding, moving, notes and entered in error need
/// `encounters.chart` (the server holds the change for review otherwise), and entered in error also
/// the author or `patients.reverse_resolved`.

/// One status change, as the history shows it.
class ProblemEvent {
  const ProblemEvent({
    required this.status,
    required this.at,
    required this.byName,
    required this.kind,
    this.encounterId,
  });
  final String status;
  final DateTime at;
  final String byName;

  /// The history kind (`created`, `set`, `confirmed`, `kept_both`, ...).
  final String kind;
  final String? encounterId;
}

/// A note on a problem, newest first in the timeline.
class ProblemNote {
  const ProblemNote({
    required this.id,
    required this.text,
    required this.writtenAt,
    required this.authorName,
    required this.pending,
    this.encounterId,
  });
  final String id;
  final String text;
  final DateTime? writtenAt;

  /// The author's name, or null for a note made on this phone.
  final String? authorName;
  final String? encounterId;

  /// Not synced yet.
  final bool pending;
}

/// An ICD-10-CM code as a problem carries it.
typedef ProblemCodeValue = ({String system, String code, String? display});

/// One problem as the profile shows it.
class ProblemView {
  const ProblemView({
    required this.id,
    required this.patientId,
    required this.title,
    required this.code,
    required this.sensitive,
    required this.status,
    required this.onsetDate,
    required this.recurrenceOf,
    required this.resolvedInErrorOf,
    required this.reversalRequest,
    required this.enteredInError,
    required this.notSynced,
    required this.statusPending,
    required this.statusCheckedAt,
    required this.history,
    required this.notes,
  });

  final String id;
  final String patientId;
  final String title;
  final ProblemCodeValue? code;
  final bool sensitive;

  /// `new`, `ongoing` or `resolved`.
  final String status;
  final String? onsetDate;

  /// A new episode of this earlier problem ("Came back · earlier episode resolved Mar 3").
  final String? recurrenceOf;

  /// A request to reverse this Resolved problem (9.4).
  final String? resolvedInErrorOf;

  /// `open`, `reversed` or `declined` on a request; null otherwise.
  final String? reversalRequest;

  /// The reason, when the whole problem was marked entered in error: hidden from lists, kept in
  /// history.
  final String? enteredInError;

  /// Made on this phone, not synced yet.
  final bool notSynced;

  /// A status change made here waits to sync.
  final bool statusPending;
  final DateTime? statusCheckedAt;
  final List<ProblemEvent> history;
  final List<ProblemNote> notes;

  /// Counts toward the bag check (phases 6–7) and is listed first.
  bool get open => status == 'new' || status == 'ongoing';

  /// "No code: won't add supplies to route bags".
  bool get hasCode => code != null;

  /// The moves the phone offers (9.1): forward only. Resolved offers none; Still has this? asks
  /// for a new entry instead.
  List<String> get moves => switch (status) {
    'new' => const ['ongoing', 'resolved'],
    'ongoing' => const ['resolved'],
    _ => const [],
  };
}

/// Problems for one team's store.
class Problems {
  Problems(this.store, {required this.permissions});

  final LocalStore store;
  final List<String> permissions;

  bool get mayView => mayViewProblems(permissions);
  bool get mayChart => permissions.contains('encounters.chart');
  bool get maySeeSensitive => permissions.contains('patients.view_sensitive');

  /// The group's problems this phone holds, New and Ongoing first, then Resolved; null when the role
  /// doesn't see the problem list (the section is hidden, D37). Entered in error and merged entries
  /// are left out ([includeRetracted] keeps the first, for history).
  List<ProblemView>? problemsOf(String patientId, {bool includeRetracted = false}) {
    if (!mayView) return null;
    final canonical = store.canonicalPatient(patientId);
    final meta = chartMetaOf(store, canonical);
    final listed = meta?.problemIds?.toSet();
    final out = <ProblemView>[];
    for (final p in patientGroup(store, canonical)) {
      for (final id in store.recordIdsOfPatient(p)) {
        final rec = store.record(id);
        if (rec == null || rec.entity != entityProblem) continue;
        // The chart lists the group's problems; a server copy it no longer lists was merged into
        // another entry or left the group (a merge undone). Work made here shows until it is listed.
        if (listed != null && !listed.contains(id) && rec.origin != 'local') continue;
        final view = _view(rec, meta);
        if (rec.attributes['mergedInto'] != null) continue;
        if (view.enteredInError != null && !includeRetracted) continue;
        if (view.sensitive && !maySeeSensitive) continue;
        out.add(view);
      }
    }
    out.sort((a, b) {
      if (a.open != b.open) return a.open ? -1 : 1;
      return a.title.compareTo(b.title);
    });
    return out;
  }

  ProblemView? problem(String problemId) {
    final rec = store.record(problemId);
    if (rec == null || rec.entity != entityProblem || !mayView) return null;
    return _view(rec, chartMetaOf(store, store.canonicalPatient(rec.patientId ?? '')));
  }

  ProblemView _view(LocalRecord rec, ChartMeta? meta) {
    final a = rec.attributes;
    final status = rec.fields['status'];
    final statusValue = status?.value is Map<String, Object?> ? status!.value! as Map<String, Object?> : null;
    final code = a['code'] is Map<String, Object?> ? a['code']! as Map<String, Object?> : null;
    final retraction = rec.fields['enteredInError']?.value;
    final pendingCreate = store.outbox().any((e) => e.recordId == rec.id && e.op == 'create');
    final serverNotes = [
      for (final n in meta?.problemNotes ?? const <ProblemNoteView>[])
        if (n.problemId == rec.id)
          ProblemNote(
            id: n.id,
            text: n.text,
            writtenAt: n.writtenAt,
            authorName: n.author.displayName,
            encounterId: n.encounterId,
            pending: false,
          ),
    ];
    final known = {for (final n in serverNotes) n.id};
    final localNotes = <ProblemNote>[];
    for (final p in patientGroup(store, rec.patientId ?? rec.id)) {
      for (final id in store.recordIdsOfPatient(p)) {
        if (known.contains(id)) continue;
        final n = store.record(id);
        if (n == null || n.entity != entityProblemNote || n.attributes['problemId'] != rec.id) continue;
        localNotes.add(
          ProblemNote(
            id: id,
            text: n.attributes['text'] as String? ?? '',
            writtenAt: null,
            authorName: null,
            encounterId: n.attributes['encounterId'] as String?,
            pending: store.outbox().any((e) => e.recordId == id),
          ),
        );
      }
    }
    final checked = a['statusCheckedAt'];
    return ProblemView(
      id: rec.id,
      patientId: rec.patientId ?? '',
      title: a['title'] as String? ?? '',
      code: code == null
          ? null
          : (
              system: code['system'] as String? ?? 'icd10cm',
              code: code['code']! as String,
              display: code['display'] as String?,
            ),
      sensitive: a['sensitive'] == true,
      status: statusValue?['status'] as String? ?? rec.status,
      onsetDate: a['onsetDate'] as String?,
      recurrenceOf: a['recurrenceOf'] as String?,
      resolvedInErrorOf: a['resolvedInErrorOf'] as String?,
      reversalRequest: a['reversalRequest'] as String?,
      enteredInError: retraction is Map<String, Object?> ? retraction['reason'] as String? : null,
      notSynced: pendingCreate,
      statusPending: status?.pendingChange != null && !pendingCreate,
      statusCheckedAt: checked is String ? DateTime.parse(checked) : null,
      history: [
        for (final e in meta?.problemHistory ?? const <ProblemStatusEvent>[])
          if (e.problemId == rec.id)
            ProblemEvent(
              status: e.status.wire,
              at: e.at,
              byName: e.by.displayName,
              kind: e.kind.wire,
              encounterId: e.encounterId,
            ),
      ]..sort((x, y) => y.at.compareTo(x.at)),
      notes: [...localNotes, ...serverNotes..sort((x, y) => y.writtenAt!.compareTo(x.writtenAt!))],
    );
  }

  // ---- changes ----

  /// **Add problem** (design 9.5): a title, an optional code, New or Ongoing (Resolved is not offered
  /// at creation), an optional onset date, and Sensitive (on for sensitive codes: the phone turns it
  /// on, and the screen locks it). Returns the problem's ID.
  String add(
    String patientId, {
    required String title,
    ProblemCodeValue? code,
    required String status,
    bool sensitive = false,
    String? onsetDate,
    String? recurrenceOf,
    String? resolvedInErrorOf,
  }) {
    if (status != 'new' && status != 'ongoing') {
      throw const LocalValidationError('Choose New or Ongoing.', paths: {'status'});
    }
    return store.createRecord(entityProblem, {
      'patientId': store.canonicalPatient(patientId),
      'title': title.trim(),
      if (code != null)
        'code': {'system': code.system, 'code': code.code, if (code.display != null) 'display': code.display!.trim()},
      'status': status,
      'sensitive': sensitive || (code != null && isSensitiveCode(code.code)),
      'onsetDate': ?onsetDate,
      'recurrenceOf': ?recurrenceOf,
      'resolvedInErrorOf': ?resolvedInErrorOf,
    });
  }

  /// Moves a problem forward (New → Ongoing, New or Ongoing → Resolved). The screen asks once before
  /// Resolved. Backward moves are refused here as the server would ([LocalValidationError] with
  /// `resolved_needs_admin` or `status_backwards`).
  void move(String problemId, String to, {String? encounterId}) {
    final p = problem(problemId) ?? (throw StateError('no such problem'));
    if (to == p.status) return;
    if (problemStatusRank(to) < problemStatusRank(p.status)) {
      throw p.status == 'resolved'
          ? const LocalValidationError(
              'Only a Program Admin moves a problem out of Resolved.',
              problem: 'resolved_needs_admin',
            )
          : const LocalValidationError('A problem’s status doesn’t go back.', problem: 'status_backwards');
    }
    store.setField(problemId, 'status', {'status': to, 'encounterId': encounterId});
  }

  /// **Still ongoing** (9.1): the person confirms the current status at a visit. It is sent even
  /// though nothing changed (an observation: the server records who looked and when, which module
  /// 5's 90-day status check reads). Throws [ChartingPaused] while the clock check fails.
  void confirmStatus(String problemId, {String? encounterId}) {
    final p = problem(problemId) ?? (throw StateError('no such problem'));
    store.setField(problemId, 'status', {'status': p.status, 'encounterId': encounterId}, observe: true);
  }

  /// Marks the whole problem entered in error, with a reason: hidden from lists, kept in history.
  void enteredInError(String problemId, String reason) =>
      store.setField(problemId, 'enteredInError', {'reason': _reason(reason)});

  /// A note (1–4,000 characters, append only; a wrong note is followed by a correcting one).
  String addNote(String problemId, String text, {String? encounterId}) {
    final p = store.record(problemId);
    if (p == null || p.entity != entityProblem) throw StateError('no such problem');
    final t = text.trim();
    if (t.isEmpty || t.length > 4000) {
      throw const LocalValidationError('A note is 1 to 4,000 characters.', paths: {'text'});
    }
    return store.createRecord(entityProblemNote, {'problemId': problemId, 'text': t, 'encounterId': ?encounterId});
  }

  /// **Still has this?** on a Resolved problem (9.4): [cameBack] makes a new episode (New,
  /// `recurrenceOf`); otherwise it never went away and was marked Resolved by mistake (New,
  /// `resolvedInErrorOf`), which asks a Program Admin to reverse it. Care and the bag check carry on
  /// at once either way. Returns the new problem's ID.
  String stillHasThis(String problemId, {required bool cameBack}) {
    final p = problem(problemId) ?? (throw StateError('no such problem'));
    return add(
      p.patientId,
      title: p.title,
      code: p.code,
      status: 'new',
      sensitive: p.sensitive,
      recurrenceOf: cameBack ? problemId : null,
      resolvedInErrorOf: cameBack ? null : problemId,
    );
  }

  // ---- the problem conflict card (9.3) ----

  /// **Keep Resolved**: the person's status stays in history; the conflict settles. False when the
  /// card is out of date (the server moved on: show it again).
  bool keepServer(String changeId) => store.resolveConflict(changeId, keepMine: false);

  /// **It came back: add as a new problem** ([cameBack]) or **Resolved by mistake: ask an admin**:
  /// keeps the server's status and adds the new entry, in one transaction. Returns the new
  /// problem's ID, or null when the card is out of date.
  String? keepServerAndAdd(String changeId, {required bool cameBack}) {
    final c = store.entry(changeId);
    if (c == null || c.entity != entityProblem) throw StateError('not a problem conflict');
    return store.transaction(() {
      if (!store.resolveConflict(changeId, keepMine: false)) return null;
      return stillHasThis(c.recordId, cameBack: cameBack);
    });
  }

  static String _reason(String reason) {
    final r = reason.trim();
    if (r.length < 3 || r.length > 300) {
      throw const LocalValidationError('Give a short reason (3 to 300 characters).', paths: {'reason'});
    }
    return r;
  }
}

/// Sensitive by default (design 9.5): the code's first characters sort inside a listed range
/// (services/api problem.ts isSensitiveCode).
bool isSensitiveCode(String code) => sensitiveCodeRanges.any((r) {
  final head = code.substring(0, min(code.length, r.from.length));
  return head.compareTo(r.from) >= 0 && head.compareTo(r.to) <= 0;
});

/// A code from the phone's curated list (assets/problem_codes.json, design 9.5).
class ProblemCode {
  const ProblemCode({required this.code, required this.title, required this.group, required this.sensitive});
  final String code;
  final String title;
  final String group;
  final bool sensitive;

  ProblemCodeValue get value => (system: 'icd10cm', code: code, display: title);
}

/// The curated ICD-10-CM list, searchable by code and by plain words ("burn" finds "Burn of left
/// forearm, first degree"). PLAN-OPEN: the list (design 14.1, Brooke and Mercy), and a full online
/// code search later.
class ProblemCodes {
  ProblemCodes(this.codes);

  /// The asset's JSON (`{codes: [{code, title, group, sensitive}]}`).
  factory ProblemCodes.parse(String json) {
    final list = (jsonDecode(json) as Map<String, Object?>)['codes']! as List<Object?>;
    return ProblemCodes([
      for (final c in list.cast<Map<String, Object?>>())
        ProblemCode(
          code: c['code']! as String,
          title: c['title']! as String,
          group: c['group'] as String? ?? '',
          sensitive: c['sensitive'] == true,
        ),
    ]);
  }

  /// The bundled list (P3 declares the asset in pubspec.yaml).
  static Future<ProblemCodes> load([AssetBundle? bundle]) async =>
      ProblemCodes.parse(await (bundle ?? rootBundle).loadString('assets/problem_codes.json'));

  final List<ProblemCode> codes;

  static final _word = RegExp('[a-z0-9]+');

  /// Codes whose code starts with [query], then codes whose title has a word starting with every
  /// word of [query], in list order; at most [limit].
  List<ProblemCode> search(String query, {int limit = 20}) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return const [];
    final byCode = [
      for (final c in codes)
        if (c.code.toLowerCase().startsWith(q) || c.code.replaceAll('.', '').toLowerCase().startsWith(q)) c,
    ];
    final words = _word.allMatches(q).map((m) => m[0]!).toList();
    final byTitle = [
      for (final c in codes)
        if (!byCode.contains(c) && words.isNotEmpty)
          if (words.every((w) => _word.allMatches(c.title.toLowerCase()).any((m) => m[0]!.startsWith(w)))) c,
    ];
    return [...byCode, ...byTitle].take(limit).toList();
  }

  /// Whether [code] has the shape the server accepts (it checks the shape only, 9.5).
  static bool wellFormed(String code) => icd10cmCode.hasMatch(code);
}
