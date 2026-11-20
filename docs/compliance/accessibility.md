# Accessibility

**Target:** WCAG 2.2 AA on iOS, Android and the portal, plus a 7:1 High contrast theme. **Legal floor:** WCAG 2.1 AA under the ADA Title II rule (April 26, 2027 for entities serving 50,000+ people) and the HHS Section 504 rule (May 11, 2027 for recipients with 15+ employees). When a contract says "ADA compliant", this is what it means (plan, module 15).

## What CI checks on every pull request

| Surface | Check | Where |
|---|---|---|
| Portal | axe-core with WCAG 2.0/2.1/2.2 A and AA tags plus best practices, on every page, in Day, Night run and High contrast, at 1440 px and 390 px; also with the system's dark and increased-contrast settings | `apps/portal/e2e/a11y.spec.ts` |
| Portal | First Tab reaches the skip link, which moves focus to the main content | same |
| Portal | No CSP violations (a broken CSP can silently break assistive scripts) | same |
| Phone | Text and control colour pairs meet 4.5:1 in Day and Night run and 7:1 in High contrast | `apps/mobile/test/design/contrast_test.dart` |
| Phone | Tap targets at least 48 px, labelled controls, and text contrast on rendered screens (Flutter's guideline matchers) | `apps/mobile/test/design/demo_banner_test.dart` and every new screen test |
| Phone | The Demo data only banner is announced by screen readers, not only drawn | same |
| Phone | Each patient screen (Patients tab, New patient and Edit details, profile, ID card, problem, Add problem, field review, Needs attention) runs its main scenario in Day, Night run and High contrast with the guideline matchers, at 200% text with no overflow, and on a 320 px wide phone | `apps/mobile/test/features/patients/` |
| Phone | Rows and chips that act as buttons carry a tap action for Switch Access and Voice Access; results and saved dates are announced once per search or change, never per keystroke | same |
| Phone | Every widget of a note form, the form itself and the read view of a finished note pass the guideline matchers in Day, Night run and High contrast, at 200% text and on a 320 px wide phone, with no overflow and nothing that scrolls sideways. The smoke test draws every bundled note type whole (every section and collapsed part opened; as it opens, answered and read-only) in those runs and at 200% text on a 320 px wide phone in Day and Night run, as are a date's typed boxes, the time dial and the question Remove asks; an entry's title and Remove fit at 300% text. The one exception is the day cells of the date calendar, a second way in beside the typed date (Known gaps) | `apps/mobile/test/features/forms/` |
| Phone | The words of what can't be changed, every answer of a read-only form and a disabled tick, are measured directly at 4.5:1 (7:1 in High contrast), since Flutter's contrast matcher skips a node that is not enabled | `apps/mobile/test/features/forms/forms_test_helpers.dart` |
| Phone | Every box a note form types in is private (no suggestions, autocorrect or learned words), a date is typed in three such boxes (or picked on the calendar) and a time picked on the dial. A refused date, a refused pick, a number's range, a text's limit and what one-tap Normal did are said once, never per keystroke; a field's label is heard before its help; a section's header is a heading; a chip's state comes from its selected flag, and a picked choose-one chip says that a tap clears it | `apps/mobile/test/features/forms/` |
| Portal | Each patient page (search, profile, ID card panel, corrections, history, reviews, duplicates queue and pair, merges, problem reversals) passes axe in the three themes and reflows at 320 px; keyboard-only decisions; error summaries take focus | `apps/portal/e2e/{patients,corrections,id-card,duplicates,problems}.spec.ts` |
| Portal | Each phase 4 page (a visit page in every state it comes back with, the patient page's timeline, the co-sign and attestation queues, Notes not complete) passes axe in the three themes and reflows at 320 px, long typed text in a note's recap, its addenda and a referral included. A refusal, a dropped connection and a failed Show earlier visits take focus each time they come, and a second identical one is said again; a button stays off, reading Working…, while the next page loads; Assign comes back at its note's form after `/reauth`; link names tell two rows of one note type apart. The one state not drawn end to end, Assign with nobody to offer, is held by a server-render test (`AssignForm.test.ts`), so axe and the 320 px check don't run on it | `apps/portal/e2e/{encounters,attestation,a11y}.spec.ts` |

## Known gaps

- **The one exception: the day cells of a note's date calendar** (`docs/design/phase-4/forms.md`
  8.2). The calendar is Material's, seven day columns to a row, and seven columns of 48 px need
  336 px, more than a 320 px wide phone has: its cells are 47.7 px wide on a 390 px phone and
  37.7 px on a 320 px one (WCAG 2.2's minimum is 24 px). They fail Android's 48 px check in every
  run and iOS's 44 px at 320 px. The way that meets every rule is the typed date beside the
  calendar: three private boxes, month, day and year, which pass every guideline in every run
  (three themes, 200% text, 320 px, and 200% text at 320 px), and the calendar stays as a second
  way. `apps/mobile/test/features/forms/date_field_test.dart` opens the calendar in every run with
  the guidelines on, holds its labels and contrast, and records which runs its cells can't meet, so
  a change to Material that fixes them shows.

## What automated checks cannot prove

Automated tools find roughly a third of WCAG failures. Before each release and in phase 11:

- VoiceOver (iOS) and TalkBack (Android) walk-throughs of every workflow.
- Keyboard-only walk-through of every portal workflow.
- Text at 200% on the phone and browser zoom at 200% on the portal, with no loss of content.
- An outside audit before the pilot, and an accessibility conformance report (VPAT 2.5, WCAG edition) as a sales document.
