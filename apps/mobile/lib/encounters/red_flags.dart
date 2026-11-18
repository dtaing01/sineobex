part of 'encounter_repository.dart';

// The Red flags and disposition note (phase 4 design, forms 6.2; lifecycle 3.1, 3.3 hard stop 5):
// one note type, with `auto: 'medical'`, that the app adds for a person beside their Medical notes,
// rather than the same questions asked again in every Medical note of a visit.

/// The team's Red flags and disposition note type among [listed] (`TeamNoteTypes.listed`): the type
/// the app adds by itself, found by its `auto` as the store and the server find it, at its newest
/// listed version. Null when the team lists none: then no Medical note of the team can be finished
/// (hard stop 5), and Complete says so.
NoteTypeDef? redFlagsTypeOf(Iterable<NoteTypeDef> listed) {
  NoteTypeDef? newest;
  for (final type in listed) {
    if (_isRedFlags(type) && (newest == null || type.version > newest.version)) newest = type;
  }
  return newest;
}

/// [notes] with the Red flags note last (forms 6.2: it shows last on the encounter screen and the
/// summary), the others in the order given. A note whose definition the phone lacks stays where it
/// is.
List<NoteView> redFlagsLast(List<NoteView> notes) => [
  for (final n in notes)
    if (n.definition == null || !_isRedFlags(n.definition!)) n,
  for (final n in notes)
    if (n.definition != null && _isRedFlags(n.definition!)) n,
];

extension RedFlagsNote on EncounterRepository {
  /// The person's own Red flags note in the visit [encounterId]: one they act as the author of,
  /// draft or finished, empty or not, with the definitions of the visit's notes loaded first. Null
  /// when they have none, or the phone holds no such visit. Throws [ChartingPaused] while the store
  /// is frozen.
  Future<String?> ownRedFlagsNote(String encounterId) async {
    _guardFrozen();
    await definitions.loadAll(EncounterRepository._versions(_Held.scan(store, encounterId: encounterId).notes));
    return _redFlagsIn(_Held.scan(store, encounterId: encounterId), null).own;
  }

  /// **The person's own Red flags note** in the visit [encounterId] (forms 6.2), on [redFlags], the
  /// team's type ([redFlagsTypeOf]): added unless the visit has a finished Red flags note (on the
  /// phone, or [redFlagsFinished] when the visit read shows one this phone does not hold) or one of
  /// their own already, an empty draft included. Returns their own, added now or there already; null
  /// when a finished one makes it needless.
  ///
  /// The summary calls it when Complete stops at hard stop 5 with no note to open
  /// ([CompleteStop.redFlagsFirst] with no [CompleteBlock.noteId]), then plans again: the note is then
  /// finished with the Medical notes, last, and its finish check asks the red-flag question. [addNote]
  /// adds it by itself with a Medical note of the person's own.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting`, `medical_credential`, `not_offered`
  /// and `medical_note_needs_patient` as [addNote] refuses a Medical note; an [ArgumentError] when
  /// [redFlags] is not a Red flags note type. A [StateError] when the phone holds no such visit.
  Future<String?> addRedFlagsNote(String encounterId, NoteTypeDef redFlags, {bool redFlagsFinished = false}) async {
    if (!_isRedFlags(redFlags)) throw ArgumentError.value(redFlags.key, 'redFlags', 'not the Red flags note type');
    _guardFrozen();
    _medicalNoteAllowed(_visit(encounterId));
    await definitions.loadAll(EncounterRepository._versions(_Held.scan(store, encounterId: encounterId).notes));
    _guardFrozen();
    final held = _redFlagsIn(_Held.scan(store, encounterId: encounterId), redFlags);
    if (held.own != null) return held.own;
    if (held.finished || redFlagsFinished) return null;
    final id = store.createNote(encounterId: encounterId, noteTypeKey: redFlags.key, noteTypeVersion: redFlags.version);
    onChanged?.call();
    return id;
  }

  /// Whether the person needs their own Red flags note in the visit, with the definitions of its
  /// notes loaded first: none finished, and none of theirs.
  Future<bool> _needsRedFlags(String encounterId, NoteTypeDef redFlags) async {
    await definitions.loadAll(EncounterRepository._versions(_Held.scan(store, encounterId: encounterId).notes));
    final held = _redFlagsIn(_Held.scan(store, encounterId: encounterId), redFlags);
    return held.own == null && !held.finished;
  }

  /// The visit's Red flags notes as this phone knows them: whether one is finished (by the server's
  /// status, or a sign-off made here that was not refused, as Complete reads hard stop 5), and the
  /// person's own. A note is one by its definition's `auto`, or by [redFlags]' key while the phone
  /// lacks its version.
  ({bool finished, String? own}) _redFlagsIn(_Held held, NoteTypeDef? redFlags) {
    var finished = false;
    String? own;
    for (final rec in held.ordered(held.notes)) {
      final definition = _loadedDefinition(rec);
      final isRedFlags = definition != null
          ? _isRedFlags(definition)
          : redFlags != null && rec.attributes['noteTypeKey'] == redFlags.key;
      if (!isRedFlags) continue;
      if (store.noteState(rec.id)!.status != NoteStatus.draft) finished = true;
      if (_actsAsAuthor(rec)) own ??= rec.id;
    }
    return (finished: finished, own: own);
  }
}
