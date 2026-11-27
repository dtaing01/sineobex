/// A patient's current flags (phase 5 design 5.3, 4.5; D135): the phone's copy of
/// packages/presets/src/current-flags.ts, which packages/contract/test-vectors/flag-current.json pins
/// with it. The flags sheet, the profile's pills and the patient list read it offline, with the
/// person's flag rule (P5-phone-domain).
library;

import 'models.dart';

/// What the fold reads of one of the team's flags: its body's tier, rank, name and sensitive, and the
/// preset's state.
typedef FlagRef = ({FlagTier tier, int rank, String name, bool sensitive, PresetState state});

/// What the fold reads of one flag change: [action] is `set` or `clear`, and [effectiveAt] the
/// change's time (4.5), an instant.
typedef FlagChangeRef = ({String id, String flagId, String action, DateTime effectiveAt, bool enteredInError});

/// The patient's risk level, or none, and their conditions by rank, then name, then id.
typedef CurrentFlags = ({String? primary, List<String> secondary});

/// A change marked entered in error is left out, and so is one whose flag is not among [flags] or that
/// [hidden] hides. The rest are folded by `effectiveAt`, then id: a set makes its flag the primary, and
/// a clear takes the primary off only when its flag is the primary then; a condition is carried when
/// its own last change is a set. An archived flag is answered as any other.
///
/// [changes] are the flag changes of the patient's merged group, in any order, [flags] the team's
/// flags by id, archived ones included, and [hidden] the reader's flag rule (design 6.2): true for a
/// flag this reader may not see. Nothing given is changed.
CurrentFlags currentFlags({
  required Iterable<FlagChangeRef> changes,
  required Map<String, FlagRef> flags,
  required bool Function(FlagRef flag) hidden,
}) {
  // A change entered in error drops out as though it had never been made. The rule is asked only of
  // the team's own flags: a flag the team does not hold names nothing the reader could be shown.
  final ordered = [
    for (final change in changes)
      if (flags[change.flagId] case final flag? when !change.enteredInError && !hidden(flag)) change,
  ]..sort(_byTimeThenId);
  String? primary;
  final lastOf = <String, String>{};
  for (final change in ordered) {
    if (flags[change.flagId]!.tier == FlagTier.secondary) {
      lastOf[change.flagId] = change.action;
    } else if (change.action == 'set') {
      primary = change.flagId;
    } else if (primary == change.flagId) {
      // A clear takes the risk level off only when it names the level the patient has then: a clear
      // from a phone that never saw a later level set takes nothing off (5.3's two-phone case).
      primary = null;
    }
  }
  // An archived flag is folded as any other, so it stays on the patient until a change clears it.
  final secondary = [
    for (final MapEntry(key: id, value: action) in lastOf.entries)
      if (action == 'set') id,
  ]..sort((a, b) => _byRankNameId(a, flags[a]!, b, flags[b]!));
  return (primary: primary, secondary: secondary);
}

// The change's own time, never later than the server's receipt (4.5), to the millisecond as the
// server's Date holds it, whatever zone it is written in; the id breaks a tie, so every reader folds
// two changes of one instant the same way.
int _byTimeThenId(FlagChangeRef a, FlagChangeRef b) {
  final byTime = a.effectiveAt.millisecondsSinceEpoch.compareTo(b.effectiveAt.millisecondsSinceEpoch);
  return byTime != 0 ? byTime : a.id.compareTo(b.id);
}

// compareTo compares UTF-16 code units, as the server's `<` does, so the phone and the server order
// alike whatever either one's locale.
int _byRankNameId(String a, FlagRef x, String b, FlagRef y) {
  final byRank = x.rank.compareTo(y.rank);
  if (byRank != 0) return byRank;
  final byName = x.name.compareTo(y.name);
  return byName != 0 ? byName : a.compareTo(b);
}
