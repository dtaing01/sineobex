part of 'encounter_repository.dart';

// Needs attention's fixes for the refusals that only this layer can settle (phase 4 design,
// lifecycle 4.1, 8.4, 9.13): a Medical note in a visit with no patient, a record made at a visit the
// team lacks or that is someone else's now, a note on a type the team doesn't have. Each sends its
// fix through the store's `fixRejected`, linked to the refused change, so the refused one settles
// once the server takes the fix (phase 2's fix chain), and what waited behind it goes after it.

/// A visit **Choose a visit** offers (8.4): one this phone holds of the refused record's patient.
typedef VisitChoice = ({String encounterId, VisitKind kind, DateTime? startedAt});

/// The records a visit's refusal can be about: what is made at a visit on a chart (4.7, 8.4).
const _madeAtVisit = {entityReferral, entityProblem, entityAllergy, entityProblemNote};

/// Whether Needs attention offers **Send without the visit** and **Choose a visit** for [e] (8.4):
/// a refused create of a referral, a problem, an allergy or a problem's note whose visit the team
/// does not have (`encounter_missing`) or is someone else's (`encounter_other_patient`).
bool settledByVisit(OutboxEntry e) =>
    e.state == ChangeState.rejected &&
    e.op == 'create' &&
    _madeAtVisit.contains(e.entity) &&
    const {'encounter_missing', 'encounter_other_patient'}.contains(e.details?['problem']);

/// Whether Needs attention offers **Choose a patient** for [e] (4.1, 3.10): a refused create of a
/// Medical note in a visit that names no patient on the server (`medical_note_needs_patient`).
bool settledByPatient(OutboxEntry e) =>
    e.state == ChangeState.rejected &&
    e.op == 'create' &&
    e.entity == entityNote &&
    e.details?['problem'] == 'medical_note_needs_patient';

/// Whether Needs attention offers **Remove this note** for [e] (4.1): a refused create of a note on
/// a key or version the team does not have (`unknown_note_type`).
bool settledByRemoving(OutboxEntry e) =>
    e.state == ChangeState.rejected &&
    e.op == 'create' &&
    e.entity == entityNote &&
    e.details?['problem'] == 'unknown_note_type';

extension RefusalFixes on EncounterRepository {
  /// **Send without the visit** (8.4): the refused create [changeId] sent again as it was, but with
  /// no visit (`encounterId: null`), as the fix of the refused one.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock check fails; a
  /// [StateError] for a change [settledByVisit] does not take.
  void sendWithoutVisit(String changeId) {
    _guardFrozen();
    final refused = _visitRefusal(changeId);
    store.fixRejected(changeId, {...refused.value! as Map<String, Object?>, 'encounterId': null});
    onChanged?.call();
  }

  /// Whether **Choose a visit** has a visit to offer for the refused create [changeId]: what
  /// [visitsToChoose] would list, without reading or logging any of it. False while the store is
  /// frozen.
  bool hasVisitsToChoose(String changeId) => !store.frozen && _choices(_visitRefusal(changeId)).isNotEmpty;

  /// The visits **Choose a visit** offers for the refused create [changeId] (8.4): those this phone
  /// holds of its record's patient's merged group, but the one it names, newest first. Each is
  /// logged as shown (`encounter.viewed`, on its own patient, 10.1), in one transaction, so a list
  /// that can't be logged shows nothing; none, and nothing is logged, when the phone holds no other.
  ///
  /// Throws [ChartingPaused] while the store is frozen; a [StateError] for a change [settledByVisit]
  /// does not take.
  List<VisitChoice> visitsToChoose(String changeId) {
    _guardFrozen();
    final refused = _visitRefusal(changeId);
    return store.transaction(() {
      final choices = _choices(refused);
      for (final (_, visit) in choices) {
        _log([_Shown('encounter.viewed', entityEncounter, visit)], EncounterRepository._patientOf(visit), const {});
      }
      return [for (final (choice, _) in choices) choice];
    });
  }

  List<(VisitChoice, LocalRecord)> _choices(OutboxEntry refused) {
    final named = (refused.value! as Map<String, Object?>)['encounterId'];
    final group = patientGroup(store, store.canonicalPatient(_patientOfRefusal(refused)));
    final choices = <(VisitChoice, LocalRecord)>[];
    for (final id in store.recordIds()) {
      final visit = store.record(id);
      if (visit == null || visit.entity != entityEncounter || visit.id == named) continue;
      final patient = EncounterRepository._patientOf(visit);
      if (patient == null || !group.contains(store.canonicalPatient(patient))) continue;
      final create = _Held.scan(store, encounterId: visit.id).createOf(visit.id);
      choices.add((
        (
          encounterId: visit.id,
          kind: VisitKind.fromCode(visit.fields['kind']?.value),
          startedAt: EncounterRepository._time(visit.attributes['startedAt']) ?? create?.time,
        ),
        visit,
      ));
    }
    return choices..sort((a, b) => (b.$1.startedAt ?? DateTime(0)).compareTo(a.$1.startedAt ?? DateTime(0)));
  }

  /// **Choose a visit** (8.4): the refused create [changeId] sent again at [encounterId], one of the
  /// visits [visitsToChoose] gives, as the fix of the refused one.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock check fails;
  /// `encounter_other_patient` for a visit of someone outside the record's patient's merged group,
  /// as Add problem and Add referral refuse one; a [StateError] for a change [settledByVisit] does
  /// not take, or a visit the phone does not hold.
  void moveToVisit(String changeId, String encounterId) {
    _guardFrozen();
    final refused = _visitRefusal(changeId);
    final visitPatient = EncounterRepository._patientOf(_visit(encounterId));
    final group = patientGroup(store, store.canonicalPatient(_patientOfRefusal(refused)));
    if (visitPatient != null && !group.contains(store.canonicalPatient(visitPatient))) {
      throw const LocalValidationError(
        'That visit belongs to someone else. Choose another, or send it without the visit.',
        problem: 'encounter_other_patient',
      );
    }
    store.fixRejected(changeId, {...refused.value! as Map<String, Object?>, 'encounterId': encounterId});
    onChanged?.call();
  }

  /// **Choose a patient** (4.1, 3.10) for [changeId], a Medical note's create the server refused
  /// because its visit named no patient: the visit is given [patientId] (a visit with no patient takes
  /// one at any time, 3.1) and becomes Medical, as **Switch to Medical** makes it, then the note's
  /// create is sent again as the fix of the refused one, after them and in one transaction, so the
  /// server takes the note once the visit names its patient, and what waited behind it goes too
  /// (D49). A visit that names a patient on this phone already (its set still on its way) keeps it:
  /// [patientId] must be that patient, and only the create is sent again.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock check fails;
  /// `not_charting` and `medical_credential` as [startEncounter]; an [ArgumentError] for a [patientId]
  /// other than the visit's own; a [StateError] for a change [settledByPatient] does not take, or a
  /// visit the phone does not hold.
  void choosePatientFor(String changeId, String patientId) {
    _guardFrozen();
    final refused = store.entry(changeId);
    if (refused == null || !settledByPatient(refused)) throw StateError('not a refused note for want of a patient');
    _mayChart(medical: true);
    final value = refused.value! as Map<String, Object?>;
    final encounterId = value['encounterId']! as String;
    final visit = _visit(encounterId);
    final current = EncounterRepository._patientOf(visit);
    final target = store.canonicalPatient(patientId);
    if (current != null && store.canonicalPatient(current) != target) {
      throw ArgumentError('the visit has a patient: change it on its own');
    }
    store.transaction(() {
      if (current == null) store.setField(encounterId, 'patientId', target);
      if (VisitKind.fromCode(visit.fields['kind']?.value) != VisitKind.medical) {
        store.setField(encounterId, 'kind', VisitKind.medical.code);
      }
      store.fixRejected(changeId, value);
    });
    onChanged?.call();
  }

  /// **Remove this note** (4.1, 9.13) for [changeId], a note's create the server refused for a note
  /// type the team does not have: the note sent again on the version the team's list gives for its
  /// key now, as the fix of the refused one, carrying the answers the phone holds, so they reach the
  /// server and its history, then each blanked by a set (review finding PS-4). The server takes it,
  /// the refusal settles, and the note counts for nothing (3.1), as a note removed from
  /// the encounter screen does; choosing its type again then opens it on the version the team has
  /// (**Choose a note type**, `addNote`).
  ///
  /// A note can only be sent on a version that holds every answer the phone keeps of it (the server
  /// refuses an unknown answer, cleared or not), so the team's list must name its key at another
  /// version that does: the team moved the type on while the phone was offline. A note whose type
  /// the team no longer lists at all can't be settled this way, nor one the server refused on the
  /// very version the list names (a build fault: the phone only offers listed versions, forms 3.4);
  /// either stays in Needs attention until the store can withdraw a create the server never took.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock check fails;
  /// `not_charting` and `medical_credential` as [startEncounter]; `not_author` for a note the person
  /// does not act as the author of; [RecordLocked] for a note finished as this phone knows it;
  /// `definition_error` when the team's list gives no such version; a [StateError] for a change
  /// [settledByRemoving] does not take.
  Future<void> removeRefusedNote(String changeId) async {
    _guardFrozen();
    final listed = await noteTypes();
    _guardFrozen();
    final refused = store.entry(changeId);
    if (refused == null || !settledByRemoving(refused)) throw StateError('not a refused note type');
    final rec = _noteRecord(refused.recordId);
    if (!_actsAsAuthor(rec)) {
      throw const LocalValidationError('Only the note’s author can remove it.', problem: 'not_author');
    }
    if (store.noteState(rec.id)!.status != NoteStatus.draft) throw const RecordLocked();
    final value = refused.value! as Map<String, Object?>;
    final key = value['noteTypeKey'] as String?;
    final paths = _answerPathsOf(rec);
    final carrier = listed
        .where(
          (t) => t.key == key && t.version != value['noteTypeVersion'] && paths.every((p) => fieldAt(t, p) != null),
        )
        .firstOrNull;
    if (carrier == null) {
      throw const LocalValidationError(
        'This note can’t be removed on this phone. Tell a Program Admin.',
        problem: 'definition_error',
      );
    }
    _mayChart(medical: isMedicalType(carrier));
    // The answers the phone holds reach the server and its history first, then are blanked as sets:
    // nothing that never synced is deleted, which only a remote wipe and the tenth wrong PIN may do
    // (the coordinator's decision on review finding PS-4).
    final held = EncounterRepository._answersOf(rec);
    store.transaction(() {
      store.fixRejected(changeId, {
        'encounterId': value['encounterId'],
        'noteTypeKey': carrier.key,
        'noteTypeVersion': carrier.version,
        'data': {for (final p in paths) p: held[p]},
      });
      for (final p in paths) {
        if (held[p] != null) store.setField(rec.id, 'data.$p', null);
      }
    });
    onChanged?.call();
  }

  OutboxEntry _visitRefusal(String changeId) {
    final refused = store.entry(changeId);
    if (refused == null || !settledByVisit(refused)) throw StateError('not a refused record at a visit');
    return refused;
  }

  /// The patient of a record made at a visit: its own, or for a problem's note, its problem's.
  static String _patientOfRefusal(OutboxEntry e) =>
      (e.value! as Map<String, Object?>)['patientId'] as String? ??
      e.patientId ??
      (throw StateError('the record names no patient'));

  /// Every answer the phone keeps of [note], or that a change of it still carries: what a create
  /// sent again carries (the store's `fixRejected`).
  Set<String> _answerPathsOf(LocalRecord note) => {
    ...EncounterRepository._answersOf(note).keys,
    for (final e in store.outbox())
      if (e.recordId == note.id && e.state != ChangeState.superseded)
        if ((e.op, e.value) case ('create', {'data': final Map<String, Object?> data}))
          ...data.keys
        else if (e.op == 'set' && (e.field?.startsWith(_data) ?? false))
          e.field!.substring(_data.length),
  };
}
