# Recipe: add a phone domain method

Line ranges are from commit `ead5a05`. All paths are under `apps/mobile/`.

## When to use this

A card adds a method to a class in `lib/patients/` (or a new class beside them) that reads or
changes patient data on the phone through `LocalStore`. The method works the same with no signal:
it writes to the phone's database and the outbox, and sync sends it later.

What goes where:

| Domain layer (`lib/patients/`) | Screen (`lib/features/`) |
|---|---|
| The rule: what is allowed, what is refused, with which error | The wording, focus and navigation |
| Every `LocalStore` call, and the transaction around them | Calls one domain method; never calls `store.createRecord` or `store.setField` itself |
| The audit entry for a display or a copy | Catches `ChartingPaused` and `LocalValidationError` and shows `e.message` |
| No `BuildContext`, no widgets, no `package:flutter/material.dart` | Calls `services.changed()` after a change so other screens re-read |

## Level

**T** when the method enforces a rule (a refusal, an audit entry, a frozen check): the planner
writes the tests first. **S** when it only shapes data the phone already shows.

Level X, never edited by a small model: `lib/sync/**` (`LocalStore`, the entity rules in
`entities.dart`, the engine), `lib/security/**`, `lib/auth/**`, `test/sync/fake_server.dart`. A
domain method **calls** these. If the card needs a new entity, field rule, audit field or
test-server answer, stop and report.

## The example to copy

| Where | What it does |
|---|---|
| `lib/patients/problems.dart` lines 134-142 | The class: holds `store` and `permissions`; getters for what the role may do |
| `problems.dart` lines 260-284 | `add`: check the input, throw `LocalValidationError`, then one `store.createRecord(entity, value)`; returns the new ID |
| `problems.dart` lines 289-301 | `move`: read the current state, refuse a bad move with a `problem` code, then one `store.setField` |
| `problems.dart` lines 352-359 | `keepServerAndAdd`: two store calls in one `store.transaction` |
| `lib/patients/id_links.dart` lines 295-312 | `copy`: `store.appendAudit` runs first; the copy happens only if it did not throw |
| `lib/patients/patient_repository.dart` lines 458-484, 490-491 | `openOnPhone`, a **display**: frozen check, then the read and `appendAudit('patient.viewed', ...)` in one `store.transaction`. `read` logs nothing itself and still refuses while frozen |
| `lib/patients/patient_providers.dart` lines 44-46, 72-78 | Where `PatientServices` builds each domain class and exposes it |
| `test/patients/id_links_test.dart` lines 15-41, 289-316; 54-73, 254-285 | Set-up (`FakeSyncServer`, `TestPhone`, `PatientServices`); tests: made offline, audit entry, frozen, clock pause |

What `LocalStore` (`lib/sync/local_store.dart`, read only) gives you:

- `createRecord(entity, value)` (line 623), `setField(recordId, field, value)` (line 802): check
  the value as the server would, then write the record and its outbox entry together.
- `appendAudit(action, entity:, entityId:, patientId:, ...)` (line 856): IDs and counts only.
- `transaction(fn)` (line 409): every store call inside `fn` commits or rolls back together.
- `frozen`, `frozenMessage` (lines 427-436). Writes and `appendAudit` throw `ChartingPaused`
  (line 47) while frozen (line 477). A plain read does not: you check it yourself.
- `LocalValidationError(message, problem:, paths:)` (line 57).

## Steps

1. Open the class the card names. Add the method below the last one of its kind.
2. For a **change**, write this shape. Trim text before it goes in the value.

   ```dart
   /// What it does and when it throws (one or two lines, as the methods around it).
   String addThing(String patientId, {required String text}) {
     final t = text.trim();
     if (t.isEmpty || t.length > 4000) {
       throw const LocalValidationError('<the card’s wording>', paths: {'text'});
     }
     return store.createRecord(entityThing, {'patientId': store.canonicalPatient(patientId), 'text': t});
   }
   ```

3. For a **field change**, read the record first, refuse what the card says to refuse, then call
   `store.setField(recordId, '<field>', <value>)` once.
4. More than one store call? Wrap them all in one `return store.transaction(() { ... });`.
5. For a method that **shows patient data that was not on screen before** (opens, lists, searches,
   copies), write this shape. The action name and its fields come from the card.

   ```dart
   ThingView openThing(String patientId) {
     if (store.frozen) throw ChartingPaused(store.frozenMessage!);
     return store.transaction(() {
       final canonical = store.canonicalPatient(patientId);
       final view = _read(canonical);
       store.appendAudit('<entity>.viewed', entity: entityThing, entityId: view.id, patientId: canonical);
       return view;
     });
   }
   ```

6. For any other read that returns patient data, make its first line
   `if (store.frozen) throw ChartingPaused(store.frozenMessage!);`.
7. Only if the card adds a new class: add a `late final` field for it in `PatientServices` and
   build it in the constructor, as `problems` is (`patient_providers.dart` lines 46 and 75).

## Tests to write

Put them in `test/patients/<name>_test.dart`. Copy the set-up from `id_links_test.dart`:
`setUp`/`tearDown` (lines 32-41), `phone(user)` (lines 26-30) and `_Phone` (lines 289-316). Use:

- `FakeSyncServer(now: ...)`, `server.seedPatient(preferredName: 'Del')`, `server.seed(entity, value)`.
- `server.offline = true` before the call under test: every domain test runs offline.
- `await a.services.patients.open(p)` to put the patient on the phone first.
- `a.phone.store.outbox()` to read what was queued; `await a.phone.engine.syncAll()` to send it.
- `a.phone.store.freeze('Your access to this team ended.')` for the frozen case.

Assert, for each new method:

1. Offline, the call succeeds and `outbox().last.value` is exactly the map the card gives.
2. Each refusal: `throwsA(isA<LocalValidationError>())`, and the outbox length did not change.
3. For a display or copy: the last outbox entry is the audit entry, compared as a whole map
   (`id_links_test.dart` lines 260-261). It holds IDs only.
4. Frozen: the call `throwsA(isA<ChartingPaused>())`, nothing is returned, and the outbox length
   did not change (`test/patients/patient_scenarios_test.dart` lines 491-503).
5. After `server.offline = false` and `syncAll()`, `outbox()` is empty: the server took it.
6. Only if the card says the entity pauses with the clock: `ChartingPaused` after the clock is
   skewed (`id_links_test.dart` lines 274-285).

## Run

```sh
export PATH=/opt/flutter/bin:/opt/bin:$PATH
cd apps/mobile
flutter test test/patients/<name>_test.dart     # last line: "+<n>: All tests passed!"
tool/format_check.sh                            # exits 0; its last line reports 0 changed files
flutter analyze --fatal-infos                   # last line: "No issues found!" and a time
```

## Check before you report

1. Does the method use only `LocalStore` calls that already exist, with no edit under
   `lib/sync/`, `lib/security/` or `lib/auth/`?
2. Are all store calls of one action inside one `store.transaction`?
3. Does a method that shows new patient data check `store.frozen` first and call `appendAudit`
   in the same transaction as the read?
4. Does the audit entry hold only IDs, counts and fixed words: no name, no typed text, no token?
5. Does each test set `server.offline = true` before the call it tests?
6. Is there a frozen test that also checks the outbox did not grow?
7. Is all test data made up, with titles and notes starting "Demo:"?

## Mistakes to avoid

- **A read with no frozen check.** `read()` once had none: a screen caught the refusal from
  `open()` and then showed the chart, legal name included, with nothing logged
  (`patient_scenarios_test.dart` lines 489-490).
- **The audit entry after the action.** `copy` logs first so that what can't be logged isn't
  copied (`id_links.dart` lines 292-294). Never catch `ChartingPaused` in the domain layer to
  carry on.
- **Patient details in an audit entry.** `appendAudit` takes IDs, counts and criteria kinds, never
  search terms or tokens (`local_store.dart` lines 853-854; `id_links.dart` line 292).
- **A refusal without the server's code.** A refusal carries the server's `details.problem` in
  `problem:` (`problems.dart` lines 292-298); the card gives the code.
- **Formatting generated code.** If `format_check.sh` fails, run `dart format` on your own
  files only, never on `lib/api/generated`.
