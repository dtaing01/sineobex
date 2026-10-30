import 'dart:convert';

import 'package:flutter/material.dart';

/// Words for sync states. Patient details never appear in these: field names, counts and times.

/// "data.wound.length_cm" → "Wound length cm". Phase 4 replaces this with the note type's labels.
String fieldLabel(String field) {
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

String categoryLabel(String category) => switch (category) {
  'encounters' => 'Patient encounters',
  'notes' => 'Notes',
  'activity' => 'Activity log',
  _ => category,
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
