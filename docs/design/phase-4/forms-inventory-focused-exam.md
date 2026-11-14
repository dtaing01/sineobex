# Forms inventory: Focused Exam

Inventory of the Focused Exam part of the field specification, for the phase 4 form-definition
design and for the transcription task cards. Nothing here is a design decision.

- **SPEC** = `prd/google-doc-contents.md`, lines 333 to 2036 (the file has 2,036 lines).
- **MAIN** = `prd/main.md`, lines 95 to 104 and 371 to 464.
- All line ranges are inclusive. A range starts on the heading line and ends on the last line with
  text. SPEC puts a blank line between every two text lines, so a list of N options spans 2N − 1
  lines.
- Option counts were checked by counting bullet lines in each range.
- "Field" means one named group of options, or one input (number, text, photo, map).
- Note for the planner: the task brief placed the Oct 19 Encounters decisions at MAIN 119 to 134.
  In the file they are at **MAIN 95 to 104**. Lines 119 to 134 hold routes, flags, inventory and
  admin decisions, none of which touch the Focused Exam.

## 1. How the Focused Exam part is laid out

**Overall shape.** SPEC 333 is the top-level entry "Focused Exam". SPEC 334 is its only child,
"General / Primary Care → Focused Exam". Under it are two blocks:

| Block | SPEC lines | What it is |
|---|---|---|
| Sixteen numbered systems | 336–1778 | The field definitions. Each system heading is `N\. Name`. |
| "Focused Exam Workflow — Sineobex" | 1780–2036 | Four steps: pick exams, review, a worked example of the screen, add more or continue. |

**Skeleton of a system.** There is a loose skeleton, not a strict one:

1. System heading (`1\. General Appearance`, SPEC 336).
2. Sometimes one line of guidance under the heading (SPEC 390, 914, 1226, 1334, 1438, 1512, 1568,
   1600, 1666). Three of these are the rule "Hidden by default unless specifically selected."
3. Lettered parts (`A. Quick Status`, SPEC 338). There are 68 lettered parts in all.
4. Inside a part, either a bullet list of options directly, or one or more unlettered named groups
   (`Pupils`, SPEC 394), each with its own bullet list.
5. Sometimes a follow-up block introduced by an "If …" line (SPEC 408, 634, 1096, 1388, 1552, 1590).
6. Sometimes a single input line (`Intensity: _ / 6`, SPEC 656).

Indentation carries no meaning: every line sits at the same indent. Structure is read from the
heading style only (number, letter, bare name, bullet `•`, sub-bullet `◦`). Sub-bullets `◦` appear
only at SPEC 516–520.

**How "Normal" is marked.** SPEC never marks it. There is no "Normal" button, no "all normal"
action and no flag on any option anywhere in lines 333 to 2036. Normal findings are ordinary
options mixed into each list, usually but not always first: "Normal" (SPEC 432), "Clear" (482),
"PERRL" (396), "Intact" (420), "None" (702), "No tenderness" (546), "Anicteric" (442), "Regular"
(614). Some lists have no normal option at all (for example Respiratory Symptoms, SPEC 802–814).
The one-tap Normal comes only from MAIN 414. So the definition format must let each field name its
normal option or options, and say when a field has none. Section 3 gives a suggested normal option
per field; these are suggestions for the clinical team to confirm, not SPEC text.

**How abnormal findings are marked.** They are not marked either. They are the other options in
the same list. Follow-up detail is tied to one specific abnormal option by an "If …" line.

**How sides of the body are marked.** Five different ways, with no shared rule:

| Way | Example | SPEC lines |
|---|---|---|
| Sub-choice under one option: Right, Left, Bilateral | Hearing → Decreased | 516–520 |
| The field written twice, once per side | Right pupil / Left pupil; Right Lung / Left Lung; Strength Right / Left; Monofilament Right / Left | 410–412; 754–784; 1000–1002; 1716–1726 |
| Side options mixed into a findings list | CVA: No tenderness, Right, Left, Bilateral; Edema location | 1376–1382; 716–724 |
| A separate Side field with two options, no Bilateral | Skin finding `Side: Right / Left`; Breast Side | 1256; 1534–1538 |
| A table with Right and Left rows | Foot pulses; workflow example pulses | 1694–1704; 1928–1990 |

Limbs are named in the label where needed (Right upper extremity and so on, SPEC 1154–1160).
Most findings lists have no side at all (ears, MSK region, lymph node groups, pulses in
Cardiovascular and Peripheral Vascular).

**How special tests are marked.** Only in MSK part H (SPEC 1042–1068). A list of named tests is
shown for the selected region. Each test takes exactly one of four results: Not performed,
Negative, Positive, Unable (SPEC 1058–1066). SPEC gives the test list for the shoulder only
(1046–1056) and says to apply the same structure to other regions (1068). Abdominal named signs
(Murphy sign, McBurney tenderness, SPEC 906–908) are plain options in a list, not tests with
results.

**How scores and measurements are marked.**

| Kind | Form in SPEC | SPEC lines |
|---|---|---|
| Score out of a fixed maximum | `_ / 6`, `_ / 10`, `_ / 5` | 656; 874, 972; 1000–1002, 1154–1160 |
| Stated scale | "Scale: 0–5" | 998 |
| Graded scale as options | pulses, edema, reflexes | 676–684, 702–712, 1196, 1458–1468, 1696 |
| Length with a unit | `_ mm`, `_ cm` | 410–412; 1312–1314, 1426, 1554 |
| Time with a unit | `Capillary refill: _ seconds` | 1490 |

Nothing in the Focused Exam is computed. There are no calculated scores, totals or risk levels.

**How sensitive exams are marked.** By one sentence under the heading: "Hidden by default unless
specifically selected." It appears for Genitourinary (GU) (SPEC 1334), Breast (1512) and Rectal
(1568). GU also has a privacy requirement: sensitive findings get extra privacy protection and do
not appear prominently on the patient overview (SPEC 1396).

**Chaperone and consent.** Only GU has them, in part D "Optional Sensitive Exam Workflow"
(SPEC 1384–1394): a tick "Exam performed"; if performed, `Chaperone: Yes / No`,
`Patient consent: Yes` (one value only, no "No"), and `Findings: Structured inputs` (not defined
further). Breast and Rectal have no chaperone or consent fields in SPEC. MAIN 415 requires both for
all three sensitive exams (see section 6).

**Outside the MVP.** SPEC marks nothing in lines 333 to 2036 as V2 or outside the MVP. The words
"optional" appear three times and mean "the clinician may skip it", not "later release": Reflexes
(SPEC 1188), the GU sensitive workflow (1384), and the Foot exam (1666).

## 2. Systems

MAIN 397 says "16 systems" and then names 19 things, because it lists eyes, ears, nose and
mouth/throat separately. SPEC has exactly 16 numbered systems, with HEENT as one system of four
parts. MAIN 414 and MAIN 831 say the picker shows all 16.

| # | System name as written in SPEC | Id | SPEC lines | Parts | Fields | Special behaviour |
|---|---|---|---|---|---|---|
| 1 | General Appearance | `general_appearance` | 336–386 | 3 (A–C) | 3 | Multi-select stated (386). Optional free text. |
| 2 | HEENT | `heent` | 388–608 | 4 sub-exams: Eyes, Ears, Nose, Mouth / Throat | 20 | Each sub-exam is its own screen (390). Follow-up for unequal pupils with mm sizes. Side sub-choice for hearing. |
| 3 | Cardiovascular | `cardiovascular` | 610–732 | 5 (A–E) | 14 | Follow-up block for murmur, with a score out of 6. Pulse grid: 5 sites, one scale. Oct 19 splits rate from rhythm (adds 1 field). |
| 4 | Pulmonary / Respiratory | `pulmonary` | 734–820 | 3 (A–C) | 8 | Same list per lung (right, left). Sputum details as two text fields. |
| 5 | Abdominal / GI | `abdominal` | 822–910 | 7 (A–G) | 9 | Pain score out of 10. Mass with a location text. Named signs as plain options. |
| 6 | Musculoskeletal (MSK) | `msk` | 912–1068 | 8 (A–H) | 17 (shoulder) | Region selector drives everything after it. Region-specific special tests, each choose-one of four. Scores out of 10 and out of 5 by side. Oct 19 adds tone and a side choice (adds 2 fields). |
| 7 | Neurologic | `neurologic` | 1070–1222 | 7 (A–G) | 22 | Quick screen that expands into 8 cranial-nerve groups when abnormal. Four limb strength scores out of 5. Reflex table (4 reflexes, one scale), optional and collapsed. Body-region picker for sensory location. |
| 8 | Skin | `skin` | 1224–1330 | 3 (A–C) | 10 (8 of them per finding) | Repeating "Add Finding" entry. Body map, side, surface, size in cm, photo. Follow-up question that links to an earlier finding. |
| 9 | Genitourinary (GU) | `gu` | 1332–1396 | 4 (A–D) | 7 | Sensitive: hidden unless selected. Chaperone and consent. Privacy rule for the overview. "Structured inputs" not defined. |
| 10 | Lymphatic | `lymphatic` | 1398–1434 | 2 (A–B) | 3 definitions; up to 11 when all 5 node groups are examined | Findings and size repeat for each node group picked. Compact one-line summary shown as an example. |
| 11 | Peripheral Vascular | `peripheral_vascular` | 1436–1508 | 4 (A–D) | 10 | Pulse grid: 6 sites, one scale. Capillary refill as a number and as a two-way choice. Oct 19 changes "Temperature change". |
| 12 | Breast | `breast` | 1510–1564 | 2 (A–B) | 8 | Sensitive: hidden unless selected. "Breast clock / body map" location. Side. Follow-up block for a mass. No chaperone or consent in SPEC. |
| 13 | Rectal | `rectal` | 1566–1596 | 3 (A–C) | 4 | Sensitive: hidden unless selected. Exam type gates part C. No chaperone or consent in SPEC. |
| 14 | Psychiatric / Behavioral Observation | `psych_observation` | 1598–1662 | 5 (A–E) | 5 | Must not duplicate the full Mental Status Examination in the Psych module (1600). |
| 15 | Foot / Diabetic Foot Exam | `diabetic_foot` | 1664–1742 | 5 (A–E) | 10 | Pulses by side on a 0 to 3+ scale. Monofilament by side. "Wound present? Yes" opens the Wound Care module. |
| 16 | Neck / Thyroid | `neck_thyroid` | 1744–1778 | 3 (A–C) | 3 | Plain lists only. |
| | Total | | 336–1778 | 68 lettered parts | about 161 | |

**Names: where MAIN and the SPEC picker differ from the SPEC headings.**

| SPEC heading | MAIN 397 name | SPEC picker name (1788–1820) |
|---|---|---|
| General Appearance | general appearance | General |
| HEENT | eyes, ears, nose, mouth/throat (four names) | HEENT |
| Cardiovascular | cardiovascular | Cardiac (the review step, 1826, says Cardiovascular) |
| Pulmonary / Respiratory | respiratory | Pulmonary |
| Abdominal / GI | abdomen | Abdomen |
| Musculoskeletal (MSK) | musculoskeletal (by joint) | MSK |
| Neurologic | neurologic | Neuro |
| Skin | skin | Skin |
| Genitourinary (GU) | GU | GU |
| Lymphatic | lymphatic | Lymph |
| Peripheral Vascular | peripheral vascular | Peripheral Vascular |
| Breast | breast | Breast |
| Rectal | rectal | Rectal |
| Psychiatric / Behavioral Observation | psychiatric observation | Psych |
| Foot / Diabetic Foot Exam | diabetic foot | Foot |
| Neck / Thyroid | neck/thyroid | Neck / Thyroid |
| (none) | (none) | Other (1820): a 17th picker entry with no definition |

The picker order (1788–1820) is also different from the numbered order: it moves Peripheral
Vascular and Foot up, and puts GU, Breast and Rectal apart from each other.

## 3. Each system in turn

Kinds used below: **chips** = a bullet list of options (choose-one or choose-many is not stated
unless noted); **text** = free text; **number** = numeric input with a unit; **score** = number out
of a fixed maximum; **grid** = one scale applied to each item of a list.
"Normal?" is the suggested normal option for one-tap Normal. It is not in SPEC.

### 3.1 General Appearance (SPEC 336–386)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Quick Status | 338–364 | 1 | chips, 13 options (340–364) | Well appearing, No acute distress | Ends with "Other", no text box stated. Distress levels exclude each other. |
| B. Mental / Behavioral Appearance | 366–380 | 1 | chips, 7 options (368–380) | Alert, Calm, Cooperative | Contains opposite pairs (Cooperative, Uncooperative). |
| C. Free Text | 382–384 | 1 | text "Additional findings" (384) | none | Optional (386). |
| UI note | 386 | 0 | prose | | "Mostly quick taps with multi-select." |

### 3.2 HEENT (SPEC 388–608)

Guidance at 390: split into Eyes, Ears, Nose, Mouth / Throat, not one large screen.

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Eyes: Pupils | 394–406 | 1 | chips, 6 (396–406) | PERRL | "Other" with no text box. |
| A. Eyes: If unequal | 408–416 | 3 | number mm, right (410); number mm, left (412); chips Reactive / Nonreactive (414–416) | none | Shown only when "Unequal pupils" is picked. Unclear if reactivity is per pupil. |
| A. Eyes: Extraocular Movements | 418–428 | 1 | chips, 5 (420–428) | Intact | |
| A. Eyes: Conjunctiva | 430–438 | 1 | chips, 4 (432–438) | Normal | |
| A. Eyes: Sclera | 440–444 | 1 | chips, 2 (442–444) | Anicteric | Reads as choose-one. |
| A. Eyes: Visual Symptoms | 446–458 | 1 | chips, 6 (448–458) | Vision normal | |
| A. Eyes: Other | 460–462 | 1 | text (462) | none | |
| B. Ears: External Ear | 466–478 | 1 | chips, 6 (468–478) | Normal | No side. |
| B. Ears: Ear Canal | 480–492 | 1 | chips, 6 (482–492) | Clear | No side. |
| B. Ears: Tympanic Membrane | 494–508 | 1 | chips, 7 (496–508) | Normal | Includes "Unable to visualize". No side. |
| B. Ears: Hearing | 510–520 | 2 | chips, 2 (512–514); side sub-choice Right, Left, Bilateral (516–520) | Grossly intact | Side shows under "Decreased". Line 522 is an empty bullet. |
| C. Nose | 524–542 | 1 | chips, 9 (526–542) | Normal | Options sit directly under the part heading. |
| C. Nose: Sinuses | 544–552 | 1 | chips, 4 (546–552) | No tenderness | |
| D. Mouth / Throat: Oral Mucosa | 556–570 | 1 | chips, 7 (558–570) | Moist | |
| D. Mouth / Throat: Dentition | 572–586 | 1 | chips, 7 (574–586) | Normal | |
| D. Mouth / Throat: Pharynx | 588–600 | 1 | chips, 6 (590–600) | Clear | |
| D. Mouth / Throat: Airway | 602–608 | 1 | chips, 3 (604–608) | Patent | |

Sub-exam ranges: Eyes 392–462 (9 fields); Ears 464–522 (5); Nose 524–552 (2); Mouth / Throat
554–608 (4).

### 3.3 Cardiovascular (SPEC 610–732)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Rate / Rhythm | 612–620 | 1 | chips, 4 (614–620) | Regular | Oct 19 (MAIN 103) splits this into rate (Normal, Tachycardic, Bradycardic) and rhythm (Regular, Irregular). SPEC is not updated. |
| B. Heart Sounds | 622–632 | 1 | chips, 5 (624–632) | Normal S1/S2 | "Other" with no text box. |
| B. If Murmur Is Present: Location | 634–646 | 1 | chips, 5 (638–646) | none | Whole block shows only when "Murmur" is picked. |
| B. Murmur: Character | 648–654 | 1 | chips, 3 (650–654) | none | |
| B. Murmur: Intensity | 656 | 1 | score out of 6 | none | |
| B. Murmur: Radiation | 658–668 | 1 | chips, 5 (660–668) | none | "None" excludes the rest. |
| C. Peripheral Perfusion: Pulses | 670–696 | 5 | grid: 5 sites (688–696) × scale of 5 (676–684) | 2+ | Scale is 2+, 1+, Trace, Absent, Unable to assess. No side. Conflicts with MAIN 414. |
| D. Edema: Severity | 698–712 | 1 | chips, 6 (702–712) | None | Choose-one by nature. |
| D. Edema: Location | 714–724 | 1 | chips, 5 (716–724) | none | Should show only when severity is not None (not stated). |
| E. Jugular Venous Distention (JVD) | 726–732 | 1 | chips, 3 (728–732) | None | |

### 3.4 Pulmonary / Respiratory (SPEC 734–820)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Work of Breathing | 736–750 | 1 | chips, 7 (738–750) | Normal | |
| B. Auscultation: Right Lung | 754–768 | 1 | chips, 7 (756–768) | Clear | |
| B. Auscultation: Left Lung | 770–784 | 1 | chips, 7 (772–784) | Clear | Same list as Right Lung. |
| B. Auscultation: Location | 786–794 | 1 | chips, 4 (788–794) | none | One Location for both lungs. Unclear which lung it describes. |
| B. Auscultation: Other Findings | 796–800 | 1 | chips, 2 (798–800) | none | |
| C. Respiratory Symptoms | 802–814 | 1 | chips, 6 (804–814) | none (leave empty) | No "None" option. |
| C. Sputum Details | 816–820 | 2 | text Color (818); text Amount (820) | none | Presumably shown when "Sputum" is picked (not stated). |

### 3.5 Abdominal / GI (SPEC 822–910)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Inspection | 824–838 | 1 | chips, 7 (826–838) | Flat | |
| B. Bowel Sounds | 840–850 | 1 | chips, 5 (842–850) | Normal | Reads as choose-one. |
| C. Palpation: Tenderness | 852–872 | 1 | chips, 9 (856–872) | None | "None" excludes the rest. |
| C. Palpation: Pain Severity | 874 | 1 | score out of 10 | none | |
| D. Peritoneal Signs | 876–884 | 1 | chips, 4 (878–884) | None | "None" is listed last here. |
| E. Mass | 886–892 | 2 | chips, 2 (888–890); text Location (892) | None | Location presumably shows when "Present". |
| F. Organomegaly | 894–900 | 1 | chips, 3 (896–900) | None | "None" is listed last. |
| G. Other Findings | 902–910 | 1 | chips, 4 (904–910) | none | "Other" with no text box. |

### 3.6 Musculoskeletal (MSK) (SPEC 912–1068)

Guidance at 914. Line 938: "Once a region is selected, display the following fields."

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Region Selector | 916–938 | 1 | chips, 9 regions (920–936), prompt "Where are you examining?" (918) | none | Gates parts B to H. One or many regions is not stated. "Other" region has no text box. Oct 19 adds Right, Left or Bilateral (MAIN 103). |
| B. Inspection | 940–956 | 1 | chips, 8 (942–956) | Normal | |
| C. Palpation | 958–972 | 2 | chips, 6 (960–970); score Pain out of 10 (972) | No tenderness | |
| D. Range of Motion (ROM) | 974–994 | 2 | chips Active, 4 (978–984); chips Passive, 4 (988–994) | Full | Same four options for both. |
| E. Strength | 996–1002 | 2 | score out of 5, Right (1000) and Left (1002); "Scale: 0–5" (998) | 5 | Oct 19 adds tone (hypertonic, hypotonic, isotonic) beside strength. |
| F. Neurovascular | 1004–1028 | 3 | chips Sensation, 4 (1008–1014); chips Pulses, 3 (1018–1022); chips Capillary Refill, 2 (1026–1028) | Intact; Intact; Less than 2 seconds | Pulses here use words, not a grade. |
| G. Gait | 1030–1040 | 1 | chips, 5 (1032–1040) | Normal | Differs from the Neurologic gait list. |
| H. Region-Specific Tests | 1042–1068 | 5 (shoulder) | list of tests by region; shoulder has 5 (1048–1056); each takes one of 4 results (1060–1066) | Not performed | "For each test, select one" (1058) is the only explicit choose-one in the Focused Exam. Tests for other regions are not in SPEC (1068). |

### 3.7 Neurologic (SPEC 1070–1222)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Mental Status | 1072–1084 | 1 | chips, 6 (1074–1084) | Alert, Oriented ×4 | ×4 and ×3 exclude each other. |
| B. Cranial Nerves: Cranial Nerve Screen | 1086–1096 | 1 | chips, 2 (1092–1094) | Grossly intact | Guidance at 1088 and 1096: quick screen first; expand detail only if Abnormal. |
| B. CN II | 1098–1102 | 1 | chips, 2 | Visual fields intact | The 8 CN groups show only when the screen is Abnormal. |
| B. CN III / IV / VI | 1104–1112 | 1 | chips, 4 | Extraocular movements intact (EOMI) | |
| B. CN V | 1114–1118 | 1 | chips, 2 | Facial sensation intact | |
| B. CN VII | 1120–1124 | 1 | chips, 2 | Symmetric facial movement | |
| B. CN VIII | 1126–1130 | 1 | chips, 2 | Hearing grossly intact | |
| B. CN IX / X | 1132–1138 | 1 | chips, 3 | Palate symmetric | |
| B. CN XI | 1140–1144 | 1 | chips, 2 | Shoulder shrug intact | |
| B. CN XII | 1146–1150 | 1 | chips, 2 | Tongue midline | |
| C. Motor Strength | 1152–1160 | 4 | score out of 5 for each of 4 limbs (1154–1160) | 5 | |
| D. Sensory | 1162–1174 | 2 | chips, 5 (1164–1172); "Location: Select body region" (1174) | Intact | The region list for Location is not given. |
| E. Coordination | 1176–1184 | 1 | chips, 4 (1178–1184) | Finger-to-nose normal, Heel-to-shin normal | |
| F. Reflexes | 1186–1208 | 4 | table: 4 reflexes (1194, 1198, 1202, 1206), each graded 0 / 1+ / 2+ / 3+ / 4+ | 2+ | "Optional expandable section" (1188). No side. Matches MAIN 414. |
| G. Gait | 1210–1222 | 1 | chips, 6 (1212–1222) | Normal | |

### 3.8 Skin (SPEC 1224–1330)

Guidance at 1226.

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Overall Skin | 1228–1244 | 1 | chips, 8 (1230–1244) | Warm, Dry | |
| B. Skin Findings: entry rule | 1246–1250 | 0 | action "+ Add Finding" (1248); one separate entry per finding (1250) | none | Repeating group. Zero entries is the normal state. |
| B. Location | 1252–1258 | 3 | body map (1254); Side: Right / Left (1256); Surface: Anterior / Posterior (1258) | | No Bilateral, no midline. |
| B. Type | 1260–1288 | 1 | chips, 14 (1262–1288) | | Includes Ulcer, Blister, Abscess, which MAIN 416 sends to Wound care. "Other" with no text box. |
| B. Characteristics | 1290–1308 | 1 | chips, 9 (1292–1308) | | |
| B. Size | 1310–1314 | 2 | number cm, Length (1312) and Width (1314) | | MAIN 411: enter in cm or inches, store cm. |
| B. Photo | 1316–1318 | 1 | photo "Add Photo" (1318) | | Count per finding not stated. |
| C. Longitudinal Tracking | 1320–1330 | 1 | question after each finding: "Is this the same lesion/wound documented previously?" Yes → link to existing finding; No → create new finding (1324–1328) | | Asked automatically (1322). Needs a list of the patient's earlier findings. |

### 3.9 Genitourinary (GU) (SPEC 1332–1396)

"Hidden by default unless specifically selected." (1334)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. General Findings | 1336–1356 | 1 | chips, 10 (1338–1356) | No acute findings | Mostly symptoms, not exam findings. |
| B. External Exam | 1358–1372 | 1 | chips, 7 (1360–1372) | Normal | |
| C. Costovertebral Angle (CVA) | 1374–1382 | 1 | chips, 4 (1376–1382) | No tenderness | Side is in the option list. Overlaps "CVA tenderness" in Abdominal (904). |
| D. Optional Sensitive Exam Workflow | 1384–1394 | 4 | tick "Exam performed" (1386); if performed: Chaperone Yes / No (1390); Patient consent: Yes (1392); Findings: Structured inputs (1394) | never filled by Normal (MAIN 415) | "Structured inputs" is not defined. |
| Privacy requirement | 1396 | 0 | prose | | Extra privacy; not prominent on the patient overview. |

### 3.10 Lymphatic (SPEC 1398–1434)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Nodes Examined | 1400–1410 | 1 | chips, 5 (1402–1410) | none | Choose-many by nature. "Other" with no text box. |
| B. Findings for Each Node Group | 1412–1426 | 2 per group | chips, 6 (1414–1424); number cm, Size (1426) | Not enlarged | Repeats for each group picked in A. Options are three opposite pairs. |
| Example of compact documentation | 1428–1434 | 0 | three example summary lines | | Uses the word "Normal", which is not an option in B. |

### 3.11 Peripheral Vascular (SPEC 1436–1508)

Guidance at 1438: kept separate from cardiovascular.

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Pulses | 1440–1468 | 6 | grid: 6 sites (1444–1454) × scale of 6 (1458–1468) | 2+ | Scale is 0, 1+, 2+, 3+, 4+, Unable to assess. No side. Conflicts with MAIN 414. |
| B. Extremity Findings | 1470–1486 | 1 | chips, 8 (1472–1486) | Warm | No side or limb. |
| C. Perfusion | 1488–1494 | 2 | number seconds, Capillary refill (1490); chips, 2 (1492–1494) | Less than 2 seconds | The number and the choice record the same thing. |
| D. Vascular Symptoms | 1496–1508 | 1 | chips, 6 (1498–1508) | none (leave empty) | Oct 19: "Temperature change" (1508) becomes Warm or Cool. |

### 3.12 Breast (SPEC 1510–1564)

"Hidden by default unless specifically selected." (1512)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Inspection | 1514–1528 | 1 | chips, 7 (1516–1528) | Symmetric | |
| B. Palpation: Location | 1532 | 1 | "Breast clock / body map" | | Not defined further. |
| B. Palpation: Side | 1534–1538 | 1 | chips, 2 (1536–1538) | | No Bilateral. |
| B. Palpation: Finding | 1540–1550 | 1 | chips, 5 (1542–1550) | No mass | "Other" with no text box. |
| B. If mass is present | 1552–1564 | 4 | number cm, Size (1554); text Location (1556); Mobile / Fixed (1558–1560); Tender / Non-tender (1562–1564) | none | Shows when "Mass" is picked. The four bullets 1558–1564 are two opposite pairs. Second Location duplicates 1532. |

No chaperone or consent fields in SPEC. MAIN 415 requires them.

### 3.13 Rectal (SPEC 1566–1596)

"Hidden by default unless specifically selected." (1568)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Exam Type | 1570–1574 | 1 | chips, 2 (1572–1574) | none | Reads as choose-one. |
| B. Findings | 1576–1588 | 1 | chips, 6 (1578–1588) | none (no normal option) | "Other" with no text box. |
| C. If DRE Performed | 1590–1596 | 2 | chips Normal / Abnormal (1592–1594); text Findings (1596) | Normal | Shows when Exam Type is DRE. |

No chaperone or consent fields in SPEC. MAIN 415 requires them.

### 3.14 Psychiatric / Behavioral Observation (SPEC 1598–1662)

Guidance at 1600: a brief observation; do not duplicate the full MSE of the Psych module.

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Appearance / Behavior | 1602–1616 | 1 | chips, 7 (1604–1616) | Calm, Cooperative | |
| B. Speech | 1618–1628 | 1 | chips, 5 (1620–1628) | Normal | |
| C. Affect | 1630–1642 | 1 | chips, 6 (1632–1642) | Appropriate | |
| D. Thought Process | 1644–1652 | 1 | chips, 4 (1646–1652) | Linear | |
| E. Orientation | 1654–1662 | 1 | chips, 4 (1656–1662) | all four | Choose-many: each tick means "oriented to". |

### 3.15 Foot / Diabetic Foot Exam (SPEC 1664–1742)

Guidance at 1666: optional focused exam.

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Inspection | 1668–1690 | 1 | chips, 11 (1670–1690) | Intact skin | No side. |
| B. Pulses | 1692–1704 | 4 | DP Right, DP Left (1696–1698); PT Right, PT Left (1702–1704); each 0 / 1+ / 2+ / 3+ / Unable | 2+ | The only pulse scale that matches MAIN 414. |
| C. Sensation | 1706–1726 | 3 | chips, 3 (1708–1712); Monofilament Right Normal / Abnormal (1716–1720); Left (1722–1726) | Intact; Normal; Normal | |
| D. Temperature | 1728–1734 | 1 | chips, 3 (1730–1734) | Warm | |
| E. Wound Present? | 1736–1742 | 1 | Yes → Open Wound Care module; No (1738–1740) | No | Workflow requirement at 1742: no duplicate wound charting; link to Wound Care. |

### 3.16 Neck / Thyroid (SPEC 1744–1778)

| Part | Lines | Fields | Kind and options | Normal? | Notes |
|---|---|---|---|---|---|
| A. Neck | 1746–1758 | 1 | chips, 6 (1748–1758) | Supple | Lymphadenopathy and JVD overlap Lymphatic and Cardiovascular. |
| B. Thyroid | 1760–1770 | 1 | chips, 5 (1762–1770) | Normal | |
| C. Carotids | 1772–1778 | 1 | chips, 3 (1774–1778) | Normal | No side. |

### 3.17 Focused Exam Workflow — Sineobex (SPEC 1780–2036)

| Step | Lines | What it holds | Notes |
|---|---|---|---|
| Step 1: Select the Exams | 1782–1820 | Prompt "What did you examine?" (1784). "Allow clinicians to select multiple exam categories." (1786). 17 entries (1788–1820): 16 systems and "Other". | Explicit choose-many. Names are short forms (see section 2). |
| Step 2: Review Selected Exams | 1822–1836 | An example selection of 4 (1826–1832); button "+ ADD EXAM" (1834); rule at 1836: only selected sections expand, the rest stay hidden. | |
| Step 3: Dynamic Exam Interface | 1838–2030 | A worked example for the 4 selected exams: Cardiovascular (1840–1890), Pulmonary (1892–1924), Peripheral Vascular (1926–2002), Skin (2004–2030). | Cut-down and partly different lists. Treat as illustration, not as definitions (see section 8). |
| Step 4: Add More Exams or Continue | 2032–2036 | Buttons "+ ADD EXAM" (2034) and "CONTINUE" (2036). | |

Step 3 detail, for comparison only:

| Example block | Lines | Differs from the numbered system how |
|---|---|---|
| Cardiovascular: Rate / Rhythm | 1842–1850 | Same 4 options as 614–620. |
| Cardiovascular: Heart Sounds | 1852–1860 | 4 options; drops "Other". No murmur follow-up. |
| Cardiovascular: Edema | 1862–1874 | Same 6 grades. |
| Cardiovascular: Location | 1876–1882 | Right, Left, Bilateral (3), against 5 options at 716–724. |
| Cardiovascular: JVD | 1884–1890 | No, Yes, Unable to assess, against None, Present, Unable to assess (728–732). |
| Pulmonary: Work of Breathing | 1894–1900 | 3 options, against 7. |
| Pulmonary: Right Lung, Left Lung | 1902–1924 | 5 options each, "Wheeze" singular, against 7 with "Wheezes". No Location. |
| Peripheral Vascular: DP and PT pulse tables | 1928–1990 | Rows Right, Left; columns 0, 1+, 2+, 3+ (tick boxes). Only 2 sites, by side, no 4+, no "Unable". |
| Peripheral Vascular: Skin | 1992–2002 | 5 options, against the 8 Extremity Findings (1472–1486); adds "Erythematous". |
| Skin: Overall Findings | 2006–2018 | 6 options, against 8. |
| Skin: Lesions / Wounds | 2020–2024 | Buttons "+ ADD FINDING", "ADD PHOTO". |
| Skin: Existing Finding | 2026–2030 | Link to previously documented lesion / wound; Create new finding. |

## 4. Catalogue of constructs (SPEC 333–2036)

Counts are approximate where marked "about".

| # | Construct | First line | How often | What a form definition must be able to say |
|---|---|---|---|---|
| 1 | System (a selectable exam) | 336 | 16 | A named, ordered unit with an id, a full name and a short picker label, that can be shown or hidden as a whole. |
| 2 | Lettered part inside a system | 338 | 68 | An ordered, titled group of fields inside a system. |
| 3 | Named field group inside a part | 394 | about 45 | A second level of title under a part, holding one options list or a few inputs. |
| 4 | Option chips | 340 | about 105 lists | A field with a fixed, ordered list of labelled options, and whether it is choose-one or choose-many. |
| 5 | Choose-many stated | 386 | 2 (also 1786) | That several options can be held at once. MAIN 102 makes this the default for the physical exam. |
| 6 | Choose-one stated | 1058 | 1 | That exactly one option is held. |
| 7 | Normal option, not marked | 396 | most lists | Which option or options one-tap Normal sets for a field, or that it sets nothing. |
| 8 | Option that excludes the others ("None", "Normal", "No tenderness") | 432 | about 40 lists | That picking this option clears the others, inside a choose-many field. |
| 9 | Opposite pairs inside one list (Mobile / Fixed, Tender / Non-tender, Cooperative / Uncooperative) | 378 | about 6 lists | That named options cannot be held together. |
| 10 | "Other" option | 364 | 12 (364, 406, 632, 646, 668, 910, 936, 1288, 1410, 1550, 1588, 1820) | That an option opens a text box for detail (SPEC states no text box; see section 8). |
| 11 | "Unable to assess" style option | 508 | about 12 | Nothing special beyond an option; it should not count as normal or abnormal. |
| 12 | Free text | 384 | 7 (384, 462, 818, 820, 892, 1556, 1596) | A text field with a label, optional. |
| 13 | Number with a unit | 410 | 7 (mm ×2, cm ×4, seconds ×1) | A numeric field with a unit, a sensible range, and (for cm) entry in inches stored as cm (MAIN 411). |
| 14 | Score out of a fixed maximum | 656 | 9 (/6 ×1, /10 ×2, /5 ×6) | A whole number with a minimum and maximum and a "/ max" display. |
| 15 | Graded scale as options | 676 | 8 lists (pulses ×4, edema ×2, reflexes ×1, example tables) | An ordered scale that several fields share by reference. |
| 16 | Grid: one scale for each item of a fixed list | 674 | 4 (CV pulses, PV pulses, reflexes, foot pulses) | A set of rows that all use the same options, shown as a compact table. |
| 17 | Grid over a chosen list ("for each node group") | 1412 | 1 | A group of fields repeated once for each option picked in another field. |
| 18 | Table layout | 1190 | 3 (1190–1208, 1928–1958, 1960–1990) | Rows and columns as a display form of constructs 16 and 20. |
| 19 | Inline options on one line (`Yes / No`, `0 / 1+ / 2+`) | 1196 | about 12 lines | Nothing new: the same as chips, written compactly. |
| 20 | The same field once per side (Right, Left) | 410 | 8 (pupils, lungs, MSK strength, foot pulses ×2, monofilament, example tables ×2) | A field that is recorded separately for right and left. |
| 21 | Side as its own field or sub-choice | 516 | 4 (516–520, 1256, 1534–1538, 1876–1882) | A side value (Right, Left, and where allowed Bilateral) attached to a finding. |
| 22 | Side mixed into a findings list | 716 | 2 (716–724, 1376–1382) | Options that are really a side; the designer may want to normalise them to construct 21. |
| 23 | Surface (Anterior / Posterior) | 1258 | 1 | A two-way choice attached to a location. |
| 24 | Follow-up shown when an option is picked | 408 | 6 stated (408, 634, 1096, 1388, 1552, 1590) and 4 implied (516, 816, 892, 714) | That a field or group is visible only while a named option of another field is selected, and what happens to its values when that option is cleared. |
| 25 | Screen first, expand detail if abnormal | 1088 | 1 | A special case of 24 over a group of eight fields. |
| 26 | Optional collapsed section | 1188 | 1 | That a part starts collapsed and can be skipped. |
| 27 | Selector that drives the fields after it (region) | 916 | 1 | That one field's value gates the rest of the system and selects a list (construct 28). |
| 28 | Test list that depends on a selected value | 1042 | 1 | A lookup from region to a list of named tests, each a choose-one over four shared results, with lists supplied later by the clinical team. |
| 29 | Repeating entry ("+ Add Finding") | 1248 | 2 (1248, 2022) | A group of fields that can be added zero or more times, each entry with its own identity. |
| 30 | Body map location | 1254 | 3 (1254, 1532 "Breast clock / body map", 1174 "Select body region") | A location field that stores a region code from a shared list (MAIN 410). |
| 31 | Photo | 1318 | 2 (1318, 2024) | An attachment field on an entry. |
| 32 | Link to an earlier record ("same lesion?") | 1322 | 2 (1322–1328, 2026–2030) | A question asked after an entry is added, whose Yes stores a reference to an earlier finding of the same patient. |
| 33 | Hand-off to another module | 1738 | 1 in SPEC (MAIN 416 adds Skin open-skin types) | That an answer opens another module in the same encounter and that the wound is charted there, not here. |
| 34 | Sensitive system, hidden by default | 1334 | 3 (1334, 1512, 1568) | A flag on a system that changes who may view it and where it may be shown. |
| 35 | Sensitive exam workflow: performed, chaperone, consent | 1384 | 1 in SPEC (3 per MAIN 415) | Fields that Normal never fills, and a rule that blocks signing until consent is recorded. |
| 36 | Privacy rule on display | 1396 | 1 | That a system's findings are left out of the patient overview. |
| 37 | Placeholder ("Findings: Structured inputs") | 1394 | 1 | Nothing; it is a gap (section 8). |
| 38 | Compact one-line summary | 1428 | 1 example | How a system or item reads when collapsed (MAIN 392, 433 need a recap per module). |
| 39 | Guidance prose and UI notes | 386 | about 14 (386, 390, 914, 938, 1044, 1068, 1088, 1226, 1330, 1438, 1600, 1666, 1742, 1836) | Nothing stored; some lines are rules the definition must carry (390, 938, 1088, 1742, 1836). |
| 40 | Scale label ("Scale: 0–5") | 998 | 1 | The range of a score field. |
| 41 | Same measure twice (number and choice) | 1490 | 1 | Either two fields or one; the only place where a value could be derived from another. |
| 42 | Exam picker | 1784 | 1 | A choose-many over the systems, with "add more later". |
| 43 | Action buttons | 1834 | 4 (1834, 2022–2024, 2034, 2036) | Screen flow, not a field. |
| 44 | Worked screen example | 1838 | 1 block (1838–2030) | Nothing; illustration only. |
| 45 | Empty bullet | 522 | 1 | Nothing; a stray line. |

## 5. Option lists and structures that repeat

**Lists that are the same or nearly the same.**

| What repeats | Where (SPEC lines) | Same or different |
|---|---|---|
| Lung findings | Right Lung 756–768; Left Lung 772–784 | Identical, 7 options. One shared list. |
| Range of motion | Active 978–984; Passive 988–994 | Identical, 4 options. |
| Special-test result | 1060–1066 | One list for every MSK test. |
| Reflex grade | 1196, 1200, 1204, 1208 | Identical: 0, 1+, 2+, 3+, 4+. |
| Foot pulse grade | 1696, 1698, 1702, 1704 | Identical: 0, 1+, 2+, 3+, Unable. |
| Pulse grade across systems | CV 676–684; PV 1458–1468; Foot 1696–1704; example 1932–1938; MSK 1018–1022 | Five different scales. MAIN 414 sets one: 0, 1+, 2+, 3+, unable to assess. |
| Pulse sites | CV 688–696 (5: Radial, Brachial, Femoral, DP, PT); PV 1444–1454 (6: Radial, Ulnar, Femoral, Popliteal, DP, PT); Foot DP and PT | Overlapping, not equal. Radial, Femoral, DP, PT appear in both CV and PV. |
| Edema grade | 702–712; 1864–1874 | Identical, 6 options. |
| Side: Right, Left, Bilateral | 516–520; 1378–1382; 1878–1882 | Same three values. |
| Side: Right, Left only | 1256; 1536–1538; pupils, lungs, strength, foot | Two values, no Bilateral. |
| Capillary refill | MSK 1026–1028; PV 1492–1494 | Identical, 2 options. |
| Sensation | MSK 1008–1014 (4); Neuro 1164–1172 (the same 4 plus Asymmetric); Foot 1708–1712 (Intact, Decreased, Absent) | Share a core. |
| Gait | MSK 1032–1040 (5); Neuro 1212–1222 (6) | Overlap: Normal, Antalgic, Unsteady, Ataxic. MSK has "Unable to assess"; Neuro has "Shuffling" and "Unable". |
| Strength out of 5 | MSK 1000–1002 (by side); Neuro 1154–1160 (by limb) | Same score, different rows. |
| Pain out of 10 | Abdominal 874; MSK 972 | Same score. |
| Normal / Abnormal | 1092–1094 (as Grossly intact / Abnormal); 1592–1594; 1718–1726 | Same two-way shape. |
| Mass or node descriptors: size cm, Mobile / Fixed, Tender / Non-tender | Lymphatic 1414–1426; Breast 1554–1564 | Same descriptors. |
| Skin temperature and colour words (Warm, Cool, Pale, Cyanotic) | General 358–362; Skin 1230–1244; PV 1472–1482; Foot 1730–1734 | Overlapping words in different lists. |
| Eye movement findings | Eyes 420–428; CN III / IV / VI 1106–1112 | Overlap: intact, Diplopia, Nystagmus. |
| Hearing | Ears 512–520; CN VIII 1128–1130 | Same finding charted in two systems. |
| Mental state words (Alert, Somnolent, Calm, Cooperative, Agitated) | General 368–380; Neuro 1074–1084; Psych 1604–1616 | Overlapping. |
| JVD | CV 728–732; Neck 1758 | Same finding in two systems. |
| CVA tenderness | Abdominal 904; GU 1376–1382 | Same finding in two systems. |
| Lymph nodes | Lymphatic 1402–1410; Neck "Lymphadenopathy" 1756 | Same finding in two systems. |
| Add finding, photo, link to earlier | Skin 1248–1328; example 2020–2030 | Same structure, shown twice. |
| "Hidden by default unless specifically selected." | 1334, 1512, 1568 | Identical sentence. |

**Systems that share a skeleton exactly.** No two systems have the same parts or the same lists.
What can be shared is the *shape*:

| Shape | Systems | What the shape needs |
|---|---|---|
| Flat: parts that each hold one chips list, with at most a free-text field | General Appearance; Psychiatric / Behavioral Observation; Neck / Thyroid; and the HEENT sub-exams Nose and Mouth / Throat | Constructs 1–4, 7, 8, 12. These five can use one definition shape with no conditions. |
| Flat plus simple follow-ups and scores | HEENT Eyes and Ears; Cardiovascular; Pulmonary / Respiratory; Abdominal / GI; Peripheral Vascular; Foot / Diabetic Foot Exam; Rectal | Adds follow-ups (24), numbers and scores (13, 14), per-side fields (20), pulse grids (16), one hand-off (33). |
| Sensitive | Genitourinary (GU); Breast; Rectal | The flat-plus shape with the hidden flag (34) and, per MAIN 415, the same chaperone and consent block (35). That block can be one shared piece. |
| One of a kind | Musculoskeletal (MSK) (region gate and test lookup); Neurologic (screen-then-expand, reflex table); Skin (repeating entry, map, photo, link); Lymphatic (fields repeated per picked item) | Each needs a construct no other system uses. |

## 6. What MAIN says, and the Oct 19 decisions

**Module 4 rules (MAIN 371–464).**

| MAIN line | What it says | SPEC lines it touches | Does SPEC already reflect it? |
|---|---|---|---|
| 392 | The tab is the field spec. Each module collapses to a one-line summary. | all; 1428–1434 | Partly. Only Lymphatic shows a compact line. |
| 396 | Focused exam is a field of General / primary care. | 334 | Yes. |
| 397 | "16 systems, tap-first", then 19 names. | 336–1778 | Count matches (16). Names differ: MAIN splits HEENT into four. |
| 406 | The tab is the source of truth for wording and option lists; MAIN holds the rules. | all | Rule for resolving conflicts: options from SPEC, behaviour from MAIN. |
| 409 | The quick form has no focused exam. | none | Not applicable to SPEC 333–2036. |
| 410 | One master list per field; body regions and the body map store the same region codes. | 1254, 1532, 1174, 920–936 | No. SPEC gives no region list for the map; MSK regions are a separate short list. |
| 411 | Measurements in cm or inches, stored in cm. | 1312–1314, 1426, 1554 | No. SPEC says cm only. Pupil size in mm (410–412) is not covered by the rule. |
| 412 | Dictation is V2; narrative fields are text boxes. | 384, 462, 818, 820, 892, 1556, 1596 | Yes (SPEC has no dictation here). |
| 414 | Lives only inside General / primary care, after Vitals. | 334 | Yes for placement; "after Vitals" is outside these lines. |
| 414 | Picker asks "What did you examine?", shows all 16 systems, any number can be tapped. | 1784–1820 | Mostly. SPEC has a 17th entry, "Other" (1820). |
| 414 | Only selected systems open; "+ Add exam" adds more before Continue. | 1834–1836, 2032–2036 | Yes. |
| 414 | Each system has a one-tap Normal that fills its normal findings. | every system | **No.** SPEC has no Normal action and marks no option as normal. |
| 414 | Details appear only when an answer calls for them (unequal pupils, a murmur, abnormal cranial-nerve screen). | 408–416, 634–668, 1096–1150 | Yes for these three. |
| 414 | Left and right are recorded where it matters. | see section 1 | Partly, and inconsistently. |
| 414 | Pulses use one scale: 0, 1+, 2+, 3+, unable to assess. | 676–684, 1458–1468, 1696–1704, 1932–1938, 1964–1970, 1018–1022 | **No.** Only Foot (1696–1704) matches. |
| 414 | Reflexes use 0–4+. | 1196–1208 | Yes. |
| 414 | MSK shows region-specific tests; the clinical team supplies the list per region; the tab only gives the shoulder. | 1042–1068 | Yes, and the gap is acknowledged. |
| 415 | Sensitive exams (GU, breast, rectal) are hidden unless selected. | 1334, 1512, 1568 | Yes. |
| 415 | They need an extra permission to view. | 1396 | Partly ("additional privacy protections", GU only). |
| 415 | They never show on the patient overview. | 1396 | Partly. SPEC says "not automatically appear prominently", for GU only. |
| 415 | Each records whether a chaperone was present and that the patient consented. | 1384–1394 | **GU only.** Breast and Rectal have neither. |
| 415 | One-tap Normal never fills those two; the note cannot be signed without consent recorded. | 1390–1392 | No. Not in SPEC. |
| 416 | Rashes, lesions and bruises are Skin findings, which ask "Same lesion as documented before?". | 1320–1330 | Yes. |
| 416 | Open skin (ulcer, abscess, laceration, burn) hands off to Wound care. | 1262–1288 | **No.** Skin Type lists Ulcer (1276), Blister (1278), Abscess (1286) with no hand-off. |
| 416 | A wound found in the diabetic foot exam hands off to Wound care. | 1736–1742 | Yes. |
| 387 | Note types are presets an admin can edit; edits are versioned. | all | Not a SPEC matter. The definition format must carry a version. |
| 424–431 | Any template field can be tied to an inventory preset. | all | Not in SPEC for the exam. No exam field names a supply. |
| 433 | The summary screen recaps what was tapped in each module. | all | Not in SPEC. Each option needs wording that reads well in a recap. |

**Oct 19 decisions (MAIN 95–104).**

| MAIN line | Decision | SPEC lines it touches | Does SPEC already reflect it? |
|---|---|---|---|
| 97 | One encounter holds several note types. | 334, 1738, 1742 | Not a field matter. It is what makes the hand-off to Wound care possible. |
| 99–100 | Drafts sync; changes merge field by field. | all | Not in SPEC. Every field, including each entry of a repeating group, needs a stable id. |
| 102 | Physical exam is multi-select. | all chips; stated only at 386 and 1786 | **No**, except General Appearance. See section 8 for lists where choose-many makes no sense. |
| 103 | Cardiovascular rate (Normal, Tachycardic, Bradycardic) and rhythm (Regular, Irregular) are separate questions. | 612–620, 1842–1850 | **No.** SPEC has one list of 4 and no "Normal" rate. |
| 103 | MSK adds tone (hypertonic, hypotonic, isotonic) beside strength. | 996–1002 | **No.** |
| 103 | MSK adds Right, Left or Bilateral. | 916–938 | **No.** |
| 103 | Vascular "Temp change" becomes Warm or Cool. | 1508 | **No.** SPEC still has the single option "Temperature change". |
| 103 | Other field changes (Cellulitis, Testing History, Pregnancy test, Dressing applied). | none in 333–2036 | Not applicable. |

## 7. Transcription work-list

One row per card. Ranges are inclusive and do not overlap. Line counts include the blank lines.
Every card should also be given the rules from sections 6 and 8 that change its lines.

| # | System | Part | SPEC lines | Lines | Fields |
|---|---|---|---|---|---|
| 1 | General Appearance | whole system (A–C and UI note) | 336–386 | 51 | 3 |
| 2 | HEENT | system intro and A. Eyes | 388–462 | 75 | 9 |
| 3 | HEENT | B. Ears | 464–522 | 59 | 5 |
| 4 | HEENT | C. Nose (with Sinuses) | 524–552 | 29 | 2 |
| 5 | HEENT | D. Mouth / Throat | 554–608 | 55 | 4 |
| 6 | Cardiovascular | A. Rate / Rhythm, B. Heart Sounds with the murmur follow-up | 610–668 | 59 | 6 (7 after the Oct 19 split) |
| 7 | Cardiovascular | C. Peripheral Perfusion, D. Edema, E. JVD | 670–732 | 63 | 8 |
| 8 | Pulmonary / Respiratory | whole system (A–C) | 734–820 | 87 | 8 |
| 9 | Abdominal / GI | whole system (A–G) | 822–910 | 89 | 9 |
| 10 | Musculoskeletal (MSK) | intro, A. Region Selector, B. Inspection, C. Palpation, D. ROM | 912–994 | 83 | 6 (7 with side) |
| 11 | Musculoskeletal (MSK) | E. Strength, F. Neurovascular, G. Gait, H. Region-Specific Tests | 996–1068 | 73 | 11 (12 with tone) |
| 12 | Neurologic | A. Mental Status, B. Cranial Nerves | 1070–1150 | 81 | 10 |
| 13 | Neurologic | C. Motor Strength, D. Sensory, E. Coordination, F. Reflexes, G. Gait | 1152–1222 | 71 | 12 |
| 14 | Skin | whole system (A–C) | 1224–1330 | 107 | 10 |
| 15 | Genitourinary (GU) | whole system (A–D and privacy rule) | 1332–1396 | 65 | 7 |
| 16 | Lymphatic | whole system (A–B and example) | 1398–1434 | 37 | 3 |
| 17 | Peripheral Vascular | whole system (A–D) | 1436–1508 | 73 | 10 |
| 18 | Breast | whole system (A–B) | 1510–1564 | 55 | 8 (10 with chaperone and consent) |
| 19 | Rectal | whole system (A–C) | 1566–1596 | 31 | 4 (6 with chaperone and consent) |
| 20 | Psychiatric / Behavioral Observation | whole system (A–E) | 1598–1662 | 65 | 5 |
| 21 | Foot / Diabetic Foot Exam | whole system (A–E) | 1664–1742 | 79 | 10 |
| 22 | Neck / Thyroid | whole system (A–C) | 1744–1778 | 35 | 3 |
| 23 | Focused Exam Workflow | Step 1 picker, Step 2 review, and Step 4 buttons | 1780–1836 and 2032–2036 | 57 + 5 | 1 (the picker, 17 entries) |
| — | Focused Exam Workflow | Step 3 worked example: **do not transcribe**; reference only | 1838–2030 | 193 | 0 |

That is 23 cards. Lines 333–334 are the two heading lines and need no card. The largest card is
Skin at 107 lines. Cards 4 and 5 can be merged (524–608, 85 lines, 6 fields) and so can cards 16
and 22 with a neighbour, if fewer cards are wanted.

Cards that are not plain transcription and need the designer's shape first: 10 and 11 (region
gate, tests), 12 (screen then expand), 13 (reflex table), 14 (repeating entry), 15, 18 and 19
(sensitive block), 16 (repeat per node group), 7 and 17 (pulse grids and the single pulse scale).

## 8. Ambiguities, contradictions and gaps

Each row gives a suggested default. None is decided here.

**Contradictions between SPEC and MAIN.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 1 | SPEC 676–684, 1458–1468, 1696–1704, 1018–1022 against MAIN 414 | Four pulse scales in SPEC; MAIN sets one (0, 1+, 2+, 3+, unable to assess). | MAIN wins for graded pulses in Cardiovascular, Peripheral Vascular and Foot: one shared scale. Keep the MSK Neurovascular pulses (Intact, Decreased, Absent) as a quick check, and ask the clinical team to confirm. "Trace", "Absent" and "4+" are dropped. |
| 2 | SPEC 612–620 against MAIN 103 | Rate and rhythm are one list in SPEC. | Two fields: Rate (Normal, Tachycardic, Bradycardic), Rhythm (Regular, Irregular), both choose-one. Normal fills Normal and Regular. |
| 3 | SPEC 996–1002 against MAIN 103 | No tone field. | Add Tone (hypertonic, hypotonic, isotonic) after Strength, choose-one. Whether tone is per side is not stated: default one value per region. |
| 4 | SPEC 916–938 against MAIN 103 | No side for the MSK region. | Add Side (Right, Left, Bilateral) straight after the region selector; not asked for Head / Neck and Back. |
| 5 | SPEC 1508 against MAIN 103 | "Temperature change" is one option. | Replace it with a follow-up choice Warm or Cool. This overlaps Warm and Cool in Extremity Findings (1472–1474); keep both and ask. |
| 6 | SPEC 1510–1596 against MAIN 415 | Breast and Rectal have no chaperone or consent. | Add the GU block (exam performed, chaperone Yes / No, consent) to all three as one shared piece. |
| 7 | SPEC 1392 against MAIN 415 | "Patient consent: Yes" has one value. | A single tick "Patient consented". Unticked blocks signing when the exam is marked performed. |
| 8 | SPEC 1262–1288 against MAIN 416 | Skin Type includes Ulcer, Blister, Abscess, with no hand-off; MAIN names ulcer, abscess, laceration, burn. | Picking Ulcer or Abscess offers "Chart in Wound care" as the Foot exam does (1738). Blister stays a Skin finding. Laceration and burn are not in the Skin list, so nothing to do. |
| 9 | SPEC 1820 against MAIN 414 | The picker has "Other", a 17th entry with no definition. | Keep "Other" as a free-text-only exam, or drop it. Default: keep, with one text field. |
| 10 | SPEC 1788–1820 against 336–1778 and MAIN 397 | Three sets of names for the same systems. | Ids from section 2. Full name from the SPEC heading; picker label from SPEC 1788–1820. |
| 11 | MAIN 397 against SPEC 388–608 | MAIN lists eyes, ears, nose, mouth/throat as systems; SPEC has one HEENT. | One system `heent` with four sub-exams, one picker entry (as SPEC 1790). Decide whether Normal is per sub-exam; default: one Normal per sub-exam, since each is its own screen (390). |
| 12 | SPEC 1838–2030 against 610–820, 1436–1508, 1224–1330 | The worked example uses shorter and different lists (see 3.17). | The numbered systems are the definitions. The example is illustration only. |

**Choose-one or choose-many.** SPEC states it only at 386, 1058 and 1786. MAIN 102 says the
physical exam is multi-select.

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 13 | all chips lists | Not stated per list. | Choose-many by default (MAIN 102), with the normal or "None" option clearing the others. |
| 14 | 440–444, 698–712, 726–732, 840–850, 886–890, 1024–1028, 1090–1094, 1456–1468, 1492–1494, 1570–1574, 1590–1594, 1694–1726, 1736–1740 | Lists that only make sense as choose-one (two-way choices, grades, yes or no). | Choose-one for grades, scales, two-way and three-way state lists. |
| 15 | 1570–1574 | Exam Type: can external inspection and DRE both be recorded? | Choose-one; DRE implies inspection. |
| 16 | 916–936 | One MSK region per exam, or several? | Several: the MSK block (B to H) repeats per region picked. This makes MSK a repeating group. |
| 17 | 1074–1084, 1558–1564, 1414–1424, 368–380 | Opposites in one list (Oriented ×4 and ×3; Mobile and Fixed; Tender and Non-tender; Cooperative and Uncooperative). | Mark each pair as excluding each other. |

**Sides of the body.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 18 | 464–508 | External ear, canal and tympanic membrane have no side, though ears are examined one at a time. | Record each per ear (Right, Left), as lungs are. Ask the clinical team. |
| 19 | 392–458 | Conjunctiva, sclera and eye movements have no side. | No side; use the free text (462). |
| 20 | 408–416 | Reactive / Nonreactive after the two pupil sizes: per pupil or one value? | Per pupil. |
| 21 | 786–794 | One lung Location for both lungs. | One Location per lung, shown when that lung is not Clear. |
| 22 | 714–724, 1876–1882 | Edema location mixes side and area; the example uses Right, Left, Bilateral. | Keep the five options of 716–724, choose-many. |
| 23 | 670–696, 1440–1468 | Pulses in Cardiovascular and Peripheral Vascular have no side; the example (1928–1990) and Foot do. | Record each pulse site by side (Right, Left). |
| 24 | 1256, 1534–1538 | Side is Right or Left only. | Skin: add Midline. Breast: add Bilateral for inspection findings; a mass stays one side. |
| 25 | 1186–1208, 1772–1778, 1470–1486, 1668–1690, 1728–1734 | Reflexes, carotids, extremity findings, foot inspection and foot temperature have no side. | Reflexes and carotids by side; the others one list plus free text. Ask. |

**Normal.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 26 | every system | No option is marked normal. | Use the "Normal?" column in section 3; have the clinical team confirm it before transcription. |
| 27 | 802–814, 1496–1508, 902–910, 796–800, 1576–1588, 1336–1356 | Lists of symptoms or abnormal signs with no normal option. | Normal leaves them empty. The recap should say nothing rather than "none" unless a "None" option is added. |
| 28 | 1152–1160, 996–1002, 1186–1208, 670–696 | Does Normal fill scores and grades (5/5, 2+)? | Yes: 5 out of 5 for strength, 2+ for pulses and reflexes. Pain scores are left empty. |
| 29 | 1246–1330, 1384–1394, 1736–1740, 916–936, 1400–1410 | What Normal does to repeating entries, sensitive fields, hand-offs and selectors. | Normal adds no entries, never fills chaperone or consent (MAIN 415), sets "Wound present?" to No, and does not pick an MSK region or node group. So MSK and Lymphatic Normal need a region or group picked first, or a system-level "all normal" line. Ask. |
| 30 | 1094, 1096 | After Normal, is the cranial-nerve detail stored? | No. Only the screen value "Grossly intact" is stored. |

**Follow-ups and missing detail.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 31 | 364, 406, 632, 646, 668, 910, 936, 1288, 1410, 1550, 1588 | "Other" has no text box. | Every "Other" opens a short text box (as MAIN 103 does for Dressing applied). |
| 32 | 816–820, 892, 714–724, 972, 874 | Follow-up implied but no "If" line: sputum details, mass location, edema location, pain scores. | Show sputum details when Sputum is picked; mass location when Present; edema location when severity is not None; pain score when any tenderness is picked. |
| 33 | 818–820 | Sputum Color and Amount are free text. | Keep as text. |
| 34 | 1394 | "Findings: Structured inputs" is undefined. | Use parts A to C of the same system as the structured findings; add one free-text field. |
| 35 | 1384–1386 | Does "Exam performed" gate parts A to C, or only part D? Part A is mostly symptoms. | It gates B (External Exam) and the chaperone and consent block. A and C can be charted without it. Ask. |
| 36 | 1068, 1044–1056 | Tests exist for the shoulder only. | Ship the shoulder list; other regions show no tests until the clinical team supplies lists (MAIN 414). The format must allow lists to be added without a code change. |
| 37 | 1174 | "Select body region" has no list. | Use the shared region codes of the body map (MAIN 410). |
| 38 | 1254, 1532 | The body map and "breast clock" are not specified. | Skin uses the same body map as Wound care. Breast: clock position 1 to 12 plus Central, with Side; no drawing in the MVP. Ask. |
| 39 | 1532, 1556 | Two Location fields for one breast mass. | One: the clock position. Drop the text Location at 1556, or keep it as a note. |
| 40 | 1318, 2024 | Number of photos per skin finding not stated. | Up to 5, as the quick encounter wound has (MAIN 404). |
| 41 | 1322–1328 | "Same lesion?" needs the earlier findings. Offline behaviour is not stated. | Offer the patient's earlier Skin findings held on the phone; if none are held, store "new" and allow linking later. |
| 42 | 1490–1494 | Capillary refill as a number and as a choice. | Keep the choice; the number is optional. Do not derive one from the other. |
| 43 | 410–412 | No range for pupil size; MAIN 411 covers cm and inches only. | Whole or half millimetres, 1 to 9, mm only. |
| 44 | 656, 874, 972, 1000–1002, 1154–1160 | Whole numbers only? | Whole numbers; ranges 1–6, 0–10, 0–10, 0–5, 0–5. |
| 45 | 1412–1434 | The example says "Normal" for a node group, but the options have no "Normal". | "Not enlarged" is the normal value and reads as "Normal" in the recap. |
| 46 | 1428–1434, MAIN 392, 433 | The one-line summary is shown for Lymphatic only. | Every system gets a generated recap: normal values collapse to "Normal"; abnormal values are listed. |
| 47 | 522 | Empty bullet after Hearing. | Ignore. |

**Overlaps that could lead to charting twice.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 48 | 420–428 and 1104–1112; 512–520 and 1126–1130; 728–732 and 1758; 904 and 1374–1382; 1402–1410 and 1756; 688–696 and 1444–1454 and 1692–1704 | The same finding can be recorded in two systems. | Keep them independent in the MVP, as SPEC does. Note it as an open question; do not link values across systems. |
| 49 | 1598–1662 | SPEC 1600 says this must not duplicate the Psych module's MSE. | Keep it as the short list given. No link to the Psych module. |
| 50 | 366–380, 1072–1084, 1602–1616 | Mental state words appear in three systems. | Leave as written. |

**Other gaps.**

| # | Lines | Problem | Suggested default |
|---|---|---|---|
| 51 | 1396, MAIN 415 | "Extra permission to view" for sensitive exams. The project allows no new permission types in the MVP. | For the designer: map to an existing permission key. Not a SPEC matter; flagged so it is not missed. |
| 52 | 1396 | The privacy sentence is written under GU only. | Apply it to GU, Breast and Rectal (MAIN 415). |
| 53 | 333–2036 | No field is marked required. | Nothing is required except consent when a sensitive exam is marked performed (MAIN 415). |
| 54 | 333–2036 | SPEC marks nothing as outside the MVP. | Treat everything as in scope, except: test lists for regions other than the shoulder (waiting on the clinical team), and any drawing-based breast map. |
| 55 | 1666 | "Optional focused exam": optional in what sense? | It is one of the 16 picker entries like any other. |
