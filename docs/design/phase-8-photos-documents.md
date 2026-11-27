> Draft plan (Nov 14), checked against the reviewed phase 4 design and the designs of the phases before it. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 8: Photos and documents
How to read the citations: "PRD 573" is line 573 of the product spec's main tab; "BP 110" is line 110 of its Build plan tab; "D20" is a decision in `IMPLEMENTATION_PLAN.md`. "lifecycle 4.5" and "forms 2.3" are sections of `docs/design/phase-4/lifecycle.md` and `forms.md`. Code is cited by file. A photo or a document page is called an **attachment** here; its bytes are the **file**.

## 1. Scope and Done when
**Done when** (BP 111, plan phase table): five wound photos taken offline upload after reconnecting and never appear in the camera roll.

| In | PRD |
|---|---|
| In-app capture only. Nothing touches the camera roll | 483, BP 110 |
| Wound photos on a note, up to 5 (the cap is data, so it can change after the pilot) | 398, 404, 486 |
| Profile photo on the patient record, shown hidden until tapped | 485, 721 |
| Documents: paperwork photographed in the app or uploaded on desktop, under the same rules | 727 |
| Encrypted on the phone until the server confirms receipt, then purged | 487, 573, 598 |
| Upload in resumable chunks; the server confirms only after hashing the whole stored file | 573, 608 |
| Server storage behind one interface: Supabase Storage (preview), encrypted S3 (production) | 488, BP 16 |
| Every view of a file logged like a chart read | 488, 625 |
| "Photos: 2 of 6" in the log-out alert; photos counted on the admin's device view | 575 |
| A removed user's photos go to quarantine with their records, never discarded | 560, 610–617 |

| Out | Who takes it |
|---|---|
| Retention periods and deletion jobs | Counsel first (PRD 489, 727); then phase 12 (S3 lifecycle) |
| KMS keys, bucket policy, Object Lock, CloudTrail on the bucket | Phase 12 (PRD 621, 643) |
| Photos in the route cache (offline viewing of old photos) | Phase 7 owns the route cache; default here is none (section 11) |
| "Wound history with dated photos and sizes" as a profile panel (PRD 728) | This phase supplies the list route and the viewer; the panel's sizes come from phase 4 notes. One card here places photos in it |
| Export, download, share or print of a file | Not offered on mobile (PRD 602); desktop exports are phase 10 |
| Video, audio, image annotation, OCR; malware scanning of desktop uploads | V2 or later; scanning in phase 12 (section 12, risk 6) |
| The wound form, its body regions, and the `photo` field kind with its `max` | Phase 4 (forms 2.2, 2.3; `docs/design/phase-4/forms-inventory.md` rows 143, 278, 330). This phase fills the placeholder that kind draws (forms 6.8) |
| Any change to what a signature covers, to corrections or to addenda | Phase 4 owns them (lifecycle 3.6, 4.5). Section 5.6 says how a photo sits beside them |
## 2. Ground truth
**What the code has today.**
| Fact | Where |
|---|---|
| A change is immutable, carries a SHA-256 of its canonical value, and leaves the phone only when a receipt's hash matches | `apps/mobile/lib/sync/local_store.dart` (header, `confirm`, `_deleteSettled`) |
| The purge deletes confirmed fields only after the record leaves active use; charts go when no scope or local work keeps them | `local_store.dart` (`_purgeRecords`, `_purgeCharts`) |
| The unsynced summary is counted from the outbox by category and sent with every push; the server stores it as sent | `local_store.dart` (`unsynced`), `services/api/src/sync/push.ts` (`unsynced_counts`) |
| One change, one transaction, in a savepoint; a failure of one change never stops the rest; quarantined changes answer with their stored hash | `services/api/src/sync/push.ts` (`processOne`) |
| Synced record kinds are a registry: one module per entity with its permission, parents, create and fields | `services/api/src/sync/entities/index.ts`; phone mirror `apps/mobile/lib/sync/entities.dart`; fake `apps/mobile/test/sync/fake_server.dart` |
| A removed user's phone hands its outbox to quarantine with the device key, then wipes | `apps/mobile/lib/sync/sync_engine.dart` (hand-over), `services/api/src/routes/devices.ts` (`/v1/devices/{deviceId}/quarantine`) |
| One 256-bit key per user, wrapped under the PIN, this-device-only; ten wrong PINs or a wipe destroy it. `seal`/`open` use AES-256-GCM | `apps/mobile/lib/security/key_vault.dart` |
| The database is one SQLCipher file per user and team, `sx_<who>_<team>.db`, in the app support directory, excluded from backup | `apps/mobile/lib/sync/local_db.dart`, `apps/mobile/lib/app_providers.dart` (`databaseDirectory`) |
| Android: `allowBackup="false"`, data extraction rules, `FLAG_SECURE`. iOS: `excludeFromBackup`, `secureCopy`, `bootClock` channel methods | `apps/mobile/android/app/src/main/AndroidManifest.xml`, `.../MainActivity.kt`, `apps/mobile/ios/Runner/AppDelegate.swift` |
| The phone has no camera, picker, share or image-cache package | `apps/mobile/pubspec.yaml` |
| 23 permission keys; derived rules live beside them and are pinned by `access.json` | `services/api/src/auth/permissions.ts`, `packages/contract/test-vectors/access.json` |
| `Deps` has no blob store yet, though D3 names one | `services/api/src/types.ts` |
| Migrations end at `0016`; phase 4 takes `0017`–`0021`, and phases 5 to 7 may take more | `db/migrations/`, lifecycle 2.1 |
| `patient_of_change` names every synced entity by hand; `lockTeamWrites` is the first statement of every online writer | `db/migrations/0009_patients.sql` (line 430), `services/api/src/sync/locks.ts` |
| There is no `apps/mobile/integration_test/` and no iOS build in CI | `ls apps/mobile`, plan risk 5 |

**What earlier, unbuilt phases must have delivered.** Phase 4 is designed and reviewed, not built; its names are used here as its design gives them.

| Phase | Thing this phase needs | If it is missing |
|---|---|---|
| 4 Encounters, forms | The `photo` field kind with a `max`. It stores nothing and draws "Photos arrive in a later release" (forms 2.2, 2.3, 6.8; `apps/mobile/lib/features/forms/photo_field.dart`, card F5-photo). A repeating section's entry ID is the second part of a path: `e` and seven characters (forms 2.3). `fieldAt`, `effectiveAnswers` and `visibleAnswers` (forms 7.1) | Wound photos cannot be attached. Profile photos and documents still work |
| 4 Encounters, lifecycle | The note is the unit, with an author and a state (D55). `encounter_notes.medical`, the Medical gate and whoever acts as a note's author (lifecycle 2.2, 3.8, 4.2; D56). A late change to a finished note is kept, never refused (lifecycle 3.6). A refusal only for what the worker can fix (lifecycle 4.1, D59) | The rules of 5.6 and 6.2 have nothing to stand on |
| 4 Encounters, lifecycle | `noteContentHash` (lifecycle 4.5, D57). This phase leaves it as it is: a photo is not in it (5.6) | Nothing |
| 4 Encounters, lifecycle | The chart answer's `timeline` and `recentVisits`, riding in `_chart`, whose keys `chart_cache.dart` names by hand (lifecycle 5.2, D67). The visit read and the portal's visit page (lifecycle 5.1, 9.11). `GET /v1/me/counts`, which names no patient (lifecycle 5.6) | The attachment list is read from its own route only |
| 5 Admin configuration | Nothing required. If team settings exist, the cap and the size limits become settings instead of constants | Constants stand |
| 7 Routes | Nothing. Photos are not in the route cache (section 11) | |
## 3. The design in one page
1. **An attachment is two things with two receipts.** A small synced record (who, what, which note, and the SHA-256 of the file) goes through the existing change protocol. The bytes go through upload routes. The phone deletes the file only when both are confirmed. Reason: the record is small and reuses every sync rule; the bytes need chunks.
2. **The file's hash is inside the record's value.** So the change's own hash-confirmed receipt fixes which file the server expects, before the bytes arrive, and a recorded photo can never be swapped for another.
3. **Chunks are 64 KiB and go through our API, never straight to storage.** Reason: D4 (phones talk only to the API), every write is permission-checked and audited, and a 64 KiB request fits D24's weak-link budget. S3 multipart cannot take parts under 5 MiB, so the API stages chunks as small objects and assembles them (section 12, departure 1).
4. **The server confirms what it stored, not what it received.** After writing the final object it reads it back from storage, hashes it, and only then writes the receipt row with its audit event. Reason: the promise is about the stored copy (PRD 573, 608).
5. **Attachments are append-only.** No field of one is overwritten. "Current profile photo", "photos on this wound" and "pages of this document" are worked out from the rows. Removing one is a one-way mark, "entered in error". Reason: two phones offline cannot conflict.
6. **Bytes follow their record.** If the record lands on the chart, the bytes are stored for the chart. If the record is held in quarantine, the same routes store the bytes beside it. Reason: PRD 560, "no care record is lost".
7. **On the phone a file is sealed in 64 KiB segments with its own random key, and that key lives only in the SQLCipher database.** Reason: the existing key hierarchy then covers files with no new keystore item; destroying the user's key, or deleting one row, makes a file unreadable even if flash keeps its blocks.
8. **Capture is our own native code and returns bytes in memory.** No plugin that writes a temporary JPEG, no system camera app, no picker. Reason: PRD 598, "nothing in plain files"; the system camera saves to the gallery on some phones.
9. **Old files are never kept on a phone.** A stored file is viewed online, held in memory, and logged on the server at fetch. Reason: least PHI on the phone, and a read that cannot be logged is refused.
10. **No new permission keys.** A wound photo follows its note: phase 4's Medical gate to add one, phase 4's `visibleAnswers` to see one. Profile photos and documents follow `patients.edit` and `patients.view` (section 7.1).
11. **A photo hangs on a note's `photo` field; it is not an answer.** It names the note and the field's path, entry included. It has its own author, time and file hash, as an addendum has its own author. So it is outside what a signature covers, a correction cannot touch it, and phase 4's hash, sign-off and correction stay exactly as designed (5.6).
## 4. Data model
One migration, taking **the next free number** after the phases before it: `<n>_attachments.sql`. It also replaces `patient_of_change` with the same body plus `attachment`, as phase 4's `0020` does for its entities (lifecycle 2.4).
### 4.1 `<n>_attachments.sql` (tables, policies, triggers: level X)
`sineobex.attachments`: one row per photo or document page. `wound_photo` is the kind of every photo taken in a note's `photo` field, in any note type. **Append-only**, except the three `entered_in_error_*` columns, which a trigger lets move from null to a value once.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid PK | Made on the device (or by the portal) |
| `team_id` | uuid not null | FK teams. Leads every index |
| `patient_id` | uuid not null | FK patients. Reads group by `canonical_id` (D27); add this table to the schema test that lists every table with a `patient_id` |
| `kind` | text not null | `wound_photo`, `profile_photo`, `document` (check) |
| `note_id` | uuid null | FK `encounter_notes`, on `(team_id, note_id)`. Required for `wound_photo`, null otherwise (check) |
| `encounter_id` | uuid null | Filled by the server from the note |
| `field_path` | text null | The path of the note's `photo` field as phase 4 writes paths (forms 2.3): section, then the entry ID in a repeating section, then the field. For example `wounds.e3k9x2ab.photos`. Two to four parts. Required for `wound_photo` |
| `group_id` | uuid null | Documents only: pages of one paper share it |
| `page` | smallint null | Documents only: 1–50 |
| `doc_type` | text null | Documents only: `discharge_papers`, `outside_lab`, `identification`, `insurance`, `consent_form`, `other` (check; section 11) |
| `doc_date` | date null | The date on the paper, when known |
| `mime` | text not null | `image/jpeg`, `image/png`, `application/pdf` (check). Phones send only JPEG |
| `byte_size` | integer not null | 1 to 20 971 520 |
| `sha256` | text not null | 64 lower-case hex. Hash of the exact file bytes |
| `chunk_size` | integer not null | 65 536 (check) |
| `chunk_count` | integer not null | = ceil(`byte_size` / `chunk_size`) (check) |
| `width`, `height` | integer null | Pixels, images only |
| `rotation` | smallint not null default 0 | 0, 90, 180, 270: how to turn the image when showing it |
| `source` | text not null | `phone`, `portal` |
| `over_cap` | boolean not null default false | Arrived when its photo set already held `max` (section 5.3) |
| `late` | boolean not null default false | Arrived after its note was finished (5.6) |
| `unplaced` | boolean not null default false | Its `field_path` is not a `photo` field of the note's definition (6.2) |
| `created_by`, `device_id`, `change_id` | uuid | Who, which phone (null for portal), which change |
| `device_time`, `corrected_time`, `clock_verified`, `created_at` | as on other synced rows | Capture time and server receipt time |
| `entered_in_error_at`, `_by`, `_reason` | timestamptz, uuid, text null | Set once, together. Reason is one of `wrong_patient`, `not_clinical`, `unreadable`, `duplicate`, `other` |

Indexes: `(team_id, patient_id, kind, corrected_time desc)`, `(team_id, note_id)`, `(team_id, group_id, page)`.

`sineobex.attachment_uploads`: the upload session, one per attachment. Exists so bytes can arrive for a record that is on the chart **or** held in quarantine.

| Column | Type | Meaning |
|---|---|---|
| `attachment_id` | uuid PK | No FK to `attachments` (the row may be in quarantine) |
| `team_id`, `user_id`, `device_id` | uuid | Who may send chunks. `device_id` null for the portal |
| `origin` | text | `chart` or `quarantine` |
| `sha256`, `byte_size`, `chunk_size`, `chunk_count` | | Copied from the accepted or quarantined create |
| `state` | text | `open`, `stored` |
| `opened_at`, `stored_at` | timestamptz | |

`sineobex.attachment_chunks`: staging. PK `(attachment_id, idx)`; `sha256`, `byte_size`, `received_at`. A row is replaced when a chunk is sent again and deleted when the file is stored. Not append-only: it holds no chart data.

`sineobex.attachment_blobs`: **the receipt. Append-only** (UPDATE and DELETE blocked by trigger and grants, as in `0003_audit.sql`). PK `attachment_id`; `team_id`; `storage_key` (`<team_id>/<attachment_id>`, no patient details); `sha256` (hash of the bytes read back from storage); `byte_size`; `stored_at`. A row here means the file is in storage and its hash was checked.

**Row-level security**, all four tables: `enable row level security; force row level security;` and the team policy block of `0004_sync.sql` lines 185–195, with composite foreign keys on `(team_id, ...)` as `0009_patients.sql` has, the rule phase 4 states for every new table (lifecycle 2). `attachment_chunks` gets `team_id` too so it needs no join.
### 4.2 Phone tables (SQLCipher schema, next version; `apps/mobile/lib/sync/local_db.dart`, level X)
`attachment_files`: `attachment_id` text PK; `kind`; `patient_id`; `parent_id` (note, or patient); `sha256`; `byte_size`; `chunk_count`; `file_key` blob(32); `state` (section 5.1); `have_json` (chunk indexes the server reported); `attempts` int; `last_problem` text (a code, never a message with details); `created_at`; `stored_at`. The sealed file is `att/<attachment_id>.sxa` beside the database. Server copies of attachment **metadata** ride in the patient record's `_chart` field (D44) under one more key, `attachments`, beside phase 4's `timeline` and `recentVisits` (lifecycle 5.2). Never in a table of their own, and never with bytes.
## 5. Rules
### 5.1 The file on the phone
| State | Meaning | Next | Who or what moves it |
|---|---|---|---|
| `sealed` | File encrypted on disk; the create change is in the outbox | `uploading` | The uploader, once the create has a receipt (accepted, or quarantined with a matching hash) |
| `uploading` | Session open; chunks going | `stored`, `damaged` | The server's answers |
| `stored` | The server's complete answer carried the same SHA-256 the phone computed at capture | (row and file deleted) | The purge, when `mayPurgeFile` is true |
| `damaged` | The phone re-hashed its own file after a server mismatch and it no longer matches | stays | Needs attention. Never deleted automatically. The person retakes, or marks it entered in error |

A file whose create was **rejected for validation** stays `sealed` and waits on the rejection like any dependent (PRD 564). The fix re-points the file row to the replacement record (`replaceRejected` in `local_store.dart`).
### 5.2 The record on the server
| From | To | By | Rule |
|---|---|---|---|
| (none) | awaiting file | sync create, or portal create | Section 6.2 |
| awaiting file | stored | the complete route | A row in `attachment_blobs` |
| any | entered in error | the creator on the phone (sync `set`), or a member who may add that kind, in the portal (7.1) | One way. Allowed before and after the note is finished. The file is kept in storage and hidden from the chart; an admin with `team.view_audit` still sees that it existed |

There is no delete and no replace. A retake is a new attachment; the first is marked entered in error with reason `unreadable`.
### 5.3 Derived values (sums, never stored)
| Value | Rule |
|---|---|
| Photos in a set | Attachments with that `note_id` and `field_path`, not entered in error |
| Photos a note shows | Its sets whose field is visible and whose entry was not removed: the paths `effectiveAnswers` would keep (forms 7.1). The rest are kept and not shown, as a hidden answer is |
| Cap | The `photo` field's `max`, read with `fieldAt` (5 per wound, PRD 486, 404). A hard stop on the phone. The server never refuses for it: it accepts and sets `over_cap` |
| Current profile photo | The newest `profile_photo` by `corrected_time`, then by `id`, not entered in error |
| A document | All pages with one `group_id`, ordered by `page`, then `corrected_time` |
### 5.4 Pure functions
TypeScript in `services/api/src/attachments/rules.ts`, Dart in `apps/mobile/lib/attachments/rules.dart`, same names, pinned by vector files in `packages/contract/test-vectors/`.

| Function | Inputs | Output | Vectors |
|---|---|---|---|
| `chunkPlan` | `byteSize`, `chunkSize` | `{count, lastSize}`; throws on 0 or over the limit | `attachment-chunks.json` |
| `chunkRange` | `index`, `byteSize`, `chunkSize` | `{start, end}` | same |
| `missingChunks` | `count`, `have: int[]` | sorted `int[]` | same |
| `fileStep` | `{state, createStatus, have, count, localHashOk}` | `wait`, `open`, `send(index)`, `complete`, `rehash`, `purge`, `attention` | `attachment-steps.json` |
| `mayPurgeFile` | `{createConfirmed, storedSha, localSha, parentInUse}` | bool: all of confirmed, equal hashes, parent out of use | same |
| `completeDecision` (TS, mirrored in the fake) | `{expected: {sha256, byteSize, count}, chunks: [{idx, byteSize}]}` | `ready`, or `chunks_missing` with the list | same |
| `photosLeft` | `activeCount`, `max` | int ≥ 0 | `attachment-rules.json` |
| `currentProfilePhoto` | list of `{id, correctedTime, enteredInError}` | id or null | same |
| `attachmentAccess` | `permissions`, `kind`, `action` (`create`, `view`, `mark_error`), and for a wound photo `{noteMedical, chartsMedical, pathVisible, actsAsAuthor}` | bool (section 7.1). It holds no note rule of its own: `pathVisible` is phase 4's `visibleAnswers` asked about the photo's path | `access.json` (extended) |
| `validateAttachmentValue` | the create value | list of problem codes | `attachment-rules.json` |
| `sniffMime` | first 16 bytes | `image/jpeg`, `image/png`, `application/pdf` or null | `mime-sniff.json` |
| `stripJpegMetadata` (Dart; TS for the portal) | JPEG bytes | JPEG bytes without APP1–APP15 and COM segments; throws if not a JPEG | `jpeg-strip.json` (hex) |
| `storageKey`, `stagingKey` (TS) | `teamId`, `attachmentId`, `idx` | `<team>/<id>`, `staging/<team>/<id>/<idx>` | `attachment-rules.json` |
| `sealSegment`, `openSegment` (Dart only) | key, index, final flag, bytes | bytes | `sealed-file.json` (known answers) |
### 5.5 The sealed file format (Dart, `apps/mobile/lib/attachments/sealed_file.dart`)
Header: the 4 bytes `SXA1`. Then one segment per upload chunk: AES-256-GCM over 65 536 plaintext bytes (the last is shorter), key = the file's own random 256-bit key, nonce = 8 zero bytes then the segment index as a big-endian u32, associated data = index then one byte `1` for the last segment and `0` otherwise, followed by the 16-byte tag. So chunk `i` can be read and decrypted alone, a truncated or reordered file fails to open, and plaintext never touches disk. The write goes to `<id>.sxa.part`, is flushed, then renamed; a `.part` file found at start-up is deleted (its record was never made).
### 5.6 A photo and its note (what phase 4 owns, and what this phase adds)
| Question | Answer |
|---|---|
| How does a photo attach? | By `note_id` and `field_path`. The path is the `photo` field's own path, so in Wound care it carries the wound's entry ID. The field itself still stores no answer (forms 2.3): no change to `checkAnswer`, `effectiveAnswers` or any definition |
| Two phones add photos to one wound offline | Each photo is its own record. Nothing conflicts |
| The entry or the note does not exist yet on the server | The note is a parent, so the photo waits for it (6.2). An entry is only a path part: the photo is accepted, and shown once the entry's `entryAt` answer counts |
| Is a photo inside what a signature covers? | No. `noteContentHash` (lifecycle 4.5) is unchanged, and so are the sign-off, co-sign and attest. A photo is fixed by its own record: append-only, with its author, time and the hash of its file. PLAN-OPEN 11 #10 |
| What does the signer see? | The summary screen (lifecycle 9.6) lists each photo set with its count. A photo that arrives after the screen drew does not stop the sign-off |
| A photo added after the note is finished | The phone does not offer it: the field is disabled like every field of a finished note. If one arrives late from a second phone it is accepted with `late: true`, shown below the note with its author and time, and both people are told, as for a late edit (lifecycle 3.6) |
| What can a correction do to a photo? | Nothing directly: a correction changes answers (lifecycle 3.6), and a photo is not one. A correction that removes an entry or hides the field hides that set's photos with it; they are kept. A wrong photo on a finished note is marked entered in error by its creator, with a reason code. That mark is the photo's correction: one way, audited, the file kept |
| What can an addendum do? | An addendum is text (lifecycle 4.7). It carries no photo. It can say why a photo was marked, or point to a late one |
| Co-sign and attest | Unchanged. A reader who sees every answer that counts also sees every photo of the note (7.1), so nothing new can stall a queue |
## 6. Sync
### 6.1 One new entity: `attachment`
Registered like the phase 3 entities and phase 4's four (`services/api/src/sync/entities/attachment.ts`, `entities.dart`, the fake). Category for the unsynced summary: `photos`. No new reject reason: a refused rule is `validation` with a `details.problem`, as in phase 4 (lifecycle 4.1).

| Op | Field | Value | Permission (`attachmentAccess`) |
|---|---|---|---|
| `create` | | `{patientId, kind, noteId?, fieldPath?, groupId?, page?, docType?, docDate?, mime, byteSize, sha256, chunkSize, width?, height?, rotation}` | `create` for the kind; on a Medical note, the Medical gate |
| `set` | `enteredInError` | `{reason}` | `mark_error`: the creator only, on a phone |

Parents: the patient always; the note for a wound photo. `takesTeamLock` is true for every change, as for phase 4's entities (lifecycle 4.2). **The Medical gate** (lifecycle 4.2): a photo on a note whose `medical` is true needs a credential with `chartMedical`, loaded with `loadSigner`. The phone offers the field only to such a credential, so the gate is met only when a credential was lowered offline; the change is then held for a Program Admin, never refused. Clock pause: wound photos pause with notes; profile photos and documents do not (D35's split).
### 6.2 What the server answers
| Case | Answer | Then |
|---|---|---|
| Valid create | `accepted`, hash of the value | Row inserted; audit `attachment.created`; the upload may open |
| Same change again | The stored receipt (existing rule) | |
| Value fails `validateAttachmentValue` (bad hash text, size, mime, chunk count, kind and parent mismatch) | `rejected`, `validation`, `details.problem` = the code | The phone checks the same function before it saves, so this is a build fault. The worker's fix is **Send again**: `replaceRejected` with the value built again from the sealed file. The file stays sealed until then |
| `fieldPath` is not a `photo` field of the note's definition | `accepted`, `details.problem: 'not_a_photo_field'`; `unplaced` set | Shown below the note with a notice. The worker could not fix a refusal |
| Reading the definition throws | Stored `validation`, `definition_error` (lifecycle 4.1) | The queue moves on |
| Patient or note unknown | `rejected`, `stale_reference`, `patient_missing` or `encounter_note_missing` (existing parent rule) | Held with its parent's own change, or Needs attention |
| Patient merged | `accepted`, stored as sent; `details.redirectedTo` (D27) | |
| Photo set already at `max` | `accepted`, `details.overCap: true` | Shown with a notice; never refused |
| Note already finished | `accepted`, `details.outcome: 'late'` | Both people told, as for a late edit (lifecycle 3.6; 5.6) |
| No permission, the Medical gate, or the user was removed | `rejected`, `permission`, `quarantined: true`, stored hash (existing rule, D17): held for a Program Admin | The change leaves the phone; **the file does not**: it uploads into quarantine (6.3) |
| `set enteredInError` by its creator | `accepted` | Audit `attachment.entered_in_error` |
| `set enteredInError` already set | `accepted`, `details.outcome: 'already'` | No second event |
| `set enteredInError` by someone else | `accepted`, stored with no effect, `details.problem: 'not_creator'`; the sender gets a notice | As phase 4's `not_author`: the phone never offers it, and the worker could not fix a refusal |
| A database constraint fails | Stored `server_constraint` rejection (D42) | The queue moves on |
### 6.3 The upload, after the record
The uploader (`apps/mobile/lib/attachments/uploader.dart`) runs after every push round, oldest file first, one file at a time, one chunk per request. `fileStep` decides each move.
1. `open`: `POST /v1/attachments/{id}/upload`. The answer lists the chunk indexes the server holds. This is how an upload resumes after the app was killed (PRD 608).
2. `send(i)`: read segment `i` from the sealed file, decrypt it in memory, `PUT` it with its SHA-256. A network error or timeout ends the round; the engine's existing backoff applies. A refusal for this file moves on to the next file: one bad file never stops the others.
3. `complete`: `POST .../complete`. Answer `stored` with a hash equal to the phone's: state `stored`. Answer `chunks_missing`: send those. Answer `hash_mismatch`: the server has dropped its staged chunks; the phone does `rehash` (decrypts and hashes its own file). If its file is whole it starts again; after three whole-file mismatches, or if its own file fails, state `damaged`.
4. `purge`: when `mayPurgeFile` is true, delete the file key and row in one transaction, then the file. A file found without a row at start-up is deleted (it is unreadable anyway).

### 6.4 What changes in the sync core (level X)
| Place | Change |
|---|---|
| `LocalStore.unsynced` | Adds `photos`: files not yet `stored`. `hasUnsynced` is true while any `attachment_files` row exists that is not `stored` |
| D20 sign-out | Files count as unsynced work: sign-out keeps the key and the files |
| D21 hand-over | The wipe waits for every change ID **and** every file to be confirmed. Chunks go to the device-key routes (section 7) |
| Remote wipe, tenth wrong PIN | Unchanged: the key is destroyed, so file keys are gone. The team's `att/` directory is deleted with the database file |
| `LocalStore.purge` | Calls the attachments purge with the set of records in use; a chart with a file not yet stored counts as local work |
| Phase 4's `noteContentHash`, sign-off and correction | Unchanged (5.6) |
| The sync read, `/v1/sync/records` | `attachment` gets its own read rule, as phase 4's entities do (lifecycle 6.4 rule 7): a row is given to whoever `attachmentAccess` lets view it, and is absent otherwise |
### 6.5 What the fake must mirror (`apps/mobile/test/sync/fake_server.dart`, level X; plan risk 7, D52)
Every row of 6.2, the Medical gate and the read rule included; `completeDecision`; chunk hash checking; "open is idempotent"; "complete is idempotent"; mismatch clears staging; the quarantine origin. The blob half lives in a new `apps/mobile/test/sync/fake_blob_server.dart`, treated as level X too. `fake_parity_test.dart` gains one case per rule, each pinned to the real API's answer.

### 6.6 What a phone holds
| Thing | How it gets there | When it leaves |
|---|---|---|
| A sealed file and its key | Capture | Both receipts, and the parent out of use (the note saved and closed or finished, the form closed): PRD 572, 573 |
| Attachment metadata of a cached chart (ids, kinds, times, stored or not) | With the chart, in `_chart` | With the chart (D30, D44) |
| Bytes of a stored file | Never on disk. Fetched online into memory to view | When the viewer closes, at lock, at background |
## 7. API routes that only work online
### 7.1 Permissions (`attachmentAccess`, existing keys only)
| Action | Wound photo | Profile photo | Document |
|---|---|---|---|
| Create | `encounters.chart`, and on a Medical note a credential with `chartMedical` (the Medical gate, 6.1) | `patients.edit` | `patients.edit` |
| View file or list row | `patients.view` and `encounters.chart`, and the reader would see an answer at the photo's path: `visibleAnswers` (forms 7.1, lifecycle 6.4) keeps it. Whoever acts as the note's author sees it | `patients.view` | `patients.view` |
| Mark entered in error (portal) | As create | `patients.edit` | `patients.edit` |

So a photo in a sensitive note type, a substance use treatment section or a sensitive exam section is read under phase 4's rule for that content, decided in phase 4's one function. A photo the reader may not see is **absent**: no row in the list, the chart or the sync read, and `404` from the content route. A photo in a sensitive exam section never shows in the wound history or the profile, for any reader (PRD main 415); it shows in the visit only. A reader of Medical notes through `billing.view_codes` alone sees no photo (PLAN-OPEN 11 #3).
### 7.2 Routes
| Path | Key | Request → answer | Refusals | Audit |
|---|---|---|---|---|
| `POST /v1/attachments/{id}/upload` | Creator of the record, on its device (or portal session) | none → `{state, chunkSize, chunkCount, have: int[]}` | 404 `attachment_unknown` (no accepted or quarantined create by this caller) | `attachment.upload_opened`, first time only |
| `PUT /v1/attachments/{id}/chunks/{index}` | Same | body: raw bytes, header `x-chunk-sha256` → `{index, sha256}` | 409 `chunk_hash_mismatch`; 413 `chunk_too_large`; 400 `chunk_out_of_range`; 409 `already_stored` (treated as success by the phone, which then calls complete) | None: staging holds no chart data (section 9) |
| `POST /v1/attachments/{id}/complete` | Same | none → `{state: 'stored', sha256, byteSize}` | 409 `chunks_missing {missing}`; 409 `hash_mismatch` | `attachment.stored`, or `attachment.upload_refused` |
| `POST /v1/devices/{deviceId}/quarantine/attachments/{id}/upload`, `.../chunks/{index}`, `.../complete` | The device key, as the existing quarantine route | As above | As above, plus the device-key refusals | Same events, `origin: 'quarantine'` |
| `GET /v1/patients/{patientId}/attachments` | `patients.view`; rows filtered by `attachmentAccess` | → metadata rows with `stored: bool`. The same rows ride in the chart answer as `attachments` (4.2) | 403 | `attachment.listed` (`patientId`, count) |
| `GET /v1/attachments/{id}/content` | `attachmentAccess(view)` | → the bytes, `Cache-Control: no-store`, `Content-Disposition: inline` | 404 (unknown, or not for this reader); 409 `not_stored_yet` | `attachment.viewed`, committed before the first byte is sent |
| `POST /v1/attachments` | `attachmentAccess(create)`; documents and profile photos only | The create value → the row | 400 with the validation codes; 403 | `attachment.created` (`source: 'portal'`) |
| `POST /v1/attachments/{id}/entered-in-error` | 7.1 | `{reason}` → the row. Already marked: the row again, no second event | 403 | `attachment.entered_in_error` |

**The team lock.** Every route here that writes a row calls `lockTeamWrites` as the first statement of its transaction, as every online writer does (lifecycle 5; `services/api/src/sync/locks.ts`): open, chunk, complete, the portal create and entered in error, and the device-key variants. Storage calls run outside that transaction, so the lock is held for one small write, never for a file's transfer. Phase 4's routes are not changed: the visit read (lifecycle 5.1) keeps its shape, and a screen joins photos to a note by `noteId` and `fieldPath`.

**Complete, in order.** (1) Read the session. If a blob row exists, answer `stored` again. (2) `completeDecision`. (3) Read the staged chunks in order, check size and SHA-256 against the session. On mismatch: delete staged objects and chunk rows, audit `attachment.upload_refused`, answer `hash_mismatch`. (4) Put the final object at `storageKey`. (5) Get it back from storage and hash it. (6) In one transaction: take the team lock, lock the session row and check again that no blob row exists, insert `attachment_blobs`, set the session `stored`, write `attachment.stored`. (7) Delete staged objects, best effort; `open` on a stored session deletes leftovers. An object can exist without a receipt row (harmless, overwritten on retry). A receipt row never exists without a checked object.

**Storage interface** (`services/api/src/blobs/store.ts`, added to `Deps` as `blobs`): `put(key, bytes)`, `get(key) → bytes | null`, `delete(key)`, `deletePrefix(prefix)`. Two implementations: memory (tests, local) and S3 API with SigV4 over `fetch` (one class for Supabase Storage and S3; it runs on Node and Deno, D3). Config: `BLOB_ENDPOINT`, `BLOB_REGION`, `BLOB_BUCKET`, and two secrets; rows for `docs/setup.md`.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast, reflows at narrow width, and is tested offline (CLAUDE.md).

### 8.1 Phone (`apps/mobile/lib/features/attachments/`)
| Screen | Shows | States | Wording |
|---|---|---|---|
| Photo field (phase 4's `photo` kind; replaces the placeholder in `features/forms/photo_field.dart`) | Button, count, a row of the set's photos | Empty; 1–4; full; clock paused; disabled on a finished note | Button "TAKE WOUND PHOTO"; "Photos: Up to 5" (field spec rows 116, 306–307, via `forms-inventory.md` 143, 278). Full: "This wound has 5 photos. That’s the most a visit can hold." |
| Capture | Live preview, shutter, flash, close | Asking for the camera; refused; ready; saving; no space | Refused: "Sineobex needs the camera to add photos. Turn it on in Settings." No space: "This phone is out of space. The photo wasn’t saved." |
| Review (after each shot) | The photo just taken | | Buttons "Retake photo", "Add another photo", "Submit photo" (field spec row 117) |
| Photo tile | Image if the file is still here; otherwise a plain tile with its state | "On this phone", "Sending 3 of 12", "Saved", "Needs attention", "Marked entered in error" | A person is never shown a hash or a byte count |
| Viewer | One image, full screen, pinch to zoom; capture time and author | Local file; online fetch; offline and not here | Offline: "This photo is saved on the server. Connect to see it." No share, save or copy control exists |
| Profile header photo | A plain covered tile until tapped (PRD 721) | No photo; covered; shown; offline | "Tap to show photo". Add or replace: "Take profile photo" |
| Documents (profile) | A list by date and type, page count | Empty; list; offline | "Add document" opens type, optional date, then Capture for each page: "Add another page", "Done" |
| Needs attention row | A damaged or refused file | Refused record: "Send again". Damaged file: retake, or "Mark entered in error" | "A photo couldn’t be saved to the chart. Take it again if you can." |
| Log-out alert line | Stored of total | | "Photos: 2 of 6" (PRD 575) |

The photo field stays a plain widget, as phase 4 requires of every field widget (forms 8.1): it is given its tiles and two callbacks by the note form's host, and touches no store. Phase 4's read view and summary screen (lifecycle 9.6, 9.7) show each set under its field, and late or unplaced photos below the note. The viewer and tiles draw with `Image.memory` only. The image cache is cleared when the app locks or goes to the background (`apps/mobile/lib/security/idle_lock.dart` gains a callback).

### 8.2 Portal (`apps/portal/src/app/(app)/patients/[patientId]/`)
| Page | Shows | States | Notes |
|---|---|---|---|
| Documents tab | List; viewer; "Upload document" (type, date, file); "Mark entered in error" with a reason | Empty; uploading with progress; failed with "Try again" (the chosen file stays in the form, PRD 606); refused type or size | JPEG, PNG, PDF; 20 MiB. The route handler hashes, creates, chunks and completes server-side; nothing is written to disk or browser storage |
| Photos in wound history, and under each note on phase 4's visit page (lifecycle 9.11) | Dated photos per wound | "Still on the phone of the person who took it" for a record with no file yet | Sizes come from phase 4. No photo from a sensitive exam section in the history |
| Profile header | Covered until clicked; the click fetches, and the fetch is the logged read | | |
| File route `/patients/[patientId]/files/[attachmentId]` | Proxies `GET .../content` | | `no-store`; generic page title; the URL holds two UUIDs and nothing else |
| Team devices page | `photos` in each phone's unsynced counts | | Existing page, one more label |

There is no download button, and the image element sets `draggable=false`. A browser can still save an image; that is PRD 602's stated desktop risk, and exports are phase 10's (section 12).

## 9. Audit events and PHI rules
| Event | When | Details (IDs, counts and hashes only, D33) |
|---|---|---|
| `attachment.created` | Sync create or portal create, same transaction | `attachmentId`, `patientId`, `kind`, `noteId`, `source`, `byteSize`, `overCap`, `late`, `unplaced` |
| `attachment.upload_opened` | First open of a session | `attachmentId`, `origin`, `chunkCount` |
| `attachment.stored` | The receipt row's transaction | `attachmentId`, `byteSize`, `chunkCount`, `sha256`, `origin` |
| `attachment.upload_refused` | Whole-file mismatch | `attachmentId`, `problem` |
| `attachment.listed` | List route | `patientId`, `count` |
| `attachment.viewed` | Content route; and offline on the phone through `LocalStore.appendAudit` when someone opens a local file | `attachmentId`, `patientId`, `kind` |
| `attachment.entered_in_error` | Either path | `attachmentId`, `reason` (a code) |

Rules that apply: no file name, document type text, note text or patient name in details, logs or URLs. Storage keys and local file names are UUIDs. Chunk writes are not audited one by one: they are staging, not chart data, and the session's open and stored events bracket them (a reading of "every action", stated in section 12). A content read whose audit insert fails sends no bytes. API logs for these routes carry `requestId`, `attachmentId`, index and sizes only. Images never enter crash reports, notifications or `kv`. Home gains no count from this phase: the Needs attention row is counted from the phone's own store, so opening Home still writes no patient into the audit log (lifecycle 5.6, 9.9).

## 10. Tests
### 10.1 The Done when, step by step
Runs against the fake (host test), against the real API (`tools/live-sync.sh`), and on an Android emulator with the real camera channel.

| # | Step | Asserted |
|---|---|---|
| 1 | Offline. Open a wound note. Take five photos | Five `attachment` creates in the outbox; five `.sxa` files; `unsynced().counts['photos'] == 5`; a sixth is refused by the cap |
| 2 | Scan the app's whole data directory | No file starts with a JPEG, PNG or PDF signature; no `.part` file; nothing in the cache or temporary directory; the files do not open with a wrong key |
| 3 | Emulator only: read the gallery | The count of images in MediaStore, and the listings of `DCIM` and `Pictures`, equal the values read before step 1 |
| 4 | Save & Close the note, still offline | Nothing purged: five files remain |
| 5 | Reconnect; sync; kill the uploader after chunk 2 of photo 3; start again | Photo 3 resumes from the server's `have` list; no chunk is sent twice that the server confirmed |
| 6 | Sync finishes | Five `attachment_blobs` rows whose `sha256` equal the hashes computed at capture; five `attachment.stored` events; the bytes read from the blob store hash to the same value |
| 7 | Purge | No `.sxa` file, no `attachment_files` row; `photos` is 0; the devices page shows 0 |
| 8 | Open the note online | Five tiles; opening one writes `attachment.viewed`; no file appears on disk |
### 10.2 The test that holds each rule
| Rule | Test |
|---|---|
| A file is deleted only after a matching whole-file hash | `mayPurgeFile` vectors; store test: a `stored` answer with a different hash leaves the file; revert check: remove the hash comparison, the test fails |
| The server's receipt is of what storage returned | API test with a blob store that corrupts on `get`: complete refuses, no blob row, no `attachment.stored` |
| Receipt row and audit event commit together | API test: an audit failure injected at complete leaves no `attachment_blobs` row |
| A refused file never stops the others | Uploader test: file 1 answers `hash_mismatch` forever; files 2–5 store |
| A rejected create is never dropped, and its file stays | Store test: validation rejection, then purge: file and row remain; fix re-points the file |
| Quarantined record, quarantined bytes | API and fake: removed user; hand-over; the wipe happens only after the file's `stored` answer |
| Sign-out and "Log out anyway" keep files | Session test (D20): files present after sign-out, readable after the same user signs in |
| Tenth wrong PIN and remote wipe make files unreadable | Vault test: after `destroy`, no key opens the file; the `att/` directory is gone |
| App killed mid-upload (PRD 608) | Step 5 above, in the fake and live |
| Storage full (PRD 608) | Sealed-file test with a writer that fails midway: no `.sxa`, no record, the person is told |
| No plaintext on disk | Step 2; `tools/leak-guard.mjs` (below) |
| Nothing reaches the camera roll, a share sheet or a backup | 10.3 |
| Permissions | `access.json` vectors; API tests per route and role. A Billing/Data role, and a reader without the key for a sensitive exam section, get no row and a 404 for that photo; the note's acting author gets it |
| A photo is outside the signature | API and fake: a photo added between the summary screen and the sign-off leaves `noteContentHash` equal and the sign-off lands; a photo on a finished note is `late`; a correction that removes the entry hides its photos and deletes none |
| The Medical gate; no refusal a worker cannot fix | API and fake: a lowered credential's photo is held for an admin and its bytes reach quarantine; `not_a_photo_field` and `not_creator` are accepted with a notice |
| The team lock comes first | API test per writing route: a held team lock makes the route wait; no storage call runs inside the transaction |
| Row-level security | DB test: another team's `app.team_id` sees no row in the four tables |
| The fake agrees with the API | `fake_parity_test.dart` cases for 6.2 and the three upload answers |
| Both runtimes | Blob store test against memory and against a local S3-API server in CI (the Supabase stack already used by the live job, if it exposes storage; otherwise section 12, risk 4) |
| Portal | Playwright: upload a demo PDF, see it listed, open it, mark it entered in error; axe in three themes; no `localStorage`, IndexedDB or cache entry after |
### 10.3 What the native code must do, and how each claim is tested
| Claim | Android | iOS | Test |
|---|---|---|---|
| Capture returns bytes in memory | CameraX `ImageCapture.takePicture(executor, OnImageCapturedCallback)`; never the `OutputFileOptions` form; preview in a platform view | `AVCapturePhotoOutput`; `photo.fileDataRepresentation()`; never a file URL | Step 2; code review (level X) |
| Size is set at capture | Target long edge 2048 px, JPEG quality 80 | `maxPhotoDimensions` near 2048, same quality | Dart test rejects more than 8 MiB with "Take it again" |
| No location in the image | Never call `setLocation` | No location metadata set | `stripJpegMetadata` runs on every capture; vectors |
| No path to the gallery | No `MediaStore`, `Environment.getExternalStorage*`, `FileProvider`, `ACTION_SEND`, `ACTION_IMAGE_CAPTURE` in source; manifest adds only `CAMERA`; no storage permission; no `<provider>` | `Info.plist` gains only `NSCameraUsageDescription`. No `NSPhotoLibrary*` key (so the OS itself refuses a write), no `UIFileSharingEnabled`, no `LSSupportsOpeningDocumentsInPlace`; no `PHPhotoLibrary`, `UIImageWriteToSavedPhotosAlbum`, `UIActivityViewController`, `UIDocumentInteractionController` in source | `tools/leak-guard.mjs` fails the build on any of these, and on `image_picker`, `camera`, `share_plus`, `file_picker`, `gallery_saver`, `photo_manager`, `open_file`, `cached_network_image`, `Image.file`, `Image.network`, `getTemporaryDirectory`, `getExternalStorageDirectory` in the phone app. Step 3 on the emulator |
| Files are outside backups | `att/` under the app support directory already covered by `allowBackup="false"` and the extraction rules | `att/` gets `isExcludedFromBackup` (the existing channel method) and `FileProtectionType.complete` | Android: manifest assertion. iOS: a debug channel method reads the flags back; device checklist |
| No thumbnail or screenshot | `FLAG_SECURE` (exists) covers the preview and the viewer | The app's cover in the app switcher must also cover the capture screen | Android: existing test. iOS: device checklist |
| iOS has no automated device test | | | A signed checklist in `docs/compliance/photo-handling.md`: Photos app unchanged after five captures, Files app shows no Sineobex folder, the app is absent from the share sheet, backup flags read back. Plan risk 5 stands |
## 11. Defaults chosen (PLAN-OPEN)
| # | Question | Default | Why | Who decides |
|---|---|---|---|---|
| 1 | How long are photos and documents kept? (PRD 489, 727) | Kept. Nothing is deleted; entered in error hides | The only choice that loses nothing | Counsel |
| 2 | Is the cap per encounter or per wound? (PRD 486 says encounter; the field spec gives 5 on the quick form only) | The form field's `max`, default 5 per photo set, so per wound in Wound care | Matches phase 4's default A33 | Brooke and Mercy |
| 3 | May a reader of Medical notes through `billing.view_codes` alone see wound photos? Phase 4 lets that reader see the note's answers (lifecycle 6.4) | No: a photo needs `encounters.chart` on top of phase 4's rule for its path | Minimum necessary: coding needs the answers, not the image | The project lead |
| 4 | Which key adds a document or a profile photo? | `patients.edit` | It is demographic paperwork, and CHWs hold it | The project lead |
| 5 | Document types | Six (4.1) | PRD 727 names two; the rest are the common papers | Brooke and Mercy |
| 6 | Are any photos kept on the phone for offline viewing (route cache, profile photo)? | None | Least PHI on the phone | Brooke and Mercy, then the project lead |
| 7 | "Blurred until tapped" (PRD 721) | A plain covered tile; the tap fetches and logs | Bytes are not fetched, so nothing is disclosed, until someone asks | The team |
| 8 | Image size and limits | Long edge 2048 px, quality 80; 8 MiB per phone file; 20 MiB per desktop file; 50 pages per document | Enough for wound detail at about 1 MB a photo | Brooke and Mercy (detail), the team (cost) |
| 9 | Who may mark an attachment entered in error? | Its creator on the phone; anyone who may add that kind, in the portal | What only the author does works offline (D60) | Brooke and Mercy |
| 10 | Is a photo part of what a signature covers? | No. Phase 4's hash covers the answers, the patient and the assessment (D57) and is left alone. A photo is fixed by its own append-only record and file hash, and one added later is marked `late` | Phase 4 owns the hash. Putting photos in it would make a teammate's photo refuse a sign-off, and would let a note be signed over a file that never arrives. If the answer is yes: version 2 of the hash with a sorted list of `{id, sha256}`, in phase 4's files | Brooke and Mercy, with counsel |
| 13 | May a photo be added on purpose to a finished note, as an addendum is? | No: only a late arrival from a second phone | The PRD's addendum is a dated entry of text (PRD 459) | Brooke and Mercy |
| 11 | Uploads in the background, app closed | No: only while the app is open and unlocked | The file key needs the unlock; no background PHI handling | The team |
| 12 | Consent for a photo | Nothing new: registration consent covers charting | The PRD names no photo consent | Counsel |

**Questions with no default.** (a) Counsel: must a file marked entered in error for "wrong patient" be removed from storage, and after how long? (b) Counsel: are photos of identification documents subject to extra rules in Michigan? (c) The team: which device is the pilot's oldest phone, for the capture and memory tests?

## 12. Risks, and where the design departs from the PRD
**Departures and readings.**
1. **"S3 multipart upload" (PRD 608) is read as "resumable chunks" (PRD 573).** S3 parts must be at least 5 MiB, larger than a whole photo, and far too big for D24's weak links. The phone's chunks are 64 KiB; the API stages and assembles them. The promise (resume where it stopped; confirm after hashing the reassembled file) is kept.
2. **Phones never talk to storage.** No presigned URLs (D4, and every write audited).
3. **Purge waits for the note to close** (PRD 572) even though PRD 573 says "then the local file is deleted". 572 is read as governing: staff should not lose sight of a photo mid-encounter.
4. **Chunk writes are not audit events.** The session's open and stored events are.
5. **The cap is never enforced by refusing on the server.** A refusal there would be one the worker cannot fix (D59). The same reading makes `not_a_photo_field` and `not_creator` accepted with a notice.
6. **Hash of the plaintext file.** The phone's file encryption is local; the server hashes the same bytes the phone hashed before sealing.
7. **A signature does not cover photos** (5.6, section 11 #10). The PRD says a signed note is locked (PRD 452); a photo cannot change, and one added later is marked.

**Risks.**
1. **Native camera code is new, and iOS has no CI build** (plan risk 5). It is the one place a leak could be introduced unseen. Mitigation: it is small, level X, guarded by `leak-guard`, and checked on a device before the pilot.
2. **Memory.** A whole photo is in memory at capture and at view; complete holds up to 20 MiB in the API. Edge Functions have tight limits: measure in the preview, and lower the desktop limit there if needed.
3. **The fake now mirrors a second protocol** (plan risk 7). Mitigation: `completeDecision` is shared logic pinned by vectors, and parity tests cover each answer.
4. **Supabase Storage's S3 API may differ from S3** (errors, listing for `deletePrefix`). Mitigation: the interface is four calls; the live job runs them against the preview's storage.
5. **Orphans.** A phone lost before upload leaves a record with no file, for good. The chart says so; the devices page already shows the phone's unsynced photos; nothing can recover them (PRD 604 accepts this for remote wipe).
6. **Desktop uploads are untrusted files.** Type is checked by signature, size is capped, files are served `inline` with `nosniff`. No malware scan until phase 12.
7. **A browser can save a displayed image.** Stated by PRD 602; not solvable in a web app.
8. **Flash storage keeps deleted blocks.** Mitigated by the per-file key: deleting the row is the erase.
9. **Phase 4 may be built differently from its design.** The `photo` field and its paths, `visibleAnswers`, the Medical gate and the `_chart` keys are the four joins; check them first (section 2).
10. **A photo's visibility is asked of phase 4's function, by path.** If `visibleAnswers` cannot answer for a path that holds no answer, phase 4's unit F1 gains a small `pathVisible(def, path, reader)` built on it, with vectors; this phase must not copy the rule.

## 13. Units and a first card list
Units own disjoint files, except the shared files named below. U0 lands first, alone, with CI green. Then U1 and U2 (server), U3 then U4 (phone core), U5 beside them, then U6 and U7, then U8. Card IDs are a unit and a short name, and levels follow `docs/plan/README.md`: anything under `services/api/src/sync`, `auth` or `db`, `apps/mobile/lib/sync`, `security` or `auth`, the phone's test server, a migration with a policy or trigger, `.github` or `tools` is level X; a screen or a widget is R; S only where a machine check catches every mistake. Each unit with T cards has one tests card (level X) that writes those cards' test files first. No card changes more than three source files; tests are extra. Paths are short as in phase 4's index: `api/` is `services/api/src/`, `api-test/` is `services/api/test/`, `phone/` is `apps/mobile/lib/`, `phone-test/` is `apps/mobile/test/`, `vectors/` is `packages/contract/test-vectors/`, `portal/` is `apps/portal/src/app/(app)/`.

**Files another phase or unit also edits, and the order:** `api/app.ts`, `api-test/permissions.test.ts`, `db/seed/seed.ts`, `api/patients/{charts,projection,schemas}.ts`, `phone/patients/chart_cache.dart`, `phone/features/forms/photo_field.dart` and `field_host.dart`, the note read view and summary screen, `phone/features/sync/*`, the portal's `NoteView.tsx` (all after phase 4's cards for them); `api/routes/attachments.ts` (U0-routes, then each U2 card wires its own route); the generated contract (U0-contract, U1-contract).

| Card | Level | Files, and what it does | Needs |
|---|---|---|---|
| | | **U0 Schema, contract and core rules (first, alone)** | |
| U0-vectors-upload, U0-vectors-rules | X | `vectors/attachment-chunks.json`, `attachment-steps.json`, `sealed-file.json`; then `attachment-rules.json`, `mime-sniff.json`, `jpeg-strip.json` | |
| U0-migration | X | `db/migrations/<n>_attachments.sql`: four tables, policies, append-only triggers, `patient_of_change`; its DB test | |
| U0-access | X | `api/auth/permissions.ts`, `vectors/access.json`: `attachmentAccess` | U0-vectors-rules |
| U0-blob-store | X | `api/blobs/store.ts`, `api/types.ts` (`Deps.blobs`), the test harness | |
| U0-tests | X | The test files of this unit's T cards, and `api-test/attachment-fixtures.ts` (a demo JPEG maker, `createAttachment`, `expectStored`) | the cards above |
| U0-rules-chunks, U0-rules-steps | T | `api/attachments/rules.ts`: chunk functions; then step, purge, complete and cap functions | U0-tests |
| U0-validate | T | `api/attachments/validate.ts`: value validation, mime sniff, storage keys | U0-tests |
| U0-routes | T | `api/routes/attachments.ts`, `api/attachments/schemas.ts`, `api/app.ts`: schemas, routes answering 501, a row per route in `api-test/permissions.test.ts` | U0-validate |
| U0-contract | S | The generated contract | U0-routes |
| | | **U1 Server sync entity (level X throughout)** | |
| U1-entity | X | `api/sync/entities/attachment.ts`, `entities/index.ts`, `api/sync/schemas.ts`: create, parents, the team lock, permission, the Medical gate | U0 |
| U1-details, U1-entered-in-error | X | `entities/attachment.ts`: `over_cap`, `late`, `unplaced`, merged patient, a throwing definition stored; then the one-way mark and `not_creator` | U1-entity |
| U1-sync-read | X | `api/routes/sync.ts`: the read rule for `attachment` | U1-entity, U0-access |
| U1-chart | X | `api/patients/charts.ts`, `projection.ts`, `schemas.ts`: the `attachments` key, filtered | U1-entity |
| U1-contract | X | The generated contract and `vectors/sync-values.json` | the U1 cards above |
| | | **U2 Server upload, receipt and reads (`api/attachments/`)** | |
| U2-tests | X | `api-test/attachments-{sessions,chunks,reads,create}.test.ts` | U0 |
| U2-open | T | `sessions.ts`: open a session from an accepted create | U2-tests |
| U2-open-quarantine | X | `sessions.ts`: open a session from a quarantined create | U2-open |
| U2-chunk | T | `chunks.ts`: hash, size, range, replace; the lock held for the row only | U2-open |
| U2-complete | X | `complete.ts`: assemble, read back, receipt and audit in one transaction | U2-chunk |
| U2-device-routes | X | `api/routes/devices.ts`, `sessions.ts`: the device-key variants | U2-open-quarantine, U2-complete |
| U2-list, U2-content | T | `reads.ts`: the list with `attachment.listed`; then content: audit first, then bytes, `no-store`, 404 when hidden | U2-tests; U2-complete |
| U2-portal-create, U2-entered-in-error | T | `create.ts`: the portal create; then the mark, idempotent | U2-tests |
| U2-s3-store, U2-s3-config | X | `api/blobs/s3.ts` (SigV4 over `fetch`); then `api/config.ts` and the two entry files | U0-blob-store |
| U2-seed | S | `db/seed/demo-attachments.ts`, `db/seed/seed.ts`: three attachments with generated images | U2-complete |
| | | **U3 Phone store and test server (level X throughout)** | |
| U3-local-schema | X | `phone/sync/local_db.dart`: `attachment_files` | U0 |
| U3-registry | X | `phone/sync/entities.dart`: `attachment`, category `photos`, the clock rule | U0 |
| U3-store | X | `phone/sync/local_store.dart`: `unsynced`, `hasUnsynced`, the purge hook, the file re-point on a fix | U3-local-schema, U3-registry |
| U3-fake-entity | X | `phone-test/sync/fake_server.dart`: every row of 6.2 | U1 |
| U3-fake-blobs | X | `phone-test/sync/fake_blob_server.dart`, `fake_parity_test.dart` | U2 |
| U3-engine | X | `phone/sync/sync_engine.dart`, `sync_controller.dart`: run the uploader after a push; the hand-over waits for files | U3-store, U4-uploader |
| | | **U4 Phone attachments domain (`phone/attachments/`)** | |
| U4-tests | X | The test files of this unit's T cards, under `phone-test/attachments/` | U0, U3-store |
| U4-rules | T | `rules.dart`: chunk, step, purge and cap functions | U4-tests |
| U4-validate | T | `validate.dart`, `phone/patients/access.dart`: validation, mime sniff, `attachmentAccess` | U4-tests, U0-access |
| U4-jpeg | T | `jpeg.dart`: `stripJpegMetadata` | U4-tests |
| U4-sealed-file | X | `sealed_file.dart`: segments, the write through `.part`, read one segment (encryption) | U0-vectors-upload |
| U4-file-vault | T | `file_vault.dart`: directory, start-up sweep, delete on wipe | U4-sealed-file, U3-local-schema |
| U4-uploader | T | `uploader.dart`: open, send, complete, rehash, driven by `fileStep` | U4-rules, U4-file-vault, U3-fake-blobs |
| U4-repository | T | `attachment_repository.dart`: capture to record and file in one step; list; mark error | U3-store, U4-jpeg, U4-file-vault |
| U4-reader | T | `attachment_reader.dart`: fetch to memory; offline audit for local views | U4-repository |
| U4-providers | T | `attachment_providers.dart`, `capture_source.dart`: the capture-source interface, with a fake for tests | U4-repository |
| U4-chart-cache | R | `phone/patients/chart_cache.dart`, its test: keeps `attachments` | U1-chart |
| | | **U5 Native capture (level X: the frontier model or a person)** | |
| U5-android, U5-ios | X | `CaptureChannel.kt`, `MainActivity.kt`, `AndroidManifest.xml`; `CaptureChannel.swift`, `AppDelegate.swift`, `Info.plist`: in-memory capture, platform view, camera permission, file protection | |
| U5-channel | X | `phone/attachments/capture_channel.dart`: the capture source over the channel | U4-providers, U5-android |
| | | **U6 Phone screens (`phone/features/attachments/`; level R, each with its widget test)** | |
| U6-labels | S | `attachment_labels.dart` | |
| U6-capture, U6-review | R | `capture_screen.dart` and its refusals; `review_screen.dart`: Retake, Add another, Submit | U5-channel, U6-labels |
| U6-tile | R | `photo_tile.dart`: its five states | U4-repository, U6-labels |
| U6-photo-field | R | `phone/features/forms/photo_field.dart`, `field_host.dart`: the placeholder becomes the field, with the cap | U6-review, U6-tile |
| U6-note-photos | R | `note_photos.dart`, phase 4's read view and summary screen: sets under their fields, late and unplaced photos below | U6-tile |
| U6-viewer | R | `viewer_screen.dart` | U4-reader |
| U6-lock-clears-images | X | `phone/security/idle_lock.dart`: a callback that clears the image cache at lock and in the background | U6-viewer |
| U6-profile-photo | R | `profile_photo.dart`, `phone/features/patients/patient_screen.dart`: covered until tapped | U6-viewer |
| U6-documents | R | `documents_screen.dart`, `add_document_screen.dart` | U6-review |
| U6-needs-attention | R | `phone/features/sync/sync_labels.dart`, `needs_attention_screen.dart`, `sign_out_dialog.dart`: the row, Send again, "Photos: 2 of 6" | U3-store |
| | | **U7 Portal** | |
| U7-tests | X | The test files of U7-file-route and U7-upload, and `apps/portal/e2e/documents.spec.ts` (upload, view, mark; axe in three themes; no browser storage) | U2 |
| U7-file-route | T | `portal/patients/[patientId]/files/[attachmentId]/route.ts`: proxy, `no-store`, generic title | U7-tests |
| U7-upload | T | `apps/portal/src/app/actions/attachments.ts`, `apps/portal/src/lib/chunks.ts`: hash, create, chunk, complete, in memory | U7-tests |
| U7-documents | R | `portal/patients/[patientId]/documents/page.tsx`, its form component | U7-file-route, U7-upload |
| U7-photos | R | `portal/patients/[patientId]/page.tsx`, `PhotoStrip.tsx`, phase 4's `NoteView.tsx`: the covered profile photo, wound history, photos under a note | U7-file-route |
| U7-devices | R | The devices page, `apps/portal/src/lib/labels.ts`: `photos` | |
| | | **U8 Leak guards and the Done when** | |
| U8-leak-guard | X | `tools/leak-guard.mjs`, `tools/ci-local.sh`, the CI workflow | U5 |
| U8-done-when-phone | X | `phone-test/attachments/done_when_test.dart`: steps 1, 2, 4–8 against the test server | U4, U3 |
| U8-live | X | `tools/live-sync.sh`, its Dart driver: the Done when against the real API | U8-done-when-phone, U2 |
| U8-emulator | X | `apps/mobile/integration_test/camera_roll_test.dart`, `.github/workflows/`: step 3 | U5-android, U6-review |
| U8-compliance | R | `docs/compliance/photo-handling.md`: the iOS device checklist | U5-ios |
| U8-plan | R | `IMPLEMENTATION_PLAN.md`, `docs/setup.md`, this file's Status | all |

**Count: 73 cards.** S 3, T 20, R 15, X 35. By unit: U0 11, U1 6, U2 13, U3 6, U4 11, U5 3, U6 11, U7 6, U8 6. The small model types the code of 38; the frontier model or a person writes the other 35, the tests of every T card among them.
