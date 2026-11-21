/// Notes to finish (phase 4 design, lifecycle 3.9, 5.6, 9.9): the drafts the person acts as the
/// author of, which Home's first tile counts and its list shows. Worked out offline from what the
/// phone holds; online, the server's list of their drafts adds those not on this phone, and its word
/// on which are overdue wins, since it knows when it received a visit whose start the phone could
/// not verify. The phone's copy of a note it holds wins otherwise: one finished here, or sent for
/// review, waits for no one to finish it, though the server has it as a draft until it syncs.
library;

import 'dart:math' show max, min;

import '../api/generated/api.dart' as wire;
import '../sync/entities.dart' show auditMaxPatients;
import '../sync/local_store.dart';
import 'credentials.dart';
import 'encounter_api.dart';
import 'rules.dart';

/// One row of the list (9.9): the patient's preferred name, the note type, when the visit started.
class NoteToFinishRow {
  const NoteToFinishRow({
    required this.noteId,
    required this.encounterId,
    required this.patientId,
    required this.patientName,
    required this.noteTypeKey,
    required this.title,
    required this.startedAt,
    required this.overdue,
    required this.onPhone,
    required this.notSynced,
  });

  final String noteId;
  final String encounterId;

  /// Null for a visit with no patient (3.10).
  final String? patientId;

  /// Where the phone knows it.
  final String? patientName;
  final String noteTypeKey;

  /// The note type's title, where the team's list on the phone names it.
  final String? title;
  final DateTime? startedAt;

  /// Still a draft more than a day after its visit started (3.9).
  final bool overdue;

  /// The note opens offline; one that is not on this phone needs a connection (9.9).
  final bool onPhone;

  /// Its create waits here: the server can't know of it yet.
  final bool notSynced;
}

/// The list as read.
class NotesToFinishList {
  const NotesToFinishList(this.rows, {required this.online});

  /// Oldest visit first, as the server lists them.
  final List<NoteToFinishRow> rows;

  /// The server's list was merged in: drafts not on this phone are there too.
  final bool online;

  int get overdue => rows.where((r) => r.overdue).length;
}

/// The person's notes to finish in the open team.
class NotesToFinish {
  NotesToFinish(this.store, {required this.user, this.api, this.titleOf, this.patientName, DateTime Function()? now})
    : _now = now ?? DateTime.now;

  final LocalStore store;
  final EncounterUser user;

  /// The server's list, online; null where there is none to ask.
  final EncounterApi? api;

  /// A note type's title by its key (the team's list on the phone).
  final String? Function(String key)? titleOf;

  /// A patient's name where the phone knows it beyond the charts it holds (the team's index);
  /// otherwise the preferred name on the chart it holds.
  final String? Function(String patientId)? patientName;

  /// The corrected clock: a note is overdue a day after its visit started.
  final DateTime Function() _now;

  /// The list (9.9), the server's merged in when it answers (5.6): the server logs what it lists,
  /// and the phone logs what it shows (`notes_to_finish.viewed`, 10.1) in the transaction that reads
  /// it, so a read that can't be logged shows nothing. Without signal, or refused, the phone's own.
  /// Throws [ChartingPaused] while the store is frozen.
  Future<NotesToFinishList> open({Set<String> shownBefore = const {}}) async {
    List<wire.NoteToFinish>? server;
    final online = api;
    if (online != null) {
      try {
        server = await online.notesToFinish();
      } on EncounterRequestFailed {
        server = null;
      }
    }
    return read(server: server, shownBefore: shownBefore);
  }

  /// [open] with the server's list given (null: none), read and logged in one transaction.
  /// [shownBefore] holds the notes on screen already: only the patients of the others are logged.
  NotesToFinishList read({List<wire.NoteToFinish>? server, Set<String> shownBefore = const {}}) {
    _guardFrozen();
    return store.transaction(() {
      final drafts = _drafts();
      final byId = {for (final d in drafts) d.noteId: d};
      final listed = {for (final s in server ?? const <wire.NoteToFinish>[]) s.noteId: s};
      final rows = <NoteToFinishRow>[
        for (final d in drafts)
          if (d.listed) d.row(overdue: listed[d.noteId]?.overdue, startedAt: listed[d.noteId]?.startedAt),
        for (final s in listed.values)
          // A note of theirs the phone holds is as the phone has it: listed above, or finished here.
          if (!byId.containsKey(s.noteId)) _serverRow(s),
      ]..sort(_oldestFirst);
      _log([
        for (final r in rows)
          if (!shownBefore.contains(r.noteId)) r,
      ]);
      return NotesToFinishList(rows, online: server != null);
    });
  }

  /// Home's tile (9.9): how many notes to finish and how many are overdue, as the list would show
  /// them. [server] is `GET /v1/me/counts` (5.6), null offline. It names no patient, so nothing is
  /// logged. The server counted its drafts; the phone adds its own drafts the server can't have
  /// counted, and takes away those it counted that are finished or emptied here. Throws
  /// [ChartingPaused] while the store is frozen.
  ({int notes, int overdue}) count(wire.HomeCounts? server) {
    _guardFrozen();
    final drafts = _drafts();
    final listed = [
      for (final d in drafts)
        if (d.listed) d,
    ];
    final notes = server?.notesToFinish;
    if (notes == null) return (notes: listed.length, overdue: listed.where((d) => d.overdue).length);
    final added = [
      for (final d in listed)
        if (!d.serverCounts) d,
    ];
    final gone = [
      for (final d in drafts)
        if (!d.listed && d.serverCounts) d,
    ];
    return (
      notes: max(0, notes + added.length - gone.length),
      overdue: max(
        0,
        (server!.notesOverdue ?? 0) + added.where((d) => d.overdue).length - gone.where((d) => d.overdue).length,
      ),
    );
  }

  // ---- inside ----

  /// Every note on the phone the person acts as the author of (3.8).
  List<_Draft> _drafts() {
    final creates = {
      for (final e in store.outbox())
        if (e.op == 'create' && e.state != ChangeState.superseded) e.recordId: e,
    };
    final now = _now();
    final out = <_Draft>[];
    for (final id in store.recordIds()) {
      final rec = store.record(id);
      if (rec == null || rec.entity != entityNote) continue;
      if ((rec.attributes['actingAuthorId'] as String? ?? rec.authorUserId) != user.userId) continue;
      final state = store.noteState(id)!;
      final encounterId = rec.attributes['encounterId'] as String? ?? '';
      final visit = store.record(encounterId);
      final visitCreate = creates[encounterId];
      final startedAt = _time(visit?.attributes['startedAt']) ?? visitCreate?.correctedTime ?? visitCreate?.deviceTime;
      final verified = visit?.attributes['clockVerified'] as bool? ?? visitCreate?.clockVerified ?? false;
      final answers = {
        for (final MapEntry(:key, :value) in rec.fields.entries)
          if (key.startsWith(_data)) key: value,
      };
      final patientId = visit?.fields['patientId']?.value as String?;
      out.add(
        _Draft(
          noteId: id,
          encounterId: encounterId,
          patientId: patientId,
          patientName: patientId == null ? null : _nameOf(patientId),
          noteTypeKey: rec.attributes['noteTypeKey'] as String? ?? '',
          title: titleOf?.call(rec.attributes['noteTypeKey'] as String? ?? ''),
          startedAt: startedAt,
          overdue:
              startedAt != null &&
              isOverdue(
                noteStatus: NoteStatus.draft,
                startedAt: startedAt,
                startedVerified: verified,
                receivedAt: null,
                now: now,
              ),
          notSynced: creates.containsKey(id),
          // Finished as the phone knows it, sent for review included (its sign-off's effect stays
          // until a Program Admin decides): nothing for the person to finish.
          listed:
              state.status == NoteStatus.draft &&
              !noteIsEmpty({for (final MapEntry(:key, :value) in answers.entries) key: value.value}),
          // The server lists it as theirs: it is a draft there, and an answer was written there (none
          // of a note whose create waits here is). An answer changed here and not sent yet is taken
          // to hold what it held there; a blank one the server confirmed holds nothing.
          serverCounts:
              rec.status == NoteStatus.draft.name &&
              answers.values.any((f) => f.confirmed ? !noteIsEmpty({'': f.value}) : f.serverVersion > 0),
        ),
      );
    }
    return out;
  }

  NoteToFinishRow _serverRow(wire.NoteToFinish s) => NoteToFinishRow(
    noteId: s.noteId,
    encounterId: s.encounterId,
    patientId: s.patientId,
    patientName: s.patientId == null ? null : _nameOf(s.patientId!),
    noteTypeKey: s.noteTypeKey,
    title: titleOf?.call(s.noteTypeKey),
    startedAt: s.startedAt,
    overdue: s.overdue,
    onPhone: store.record(s.noteId) != null,
    notSynced: false,
  );

  String? _nameOf(String patientId) =>
      patientName?.call(patientId) ??
      store.record(store.canonicalPatient(patientId))?.fields['preferredName']?.value as String?;

  /// One entry for what the read adds to the screen: the patients shown, each once, and how many
  /// notes. An entry lists at most [auditMaxPatients], so a longer list writes more than one.
  void _log(List<NoteToFinishRow> shown) {
    if (shown.isEmpty) return;
    final patients = <String>[
      ...{
        for (final r in shown)
          if (r.patientId != null) r.patientId!,
      },
    ];
    var first = true;
    for (var i = 0; first || i < patients.length; i += auditMaxPatients) {
      store.appendAudit(
        'notes_to_finish.viewed',
        patientIds: patients.sublist(i, min(i + auditMaxPatients, patients.length)),
        resultCount: shown.length,
      );
      first = false;
    }
  }

  static int _oldestFirst(NoteToFinishRow a, NoteToFinishRow b) {
    final at = (a.startedAt ?? _never).compareTo(b.startedAt ?? _never);
    return at != 0 ? at : a.noteId.compareTo(b.noteId);
  }

  void _guardFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  static DateTime? _time(Object? iso) => iso is String ? DateTime.tryParse(iso) : null;
}

const _data = 'data.';

/// A visit whose start the phone can't tell goes last.
final _never = DateTime.utc(9999);

/// A note on the phone the person acts as the author of, as the list and the tile need it.
class _Draft {
  _Draft({
    required this.noteId,
    required this.encounterId,
    required this.patientId,
    required this.patientName,
    required this.noteTypeKey,
    required this.title,
    required this.startedAt,
    required this.overdue,
    required this.notSynced,
    required this.listed,
    required this.serverCounts,
  });

  final String noteId;
  final String encounterId;
  final String? patientId;
  final String? patientName;
  final String noteTypeKey;
  final String? title;
  final DateTime? startedAt;
  final bool overdue;
  final bool notSynced;

  /// A draft as the phone knows it, not empty: on the list.
  final bool listed;

  /// The server counts it among the person's drafts.
  final bool serverCounts;

  /// Its row; [overdue] and [startedAt] are the server's where it lists the note too.
  NoteToFinishRow row({bool? overdue, DateTime? startedAt}) => NoteToFinishRow(
    noteId: noteId,
    encounterId: encounterId,
    patientId: patientId,
    patientName: patientName,
    noteTypeKey: noteTypeKey,
    title: title,
    startedAt: this.startedAt ?? startedAt,
    overdue: overdue ?? this.overdue,
    onPhone: true,
    notSynced: notSynced,
  );
}
