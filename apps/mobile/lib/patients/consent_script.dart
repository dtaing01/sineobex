/// What a worker reads aloud at intake, and how the answers are recorded (design 11.2).
///
/// What the person agrees to: that this team keeps a record of their visits, used by the team and
/// the health partners it works with to care for them. Not treatment (each encounter is its own
/// act), not photos (phase 8 asks separately), not research or sharing beyond care. The same step
/// offers the team's Notice of Privacy Practices and records the good-faith acknowledgement attempt
/// (HIPAA §164.520(c)(2)(ii)).
///
/// Recorded in the patient create as two consent records: `care_and_record` (given, or unable with
/// a reason; the chart is created either way) and `privacy_notice` (never blocking). Who and when
/// come from the change entry; [consentScriptVersion] and the language say what was read.
///
/// PLAN-OPEN: the consent wording, whether verbal consent suffices, minors, and what a later
/// withdrawal means (design 14.1, #3; counsel, Brooke and Mercy).
library;

import '../sync/local_store.dart' show LocalValidationError;
import 'dob.dart';

/// The version of the script below. A new wording is a new version, so a record always says what
/// was read.
const consentScriptVersion = '2026-10-1';

/// The script, short enough to read aloud in 15 seconds.
class ConsentScript {
  const ConsentScript({required this.language, required this.text, required this.translated});

  /// The BCP 47 tag of [text], as it is recorded.
  final String language;
  final String text;

  /// False when the person's language had no translation and English is shown instead (§1557: the
  /// screen then says so, so the worker can get an interpreter).
  final bool translated;
}

const _english =
    'We keep a record of your visits so our team can take care of you. Only our team and the clinics we '
    'work with see it. Is that OK? We also have a paper about your privacy rights. Would you like it?';

/// Translations by language tag. English only until the §1557 translation table has reviewed text
/// (PLAN-OPEN with the consent wording above).
const _scripts = {'en': _english};

/// The script in [language] when a translation exists, else English with [ConsentScript.translated]
/// false.
ConsentScript consentScriptFor(String? language) {
  final base = language?.split('-').first.toLowerCase();
  final text = base == null ? null : _scripts[base];
  return text == null
      ? const ConsentScript(language: 'en', text: _english, translated: false)
      : ConsentScript(language: base!, text: text, translated: language != null);
}

/// Why someone couldn't consent now (11.2), as chips. The label is what is recorded as the reason;
/// [ConsentAnswer.unable] also takes the worker's own words.
enum UnableReason {
  unconscious('Unconscious or not responding'),
  intoxicated('Intoxicated'),
  crisis('In crisis'),
  language('Language: no interpreter available');

  const UnableReason(this.label);
  final String label;
}

/// The answer to "Is that OK?".
sealed class ConsentAnswer {
  const ConsentAnswer();

  /// Agrees, verbally (the default) or in writing.
  const factory ConsentAnswer.given({String method}) = ConsentGiven;

  /// Can't consent now; the chart is created with a banner until consent is recorded.
  const factory ConsentAnswer.unable(String reason) = ConsentUnable;
}

final class ConsentGiven extends ConsentAnswer {
  const ConsentGiven({this.method = 'verbal'});

  /// `verbal` or `written`.
  final String method;
}

final class ConsentUnable extends ConsentAnswer {
  const ConsentUnable(this.reason);
  final String reason;
}

/// What happened when the privacy notice was offered. Recorded, never blocking.
enum PrivacyNoticeDecision { acknowledged, declined, unable, notOffered }

String _noticeWire(PrivacyNoticeDecision d) => switch (d) {
  PrivacyNoticeDecision.acknowledged => 'acknowledged',
  PrivacyNoticeDecision.declined => 'declined',
  PrivacyNoticeDecision.unable => 'unable',
  PrivacyNoticeDecision.notOffered => 'not_offered',
};

/// A reason as the sync value takes it: trimmed, 3 to 300 characters.
String _reason(String reason) {
  final r = reason.trim();
  if (r.length < 3 || r.length > 300) {
    throw const LocalValidationError('Give a short reason (3 to 300 characters).', paths: {'reason'});
  }
  return r;
}

/// The patient create's `consent` value.
Map<String, Object?> registrationConsent(String id, ConsentAnswer answer, {required String language}) =>
    switch (answer) {
      ConsentGiven(:final method) => {
        'id': id,
        'decision': 'given',
        'method': method,
        'scriptVersion': consentScriptVersion,
        'language': language,
      },
      ConsentUnable(:final reason) => {
        'id': id,
        'decision': 'unable',
        'method': 'not_applicable',
        'reason': _reason(reason),
        'scriptVersion': consentScriptVersion,
        'language': language,
      },
    };

/// The patient create's `privacyNotice` value. [reason] is required for unable and not offered.
Map<String, Object?> privacyNotice(String id, PrivacyNoticeDecision decision, {String? reason}) => {
  'id': id,
  'decision': _noticeWire(decision),
  if (decision == PrivacyNoticeDecision.unable || decision == PrivacyNoticeDecision.notOffered)
    'reason': _reason(reason ?? ''),
};

/// A later `patient_consent` create for care and record (**Record consent now** on the profile).
Map<String, Object?> laterConsent(String patientId, ConsentAnswer answer, {required String language}) => {
  'patientId': patientId,
  'kind': 'care_and_record',
  ...registrationConsent('', answer, language: language)..remove('id'),
};

/// A later `patient_consent` create for the privacy notice.
Map<String, Object?> laterPrivacyNotice(
  String patientId,
  PrivacyNoticeDecision decision, {
  required String language,
  String? reason,
}) => {
  'patientId': patientId,
  'kind': 'privacy_notice',
  'decision': _noticeWire(decision),
  'method': decision == PrivacyNoticeDecision.acknowledged ? 'verbal' : 'not_applicable',
  'scriptVersion': consentScriptVersion,
  'language': language,
  if (decision == PrivacyNoticeDecision.unable || decision == PrivacyNoticeDecision.notOffered)
    'reason': _reason(reason ?? ''),
};

/// Under 18 on [today]: the intake shows the team's minor-consent guidance (PLAN-OPEN above).
bool isMinor(Birth? birth, DateTime today) => birth != null && ageOn(birth, today) < 18;
