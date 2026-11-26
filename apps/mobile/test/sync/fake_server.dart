import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart' as crypto;
import 'package:cryptography/cryptography.dart';
import 'package:sineobex_field/api/transport.dart';
import 'package:sineobex_field/encounters/content_hash.dart';
import 'package:sineobex_field/encounters/rules.dart';
import 'package:sineobex_field/forms/check_answer.dart';
import 'package:sineobex_field/forms/conditions.dart' show Answers, NoteReading, isBlank;
import 'package:sineobex_field/forms/definition.dart';
import 'package:sineobex_field/forms/effective.dart';
import 'package:sineobex_field/forms/field_at.dart';
import 'package:sineobex_field/forms/paths.dart' show CodesHolds, FieldNode;
import 'package:sineobex_field/forms/finish.dart';
import 'package:sineobex_field/forms/visible.dart';
import 'package:sineobex_field/patients/access.dart';
import 'package:sineobex_field/patients/dob.dart';
import 'package:sineobex_field/patients/generated/sensitive_codes.dart';
import 'package:sineobex_field/patients/id_link_token.dart';
import 'package:sineobex_field/patients/match_constants.dart';
import 'package:sineobex_field/patients/matching.dart';
import 'package:sineobex_field/patients/recognisable.dart';
import 'package:sineobex_field/presets/current_flags.dart';
import 'package:sineobex_field/presets/models.dart' show FlagColor, FlagTier, PresetState;
import 'package:sineobex_field/presets/problem_check.dart';
import 'package:sineobex_field/sync/canonical_json.dart';
import 'package:sineobex_field/sync/entities.dart';

import 'test_note_types.dart';

/// An in-memory server with the API's sync rules (services/api/src/sync), for engine tests. The
/// live tests (live_api_test.dart, and lib/patients/'s) run the same scenarios against the real
/// API in CI, which keeps this fake honest.
///
/// Phase 3 (design 2.10, S1's list in the design's Status): values are checked with the phone's
/// entity registry (lib/sync/entities.dart), which sync-values.json pins to the API's Zod schemas;
/// permissions per entity; parents of creates and sets; the field classes (keep both, identity,
/// set once, the problem status rule) with their accepted outcomes; receipts that carry `server`
/// and `details`, replayed the same; redirects for merged patients and problems; caps; the ID link
/// handshake over the group; and duplicate matching with the phone's own scorer.
///
/// Phase 4 (lifecycle 4.9), each rule as services/api/src/sync/entities builds it and with its case
/// in fake_parity_test.dart or fake_reads_test.dart: an encounter's fields and the envelope lock
/// (rules 1 and 2, encounter.ts); a note's type, a Medical note's patient and its visit made Medical
/// (3 and 4, note.ts); a finished note's late changes and the reopen (5 and 6); the sign-off, by
/// signoffEffect, over the content hash, under the credential signedUnder finds (7 and 8,
/// note-signoff.ts); addenda (9) and corrections (10); referrals, and a visit of someone else
/// (11); the Medical gate (12); the visit's status worked out from its notes, as the trigger of
/// migration 0018 does (13); each answer checked against its type (14); the offline audit actions
/// (15, the registry's); what a sync read shows of a note and what hangs off it (16); what is
/// accepted with no effect (17). Each person has a credential, an attending's unless a test says.
///
/// Phase 5 (design 6.3), as services/api/src/routes/presets.ts builds it, each rule with its case
/// in fake_parity_test.dart named as the API's own: the presets pull (`GET /v1/presets`), for any
/// member of the team whatever the role, and refused to anyone else as every route is here; its
/// query read before the team is, so a `since` that is not 1 to 19 digits or an `epoch` that is not
/// a UUID is 422 whoever asks; a reset when `since` is left out, above the team's revision or past
/// what a JavaScript number holds exactly, or when `epoch` is not the team's; the revision answered,
/// the greatest among the presets answered, else `since`, else 0 on a reset; revision 0 and the nil
/// UUID for a team that has taken no revision; archived presets answered, a kind no phone reads
/// never; a fault (500) while a preset's current version is missing. A test writes each team's
/// presets as the API's writers leave them ([addPreset], [editPreset], [archivePreset],
/// [restorePreset]), each write under the team's next revision as takeRevision takes it, and renews
/// an epoch as a database restore does ([renewPresetEpoch]). Not mirrored: the preset and note type
/// installers and the platform updates they offer, which the API's pull runs first, so a pull here
/// never writes; the admin routes (routes/presets-admin.ts, routes/note-types-admin.ts); and the
/// `access.denied` event a refusal is logged with, which no route here writes.
///
/// Phase 5's flag changes (design 6.2, 6.3), as services/api/src/sync/entities/patient-flag-change.ts,
/// sync/read-rules.ts and sync/review.ts build them, each rule with its case in fake_parity_test.dart
/// named as the API's own: the value's reason rule, through the phone's registry, before anything is
/// read; one of the team's flags, whatever its state, or `unknown_flag`; the flag rule
/// ([_flagHidden]: a flag the team does not hold, or a sensitive one for a reader who sees no
/// sensitive problem), which holds a create or a mark from a sender it hides the flag from, never
/// refuses it; the change's time, never later than the server's receipt, a held change's hold time;
/// its mark, set once, by its author or whoever manages the team's people; the sync read and a value
/// sent back by the flag rule, and a mark's reasons only to the change's author and Program Admins;
/// and the notice a held change that will not reach the chart leaves its sender, naming the change
/// and its patient. A flag change's flag is read from the presets of the team it was made in, as the
/// team holds it now; a seed, an online act, is made in the team that holds its flag. Not mirrored:
/// the team lock; the audit events (`patient_flag.changed`, `patient_flag.entered_in_error`,
/// `quarantine.accept_refused`); the review queue, so a reviewer's own sight of the flag, and the
/// 409 a refused accept answers, are the API's alone ([acceptHeld] answers what applying it
/// answered); the routes' own checks, which no sync change reaches (insertFlagChange's second look at
/// the reason, and its refusal of a set of an archived flag); the two flag routes and the portal's
/// flag list (`GET /v1/presets/flags`), which no phone calls; and who approved a held create, which
/// its row keeps and no sync read gives.
///
/// Phase 5's reads (design 6.1, 6.3, 7), as services/api/src/patients/charts.ts, projection.ts,
/// team-index.ts and search.ts build them, each rule with its case in fake_reads_test.dart named as
/// the API's own, every flag read from the presets of the team the request names ([_teamFlags]): the
/// chart's flagChanges, every change of the merged group by its time, to the millisecond, then ID,
/// each as the sync read shows it ([_flagChangeShown]), so a hidden flag's change is absent, never
/// blanked; its flags, worked out by the phone's copy of currentFlags, which flag-current.json holds
/// to the server's, over every change with the reader's flag rule, each flag as the team holds it now,
/// archived ones included, and a history row for each change shown, naming its author and who marked
/// it by their names now; each problem's statusCheckDue, by the team's settings window, else the
/// platform's, on the chart and the sync read alike; the team index's flags, IDs only, under
/// idx1+sens for a reader the flag rule shows a sensitive flag to; and search's flagIds, read in
/// lowercase and each once, refused 403 before anything is searched when one names a flag hidden from
/// the caller or one the team does not hold, narrowing the hits before the cut, and counted in the
/// search's event. Not mirrored: the search body's schema, as for the rest of the search (a flag
/// alone, as a year alone, and a flag ID that is no UUID, each 422); the `access.denied` a refused
/// search is logged with; and the index's version moving at a flag change that changes no entry the
/// reader holds, as the API's triggers move its counter at every one: here it moves when what the
/// reader's entries or the redirect list show changes, as for every other record.
class FakeSyncServer {
  FakeSyncServer({required this.now});

  /// The server's own clock.
  DateTime Function() now;

  final devices = <String, _Device>{};
  final records = <String, FakeRecord>{};
  final receipts = <String, _Receipt>{};
  final quarantine = <String, Map<String, Object?>>{};

  /// Whose each change in [quarantine] is and why it is held. It waits until a test accepts it
  /// ([acceptHeld]) or rejects it ([rejectHeld]).
  final held = <String, ({String userId, String deviceId, String reason, String? waitsOn})>{};

  /// The team each change in [quarantine] was sent in (quarantine_items.team_id), which an admin's
  /// accept applies it in.
  final heldInTeam = <String, String?>{};

  /// The held changes a Program Admin rejected ([rejectHeld]): still held, decided.
  final rejectedHeld = <String>{};

  /// Offline reads appended to the audit chain (AuditAppend entries), with their fields.
  final audit = <Map<String, Object?>>[];

  /// Field history: `kind` is created, set, filled_blank, replaced_after_review, kept_both,
  /// confirmed, redirected, cleared_by_allergy or entered_in_error.
  final history = <Map<String, Object?>>[];
  final removedUsers = <String>{};

  /// 'userId/teamId': removed from one team only.
  final removedFromTeam = <String>{};

  /// Each person's permission keys in the team (D37); [healthcareStaff] for anyone not listed.
  final permissions = <String, Set<String>>{};

  /// The note type versions the team holds (note_type_versions), by key and version: the test-only
  /// types every API test team holds (test_note_types.dart).
  final noteTypes = <(String, int), Map<String, Object?>>{
    for (final d in testNoteTypes) (d['key']! as String, d['version']! as int): d,
  };

  /// Rows of [noteTypes] whose hash is not their definition's (D79): a rule that reads one fails
  /// with definition_error, as definitionFor's DefinitionMismatch does.
  final forged = <(String, int)>{};

  /// Each person's credential in the team now (team_memberships.credential, read by loadSigner);
  /// [defaultCredential] for anyone not listed, as [healthcareStaff] is their role.
  final credentials = <String, String>{};
  static const defaultCredential = 'attending';
  String credentialOf(String userId) => credentials[userId] ?? defaultCredential;

  /// Each person's display name now (users.display_name); [defaultName] for anyone not listed. A
  /// sign-off, a correction and an addendum keep the one their person had then.
  final names = <String, String>{};
  static const defaultName = 'Demo user';
  String nameOf(String userId) => names[userId] ?? defaultName;

  /// Each person's credential changes and restores (membership_changes of kind credential and
  /// restored), with the credential each replaced: what signedUnder reads after a signature.
  final credentialChanges = <({String userId, DateTime changedAt, String oldCredential})>[];

  /// An admin changes [userId]'s credential now (or [at]).
  void changeCredential(String userId, String to, {DateTime? at}) {
    credentialChanges.add((userId: userId, changedAt: (at ?? now()).toUtc(), oldCredential: credentialOf(userId)));
    credentials[userId] = to;
  }

  /// When each change held for review was received (quarantine_items.received_at): a signature's
  /// time is checked against it once an admin accepts it, not against the accept.
  final heldAt = <String, DateTime>{};

  /// Attestations made online (note_attestations): the note, the signature attested, the attending.
  final attestations = <({String noteId, String? signoffId, String by})>[];

  /// Each correction's history rows, by the field each changed (note_corrections.changes[].historyId).
  final correctionHistory = <String, Map<String, String>>{};

  /// What each credential may do (services/api/src/auth/permissions.ts CAPABILITIES).
  static const capabilities =
      <String, ({bool chartMedical, bool orderMedications, bool sign, bool billingNeedsAttestation})>{
        'attending': (chartMedical: true, orderMedications: true, sign: true, billingNeedsAttestation: false),
        'resident': (chartMedical: true, orderMedications: true, sign: true, billingNeedsAttestation: true),
        'np': (chartMedical: true, orderMedications: true, sign: true, billingNeedsAttestation: true),
        'pa': (chartMedical: true, orderMedications: true, sign: true, billingNeedsAttestation: true),
        'student': (chartMedical: true, orderMedications: false, sign: false, billingNeedsAttestation: true),
        'chw': (chartMedical: false, orderMedications: false, sign: false, billingNeedsAttestation: false),
        'none': (chartMedical: false, orderMedications: false, sign: false, billingNeedsAttestation: false),
      };

  /// The Healthcare Staff role of 0002.
  static const healthcareStaff = {
    'patients.view',
    'patients.edit',
    'patients.view_sensitive',
    'encounters.chart',
    'checkins.create',
    'referrals.create',
    'routes.view',
    'inventory.view',
  };

  /// The CHW preset (design 4.2; permissions.ts CHW_PRESET): registers patients and makes referrals,
  /// never charts.
  static const chw = {'patients.view', 'patients.edit', 'checkins.create', 'referrals.create', 'routes.view'};

  Set<String> permissionsOf(String userId) => permissions[userId] ?? healthcareStaff;

  /// Open field reviews (a value kept both), by ID.
  final reviews = <String, FakeReview>{};

  /// Pairs flagged as possible duplicates.
  final pairs = <FakePair>[];

  /// Merges, by ID ([merge], [undoMerge]).
  final merges = <String, FakeMerge>{};

  /// ID links, by ID.
  final idLinks = <String, FakeIdLink>{};

  /// Notices for people (user_notices): kind, entity and record ID only, and for a held sign-off's the
  /// note's ID (D104).
  final notices = <FakeNotice>[];

  /// What the online read routes audited: `patient.viewed`, `patient.searched`,
  /// `patient.match_checked`, `patient.index_downloaded`, with who and which patients.
  final serverAudit = <Map<String, Object?>>[];

  /// The ID link base URL a chart's links are made with (ID_LINK_BASE_URL in local and test).
  String idLinkBaseUrl = 'http://localhost:3100';

  /// Network conditions for the next requests.
  bool offline = false;

  /// Refuses the sign-in with this 403 code (team suspended, MFA needed) without touching what
  /// the device-key check says.
  String? refuseCode;

  /// People whose sign-in is older than RECENT_AUTH_MINUTES: an identity decision is refused with
  /// 403 reauth_required until they sign in again.
  final staleSignIn = <String>{};

  /// The server commits a push, then the answer never arrives (killed app, dropped connection).
  int dropPushResponses = 0;

  /// Process only this many changes, then stop (a server failure mid-batch).
  int? stopAfter;

  /// Step 6 of a correction as the API ran it before D109, which refused a change to an answer blank
  /// now that the sender held no version of: for a phone that still holds such a refusal.
  bool stepSixBeforeD109 = false;

  /// Called with each request before it is handled (to advance clocks in tests).
  void Function(String path)? onRequest;

  int pushes = 0;

  /// Change IDs the request schema refuses (an app fault), failing the whole push with 422.
  final malformed = <String>{};

  final _random = Random(7);
  int _received = 0;

  ApiTransport transportFor(String userId, String teamId) => _Transport(this, userId, teamId);

  String _uuid() {
    String hex(int n) => [for (var i = 0; i < n; i++) _random.nextInt(16).toRadixString(16)].join();
    return '${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}';
  }

  String get _today => now().toUtc().toIso8601String().substring(0, 10);

  // ---- test hooks ----

  /// Someone else changes a field on the server (online, as the portal does): the field's next
  /// version, and what the field decides about its record (a problem's status, a retraction).
  void serverEdit(String recordId, String field, Object? value, {required String by}) {
    final record = records[recordId]!;
    final current = record.fields[field];
    _write(record, field, value, (current?.version ?? 0) + 1, by, now().toUtc().toIso8601String(), null);
  }

  /// A note finished on the server, as a sign-off leaves it (lifecycle 4.6) and as the API's tests
  /// write one: [status] at the version its status field had, finished now by its author.
  /// [everSigned]: signed once, as a student's correction leaves a co-signed note.
  void finishNote(String noteId, {String status = 'completed', bool everSigned = false}) {
    final note = records[noteId]!;
    final cur = note.fields['status']!;
    note
      ..fields['status'] = FakeField(status, cur.version, cur.by, cur.at, cur.changeId)
      ..completedAt = _iso(now())
      ..completedBy = note.author
      ..everSigned = note.everSigned || everSigned || status == 'signed';
    _refreshVisit(note.attributes['encounterId']);
  }

  /// Someone else co-signs [noteId] online, as the API's tests do until the route exists (L2): a
  /// sign-off of act `cosign` that signs the note, which the note then names.
  String cosign(String noteId, {required String by}) {
    final note = records[noteId]!;
    final id = _uuid();
    records[id] = FakeRecord(
      id: id,
      entity: entitySignoff,
      author: by,
      createdAt: now(),
      attributes: {
        'noteId': noteId,
        'act': 'cosign',
        'effect': 'signed',
        'signerName': nameOf(by),
        'signerCredential': credentialOf(by),
      },
      status: 'signed',
      fields: {},
    )..storedAt = now().toUtc();
    final cur = note.fields['status']!;
    note
      ..fields['status'] = FakeField('signed', cur.version, cur.by, cur.at, cur.changeId)
      ..signoffId = id
      ..everSigned = true
      ..attestation = 'not_needed';
    _refreshVisit(note.attributes['encounterId']);
    return id;
  }

  /// An attending attests [noteId]'s current signature online, as the API's tests do (L2).
  void attest(String noteId, {required String by}) {
    final note = records[noteId]!;
    attestations.add((noteId: noteId, signoffId: note.signoffId, by: by));
    note.attestation = 'attested';
  }

  /// A record made online (or seeded): [entity]'s create applied with every permission, as an
  /// admin's online action would be. Returns its ID; throws when the create is refused.
  String seed(String entity, Map<String, Object?> value, {String? id, String by = 'seed-user', DateTime? at}) {
    final recordId = id ?? _uuid();
    final when = (at ?? now()).toUtc().toIso8601String();
    final c = <String, Object?>{
      'changeId': _uuid(),
      'seq': 0,
      'entity': entity,
      'recordId': recordId,
      'op': 'create',
      'value': value,
      'baseVersion': 0,
      'deviceTime': when,
      'correctedTime': when,
      'clockVerified': true,
    };
    final o = _decide(_Actor(by, 'seed-device', _allPermissions, holdForReview: false), c);
    if (o['status'] != 'accepted') throw StateError('seed refused: ${o['reason']} ${o['details']}');
    return recordId;
  }

  /// A patient made online, with the consent every create carries.
  String seedPatient({
    String? id,
    String? preferredName = 'Demo Patient',
    Map<String, Object?>? legalName,
    String? visualDescriptor,
    Map<String, Object?>? birth,
    String? usualArea,
    String by = 'seed-user',
    DateTime? at,
  }) => seed(
    entityPatient,
    {
      'preferredName': ?preferredName,
      'legalName': ?legalName,
      'visualDescriptor': ?visualDescriptor,
      'birth': ?birth,
      'usualArea': ?usualArea,
      'consent': {
        'id': _uuid(),
        'decision': 'given',
        'method': 'verbal',
        'scriptVersion': '2026-10-1',
        'language': 'en',
      },
      'privacyNotice': {'id': _uuid(), 'decision': 'acknowledged'},
    },
    id: id,
    by: by,
    at: at,
  );

  /// Merges [mergedId] into [intoId] (design 3.4): nothing moves, the merged record points at the
  /// survivor, and every record of its group now belongs to the survivor's. Open pairs naming it
  /// are superseded, and the survivor is matched again. Returns the merge's ID.
  String merge(String mergedId, String intoId) {
    final merged = records[mergedId]!;
    final survivor = canonicalOf(intoId);
    // The merged records' open reviews are moot: re-matching raises every real difference against
    // the survivor. Undo opens them again (merges.ts).
    final subtree = _subtree(mergedId);
    final obsoleted = [
      for (final r in reviews.values)
        if (r.status == 'open' && subtree.contains(r.recordId)) r..status = 'obsolete',
    ];
    merged
      ..status = 'merged'
      ..mergedInto = survivor;
    final id = _uuid();
    merges[id] = FakeMerge(id, mergedId, survivor, now().toUtc())..reviewsObsoleted.addAll(obsoleted.map((r) => r.id));
    for (final p in pairs) {
      if ((p.a == mergedId || p.b == mergedId) && (p.status == 'open' || p.status == 'not_sure')) {
        p.status = 'superseded';
      }
    }
    _rematch(survivor, 'merge_rematch');
    return id;
  }

  /// Undoes a merge: the merged record is its own again, with everything stored under its ID,
  /// late arrivals included; its cards are its own again (they were never retired). Values edits
  /// sent to it while merged put into the survivor's open reviews are withdrawn; a review left with
  /// nothing to choose is moot; the merged records' own reviews open again (merges.ts, review
  /// finding S1). History stays as it is.
  void undoMerge(String mergeId) {
    final m = merges[mergeId]!;
    if (m.undoneAt != null) throw StateError('already_undone');
    m.undoneAt = now().toUtc();
    final subtree = _subtree(m.mergedId);
    for (final h in history) {
      final review = reviews[h['reviewId']];
      final sentTo = receipts[h['changeId']]?.recordId;
      if (review == null ||
          review.status != 'open' ||
          h['kind'] != 'kept_both' ||
          h['entity'] != entityPatient ||
          subtree.contains(h['recordId']) ||
          !subtree.contains(sentTo)) {
        continue;
      }
      review.withdrawn.add(h['id']! as String);
      if (_alternatesOf(review).isEmpty) review.status = 'obsolete';
    }
    records[m.mergedId]!
      ..status = 'active'
      ..mergedInto = null;
    for (final id in m.reviewsObsoleted) {
      final r = reviews[id]!;
      final another = reviews.values.any(
        (o) => o.status == 'open' && o.entity == r.entity && o.recordId == r.recordId && o.field == r.field,
      );
      if (r.status == 'obsolete' && !another) r.status = 'open';
    }
  }

  /// [patientId] and every record merged into it, at any depth.
  Set<String> _subtree(String patientId) => {
    for (final r in records.values)
      if (r.entity == entityPatient && _chain(r.id).contains(patientId)) r.id,
  };

  /// A record and the survivors its merges lead to.
  List<String> _chain(String id) {
    final chain = [id];
    for (var next = records[id]?.mergedInto; next != null && chain.length < 21; next = records[next]?.mergedInto) {
      chain.add(next);
    }
    return chain;
  }

  /// The values a review still offers: those kept for it, less any a merge undo withdrew.
  List<Map<String, Object?>> _alternatesOf(FakeReview r) => [
    for (final h in history)
      if (h['reviewId'] == r.id && h['kind'] == 'kept_both' && !r.withdrawn.contains(h['id'])) h,
  ];

  /// A problem entry merged into another (an admin's problem merge, design 9.4).
  void mergeProblem(String mergedId, String intoId) => records[mergedId]!.mergedInto = intoId;

  /// "Not the same person" (design 8.6): the pair is decided, and never flagged again.
  void keepSeparate(String a, String b) {
    final ca = canonicalOf(a), cb = canonicalOf(b);
    final pair = _pairOf(ca, cb);
    if (pair == null) {
      pairs.add(FakePair(_uuid(), ca, cb, 0, ['staff'])..status = 'kept_separate');
    } else {
      pair.status = 'kept_separate';
    }
  }

  /// A Program Admin ([by]) accepts a change held for review (review.ts decideQuarantine): applied
  /// with the whole catalog, approved by them, and the receipt the push got is replaced. Returns what
  /// applying it answered.
  Map<String, Object?> acceptHeld(String changeId, {String by = 'admin-user'}) {
    final c = quarantine[changeId]!;
    final h = held[changeId]!;
    final outcome = _decide(
      _Actor(h.userId, 'admin', _allPermissions, holdForReview: false, approvedBy: by, teamId: heldInTeam[changeId]),
      c,
    );
    if (outcome['status'] != 'accepted') {
      // Refused, the change stays held; a sign-off the note no longer matches tells its sender, and
      // so does a correction refused now (review finding VS-6), and a flag change, unless it waits on
      // its sender's own held create, which is no refusal yet (review.ts waitingOnRecord).
      if ((outcome['details'] as Map<String, Object?>?)?['problem'] == 'content_changed') {
        _signoffNotApplied(h.userId, c);
      }
      _correctionNotApplied(h.userId, c);
      final rules = rulesFor(c['entity']! as String);
      final waiting =
          outcome['reason'] == 'stale_reference' && rules != null && _heldCreate(h.userId, c, rules) != null;
      if (!waiting) _flagChangeNotApplied(h.userId, c);
      return outcome;
    }
    quarantine.remove(changeId);
    held.remove(changeId);
    heldInTeam.remove(changeId);
    receipts[changeId] = _Receipt(
      userId: h.userId,
      deviceId: h.deviceId,
      seq: c['seq']! as int,
      entity: c['entity']! as String,
      recordId: c['recordId']! as String,
      field: c['field'] as String?,
      supersedes: c['supersedes'] as String?,
      conflictOf: c['conflictOf'] as String?,
      status: 'accepted',
      serverVersion: outcome['serverVersion'] as int?,
      reason: null,
      hash: valueHash(c['value']),
      quarantined: false,
      details: outcome['details'] as Map<String, Object?>?,
    );
    return outcome;
  }

  /// A sign-off a reviewer rejected, not on the chart and with no held create of it still waiting
  /// (records.ts withoutRejectedSignoff).
  bool _rejectedInReview(String? signoffId) {
    if (signoffId == null || records.containsKey(signoffId)) return false;
    bool create(String changeId) {
      final c = quarantine[changeId];
      return c != null && c['entity'] == entitySignoff && c['op'] == 'create' && c['recordId'] == signoffId;
    }

    return rejectedHeld.any(create) && !held.keys.where((id) => !rejectedHeld.contains(id)).any(create);
  }

  /// A Program Admin rejects a change held for review (review.ts decideQuarantine): it stays held,
  /// decided, and a retry says so. A held sign-off rejected tells its sender the note needs
  /// completing again, a held correction that it needs correcting again, and a held flag change that
  /// it was not made.
  void rejectHeld(String changeId) {
    final c = quarantine[changeId]!;
    rejectedHeld.add(changeId);
    _signoffNotApplied(held[changeId]!.userId, c);
    _correctionNotApplied(held[changeId]!.userId, c);
    _flagChangeNotApplied(held[changeId]!.userId, c);
  }

  /// A held flag change that will not reach the chart (review.ts flagChangeNotApplied, design 6.2):
  /// its phone let go of it when it was held, so its sender gets `flag_change_not_applied` naming the
  /// flag change, its create's record or the one its mark was for, and its patient, as the queue
  /// names it ([_patientOfHeldFlagChange]). Once per sender and flag change; the notice holds no text
  /// of it. Only for a patient on the chart: a patient whose own create was held and rejected tells
  /// nobody, since the notice's key would abort the reject (intake's risk level).
  void _flagChangeNotApplied(String userId, Map<String, Object?> c) {
    if (c['entity'] != entityFlagChange) return;
    final recordId = c['recordId']! as String;
    final patientId = _patientOfHeldFlagChange(recordId, c['value']);
    if (patientId == null || records[patientId]?.entity != entityPatient) return;
    final told = notices.any(
      (n) =>
          n.userId == userId &&
          n.kind == 'flag_change_not_applied' &&
          n.entity == entityFlagChange &&
          n.recordId == recordId,
    );
    if (!told) _notify(userId, 'flag_change_not_applied', entityFlagChange, recordId, patientId: patientId);
  }

  /// The patient a held flag change is about, as 0024's patient_of_change names it: the change's own
  /// row's, as stored (a merged patient included); else the patient its value names; else, for a mark
  /// whose create is held too, the one the latest held create of the change names. Named only by a
  /// UUID, as as_uuid reads one: a held value was never checked.
  String? _patientOfHeldFlagChange(String recordId, Object? value) {
    final stored = records[recordId];
    if (stored?.entity == entityFlagChange) return stored!.patientId;
    String? patientOf(Object? v) => switch (v) {
      {'patientId': final String id} when _anyUuid.hasMatch(id) => id.toLowerCase(),
      _ => null,
    };
    final named = patientOf(value);
    if (named != null) return named;
    final creates = [
      for (final MapEntry(key: id, value: q) in quarantine.entries)
        if (q['entity'] == entityFlagChange && q['op'] == 'create' && q['recordId'] == recordId) id,
    ]..sort((a, b) => heldAt[a]!.compareTo(heldAt[b]!));
    return creates.isEmpty ? null : patientOf(quarantine[creates.last]!['value']);
  }

  /// Any UUID, as 0009's as_uuid takes one: 8-4-4-4-12 hexadecimal digits in either case.
  static final _anyUuid = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

  /// A held correction that will not reach the chart (review.ts correctionNotApplied, review finding
  /// VS-6): its sender gets `correction_not_applied` naming it and its note, once per correction.
  /// Only for a correction of a note on the chart.
  void _correctionNotApplied(String userId, Map<String, Object?> c) {
    if (c['entity'] != entityCorrection || c['op'] != 'create') return;
    final noteId = (c['value'] as Map<String, Object?>?)?['noteId'];
    if (noteId is! String || records[noteId]?.entity != entityNote) return;
    final correctionId = c['recordId']! as String;
    final told = notices.any(
      (n) =>
          n.userId == userId &&
          n.kind == 'correction_not_applied' &&
          n.entity == entityCorrection &&
          n.recordId == correctionId,
    );
    if (!told) _notify(userId, 'correction_not_applied', entityCorrection, correctionId, noteId: noteId);
  }

  /// A held sign-off that will not reach the chart (review.ts signoffNotApplied, review finding
  /// NOT-12): its phone let go of it when it was held, so its sender gets `signoff_not_applied` naming
  /// that sign-off, once per sign-off whether or not they have read it (SRC-1, SRC-2, SRC-5), and its
  /// note, which no sync read finds from a held sign-off (D104). Only for a sign-off of a note on the
  /// chart.
  void _signoffNotApplied(String userId, Map<String, Object?> c) {
    if (c['entity'] != entitySignoff || c['op'] != 'create') return;
    final noteId = (c['value'] as Map<String, Object?>?)?['noteId'];
    if (noteId is! String || records[noteId]?.entity != entityNote) return;
    final signoffId = c['recordId']! as String;
    final told = notices.any(
      (n) =>
          n.userId == userId && n.kind == 'signoff_not_applied' && n.entity == entitySignoff && n.recordId == signoffId,
    );
    if (!told) _notify(userId, 'signoff_not_applied', entitySignoff, signoffId, noteId: noteId);
  }

  /// The patient whose chart holds [patientId] now (its canonical ID).
  String canonicalOf(String patientId) {
    var id = patientId;
    for (var hops = 0; hops < 20; hops++) {
      final next = records[id]?.mergedInto;
      if (next == null) return id;
      id = next;
    }
    return id;
  }

  /// Every patient record whose chart is [canonicalId]'s (itself and those merged into it).
  Iterable<FakeRecord> groupOf(String canonicalId) =>
      records.values.where((r) => r.entity == entityPatient && canonicalOf(r.id) == canonicalId);

  /// The open or not-sure pair of two canonical patients, if any.
  FakePair? openPair(String a, String b) {
    final p = _pairOf(canonicalOf(a), canonicalOf(b));
    return p != null && (p.status == 'open' || p.status == 'not_sure') ? p : null;
  }

  FakePair? _pairOf(String a, String b) => pairs.where((p) => {p.a, p.b}.containsAll([a, b])).firstOrNull;

  // ---- requests ----

  Future<Object?> handle(
    String userId,
    String teamId,
    String method,
    String path,
    Object? rawBody, {
    Map<String, String>? query,
  }) async {
    if (offline) throw const NetworkException('offline');
    onRequest?.call(path);
    // Round-trip through JSON, as HTTP would, with the API's body limit (app.ts).
    final encoded = rawBody == null ? null : jsonEncode(rawBody);
    if (encoded != null && utf8.encode(encoded).length > 1024 * 1024) {
      throw const ApiException(413, 'payload_too_large', 'The request is too large.');
    }
    final body = encoded == null ? null : jsonDecode(encoded) as Map<String, Object?>;
    final signed = RegExp(r'^/v1/devices/([^/]+)/(status|quarantine|wiped)$').firstMatch(path);
    final Object? result;
    if (signed != null) {
      result = await _signed(signed.group(1)!, signed.group(2)!, body!);
    } else {
      // The route's schema reads the pull's query before its handler runs teamScope (app.ts), so a
      // malformed one is refused whoever asks.
      final presetsQuery = method == 'GET' && path == '/v1/presets' ? _pullQuery(query ?? const {}) : null;
      if (removedUsers.contains(userId) || removedFromTeam.contains('$userId/$teamId')) {
        throw const ApiException(403, 'not_a_member', 'You are not a member of this team.');
      }
      if (refuseCode != null) throw ApiException(403, refuseCode!, 'Refused.');
      result = switch ((method, path)) {
        ('POST', '/v1/devices') => _register(userId, teamId, body!),
        ('POST', '/v1/sync/push') => _push(userId, teamId, body!),
        ('POST', '/v1/sync/records') => _fetch(userId, teamId, body!),
        ('GET', '/v1/team/notices') => _notices(userId),
        ('POST', '/v1/patients/index') => _index(userId, teamId, body!),
        ('POST', '/v1/patients/charts') => _charts(userId, teamId, body!),
        ('POST', '/v1/patients/search') => _search(userId, teamId, body!),
        ('POST', '/v1/patients/match') => _match(userId, body!),
        ('GET', _) when _chartPath.hasMatch(path) => _chart(userId, teamId, _chartPath.firstMatch(path)![1]!),
        ('POST', _) when _noticeRead.hasMatch(path) => _markRead(userId, _noticeRead.firstMatch(path)![1]!),
        ('GET', _) when _historyPath.hasMatch(path) => _historyOf(
          userId,
          _historyPath.firstMatch(path)![1]!,
          query ?? {},
        ),
        ('POST', _) when _reviewDecision.hasMatch(path) => _decideReview(
          userId,
          _reviewDecision.firstMatch(path)![1]!,
          body!,
        ),
        ('GET', '/v1/presets') => _pullPresets(teamId, presetsQuery!),
        ('GET', '/v1/time') => {'epochMs': now().millisecondsSinceEpoch, 'serverTime': now().toUtc().toIso8601String()},
        _ => throw ApiException(404, 'not_found', 'no route $method $path'),
      };
    }
    if (path == '/v1/sync/push' && dropPushResponses > 0) {
      dropPushResponses--;
      throw const NetworkException('timeout');
    }
    return result;
  }

  Map<String, Object?> _register(String userId, String teamId, Map<String, Object?> b) {
    final id = b['deviceId']! as String;
    final existing = devices[id];
    if (existing != null && (existing.userId != userId || existing.publicKey != b['publicKey'])) {
      throw const ApiException(409, 'device_exists', 'registered');
    }
    devices[id] ??= _Device(userId, teamId, b['publicKey']! as String);
    return {'id': id, 'status': devices[id]!.status, 'registeredAt': now().toUtc().toIso8601String()};
  }

  Map<String, Object?> _push(String userId, String teamId, Map<String, Object?> b) {
    pushes++;
    final device = devices[b['deviceId']];
    if (device == null || device.userId != userId) {
      throw const ApiException(409, 'device_not_registered', 'Register this phone before syncing.');
    }
    final deviceTime = DateTime.parse((b['clock']! as Map<String, Object?>)['deviceTime']! as String);
    final offsetMs = now().difference(deviceTime).inMilliseconds.clamp(-maxVersion, maxVersion);
    final flagged = offsetMs.abs() > 5 * 60000;
    // Every push replaces the phone's report, as push.ts does: the admin's devices page shows it.
    final unsynced = b['unsynced']! as Map<String, Object?>;
    device
      ..unsynced = Map.of(unsynced['counts']! as Map<String, Object?>)
      ..oldestUnsynced = unsynced['oldest'] as String?;
    final base = {
      'serverTime': now().toUtc().toIso8601String(),
      'clock': {'offsetMs': offsetMs, 'flagged': flagged},
      'device': {'status': device.status},
    };
    if (device.status != 'active') return {...base, 'results': <Object?>[]};
    final changes = (b['changes']! as List<Object?>).cast<Map<String, Object?>>();
    _validatePush(changes);
    changes.sort((x, y) => (x['seq']! as int).compareTo(y['seq']! as int));
    final results = <Map<String, Object?>>[];
    for (final c in changes) {
      if (stopAfter != null && results.length >= stopAfter!) break;
      // A time the server just measured as more than 5 minutes off is never stored as verified,
      // whatever the phone claims (push.ts, review finding P8).
      results.add(_one(userId, b['deviceId']! as String, teamId, flagged ? {...c, 'clockVerified': false} : c));
    }
    return {...base, 'results': results};
  }

  /// The largest version a change may name (schemas.ts MAX_VERSION, Postgres `integer`), and the
  /// largest clock offset a push records.
  static const maxVersion = 2147483647;

  /// schemas.ts isPhoneTime: from the Unix epoch through the last moment of 9999, in UTC.
  static bool isPhoneTime(Object? text) {
    final t = text is String ? DateTime.tryParse(text) : null;
    return t != null && !t.isBefore(DateTime.utc(1970)) && !t.isAfter(DateTime.utc(9999, 12, 31, 23, 59, 59, 999));
  }

  /// SyncChange's request schema: one bad change fails the whole push with 422, as the API does.
  /// A base version past `integer`, or a time Postgres can't hold, is named too (review finding S6).
  void _validatePush(List<Map<String, Object?>> changes) {
    final problems = <Object?>[
      for (final (i, c) in changes.indexed) ...[
        if (malformed.contains(c['changeId']) || (c['field'] is String && (c['field']! as String).length > 200))
          {'path': 'changes.$i.field', 'problem': 'too_big'},
        if (c['baseVersion'] is int && (c['baseVersion']! as int) > maxVersion)
          {'path': 'changes.$i.baseVersion', 'problem': 'too_big'},
        if (!isPhoneTime(c['deviceTime'])) {'path': 'changes.$i.deviceTime', 'problem': 'custom'},
        if (c['correctedTime'] != null && !isPhoneTime(c['correctedTime']))
          {'path': 'changes.$i.correctedTime', 'problem': 'custom'},
      ],
    ];
    if (problems.isNotEmpty) {
      throw ApiException(
        422,
        'validation_failed',
        'Some fields are missing or invalid.',
        details: {'fields': problems},
      );
    }
  }

  /// push.ts processOne: apply.ts precheck (a damaged value is answered, never stored); the
  /// stored answer for a change already here, unless its ID is someone else's (another person's or
  /// phone's receipt, or a change held for them: `change_id_reused`, review finding P8); the
  /// person's own change handed over after removal, which only an admin's decision applies; then
  /// decide(), or the lasting rejection precheck found.
  Map<String, Object?> _one(String userId, String deviceId, String teamId, Map<String, Object?> c) {
    final id = c['changeId']! as String;
    final hash = valueHash(c['value']);
    final unstorable = c.containsKey('value') ? storableProblem(c['value']) : null;
    final lasting = !c.containsKey('value')
        ? _invalid('value_missing')
        : unstorable == null
        ? null
        : _invalid(unstorable == 'too large' ? 'too_large' : 'unstorable_value');
    if (lasting == null && hash != c['valueHash']) {
      return {'changeId': id, 'status': 'rejected', 'reason': 'hash_mismatch'};
    }
    final existing = receipts[id];
    if (existing != null) {
      return existing.userId == userId && existing.deviceId == deviceId ? existing.result(this, id) : _reused(id);
    }
    final h = held[id];
    if (h != null) {
      if (h.userId != userId || h.deviceId != deviceId) return _reused(id);
      return {
        'changeId': id,
        'status': 'rejected',
        'reason': 'permission',
        'message': 'rejected: permission',
        'details': {'problem': 'held_for_review', 'decision': rejectedHeld.contains(id) ? 'rejected' : 'pending'},
        'quarantined': true,
        'hash': valueHash(quarantine[id]!['value']),
      };
    }
    if (lasting != null) return _store(userId, deviceId, c, c['valueHash']! as String, lasting);
    final outcome = _decide(_Actor(userId, deviceId, permissionsOf(userId), holdForReview: true, teamId: teamId), c);
    return _store(userId, deviceId, c, hash, outcome);
  }

  /// push.ts reused: never stored, so the holder's change keeps its ID.
  static Map<String, Object?> _reused(String changeId) => {
    'changeId': changeId,
    'status': 'rejected',
    'reason': 'validation',
    'message': 'This change ID was already used. The app will make a new one.',
    'details': {'problem': 'change_id_reused'},
  };

  /// What an admin's accept and a seed are applied with: every key a rule here reads, as review.ts
  /// decideQuarantine applies an accept with the whole catalog. team.manage_users among them, so an
  /// accepted mark of someone else's flag change passes its author rule.
  static final _allPermissions = {
    ...healthcareStaff,
    'patients.reverse_resolved',
    'patients.correct_identity',
    'team.manage_users',
  };

  /// apply.ts decide: an activity log entry, or the entity's permission, then its create or set,
  /// and a refusal the person can't fix held for review with what it waits on.
  Map<String, Object?> _decide(_Actor actor, Map<String, Object?> c) {
    final rules = rulesFor(c['entity']! as String);
    if (rules == null) {
      if (c['op'] != 'append') return _invalid('audit_is_append_only');
      final issues = auditIssues(c['value']);
      if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
      final v = c['value']! as Map<String, Object?>;
      audit.add({...v, 'deviceTime': c['deviceTime'], 'changeId': c['changeId'], 'userId': actor.userId});
      return {'status': 'accepted', 'serverVersion': 1};
    }
    final op = c['op'];
    if (!actor.permissions.contains(rules.permission(op == 'set' ? 'set' : 'create', c['field'] as String?))) {
      return actor.holdForReview ? _hold(actor, c, 'permission') : _rejected('permission');
    }
    if (op != 'create' && op != 'set') return _invalid('append_only_for_audit');
    // Applied as the database writes it, its IDs in lowercase (_asStored); what is held keeps the
    // change as it came.
    final stored = _asStored(c);
    final Map<String, Object?> outcome;
    try {
      outcome = op == 'create' ? _create(actor, stored, rules) : _set(actor, stored, rules);
    } on _DefinitionError {
      // apply.ts applyInSavepoint: a lasting fault, stored, and the queue goes on. Every rule here
      // reads its definitions before it writes, so there is nothing to roll back.
      return _invalid('definition_error');
    }
    // A conflict the sender may not see into is held for a reviewer who may read both instead (apply.ts
    // decide, review finding VS-1). A conflict writes nothing.
    if (actor.holdForReview && outcome['status'] == 'conflict' && c['field'] != null) {
      final redirected = (outcome['details'] as Map<String, Object?>?)?['redirectedTo'] as String?;
      final on = records[redirected ?? stored['recordId']];
      if (on == null || _showsNothing(_fieldForAnswer(actor.userId, on, c['field']! as String))) {
        return _hold(actor, c, 'permission');
      }
    }
    if (actor.holdForReview && outcome['status'] == 'rejected') {
      // Known only once the record is: a problem marked entered in error by someone else.
      if (outcome['reason'] == 'permission') return _hold(actor, c, 'permission');
      if (outcome['reason'] == 'stale_reference') {
        final waitsOn = _heldCreate(actor.userId, c, rules);
        if (waitsOn != null) return _hold(actor, c, 'awaiting_review', waitsOn: waitsOn);
      }
    }
    return outcome;
  }

  /// The value fields that name a record by its UUID, which the database holds in a uuid column
  /// (values.ts's Uuid fields, a status check's lists and an intake's consent IDs aside, which it
  /// keeps as sent in jsonb).
  static const _recordIds = {
    'patientId',
    'encounterId',
    'problemId',
    'noteId',
    'signoffId',
    'flagId',
    'recurrenceOf',
    'resolvedInErrorOf',
    'replacesLinkId',
  };

  /// [c] as the database writes it: a UUID in lowercase, whatever case it was sent in, so an ID in
  /// capitals names the same record and is stored and read in lowercase (review finding MR-3, for
  /// every entity): the record's own ID, the IDs a create's value names, and a set's, an encounter's
  /// patient or a problem status's visit.
  static Map<String, Object?> _asStored(Map<String, Object?> c) {
    Object? lower(Object? id) => id is String ? id.toLowerCase() : id;
    final value = c['value'];
    return {
      ...c,
      'recordId': lower(c['recordId']),
      'value': switch (value) {
        final Map<String, Object?> v when c['op'] == 'create' => {
          for (final MapEntry(:key, value: x) in v.entries) key: _recordIds.contains(key) ? lower(x) : x,
        },
        final String id when c['op'] == 'set' && _recordIds.contains(c['field']) => id.toLowerCase(),
        final Map<String, Object?> v when c['op'] == 'set' && v.containsKey('encounterId') => {
          ...v,
          'encounterId': lower(v['encounterId']),
        },
        _ => value,
      },
    };
  }

  /// apply.ts hold: what it waits on goes to the audit event, not to the phone, whose answer carries
  /// no details (review finding P8).
  Map<String, Object?> _hold(_Actor actor, Map<String, Object?> c, String reason, {String? waitsOn}) {
    quarantine[c['changeId']! as String] = c;
    held[c['changeId']! as String] = (userId: actor.userId, deviceId: actor.deviceId, reason: reason, waitsOn: waitsOn);
    heldInTeam[c['changeId']! as String] = actor.teamId;
    heldAt[c['changeId']! as String] ??= now().toUtc();
    return {'status': 'rejected', 'reason': reason, 'quarantined': true};
  }

  /// The person's own create, held for review, of a record [c] needs: the record it changes, or a
  /// parent it names (a whole intake held, its street names with it). Its change ID.
  String? _heldCreate(String userId, Map<String, Object?> c, EntityRules rules) {
    final needs = <ParentRef>[
      if (c['op'] == 'set') (entity: rules.entity, id: c['recordId']! as String),
      ...parentsOf(entity: rules.entity, op: c['op']! as String, field: c['field'] as String?, value: c['value']),
    ];
    for (final need in needs) {
      for (final q in quarantine.entries) {
        if (held[q.key]?.userId == userId &&
            q.value['op'] == 'create' &&
            q.value['entity'] == need.entity &&
            q.value['recordId'] == need.id) {
          return q.key;
        }
      }
    }
    return null;
  }

  Map<String, Object?> _rejected(String reason, [Map<String, Object?>? details]) => {
    'status': 'rejected',
    'reason': reason,
    'message': 'rejected: $reason',
    'details': ?details,
  };

  Map<String, Object?> _invalid(String problem, [Map<String, Object?> more = const {}]) =>
      _rejected('validation', {'problem': problem, ...more});

  /// Paths and codes only, as apply.ts `issues` reports a schema failure: never a value.
  Map<String, Object?> _problems(Set<String> paths) => {
    'problems': [
      for (final p in paths) {'path': p, 'code': 'invalid'},
    ],
  };

  static Map<String, Object?> _accepted(int version, {Map<String, Object?>? server, Map<String, Object?>? details}) => {
    'status': 'accepted',
    'serverVersion': version,
    'server': ?server,
    'details': ?details,
  };

  Map<String, Object?> _store(
    String userId,
    String deviceId,
    Map<String, Object?> c,
    String hash,
    Map<String, Object?> o,
  ) {
    final id = c['changeId']! as String;
    receipts[id] = _Receipt(
      userId: userId,
      deviceId: deviceId,
      seq: c['seq']! as int,
      entity: c['entity']! as String,
      recordId: c['recordId']! as String,
      field: c['field'] as String?,
      supersedes: c['supersedes'] as String?,
      conflictOf: c['conflictOf'] as String?,
      status: o['status']! as String,
      serverVersion: o['serverVersion'] as int?,
      reason: o['reason'] as String?,
      hash: hash,
      quarantined: o['quarantined'] == true,
      details: o['details'] as Map<String, Object?>?,
    );
    if (o['status'] == 'accepted' && (c['supersedes'] != null || c['conflictOf'] != null)) {
      _settle(id, create: c['op'] == 'create');
    }
    return receipts[id]!.result(this, id);
  }

  /// What an accepted fix or choice covers (apply.ts settle): what the phone folded into it (its
  /// earlier unsettled changes to the field, or a fixed create's record's rejections), then, by
  /// the person's own links, what each of those fixed or resolved in turn.
  void _settle(String id, {required bool create}) {
    final fix = receipts[id]!;
    bool open(_Receipt r) => !r.resolved && !r.quarantined && (r.status == 'rejected' || r.status == 'conflict');
    final queue = [
      id,
      for (final MapEntry(:key, value: r) in receipts.entries)
        if (r.userId == fix.userId &&
            r.recordId == fix.recordId &&
            open(r) &&
            (create ? r.status == 'rejected' : r.deviceId == fix.deviceId && r.field == fix.field && r.seq < fix.seq))
          key,
    ];
    final seen = <String>{};
    while (queue.isNotEmpty) {
      final next = queue.removeLast();
      final r = receipts[next];
      if (r == null || r.userId != fix.userId || !seen.add(next)) continue;
      if (next != id && open(r)) r.resolved = true;
      queue.addAll([r.supersedes, r.conflictOf].whereType<String>());
    }
  }

  static String _when(Map<String, Object?> c) => c['correctedTime'] as String? ?? c['deviceTime']! as String;

  bool _exists(ParentRef p) => p.entity == entityIdLink ? idLinks.containsKey(p.id) : records[p.id]?.entity == p.entity;

  // ---- creates (design 2.2 step 3, 2.3) ----

  Map<String, Object?> _create(_Actor actor, Map<String, Object?> c, EntityRules rules) {
    final value = c['value'];
    final issues = rules.createIssues(value);
    if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
    // Its IDs in lowercase already, as the database writes a UUID (_asStored; patient-flag-change.ts
    // applyCreate passes a flag change's patient and flag so too).
    var v = value! as Map<String, Object?>;
    // An addendum or a correction naming a sign-off a reviewer rejected names none (records.ts
    // withoutRejectedSignoff, review finding PS-2).
    if ((rules.entity == entityAddendum || rules.entity == entityCorrection) &&
        _rejectedInReview(v['signoffId'] as String?)) {
      v = {...v, 'signoffId': null};
    }
    // records.ts NoteCreate bounds the version as every version a change names is (review finding
    // FAK-1). The phone's registry does not yet; once it does, createIssues answers this first.
    if (rules.entity == entityNote && v['noteTypeVersion'] is int && (v['noteTypeVersion']! as int) > maxVersion) {
      return _rejected('validation', _problems({'noteTypeVersion'}));
    }
    final problem = rules.valueProblem('create', null, v, _today);
    if (problem != null) return _invalid(problem);
    for (final p in rules.parentsOfCreate(v)) {
      if (!_exists(p)) return _rejected('stale_reference', {'problem': '${p.entity}_missing'});
    }
    final recordId = c['recordId']! as String;
    final at = _when(c);
    final changeId = c['changeId']! as String;
    if (rules.entity == entityIdLink) return _idLinkHandshake(actor, c, v);

    // The entity's own checks, before the insert (storeCreate's `check`).
    NoteTypeDef? noteType;
    String? authorCredential;
    _FlagHead? flag;
    switch (rules.entity) {
      case entitySignoff:
        return _signoff(actor, c, v);
      case entityCorrection:
        return _correction(actor, c, v);
      // A note of its visit (note-addendum.ts): checked before the insert, as a missing parent is.
      // Its author is recorded as they were when they wrote it.
      case entityAddendum:
        final visit = records[v['encounterId']]!;
        final noteId = v['noteId'] as String?;
        if (noteId != null && records[noteId]!.attributes['encounterId'] != visit.id) {
          return _rejected('stale_reference', {'problem': 'encounter_note_missing'});
        }
        final unread = noteId == null ? null : _unreadableBySender(actor, records[noteId]!);
        if (unread != null) return unread;
        final other = _signoffOfOther(v['signoffId'] as String?, noteId, visit.id);
        if (other != null) return other;
        authorCredential = _signedUnderFor(actor, c, notBefore: visit.storedAt ?? visit.createdAt).credential;
      // A visit of the referral's patient's merged group, or none (referral.ts).
      case entityReferral:
        final encounterId = v['encounterId'] as String?;
        if (encounterId != null && _visitOfOtherPatient(v['patientId']! as String, encounterId)) {
          return _rejected('stale_reference', {'problem': 'encounter_other_patient'});
        }
      // One of the team's flags, whatever its state: an archived one stays on the patient (5.1). A
      // flag hidden from its sender is no refusal they can fix: held, as decide holds a lowered role
      // (patient-flag-change.ts insertFlagChange).
      case entityFlagChange:
        flag = _flagHead(actor.teamId, v['flagId']);
        if (flag == null) return _invalid('unknown_flag');
        if (_flagHidden(actor.permissions, flag)) return _rejected('permission');
      // In this order (note.ts applyCreate): the type and the visit, which the worker can fix; the
      // gate, which holds the change for review; then each answer, as a set of it is checked. A note
      // is taken whatever state the visit's other notes are in.
      case entityNote:
        final version = v['noteTypeVersion'] as int?;
        noteType = version == null ? null : _definition(v['noteTypeKey']! as String, version);
        if (noteType == null) return _invalid('unknown_note_type');
        final medical = _medicalType(noteType);
        if (medical && records[v['encounterId']]!.fields['patientId']?.value == null) {
          return _invalid('medical_note_needs_patient');
        }
        final gated =
            _medicalGate(actor, medical) ??
            _needsGate(actor, noteType, ((v['data'] as Map<String, Object?>?) ?? const {}).keys);
        if (gated != null) return gated;
        for (final MapEntry(key: path, :value) in ((v['data'] as Map<String, Object?>?) ?? const {}).entries) {
          final problem = _byDefinition(() => checkAnswer(noteType!, path, value));
          if (problem != null) return _invalid(problem.code, {'path': path});
        }
      case entityPatient:
        final consent = (v['consent']! as Map<String, Object?>)['id'];
        final notice = (v['privacyNotice']! as Map<String, Object?>)['id'];
        if (consent == notice || records.containsKey(consent) || records.containsKey(notice)) {
          return _invalid('record_exists');
        }
      case entityAlias:
        if (_active(entityAlias, v['patientId']) >= 20) return _invalid('too_many_aliases');
      case entityAllergy:
        // A visit of the patient's merged group, or none (allergy.ts, lifecycle 4.7).
        final encounterId = v['encounterId'] as String?;
        if (encounterId != null && _visitOfOtherPatient(v['patientId']! as String, encounterId)) {
          return _rejected('stale_reference', {'problem': 'encounter_other_patient'});
        }
        if (_active(entityAllergy, v['patientId']) >= 30) return _invalid('too_many_allergies');
      // A visit of the problem's patient's merged group, or none (problem-note.ts, lifecycle 4.7).
      case entityProblemNote:
        final encounterId = v['encounterId'] as String?;
        if (encounterId != null && _visitOfOtherPatient(records[v['problemId']]!.patientId!, encounterId)) {
          return _rejected('stale_reference', {'problem': 'encounter_other_patient'});
        }
      case entityProblem:
        // A visit of the patient's merged group, or none (problem.ts), before the recurrence check.
        final encounterId = v['encounterId'] as String?;
        if (encounterId != null && _visitOfOtherPatient(v['patientId']! as String, encounterId)) {
          return _rejected('stale_reference', {'problem': 'encounter_other_patient'});
        }
        final origin = (v['recurrenceOf'] ?? v['resolvedInErrorOf']) as String?;
        if (origin != null) {
          final earlier = records[origin]!;
          final sameGroup =
              canonicalOf(earlier.patientId!) == canonicalOf(v['patientId']! as String) && earlier.status == 'resolved';
          if (!sameGroup) return _invalid('not_resolved');
        }
    }
    if (records.containsKey(recordId)) return _invalid('record_exists');

    final initial = rules.createdFields(v);
    final record = records[recordId] = FakeRecord(
      id: recordId,
      entity: rules.entity,
      createdAt: DateTime.parse(at),
      author: actor.userId,
      clockVerified: c['clockVerified'] == true,
      attributes: rules.attributes(v),
      status: rules.initialStatus(v),
      patientId: switch (rules.entity) {
        entityProblemNote => records[v['problemId']]!.patientId,
        entityNote => null,
        _ => rules.patientOfCreate(recordId, v),
      },
      fields: {
        for (final MapEntry(:key, :value) in initial.entries) key: FakeField(value, 1, actor.userId, at, changeId),
      },
    );
    // When the server received the create (records.ts createReceivedAt): when its push held it, if an
    // admin's accept made it later. Its row is written now all the same (created_at).
    record
      ..storedAt = heldAt[c['changeId']] ?? now().toUtc()
      ..madeAt = now().toUtc();
    // A patient is its team's (patients.team_id), whose chart no other team reads; a seed's is anyone's.
    if (rules.entity == entityPatient) record.teamId = actor.teamId?.toLowerCase();
    for (final MapEntry(:key, :value) in initial.entries) {
      _history(record, key, 1, value, null, 'created', actor, c);
    }
    Map<String, Object?>? details;
    switch (rules.entity) {
      // What each keeps, as its load() shows it.
      case entityAddendum:
        record.attributes
          ..clear()
          ..addAll({
            'encounterId': v['encounterId'],
            'noteId': v['noteId'],
            'text': v['text'],
            'writtenAt': _iso(DateTime.parse(at)),
            'clockVerified': c['clockVerified'] == true,
            'authorName': nameOf(actor.userId),
            'authorCredential': authorCredential,
          });
      case entityReferral:
        record.attributes
          ..clear()
          ..addAll({
            'patientId': v['patientId'],
            'referredOn': v['referredOn'],
            'details': v['details'],
            'encounterId': v['encounterId'],
            'recordedAt': _iso(DateTime.parse(at)),
            'clockVerified': c['clockVerified'] == true,
          });
      // Its time is the change's, never later than the server's receipt, a held change's hold time
      // (4.5, D90), so a phone whose clock runs ahead never wins every change. Its one field is the
      // mark, so it writes no history of its own.
      case entityFlagChange:
        final made = DateTime.parse(at);
        final receipt = record.storedAt!;
        record.teamId = flag!.teamId;
        record.attributes
          ..clear()
          ..addAll({
            'patientId': v['patientId'],
            'flagId': v['flagId'],
            'action': v['action'],
            'reason': v['reason'],
            'effectiveAt': _isoMs(made.isBefore(receipt) ? made : receipt),
            'clockVerified': c['clockVerified'] == true,
          });
      case entityEncounter:
        // What the server keeps with a visit and no set changes (encounter.ts load).
        record.attributes.addAll({
          'startedAt': at,
          'startedDeviceTime': c['deviceTime'],
          'clockVerified': c['clockVerified'] == true,
        });
        if (v['patientId'] case final String patientId) _seen(patientId, DateTime.parse(at));
      case entityNote:
        record.medical = _medicalType(noteType!);
        _refreshVisit(v['encounterId']);
        if (record.medical) _makeMedical(actor, c, records[v['encounterId']]!);
      case entityPatient:
        for (final name in ['consent', 'privacyNotice']) {
          final decision = v[name]! as Map<String, Object?>;
          final id = decision['id']! as String;
          records[id] = FakeRecord(
            id: id,
            entity: entityConsent,
            createdAt: DateTime.parse(at),
            author: actor.userId,
            attributes: {
              'patientId': recordId,
              'kind': name == 'consent' ? 'care_and_record' : 'privacy_notice',
              ...decision,
            },
            status: 'recorded',
            patientId: recordId,
            fields: {},
          );
        }
        // The server sees legal names and patients the phone's index lacks; a pair flagged against
        // someone the creator wasn't shown is worth telling them about.
        final check = v['matchCheck'] as Map<String, Object?>?;
        final flagged = _rematch(
          recordId,
          'sync',
          shown: ((check?['shown'] as List<Object?>?) ?? const []).cast<String>(),
          dismissed: ((check?['dismissed'] as List<Object?>?) ?? const []).cast<String>(),
        );
        if (flagged) details = {'possibleDuplicate': true};
      case entityAlias:
        _rematch(v['patientId']! as String, 'edit');
      case entityAllergy:
        _clearNoKnownAllergies(actor, c, v['patientId']! as String);
      case entityProblem:
        record
          ..checkedAt = DateTime.parse(at)
          ..attributes['sensitive'] = v['sensitive'] == true || _sensitiveCode(v['code'])
          ..attributes['reversalRequest'] = v['resolvedInErrorOf'] == null ? null : 'open'
          // Made at a visit, or by hand (problem.ts, lifecycle 8.3).
          ..attributes['source'] = v['encounterId'] == null ? 'manual' : 'encounter'
          ..attributes['createdEncounterId'] = v['encounterId'];
      case entityProblemNote:
        // It names its problem's patient, which nothing else of it names (review finding LRA-1).
        record.attributes
          ..clear()
          ..addAll({
            'problemId': v['problemId'],
            'text': v['text'],
            'encounterId': v['encounterId'],
            'writtenAt': _iso(DateTime.parse(at)),
            'patientId': record.patientId,
          });
        // Stored as sent, with the problem it names, retracted or merged since (review finding 7).
        if (records[v['problemId']]!.retracted) details = {'problemRetracted': true};
    }
    return _accepted(1, details: details);
  }

  int _active(String entity, Object? patientId) =>
      records.values.where((r) => r.entity == entity && r.patientId == patientId && r.status == 'active').length;

  /// problem.ts isSensitiveCode: the code's first characters sort inside a listed range.
  static bool _sensitiveCode(Object? code) {
    if (code is! Map<String, Object?>) return false;
    final c = code['code']! as String;
    return sensitiveCodeRanges.any((r) {
      final head = c.substring(0, min(c.length, r.from.length));
      return head.compareTo(r.from) >= 0 && head.compareTo(r.to) <= 0;
    });
  }

  /// "No known allergies" never stands beside an allergy (design 2.3): the group's screen goes back
  /// to "not asked", as the allergy's author, under its change ID.
  void _clearNoKnownAllergies(_Actor actor, Map<String, Object?> c, String patientId) {
    final patient = records[canonicalOf(patientId)]!;
    final cur = patient.fields['allergyScreen'];
    if (cur?.value != 'none_known') return;
    final version = cur!.version + 1;
    _write(patient, 'allergyScreen', 'not_asked', version, actor.userId, _when(c), c['changeId'] as String?);
    _history(patient, 'allergyScreen', version, 'not_asked', 'none_known', 'cleared_by_allergy', actor, c);
  }

  // ---- the ID link handshake (design 10.4) ----

  /// Not an active member of the team any more.
  bool _removed(String userId) => removedUsers.contains(userId) || removedFromTeam.any((k) => k.startsWith('$userId/'));

  Map<String, Object?> _idLinkHandshake(_Actor actor, Map<String, Object?> c, Map<String, Object?> v) {
    final patientId = v['patientId']! as String;
    final patient = records[patientId]!;
    // A card is made on the chart that is kept: the phone makes a new one from the survivor.
    if (patient.status != 'active') {
      return _rejected('stale_reference', {'problem': 'patient_merged', 'survivorId': canonicalOf(patientId)});
    }
    final linkId = c['recordId']! as String;
    if (idLinks.containsKey(linkId)) return _invalid('record_exists');
    final effectiveAt = DateTime.parse(_when(c));
    final active = idLinks.values.where((l) => l.status == 'active' && canonicalOf(l.patientId) == patientId).toList()
      ..sort(
        (a, b) => b.effectiveAt != a.effectiveAt
            ? b.effectiveAt.compareTo(a.effectiveAt)
            : (b.received != a.received ? b.received - a.received : a.id.compareTo(b.id)),
      );
    final named = v['replacesLinkId'] != null && active.any((l) => l.id == v['replacesLinkId']);
    final rival = active.isNotEmpty && !named ? active.first : null;
    final won = rival == null || !effectiveAt.isBefore(rival.effectiveAt);
    final tokenHash = idLinkTokenHash(v['token']! as String);
    // Taken by a link in some team (2^-128): nothing retired or stored.
    if (idLinks.values.any((l) => l.tokenHash == tokenHash)) return _invalid('token_taken');
    final retiring = won ? active : const <FakeIdLink>[];
    for (final l in retiring) {
      l
        ..status = 'retired'
        ..retiredReason = rival == null ? 'regenerated' : 'superseded_by_newer';
    }
    idLinks[linkId] = FakeIdLink(
      id: linkId,
      patientId: patientId,
      token: v['token']! as String,
      tokenHash: tokenHash,
      status: won ? 'active' : 'retired',
      effectiveAt: effectiveAt,
      received: ++_received,
      issuedBy: actor.userId,
      replaces: v['replacesLinkId'] as String?,
    )..retiredReason = won ? null : 'superseded_by_newer';
    if (rival != null) {
      final (winner, loser) = won ? (linkId, rival.id) : (rival.id, linkId);
      notices
        ..add(
          FakeNotice(_uuid(), won ? rival.issuedBy : actor.userId, 'id_link_superseded', entityIdLink, loser, now()),
        )
        ..add(FakeNotice(_uuid(), won ? actor.userId : rival.issuedBy, 'id_link_kept', entityIdLink, winner, now()))
        // Everyone who manages the team's people hears of the conflict, naming the valid card
        // (id-links.ts, review finding P8).
        ..addAll([
          for (final MapEntry(key: user, value: perms) in permissions.entries)
            if (perms.contains('team.manage_users') && !_removed(user))
              FakeNotice(_uuid(), user, 'id_link_conflict', entityIdLink, winner, now()),
        ]);
    }
    return _accepted(
      1,
      details: {
        'linkOutcome': won ? 'active' : 'retired',
        'activeLinkId': won ? linkId : rival.id,
        'retiredLinkIds': won ? [for (final l in retiring) l.id] : [linkId],
      },
    );
  }

  // ---- sets (design 2.2 step 4, 2.4) ----

  Map<String, Object?> _set(_Actor actor, Map<String, Object?> c, EntityRules rules) {
    final field = c['field'] as String?;
    if (field == null) return _invalid('field_missing');
    final cls = rules.fieldClass(field);
    // The API's schema takes an old build's Complete (records.ts Status), which the note's status rule
    // keeps in history; the phone's registry never sends one.
    final oldComplete = rules.entity == entityNote && field == 'status' && c['value'] == 'completed';
    final issues = oldComplete ? <String>{} : rules.fieldIssues(field, c['value']);
    if (issues == null || cls == null) return _invalid('unknown_field');
    if (issues.isNotEmpty) return _rejected('validation', _problems(issues));
    final value = c['value'];
    final problem = rules.valueProblem('set', field, value, _today);
    if (problem != null) return _invalid(problem);
    final named = records[c['recordId']];
    if (named == null || named.entity != rules.entity) {
      return _rejected('stale_reference', {'problem': 'record_missing'});
    }
    for (final p in rules.parentsOfSet(field, value)) {
      if (!_exists(p)) return _rejected('stale_reference', {'problem': '${p.entity}_missing'});
    }
    // Entered in error: the problem's author, or someone who may reverse a resolution (design 9.5).
    if (rules.entity == entityProblem &&
        field == 'enteredInError' &&
        named.author != actor.userId &&
        !actor.permissions.contains('patients.reverse_resolved')) {
      return _rejected('permission');
    }
    // A referral is taken back by its author, or by anyone who charts (referral.ts mayChange).
    if (rules.entity == entityReferral &&
        named.author != actor.userId &&
        !actor.permissions.contains('encounters.chart')) {
      return _rejected('permission');
    }
    // A flag change is marked by its author or whoever manages the team's people, and never by a
    // sender its flag is hidden from, its author included once their role no longer sees it
    // (patient-flag-change.ts mayChange): held for someone who may.
    if (rules.entity == entityFlagChange &&
        (_flagHidden(actor.permissions, _flagHead(named.teamId, named.attributes['flagId'])) ||
            (named.author != actor.userId && !actor.permissions.contains('team.manage_users')))) {
      return _rejected('permission');
    }
    // A Medical visit's summary from a sender the sync read withholds it from is held, whatever
    // version it names, before anything answers with what it holds (apply.ts set, VS-1).
    if (actor.approvedBy == null && _summaryWithheld(actor.permissions, named, field)) {
      return _rejected('permission');
    }
    // A set naming a merged record applies to its survivor, as one that never saw the survivor's
    // value (design 2.7), unless it answers a conflict that showed the survivor's value.
    final redirect = _redirect(named, field);
    final rec = redirect == null ? named : records[redirect['redirectedTo']]!;
    final cur = rec.state(field);
    final saw = redirect == null
        ? c['baseVersion'] == cur['version'] || _followsCurrent(actor, c, rec, field, cur['version']! as int)
        : c['baseVersion'] == cur['version'] && _answersConflictOn(actor, c, rec.id);
    final s = _SetContext(actor, c, rules, rec, field, value, cur, saw, redirect);
    final outcome = switch ((rules.entity, cls)) {
      (entityNote, _) => _noteSet(s),
      (entityEncounter, FieldClass.status) => _kindSet(s),
      (_, FieldClass.draft) => _draftSet(s),
      (_, FieldClass.keepBoth) => _keepBothSet(s),
      (_, FieldClass.identity) => _identitySet(s),
      (_, FieldClass.setOnce) => _setOnceSet(s),
      (_, FieldClass.status) => _statusSet(s),
    };
    // A conflict keeps its survivor on the receipt, so a retry shows the survivor again.
    if (redirect != null && outcome['status'] != 'rejected') {
      return {
        ...outcome,
        'details': {...?outcome['details'] as Map<String, Object?>?, ...redirect},
      };
    }
    return outcome;
  }

  /// A merged patient's survivor, for any of its fields; a merged problem's, for its status only
  /// (a retraction stays on the record it names).
  Map<String, Object?>? _redirect(FakeRecord rec, String field) {
    if (rec.entity == entityPatient && rec.status == 'merged') {
      final merge = merges.values.where((m) => m.mergedId == rec.id && m.undoneAt == null).firstOrNull;
      return {'redirectedTo': canonicalOf(rec.id), 'mergeId': ?merge?.id};
    }
    if (rec.entity == entityProblem && field == 'status' && rec.mergedInto != null) {
      var to = rec;
      for (var hops = 0; to.mergedInto != null && hops < 20; hops++) {
        to = records[to.mergedInto]!;
      }
      return {'redirectedTo': to.id};
    }
    return null;
  }

  /// apply.ts answersConflictOn: [c] answers the person's own conflict on this field of this record,
  /// and that conflict showed [survivorId]'s value (the problem card of a merged entry).
  bool _answersConflictOn(_Actor actor, Map<String, Object?> c, String survivorId) {
    final shown = receipts[c['conflictOf']];
    return shown != null &&
        shown.status == 'conflict' &&
        shown.userId == actor.userId &&
        shown.recordId == c['recordId'] &&
        shown.field == c['field'] &&
        shown.details?['redirectedTo'] == survivorId;
  }

  /// D16, with the exception of design 2.2 step 7: a change that follows the person's own earlier
  /// one saw the current value only when that one reached the chart as sent.
  bool _followsCurrent(_Actor actor, Map<String, Object?> c, FakeRecord rec, String field, int version) {
    final follows = c['follows'] as String?;
    if (follows == null) return false;
    final meta = rec.fields[field];
    if (meta != null && meta.changeId == follows && meta.by == actor.userId) return true;
    final prev = receipts[follows];
    final details = prev?.details;
    final keptNotApplied =
        details?['outcome'] == 'kept_both' || details?['outcome'] == 'history_only' || details?['redirectedTo'] != null;
    return prev != null &&
        prev.status == 'accepted' &&
        !keptNotApplied &&
        prev.userId == actor.userId &&
        prev.recordId == c['recordId'] &&
        prev.field == field &&
        prev.serverVersion == version;
  }

  /// Writes the value: the field's next version and its history (`redirected` for a redirected
  /// change), then what the write sets off (matching again on a name).
  Map<String, Object?> _writeValue(_SetContext s, String kind, {String? approvedBy}) {
    final version = (s.cur['version']! as int) + 1;
    _write(s.rec, s.field, s.value, version, s.actor.userId, _when(s.c), s.c['changeId'] as String?);
    _history(
      s.rec,
      s.field,
      version,
      s.value,
      s.cur['value'],
      s.redirect != null ? 'redirected' : kind,
      s.actor,
      s.c,
      approvedBy: approvedBy,
    );
    if (s.rec.entity == entityPatient && const {'preferredName', 'legalName', 'birth'}.contains(s.field)) {
      _rematch(s.rec.id, 'edit');
    }
    if (s.rec.entity == entityAlias) _rematch(s.rec.patientId!, 'edit');
    // A patient set that applies moves the new patient's last seen to the visit's start (afterWrite).
    if (s.rec.entity == entityEncounter && s.field == 'patientId' && s.value is String) {
      _seen(s.value! as String, DateTime.parse(s.rec.attributes['startedAt']! as String));
    }
    return _accepted(version);
  }

  /// The patient was seen when the visit started (encounter.ts seen): the earlier of that and the
  /// server's clock, later only. The named record, merged or not: reads take the group's latest.
  void _seen(String patientId, DateTime startedAt) {
    final p = records[patientId];
    if (p == null) return;
    final at = startedAt.isAfter(now()) ? now() : startedAt;
    if (at.isAfter(p.seenAt)) p.lastSeenAt = at.toUtc();
  }

  /// One field write and what it decides about its record.
  void _write(FakeRecord rec, String field, Object? value, int version, String by, String at, String? changeId) {
    rec.fields[field] = FakeField(value, version, by, at, changeId);
    switch ((rec.entity, field)) {
      case (entityAlias, 'removal'):
        rec.status = 'removed';
      case (entityAllergy, 'enteredInError') ||
          (entityReferral, 'enteredInError') ||
          (entityFlagChange, 'enteredInError'):
        rec.status = 'entered_in_error';
      case (entityProblem, 'enteredInError'):
        rec.retracted = true;
      case (entityProblem, 'status'):
        rec.status = (value! as Map<String, Object?>)['status']! as String;
        // A confirmation moves only the check date, and it never moves back.
        final when = DateTime.parse(at);
        if (rec.checkedAt == null || when.isAfter(rec.checkedAt!)) rec.checkedAt = when;
      // A reopen is the only status a sync writes: a draft holds no time of finishing (note.ts write).
      case (entityNote, 'status') when value == 'draft':
        rec
          ..completedAt = null
          ..completedBy = null;
    }
    if (rec.entity == entityNote) _refreshVisit(rec.attributes['encounterId']);
  }

  /// One field history row (field_history): `at` is the corrected device time the rules compare,
  /// `deviceTime` the phone's own, `recordedAt` the server's; `approvedBy` whoever chose or accepted
  /// it for the person (records.ts historyOf).
  void _history(
    FakeRecord rec,
    String field,
    int version,
    Object? value,
    Object? previous,
    String kind,
    _Actor actor,
    Map<String, Object?> c, {
    String? reviewId,
    String? approvedBy,
  }) => history.add({
    'id': '${history.length + 1}',
    'at': _when(c),
    'deviceTime': c['deviceTime'],
    'recordedAt': _iso(now()),
    'entity': rec.entity,
    'recordId': rec.id,
    'field': field,
    'version': version,
    'kind': kind,
    'value': value,
    'previous': previous,
    'by': actor.userId,
    'approvedBy': approvedBy ?? actor.approvedBy,
    'changeId': c['changeId'],
    'reviewId': ?reviewId,
  });

  /// Kept in history, not applied: the other value of an open review ([needs]), or history only
  /// (a stale observation, a second retraction, a clear that would leave nobody recognisable, a late
  /// change to a visit or a note). Accepted at the field's version, and the receipt carries the
  /// chart's value (design 2.5). [notice] tells each person it names once (fields.ts keepInHistory).
  Map<String, Object?> _keepInHistory(
    _SetContext s, {
    String? needs,
    String? problem,
    ({String kind, List<String> to})? notice,
  }) {
    String? reviewId;
    if (needs != null) {
      final open = reviews.values
          .where((r) => r.status == 'open' && r.entity == s.rec.entity && r.recordId == s.rec.id && r.field == s.field)
          .firstOrNull;
      reviewId = open?.id ?? _uuid();
      reviews[reviewId] ??= FakeReview(reviewId, s.rec.entity, s.rec.id, s.field, needs, openedAt: now().toUtc());
    }
    _history(
      s.rec,
      s.field,
      s.cur['version']! as int,
      s.value,
      s.cur['value'],
      'kept_both',
      s.actor,
      s.c,
      reviewId: reviewId,
    );
    for (final userId in notice?.to ?? const <String>[]) {
      notices.add(FakeNotice(_uuid(), userId, notice!.kind, s.rec.entity, s.rec.id, now()));
    }
    return _accepted(
      s.cur['version']! as int,
      server: s.cur,
      details: reviewId != null
          ? {'outcome': 'kept_both', 'reviewId': reviewId}
          : {'outcome': 'history_only', 'problem': ?problem},
    );
  }

  /// The person looked at both values and kept the server's: theirs is kept in history.
  /// On a draft ([notifyAuthor]), the record's author is told when the kept value was someone
  /// else's (fields.ts keepServer, review finding P8); a problem's status tells nobody.
  Map<String, Object?> _keepServer(_SetContext s, {bool notifyAuthor = false}) {
    if (!s.saw) return _conflict(s);
    final changedBy = s.cur['changedBy'];
    if (notifyAuthor && changedBy != null && changedBy != s.actor.userId && s.rec.author != s.actor.decider) {
      notices.add(FakeNotice(_uuid(), s.rec.author, 'conflict_resolved', s.rec.entity, s.rec.id, now()));
    }
    _history(
      s.rec,
      s.field,
      s.cur['version']! as int,
      s.value,
      s.cur['value'],
      'kept_both',
      s.actor,
      s.c,
      approvedBy: s.actor.decider,
    );
    return _accepted(s.cur['version']! as int);
  }

  Map<String, Object?> _conflict(_SetContext s) => {
    'status': 'conflict',
    'serverVersion': s.cur['version'],
    'server': s.cur,
  };

  bool _same(Object? a, Object? b) => canonicalJson(a) == canonicalJson(b);

  /// The draft rule (D9): encounters and notes. A value the record takes no more of (the envelope of
  /// a visit with a finished note, an answer to a finished note) is kept in history, the answer to a
  /// conflict included, once it differs from the value held (fields.ts draftSet).
  Map<String, Object?> _draftSet(_SetContext s) {
    final resolution = s.c['resolution'];
    _Kept? keptInstead() => switch (s.rec.entity) {
      entityEncounter => _envelopeKept(s),
      entityNote => _lateChange(s),
      _ => null,
    };
    if (resolution == 'keep_server') {
      // A choice made on a value that has moved since, on a record that takes no more: kept (NOT-10).
      final kept = s.saw ? null : keptInstead();
      if (kept != null) return _keepInHistory(s, problem: kept.problem, notice: kept.notice);
      return _keepServer(s, notifyAuthor: true);
    }
    if (_same(s.cur['value'], s.value)) return _accepted(s.cur['version']! as int);
    final kept = keptInstead();
    if (kept != null) return _keepInHistory(s, problem: kept.problem, notice: kept.notice);
    // The bound is on what reaches the chart: a value kept in history adds no field.
    final dataFields = s.rec.fields.keys.where((f) => f.startsWith('data.')).length;
    if (s.field.startsWith('data.') && !s.rec.fields.containsKey(s.field) && dataFields >= maxNoteFields) {
      return _invalid('too_many_fields');
    }
    if (resolution == 'replace') {
      return s.saw ? _writeValue(s, 'replaced_after_review', approvedBy: s.actor.decider) : _conflict(s);
    }
    if (s.saw) return _writeValue(s, 'set');
    if (isBlankValue(s.cur['value'])) return _writeValue(s, 'filled_blank');
    // "A field that already holds a different value is never overwritten silently."
    return _conflict(s);
  }

  /// The envelope lock (encounter.ts envelopeKept): a patient is never taken off a visit; a visit
  /// with none can always be given one; anything else waits on the visit's notes, and once one is
  /// finished the change is kept and its sender told.
  _Kept? _envelopeKept(_SetContext s) {
    if (s.field == 'patientId') {
      if (s.value == null) return (problem: 'patient_cannot_be_removed', notice: null);
      if (isBlankValue(s.cur['value'])) return null;
    }
    // The sender, and whoever acts as the author of each finished note, once each (encounter.ts).
    final authors = {
      for (final n in _notesOf(s.rec.id))
        if (_noteStatusOf(n) != 'draft') _actingAuthor(n),
    };
    if (authors.isEmpty) return null;
    return (
      problem: 'encounter_has_finished_note',
      notice: (kind: 'late_change_kept', to: [s.actor.userId, ...authors.where((a) => a != s.actor.userId)]),
    );
  }

  /// A visit's kind (encounter.ts kindSet): to Medical from any version, never back, never a conflict.
  Map<String, Object?> _kindSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (_same(s.cur['value'], s.value)) return _accepted(s.cur['version']! as int);
    if (s.value != 'medical') return _keepInHistory(s, problem: 'kind_cannot_go_back');
    return _writeValue(s, 'set');
  }

  /// A set of a note's field (note.ts noteSet): an answer the sender may not see, held; the Medical
  /// gate; the status's own rule; a finished note's late change, kept by the draft rule; then, for a
  /// note with a version, the answer's check against its type, the draft rule, and whether the
  /// answer now on the chart counts. A phase 2 note with no version keeps the open path rule.
  Map<String, Object?> _noteSet(_SetContext s) {
    final unread = _unreadableBySender(s.actor, s.rec);
    if (unread != null) return unread;
    final hidden = _hiddenFromSender(s);
    if (hidden != null) return hidden;
    // A non-author's reopen changes nothing, whatever their credential: not_author first (note.ts).
    if (s.field == 'status' && s.actor.userId != _actingAuthor(s.rec)) return _noteStatusSet(s);
    final gated = _medicalGate(s.actor, s.rec.medical);
    if (gated != null) return gated;
    if (s.field == 'status') return _noteStatusSet(s);
    final needed = _needsGate(s.actor, _noteTypeOf(s.rec), [s.field.substring('data.'.length)]);
    if (needed != null) return needed;
    if (_noteStatusOf(s.rec) != 'draft') return _draftSet(s);
    final type = _noteTypeOf(s.rec);
    if (type == null) return _draftSet(s);
    final path = s.field.substring('data.'.length);
    final problem = _byDefinition(() => checkAnswer(type, path, s.value));
    if (problem != null) return _invalid(problem.code);
    // What the write would leave, taken back if the count throws: the API's savepoint rolls back.
    final before = (field: s.rec.fields[s.field], history: history.length, notices: notices.length);
    final outcome = _draftSet(s);
    // Told only of a value now on the chart: not a conflict, a value kept in history, or the answer
    // to a conflict that kept the server's value.
    if (outcome['status'] != 'accepted' || outcome.containsKey('server') || s.c['resolution'] == 'keep_server') {
      return outcome;
    }
    final String? why;
    try {
      why = _byDefinition(() => notCounted(type, {..._answersOf(s.rec), path: s.value}, path));
    } on _DefinitionError {
      if (before.field == null) {
        s.rec.fields.remove(s.field);
      } else {
        s.rec.fields[s.field] = before.field!;
      }
      history.removeRange(before.history, history.length);
      notices.removeRange(before.notices, notices.length);
      _refreshVisit(s.rec.attributes['encounterId']);
      rethrow;
    }
    if (why == null) return outcome;
    return {
      ...outcome,
      'details': {...?outcome['details'] as Map<String, Object?>?, 'notCounted': why},
    };
  }

  /// Why an answer on the chart does not count (note.ts notCounted), or null when it does: it is in
  /// an entry that is not there, or its field is hidden now. A clear and a removal are never told.
  static String? notCounted(NoteTypeDef type, Answers answers, String path) {
    final target = fieldAt(type, path);
    if (target == null || target.part == AnswerPart.entryRemoved || isBlank(answers[path])) return null;
    final reading = NoteReading(type, answers);
    if (reading.counts(path)) return null;
    if (target.entry != null) {
      final section = reading.model.sections.firstWhere((node) => node.section == target.section);
      if (!reading.entries(section).contains(target.entry)) return 'removed_entry';
    }
    return 'hidden_field';
  }

  /// A set of an answer that could hold something the sender may not see (note.ts hiddenFromSender,
  /// lifecycle 6.4 rule 5; [mayHoldHidden]): asked of the definition and the sender's keys, never of
  /// what the answer holds (review finding RD-10). Held for a Program Admin before anything answers
  /// with the value held there. The acting author sees all of their note, and an admin's accept
  /// passes. A section that needs a capability is _needsGate's.
  Map<String, Object?>? _hiddenFromSender(_SetContext s) {
    if (!s.field.startsWith('data.') || s.actor.approvedBy != null) return null;
    if (s.actor.userId == _actingAuthor(s.rec)) return null;
    final type = _noteTypeOf(s.rec);
    if (type == null) return null;
    final reader = noteReader(s.actor.permissions, credentialOf(s.actor.userId), actsAsAuthor: false);
    final path = s.field.substring('data.'.length);
    return _byDefinition(() => mayHoldHidden(type, path, reader)) ? _rejected('permission') : null;
  }

  /// A note the sender may not read at all (note.ts unreadableBySender, review finding RD-11): every
  /// change of it, and of what hangs off it, is held as a set of a hidden answer is. Whoever acts as
  /// the author reads it, an admin's accept passes, and a phase 2 note is read whole.
  Map<String, Object?>? _unreadableBySender(_Actor actor, FakeRecord note) {
    if (actor.approvedBy != null || actor.userId == _actingAuthor(note)) return null;
    final type = _noteTypeOf(note);
    if (type == null) return null;
    final reader = noteReader(actor.permissions, credentialOf(actor.userId), actsAsAuthor: false);
    return _byDefinition(() => visibleAnswers(type, _answersOf(note), reader)) == null ? _rejected('permission') : null;
  }

  /// A field that holds nothing, as a retry is answered with an answer hidden from its sender.
  static const _nothingShown = <String, Object?>{'value': null, 'version': 0, 'changedBy': null, 'changedAt': null};

  /// A note's field as a retry of [userId]'s change is answered with it (note.ts fieldForSender,
  /// lifecycle 4.4, 6.4 rule 2): as it is now, or, when the sender's keys no longer let them see all
  /// it could hold ([mayHoldHidden]), a field that holds nothing, as a fresh set of it would be held.
  /// Whoever acts as the author is sent it as it is, and so is the field of a phase 2 note; an
  /// unreadable definition hides it.
  Map<String, Object?> _fieldForSender(String userId, FakeRecord note, String field) {
    final state = note.state(field);
    if (!field.startsWith('data.') || userId == _actingAuthor(note)) return state;
    try {
      final type = _noteTypeOf(note);
      if (type == null) return state;
      final reader = noteReader(permissionsOf(userId), credentialOf(userId), actsAsAuthor: false);
      final hidden = _byDefinition(() => mayHoldHidden(type, field.substring('data.'.length), reader));
      return hidden ? _nothingShown : state;
    } on _DefinitionError {
      return _nothingShown;
    }
  }

  /// A record's field as it goes back to [userId] in an answer (apply.ts fieldForAnswer, D86): as the
  /// sync read would show it to them, by its one copy of the rules (review findings VA-1, VS-1). A
  /// record they may not read through sync at all ([_readsRecord]), a note's answer they may not see
  /// all of ([_fieldForSender]) and a Medical visit's summary withheld from them ([_summaryWithheld])
  /// are a field that holds nothing. A flag change's mark goes as [_flagChangeShown] shows it: an
  /// entered-in-error change's reason only to its author and Program Admins, as they are when the
  /// answer is made (review finding MJ-1).
  Map<String, Object?> _fieldForAnswer(String userId, FakeRecord rec, String field) {
    final perms = permissionsOf(userId);
    if (!_readsRecord(perms, rec)) return _nothingShown;
    if (rec.entity == entityNote) return _fieldForSender(userId, rec, field);
    if (_summaryWithheld(perms, rec, field)) return _nothingShown;
    if (rec.entity == entityFlagChange) {
      final shown = _flagChangeShown(userId, perms, rec, _flagHead(rec.teamId, rec.attributes['flagId']));
      if (shown == null) return _nothingShown;
      return ((shown['fields']! as Map<String, Object?>)[field] as Map<String, Object?>?) ?? rec.state(field);
    }
    return rec.state(field);
  }

  /// A Medical visit's summary, which the sync read leaves out for [perms] (apply.ts summaryWithheld).
  static bool _summaryWithheld(Set<String> perms, FakeRecord rec, String field) =>
      rec.entity == entityEncounter && field == 'summary' && _medicalHidden(perms, rec);

  /// A field that holds nothing tells its sender nothing (apply.ts showsNothing).
  static bool _showsNothing(Map<String, Object?> shown) => shown['value'] == null && shown['version'] == 0;

  /// A person as visibleAnswers reads them (records.ts noteReader): their role's keys and their
  /// credential now. A Medical note is read by whoever may read the problem list (D37).
  static NoteReader noteReader(Set<String> permissions, String credential, {required bool actsAsAuthor}) {
    final can = capabilities[credential]!;
    return NoteReader(
      actsAsAuthor: actsAsAuthor,
      viewSensitive: permissions.contains('patients.view_sensitive'),
      viewSensitiveExams: permissions.contains('patients.view_sensitive_exams'),
      readsMedical: mayViewProblems(permissions),
      chartsMedical: can.chartMedical,
      ordersMedications: can.orderMedications,
      sensitiveCodes: sensitiveCodeRanges,
    );
  }

  /// Whether the answer at [path] could hold something [reader] may not see, read from the
  /// definition and the reader's keys alone, never from what the note holds (records.ts
  /// mayHoldHidden; lifecycle 4.4, 6.4 rule 5; review finding RD-10): a note they may not read; a
  /// sensitive exam's section, or a treatment record, they may not read; without view_sensitive,
  /// every answer of a section that holds a diagnosis; without view_sensitive_exams, a field whose
  /// options, rows or regions carry the mark, its Other text, and each entry's own answers in a
  /// repeating section that holds one. Never for whoever acts as the author.
  static bool mayHoldHidden(NoteTypeDef type, String path, NoteReader reader) {
    if (reader.actsAsAuthor) return false;
    if (visibleAnswers(type, const {}, reader) == null) return true;
    final target = fieldAt(type, path);
    if (target == null) return false;
    final section = target.section;
    if (section.sensitiveExam && !reader.viewSensitiveExams) return true;
    if (section.treatmentRecord && !(reader.viewSensitive && reader.chartsMedical)) return true;
    final nodes = [
      for (final n in definitionModel(type).nodes)
        if (n.section.section == section) n,
    ];
    if (!reader.viewSensitive && nodes.any((n) => n.field is ProblemDef)) return true;
    if (reader.viewSensitiveExams) return false;
    if (target.points == Points.entry) return nodes.any(_marked);
    final node = target.leaf?.node ?? nodes.where((n) => n.field == target.field).firstOrNull;
    return [node, node?.grid].any((n) => n != null && _marked(n));
  }

  /// A field whose options, rows or regions carry the sensitive-exam mark (records.ts marked).
  static bool _marked(FieldNode node) {
    final picked = node.picked?.holds;
    final options = switch (node.field) {
      ChoiceDef(:final options) || RegionDef(:final options) => options,
      GridDef(:final rows) => rows ?? (picked is CodesHolds ? picked.options : const <OptionDef>[]),
      _ => const <OptionDef>[],
    };
    return options.any((o) => o.sensitiveExam);
  }

  /// Whether [reader] may not see [value] as the answer at [path] of a note holding [answers]
  /// (records.ts answerHidden): the note, its section, or what visibleAnswers makes of the value.
  /// An answer that does not count is told by what it would be if it counted: any answer of its
  /// entry, or of its section outside a repeating one, is a sensitive diagnosis, counting or not; or
  /// it picks a sensitive exam's option.
  static bool answerHidden(NoteTypeDef type, Answers answers, String path, Object? value, NoteReader reader) {
    if (reader.actsAsAuthor) return false;
    final placed = {...answers, path: value};
    final seen = visibleAnswers(type, placed, reader);
    if (seen == null) return true;
    final target = fieldAt(type, path);
    final section = target?.section;
    if ((section?.sensitiveExam ?? false) && !reader.viewSensitiveExams) return true;
    if ((section?.treatmentRecord ?? false) && !(reader.viewSensitive && reader.chartsMedical)) return true;
    final counted = effectiveAnswers(type, placed);
    if (counted.containsKey(path)) {
      return !seen.containsKey(path) || canonicalJson(seen[path]) != canonicalJson(counted[path]);
    }
    if (target == null) return false;
    final scope = target.entry == null ? '${target.section.id}.' : '${target.section.id}.${target.entry}.';
    if (!reader.viewSensitive) {
      for (final MapEntry(key: p, value: v) in placed.entries) {
        if (!p.startsWith(scope) || v is! String) continue;
        final at = fieldAt(type, p);
        if (at?.field is ProblemDef && at?.part == AnswerPart.code && isSensitiveCode(v, reader.sensitiveCodes)) {
          return true;
        }
      }
    }
    final holds = target.holds;
    if (reader.viewSensitiveExams || holds is! CodesHolds) return false;
    final picked = value is String
        ? {value}
        : value is List
        ? value.toSet()
        : const <Object?>{};
    return holds.options.any((o) => o.sensitiveExam && picked.contains(o.code));
  }

  /// The gate of a section that needs a capability (note.ts needsGate, lifecycle 4.2, 6.4 rule 5): an
  /// answer of a `needs: orderMedications` section, in a create, a set or a correction, needs an
  /// active credential that orders medications, read now, whoever acts as the author. Held for a
  /// Program Admin, whose accept passes.
  Map<String, Object?>? _needsGate(_Actor actor, NoteTypeDef? type, Iterable<String> paths) {
    if (type == null || actor.approvedBy != null) return null;
    final needs = _byDefinition(() => paths.any((path) => fieldAt(type, path)?.section.needs == 'orderMedications'));
    if (!needs) return null;
    return !_removed(actor.userId) && capabilities[credentialOf(actor.userId)]!.orderMedications
        ? null
        : _rejected('permission');
  }

  /// The Medical gate (note.ts medicalGate, lifecycle 4.2): a change to a Medical note needs a
  /// credential that charts Medical, read now. The worker has nothing to fix, so it is held for a
  /// Program Admin (`permission` on a push), and an admin's accept passes.
  Map<String, Object?>? _medicalGate(_Actor actor, bool medical) {
    if (!medical || actor.approvedBy != null) return null;
    return chartsMedical(actor.userId) ? null : _rejected('permission');
  }

  /// signer.ts chartsMedical: an active member whose credential charts Medical.
  bool chartsMedical(String userId) => !_removed(userId) && capabilities[credentialOf(userId)]!.chartMedical;

  /// The definition of a version the team holds (records.ts definitionOf), or null when it holds
  /// none; a forged row, or one the reader cannot read, is a definition error.
  NoteTypeDef? _definition(String key, int version) {
    final json = noteTypes[(key, version)];
    if (json == null) return null;
    if (forged.contains((key, version))) throw _DefinitionError();
    return _parsed[json] ??= _byDefinition(() => NoteTypeDef.fromJson(json));
  }

  final _parsed = Expando<NoteTypeDef>();

  /// The definition of a note's own type (note.ts noteTypeOf): null for a phase 2 note with no
  /// version; a version the team does not hold is nothing the worker can fix.
  NoteTypeDef? _noteTypeOf(FakeRecord note) {
    final version = note.attributes['noteTypeVersion'] as int?;
    if (version == null) return null;
    return _definition(note.attributes['noteTypeKey']! as String, version) ?? (throw _DefinitionError());
  }

  /// A note's answers, by path, as stored.
  static Answers _answersOf(FakeRecord note) => {
    for (final MapEntry(:key, :value) in note.fields.entries)
      if (key.startsWith('data.')) key.substring('data.'.length): value.value,
  };

  /// A finished note keeps a late change (note.ts lateChange): its sender is told, and its acting
  /// author when that is someone else.
  _Kept? _lateChange(_SetContext s) => _noteStatusOf(s.rec) == 'draft' ? null : _lateKept(s);

  _Kept _lateKept(_SetContext s) {
    final author = _actingAuthor(s.rec);
    final to = s.actor.userId == author ? [author] : [s.actor.userId, author];
    return (problem: 'note_finished', notice: (kind: 'late_change_kept', to: to));
  }

  /// Who acts as a note's author (lifecycle 3.8): the clinician assigned after the author left.
  static String _actingAuthor(FakeRecord note) => note.assignedTo ?? note.author;

  /// A note's status from a phone (note.ts statusSet): `draft` is the reopen, by the table of
  /// reopenEffect; `completed` is an old build's Complete, kept in history. It never conflicts.
  Map<String, Object?> _noteStatusSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (s.value == 'completed') return _keepInHistory(s, problem: 'use_signoff');
    ReopenEffect effect({required bool actsAsAuthor}) => reopenEffect(
      noteStatus: NoteStatus.values.byName(_noteStatusOf(s.rec)),
      everSigned: s.rec.everSigned,
      medicalNote: s.rec.medical,
      actsAsAuthor: actsAsAuthor,
    );
    switch (effect(actsAsAuthor: s.actor.userId == _actingAuthor(s.rec))) {
      case ReopenEffect.nothing:
        return _accepted(s.cur['version']! as int);
      case ReopenEffect.apply:
        return _writeValue(s, 'set');
      case ReopenEffect.keepInHistory:
        if (effect(actsAsAuthor: true) == ReopenEffect.apply) {
          return _keepInHistory(s, problem: 'not_author', notice: (kind: 'change_not_applied', to: [s.actor.userId]));
        }
        final late = _lateKept(s);
        return _keepInHistory(s, problem: late.problem, notice: late.notice);
    }
  }

  /// A Medical note type is one offered for Medical encounters only (note.ts isMedicalType).
  static bool _medicalType(NoteTypeDef definition) => !definition.kinds.contains(NoteKind.nonMedical);

  /// A Medical note makes its visit Medical if it was not (note.ts makeMedical): this change's switch
  /// of the visit's kind, its next version and its history.
  void _makeMedical(_Actor actor, Map<String, Object?> c, FakeRecord visit) {
    final cur = visit.state('kind');
    if (cur['value'] == 'medical') return;
    final version = (cur['version']! as int) + 1;
    _write(visit, 'kind', 'medical', version, actor.userId, _when(c), c['changeId'] as String?);
    _history(visit, 'kind', version, 'medical', cur['value'], 'set', actor, c);
  }

  static String _noteStatusOf(FakeRecord note) => note.fields['status']?.value as String? ?? 'draft';

  Iterable<FakeRecord> _notesOf(String encounterId) =>
      records.values.where((r) => r.entity == entityNote && r.attributes['encounterId'] == encounterId);

  /// The trigger of migration 0018 (lifecycle 2.2): a visit's status, worked out from its notes each
  /// time one is made or its status or answers change. An empty draft does not count.
  void _refreshVisit(Object? encounterId) {
    final visit = records[encounterId];
    if (visit == null || encounterId is! String) return;
    visit.status = encounterStatus([
      for (final n in _notesOf(encounterId))
        (
          status: NoteStatus.values.byName(_noteStatusOf(n)),
          medical: n.medical,
          empty: noteIsEmpty({
            for (final MapEntry(:key, :value) in n.fields.entries)
              if (key.startsWith('data.')) key: value.value,
          }),
        ),
    ]).name;
  }

  /// Patient demographics (keep both).
  Map<String, Object?> _keepBothSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (_same(s.cur['value'], s.value)) return _accepted(s.cur['version']! as int);
    // An allergy outranks "No known allergies", whichever arrives first; nothing to review.
    if (s.field == 'allergyScreen' && s.value == 'none_known' && _groupHasActiveAllergy(s.rec.id)) {
      return _keepInHistory(s);
    }
    if (s.saw || isBlankField(s.field, s.cur['value'])) {
      return _writeUnlessUnrecognisable(s, s.saw ? 'set' : 'filled_blank');
    }
    return _keepInHistory(s, needs: 'patients.edit');
  }

  bool _groupHasActiveAllergy(String canonicalId) => records.values.any(
    (r) => r.entity == entityAllergy && r.status == 'active' && canonicalOf(r.patientId!) == canonicalId,
  );

  /// Someone must stay recognisable (design 2.3, D42).
  Map<String, Object?> _writeUnlessUnrecognisable(_SetContext s, String kind) {
    final values = {for (final MapEntry(:key, :value) in s.rec.fields.entries) key: value.value};
    if (!recognisableAfter(values, s.field, s.value)) return _keepInHistory(s, problem: 'nothing_to_recognise');
    return _writeValue(s, kind);
  }

  /// Legal name and birth (identity): a fill only from someone who saw the current value, or into
  /// a blank; anything else is an admin's correction, or a kept alternate for one.
  Map<String, Object?> _identitySet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    final cur = s.cur['value'];
    if (_same(cur, s.value)) return _accepted(s.cur['version']! as int);
    if (isBlankValue(cur)) return _writeUnlessUnrecognisable(s, 'filled_blank');
    if (!s.saw) return _keepInHistory(s, needs: 'patients.correct_identity');
    if (fills(s.field, cur, s.value)) return _writeUnlessUnrecognisable(s, 'filled_blank');
    if (s.field == 'birth' && refinedOutOfRange(cur, s.value)) {
      return _keepInHistory(s, needs: 'patients.correct_identity');
    }
    return _invalid('identity_admin_only');
  }

  /// Retractions: the first is written, a later one kept in history. Never un-set.
  Map<String, Object?> _setOnceSet(_SetContext s) {
    if (s.c['resolution'] != null) return _invalid('nothing_to_resolve');
    if (!isBlankValue(s.cur['value'])) return _keepInHistory(s);
    return _writeValue(s, s.field == 'enteredInError' ? 'entered_in_error' : 'set');
  }

  /// A problem's status (design 9.2): every observation counts, the latest by corrected device time
  /// wins, and only an admin moves a problem out of Resolved.
  Map<String, Object?> _statusSet(_SetContext s) {
    // Kept, and the problem stays retracted: nothing for the worker to fix.
    if (s.rec.retracted) return _keepInHistory(s);
    final resolution = s.c['resolution'];
    if (resolution == 'keep_server') return _keepServer(s);
    if (resolution == 'replace' && !s.saw) return _conflict(s);
    final cur = (s.cur['value']! as Map<String, Object?>)['status'];
    final next = (s.value! as Map<String, Object?>)['status'];
    final forward = problemStatusRank(next) > problemStatusRank(cur);
    if (s.saw) {
      if (next == cur) return _writeValue(s, 'confirmed');
      if (forward) return _writeValue(s, 'set');
      return _invalid(cur == 'resolved' ? 'resolved_needs_admin' : 'status_backwards');
    }
    // Older than the observation the chart holds: history, even when it agrees.
    final observedAt = s.rec.fields['status']?.at;
    if (observedAt != null && DateTime.parse(_when(s.c)).isBefore(DateTime.parse(observedAt))) {
      return _keepInHistory(s);
    }
    if (next == cur) return _writeValue(s, 'confirmed');
    if (forward) return _writeValue(s, 'set');
    if (cur == 'resolved') return _conflict(s);
    return _keepInHistory(s);
  }

  // ---- sign-offs, addenda and corrections (lifecycle 4.6, 4.7) ----

  /// A sign-off (note-signoff.ts): the gate, then signoffEffect's inputs from the note as the server
  /// holds it, and what the function says. A refusal stores nothing, so the same record sent again
  /// is applied fresh. Effect `none` (finished, not the author's, or an empty draft) stores the
  /// sign-off only; any other finishes the note.
  Map<String, Object?> _signoff(_Actor actor, Map<String, Object?> c, Map<String, Object?> v) {
    final note = records[v['noteId']]!;
    // A non-author's sign-off changes nothing, whatever their credential: not_author first (note-signoff.ts).
    final gated =
        _unreadableBySender(actor, note) ??
        (actor.userId == _actingAuthor(note) ? _medicalGate(actor, note.medical) : null);
    if (gated != null) return gated;
    // A phase 2 note has no type to hash it by, and the phone can make no sign-off of one.
    final definition = _noteTypeOf(note) ?? (throw _DefinitionError());
    final answers = _answersOf(note);
    final hashMatches = _byDefinition(() => _contentHash(note, definition)) == v['contentHash'];
    final finishOk = _byDefinition(() => finishCheck(definition, answers)).isEmpty;
    // Asked of a Medical note only: signoffEffect reads it of no other.
    final redFlagsDone =
        !note.medical ||
        _isRedFlags(definition) ||
        _finishedRedFlags(note.attributes['encounterId']! as String, note.id);
    final under = _signedUnderFor(
      actor,
      c,
      notBefore: note.storedAt ?? note.createdAt,
      claimed: v['claimedCredential'] as String?,
    );
    final status = _noteStatusOf(note);
    final effect = signoffEffect(
      noteStatus: NoteStatus.values.byName(status),
      medicalNote: note.medical,
      act: SignoffAct.values.byName(v['act']! as String),
      actsAsAuthor: actor.userId == _actingAuthor(note),
      canSign: under.canSign,
      needsAttestation: under.needsAttestation,
      hashMatches: hashMatches,
      // The empty test the visit's status uses: an empty draft does not count.
      emptyDraft: noteIsEmpty(answers),
      finishOk: finishOk,
      redFlagsDone: redFlagsDone,
    );
    if (effect is SignoffRefused) return _invalid(effect.problem.code);
    final counting = _byDefinition(() => effectiveAnswers(definition, answers));
    if (records.containsKey(c['recordId'])) return _invalid('record_exists');
    final signedAt = _iso(DateTime.parse(_when(c)));
    records[c['recordId']! as String] = FakeRecord(
      id: c['recordId']! as String,
      entity: entitySignoff,
      author: actor.userId,
      createdAt: DateTime.parse(_when(c)),
      clockVerified: c['clockVerified'] == true,
      // The NPI and the credential's other fields stay with the billing export, not the phone.
      attributes: {
        'noteId': note.id,
        'act': v['act'],
        'effect': switch (effect) {
          SignoffApplied(:final effect) => effect.code,
          _ => 'none',
        },
        'contentHash': v['contentHash'],
        // The name and credential as they were then, as an addendum's author is kept (0019).
        'signerName': nameOf(actor.userId),
        'signerCredential': under.credential,
        'claimedCredential': v['claimedCredential'],
        'needsAttestation': under.needsAttestation,
        'statementVersion': v['statementVersion'],
        'signedAt': signedAt,
        'clockVerified': c['clockVerified'] == true,
      },
      status: switch (effect) {
        SignoffApplied(:final effect) => effect.code,
        _ => 'none',
      },
      fields: {},
    )..storedAt = now().toUtc();
    switch (effect) {
      case SignoffRefused():
        throw StateError('refused above');
      case SignoffUnchanged(:final reason):
        // Against the signature that finished it, not the note as it is now (note-signoff.ts).
        final seen = reason == SignoffUnchangedReason.alreadyFinished
            ? (_finishingHash(note) ?? _byDefinition(() => _contentHash(note, definition))) == v['contentHash']
            : hashMatches;
        // "Only the note's author can do that. Nothing was changed."
        if (reason == SignoffUnchangedReason.notAuthor) {
          _notify(actor.userId, 'change_not_applied', entityNote, note.id);
        }
        return _accepted(
          1,
          details: {
            'effect': 'none',
            'reason': reason.code,
            'status': status,
            'attestation': note.attestation,
            // Only to whoever acts as the author (note-signoff.ts): to anyone else it checks a guess.
            if (actor.userId == _actingAuthor(note)) 'hashMatches': seen,
          },
        );
      case SignoffApplied(effect: final outcome, :final statusAfter, :final attestationAfter):
        _finishNote(actor, c, note, counting, statusAfter, attestationAfter, signed: outcome == SignoffOutcome.signed);
        // "Your credential can't sign this note type. It was saved unsigned for a co-signer."
        if (outcome == SignoffOutcome.savedUnsigned) _notify(actor.userId, 'note_saved_unsigned', entityNote, note.id);
        return _accepted(
          1,
          details: {
            'effect': outcome.code,
            'status': statusAfter.name,
            'attestation': attestationAfter.code,
            'hashMatches': hashMatches,
          },
        );
    }
  }

  /// Finishes a note as a sign-off's effect says (note-signoff.ts finishNote): its answers become
  /// those that count, which is what was hashed; its status, who finished it and when, and when
  /// signed the signature it names. The status and each answer dropped get their next version and
  /// a history row, so nothing is lost.
  void _finishNote(
    _Actor actor,
    Map<String, Object?> c,
    FakeRecord note,
    Map<String, Object> counting,
    NoteStatus statusAfter,
    Attestation attestationAfter, {
    required bool signed,
  }) {
    final answers = _answersOf(note);
    final at = _when(c);
    void write(String field, Object? value, Object? previous) {
      final version = (note.fields[field]?.version ?? 0) + 1;
      note.fields[field] = FakeField(value, version, actor.userId, at, c['changeId'] as String?);
      _history(note, field, version, value, previous, 'set', actor, c);
    }

    write('status', statusAfter.name, _noteStatusOf(note));
    for (final path in answers.keys) {
      if (!counting.containsKey(path)) write('data.$path', null, answers[path]);
    }
    note
      ..completedAt = _iso(DateTime.parse(at))
      ..completedBy = actor.userId
      ..everSigned = signed
      ..signoffId = signed ? c['recordId'] as String? : null
      ..attestation = attestationAfter.code;
    _refreshVisit(note.attributes['encounterId']);
  }

  /// The hash of the sign-off that finished [note] (note-signoff.ts finishingHash): by whoever
  /// completed it, at the time it was completed, with an effect. The latest stored wins a tie.
  String? _finishingHash(FakeRecord note) =>
      records.values
              .where(
                (s) =>
                    s.entity == entitySignoff &&
                    s.attributes['noteId'] == note.id &&
                    s.status != 'none' &&
                    s.author == note.completedBy &&
                    s.attributes['signedAt'] == note.completedAt,
              )
              .lastOrNull
              ?.attributes['contentHash']
          as String?;

  /// The hash of a note as the server holds it (lifecycle 4.5): its visit's patient and summary now.
  String _contentHash(FakeRecord note, NoteTypeDef definition) {
    final visit = records[note.attributes['encounterId']]!;
    return noteContentHash(
      noteId: note.id,
      encounterId: visit.id,
      patientId: visit.fields['patientId']?.value as String?,
      summary: visit.fields['summary']?.value as String?,
      definition: definition,
      answers: _answersOf(note),
    );
  }

  /// The Red flags and disposition note, added by itself to a Medical visit (forms 6.2).
  static bool _isRedFlags(NoteTypeDef definition) => definition.auto == 'medical';

  /// The visit holds a finished Red flags note other than [noteId] (note-signoff.ts finishedRedFlags).
  bool _finishedRedFlags(String encounterId, String noteId) => _notesOf(encounterId).any((n) {
    final version = n.attributes['noteTypeVersion'] as int?;
    if (n.id == noteId || _noteStatusOf(n) == 'draft' || version == null) return false;
    final definition = _definition(n.attributes['noteTypeKey']! as String, version);
    return definition != null && _isRedFlags(definition);
  });

  /// signed-under.ts signedUnder (lifecycle 3.5): the credential a signature, an addendum or a
  /// correction is recorded under. A time the server can trust finds the credential held then,
  /// from the first later change; otherwise the one held now. A claim only makes it more careful.
  static SignedUnder signedUnder({
    required String current,
    required List<({String changedAt, String oldCredential})> laterChanges,
    required String signedAt,
    required String receivedAt,
    required bool clockVerified,
    required String notBefore,
    required String? claimed,
  }) {
    if (laterChanges.any((change) => DateTime.tryParse(change.changedAt) == null)) {
      throw StateError('a credential change has a time that cannot be read');
    }
    final at = DateTime.tryParse(signedAt);
    final received = DateTime.tryParse(receivedAt);
    final before = DateTime.tryParse(notBefore);
    // sync/push.ts CLOCK_LIMIT_MS: how far ahead of its receipt a time is believed.
    final timeTrusted =
        clockVerified &&
        at != null &&
        received != null &&
        before != null &&
        at.difference(received) <= const Duration(minutes: 5) &&
        !at.isBefore(before);
    var found = current;
    if (timeTrusted) {
      DateTime? first;
      for (final change in laterChanges) {
        final changed = DateTime.parse(change.changedAt);
        if (changed.isAfter(at) && (first == null || changed.isBefore(first))) {
          first = changed;
          found = change.oldCredential;
        }
      }
    }
    return (
      credential: found,
      timeTrusted: timeTrusted,
      canSign: capabilities[found]!.sign,
      needsAttestation:
          capabilities[found]!.billingNeedsAttestation ||
          (claimed != null && capabilities[claimed]!.billingNeedsAttestation),
      claimDiffers: claimed != null && claimed != found,
    );
  }

  /// [signedUnder] for [actor]'s change [c]: their credential now and its later changes
  /// (signer.ts), the change's time, and when the server received it (records.ts receivedAtOf).
  SignedUnder _signedUnderFor(_Actor actor, Map<String, Object?> c, {required DateTime notBefore, String? claimed}) {
    final signedAt = DateTime.parse(_when(c));
    return signedUnder(
      current: credentialOf(actor.userId),
      laterChanges: [
        for (final change in credentialChanges)
          if (change.userId == actor.userId && change.changedAt.isAfter(signedAt))
            (changedAt: _iso(change.changedAt), oldCredential: change.oldCredential),
      ],
      signedAt: _when(c),
      receivedAt: _iso(heldAt[c['changeId']] ?? now()),
      clockVerified: c['clockVerified'] == true,
      notBefore: _iso(notBefore),
      claimed: claimed,
    );
  }

  /// A notice with no text (user_notices). Only a held sign-off's or correction's names a note, and
  /// only a held flag change's a patient.
  void _notify(String userId, String kind, String entity, String recordId, {String? noteId, String? patientId}) =>
      notices.add(FakeNotice(_uuid(), userId, kind, entity, recordId, now(), noteId: noteId, patientId: patientId));

  /// A patient's record names a visit of someone else (records.ts visitOfOtherPatient): one whose
  /// patient is outside [patientId]'s merged group. A visit that names no patient names nobody else.
  /// The sign-off an addendum or a correction names is one of its note, or with no note, of a note of
  /// its visit (records.ts signoffOfOther); otherwise refused as a missing parent is.
  Map<String, Object?>? _signoffOfOther(String? signoffId, String? noteId, String? encounterId) {
    if (signoffId == null) return null;
    final ofNote = records[signoffId]?.attributes['noteId'] as String?;
    final ours = noteId != null ? ofNote == noteId : records[ofNote]?.attributes['encounterId'] == encounterId;
    return ours ? null : _rejected('stale_reference', {'problem': 'note_signoff_missing'});
  }

  bool _visitOfOtherPatient(String patientId, String encounterId) {
    final seen = records[encounterId]!.fields['patientId']?.value as String?;
    return seen != null && canonicalOf(seen) != canonicalOf(patientId);
  }

  /// A correction (note-correction.ts, lifecycle 4.7), step by step from the one note: whoever does
  /// not act as the author is told; the Medical gate; a declined request is stored as it is; each
  /// new value is one the type takes; a draft is edited by the draft rule; then each answer is still
  /// at the version the person saw (or, never seen, blank or hidden: D109), a correction that changes
  /// nothing the note shows is stored as such, and one that would leave the note failing its finish
  /// check is refused. Otherwise each changed answer that shows, before or after, or that the sender
  /// held at its version, is written as `corrected`, and correctionEffect says what is left of the
  /// signature.
  Map<String, Object?> _correction(_Actor actor, Map<String, Object?> c, Map<String, Object?> v) {
    final recordId = c['recordId']! as String;
    if (records.containsKey(recordId)) return _invalid('record_exists');
    final other = _signoffOfOther(v['signoffId'] as String?, v['noteId']! as String, null);
    if (other != null) return other;
    final note = records[v['noteId']]!;
    final unread = _unreadableBySender(actor, note);
    if (unread != null) return unread;
    final under = _signedUnderFor(
      actor,
      c,
      notBefore: note.storedAt ?? note.createdAt,
      claimed: v['claimedCredential'] as String?,
    );
    final asked = [
      for (final change in (v['changes']! as List<Object?>).cast<Map<String, Object?>>())
        (
          field: change['field']! as String,
          path: (change['field']! as String).substring('data.'.length),
          newValue: change['newValue'],
          baseVersion: change['baseVersion']! as int,
          cur: note.state(change['field']! as String),
        ),
    ];
    final status = _noteStatusOf(note);
    final unchanged = (status: status, attestation: note.attestation);
    Map<String, Object?> store(
      String outcome, [
      ({String status, String attestation})? after,
      Map<String, String> ids = const {},
    ]) {
      final shown = after ?? unchanged;
      records[recordId] = FakeRecord(
        id: recordId,
        entity: entityCorrection,
        author: actor.userId,
        createdAt: DateTime.parse(_when(c)),
        clockVerified: c['clockVerified'] == true,
        attributes: {
          'noteId': note.id,
          // A correction that changed the note names only the answers it wrote (review R1).
          'changes': [
            for (final a in asked)
              if (outcome != 'corrected' || ids.containsKey(a.field))
                {'field': a.field, 'oldValue': a.cur['value'], 'newValue': a.newValue},
          ],
          'outcome': outcome,
          'reason': v['reason'],
          'requestedByPatient': v['requestedByPatient'],
          // The name and credential as they were then, as an addendum's author is kept (0019).
          'correctorName': nameOf(actor.userId),
          'correctorCredential': under.credential,
          'claimedCredential': v['claimedCredential'],
          'correctedAt': _iso(DateTime.parse(_when(c))),
          'clockVerified': c['clockVerified'] == true,
        },
        status: outcome,
        fields: {},
      )..storedAt = now().toUtc();
      correctionHistory[recordId] = ids;
      return _accepted(1, details: {'outcome': outcome, 'status': shown.status, 'attestation': shown.attestation});
    }

    // 1. "The original signer corrects their own note" (PRD main 461): whoever acts as its author.
    if (actor.userId != _actingAuthor(note)) {
      _notify(actor.userId, 'change_not_applied', entityNote, note.id);
      return store('not_author');
    }
    final gated = _medicalGate(actor, note.medical);
    if (gated != null) return gated;
    // A phase 2 note has no type to check a correction by; as a draft it keeps the open path rule.
    final definition = _noteTypeOf(note);
    // So does a section that needs a capability (_needsGate), for the author too.
    final needed = _needsGate(actor, definition, [for (final a in asked) a.path]);
    if (needed != null) return needed;
    if (v['declined'] == true) return store('declined');

    final draft = status == 'draft';
    if (definition == null && !draft) throw _DefinitionError();
    if (definition != null) {
      for (final a in asked) {
        final problem = _byDefinition(() => checkAnswer(definition, a.path, a.newValue));
        if (problem != null) return _invalid(problem.code, {'field': a.field});
      }
    }
    // The draft rule's bound: on what reaches the chart.
    final held = note.fields.keys.where((f) => f.startsWith('data.')).length;
    final added = asked.where((a) => !note.fields.containsKey(a.field)).length;
    if (added > 0 && held + added > maxNoteFields) return _invalid('too_many_fields');

    // 2. A note reopened since is edited as a draft: a value the person saw, or a blank, is
    // written; one they did not see is never overwritten silently.
    if (draft) {
      final writes = <_AnswerWrite>[];
      for (final a in asked) {
        if (_same(a.cur['value'], a.newValue)) continue;
        final kind = a.cur['version'] == a.baseVersion
            ? 'set'
            : isBlankValue(a.cur['value'])
            ? 'filled_blank'
            : null;
        if (kind == null) return _invalid('field_changed', {'field': a.field});
        writes.add((field: a.field, value: a.newValue, previous: a.cur['value'], kind: kind));
      }
      return store('draft_edit', unchanged, _writeAnswers(actor, c, note, writes, null));
    }
    // 6. Each answer is as the person saw it: another correction may have got there first. An answer
    // the note's read never sends, so the sender held no version of it, is written from version 0
    // (D109): one blank now, or one that does not count as the note stands (a correction hid it).
    final stored = _answersOf(note);
    final showsNow = _shows(definition!, stored);
    final moved = asked
        .where(
          (a) =>
              a.cur['version'] != a.baseVersion &&
              (stepSixBeforeD109 || a.baseVersion != 0 || (!isBlankValue(a.cur['value']) && showsNow(a.path))),
        )
        .firstOrNull;
    if (moved != null) return _invalid('field_changed', {'field': moved.field});
    // 7. Nothing to change: "Leave it" after a field_changed sends the value the note holds. A
    // correction whose changes are all to answers hidden before and after changes nothing the note
    // shows, and writes nothing. Beside a change that shows, a hidden answer the sender held at its
    // version is written; one they never held only by a correction that makes it count again.
    final showsAfter = _shows(definition, {...stored, for (final a in asked) a.path: a.newValue});
    final changed = [
      for (final a in asked)
        if (!_same(a.cur['value'], a.newValue)) a,
    ];
    bool counts(String path) => showsNow(path) || showsAfter(path);
    if (!changed.any((a) => counts(a.path))) return store('no_change');
    final writes = <_AnswerWrite>[
      for (final a in changed)
        if (counts(a.path) || a.baseVersion > 0)
          (field: a.field, value: a.newValue, previous: a.cur['value'], kind: 'corrected'),
    ];
    // 8. A correction can never leave a signed note failing its own finish check.
    final answers = {...stored, for (final w in writes) w.field.substring('data.'.length): w.value};
    if (_byDefinition(() => finishCheck(definition, answers)).isNotEmpty) return _invalid('incomplete');

    // 9. The table of 3.6.
    final effect = correctionEffect(
      noteStatus: NoteStatus.values.byName(status),
      attestation: Attestation.values.firstWhere((a) => a.code == note.attestation),
      correctorCanSign: under.canSign,
      correctorNeedsAttestation: under.needsAttestation,
    );
    final told = _reviewersUndone(actor, note, effect);
    final ids = _writeAnswers(actor, c, note, writes, effect);
    final outcome = store('corrected', (
      status: effect.statusAfter.name,
      attestation: effect.attestationAfter.code,
    ), ids);
    // "A note you signed was corrected. It needs your review again."
    for (final userId in told) {
      _notify(userId, 'note_corrected', entityNote, note.id);
    }
    return outcome;
  }

  /// Whether an answer at a path would count in [answers] (note-correction.ts `shows`): its field
  /// shows there, in an entry that is there, and nothing clears it.
  bool Function(String path) _shows(NoteTypeDef definition, Answers answers) {
    final reading = _byDefinition(() => NoteReading(definition, answers));
    return (path) => _byDefinition(() => reading.counts(path));
  }

  /// The co-signer of the signature a correction clears, and whoever attested the note when it is no
  /// longer attested (note-correction.ts reviewersUndone), read before the note is written. Never
  /// the corrector.
  List<String> _reviewersUndone(_Actor actor, FakeRecord note, CorrectionEffect effect) {
    final told = <String>{};
    final signature = records[note.signoffId];
    if (effect.clearSignoff && signature != null && signature.attributes['act'] == 'cosign') told.add(signature.author);
    if (note.attestation == 'attested' && effect.attestationAfter != Attestation.attested) {
      told.addAll([
        for (final a in attestations)
          if (a.noteId == note.id && a.signoffId == note.signoffId) a.by,
      ]);
    }
    return [...told..remove(actor.userId)];
  }

  /// Writes a correction's answers (note-correction.ts writeAnswers): each its next version, with
  /// what correctionEffect says of the status, the signature and the attestation of a finished note;
  /// then a history row for each answer, and for the status when it moves. Each answer's history ID.
  Map<String, String> _writeAnswers(
    _Actor actor,
    Map<String, Object?> c,
    FakeRecord note,
    List<_AnswerWrite> writes,
    CorrectionEffect? effect,
  ) {
    if (writes.isEmpty) return const {};
    final at = _when(c);
    final changeId = c['changeId'] as String?;
    final previous = _noteStatusOf(note);
    final moves = effect != null && effect.statusAfter.name != previous;
    for (final w in writes) {
      note.fields[w.field] = FakeField(w.value, (note.fields[w.field]?.version ?? 0) + 1, actor.userId, at, changeId);
    }
    if (moves) {
      note.fields['status'] = FakeField(
        effect.statusAfter.name,
        note.fields['status']!.version + 1,
        actor.userId,
        at,
        changeId,
      );
    }
    if (effect != null) {
      note.attestation = effect.attestationAfter.code;
      if (effect.clearSignoff) note.signoffId = null;
    }
    final ids = <String, String>{};
    for (final w in writes) {
      _history(note, w.field, note.fields[w.field]!.version, w.value, w.previous, w.kind, actor, c);
      ids[w.field] = history.last['id']! as String;
    }
    if (moves) {
      _history(note, 'status', note.fields['status']!.version, effect.statusAfter.name, previous, 'set', actor, c);
    }
    _refreshVisit(note.attributes['encounterId']);
    return ids;
  }

  // ---- duplicate matching (design 8.2), with the phone's scorer and no sound-alike term ----

  /// The names of a canonical patient's group, as the server's patient_name_keys hold them.
  List<NameKey> _keysOf(String canonicalId) {
    final group = groupOf(canonicalId).toList();
    final ids = {for (final r in group) r.id};
    return [
      for (final r in group) ...[
        NameKey.of(NameSource.preferred, r.fields['preferredName']?.value as String?),
        if (r.fields['legalName']?.value case final Map<String, Object?> legal)
          NameKey.legal(legal['given'] as String?, legal['family'] as String?),
      ],
      for (final a in records.values)
        if (a.entity == entityAlias && a.status == 'active' && ids.contains(a.patientId))
          NameKey.of(NameSource.alias, a.attributes['alias'] as String?),
    ].nonNulls.toList();
  }

  /// Re-runs matching for [patientId]'s group: every other active patient at or above the queue
  /// threshold is flagged (a decided pair is left alone). True when a pair names a patient the
  /// creator was not shown at intake ([shown], [dismissed]).
  bool _rematch(String patientId, String source, {List<String> shown = const [], List<String> dismissed = const []}) {
    final self = canonicalOf(patientId);
    final names = _keysOf(self);
    if (names.isEmpty) return false;
    final subject = MatchSubject(names: names, birth: Birth.fromJson(records[self]!.fields['birth']?.value));
    final exclude = {
      self,
      for (final p in pairs)
        if (p.status == 'kept_separate' && (p.a == self || p.b == self)) p.a == self ? p.b : p.a,
    };
    final candidates = [
      for (final r in records.values)
        if (r.entity == entityPatient && r.status == 'active' && !exclude.contains(r.id))
          CandidateGroup(
            patientId: r.id,
            keys: _keysOf(r.id),
            births: [for (final g in groupOf(r.id)) Birth.fromJson(g.fields['birth']?.value)],
          ),
    ];
    final seen = {...shown, ...dismissed}.map(canonicalOf).toSet();
    var flaggedUnseen = false;
    for (final m in rankMatches(
      subject,
      candidates,
      exclude: exclude,
      minScore: queueThreshold,
      limit: candidateLimit,
    )) {
      final other = m.group.patientId;
      final existing = _pairOf(self, other);
      if (existing == null) {
        pairs.add(FakePair(_uuid(), self, other, m.score.score, [source]));
      } else if (existing.status == 'open' || existing.status == 'not_sure') {
        existing
          ..score = max(existing.score, m.score.score)
          ..sources = {...existing.sources, source}.toList();
      } else {
        continue;
      }
      if (!seen.contains(other)) flaggedUnseen = true;
    }
    return flaggedUnseen;
  }

  // ---- the patient read routes (design 3.1, 6, 7; services/api/src/patients) ----

  static final _chartPath = RegExp(r'^/v1/patients/([0-9a-fA-F-]{36})$');
  static final _noticeRead = RegExp(r'^/v1/team/notices/([^/]+)/read$');

  void _require(String userId, String permission) {
    if (!permissionsOf(userId).contains(permission)) {
      throw const ApiException(403, 'forbidden', 'Your role doesn’t allow this.');
    }
  }

  static String _iso(DateTime t) => t.toUtc().toIso8601String();

  /// [t] to the millisecond, as the API answers a time the database holds to the microsecond: a
  /// JavaScript Date holds no more.
  static String _isoMs(DateTime t) =>
      DateTime.fromMillisecondsSinceEpoch(t.millisecondsSinceEpoch, isUtc: true).toIso8601String();

  /// [t] to the microsecond, with all six places, as note.ts load gives a note's createdAt: the time
  /// Postgres keeps, as text that sorts as the time does (review finding N2-R1).
  static String isoMicros(DateTime t) {
    final u = t.toUtc();
    final places = (u.millisecond * 1000 + u.microsecond).toString().padLeft(6, '0');
    return '${u.toIso8601String().substring(0, 19)}.${places}Z';
  }

  Map<String, Object?> _user(String? id) => {
    'userId': id ?? 'unknown',
    'displayName': id == null ? defaultName : nameOf(id),
  };

  /// The open or not-sure pair touching a group whose sides are still two patients (the most
  /// recently flagged), as a chart, an index entry and a summary show it.
  Map<String, Object?>? _hint(String canonicalId) {
    final p = pairs.reversed
        .where(
          (p) =>
              (p.status == 'open' || p.status == 'not_sure') &&
              canonicalOf(p.a) != canonicalOf(p.b) &&
              (canonicalOf(p.a) == canonicalId || canonicalOf(p.b) == canonicalId),
        )
        .firstOrNull;
    return p == null ? null : {'status': p.status, 'note': p.note};
  }

  /// Records of [entity] that belong to [canonicalId]'s group.
  List<FakeRecord> _ofGroup(String entity, String canonicalId) => [
    for (final r in records.values)
      if (r.entity == entity && r.patientId != null && canonicalOf(r.patientId!) == canonicalId) r,
  ]..sort((a, b) => a.createdAt != b.createdAt ? a.createdAt.compareTo(b.createdAt) : a.id.compareTo(b.id));

  List<FakeIdLink> _activeLinks(String canonicalId) =>
      idLinks.values.where((l) => l.status == 'active' && canonicalOf(l.patientId) == canonicalId).toList()..sort(
        (a, b) => a.effectiveAt != b.effectiveAt ? a.effectiveAt.compareTo(b.effectiveAt) : a.id.compareTo(b.id),
      );

  Set<String> _openReviewFields(String canonicalId) => {
    for (final r in reviews.values)
      if (r.status == 'open' && canonicalOf(r.recordId) == canonicalId) r.field,
  };

  /// Live redirects: every merged record and the canonical patient its chart is now ([into] only).
  List<Map<String, Object?>> _redirects({Set<String>? into}) => [
    for (final r
        in records.values.where((r) => r.entity == entityPatient && r.status == 'merged').toList()
          ..sort((a, b) => a.id.compareTo(b.id)))
      if (into == null || into.contains(canonicalOf(r.id)))
        {
          'mergedId': r.id,
          'survivorId': canonicalOf(r.id),
          'mergedAt': _iso(
            merges.values.where((m) => m.mergedId == r.id && m.undoneAt == null).firstOrNull?.mergedAt ?? now(),
          ),
        },
  ];

  /// The latest last seen of [canonicalId]'s group (team-index.ts, projection.ts: max(last_seen_at)).
  DateTime _groupSeenAt(String canonicalId) => records.values
      .where((r) => r.entity == entityPatient && canonicalOf(r.id) == canonicalId)
      .map((r) => r.seenAt)
      .reduce((a, b) => a.isAfter(b) ? a : b);

  /// One team index entry (team-index.ts): only the PRD's list and bookkeeping, never a legal name,
  /// with the group's current [flags] as the reader may see them, IDs only.
  Map<String, Object?> _indexEntry(FakeRecord p, CurrentFlags flags) {
    final aliases = <Map<String, Object?>>[
      for (final a in _ofGroup(entityAlias, p.id))
        if (a.status == 'active') {'id': a.id, 'alias': a.attributes['alias'], 'kind': 'alias'},
    ];
    // A merged record's preferred name finds the survivor, but it is no street name record: no ID.
    for (final g in groupOf(p.id).where((g) => g.id != p.id)) {
      final name = g.fields['preferredName']?.value;
      if (name is String && name != p.fields['preferredName']?.value && !aliases.any((a) => a['alias'] == name)) {
        aliases.add({'id': null, 'alias': name, 'kind': 'merged_name'});
      }
    }
    return {
      'patientId': p.id,
      'preferredName': p.fields['preferredName']?.value,
      'aliases': aliases.take(20).toList(),
      'visualDescriptor': p.fields['visualDescriptor']?.value,
      'birth': p.fields['birth']?.value,
      'usualArea': p.fields['usualArea']?.value,
      'lastSeenOn': _iso(_groupSeenAt(p.id)).substring(0, 10),
      'allergyScreen': p.fields['allergyScreen']?.value ?? 'not_asked',
      'allergies': [
        for (final a in _ofGroup(entityAllergy, p.id))
          if (a.status == 'active')
            {
              'id': a.id,
              'substance': a.attributes['substance'],
              'category': a.attributes['category'] ?? 'unknown',
              'severity': a.attributes['severity'] ?? 'unknown',
            },
      ],
      'idLinks': [
        for (final l in _activeLinks(p.id)) {'id': l.id, 'effectiveAt': _iso(l.effectiveAt)},
      ],
      // The reviewer's Not sure note is free text, which can hold a legal name (D40): it shows
      // from the chart only (review finding P7).
      'duplicate': switch (_hint(p.id)) {
        final hint? => {'status': hint['status']},
        null => null,
      },
      // Never a change's reason (team-index.ts; BM-83).
      'flags': {'primary': flags.primary, 'secondary': flags.secondary},
      'reviews': _openReviewFields(p.id).toList()..sort(),
      'versions': {
        for (final f in ['preferredName', 'visualDescriptor', 'usualArea', 'allergyScreen'])
          f: p.fields[f]?.version ?? 0,
      },
    };
  }

  /// The index's version: it moves whenever anything an entry the reader holds or the redirect list
  /// shows changes, as the server's statement-level triggers bump its counter, and names the
  /// reader's projection after it, as team-index.ts does (`<counter>.<projection>`).
  final _indexVersions = <String, int>{};

  /// How many index pages were downloaded (tests watch a resumed download).
  int indexPages = 0;

  Map<String, Object?> _index(String userId, String teamId, Map<String, Object?> b) {
    final perms = permissionsOf(userId);
    if (!mayHoldTeamIndex(perms)) {
      throw const ApiException(403, 'index_not_permitted', 'Your role doesn’t keep the patient list on a phone.');
    }
    // A reader the flag rule shows a sensitive flag to holds another copy (team-index.ts, phase 5
    // design 6.1), so a role that gains or loses sight of one downloads the index anew.
    final projection = _flagHidden(perms, (teamId: teamId.toLowerCase(), sensitive: true)) ? 'idx1' : 'idx1+sens';
    final flags = _teamFlags(teamId);
    final active = records.values.where((r) => r.entity == entityPatient && r.status == 'active').toList()
      ..sort((a, b) => a.id.compareTo(b.id));
    final all = [
      for (final p in active) _indexEntry(p, _currentFlags(perms, teamId, flags, _ofGroup(entityFlagChange, p.id))),
    ];
    final content = valueHash({'entries': all, 'redirects': _redirects()});
    final version = '${_indexVersions.putIfAbsent(content, () => _indexVersions.length + 1)}.$projection';
    final base = {'version': version, 'projection': projection, 'generatedAt': _iso(now())};
    final after = b['after'] as String?;
    if (after == null && b['have'] == version) {
      return {...base, 'status': 'unchanged', 'entries': <Object?>[], 'next': null, 'redirects': <Object?>[]};
    }
    final limit = ((b['limit'] as num?) ?? 500).toInt().clamp(100, 1000);
    final rest = [
      for (final e in all)
        if (after == null || (e['patientId']! as String).compareTo(after) > 0) e,
    ];
    final page = rest.take(limit).toList();
    final next = rest.length > limit ? page.last['patientId'] : null;
    indexPages++;
    serverAudit.add({
      'action': 'patient.index_downloaded',
      'userId': userId,
      'details': {'version': version, 'after': after, 'next': next, 'count': page.length},
    });
    return {...base, 'status': 'page', 'entries': page, 'next': next, 'redirects': after == null ? _redirects() : []};
  }

  /// A record as RecordSnapshot shows it.
  Map<String, Object?> _snapshot(FakeRecord r, Map<String, Object?> attributes, List<String> fieldNames) {
    final versions = [for (final f in r.fields.values) f.version];
    return {
      'entity': r.entity,
      'id': r.id,
      'version': versions.isEmpty ? 1 : versions.reduce(max),
      'status': r.status,
      'authorUserId': r.author,
      'createdAt': _iso(r.createdAt),
      'updatedAt': _iso(r.createdAt),
      'attributes': attributes,
      'fields': {for (final f in fieldNames) f: r.state(f)},
    };
  }

  /// A problem as the chart and the sync read alike show it, with whether its status check is due by
  /// the team's window of [checkDays] at the server's time (charts.ts problemSnapshot, review.ts
  /// withStatusCheck; phase 5 design 5.3): never for one Resolved or entered in error.
  Map<String, Object?> _problemSnapshot(FakeRecord r, int checkDays) {
    final code = r.attributes['code'] as Map<String, Object?>?;
    return _snapshot(
      r,
      {
        'patientId': r.patientId,
        'title': r.attributes['title'],
        'code': code == null ? null : {'system': code['system'], 'code': code['code'], 'display': code['display']},
        'sensitive': r.attributes['sensitive'] == true,
        'source': r.attributes['source'],
        'createdEncounterId': r.attributes['createdEncounterId'],
        'onsetDate': r.attributes['onsetDate'],
        'recurrenceOf': r.attributes['recurrenceOf'],
        'resolvedInErrorOf': r.attributes['resolvedInErrorOf'],
        'reversalRequest': r.attributes['reversalRequest'],
        'mergedInto': r.mergedInto,
        'statusChangedAt': _iso(r.checkedAt ?? r.createdAt),
        'statusCheckedAt': _iso(r.checkedAt ?? r.createdAt),
        'statusCheckDue': problemCheckDue(
          (status: r.status, statusCheckedAt: r.checkedAt ?? r.createdAt, enteredInError: r.retracted),
          now(),
          checkDays,
        ),
      },
      const ['status', 'enteredInError'],
    );
  }

  /// The platform's window for a problem's status check (projection.ts PLATFORM_CHECK_DAYS): its
  /// newest settings preset's, in packages/presets/data/platform.json, the one the installer would give
  /// a team that holds none yet.
  static final platformProblemCheckDays = () {
    final platform = jsonDecode(File('../../packages/presets/data/platform.json').readAsStringSync()) as List<Object?>;
    final settings = [
      for (final e in platform.cast<Map<String, Object?>>())
        if (e['kind'] == 'settings') e,
    ]..sort((a, b) => (b['platformVersion']! as int).compareTo(a['platformVersion']! as int));
    return (settings.first['body']! as Map<String, Object?>)['problemCheckDays']! as int;
  }();

  /// How many days a problem's status may go unchecked in [teamId] (projection.ts problemCheckDays):
  /// its settings preset's window, read from the current version, when that is a number, else the
  /// platform's.
  int _problemCheckDays(String teamId) {
    for (final head in presetTeams[teamId.toLowerCase()]?.heads.values ?? const <FakePreset>[]) {
      final body = head.versions[head.currentVersion];
      if (head.kind != 'settings' || body == null) continue;
      return switch (body['problemCheckDays']) {
        final int days => days,
        _ => platformProblemCheckDays,
      };
    }
    return platformProblemCheckDays;
  }

  /// A group's chart, projected for [userId]'s role (charts.ts loadGroupCharts and projectChart):
  /// problems only with the problem list's permissions, sensitive ones only with view_sensitive,
  /// card links only with patients.edit, and the flags the flag rule shows them ([_chartFlags]),
  /// whatever their role. A legal name stays: the chart is the person's own.
  Map<String, Object?> _chartOf(String userId, String teamId, String canonicalId) {
    final perms = permissionsOf(userId);
    final problemsShown = mayViewProblems(perms);
    final sensitive = problemsShown && perms.contains('patients.view_sensitive');
    final urls = perms.contains('patients.edit');
    final p = records[canonicalId]!;
    final problems = [
      for (final r in _ofGroup(entityProblem, canonicalId))
        if (sensitive || r.attributes['sensitive'] != true) r,
    ];
    final problemIds = {for (final r in problems) r.id};
    final checkDays = _problemCheckDays(teamId);
    return {
      'patient': _snapshot(p, {
        'registeredAt': _iso(p.createdAt),
        'clockVerified': p.clockVerified,
        'lastSeenAt': _iso(p.seenAt),
      }, patientFieldNames),
      'canonicalId': canonicalId,
      'mergedFrom': [
        for (final m in merges.values)
          if (m.undoneAt == null && canonicalOf(m.mergedId) == canonicalId)
            {'patientId': m.mergedId, 'mergedAt': _iso(m.mergedAt), 'mergeId': m.id},
      ],
      'aliases': [
        for (final a in _ofGroup(entityAlias, canonicalId))
          _snapshot(a, {'patientId': a.patientId, 'alias': a.attributes['alias']}, const ['removal']),
      ],
      'allergies': [
        for (final a in _ofGroup(entityAllergy, canonicalId))
          _snapshot(
            a,
            {
              'patientId': a.patientId,
              'substance': a.attributes['substance'],
              'category': a.attributes['category'] ?? 'unknown',
              'reaction': a.attributes['reaction'],
              'severity': a.attributes['severity'] ?? 'unknown',
              'encounterId': a.attributes['encounterId'],
              'recordedAt': _iso(a.createdAt),
            },
            const ['enteredInError'],
          ),
      ],
      'consents': [
        for (final c in _ofGroup(entityConsent, canonicalId))
          {
            'id': c.id,
            'kind': c.attributes['kind'],
            'decision': c.attributes['decision'],
            'method': c.attributes['method'] ?? 'verbal',
            'recordedAt': _iso(c.createdAt),
            'recordedBy': _user(c.author),
          },
      ],
      if (problemsShown) ...{
        'problems': [for (final r in problems) _problemSnapshot(r, checkDays)],
        'problemHistory': [
          for (final h in history)
            if (h['entity'] == entityProblem && h['field'] == 'status' && problemIds.contains(h['recordId']))
              {
                'historyId': h['id'],
                'problemId': h['recordId'],
                'status': (h['value']! as Map<String, Object?>)['status'],
                'encounterId': (h['value']! as Map<String, Object?>)['encounterId'],
                'by': _user(h['by'] as String?),
                'at': h['at'],
                'kind': h['kind'],
              },
        ],
        'problemNotes': [
          for (final n in records.values)
            if (n.entity == entityProblemNote && problemIds.contains(n.attributes['problemId']))
              {
                'id': n.id,
                'problemId': n.attributes['problemId'],
                'text': n.attributes['text'],
                'encounterId': n.attributes['encounterId'],
                'writtenAt': _iso(n.createdAt),
                'author': _user(n.author),
              },
        ],
      },
      'idLinks': [
        for (final l in _activeLinks(canonicalId))
          {
            'id': l.id,
            'issuedOn': l.patientId,
            'status': l.status,
            'effectiveAt': _iso(l.effectiveAt),
            'madeOffline': true,
            if (urls) 'url': idLinkUrl(idLinkBaseUrl, l.token),
          },
      ],
      // A chart names the record each review is on.
      'reviews': [
        for (final r in reviews.values)
          if (r.status == 'open' && canonicalOf(r.recordId) == canonicalId) _reviewView(r, patientId: r.recordId),
      ],
      'duplicate': _hint(canonicalId),
      ..._chartFlags(userId, perms, teamId, canonicalId),
      'projection': ['c1', if (problemsShown) 'prob', if (sensitive) 'sens', if (urls) 'url'].join('+'),
    };
  }

  /// The flag changes of [canonicalId]'s merged group, both records' of a merge, by their time to the
  /// millisecond, as the API's Date holds it, then ID by code units: the order the fold reads them in
  /// (charts.ts byTimeThenId).
  List<FakeRecord> _flagChangesOf(String canonicalId) => _ofGroup(entityFlagChange, canonicalId)
    ..sort((a, b) {
      final byTime = _effectiveAt(a).millisecondsSinceEpoch.compareTo(_effectiveAt(b).millisecondsSinceEpoch);
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });

  static DateTime _effectiveAt(FakeRecord change) => DateTime.parse(change.attributes['effectiveAt']! as String);

  /// A patient's current flags as [perms] may see them (projection.ts flagsReader and currentFlagsOf):
  /// the fold of every flag change of their group, the phone's copy of it, which flag-current.json
  /// holds to the server's, over [teamId]'s flags, archived ones included, with the reader's flag rule.
  CurrentFlags _currentFlags(
    Set<String> perms,
    String teamId,
    Map<String, _TeamFlag> flags,
    Iterable<FakeRecord> changes,
  ) => currentFlags(
    changes: [
      for (final c in changes)
        (
          id: c.id,
          flagId: c.attributes['flagId']! as String,
          action: c.attributes['action']! as String,
          effectiveAt: _effectiveAt(c),
          enteredInError: c.status == 'entered_in_error',
        ),
    ],
    flags: {
      for (final f in flags.values)
        f.id: (
          tier: f.tier == 'secondary' ? FlagTier.secondary : FlagTier.primary,
          rank: f.rank,
          name: f.name ?? '',
          sensitive: f.head.sensitive,
          state: f.archived ? PresetState.archived : PresetState.active,
        ),
    },
    hidden: (f) => _flagHidden(perms, (teamId: teamId.toLowerCase(), sensitive: f.sensitive)),
  );

  /// A flag as the chart shows it (projection.ts flagView): as the team holds it now, with its
  /// colour's plain name.
  static Map<String, Object?> _flagView(_TeamFlag f) => {
    'flagId': f.id,
    'name': f.name,
    'tier': f.tier,
    'color': f.color,
    'colorName': FlagColor.byCode(f.color ?? '')?.colorName ?? f.color,
    'rank': f.rank,
    'archived': f.archived,
  };

  /// A chart's flag changes and flags as [userId] may see them (projection.ts projectFlags, charts.ts
  /// loadGroupCharts; design 7). Each change of the group goes through the flag rule and its reasons
  /// rule ([_flagChangeShown]) with its flag as [teamId] holds it now, so a change of a flag hidden from
  /// the reader is absent, never blanked, with its history row, and one entered in error keeps its
  /// reasons only for its author and whoever manages the team's people. The current flags are the fold
  /// of every change with the reader's flag rule ([_currentFlags]). A history row says what its
  /// snapshot says, and names its author, and who marked it, by their names now.
  Map<String, Object?> _chartFlags(String userId, Set<String> perms, String teamId, String canonicalId) {
    final flags = _teamFlags(teamId);
    final changes = _flagChangesOf(canonicalId);
    final shown = [
      for (final c in changes)
        if (flags[c.attributes['flagId']] case final flag?)
          if (_flagChangeShown(userId, perms, c, flag.head) case final snapshot?)
            (change: c, flag: flag, snapshot: snapshot),
    ];
    final current = _currentFlags(perms, teamId, flags, changes);
    return {
      'flagChanges': [for (final s in shown) s.snapshot],
      'flags': {
        'primary': current.primary == null ? null : _flagView(flags[current.primary]!),
        'secondary': [for (final id in current.secondary) _flagView(flags[id]!)],
        'history': [for (final s in shown) _flagHistoryRow(s.change, s.flag, s.snapshot)],
      },
    };
  }

  /// One row of a chart's flag history (projection.ts projectFlags): what its shown [snapshot] says,
  /// with its flag as the team holds it now, and its author, and who marked it and when, by their
  /// names now. A reason the snapshot leaves out is left out here too, never blank.
  Map<String, Object?> _flagHistoryRow(FakeRecord change, _TeamFlag flag, Map<String, Object?> snapshot) {
    final attributes = snapshot['attributes']! as Map<String, Object?>;
    final mark = ((snapshot['fields']! as Map<String, Object?>)['enteredInError']! as Map<String, Object?>)['value'];
    final marked = change.fields['enteredInError'];
    return {
      'changeId': change.id,
      'flagId': flag.id,
      'name': flag.name,
      'tier': flag.tier,
      'action': attributes['action'],
      'effectiveAt': attributes['effectiveAt'],
      'authorName': nameOf(change.author),
      if (attributes.containsKey('reason')) 'reason': attributes['reason'],
      'enteredInError': change.status != 'entered_in_error' || marked == null
          ? null
          : {
              'byName': marked.by == null ? '' : nameOf(marked.by!),
              'at': _isoMs(DateTime.parse(marked.at!)),
              if (mark case {'reason': final reason}) 'reason': reason,
            },
    };
  }

  /// How many charts each request asked for (tests watch the phone's batch sizes).
  final chartRequests = <int>[];

  /// POST /v1/patients/charts: the charts of the requested patients' groups, and every live
  /// redirect into the returned groups. One `patient.viewed {source: 'cache'}` per chart.
  Map<String, Object?> _charts(String userId, String teamId, Map<String, Object?> b) {
    _require(userId, 'patients.view');
    final requested = {for (final id in (b['patientIds']! as List<Object?>).cast<String>()) id.toLowerCase()};
    chartRequests.add(requested.length);
    final groups = <String>{
      for (final id in requested)
        if (records[id]?.entity == entityPatient) canonicalOf(id),
    };
    final charts = [
      for (final id in groups)
        if (records[id]!.status == 'active') _chartOf(userId, teamId, id),
    ];
    for (final c in charts) {
      serverAudit.add({
        'action': 'patient.viewed',
        'userId': userId,
        'patientId': c['canonicalId'],
        'details': {'source': 'cache', 'reason': b['reason']},
      });
      _auditLinkViews(userId, c, 'cache');
    }
    final returned = {for (final c in charts) c['canonicalId']! as String};
    return {
      'charts': charts,
      'missing': [
        for (final id in requested)
          if (records[id]?.entity != entityPatient || !returned.contains(canonicalOf(id))) id,
      ],
      'redirects': _redirects(into: returned),
    };
  }

  /// GET /v1/patients/{id}: the group's chart; a merged ID answers the survivor's with
  /// `redirectedFrom`.
  Map<String, Object?> _chart(String userId, String teamId, String patientId) {
    _require(userId, 'patients.view');
    final named = records[patientId];
    // Another team's patient is none of this team's, as row-level security keeps it (charts.ts reads
    // the chart in the team's scope): 404, and nothing is logged.
    if (named?.entity != entityPatient || (named!.teamId != null && named.teamId != teamId.toLowerCase())) {
      throw const ApiException(404, 'not_found', 'No such patient.');
    }
    final canonical = canonicalOf(patientId);
    final chart = _chartOf(userId, teamId, canonical);
    serverAudit.add({
      'action': 'patient.viewed',
      'userId': userId,
      'patientId': canonical,
      'details': {'source': 'phone'},
    });
    _auditLinkViews(userId, chart, 'phone');
    return {...chart, if (canonical != patientId) 'redirectedFrom': patientId};
  }

  /// A chart that carries card links (patients.edit) is a read of those links (charts.ts
  /// auditLinkViews, design 10.6): one `id_link.viewed {linkId, tokenRef, source}` per link shown.
  void _auditLinkViews(String userId, Map<String, Object?> chart, String source) {
    for (final l in (chart['idLinks']! as List<Object?>).cast<Map<String, Object?>>()) {
      final url = l['url'] as String?;
      if (url == null) continue;
      serverAudit.add({
        'action': 'id_link.viewed',
        'userId': userId,
        'patientId': chart['canonicalId'],
        'entityId': l['id'],
        'details': {'linkId': l['id'], 'tokenRef': idLinkTokenRef(Uri.parse(url).fragment), 'source': source},
      });
    }
  }

  /// A group as the scorer reads it: every record's names of [sources], and every birth.
  CandidateGroup _candidate(String canonicalId, Set<NameSource> sources) {
    final group = groupOf(canonicalId).toList();
    final ids = {for (final r in group) r.id};
    return CandidateGroup(
      patientId: canonicalId,
      keys: [
        for (final r in group) ...[
          if (sources.contains(NameSource.preferred))
            NameKey.of(NameSource.preferred, r.fields['preferredName']?.value as String?),
          if (sources.contains(NameSource.legal))
            if (r.fields['legalName']?.value case final Map<String, Object?> legal)
              NameKey.legal(legal['given'] as String?, legal['family'] as String?),
          if (sources.contains(NameSource.descriptor))
            NameKey.of(NameSource.descriptor, r.fields['visualDescriptor']?.value as String?),
        ],
        if (sources.contains(NameSource.alias))
          for (final a in records.values)
            if (a.entity == entityAlias && a.status == 'active' && ids.contains(a.patientId))
              NameKey.of(NameSource.alias, a.attributes['alias'] as String?),
      ].nonNulls,
      births: [for (final r in group) Birth.fromJson(r.fields['birth']?.value)],
      lastSeen: group.map((r) => r.seenAt).reduce((a, b) => a.isAfter(b) ? a : b),
    );
  }

  Iterable<String> get _activePatients =>
      records.values.where((r) => r.entity == entityPatient && r.status == 'active').map((r) => r.id);

  /// Who someone is in a result list (projection.ts loadSummaries and projectSummary): on the phone,
  /// never a legal name (D40).
  Map<String, Object?> _summary(String canonicalId, String surface) {
    final p = records[canonicalId]!;
    final birth = p.fields['birth']?.value as Map<String, Object?>?;
    final allergies = _ofGroup(entityAllergy, canonicalId).where((a) => a.status == 'active').toList();
    final today = now().toUtc();
    int? age;
    if (birth != null) {
      final b = Birth.fromJson(birth)!;
      age = switch (b) {
        BirthDate(:final year, :final month, :final day) =>
          today.year - year - (today.month < month || (today.month == month && today.day < day) ? 1 : 0),
        _ => today.year - b.year,
      };
    }
    return {
      'preferredName': p.fields['preferredName']?.value,
      if (surface != 'phone') 'legalName': p.fields['legalName']?.value,
      'aliases': [
        for (final a in _ofGroup(entityAlias, canonicalId).where((a) => a.status == 'active').take(5))
          a.attributes['alias'],
      ],
      'visualDescriptor': p.fields['visualDescriptor']?.value,
      'birth': birth,
      'ageYears': age,
      'usualArea': p.fields['usualArea']?.value,
      'lastSeenOn': _iso(_groupSeenAt(p.id)).substring(0, 10),
      'allergy': {
        'screen': p.fields['allergyScreen']?.value ?? 'not_asked',
        'count': allergies.length,
        'severe': allergies.any((a) => a.attributes['severity'] == 'severe'),
      },
      'duplicateHint': _hint(canonicalId) != null,
    };
  }

  Map<String, Object?> _hit(RankedGroup h, String surface) => {
    'patientId': h.group.patientId,
    'score': h.score.score,
    'band': h.score.band.toJson(),
    'reasons': [for (final r in h.score.reasons) r.toJson()],
    'summary': _summary(h.group.patientId, surface),
  };

  /// POST /v1/patients/search (search.ts), scored with the phone's scorer (no sound-alike term).
  /// `flagIds` (phase 5 design 7), read in lowercase and each once, keeps the hits carrying every flag
  /// named among their current flags as the reader may see them ([_currentFlags]), either tier, before
  /// the cut, so a narrowed search still fills its limit and says when more matched; the event counts
  /// the flags and names none. A flag the flag rule hides from the caller, one the team does not hold
  /// among them, is refused before anything is searched, with no search event.
  Map<String, Object?> _search(String userId, String teamId, Map<String, Object?> b) {
    _require(userId, 'patients.view');
    final perms = permissionsOf(userId);
    final flagIds = switch (b['flagIds']) {
      final List<Object?> ids => {for (final id in ids) (id! as String).toLowerCase()}.toList(),
      _ => null,
    };
    final flags = _teamFlags(teamId);
    if (flagIds != null && flagIds.any((id) => _flagHidden(perms, flags[id]?.head))) {
      throw const ApiException(403, 'flag_hidden', 'Your role can’t search by one of these flags.');
    }
    final name = b['name'] as String?;
    final birth = b['birth'] as Map<String, Object?>?;
    final year = (birth?['year'] as num?)?.toInt();
    final month = (birth?['month'] as num?)?.toInt();
    final day = (birth?['day'] as num?)?.toInt();
    final query = year != null && month != null && day == null
        ? SearchQuery.yearMonth(text: name, month: (year: year, month: month))
        : SearchQuery(
            text: name,
            birth: year == null
                ? null
                : day != null && month != null
                ? BirthDate(year, month, day)
                : BirthYear(year),
          );
    final surface = b['surface'] as String? ?? 'phone';
    final all = NameSource.values.toSet();
    final limit = ((b['limit'] as num?) ?? searchLimit).toInt();
    final candidates = [for (final id in _activePatients) _candidate(id, all)];
    var (:hits, :truncated) = query.isEmpty
        ? (hits: const <RankedGroup>[], truncated: false)
        : rankSearch(query, candidates, limit: flagIds == null ? limit : candidates.length);
    if (flagIds != null) {
      final carrying = [
        for (final h in hits)
          if (_currentFlags(perms, teamId, flags, _ofGroup(entityFlagChange, h.group.patientId)) case final held
              when flagIds.every((id) => held.primary == id || held.secondary.contains(id)))
            h,
      ];
      hits = carrying.take(limit).toList();
      truncated = carrying.length > limit;
    }
    final shown = [for (final h in hits) _hit(h, surface)];
    serverAudit.add({
      'action': 'patient.searched',
      'userId': userId,
      'details': {
        'resultCount': shown.length,
        'patientIds': [for (final h in shown) h['patientId']],
        'criteria': [if (name != null) 'name', if (year != null) day != null ? 'birth_full' : 'birth_year'],
        'surface': surface,
        'flagCount': ?flagIds?.length,
      },
    });
    return {'hits': shown, 'truncated': truncated};
  }

  /// POST /v1/patients/match (match.ts): the intake's check before saving.
  Map<String, Object?> _match(String userId, Map<String, Object?> b) {
    // The candidates are names and births: a role refused search is refused them here too (S5).
    _require(userId, 'patients.view');
    _require(userId, 'patients.edit');
    final legal = b['legalName'] as Map<String, Object?>?;
    final birth = b['birth'] as Map<String, Object?>?;
    final subject = MatchSubject.of(
      preferredName: b['preferredName'] as String?,
      legalName: legal == null ? null : (given: legal['given'] as String?, family: legal['family'] as String?),
      aliases: ((b['aliases'] as List<Object?>?) ?? const []).cast<String>(),
      birth: Birth.fromJson(birth),
    );
    final exclude = <String>{};
    final own = b['excludePatientId'] as String?;
    if (own != null && records[own]?.entity == entityPatient) {
      final self = canonicalOf(own);
      exclude.add(self);
      for (final p in pairs) {
        if (p.status == 'kept_separate' && (p.a == self || p.b == self)) exclude.add(p.a == self ? p.b : p.a);
      }
    }
    final surface = b['surface'] as String? ?? 'phone';
    final found = rankMatches(subject, [
      for (final id in _activePatients) _candidate(id, {NameSource.legal, NameSource.preferred, NameSource.alias}),
    ], exclude: exclude);
    final checkId = _uuid();
    final candidates = [for (final f in found) _hit(f, surface)];
    serverAudit.add({
      'action': 'patient.match_checked',
      'userId': userId,
      'details': {
        'checkId': checkId,
        'patientIds': [for (final c in candidates) c['patientId']],
        'surface': surface,
      },
    });
    return {'checkId': checkId, 'candidates': candidates};
  }

  /// The person's newest 100 notices, newest first (review.ts listNotices, review finding P8).
  static const noticeLimit = 100;

  List<Object?> _notices(String userId) {
    final mine = [
      for (final (i, n) in notices.indexed)
        if (n.userId == userId) (i, n),
    ]..sort((a, b) => b.$2.createdAt != a.$2.createdAt ? b.$2.createdAt.compareTo(a.$2.createdAt) : b.$1 - a.$1);
    return [
      for (final (_, n) in mine.take(noticeLimit))
        {
          'id': n.id,
          'kind': n.kind,
          'entity': n.entity,
          'recordId': n.recordId,
          'noteId': n.noteId,
          'patientId': n.patientId,
          'createdAt': _iso(n.createdAt),
          'readAt': n.readAt == null ? null : _iso(n.readAt!),
        },
    ];
  }

  Map<String, Object?> _markRead(String userId, String id) {
    for (final n in notices.where((n) => n.id == id && n.userId == userId)) {
      n.readAt ??= now();
    }
    return {'ok': true};
  }

  // ---- field reviews and history (design 3.1, 3.2; services/api/src/patients) ----

  static final _historyPath = RegExp(r'^/v1/patients/([0-9a-fA-F-]{36})/history$');
  static final _reviewDecision = RegExp(r'^/v1/team/field-reviews/([^/]+)/decision$');
  static final _uuidPattern = RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
  static final _historyIdPattern = RegExp(r'^\d{1,19}$');

  /// History entries per page (history.ts HISTORY_PAGE).
  static const historyPage = 50;

  /// A request the route's schema refuses: 422 with the paths that failed, as app.ts answers.
  static Never _unreadable(List<(String, String)> problems) => throw ApiException(
    422,
    'validation_failed',
    'Some fields are missing or invalid.',
    details: {
      'fields': [
        for (final (path, problem) in problems) {'path': path, 'problem': problem},
      ],
    },
  );

  /// A review as FieldReviewView shows it (field-reviews.ts reviewViews): the chart's value beside
  /// the values kept for it. A decision names the canonical patient and who recorded the chart's
  /// value (`currentBy`, review finding W1); a chart names the record the review is on, and no
  /// recorder ([patientId] given).
  Map<String, Object?> _reviewView(FakeReview r, {String? patientId}) {
    final current = records[r.recordId]!.state(r.field);
    return {
      'id': r.id,
      'patientId': patientId ?? canonicalOf(r.recordId),
      'field': r.field,
      'needs': r.needs,
      'current': current,
      if (patientId == null) 'currentBy': current['changedBy'] == null ? null : _user(current['changedBy'] as String?),
      'alternates': [
        for (final h in _alternatesOf(r))
          {'historyId': h['id'], 'value': h['value'], 'by': _user(h['by'] as String?), 'deviceTime': h['deviceTime']},
      ],
      'openedAt': _iso(r.openedAt),
      'status': r.status,
    };
  }

  /// GET /v1/patients/{id}/history (history.ts fieldHistory): every recorded value of the group's
  /// patient records, street names, allergies and problems (problems with the problem list's
  /// permissions, sensitive ones only with view_sensitive), newest first, [historyPage] at a time.
  /// ID links are left out: a link's create holds its token. Audited as `patient.history_viewed`.
  Map<String, Object?> _historyOf(String userId, String patientId, Map<String, String> query) {
    final field = query['field'];
    final afterId = query['afterId'];
    final unreadable = [
      if (field != null && !RegExp(r'^[a-z][a-zA-Z]{0,40}$').hasMatch(field)) ('field', 'invalid_format'),
      if (afterId != null && !_historyIdPattern.hasMatch(afterId)) ('afterId', 'invalid_format'),
    ];
    if (unreadable.isNotEmpty) _unreadable(unreadable);
    _require(userId, 'patients.view');
    if (records[patientId]?.entity != entityPatient) {
      throw const ApiException(404, 'not_found', 'That patient was not found.');
    }
    final canonical = canonicalOf(patientId);
    final perms = permissionsOf(userId);
    final problems = mayViewProblems(perms);
    final sensitive = problems && perms.contains('patients.view_sensitive');
    final members = {for (final r in groupOf(canonical)) r.id};
    bool shown(Map<String, Object?> h) {
      final r = records[h['recordId']];
      if (r == null || r.entity != h['entity']) return false;
      return switch (r.entity) {
        entityPatient => members.contains(r.id),
        entityAlias || entityAllergy => members.contains(r.patientId),
        entityProblem => problems && members.contains(r.patientId) && (sensitive || r.attributes['sensitive'] != true),
        _ => false,
      };
    }

    final after = afterId == null ? null : BigInt.parse(afterId);
    final rows = [
      for (final h in history.reversed)
        if (shown(h) &&
            (field == null || h['field'] == field) &&
            (after == null || BigInt.parse(h['id']! as String) < after))
          h,
    ];
    final page = rows.take(historyPage).toList();
    serverAudit.add({
      'action': 'patient.history_viewed',
      'userId': userId,
      'patientId': canonical,
      'entityId': canonical,
      'details': {'field': field, 'count': page.length},
    });
    return {
      'entries': [
        for (final h in page)
          {
            'id': h['id'],
            'entity': h['entity'],
            'recordId': h['recordId'],
            'field': h['field'],
            'version': h['version'],
            'value': h['value'],
            'previousValue': h['previous'],
            'kind': h['kind'],
            'changedBy': _user(h['by'] as String?),
            'approvedBy': h['approvedBy'] == null ? null : _user(h['approvedBy'] as String?),
            'deviceTime': h['deviceTime'],
            'recordedAt': h['recordedAt'],
            'reviewId': h['reviewId'],
            'correctionId': h['correctionId'],
          },
      ],
      'nextAfterId': rows.length > historyPage ? page.last['id'] : null,
    };
  }

  /// POST /v1/team/field-reviews/{reviewId}/decision (field-reviews.ts decideFieldReview): keep
  /// the chart's value or one kept for the review. Needs patients.edit or correct_identity to ask,
  /// then the review's own `needs`, and for patients.correct_identity a recent sign-in. Legal name
  /// and birth need a comment. A stale baseVersion is 409 field_changed; an alternate that would
  /// leave nobody recognisable 409 nothing_to_recognise. Audited as `field_review.decided`.
  Map<String, Object?> _decideReview(String userId, String reviewId, Map<String, Object?> b) {
    // The route's schemas (ReviewParam, DecideFieldReview) answer before anything else.
    final keep = b['keep'];
    final historyId = b['historyId'];
    final rawComment = b['comment'];
    final comment = rawComment is String ? rawComment.trim() : null;
    final base = b['baseVersion'];
    final unreadable = [
      if (!_uuidPattern.hasMatch(reviewId)) ('reviewId', 'invalid_format'),
      if (keep != 'current' && keep != 'alternate') ('keep', 'invalid_value'),
      if (historyId != null && (historyId is! String || !_historyIdPattern.hasMatch(historyId)))
        ('historyId', 'invalid_format'),
      if (rawComment != null && comment == null) ('comment', 'invalid_type'),
      if (comment != null && comment.length < 3) ('comment', 'too_small'),
      if (comment != null && comment.length > 500) ('comment', 'too_big'),
      if (base is! int) ('baseVersion', 'invalid_type') else if (base < 0) ('baseVersion', 'too_small'),
    ];
    // DecideFieldReview's refinement runs only on an otherwise readable body.
    if (unreadable.isEmpty && keep == 'alternate' && historyId == null) unreadable.add(('historyId', 'custom'));
    if (unreadable.isNotEmpty) _unreadable(unreadable);

    // The answer holds the chart's values, so patients.view as well as a key that decides (S5).
    _require(userId, 'patients.view');
    final perms = permissionsOf(userId);
    if (!perms.contains('patients.edit') && !perms.contains('patients.correct_identity')) {
      throw const ApiException(403, 'forbidden', 'Your role does not allow this.');
    }
    final review = reviews[reviewId];
    if (review == null) throw const ApiException(404, 'not_found', 'That review was not found.');
    if (!perms.contains(review.needs)) throw const ApiException(403, 'forbidden', 'Your role does not allow this.');
    if (review.needs == 'patients.correct_identity' && staleSignIn.contains(userId)) {
      throw const ApiException(403, 'reauth_required', 'Sign in again to confirm it is you.');
    }
    if (review.status != 'open') throw const ApiException(409, 'already_decided', 'This review was already decided.');
    final identity = identityFields.contains(review.field);
    if (identity && comment == null) {
      throw const ApiException(
        422,
        'comment_required',
        'Say why: a legal name or birth date is changed with a reason.',
      );
    }
    final rec = records[review.recordId]!;
    final current = rec.state(review.field);
    // Versions only: the reviewer re-reads the chart through the audited GET.
    if (base != current['version']) {
      throw ApiException(
        409,
        'field_changed',
        'This field changed since you opened the review. Look again.',
        details: {'field': review.field, 'version': current['version']},
      );
    }

    var version = current['version']! as int;
    String? correctionId;
    if (keep == 'alternate') {
      // A value a merge undo withdrew (it came from the other person) is no longer one to keep.
      final alternate = _alternatesOf(review).where((h) => h['id'] == historyId).firstOrNull;
      if (alternate == null) {
        throw const ApiException(422, 'not_an_alternate', 'That value isn’t one of this review’s.');
      }
      final values = {for (final MapEntry(:key, :value) in rec.fields.entries) key: value.value};
      if (!recognisableAfter(values, review.field, alternate['value'])) {
        throw const ApiException(
          409,
          'nothing_to_recognise',
          'Keeping that value would leave no name or description. Keep the chart’s value.',
        );
      }
      if (!_same(current['value'], alternate['value'])) {
        version++;
        // Recorded as the person who saw that value, approved by the reviewer.
        final by = alternate['by']! as String;
        final at = _iso(now());
        _write(rec, review.field, alternate['value'], version, by, at, null);
        if (identity) correctionId = _uuid();
        history.add({
          'id': '${history.length + 1}',
          'at': at,
          'deviceTime': null,
          'recordedAt': at,
          'entity': entityPatient,
          'recordId': rec.id,
          'field': review.field,
          'version': version,
          'kind': 'review_decided',
          'value': alternate['value'],
          'previous': current['value'],
          'by': by,
          'approvedBy': userId,
          'changeId': null,
          'reviewId': review.id,
          'correctionId': ?correctionId,
        });
        if (const {'preferredName', 'legalName', 'birth'}.contains(review.field)) {
          _rematch(rec.id, identity ? 'correction' : 'edit');
        }
      }
    }
    review
      ..status = 'decided'
      ..decidedBy = userId
      ..decision = {'kept': keep, 'historyId': historyId}
      ..comment = comment;
    serverAudit.add({
      'action': 'field_review.decided',
      'userId': userId,
      'patientId': canonicalOf(rec.id),
      'entityId': rec.id,
      'details': {
        'reviewId': review.id,
        'field': review.field,
        'kept': keep,
        'historyId': historyId,
        'version': version,
        'correctionId': ?correctionId,
        if (comment != null) 'commentSha256': crypto.sha256.convert(utf8.encode(comment)).toString(),
      },
    });
    return _reviewView(review);
  }

  // ---- the team's presets (phase 5 design 4.1, 4.2, 6.1; services/api/src/routes/presets.ts) ----

  /// Each team's presets by team ID (team_preset_state, team_presets and team_preset_versions, 0023):
  /// what `GET /v1/presets` reads. A team with no entry has no state row.
  final presetTeams = <String, FakePresetTeam>{};

  /// [teamId]'s presets, for a test to write or change, as the API's tests change rows.
  FakePresetTeam presetsOf(String teamId) => presetTeams.putIfAbsent(teamId.toLowerCase(), FakePresetTeam.new);

  /// Takes [teamId]'s next revision, as takeRevision does once in each write's transaction: the
  /// team's first makes its state row, at revision 1 under a new epoch. A note type write takes one
  /// too, and is no preset (design 4.3).
  int takePresetRevision(String teamId) {
    final team = presetsOf(teamId);
    team.epoch ??= _uuid();
    return ++team.revision;
  }

  /// A preset made online at version 1, under the team's next revision, as the store's create writes
  /// one, or an installer with the platform preset's [originKey]. [body] is stored as given, not
  /// checked, so a test can hold a phone to one it can't read. Returns its ID.
  String addPreset(String teamId, String kind, Map<String, Object?> body, {String? id, String? originKey}) {
    final presetId = id ?? _uuid();
    final team = presetsOf(teamId);
    if (team.heads.containsKey(presetId)) throw StateError('A preset with this ID exists.');
    team.heads[presetId] = FakePreset(presetId, kind, originKey)
      ..versions[1] = _copyJson(body)
      ..currentVersion = 1
      ..revision = takePresetRevision(teamId);
    return presetId;
  }

  /// The preset [id]'s next version, [body], under the team's next revision, as an edit or an update
  /// taken in place writes it: its kind, state and origin stay. Returns the version.
  int editPreset(String teamId, String id, Map<String, Object?> body) {
    final head = presetsOf(teamId).heads[id]!;
    final version = head.currentVersion + 1;
    head
      ..versions[version] = _copyJson(body)
      ..currentVersion = version
      ..revision = takePresetRevision(teamId);
    return version;
  }

  /// Archives the preset [id] at the version it is at, under the team's next revision.
  void archivePreset(String teamId, String id) => presetsOf(teamId).heads[id]!
    ..state = 'archived'
    ..revision = takePresetRevision(teamId);

  /// Restores the preset [id] at the version it is at, under the team's next revision.
  void restorePreset(String teamId, String id) => presetsOf(teamId).heads[id]!
    ..state = 'active'
    ..revision = takePresetRevision(teamId);

  /// A database restore renews every team's epoch (docs/setup.md), so a phone holding a copy from
  /// before it replaces the copy at its next pull. The statement updates state rows only, so a team
  /// with none keeps answering [noPresetEpoch]. Returns the epoch the team answers now.
  String renewPresetEpoch(String teamId) {
    final team = presetsOf(teamId);
    if (team.epoch != null) team.epoch = _uuid();
    return team.epoch ?? noPresetEpoch;
  }

  /// The kinds a phone reads (presets.ts PULLED_KINDS): never one a later phase adds for the server
  /// alone, as phase 10's billing_code_map.
  static const pulledPresetKinds = {
    'order_category',
    'item',
    'bundle',
    'flag',
    'field_supply_map',
    'condition_supply_map',
    'bag',
    'settings',
  };

  /// The epoch a team that has taken no revision answers (presets.ts NO_EPOCH).
  static const noPresetEpoch = '00000000-0000-0000-0000-000000000000';

  /// `since` as PresetsQuery reads it.
  static final _presetsSince = RegExp(r'^\d{1,19}$');

  /// A UUID as the API's `Uuid` (zod's uuid()) reads one: versions 1 to 8 of variant 8 to b, in
  /// either case, or the nil UUID, or the max one in lowercase.
  static final _zodUuid = RegExp(
    r'^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|'
    r'00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
  );

  /// The greatest whole number a JavaScript number holds exactly (Number.MAX_SAFE_INTEGER).
  static final _maxSafeInteger = BigInt.from(9007199254740991);

  /// The pull's query as PresetsQuery reads it: `since` 1 to 19 digits and `epoch` a UUID, else 422
  /// naming each. A `since` past what a JavaScript number holds exactly, which no team can have
  /// taken, is read as one left out (presets.ts Number.isSafeInteger).
  static ({int? since, String? epoch}) _pullQuery(Map<String, String> query) {
    final since = query['since'];
    final epoch = query['epoch'];
    final unreadable = [
      if (since != null && !_presetsSince.hasMatch(since)) ('since', 'invalid_format'),
      if (epoch != null && !_zodUuid.hasMatch(epoch)) ('epoch', 'invalid_format'),
    ];
    if (unreadable.isNotEmpty) _unreadable(unreadable);
    final sent = since == null ? null : BigInt.parse(since);
    return (since: sent != null && sent <= _maxSafeInteger ? sent.toInt() : null, epoch: epoch);
  }

  /// GET /v1/presets (presets.ts pullPresets): every preset of the kinds a phone reads whose
  /// revision is above `since`, archived ones included, each at its current version, by revision
  /// then ID; every one of them on a reset. A pull is a reset when `since` is left out or above the
  /// team's revision, or when `epoch` is not the team's, left out included; an epoch is compared as
  /// the UUID it is, whatever its case. The revision answered is the greatest among the presets
  /// answered, else `since`, else 0 on a reset; a team with no state row answers revision 0 and
  /// [noPresetEpoch], and the read gives it none. A preset whose current version is missing is a
  /// fault, never left out under a revision above it, after which no phone would ask for it again.
  /// No pull takes a revision or audits anything.
  Map<String, Object?> _pullPresets(String teamId, ({int? since, String? epoch}) query) {
    final team = presetTeams[teamId.toLowerCase()] ?? FakePresetTeam();
    final epoch = team.epoch ?? noPresetEpoch;
    final since = query.since;
    final reset = since == null || since > team.revision || query.epoch?.toLowerCase() != epoch;
    final above = reset ? null : since;
    final answered = [
      for (final p in team.heads.values)
        if (pulledPresetKinds.contains(p.kind) && (above == null || p.revision > above)) p,
    ]..sort((a, b) => a.revision != b.revision ? a.revision.compareTo(b.revision) : a.id.compareTo(b.id));
    if (answered.any((p) => !p.versions.containsKey(p.currentVersion))) {
      throw const ApiException(500, 'internal', 'Something went wrong. Your data is safe; try again.');
    }
    return {
      'reset': reset,
      'revision': answered.isEmpty ? (above ?? 0) : answered.last.revision,
      'epoch': epoch,
      'presets': [
        for (final p in answered)
          {
            'id': p.id,
            'kind': p.kind,
            'state': p.state,
            'version': p.currentVersion,
            'originKey': p.originKey,
            'body': _copyJson(p.versions[p.currentVersion]!),
          },
      ],
    };
  }

  /// A body as JSON carries it, so neither a test's map nor an answer's is shared with the server's.
  static Map<String, Object?> _copyJson(Map<String, Object?> body) =>
      jsonDecode(jsonEncode(body)) as Map<String, Object?>;

  // ---- reads ----

  /// POST /v1/sync/records (routes/sync.ts requireRead, review.ts fetchRecords): each kind of record
  /// needs its read permission, refused for the whole request; another team's flag change is missing,
  /// as row-level security keeps it; a sensitive problem, or its note, is missing to a role without
  /// patients.view_sensitive; a note leaves out what the reader may not see, and what hangs off a
  /// note goes with it (lifecycle 6.4). Each read is logged: a visit's as encounter.viewed, a note's
  /// and what hangs off it as note.viewed, anything else as a view of the patient (review finding P8).
  Map<String, Object?> _fetch(String userId, String teamId, Map<String, Object?> b) {
    final refs = (b['records']! as List<Object?>).cast<Map<String, Object?>>();
    final perms = permissionsOf(userId);
    for (final entity in {for (final ref in refs) ref['entity']}) {
      if (!_readsEntity(perms, entity! as String)) {
        throw const ApiException(403, 'forbidden', 'Your role does not allow this.');
      }
    }
    final out = <Object?>[];
    final missing = <Object?>[];
    for (final ref in refs) {
      // Looked up as the database compares a UUID, whatever case it was asked in; missing as asked.
      final r = records[(ref['id'] as String?)?.toLowerCase()];
      // A record of another team is none of this one's, as row-level security keeps it (review
      // finding MR-4). Only a flag change keeps its team here; a seed names none.
      final ours = r != null && (r.teamId == null || r.teamId == teamId.toLowerCase());
      final shown = !ours || r.entity != ref['entity'] ? null : _asRead(userId, teamId, perms, r);
      if (shown == null) {
        missing.add(ref);
        continue;
      }
      serverAudit.add({
        'action': switch (r!.entity) {
          entityEncounter => 'encounter.viewed',
          entityNote || entitySignoff || entityAddendum || entityCorrection => 'note.viewed',
          _ => 'patient.viewed',
        },
        'userId': userId,
        'patientId': _patientOf(r),
        'entityId': r.id,
        'details': {'source': 'sync'},
      });
      out.add(shown);
    }
    return {'records': out, 'missing': missing};
  }

  /// Who may read a record of each kind through sync at all (read-rules.ts readNeed, the one copy the
  /// sync read, the review queue and every value sent back to a phone use; review findings VA-1 and
  /// VS-1): a visit's records encounters.chart, a problem and its notes the problem list's rule, every
  /// other record, a referral among them, patients.view.
  static bool _readsEntity(Set<String> perms, String entity) => switch (entity) {
    entityEncounter ||
    entityNote ||
    entitySignoff ||
    entityAddendum ||
    entityCorrection => perms.contains('encounters.chart'),
    entityProblem || entityProblemNote => mayViewProblems(perms),
    _ => perms.contains('patients.view'),
  };

  /// A sensitive problem, and a note on one, is read with patients.view_sensitive (read-rules.ts
  /// sensitiveHidden).
  static bool _sensitiveHidden(Set<String> perms, FakeRecord? problem) =>
      problem?.attributes['sensitive'] == true && !perms.contains('patients.view_sensitive');

  /// Whether [perms] read this record through sync at all (read-rules.ts readsRecord): its kind's
  /// rule, then a sensitive problem's, for the problem and for a note on it, and the flag rule for a
  /// flag change.
  bool _readsRecord(Set<String> perms, FakeRecord r) {
    if (!_readsEntity(perms, r.entity)) return false;
    if (r.entity == entityProblem) return !_sensitiveHidden(perms, r);
    if (r.entity == entityProblemNote) return !_sensitiveHidden(perms, records[r.attributes['problemId']]);
    if (r.entity == entityFlagChange) return !_flagHidden(perms, _flagHead(r.teamId, r.attributes['flagId']));
    return true;
  }

  /// [teamId]'s flags as the team holds them now, archived ones included, by ID (read-rules.ts
  /// flagRows and teamFlags, the one read of a flag every reader of the flag rule asks): each its
  /// head and its current version's body, so a head whose current version is missing, which the
  /// API's join finds no row for, is no flag. Sensitive is the body's JSON value true and nothing
  /// else, read without a cast, so a body no writer leaves reads as not sensitive, and a tier, name,
  /// colour or rank it holds as no text or number reads as none.
  Map<String, _TeamFlag> _teamFlags(String teamId) {
    final team = teamId.toLowerCase();
    return {
      for (final head in presetTeams[team]?.heads.values ?? const <FakePreset>[])
        if (head.versions[head.currentVersion] case final body? when head.kind == 'flag')
          head.id: (
            id: head.id,
            head: (teamId: team, sensitive: body['sensitive'] == true),
            tier: body['tier'] is String ? body['tier']! as String : null,
            name: body['name'] is String ? body['name']! as String : null,
            color: body['color'] is String ? body['color']! as String : null,
            rank: body['rank'] is num ? (body['rank']! as num).toInt() : 0,
            archived: head.state == 'archived',
          ),
    };
  }

  /// One of [teamId]'s flags as the team holds it now (read-rules.ts flagHead): the team it is in,
  /// and whether it is sensitive ([_teamFlags]). Null when [flagId] names no flag of the team: another
  /// kind of preset, another team's, nothing, or a head whose current version is missing. A seed names
  /// no team, so its flag is whichever team's holds it. The ID is read in lowercase, as the database
  /// compares a UUID, so one in capitals names the same flag (review finding MR-3).
  _FlagHead? _flagHead(String? teamId, Object? flagId) {
    final key = flagId is String ? flagId.toLowerCase() : flagId;
    for (final id in presetTeams.keys) {
      if (teamId != null && id != teamId.toLowerCase()) continue;
      if (_teamFlags(id)[key] case final flag?) return flag.head;
    }
    return null;
  }

  /// The flag rule (read-rules.ts flagHidden, design 6.2, D136): a flag the team does not hold, or a
  /// sensitive one for a reader whose projection sees no sensitive problem (`mayViewProblems` with
  /// patients.view_sensitive, projection.ts Projection.sensitive), is hidden from them.
  static bool _flagHidden(Set<String> perms, _FlagHead? flag) =>
      flag == null || (flag.sensitive && !(mayViewProblems(perms) && perms.contains('patients.view_sensitive')));

  /// A flag change as [userId] may see it (read-rules.ts flagChangeShown), with [flag], its flag as the
  /// team holds it now: nothing of it when the flag is hidden from them; else its snapshot as its
  /// load() gives it, at the row's version and made at its receipt, without its reason or its mark's
  /// once it is entered in error and they neither made it nor manage the team's people. A reason
  /// left out leaves no key, and the mark's field holds `{}`, with who and when: marked, and nothing
  /// of why. The sync read, and the chart's flagChanges and history, show a change through it.
  Map<String, Object?>? _flagChangeShown(String userId, Set<String> perms, FakeRecord r, _FlagHead? flag) {
    if (_flagHidden(perms, flag)) return null;
    final shown = {
      ..._readSnapshot(r),
      'version': 1 + (r.fields['enteredInError']?.version ?? 0),
      'createdAt': _isoMs(r.storedAt ?? r.createdAt),
    };
    if (r.status != 'entered_in_error' || r.author == userId || perms.contains('team.manage_users')) return shown;
    return {
      ...shown,
      'attributes': {...r.attributes}..remove('reason'),
      'fields': {
        'enteredInError': {...r.state('enteredInError'), 'value': const <String, Object?>{}},
      },
    };
  }

  /// The record as [userId] may see it in [teamId] (review.ts asRead), or null when they may not see
  /// it at all. A problem says whether its status check is due, as its chart does.
  Map<String, Object?>? _asRead(String userId, String teamId, Set<String> perms, FakeRecord r) {
    switch (r.entity) {
      case entityProblem:
        return _readsRecord(perms, r) ? _problemSnapshot(r, _problemCheckDays(teamId)) : null;
      case entityProblemNote:
        return _readsRecord(perms, r) ? _readSnapshot(r) : null;
      case entityNote:
        return _noteAsRead(userId, perms, r)?.snapshot;
      // Its hash only to whoever acts as the author, its signer, and a reader who sees every answer of
      // any note (review.ts readsWhole): hashed again over what is shown, it would say what is hidden.
      // Never over a visit's summary withheld from the reader, which it covers (read.ts
      // signoffHashShown, LRD-5).
      case entitySignoff:
        final note = records[r.attributes['noteId']];
        final read = _noteAsRead(userId, perms, note);
        if (read == null) return null;
        final shown = _readSnapshot(r);
        final reader = read.reader;
        final whole = reader.readsMedical && reader.viewSensitive && reader.viewSensitiveExams && reader.chartsMedical;
        final visit = records[note!.attributes['encounterId']];
        final summaryHidden = visit == null || _medicalHidden(perms, visit);
        if (!summaryHidden && (reader.actsAsAuthor || r.author == userId || whole)) return shown;
        return {
          ...shown,
          'attributes': {...r.attributes}..remove('contentHash'),
        };
      // A Medical visit's summary is Medical content, read as its notes are (review.ts medicalHidden).
      // Its status is worked out from the notes the reader may read, so it says nothing of one left out
      // (review.ts statusShown, LRD-2).
      // Whether it holds a finished note is worked out from the same notes: the patient, the place and
      // the summary are locked from the first one on (lifecycle 3.1, review finding SLK-1).
      case entityEncounter:
        final notes = _notesShown(userId, perms, r.id);
        final read = _readSnapshot(r);
        final shown = {
          ...read,
          'status': encounterStatus(notes).name,
          'attributes': {
            ...read['attributes']! as Map<String, Object?>,
            'hasFinishedNote': notes.any((n) => n.status != NoteStatus.draft),
          },
        };
        if (!_medicalHidden(perms, r)) return shown;
        return {
          ...shown,
          'fields': {...(shown['fields']! as Map<String, Object?>)}..remove('summary'),
        };
      // An addendum to the visit itself is read with the visit: with its summary, on a Medical one.
      case entityAddendum:
        final noteId = r.attributes['noteId'];
        if (noteId != null) return _noteAsRead(userId, perms, records[noteId]) != null ? _readSnapshot(r) : null;
        final visit = records[r.attributes['encounterId']];
        return visit != null && !_medicalHidden(perms, visit) ? _readSnapshot(r) : null;
      // Missing too when an answer it changes is hidden from the reader, now or in any state the note
      // has held: its old or new value would give it away (read.ts hiddenCorrections, LRD-1).
      case entityCorrection:
        final noteId = r.attributes['noteId'];
        final read = _noteAsRead(userId, perms, records[noteId]);
        if (read == null) return null;
        // Every correction of the note, in the order they were stored, which is the order applied.
        final all = [
          for (final c in records.values)
            if (c.entity == entityCorrection && c.attributes['noteId'] == noteId) c,
        ];
        return _hiddenCorrections(read.type, read.answers, read.reader, all).contains(r.id) ? null : _readSnapshot(r);
      // By the flag rule, and once entered in error without its reasons for whoever neither made it
      // nor manages the team's people (review.ts asRead).
      case entityFlagChange:
        return _flagChangeShown(userId, perms, r, _flagHead(r.teamId, r.attributes['flagId']));
      // Who recorded it, by their name now: a referral keeps no name of its own (referral.ts load).
      case entityReferral:
        final read = _readSnapshot(r);
        return {
          ...read,
          'attributes': {...read['attributes']! as Map<String, Object?>, 'authorName': nameOf(r.author)},
        };
      default:
        return _readSnapshot(r);
    }
  }

  /// The corrections of a note that are hidden from [reader] (read.ts hiddenCorrections): a value one
  /// names is hidden in the note now; in the note with the later corrections undone, in [all]'s
  /// order; or in the note now with each correction's old values, or its new values, put back. None
  /// of a phase 2 note's.
  static Set<String> _hiddenCorrections(NoteTypeDef? type, Answers answers, NoteReader reader, List<FakeRecord> all) {
    if (type == null) return {};
    List<Map<String, Object?>> changesOf(FakeRecord c) =>
        (c.attributes['changes']! as List<Object?>).cast<Map<String, Object?>>();
    Answers placed(Answers on, FakeRecord c, String which) {
      final out = {...on};
      for (final change in changesOf(c)) {
        final path = (change['field']! as String).substring('data.'.length);
        final value = change[which];
        if (value == null) {
          out.remove(path);
        } else {
          out[path] = value;
        }
      }
      return out;
    }

    final states = <Answers>[answers];
    var after = answers;
    for (final c in all.reversed) {
      if (!const {'corrected', 'draft_edit'}.contains(c.attributes['outcome'])) continue;
      after = placed(after, c, 'oldValue');
      states.add(after);
    }
    for (final c in all) {
      states
        ..add(placed(answers, c, 'oldValue'))
        ..add(placed(answers, c, 'newValue'));
    }
    final hidden = <String>{};
    for (final c in all) {
      final shows = changesOf(c).every((change) {
        final path = (change['field']! as String).substring('data.'.length);
        try {
          return _byDefinition(
            () => states.every(
              (state) =>
                  !answerHidden(type, state, path, change['oldValue'], reader) &&
                  !answerHidden(type, state, path, change['newValue'], reader),
            ),
          );
        } on _DefinitionError {
          return false;
        }
      });
      if (!shows) hidden.add(c.id);
    }
    return hidden;
  }

  /// The notes of a visit [userId] may read, as its status is worked out from them (review.ts
  /// notesShown, statusShown).
  List<({NoteStatus status, bool medical, bool empty})> _notesShown(
    String userId,
    Set<String> perms,
    String encounterId,
  ) => [
    for (final n in _notesOf(encounterId))
      if (_noteAsRead(userId, perms, n) case final read?)
        (
          status: NoteStatus.values.byName(_noteStatusOf(n)),
          medical: n.medical,
          empty: _noteStatusOf(n) == 'draft' && noteIsEmpty(read.answers),
        ),
  ];

  /// A Medical visit whose summary [perms] may not read (review.ts medicalHidden, RD-7).
  static bool _medicalHidden(Set<String> perms, FakeRecord visit) =>
      visit.fields['kind']?.value == 'medical' && !mayViewProblems(perms);

  /// A note as [userId] may read it (review.ts noteAsRead), or null when they may not: whoever acts
  /// as the author of a draft gets every answer it holds, hidden ones included; everyone else, and
  /// every finished note, the answers that count that the reader may see. A hidden answer leaves no
  /// key: no value, no version, no mark. A phase 2 note is read whole; one whose definition cannot be
  /// read is missing.
  ({Map<String, Object?> snapshot, NoteTypeDef? type, Answers answers, NoteReader reader})? _noteAsRead(
    String userId,
    Set<String> perms,
    FakeRecord? note,
  ) {
    if (note == null) return null;
    final NoteTypeDef? read;
    try {
      read = _noteTypeOf(note);
    } on _DefinitionError {
      return null;
    }
    final reader = noteReader(perms, credentialOf(userId), actsAsAuthor: userId == _actingAuthor(note));
    final answers = _answersOf(note);
    final type = read;
    if (type == null || (reader.actsAsAuthor && _noteStatusOf(note) == 'draft')) {
      return (snapshot: _noteSnapshot(note, null), type: type, answers: answers, reader: reader);
    }
    final Map<String, Object>? seen;
    try {
      seen = _byDefinition(() => visibleAnswers(type, answers, reader));
    } on _DefinitionError {
      return null;
    }
    return seen == null ? null : (snapshot: _noteSnapshot(note, seen), type: type, answers: answers, reader: reader);
  }

  /// A note's snapshot (note.ts load): its state in its attributes, and its answers, or only [seen].
  /// Only [seen]: versioned and dated by the latest field it shows (review.ts onlyAnswers, RD-6).
  Map<String, Object?> _noteSnapshot(FakeRecord note, Map<String, Object>? seen) {
    final snapshot = _noteSnapshotWhole(note, seen);
    if (seen == null) return snapshot;
    final shown = (snapshot['fields']! as Map<String, Object?>).values.cast<Map<String, Object?>>();
    final times = [
      note.createdAt.toUtc(),
      for (final f in shown)
        if (f['changedAt'] case final String at) DateTime.parse(at).toUtc(),
    ];
    return {
      ...snapshot,
      'version': shown.map((f) => f['version']! as int).fold<int>(1, max),
      'updatedAt': _iso(times.reduce((a, b) => a.isAfter(b) ? a : b)),
    };
  }

  Map<String, Object?> _noteSnapshotWhole(FakeRecord note, Map<String, Object>? seen) => {
    ..._readSnapshot(note, fields: const []),
    'status': _noteStatusOf(note),
    // Its state too, so the author's phone can show the state of a note it still holds (4.4, 4.10).
    'attributes': {
      'encounterId': note.attributes['encounterId'],
      'noteTypeKey': note.attributes['noteTypeKey'],
      'noteTypeVersion': note.attributes['noteTypeVersion'],
      // The server's time, which the visit read orders a visit's notes by (D108).
      'createdAt': isoMicros(note.madeAt ?? note.createdAt),
      'attestation': note.attestation,
      'actingAuthorId': _actingAuthor(note),
      // Their name now, as the visit read gives it: a note keeps no name of its own.
      'actingAuthorName': nameOf(_actingAuthor(note)),
      'everSigned': note.everSigned,
      'completedAt': note.completedAt,
      'signoffId': note.signoffId,
    },
    'fields': {
      for (final name in note.fields.keys)
        if (seen == null || !name.startsWith('data.'))
          name: note.state(name)
        else if (seen.containsKey(name.substring('data.'.length)))
          name: {...note.state(name), 'value': seen[name.substring('data.'.length)]},
    },
  };

  /// A record as the sync read sends it: a visit shows each of its fields, at version 0 until one is
  /// written (encounter.ts load), and a referral and a flag change their mark.
  Map<String, Object?> _readSnapshot(FakeRecord r, {List<String>? fields}) {
    final at = now().toUtc().toIso8601String();
    return {
      'entity': r.entity,
      'id': r.id,
      'version': 1,
      'status': r.status,
      'authorUserId': r.author,
      'createdAt': at,
      'updatedAt': at,
      'attributes': r.attributes,
      'fields': {
        for (final name
            in fields ??
                switch (r.entity) {
                  entityEncounter => _encounterFields,
                  entityReferral || entityFlagChange => const ['enteredInError'],
                  _ => r.fields.keys,
                })
          name: r.state(name),
      },
    };
  }

  /// The patient a record is about now: a visit's, and through it its notes' and what hangs off them.
  String? _patientOf(FakeRecord? r) => switch (r?.entity) {
    entityEncounter => r!.fields['patientId']?.value as String?,
    entityNote || entityAddendum => _patientOf(records[r!.attributes['encounterId']]),
    entitySignoff || entityCorrection => _patientOf(records[r!.attributes['noteId']]),
    _ => r?.patientId,
  };

  Future<Map<String, Object?>> _signed(String deviceId, String purpose, Map<String, Object?> b) async {
    final payload = b['payload']! as Map<String, Object?>;
    final device = devices[deviceId];
    if (device == null || payload['purpose'] != purpose || payload['deviceId'] != deviceId) {
      throw const ApiException(401, 'device_signature_invalid', 'This phone could not be verified.');
    }
    final ok = await Ed25519().verify(
      utf8.encode(canonicalJson(payload)),
      signature: Signature(
        base64Url.decode(base64Url.normalize(b['signature']! as String)),
        publicKey: SimplePublicKey(base64Url.decode(base64Url.normalize(device.publicKey)), type: KeyPairType.ed25519),
      ),
    );
    if (!ok) throw const ApiException(401, 'device_signature_invalid', 'This phone could not be verified.');
    final removed =
        removedUsers.contains(device.userId) || removedFromTeam.contains('${device.userId}/${device.teamId}');
    final access = removed ? 'removed' : 'active';
    switch (purpose) {
      case 'status':
        return {'status': device.status, 'access': access, 'serverTime': now().toUtc().toIso8601String()};
      case 'quarantine':
        if (device.status == 'wipe_requested') throw const ApiException(409, 'wipe_requested', 'Wipe this phone.');
        if (device.status == 'active' && access == 'active') {
          throw const ApiException(409, 'use_sync', 'This phone can still sync normally.');
        }
        final results = <Object?>[];
        final changes = (payload['changes']! as List<Object?>).cast<Map<String, Object?>>();
        // The same SyncChange schema as a push: one unreadable change refuses the whole upload.
        _validatePush(changes);
        for (final c in changes) {
          final hash = valueHash(c['value']);
          if (hash != c['valueHash']) {
            results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'hash_mismatch'});
            continue;
          }
          if (c['entity'] == entityAudit) {
            // An offline read joins the audit chain as the person's, not anyone's to approve.
            if (auditIssues(c['value']).isNotEmpty) {
              results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'validation'});
              continue;
            }
            if (!audit.any((a) => a['changeId'] == c['changeId'])) {
              audit.add({
                ...c['value']! as Map<String, Object?>,
                'deviceTime': c['deviceTime'],
                'changeId': c['changeId'],
                'userId': device.userId,
                'afterRemoval': true,
              });
            }
            results.add({'changeId': c['changeId'], 'status': 'recorded', 'hash': hash});
            continue;
          }
          // devices.ts: an ID someone else's held change already has is theirs; nothing of this
          // phone's is stored, and "quarantined" would have it wipe the change.
          final other = held[c['changeId']];
          if (other != null && (other.userId != device.userId || other.deviceId != deviceId)) {
            results.add({'changeId': c['changeId'], 'status': 'rejected', 'reason': 'validation'});
            continue;
          }
          if (other == null) {
            _hold(
              _Actor(device.userId, deviceId, const {}, holdForReview: true, teamId: device.teamId),
              c,
              'access_removed',
            );
          }
          results.add({'changeId': c['changeId'], 'status': 'quarantined', 'hash': hash});
        }
        return {'results': results};
      default:
        device.status = 'wiped';
        return {'ok': true};
    }
  }
}

/// Why a value the draft rule would write is kept in history instead (records.ts KeptInstead).
typedef _Kept = ({String problem, ({String kind, List<String> to})? notice});

/// What the flag rule reads of one of a team's flags (read-rules.ts FlagHead): the team that holds it,
/// and whether it is sensitive.
typedef _FlagHead = ({String teamId, bool sensitive});

/// One of a team's flags as the chart, the team index and search read it (read-rules.ts TeamFlag): its
/// head, its state, and its current version's tier, name, colour and rank.
typedef _TeamFlag = ({String id, _FlagHead head, String? tier, String? name, String? color, int rank, bool archived});

/// What signedUnder finds: the credential, whether the time was believed, and what it may do.
typedef SignedUnder = ({String credential, bool timeTrusted, bool canSign, bool needsAttestation, bool claimDiffers});

/// One answer a correction writes, with the history kind it is written under.
typedef _AnswerWrite = ({String field, Object? value, Object? previous, String kind});

/// A rule could not apply a note type's definition (records.ts DefinitionError): its row is forged,
/// a note names a version the team does not hold, or the interpreter threw on it.
class _DefinitionError implements Exception {}

/// Runs the interpreter for a rule (records.ts byDefinition): any throw is a definition error.
T _byDefinition<T>(T Function() rule) {
  try {
    return rule();
  } on _DefinitionError {
    rethrow;
    // The interpreter's own faults are Errors as well as Exceptions: a condition cycle, a bad cast.
    // ignore: avoid_catches_without_on_clauses
  } catch (_) {
    throw _DefinitionError();
  }
}

/// The test-only note types the API's sign-off and read tests install beside [testNoteTypes]
/// (packages/contract/test-vectors/sync-note-types.json): the Red flags note, and four with sections
/// or fields some readers may not see.
final _noteTypesFile = jsonDecode(
  File('../../packages/contract/test-vectors/sync-note-types.json').readAsStringSync(),
) as Map<String, Object?>;
final redFlagsNoteType = _noteTypesFile['redFlags']! as Map<String, Object?>;
final restrictedNoteTypes = [
  for (final d in _noteTypesFile['restricted']! as List<Object?>) d! as Map<String, Object?>,
];
const TestNoteType testRedFlags = (key: 'test_red_flags', version: 1);
const TestNoteType testRestricted = (key: 'test_restricted', version: 1);
const TestNoteType testSensitive = (key: 'test_sensitive', version: 1);
const TestNoteType testAssess = (key: 'test_assess', version: 1);
const TestNoteType testMarked = (key: 'test_marked', version: 1);

const _encounterFields = ['patientId', 'location', 'locationText', 'summary', 'kind'];

class _Actor {
  _Actor(this.userId, this.deviceId, this.permissions, {required this.holdForReview, this.approvedBy, this.teamId});
  final String userId;
  final String deviceId;
  final Set<String> permissions;

  /// The team the change is applied in: the push's, or the held change's for an admin's accept. A
  /// seed names none.
  final String? teamId;

  /// A push holds what it may not apply; an admin's accept fails instead.
  final bool holdForReview;

  /// The Program Admin who accepted a held change for [userId].
  final String? approvedBy;

  /// Who chose between two values: the approver, or the person themselves.
  String get decider => approvedBy ?? userId;
}

class _SetContext {
  _SetContext(this.actor, this.c, this.rules, this.rec, this.field, this.value, this.cur, this.saw, this.redirect);
  final _Actor actor;
  final Map<String, Object?> c;
  final EntityRules rules;

  /// The record the change applies to: the survivor when it was redirected.
  final FakeRecord rec;
  final String field;
  final Object? value;

  /// The field as the server holds it (a FieldState).
  final Map<String, Object?> cur;
  final bool saw;
  final Map<String, Object?>? redirect;
}

class _Transport implements ApiTransport {
  _Transport(this.server, this.userId, this.teamId);
  final FakeSyncServer server;
  final String userId;
  final String teamId;

  @override
  Future<Object?> send(String method, String path, {Map<String, String>? query, Object? body}) =>
      server.handle(userId, teamId, method, path, body, query: query);
}

class _Device {
  _Device(this.userId, this.teamId, this.publicKey);
  final String userId;
  final String teamId;
  final String publicKey;
  String status = 'active';
  Map<String, Object?> unsynced = {};
  String? oldestUnsynced;
}

/// One field as the server holds it: its value, version, who and when (corrected device time) last
/// wrote it, and the change that did.
class FakeField {
  FakeField(this.value, this.version, this.by, this.at, this.changeId);
  final Object? value;
  final int version;
  final String? by;
  final String? at;
  final String? changeId;
}

/// A synced record on the fake server.
class FakeRecord {
  FakeRecord({
    required this.id,
    required this.entity,
    required this.author,
    required this.attributes,
    required this.fields,
    this.status = 'active',
    this.patientId,
    this.clockVerified = true,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.utc(2026);

  /// Whether its creating change's time was verified, as the server stored it (a push measured
  /// more than 5 minutes off stores none as verified).
  final bool clockVerified;

  /// When the server stored it (registeredAt for a patient, recordedAt for an allergy).
  final DateTime createdAt;
  final String id;
  final String entity;
  final String author;
  final Map<String, Object?> attributes;
  final Map<String, FakeField> fields;

  /// active, merged (a patient), removed (a street name), entered_in_error (an allergy), a
  /// problem's status, recorded (a consent, a problem note).
  String status;

  /// The patient a patient-side record names, as stored (a merged one included).
  final String? patientId;

  /// A merged patient's or problem's survivor.
  String? mergedInto;

  /// A patient's last seen once a visit moved it (encounter.ts seen); registration until then.
  DateTime? lastSeenAt;
  DateTime get seenAt => lastSeenAt ?? createdAt;

  /// A problem marked entered in error.
  bool retracted = false;

  /// When a problem's status was last observed; never moves back.
  DateTime? checkedAt;

  /// A note's: whether its type is a Medical one (set at its create, never changed); the clinician a
  /// Program Admin assigned it to after its author left; whether it was ever signed; when and by
  /// whom it last left draft (lifecycle 2.2).
  bool medical = false;
  String? assignedTo;
  bool everSigned = false;
  String? completedAt;
  String? completedBy;

  /// A note's attestation (not_needed, waiting, attested) and the signature that signs it.
  String attestation = 'not_needed';
  String? signoffId;

  /// When the server received its create (records.ts createReceivedAt): signedUnder believes no time
  /// before it. When a push held the create, that push's time, not the admin's accept.
  DateTime? storedAt;

  /// When the server wrote its row (created_at): at its create, or at the admin's accept of a held
  /// one. A note's snapshot gives it as its `createdAt`.
  DateTime? madeAt;

  /// The team a flag change or a patient was made in (patient_flag_changes.team_id, patients.team_id):
  /// a flag change's flag is read from that team's presets, as the team holds it now, and no other
  /// team reads either (the records read, a chart). Null for a seed's, which every team's tests read.
  String? teamId;

  /// The field as a FieldState: version 0 and no value when never written.
  Map<String, Object?> state(String field) {
    final f = fields[field];
    return {'value': f?.value, 'version': f?.version ?? 0, 'changedBy': f?.by, 'changedAt': f?.at};
  }
}

class FakeReview {
  FakeReview(this.id, this.entity, this.recordId, this.field, this.needs, {DateTime? openedAt})
    : openedAt = openedAt ?? DateTime.utc(2026);
  final String id;
  final String entity;
  final String recordId;
  final String field;
  final String needs;
  final DateTime openedAt;

  /// open, decided or obsolete (a merge, or a merge undo, left nothing to choose).
  String status = 'open';

  /// History IDs a merge undo took out: they came from the other person.
  final withdrawn = <String>{};
  String? decidedBy;

  /// `{kept, historyId}`, and the comment, as field_reviews stores a decision.
  Map<String, Object?>? decision;
  String? comment;
}

class FakePair {
  FakePair(this.id, String x, String y, this.score, this.sources)
    : a = x.compareTo(y) < 0 ? x : y,
      b = x.compareTo(y) < 0 ? y : x;
  final String id;
  final String a;
  final String b;
  double score;
  List<String> sources;

  /// open, not_sure, kept_separate, merged or superseded.
  String status = 'open';

  /// A reviewer's Not sure note ("check ID card at next visit").
  String? note;
}

class FakeNotice {
  FakeNotice(
    this.id,
    this.userId,
    this.kind,
    this.entity,
    this.recordId,
    this.createdAt, {
    this.noteId,
    this.patientId,
  });
  final String id;
  final String userId;
  final String kind;
  final String entity;
  final String recordId;

  /// The note a `signoff_not_applied` or `correction_not_applied` notice is about (user_notices.note_id,
  /// D104, VS-6); null for any other.
  final String? noteId;

  /// The patient a `flag_change_not_applied` notice is about (user_notices.patient_id, design 6.2);
  /// null for any other.
  final String? patientId;
  final DateTime createdAt;
  DateTime? readAt;
}

class FakeMerge {
  FakeMerge(this.id, this.mergedId, this.survivorId, this.mergedAt);
  final String id;
  final String mergedId;
  final String survivorId;
  final DateTime mergedAt;
  DateTime? undoneAt;

  /// The merged records' reviews it made obsolete, which undo opens again.
  final reviewsObsoleted = <String>[];
}

class FakeIdLink {
  FakeIdLink({
    required this.id,
    required this.patientId,
    required this.token,
    required this.tokenHash,
    required this.status,
    required this.effectiveAt,
    required this.received,
    required this.issuedBy,
    this.replaces,
  });
  final String id;

  /// The record it was issued on (the canonical one at the time).
  final String patientId;
  final String token;
  final String tokenHash;

  /// active or retired.
  String status;
  String? retiredReason;
  final DateTime effectiveAt;

  /// Receipt order: a tie on effective time goes to the later receipt.
  final int received;
  final String issuedBy;
  final String? replaces;
}

/// One team's presets (0023): its state row's revision and epoch, and its presets by ID.
class FakePresetTeam {
  /// team_preset_state.revision: 0 until the team's first write takes one.
  int revision = 0;

  /// team_preset_state.epoch; null while the team has no state row.
  String? epoch;

  /// Each preset's head (team_presets), by ID.
  final heads = <String, FakePreset>{};
}

/// A preset's head (team_presets) and its versions (team_preset_versions).
class FakePreset {
  FakePreset(this.id, this.kind, this.originKey);
  final String id;

  /// Fixed once made (0023's team_presets_kind_fixed).
  final String kind;

  /// The platform preset it came from; null for the team's own.
  final String? originKey;

  /// active or archived.
  String state = 'active';

  /// The version the head is at. A test that moves it past [versions] breaks the head as no writer
  /// may (design 4.1), and the pull is then a fault.
  int currentVersion = 0;

  /// The revision of the write that last changed the head.
  int revision = 0;

  /// Each version's body, by version, never changed once written.
  final versions = <int, Map<String, Object?>>{};
}

class _Receipt {
  _Receipt({
    required this.userId,
    required this.deviceId,
    required this.seq,
    required this.entity,
    required this.recordId,
    required this.field,
    required this.supersedes,
    required this.conflictOf,
    required this.status,
    required this.serverVersion,
    required this.reason,
    required this.hash,
    required this.quarantined,
    required this.details,
  });
  final String userId;
  final String deviceId;
  final int seq;
  final String entity;
  final String recordId;
  final String? field;
  final String? supersedes;
  final String? conflictOf;
  final String status;
  final int? serverVersion;
  final String? reason;
  final String hash;
  final bool quarantined;

  /// What an accepted change carried (kept both, redirected, a card's outcome), or a refusal's.
  final Map<String, Object?>? details;
  bool resolved = false;

  /// The answer for this change, as the API gives it: a conflict, and a value kept but not applied,
  /// show the field as the server holds it now, as its sender may see it (apply.ts
  /// resultFromReceipt and fieldForAnswer).
  Map<String, Object?> result(FakeSyncServer s, String changeId) {
    Map<String, Object?> current(String id) {
      final rec = s.records[id];
      if (rec == null) return FakeSyncServer._nothingShown;
      return s._fieldForAnswer(userId, rec, field ?? '');
    }

    // A redirected change was answered with the survivor's field, a conflict included.
    final on = details?['redirectedTo'] as String? ?? recordId;
    switch (status) {
      case 'accepted':
        final kept = details?['outcome'] == 'kept_both' || details?['outcome'] == 'history_only';
        return {
          'changeId': changeId,
          'status': 'accepted',
          'serverVersion': serverVersion,
          'hash': hash,
          if (kept) 'server': current(on),
          'details': ?details,
        };
      case 'conflict':
        final f = current(on);
        return {'changeId': changeId, 'status': 'conflict', 'serverVersion': f['version'], 'server': f};
      default:
        return {
          'changeId': changeId,
          'status': 'rejected',
          'reason': reason,
          'message': 'rejected: $reason',
          'details': ?details,
          if (quarantined) ...{'quarantined': true, 'hash': hash},
        };
    }
  }
}
