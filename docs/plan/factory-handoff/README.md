# Factory readiness handoff (Nov 16)

How the phase 4–12 task cards could run through an external build system: an orchestrator that hands
out cards, the card driver (`tools/card-run.mjs`) with a local model runner, and a frontier model for
level X work and audits. **Nothing here is applied.** No card level, card, Needs, CI step or factory
setting has changed because of these documents. They are the input to a separate comparison with the
factory's actual code.

Every statement is marked:

- **[V]** verified against this repository at `ca2c4db` (commands, scripts or runs cited);
- **[I]** an assumption about the external factory, or a tool not checked here, to inspect;
- **[P]** a proposed change, not applied.

| File | What |
|---|---|
| `A-factory-integration-delta.md` | What the factory would change: inspections first, then configuration. No new code is needed for the first run |
| `B-sineobex-plan-corrections.md` | Proposed corrections to the plans: card counts (baseline and proposed revision), defects that block execution, new and reclassified cards, permission tables, cross-phase exceptions |
| `C-first-execution-runbook.md` | A proposed procedure for the first local card, stages 0–8, with pass/fail criteria and rollback |
| `proposed-cards/F0-package.md` | The first card, written in full. It is outside `cards/`, so the driver and the card index don't treat it as a card of the phase. It moves to `docs/plan/phase-4-encounters/cards/` only when accepted |
| `scripts/count-cards.mjs`, `scripts/count-phase4.mjs` | Count cards by level from the designs and the phase 4 index (B §1) |
| `evidence/` | The F0-package runs with a stand-in model, and how to repeat them |

## Card counts

- **Baseline, verified:** 505 local (S, T, R) / 229 X / 734 cards in phases 4–10 and 12.
- **Proposed revision, not applied:** 503 / 237 / 740, if every change in B §3 and §4 is accepted.

```sh
node docs/plan/factory-handoff/scripts/count-phase4.mjs .
node docs/plan/factory-handoff/scripts/count-cards.mjs .
```

## What changed since the Nov 15 assessment

That assessment was not committed. This handoff corrects it in four places:

- The phase 8 card to make level X is `U2-content`, not `U2-open` (B §4).
- `L0-rules-ts` can't run after `L0-vectors` as planned: the shared TypeScript reader and the
  repo-wide type check block it (B §2.1). The first local card is `F0-package`, and it needs
  registry access (A5, B §8).
- The "~150-line adapter" is withdrawn: the first run needs configuration only (A1).
- `git clone --local` and a Unix-socket bridge to the runner are fallbacks, chosen only after the
  inspections in A2 and A3.
