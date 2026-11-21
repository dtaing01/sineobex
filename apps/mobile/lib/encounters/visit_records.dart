/// The records made at a visit (phase 4 design, lifecycle 9.7, 8.4; D91): its referrals, problems,
/// allergies and problems' notes, whichever chart they are on. A visit moved to another patient
/// leaves them with the first (4.3, 12.1 #25), and this list is how the clinician finds each one to
/// enter it in error on the first chart and chart it again on the second. The server's visit read
/// gives the same list for a visit the phone does not hold (`VisitView.records`); this one reads the
/// phone's own copy, offline too.
library;

import '../api/generated/api.dart' show ProblemNoteView;
import '../patients/chart_cache.dart' show chartMetaOf;
import '../patients/patient_repository.dart' show AllergyView;
import '../patients/problems.dart';
import '../sync/entities.dart' show entityReferral;
import '../sync/local_store.dart';
import 'credentials.dart';
import 'referrals.dart';

/// One record made at a visit, as the visit lists it.
sealed class MadeAtVisit {
  const MadeAtVisit({required this.onAnotherChart});

  String get id;

  /// The chart it is on: the patient it was made for, wherever the visit has gone since.
  String get patientId;

  /// Its entity, as the audit names it.
  String get entity;

  /// The visit has moved to someone outside [patientId]'s merged group since it was made (8.4, 12.1
  /// #25): the record stays on the first chart, which no longer says "at a visit", and the clinician
  /// enters it in error there and charts it again on the visit's own.
  final bool onAnotherChart;
}

/// A referral made at the visit (lifecycle 7), opened in the Referrals sheet.
final class ReferralMadeAt extends MadeAtVisit {
  const ReferralMadeAt(this.referral, {required super.onAnotherChart});

  final ReferralView referral;

  @override
  String get id => referral.id;
  @override
  String get patientId => referral.patientId;
  @override
  String get entity => entityReferral;
}

/// A problem added at the visit (8.3), opened on the problem screen.
final class ProblemMadeAt extends MadeAtVisit {
  const ProblemMadeAt(this.problem, {required super.onAnotherChart});

  final ProblemView problem;

  @override
  String get id => problem.id;
  @override
  String get patientId => problem.patientId;
  @override
  String get entity => entityProblem;
}

/// An allergy recorded at the visit, opened in the profile's Allergies section.
final class AllergyMadeAt extends MadeAtVisit {
  const AllergyMadeAt(this.allergy, {required this.patientId, required super.onAnotherChart});

  final AllergyView allergy;
  @override
  final String patientId;

  @override
  String get id => allergy.id;
  @override
  String get entity => entityAllergy;
}

/// A note written on a problem at the visit, opened on its problem's screen. A wrong note is followed
/// by a correcting one: a note is never entered in error.
final class ProblemNoteMadeAt extends MadeAtVisit {
  const ProblemNoteMadeAt(
    this.note, {
    required this.problemId,
    required this.problemTitle,
    required this.patientId,
    required super.onAnotherChart,
  });

  final ProblemNote note;
  final String problemId;
  final String problemTitle;
  @override
  final String patientId;

  @override
  String get id => note.id;
  @override
  String get entity => entityProblemNote;
}

/// The records made at a visit, for one person, from the phone's own copy.
class VisitRecords {
  VisitRecords(this.store, {required this.user, this.nameOf});

  final LocalStore store;
  final EncounterUser user;

  /// A teammate's name, where the phone knows it.
  final String? Function(String userId)? nameOf;

  /// The records made at the visit [encounterId] that the phone holds, as a chart shows each to the
  /// person (phase 3's reads, as the server's `recordsMadeAt` asks them): none without
  /// `patients.view`; a problem, and a note on one, only with the problem list's keys, and a sensitive
  /// one only with `patients.view_sensitive`. Referrals first, then problems, allergies and problems'
  /// notes, as 9.7 lists them, each kind in the order made as far as the phone can tell.
  ///
  /// Each one shown is logged as the server's visit read logs it (5.1, 10.1): `patient.viewed` on its
  /// own entity and its own patient, which can be another chart's, in the transaction that reads it,
  /// so a read that can't be logged shows nothing; [shownBefore] holds the IDs already on screen,
  /// which are not logged again. Throws [ChartingPaused] while the store is frozen.
  List<MadeAtVisit> madeAt(String encounterId, {Set<String> shownBefore = const {}}) {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
    return store.transaction(() {
      final list = _read(encounterId);
      for (final r in list) {
        if (shownBefore.contains(r.id)) continue;
        store.appendAudit(
          'patient.viewed',
          entity: r.entity,
          entityId: r.id,
          patientId: r.patientId,
          // Made or worked on here, or a copy the server sent, as phase 3 logs a chart read offline.
          source: store.record(r.id)?.origin == 'local' ? 'local' : 'cache',
        );
      }
      return list;
    });
  }

  List<MadeAtVisit> _read(String encounterId) {
    if (!user.permissions.contains('patients.view')) return const [];
    // Problems.problem gives nothing to a role without the problem list's keys.
    final problems = Problems(store, permissions: user.permissions.toList());
    bool seen(ProblemView p) => !p.sensitive || problems.maySeeSensitive;
    bool moved(String patientId) => !atVisitOf(store, patientId, encounterId);

    final made = _Made(store);
    final problemList = <ProblemView>[];
    final allergies = <(AllergyView, String)>[];
    final notes = <String, (ProblemNoteView?, LocalRecord?)>{};
    for (final id in store.recordIds()) {
      final rec = store.record(id)!;
      final a = rec.attributes;
      switch (rec.entity) {
        case entityPatient:
          for (final n in chartMetaOf(store, id)?.problemNotes ?? const <ProblemNoteView>[]) {
            if (n.encounterId == encounterId) notes[n.id] = (n, notes[n.id]?.$2);
          }
        // A server copy says where it was made as the chart shows it; one made here, as it was made.
        case entityProblem when (a['createdEncounterId'] ?? a['encounterId']) == encounterId:
          final p = problems.problem(id);
          if (p != null && seen(p)) problemList.add(p);
        case entityAllergy when a['encounterId'] == encounterId:
          allergies.add((_allergy(rec, waiting: made.waiting(id)), rec.patientId ?? a['patientId']! as String));
        case entityProblemNote when a['encounterId'] == encounterId:
          notes[id] = (notes[id]?.$1, rec);
      }
    }

    return [
      for (final r in made.ordered(
        Referrals(store, user: user, nameOf: nameOf).referralsMadeAt(encounterId),
        (r) => r.id,
        (r) => r.recordedAt,
      ))
        ReferralMadeAt(r, onAnotherChart: moved(r.patientId)),
      for (final p in made.ordered(problemList, (p) => p.id, _createdAt))
        ProblemMadeAt(p, onAnotherChart: moved(p.patientId)),
      for (final (allergy, patientId) in made.ordered(allergies, (x) => x.$1.id, (x) => _recordedAt(store, x.$1.id)))
        AllergyMadeAt(allergy, patientId: patientId, onAnotherChart: moved(patientId)),
      for (final note in made.ordered(_notes(notes, problems, seen), (n) => n.note.id, (n) => n.note.writtenAt))
        ProblemNoteMadeAt(
          note.note,
          problemId: note.problem.id,
          problemTitle: note.problem.title,
          patientId: note.problem.patientId,
          onAnotherChart: moved(note.problem.patientId),
        ),
    ];
  }

  /// Each note with its problem, when the person may see the problem; a note whose problem the phone
  /// does not hold is left out, since nothing then says whether it is sensitive. The chart's copy of a
  /// note is the one shown once the chart lists it.
  List<({ProblemNote note, ProblemView problem})> _notes(
    Map<String, (ProblemNoteView?, LocalRecord?)> notes,
    Problems problems,
    bool Function(ProblemView p) seen,
  ) {
    final out = <({ProblemNote note, ProblemView problem})>[];
    for (final MapEntry(key: id, value: (fromChart, held)) in notes.entries) {
      final problemId = fromChart?.problemId ?? held!.attributes['problemId'] as String?;
      final problem = problemId == null ? null : problems.problem(problemId);
      if (problem == null || !seen(problem)) continue;
      out.add((
        note: ProblemNote(
          id: id,
          text: fromChart?.text ?? held!.attributes['text'] as String? ?? '',
          writtenAt: fromChart?.writtenAt,
          authorName: fromChart?.author.displayName,
          encounterId: fromChart?.encounterId ?? held!.attributes['encounterId'] as String?,
          pending: store.outbox().any((e) => e.recordId == id),
        ),
        problem: problem,
      ));
    }
    return out;
  }

  /// When the problem was added, by the chart's history of it.
  static DateTime? _createdAt(ProblemView p) => p.history.where((e) => e.kind == 'created').firstOrNull?.at;

  static DateTime? _recordedAt(LocalStore store, String id) => switch (store.record(id)?.attributes['recordedAt']) {
    final String iso => DateTime.tryParse(iso),
    _ => null,
  };

  /// An allergy as the profile's Allergies section shows it (`PatientRepository.read`).
  static AllergyView _allergy(LocalRecord r, {required bool waiting}) {
    final error = r.fields['enteredInError']?.value;
    return AllergyView(
      id: r.id,
      substance: r.attributes['substance'] as String? ?? '',
      category: r.attributes['category'] as String?,
      severity: r.attributes['severity'] as String?,
      reaction: r.attributes['reaction'] as String?,
      active: r.status == 'active' && error == null,
      enteredInErrorReason: error is Map<String, Object?> ? error['reason'] as String? : null,
      pending: waiting,
    );
  }
}

/// What waits here to send, read once per read: the order records were made in, as the phone can
/// tell it.
class _Made {
  _Made(LocalStore store) {
    for (final e in store.outbox()) {
      _waiting.add(e.recordId);
      if (e.op == 'create' && e.state != ChangeState.superseded) _seq[e.recordId] = e.seq;
    }
  }

  final _waiting = <String>{};
  final _seq = <String, int>{};

  /// Something of [recordId] waits to send.
  bool waiting(String recordId) => _waiting.contains(recordId);

  /// [items] in the order made: those the server holds by the time it gives them, then those with no
  /// time known by ID, then those whose create waits here in the order they were made (as the visit's
  /// own notes are ordered, `EncounterRepository`).
  List<T> ordered<T>(Iterable<T> items, String Function(T item) idOf, DateTime? Function(T item) timeOf) {
    int rank(T x) => _seq.containsKey(idOf(x)) ? 2 : (timeOf(x) == null ? 1 : 0);
    return [...items]..sort((a, b) {
      final byRank = rank(a).compareTo(rank(b));
      if (byRank != 0) return byRank;
      return switch (rank(a)) {
        0 => timeOf(a)!.compareTo(timeOf(b)!) != 0 ? timeOf(a)!.compareTo(timeOf(b)!) : idOf(a).compareTo(idOf(b)),
        2 => _seq[idOf(a)]!.compareTo(_seq[idOf(b)]!),
        _ => idOf(a).compareTo(idOf(b)),
      };
    });
  }
}
