// Which row of docs/decisions-for-review.md each older PLAN-OPEN marker belongs to, from before a
// marker named its row: for each file, [row, words] or [row, words, count]. decisions-check.mjs
// gives a marker without a row id to the rule of its file that holds its words, what it says from
// "PLAN-OPEN" to the next marker cut at a word within 60 characters; the count, 1 unless given, is
// how many markers of the file say them (a constant marked on every line says the same). So a rule
// takes only the markers it was written for: one written later, or an older one reworded, names
// its row. The list only shrinks: a marker that names its row, changes or goes leaves its rule,
// which is lowered or deleted. Each file is its whole path, so that lint finds one given twice.
export const RULES = {
  'apps/mobile/android/app/build.gradle.kts': [
    ['TM-2', 'PLAN-OPEN: the public app name is not decided; the ID stays'],
  ],
  'apps/mobile/lib/design/widgets/private_box.dart': [
    ['PL-2', "PLAN-OPEN: what may a private box's selection menu do with"],
  ],
  'apps/mobile/lib/encounters/close_sweep.dart': [
    ['TM-6', 'PLAN-OPEN: how long does an untouched draft stay on its'],
  ],
  'apps/mobile/lib/encounters/complete.dart': [
    ['CO-4', 'PLAN-OPEN: the wording a signer is shown (lifecycle 12.1'],
    ['CO-4', 'PLAN-OPEN: what is a person shown when they complete a note'],
  ],
  'apps/mobile/lib/encounters/encounter_api.dart': [
    ['CO-4', 'PLAN-OPEN: the wording a signer, a co-signer and an attester'],
  ],
  'apps/mobile/lib/encounters/encounter_repository.dart': [
    ['BM-11', 'PLAN-OPEN: can a Medical note be written for someone who is'],
    ['CO-9', 'PLAN-OPEN: is the GPS position stored, and how exact'],
    ['BM-10', 'PLAN-OPEN: may a note be added to a visit whose other notes'],
    ['BM-19', 'PLAN-OPEN 12.1 #16, `problemListStatus`); null when nothing'],
  ],
  'apps/mobile/lib/encounters/expand_quick.dart': [
    ['BM-57', 'PLAN-OPEN: what Expand does when the visit already has a'],
  ],
  'apps/mobile/lib/encounters/note_actions.dart': [
    ['BM-12', 'PLAN-OPEN: how is a wrong free-text assessment fixed after'],
    ['CO-5', "PLAN-OPEN: what does a patient's amendment request need"],
    ['CO-4', 'PLAN-OPEN: does a correction record the wording its'],
  ],
  'apps/mobile/lib/encounters/refusal_fixes.dart': [
    ['BM-17', 'PLAN-OPEN: what does Remove this note keep of a note the'],
  ],
  'apps/mobile/lib/encounters/rules.dart': [
    ['BM-5', 'PLAN-OPEN: is a Social needs or Outreach note inside a'],
    ['BM-8', 'PLAN-OPEN: can a co-signer send a note back to its author'],
    ['BM-7', "PLAN-OPEN: may a resident, NP or PA co-sign a student's"],
  ],
  'apps/mobile/lib/features/encounters/handoff_screen.dart': [
    ['BM-18', 'PLAN-OPEN: should any of it reach EMS: a behavioral health,'],
    ['BM-60', 'PLAN-OPEN 10.1 #51 answered yes for this action).'],
  ],
  'apps/mobile/lib/features/encounters/location_field.dart': [
    ['CO-9', 'PLAN-OPEN: is the GPS position stored, and how exact'],
    ['CO-9', "PLAN-OPEN: may Use my location ask Google's location"],
  ],
  'apps/mobile/lib/features/encounters/start_sheet.dart': [['BM-29', 'PLAN-OPEN 12.1 #14.']],
  'apps/mobile/lib/features/forms/action_field.dart': [
    ['BM-60', 'PLAN-OPEN: whether a finished note offers its actions (forms'],
  ],
  'apps/mobile/lib/features/forms/choice_field.dart': [
    ['TM-16', 'PLAN-OPEN: how a choose-one answer is cleared (forms 10.1'],
  ],
  'apps/mobile/lib/features/forms/date_field.dart': [
    ['TM-18', "PLAN-OPEN: how far a note's date picker reaches (forms 10.1"],
    ['TM-18', 'PLAN-OPEN: how a date is typed (forms 10.1 #54). Three'],
  ],
  'apps/mobile/lib/features/forms/field_host.dart': [
    ['TM-17', 'PLAN-OPEN: whether a conflict names the person who made the'],
  ],
  'apps/mobile/lib/features/forms/grid_field.dart': [
    ['BM-45', 'PLAN-OPEN: whether a collapsed group or grid opens by itself'],
  ],
  'apps/mobile/lib/features/forms/group_field.dart': [
    ['BM-45', 'PLAN-OPEN: whether a collapsed group or grid opens by itself'],
  ],
  'apps/mobile/lib/features/forms/note_form.dart': [
    ['TM-15', 'PLAN-OPEN: which section a form opens at (forms 10.1 #47).'],
    ['BM-61', 'PLAN-OPEN: whether a section that `needs` a capability is'],
    ['BM-45', 'PLAN-OPEN: whether a collapsed group or grid opens by itself'],
    ['TM-15', 'PLAN-OPEN: how much of a long recap a closed header shows'],
  ],
  'apps/mobile/lib/features/forms/number_field.dart': [
    ['BM-41', 'PLAN-OPEN: which unit a field with a second one opens in'],
    ['TM-14', "PLAN-OPEN: when a stepper's count is saved (forms 10.1 #45):"],
  ],
  'apps/mobile/lib/features/forms/problem_field.dart': [
    ['BM-20', "PLAN-OPEN: a diagnosis not on the phone's list (forms 10.1"],
  ],
  'apps/mobile/lib/features/forms/region_field.dart': [
    ['TM-12', 'PLAN-OPEN: how the body map is drawn (forms 10.1 #3). Until'],
  ],
  'apps/mobile/lib/features/forms/text_field.dart': [
    ['TM-14', 'PLAN-OPEN: how long a pause in typing saves a typed answer'],
  ],
  'apps/mobile/lib/features/patients/intake_screen.dart': [
    ['CO-7', 'PLAN-OPEN: the privacy notice answer an intake starts from'],
    ['CO-6', "PLAN-OPEN: minors' consent (design 14.1, #1; counsel): the"],
  ],
  'apps/mobile/lib/features/patients/patient_labels.dart': [
    ['BM-22', 'PLAN-OPEN: living situation options (design 14.1, #2): the'],
    ['BM-24', 'PLAN-OPEN: which languages lead the list (Brooke and Mercy):'],
    ['TM-33', 'PLAN-OPEN: "phone, offline" (design 11.7): an entry says'],
  ],
  'apps/mobile/lib/forms/definition.dart': [
    ['TM-18', "PLAN-OPEN: how are a referral's date and a problem's onset"],
  ],
  'apps/mobile/lib/forms/expand.dart': [
    ['BM-58', 'PLAN-OPEN: what Expand does with such a draft (forms.md 10.1'],
  ],
  'apps/mobile/lib/forms/forms_api.dart': [
    ['TM-11', 'PLAN-OPEN (forms 10.1 #33): what the phone does with a list'],
  ],
  'apps/mobile/lib/forms/handoff.dart': [
    ['BM-18', 'PLAN-OPEN: the content of the summary (forms.md 10.1 #6).'],
    ['BM-18', 'PLAN-OPEN (forms.md 10.1 #6): whether a sensitive diagnosis'],
  ],
  'apps/mobile/lib/forms/read_model.dart': [['BM-59', 'PLAN-OPEN: what the visit read shows of an answer a']],
  'apps/mobile/lib/patients/access.dart': [
    ['TM-24', 'PLAN-OPEN: a way for a team to keep the index off a field'],
  ],
  'apps/mobile/lib/patients/consent_script.dart': [
    ['CO-6', 'PLAN-OPEN: the consent wording, whether verbal consent'],
    ['BM-25', 'PLAN-OPEN with the consent wording above).'],
    ['CO-6', 'PLAN-OPEN above).'],
  ],
  'apps/mobile/lib/patients/dob.dart': [
    ['BM-27', 'PLAN-OPEN: day-month order (design 14.1, #20): month first'],
    ['BM-27', 'PLAN-OPEN: the range that asks for confirmation (design'],
  ],
  'apps/mobile/lib/patients/generated/nicknames.dart': [
    ['BM-26', 'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the'],
  ],
  'apps/mobile/lib/patients/generated/sensitive_codes.dart': [
    ['CO-2', 'PLAN-OPEN: which codes are sensitive (phase 3 design 14.1,'],
  ],
  'apps/mobile/lib/patients/match_constants.dart': [
    ['BM-26', 'PLAN-OPEN: tune on pilot data (module 2)', 33],
  ],
  'apps/mobile/lib/patients/problems.dart': [
    ['BM-19', "PLAN-OPEN: how a note's four statuses map to the list's"],
    ['BM-21', 'PLAN-OPEN: the list (design 14.1, Brooke and Mercy), and a'],
  ],
  'apps/mobile/lib/patients/team_index.dart': [
    ['TM-30', 'PLAN-OPEN: index timing and lifetime (design 14.1, #22):'],
  ],
  'apps/mobile/lib/security/secure_copy.dart': [
    ['PL-2', "PLAN-OPEN: Android's clipboard rule (design 14.3, #17). The"],
  ],
  'apps/mobile/lib/sync/entities.dart': [
    ['BM-22', 'PLAN-OPEN: living situation options (design 14.1, #2): the'],
    ['CO-8', 'PLAN-OPEN: search terms in the audit log (design 14.1, #9,'],
  ],
  'apps/mobile/lib/sync/local_store.dart': [
    ['TM-7', 'PLAN-OPEN: how far ahead may a referral be dated while the'],
  ],
  'apps/mobile/pubspec.yaml': [['CO-9', "PLAN-OPEN: may Use my location ask Google's location service"]],
  'apps/mobile/test/encounters/problem_list_test.dart': [
    ['BM-19', 'PLAN-OPEN 12.1 #16), asking phase 3\'s "same problem coming'],
  ],
  'apps/mobile/test/encounters/start_test.dart': [
    ['BM-10', 'PLAN-OPEN 12.1 #3: a note may be added to a visit whose'],
  ],
  'apps/portal/src/app/(app)/patients/format.ts': [
    ['TM-33', 'PLAN-OPEN: "phone, offline" (design 11.7). A history entry'],
  ],
  'apps/portal/src/app/(app)/team/duplicates/[pairId]/DecisionForm.tsx': [
    ['TM-27', 'PLAN-OPEN: merge survivor default (design 14.1, #26): the'],
  ],
  'apps/portal/src/app/(app)/team/merges/UndoMerge.tsx': [
    ['TM-26', 'PLAN-OPEN: cards at undo (design 14.1, #16): a card made'],
  ],
  'apps/portal/src/app/(app)/team/problem-reversals/ReversalDecision.tsx': [
    ['TM-26', 'PLAN-OPEN: undo limits (design 14.1, #15): no undo for a'],
  ],
  'apps/portal/src/app/acknowledge/page.tsx': [
    ['CO-11', 'PLAN-OPEN: final wording comes from counsel ("Draft Terms of'],
  ],
  'apps/portal/src/app/c/page.tsx': [['BM-25', 'PLAN-OPEN: the languages patient-facing text is translated']],
  'apps/portal/src/lib/auth/index.ts': [
    ['BF-1', 'PLAN-OPEN (phase 12): Cognito hosted UI with authorization'],
  ],
  'apps/portal/src/lib/dob.ts': [
    ['BM-27', 'PLAN-OPEN: the DOB range that asks for confirmation (design'],
    ['BM-27', 'PLAN-OPEN: day-month order in typed dates (design 14.1,'],
  ],
  'apps/portal/src/lib/labels.ts': [['BM-22', 'PLAN-OPEN: living situation options (design 14.1, #2): the']],
  'apps/portal/src/lib/sign.ts': [['CO-4', 'PLAN-OPEN: the wording a signer, a co-signer and an attester']],
  'packages/contract/scripts/gen-patient-data.ts': [
    ['BM-21', 'PLAN-OPEN: the problem code list (phase 3 design 14.1, #5),'],
    ['BM-26', 'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the'],
    ['CO-2', 'PLAN-OPEN: which codes are sensitive (phase 3 design 14.1,'],
  ],
  'packages/forms/src/interp/expand.ts': [
    ['BM-58', 'PLAN-OPEN: what Expand does with such a draft (forms.md 10.1'],
  ],
  'packages/forms/src/interp/handoff.ts': [
    ['BM-18', 'PLAN-OPEN: the content of the summary (forms.md 10.1 #6).'],
    ['BM-18', 'PLAN-OPEN (forms.md 10.1 #6): whether a sensitive diagnosis'],
  ],
  'packages/forms/src/interp/read-model.ts': [
    ['BM-59', 'PLAN-OPEN: what the visit read shows of an answer a'],
  ],
  'services/api/src/auth/acknowledgements.ts': [
    ['CO-11', 'PLAN-OPEN: the texts are drafted by counsel ("Draft Terms of'],
  ],
  'services/api/src/auth/permissions.ts': [
    ['TM-24', 'PLAN-OPEN: a way for a team to keep the index off a field'],
    ['BM-2', 'PLAN-OPEN: the PA rule is "to confirm". Treated like NP'],
    ['BM-1', 'PLAN-OPEN: proposed in the Oct 19 decisions, pending Brooke'],
  ],
  'services/api/src/config.ts': [['TM-1', 'PLAN-OPEN: the ID link host (phase 3 design 14.1, #7),']],
  'services/api/src/encounters/assign.ts': [
    ['BM-9', 'PLAN-OPEN 12.1 #7).'],
    ['BM-4', 'PLAN-OPEN: a note that holds a sensitive exam, a treatment'],
  ],
  'services/api/src/encounters/handoff.ts': [
    ['TM-3', 'PLAN-OPEN: where does the EMS handoff PDF come from'],
    ['BM-18', "PLAN-OPEN: what of the patient does the handoff's header"],
    ['BM-18', 'PLAN-OPEN: should any of it reach EMS: a behavioral health,'],
    ['TM-3', 'PLAN-OPEN: who may export the EMS handoff as a PDF'],
    ['TM-4', "PLAN-OPEN: the time zone of the handoff's times (lifecycle"],
  ],
  'services/api/src/encounters/rules.ts': [
    ['BM-5', 'PLAN-OPEN: is a Social needs or Outreach note inside a'],
    ['BM-8', 'PLAN-OPEN: can a co-signer send a note back to its author'],
    ['BM-7', "PLAN-OPEN: may a resident, NP or PA co-sign a student's"],
  ],
  'services/api/src/encounters/signed-under.ts': [
    ['CO-3', 'PLAN-OPEN: does a note signed offline count as signed at'],
    ['CO-3', 'PLAN-OPEN: which credential is a signature recorded under'],
  ],
  'services/api/src/encounters/timeline.ts': [
    ['TM-5', 'PLAN-OPEN: how many recent visits ride with a chart, to be'],
  ],
  'services/api/src/patients/duplicates.ts': [
    ['TM-23', 'PLAN-OPEN: how long after its device time an intake may'],
    ['TM-25', 'PLAN-OPEN: only a reviewer should re-open a pair kept'],
  ],
  'services/api/src/patients/generated/nicknames.ts': [
    ['BM-26', 'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the'],
  ],
  'services/api/src/patients/generated/sensitive-codes.ts': [
    ['CO-2', 'PLAN-OPEN: which codes are sensitive (phase 3 design 14.1,'],
  ],
  'services/api/src/patients/id-links.ts': [
    ['TM-22', 'PLAN-OPEN: whether an unverified clock should lose a'],
  ],
  'services/api/src/patients/problems-admin.ts': [
    ['TM-26', 'PLAN-OPEN: no undo for a problem merge in phase 3 (design'],
  ],
  'services/api/src/patients/projection.ts': [
    ['TM-4', 'PLAN-OPEN: dates (age, last seen) are taken in UTC; a team'],
  ],
  'services/api/src/patients/search.ts': [
    ['CO-8', 'PLAN-OPEN: search terms in the audit log (design 14.1, #9,'],
  ],
  'services/api/src/patients/team-index.ts': [
    ['TM-30', 'PLAN-OPEN: index timing and lifetime (design 14.1, #22):'],
  ],
  'services/api/src/patients/match-constants.ts': [['BM-26', 'PLAN-OPEN: tune on pilot data (module 2)', 33]],
  'services/api/src/services/memberships.ts': [
    ['TM-21', 'PLAN-OPEN: "What happens when a team\'s only admin is'],
  ],
  'services/api/src/sync/apply.ts': [['TM-10', 'PLAN-OPEN: does the review queue name the rule that held a']],
  'services/api/src/sync/entities/encounter.ts': [
    ['BM-14', 'PLAN-OPEN: where do the records made at a visit go when the'],
  ],
  'services/api/src/sync/entities/note-correction.ts': [
    ['CO-4', 'PLAN-OPEN: does a correction record the wording its'],
  ],
  'services/api/src/sync/entities/patient.ts': [
    ['CO-6', 'PLAN-OPEN: consent wording and method (design 14.1, #1). The'],
  ],
  'services/api/src/sync/entities/values.ts': [
    ['BM-22', 'PLAN-OPEN: living situation options (design 14.1, #2): the'],
    ['CO-6', 'PLAN-OPEN: consent wording, whether verbal suffices, minors'],
    ['CO-4', 'PLAN-OPEN: what is a person shown when they complete a note'],
    ['CO-8', 'PLAN-OPEN: search terms in the audit log (design 14.1, #9,'],
  ],
  'services/api/src/sync/records.ts': [
    ['BM-16', 'PLAN-OPEN: what happens to an addendum or a correction whose'],
  ],
  'services/api/src/sync/review.ts': [['TM-8', "PLAN-OPEN: may a Program Admin's accept put a held change"]],
  'services/api/test/encounters-assign.test.ts': [['BM-9', 'PLAN-OPEN 12.1 #7)']],
  'services/api/test/encounters-cosign.test.ts': [
    ['BM-4', 'PLAN-OPEN 12.1 #13): the note waits for Vic.'],
    ['BM-7', 'PLAN-OPEN 12.1 #6)'],
  ],
  'services/api/test/encounters-fixtures.ts': [['BM-7', 'PLAN-OPEN 12.1 #6).']],
  'services/api/test/encounters-handoff.test.ts': [
    ['TM-3', 'PLAN-OPEN 12.1 #12 and #18): the EMS handoff as a PDF, built'],
    ['BM-18', 'PLAN-OPEN for the clinical team and counsel).'],
  ],
  'services/api/test/encounters-queues.test.ts': [
    ['BM-4', "PLAN-OPEN 12.1 #13), and wrote the middle visit's notes."],
    ['BM-7', 'PLAN-OPEN 12.1 #6) and sees what Ana sees.'],
  ],
  'services/api/test/encounters-timeline.test.ts': [
    ['TM-5', "PLAN-OPEN 12.1 #17), which it reads offline; the portal's"],
  ],
  'packages/forms/definitions/spec/exam-breast.diff.json': [
    ['BM-38', 'PLAN-OPEN (forms 10.1 #1): Exam performed gates the findings'],
    ['BM-51', 'PLAN-OPEN (forms 10.1 #1): one mass per exam, no side for'],
    ['BM-37', 'PLAN-OPEN (forms 10.1 #23): the clinical team confirms which'],
  ],
  'packages/forms/definitions/spec/exam-cv-perfusion.diff.json': [
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1): which sites are routine, for the'],
  ],
  'packages/forms/definitions/spec/exam-cv-rhythm.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #23): the clinical team confirms which'],
  ],
  'packages/forms/definitions/spec/exam-foot.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #23): the clinical team confirms which'],
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): Warm is kept with Asymmetric'],
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1, #29): a departure from'],
    ['BM-48', 'PLAN-OPEN (forms 10.1 #1): a side for these findings, for'],
  ],
  'packages/forms/definitions/spec/exam-general-appearance.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): the pairs beyond the distress'],
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): the pairs beyond Cooperative and'],
  ],
  'packages/forms/definitions/spec/exam-gu.diff.json': [
    ['BM-38', 'PLAN-OPEN (forms 10.1 #1): default 35 asks whether Exam'],
  ],
  'packages/forms/definitions/spec/exam-heent-ears.diff.json': [
    ['BM-48', 'PLAN-OPEN (forms 10.1 #1): the inventory asks the clinical'],
  ],
  'packages/forms/definitions/spec/exam-heent-eyes.diff.json': [['BM-37', 'PLAN-OPEN (forms 10.1 #23)']],
  'packages/forms/definitions/spec/exam-heent-mouth.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #23): the clinical team confirms which'],
  ],
  'packages/forms/definitions/spec/exam-lymphatic.diff.json': [
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1): Normal does nothing in Lymphatic'],
    ['BM-50', 'PLAN-OPEN (forms 10.1 #1): Size shown once the row has a'],
  ],
  'packages/forms/definitions/spec/exam-msk.diff.json': [
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the most regions in one exam (the'],
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1): Normal does nothing in an entry'],
    ['BM-49', 'PLAN-OPEN (forms 10.1 #1): does a wound found in the MSK'],
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1): is Isotonic the tone Normal'],
  ],
  'packages/forms/definitions/spec/exam-neck.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #23): the clinical team confirms which'],
  ],
  'packages/forms/definitions/spec/exam-neuro-1.diff.json': [
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): the pairs among Alert, Somnolent'],
    ['BM-48', 'PLAN-OPEN (forms 10.1 #1): a side for these findings, for'],
  ],
  'packages/forms/definitions/spec/exam-neuro-2.diff.json': [
    ['BM-48', 'PLAN-OPEN (forms 10.1 #1): the side of a sensory finding is'],
    ['BM-47', 'PLAN-OPEN (forms 10.1 #27): the regions of the list, before'],
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): Abnormal beside both normal'],
  ],
  'packages/forms/definitions/spec/exam-peripheral-vascular.diff.json': [
    ['BM-36', 'PLAN-OPEN (forms 10.1 #1): which sites are routine, for the'],
    ['BM-37', 'PLAN-OPEN (forms 10.1 #1): Warm is kept with Edema and the'],
    ['BM-52', 'PLAN-OPEN (forms 10.1 #1): a refill time is charted only'],
    ['BM-48', 'PLAN-OPEN (forms 10.1 #1): a side for these findings, for'],
  ],
  'packages/forms/definitions/spec/exam-psychiatric.diff.json': [
    ['BM-37', "PLAN-OPEN (forms 10.1 #1): the pair is this plan's reading", 2],
  ],
  'packages/forms/definitions/spec/exam-rectal.diff.json': [
    ['BM-38', 'PLAN-OPEN (forms 10.1 #1): Exam performed gates the findings'],
  ],
  'packages/forms/definitions/spec/exam-skin.diff.json': [
    ['BM-37', "PLAN-OPEN (forms 10.1 #1): the pairs are this plan's reading"],
    ['BM-47', 'PLAN-OPEN (forms 10.1 #27): the regions of the list, before'],
  ],
  'packages/forms/definitions/spec/general-1.diff.json': [
    ['BM-54', 'PLAN-OPEN (forms 10.1 #1): the pairs, for the clinical team'],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): units and ranges of the vitals,'],
    ['BM-42', 'PLAN-OPEN (forms 10.1 #1): a warning on a diastolic above'],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the most sets of vitals in one'],
  ],
  'packages/forms/definitions/spec/general-2.diff.json': [
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the most problems in one note'],
  ],
  'packages/forms/definitions/spec/harm-reduction.diff.json': [
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the most doses'],
  ],
  'packages/forms/definitions/spec/outreach.diff.json': [
    ['BM-55', 'PLAN-OPEN (forms 10.1 #39): the default is Go to Red flags'],
  ],
  'packages/forms/definitions/spec/quick-1.diff.json': [
    ['BM-47', 'PLAN-OPEN (forms 10.1 #27): the regions of the list, before'],
  ],
  'packages/forms/definitions/spec/red-flags.diff.json': [['BM-56', 'PLAN-OPEN (forms 10.1 #1)']],
  'packages/forms/definitions/spec/sexrepro-1.diff.json': [
    ['BM-53', 'PLAN-OPEN (forms 10.1 #1): a departure from the lines, for'],
    ['BM-46', 'PLAN-OPEN (forms 10.1 #1): choose-one or choose-many (A1'],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the ranges'],
  ],
  'packages/forms/definitions/spec/sexrepro-2.diff.json': [
    ['BM-53', 'PLAN-OPEN (forms 10.1 #1): whether a known pregnancy opens'],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #19): the range of gestational age, 0'],
    ['BM-39', "PLAN-OPEN (forms 10.1 #1): the date's range"],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the range', 2],
  ],
  'packages/forms/definitions/spec/sexrepro-3.diff.json': [
    ['BM-35', 'PLAN-OPEN (forms 10.1 #1): the result options and the most'],
    ['BM-53', 'PLAN-OPEN (forms 10.1 #24): one pregnancy test twice, for'],
    ['BM-56', 'PLAN-OPEN (forms 10.1 #1): what phase 7 does with this'],
  ],
  'packages/forms/definitions/spec/wound.diff.json': [
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the most wounds in one note'],
    ['BM-47', 'PLAN-OPEN (forms 10.1 #27): the regions of the list, before'],
    ['BM-46', 'PLAN-OPEN (forms 10.1 #1): choose-one or choose-many, with'],
    ['BM-39', 'PLAN-OPEN (forms 10.1 #1): the ranges'],
    ['BM-46', 'PLAN-OPEN (forms 10.1 #1): choose-one, or a when and a'],
    ['BM-56', "PLAN-OPEN (forms 10.1 #1): what phase 7 does with a wound's"],
  ],
};
