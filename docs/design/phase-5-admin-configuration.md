> Draft plan (Nov 14), written before phase 4 was built. Check section 2 against the code before building, and write the task cards when the phase starts.

# Phase 5: Admin configuration
PRD citations are `main.md:<line>` and `build-plan.md:<line>` (the saved copies of the product spec). Code citations are paths on the pull request branch.

## 1. Scope and Done when
**Done when** (`build-plan.md:91`, `IMPLEMENTATION_PLAN.md:161`): an admin adds a Labs item, a bundle and a secondary flag, and a phone sees all three after its next sync.

| In | PRD |
|---|---|
| Admins own every team preset, on desktop | `main.md:185-192`, `:198-199` |
| Note types: use as is, edit, remove, add; edits versioned; used ones archived; a platform update never overwrites a team copy | `main.md:387` |
| Bundles: use, edit, remove, add; core and optional lines; Medical or Non-Medical tag | `main.md:128`, `:437-448` |
| Item catalog; each item counted in its dispensing unit, set at creation; no conversions | `main.md:127`, `:469`, `:472` |
| Orders categories: OTC, Rx, Labs and others the admin adds; a Labs item records a result | `main.md:104` |
| Field-to-supply mappings, firing on the action field | `main.md:424-431`, `:470` |
| Condition-to-supply mappings with a quantity per patient; the problem status-check window (default 90 days) | `main.md:476` |
| Two-tier flags: primary risk levels placed at a rank, secondary condition flags, criteria text; a flag change records who and why; sensitive flags hidden from Billing and Data | `main.md:120-121`, `:316-320` |
| Bag minimums: per bag, a template for new bags, on or off per team | `main.md:477` |

| Out | Taken by |
|---|---|
| Stock counts, the Orders tab, suggest then confirm, deduction, the restock reminder itself, bag owners, the allergy check | Phase 6 (`build-plan.md:93-98`) |
| The bag check and the route packing list (they read this phase's mappings); ranking the route builder and the continuity queue by flags | Phases 7 and 9 (`main.md:476`, `:478`) |
| Alert rules, geofence radius, resource directory settings | Phase 6 (alerts); V2 (`main.md:190-191`) |
| A free-form form builder (branching rules, layout); barcode scanning; pack-to-unit conversion | V2 or deferred (`main.md:479`, `:127`). Phase 5 edits note types through a fixed list of operations (5.4) |

## 2. Ground truth
What the code has today:

| Fact | Where |
|---|---|
| `team.manage_presets` exists: "Change note types, bundles, the item catalog, flags, mappings and alert rules". Only Program Admins hold it among standard roles. | `services/api/src/auth/permissions.ts:14`; `db/migrations/0002_identity_access.sql:76-97` |
| No table for items, bundles, flags, mappings, bags or note types. The last migration is `0016_merge_review_undo.sql`. | `db/migrations/` |
| `patients.priority_flag_key text` exists, is never read or written, and carries the comment "phase 5 adds the team flag table and the FK". | `db/migrations/0009_patients.sql:58` |
| `encounter_notes` stores `note_type_key` and a nullable `note_type_version`. | `db/migrations/0004_sync.sql:60-61` |
| Problems carry an optional ICD-10-CM `code` with a format check. | `db/migrations/0010_problems.sql:13-14` |
| The team policy block (row-level security on `team_id`) and the revoke of update and delete on history tables. | `db/migrations/0004_sync.sql:185-198` |
| An admin route opens `teamScope(c, deps, {permissions, recentAuth})`, writes inside `scope.tx(async (tx, audit) => …)` and audits in that transaction. A refusal writes `access.denied`. | `services/api/src/routes/roles.ts:141-192`; `services/api/src/auth/context.ts:230-256` |
| The phone refreshes server data after each sync through `AfterSyncRefresher`; the team index is the model (a table in the team database, replaced from a read route). | `apps/mobile/lib/sync/sync_engine.dart:89`; `apps/mobile/lib/patients/team_index.dart:330`; `apps/mobile/lib/sync/local_db.dart:256` |
| Synced entities are registered with their permission, parents and field rules; the phone test server mirrors them by hand. | `services/api/src/sync/entities/index.ts`; `apps/mobile/test/sync/fake_server.dart` |
| Every table with a `patient_id` must be listed in `CHART_TABLES`. | `services/api/src/patients/charts.ts:24-37` |
| Portal admin pages so far: `devices`, `duplicates`, `members`, `merges`, `problem-reversals`, `quarantine`, `reviews`, `roles`. None for presets. | `apps/portal/src/app/(app)/team/` |
| `packages/forms` does not exist. Shared vectors live in `packages/contract/test-vectors/`. | `packages/`; `docs/design/phase-4/lifecycle.md:140-148` |

What must be delivered first (not built on Nov 14; the phase 4 forms design does not yet specify the storage, so each row is a check):

| From | Thing | Phase 5 needs |
|---|---|---|
| Phase 4, forms part (migration 0017, D13) | `note_type_versions`, one row per team, key and version, with the definition as JSON; platform presets installed for each team | Rows are append-only. If there is no head row per note type, unit E adds one (4.3) |
| Phase 4, forms part | The definition schema in `packages/forms` | Stable ids for sections, fields and options; a `locked` mark on fields that rules depend on; option lists shared by id (`main.md:410`) |
| Phase 4, both parts | The read route that gives a phone its note types and the phone's cache of them; a note keeps its `note_type_version` from creation to signing | The route serves any stored version by key and version; the phone keeps every version a note it holds was written on (6.4) |
| Phase 4 | The encounter and chart screens on the phone | The flag row (8.2) sits on the chart header |

## 3. The design in one page
1. **Every setting is a preset: a head row plus append-only versions with a JSON body.** One pair of tables holds eight kinds. One shape means one set of rules, one route file and one portal pattern, repeated.
2. **Presets are written only online, in the portal, never through the change protocol.** Admins work on desktop (`main.md:185`), so no phone can hold a refused preset change.
3. **A phone gets presets from one read route, by revision, after every sync, and keeps them in its team database.** Presets hold no patient data, so they stay until the team database is wiped. Everything works offline from that copy.
4. **Nothing is deleted. Remove means archive.** Old notes, orders and reports can always resolve an id. This is stricter than the PRD, which archives only what was used (`main.md:387`).
5. **What a count or a rank means never changes after creation**: an item's unit, a category's behaviour and a flag's tier are fixed. To change one, archive and add. An old order then never changes meaning.
6. **Records made against an older version are kept, never refused.** A record stores the preset id and the version it was made on. A phone offline cannot know about an edit or an archive.
7. **A platform update touches only copies the team never edited.** An edited copy gets an offer the admin may take. An archived copy stays archived.
8. **Note types are edited by a fixed list of operations, applied by one pure function on the server.** The server never accepts a definition built by a browser, and a locked field cannot be hidden.
9. **A patient's flags are append-only changes; the current flags are worked out from them.** Two phones offline cannot conflict, and "who set it and why" (`main.md:320`) is the record itself.
10. **No new permission keys.** Writing presets needs `team.manage_presets`. Flagging a patient needs `patients.edit`. Seeing a sensitive flag needs `patients.view_sensitive`.

## 4. Data model
Migrations take the next free numbers after phase 4. All are plain SQL, additive, one transaction. Both add policies, so both are level X.

| File | Adds |
|---|---|
| `<next>_team_presets.sql` | `team_presets`, `team_preset_versions`, `team_preset_state`; the note type head (4.3) if phase 4 has none |
| `<next>_patient_flag_changes.sql` | `patient_flag_changes`; `patient_of_change` learns the new entity (as phase 4's 0020 does) |

### 4.1 `team_presets` (head; the API may update, never delete)
| Column | Type | Meaning and constraint |
|---|---|---|
| `team_id` | uuid not null | FK `teams`. `unique (team_id, id)` so later tables can point here with a composite key |
| `id` | uuid primary key | Made by the server |
| `kind` | text not null | One of `order_category`, `item`, `bundle`, `flag`, `field_supply_map`, `condition_supply_map`, `bag`, `settings`. Never changes. One `settings` row per team: `unique (team_id) where kind = 'settings'` |
| `name` | text not null | Copy of `body.name`, 1 to 80 characters. Unique per `(team_id, kind, lower(name))` where `state = 'active'` |
| `state` | text not null | `active` or `archived` |
| `current_version` | integer not null | At least 1; equals the newest row in `team_preset_versions` |
| `origin_key` | text | The platform preset this came from, for example `bundle.basic_wound_care`. Null for a team's own. Unique per `(team_id, origin_key)` |
| `origin_version` | integer | The platform version this copy was last taken from |
| `platform_latest` | integer | The newest platform version the installer has seen. Greater than `origin_version` means an update is on offer |
| `customized` | boolean not null default false | True once the team edits, archives or restores it |
| `revision` | bigint not null | The team revision at this row's last change (4.2) |
| `created_by`, `updated_by` | uuid | Null for the platform installer |
| `created_at`, `updated_at` | timestamptz not null | Server time |

### 4.2 `team_preset_versions` (append-only) and `team_preset_state`
| Column | Type | Meaning and constraint |
|---|---|---|
| `team_id`, `preset_id` | uuid not null | Composite FK to `team_presets (team_id, id)` |
| `version` | integer not null | Primary key `(team_id, preset_id, version)`; starts at 1, no gaps |
| `body` | jsonb not null | The shape for the kind (4.4). At most 32 KiB |
| `source` | text not null | `team` or `platform` |
| `created_by` | uuid | Null when `source = 'platform'` |
| `created_at` | timestamptz not null | Server time |

`team_preset_state`: `team_id uuid primary key`, `revision bigint not null default 0`. Every preset write adds 1 and stamps the head row, inside the team's audit-chain lock (D32), so revisions are in order with no gaps. Security block for all three: the team policy of `0004_sync.sql:185-195`; `revoke delete` on all three; `revoke update` on `team_preset_versions`.

### 4.3 Note types
Phase 4 owns `note_type_versions`. Phase 5 needs a head row per team and key with the same columns as 4.1 from `state` to `updated_at`. If phase 4 delivered one, unit E adds only the missing columns. If not, `<next>_team_presets.sql` adds `note_types (team_id, key, name, state, current_version, origin_key, origin_version, platform_latest, customized, revision, …)` with primary key `(team_id, key)`, filled from the existing versions. It shares `team_preset_state.revision`.

### 4.4 Body shapes (zod schemas in `packages/presets/src/schemas.ts`; `id` fields are preset ids of the same team)
| Kind | Body | Fixed after creation |
|---|---|---|
| `order_category` | `{name, behaviour: 'supply' \| 'medication' \| 'lab', sort: int}` | `behaviour` |
| `item` | `{name, categoryId, unit: text 1-20, medical: bool, captureLot: bool, result: null \| {type:'choice', options: text[2..12]} \| {type:'number', unit: text}}` | `unit`, `result.type` |
| `bundle` | `{name, medical: bool, lines: [{itemId, qty: int 1-99, core: bool}] (1-40, no item twice)}` | none |
| `flag` | `{name, tier: 'primary' \| 'secondary', criteria: text 0-500, color: one of 8 palette names, rank: int, sensitive: bool}` | `tier` |
| `field_supply_map` | `{name, noteTypeKey, fieldId, when: {equals: value} \| {includes: optionId} \| {answered: true}, lines: [{itemId, qty: int 1-99 \| {fromField: fieldId}}] (1-10)}` | `noteTypeKey`, `fieldId` |
| `condition_supply_map` | `{name, codes: text[1..20] (ICD-10-CM, the format of `0010_problems.sql:14`), lines: [{itemId, qtyPerPatient: int 1-99}] (1-10)}` | none |
| `bag` | `{name, minimums: [{itemId, min: int 1-999}] (0-200, no item twice)}` | none |
| `settings` | `{bagMinimumsOn: bool, newBagMinimums: [{itemId, min}], problemCheckDays: int 7-365}` | none |

Rules the schema cannot hold are in `validatePreset` (5.3): an item's category exists; `result` is set exactly when the category's behaviour is `lab`; `medical` is true when the behaviour is `medication` or `lab`; a bundle holding a `medication` item is `medical` (`main.md:447`); a `primary` flag is never `sensitive`.

### 4.5 `patient_flag_changes` (append-only; a synced entity)
| Column | Type | Meaning and constraint |
|---|---|---|
| `id` | uuid primary key | Made on the phone, or by the API for a portal change |
| `team_id`, `patient_id` | uuid not null | Composite FK to `patients (team_id, id)`. Listed in `CHART_TABLES` as `group`, so a merged chart shows both sides' flags (D27) |
| `flag_id` | uuid not null | Composite FK to `team_presets (team_id, id)`. The API checks `kind = 'flag'` |
| `action` | text not null | `set` or `clear` |
| `reason` | text not null | 1 to 500 characters. Patient detail: never in audit details, logs or notices |
| `effective_at` | timestamptz not null | Clock-corrected device time, as `encounters.started_at` |
| `device_time`, `clock_verified` | timestamptz, boolean | As on `encounters` (`0004_sync.sql:33-52`) |
| `author_user_id`, `created_device_id` | uuid | Who and from where; device null for the portal |
| `created_at` | timestamptz not null | Server receipt |

Index `(team_id, patient_id, effective_at, id)`. Security block: the team policy; `revoke update, delete`. `patients.priority_flag_key` stays unused (12.2).

## 5. Rules
### 5.1 States of a preset and of a note type
An archived preset is never offered for new work. It stays readable everywhere, with its name.

| Act | From | To | Who | Refused when (code) |
|---|---|---|---|---|
| Create | none | `active`, version 1 | `team.manage_presets` | body invalid (`invalid`); name in use (`name_taken`); it points at an archived preset (`reference_archived`) |
| Edit | `active` | `active`, version + 1, `customized` | same | `invalid`; `name_taken`; `reference_archived`; a fixed field changed (`fixed_field`); base version is not current (`stale`); body unchanged (`no_change`) |
| Remove | `active` | `archived`, `customized` | same | an active preset points at it (`referenced`, with counts by kind); `stale`; it is the `settings` row (`not_removable`) |
| Restore | `archived` | `active` | same | `name_taken`; `reference_archived` |
| Take the platform update | `active`, update on offer | version + 1 with the platform body, `customized = false`, `origin_version = platform_latest` | same | `stale`; no update on offer (`no_update`) |
| Platform install or update | see 5.2 | | the installer, no user | never refuses; it skips |

### 5.2 A platform update (`main.md:387`, `:439`)
`platformUpdateEffect({exists, state, customized, originVersion, platformVersion})` returns one of:

| Case | Result |
|---|---|
| The team has no row with this `origin_key` | `install`: head plus version 1, `source = 'platform'` |
| Row exists, `platformVersion <= originVersion` | `skip` |
| Row is `active`, not customized, platform is newer | `update`: version + 1, `source = 'platform'`, `origin_version` moves |
| Row is customized or archived, platform is newer | `offer`: only `platform_latest` moves. The body is untouched |

The installer runs for a new team and for every team at deploy, as phase 4's note type installer does. It is idempotent. Platform data is `packages/presets/data/platform.json`, each entry with `originKey`, `platformVersion` and a body that names other entries by `originKey`.

### 5.3 The pure functions
Each has no database or network in it. TypeScript lives in `packages/presets/src/`, Dart in `apps/mobile/lib/presets/`. Each is pinned by one vector file in `packages/contract/test-vectors/` that both sides read, as `access.json` is today.

| Vector file | Function | Input | Output | Dart |
|---|---|---|---|---|
| `preset-bodies.json` | the schemas of 4.4 | kind, body | accepted, or the failing paths | parsers `parsePreset(kind, json)` accept every valid sample |
| `preset-validate.json` | `validatePreset` | kind, body, `refs` (id to kind, state and the few fields rules read) | `[]` or `[{path, code}]` | no |
| `preset-rules.json` | `presetWriteEffect` | `{act, state, baseVersion, currentVersion, changedFixed, sameBody, referencedBy, archivedRefs, nameTaken, updateOnOffer}` | `{refuse: code}` or `{stateAfter, versionAfter, customizedAfter}` | no |
| `preset-rules.json` | `reorderRanks` | current `[{id, rank}]`, ordered ids | `[{id, rank}]` for flags whose rank changes (rank = position times 10) | no |
| `platform-update.json` | `platformUpdateEffect` | 5.2 | `install`, `skip`, `update`, `offer` | no |
| `flag-current.json` | `currentFlags` | changes `[{flagId, action, effectiveAt, id}]`, flags by id, `maySeeSensitive` | `{primary: id or null, secondary: id[] by rank then name}` | yes |
| `supply-suggest.json` | `suggestSupplies` | active maps, items by id, `noteTypeKey`, the note's answers | `[{itemId, qty, mapId}]`, summed per item | yes |
| `supply-suggest.json` | `bundleLines` | bundle body, items by id, multiplier | `[{itemId, qty, checked}]`; lines whose item is archived are left out | yes |
| `note-type-edit.json` | `applyNoteTypeEdit` (5.4) | definition, one operation | a new definition, or `{refuse: code}` | no |

`currentFlags`: order changes by `effectiveAt`, then `id`. Primary is the flag of the last primary-tier change if its action is `set`, else none. A secondary flag is carried when its own last change is `set`. Archived flags are left out. Sensitive flags are left out unless `maySeeSensitive`.
`suggestSupplies`: a map fires when the note's type matches and the answer at `fieldId` equals the value, includes the option, or is present. `{fromField}` reads a whole number from 0 to 99 from the answers; anything else gives 0, and a line with 0 is left out. A map that names an archived item skips that line. Phase 6 calls it; phase 5 pins it.

### 5.4 Note type edits
`PUT` sends `{baseVersion, ops}`. The server loads the current definition, applies each operation in order with `applyNoteTypeEdit`, validates the result with phase 4's schema and stores it as the next version.

| Operation | Refused when |
|---|---|
| `rename_type {name}` | empty or over 80 characters |
| `set_hidden {target: section or field id, hidden}` | the target is `locked` (`locked`). Red flags, disposition and sensitive-exam consent are locked (`main.md:409`, `:415`) |
| `rename_label {target, label}` | `locked` |
| `add_option {listId, label}`, `rename_option`, `retire_option {listId, optionId, retired}`, `move_option` | the list is `locked`; a retire would leave fewer than one option |
| `add_field {sectionId, type: text, yes_no, choice, multi_choice, number; label; options}` | over 40 team fields in a type |
| `add_section {label, afterSectionId}` | over 10 team sections |

Three rules hold in every case. An id is made by the server and never reused. Nothing is taken out of a definition: a hidden field and a retired option stay, so any note on any version reads against any later version. A shared option list is edited once and every note type that uses it gets its next version in the same transaction (`main.md:410`). Add a note type: a copy of an existing one, or a blank one with a name and Medical or Non-Medical. Remove and restore follow 5.1; a team's own unused note type is archived too (decision 4).

## 6. Sync
### 6.1 What a phone holds, how it gets it, when it leaves
| Data | How it arrives | Held in | Leaves when |
|---|---|---|---|
| Every preset of the team at its current version, archived ones included (for names) | `GET /v1/presets?since=<revision>` after each sync that reached the server, at unlock and on pull to refresh (`PresetsRefresher`, an `AfterSyncRefresher`) | Table `presets (kind, id, version, state, origin_key, body_json)` and `kv` key `presets_revision` in the team database | The team database is wiped (removal, remote wipe, tenth wrong PIN, full sign-out). Never purged by age: it holds no patient data |
| Note type versions | Phase 4's route and cache | Phase 4's table | Phase 4's rule, plus: a version stays while a held note names it |
| A patient's flag changes | With the chart, through `/v1/sync/records`, like problems | `records` and `fields` (D30) | With the chart (the 24-hour cache rule) |

The pull answers `{revision, presets: [{id, kind, state, version, originKey, body}]}` with every head whose `revision > since`. `since` absent means everything. The phone writes the rows and the new revision in one local transaction, so a pull cut short is repeated whole. If `since` is greater than the server's revision (a restored database), the server answers `{reset: true}` with everything and the phone replaces the table. A phone that has never pulled shows "Your team’s setup hasn’t downloaded yet. Connect to finish." where a preset list would be.

### 6.2 The new synced entity: `patient_flag_change`
Create only. No fields can be edited, so it has no field versions. Reads: `/v1/sync/records` leaves out changes for a sensitive flag when the reader lacks `patients.view_sensitive`, as the projection does for sensitive sections today (`services/api/src/patients/projection.ts`).

| Case | Server answer | Mirror in the phone test server |
|---|---|---|
| Valid; author holds `patients.edit` (checked per entity, D25) | Accepted; receipt with the hash | yes |
| Same id and same hash again | Accepted again (idempotent), as every entity | yes |
| The flag is archived, or archived since | Accepted and kept (decision 6) | yes |
| `flag_id` is not a flag of this team | Rejected `flag_unknown`; goes to Needs attention; the queue continues | yes |
| The patient is unknown to the server yet | Held as a dependent of the patient create (the existing parent rule) | yes |
| The patient was merged | Stored as sent; reads group by `canonical_id` (D27) | yes |
| The author lacks `patients.edit` | Rejected `permission_denied`, audited `access.denied`; quarantine rules as today | yes |
| A sensitive flag set by someone without `patients.view_sensitive` | Rejected `permission_denied`. The phone never offers it (8.2) | yes |
| `reason` empty or over 500 characters | Rejected by the wire schema, naming the change (D51) | yes |

### 6.3 Rules the phone test server must mirror (`apps/mobile/test/sync/fake_server.dart`, level X)
Three things: `GET /v1/presets` (`since`, the `reset` answer, archived rows included, membership only); every row of 6.2 with the same rejection codes; the sensitive filter on reads. `fake_parity_test.dart` gains one case per row.

### 6.4 Records written against an older version
| Record | Stores | When the preset changed or was archived meanwhile |
|---|---|---|
| A note (phase 4) | `note_type_key`, `note_type_version` | It stays on its version until signed, on any phone. The server accepts it. An archived note type cannot start a new note; open drafts finish |
| An order or a dispense line (phase 6) | `item_id`, `item_version`; for a lab, the result | Accepted. The count means the same, because the unit is fixed |
| A bundle that was applied (phase 6) | `bundle_id`, `bundle_version`, and its lines as item lines | Accepted. The lines are what count; the bundle is provenance |
| A suggestion from a mapping (phase 6) | `map_id` on the line | Accepted. A map whose field is hidden or whose option is retired no longer fires on new notes |
| A flag change | `flag_id` | Accepted (6.2). An archived flag drops out of `currentFlags` and stays in the history |

## 7. API routes that only work online
All are in `services/api/src/routes/presets.ts` and `note-types-admin.ts`, opened with `teamScope` as `routes/roles.ts:141` does. "Admin" below means `team.manage_presets`. Every write takes the team lock, bumps the revision and audits in the same transaction. A refusal for a missing key writes `access.denied` (`auth/context.ts:230-241`).

| Route | Key | Request and answer | Refusals | Audit event |
|---|---|---|---|---|
| `GET /v1/presets?since=` | active membership | `{revision, presets[]}` or `{reset: true, …}` (6.1) | not a member: 403 | none (11, row 9) |
| `GET /v1/admin/presets/{kind}` | Admin | `[{id, name, state, version, customized, updateOnOffer, referencedBy, body}]` | 403 | none |
| `POST /v1/admin/presets/{kind}` | Admin | `{body}` gives 201 `{id, version: 1, revision}` | 422 `invalid` with paths; 409 `name_taken`, `reference_archived` | `preset.created` |
| `PUT /v1/admin/presets/{kind}/{id}` | Admin | `{baseVersion, body}` gives `{version, revision}` | 409 `stale` with `currentVersion`, `archived`; 422 `invalid`, `fixed_field`, `no_change` | `preset.updated` |
| `POST /v1/admin/presets/{kind}/{id}/archive` | Admin | `{baseVersion}` gives `{revision}` | 409 `referenced` with counts by kind, `stale`, `not_removable` | `preset.archived` |
| `POST /v1/admin/presets/{kind}/{id}/restore` | Admin | `{}` gives `{revision}` | 409 `name_taken`, `reference_archived` | `preset.restored` |
| `POST /v1/admin/presets/{kind}/{id}/take-update` | Admin | `{baseVersion}` gives `{version, revision}` | 409 `stale`, `no_update` | `preset.platform_update_taken` |
| `GET /v1/admin/presets/{kind}/{id}/versions` | Admin | `[{version, source, createdBy, createdAt, body}]` | 404 | none |
| `POST /v1/admin/preset-order/flag` | Admin | `{tier, ids}` gives `{changed}` | 422 `ids_mismatch` unless `ids` is exactly the tier's active flags | `preset.reordered` |
| `GET /v1/admin/note-types` | Admin | heads with the current definition | 403 | none |
| `POST /v1/admin/note-types` | Admin | `{name, copyOf}` or `{name, medical}` gives 201 `{key, version: 1}` | 409 `name_taken`; 404 `copyOf` | `note_type.created` |
| `PUT /v1/admin/note-types/{key}` | Admin | `{baseVersion, ops}` gives `{version, alsoPublished: keys}` | 409 `stale`, `archived`; 422 `{opIndex, code}` | `note_type.published`, one per type |
| `POST /v1/admin/note-types/{key}/archive`, `/restore`, `/take-update` | Admin | as for presets | as for presets | `note_type.archived`, `.restored`, `.platform_update_taken` |
| `POST /v1/patients/{id}/flags` | `patients.edit`; plus `patients.view_sensitive` for a sensitive flag | `{flagId, action, reason}` gives 201 `{id}` | 404 patient; 422 `flag_unknown`; 403 | `patient.flag_changed` |
| `POST /v1/patients/search` (exists) gains `flagIds` | as today | filters by current flags, both tiers (`main.md:120`) | a sensitive flag id without `patients.view_sensitive`: 403 | the existing search event, plus the count of flag ids |

Ids in paths are preset ids and note type keys, never a name. The chart read (`services/api/src/patients/projection.ts`) gains `flags: {primary, secondary[], history[]}` filtered by `currentFlags`.

## 8. Screens
Every screen passes the accessibility checks in Day, Night run and High contrast and reflows at 320 px. A flag is never shown by colour alone: its name is always beside the colour.

### 8.1 Portal, under `/team/presets` (shown only with `team.manage_presets`; the server refuses a typed URL)
| Page | Shows | States and wording |
|---|---|---|
| `/team/presets` | One card per area with its count and an "Update available" badge | Loading; error |
| `/categories` | OTC, Rx, Labs and the team's own (`main.md:104`); add with name and what it holds (Supplies, Medications, Tests) | "What it holds can’t be changed later." |
| `/items`, `/items/[id]` | Items grouped by category, A–Z, with a search box; form: Name, Category, Counted in, Medical, Capture lot and expiry, Result (for Labs) | Under Counted in: "1 means one of these, for example 1 tablet or 1 packet. This can’t be changed later." (`main.md:127`) |
| `/bundles`, `/bundles/[id]` | Name, Medical or Non-Medical, lines with item, quantity and Core (`main.md:441`, `:447`) | Refusal: "This bundle holds a medication, so it must be Medical." |
| `/flags`, `/flags/[id]` | Two lists: Risk level (primary; Red, Yellow, Green by default, highest risk first) and Conditions (secondary). Move up, Move down, Add, criteria text, colour, Sensitive (`main.md:316-318`) | "Sensitive flags are hidden from Billing and Data." |
| `/field-supplies` | Note type, field, answer, items and quantities (`main.md:424-431`) | Hint: "Map the answer that means something was given, not the question that asks about it." Warning row when the field is hidden or the option retired |
| `/condition-supplies` | Condition codes, items, quantity per patient; "Check problems not updated in [90] days" (`main.md:476`) | |
| `/bag-minimums` | The page name is the PRD's (`main.md:477`): a switch for the team, the template for new bags, each bag with its minimums, Add bag | "Bag minimums are off. Nobody is reminded to restock." |
| `/note-types`, `/note-types/[key]` | List with Use as is, Edit, Remove, Add; editor of sections, fields and options with Hide, Rename, Retire, Add; Publish | Locked rows say "Every Medical note keeps this." After Publish: "Version 4 is live. Notes already started stay on the version they began on." |

Shared on every page: the Removed list with Restore; version history (who, when, platform or team); the update offer "Sineobex updated this preset. Your edited copy hasn’t changed." with Review and Replace with the new version; the stale refusal "Someone else changed this while you were editing. Reload to see their version."; the referenced refusal "Still used by 2 bundles and 1 mapping. Take it out of those first."; and under every free-text box "Don’t put patient names here."

The chart header shows the primary flag and the secondary flags. A Flags panel lists the history (flag, set or cleared, who, when, why) and has a form: flag, reason (required), Save. The patient list gains two filters, Risk level and Conditions. Sensitive flags are absent for a reader without `patients.view_sensitive`.

### 8.2 Phone
| Screen | Shows | States |
|---|---|---|
| Team setup (from Home; read only) | Orders items by category, bundles with their lines, flags by tier, "Updated 10:42" | Not downloaded yet (6.1); offline shows the held copy |
| Chart header (phase 4's screen) | Primary flag chip and secondary flag chips | No flags: nothing shown |
| Change flags sheet | Risk level (one, or None) and Conditions (several); a reason box, required; Save | Works offline; Save is disabled until a reason is typed; sensitive flags listed only with `patients.view_sensitive` |

## 9. Audit events and the PHI rules
| Event | Entity, id | Details |
|---|---|---|
| `preset.created`, `.updated`, `.archived`, `.restored`, `.platform_update_taken` | `preset`, preset id | `kind`, `version`, `revision`, changed top-level field names; never a value |
| `preset.reordered` | `preset`, none | `tier`, count changed |
| `preset.platform_installed` | `team`, team id | counts of `install`, `update`, `offer` by kind; actor is the system |
| `note_type.created`, `.published`, `.archived`, `.restored`, `.platform_update_taken` | `note_type`, key | `version`, operation names and count |
| `patient.flag_changed` | `patient`, patient id | change id, flag id, `action`, tier; never the reason |
| `access.denied` | as today | permission and route |

- Preset bodies are admin text, not patient data, but an admin can type anything. Audit details carry field names and counts only, and the portal warns under every free-text box (8.1).
- A flag reason is patient detail. It lives only in `patient_flag_changes` and the phone's encrypted store. It is never in audit details, logs, notices, URLs or page titles.
- A sensitive flag on a patient is a sensitive detail (`main.md:121`): filtered on the server by `patients.view_sensitive`, in sync reads, the chart read and search.
- The phone's `presets` table and the `presets_revision` key hold no patient data, and nothing derived from a legal name (D40). Platform and seed presets pass the PHI guard; demo additions start "Demo:".
- A reason and a search by flag travel in POST bodies.

## 10. Tests
### 10.1 The Done when
Runs as `services/api/test/presets-done-when.test.ts`, `apps/mobile/test/presets/done_when_presets_test.dart` (against the fake), `live_presets_test.dart` (real API, under the lock) and `apps/portal/e2e/presets.spec.ts`. Steps and names come from `packages/contract/test-vectors/done-when.json`.

| Step | Asserts |
|---|---|
| 1. A phone signs in, syncs, then goes offline | It holds the platform presets and revision R |
| 2. A Program Admin adds the item "Demo: Glucose test" in Labs, counted in "test", result a number in mg/dL | 201, version 1; `preset.created` in the same transaction; revision R+1 |
| 3 and 4. The admin adds the bundle "Demo: Foot check" with that item as a core line, then the secondary flag "Demo: Frost risk" | 201 each; revision R+2, then R+3 |
| 5. A Healthcare Staff member tries step 2 | 403; `access.denied` written; revision unchanged |
| 6. The phone comes online and syncs | One pull with `since=R` returns exactly the three; the phone holds revision R+3 |
| 7. The phone goes offline; Team setup is opened | The Labs item under Labs, the bundle with its line, the flag under Conditions |
| 8. Still offline, staff set "Demo: Frost risk" on a made-up patient with a reason; then sync | Accepted with a hash-matched receipt; the portal chart shows the flag; `patient.flag_changed` carries no reason |

### 10.2 The test that holds each rule (each is checked to bite)
| Rule | Test |
|---|---|
| Shapes, validation, write effects, platform updates, flags, suggestions, note type edits | The vector files of 5.3, read by Vitest and by `flutter test` |
| Versions are append-only; no delete; team isolation | `db/test`: update and delete as the app role fail; a second team sees nothing |
| The revision moves once per write, with no gap, under two writers at once; every write audits in its transaction (a failed audit rolls the write back) | `presets-revision.test.ts`, `presets-audit.test.ts` |
| Every admin route refuses without `team.manage_presets` and logs it | `presets-permissions.test.ts`, one case per route |
| A platform update never overwrites an edited or archived copy | `presets-install.test.ts`: edit, raise the platform version, install, compare bodies |
| A fixed field cannot change; a referenced preset cannot be archived; every body's ids point at presets of the same team | `presets-routes.test.ts`; `presets-refs.test.ts` (a walk over all kinds) |
| A draft begun on version 1 completes after version 2 is published; another phone can open it | `note-type-versions.test.ts`; phone `note_type_version_test.dart` |
| A locked field cannot be hidden; nothing leaves a definition | `note-type-edit.json` |
| A pull cut short leaves the old copy whole; `reset` replaces it | `presets_refresher_test.dart` |
| Flag changes: every row of 6.2, on the API and on the fake | `sync-flag-change.test.ts`; `fake_parity_test.dart` |
| Two phones offline flag the same patient: both changes kept, the later one current | `sync_scenarios_test.dart`, new scenario |
| A sensitive flag never reaches a reader without the key | `patients-flags-sensitive.test.ts` (records, chart, search) |
| Screens | Playwright with axe in three themes and 320 px for each page; phone widget tests in three themes, offline |

## 11. Defaults chosen (PLAN-OPEN) and questions for people
| # | Question the PRD leaves open | Default | Who decides |
|---|---|---|---|
| 1 | Is an unused preset deleted or archived? | Always archived: one rule, and a platform update can’t bring it back | Project lead |
| 2 | Can an item’s unit change later? | No. Archive and add a new item, so old counts keep their meaning | Brooke and Mercy |
| 3 | Which category holds gauze and kits? | A fourth platform category, Supplies | Brooke and Mercy |
| 4 | What can a Labs result be? | A choice from a list, or a number with a unit | Brooke and Mercy |
| 5 | Which flags ship? | Primary: Red, Yellow, Green. Secondary: the six suggested criteria of `main.md:319`, plus Pregnancy (sensitive) | Brooke and Mercy |
| 6 | Are criteria rules the app runs, or text for people? | Text. Nothing flags a patient automatically in V1 | Brooke and Mercy |
| 7 | Which colours can a flag have? | Eight named colours that pass contrast in all three themes; no free colour picker | The team |
| 8 | Who may flag a patient? Must clearing give a reason? | `patients.edit`; yes | Brooke and Mercy |
| 9 | Is reading presets audited, and who may read? | Any active member; not audited, as it shows no patient | Counsel |
| 10 | Do preset writes need a recent sign-in, as user changes do? | No | Project lead |
| 11 | Does a draft move to a new note type version? | No. It stays on the version it began on | Brooke and Mercy |
| 12 | Which fields may be mapped to supplies? | Any choice, yes or no, or number field; the platform’s own mappings use action fields only | Brooke and Mercy |
| 13 | Does a condition mapping match a code family (L30 and all below it)? | No, exact codes only | Brooke and Mercy |
| 14 | Are bags defined in this phase? | Yes: a name and minimums. Phase 6 adds stock and owners | Project lead |
| 15 | Naloxone and safer-use supplies: Medical or not? | The item’s `medical` switch (`IMPLEMENTATION_PLAN.md:207`) | Brooke and Mercy |
| 16 | Is flagging patients part of this phase? | Yes (unit F). It can move to the start of phase 7 without touching units A to E | Project lead |

Questions with no default; each blocks only the card named:

1. The contents of the 18 platform bundles and the starter item list (`main.md:439` gives names only). Brooke and Mercy. Blocks card A8; until then it ships the items the PRD names.
2. Which field in each note type is the action field for the default mappings (`main.md:431`). Brooke and Mercy. Blocks card A9.
3. Whether a flag about substance use falls under 42 CFR Part 2 (`main.md:435`). Counsel. Until answered the platform ships no such flag.

## 12. Risks and departures from the PRD
### 12.1 Risks
1. **Ids inside a JSON body have no foreign key.** Only the API checks them. `presets-refs.test.ts` walks every body, and `referenced` stops an archive from leaving a dangling id.
2. **Phase 4 is not built.** Unit E and cards A9, C6 and F9 depend on shapes this design assumes (section 2). If the definition has no stable ids or no `locked` mark, unit E waits for them; units A to D do not.
3. **Body shapes will grow.** A new field must be optional with a default in both parsers. A phone skips a kind it does not know and ignores a field it does not know (pinned in `preset-bodies.json`).
4. **A phone offline for days works from old presets.** By design (decision 6). Team setup shows when the copy was last updated.
5. **The fake can drift from the API** (plan risk 7). Every row of 6.2 and 6.3 is a parity case.
6. **A custom role may lack the key the PRD implies.** The standard Logistics role holds `patients.view_sensitive` (`0002_identity_access.sql:90-92`), so it sees a pregnancy flag as `main.md:121` says. A custom role without the key does not; the design keeps to the key.
7. **An admin can type a patient’s name into criteria or a bag name.** The hint is the only guard; audit details never carry the text.
8. **One shared option list publishes many note types at once.** One transaction, one audit event per type, one revision step.

### 12.2 Departures and readings
- "Archived rather than deleted" applies to used note types (`main.md:387`); this design archives everything (decision 4). "Edit" a note type is read as the operations of 5.4, not a free form builder. A locked field stays (`main.md:409`).
- "Remove" a bundle (`main.md:128`) is refused while a mapping or another preset points at it; the admin removes those first.
- Bags are defined here though shared bags are phase 6 (`build-plan.md:95`), because bag minimums need a bag to hang on.
- `patients.priority_flag_key` (`0009_patients.sql:58`) is left unused. Flags are worked out from changes, so there is no value two phones could overwrite. The commit that lands unit F corrects the comment in a new migration, not in 0009.
- The build plan lists flags as configuration only. This design also lets staff flag a patient (default 16), because a flag nobody can set is not visible to anyone.
- Mappings fire "on the action field" (`main.md:431`); the app cannot tell which field that is, so it is guidance on the page plus the platform’s own choices.

## 13. Units and first card list
Units own disjoint files. A lands first, alone, with CI green. Then B. Then C and D run together; E after phase 4’s forms part; F after B and phase 4’s chart screen; G last. Level X units and cards: A1, C1, C2, F1, F4, F5 and G1. "+c" means the contract is regenerated in the same card.

| Card | Level | Files | Needs |
|---|---|---|---|
| **Unit A: schema and core rules** (`db/migrations/`, `packages/presets/`, `services/api/src/presets/install.ts`) | | | |
| A1 Preset tables, policies and revokes, with the DB test | X | `db/migrations/<next>_team_presets.sql` | phase 4 merged |
| A2 Package and schemas: category, item, bundle | S | `packages/presets/src/schemas.ts`, `preset-bodies.json` | none |
| A3 Schemas: flag, both mappings, bag, settings | S | `packages/presets/src/schemas.ts`, `preset-bodies.json` | A2 |
| A4 `validatePreset` | T | `packages/presets/src/validate.ts` | A3 |
| A5 `presetWriteEffect` and `reorderRanks` | T | `packages/presets/src/rules.ts` | A2 |
| A6 `platformUpdateEffect` | T | `packages/presets/src/platform.ts` | A2 |
| A7 `suggestSupplies` and `bundleLines` (TypeScript) | T | `packages/presets/src/supplies.ts` | A3 |
| A8 Platform data: categories, flags, settings, starter items, 18 bundles | S | `packages/presets/data/platform.json` | A4; question 1 |
| A9 Platform data: default field and condition mappings | S | `packages/presets/data/platform.json` | A8; question 2; phase 4 field ids |
| A10 The installer, at team creation and at start-up | T | `services/api/src/presets/install.ts`, `routes/owner.ts`, `entry/bootstrap.ts` | A1, A6, A8 |
| **Unit B: API** (`services/api/src/presets/`, `services/api/src/routes/presets.ts`) | | | |
| B1 Store: load refs, write a version, bump the revision under the team lock | T | `services/api/src/presets/store.ts` | A |
| B2 `GET /v1/presets` +c | T | `routes/presets.ts`, `app.ts` | B1 |
| B3 Admin list and create +c | T | `routes/presets.ts` | B1 |
| B4 Edit +c | T | `routes/presets.ts` | B3 |
| B5 Archive and restore +c | T | `routes/presets.ts`, `presets/store.ts` | B3 |
| B6 Take update and versions +c | T | `routes/presets.ts` | B4 |
| B7 Flag order +c | T | `routes/presets.ts` | B4 |
| B8 Demo presets in the seed | S | the seed data file (recipe `seed-data.md`) | B3 |
| B9 API half of the Done when, steps 2 to 5 | T | test only | B3 |
| **Unit C: phone cache** (`apps/mobile/lib/presets/`, `apps/mobile/lib/features/presets/`) | | | |
| C1 `presets` table in the team database | X | `apps/mobile/lib/sync/local_db.dart` | B2 |
| C2 The test server answers `GET /v1/presets`; parity case | X | `apps/mobile/test/sync/fake_server.dart` | B2 |
| C3 Body models and parsers | S | `lib/presets/models.dart` | A3 |
| C4 `PresetStore` and `PresetsRefresher` | T | `lib/presets/preset_store.dart`, `presets_refresher.dart`, `lib/patients/patient_providers.dart` | C1, C2, C3 |
| C5 `suggestSupplies` and `bundleLines` (Dart) | T | `lib/presets/supplies.dart` | C3, A7 |
| C6 Team setup screen and its Home entry | R | `lib/features/presets/team_setup_screen.dart`, the Home screen | C4 |
| C7 Phone half of the Done when, steps 1, 6, 7 | T | test only | C6 |
| **Unit D: portal presets** (`apps/portal/src/app/(app)/team/presets/`, `apps/portal/src/components/presets/`) | | | |
| D1 Hub page, nav link, API helpers | R | `team/presets/page.tsx`, `(app)/layout.tsx`, `lib/presets.ts` | B3 |
| D2 Shared parts: item lines field, Removed list, refusal messages | R | `components/presets/ItemLines.tsx`, `RemovedList.tsx`, `refusals.ts` | D1 |
| D3 Categories page | R | `categories/page.tsx`, `actions.ts` | D2 |
| D4 Items list and add | R | `items/page.tsx`, `actions.ts` | D3 |
| D5 Item edit | R | `items/[id]/page.tsx` | D4 |
| D6 Bundles list and add | R | `bundles/page.tsx`, `actions.ts` | D4 |
| D7 Bundle edit | R | `bundles/[id]/page.tsx` | D6 |
| D8 Flags page with Move up and Move down | R | `flags/page.tsx`, `actions.ts` | D2, B7 |
| D9 Flag edit | R | `flags/[id]/page.tsx` | D8 |
| D10 Field-to-supply page | R | `field-supplies/page.tsx`, `actions.ts` | D4; phase 4 definitions |
| D11 Condition-to-supply page and the status-check days | R | `condition-supplies/page.tsx`, `actions.ts` | D4 |
| D12 Bag minimums page | R | `bag-minimums/page.tsx`, `actions.ts` | D4 |
| D13 Update offer and version history | R | `components/presets/UpdateOffer.tsx`, `VersionHistory.tsx` | D2, B6 |
| D14 Portal half of the Done when | S | `apps/portal/e2e/presets.spec.ts` | D4, D6, D8 |
| **Unit E: note type editing** (`packages/forms/src/edit*.ts`, `services/api/src/presets/note-types.ts`, `routes/note-types-admin.ts`, `team/presets/note-types/`) | | | |
| E1 `applyNoteTypeEdit`: rename, hide, relabel | T | `packages/forms/src/edit.ts` | phase 4 forms |
| E2 Option operations | T | `packages/forms/src/edit-options.ts` | E1 |
| E3 Add field and add section | T | `packages/forms/src/edit-add.ts` | E1 |
| E4 Admin list and publish, with the shared-list fan-out +c | T | `presets/note-types.ts`, `routes/note-types-admin.ts` | E2, B1 |
| E5 Add, archive, restore, take update +c | T | `presets/note-types.ts`, `routes/note-types-admin.ts` | E4 |
| E6 Phase 4’s installer uses `platformUpdateEffect` | T | phase 4’s installer file | A6 |
| E7 Older versions: API and phone tests of 10.2 | T | tests only | E4 |
| E8 Note types list page | R | `note-types/page.tsx`, `actions.ts` | E5, D2 |
| E9 Editor: sections and fields | R | `note-types/[key]/page.tsx`, `actions.ts` | E8 |
| E10 Editor: options, add field, add section | R | `note-types/[key]/OptionEditor.tsx`, `AddField.tsx` | E9 |
| **Unit F: flags on patients** (`services/api/src/sync/entities/patient-flag-change.ts`, `lib/presets/flags.dart`, the chart files named) | | | |
| F1 `patient_flag_changes`, policy, revokes, `patient_of_change` | X | `db/migrations/<next>_patient_flag_changes.sql` | A1 |
| F2 `currentFlags` (TypeScript) | T | `packages/presets/src/flags.ts` | A3 |
| F3 `currentFlags` (Dart) | T | `lib/presets/flags.dart` | C3, F2 |
| F4 The synced entity on the server | X | `sync/entities/patient-flag-change.ts`, `sync/entities/index.ts`, `patients/charts.ts` | F1 |
| F5 The entity on the phone and in the test server | X | `lib/sync/entities.dart`, `test/sync/fake_server.dart` | F4 |
| F6 Chart read: flags, with the sensitive filter +c | T | `patients/projection.ts` | F2, F4 |
| F7 `POST /v1/patients/{id}/flags` +c | T | `routes/patients.ts` | F4 |
| F8 Search by flag ids +c | T | `patients/search.ts`, `routes/patients.ts` | F6 |
| F9 Phone: flag chips and the Change flags sheet | R | `lib/features/patients/flag_sheet.dart`, the chart header | F3, F5, C4 |
| F10 Portal: Flags panel on the chart | R | `components/FlagsPanel.tsx`, the chart page, its `actions.ts` | F7 |
| F11 Portal: list filters by both tiers | R | the patients list page | F8 |
| **Unit G: close**  | | | |
| G1 Live test against the real API, step 8 included | X | `tools/live-sync.sh`, `apps/mobile/test/presets/live_presets_test.dart` | C7, F9 |
| G2 Recipe "add a preset kind" | S | `docs/plan/patterns/preset-kind.md` | B, C, D |
| G3 Compliance docs, the D-table, section 6 rows, the PR description | S | `docs/compliance/`, `IMPLEMENTATION_PLAN.md` | all |

**Count: 64 cards. S 9, T 28, R 20, X 7.**
