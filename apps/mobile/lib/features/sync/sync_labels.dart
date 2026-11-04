import 'dart:convert';

import 'package:flutter/material.dart';

import '../patients/patient_labels.dart' show patientFieldLabels;

/// Words for sync states. Patient details never appear in these: field names, counts and times.

/// "data.wound.length_cm" → "Wound length cm". Phase 4 replaces this with the note type's labels.
/// Patient fields use the intake form's words ("Usually found").
String fieldLabel(String field) {
  final known = patientFieldLabels[field] ?? _recordFieldLabels[field];
  if (known != null) return known;
  final raw = field.startsWith('data.') ? field.substring(5) : field;
  final words = raw
      .replaceAll('.', ' ')
      .replaceAll('_', ' ')
      .replaceAllMapped(RegExp('([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}');
  final lower = words.toLowerCase().trim();
  return lower.isEmpty ? field : lower[0].toUpperCase() + lower.substring(1);
}

/// A field value as text, for the side-by-side view.
String valueText(Object? value) => switch (value) {
  null || '' => '(blank)',
  String() => value,
  num() || bool() => '$value',
  _ => const JsonEncoder.withIndent('  ').convert(value),
};

const _recordFieldLabels = {'status': 'Status', 'removal': 'Removed', 'enteredInError': 'Entered in error'};

String categoryLabel(String category) => switch (category) {
  'encounters' => 'Patient encounters',
  'notes' => 'Notes',
  // Phase 3 (design 2.1): a patient's details, street names, allergies, consents and ID cards;
  // problems and their notes.
  'patients' => 'Patients',
  'problems' => 'Problems',
  'activity' => 'Activity log',
  _ => category,
};

/// What kind of record a change is, as a heading: "Street name", "ID card".
String entityLabel(String entity) => switch (entity) {
  'encounter' => 'An encounter',
  'encounter_note' => 'A note',
  'patient' => 'Patient details',
  'patient_alias' => 'Street name',
  'patient_allergy' => 'Allergy',
  'patient_consent' => 'Consent decision',
  'problem' => 'Problem',
  'problem_note' => 'Problem note',
  'id_link' => 'ID card',
  _ => 'A record',
};

/// The words for a refusal's `details.problem` (design 2.6), or null for one without its own.
String? problemLabel(String? problem) => switch (problem) {
  'nothing_to_recognise' => 'This person needs a name or a description. Add one, then it sends again.',
  'birth_in_future' => 'The date of birth is in the future. Check it with them.',
  'living_other_text' => 'An “Other” living situation needs a few words.',
  'too_many_aliases' => 'A person can have up to 20 street names. Remove one first.',
  'too_many_allergies' => 'A person can have up to 30 allergies listed.',
  'allergy_listed' => 'An allergy is listed, so “No known allergies” can’t be saved.',
  'not_resolved' => 'The problem this asks about isn’t Resolved any more.',
  'identity_admin_only' => 'A recorded legal name or birth date is corrected by a Program Admin.',
  'resolved_needs_admin' => 'Only a Program Admin moves a problem out of Resolved.',
  'status_backwards' => 'A problem’s status doesn’t go back.',
  'record_exists' => 'A record with this ID is already on the server.',
  'server_constraint' =>
    'This entry has a problem the app can’t explain. Edit it and send it again; your team’s admin has been told.',
  'token_taken' => 'This card’s code was already in use. Make a new card.',
  'patient_missing' => 'The patient this belongs to isn’t on the team’s list.',
  'problem_missing' => 'The problem this belongs to isn’t on the team’s list.',
  'encounter_missing' => 'The visit this names isn’t on the team’s list.',
  'record_missing' => 'The record this changes isn’t on the team’s list.',
  'patient_merged' => 'This chart was merged. Make a new card from the kept chart.',
  _ => null,
};

/// A notice that needs no fix (design 12.1, Needs attention): kind and field only, never a value.
String noticeLabel(String kind, String? field) => switch (kind) {
  'kept_both' =>
    'Two values recorded for ${field == null ? 'a field' : fieldLabel(field)}. Someone who knows this person will choose.',
  'nothing_to_recognise' => 'Kept the name: this person would have had no name or description left.',
  'possible_duplicate' => 'A reviewer will check whether this person already has a chart.',
  'problem_retracted' => 'Your note was saved on a problem someone marked entered in error.',
  'id_link_superseded' =>
    'Another new card was made after yours. That card is the valid one; yours won’t open the chart.',
  'id_link_kept' => 'Another new card was made for the same patient at about the same time. Yours is the valid one.',
  'id_link_conflict' => 'Two new cards were made for one patient. The newer one is the valid one.',
  'problem_reversal_decided' => 'A Program Admin answered your request about a problem marked Resolved by mistake.',
  _ => 'Something changed after it synced.',
};

String reasonLabel(String? reason) => switch (reason) {
  'validation' => 'Something in it needs fixing',
  'stale_reference' => 'The record it belongs to has changed',
  'record_locked' => 'The note was signed',
  'signing_rule' => 'Needs a co-signer',
  'permission' => 'Sent to a Program Admin',
  _ => 'Not accepted',
};

String timeOfDay(BuildContext context, DateTime t) =>
    MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(t.toLocal()));

String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';

/// Another team's unsynced work on this phone (null: a database that couldn't be read).
String elsewhereText(int? n) => n == null
    ? 'Records from another team are on this phone and couldn’t be checked. They stay until they sync.'
    : '${plural(n, 'change')} for another team ${n == 1 ? 'is' : 'are'} waiting on this phone. '
          '${n == 1 ? 'It syncs' : 'They sync'} when you work in that team.';

/// "7 minutes behind" / "3 minutes ahead".
String offsetText(Duration offset) {
  final minutes = offset.inMinutes.abs();
  final amount = minutes >= 1 ? plural(minutes, 'minute') : plural(offset.inSeconds.abs(), 'second');
  // offset = server time minus phone time: positive means the phone is behind.
  return offset.isNegative ? '$amount ahead of' : '$amount behind';
}
