/// A patient's current flags (phase 5 design 5.3, 4.5; D135): the phone's copy of
/// packages/presets/src/current-flags.ts, which packages/contract/test-vectors/flag-current.json pins
/// with it. The flags sheet, the profile's pills and the patient list read it offline, with the
/// person's flag rule (P5-phone-domain).
///
/// Written ahead of P5-current-dart, whose code replaces the stub below.
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
CurrentFlags currentFlags({
  required Iterable<FlagChangeRef> changes,
  required Map<String, FlagRef> flags,
  required bool Function(FlagRef flag) hidden,
}) => throw UnimplementedError('P5-current-dart');
