import '../../api/generated/api.dart' show FieldHistoryEntry, MatchReason;
import '../../patients/dob.dart';
import '../../patients/patient_repository.dart' show OnlineProblem;
import '../../sync/entities.dart' show entityAlias, entityAllergy, entityProblem;

/// Words for the patient screens (design 12.1). Fixed strings keyed by code: a patient's details
/// appear only where a screen shows that patient, never in a title, toast or error.

/// The ten living situations of 11.4, in the order the chips show them. The keys are the sync
/// value's `kind` (entities.dart `livingSituations`).
///
/// PLAN-OPEN: living situation options (design 14.1, #2): the ten of 11.4 until the Google Doc
/// Contents tab, which owns option lists, confirms them. The portal's labels.ts holds the same words.
const livingSituationLabels = {
  'unsheltered': 'Unsheltered (street or outdoors)',
  'vehicle': 'Vehicle',
  'emergency_shelter': 'Emergency shelter',
  'transitional_housing': 'Transitional housing',
  'couch_surfing': 'Couch surfing',
  'hotel_motel': 'Hotel or motel (self-paid)',
  'housed': 'Housed',
  'institution': 'In an institution (hospital, jail, treatment)',
  'unknown': 'Unknown',
  'other': 'Other',
};

/// "Other: under the bridge" / "Vehicle".
String livingSituationText(({String kind, String? other})? s) {
  if (s == null) return 'Not recorded';
  final label = livingSituationLabels[s.kind] ?? s.kind;
  final other = s.other?.trim();
  return s.kind == 'other' && other != null && other.isNotEmpty ? '$label: $other' : label;
}

/// Preferred languages, common local ones first (11.1 #9), as BCP 47 tags.
///
/// PLAN-OPEN: which languages lead the list (Brooke and Mercy): Detroit's most common languages
/// after English, then the rest alphabetically; a team setting later.
const languageLabels = {
  'en': 'English',
  'es': 'Spanish',
  'ar': 'Arabic',
  'bn': 'Bengali',
  'asl': 'American Sign Language',
  'fr': 'French',
  'hmn': 'Hmong',
  'ht': 'Haitian Creole',
  'pl': 'Polish',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'sq': 'Albanian',
  'sw': 'Swahili',
  'vi': 'Vietnamese',
  'zh': 'Chinese',
};

String languageText(String? tag) => tag == null ? 'Not recorded' : (languageLabels[tag] ?? tag);

const allergyCategoryLabels = {
  'drug': 'Medicine',
  'food': 'Food',
  'environment': 'Environment',
  'other': 'Other',
  'unknown': 'Not sure',
};

const allergySeverityLabels = {'mild': 'Mild', 'moderate': 'Moderate', 'severe': 'Severe', 'unknown': 'Not sure'};

const problemStatusLabels = {'new': 'New', 'ongoing': 'Ongoing', 'resolved': 'Resolved'};

String problemStatusText(String status) => problemStatusLabels[status] ?? status;

/// Why a card is made (design 10.4), in the order the chips show them. `first_card` is never a chip.
const cardReasonLabels = {
  'lost': 'Lost',
  'damaged': 'Damaged',
  'stolen': 'Stolen',
  'patient_request': 'Patient asked',
  'other': 'Other',
};

const consentDecisionLabels = {
  'given': 'Agreed',
  'unable': 'Unable to consent',
  'acknowledged': 'Took the privacy notice',
  'declined': 'Declined the privacy notice',
  'not_offered': 'Privacy notice not offered',
};

String consentText(String kind, String decision) {
  if (kind == 'privacy_notice' && decision == 'unable') return 'Unable to take the privacy notice';
  return consentDecisionLabels[decision] ?? decision;
}

/// Patient fields in the words of the intake form (11.1). The portal's labels.ts holds the same.
const patientFieldLabels = {
  'preferredName': 'Name they go by',
  'legalName': 'Legal name',
  'birth': 'Date of birth',
  'visualDescriptor': 'What they look like',
  'usualArea': 'Usually found',
  'livingSituation': 'Living situation',
  'preferredLanguage': 'Preferred language',
  'allergyScreen': 'Allergies asked',
  'idCardChoice': 'ID card',
};

/// One line of a chart's history (design 11.7): "Usually found: Elm St underpass → Library steps ·
/// Jordan Lee · Oct 21 · on a phone". A street name removed, or an allergy or problem entered in
/// error, reads with its reason; a problem's status in the problem list's words.
///
/// PLAN-OPEN: "phone, offline" (design 11.7): an entry says when the phone made the change, not
/// whether it had signal, so this says "on a phone" for both, as the portal does.
String historyLine(FieldHistoryEntry e, DateTime today) {
  final String what;
  if (_historyReasons[(e.entity, e.field)] case final label?) {
    final reason = e.value is Map<String, Object?> ? (e.value! as Map<String, Object?>)['reason'] : null;
    what = reason is String && reason.isNotEmpty ? '$label: $reason' : label;
  } else {
    final label = e.entity == entityProblem && e.field == 'status'
        ? 'Problem status'
        : (patientFieldLabels[e.field] ?? e.field);
    what =
        '$label: ${patientValueText(e.field, e.previousValue, today)} → '
        '${patientValueText(e.field, e.value, today)}';
  }
  return [
    what,
    e.changedBy.displayName,
    shortDate(e.recordedAt, today),
    if (e.deviceTime != null) 'on a phone',
  ].join(' · ');
}

/// History entries that are a withdrawal with a reason, by sync entity and field.
const _historyReasons = {
  (entityAlias, 'removal'): 'Street name removed',
  (entityAllergy, 'enteredInError'): 'Allergy entered in error',
  (entityProblem, 'enteredInError'): 'Problem entered in error',
};

/// A patient field's value in words: a review's values, a history entry.
String patientValueText(String field, Object? value, DateTime today) => switch ((field, value)) {
  (_, null || '') => '(blank)',
  // A problem's status, in a chart's history.
  ('status', {'status': final String status}) => problemStatusText(status),
  ('birth', _) => switch (Birth.fromJson(value)) {
    final b? => readBack(b, today),
    null => '(blank)',
  },
  ('legalName', final Map<String, Object?> m) => [m['given'], m['family']].nonNulls.join(' '),
  ('livingSituation', final Map<String, Object?> m) => livingSituationText((
    kind: m['kind'] as String? ?? '',
    other: m['other'] as String?,
  )),
  ('allergyScreen', 'none_known') => 'No known allergies',
  ('allergyScreen', _) => 'Not asked yet',
  ('idCardChoice', 'wants') => 'Wants a card',
  ('idCardChoice', 'declined') => 'Declined a card',
  ('idCardChoice', _) => 'Not asked yet',
  ('preferredLanguage', final String tag) => languageText(tag),
  (_, final String s) => s,
  _ => '$value',
};

// ---- requests that only work online ----

/// Why a "Which is right?" choice wasn't saved (design 3.2), one fixed sentence per reason: what
/// happened and what to do next, never a value and never the server's code.
String reviewProblemText(OnlineProblem problem) => switch (problem) {
  OnlineProblem.offline => 'Saving a choice needs a connection. Try again when the phone is online.',
  OnlineProblem.notAllowed => 'Your role can’t choose between these values. Someone who can edit patient details will.',
  OnlineProblem.signInAgain => 'Sign in again, then save your choice.',
  OnlineProblem.notFound => 'These values aren’t waiting for a choice any more. Open the chart again.',
  OnlineProblem.alreadyDecided => 'Someone has already chosen. Open the chart again to see the value kept.',
  OnlineProblem.fieldChanged => 'The value changed since this was opened. Open the chart again to see it.',
  OnlineProblem.commentRequired => 'A Program Admin chooses a legal name or date of birth, and says why.',
  OnlineProblem.nothingToRecognise =>
    'Keeping that value would leave no name or description to recognise them by. Keep the value on the chart.',
  OnlineProblem.invalid => 'That value is no longer one of the choices. Open the chart again.',
  OnlineProblem.failed => 'The choice couldn’t be saved. Try again.',
};

/// Why a chart's history didn't load (design 11.7). The reasons that belong to a review's decision
/// can't come back from a read; they get the plain "try again".
String historyProblemText(OnlineProblem problem) => switch (problem) {
  OnlineProblem.offline => 'History needs a connection. Try again when the phone is online.',
  OnlineProblem.notAllowed => 'Your role can’t see what changed on this chart.',
  OnlineProblem.signInAgain => 'Sign in again to see what changed.',
  OnlineProblem.notFound => 'The server doesn’t have this chart yet. What changed shows once it has synced.',
  OnlineProblem.alreadyDecided ||
  OnlineProblem.fieldChanged ||
  OnlineProblem.commentRequired ||
  OnlineProblem.nothingToRecognise ||
  OnlineProblem.invalid ||
  OnlineProblem.failed => 'History couldn’t be loaded. Try again.',
};

// ---- dates ----

const _shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// "Oct 3", or "Oct 3, 2025" outside [today]'s year.
String shortDate(DateTime d, DateTime today) {
  final l = d.toLocal();
  final base = '${_shortMonths[l.month - 1]} ${l.day}';
  return l.year == today.year ? base : '$base, ${l.year}';
}

/// "October 3, 2026", for screen readers.
String longDate(DateTime d) {
  final l = d.toLocal();
  return '${monthNames[l.month - 1]} ${l.day}, ${l.year}';
}

/// A `YYYY-MM-DD` date as a [DateTime] at local midnight, or null.
DateTime? isoDay(String? iso) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(iso ?? '');
  return m == null ? null : DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
}

/// "2 hours ago", "yesterday", "3 days ago", "just now".
String ago(DateTime then, DateTime now) {
  final d = now.difference(then);
  if (d.inMinutes < 2) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes} minutes ago';
  if (d.inHours < 24) return d.inHours == 1 ? '1 hour ago' : '${d.inHours} hours ago';
  if (d.inDays == 1) return 'yesterday';
  return '${d.inDays} days ago';
}

/// "1,204".
String count(int n) => n.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

// ---- a result row ----

/// The row form of a birth (design 12.1): "born 1946 · 80" for a date, "born 1946" for a year
/// alone, "about 46" for an estimate; and the same for a screen reader.
({String text, String spoken}) birthRowLabel(Birth birth, DateTime today) => switch (birth) {
  BirthDate(:final year) => (
    text: 'born $year · ${ageOn(birth, today)}',
    spoken: 'born $year, age ${ageOn(birth, today)}',
  ),
  BirthYear(:final year) => (text: 'born $year', spoken: 'born $year'),
  BirthEstimate() => (text: 'about ${ageOn(birth, today)}', spoken: 'about ${ageOn(birth, today)} years old'),
};

/// What a name match was against: as the object of "Close to …", and as a sentence's subject.
const _against = {
  MatchReason.name: (object: 'the name they go by', subject: 'Name they go by'),
  MatchReason.alias: (object: 'a street name', subject: 'Street name'),
  MatchReason.descriptor: (object: 'the description', subject: 'Description'),
};

/// Why a hit or a possible duplicate matched, in words (design 8.1: "Street name matches · Birth
/// date: day and month swapped"), one phrase per name it matched. The reasons never carry the
/// text that matched, and a legal name is never shown on a list (D40): it is "Close to the legal
/// name on a chart you opened".
List<String> matchReasonTexts(List<MatchReason> reasons) {
  final out = <String>[];
  if (reasons.contains(MatchReason.legalName)) out.add('Close to the legal name on a chart you opened');
  for (final MapEntry(key: reason, value: (:object, :subject)) in _against.entries) {
    if (!reasons.contains(reason)) continue;
    out.add(
      reasons.contains(MatchReason.typo)
          ? 'Close to $object'
          : reasons.contains(MatchReason.nickname)
          ? 'A nickname for $object'
          : reasons.contains(MatchReason.soundsLike)
          ? 'Sounds like $object'
          : reasons.contains(MatchReason.initial)
          ? 'Initial of $object'
          : '$subject matches',
    );
  }
  for (final r in reasons) {
    final birth = switch (r) {
      MatchReason.dobExact => 'Same birth date',
      MatchReason.dobSwapped => 'Birth date: day and month swapped',
      MatchReason.dobMonthYear => 'Same birth month and year',
      MatchReason.dobYearSlip => 'Birth date: the year a little off',
      MatchReason.dobYear => 'Same birth year',
      MatchReason.dobEstimate => 'Age close to the estimate',
      _ => null,
    };
    if (birth != null) out.add(birth);
  }
  return out;
}
