# Sineobex — React → Flutter Conversion Plan

**Status:** approved, in development
**Source of truth for parity:** `src/App.tsx` (2,919 lines, single-file React prototype) at commit `8571e08`
**Target:** iOS + Android phones (primary), mobile/desktop web (secondary)

---

## 1. What exists today

The current platform is a **front-end-only prototype**. There is no backend, no
authentication, no persistence, and no network layer. Every record lives in a
single `MOCK_DATA` constant and every mutation is `useState` in
`App.tsx`, discarded on reload.

| Aspect | Current |
|---|---|
| Framework | React 19 + Vite 6 + TypeScript |
| Styling | Tailwind v4 utility classes (raw palette, not the shadcn tokens in `index.css`) |
| Components | 12 shadcn/base-ui primitives in `components/ui/`; only Card, Button, Badge, Input, Textarea are actually used |
| Maps | `react-leaflet` 5 + Leaflet 1.9, CartoDB Positron raster tiles (OpenStreetMap data) |
| Charts | Recharts 3 (`BarChart`, `Cell`, custom `Tooltip`) |
| Animation | `motion` (Framer Motion) — page transitions + one animated progress bar |
| Icons | `lucide-react` |
| Routing | none — a `switch` on an `activeTab` string, plus a `selectedPatientId` override |
| State | 5 `useState` hooks in `App`, view-local state elsewhere |
| Data | 12 patients, 37 inventory items, 13 resources, 19 hotspots, 3 tasks, 2 outreach actions, 6 analytics datasets |
| Persistence | **none** |
| Auth | **none** — user is a hardcoded literal, `isAdmin: true` |
| Layout | `max-w-md` (448px) centred column; desktop shows a phone-shaped card |

### Screens

1. **HomeView** (`dashboard`) — summary cards, module shortcuts, high-risk list, embedded route-preview map, today's actions, team tasks, follow-up carousel, inventory alerts with order/receive
2. **PatientsView** — search (name + DOB), 7 filter chips, patient cards; inline **enrollment form** (9 fields + risk selector)
3. **PatientDetail** — risk header, flag chips, field-intelligence map, movement patterns, demographics & billing, encounter logging form, encounter history timeline
4. **MapView** — 4 layers (Patients / Resources / Heatmap / Inventory), each with its own polyline route, marker style, legend, and 3-section bottom panel
5. **InventoryView** — category + status filters, stock bars, order/receive lifecycle, seasonal priority, field usage log
6. **InsightsView** — impact grid, seasonal demand chart, encounters chart, continuity metrics, supply-usage-by-region chart, grant reporting block (4 sub-cards)
7. **ProfileView** — identity, admin control centre, account/security rows
8. **MemberManagementView** — team roster with activate/deactivate
9. **FollowUpsView** — *defined but never routed to* (dead code; see §6)

---

## 2. Target architecture

```
sineobex/
├── src/, components/, lib/     # React prototype, retained as the parity reference
├── app/                        # Flutter application
│   └── lib/
│       ├── core/               # theme, tokens, router, env, formatting, security
│       ├── data/
│       │   ├── models/         # immutable typed models
│       │   ├── local/          # Drift + SQLCipher encrypted store
│       │   ├── remote/         # API client against API Gateway
│       │   ├── sync/           # outbox queue + conflict policy
│       │   ├── repositories/   # the seam the UI talks to
│       │   └── seed/           # DEMO-flagged synthetic dataset
│       ├── features/           # one folder per screen
│       └── widgets/            # ported UI kit
├── infra/                      # AWS CDK (TypeScript) + Lambda handlers + SQL migrations
├── cron/                       # cron-job.org job definitions
└── docs/                       # this plan, parity review, HIPAA notes
```

### 2.1 Client stack

| Concern | Choice | Why |
|---|---|---|
| State | `flutter_riverpod` | Compile-safe DI; replaces prop-drilling of `patients`/`inventory`/`onOrder`/`onReceive` through 4 levels |
| Routing | `go_router` with a `StatefulShellRoute` | Real deep links + back-button semantics; the prototype's `activeTab` switch has neither |
| Maps | `flutter_map` 8 + OSM raster tiles | Direct Leaflet analogue — same tile pipeline, same marker/circle/polyline primitives |
| Tile cache | `flutter_map_cache` + `dio_cache_interceptor` | Offline map legibility in dead zones |
| Charts | `fl_chart` | Closest Recharts analogue for the bar charts in use |
| Local DB | `drift` + `sqlcipher_flutter_libs` | Typed SQL, reactive streams, encrypted at rest |
| Key storage | `flutter_secure_storage` | SQLCipher key in Keychain / Android Keystore |
| Auth | `amazon_cognito_identity_dart_2` | Cognito SRP without pulling in all of Amplify |
| HTTP | `dio` + interceptors | Token refresh, retry, request signing |
| Local auth | `local_auth` | Face ID / fingerprint re-auth after inactivity lock |

### 2.2 Design tokens

The prototype's `index.css` defines shadcn OKLCH tokens that the app **does not
use** — every colour in `App.tsx` is a raw Tailwind class (`bg-blue-600`,
`text-slate-400`, `border-orange-200`, …). Porting the OKLCH tokens would
produce a grey app that looks nothing like the original.

So: port the **Tailwind v4 palette** directly into `core/theme/tokens.dart`
(slate, blue, orange, red, amber, emerald, green, purple, rose, yellow — the
shades actually referenced), plus the type ramp (`text-[8px]` … `text-3xl`,
`font-bold`/`font-medium`, `tracking-widest`/`tracking-tight`) and the radius
scale (`rounded-lg` … `rounded-[2rem]`). Screens then reference tokens, never
raw hex.

### 2.3 Backend (AWS)

```
Flutter ──HTTPS──> CloudFront/WAF ──> API Gateway (Cognito authorizer)
                                         │
                                         ▼
                                   Lambda (Node 22, VPC-attached)
                                         │
                            ┌────────────┼────────────┐
                            ▼            ▼            ▼
              Aurora Serverless v2   S3 (attachments)  KMS CMKs
              Postgres 16 + PostGIS   SSE-KMS          key rotation
```

- **Aurora + PostGIS** because the app is fundamentally geospatial: patient
  pins, common-location clustering, hotspot radii, "nearest partner facility",
  and route ordering are all natural PostGIS queries and awkward key-value ones.
- **Cognito** user pool, MFA required, groups mapping to the app's existing
  access tiers (`Full Admin` / `Standard` / `View Only` — already modelled in
  `MemberManagementView`).
- Every table with PHI carries `created_by`, `updated_by`, `updated_at`; every
  read and write of a patient record writes an `audit_log` row (actor, action,
  subject, timestamp, source IP) — HIPAA §164.312(b).
- All services chosen are HIPAA-eligible. **A signed BAA with AWS is a
  prerequisite and is the operator's responsibility, not the code's.**

### 2.4 Offline-first sync

Street medicine happens in underpasses and basements. The client is the
system of record until it can reach the server.

1. All reads come from Drift; the UI never awaits the network.
2. All writes commit locally and enqueue an `outbox` row.
3. A background sync drains the outbox when connectivity returns.
4. Conflicts resolve last-writer-wins on scalar fields, **append-only for
   encounters** — a clinical note is never overwritten or dropped, it is
   appended and flagged for review.
5. Encrypted DB, no PHI in logs, wipe-on-logout, auto-lock after inactivity.

### 2.5 Scheduled refresh (cron-job.org)

cron-job.org calls authenticated HTTPS endpoints on a schedule. Each job is a
`POST` to `/cron/{job}` carrying an HMAC-SHA256 signature over a timestamped
body, verified in Lambda against a Secrets Manager secret; requests older than
5 minutes are rejected. **No PHI in URLs, query strings, or job payloads** —
cron-job.org is not a BAA counterparty and must never see patient data. Jobs:

| Job | Cadence | Work |
|---|---|---|
| `analytics-rollup` | hourly | Recompute encounter/patient-mix aggregates |
| `hotspot-recompute` | every 6h | Re-cluster hotspots from encounter geography |
| `seasonal-demand` | daily | Update the 12-month demand model |
| `followup-due` | daily 07:00 | Queue push notifications for due follow-ups |
| `low-stock-alert` | every 4h | Flag inventory below `min`, notify leads |
| `audit-archive` | weekly | Ship audit log to S3 Glacier with Object Lock |

---

## 3. Feature-by-feature mapping

| React | Flutter | Notes |
|---|---|---|
| `useState` tab switch | `go_router` `StatefulShellRoute.indexedStack` | Gains deep links + real back stack |
| `AnimatePresence` fade/slide | `AnimatedSwitcher` + `FadeTransition`/`SlideTransition` | Same 200ms, same 10px offset |
| `MapContainer`/`TileLayer` | `FlutterMap`/`TileLayer` | Same OSM tiles |
| `L.divIcon` HTML pins | `Marker` + `CustomPainter` teardrop | Rotated-square CSS trick → painted path |
| `Circle` heatmap rings | `CircleLayer` with `useRadiusInMeter` | Same 3-ring opacity ramp |
| `Polyline` `dashArray` | `PolylineLayer` w/ `pattern: StrokePattern.dashed` | Same colour per layer |
| `Popup` | `PopupMarkerLayer` (`flutter_map_marker_popup`) | Same content |
| Recharts `BarChart` | `fl_chart` `BarChart` | Stacked + horizontal variants both needed |
| Recharts custom `Tooltip` | `BarTouchData.touchTooltipData` | Seasonal-demand chip tooltip reproduced |
| `motion.div` width animation | `TweenAnimationBuilder` | Continuity bars, same 1s + stagger |
| `lucide-react` | `lucide_icons_flutter` | 1:1 icon names |
| `overflow-x-auto` chip rows | horizontal `ListView` | Same scroll-snap-free behaviour |
| `Intl.DateTimeFormat` | `package:intl` | Same weekday/time formatting in enrollment |

---

## 4. Where the Flutter app deliberately exceeds the prototype

These are gaps in the prototype that would be malpractice to port faithfully
into something holding real PHI. Each is **additive** — no prototype behaviour
is lost.

1. **Authentication.** The prototype has none and hardcodes an admin user.
   Flutter gets a Cognito sign-in screen, session refresh, and role gating.
2. **Persistence.** Enrollment, encounter logging, and order/receive currently
   vanish on reload. All three now write to the encrypted store and sync.
3. **Encounter save actually saves.** `PatientDetail`'s "Save Entry" button
   currently just calls `setIsLogging(false)` and discards notes, supplies, and
   the follow-up flag. Ported as a real write.
4. **Audit logging.** Every PHI access recorded.
5. **Auto-lock + biometric re-auth.** Inactivity timeout, wipe on logout.
6. **Inventory decrement.** Supplies marked used in an encounter now debit
   stock, which the prototype never does.

---

## 5. Known prototype defects, and how they're handled

Found while reading `App.tsx`. Each is called out so the parity review can't be
read as "the Flutter app is wrong here."

| # | Defect | Location | Disposition |
|---|---|---|---|
| D1 | `handleAddPatient` sets tab to `patients`, but the nav's first tab id is `dashboard` while `activeTab` initialises to `'home'` — which matches no case and falls through to `default`. The initial state string is dead. | `App.tsx:503`, `:551` | **Fixed** — single `AppTab` enum, no orphan strings |
| D2 | `FollowUpsView` is fully implemented but never rendered by any route | `App.tsx:1122` | **Ported and routed** — reachable from the dashboard "Alerts" shortcut, which currently misleadingly opens the patient list |
| D3 | Markdown asterisks render literally: `**Cass Corridor**` appears with visible `**` in four insight cards | `App.tsx:1889`, `:1938`, `:1988`, `:2038`, `:2704` | **Fixed** — rendered as bold spans |
| D4 | `text-slate-50` on white in "Nearby Partner Facilities" — resource hours are invisible | `App.tsx:1925` | **Fixed** — `slate-500`, matching every sibling row |
| D5 | Continuity caption compares `item.label === 'Primary Care Connected'` but the data says `'Primary Care Connected (YTD)'`, so the true branch is unreachable and both rows show the readmissions caption | `App.tsx:2455` | **Fixed** — matched on a stable enum |
| D6 | Map priority list, resource list, and hotspot lists read `MOCK_DATA.patients` directly instead of the live `patients` prop, so newly enrolled patients never appear there | `App.tsx:1866` | **Fixed** — single reactive source |
| D7 | `handleReceive` sets `stock = max(stock, min + 10)`, an arbitrary quantity with no received-amount input | `App.tsx:527` | **Ported with a quantity field**, defaulting to the same value |
| D8 | Encounter "Save Entry" discards all input | `App.tsx:1387` | **Fixed** (see §4.3) |
| D9 | Supply picker in encounter logging is hardcoded to `MOCK_DATA.inventory.slice(0, 4)` — first four items only, ignoring live inventory | `App.tsx:1364` | **Fixed** — searchable full inventory |
| D10 | Age computed as `currentYear - birthYear`, off by up to a year before the birthday | `App.tsx:911` | **Fixed** — true age from full date |
| D11 | New patients get random coordinates within ±0.01° of downtown Detroit rather than a real location | `App.tsx:928` | **Replaced** with device GPS capture + manual pin, falling back to the typed location |
| D12 | `Math.random().toString(36).substr(2,9)` for patient ids — collision-prone, and `substr` is deprecated | `App.tsx:915` | **Replaced** with UUID v4 |
| D13 | Hardcoded "Saturday, April 11" date and "5 Patients • 1.4 miles • 3h est." route stats | `App.tsx:641`, `:1855` | Date is **live**; route stats **computed** from the actual route |
| D14 | Two hotspots share the display name "Grand Circus" and two share "New Center"/"Eastern Market" across categories | `MOCK_DATA.hotspots` | Kept — legitimate distinct records, disambiguated by category badge |
| D15 | `History` SVG component (`:2711`) duplicates the imported `HistoryIcon` and is never used | `App.tsx:2711` | Dropped |

---

## 6. Phasing

- **P1** Scaffold, theme tokens, navigation shell
- **P2** Models, encrypted Drift store, repositories, outbox, DEMO seed
- **P3** UI kit
- **P4** Dashboard, Patients, Enrollment
- **P5** Patient Detail + encounter logging
- **P6** Map, all four layers
- **P7** Inventory + Insights
- **P8** Profile, Team Access, auth, auto-lock
- **P9** CDK infra, Lambda API, SQL migrations
- **P10** cron-job.org definitions, HIPAA doc
- **P11** `flutter analyze`, tests, parity re-check

---

## 7. Explicitly out of scope

- Deploying the CDK stack (no verified AWS account access from the build
  environment; the stack is written to be reviewed and deployed by the operator)
- App Store / Play Store submission and signing
- Real patient data migration
- The organizational half of HIPAA compliance — BAA execution, risk analysis,
  workforce training, incident response, sanction policy. Code is necessary and
  nowhere near sufficient. See `docs/HIPAA.md`.
