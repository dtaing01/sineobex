import 'dart:convert';
import 'dart:io';

/// The test-only note types the phone's sync tests chart on (phase 4 lifecycle 4.4), read from the
/// file the API's tests install in every test team: packages/contract/test-vectors/sync-note-types.json.
/// `test_note` is a Non-Medical note type, so the Medical gate never applies to it; `test_medical` is
/// a Medical one with the same sections. Answers go at the definition's paths: `vitals.temp_c`,
/// `vitals.pulse`, `care.plan`, `care.followup`, `care.allergies`, `care.history`, `wound.site`,
/// `wound.length_cm`, `extra.a` to `extra.g`, and in the repeating section `rows.<entry>.n` and
/// `rows.<entry>.text`.
final List<Map<String, Object?>> testNoteTypes = [
  for (final type
      in (jsonDecode(File('../../packages/contract/test-vectors/sync-note-types.json').readAsStringSync())
              as Map<String, Object?>)['noteTypes']!
          as List<Object?>)
    type! as Map<String, Object?>,
];

/// A note type's key and version, as a note's create names them.
typedef TestNoteType = ({String key, int version});

const TestNoteType testNote = (key: 'test_note', version: 1);
const TestNoteType testMedical = (key: 'test_medical', version: 1);
