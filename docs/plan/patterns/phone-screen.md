# Recipe: add a phone screen with its widget tests

Line ranges are from commit `ead5a05`. All paths are under `apps/mobile/`.

## When to use this

A card adds one screen under `lib/features/<area>/`, its route, and its test under
`test/features/<area>/`. The screen shows what a domain method returns and calls one domain
method to save (see [phone-domain.md](phone-domain.md)). It holds no rules of its own.

## Level

**R**. A screen is wording, accessibility and what a role sees: a reviewer reads the diff and
looks at the screen. The card gives every word the screen shows.

A small model must not:

- Edit `lib/sync/**`, `lib/security/**`, `lib/auth/**` or `test/sync/fake_server.dart` (level X).
  The screen reaches the store only through a domain class on `PatientServices`.
- Change the `redirect` in `lib/app.dart` (lines 57-62): it keeps a locked phone off every
  patient screen. You add one `GoRoute` and nothing else there.
- Edit the shared test helpers `test/helpers/app_harness.dart` and
  `test/features/patients/patient_kit.dart`. If one lacks something, stop and report.

## The example to copy

| Where | What it does |
|---|---|
| `lib/features/patients/add_problem_screen.dart` lines 24-33 | The public widget: takes IDs only and wraps the body in `PatientsGate` with a fixed title |
| same file, lines 35-66 | The stateful body: controllers, a focus node, `_error`, `dispose` |
| lines 99-133 | `_save`: check, call **one** domain method, `_s.changed()`, `showDone`, `context.pop()`; catch `LocalValidationError` and `ChartingPaused` and show `e.message` |
| lines 149-165 | `Scaffold`, `ListView`, `ErrorMessage` on top, a `PhiField` |
| lines 195-210 | A custom tappable row: `Semantics(button: true, label:, onTap:)` around an `InkWell` at least `FieldTap.min` high |
| lines 271-274 | The main button: `FilledButton` in a `SizedBox` of height `FieldTap.large` |
| `lib/features/patients/patient_widgets.dart` lines 24-80 | `PhiField`: key `phi.<name>`, autocorrect, suggestions and keyboard learning off |
| same file, lines 396-436 | `PatientsGate`: no services, no permission, or a frozen store: the builder never runs and `FrozenNotice` shows instead |
| `lib/app.dart` lines 107-110 | The route: `/patients/:id/problems/new`, IDs from `state.pathParameters` |
| `lib/features/patients/patient_labels.dart` lines 6-7, 69-71 | The labels file: fixed words keyed by code (`problemStatusLabels`, `problemStatusText`) |
| `test/features/patients/add_problem_screen_test.dart` lines 13-23, 29-75, 77-94 | Opening the screen offline; the five runs; a control a switch can activate |
| `test/features/patients/patient_kit.dart` lines 30-40, 181-198 | `runs`, `runName`; `expectPrivateFields`, `expectScreenOk` |
| `test/helpers/app_harness.dart` lines 135-140 | `expectGuidelines`: tap target size, labels, text contrast |

## Steps

1. Create `lib/features/<area>/<name>_screen.dart`. Write the public widget: a `StatelessWidget`
   whose fields are UUIDs only, whose `build` returns
   `PatientsGate(title: '<fixed title>', builder: (context, services) => _Body(...))`.
2. Write the private body as a `ConsumerStatefulWidget` (or `StatefulWidget`) that takes
   `services` and the IDs. Dispose every controller and focus node.
3. Build the layout: `Scaffold` with an `AppBar` whose title is the same fixed string, then
   `SafeArea` and a `ListView` with `padding: const EdgeInsets.all(FieldSpace.s4)`. A `ListView`
   scrolls, so it reflows at 320 px and at 200% text. Put side-by-side items in a `Wrap`, not a
   `Row`.
4. Every text field is a `PhiField(name: '<name>', label: '<label>', controller: ...)`. Never a
   bare `TextField`.
5. Every control has a visible label. For a control that is not a standard button, wrap it as
   lines 195-210 do: `Semantics(button: true, label: '...', excludeSemantics: true, onTap: f)`
   with the same `f` on the `InkWell`.
6. Show a message that appears after an action in a live region: `ErrorMessage(_error!)` for an
   error, or `Semantics(liveRegion: true, child: Text(...))` for a result. Do not make text that
   changes on every keystroke a live region.
7. Write `_save` as lines 99-133: set the error state, return early, then in a `try` call the
   domain method, `_s.changed()`, `showDone(context, '<fixed words>')`, `context.pop()`.
8. Words for a coded value (a status, a reason, a category) go in the area's labels file as a
   `const` map and a `...Text` function. One-off sentences are string literals in the screen,
   exactly as the card gives them, with curly apostrophes (’).
9. Add the route in `lib/app.dart` beside line 108:

   ```dart
   GoRoute(
     path: '/patients/:id/<thing>',
     builder: (_, state) => ThingScreen(patientId: state.pathParameters['id']!),
   ),
   ```

   A path holds fixed words and UUIDs only. Anything typed travels in `state.extra` (lines 94-97).

## Tests to write

One file, `test/features/<area>/<name>_screen_test.dart`. Import `patient_kit.dart` (it exports
the harness). Write an opener like `addProblem` (lines 13-23): `signIn(tester, theme:, scale:,
narrow:)`, `seedP1(h.server)`, `syncAndRefresh(tester, h)`, `go(tester, '/patients/$p1Id')`,
then `h.server.offline = true` **before** opening the new screen. Use `tapOn`, `type`,
`fieldNamed`, `reveal`, `expectShown` and `settle`; start each test with
`tester.ensureSemantics()` and end with `handle.dispose()`.

1. **Five runs.** `for (final run in runs) testWidgets('... (${runName(run)})', ...)`: Day, Night
   run, High contrast, Day at 200% text, Day at 320 wide. In each, call
   `await expectScreenOk(tester)` once when the screen opens and again after each change of what
   is shown. It runs the four guideline matchers and `expectPrivateFields`. An overflow at 200%
   or 320 wide is a Flutter error and fails the test by itself.
2. **Saved offline.** After the main button, read `h.sync.store!.outbox()` and compare the queued
   value with what the card gives (lines 25-27, 65-72).
3. **Each refusal.** Tap the main button with a field missing; `expectShown` the exact message.
4. **Labelled, with a tap action.** For each custom control:
   `expect(tester.getSemantics(f), isSemantics(isButton: true, hasTapAction: true))`, then
   `tester.semantics.tap(find.semantics.byLabel(label))` and assert it acted (lines 77-94).
5. **Live regions.** `isSemantics(isLiveRegion: true)` on the message
   (`intake_screen_test.dart` line 71). If a message can repeat, assert it is said once, as
   `problem_screen_test.dart` lines 91-130 do with `tester.takeAnnouncements()`.
6. **Frozen.** `h.sync.store!.freeze(frozen)` (`frozen` is a `const` string the test declares),
   then `h.patients.changed()` and `tester.pump()`: `find.text(frozen)` is found, the patient's details are not (`find.text('Del')`,
   `expectNoLegalName(tester)`), and `tester.takeException()` is null
   (`patient_screen_test.dart` lines 248-266). If the screen saves, also assert nothing was queued
   (`id_card_screen_test.dart` lines 109-123).
7. **Audit**, if the screen shows new patient data: `auditEvents(h.sync.store!)` holds the action
   the card names.

## Run

```sh
export PATH=/opt/flutter/bin:/opt/bin:$PATH
cd apps/mobile
flutter test test/features/<area>/<name>_screen_test.dart   # last line ends "+<n>: All tests passed!"
tool/format_check.sh                                        # exits 0; last line reports 0 changed
flutter analyze --fatal-infos                               # last line: "No issues found!" and a time
```

For the example, the first command ends `+9: All tests passed!`.

## Check before you report

1. Does the public widget return a `PatientsGate`, so a frozen store shows only the notice?
2. Is every text field a `PhiField`?
3. Does the test loop over `runs` and call `expectScreenOk` in each?
4. Does every custom control have a label and a tap action, with a test for it?
5. Do the route and every `context.push` carry only fixed words and UUIDs?
6. Do the app bar title, the snackbar and every error hold fixed words only, no patient detail?
7. Does the screen call a domain method to save, and never `store.createRecord` or
   `store.setField` itself?
8. Does the test go offline before the screen opens, and is all test data made up ("Demo:")?

## Mistakes to avoid

- **Showing data after a refusal.** A screen caught the refusal from `open()` and then drew the
  chart from `read()`, legal name included (`test/patients/patient_scenarios_test.dart` lines
  489-490). When a call throws `ChartingPaused`, show its message and nothing else.
- **A rebuild that reads while frozen.** A screen rebuilds for its services and its own state,
  not only the sync controller; none may reach the read (`patient_screen_test.dart` lines
  246-247). `PatientsGate` handles this: do not read patient data outside its builder.
- **A row only a finger can use.** A code result with no semantic tap action could not be
  activated by Switch Access (finding V6, `add_problem_screen_test.dart` line 77).
- **A live region that speaks on every keystroke.** The note counter is said once on crossing 90%
  and once at the limit (finding V11, `problem_screen_test.dart` line 91).
- **A bare `TextField`.** The keyboard then learns patient words. `expectPrivateFields` fails on
  any field without a `phi.` key (`patient_kit.dart` lines 181-192).
- **Patient details in a title, snackbar or error.** `showDone` and `errorText` take fixed
  strings only (`patient_widgets.dart` lines 246-254); so does the labels file (lines 6-7).
- **Tapping with `tester.tap` on a tall row.** At 200% text a row can be taller than the screen;
  `tapOn` taps near its top left (`patient_kit.dart` lines 172-179).
