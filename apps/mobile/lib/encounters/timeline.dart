part of 'encounter_repository.dart';

// The patient profile's timeline (phase 4 design, lifecycle 5.2, 8.2, 9.1): one row per visit and
// per referral, newest first. The chart's list (`timeline`, 5.2, and the pages Show earlier visits
// adds) is merged with the visits the phone holds, which it knows better of: one the server has not
// confirmed yet, and one whose notes were finished or changed here and not sent. The timeline is part
// of the chart, whose open logged the read (phase 3's chart read lists its problems the same way), so
// it logs nothing of its own; opening a visit from it is a visit read, which does.

/// The visits one page of the server's timeline holds (`TIMELINE_PAGE`, 5.2).
const timelinePage = 50;

/// The type filter's chips, in the PRD's order (PRD main 725): the note types' timeline groups (forms
/// 2.2), and `referrals` for a referral's row.
const timelineGroups = ['clinical', 'psych', 'social', 'referrals', 'outreach', 'harm_reduction', 'wound'];

/// A note of a visit's row: its type, as a chip, with its state in words (9.1).
class TimelineNoteChip {
  const TimelineNoteChip({
    required this.noteId,
    required this.noteTypeKey,
    required this.title,
    required this.group,
    required this.shown,
    required this.waitingToSend,
    required this.sentForReview,
  });

  final String noteId;
  final String noteTypeKey;

  /// The note type's title, where the phone holds its definition or the team's list names it.
  final String? title;

  /// Its timeline group; null where the phone can't tell it.
  final String? group;
  final NoteShown shown;

  /// Done here and not confirmed yet: "Waiting to send" (8.2).
  final bool waitingToSend;

  /// "Sent for review": a Program Admin decides its sign-off (4.8).
  final bool sentForReview;
}

/// A row of the timeline: a visit or a referral.
sealed class TimelineRow {
  const TimelineRow();

  /// The type filter's groups it shows under.
  Set<String> get groups;
}

/// A visit's row (9.1): its date, Medical or Non-Medical, and its notes. It opens the visit (9.7).
final class TimelineVisitRow extends TimelineRow {
  const TimelineVisitRow({
    required this.encounterId,
    required this.startedAt,
    required this.kind,
    required this.status,
    required this.notes,
    required this.waitingToSend,
    required this.onPhone,
  });

  final String encounterId;

  /// Null only for a visit the phone holds whose time it does not know yet.
  final DateTime? startedAt;
  final VisitKind kind;

  /// From the notes listed, as the server works it out for the reader (5.2).
  final NoteStatus status;

  /// The notes the person may see, an empty draft left out.
  final List<TimelineNoteChip> notes;

  /// "Waiting to send": the visit, or something done to one of its notes here, is not confirmed yet.
  final bool waitingToSend;

  /// The visit is on this phone: it opens offline.
  final bool onPhone;

  @override
  Set<String> get groups => {
    for (final n in notes)
      if (n.group != null) n.group!,
  };
}

/// A referral's row (7, 9.1).
final class TimelineReferralRow extends TimelineRow {
  const TimelineReferralRow(this.referral);
  final ReferralView referral;

  @override
  Set<String> get groups => const {'referrals'};
}

/// The timeline as read.
class TimelineView {
  const TimelineView(this.rows, {required this.earlierBefore});

  /// Newest first.
  final List<TimelineRow> rows;

  /// **Show earlier visits** asks for the visits after this one (`EncounterApi.earlierVisits`); null
  /// when the server's last page was not full, so there are none.
  final String? earlierBefore;

  /// The rows under any of [groups] (the type filter's chips on); every row when none is on.
  List<TimelineRow> filtered(Set<String> groups) =>
      groups.isEmpty ? rows : [...rows.where((r) => r.groups.any(groups.contains))];
}

extension PatientTimeline on EncounterRepository {
  /// [patientId]'s timeline (9.1): the chart's list [chart] and the [earlier] pages Show earlier
  /// visits fetched, merged with the visits the phone holds of the patient's merged group, and the
  /// group's referrals ([Referrals.referralsOf], with the chart's own). A note's state is the phone's
  /// for a note it holds; [typeOf] gives a note type by key from the team's list, for its title and,
  /// for a note the phone does not hold, whether it is Medical (3.1). The definitions of the notes the
  /// phone holds are loaded first, offline too. Throws [ChartingPaused] while the store is frozen.
  Future<TimelineView> openTimeline(
    String patientId, {
    wire.Timeline? chart,
    List<List<wire.TimelineVisit>> earlier = const [],
    NoteTypeDef? Function(String key)? typeOf,
  }) async {
    _guardFrozen();
    final group = patientGroup(store, patientId);
    await definitions.loadAll(
      EncounterRepository._versions([
        for (final visit in _visitsOf(group)) ..._Held.scan(store, encounterId: visit.id).notes,
      ]),
    );
    return readTimeline(patientId, chart: chart, earlier: earlier, typeOf: typeOf);
  }

  /// [openTimeline] with the definitions loaded already.
  TimelineView readTimeline(
    String patientId, {
    wire.Timeline? chart,
    List<List<wire.TimelineVisit>> earlier = const [],
    NoteTypeDef? Function(String key)? typeOf,
  }) {
    _guardFrozen();
    final group = patientGroup(store, patientId);
    final visits = <String, TimelineVisitRow>{};
    // A visit started at the same time as the last one of a page may come again on the next (5.2).
    for (final v in [...?chart?.encounters, for (final page in earlier) ...page]) {
      visits.putIfAbsent(v.encounterId, () => _serverVisit(v, typeOf));
    }
    for (final visit in _visitsOf(group)) {
      visits[visit.id] = _heldVisit(visit, visits[visit.id], typeOf);
    }
    final referrals = Referrals(
      store,
      user: user,
      nameOf: nameOf,
    ).referralsOf(patientId, chart: chart?.referrals ?? const []);
    final rows = <TimelineRow>[...visits.values, for (final r in referrals) TimelineReferralRow(r)]..sort(_newestFirst);
    final last = earlier.isNotEmpty ? earlier.last : chart?.encounters;
    return TimelineView(
      rows,
      earlierBefore: last != null && last.length >= timelinePage ? last.last.encounterId : null,
    );
  }

  /// The visits this phone holds of the patient group [group].
  List<LocalRecord> _visitsOf(Set<String> group) => [
    for (final id in store.recordIds())
      if (store.record(id) case final rec? when rec.entity == entityEncounter)
        if (rec.fields['patientId']?.value case final String patient
            when group.contains(store.canonicalPatient(patient)))
          rec,
  ];

  TimelineVisitRow _serverVisit(wire.TimelineVisit v, NoteTypeDef? Function(String key)? typeOf) {
    final kind = v.kind == wire.EncounterKind.medical ? VisitKind.medical : VisitKind.nonMedical;
    return TimelineVisitRow(
      encounterId: v.encounterId,
      startedAt: v.startedAt,
      kind: kind,
      status: _wireStatus(v.status),
      notes: [
        for (final n in v.notes)
          TimelineNoteChip(
            noteId: n.noteId,
            noteTypeKey: n.noteTypeKey,
            title: typeOf?.call(n.noteTypeKey)?.title,
            group: n.group == wire.TimelineGroup.unknown ? null : n.group.wire,
            shown: noteShown(
              status: _wireStatus(n.status),
              attestation:
                  Attestation.values.where((a) => a.code == n.attestation.wire).firstOrNull ?? Attestation.notNeeded,
              // A Non-Medical visit holds Non-Medical notes only (3.10).
              medical: switch (typeOf?.call(n.noteTypeKey)) {
                final type? => isMedicalType(type),
                null => kind == VisitKind.medical,
              },
            ),
            waitingToSend: false,
            sentForReview: false,
          ),
      ],
      waitingToSend: false,
      onPhone: false,
    );
  }

  /// [visit] as the phone holds it, its notes as the person may see them (6.4) and as this phone
  /// knows them; [server] is the chart's row of it, whose notes the phone does not hold stay as the
  /// chart has them, in the chart's order.
  TimelineVisitRow _heldVisit(LocalRecord visit, TimelineVisitRow? server, NoteTypeDef? Function(String key)? typeOf) {
    final held = _Held.scan(store, encounterId: visit.id);
    final ordered = held.ordered(held.notes);
    final mine = <String, TimelineNoteChip?>{for (final rec in ordered) rec.id: _heldChip(rec, held, typeOf)};
    final notes = <TimelineNoteChip>[
      for (final chip in server?.notes ?? const <TimelineNoteChip>[])
        if (!mine.containsKey(chip.noteId)) chip else ?mine[chip.noteId],
      for (final rec in ordered)
        if (!(server?.notes.any((c) => c.noteId == rec.id) ?? false)) ?mine[rec.id],
    ];
    final create = held.createOf(visit.id);
    return TimelineVisitRow(
      encounterId: visit.id,
      startedAt: EncounterRepository._time(visit.attributes['startedAt']) ?? create?.time ?? server?.startedAt,
      kind: VisitKind.fromCode(visit.fields['kind']?.value),
      status: encounterStatus([
        for (final n in notes)
          (
            status: switch (n.shown) {
              NoteShown.draft => NoteStatus.draft,
              NoteShown.complete || NoteShown.waitingForCosigner => NoteStatus.completed,
              _ => NoteStatus.signed,
            },
            medical: n.shown == NoteShown.waitingForCosigner,
            empty: false,
          ),
      ]),
      notes: notes,
      waitingToSend: create != null || notes.any((n) => n.waitingToSend),
      onPhone: true,
    );
  }

  /// A note the phone holds, as a chip; null when the person may not see it or it is an empty draft.
  TimelineNoteChip? _heldChip(LocalRecord rec, _Held held, NoteTypeDef? Function(String key)? typeOf) {
    // Part of the chart's logged read: what [_note] would log is not.
    final view = _note(rec, held, <_Shown>[]);
    if (view == null) return null;
    final type = view.definition ?? typeOf?.call(view.noteTypeKey);
    return TimelineNoteChip(
      noteId: view.noteId,
      noteTypeKey: view.noteTypeKey,
      title: type?.title,
      group: type?.group,
      shown: view.shown,
      waitingToSend: view.waitingToSend || view.notSynced,
      sentForReview: view.sentForReview,
    );
  }

  static NoteStatus _wireStatus(wire.NoteStatus s) => switch (s) {
    wire.NoteStatus.completed => NoteStatus.completed,
    wire.NoteStatus.signed => NoteStatus.signed,
    _ => NoteStatus.draft,
  };

  static int _newestFirst(TimelineRow a, TimelineRow b) {
    DateTime at(TimelineRow r) => switch (r) {
      // A visit made here whose time the phone has not learned yet is as new as can be.
      TimelineVisitRow(:final startedAt) => startedAt ?? DateTime.utc(9999),
      TimelineReferralRow(:final referral) => DateTime.tryParse('${referral.referredOn}T00:00:00Z') ?? DateTime.utc(0),
    };
    final byTime = at(b).compareTo(at(a));
    if (byTime != 0) return byTime;
    // A visit before a referral of the same moment, then by ID.
    if (a.runtimeType != b.runtimeType) return a is TimelineVisitRow ? -1 : 1;
    String id(TimelineRow r) => switch (r) {
      TimelineVisitRow(:final encounterId) => encounterId,
      TimelineReferralRow(:final referral) => referral.id,
    };
    return id(a).compareTo(id(b));
  }
}
