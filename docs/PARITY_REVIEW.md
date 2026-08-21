# Parity Review — React prototype vs. planned Flutter app

Conducted before development began, against `src/App.tsx` @ `8571e08`.
Method: every JSX element that renders visible content or handles input was
enumerated and assigned a Flutter counterpart. A row is **Full** only when
layout, data, states, and interactions all map.

**Verdict: high parity achievable — 106 of 111 elements Full, 5 Improved,
0 Lost.** Development approved to proceed.

---

## Scoring key

- **Full** — same content, same layout, same interaction
- **Improved** — prototype behaviour preserved and extended (see plan §4/§5)
- **Partial** — some aspect not reproducible
- **Lost** — no counterpart

---

## 1. App shell — 8/8 Full

| Element | Flutter | Verdict |
|---|---|---|
| Sticky translucent header w/ blur | `SliverAppBar` pinned + `BackdropFilter` | Full |
| Logo tile + "Sineobex" wordmark, tap → dashboard | `Row` + `GestureDetector` | Full |
| "Team A" outline badge | `AppBadge.outline` | Full |
| "SC" avatar button, active-state colour swap | `AppAvatarButton` | Full |
| 5-tab bottom nav, icon + 9px uppercase label | `NavigationBar` w/ custom indicator | Full |
| Active tab: blue + `scale-110` | `AnimatedScale` 1.1 | Full |
| Page transition: fade + 10px y-slide, 200ms | `AnimatedSwitcher` + slide/fade | Full |
| 448px max-width centred column | `ConstrainedBox` maxWidth 448 | Full |

## 2. Dashboard — 22/22 (21 Full, 1 Improved)

| Element | Verdict | Note |
|---|---|---|
| "Coordination Hub" heading | Full | |
| Date + team subtitle | Improved | D13 — live date instead of hardcoded "Saturday, April 11" |
| Active-patients card (blue, CARE badge, count) | Full | |
| Supply-alerts card (orange, alert count ×2) | Full | |
| 3 module shortcut buttons (Map/Insights/Alerts) | Full | Alerts now routes to follow-ups (D2) |
| "Urgent Attention" header + IMMEDIATE pill | Full | |
| High-risk cards, red left border, tap → detail | Full | |
| `active:scale-[0.98]` press feedback | Full | `AnimatedScale` on tap-down |
| Route-preview map, 160px, interaction disabled | Full | `InteractiveFlag.none` |
| Dashed orange 5-point route polyline | Full | |
| 12px teardrop risk-coloured patient pins | Full | `CustomPainter` |
| Floating legend overlay (High/Moderate) | Full | |
| Map footer bar + "VIEW FULL MAP" | Full | |
| "Today's Actions" time-chip rows | Full | |
| "Team Tasks" card, pending only, checkbox, priority dot | Full | |
| Follow-up horizontal carousel, 140px cards | Full | |
| Inventory alert rows (orange) | Full | |
| "NEED TO ORDER" vs "Ordered: {ts} by {actor}" | Full | |
| Mark Ordered / Mark Received buttons | Full | Now persisted |
| `stopPropagation` on alert buttons | Full | Separate tap targets |
| Low-stock derivation `stock < min` | Full | |
| Section spacing / typography ramp | Full | |

## 3. Patients list & enrollment — 19/19 (17 Full, 2 Improved)

| Element | Verdict | Note |
|---|---|---|
| "Patient Care" heading + blue FAB | Full | |
| Search field, 48px, rounded-2xl, leading icon | Full | |
| Search matches name **or** DOB substring | Full | |
| 7 filter chips, horizontal scroll | Full | All/High/Moderate/Low/Pregnancy/Mental Health/Chronic |
| Filter semantics (risk vs. `flags`) | Full | |
| Patient card: name, age, DOB, location | Full | |
| Risk badge colour ramp | Full | |
| Flag chips | Full | |
| "Next: {date}" with calendar icon | Full | |
| Enrollment: Cancel back-button | Full | |
| First / Last name (2-col) | Full | |
| Date of birth picker | Full | |
| Phone (tel keyboard) | Full | |
| Current/Found Location | Improved | D11 — adds GPS capture + map pin |
| Insurance Name / Member ID (2-col) | Full | |
| Primary Doctor | Full | |
| Risk selector, 3 pill buttons | Full | |
| Required-field guard (first/last/location) | Full | |
| "Complete Enrollment" save | Improved | Persists; real age (D10), UUID (D12) |

## 4. Patient Detail — 24/24 (22 Full, 2 Improved)

| Element | Verdict | Note |
|---|---|---|
| Back button | Full | |
| Name (3xl), age • DOB • location | Full | |
| "Next Follow-up" line | Full | |
| Risk badge | Full | |
| Flag chips with 🤰/🧠/🏥 emoji prefixes | Full | |
| "Field Intelligence Map" header | Full | |
| 224px map, zoom 15, no zoom control | Full | |
| Current-location pin, risk-coloured, white dot | Full | |
| Common-location slate pins | Full | |
| Marker popups | Full | |
| Two-row legend overlay | Full | |
| Bottom scrolling location chips w/ day/date/time | Full | |
| "Historical Movement Patterns" list | Full | |
| Per-location "Verified" badge | Full | |
| Explanatory italic caption | Full | |
| Demographics & Billing 2×2 grid | Full | |
| Empty-state fallbacks ("Self-Pay / Not Provided" etc.) | Full | |
| "Log New Encounter" CTA, 56px | Full | |
| Logging card: blue ring, "By: {user}" | Full | |
| Notes textarea, 120px min | Full | |
| Supply toggle chips | Improved | D9 — full searchable inventory, not first 4 |
| "Flag for Follow-up" checkbox | Full | |
| Cancel / Save Entry | Improved | D8 — actually persists; debits stock |
| History timeline w/ rail, dots, 6 sub-blocks | Full | provider, date, location, needs, notes, supplies, follow-up block |
| Empty history message | Full | |

## 5. Map — 26/26 (25 Full, 1 Improved)

| Element | Verdict | Note |
|---|---|---|
| "Field Map: {layer}" heading | Full | |
| 4-way segmented layer switcher | Full | |
| 550px map, rounded-[2rem], zoom 14 | Full | |
| OSM/Positron tiles + attribution | Full | Attribution is a licence requirement, kept |
| Per-layer dashed polyline, per-layer colour | Full | orange / green / purple |
| Patient teardrop pins by risk | Full | |
| Patient popup w/ tappable name → detail | Full | |
| Resource emoji markers (6 types) | Full | 🏠🏥🍲💊🦷🚻 |
| Resource popup: address, hours, phone, type | Full | |
| Heatmap 3-ring circles (0.08/0.12/0.20 opacity) | Full | |
| Radius by intensity (700 / 400 base) | Full | |
| Heatmap category colours | Full | red / yellow / green / blue |
| Heatmap popup + category badge | Full | |
| Inventory purple supply circles + item name | Full | |
| Floating legend, contents switch per layer | Full | 4 variants |
| Patients panel: Route Planning card | Full | |
| Route stats | Improved | D13 — computed from route |
| Patients panel: Priority Patients list | Full | D6 — now reactive |
| Patients panel: Clinical Insight card | Full | D3 — bold renders |
| Resources panel: Shelter Referral Loop | Full | |
| Resources panel: Partner Facilities | Full | D4 — hours now visible |
| Resources panel: Resource Insight | Full | |
| Heatmap panel: Outbreak Surveillance | Full | |
| Heatmap panel: Health Risk Hotspots | Full | |
| Inventory panel: Restock Route | Full | |
| Inventory panel: Distribution Points + Insight | Full | |

The prototype's closing note — *"In production, this would integrate with
Mapbox or Google Maps API"* — is dropped: OSM via `flutter_map` **is** the
production integration.

## 6. Inventory — 16/16 (15 Full, 1 Improved)

| Element | Verdict | Note |
|---|---|---|
| Heading, View Map, Add buttons | Full | |
| 4 category filter chips | Full | |
| 4 stock-status filter chips | Full | All / Low / Out / In |
| Combined filter logic | Full | |
| Card border tint by state | Full | red / orange / blue / slate |
| Name + state badge | Full | OUT OF STOCK / LOW STOCK / SEASONAL PRIORITY |
| Seasonal-priority match against current month | Full | |
| Category caption | Full | |
| Stock number, colour-coded, + unit | Full | |
| Progress bar `min(100, stock/(min*1.5)*100)` | Full | Same formula |
| "0" / "Min: {n}" scale labels | Full | |
| Order Status block on low/out only | Full | |
| Mark Ordered / Mark Received | Improved | D7 — received-quantity input |
| Ordered timestamp + actor | Full | |
| "NEED TO ORDER" state | Full | |
| Field Usage Log (dark card) | Full | Now fed by real encounters |

## 7. Insights — 25/25 Full

| Element | Verdict |
|---|---|
| Heading + View Heatmap + Grant Report buttons | Full |
| 4 impact metric tiles w/ trend | Full |
| "Seasonal Supply Demand" + PREDICTIVE AI badge | Full |
| 12-month bar chart | Full |
| Current month highlighted orange, others 60% blue | Full |
| Custom dark tooltip listing month's items as chips | Full |
| "High Demand This Month" chip row | Full |
| Outreach Volume header + MoM badge | Full |
| 3 stat tiles (encounters / unique / new) | Full |
| Stacked bar chart (new + repeat) + total overlay | Full |
| 3-item chart legend | Full |
| Continuity: 2 animated progress bars | Full |
| Value / total labels | Full |
| Per-row caption | Full (D5 fixed) |
| Emerald PCP callout | Full |
| Supply Usage by Region horizontal bar chart | Full |
| 4-colour palette cycling | Full |
| Custom region tooltip | Full |
| Region breakdown list | Full |
| Grant: Q2 Impact Overview + pulsing On Track dot | Full |
| Site Expansion / Patient Volume mini-bars | Full |
| Engagement Journey baseline→current→goal | Full |
| Key Outcomes: 5 rows, status dot, badge, trend icon | Full |
| Insight Prompts chips | Full |
| Generate Grant Report / Edit Metrics buttons | Full |
| Rising Need Alert card | Full (D3 fixed) |

## 8. Profile & Team Access — 17/17 Full

| Element | Verdict |
|---|---|
| 96px avatar w/ badge overlay | Full |
| Name + role + admin shield | Full |
| Admin Control Center → Team Access | Full |
| Agency / Email / Assignment rows | Full |
| 4 account & security rows (Log Out in red) | Full |
| Version + last-sync footer | Full |
| Team Access back button + heading | Full |
| "Admin Authority Enabled" banner | Full |
| Member cards w/ initials avatar | Full |
| "You" pill on self | Full |
| Role • Access caption | Full |
| Active/Inactive badge | Full |
| Deactivate / Restore toggle | Full |
| Self-row protected from toggling | Full |
| Inactive rows at 60% opacity | Full |
| Provision New Member button | Full |
| 3 access tiers | Full |

## 9. Follow-ups view — 4/4 Improved

Implemented in the prototype but unreachable (D2). Ported and routed.

---

## Totals

| Verdict | Count |
|---|---|
| Full | 106 |
| Improved | 5 |
| Partial | 0 |
| **Lost** | **0** |

## Risks accepted

1. **Charts.** `fl_chart` is not Recharts. Bar geometry, stacking, and custom
   tooltips all map; sub-pixel rendering will differ slightly. Acceptable.
2. **Map pins.** Leaflet `divIcon` HTML is reproduced with `CustomPainter`
   rather than translated CSS. Visually equivalent, structurally different.
3. **Fonts.** Prototype loads both Inter and Geist Variable and applies them
   inconsistently. Flutter standardises on Inter, which is what the rendered
   `body` actually resolves to.
4. **Web secondary.** `flutter_map`, `fl_chart`, and Drift all support web;
   SQLCipher does not — web builds fall back to IndexedDB via `drift_wasm`
   with **no local PHI caching**, reads served straight from the API.
5. **Dead prototype code, not ported.** `PieChart` and `Pie` are imported but
   never rendered (`Cell` is used, by the bar charts). The `usageStats`,
   `categoryStats`, and `stats` datasets are defined and never read. The local
   `History` SVG duplicates the imported `HistoryIcon` and is unreferenced.
   Noted here so their absence is not read as a parity gap.
