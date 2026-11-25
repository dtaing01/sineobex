/// A patient's flags on the phone (phase 5 design 6.1, 6.2, 8.2): the one domain class the flags
/// sheet, intake's risk level, the patient list and Needs attention write through, never the store
/// directly. It records a change (through `createRecord`, refused while the store is frozen or the
/// clock is paused, D35), works out the patient's current flags (6.1), marks a change entered in
/// error, and settles the two refusals a worker can fix (Choose a flag and Change the reason,
/// through `fixRejected`, D121). The flag rule here is the phone's one copy of the server's
/// (`flagHidden` in services/api/src/sync/read-rules.ts, D99, D136); Team setup lists the team's
/// flags by it too.
///
/// A change's reason is patient detail: it lives in the change's record, in the store's encrypted
/// database, and in what this class answers, never in a log, a notice or an audit entry (design 9).
library;

import 'dart:convert';

import '../api/generated/api.dart' as api show ChartFlags, FlagChangeMark, FlagHistoryRow, FlagTier;
import '../presets/current_flags.dart';
import '../presets/models.dart' show FlagBody, FlagColor, FlagTier, PresetKind, PresetState;
import '../presets/preset_store.dart';
import '../sync/entities.dart' show entityFlagChange, flagReasonInvalid;
import '../sync/local_store.dart';
import 'access.dart' show mayViewProblems;
import 'chart_cache.dart' show chartMetaOf, patientGroup;
import 'team_index.dart' show TeamIndex;

// ------------------------------------------------------------------------------------------------
// The flag rule
// ------------------------------------------------------------------------------------------------

/// Whether a person with [permissions] sees a sensitive flag: the reader half of the flag rule (6.2,
/// D136), the server's `Projection.sensitive` for a sensitive problem, `mayViewProblems` (access.dart)
/// and `patients.view_sensitive`, held to it role by role in flags_test.dart through access.json.
// PLAN-OPEN (PL-23): who sees a sensitive flag? Whoever sees a sensitive problem: patients.view_sensitive
// with the problem list, so a flag tells no reader what the problem list would not. The phone's one
// copy of the rule: Team setup, the team index, the flags sheet and the patient list all ask it.
bool seesSensitiveFlags(Iterable<String> permissions) =>
    mayViewProblems(permissions) && permissions.contains('patients.view_sensitive');

/// The flag rule (6.2): true when [flag] is not one of the team's flags (null: the phone's copy of the
/// presets doesn't hold it) or is sensitive and [permissions] don't see sensitive flags
/// ([seesSensitiveFlags]). A hidden flag, and every change of it, is absent wherever the phone
/// shows flags: never offered, never answered, never blanked. Team setup lists the team's flags by it.
bool flagHidden(Iterable<String> permissions, FlagBody? flag) =>
    flag == null || (flag.sensitive && !seesSensitiveFlags(permissions));

// ------------------------------------------------------------------------------------------------
// The two refusals a worker can fix (6.2, D121)
// ------------------------------------------------------------------------------------------------

/// Whether Needs attention offers **Choose a flag** for [e]: a refused create of a flag change whose
/// flag the server doesn't hold among the team's flags (`unknown_flag`).
bool settledByFlag(OutboxEntry e) => _refusedCreate(e, 'unknown_flag');

/// Whether [e], a flag change, clears its flag. Choose a flag offers no other flag in place of a
/// refused clear's ([PatientFlags.flagsToChoose]): clearing one the person never named could take a
/// risk level off the patient unseen, so the card says the flag can't be cleared on this phone.
bool clearsFlag(OutboxEntry e) => e.entity == entityFlagChange && (e.value as Map?)?['action'] == 'clear';

/// Whether Needs attention offers **Change the reason** for [e]: a refused create of a flag change
/// whose reason the server refused (`reason_invalid`).
bool settledByReason(OutboxEntry e) => _refusedCreate(e, 'reason_invalid');

bool _refusedCreate(OutboxEntry e, String problem) =>
    e.state == ChangeState.rejected &&
    e.op == 'create' &&
    e.entity == entityFlagChange &&
    e.details?['problem'] == problem;

// ------------------------------------------------------------------------------------------------
// What the screens show
// ------------------------------------------------------------------------------------------------

/// One of the team's flags as a screen draws it (`FlagPill`: "Red · High"), named from the phone's
/// copy of the presets, else from the chart's `flags` for one the presets don't hold (6.1).
class FlagView {
  const FlagView({
    required this.flagId,
    required this.name,
    required this.tier,
    required this.color,
    required this.colorName,
    required this.rank,
    required this.archived,
  });

  final String flagId;

  /// The flag's name now, as the team wrote it.
  final String name;
  final FlagTier tier;

  /// Null for a colour this version of the app doesn't know (the chart named it): drawn grey with
  /// [colorName].
  final FlagColor? color;

  /// The colour's plain name, shown first: "Red". Empty only for a flag the phone knows from a
  /// chart's history row alone (the presets not held, and the flag on the patient no longer): its
  /// name is then shown alone.
  final String colorName;

  /// Its place in its tier, lowest first.
  final int rank;

  /// "No longer on the team’s list": it stays on the patient who carries it, and is offered only to
  /// clear (5.1).
  final bool archived;
}

/// Where a flag change is, as the flags sheet's history and the profile say it.
enum FlagChangeState {
  /// On the server's chart, or brought by the chart.
  sent,

  /// Made on this phone and waiting for its receipt.
  waiting,

  /// Held by the server for a Program Admin: "Sent for review". Not counted in the current flags.
  inReview,

  /// Refused: shown only in Needs attention, and not counted.
  refused,
}

/// A change marked entered in error: who and when, and why only for its author and Program Admins
/// (holders of `team.manage_users`, section 11 rows 23 and 24). [byName] is null for a mark made on
/// this phone that no chart names yet (the person's own), [at] for one confirmed here and not yet on
/// a chart; [waiting] while the mark waits for its receipt. [held] for a mark of this phone's the
/// server holds for a Program Admin: "Sent for review", and the change still counts until one accepts
/// it (6.1, 8.2), since the server's chart still counts it.
typedef FlagChangeMarkView = ({String? byName, DateTime? at, String? reason, bool waiting, bool held});

/// One change of a patient's flags as the flags sheet's history lists it: the flag, set or cleared,
/// who, when, why (8.2).
class FlagChangeView {
  const FlagChangeView({
    required this.changeId,
    required this.flag,
    required this.action,
    required this.at,
    required this.authorId,
    required this.authorName,
    required this.reason,
    required this.enteredInError,
    required this.state,
  });

  final String changeId;

  /// The flag, as the team holds it now.
  final FlagView flag;

  /// `set` or `clear`.
  final String action;

  /// The change's time: the server's `effectiveAt`, or this phone's for one made here.
  final DateTime? at;

  final String authorId;

  /// Who made it, by the name the server gives (their name now); null where the phone knows none.
  final String? authorName;

  /// Null for a change entered in error whose reasons the person may not read.
  final String? reason;

  /// Null while it stands.
  final FlagChangeMarkView? enteredInError;
  final FlagChangeState state;
}

/// A patient's flags as the profile, the flags sheet and the patient list show them (6.1).
class PatientFlagsView {
  const PatientFlagsView({
    required this.riskLevel,
    required this.conditions,
    required this.history,
    required this.sentForReview,
  });

  /// The risk level, or none.
  final FlagView? riskLevel;

  /// The conditions, by rank, then name, then ID.
  final List<FlagView> conditions;

  /// Every change the person may see, newest first.
  final List<FlagChangeView> history;

  /// A change of this phone's for the patient waits for a Program Admin: "Sent for review".
  final bool sentForReview;
}

/// The flag change intake records with a new patient (8.2): one risk level and why.
typedef IntakeRiskLevel = ({String flagId, String reason});

// ------------------------------------------------------------------------------------------------
// The domain class
// ------------------------------------------------------------------------------------------------

/// A team's patient flags on this phone, for one person.
class PatientFlags {
  PatientFlags(
    this.store, {
    required this.userId,
    required this.permissions,
    this.nameOf,
    this.index,
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final LocalStore store;

  /// The phone's clock, corrected by the server's where a sync measured it: when a receipt came.
  final DateTime Function() _now;

  /// The person's ID: a change's author.
  final String userId;

  /// The person's permission keys in the team, as /v1/me last reported them.
  final List<String> permissions;

  /// A teammate's name, where the phone knows it.
  final String? Function(String userId)? nameOf;

  /// The team index, whose entries carry each patient's flags (6.1): what the phone knows of a
  /// patient whose chart it doesn't hold. Without it, only the charts and the changes made here.
  final TeamIndex? index;

  /// Called after a change made here, so screens read again.
  void Function()? onChanged;

  /// The flags sheet is shown, and changes are made, only with `patients.edit` (section 11, row 8).
  bool get mayEdit => permissions.contains('patients.edit');

  /// The phone holds a copy of the team's presets (6.1). False is "Your team’s setup hasn’t
  /// downloaded yet. Connect to finish." on the flags sheet and intake's risk level, which then offer
  /// nothing (section 11, row 34).
  bool get presetsHeld => PresetStore(store).downloaded;

  /// The team's active flags of [tier] the person may see ([flagHidden]), by rank, then name, then
  /// ID: what the sheet offers to set, intake's risk level and the patient list's filters. Empty
  /// where the presets aren't held.
  List<FlagView> teamFlags(FlagTier tier) {
    if (!presetsHeld) return const [];
    return [
      for (final f in _ordered(_held().values.where((f) => f.tier == tier && !f.archived && !_hidden(f)))) f.view,
    ];
  }

  /// [patientId]'s flags (6.1): `currentFlags` over the flag change records this phone holds for the
  /// patient's merged group whose IDs the chart lists or that this phone made, confirmed or not,
  /// less those held for review or refused, with the person's flag rule; each flag named from the
  /// presets, else from the chart's `flags`; the history of every change the person may see, a
  /// hidden flag's never. A chart read already logged on screen: this logs nothing. Throws
  /// [ChartingPaused] while the store is frozen.
  ///
  /// For a patient the phone holds no full chart of (one opened from the index offline, or never
  /// opened), the team index entry's flags stand for what the server worked out before, with the
  /// changes made here that it can't reflect yet folded after them: one still waiting, or made after
  /// the index was last refreshed. Its history then lists this phone's changes only.
  PatientFlagsView flagsOf(String patientId) {
    _guardFrozen();
    return _read(store.canonicalPatient(patientId));
  }

  /// What the flags sheet offers [patientId] in [tier]: [teamFlags], and an archived flag the patient
  /// carries, which is offered only to clear (5.1).
  List<FlagView> offered(String patientId, FlagTier tier) {
    final now = flagsOf(patientId);
    if (!presetsHeld) return const [];
    final held = _held();
    final carried = [
      for (final f in [?now.riskLevel, ...now.conditions])
        if (f.tier == tier && f.archived && held.containsKey(f.flagId)) held[f.flagId]!,
    ];
    return [...teamFlags(tier), for (final f in _ordered(carried)) f.view];
  }

  /// The risk level a patient list row shows for [patientId] (8.2): the current risk level of a chart
  /// the phone holds ([flagsOf]), else the team index entry's, as the person may see it; null for
  /// none, or where the presets name no such flag.
  FlagView? riskLevelOf(String patientId) {
    _guardFrozen();
    final canonical = store.canonicalPatient(patientId);
    final group = patientGroup(store, canonical);
    if (chartMetaOf(store, canonical) == null && _changeRows(group).isEmpty) {
      // Nothing of the patient's here but the index: its entry alone, as the person may see it.
      final primary = index?.flagsOf(canonical)?.primary;
      final f = primary == null ? null : _held()[primary];
      return f == null || _hidden(f) ? null : f.view;
    }
    return _read(canonical).riskLevel;
  }

  /// Records one change of [patientId]'s flags: [action] `set` or `clear` of the flag [flagId], with
  /// [reason] (trimmed; 1 to 500 code points, `flagReasonInvalid`), a create whose parent is the
  /// patient, filed under the canonical patient. Returns its ID.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock is paused; a
  /// [LocalValidationError] with `not_allowed` without `patients.edit`, `unknown_flag` for a flag
  /// the person may not see or the presets don't hold, `archived` for a set of an archived flag
  /// (a clear is taken), and `reason_invalid` for a reason the rule refuses.
  String record(String patientId, {required String flagId, required String action, required String reason}) {
    final id = _record(patientId, flagId: flagId, action: action, reason: reason);
    onChanged?.call();
    return id;
  }

  /// Intake's risk level (8.2), recorded in `PatientRepository.createPatient`'s transaction as a set
  /// whose parent is the new patient's create: null, and nothing written, while the clock is paused
  /// or where the presets aren't held, since the patient saves without one then. Otherwise as
  /// [record], a risk level only, without telling the screens: intake does once the patient is saved.
  String? recordAtIntake(String patientId, IntakeRiskLevel level) {
    if (store.chartingPaused || !presetsHeld) return null;
    return _record(patientId, flagId: level.flagId, action: 'set', reason: level.reason, tier: FlagTier.primary);
  }

  /// The flags sheet's **Save** (8.2): the risk level chosen ([riskLevel], a flag ID, or null for
  /// None) and the conditions chosen, against [patientId]'s current flags, each difference recorded
  /// as one change with [reason], in one transaction: a new risk level is its set, None a clear of the
  /// level the patient has, a condition added a set and one taken off a clear. Returns the changes'
  /// IDs, none when nothing differs. Throws as [record] does, writing nothing.
  List<String> save(
    String patientId, {
    required String? riskLevel,
    required Set<String> conditions,
    required String reason,
  }) {
    _guardWrite();
    final now = flagsOf(patientId);
    final carried = {for (final f in now.conditions) f.flagId};
    final level = now.riskLevel?.flagId;
    // A condition the phone's copy of the presets doesn't hold, only the chart names, is never offered
    // ([offered]), so it can't have been taken off: it is left as it is.
    final held = _held();
    final changes = <({String flagId, String action, FlagTier tier})>[
      if (riskLevel != level && riskLevel != null) (flagId: riskLevel, action: 'set', tier: FlagTier.primary),
      if (riskLevel != level && riskLevel == null) (flagId: level!, action: 'clear', tier: FlagTier.primary),
      for (final id in conditions)
        if (!carried.contains(id)) (flagId: id, action: 'set', tier: FlagTier.secondary),
      for (final id in carried)
        if (!conditions.contains(id) && held.containsKey(id)) (flagId: id, action: 'clear', tier: FlagTier.secondary),
    ];
    if (changes.isEmpty) return const [];
    final ids = store.transaction(
      () => [
        for (final c in changes) _record(patientId, flagId: c.flagId, action: c.action, reason: reason, tier: c.tier),
      ],
    );
    onChanged?.call();
    return ids;
  }

  /// **Entered in error** is offered on [change]: one standing, made by the person or marked by a
  /// holder of `team.manage_users`, with `patients.edit` (6.2; section 11, rows 23 and 24). Not on a
  /// change the server holds for review, which isn't on the chart to mark.
  // PLAN-OPEN (PL-19): who counts as a Program Admin, to mark someone else's flag change entered in
  // error, with no new keys? A holder of team.manage_users, as phase 4's assign reads it; the server
  // decides the same (services/api/src/sync/entities/patient-flag-change.ts), and this only offers it.
  bool mayEnterInError(FlagChangeView change) =>
      mayEdit &&
      change.enteredInError == null &&
      (change.state == FlagChangeState.sent || change.state == FlagChangeState.waiting) &&
      (change.authorId == userId || permissions.contains(_manageUsers));

  /// Marks the change [changeId] entered in error with [reason] (trimmed, 3 to 300 code points), once:
  /// it drops out of the current flags and stays in the history (section 11, row 23). [changeId] is
  /// the flag change's own ID, as the history gives it ([FlagChangeView.changeId]).
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock is paused; a
  /// [LocalValidationError] with `not_allowed` for someone [mayEnterInError] refuses,
  /// `entered_in_error` for one marked already, and `reason` for a reason out of bounds; a
  /// [StateError] for a change the phone doesn't hold, or doesn't show the person.
  void enterInError(String changeId, String reason) {
    _guardFrozen();
    _guardClock();
    final rec = store.record(changeId);
    final patientId = rec?.patientId;
    if (rec == null || rec.entity != entityFlagChange || patientId == null) {
      throw StateError('no such flag change on this phone');
    }
    final shown = _read(store.canonicalPatient(patientId)).history.where((h) => h.changeId == changeId).firstOrNull;
    // A hidden flag's change, a refused one and one never applied are none the person is shown.
    if (shown == null) throw StateError('no such flag change on this phone');
    if (shown.enteredInError != null) throw const LocalValidationError(_marked, problem: 'entered_in_error');
    if (!mayEnterInError(shown)) throw const LocalValidationError(_notYours, problem: 'not_allowed');
    final text = reason.trim();
    final length = text.runes.length;
    if (length < 3 || length > 300) {
      throw const LocalValidationError(_markReasonLength, problem: 'reason', paths: {'reason'});
    }
    store.setField(changeId, 'enteredInError', {'reason': text});
    onChanged?.call();
  }

  /// What **Choose a flag** offers for the refused change [changeId] ([settledByFlag]): the active
  /// flags the person may see of the tier of the refused change's flag, as the presets give it, the
  /// refused flag left out. Empty, the card says "This flag can’t be set on this phone. Tell a Program
  /// Admin." and nothing is sent. A refused flag the phone knows nowhere has no tier, so nothing is
  /// offered for it either. Throws a [StateError] for a change [settledByFlag] doesn't take.
  ///
  /// Nothing either for a refused clear ([clearsFlag]): sent again with another flag, it would clear
  /// that one, which the person never chose to take off (a risk level among them), so the card says
  /// "This flag can’t be cleared on this phone. Tell a Program Admin." and nothing is sent.
  ///
  /// Here, and in [chooseFlag] and [changeReason], [changeId] is the refused create's entry in the
  /// outbox, as Needs attention lists it ([OutboxEntry.changeId]), not the flag change's own ID.
  List<FlagView> flagsToChoose(String changeId) {
    _guardFrozen();
    final refused = _refused(changeId, settledByFlag);
    if (clearsFlag(refused)) return const [];
    final value = refused.value! as Map<String, Object?>;
    final flagId = value['flagId'];
    final patientId = value['patientId'];
    final chart = patientId is String ? chartMetaOf(store, store.canonicalPatient(patientId))?.flags : null;
    final tier = _catalog(chart)[flagId]?.tier;
    if (tier == null) return const [];
    return [
      for (final f in teamFlags(tier))
        if (f.flagId != flagId) f,
    ];
  }

  /// **Choose a flag**: the refused create [changeId] sent again with [flagId] and [reason], through
  /// `fixRejected`, so the refusal settles once the server takes it. Throws as [record] does, and a
  /// [StateError] for a change [settledByFlag] doesn't take. [flagId] must be one [flagsToChoose]
  /// offers (`unknown_flag` otherwise).
  void chooseFlag(String changeId, {required String flagId, required String reason}) {
    _guardFrozen();
    final refused = _refused(changeId, settledByFlag);
    _guardClock();
    if (!flagsToChoose(changeId).any((f) => f.flagId == flagId)) {
      throw const LocalValidationError(_unknownFlag, problem: 'unknown_flag');
    }
    store.fixRejected(changeId, {
      ...refused.value! as Map<String, Object?>,
      'flagId': flagId,
      'reason': _reason(reason),
    });
    onChanged?.call();
  }

  /// **Change the reason**: the refused create [changeId] sent again as it was, with [reason],
  /// through `fixRejected`. Throws as [record] does, and a [StateError] for a change
  /// [settledByReason] doesn't take.
  void changeReason(String changeId, String reason) {
    _guardFrozen();
    final refused = _refused(changeId, settledByReason);
    _guardClock();
    store.fixRejected(changeId, {...refused.value! as Map<String, Object?>, 'reason': _reason(reason)});
    onChanged?.call();
  }

  // ---- receipts ----

  /// Registers the receipt hook ([_onConfirmed]). Called once per store.
  void install() => store.onConfirmed.add(_onConfirmed);

  /// What the phone keeps of a flag change of its own once a receipt confirms it, in the receipt's
  /// transaction, since its outbox entry, and the times on it, go then (IDs and times only, in `kv`;
  /// never a flag or a reason): the change's own time, as the server's `when` reads it (the corrected
  /// time, else the device's); when the receipt came, by the corrected clock; for each mark the
  /// server holds for a Program Admin, the mark's change, so it is told from a held create of the
  /// same change; and whether a later mark was taken, which a held one's fate no longer decides.
  /// [_read] dates a confirmed change by them until a chart gives the server's time. What it kept of
  /// a change the phone no longer holds goes here too.
  void _onConfirmed(OutboxEntry e, AcceptedReceipt receipt) {
    if (e.entity != entityFlagChange) return;
    final kept = {...?_kept(e.recordId)};
    if (e.op == 'create') {
      kept[_keptAt] = (e.correctedTime ?? e.deviceTime).millisecondsSinceEpoch;
      kept[_keptReceivedAt] = _now().millisecondsSinceEpoch;
    } else if (e.op == 'set' && e.field == 'enteredInError' && receipt.inReview) {
      kept[_keptHeldMarks] = [..._heldMarksOf(kept), e.changeId];
      kept.remove(_keptMarkTaken);
    } else if (e.op == 'set' && e.field == 'enteredInError') {
      kept[_keptMarkTaken] = true;
    } else {
      return;
    }
    store.setKv('$_keptKvPrefix${e.recordId}', jsonEncode(kept));
    store.database.execute(
      'DELETE FROM kv WHERE substr(key, 1, ${_keptKvPrefix.length}) = ? '
      'AND substr(key, ${_keptKvPrefix.length + 1}) NOT IN (SELECT id FROM records)',
      [_keptKvPrefix],
    );
  }

  /// What [_onConfirmed] kept of the flag change [recordId]; null for none (one not confirmed yet,
  /// one made on another phone, or one confirmed by a version of the app that kept nothing).
  Map<String, Object?>? _kept(String recordId) {
    final raw = store.kv('$_keptKvPrefix$recordId');
    if (raw == null) return null;
    final value = jsonDecode(raw);
    return value is Map<String, Object?> ? value : null;
  }

  /// The change IDs of every mark of a flag change the server held, as [kept] holds them.
  static List<String> _heldMarksOf(Map<String, Object?>? kept) => [
    for (final id in kept?[_keptHeldMarks] as List<Object?>? ?? const [])
      if (id is String) id,
  ];

  // ---- recording ----

  /// One change, checked as the server would refuse it and in this layer's words, then created.
  /// [tier], when given, is the tier the flag must be of (Save's risk level and conditions).
  String _record(
    String patientId, {
    required String flagId,
    required String action,
    required String reason,
    FlagTier? tier,
  }) {
    _guardWrite();
    if (action != 'set' && action != 'clear') throw ArgumentError('a flag is set or cleared: $action');
    final flag = _held()[flagId];
    if (flag == null || _hidden(flag) || (tier != null && flag.tier != tier)) {
      throw const LocalValidationError(_unknownFlag, problem: 'unknown_flag');
    }
    if (action == 'set' && flag.archived) throw const LocalValidationError(_archived, problem: 'archived');
    return store.createRecord(entityFlagChange, {
      'patientId': store.canonicalPatient(patientId),
      'flagId': flagId,
      'action': action,
      'reason': _reason(reason),
    });
  }

  /// [reason] trimmed, as the store sends it; `reason_invalid` when the server would refuse it.
  static String _reason(String reason) {
    final text = reason.trim();
    if (flagReasonInvalid(text)) {
      throw const LocalValidationError(_reasonLength, problem: 'reason_invalid', paths: {'reason'});
    }
    return text;
  }

  /// The refused change [changeId] that [settles] takes; a [StateError] for anything else.
  OutboxEntry _refused(String changeId, bool Function(OutboxEntry e) settles) {
    final e = store.entry(changeId);
    if (e == null || !settles(e)) throw StateError('not a flag change this fix settles');
    return e;
  }

  void _guardFrozen() {
    if (store.frozen) throw ChartingPaused(store.frozenMessage!);
  }

  /// A flag change pauses with the clock (D35; PL-24): it is ordered by its own time.
  void _guardClock() {
    if (store.chartingPaused) throw const ChartingPaused(flagsClockPaused);
  }

  void _guardWrite() {
    _guardFrozen();
    _guardClock();
    if (!mayEdit) throw const LocalValidationError(_notAllowed, problem: 'not_allowed');
  }

  // ---- reading ----

  /// The flag rule ([flagHidden], the phone's one copy) over a flag as this class holds it: one of the
  /// presets by its body; one only a chart names, which the server's rule showed this person when it
  /// read the chart, is shown. A flag the phone knows nowhere is never in the catalog, so never shown.
  bool _hidden(_Flag f) => f.held && flagHidden(permissions, f.body);

  /// The team's flags the phone's copy of the presets holds, archived ones included, by ID.
  Map<String, _Flag> _held() => {
    for (final p in PresetStore(store).presets(kind: PresetKind.flag))
      if (p.body case final FlagBody b)
        p.id: _Flag(
          id: p.id,
          tier: b.tier,
          rank: b.rank,
          name: b.name,
          color: b.color,
          colorName: b.color.colorName,
          archived: p.state == PresetState.archived,
          body: b,
        ),
  };

  /// Every flag the phone can name: the presets' (6.1), then those [chart] names that the presets
  /// don't hold, which the server showed this person when it read the chart (its flag rule applied),
  /// first as the patient's own flags, then as its history rows name them.
  Map<String, _Flag> _catalog(api.ChartFlags? chart) {
    final out = _held();
    if (chart == null) return out;
    for (final f in [?chart.primary, ...chart.secondary]) {
      final tier = _tierOf(f.tier);
      if (tier == null || out.containsKey(f.flagId)) continue;
      out[f.flagId] = _Flag(
        id: f.flagId,
        tier: tier,
        rank: f.rank,
        name: f.name,
        color: FlagColor.byCode(f.color.wire),
        colorName: f.colorName,
        archived: f.archived,
      );
    }
    for (final h in chart.history) {
      final tier = _tierOf(h.tier);
      if (tier == null || out.containsKey(h.flagId)) continue;
      out[h.flagId] = _Flag(
        id: h.flagId,
        tier: tier,
        rank: _unranked,
        name: h.name,
        color: null,
        colorName: '',
        archived: false,
      );
    }
    return out;
  }

  static FlagTier? _tierOf(api.FlagTier t) => switch (t) {
    api.FlagTier.primary => FlagTier.primary,
    api.FlagTier.secondary => FlagTier.secondary,
    _ => null,
  };

  /// The flag change records filed under [group]'s patients, in the order they came to this phone,
  /// with when each came.
  List<({String id, DateTime createdAt})> _changeRows(Set<String> group) {
    final ids = group.toList();
    return [
      for (final r in store.database.select(
        'SELECT id, created_at FROM records WHERE entity = ? AND patient_id IN '
        '(${List.filled(ids.length, '?').join(', ')}) ORDER BY created_at, rowid',
        [entityFlagChange, ...ids],
      ))
        (id: r['id']! as String, createdAt: DateTime.fromMillisecondsSinceEpoch(r['created_at']! as int, isUtc: true)),
    ];
  }

  /// Everything [flagsOf] answers for the canonical patient [canonical].
  PatientFlagsView _read(String canonical) {
    final group = patientGroup(store, canonical);
    final meta = chartMetaOf(store, canonical);
    final full = meta != null && !meta.partial;
    final chart = full ? meta.flags : null;
    final listed = full ? meta.flagChangeIds.toSet() : const <String>{};
    final rows = {for (final h in chart?.history ?? const <api.FlagHistoryRow>[]) h.changeId: h};
    final catalog = _catalog(chart);

    // What waits here of each change: its create, and its mark, each the latest not folded into a fix.
    final creates = <String, OutboxEntry>{};
    final marks = <String, OutboxEntry>{};
    for (final e in store.outbox()) {
      if (e.entity != entityFlagChange || e.state == ChangeState.superseded) continue;
      if (e.op == 'create') creates[e.recordId] = e;
      if (e.op == 'set' && e.field == 'enteredInError') marks[e.recordId] = e;
    }
    // Held by the server for a Program Admin (IDs only): a change's create, or its Entered in error
    // mark, told apart by the mark this phone kept at the receipt; and those the server told the person
    // it didn't apply.
    final heldCreates = <String>{};
    final heldMarks = <String>{};
    for (final r in store.database.select('SELECT change_id, record_id FROM in_review WHERE entity = ?', [
      entityFlagChange,
    ])) {
      final recordId = r['record_id']! as String;
      if (_heldMarksOf(_kept(recordId)).contains(r['change_id'])) {
        heldMarks.add(recordId);
      } else {
        heldCreates.add(recordId);
      }
    }
    final notApplied = {
      for (final n in store.notices())
        if (n.kind == noticeFlagChangeNotApplied && n.recordId != null) n.recordId!,
    };

    final changes = <_Change>[];
    // This phone's own changes in the order they were made: one dated by this phone no earlier than
    // the one made before it goes after it, as the person made them, where two fall on one instant.
    DateTime? lastOwn;
    DateTime? lastOwnAsDated;
    for (final row in _changeRows(group)) {
      final rec = store.record(row.id);
      if (rec == null) continue;
      final create = creates[row.id];
      final FlagChangeState state;
      if (create != null) {
        state = create.state == ChangeState.rejected ? FlagChangeState.refused : FlagChangeState.waiting;
      } else if (listed.contains(row.id)) {
        state = FlagChangeState.sent;
      } else if (rec.origin != 'local' || (notApplied.contains(row.id) && !heldMarks.contains(row.id))) {
        // A server copy the chart no longer lists (merged away, or its flag hidden since), or a held
        // change a Program Admin didn't apply, which its notice tells the person of. A notice about a
        // held mark leaves the change it was for standing.
        continue;
      } else {
        state = heldCreates.contains(row.id) ? FlagChangeState.inReview : FlagChangeState.sent;
      }
      final a = rec.attributes;
      final serverAt = _time(a['effectiveAt']);
      final kept = create == null ? _kept(row.id) : null;
      final keptAt = _ms(kept?[_keptAt]);
      final receivedAt = _ms(kept?[_keptReceivedAt]);
      // One confirmed here that no chart dates yet: by its own time, never later than its receipt, as
      // the server dates it (D90; section 11, row 30), and not by when its record was made here, which
      // is the phone's own clock, uncorrected.
      final ownAt = keptAt != null && receivedAt != null && receivedAt.isBefore(keptAt) ? receivedAt : keptAt;
      final dated = serverAt ?? create?.correctedTime ?? create?.deviceTime ?? ownAt ?? row.createdAt;
      var at = dated;
      if (rec.origin == 'local') {
        if (serverAt == null && lastOwn != null && !at.isAfter(lastOwn) && !dated.isBefore(lastOwnAsDated!)) {
          at = lastOwn.add(const Duration(milliseconds: 1));
        }
        lastOwn = at;
        lastOwnAsDated = dated;
      }
      // A refused change shows only in Needs attention.
      if (state == FlagChangeState.refused) continue;
      final flag = catalog[a['flagId']];
      if (flag == null || _hidden(flag)) continue;
      // A mark held for review, unless a later one of this phone's was taken since.
      final heldMark = heldMarks.contains(row.id) && kept?[_keptMarkTaken] != true;
      changes.add(
        _Change(
          id: row.id,
          flag: flag,
          action: a['action'] as String? ?? '',
          at: at,
          receivedAt: receivedAt,
          pending: create != null,
          authorId: rec.authorUserId ?? '',
          authorName: rows[row.id]?.authorName ?? nameOf?.call(rec.authorUserId ?? ''),
          reason: a['reason'] as String?,
          mark: _mark(
            rec,
            marks[row.id],
            rows[row.id]?.enteredInError,
            held: heldMark && !notApplied.contains(row.id),
            dropped: heldMark && notApplied.contains(row.id),
          ),
          state: state,
        ),
      );
    }

    // A patient whose chart the phone doesn't hold whole: the index's word stands for the server's
    // earlier changes, and what it can't reflect yet of this phone's is folded after it: a change still
    // waiting, or one whose receipt came after the index was worked out (the index's time is the
    // server's, the receipt's the corrected clock's), else, where the receipt's time wasn't kept, one
    // made after it.
    final base = <FlagChangeRef>[];
    var counted = changes.where((c) => c.state == FlagChangeState.sent || c.state == FlagChangeState.waiting);
    final indexed = full ? null : index?.flagsOf(canonical);
    if (indexed != null) {
      final epoch = DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
      for (final id in [?indexed.primary, ...indexed.secondary]) {
        base.add((id: '', flagId: id, action: 'set', effectiveAt: epoch, enteredInError: false));
      }
      final refreshedAt = index!.state.refreshedAt;
      counted = counted.where((c) => c.pending || refreshedAt == null || (c.receivedAt ?? c.at).isAfter(refreshedAt));
    }
    final current = currentFlags(
      changes: [
        ...base,
        for (final c in counted)
          (
            id: c.id,
            flagId: c.flag.id,
            action: c.action,
            effectiveAt: c.at,
            // A mark the server holds for a Program Admin hasn't taken the change off its chart yet.
            enteredInError: c.mark != null && !c.mark!.held,
          ),
      ],
      // The fold leaves out a change whose flag it isn't given: every flag the rule hides is kept out.
      flags: {
        for (final MapEntry(:key, :value) in catalog.entries)
          if (!_hidden(value)) key: value.ref,
      },
      hidden: (_) => false,
    );
    final history = [...changes]
      ..sort((x, y) {
        final byTime = y.at.compareTo(x.at);
        return byTime != 0 ? byTime : y.id.compareTo(x.id);
      });
    return PatientFlagsView(
      riskLevel: current.primary == null ? null : catalog[current.primary]!.view,
      conditions: [for (final id in current.secondary) catalog[id]!.view],
      history: [for (final c in history) c.view],
      sentForReview: changes.any((c) => c.state == FlagChangeState.inReview || (c.mark?.held ?? false)),
    );
  }

  /// [rec]'s mark entered in error, as the person may read it: none while it stands, or while the mark
  /// made here waits refused in Needs attention. One made here waits for its receipt ([markEntry]);
  /// the chart's history row ([charted]) says who made a mark the server holds, and when. One of this
  /// phone's the server holds for a Program Admin ([held]) is shown as such, and counts for nothing
  /// until a chart shows it made; one a Program Admin didn't apply ([dropped]) is none, whatever this
  /// phone's record still says of it.
  static FlagChangeMarkView? _mark(
    LocalRecord rec,
    OutboxEntry? markEntry,
    api.FlagChangeMark? charted, {
    bool held = false,
    bool dropped = false,
  }) {
    final value = rec.fields['enteredInError']?.value;
    final reason = value is Map<String, Object?> ? value['reason'] as String? : null;
    if (markEntry != null) {
      if (markEntry.state == ChangeState.rejected) return null;
      return (
        byName: null,
        at: markEntry.correctedTime ?? markEntry.deviceTime,
        reason: reason,
        waiting: true,
        held: false,
      );
    }
    if (charted != null) return (byName: charted.byName, at: charted.at, reason: reason, waiting: false, held: false);
    if (held) return (byName: null, at: null, reason: reason, waiting: false, held: true);
    if (dropped || (value is! Map<String, Object?> && rec.status != 'entered_in_error')) return null;
    return (byName: null, at: null, reason: reason, waiting: false, held: false);
  }

  static DateTime? _time(Object? iso) => iso is String ? DateTime.tryParse(iso) : null;

  static DateTime? _ms(Object? ms) => ms is int ? DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true) : null;

  /// By rank, then name (by code unit, as the server orders them), then ID.
  static List<_Flag> _ordered(Iterable<_Flag> flags) => [...flags]
    ..sort((a, b) {
      final byRank = a.rank.compareTo(b.rank);
      if (byRank != 0) return byRank;
      final byName = a.name.compareTo(b.name);
      return byName != 0 ? byName : a.id.compareTo(b.id);
    });
}

/// Where [FlagView.rank] puts a flag the phone knows from a chart's history row alone: after the rest.
const _unranked = 1000001;

/// One of the team's flags as this class reads it: from the phone's copy of the presets, or as a
/// chart named it.
class _Flag {
  const _Flag({
    required this.id,
    required this.tier,
    required this.rank,
    required this.name,
    required this.color,
    required this.colorName,
    required this.archived,
    this.body,
  });

  final String id;
  final FlagTier tier;
  final int rank;
  final String name;
  final FlagColor? color;
  final String colorName;
  final bool archived;

  /// The preset's body, which the flag rule reads; null for a flag only a chart names.
  final FlagBody? body;

  /// The phone's copy of the presets holds it.
  bool get held => body != null;

  FlagView get view =>
      FlagView(flagId: id, name: name, tier: tier, color: color, colorName: colorName, rank: rank, archived: archived);

  FlagRef get ref => (
    tier: tier,
    rank: rank,
    name: name,
    sensitive: body?.sensitive ?? false,
    state: archived ? PresetState.archived : PresetState.active,
  );
}

/// One change as [PatientFlags.flagsOf] reads it.
class _Change {
  const _Change({
    required this.id,
    required this.flag,
    required this.action,
    required this.at,
    required this.receivedAt,
    required this.pending,
    required this.authorId,
    required this.authorName,
    required this.reason,
    required this.mark,
    required this.state,
  });

  final String id;
  final _Flag flag;
  final String action;

  /// The server's time for it, or this phone's for one made here that no chart lists yet.
  final DateTime at;

  /// For one made here, when its receipt came, by the corrected clock; null while it waits, and where
  /// the phone kept none.
  final DateTime? receivedAt;

  /// Made here, its create still waiting for its receipt.
  final bool pending;
  final String authorId;
  final String? authorName;
  final String? reason;
  final FlagChangeMarkView? mark;
  final FlagChangeState state;

  FlagChangeView get view => FlagChangeView(
    changeId: id,
    flag: flag.view,
    action: action,
    at: at,
    authorId: authorId,
    authorName: authorName,
    reason: reason,
    enteredInError: mark,
    state: state,
  );
}

/// While the clock is paused (D35): the flags sheet's words (8.2).
const flagsClockPaused = 'Flags can be changed once the phone’s clock is right.';

const _manageUsers = 'team.manage_users';

/// Where [PatientFlags] keeps what a receipt confirms of a flag change of this phone's (IDs and times
/// only, `kv` by the flag change's ID), and its keys.
const _keptKvPrefix = 'flagChange.';
const _keptAt = 'at';
const _keptReceivedAt = 'receivedAt';
const _keptHeldMarks = 'heldMarks';
const _keptMarkTaken = 'markTaken';

// What the flags sheet, intake and Needs attention say when this layer stops: its words.
const _notAllowed = 'Your role can’t change a patient’s flags.';
const _unknownFlag = 'This flag isn’t on your team’s list.';
const _archived = 'This flag is no longer on the team’s list. It can only be cleared.';
const _reasonLength = 'Give a reason, up to 500 characters.';
const _marked = 'This change is already marked entered in error.';
const _notYours = 'Only the person who made this change, or a Program Admin, can mark it entered in error.';
const _markReasonLength = 'Give a short reason (3 to 300 characters).';
