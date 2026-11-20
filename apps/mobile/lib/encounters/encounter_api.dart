/// The encounter routes that only work online (phase 4 design, lifecycle 5; 3.7, 8.2, 9.7, 9.9): a
/// visit that is not on the phone, co-sign and attest, the two queues, Home's counts, earlier visits
/// and the server's list of notes to finish, through the generated client. The server checks each
/// permission and logs each read in its own transaction; this layer turns each answer into the read
/// model a screen draws and each refusal into the sentence it shows, as phase 3's online calls do.
/// Nothing is asked while the store is frozen, since nothing may be shown then.
library;

import 'dart:async' show TimeoutException;

import '../api/generated/api.dart' as wire;
import '../api/transport.dart';
import '../auth/auth_provider.dart' show AuthErrorCode, AuthException;
import '../forms/definition.dart';
import '../forms/forms_api.dart' show NoteTypeVersion;
import '../forms/read_model.dart';
import '../forms/recap.dart' show RecapLine;
import '../sync/local_store.dart' show ChartingPaused, LocalStore;
import 'credentials.dart';
import 'encounter_models.dart';
import 'encounter_repository.dart';
import 'note_definitions.dart';
import 'rules.dart';

/// The version of the co-signer's sentence, stored with each co-signature (lifecycle 3.5).
///
/// PLAN-OPEN: the wording a signer, a co-signer and an attester are shown (lifecycle 12.1 #5): the
/// sentences of 3.5, each with its version.
const cosignStatementVersion = 'cosign-2026-11';

/// The version of the attester's sentence (lifecycle 3.5).
const attestStatementVersion = 'attest-2026-11';

/// How long a screen waits for the server's read of a visit before it reads the phone's copy instead
/// (the coordinator's decision on the review of unit L5, SRD-3): a weak signal must not keep a
/// clinician from the visit they hold.
const serverReadLimit = Duration(seconds: 6);

/// What a co-signer is shown above **Co-sign** (lifecycle 3.5, 9.9).
const cosignSentence = 'I reviewed this note and agree with it.';

/// What an attending is shown above **Attest** (lifecycle 3.5, 9.9).
const attestSentence = 'I reviewed this note and agree with the assessment and plan.';

/// Why a request that only works online didn't go through.
enum EncounterProblem {
  /// No connection.
  offline,

  /// The session ended, or the act asks for a recent sign-in (401, 403 `reauth_required`).
  signInAgain,

  /// The role, the credential or the rule refuses it (403).
  notAllowed,

  /// The team has no such record (404).
  notFound,

  /// The visit changed since it was read (409 `content_changed`, `not_waiting`): read it again.
  changed,

  /// The request didn't fit (400, 422, another 409): an app fault.
  invalid,

  /// The server failed. Try again.
  failed,
}

/// An online request that didn't go through: why, and the sentence the screen shows. Holds no
/// value of a record, only the server's code and the notes a refusal names.
class EncounterRequestFailed implements Exception {
  const EncounterRequestFailed(this.problem, this.message, {this.code, this.noteIds = const []});

  final EncounterProblem problem;
  final String message;

  /// The server's code for a refusal it named (`content_changed`, `cannot_see_all`, ...).
  final String? code;

  /// The notes a co-sign's or an attest's refusal is about.
  final List<String> noteIds;

  @override
  String toString() => 'EncounterRequestFailed(${problem.name}, $code)';
}

/// What a second person does to a visit's waiting notes, online (lifecycle 3.7).
enum SecondAct { cosign, attest }

/// **Co-sign** or **Attest** on a visit (lifecycle 5.3, 5.4, 9.7, 9.9): one tap acts on every waiting
/// note of the visit the person may act on, each with the hash of the note as they read it.
class SecondActPlan {
  const SecondActPlan._({
    required this.act,
    required this.encounterId,
    required this.notes,
    required this.cannotSeeAll,
    required this.readOnline,
  });

  final SecondAct act;
  final String encounterId;

  /// The waiting notes the person may act on, in the visit's order, each with the hash the server's
  /// read gave; null while the visit was read from the phone or the chart.
  final List<({String noteId, String? contentHash})> notes;

  /// Waiting notes the person may not act on because each holds a part they can't open (6.4 rule 4).
  final List<String> cannotSeeAll;

  /// The visit was read from the phone or the chart's recent visits: it is read from the server
  /// first ([EncounterApi.readVisit]), so the person signs what the server holds and was shown.
  final bool readOnline;

  List<String> get noteIds => [for (final n in notes) n.noteId];

  /// The button acts now.
  bool get canAct => !readOnline && notes.isNotEmpty;

  String get statementVersion => act == SecondAct.cosign ? cosignStatementVersion : attestStatementVersion;

  /// The sentence shown above the button (3.5).
  String get sentence => act == SecondAct.cosign ? cosignSentence : attestSentence;

  /// What a note of [cannotSeeAll] says (9.7).
  String get cannotSeeAllMessage => _partHidden;
}

/// A waiting note in a queue (lifecycle 5.4).
class QueueNoteItem {
  const QueueNoteItem({
    required this.noteId,
    required this.noteTypeKey,
    required this.author,
    required this.completedAt,
    required this.signedBefore,
    required this.attestedBefore,
    required this.canAct,
    this.heldBecause,
  });

  final String noteId;
  final String noteTypeKey;
  final PersonRef author;
  final DateTime? completedAt;

  /// Who signed it before, when a correction sent it back (3.7).
  final PersonRef? signedBefore;

  /// Who attested it last, when a correction sent it back.
  final PersonRef? attestedBefore;

  /// The person may act on it; false for one they wrote or signed, or one with a part they can't
  /// open, which the queue says why of.
  final bool canAct;

  /// Why someone else has to act on it, as the server says (5.4, in the visit read's words); null when
  /// the person may, or the reason is about their credential or role rather than the note.
  final HeldBecause? heldBecause;
}

/// One visit of a queue: the patient by preferred name, as the reader's projection allows.
class QueueRow {
  const QueueRow({
    required this.encounterId,
    required this.patientId,
    required this.preferredName,
    required this.startedAt,
    required this.notes,
  });

  final String encounterId;
  final String? patientId;
  final String? preferredName;
  final DateTime startedAt;
  final List<QueueNoteItem> notes;

  bool get canActOnAny => notes.any((n) => n.canAct);
}

/// Home's tiles under Needs attention (lifecycle 9.9). Numbers only: no patient is named, so
/// nothing is logged (5.6).
class HomeTiles {
  const HomeTiles({
    required this.online,
    required this.notesToFinish,
    required this.showsCosign,
    required this.cosignWaiting,
    required this.showsAttestation,
    required this.attestationWaiting,
  });

  /// The server's counts reached the phone.
  final bool online;

  /// The person's notes to finish and how many are older than a day: the tile shows while there is
  /// one.
  final ({int notes, int overdue}) notesToFinish;

  /// **Waiting for your co-signature**, to a credential that signs.
  final bool showsCosign;

  /// The visits waiting; null offline: "Connect to see notes waiting for you".
  final int? cosignWaiting;

  /// **Waiting for attestation**, to a credential that attests.
  final bool showsAttestation;
  final int? attestationWaiting;
}

/// The online encounter routes for one person in the open team.
class EncounterApi {
  EncounterApi(this.api, this.store, {required this.user, required this.definitions});

  final wire.SineobexApi api;
  final LocalStore store;
  final EncounterUser user;

  /// The notes' own definitions, to tell a Medical note from another (3.1) and to lay out a form.
  final NoteDefinitions definitions;

  // ---- a visit (5.1, 8.2, 9.7) ----

  /// The visit [encounterId] as the server reads it for the person (5.1), shown from memory: the
  /// phone keeps nothing of it, and the server logged the read. Throws [EncounterRequestFailed]
  /// (offline: "This visit isn't on this phone. Connect to open it.", 8.2), [ChartingPaused] while
  /// the store is frozen.
  Future<VisitView> readVisit(String encounterId) async {
    _guardFrozen();
    final read = await _ask(
      () => api.getEncounter(encounterId: encounterId),
      offline: _visitNotOnPhone,
      notFound: _visitNotFound,
      notAllowed: _cantOpen,
    );
    await definitions.loadAll(_versionsOf(read));
    _guardFrozen();
    return visitFromRead(read, source: VisitSource.server, user: user, definitionOf: definitions.loaded);
  }

  /// One of the chart's recent visits (5.2), read offline: each record shown is logged here as the
  /// server logs its read (10.1), with source `cache`, in the transaction that reads it; [shownBefore]
  /// holds the IDs on screen already. Throws [ChartingPaused] while the store is frozen.
  Future<VisitView> recentVisit(wire.VisitRead read, {Set<String> shownBefore = const {}}) async {
    _guardFrozen();
    await definitions.loadAll(_versionsOf(read));
    _guardFrozen();
    return store.transaction(() {
      final view = visitFromRead(read, source: VisitSource.chart, user: user, definitionOf: definitions.loaded);
      _logChartRead(view, shownBefore);
      return view;
    });
  }

  /// Whether the server's read of the visit [encounterId] shows a finished Red flags note (lifecycle
  /// 8.2, D113, forms 6.2), which a screen passes as `redFlagsFinished` to `addNote`, `openComplete`,
  /// `addRedFlagsNote` and `expand`: a teammate's that this phone does not hold makes the person's own
  /// needless. One read of the server's, logged there. False without signal, for a visit the server
  /// does not have, or when no answer comes within [limit]: offline the phone's own copy decides, as
  /// before, which the server tolerates.
  Future<bool> redFlagsFinished(String encounterId, {Duration limit = serverReadLimit}) async {
    try {
      return showsFinishedRedFlags(await readVisit(encounterId).timeout(limit));
    } on EncounterRequestFailed {
      return false;
    } on TimeoutException {
      return false;
    } on ChartingPaused {
      // Nothing is shown from it; the screen says why.
      return false;
    }
  }

  /// Opens a visit wherever it is (8.2, 9.7): the phone's own copy, for a visit it holds; else the
  /// chart's [recent] visits; else the server's read, which needs a connection.
  Future<VisitView> openVisit(
    String encounterId, {
    required EncounterRepository phone,
    Iterable<wire.VisitRead> recent = const [],
    Set<String> shownBefore = const {},
  }) async {
    final held = await phone.openVisit(encounterId, shownBefore: shownBefore);
    if (held != null) return held;
    final cached = recent.where((r) => r.encounterId == encounterId).firstOrNull;
    if (cached != null) return recentVisit(cached, shownBefore: shownBefore);
    return readVisit(encounterId);
  }

  // ---- co-sign and attest (3.7, 5.3, 5.4) ----

  /// **Co-sign** on [visit]: null when the person may co-sign none of its notes. For a visit read
  /// from the server, the notes its read marks `canCosign` (5.1 as built for L6), each with the hash
  /// it gives, and those held from the reader for a part they can't open (`heldBecause`); the server
  /// asked its own rule of the reader. For a copy read from the phone or a chart, which says nothing
  /// of it, the notes the same rule would offer (`cosignEffect`, as if each hash matched): a plan
  /// that reads the visit from the server first ([SecondActPlan.readOnline]), whose answer then
  /// decides. Never for a role that doesn't chart or a credential that can't sign.
  SecondActPlan? cosignPlan(VisitView visit) {
    if (!user.charts || !user.can.sign) return null;
    return _plan(SecondAct.cosign, visit, (note, seesAll) {
      final effect = cosignEffect(
        noteStatus: note.status,
        medicalNote: note.medical ?? visit.medical,
        actsAsAuthor: _actsAsAuthor(note),
        canSign: user.can.sign,
        needsAttestation: user.can.billingNeedsAttestation,
        seesAllThatCounts: seesAll,
        hashMatches: true,
      );
      return effect is CosignRefused ? effect.problem.code : null;
    });
  }

  /// **Attest** on [visit]: null when the person may attest none of its notes. For a visit read from
  /// the server, the notes its read marks `canAttest` (5.1 as built for L6); for any other copy, a
  /// plan that reads it there first, by the rule (`attestEffect`): a note waiting for attestation
  /// that is not theirs and whose current signature is not their own. Never for a role that doesn't
  /// chart or a credential that can't attest.
  SecondActPlan? attestPlan(VisitView visit) {
    if (!user.charts || !user.can.attest) return null;
    return _plan(
      SecondAct.attest,
      visit,
      (note, seesAll) => attestEffect(
        noteStatus: note.status,
        attestation: note.attestation,
        actsAsAuthor: _actsAsAuthor(note),
        isSigner: _currentSigner(note) == user.userId,
        canAttest: user.can.attest,
        seesAllThatCounts: seesAll,
        hashMatches: true,
      )?.code,
    );
  }

  /// Co-signs or attests every note of [plan], all or nothing, and returns what each note is now.
  /// Throws [EncounterRequestFailed]: `changed` ("This visit changed. Read it again.", 9.9) when a
  /// note changed or stopped waiting since the visit was read, naming the notes, so the screen reads
  /// the visit again; `notAllowed` with the rule's sentence; `offline` ("Connect to co-sign."). A
  /// [StateError] for a plan that can't act ([SecondActPlan.canAct]).
  Future<Map<String, ({NoteStatus status, Attestation attestation})>> secondAct(SecondActPlan plan) async {
    _guardFrozen();
    if (!plan.canAct) throw StateError('read the visit from the server first: only what was read there is signed');
    final body = wire.NoteActInput(
      notes: [for (final n in plan.notes) wire.NoteActInputNotesItem(noteId: n.noteId, contentHash: n.contentHash!)],
      statementVersion: plan.statementVersion,
    );
    final cosign = plan.act == SecondAct.cosign;
    final result = await _ask(
      () => cosign
          ? api.cosignEncounter(encounterId: plan.encounterId, body: body)
          : api.attestEncounter(encounterId: plan.encounterId, body: body),
      offline: cosign ? _connectToCosign : _connectToAttest,
      notFound: _visitNotFound,
      notAllowed: cosign ? _cantCosign : _cantAttest,
      refusals: cosign ? _cosignRefusals : _attestRefusals,
    );
    return {
      for (final n in result.notes) n.noteId: (status: _status(n.status), attestation: _attestation(n.attestation)),
    };
  }

  // ---- the queues and Home (5.4, 5.6, 9.9) ----

  /// The co-sign queue: one row per visit, oldest first. The server logs the patients it shows.
  Future<List<QueueRow>> cosignQueue() => _queue(api.getCosignQueue);

  /// The attestation queue.
  Future<List<QueueRow>> attestationQueue() => _queue(api.getAttestationQueue);

  /// Home's tiles (9.9), from `GET /v1/me/counts` when online. [notesToFinish] merges the server's
  /// count of the person's drafts with the phone's own (`NotesToFinish.count`), given null offline.
  /// Never throws for want of signal or of an answer: Home shows the phone's numbers and "Connect to
  /// see notes waiting for you" then. Throws [ChartingPaused] while the store is frozen.
  Future<HomeTiles> homeTiles({
    required ({int notes, int overdue}) Function(wire.HomeCounts? server) notesToFinish,
  }) async {
    _guardFrozen();
    wire.HomeCounts? counts;
    try {
      counts = await api.getHomeCounts();
    } on NetworkException {
      counts = null;
    } on AuthException {
      counts = null;
    } on ApiException {
      counts = null;
    }
    _guardFrozen();
    return HomeTiles(
      online: counts != null,
      notesToFinish: notesToFinish(counts),
      showsCosign: user.charts && user.can.sign,
      cosignWaiting: counts?.cosignWaiting,
      showsAttestation: user.charts && user.can.attest,
      attestationWaiting: counts?.attestationWaiting,
    );
  }

  /// The person's drafts as the server holds them (5.6), which `NotesToFinish` merges with the
  /// phone's own. The server logs the patients it shows.
  Future<List<wire.NoteToFinish>> notesToFinish() async {
    _guardFrozen();
    final list = await _ask(api.getNotesToFinish, offline: _connectForList, notAllowed: _cantChart);
    _guardFrozen();
    return list.notes;
  }

  /// **Show earlier visits** (5.2): the next 50 of [patientId]'s visits after [before], newest first,
  /// as the reader may see them. The server logs the read (`chart.timeline_viewed`).
  Future<List<wire.TimelineVisit>> earlierVisits(String patientId, {required String before}) async {
    _guardFrozen();
    final page = await _ask(
      () => api.getPatientTimeline(patientId: patientId, before: before),
      offline: _connectForEarlier,
      notFound: _chartNotFound,
      notAllowed: _cantOpen,
    );
    _guardFrozen();
    return page.encounters;
  }

  // ---- inside ----

  Future<List<QueueRow>> _queue(Future<wire.SignatureQueue> Function() ask) async {
    _guardFrozen();
    final queue = await _ask(ask, offline: _connectForQueue, notAllowed: _cantChart, refusals: _queueRefusals);
    _guardFrozen();
    return [
      for (final r in queue.rows)
        QueueRow(
          encounterId: r.encounterId,
          patientId: r.patientId,
          preferredName: r.preferredName,
          startedAt: r.startedAt,
          notes: [
            for (final n in r.notes)
              QueueNoteItem(
                noteId: n.noteId,
                noteTypeKey: n.noteTypeKey,
                author: _ref(n.author),
                completedAt: n.completedAt,
                signedBefore: n.signedBefore == null ? null : _ref(n.signedBefore!),
                attestedBefore: n.attestedBefore == null ? null : _ref(n.attestedBefore!),
                canAct: n.canAct,
                heldBecause: HeldBecause.fromCode(n.heldBecause),
              ),
          ],
        ),
    ];
  }

  /// For a visit read from the server, its own answer for the reader: the notes it marks for [act],
  /// and those it holds from them for a part they can't open. For any other copy, [refusal] says, for
  /// a note waiting for [act], why the person may not act on it (the rule's code), as if its hash
  /// matched; null when they may. A note that does not wait is `not_waiting`.
  SecondActPlan? _plan(SecondAct act, VisitView visit, String? Function(NoteView note, bool seesAll) refusal) {
    final fromServer = visit.source == VisitSource.server;
    final notes = <({String noteId, String? contentHash})>[];
    final hidden = <String>[];
    bool waits(NoteView note) => act == SecondAct.cosign
        ? note.status == NoteStatus.completed
        : note.status == NoteStatus.signed && note.attestation == Attestation.waiting;
    for (final note in visit.notes) {
      if (fromServer) {
        final may = act == SecondAct.cosign ? note.canCosign : note.canAttest;
        // Only what the server gave a hash for can be sent (5.3, 5.4).
        if (may && note.contentHash != null) {
          notes.add((noteId: note.noteId, contentHash: note.contentHash));
        } else if (note.heldBecause == HeldBecause.cannotSeeAll && waits(note)) {
          hidden.add(note.noteId);
        }
        continue;
      }
      switch (refusal(note, true)) {
        case null:
          notes.add((noteId: note.noteId, contentHash: null));
        case 'cannot_see_all':
          hidden.add(note.noteId);
      }
    }
    if (notes.isEmpty && hidden.isEmpty) return null;
    return SecondActPlan._(
      act: act,
      encounterId: visit.encounterId,
      notes: notes,
      cannotSeeAll: hidden,
      readOnline: !fromServer,
    );
  }

  /// Nobody co-signs or attests a note they wrote, completed or act as the author of (3.7; as built,
  /// 5.3), as the server's `actNote` asks it.
  bool _actsAsAuthor(NoteView note) =>
      note.author.userId == user.userId ||
      note.actingAuthor.userId == user.userId ||
      _lastSigner(note, (s) => s.act != 'cosign' && s.effect != null && s.effect != 'none') == user.userId;

  /// Who made the note's current signature: the latest that signed it.
  String? _currentSigner(NoteView note) => _lastSigner(note, (s) => s.effect == 'signed');

  static String? _lastSigner(NoteView note, bool Function(SignoffItem s) counts) {
    final matching = [...note.signoffs.where(counts)]
      ..sort((a, b) => (a.signedAt ?? DateTime(0)).compareTo(b.signedAt ?? DateTime(0)));
    return matching.lastOrNull?.signer.userId;
  }

  /// Logs a recent visit read offline as the server logs a read (5.1, 10.1): the visit, its own
  /// addenda, each note and what hangs off it, and each record made at the visit on its own entity
  /// and patient.
  void _logChartRead(VisitView view, Set<String> shownBefore) {
    void log(String action, String entity, String id, String? patientId) {
      if (shownBefore.contains(id)) return;
      store.appendAudit(action, entity: entity, entityId: id, patientId: patientId, source: 'cache');
    }

    final patient = view.patientId;
    log('encounter.viewed', 'encounter', view.encounterId, patient);
    for (final a in view.addenda) {
      log('note.viewed', 'note_addendum', a.id, patient);
    }
    for (final n in view.notes) {
      log('note.viewed', 'encounter_note', n.noteId, patient);
      for (final s in n.signoffs) {
        log('note.viewed', 'note_signoff', s.id, patient);
      }
      for (final a in n.addenda) {
        log('note.viewed', 'note_addendum', a.id, patient);
      }
      for (final c in n.corrections) {
        log('note.viewed', 'note_correction', c.id, patient);
      }
      for (final a in n.attestations) {
        log('note.viewed', 'note_attestation', a.id, patient);
      }
    }
    for (final r in view.records) {
      log('patient.viewed', r.entity.wire, r.id, patientOfMadeAt(r, view.records, store));
    }
  }

  void _guardFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  static Iterable<NoteTypeVersion> _versionsOf(wire.VisitRead read) => [
    for (final n in read.notes) (key: n.noteTypeKey, version: n.noteTypeVersion),
  ];

  /// [request]'s answer, or [EncounterRequestFailed] with why there is none, in the words given.
  static Future<T> _ask<T>(
    Future<T> Function() request, {
    required String offline,
    String notFound = _notFound,
    String notAllowed = _cantOpen,
    Map<String, String> refusals = const {},
  }) async {
    try {
      return await request();
    } on NetworkException {
      throw EncounterRequestFailed(EncounterProblem.offline, offline);
    } on AuthException catch (e) {
      throw e.code == AuthErrorCode.unavailable
          ? EncounterRequestFailed(EncounterProblem.offline, offline)
          : const EncounterRequestFailed(EncounterProblem.signInAgain, _signInAgain);
    } on ApiException catch (e) {
      final named = e.details?['noteIds'];
      final noteIds = named is List ? [...named.whereType<String>()] : const <String>[];
      final (problem, message) = switch ((e.status, e.code)) {
        (401, _) || (403, 'reauth_required') => (EncounterProblem.signInAgain, _signInAgain),
        (403, _) => (EncounterProblem.notAllowed, refusals[e.code] ?? notAllowed),
        (404, _) => (EncounterProblem.notFound, notFound),
        (409, 'content_changed' || 'not_waiting') => (EncounterProblem.changed, _visitChanged),
        (400 || 409 || 422, _) => (EncounterProblem.invalid, _invalid),
        _ => (EncounterProblem.failed, _failed),
      };
      throw EncounterRequestFailed(problem, message, code: e.code, noteIds: noteIds);
    }
  }
}

/// The patient [record], one of the records made at a visit ([records], `VisitRead.records`), is on
/// (lifecycle 8.4, D91), which can be another chart's than the visit's once the visit moved: its own
/// `patientId`, which a problem's note names as its problem's (review LRA-1), taken first since the
/// phone may hold the problem under the chart it was read with. For a problem's note that names none
/// (a chart cached before the server named it), its problem's, from [records] or the phone's copy of
/// the problem. Null when neither says: never the visit's patient, which may not be its own.
String? patientOfMadeAt(wire.RecordSnapshot record, Iterable<wire.RecordSnapshot> records, LocalStore store) {
  if (record.attributes['patientId'] case final String patientId) return patientId;
  if (record.attributes['problemId'] case final String problemId) {
    for (final r in records) {
      if (r.id == problemId && r.attributes['patientId'] is String) return r.attributes['patientId']! as String;
    }
    return store.record(problemId)?.patientId;
  }
  return null;
}

/// The server's read of a visit (5.1) as the read model the screens draw: from [source] `server`,
/// or `chart` for one of a chart's recent visits (5.2). Every answer it holds is one the reader may
/// see, laid out by the server (`read`), and each note's recap lines are the server's, worked out
/// over what the reader may see (`VisitNote.recap`, D108); the phone has no answers to put in a
/// form. [definitionOf] gives each note's own definition where the phone holds it, to tell a Medical
/// note from another.
VisitView visitFromRead(
  wire.VisitRead read, {
  required VisitSource source,
  required EncounterUser user,
  required NoteTypeDef? Function(String key, int version) definitionOf,
}) {
  final kind = read.kind == wire.EncounterKind.medical ? VisitKind.medical : VisitKind.nonMedical;
  // The Red flags note last, as on the phone's own read (forms 6.2); the server gives them as made.
  final notes = redFlagsLast([for (final n in read.notes) _noteFromRead(n, read.encounterId, user, definitionOf)]);
  return VisitView(
    encounterId: read.encounterId,
    source: source,
    patientId: read.patientId,
    kind: kind,
    status: _status(read.status),
    startedAt: read.startedAt,
    clockVerified: read.clockVerified,
    locationText: read.locationText,
    summary: read.summary,
    summaryHidden: kind == VisitKind.medical && !user.readsMedical,
    envelopeLocked: envelopeLocked([for (final n in notes) n.status]),
    addenda: [for (final a in read.addenda) _addendum(a)],
    notes: notes,
    notSynced: false,
    pendingFields: const {},
    records: read.records,
    preferredName: read.preferredName,
    recordsOnAnotherChart: read.recordsOnAnotherChart?.toSet(),
  );
}

NoteView _noteFromRead(
  wire.VisitNote n,
  String encounterId,
  EncounterUser user,
  NoteTypeDef? Function(String key, int version) definitionOf,
) => NoteView(
  noteId: n.noteId,
  encounterId: encounterId,
  noteTypeKey: n.noteTypeKey,
  noteTypeVersion: n.noteTypeVersion,
  definition: definitionOf(n.noteTypeKey, n.noteTypeVersion),
  author: _ref(n.author),
  actingAuthor: _ref(n.actingAuthor),
  actsAsAuthor: n.actingAuthor.userId == user.userId,
  status: _status(n.status),
  attestation: _attestation(n.attestation),
  waitingToSend: false,
  sentForReview: false,
  // A draft the person may change opens from the phone's copy, as the form (9.7).
  editable: false,
  answers: const {},
  pendingPaths: const {},
  read: _readModel(n.read),
  recap: [for (final l in n.recap) RecapLine(section: l.section, text: l.text)],
  signoffs: [
    for (final s in n.signoffs)
      SignoffItem(
        id: s.id,
        signer: _ref(s.signer),
        act: s.act.wire,
        effect: s.effect.wire,
        credential: s.credential.wire,
        signedAt: s.signedAt,
        clockVerified: s.clockVerified,
        statementVersion: s.statementVersion,
        needsAttestation: s.needsAttestation,
        sending: Sending.sent,
      ),
  ],
  addenda: [for (final a in n.addenda) _addendum(a)],
  corrections: [
    for (final c in n.corrections)
      CorrectionItem(
        id: c.id,
        corrector: _ref(c.corrector),
        credential: c.credential.wire,
        fields: c.fields,
        outcome: c.outcome.wire,
        reason: c.reason,
        requestedByPatient: c.requestedByPatient,
        declined: c.outcome == wire.CorrectionViewOutcome.declined,
        correctedAt: c.correctedAt,
        clockVerified: c.clockVerified,
        sending: Sending.sent,
      ),
  ],
  attestations: [
    for (final a in n.attestations)
      AttestationItem(
        id: a.id,
        signoffId: a.signoffId,
        attending: _ref(a.attending),
        attestedAt: a.attestedAt,
        statementVersion: a.statementVersion,
      ),
  ],
  notSynced: false,
  title: n.title,
  contentHash: n.contentHash,
  canCosign: n.canCosign ?? false,
  canAttest: n.canAttest ?? false,
  heldBecause: HeldBecause.fromCode(n.heldBecause?.wire),
);

AddendumItem _addendum(wire.AddendumView a) => AddendumItem(
  id: a.id,
  noteId: a.noteId,
  author: _ref(a.author),
  credential: a.credential.wire,
  text: a.text,
  writtenAt: a.writtenAt,
  clockVerified: a.clockVerified,
  sending: Sending.sent,
);

PersonRef _ref(wire.UserRef r) => PersonRef(r.userId, name: r.displayName);

/// A state this app does not know yet reads as a draft: nothing is offered on it.
NoteStatus _status(wire.NoteStatus s) => switch (s) {
  wire.NoteStatus.completed => NoteStatus.completed,
  wire.NoteStatus.signed => NoteStatus.signed,
  _ => NoteStatus.draft,
};

Attestation _attestation(wire.NoteAttestation a) =>
    Attestation.values.where((x) => x.code == a.wire).firstOrNull ?? Attestation.notNeeded;

ReadModel _readModel(wire.ReadModel m) => ReadModel([
  for (final s in m.sections)
    ReadSection(
      id: s.id,
      title: s.title,
      items: [for (final i in s.items ?? const <wire.ReadItem>[]) _readItem(i)],
      entries: s.entries == null
          ? null
          : [
              for (final e in s.entries!)
                ReadEntry(id: e.id, title: e.title, items: [for (final i in e.items) _readItem(i)]),
            ],
    ),
]);

ReadItem _readItem(wire.ReadItem i) => ReadItem(path: i.path, labels: i.labels, value: i.value)
  ..corrections.addAll([
    for (final c in i.corrections)
      ReadCorrection(path: c.path, old: c.old, by: c.by, credential: c.credential, at: c.at, reason: c.reason),
  ]);

// What the online routes' refusals say (lifecycle 8.2, 9.7, 9.9): the design's sentences, and this
// layer's own where it gives none.
const _visitNotOnPhone = 'This visit isn’t on this phone. Connect to open it.';
const _visitChanged = 'This visit changed. Read it again.';
const _partHidden = 'This note has a part you can’t open. Ask a Program Admin.';
const _connectToCosign = 'Connect to co-sign.';
const _connectToAttest = 'Connect to attest.';
const _connectForQueue = 'Connect to see notes waiting for you.';
const _connectForList = 'Connect to see your notes that aren’t on this phone.';
const _connectForEarlier = 'Connect to see earlier visits.';
const _visitNotFound = 'This visit can’t be found.';
const _chartNotFound = 'This chart can’t be found.';
const _notFound = 'This can’t be found.';
const _cantOpen = 'Your role can’t open this.';
const _cantChart = 'Your role doesn’t chart notes.';
const _cantCosign = 'Your role can’t co-sign notes.';
const _cantAttest = 'Your role can’t attest notes.';
const _signInAgain = 'Sign in again to go on.';
const _invalid = 'Something about this request was wrong. Load it again.';
const _failed = 'Something went wrong. Try again.';
const _notAMember = 'You’re no longer a member of this team.';
const _cantSign = 'Your credential can’t sign notes.';
const _cantAttestCredential = 'Your credential can’t attest notes.';

const _cosignRefusals = {
  'cannot_see_all': _partHidden,
  // Worded for everyone it covers, as the API words it: an assignee is never told they wrote a note.
  'is_author': 'You can’t co-sign a note you wrote, completed or act as the author of.',
  'cannot_sign': _cantSign,
  'not_a_member': _notAMember,
};
const _attestRefusals = {
  'cannot_see_all': _partHidden,
  'is_author': 'You can’t attest a note you wrote, completed or act as the author of.',
  'is_signer': 'You can’t attest a note you signed.',
  'cannot_attest': _cantAttestCredential,
  'not_a_member': _notAMember,
};
const _queueRefusals = {'cannot_sign': _cantSign, 'cannot_attest': _cantAttestCredential};
