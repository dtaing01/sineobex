import { readFileSync } from 'node:fs';
import { PRESETS, type ResolvedNoteType } from '@sineobex/forms';
import { describe, expect, it } from 'vitest';
import {
  BODY_SCHEMAS,
  changedFixedFields,
  PRESET_KINDS,
  suggestSupplies,
  validatePreset,
} from '../src/index.ts';
import type { FieldSupplyMapBody, PresetBody, PresetKind, PresetRef } from '../src/index.ts';

// The platform's presets (phase 5 design 4.6, 5.2; D140), packages/presets/data/platform.json,
// which every team is given and which P0-data-catalog and P0-data-maps write from the PRD's own
// words. Held here twice: as data every team can take (each entry valid against the platform's own
// presets and the released note types, every origin key it names there, names unique per kind, a
// fixed field changed by a new platform version reported, since every team then gets it as an
// offer), and as what 4.6 says the platform ships, item by item, bundle by bundle, map by map.
//
// The file, as these tests read it: an array of entries {originKey, platformVersion, kind, body}.
// An origin key is `<kind>.<name>`, the name ^[a-z][a-z0-9_]*$, and a body names another entry by
// its origin key wherever it holds an id. The file may hold several versions of one origin key,
// numbered 1 up with none missing: the newest is what a team is given (P0-install), and each is
// compared with the one before it. A released version is kept as it is, so that comparison means
// something.
//
// JSON holds no comment, so this file marks the defaults of section 11 the data holds.
// PLAN-OPEN (BM-65): which order category holds gauze and kits? A fourth platform category,
// Supplies, beside OTC, Rx and Labs.
// PLAN-OPEN (BM-66): what can a Labs result be? The platform's pregnancy test is a choice of
// Positive or Negative, its glucose test a number in mg/dL.
// PLAN-OPEN (BM-63): do safer-use supplies and naloxone count as Non-Medical? The Naloxone kit is
// in OTC, so Medical, and the safer-use kits are in Supplies, so their bundles are Non-Medical.
// PLAN-OPEN (BM-67): which flags ship? Primary High, Medium and Low in red, yellow and green, each
// with the PRD's six suggested starting criteria to rewrite; secondary Frost risk in blue,
// Dehydration risk in orange and Pregnancy in purple, sensitive, with no criteria of their own.
// PLAN-OPEN (CO-13): does a flag about substance use fall under 42 CFR Part 2? No such flag ships
// until counsel answers.
// PLAN-OPEN (BM-81): are bag minimums on for a new team? Off, with an empty template.
// PLAN-OPEN (BM-76): when is a problem due a status check? After 90 days, by default.
// PLAN-OPEN (BM-79): what do the 18 bundles and the starter items hold, and how is each tagged?
// What the PRD's words give, else one kit named after the bundle, Medical as its bundle is; the
// tags as 4.6's table; one of each line's item, as the PRD gives no quantity.
// PLAN-OPEN (BM-74): which bundles ask a prompt first? Summer/dehydration, Winter/frostbite and
// Cold/flu, one each in plain words.
// PLAN-OPEN (BM-80): which fields drive the default mappings? Fields that record something given:
// a vaccine given, a dressing applied and its type, food, hygiene, socks and handwarmers given.

type Entry = { originKey: string; platformVersion: number; kind: PresetKind; body: Record<string, unknown> };

const entries = JSON.parse(
  readFileSync(new URL('../data/platform.json', import.meta.url), 'utf8'),
) as Entry[];

/** The version of each origin key a team is given. */
const newest = new Map<string, Entry>();
for (const e of entries)
  if ((newest.get(e.originKey)?.platformVersion ?? 0) < e.platformVersion) newest.set(e.originKey, e);
const current = [...newest.values()];
const ofKind = (kind: PresetKind) => current.filter((e) => e.kind === kind);

/** A made-up id for each origin key, as a team's install would give it one. */
const idOf = new Map(
  [...newest.keys()].map((key, i) => [
    key,
    `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`,
  ]),
);
const keyOf = new Map([...idOf].map(([key, id]) => [id, key]));

/** The body with every origin key it names put as that entry's id. */
function withIds(value: unknown): unknown {
  if (typeof value === 'string') return idOf.get(value) ?? value;
  if (Array.isArray(value)) return value.map(withIds);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withIds(v)]));
  return value;
}

/** Each place a body holds an id, with the kind it must name. */
function idsOf(
  kind: PresetKind,
  body: Record<string, unknown>,
): { at: string; value: unknown; kind: PresetKind }[] {
  const lines = (field: string) =>
    ((body[field] ?? []) as { itemId: unknown }[]).map((line, i) => ({
      at: `${field}.${i}.itemId`,
      value: line.itemId,
      kind: 'item' as const,
    }));
  switch (kind) {
    case 'item':
      return [{ at: 'categoryId', value: body.categoryId, kind: 'order_category' }];
    case 'bundle':
    case 'field_supply_map':
    case 'condition_supply_map':
      return lines('lines');
    case 'bag':
      return lines('minimums');
    case 'settings':
      return lines('newBagMinimums');
    default:
      return [];
  }
}

/** The team's presets, as validatePreset reads them, once every entry is installed. */
const refs: Record<string, PresetRef> = {};
for (const e of current) {
  const behaviour =
    e.kind === 'order_category'
      ? (e.body.behaviour as PresetRef['behaviour'])
      : e.kind === 'item'
        ? (newest.get(e.body.categoryId as string)?.body.behaviour as PresetRef['behaviour'])
        : undefined;
  refs[idOf.get(e.originKey)!] = { kind: e.kind, state: 'active', ...(behaviour ? { behaviour } : {}) };
}

/** The released note types a team holds, each at its newest version. */
const definitions: Record<string, ResolvedNoteType> = {};
for (const p of PRESETS)
  if ((definitions[p.key]?.version ?? 0) < p.version) definitions[p.key] = p.definition;

/** A new platform version that changes a fixed field, which every team gets as an offer, by `originKey@version`. */
const OFFERED_ONLY: readonly string[] = [];

const itemName = (id: string) => newest.get(id)?.body.name;

describe('the platform data', () => {
  describe('as data every team can take', () => {
    it('is a list of entries, each an origin key, a platform version, a kind and a body', () => {
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(50);
      for (const e of entries) {
        expect(Object.keys(e).sort(), e.originKey).toEqual(['body', 'kind', 'originKey', 'platformVersion']);
        expect(PRESET_KINDS, e.originKey).toContain(e.kind);
        expect(e.originKey).toMatch(new RegExp(`^${e.kind}\\.[a-z][a-z0-9_]*$`));
        expect(Number.isInteger(e.platformVersion) && e.platformVersion >= 1, e.originKey).toBe(true);
      }
    });

    it('numbers each origin key’s versions from 1 with none missing, in order, and never changes its kind', () => {
      const versions = new Map<string, Entry[]>();
      for (const e of entries) versions.set(e.originKey, [...(versions.get(e.originKey) ?? []), e]);
      for (const [key, list] of versions) {
        expect(
          list.map((e) => e.platformVersion),
          key,
        ).toEqual(list.map((_, i) => i + 1));
        expect(new Set(list.map((e) => e.kind)).size, key).toBe(1);
      }
    });

    it('writes every body in full, each passing its schema once its origin keys are ids', () => {
      for (const e of entries) {
        const body = withIds(e.body);
        const parsed = BODY_SCHEMAS[e.kind].safeParse(body);
        expect(
          parsed.success,
          `${e.originKey} v${e.platformVersion}: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
        // Nothing is left to a default: what a team is given is what the file says.
        expect(parsed.data, e.originKey).toEqual(body);
      }
    });

    it('names, wherever a body holds an id, an entry of the right kind by its origin key', () => {
      for (const e of entries)
        for (const { at, value, kind } of idsOf(e.kind, e.body)) {
          const target = typeof value === 'string' ? newest.get(value) : undefined;
          expect(target, `${e.originKey} ${at} names "${String(value)}", which is no entry`).toBeDefined();
          expect(target!.kind, `${e.originKey} ${at}`).toBe(kind);
        }
    });

    it('names only entries the file names earlier, the order a team installs them in', () => {
      // The installer gives each entry in turn its id and checks it against those before it, so an
      // entry named before it is given would be refused.
      const seen = new Set<string>();
      for (const e of entries) {
        for (const { at, value } of idsOf(e.kind, e.body))
          expect(
            seen.has(String(value)),
            `${e.originKey} ${at} names ${String(value)} before the file does`,
          ).toBe(true);
        seen.add(e.originKey);
      }
    });

    it('passes validatePreset, each entry against all the others and the released note types', () => {
      for (const e of current) {
        const problems = validatePreset({
          kind: e.kind,
          body: BODY_SCHEMAS[e.kind].parse(withIds(e.body)) as PresetBody,
          refs,
          definitions,
          id: idOf.get(e.originKey)!,
        });
        expect(problems, e.originKey).toEqual([]);
      }
    });

    it('gives each kind’s names once, ignoring case, as a team’s active presets must be', () => {
      for (const kind of PRESET_KINDS) {
        const names = ofKind(kind).map((e) => String(e.body.name).toLowerCase());
        expect(new Set(names).size, kind).toBe(names.length);
      }
    });

    it('reports a new platform version that changes a field fixed at creation: every team gets it as an offer', () => {
      const changed: string[] = [];
      for (const e of entries) {
        if (e.platformVersion === 1) continue;
        const before = entries.find(
          (p) => p.originKey === e.originKey && p.platformVersion === e.platformVersion - 1,
        )!;
        const fields = changedFixedFields(
          e.kind,
          BODY_SCHEMAS[e.kind].parse(withIds(before.body)) as PresetBody,
          BODY_SCHEMAS[e.kind].parse(withIds(e.body)) as PresetBody,
        );
        if (fields.length > 0) changed.push(`${e.originKey}@${e.platformVersion} (${fields.join(', ')})`);
      }
      const unacknowledged = changed.filter((c) => !OFFERED_ONLY.includes(c.slice(0, c.indexOf(' '))));
      expect(
        unacknowledged,
        'each changes a fixed field, so no team takes it in place; list it in OFFERED_ONLY if that is meant',
      ).toEqual([]);
    });
  });

  describe('as 4.6 says', () => {
    it('has the four categories, in the order the PRD names them (main 104)', () => {
      const categories = ofKind('order_category')
        .map((e) => e.body as { name: string; behaviour: string; sort: number })
        .sort((a, b) => a.sort - b.sort);
      expect(categories.map(({ name, behaviour }) => ({ name, behaviour }))).toEqual([
        { name: 'OTC', behaviour: 'medication' },
        { name: 'Rx', behaviour: 'medication' },
        { name: 'Labs', behaviour: 'lab' },
        { name: 'Supplies', behaviour: 'supply' },
      ]);
      expect(new Set(categories.map((c) => c.sort)).size).toBe(4);
    });

    it('ranks the risk levels High, Medium, Low, highest risk first, each carrying the PRD’s suggested criteria', () => {
      type Flag = {
        name: string;
        tier: string;
        color: string;
        rank: number;
        criteria: string;
        sensitive: boolean;
      };
      const primary = ofKind('flag')
        .map((e) => e.body as Flag)
        .filter((f) => f.tier === 'primary')
        .sort((a, b) => a.rank - b.rank);
      expect(primary.map(({ name, color, sensitive }) => ({ name, color, sensitive }))).toEqual([
        { name: 'High', color: 'red', sensitive: false },
        { name: 'Medium', color: 'yellow', sensitive: false },
        { name: 'Low', color: 'green', sensitive: false },
      ]);
      expect(new Set(primary.map((f) => f.rank)).size).toBe(3);
      // main 319, in the PRD's words; main 317 does not say which goes with which level.
      const SUGGESTED = [
        'recent hospital discharge',
        'overdue follow-up',
        'new lab results',
        'open referral',
        'frostbite risk',
        'dehydration risk',
      ];
      for (const { name, criteria } of primary) {
        expect(
          criteria.startsWith(
            'Suggested starting criteria. Rewrite them for your team and say which put a patient at this level:',
          ),
          name,
        ).toBe(true);
        let from = 0;
        for (const phrase of SUGGESTED) {
          const at = criteria.indexOf(phrase, from);
          expect(at, `${name}: "${phrase}", in the PRD's order`).toBeGreaterThan(from - 1);
          from = at + phrase.length;
        }
      }
    });

    it('marks Frost risk, Dehydration risk and Pregnancy, and only Pregnancy is sensitive (main 121, 316)', () => {
      const secondary = ofKind('flag')
        .map((e) => e.body as { name: string; tier: string; sensitive: boolean; rank: number })
        .filter((f) => f.tier === 'secondary');
      expect(
        secondary
          .map(({ name, sensitive }) => ({ name, sensitive }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      ).toEqual([
        { name: 'Dehydration risk', sensitive: false },
        { name: 'Frost risk', sensitive: false },
        { name: 'Pregnancy', sensitive: true },
      ]);
      expect(new Set(secondary.map((f) => f.rank)).size).toBe(3);
    });

    it('ships no flag about substance use until counsel answers (main 435)', () => {
      for (const e of ofKind('flag'))
        expect(String(e.body.name)).not.toMatch(
          /substance|opioid|opiate|alcohol|drug|overdose|fentanyl|stimulant|use disorder|\bsud\b/i,
        );
    });

    it('starts a team with bag minimums off, no template and a 90-day status check (main 476, 477)', () => {
      expect(ofKind('settings').map((e) => e.body)).toEqual([
        { name: 'Team settings', bagMinimumsOn: false, newBagMinimums: [], problemCheckDays: 90 },
      ]);
      expect(ofKind('bag')).toEqual([]);
    });

    it('stocks the items of 4.6’s table, each in its category and counted in its unit', () => {
      const VACCINES = ['Flu', 'COVID', 'Tdap', 'Hep A', 'Hep B', 'Pneumococcal', 'HPV', 'Shingles'];
      const KITS = [
        'Advanced wound care',
        'Abscess and drainage',
        'Safe smoking',
        'Safer crack use',
        'Injection',
        'Sexual health',
        'Menstrual care',
        'Foot fungus',
        'Dry skin and chafing',
        'Foot protection',
      ];
      const expected: Record<string, [category: string, unit: string, result: unknown, captureLot: boolean]> =
        {
          'Pregnancy test': ['Labs', 'test', { type: 'choice', options: ['Positive', 'Negative'] }, false],
          'Glucose test': ['Labs', 'test', { type: 'number', unit: 'mg/dL' }, false],
          'Doxycycline 100 mg': ['Rx', 'tablet', null, false],
          Acetaminophen: ['OTC', 'tablet', null, false],
          'Hydrocortisone cream': ['OTC', 'each', null, false],
          'Naloxone kit': ['OTC', 'kit', null, false],
          'Electrolyte packet': ['Supplies', 'packet', null, false],
          Gauze: ['Supplies', 'each', null, false],
          Bandage: ['Supplies', 'each', null, false],
          Xeroform: ['Supplies', 'each', null, false],
          Mepilex: ['Supplies', 'each', null, false],
          ABD: ['Supplies', 'each', null, false],
          Hydrocolloid: ['Supplies', 'each', null, false],
          Aquacel: ['Supplies', 'each', null, false],
          Compression: ['Supplies', 'each', null, false],
          'Food kit': ['Supplies', 'kit', null, false],
          'Hygiene kit': ['Supplies', 'kit', null, false],
          Socks: ['Supplies', 'each', null, false],
          Handwarmers: ['Supplies', 'each', null, false],
          // The two kits that hold a medication (main 447) are in OTC.
          'Allergy kit': ['OTC', 'kit', null, false],
          'Cold and flu kit': ['OTC', 'kit', null, false],
          ...Object.fromEntries(VACCINES.map((v) => [`${v} vaccine`, ['Rx', 'dose', null, true]])),
          ...Object.fromEntries(KITS.map((k) => [`${k} kit`, ['Supplies', 'kit', null, false]])),
        };
      const items = ofKind('item').map((e) => e.body as Record<string, unknown>);
      const actual = Object.fromEntries(
        items.map((b) => [
          b.name,
          [newest.get(b.categoryId as string)?.body.name, b.unit, b.result, b.captureLot],
        ]),
      );
      expect(actual).toEqual(expected);
      // A medication or a Labs item is Medical (validatePreset holds it, so a supply's switch is the data's).
      for (const b of items)
        if (['OTC', 'Rx', 'Labs'].includes(String(newest.get(b.categoryId as string)?.body.name)))
          expect(b.medical, String(b.name)).toBe(true);
    });

    it('ships the 18 bundles of main 439, tagged and filled as 4.6’s table says', () => {
      type Line = { itemId: string; qty: number; core: boolean };
      const kit = (name: string) => [[`${name} kit`, true]] as [string, boolean][];
      const expected: Record<string, { medical: boolean; lines: [string, boolean][]; prompt?: string }> = {
        'Basic wound care': {
          medical: true,
          lines: [
            ['Gauze', true],
            ['Bandage', true],
            ['Doxycycline 100 mg', false],
          ],
        },
        'General pain': { medical: true, lines: [['Acetaminophen', true]] },
        'Overdose response': { medical: true, lines: [['Naloxone kit', true]] },
        'Summer/dehydration': {
          medical: false,
          lines: [['Electrolyte packet', true]],
          prompt: 'Check for signs of heat illness before giving this bundle.',
        },
        'Winter/frostbite': {
          medical: false,
          lines: [
            ['Socks', true],
            ['Handwarmers', true],
          ],
          prompt: 'Check for frostbite before giving this bundle.',
        },
        'Cold/flu': {
          medical: true,
          lines: kit('Cold and flu'),
          prompt: 'Ask about respiratory symptoms before giving this bundle.',
        },
        Allergy: { medical: true, lines: kit('Allergy') },
        Hygiene: { medical: false, lines: kit('Hygiene') },
        'Menstrual care': { medical: false, lines: kit('Menstrual care') },
        'Foot protection': { medical: false, lines: kit('Foot protection') },
        'Safe smoking': { medical: false, lines: kit('Safe smoking') },
        'Safer crack use': { medical: false, lines: kit('Safer crack use') },
        Injection: { medical: false, lines: kit('Injection') },
        'Advanced wound care': { medical: true, lines: kit('Advanced wound care') },
        'Abscess/drainage': { medical: true, lines: kit('Abscess and drainage') },
        'Sexual health': { medical: true, lines: kit('Sexual health') },
        'Foot fungus': { medical: true, lines: kit('Foot fungus') },
        'Dry skin/chafing': { medical: true, lines: kit('Dry skin and chafing') },
      };
      const actual = Object.fromEntries(
        ofKind('bundle').map((e) => {
          const b = e.body as { name: string; medical: boolean; prompt: string; lines: Line[] };
          return [
            b.name,
            {
              medical: b.medical,
              lines: b.lines.map((l) => [newest.get(l.itemId)?.body.name, l.core]),
              ...(b.prompt === '' ? {} : { prompt: b.prompt }),
            },
          ];
        }),
      );
      expect(actual).toEqual(expected);
    });

    it('maps only fields that record something given (main 424-431), and nothing it should not', () => {
      const VACCINE_ROWS: [string, string][] = [
        ['flu', 'Flu'],
        ['covid', 'COVID'],
        ['tdap', 'Tdap'],
        ['hep_a', 'Hep A'],
        ['hep_b', 'Hep B'],
        ['pneumococcal', 'Pneumococcal'],
        ['hpv', 'HPV'],
        ['shingles', 'Shingles'],
      ];
      const DRESSINGS: Record<string, string[]> = {
        'wound_care wound.treatment.dressing': [
          'xeroform',
          'mepilex',
          'abd',
          'hydrocolloid',
          'aquacel',
          'compression',
        ],
        'quick_encounter wound.dressing': ['abd', 'xeroform', 'compression'],
      };
      const LABEL: Record<string, string> = {
        xeroform: 'Xeroform',
        mepilex: 'Mepilex',
        abd: 'ABD',
        hydrocolloid: 'Hydrocolloid',
        aquacel: 'Aquacel',
        compression: 'Compression',
      };
      const expected = [
        ...VACCINE_ROWS.map(
          ([row, label]) =>
            `general_primary_care preventive.vaccine_status.${row} {"equals":"given_today"} -> ${label} vaccine x1`,
        ),
        'wound_care wound.treatment.dressing {"answered":true} -> Gauze x1, Bandage x1',
        'quick_encounter wound.dressing {"answered":true} -> Gauze x1, Bandage x1',
        ...Object.entries(DRESSINGS).flatMap(([at, codes]) =>
          codes.map((code) => `${at} {"includes":"${code}"} -> ${LABEL[code]} x1`),
        ),
        'outreach outreach.support {"includes":"food"} -> Food kit x1',
        'outreach outreach.support {"includes":"hygiene"} -> Hygiene kit x1',
        'quick_encounter social.support {"includes":"food"} -> Food kit x1',
        'quick_encounter social.support {"includes":"hygiene_kit"} -> Hygiene kit x1',
        'quick_encounter social.support {"includes":"socks"} -> Socks x1',
        'quick_encounter social.support {"includes":"handwarmers"} -> Handwarmers x1',
      ].sort();
      const actual = ofKind('field_supply_map')
        .map((e) => {
          const b = e.body as FieldSupplyMapBody;
          const lines = b.lines
            .map((l) => `${String(itemName(l.itemId))} x${JSON.stringify(l.qty)}`)
            .join(', ');
          return `${b.noteTypeKey} ${b.path ?? '(every note)'} ${JSON.stringify(b.when ?? null)} -> ${lines}`;
        })
        .sort();
      expect(actual).toEqual(expected);
      // Not shipped (4.6): naloxone accepted, in a sensitive note type; what social needs asks is
      // needed, which gives nothing; a map on every wound care note, beside the dressing map.
      for (const e of ofKind('field_supply_map')) {
        const b = e.body as FieldSupplyMapBody;
        expect(definitions[b.noteTypeKey]?.sensitivity, e.originKey).toBe('none');
        expect(b.noteTypeKey, e.originKey).not.toBe('social_needs');
        expect(b.path, e.originKey).toBeDefined();
      }
    });

    it('maps rash or dermatitis to one hydrocortisone cream per patient (main 476)', () => {
      const maps = ofKind('condition_supply_map').map(
        (e) => e.body as { codes: string[]; lines: { itemId: string; qtyPerPatient: number }[] },
      );
      expect(
        maps.map((m) => ({
          codes: [...m.codes].sort(),
          lines: m.lines.map((l) => [itemName(l.itemId), l.qtyPerPatient]),
        })),
      ).toEqual([{ codes: ['L30.9', 'R21'], lines: [['Hydrocortisone cream', 1]] }]);
    });

    it('suggests on real notes what the PRD’s examples say', () => {
      const maps = ofKind('field_supply_map').map((e) => ({
        id: idOf.get(e.originKey)!,
        body: BODY_SCHEMAS.field_supply_map.parse(withIds(e.body)) as FieldSupplyMapBody,
      }));
      const items = Object.fromEntries(
        ofKind('item').map((e) => [idOf.get(e.originKey)!, { state: 'active' as const }]),
      );
      const suggest = (key: string, answers: Record<string, unknown>) =>
        suggestSupplies({ maps, items, noteTypeKey: key, definition: definitions[key]!, answers })
          .map((s) => `${String(newest.get(keyOf.get(s.itemId)!)?.body.name)} x${s.qty}`)
          .sort();
      // A vaccine marked given deducts that vaccine; a declined one nothing (main 426, 431).
      expect(
        suggest('general_primary_care', {
          'preventive.vaccines': ['flu', 'covid'],
          'preventive.vaccine_status.covid': 'declined',
          'preventive.vaccine_status.flu': 'given_today',
        }),
      ).toEqual(['Flu vaccine x1']);
      // Two wounds dressed: gauze and a bandage each, and the dressing types chosen (main 427).
      expect(
        suggest('wound_care', {
          'wound.e0000001.entryAt': '2026-01-01T10:00:00Z',
          'wound.e0000001.treatment.dressing': ['xeroform'],
          'wound.e0000002.entryAt': '2026-01-01T10:05:00Z',
          'wound.e0000002.treatment.dressing': ['gauze', 'abd'],
        }),
      ).toEqual(['ABD x1', 'Bandage x2', 'Gauze x2', 'Xeroform x1']);
      // Support given on the quick form: the matching kits and items (main 429).
      expect(
        suggest('quick_encounter', {
          'social.support': ['food', 'socks', 'ride_arranged'],
          'visit.parts': ['social_needs'],
        }),
      ).toEqual(['Food kit x1', 'Socks x1']);
    });
  });
});
