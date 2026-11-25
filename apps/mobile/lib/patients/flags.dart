/// A patient's flags on the phone (phase 5 design 6.1, 6.2, 8.2): the one domain class the flags
/// sheet, intake's risk level, the patient list and Needs attention write through, never the store
/// directly. It records a change (through `createRecord`, refused while the store is frozen or the
/// clock is paused, D35), works out the patient's current flags (6.1), marks a change entered in
/// error, and settles the two refusals a worker can fix (Choose a flag and Change the reason,
/// through `fixRejected`, D121). The flag rule here is the phone's one copy of the server's
/// (`flagHidden` in services/api/src/sync/read-rules.ts, D99, D136).
///
/// Written ahead of its code (card P5-tests): every member throws until card P5-phone-domain
/// builds it. The tests in test/patients/flags_test.dart say what each must do.
library;

import '../presets/models.dart' show FlagBody, FlagColor, FlagTier;
import '../sync/local_store.dart';
import 'access.dart' show mayViewProblems;

// ------------------------------------------------------------------------------------------------
// The flag rule
// ------------------------------------------------------------------------------------------------

/// Whether a person with [permissions] sees a sensitive flag: the reader half of the flag rule (6.2,
/// D136), the server's `Projection.sensitive` for a sensitive problem, `mayViewProblems` (access.dart)
/// and `patients.view_sensitive`, held to it role by role in flags_test.dart through access.json.
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
bool settledByFlag(OutboxEntry e) => throw UnimplementedError('P5-phone-domain');

/// Whether Needs attention offers **Change the reason** for [e]: a refused create of a flag change
/// whose reason the server refused (`reason_invalid`).
bool settledByReason(OutboxEntry e) => throw UnimplementedError('P5-phone-domain');

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

  /// The colour's plain name, shown first: "Red".
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
/// (holders of `team.manage_users`, section 11 rows 23 and 24).
typedef FlagChangeMarkView = ({String? byName, DateTime? at, String? reason, bool waiting});

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
  PatientFlags(this.store, {required this.userId, required this.permissions, this.nameOf});

  final LocalStore store;

  /// The person's ID: a change's author.
  final String userId;

  /// The person's permission keys in the team, as /v1/me last reported them.
  final List<String> permissions;

  /// A teammate's name, where the phone knows it.
  final String? Function(String userId)? nameOf;

  /// Called after a change made here, so screens read again.
  void Function()? onChanged;

  /// The flags sheet is shown, and changes are made, only with `patients.edit` (section 11, row 8).
  bool get mayEdit => throw UnimplementedError('P5-phone-domain');

  /// The phone holds a copy of the team's presets (6.1). False is "Your team’s setup hasn’t
  /// downloaded yet. Connect to finish." on the flags sheet and intake's risk level, which then offer
  /// nothing (section 11, row 34).
  bool get presetsHeld => throw UnimplementedError('P5-phone-domain');

  /// The team's active flags of [tier] the person may see ([flagHidden]), by rank, then name, then
  /// ID: what the sheet offers to set, intake's risk level and the patient list's filters. Empty
  /// where the presets aren't held.
  List<FlagView> teamFlags(FlagTier tier) => throw UnimplementedError('P5-phone-domain');

  /// [patientId]'s flags (6.1): `currentFlags` over the flag change records this phone holds for the
  /// patient's merged group whose IDs the chart lists or that this phone made, confirmed or not,
  /// less those held for review or refused, with the person's flag rule; each flag named from the
  /// presets, else from the chart's `flags`; the history of every change the person may see, a
  /// hidden flag's never. A chart read already logged on screen: this logs nothing. Throws
  /// [ChartingPaused] while the store is frozen.
  PatientFlagsView flagsOf(String patientId) => throw UnimplementedError('P5-phone-domain');

  /// What the flags sheet offers [patientId] in [tier]: [teamFlags], and an archived flag the patient
  /// carries, which is offered only to clear (5.1).
  List<FlagView> offered(String patientId, FlagTier tier) => throw UnimplementedError('P5-phone-domain');

  /// The risk level a patient list row shows for [patientId] (8.2): the current risk level of a chart
  /// the phone holds ([flagsOf]), else the team index entry's, as the person may see it; null for
  /// none, or where the presets name no such flag.
  FlagView? riskLevelOf(String patientId) => throw UnimplementedError('P5-phone-domain');

  /// Records one change of [patientId]'s flags: [action] `set` or `clear` of the flag [flagId], with
  /// [reason] (trimmed; 1 to 500 code points, `flagReasonInvalid`), a create whose parent is the
  /// patient, filed under the canonical patient. Returns its ID.
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock is paused; a
  /// [LocalValidationError] with `not_allowed` without `patients.edit`, `unknown_flag` for a flag
  /// the person may not see or the presets don't hold, `archived` for a set of an archived flag
  /// (a clear is taken), and `reason_invalid` for a reason the rule refuses.
  String record(String patientId, {required String flagId, required String action, required String reason}) =>
      throw UnimplementedError('P5-phone-domain');

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
  }) => throw UnimplementedError('P5-phone-domain');

  /// **Entered in error** is offered on [change]: one standing, made by the person or marked by a
  /// holder of `team.manage_users`, with `patients.edit` (6.2; section 11, rows 23 and 24).
  bool mayEnterInError(FlagChangeView change) => throw UnimplementedError('P5-phone-domain');

  /// Marks the change [changeId] entered in error with [reason] (trimmed, 3 to 300 code points), once:
  /// it drops out of the current flags and stays in the history (section 11, row 23).
  ///
  /// Throws, writing nothing: [ChartingPaused] while the store is frozen or the clock is paused; a
  /// [LocalValidationError] with `not_allowed` for someone [mayEnterInError] refuses,
  /// `entered_in_error` for one marked already, and `reason` for a reason out of bounds; a
  /// [StateError] for a change the phone doesn't hold.
  void enterInError(String changeId, String reason) => throw UnimplementedError('P5-phone-domain');

  /// What **Choose a flag** offers for the refused change [changeId] ([settledByFlag]): the active
  /// flags the person may see of the tier of the refused change's flag, as the presets give it, the
  /// refused flag left out. Empty, the card says "This flag can’t be set on this phone. Tell a Program
  /// Admin." and nothing is sent.
  List<FlagView> flagsToChoose(String changeId) => throw UnimplementedError('P5-phone-domain');

  /// **Choose a flag**: the refused create [changeId] sent again with [flagId] and [reason], through
  /// `fixRejected`, so the refusal settles once the server takes it. Throws as [record] does, and a
  /// [StateError] for a change [settledByFlag] doesn't take.
  void chooseFlag(String changeId, {required String flagId, required String reason}) =>
      throw UnimplementedError('P5-phone-domain');

  /// **Change the reason**: the refused create [changeId] sent again as it was, with [reason],
  /// through `fixRejected`. Throws as [record] does, and a [StateError] for a change
  /// [settledByReason] doesn't take.
  void changeReason(String changeId, String reason) => throw UnimplementedError('P5-phone-domain');
}
