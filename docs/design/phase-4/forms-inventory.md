# Phase 4 forms inventory: SPEC lines 1 to 332

An inventory of the field specification before the Focused Exam. It designs nothing.

- **SPEC** = the PRD's Google Doc Contents tab (`prd/google-doc-contents.md`, 2,036 lines). This file covers lines 1 to 332.
- **MAIN** = the PRD's main tab (`prd/main.md`). Oct 19 decisions are lines 86 to 153; module 4 is lines 371 to 464.
- Line ranges are inclusive. Things are named by line, never by list number (the list renumbers itself).
- **How fields are counted.** One field is one stored answer: one row of buttons, one text box, one number box, one date, one time, one search box, one photo set, one body map, one computed value. A row of three number boxes is three fields. A tick-box beside an input ("Unable to Measure", "Approximate", the unit switch) is one field. Buttons that only do something (open, add, connect, copy) are **actions** and are not counted. An "Other" text box is part of its button row and is not counted on its own.
- **one?** and **many?** mean the specification does not say whether a button row is choose-one or choose-many; the word is the suggested default (see section 9, A1). **many (MAIN n)** means MAIN says so.

## 1. How the specification is laid out

SPEC is one nested numbered list. Lines 1 to 4 are a title and the sentence "There are 8 main categories". Each top-level entry is a note category. Under it come entries named "Subsection 1", "Subsection 2" and so on, then named sections, then fields.

| Thing | How SPEC writes it | First line | Notes |
|---|---|---|---|
| Row of buttons | `Buttons: [ A ] [ B ] ...` | 8 | Some rows drop the word "Buttons:" (22, 58, 147, 251). Some rows wrap onto a second or third line (74 to 76, 84 to 86, 93 to 95, 100 to 101, 111 to 113). Choose-one or choose-many is never stated. |
| Options with no brackets | A plain sub-list, one option per line | 215 | Only in the pregnancy lists (215 to 229, 231 to 243). Also `Status: New, Chronic, Improving, Worse` on one line (33). |
| Text box | `Text box titled X`, `Text box`, or `[ Text box ]` | 9 | The title is the field label. |
| Number input | `Text input boxes: BP \| HR \| ...` (24); `[ ___ cm ]` (82); `[ numbers ]` (301); `[ number ]` (211); `[ weeks ] [ days ]` (207) | 24 | Units are given only for cm, in., weeks, days, doses and "/ 10". Vitals have no units. |
| Stepper | `[ − ] x doses [ + ]` | 134 | One place only. |
| Date | `[ 09 / 12 / 2026 ]`, `[ Date of LMP ]`, `[ date ]`, `[ Date ]` | 184 | The filled-in date is an example. |
| Time | `TIME EMS CALLED: [ 10:52 AM ]` | 51 | The value is an example. |
| Question | `Question: ...?` then a button row | 37 | Some questions drop the word "Question:" (40, 43, 140, 142, 144). |
| Condition | `If [YES] :`, `If NO:`, `If yes:`, `If [ Pregnancy ]` | 39 | The fields nested under it show only for that answer. Which question an "If" belongs to is sometimes only clear from position (46). |
| Expander | `[+ SHOW INFECTION DETAILS]`, `[+ COMPLETE SAFETY ASSESSMENT]`, `[+ OPEN MSE]` | 98 | Opens more fields. Two of the three have no fields under them (164, 166). |
| Repeating group | `[+ ADD VITAL]`, `[ + ADD ANOTHER MODALITY ]`, `[ WOUND 1 ] [ WOUND 2 ] [ + ADD WOUND ]` | 25 | What is repeated is not stated for vitals and modality. |
| "For each" | `Status (for each vaccine)` | 17 | A follow-up asked once per option picked above it. Written once only. |
| Search box | `[Search diagnosis/problem]`, `Search Box: [ Search Sineobex resources... 🔍 ]` | 32 | Both search another part of the product. |
| Computed content | `[ Auto-generated from encounter/Export of Encounter ]` (54); `(auto populate based on what was clicked in current needs section)` (261) | 54 | |
| Action button | `[ COPY / SHARE HANDOFF ]`, `[ CONNECT TO RESOURCE ]`, `[ CONNECT ]`, photo buttons (117) | 56 | |
| Body map | `[Body Map]`, `Tap body location: FRONT BACK` | 70 | No regions listed. |
| Photo | `TAKE WOUND PHOTO` with three buttons (116 to 117); `Photos: Up to 5` (306 to 307) | 116 | |
| Note to the builder | Round brackets or plain words: `Dictation (option in V2, not in MVP/V1)`, `(for each vaccine)`, `(auto populate ...)`, `Example:`, `Up to 5` | 13 | Not a field. |
| Example values | `10:52 AM`, `09 / 12 / 2026`, `28 days`, `5 days`, `4 / 10`, a resource card | 51 | Examples, not defaults (MAIN 420 says so for the menstrual and pain values). |

Markdown noise to ignore when transcribing: `&#91;` is `[`, `&#32;` is a space, `\[` and `\]` are brackets, and a `\` at the end of a line is a line break inside one list item. Lines 40 to 56 are one list item spread over 17 lines; so are 263 to 265 and 100 to 101.

What SPEC leaves unsaid:

- Whether any button row is choose-one or choose-many.
- Which fields are required.
- Units and ranges for vitals; the pain scale; number formats.
- What an "Other" button does (a text box is shown for only 2 of 19).
- Which option in a choose-many row excludes the others ("None", "No", "None known").
- Whether a section repeats (problems, referrals).
- Medical or Non-Medical for each note type; who may see or sign what.
- Where a field links to supplies, orders, referrals or the problem list.
- The content of the full safety assessment and the mental status exam.
- Red flags and disposition for any note type other than General / Primary Care.

## 2. Note types

SPEC line 3 says there are 8 categories. Seven start inside lines 1 to 332; the eighth, Focused Exam, starts at 333 (outside this inventory). None is missing. MAIN 408 lists the same eight. Note: **Psychological starts at line 150** and is easy to miss, because a blank line (149) breaks the list and its number is written `4)`.

| Name as written | Id | Medical or Non-Medical | SPEC lines | Subsections | Fields | Special behaviour |
|---|---|---|---|---|---|---|
| General / Primary Care | `general_primary_care` | Medical (MAIN 98 calls it "the full Medical form"; MAIN 379) | 5–62 | 3 numbered, plus "Encounter Summary" with no number | 26 | Red-flag question with an EMS branch, a call time and a built handoff summary (36–56). Status asked per vaccine (17–18). Holds the Focused Exam picker (26–28). Diagnosis search (32). Two "add" repeats (25, 28). |
| Wound Care | `wound_care` | Not stated (a clinical template is implied, MAIN 379–380) | 63–119 | 3 | 20 per wound | The whole form repeats per wound (66). Body map (69–72). Photos (116–117). Infection details behind an expander (98–103). Measurements with "Unable to Measure" (82). |
| Harm Reduction | `harm_reduction` | Not stated (MAIN 447 leaves open whether naloxone and safer-use supplies are Non-Medical) | 120–148 | 2 | 12 | Dose stepper (134). One follow-up on "Interested in treatment" (146–147). Connect to resource action (148). Sensitive: MAIN 435, 145. |
| Psychological | `psychological` | Not stated | 150–171 | 3 | 7 | Safety questions (158–163). Two expanders with no content: full safety assessment (164), mental status exam (165–166). Sensitive: MAIN 435. |
| Sexual and Reproductive | `sexual_reproductive` | Not stated | 173–251 | 1 | 25 | Four conditional blocks hang off the Reason row (177–243). Dates, weeks and days, gravida and para. Sensitive: MAIN 121, 435. |
| Social Needs | `social_needs` | Non-Medical (MAIN 379, 409) | 252–282 | 2 (the second is "Outreach / Community Encounter", 268–282) | 11 | Resource search (259). Suggested resources built from the needs tapped (260–265). Referral status per resource (266–267). Emoji on buttons (255). |
| Patient Encounter | `quick_encounter` (MAIN 404 names it "Quick encounter") | Medical, always (MAIN 409) | 283–332 | 3 | 26 | Four blocks shown by a selector row (285–323). Unit switch in. / cm. (301). Up to 5 photos (307). Medication delivery (317–323). No red flags or disposition in SPEC; MAIN 409 requires them. |
| Focused Exam | `focused_exam` | Part of General / Primary Care (MAIN 414) | 333–2036 | not in this inventory | not counted here | Not in this inventory. |

Total fields in lines 5 to 332: **127**.

## 3. Each note type in turn

Columns: SPEC lines; name as written; kind; number of options; notes (conditions, MVP marks, links to other parts of the product).

### 3.1 General / Primary Care (5–62)

**Subsection 1 (6–9): Reason for Encounter (7–9). 2 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 8 | Reason for Encounter | buttons, many? | 7 | Has Other (no text box shown). "Medication" may point at orders; not stated. |
| 9 | Chief Concern | text box | | |

**Subsection 2 (10–28): History of Present Illness (11–28). 12 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 12–13 | "Text box titled Chief Concern" | text box | | This is the HPI narrative; the title is a slip (MAIN 420). Line 13: Dictation, **V2, not MVP**. |
| 14–22 | Preventative Care | group | | Four fields below. |
| 15–16 | Vaccines | buttons, many? | 8 | |
| 17–18 | Status (for each vaccine) | buttons, one? per vaccine picked | 6 | "Given today" deducts a vaccine dose and needs lot number and expiry (MAIN 426): supplies link. |
| 19–20 | Screening | buttons, many? | 8 | "Pregnancy", "STI", "HIV", "Hep C" repeat in Sexual and Reproductive (247). |
| 21–22 | Action | buttons, many? | 5 | No "Buttons:" label. Probably per screening picked; not stated. "Ordered" points at orders, "Referred" at referrals. Supply mapping fires here, not on Screening (MAIN 431). |
| 23–25 | Vitals | 6 number inputs: BP, HR, SpO₂, RR, TEMP, PAIN | | No units. Line 25: `[+ ADD VITAL]` repeat. |
| 26–28 | Focused Exam | buttons, many (MAIN 102, 414) | 10 | Nested under Vitals. Has Other and GU (GU is a sensitive exam, MAIN 415). Line 28: `[ + ADD ANOTHER MODALITY ]`. The real picker is the Focused Exam category (333 on), which has more systems than these 10. |

**Subsection 3 (29–60): Assessment (30–60). 11 fields, 1 action.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 31–35 | Problem | group, probably repeating | | Points at the problem list. |
| 32 | [Search diagnosis/problem] | search box | | Diagnosis search: another part of the product. |
| 33 | Status | options, one? | 4 | Written as a comma list. MAIN 108 gives the problem list only New or Ongoing. |
| 34–35 | Intervention | buttons, many? | 7 | Has Other. Medication, Testing, Referral, Supplies, Procedure point at orders, referrals and supplies; no link is stated. |
| 36–56 | Red Flags | group | | |
| 37–38 | Does the patient require emergency evaluation? | buttons, one? | 3 | NO, UNCERTAIN, YES. |
| 39–44 | If [YES]: EMS activated? ; Patient agrees to transport? | 2 × buttons, one | 2 each | Shown only when 38 is YES. |
| 46–49 | If NO: reason | buttons, one? | 3 | Shown when "Patient agrees to transport" is NO (by position; MAIN 413 "reason if not"). Has Other. |
| 51 | TIME EMS CALLED | time | | Example value shown. |
| 53–54 | HANDOFF SUMMARY | computed text | | Built from the encounter. |
| 56 | [ COPY / SHARE HANDOFF ] | action | | **MAIN 413 forbids copy and share**: full-screen view and PDF export instead, both audit-logged. |
| 57–58 | Disposition | buttons, many (MAIN 102) | 9 | No "Buttons:" label. Contradictory pairs must be blocked (MAIN 102). Has None and Declined. |
| 59–60 | Follow Up | buttons, one? | 3 | "Specific date" needs a date input that SPEC does not show. Points at follow-up tasks (MAIN 384, 433). |

**Encounter Summary (61–62). 1 field.** Text box "for the summary/manual inputs" (62). Sits at subsection level with no "Subsection 4" label.

### 3.2 Wound Care (63–119)

**Subsection 1 (64–66): Wounds (65–66). 0 fields.** A row `[ WOUND 1 ] [ WOUND 2 ] [ + ADD WOUND ]` (66): the selector and add button of a repeating group.

**Subsection 2 (67–103): WOUND 1 (68–103). 14 fields per wound.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 69–72 | LOCATION; "Tap body location: FRONT BACK" | body map with front and back views | | No region list. MAIN 410: stores the same region codes as the quick form (299). MAIN 103 adds Right, Left or Bilateral. |
| 73–76 | WOUND TYPE | buttons, one? | 8 | Two lines of buttons. Has Other. Differs from the quick list (297); MAIN 410 sets one master list of 10. |
| 77–78 | DURATION | buttons, one | 5 | |
| 79–82 | MEASUREMENTS | 3 numbers in cm (Length, Width, Depth) and an "Unable to Measure" tick | | MAIN 411: cm or inches, stored in cm. |
| 83–86 | WOUND BED | buttons, many? | 6 | Two lines. Has Other. |
| 87–91 | DRAINAGE | 2 × buttons: Amount (89), one, 5 options; Type (91), one?, 4 options | | Both have None. |
| 92–95 | PERIWOUND | buttons, many? | 7 | Two lines. |
| 96–97 | INFECTION CONCERN | buttons, one | 4 | "Urgent" has no stated effect. |
| 98 | [+ SHOW INFECTION DETAILS] | expander | | Opens the two rows below. |
| 99–101 | INFECTION FINDINGS | buttons, many? | 9 | Two lines. "Foul Odor" lives here; there is no Odor field (MAIN 422). |
| 102–103 | SYSTEMIC SYMPTOMS | buttons, many? | 5 | None is exclusive. Has Other. Fever and Chills repeat from 100–101. |

**Subsection 3 (104–119): WOUND TREATMENT (105–119). 6 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 106–107 | CLEANSING | buttons, many? | 5 | None is exclusive. |
| 108–109 | PROCEDURE | buttons, many? | 4 | None is exclusive. |
| 110–113 | DRESSING | buttons, many? | 8 | Two lines. Has Other. Drives supply deductions (MAIN 103, 427): supplies link. |
| 114–115 | MEDICATION | buttons, many? | 4 | None is exclusive. Points at medication orders and the allergy check (MAIN 450); no link stated. |
| 116–117 | TAKE WOUND PHOTO | photo set | | Three action buttons: Retake photo, Add another photo, Submit photo. Photos link. No limit stated here (5 in the quick form, 307). |
| 118–119 | FOLLOW-UP | buttons, one? | 6 | Mixes times (Tomorrow, 1 week) and places (Wound clinic, ED). Points at follow-up tasks and referrals. |

Nothing in Wound Care is marked outside the MVP.

### 3.3 Harm Reduction (120–148; line 149 is blank)

**Subsection 1 (121–129). 4 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 122–123 | SUBSTANCE(S) | buttons, many | 8 | Has Other. |
| 124–125 | LAST USE | buttons, one? | 5 | Overall or per substance: not stated. |
| 126–127 | OVERDOSE HISTORY | buttons, one? | 4 | |
| 128–129 | RISK FACTORS | buttons, many? | 5 | Has Other. |

**Subsection 2 (130–148). 8 fields, 1 action.** Two sections.

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 131–138 | HARM REDUCTION PROVIDED | section | | |
| 132–133 | NALOXONE | buttons, one? | 4 | "Accepted" deducts naloxone kits at the doses entered (MAIN 428): supplies link. |
| 134 | `[ − ] x doses [ + ]` | stepper (whole number) | | |
| 135–136 | SUPPLIES | buttons, many? | 6 | Has Other. Supplies link. |
| 137–138 | EDUCATION | buttons, many? | 5 | Has Other. |
| 139–148 | MOUD / SUD TREATMENT | section | | Substance use treatment records: MAIN 145, 435. |
| 140–141 | Currently receiving treatment? | buttons, one | 3 | |
| 142–143 | Treatment Discussed? | buttons, one | 2 | |
| 144–145 | Interested in treatment? | buttons, one | 3 | |
| 146–147 | If yes: treatment | buttons, many? | 4 | Shown only when 145 is Yes. Has Other. No "Buttons:" label. |
| 148 | [ CONNECT TO RESOURCE ] | action | | Referrals and resources link. MAIN 399 names the resources per treatment. |

Nothing in Harm Reduction is marked outside the MVP.

### 3.4 Psychological (150–171; line 172 is blank)

**Subsection 1 (151–155): Reason for Visit (152–155). 2 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 153 | Reason for Visit | buttons, many? | 10 | Has Other. |
| 154–155 | Current Concern | text box | | Line 155: Dictation, **V2, not MVP**. |

**Subsection 2 (156–166). 3 fields, 2 expanders with no content.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 157 | SAFETY | heading only | | The next three rows are written as its siblings, not its children. |
| 158–159 | SUICIDAL THOUGHTS | buttons, one | 4 | |
| 160–161 | HOMICIDAL THOUGHTS | buttons, one | 3 | |
| 162–163 | IMMEDIATE SAFETY CONCERN | buttons, one | 2 | No stated effect for Yes (no red-flag branch written). |
| 164 | [+ COMPLETE SAFETY ASSESSMENT] | expander | | **No fields defined anywhere in 1–332.** |
| 165–166 | MENTAL STATUS EXAM; [+ OPEN MSE] | expander | | **No fields defined in 1–332.** MAIN 397 lists "psychiatric observation" inside the Focused Exam. |

**Subsection 3 (167–171). 2 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 168–169 | INTERVENTION | buttons, many | 9 | "Referral" and "Warm handoff" point at referrals. No Other. |
| 170–171 | OUTCOME | buttons, many? | 5 | "Follow-up scheduled" points at follow-up tasks. |

### 3.5 Sexual and Reproductive (173–251)

One subsection: **Subsection 1 (174–251). 25 fields.** Its sections are Reason (175–243, which holds four conditional blocks), Symptoms, Testing, Prevention and Follow-up.

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 175–176 | Reason | buttons, many? | 10 | Has Other. Three options open blocks below. |
| 177–186 | **If [ Pregnancy ]: Pregnancy** | block, 5 fields | | Shown when Reason includes Pregnancy. |
| 179–180 | Pregnancy possible? | buttons, one | 3 | |
| 181–182 | Pregnancy desired? | buttons, one | 3 | |
| 183–184 | LMP | date and an "Approximate" tick | | 2 fields. Date shown is an example. |
| 185–186 | Pregnancy Test | buttons, one | 3 | MAIN 103, 417: moves to the top and loses "Not done". Point-of-care lab (MAIN 104): orders link. |
| 187–192 | **If [ Contraception ]: Contraception** | block, 2 fields | | |
| 189–190 | Current Method | buttons, one? | 7 | Has None and Other. |
| 191–192 | Interested in changing method? | buttons, one | 3 | |
| 193–203 | **If [ Menstrual Health ]: Menstrual Health** | block, 6 fields | | The Reason button is named "Menstrual" (176). |
| 195–196 | Status | buttons, one | 4 | |
| 197 | LMP | date | | Same fact as 184. |
| 198 | Typical Cycle | number, days | | "28" is an example (MAIN 420). |
| 199 | Typical Duration | number, days | | "5" is an example. |
| 200–201 | Heavy Bleeding? | buttons, one | 2 | |
| 202–203 | Pain | number out of 10 | | "4" is an example. |
| 204–243 | **If [ Pregnant ]** | block, 7 fields | | No button named "Pregnant" exists. MAIN 417: shown once a pregnancy is confirmed. |
| 205–213 | Current Pregnancy | 5 fields | | Gestational age: weeks, days (207). Estimated due date: date (209). Gravida: number (211). Para: number (213; the line reads "G [number] P [number]", MAIN 420 makes para its own field). |
| 214–229 | Pregnancy History / Current Complications | plain list, many? | 14 | "Other" opens a text box (227–228). "None known" (229) is exclusive. Could feed the problem list; not stated. |
| 230–243 | Current Symptoms | plain list, many? | 12 | "Other" opens a text box (242–243). No "None". |
| 244–245 | Symptoms | buttons, many? | 7 | None is exclusive. No Other. |
| 246–247 | Testing | buttons, many? | 7 | MAIN 103: becomes "Testing History" with a date and result per test. Point-of-care labs (MAIN 104). |
| 248–249 | Prevention | buttons, many? | 5 | "Condoms provided" is a supplies link; "Vaccine" points at 16–18. |
| 250–251 | Follow-up | buttons, many? | 4 | No "Buttons:" label. Has None. "Referral" and "PCP" point at referrals. |

Nothing in Sexual and Reproductive is marked outside the MVP. Pregnancy details are sensitive (MAIN 121).

### 3.6 Social Needs (252–282)

**Subsection 1 (253–267). 5 fields, 1 action.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 254–255 | Current Needs | buttons, many | 14 | 13 carry an emoji; MAIN 419 turns them into icons. Has Other. Food and hygiene map to kits (MAIN 429): supplies link. |
| 256–257 | Housing Status | buttons, one | 6 | Same idea as the patient's living situation, which MAIN 111 changes. |
| 258–259 | Resources | search box | | Searches the resource directory: another part of the product. |
| 260–265 | Recommended Sources | computed list of resource cards | | Line 261: filled from the needs tapped in 255. Lines 262–265: an example card (a real organization's name, two tags, `[ CONNECT ]` action). Referrals link. |
| 266–267 | Referral Status | buttons, one, per resource connected | 7 | **Moved to V2 by MAIN 113.** |

**Subsection 2 (268–282): Outreach / Community Encounter (269–282). 6 fields.**

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 270–271 | Type | buttons, one? | 6 | |
| 272–273 | Interaction | buttons, one? | 4 | |
| 274–275 | Support Provided | buttons, many | 8 | Supplies link. |
| 276–277 | New Need Identified | buttons, many? | 5 | "No" is exclusive. |
| 278–280 | Notes | text box | | Line 280: Dictation, **V2, not MVP**. |
| 281–282 | Follow-up | buttons, one | 3 | Points at follow-up tasks. |

### 3.7 Patient Encounter (283–332), the Quick encounter

**Subsection 1 (284–323). 23 fields.** One selector row and four conditional blocks.

| Lines | Name | Kind | Options | Notes |
|---|---|---|---|---|
| 285 | (no name) | buttons, many? | 4 | GENERAL, WOUND, SOCIAL NEEDS, MEDICATION. Each opens a block. |
| 286–294 | **If [ GENERAL ]** | block, 6 fields | | |
| 287–288 | Chief Concern | text box | | |
| 289–290 | History of present illness | buttons, one | 3 | Yes, No, Unknown. MAIN 409, 422: Yes opens a text box (not in SPEC). |
| 291–292 | Vitals | 3 number inputs: BP, HR, Temperature | | Subset of 24. |
| 293–294 | Assessment | text box | | |
| 295–307 | **If [ WOUND ]** | block, 9 fields | | |
| 296–297 | Wound Type | buttons, one? | 8 | Differs from 74–76. |
| 298–299 | Location | buttons, one? | 8 | Body regions. |
| 300–301 | Dimensions | 3 numbers and a unit switch (in. / cm.) | | Order not labelled; MAIN 404 says L × W × D. |
| 302–303 | Drainage | buttons, one | 5 | "Moderate" here, "Mod" at 89. |
| 304–305 | Dressing Applied | buttons, many? | 4 | Subset of 111–113. MAIN 103 adds Other with a text box. Supplies link. |
| 306–307 | Photos | photo set | | "Up to 5". Photos link. |
| 308–316 | **If [ SOCIAL NEEDS ]** | block, 4 fields | | |
| 309–310 | Support | buttons, many | 6 | Supplies link. |
| 311–312 | Needs | buttons, many | 5 | Subset in spirit of 255, with different wording ("ID Documents"). |
| 313–316 | Referral | buttons, one (Yes, No); if Yes, a text box (315–316) | 2 | Referrals link (MAIN 113: a referral is a date and free text). |
| 317–323 | **If [ MEDICATION ]** | block, 3 fields | | Needs an ordering credential (MAIN 409). |
| 318–319 | Order | buttons, many? | 2 | OTC, Prescription. Orders link (MAIN 104). No item picker shown. |
| 320–321 | Delivery | buttons, one | 2 | Yes creates a delivery task (MAIN 418). |
| 322–323 | Instructions for Delivery | text box | | Not written as conditional on Delivery = YES. |

**Subsection 2 (324–326). 1 field.** Assessment / Encounter Summary: text box (326).

**Subsection 3 (327–332). 2 fields.** Follow up (328) holds "Follow up": text box (329–330), and "Date of follow up": date (331–332). Points at follow-up tasks.

Nothing in Patient Encounter is marked outside the MVP.

## 4. Catalogue of constructs in lines 1 to 332

Counts are of lines 5 to 332. "Times" counts places, not options.

| # | Construct | First line | Times | What a form definition must be able to say |
|---|---|---|---|---|
| 1 | Choose-one buttons | 18 (first clear case: 38) | 41 of 79 button rows, by the suggested defaults (SPEC states none) | A field with a fixed option list, each option with a stable code and a label, that stores at most one code. |
| 2 | Choose-many buttons | 8 (first clear case: 16) | 38 of 79, by the suggested defaults (two are stated by MAIN 102: lines 27 and 58) | The same, storing a set of codes. |
| 3 | Exclusive option inside a choose-many row ("None", "No", "None known") | 58 | 9 (58, 103, 107, 109, 115, 229, 245, 251, 277) | An option can be marked as clearing and blocking all the others. |
| 4 | Pairs of options that may not be picked together | 58 (rule in MAIN 102) | 1 | A field can list option pairs that block each other, with a message. |
| 5 | "Other" button | 8 | 19 rows (8, 27, 35, 49, 76, 86, 103, 113, 123, 129, 136, 138, 147, 153, 176, 190, 227, 242, 255) | An option can require a short text, stored with the answer. |
| 6 | "Other" with its text box written out | 227–228 | 2 (227–228, 242–243) | Same as 5; these two show it is the intended behaviour. |
| 7 | Free text box | 9 | 13 (9, 12, 62, 154, 228, 243, 279, 288, 294, 316, 323, 326, 330); 11 without the two "Other" boxes | A multi-line text field with a label; long narrative. |
| 8 | Dictation note | 13 | 3 (13, 155, 280) | Nothing in V1 (MAIN 412). A text field may later carry a "dictation allowed" mark. |
| 9 | Vitals row | 24 | 2 (24 with 6 values; 292 with 3) | A named group of number fields shown on one row, each with its own unit and range; BP is two numbers (systolic and diastolic). |
| 10 | Number with a unit | 82 | 9 places: cm × 3 (82); three numbers with a unit switch (301); doses (134); days (198, 199); weeks and days (207); out of 10 (203); plus the vitals | A number field with a unit, a minimum, a maximum and a step; whole or decimal. |
| 11 | Unit switch | 301 | 1 (MAIN 411 applies it to 82 too) | A number field can accept two units and store one (cm). |
| 12 | Stepper | 134 | 1 | A whole-number field shown as minus and plus, with a minimum of 0 and a unit label. |
| 13 | Plain count | 211 | 2 (gravida 211, para 213) | A whole-number field with a short prefix label (G, P). |
| 14 | Score out of 10 | 203 | 1 (and PAIN in the vitals row, 24) | A whole number from 0 to 10. |
| 15 | Tick beside an input | 82 | 2 ("Unable to Measure" 82; "Approximate" 184) | A yes/no flag tied to other fields; "Unable to Measure" must clear and disable the three numbers. |
| 16 | Date | 184 | 4 (184, 197, 209, 332); a fifth is implied by "Specific date" (60) | A date field; some allow past dates only (LMP), some future only (due date, follow-up). |
| 17 | Time | 51 | 1 | A time-of-day field that can default to now. |
| 18 | Duration in two parts | 207 | 1 | Two linked numbers (weeks, days) stored as one value. |
| 19 | Follow-up fields shown only for some answers | 39 | 12 written (39, 46, 146, 177, 187, 193, 204, 286, 295, 308, 315, 317); 2 more implied (60 "Specific date"; 290 Yes, MAIN 409) | A field or block has a "show when" rule naming another field and the answers that open it, including "contains" for choose-many rows; hidden fields store nothing. |
| 20 | Condition on a fact that is not a button | 204 | 1 ("If [ Pregnant ]") | A "show when" rule can test another field's value (pregnancy test Positive) or a patient fact. |
| 21 | Expander | 98 | 3 (98, 164, 166) | A block of fields that stays closed until tapped, and may open by itself on some answers. |
| 22 | Repeating group with numbered tabs | 66 | 1 (wounds) | A block of sections that repeats, each copy with a number and its own answers; add and (not stated) remove. |
| 23 | "Add another" on a row | 25 | 2 (25 add vital; 28 add another modality) | A group can repeat (a second set of vitals) or a picker can be reopened to add more. |
| 24 | Question asked once per option picked | 17 | 1 written (17–18); 1 implied (21–22 per screening) | A field can repeat for each option chosen in another field, storing one answer per option. |
| 25 | Repeating group implied | 31 | 2 (problems 31–35; referral status per resource 266–267) | Same as 22, without tabs. |
| 26 | Search box into another part of the product | 32 | 2 (32 diagnoses; 259 resources) | A field whose options come from a named catalogue at run time, and which stores the catalogue item's id; must work offline. |
| 27 | Computed text | 54 | 1 (EMS handoff summary) | A read-only block built from other fields by a named template; not typed by the user. |
| 28 | Computed list | 261 | 1 (recommended resources) | A list filled by a rule that maps answers in one field (255) to catalogue items. |
| 29 | Action button | 56 | 4 places (56 copy/share; 148 connect to resource; 265 connect; 117 three photo buttons) | A button that starts a named product action (open handoff view, create referral, take photo); stores nothing itself. |
| 30 | Body map | 70 | 1 (69–72) | A field of type "body region" that stores a region code and a view (front, back), with a side added by MAIN 103. |
| 31 | Photo set | 116 | 2 (116–117; 306–307 with a limit of 5) | A field that holds 0 to N photos, with N set in the definition. |
| 32 | Question label | 37 | 5 with the word "Question:" (37, 179, 181, 191, 200); 5 without (40, 43, 140, 142, 144) | A field label can be a full sentence. |
| 33 | Two labelled button rows under one heading | 89 | 1 (Amount 89, Type 91) | A heading can hold several fields, each with a short label. |
| 34 | Button row wrapped over lines | 74 | 5 (74–76, 84–86, 93–95, 100–101, 111–113) | Nothing: it is one field. The transcriber must join the lines. |
| 35 | Options as a plain list | 215 | 2 (215–229, 231–243); also the comma list at 33 | Nothing: same as a button row. |
| 36 | Icon on a button | 255 | 1 row, 13 options | An option can carry an icon name (MAIN 419: design-system icons, not emoji). |
| 37 | Example value | 51 | 6 (51, 184, 198, 199, 203, 263–265) | Nothing: no default values. At most a placeholder. |
| 38 | Heading with no fields | 157 | 1 (SAFETY) | A section can group the fields that follow it. |
| 39 | Subsection | 6 | 17 numbered, plus 1 unnumbered (61) | A note type is an ordered list of pages or accordion sections (MAIN 381), each with a name. SPEC gives most only a number. |
| 40 | Selector that opens whole blocks | 285 | 2 (176 opens 3 blocks; 285 opens 4) | Construct 19 applied to a block of several fields. |

Things MAIN adds that a definition must also carry (details in section 7): a supply mapping per option (MAIN 424–431), a sensitive mark per section or module (MAIN 415, 435), a version (MAIN 387), a Medical or Non-Medical tag (MAIN 379), a one-line summary per module (MAIN 392, 433), a shared option list by name (MAIN 410).

## 5. Option lists that appear in more than one place

| List | Appearances (SPEC lines) | Same or different |
|---|---|---|
| Wound type | 73–76 (8); 296–297 (8) | Different. 74–76 has Ulcer and Other; 297 has Venous and Arterial and no Other. MAIN 410 sets one list of 10: venous ulcer, arterial ulcer, pressure, diabetic, traumatic, burn, abscess, surgical, cellulitis, other. |
| Wound location | 69–72 (body map); 298–299 (8 regions) | Different controls; MAIN 410 says both store the same region codes. |
| Wound measurements | 79–82 (cm, with Unable to Measure); 300–301 (in. / cm.) | Different; MAIN 411 unifies units. |
| Drainage amount | 89 (5); 302–303 (5) | Same list; "Mod" at 89, "Moderate" at 303. |
| Dressing | 110–113 (8); 304–305 (4) | 305 is a subset of 111–113. MAIN 103 adds Other to 305. |
| Wound photo | 116–117; 306–307 | Limit of 5 stated only at 307. |
| Vitals | 23–24 (6); 291–292 (3) | 292 is a subset; "TEMP" at 24, "Temperature" at 292. |
| Chief concern text | 9; 12 (mis-titled); 287–288. "Current Concern" 154 is the same idea. | Same field in the full and quick forms. |
| Assessment or summary text | 61–62; 293–294; 325–326 | Same idea; the quick form has two (294 and 326). |
| Yes / No | 41, 44, 143, 201 (No first), 163 (No first), 314, 321 | Same; order and capitals vary. |
| Yes / No / Unknown | 141, 290 | Same. |
| Yes / No / Unsure | 180 (No, Yes, Unsure), 182 (Yes, Unsure, No), 192 (Yes, No, Unsure) | Same options, three orders. |
| Three-way with a middle answer | 38 (NO, UNCERTAIN, YES), 145 (Yes, Maybe, No) | Different words for the middle answer. |
| Offer status | 18 (6: vaccine status), 133 (4: naloxone), 267 (7: referral status) | Overlap on Offered, Declined, Accepted. Different lists. |
| Follow-up | 59–60 (3), 118–119 (6), 250–251 (4), 281–282 (3), 328–332 (text and date) | All different. "Next street clinic" (60) and "Next clinic" (119) are the same answer. |
| Disposition against follow-up | 57–58 has Follow-up, PCP, ED; 119 has ED; 251 has PCP, Referral | Overlapping answers in different fields. |
| Tests | 19–20 Screening (8); 246–247 Testing (7); 185–186 Pregnancy Test | HIV, Hep C and Pregnancy are in both 20 and 247. "STI" at 20 covers Syphilis, Gonorrhea and Chlamydia at 247. |
| Vaccines | 15–16 (8); "Vaccine" at 249; "Hep B" also a test at 247 | 249 points at 16 without a list. |
| Needs | 254–255 (14); 311–312 (5) | 312 is a subset with different words ("ID Documents" against "ID"). |
| Support given | 274–275 (8); 309–310 (6) | Different. Food is in both; 310 has Water, Socks, Handwarmers, Hygiene Kit, Ride arranged. |
| Interventions | 34–35 (7); 168–169 (9) | Different lists; Referral is in both, and "Medication" against "Medication discussion". |
| Education topics | 137–138 (5); "Education" as an option at 22 and 35; "Safer sex counseling" 249 | 138 is the only real list. |
| Supplies | 135–136 (6); "Supplies" as an option at 35 and 275; "Condoms" 136 and "Condoms provided" 249 | Condoms appear twice. |
| Infection signs | 99–101 (9); 102–103 (5); 230–243 has Fever | Fever and Chills are in both 100–101 and 103. |
| Reasons | 8 (7); 153 (10); 176 (10) | Different. "Medication" and "Other" are in 8 and 153; "Follow-up" in 8, "Follow-up attempt" in 271. |
| LMP date | 183–184; 197 | Same fact, entered in two blocks. |
| Pregnancy | Reason 176; Screening 20; Testing 247; Pregnancy Test 186; block 204–243 | Five places touch pregnancy. |
| Housing | 256–257 (6); the patient's living situation in the chart (MAIN 111) | Same list in spirit; MAIN 111 changes it (see section 6). |
| Substance use | Reason "Substance Use" 153; SUBSTANCE(S) 123 | 153 points at the Harm Reduction module. |
| Problem status | 33 (New, Chronic, Improving, Worse); the problem list (MAIN 108: New or Ongoing) | Different. |

## 6. The Oct 19 decisions

Only decisions that change a field, an option, a section or a flow of a note type. Decisions about the Focused Exam's own fields are listed but their SPEC lines are after 332 and were not checked here.

| Decision | MAIN line | SPEC lines touched | State |
|---|---|---|---|
| One encounter holds several note types ("Add another note type") | 97 | every category (5–332); no such control is written | not in SPEC at all |
| The note type is called "Psych and behavioral health" | 97 (also "Behavioral health", 400) | 150 ("Psychological") | SPEC still shows the old version (a naming difference; MAIN 408 uses "Psychological") |
| The full Medical form gets a chief concern | 98 | 9 | already in SPEC |
| The full Medical form gets a free-text HPI | 98 | 11–13 | SPEC still shows the old version (the box is there but titled "Chief Concern"; MAIN 420 fixes the title) |
| Save & Close keeps a draft; Complete finishes it; incomplete notes are listed and alerted | 99 | none | not in SPEC at all |
| A synced draft merges field by field; a differing value is never overwritten silently | 100 | none (applies to every field) | not in SPEC at all |
| After Complete, the patient's chart opens | 101 | none | not in SPEC at all |
| Physical exam is multi-select | 102 | 26–27 (the picker) | not in SPEC at all (SPEC states no mode) |
| Disposition is multi-select and blocks contradictory pairs | 102 | 57–58 | not in SPEC at all (SPEC states no mode and no pairs) |
| Cardiovascular rate and rhythm are separate questions | 103 | Focused Exam, after 332 | not checked here |
| MSK adds tone beside strength; MSK adds Right, Left or Bilateral | 103 | Focused Exam, after 332 | not checked here |
| Wound care adds Right, Left or Bilateral | 103 | 69–72; 298–299 | not in SPEC at all |
| Cellulitis joins the wound type list | 103 (and 410) | 73–76; 296–297 | SPEC still shows the old version |
| Vascular "Temp change" becomes Warm or Cool | 103 | Focused Exam, after 332 | not checked here |
| The STI section is renamed Testing History, with a date and result per test | 103 | 246–247 ("Testing"); possibly "STI" at 20 | SPEC still shows the old version (which section is meant: see A34) |
| Pregnancy test moves to the top of the Pregnancy section and loses "Not done" | 103 (and 417) | 177–186 (the test is last, 185–186, with 3 options) | SPEC still shows the old version |
| "Dressing applied" keeps its chips and adds Other, which opens a text box | 103 | 304–305 (no Other); 110–113 (has Other, no text box shown) | SPEC still shows the old version |
| Orders are grouped by category: OTC, Rx, Labs and admin-added ones | 104 | 318–319 (OTC, Prescription only) | SPEC still shows the old version |
| Labs are point-of-care tests; the app records the test and its result; no send-out labs | 104 | 185–186; 246–247; 19–22 | not in SPEC at all (only the pregnancy test has a result) |
| A problem can be added by hand with a code and New or Ongoing status | 108 | 31–33 (status has 4 other values) | SPEC still shows the old version (different status list) |
| Living situation: "Doubled up" becomes "Couch surfing"; Unknown stays; Other opens a text box | 111 | 256–257 (has Doubled-up, no Other) | SPEC still shows the old version (if Housing Status uses the same list: see A37) |
| Referrals in V1 record only a date and free text; referral status moves to V2 | 113 | 266–267 (Referral Status); also 148, 265, 313–316 | SPEC still shows the old version (266–267 is now outside V1; 313–316 already fits) |
| Pregnancy can be a secondary flag on the patient | 120 | 177–243 | not in SPEC at all |
| Sensitive details, pregnancy included, are hidden from Billing and Data | 121 | 173–251 | not in SPEC at all |
| Each item is counted in the unit it is given out in | 127 | 134 ("x doses"); 136; 275; 310 | already in SPEC for naloxone (doses); nothing for the other supplies |
| Substance use treatment records stay out of Logistics' view until counsel decides | 145 | 120–148, mainly 139–148 | not in SPEC at all |

## 7. What MAIN module 4 requires of forms that SPEC does not show

| MAIN line | Requirement |
|---|---|
| 379 | The user chooses Medical or Non-Medical first. Non-Medical has no orders, co-signing or billing codes, but still deducts supplies. |
| 379 | A Non-Medical encounter can switch to Medical partway through, keeping what is filled in. |
| 380 | Choosing an encounter type loads its template. |
| 381 | Sections are accordions of checkboxes and dropdowns. |
| 382 | One or more order sets are applied, and the suggested orders and supplies confirmed. |
| 383, 433 | Every encounter ends on a summary screen: an automatic recap of what was tapped in each module, a free-text assessment, one-tap follow-up tasks and suggested next steps. |
| 384 | A referral or a follow-up can be created from the encounter. |
| 385, 452 | The note is signed, or sent to a co-signer; a signed note is locked. |
| 387 | Each team's admin can use, edit, remove or add note types. Edits are versioned; past notes keep their template. A used note type is archived, not deleted. A platform update never overwrites a team's edited copy. |
| 390 | A preset "Brief call note" with a quick outcome (confirmed, left voicemail, no phone). It is not in SPEC 1–332. |
| 392 | Staff add as many modules as the visit needs; each collapses to a one-line summary. |
| 394–403 | The module table treats Outreach / community as its own module; MAIN 408 calls it the second subsection of Social needs. |
| 399 | Connect to resource names a resource per treatment (one for buprenorphine, one for methadone). |
| 409 | The Quick encounter is always Medical; its Medication section needs an ordering credential. |
| 409 | Any part of a quick encounter can be expanded into its full module without re-entering answers. So quick and full fields must share ids or a mapping. |
| 409, 422 | Quick HPI: Yes opens a text box. |
| 409 | The quick form keeps red flags and disposition, "like every Medical form". SPEC shows them only in General / Primary Care. |
| 410 | One master option list per field, shared by the quick form and the full modules. |
| 410 | Wound location: the body map and the quick regions store the same region codes. |
| 411 | Measurements can be entered in cm or inches and are stored in cm. |
| 412 | Dictation is V2; every narrative field is a text box in V1. |
| 413 | The handoff summary is shown full-screen and can be exported as a PDF; both are audit-logged. No copy or share. |
| 414 | The Focused Exam lives only inside General / primary care, after Vitals; all systems are shown at once; [+ Add exam]; a one-tap Normal per system. |
| 415 | Sensitive exams (GU, breast, rectal) are hidden unless selected, need an extra permission, never show on the overview, and need chaperone and consent recorded; no signing without consent. GU is a button at SPEC 27. |
| 416 | Open skin found in an exam hands off to Wound care; nothing is charted twice. |
| 417 | Current pregnancy details appear only once a pregnancy is confirmed. |
| 418 | Medication delivery = Yes creates a delivery task with the instructions. |
| 419 | Emoji become design-system icons. |
| 420 | HPI gets its own text box; para is its own field; menstrual and pain values are examples, not defaults. |
| 422 | There is no separate Odor field. |
| 424–431 | Any template field can be tied to an inventory preset; admins can edit the mappings. The mapping fires on the action field, not the screening question. |
| 426 | A vaccine marked Given records lot number and expiry. |
| 435 | A permission hides the behavioral health, harm reduction and reproductive modules from roles that do not need them. |
| 445 | Clinical red-flag prompts come before a bundle. |
| 447, 450 | A bundle or order with a medication needs a Medical encounter, an ordering credential and the allergy check first. |
| 458 | A draft saves as the author types. |
| 459–460 | After signing, changes are addenda and per-field corrections with a reason. So every field needs a stable id and a readable label. |

## 8. Transcription work-list

Lines 1 to 4 are a title and need no card. Lines 149 and 172 are blank. Every piece is under 120 lines. 14 pieces; the field counts add up to 127.

| # | Note type | Part | SPEC lines | Fields |
|---|---|---|---|---|
| 1 | General / Primary Care | Subsection 1 (Reason for Encounter) and Subsection 2 (History of Present Illness: narrative, Preventative Care, Vitals, Focused Exam picker) | 5–28 | 14 |
| 2 | General / Primary Care | Subsection 3, its Problem part (Assessment: diagnosis search, Status, Intervention), and Encounter Summary | 29–35, 61–62 | 4 |
| 3 | Wound Care | Subsection 1 (Wounds) and Subsection 2 (WOUND 1: location to systemic symptoms) | 63–103 | 14 |
| 4 | Wound Care | Subsection 3 (WOUND TREATMENT) | 104–119 | 6 |
| 5 | Harm Reduction | Whole note type | 120–148 | 12 |
| 6 | Psychological | Whole note type | 150–171 | 7 |
| 7 | Sexual and Reproductive | Reason, and the Pregnancy, Contraception and Menstrual Health blocks | 173–203 | 14 |
| 8 | Sexual and Reproductive | The "If [ Pregnant ]" block: Current Pregnancy, Pregnancy History / Current Complications, Current Symptoms | 204–243 | 7 |
| 9 | Sexual and Reproductive | Symptoms, Testing, Prevention, Follow-up | 244–251 | 4 |
| 10 | Social Needs | Subsection 1 (Current Needs, Housing Status, Resources, Recommended Sources, Referral Status) | 252–267 | 5 |
| 11 | Social Needs | Subsection 2 (Outreach / Community Encounter) | 268–282 | 6 |
| 12 | Patient Encounter | Subsection 1, first half: the selector row, If GENERAL, If WOUND | 283–307 | 16 |
| 13 | Patient Encounter | Subsection 1, second half (If SOCIAL NEEDS, If MEDICATION), Subsection 2 and Subsection 3 | 308–332 | 10 |
| 14 | Red flags and disposition (`red_flags_disposition`, a note type of its own: forms 6.2) | From Subsection 3 of General: Red Flags with the EMS branch, Disposition, Follow Up | 36–60 | 8 |

Notes for the cards:

- Piece 8 hangs off the Reason row in piece 7 (line 176), and piece 13 off the selector in piece 12 (line 285). Each card must name the parent field's id.
- Piece 9 is short; it can be joined to piece 8 (204–251, 48 lines, 11 fields) if fewer cards are wanted.
- Pieces 1, 3, 7 and 12 hold option lists that section 5 says are shared. Decide the shared list names before those cards are written.
- Piece 14 (`red-flags`) was cut out of piece 2 (`general-2`) once the red flags became a note type of their own (forms 6.2): it has its own three files under `definitions/spec/`, and piece 2 is lines 29 to 35 and 61 to 62. Lines 61 and 62, the Encounter Summary, are the visit's assessment (lifecycle 9.6), not a field of any note, so no definition types them: piece 2's diff file declares their words. The field count keeps this inventory's way of counting.
- Each card should carry the fixes from section 6 and section 9 that touch its lines, so the small model does not copy the old version.

## 9. Ambiguities, contradictions and gaps

Each has the lines and a suggested default. Defaults the PRD leaves open should become `PLAN-OPEN:` rows.

**Across the whole specification**

- **A1. Choose-one or choose-many is never stated** (all 79 button rows). Default: the mode marked in section 3. Rule of thumb used: a status, a yes/no question, a severity or an amount is choose-one; a list of things found, done or given is choose-many. MAIN 102 settles lines 27 and 58 (many). The least certain: 8, 22, 91, 119, 133, 190, 251, 271, 299, 319.
- **A2. "Other" has a text box in only 2 of 19 rows** (228, 243). Default: every "Other" opens a short text box (MAIN 103 says so for dressings).
- **A3. No field is marked required.** Default: nothing is required except what a rule in MAIN needs (EMS time when EMS is activated; consent for sensitive exams).
- **A4. No exclusive options are marked** (58, 103, 107, 109, 115, 229, 245, 251, 277). Default: None, No and None known clear the rest of their row.
- **A5. Red flags and Disposition are written only in General / Primary Care** (36–58), but MAIN 409 says every Medical form has them. Default: one shared red-flag and disposition section per encounter, not one per module.
- **A6. Follow-up is asked in five different ways** (60, 119, 251, 282, 328–332). Default: keep each list as written, and have all of them create the same kind of follow-up task.
- **A7. Medical or Non-Medical is stated only for General, Social Needs and the Quick encounter** (MAIN 98, 379, 409). Default: Wound Care, Harm Reduction, Psychological and Sexual and Reproductive are Medical; ask about Harm Reduction (MAIN 447).
- **A8. Outreach is a subsection of Social Needs in SPEC (268) and MAIN 408, but its own module in MAIN 403.** Default: two modules, `social_needs` and `outreach`, in one category, so staff can add either alone.
- **A9. The task index lists seven top-level starts and leaves out Psychological (150).** Default: treat 150–171 as the fourth category.
- **A10. Vitals have no units, ranges or format** (24, 292). Default: BP as two whole numbers in mmHg, HR per minute, SpO₂ in percent, RR per minute, temperature in °F with a °C switch, pain 0 to 10. To confirm with the clinical team.

**General / Primary Care**

- **A11. The HPI box is titled "Chief Concern"** (12). Default: label it "History of present illness" (MAIN 420).
- **A12. "Status (for each vaccine)" is clear; "Action" is not** (21–22). Default: Action is asked once per screening picked, choose-many.
- **A13. `[+ ADD VITAL]` does not say what is added** (25). Default: a second full set of vitals with its own time; ask whether extra kinds (weight, glucose) are wanted.
- **A14. The Focused Exam sits under Vitals and shows 10 buttons** (26–27), while MAIN 414 says all systems of the Focused Exam category are shown. Default: ignore the 10-button row; use the systems from SPEC 333 on.
- **A15. `[ + ADD ANOTHER MODALITY ]`** (28) is not explained. Default: the same as MAIN 414's [+ Add exam].
- **A16. Problem: one or many, and is Intervention per problem?** (31–35). Default: a repeating group of diagnosis, status and interventions.
- **A17. Problem status has four values** (33); the chart's problem list has New or Ongoing (MAIN 108). Default: keep the four in the note; map New to New and the other three to Ongoing on the problem list.
- **A18. UNCERTAIN has no follow-up** (38). Default: no branch; it shows in the summary.
- **A19. "If NO:" does not say which question** (46). Default: it follows "Patient agrees to transport?" = NO. "TIME EMS CALLED" (51) shows only when "EMS activated?" is YES.
- **A20. `[ COPY / SHARE HANDOFF ]` (56) contradicts MAIN 413.** Default: MAIN wins: "Show handoff" full-screen and "Export PDF".
- **A21. Disposition mixes overlapping answers** (58: Follow-up, ED, ED referral, EMS, Transport arranged, None, Declined), and only one blocked pair is given (MAIN 102). Default: None blocks all others; Declined blocks ED, EMS, ED referral and Transport arranged; ask for the full list.
- **A22. "Specific date" has no date input** (60). Default: it opens a date picker.
- **A23. Encounter Summary has no subsection number** (61). Default: treat it as the fourth subsection; MAIN 433 moves the summary to the end of the whole encounter.
- **A24. Intervention and Action options name other parts of the product without a link** (22, 35). Default: they are record-only chips; orders, referrals and supplies are entered in their own screens, with the supply mapping of MAIN 424.
- **A25. "Given today" needs lot and expiry** (18; MAIN 426) and SPEC has no such fields. Default: captured on the supply confirmation screen, not in the form.

**Wound Care**

- **A26. Is WOUND TREATMENT per wound or per note?** (104–119; it is a sibling of WOUND 1, not inside it). Default: per wound, since dressing and photos belong to one wound.
- **A27. The body map has no region list, and "FRONT BACK" may be a second control** (69–72). Default: one control; regions are the codes behind 299 plus front or back and a side (MAIN 103, 410).
- **A28. Two wound type lists** (74–76, 297). Default: the master list in MAIN 410.
- **A29. cm only at 82, in. or cm. at 301.** Default: a unit switch on both, stored in cm (MAIN 411).
- **A30. Drainage Type has its own None** (91). Default: Type shows only when Amount is not None; Type is choose-one.
- **A31. When does `[+ SHOW INFECTION DETAILS]` open, and does "Urgent" do anything?** (97–98). Default: always available, opens by itself for Possible, Yes and Urgent; Urgent prompts the red-flag question.
- **A32. Fever and Chills are in both infection rows** (100–101, 103). Default: keep both as written.
- **A33. Photo buttons are a capture flow, and no limit is given** (117). Default: up to 5 photos per wound, as at 307.
- **A34a. Wound MEDICATION** (115) does not say whether it places an order. Default: record-only; the order is placed in Orders.

**Harm Reduction**

- **A35. LAST USE: overall or per substance?** (125). Default: overall.
- **A36. Naloxone mode and doses** (133–134). Default: choose-one; the stepper shows for Accepted and starts at 1.
- **A37a. "If yes:" under a Yes / Maybe / No question** (145–147). Default: show for Yes and Maybe.
- **A38. `[ CONNECT TO RESOURCE ]` is nested under "Interested in treatment?"** (148). Default: always shown in the section; it opens Add referral (V1 referral: date and free text, MAIN 113).

**Psychological**

- **A39. The full safety assessment and the mental status exam have no fields** (164–166). Default: ship the expanders with one text box each, and ask the clinical team for the lists; check whether "psychiatric observation" in the Focused Exam (MAIN 397) is the MSE.
- **A40. SAFETY is an empty heading** (157). Default: it groups 158–164.
- **A41. No effect is written for Active thoughts or an immediate safety concern** (159–163). Default: either one prompts the shared red-flag question (A5).
- **A42. Three names: Psychological (150), Behavioral health (MAIN 400), Psych and behavioral health (MAIN 97).** Default: id `psychological`; label to be confirmed.

**Sexual and Reproductive**

- **A43. "If [ Menstrual Health ]" (193) matches no button; the button is "Menstrual" (176).** Default: same thing.
- **A44. "If [ Pregnant ]" (204) matches no button.** Default: the block shows when Pregnancy Test is Positive (MAIN 417 "once a pregnancy is confirmed"); ask whether a known pregnancy on the chart should also open it.
- **A45. Pregnancy Test is last and has "Not done"** (185–186). Default: MAIN 103 wins: first in the block, Positive or Negative only.
- **A46. LMP is asked twice** (184, 197). Default: one stored value shown in both blocks; the "Approximate" tick applies to both.
- **A47. Para reads "G [number] P [number]"** (213). Default: gravida and para are two whole numbers (MAIN 420).
- **A48. The two pregnancy lists have no "Buttons:" label, and the first mixes history with current complications** (214–243). Default: both choose-many; "None known" exclusive; no "None" added to Current Symptoms.
- **A34. Which section becomes "Testing History"?** (MAIN 103; SPEC 246–247, or "STI" at 20). Default: 246–247 becomes a repeating group of test, date and result; result options are not given anywhere (suggest Positive, Negative, Pending, Unknown, to confirm).
- **A49. Typical Cycle, Typical Duration and Pain show values** (198, 199, 203). Default: empty number fields (MAIN 420).

**Social Needs**

- **A37. Is Housing Status the patient's living situation?** (256–257; MAIN 111). Default: the same master list with MAIN 111's changes (Couch surfing, Other with text); the note stores its own answer and offers to update the chart.
- **A50. Referral Status** (266–267) is V2 by MAIN 113. Default: leave it out of V1; `[ CONNECT ]` (265) creates a V1 referral.
- **A51. The example resource card names a real organization** (263–265). Default: do not copy it into demo data; use a "Demo:" resource.
- **A52. Which needs suggest which resources** (261) is not given. Default: resources carry need tags; the list shows resources whose tags match the needs tapped.
- **A53. Outreach "Unable to locate"** (273) leaves the other fields meaningless. Default: no rule in V1.

**Patient Encounter (Quick encounter)**

- **A54. HPI is Yes / No / Unknown with no text box** (290). Default: Yes opens a text box (MAIN 409).
- **A55. No red flags or disposition** (283–332). Default: MAIN 409 wins; see A5.
- **A56. Two assessment boxes** (294 and 326). Default: keep both; 326 is the encounter-level summary (same field as 62).
- **A57. "Follow up" is named twice** (328–329). Default: one section with a text box and a date.
- **A58. Location regions overlap** (299: Upper Body, Back, Abdomen, Lower Body, Legs). Default: choose-one, plus a side (MAIN 103).
- **A59. Dimensions are not labelled** (301). Default: length × width × depth (MAIN 404).
- **A60. Order has only OTC and Prescription and no item** (319). Default: each button opens the Orders screen at that category (MAIN 104); Prescription needs an ordering credential.
- **A61. Instructions for Delivery is not conditional** (322–323). Default: shown only when Delivery is YES.
- **A62. Quick Referral = Yes with a text box** (313–316). Default: it creates a V1 referral with today's date and the text.
- **A63. Quick lists differ from the full lists** (297, 303, 305, 310, 312). Default: one master list per field (MAIN 410); the quick form shows a subset by option code.

