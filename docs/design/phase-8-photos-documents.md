> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 8: Photos and documents
How to read the citations: "PRD 573" is line 573 of the product spec's main tab; "BP 110" is line 110 of its Build plan tab; "D20" is a decision in `IMPLEMENTATION_PLAN.md`. Code is cited by file. A photo or a document page is called an **attachment** here; its bytes are the **file**.

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
| The wound form, its body map and the "photo set" field definition | Phase 4 (`docs/design/phase-4/forms-inventory.md` rows 143, 278, 330) |
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
| Migrations end at `0016`; phase 4 reserves `0017`–`0021` | `db/migrations/`, the task text |
| There is no `apps/mobile/integration_test/` and no iOS build in CI | `ls apps/mobile`, plan risk 5 |

**What earlier, unbuilt phases must have delivered.**

| Phase | Thing this phase needs | If it is missing |
|---|---|---|
| 4 Encounters | Notes with an author, a state and Save & Close (`docs/design/phase-4/lifecycle.md` 33–55); a "photo set" field type in form definitions with a `max`; the rule "a change that reaches a finished note is kept, never refused" (lifecycle point 6); the note's sensitivity class used by the chart projection | Wound photos cannot be attached. Profile photos and documents still work |
| 4 Encounters | The sign-off hash function (lifecycle point 3). This phase adds one input to it (section 6.4) | Decide in phase 4's review whether attachments are inside the signed hash |
| 5 Admin configuration | Nothing required. If team settings exist, the cap and the size limits become settings instead of constants | Constants stand |
| 7 Routes | Nothing. Photos are not in the route cache (section 11) | |
## 3. The design in one page
1. **An attachment is two things with two receipts.** A small synced record (who, what, which note, and the SHA-256 of the file) goes through the existing change protocol. The bytes go through upload routes. The phone deletes the file only when both are confirmed. Reason: the record is small and reuses every sync rule; the bytes need chunks.
2. **The file's hash is inside the record's value.** So the change's own hash-confirmed receipt fixes which file the server expects, and a signature on a note can cover its photos before the bytes arrive.
3. **Chunks are 64 KiB and go through our API, never straight to storage.** Reason: D4 (phones talk only to the API), every write is permission-checked and audited, and a 64 KiB request fits D24's weak-link budget. S3 multipart cannot take parts under 5 MiB, so the API stages chunks as small objects and assembles them (section 12, departure 1).
4. **The server confirms what it stored, not what it received.** After writing the final object it reads it back from storage, hashes it, and only then writes the receipt row with its audit event. Reason: the promise is about the stored copy (PRD 573, 608).
5. **Attachments are append-only.** No field of one is overwritten. "Current profile photo", "photos on this wound" and "pages of this document" are worked out from the rows. Removing one is a one-way mark, "entered in error". Reason: two phones offline cannot conflict.
6. **Bytes follow their record.** If the record lands on the chart, the bytes are stored for the chart. If the record is held in quarantine, the same routes store the bytes beside it. Reason: PRD 560, "no care record is lost".
7. **On the phone a file is sealed in 64 KiB segments with its own random key, and that key lives only in the SQLCipher database.** Reason: the existing key hierarchy then covers files with no new keystore item; destroying the user's key, or deleting one row, makes a file unreadable even if flash keeps its blocks.
8. **Capture is our own native code and returns bytes in memory.** No plugin that writes a temporary JPEG, no system camera app, no picker. Reason: PRD 598, "nothing in plain files"; the system camera saves to the gallery on some phones.
9. **Old files are never kept on a phone.** A stored file is viewed online, held in memory, and logged on the server at fetch. Reason: least PHI on the phone, and a read that cannot be logged is refused.
10. **No new permission keys.** Wound photos follow `encounters.chart`; profile photos and documents follow `patients.edit`; viewing follows `patients.view` (section 7.1).

## 4. Data model
Migrations take **the next free numbers** after phase 4's, named by what they add: `<n>_attachments.sql`, and `<n+1>_attachment_sync_names.sql` only if phase 4 left a list of entity names in SQL to extend (today `0009_patients.sql` line 458 has one; check at build time).

### 4.1 `<n>_attachments.sql` (tables, policies, trigger: level X)
`sineobex.attachments`: one row per photo or document page. **Append-only**, except the three `entered_in_error_*` columns, which a trigger lets move from null to a value once.

| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid PK | Made on the device (or by the portal) |
| `team_id` | uuid not null | FK teams. Leads every index |
| `patient_id` | uuid not null | FK patients. Reads group by `canonical_id` (D27); add this table to the schema test that lists every table with a `patient_id` |
| `kind` | text not null | `wound_photo`, `profile_photo`, `document` (check) |
| `note_id` | uuid null | FK encounter notes. Required for `wound_photo`, null otherwise (check) |
| `encounter_id` | uuid null | Filled by the server from the note |
| `field_path` | text null | The form's photo-set field, for example `wounds.1.photos`. Required for `wound_photo`; ≤ 120 chars; same pattern as data paths |
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
| `late` | boolean not null default false | Arrived after its note was finished |
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

**Row-level security**, all four tables: `enable row level security; force row level security;` and one policy `using (team_id = current_setting('app.team_id')::uuid) with check (same)`, exactly as `0009_patients.sql` does. `attachment_chunks` gets `team_id` too so it needs no join.

### 4.2 Phone tables (SQLCipher schema, next version; `apps/mobile/lib/sync/local_db.dart`, level X)
`attachment_files`: `attachment_id` text PK; `kind`; `patient_id`; `parent_id` (note, or patient); `sha256`; `byte_size`; `chunk_count`; `file_key` blob(32); `state` (section 5.1); `have_json` (chunk indexes the server reported); `attempts` int; `last_problem` text (a code, never a message with details); `created_at`; `stored_at`. The sealed file is `att/<attachment_id>.sxa` beside the database. Server copies of attachment **metadata** ride in the patient record's `_chart` field (D44), never in a table of their own, and never with bytes.

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
| any | entered in error | the creator on the phone (sync `set`), or a member holding the kind's create key in the portal | One way. The file is kept in storage and hidden from the chart; an admin with `team.view_audit` still sees that it existed |

There is no delete and no replace. A retake is a new attachment; the first is marked entered in error with reason `unreadable`.

### 5.3 Derived values (sums, never stored)
| Value | Rule |
|---|---|
| Photos in a set | Attachments with that `note_id` and `field_path`, not entered in error |
| Cap | The form field's `max` (default 5, PRD 486, 404). A hard stop on the phone. The server never refuses for it: it accepts and sets `over_cap` |
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
| `attachmentAccess` | `permissions`, `kind`, `action` (`create`, `view`, `mark_error`), `noteClass` | bool (section 7.1) | `access.json` (extended) |
| `validateAttachmentValue` | the create value | list of problem codes | `attachment-rules.json` |
| `sniffMime` | first 16 bytes | `image/jpeg`, `image/png`, `application/pdf` or null | `mime-sniff.json` |
| `stripJpegMetadata` (Dart; TS for the portal) | JPEG bytes | JPEG bytes without APP1–APP15 and COM segments; throws if not a JPEG | `jpeg-strip.json` (hex) |
| `storageKey`, `stagingKey` (TS) | `teamId`, `attachmentId`, `idx` | `<team>/<id>`, `staging/<team>/<id>/<idx>` | `attachment-rules.json` |
| `sealSegment`, `openSegment` (Dart only) | key, index, final flag, bytes | bytes | `sealed-file.json` (known answers) |
### 5.5 The sealed file format (Dart, `apps/mobile/lib/attachments/sealed_file.dart`)
Header: the 4 bytes `SXA1`. Then one segment per upload chunk: AES-256-GCM over 65 536 plaintext bytes (the last is shorter), key = the file's own random 256-bit key, nonce = 8 zero bytes then the segment index as a big-endian u32, associated data = index then one byte `1` for the last segment and `0` otherwise, followed by the 16-byte tag. So chunk `i` can be read and decrypted alone, a truncated or reordered file fails to open, and plaintext never touches disk. The write goes to `<id>.sxa.part`, is flushed, then renamed; a `.part` file found at start-up is deleted (its record was never made).

## 6. Sync
### 6.1 One new entity: `attachment`
Registered like the phase 3 entities (`services/api/src/sync/entities/attachment.ts`, `entities.dart`, the fake). Category for the unsynced summary: `photos`.

| Op | Field | Value | Permission (`attachmentAccess`) |
|---|---|---|---|
| `create` | | `{patientId, kind, noteId?, fieldPath?, groupId?, page?, docType?, docDate?, mime, byteSize, sha256, chunkSize, width?, height?, rotation}` | `create` for the kind |
| `set` | `enteredInError` | `{reason}` | `mark_error`: the creator only, on a phone |

Parents: the patient always; the note for a wound photo. Takes the team write lock (it names a patient, D32). Clock pause: wound photos pause with notes; profile photos and documents do not (D35's split).

### 6.2 What the server answers
| Case | Answer | Then |
|---|---|---|
| Valid create | `accepted`, hash of the value | Row inserted; audit `attachment.created`; the upload may open |
| Same change again | The stored receipt (existing rule) | |
| Value fails `validateAttachmentValue` (bad hash text, size, mime, chunk count, kind and parent mismatch) | `rejected`, `validation`, `details.problem` = the code | Needs attention; the file stays sealed |
| Patient or note unknown | `rejected`, `stale_reference`, `patient_missing` or `encounter_note_missing` (existing parent rule) | Held with its parent's own change, or Needs attention |
| Patient merged | `accepted`, stored as sent; `details.redirectedTo` (D27) | |
| Photo set already at `max` | `accepted`, `details.overCap: true` | Shown with a notice; never refused |
| Note already finished | `accepted`, `details.outcome: 'late'` | Both people told, as phase 4 rule 6 |
| No permission, or the user was removed | `rejected`, `permission`, `quarantined: true`, stored hash (existing rule, D17) | The change leaves the phone; **the file does not**: it uploads into quarantine (6.3) |
| `set enteredInError` by its creator | `accepted` | Audit `attachment.entered_in_error` |
| `set enteredInError` already set | `accepted`, `details.outcome: 'already'` | No second event |
| `set enteredInError` by someone else | `rejected`, `permission`, quarantined | |
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
| Phase 4 sign-off hash | Gains the note's attachments as a sorted list of `{id, sha256}`. A photo added after signing is `late` |
### 6.5 What the fake must mirror (`apps/mobile/test/sync/fake_server.dart`, level X; plan risk 7, D52)
Every row of 6.2; `completeDecision`; chunk hash checking; "open is idempotent"; "complete is idempotent"; mismatch clears staging; the quarantine origin. The blob half lives in a new `apps/mobile/test/sync/fake_blob_server.dart`, treated as level X too. `fake_parity_test.dart` gains one case per rule, each pinned to the real API's answer.

### 6.6 What a phone holds
| Thing | How it gets there | When it leaves |
|---|---|---|
| A sealed file and its key | Capture | Both receipts, and the parent out of use (note closed or signed, form closed): PRD 572, 573 |
| Attachment metadata of a cached chart (ids, kinds, times, stored or not) | With the chart, in `_chart` | With the chart (D30, D44) |
| Bytes of a stored file | Never on disk. Fetched online into memory to view | When the viewer closes, at lock, at background |
## 7. API routes that only work online
### 7.1 Permissions (`attachmentAccess`, existing keys only)
| Action | Wound photo | Profile photo | Document |
|---|---|---|---|
| Create | `encounters.chart` | `patients.edit` | `patients.edit` |
| View file or list | `patients.view` and `encounters.chart`; plus the note's own class (`patients.view_sensitive`, `patients.view_sensitive_exams`) when phase 4's projection asks for it | `patients.view` | `patients.view` |
| Mark entered in error (portal) | `encounters.chart` | `patients.edit` | `patients.edit` |
### 7.2 Routes
| Path | Key | Request → answer | Refusals | Audit |
|---|---|---|---|---|
| `POST /v1/attachments/{id}/upload` | Creator of the record, on its device (or portal session) | none → `{state, chunkSize, chunkCount, have: int[]}` | 404 `attachment_unknown` (no accepted or quarantined create by this caller) | `attachment.upload_opened`, first time only |
| `PUT /v1/attachments/{id}/chunks/{index}` | Same | body: raw bytes, header `x-chunk-sha256` → `{index, sha256}` | 409 `chunk_hash_mismatch`; 413 `chunk_too_large`; 400 `chunk_out_of_range`; 409 `already_stored` (treated as success by the phone, which then calls complete) | None: staging holds no chart data (section 9) |
| `POST /v1/attachments/{id}/complete` | Same | none → `{state: 'stored', sha256, byteSize}` | 409 `chunks_missing {missing}`; 409 `hash_mismatch` | `attachment.stored`, or `attachment.upload_refused` |
| `POST /v1/devices/{deviceId}/quarantine/attachments/{id}/upload`, `.../chunks/{index}`, `.../complete` | The device key, as the existing quarantine route | As above | As above, plus the device-key refusals | Same events, `origin: 'quarantine'` |
| `GET /v1/patients/{patientId}/attachments` | `patients.view`; rows filtered by `attachmentAccess` | → metadata rows with `stored: bool` | 403 | `attachment.listed` (`patientId`, count) |
| `GET /v1/attachments/{id}/content` | `attachmentAccess(view)` | → the bytes, `Cache-Control: no-store`, `Content-Disposition: inline` | 403; 404; 409 `not_stored_yet` | `attachment.viewed`, committed before the first byte is sent |
| `POST /v1/attachments` | `attachmentAccess(create)`; documents and profile photos only | The create value → the row | 400 with the validation codes; 403 | `attachment.created` (`source: 'portal'`) |
| `POST /v1/attachments/{id}/entered-in-error` | 7.1 | `{reason}` → the row | 403; 409 `already` | `attachment.entered_in_error` |

**Complete, in order.** (1) Lock the session row. If a blob row exists, answer `stored` again. (2) `completeDecision`. (3) Read the staged chunks in order, check size and SHA-256 against the session. On mismatch: delete staged objects and chunk rows, audit `attachment.upload_refused`, answer `hash_mismatch`. (4) Put the final object at `storageKey`. (5) Get it back from storage and hash it. (6) In one transaction: insert `attachment_blobs`, set the session `stored`, write `attachment.stored`. (7) Delete staged objects, best effort; `open` on a stored session deletes leftovers. An object can exist without a receipt row (harmless, overwritten on retry). A receipt row never exists without a checked object.

**Storage interface** (`services/api/src/blobs/store.ts`, added to `Deps` as `blobs`): `put(key, bytes)`, `get(key) → bytes | null`, `delete(key)`, `deletePrefix(prefix)`. Two implementations: memory (tests, local) and S3 API with SigV4 over `fetch` (one class for Supabase Storage and S3; it runs on Node and Deno, D3). Config: `BLOB_ENDPOINT`, `BLOB_REGION`, `BLOB_BUCKET`, and two secrets; rows for `docs/setup.md`.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast, reflows at narrow width, and is tested offline (CLAUDE.md).

### 8.1 Phone (`apps/mobile/lib/features/attachments/`)
| Screen | Shows | States | Wording |
|---|---|---|---|
| Photo set field (inside a phase 4 form) | Button, count, a row of the set's photos | Empty; 1–4; full; clock paused | Button "TAKE WOUND PHOTO"; "Photos: Up to 5" (field spec rows 116, 306–307, via `forms-inventory.md` 143, 278). Full: "This wound has 5 photos. That’s the most a visit can hold." |
| Capture | Live preview, shutter, flash, close | Asking for the camera; refused; ready; saving; no space | Refused: "Sineobex needs the camera to add photos. Turn it on in Settings." No space: "This phone is out of space. The photo wasn’t saved." |
| Review (after each shot) | The photo just taken | | Buttons "Retake photo", "Add another photo", "Submit photo" (field spec row 117) |
| Photo tile | Image if the file is still here; otherwise a plain tile with its state | "On this phone", "Sending 3 of 12", "Saved", "Needs attention", "Marked entered in error" | A person is never shown a hash or a byte count |
| Viewer | One image, full screen, pinch to zoom; capture time and author | Local file; online fetch; offline and not here | Offline: "This photo is saved on the server. Connect to see it." No share, save or copy control exists |
| Profile header photo | A plain covered tile until tapped (PRD 721) | No photo; covered; shown; offline | "Tap to show photo". Add or replace: "Take profile photo" |
| Documents (profile) | A list by date and type, page count | Empty; list; offline | "Add document" opens type, optional date, then Capture for each page: "Add another page", "Done" |
| Needs attention row | A damaged or refused file | | "A photo couldn’t be saved to the chart. Take it again if you can." |
| Log-out alert line | Stored of total | | "Photos: 2 of 6" (PRD 575) |

The viewer and tiles draw with `Image.memory` only. The image cache is cleared when the app locks or goes to the background (`apps/mobile/lib/security/idle_lock.dart` gains a callback).

### 8.2 Portal (`apps/portal/src/app/(app)/patients/[id]/`)
| Page | Shows | States | Notes |
|---|---|---|---|
| Documents tab | List; viewer; "Upload document" (type, date, file); "Mark entered in error" with a reason | Empty; uploading with progress; failed with "Try again" (the chosen file stays in the form, PRD 606); refused type or size | JPEG, PNG, PDF; 20 MiB. The route handler hashes, creates, chunks and completes server-side; nothing is written to disk or browser storage |
| Photos in wound history | Dated photos per wound | "Still on the phone of the person who took it" for a record with no file yet | Sizes come from phase 4 |
| Profile header | Covered until clicked; the click fetches, and the fetch is the logged read | | |
| File route `/patients/[id]/files/[attachmentId]` | Proxies `GET .../content` | | `no-store`; generic page title; the URL holds two UUIDs and nothing else |
| Team devices page | `photos` in each phone's unsynced counts | | Existing page, one more label |

There is no download button, and the image element sets `draggable=false`. A browser can still save an image; that is PRD 602's stated desktop risk, and exports are phase 10's (section 12).

## 9. Audit events and PHI rules
| Event | When | Details (IDs, counts and hashes only, D33) |
|---|---|---|
| `attachment.created` | Sync create or portal create, same transaction | `attachmentId`, `patientId`, `kind`, `noteId`, `source`, `byteSize`, `overCap`, `late` |
| `attachment.upload_opened` | First open of a session | `attachmentId`, `origin`, `chunkCount` |
| `attachment.stored` | The receipt row's transaction | `attachmentId`, `byteSize`, `chunkCount`, `sha256`, `origin` |
| `attachment.upload_refused` | Whole-file mismatch | `attachmentId`, `problem` |
| `attachment.listed` | List route | `patientId`, `count` |
| `attachment.viewed` | Content route; and offline on the phone through `LocalStore.appendAudit` when someone opens a local file | `attachmentId`, `patientId`, `kind` |
| `attachment.entered_in_error` | Either path | `attachmentId`, `reason` (a code) |

Rules that apply: no file name, document type text, note text or patient name in details, logs or URLs. Storage keys and local file names are UUIDs. Chunk writes are not audited one by one: they are staging, not chart data, and the session's open and stored events bracket them (a reading of "every action", stated in section 12). A content read whose audit insert fails sends no bytes. API logs for these routes carry `requestId`, `attachmentId`, index and sizes only. Images never enter crash reports, notifications or `kv`.

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
| Permissions | `access.json` vectors; API tests per route and role; a Billing/Data role gets 403 on a wound photo |
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
| 3 | May Billing/Data and Logistics see wound photos? | No: `patients.view` and `encounters.chart` | Minimum necessary; D38 narrows nothing else | The project lead |
| 4 | Which key adds a document or a profile photo? | `patients.edit` | It is demographic paperwork, and CHWs hold it | The project lead |
| 5 | Document types | Six (4.1) | PRD 727 names two; the rest are the common papers | Brooke and Mercy |
| 6 | Are any photos kept on the phone for offline viewing (route cache, profile photo)? | None | Least PHI on the phone | Brooke and Mercy, then the project lead |
| 7 | "Blurred until tapped" (PRD 721) | A plain covered tile; the tap fetches and logs | Bytes are not fetched, so nothing is disclosed, until someone asks | The team |
| 8 | Image size and limits | Long edge 2048 px, quality 80; 8 MiB per phone file; 20 MiB per desktop file; 50 pages per document | Enough for wound detail at about 1 MB a photo | Brooke and Mercy (detail), the team (cost) |
| 9 | Who may mark an attachment entered in error? | Its creator on the phone; any holder of the kind's create key in the portal | What only the author does works offline (phase 4 rule 5) | Brooke and Mercy |
| 10 | Is a photo part of what a signature covers? | Yes, by hash | A signed note should not change silently | Brooke and Mercy, with counsel |
| 11 | Uploads in the background, app closed | No: only while the app is open and unlocked | The file key needs the unlock; no background PHI handling | The team |
| 12 | Consent for a photo | Nothing new: registration consent covers charting | The PRD names no photo consent | Counsel |

**Questions with no default.** (a) Counsel: must a file marked entered in error for "wrong patient" be removed from storage, and after how long? (b) Counsel: are photos of identification documents subject to extra rules in Michigan? (c) The team: which device is the pilot's oldest phone, for the capture and memory tests?

## 12. Risks, and where the design departs from the PRD
**Departures and readings.**
1. **"S3 multipart upload" (PRD 608) is read as "resumable chunks" (PRD 573).** S3 parts must be at least 5 MiB, larger than a whole photo, and far too big for D24's weak links. The phone's chunks are 64 KiB; the API stages and assembles them. The promise (resume where it stopped; confirm after hashing the reassembled file) is kept.
2. **Phones never talk to storage.** No presigned URLs (D4, and every write audited).
3. **Purge waits for the note to close** (PRD 572) even though PRD 573 says "then the local file is deleted". 572 is read as governing: staff should not lose sight of a photo mid-encounter.
4. **Chunk writes are not audit events.** The session's open and stored events are.
5. **The cap is never enforced by refusing on the server.** A refusal there would be one the worker cannot fix.
6. **Hash of the plaintext file.** The phone's file encryption is local; the server hashes the same bytes the phone hashed before sealing.

**Risks.**
1. **Native camera code is new, and iOS has no CI build** (plan risk 5). It is the one place a leak could be introduced unseen. Mitigation: it is small, level X, guarded by `leak-guard`, and checked on a device before the pilot.
2. **Memory.** A whole photo is in memory at capture and at view; complete holds up to 20 MiB in the API. Edge Functions have tight limits: measure in the preview, and lower the desktop limit there if needed.
3. **The fake now mirrors a second protocol** (plan risk 7). Mitigation: `completeDecision` is shared logic pinned by vectors, and parity tests cover each answer.
4. **Supabase Storage's S3 API may differ from S3** (errors, listing for `deletePrefix`). Mitigation: the interface is four calls; the live job runs them against the preview's storage.
5. **Orphans.** A phone lost before upload leaves a record with no file, for good. The chart says so; the devices page already shows the phone's unsynced photos; nothing can recover them (PRD 604 accepts this for remote wipe).
6. **Desktop uploads are untrusted files.** Type is checked by signature, size is capped, files are served `inline` with `nosniff`. No malware scan until phase 12.
7. **A browser can save a displayed image.** Stated by PRD 602; not solvable in a web app.
8. **Flash storage keeps deleted blocks.** Mitigated by the per-file key: deleting the row is the erase.
9. **Phase 4 may be built differently from its design.** The photo-set field, the note class and the sign-off hash are the three joins; check them first (section 2).

## 13. Units and a first card list
Units own disjoint files. U0 lands first, alone, with CI green. Then U1 and U2 (server), U3 then U4 (phone core), U5 beside them, then U6 and U7, then U8. "Tests" are extra to the three source files. **Level X units, plainly:** U0's migration and `Deps` cards, all of U1, all of U3, the receipt cards of U2, U5 (native), and U8's `tools/` and `.github` cards.

| # | Card | Level | Files | Needs |
|---|---|---|---|---|
| | **U0 Schema, contract and core rules (first, alone)** | | | |
| 0.1 | Vector files for chunks, steps, rules, mime, JPEG strip | T | `packages/contract/test-vectors/attachment-*.json`, `mime-sniff.json`, `jpeg-strip.json` | |
| 0.2 | Migration: four tables, policies, append-only triggers | X | `db/migrations/<n>_attachments.sql` | |
| 0.3 | Migration: entity names in SQL, if any remain | X | `db/migrations/<n+1>_attachment_sync_names.sql` | 0.2 |
| 0.4 | TS chunk functions | T | `services/api/src/attachments/rules.ts` | 0.1 |
| 0.5 | TS step, purge, complete and cap functions | T | `services/api/src/attachments/rules.ts` | 0.4 |
| 0.6 | TS value validation, mime sniff, storage keys | T | `services/api/src/attachments/validate.ts` | 0.1 |
| 0.7 | `attachmentAccess` and its vectors | X | `services/api/src/auth/permissions.ts`, `access.json` | 0.1 |
| 0.8 | Blob store interface, memory store, `Deps.blobs` | X | `services/api/src/blobs/store.ts`, `services/api/src/types.ts`, test harness | |
| 0.9 | Route and value schemas, routes answering 501, contract regenerated | T | `services/api/src/routes/attachments.ts`, `services/api/src/attachments/schemas.ts`, `services/api/src/app.ts` | 0.6 |
| 0.10 | Test fixtures: a demo JPEG maker, `createAttachment`, `expectStored` | S | `services/api/test/attachment-fixtures.ts` | 0.9 |
| | **U1 Server sync entity (level X throughout)** | | | |
| 1.1 | `attachment` entity: create, parents, lock, permission | X | `services/api/src/sync/entities/attachment.ts`, `index.ts`, `schemas.ts` | U0 |
| 1.2 | `over_cap`, `late`, merged-patient details on the receipt | X | `entities/attachment.ts` | 1.1 |
| 1.3 | `set enteredInError`, one way | X | `entities/attachment.ts` | 1.1 |
| 1.4 | Attachment list inside the chart bundle (`_chart`) | X | the chart projection file phase 4 leaves, `services/api/src/patients/` | 1.1 |
| | **U2 Server upload, receipt and reads** | | | |
| 2.1 | Open a session from an accepted create | T | `services/api/src/attachments/sessions.ts` | U0 |
| 2.2 | Open a session from a quarantined create | X | `sessions.ts` | 2.1 |
| 2.3 | Put a chunk: hash, size, range, replace | T | `services/api/src/attachments/chunks.ts` | 2.1 |
| 2.4 | Complete: assemble, read back, receipt and audit in one transaction | X | `services/api/src/attachments/complete.ts` | 2.3 |
| 2.5 | Device-key variants of the three routes | X | `services/api/src/routes/devices.ts`, `sessions.ts` | 2.2, 2.4 |
| 2.6 | List route with `attachment.listed` | T | `services/api/src/attachments/reads.ts` | U0 |
| 2.7 | Content route: audit first, then bytes, `no-store` | T | `reads.ts` | 2.4 |
| 2.8 | Portal create route | T | `services/api/src/attachments/create.ts` | U0 |
| 2.9 | Entered-in-error route | T | `create.ts` | 2.8 |
| 2.10 | S3-API blob store with SigV4 | X | `services/api/src/blobs/s3.ts`, `config.ts`, both entry files | 0.8 |
| 2.11 | Demo seed: three attachments with generated images | S | `db/seed/` | 2.4 |
| | **U3 Phone store and fake (level X throughout)** | | | |
| 3.1 | Local schema: `attachment_files` | X | `apps/mobile/lib/sync/local_db.dart` | U0 |
| 3.2 | Entity registry: `attachment`, category `photos`, clock rule | X | `apps/mobile/lib/sync/entities.dart` | U0 |
| 3.3 | `unsynced`, `hasUnsynced`, purge hook, file re-point on a fix | X | `apps/mobile/lib/sync/local_store.dart` | 3.1, 3.2 |
| 3.4 | Engine: run the uploader after a push; hand-over waits for files | X | `apps/mobile/lib/sync/sync_engine.dart`, `sync_controller.dart` | 3.3, 4.6 |
| 3.5 | Fake: the `attachment` entity rules | X | `apps/mobile/test/sync/fake_server.dart` | U1 |
| 3.6 | Fake blob server and parity cases | X | `apps/mobile/test/sync/fake_blob_server.dart`, `fake_parity_test.dart` | U2 |
| | **U4 Phone attachments domain (`apps/mobile/lib/attachments/`)** | | | |
| 4.1 | Dart chunk, step, purge, cap functions | T | `rules.dart` | 0.1 |
| 4.2 | Dart value validation, mime sniff, `attachmentAccess` | T | `validate.dart`, `apps/mobile/lib/patients/access.dart` | 0.1, 0.7 |
| 4.3 | `stripJpegMetadata` | T | `jpeg.dart` | 0.1 |
| 4.4 | Sealed file: segments, write through `.part`, read one segment | T | `sealed_file.dart` | 0.1 |
| 4.5 | File vault: directory, start-up sweep, delete on wipe | T | `file_vault.dart` | 4.4, 3.1 |
| 4.6 | Uploader: open, send, complete, rehash, driven by `fileStep` | T | `uploader.dart` | 4.1, 4.5, 3.6 |
| 4.7 | Repository: capture to record and file in one step; list; mark error | T | `attachment_repository.dart` | 3.3, 4.3, 4.5 |
| 4.8 | Online viewer source: fetch to memory; offline audit for local views | T | `attachment_reader.dart` | 4.7 |
| 4.9 | Providers and the capture-source interface with a fake for tests | S | `attachment_providers.dart`, `capture_source.dart` | 4.7 |
| | **U5 Native capture (level X: a strong model or a person)** | | | |
| 5.1 | Android: CameraX in-memory capture, platform view, `CAMERA` permission | X | `CaptureChannel.kt`, `MainActivity.kt`, `AndroidManifest.xml` | |
| 5.2 | iOS: AVFoundation in-memory capture, platform view, usage text, file protection | X | `CaptureChannel.swift`, `AppDelegate.swift`, `Info.plist` | |
| 5.3 | Dart channel wrapper implementing the capture source | T | `apps/mobile/lib/attachments/capture_channel.dart` | 4.9, 5.1 |
| | **U6 Phone screens (`apps/mobile/lib/features/attachments/`)** | | | |
| 6.1 | Capture screen and its refusals | R | `capture_screen.dart` | 5.3 |
| 6.2 | Review screen: Retake, Add another, Submit | R | `review_screen.dart` | 6.1 |
| 6.3 | Photo tile with its five states | R | `photo_tile.dart`, `attachment_labels.dart` | 4.7 |
| 6.4 | Photo set field for phase 4 forms, with the cap | R | `photo_set_field.dart`, the form field registry | 6.2, 6.3 |
| 6.5 | Viewer; image cache cleared at lock | R | `viewer_screen.dart`, `apps/mobile/lib/security/idle_lock.dart` (X: reviewed twice) | 4.8 |
| 6.6 | Profile header photo, covered until tapped | R | `profile_photo.dart`, the profile screen | 6.5 |
| 6.7 | Documents list and add flow | R | `documents_screen.dart`, `add_document_screen.dart` | 6.2 |
| 6.8 | Needs attention row and the "Photos: 2 of 6" line | R | the sync feature's list and log-out alert | 3.3 |
| | **U7 Portal** | | | |
| 7.1 | File route: proxy, `no-store`, generic title | T | `apps/portal/src/app/(app)/patients/[id]/files/[attachmentId]/route.ts` | 2.7 |
| 7.2 | Upload action: hash, create, chunk, complete, in memory | T | `apps/portal/src/app/actions/attachments.ts`, `apps/portal/src/lib/chunks.ts` | 2.4, 2.8 |
| 7.3 | Documents tab with upload and mark-in-error | R | `patients/[id]/documents/page.tsx`, its form component | 7.1, 7.2 |
| 7.4 | Covered profile photo; photos in wound history | R | the profile page, `photo-strip.tsx` | 7.1 |
| 7.5 | `photos` on the devices page; labels | S | the devices page, `apps/portal/src/lib/labels.ts` | |
| 7.6 | Playwright: upload, view, mark, axe in three themes, no browser storage | T | `apps/portal/e2e/documents.spec.ts` | 7.3 |
| | **U8 Leak guards and the Done when** | | | |
| 8.1 | `leak-guard`: banned packages, calls and manifest keys | X | `tools/leak-guard.mjs`, `tools/ci-local.sh` | U5 |
| 8.2 | Done-when host test against the fake (steps 1, 2, 4–8) | T | `apps/mobile/test/attachments/done_when_test.dart` | U4, U3 |
| 8.3 | Done-when in the live job against the real API | X | `tools/live-sync.sh`, its Dart driver | 8.2, U2 |
| 8.4 | Android emulator test of step 3, and its CI job | X | `apps/mobile/integration_test/camera_roll_test.dart`, `.github/workflows/` | 5.1, 6.2 |
| 8.5 | iOS device checklist and the compliance page | S | `docs/compliance/photo-handling.md` | 5.2 |
| 8.6 | Plan: decisions, section 6 rows, phase status, setup rows | S | `IMPLEMENTATION_PLAN.md`, `docs/setup.md`, this file's Status | all |

**Count: 63 cards.** S 6, T 24, R 10, X 23.
