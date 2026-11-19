import '../../api/transport.dart' show NetworkException;
import '../../encounters/encounter_api.dart' show EncounterRequestFailed;
import '../../encounters/encounter_models.dart';
import '../../sync/local_store.dart' show ChartingPaused, LocalValidationError, RecordLocked;

/// Words for the encounter screens (phase 4 design, lifecycle 9). Fixed strings keyed by state and
/// problem code: a patient's details appear only where a screen shows that patient, never in a
/// title, a toast or an error. A refusal of the domain layer (`apps/mobile/lib/encounters/`) is shown
/// in its own words ([encounterErrorText]); these are the sentences the screens add.

// ---- titles: fixed, never a patient detail (10.2) ----

const newEncounterTitle = 'New encounter';
const encounterTitle = 'Encounter';
const noteTypesTitle = 'Note types';
const noteTitle = 'Note';
const summaryTitle = 'Summary';
const handoffTitle = 'EMS handoff';

// ---- Start (9.2) ----

const startTabLabel = 'Start';
const startSheetHeading = 'Start';
const newEncounterAction = 'New encounter';
const newEncounterLine = 'Chart a visit, with or without a registered patient.';

// ---- New encounter: Who and Where (9.2, 3.10) ----

/// "Step 1 of 3": where the person is in New encounter.
String stepText(int step, int of) => 'Step $step of $of';

const whoHeading = 'Who is this visit for?';
const patientSearchLabel = 'Search by name, street name or what they look like';
const searchAction = 'Search';
const showMoreAction = 'Show more';
const narrowSearch = 'More people match. Add letters to narrow it down.';
const searchUnavailable = 'Search isn’t available right now. Try again in a moment.';
const noPatientRecords = 'Your role in this team doesn’t include patient records.';

/// The count a search run found, said once per run.
String foundText(int count, {required bool onPhone}) => count == 0
    ? (onPhone ? 'No one found on this phone.' : 'No one found.')
    : '${count == 1 ? '1 patient' : '$count patients'} found${onPhone ? ' on this phone' : ''}';

const newPatientAction = 'New patient';
const newPatientLine = 'Register them, then start the visit from their chart.';
const noPatientAction = 'No patient';
const noPatientLine = 'For someone who’d rather not be registered. The visit takes Non-Medical notes only.';

const whereHeading = 'Where';

/// The place's field (`locationText`): the design's words.
const whereLabel = 'Where are you?';
const whereHelper = 'Optional';

/// Who the visit is for, above Where.
String forPatientText(String name) => 'For $name';
const noPatientText = 'No patient';
const changePatientAction = 'Change';
const changePatientSpoken = 'Change who this visit is for';
const nextAction = 'Next';
const startVisitAction = 'Start the visit';

/// A patient with no name the phone can show: the chart's own words for it.
const noNameRecorded = 'No name recorded';

// ---- Medical or Non-Medical (9.3) ----

const kindHeading = 'Medical or Non-Medical';

/// The two kinds in words, on a button and as a visit's kind.
String kindText(VisitKind kind) => switch (kind) {
  VisitKind.medical => 'Medical',
  VisitKind.nonMedical => 'Non-Medical',
};

/// The line under each kind's button, as the design gives it (PRD main 379). The button reads the
/// whole line; it shows the kind above the rest of it.
String kindLine(VisitKind kind) => switch (kind) {
  VisitKind.medical => 'Medical: clinical notes, orders, signing',
  VisitKind.nonMedical => 'Non-Medical: outreach, supplies, social needs',
};

/// [kindLine] without its kind, for under the kind's name on the button.
String kindDetail(VisitKind kind) {
  final line = kindLine(kind).substring(kindText(kind).length + 2);
  return line[0].toUpperCase() + line.substring(1);
}

/// After `medical_note_needs_patient`: back to Who.
const choosePatientAction = 'Choose the patient';

const switchToMedicalAction = 'Switch to Medical';
const switchToMedicalTitle = 'Switch this visit to Medical?';
const switchToMedicalBody = 'The notes and their answers stay as they are. A visit can’t be switched back.';
const switchedToMedical = 'Switched to Medical';

/// Switch to Medical on a visit with no patient asks who first (3.10).
const switchNeedsPatient = 'A Medical visit needs a patient.';

// ---- The encounter screen (9.4) ----

/// The visit's kind in its header.
String visitKindText(VisitKind kind) => '${kindText(kind)} visit';

/// The place typed at Start.
String whereText(String place) => 'Where: $place';

/// A record made here that the server hasn't confirmed: phase 3's words.
const onThisPhoneOnly = 'On this phone only';

const notesHeading = 'Notes';
const chooseNoteTypeHeading = 'Choose a note type';
const addAnotherNoteType = 'Add another note type';

/// A teammate's note, named by the name its record carries (D108).
String byText(PersonRef person) => 'By ${personText(person)}';

/// Someone a record names; "a teammate" while the phone doesn't know the name (lifecycle 9.7).
String personText(PersonRef person) => person.name ?? 'a teammate';

/// The note's menu button, read with its note type.
String noteMenuSpoken(String title) => 'More for $title';
const removeNoteAction = 'Remove this note';
const removeNoteTitle = 'Remove this note?';
const removeNoteBody = 'Every answer in it is cleared, and the note counts for nothing.';
const removeNoteYes = 'Remove';
const noteRemoved = 'Note removed';

/// A note with no title the phone can show: its definition isn't here, and the server gave none.
const untitledNote = 'A note';

const visitNotOnPhone = 'This visit isn’t on this phone. Connect to open it.';

// ---- Note types (9.4) ----

/// A type the visit already has a draft of: tapping it opens that draft (`addNote`).
const draftOpensLine = 'A draft of this is in the visit. Tapping it opens the draft.';
const addAnotherAction = 'Add another';

/// [addAnotherAction], read with its note type.
String addAnotherSpoken(String title) => 'Add another $title';

/// A Non-Medical visit, to someone who may chart Medical notes: why no clinical type is listed.
const clinicalNeedsMedical = 'For clinical notes, switch this visit to Medical.';

/// No list on the phone yet: the domain layer's words for it (`no_red_flags_type`).
const noNoteTypes = 'Connect once to load your team’s note types.';

/// A role without `encounters.chart`: the domain layer's words for it (`not_charting`).
const notCharting = 'Your role doesn’t chart visits.';

// ---- The note form (9.5) ----

const saveAndCloseAction = 'Save & Close';
const continueAction = 'Continue';
const noteNotOnPhone = 'This note isn’t on this phone. Connect to open it.';

/// A note whose own version's form the phone lacks: the domain layer's words for it.
const noteFormNotOnPhone = 'This note’s form isn’t on this phone yet. Connect to load it, then try again.';

/// Above a form the person may read but not change now.
const readOnlyNote = 'You can read this note. It can’t be changed here.';
const addedToProblemList = 'Added to the problem list';

/// After Expand, when some quick answers weren't carried (forms 6.4, 10.1 #12).
const notCopiedTitle = 'Some answers weren’t copied';

/// The quick fields' labels, one to a line, then why.
String notCopiedBody(List<String> labels) =>
    '${labels.join('\n')}\n\nThe full note doesn’t take them as they are. They stay in the quick note.';
const notCopiedOk = 'Open the note';

// ---- The summary (9.6) ----

const notesToCompleteHeading = 'Notes';

/// A note of the person's own with no answer yet (their Red flags note, added by the app).
const noAnswersYet = 'No answers yet.';
const assessmentHeading = 'Assessment';
const assessmentLabel = 'Assessment';
const addToAssessmentLabel = 'Add to the assessment';

/// Under the locked assessment: what is added goes with Complete as an addendum to the visit (9.6).
const addToAssessmentHelp = 'The assessment is locked once a note is finished. What you add here is kept with it.';
const suggestionsHeading = 'Suggested next steps';

/// A suggestion chip, read with what it does.
String suggestionSpoken(String title) => 'Add $title';
const addReferralAction = 'Add referral';
const followUpHeading = 'Follow-up';
const noFollowUp = 'No follow-up recorded yet.';
const stopsHeading = 'Before you complete';

/// A line of what stops Complete is a button that opens the note there.
const stopOpensHint = 'Opens the note';

/// "{name}'s note stays a draft until they complete it." (9.6), a teammate unnamed as "A teammate".
String teammateDraftText(PersonRef author) => author.name == null
    ? 'A teammate’s note stays a draft until they complete it.'
    : '${author.name}’s note stays a draft until they complete it.';

/// The person's own note held for a Program Admin: not completed (3.3 as built).
String sentForReviewText(String title) => '$title: sent to a Program Admin for review.';

/// The Complete button, worded by what will happen (3.3).
const completeAction = 'Complete';
const completeAndSignAction = 'Complete and sign';
const completeAndSendAction = 'Complete and send for co-signature';

// ---- The EMS handoff (9.8) ----

const handoffDone = 'Done';
const handoffNotesHeading = 'Notes';

/// Who the handoff is about, as the portal's file words it (lifecycle 5.7, 12.1 #27).
const handoffNoPatient = 'No patient recorded';
const ageNotRecorded = 'Age not recorded';

/// Nothing for EMS: no note of this visit has an answer EMS may be shown.
const handoffNothing = 'Nothing in this visit is for EMS yet.';

// ---- A note's state (lifecycle 3.1, 9.1) ----

/// Lifecycle 3.1's first column, as the timeline words it (9.1).
String noteShownText(NoteShown shown) => switch (shown) {
  NoteShown.draft => 'Draft',
  NoteShown.complete => 'Complete',
  NoteShown.waitingForCosigner => 'Waiting for a co-signer',
  NoteShown.signed => 'Signed',
  NoteShown.waitingForAttestation => 'Waiting for attestation',
  NoteShown.attested => 'Attested',
};

const waitingToSend = 'Waiting to send';
const sentForReview = 'Sent for review';

/// A note's state as the phone knows it (9.1 as built): "Sent for review" while a Program Admin
/// decides, "Waiting to send" until its sign-off is confirmed, else [noteShownText].
String noteStateText(NoteView note) => note.sentForReview
    ? sentForReview
    : note.waitingToSend
    ? waitingToSend
    : noteShownText(note.shown);

// ---- Refusals ----

/// The store's sentence while the clock check fails (`ChartingPaused`, D35): Start says why before
/// anything is pressed. test/features/encounters/encounter_labels_test.dart holds it to the store's.
const chartingPaused = 'Charting is paused until the phone’s clock is right.';

/// The store's lock on a note finished as this phone knows it, in Complete's words for it.
const noteFinished = 'This note is already finished.';

const needsConnection = 'This needs a connection. Try again when the phone is online.';
const didNotWork = 'That didn’t work. Try again.';

/// What a screen shows when the domain layer refuses: its own sentence, as it gives it, for every
/// refusal that has one; the store's lock and a lost connection in the screens' words; anything else
/// as a fault to try again. Never a value or a patient detail.
String encounterErrorText(Object error) => switch (error) {
  LocalValidationError(:final message) => message,
  ChartingPaused(:final message) => message,
  EncounterRequestFailed(:final message) => message,
  RecordLocked() => noteFinished,
  NetworkException() => needsConnection,
  _ => didNotWork,
};

/// The domain layer's problem code of [error], if it names one (`medical_note_needs_patient`, ...).
String? problemOf(Object error) => error is LocalValidationError ? error.problem : null;
