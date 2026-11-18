/// When a visit and its notes leave the phone (phase 4 design, lifecycle 3.2, 8.2).
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

import '../sync/entities.dart' show parentsOf;
import '../sync/local_store.dart';
import '../sync/sync_engine.dart' show AfterSyncRefresher, RefreshReason;
import 'rules.dart' show NoteStatus;

/// PLAN-OPEN: how long does an untouched draft stay on its author's phone (lifecycle 12.1 #4)? 7
/// days after its last change, then it is released if fully synced.
const untouchedDraftLifetime = Duration(days: 7);

/// Closes the visits and notes that are done with on this phone (lifecycle 8.2), so the store's
/// purge may remove what the server has confirmed (`closeRecord`; the purge itself is phase 2's and
/// unchanged, so data still leaves the phone only after a hash-confirmed receipt):
///
/// - a finished note once its sign-off is settled (no `localEffect`) and nothing about it waits in
///   the outbox: no change to it, and no sign-off, addendum or correction of it; in a Medical visit,
///   only once no note of the visit stays a draft on the phone, since Complete and the note types
///   list read the visit's finished Red flags note from here (forms 6.2, lifecycle 3.3 hard stop 5);
/// - a draft, a teammate's opened to help included, that nobody has changed for
///   [untouchedDraftLifetime] and of which nothing waits: it stays on the server and opens again
///   online (3.2). Until then a draft stays on its author's phone, so they can complete it with no
///   signal;
/// - a visit once every note of it on the phone is closed and nothing about it waits, or, holding
///   no note, once nobody has changed it for [untouchedDraftLifetime].
///
/// A note sent for review stays (4.8): kept, the refresh settles an admin's accept, and the notice of
/// a reject finds the note to complete again. What a screen shows ([showing]) stays too.
///
/// It runs as a refresher, at start and after every sync, so a note is still closed when the app was
/// killed between the receipt and the sweep; all of one sweep is one store transaction. "Changed" is
/// any change to the record the phone sees: its own, or a teammate's brought in by the refresh. The
/// phone keeps no time of a record's last change, so the sweep keeps its own record of when it first
/// saw each open draft and visit as it is now, in the store's key-value table (IDs, a hash of the
/// fields' versions, and a time: nothing of a patient).
class CloseSweep implements AfterSyncRefresher {
  CloseSweep(this.store, {DateTime? Function()? now}) : _now = now ?? DateTime.now;

  final LocalStore store;

  /// The clock the 7 days are counted by: the phone's, corrected by the clock check; null while the
  /// clock check has no reference (a phone restarted offline), when the device's own clock could be
  /// days off. Then nothing is released for its age and no time is recorded: finished notes still
  /// close (review LCM-6).
  final DateTime? Function() _now;

  /// The visits and notes a screen shows now, which the screens add and remove: left open, and a
  /// visit's notes with it.
  final showing = <String>{};

  static const _seenKey = 'encounters.close_sweep.seen';

  /// A Non-Medical visit's kind (`VisitKind.nonMedical`): it holds no Red flags note.
  static const _nonMedical = 'non_medical';

  @override
  Future<void> refresh(RefreshReason reason) async => sweep();

  /// Closes what is done with; returns the IDs closed, the notes before their visits. Nothing while
  /// the store is frozen for a hand-over.
  List<String> sweep() {
    if (store.frozen) return const [];
    return store.transaction(() {
      final nowMs = _now()?.toUtc().millisecondsSinceEpoch;
      final waiting = _waiting();
      final records = [for (final id in store.recordIds()) store.record(id)!];
      final notes = [
        for (final r in records)
          if (r.entity == entityNote) r,
      ];
      final seen = _readSeen();
      final stillSeen = <String, (String, int)>{};

      /// Whether [r] has been as it is now for the whole lifetime, by this phone's sweeps. With no
      /// time to count by, what was seen before is kept as it is, and a change is counted from the
      /// next sweep that has one.
      bool untouched(LocalRecord r) {
        final print = _fingerprint(r);
        final before = seen[r.id];
        final same = before != null && before.$1 == print;
        if (nowMs == null) {
          if (same) stillSeen[r.id] = before;
          return false;
        }
        final since = same ? before.$2 : nowMs;
        stillSeen[r.id] = (print, since);
        return nowMs - since >= untouchedDraftLifetime.inMilliseconds;
      }

      bool shown(LocalRecord r) => showing.contains(r.id) || showing.contains(r.attributes['encounterId']);

      final closing = <String>[];
      for (final n in notes) {
        if (!n.open) continue;
        final state = store.noteState(n.id)!;
        final draft = state.status == NoteStatus.draft && !state.sentForReview;
        // Counted whether or not it can go now, so its last change is known when it can.
        final old = draft && untouched(n);
        if (shown(n) || waiting.contains(n.id) || state.sentForReview) continue;
        if (draft ? old : store.localEffect(n.id) == null) closing.add(n.id);
      }
      // A Medical visit's finished notes stay while a note of it stays unfinished: hard stop 5 and
      // the Red flags note added with a Medical note read its finished Red flags note from the phone
      // (forms 6.2), and the sweep can't tell which note that is without its definition.
      final unfinished = {
        for (final n in notes)
          if (n.open && !closing.contains(n.id) && store.noteState(n.id)!.status == NoteStatus.draft)
            n.attributes['encounterId'],
      };
      final visits = {
        for (final r in records)
          if (r.entity == entityEncounter) r.id: r,
      };
      closing.removeWhere((id) {
        final n = notes.firstWhere((n) => n.id == id);
        final visitId = n.attributes['encounterId'];
        final kind = visits[visitId]?.fields['kind']?.value;
        return store.noteState(id)!.status != NoteStatus.draft && unfinished.contains(visitId) && kind != _nonMedical;
      });
      for (final v in records) {
        if (v.entity != entityEncounter || !v.open) continue;
        final its = [
          for (final n in notes)
            if (n.attributes['encounterId'] == v.id) n,
        ];
        final old = untouched(v);
        if (shown(v) || waiting.contains(v.id)) continue;
        final done = its.isEmpty ? old : its.every((n) => !n.open || closing.contains(n.id));
        if (done) closing.add(v.id);
      }
      store.setKv(
        _seenKey,
        jsonEncode({
          for (final MapEntry(key: id, value: (print, since)) in stillSeen.entries)
            if (!closing.contains(id)) id: [print, since],
        }),
      );
      closing.forEach(store.closeRecord);
      return closing;
    });
  }

  /// The records something waits on in the outbox: the record a change is to, and every record it
  /// names (a sign-off's, an addendum's and a correction's note, a note's visit), whether it waits
  /// to send, was refused or is in conflict.
  Set<String> _waiting() => {
    for (final e in store.outbox())
      if (e.state != ChangeState.superseded) ...[
        e.recordId,
        for (final p in parentsOf(entity: e.entity, op: e.op, field: e.field, value: e.value)) p.id,
      ],
  };

  /// What [r] is now, as far as a change to it goes: its state and each field's version and waiting
  /// change, never a value.
  static String _fingerprint(LocalRecord r) {
    final fields = r.fields.keys.toList()..sort();
    final text = [
      r.status,
      for (final name in fields) '$name ${r.fields[name]!.serverVersion} ${r.fields[name]!.pendingChange ?? ''}',
    ].join('\n');
    return sha256.convert(utf8.encode(text)).toString();
  }

  Map<String, (String, int)> _readSeen() {
    // Unreadable, every record is counted from now, which only keeps a draft longer.
    try {
      return {
        if (jsonDecode(store.kv(_seenKey) ?? '{}') case final Map<String, Object?> json)
          for (final MapEntry(key: id, :value) in json.entries)
            if (value case [final String print, final int since]) id: (print, since),
      };
    } on FormatException {
      return const {};
    }
  }
}
