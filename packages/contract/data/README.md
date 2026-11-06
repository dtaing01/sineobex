# Patient data shared by the API and the phone

Data files for patient search, duplicate matching and the problem list (phase 3 design, sections 5.1 and 9.5). `pnpm contract:generate` turns them into modules for both apps; `test/patient-data.test.ts` fails if a committed output differs from what these files give, so change a file here, regenerate, and commit both.

| File | What it holds | Source and licence | Generated into |
|---|---|---|---|
| `nicknames.csv` | Given names and their nicknames, one line per name; two tokens are equivalent when they share a line | [carltonnorthern/nicknames](https://github.com/carltonnorthern/nicknames), `names.csv` at commit `1524308b6859f04335693b76de86f349dc5b78da`, created by Old Dominion University's Web Science and Digital Libraries Research Group. **Apache License 2.0**: the licence text is `nicknames.LICENSE.txt`, and the file's header states what was changed (regrouped one line per name; four dotted initials and the two names left without a nickname dropped) | `services/api/src/patients/generated/nicknames.ts`, `apps/mobile/lib/patients/generated/nicknames.dart` |
| `nicknames-local.csv` | Spanish diminutives (José/Pepe, Francisco/Paco/Pancho, ...) and Arabic transliterations (Mohammed/Muhammad/...) the upstream list lacks | Written and reviewed by hand for this project | the same two files, after the upstream groups |
| `weak-tokens.txt` | Name words dropped before scoring unless nothing else is left ("Big Mike" finds "Mike") | This project (design 5.1) | `weak-tokens.ts`, `weak_tokens.dart` |
| `icd10cm-curated.csv` | 427 ICD-10-CM codes common in street medicine, with their official titles and a grouping for the phone | ICD-10-CM is published by CDC/NCHS and is in the **public domain**. Titles are the official long descriptions of the April 1, 2026 tabular list (FY2026); every code is billable there and unchanged by the FY2027 update (October 1, 2026). Codes with a 7th character carry the tabular's text for it (", initial encounter") | `apps/mobile/assets/problem_codes.json` |
| `sensitive-code-ranges.csv` | Code ranges whose problems are sensitive by default (shown only to `patients.view_sensitive`) | This project (design 9.5, 14.1 #6) | `sensitive-codes.ts`, `sensitive_codes.dart`, and the `sensitive` flag in `problem_codes.json` |

Open questions, each marked `PLAN-OPEN` in the design's section 14.1:

- **Nickname data** (#3): the upstream list is weighted toward older English names; the local supplement is the place to add what pilot staff hear.
- **The code list** (#5): Brooke and Mercy to review. The server checks a code's shape only, so changing this list never turns a phone's change into a sync rejection; a full online code search can come later.
- **Sensitive codes** (#6): F01–F99, O00–O9A, Z30–Z39, B20, Z21, A50–A64 and Z71.4x until counsel decides; 42 CFR Part 2 may widen it.

The accent map the phone's name normalizer uses (`unaccent-latin.json`) is generated from Postgres by the matching work and lives here too once it lands.
