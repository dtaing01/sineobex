part of 'encounter_repository.dart';

// Expand on the Quick encounter (phase 4 design, forms 6.4, 7.1): "Staff can expand any part of a
// quick encounter into its full module partway through without re-entering what they filled in"
// (PRD main 409). The interpreter's `expandQuick` says what to write; this writes it as ordinary
// changes, through the store.

/// One Expand a quick form offers: the part (a section of the quick note type) it sits on, and the
/// full note type that part's answers map into.
typedef ExpandTarget = ({String section, String noteTypeKey});

/// The Expands of the quick note type [quick], in its order: for each section, each note type a
/// field of it maps into (`mapsTo`), once. Empty for a note type that is not quick, which maps
/// nothing (`validate.maps_to_not_quick`).
List<ExpandTarget> expandTargets(NoteTypeDef quick) => [
  if (quick.quick)
    for (final s in quick.sections)
      for (final key in {for (final mapsTo in _mapsTo(s.fields)) mapsTo.key}) (section: s.id, noteTypeKey: key),
];

/// Each `mapsTo` among [fields] and inside their groups, as its note type key and target path. A
/// grid maps as a whole: its cell never does.
Iterable<({String key, String path})> _mapsTo(Iterable<FieldDef> fields) sync* {
  for (final f in fields) {
    final mapsTo = f.mapsTo;
    final colon = mapsTo?.indexOf(':') ?? -1;
    if (colon > 0) yield (key: mapsTo!.substring(0, colon), path: mapsTo.substring(colon + 1));
    if (f is GroupDef) yield* _mapsTo(f.fields);
  }
}

/// A quick answer Expand did not write, for the person to see (forms 6.4, 10.1 #12).
class ExpandLeftOut {
  const ExpandLeftOut({required this.path, required this.target, required this.problem, required this.label});

  /// The quick note's path.
  final String path;

  /// The full note's path it would have gone to, without an entry's part.
  final String target;

  /// Why: `checkAnswer`'s problem code against the full note's version (`wrong_type` for a number in
  /// another unit, `too_long`, `unknown_option`, ...).
  final String problem;

  /// The quick field's label.
  final String label;
}

/// What Expand did.
class Expanded {
  const Expanded({
    required this.noteId,
    required this.existing,
    required this.written,
    required this.leftOut,
    required this.notCopied,
  });

  /// The full note, which the screen opens.
  final String noteId;

  /// The visit had a draft of the type with answers already, the one the note types list would open:
  /// it opens as it is, and nothing was written into it.
  final bool existing;

  /// What was written into the full note: path (entry part included) to value.
  final Map<String, Object> written;

  /// Quick answers the full note's version doesn't take: not written, and listed for the person.
  final List<ExpandLeftOut> leftOut;

  /// Quick answers, in a part the person can't chart (a section that needs an ordering credential
  /// they lack), that were not carried: quick paths, for the person to be told.
  final List<String> notCopied;
}

extension QuickExpand on EncounterRepository {
  /// Whether the form of [note] offers Expand: a quick note the person may change now, with a part
  /// that maps into a full note type. Each part's Expands are [expandTargets].
  bool mayExpand(NoteView note) =>
      note.editable && note.definition != null && expandTargets(note.definition!).isNotEmpty;

  /// **Expand** on a quick note (forms 6.4): the parts of [quickNoteId] that map into [full] (the
  /// team's listed version of that note type) carried into a full note of it in the same visit,
  /// every mapped answer written, the quick note keeping its own. Returns the full note to open.
  ///
  /// - The full note is a new one, made with its answers in one change, unless the visit has a draft
  ///   of the type the note types list would open ([addNote]'s rule). The person's own empty draft
  ///   of it is filled, by its own version, as a new note would be. A draft with answers opens as it
  ///   is ([Expanded.existing]): Expand never writes over an answer.
  /// - What is written is what the interpreter's `expandQuick` gives for the answers of the quick
  ///   note the person may see, each repeating section of the full note it writes into given a new
  ///   entry ([newEntryId], at [clock]'s time). What the full note's version doesn't take is left out
  ///   and listed ([Expanded.leftOut]). A part the person can't chart (it `needs` an ordering
  ///   credential they lack, forms 10.1 #53) is not carried ([Expanded.notCopied]).
  /// - A full note of a Medical type brings the person's own Red flags note with it, as [addNote]
  ///   does, given [redFlags].
  ///
  /// PLAN-OPEN: what Expand does when the visit already has a note of the full type (lifecycle 12.1
  /// #30). The draft the note types list would open opens, as it is unless it is the person's own
  /// and empty: copying again would write a second wound or set of vitals, or over an answer.
  ///
  /// Throws, writing nothing: [ChartingPaused]; `not_charting`, `medical_credential`, `not_offered`
  /// and `medical_note_needs_patient` as [addNote]; [RecordLocked] for a quick note that is finished
  /// or sent for review (Expand is offered while it is charted); `read_only` when an answer to write
  /// is one the server would hold from the person (an older quick version, whose maps the validator
  /// no longer checks). An [ArgumentError] for a note that is not quick or a [full] it maps nothing
  /// into; a [StateError] when the phone lacks the note, its definition, or the person may not see it.
  Future<Expanded> expand(
    String quickNoteId,
    NoteTypeDef full, {
    NoteTypeDef? redFlags,
    String Function()? newEntryId,
    DateTime Function()? clock,
  }) async {
    _guardFrozen();
    final quickRec = _noteRecord(quickNoteId);
    final quick = await _definitionOf(quickRec);
    final parts = {
      for (final t in expandTargets(quick))
        if (t.noteTypeKey == full.key) t.section,
    };
    if (parts.isEmpty) throw ArgumentError.value(full.key, 'full', 'the quick note maps nothing into this note type');
    final medical = isMedicalType(full);
    _mayChart(medical: medical);
    final encounterId = quickRec.attributes['encounterId'] as String? ?? '';
    final visit = _visit(encounterId);
    if (medical) _medicalNoteAllowed(visit);
    final state = store.noteState(quickNoteId)!;
    if (state.status != NoteStatus.draft || state.sentForReview) throw const RecordLocked();
    final stored = EncounterRepository._answersOf(quickRec);
    // All of it to its acting author; to anyone else what the server sent them, as they read it.
    final seen = _actsAsAuthor(quickRec) ? stored : _visibleTo(quick, stored);
    if (seen == null) throw StateError('the person may not see this note');
    final flags = medical && redFlags != null ? redFlags : null;

    final open = await _draftToOpen(encounterId, full.key);
    LocalRecord? into;
    if (open != null) {
      final rec = _noteRecord(open);
      if (!_actsAsAuthor(rec) || !noteIsEmpty(EncounterRepository._answersOf(rec))) {
        if (flags != null && _actsAsAuthor(rec)) await RedFlagsNote(this).addRedFlagsNote(encounterId, flags);
        return Expanded(noteId: open, existing: true, written: const {}, leftOut: const [], notCopied: const []);
      }
      into = rec;
    }
    final target = into == null ? full : await _definitionOf(into);

    // A part the person can't chart is not theirs to carry (forms 10.1 #53, lifecycle 6.4 rule 5).
    final barred = {
      for (final s in quick.sections)
        if (s.needs == 'orderMedications' && !user.can.orderMedications) s.id,
    };
    String sectionOf(String path) => path.split('.').first;
    final notCopied = [
      for (final path in effectiveAnswers(quick, seen).keys)
        if (barred.contains(sectionOf(path)) && parts.contains(sectionOf(path))) path,
    ];
    final carried = {
      for (final MapEntry(:key, :value) in seen.entries)
        if (!barred.contains(sectionOf(key))) key: value,
    };

    // A new entry in each repeating section of the full note an answer goes into, at an ID no answer
    // of the note uses, a removed entry's included (as the form's Add makes one, forms 2.3).
    final used = into == null ? const <String>{} : EncounterRepository._answersOf(into).keys.toSet();
    final makeId = newEntryId ?? _makeEntryId;
    final at = (clock ?? DateTime.now)().toUtc().toIso8601String();
    final targetSections = {
      for (final s in quick.sections)
        for (final m in _mapsTo(s.fields))
          if (m.key == full.key) m.path.split('.').first,
    };
    final entries = <String, ({String id, String at})>{
      for (final s in target.sections)
        if (s.repeat != null && targetSections.contains(s.id)) s.id: (id: _unusedEntryId(s.id, used, makeId), at: at),
    };
    final expansion = expandQuick(quick, carried, target, entries);
    if (expansion.answers.keys.any((path) => _heldFromPerson(target, path, actsAsAuthor: true))) {
      throw EncounterRepository._readOnly;
    }
    final leftOut = [
      for (final l in expansion.leftOut)
        ExpandLeftOut(
          path: l.path,
          target: l.target,
          problem: l.problem.code,
          label: fieldAt(quick, l.path)?.field?.label ?? l.path,
        ),
    ];

    final withFlags = flags != null && await _needsRedFlags(encounterId, flags);
    _guardFrozen();
    final id = store.transaction(() {
      final String id;
      if (into == null) {
        id = store.createNote(
          encounterId: encounterId,
          noteTypeKey: full.key,
          noteTypeVersion: full.version,
          data: expansion.answers,
        );
      } else {
        id = into.id;
        for (final MapEntry(:key, :value) in expansion.answers.entries) {
          store.setField(id, '$_data$key', value);
        }
      }
      if (withFlags) {
        store.createNote(encounterId: encounterId, noteTypeKey: flags.key, noteTypeVersion: flags.version);
      }
      return id;
    });
    onChanged?.call();
    return Expanded(noteId: id, existing: false, written: expansion.answers, leftOut: leftOut, notCopied: notCopied);
  }

  /// What a reader who does not act as the author sees of a note; null when they may not see it,
  /// or the phone can't lay it out.
  Answers? _visibleTo(NoteTypeDef definition, Answers stored) {
    try {
      return visibleAnswers(definition, stored, user.reader(actsAsAuthor: false));
      // A definition the interpreter can't run is one the phone can't lay the note out by.
      // ignore: avoid_catches_without_on_clauses
    } catch (_) {
      return null;
    }
  }
}

/// An entry ID in [section] that no answer in [used] has, from [make].
String _unusedEntryId(String section, Set<String> used, String Function() make) {
  for (var tries = 0; tries < 100; tries++) {
    final id = make();
    if (!used.any((path) => path.startsWith('$section.$id.'))) return id;
  }
  throw StateError('no unused entry ID was made');
}

/// An entry's ID as the form makes one (forms 2.3): `e` and seven characters from a-z0-9.
String _makeEntryId() {
  final random = Random.secure();
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'e${String.fromCharCodes([for (var i = 0; i < 7; i++) chars.codeUnitAt(random.nextInt(chars.length))])}';
}
