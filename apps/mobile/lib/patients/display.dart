/// How a patient's allergies and birth read on the phone (design 12.1), one rule for the profile
/// header, the index row and search results. State is never colour alone: each badge kind has words,
/// and every text has a spoken form for its semantics label.
library;

import 'dob.dart';

/// An active allergy as the badge needs it. [severity] is the sync value (`mild`, `moderate`,
/// `severe`, `unknown`) or null.
typedef BadgeAllergy = ({String substance, String? severity});

enum AllergyBadgeKind {
  /// At least one active allergy.
  allergies,

  /// Asked, and none known.
  noneKnown,

  /// Not asked yet, or nothing recorded.
  notAsked,
}

class AllergyBadge {
  const AllergyBadge(this.kind, this.allergies);
  final AllergyBadgeKind kind;

  /// Severe first, then the rest, each in the order given.
  final List<BadgeAllergy> allergies;

  /// "Allergies: penicillin (severe), peanuts" / "No known allergies" / "Allergies not asked yet".
  String get text => switch (kind) {
    AllergyBadgeKind.allergies =>
      '${_label()}: ${allergies.map((a) => _severe(a) ? '${a.substance} (severe)' : a.substance).join(', ')}',
    AllergyBadgeKind.noneKnown => 'No known allergies',
    AllergyBadgeKind.notAsked => 'Allergies not asked yet',
  };

  /// The same for a screen reader, without brackets: "Allergies: penicillin, severe; peanuts".
  String get spoken => switch (kind) {
    AllergyBadgeKind.allergies =>
      '${_label()}: ${allergies.map((a) => _severe(a) ? '${a.substance}, severe' : a.substance).join('; ')}',
    _ => text,
  };

  String _label() => allergies.length == 1 ? 'Allergy' : 'Allergies';
}

bool _severe(BadgeAllergy a) => a.severity == 'severe';

/// The allergy badge: [active] (the group's allergies not entered in error) come first, whatever
/// [screen] (`allergyScreen`: `not_asked`, `none_known`, or null) says, so a pending or late-arriving
/// allergy is never hidden behind "No known allergies" (review finding 16). Allergies are never
/// merged by text: "PCN" and "penicillin" both show. Only severe ones say how bad: the profile's
/// Allergies section gives every severity and reaction.
AllergyBadge allergyBadge(Iterable<BadgeAllergy> active, {required String? screen}) {
  final list = active.toList();
  if (list.isNotEmpty) {
    return AllergyBadge(AllergyBadgeKind.allergies, [...list.where(_severe), ...list.where((a) => !_severe(a))]);
  }
  return AllergyBadge(screen == 'none_known' ? AllergyBadgeKind.noneKnown : AllergyBadgeKind.notAsked, const []);
}

/// Age and birth as recorded, for the profile header: "80 · born Mar 7, 1946", "born 1946",
/// "about 46". A year alone gives no age (it could be off by one), and an estimate is only an age.
({String text, String spoken}) birthLabel(Birth birth, DateTime today) => switch (birth) {
  BirthDate(:final year, :final month, :final day) => (
    text: '${ageOn(birth, today)} · born ${monthNames[month - 1].substring(0, 3)} $day, $year',
    spoken: 'age ${ageOn(birth, today)}, born ${monthNames[month - 1]} $day, $year',
  ),
  BirthYear(:final year) => (text: 'born $year', spoken: 'born $year'),
  BirthEstimate() => (text: 'about ${ageOn(birth, today)}', spoken: 'about ${ageOn(birth, today)} years old'),
};
