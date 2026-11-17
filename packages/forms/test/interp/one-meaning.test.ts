import { describe, expect, it } from 'vitest';
import { checkAnswer } from '../../src/interp/check-answer.ts';
import { NoteReading } from '../../src/interp/conditions.ts';
import type { Answers } from '../../src/interp/conditions.ts';
import { effectiveAnswers } from '../../src/interp/effective.ts';
import { normalAnswers } from '../../src/interp/normal.ts';
import { visibleAnswers } from '../../src/interp/visible.ts';
import type { NoteReader } from '../../src/interp/visible.ts';
import { pathModel } from '../../src/paths.ts';
import type { FieldNode, Leaf } from '../../src/paths.ts';
import type { ResolvedNoteType } from '../../src/resolve.ts';
import { validate } from '../../src/validate.ts';

// One meaning of what counts (coordinator decision D4). The validator (validate.ts, Visibility and
// canShow) and the interpreter (conditions.ts) each say when a field shows; the reader path
// (visibleAnswers) and one-tap Normal rest on what the validator lets through. Small definitions
// are made here at random, from a fixed seed, and every answer set of each is tried (or, where
// there are too many, a fixed sample of them). Held for each:
//
//  1. A required field the validator says never shows (required_never_visible) shows under no
//     answer set; so a field the interpreter shows is one the validator's model can show.
//  2. Where every answer set was tried, a required field the validator lets through shows under
//     at least one: the two models agree both ways.
//  3. What a reader sees counts by itself: effectiveAnswers of visibleAnswers is visibleAnswers,
//     for every reader. A condition that read something the reader does not get would show a
//     field the full note does not, or hide one it does (review findings PRV-1 and PRV-2).
//  4. One-tap Normal offers only answers checkAnswer takes, each of which counts once written,
//     and makes no answer that counted stop counting (D2, D3(b)).

/** A fixed seed: the same definitions on every run, so a failure can be read again. */
function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
  };
}
type Random = ReturnType<typeof random>;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- a definition is built as plain JSON */
type Loose = any;

const option = (code: string, extra: Record<string, unknown> = {}): Loose => ({
  code,
  label: `Demo ${code}`,
  ...extra,
});

/** The fields of one generated definition, before conditions and picked rows. */
function makeFields(r: Random, count: number, where: { cell: boolean; depth: number; repeat: boolean }) {
  const fields: Loose[] = [];
  let made = 0;
  const id = () => `f${where.depth}${where.cell ? 'c' : ''}${made++}`;
  for (let i = 0; i < count; i++) {
    const kinds = ['one', 'one', 'many', 'many', 'text', 'flag'];
    if (!where.cell && where.depth === 0) kinds.push('group', 'region', 'problem');
    if (!where.cell && where.depth === 0 && !where.repeat) kinds.push('grid', 'grid');
    const kind = r.pick(kinds);
    const f: Loose = { id: id(), label: 'Demo field' };
    if (kind === 'one') {
      const options = [option('a'), option('b'), option('c')];
      if (r.chance(0.3)) options[2]!.other = true;
      if (r.chance(0.3)) options[r.pick([0, 1, 2])]!.sensitiveExam = true;
      if (r.chance(0.4)) options[0]!.normal = true;
      Object.assign(f, { kind: 'choice', many: false, options, required: true });
      if (!where.cell && r.chance(0.15)) f.sides = true;
    } else if (kind === 'many') {
      const options = [option('a'), option('b'), option('c')];
      if (r.chance(0.3)) options[0]!.exclusive = true;
      if (r.chance(0.3)) options[2]!.other = true;
      if (r.chance(0.3)) options[r.pick([0, 1, 2])]!.sensitiveExam = true;
      if (r.chance(0.4)) options[1]!.normal = true;
      Object.assign(f, { kind: 'choice', many: true, options, required: true });
      if (r.chance(0.3)) f.excludes = [['b', 'c']];
    } else if (kind === 'text')
      Object.assign(f, { kind: 'text', lines: 'one', maxLength: 10, required: true });
    else if (kind === 'flag') Object.assign(f, { kind: 'flag', required: true });
    else if (kind === 'group')
      Object.assign(f, {
        kind: 'group',
        layout: 'stack',
        fields: makeFields(r, 1 + Math.floor(r.next() * 2), { ...where, depth: 1 }),
      });
    else if (kind === 'region') {
      const options = [option('arm'), option('groin', r.chance(0.5) ? { sensitiveExam: true } : {})];
      Object.assign(f, { kind: 'region', options, side: [option('right'), option('left')] });
    } else if (kind === 'problem') Object.assign(f, { kind: 'problem' });
    else {
      const rows = [option('ra'), option('rb', r.chance(0.4) ? { sensitiveExam: true } : {})];
      const cell = r.chance(0.35)
        ? {
            id: 'cg',
            kind: 'group',
            label: 'Demo cell',
            layout: 'row',
            fields: makeFields(r, 2, { cell: true, depth: 1, repeat: false }),
          }
        : makeFields(r, 1, { cell: true, depth: 1, repeat: false })[0];
      Object.assign(f, { kind: 'grid', rows, cell });
    }
    fields.push(f);
  }
  for (const f of fields)
    if (f.kind === 'flag' && r.chance(0.5)) {
      const others = fields.filter((o) => o !== f);
      if (others.length > 0) f.clears = [r.pick(others).id];
    }
  return fields;
}

function makeDefinition(r: Random): ResolvedNoteType {
  const sections: Loose[] = [];
  const count = 2 + Math.floor(r.next() * 2);
  for (let i = 0; i < count; i++) {
    const repeat = i > 0 && r.chance(0.25);
    const section: Loose = {
      id: `s${i}`,
      title: `Demo section ${i}`,
      fields: makeFields(r, 1 + Math.floor(r.next() * 2), { cell: false, depth: 0, repeat }),
    };
    if (repeat) section.repeat = { max: 3, itemTitle: 'Demo {n}' };
    if (r.chance(0.5)) section.normal = true;
    if (r.chance(0.2)) section.sensitiveExam = true;
    else if (r.chance(0.15)) section.treatmentRecord = true;
    sections.push(section);
  }
  const definition: Loose = {
    key: 'demo_meaning',
    version: 1,
    title: 'Demo meaning',
    kinds: ['medical'],
    group: 'clinical',
    sensitivity: 'none',
    sections,
  };
  // Picked rows, then conditions: both read the paths the fields make.
  const fixed = pathModel(definition);
  const manies = [...fixed.leaves.values()].filter(
    (leaf) =>
      leaf.holds.type === 'codes' &&
      leaf.holds.many &&
      !leaf.node.grid &&
      leaf.fieldPath !== null &&
      !leaf.node.section.section.repeat,
  );
  for (const node of fixed.nodes)
    if (node.field.kind === 'grid' && manies.length > 0 && r.chance(0.4))
      (node.field as Loose).rows = { pickedIn: r.pick(manies).key };
  addConditions(r, definition);
  return definition;
}

function addConditions(r: Random, definition: Loose) {
  const model = pathModel(definition);
  const leaves = [...model.leaves.values()];
  const order = new Map(model.nodes.map((node, i) => [node, i]));
  const test = (carrier: FieldNode | null, sectionId: string, before: number): Loose => {
    if (r.chance(0.15)) {
      const inner = test(carrier, sectionId, before);
      return inner && { not: inner };
    }
    if (r.chance(0.15)) {
      const parts = [test(carrier, sectionId, before), test(carrier, sectionId, before)].filter(Boolean);
      return parts.length > 0 ? { [r.pick(['all', 'any'])]: parts } : undefined;
    }
    // Mostly what is written before the carrier, so most definitions have no cycle.
    const near = leaves.filter((leaf) => r.chance(0.15) || (order.get(leaf.node) ?? 0) < before);
    const leaf = near.length > 0 ? r.pick(near) : undefined;
    if (!leaf) return undefined;
    const section = leaf.node.section.section;
    let path = leaf.key;
    if (carrier?.grid && leaf.node.grid === carrier.grid && r.chance(0.6)) {
      const base = carrier.grid.base!.length + 1;
      path = './' + leaf.parts.slice(base).join('.');
    } else if (section.repeat) {
      if (section.id !== sectionId || !carrier || carrier.grid) return undefined;
      path = './' + leaf.parts.slice(1).join('.');
    }
    if (leaf.holds.type === 'codes' && r.chance(0.6)) {
      const codes = leaf.holds.options.map((o) => o.code);
      const is = r.chance(0.6) ? r.pick(codes) : [...new Set([r.pick(codes), r.pick(codes)])];
      return { field: path, is };
    }
    return { field: path, filled: true };
  };
  for (const node of model.nodes)
    if (r.chance(0.35)) {
      const condition = test(node, node.section.section.id, order.get(node)!);
      if (condition) node.field.showWhen = condition;
    }
  for (const section of model.sections)
    if (!section.section.repeat && r.chance(0.3)) {
      const first = Math.min(...section.nodes.map((node) => order.get(node)!));
      const condition = test(null, section.section.id, first);
      if (condition) (section.section as Loose).showWhen = condition;
    }
}

const ENTRY = 'eaaaaaaa';
const AT = '2026-01-01T10:00:00Z';

/** Where a leaf's answer is in a note: in a repeating section, in the one entry tried. */
const pathOf = (leaf: Leaf) =>
  leaf.node.section.section.repeat ? [leaf.parts[0], ENTRY, ...leaf.parts.slice(1)].join('.') : leaf.key;

/** The answers a leaf can hold that a condition can tell apart, and no answer. */
function domain(definition: ResolvedNoteType, leaf: Leaf): unknown[] {
  const path = pathOf(leaf);
  const holds = leaf.holds;
  if (holds.type === 'codes') {
    const codes = holds.options.map((o) => o.code);
    if (!holds.many) return [undefined, ...codes];
    const sets: string[][] = [];
    for (let mask = 1; mask < 1 << codes.length; mask++) sets.push(codes.filter((_, i) => mask & (1 << i)));
    return [undefined, ...sets.filter((set) => checkAnswer(definition, path, set) === null)];
  }
  if (holds.type === 'text') return [undefined, 'Demo x'];
  if (holds.type === 'flag') return [undefined, true];
  if (holds.type === 'problemCode') return [undefined, 'F32.9', 'J45'];
  if (holds.type === 'problemLabel') return [undefined, 'Demo label'];
  return [undefined];
}

const SENSITIVE = [{ from: 'F01', to: 'F99' }];
const READERS: NoteReader[] = [
  [false, false, false],
  [true, false, true],
  [false, true, false],
  [true, true, false],
].map(([viewSensitive, viewSensitiveExams, chartsMedical]) => ({
  actsAsAuthor: false,
  viewSensitive: viewSensitive!,
  viewSensitiveExams: viewSensitiveExams!,
  readsMedical: true,
  chartsMedical: chartsMedical!,
  ordersMedications: false,
  sensitiveCodes: SENSITIVE,
}));

/** Every answer set when there are at most this many; else this many, drawn from the seed. */
const ALL_UP_TO = 256;
const DEFINITIONS = 300;

describe('the validator and the interpreter, on generated definitions', () => {
  it('give one meaning of what shows, what a reader sees and what Normal fills', () => {
    const r = random(4);
    const tally = { checked: 0, exhaustive: 0, never: 0, marked: 0, answerSets: 0, normal: 0 };
    for (let made = 0; made < DEFINITIONS * 6 && tally.checked < DEFINITIONS; made++) {
      const definition = makeDefinition(r);
      const problems = validate(definition, { noteType: () => undefined });
      if (problems.some((p) => p.rule !== 'validate.required_never_visible')) continue;
      tally.checked++;
      const json = JSON.stringify(definition);
      if (json.includes('sensitiveExam') || json.includes('treatmentRecord') || json.includes('problem'))
        tally.marked++;
      const never = new Set(problems.map((p) => p.path.replace(/\.required$/, '')));
      if (never.size > 0) tally.never++;

      const model = pathModel(definition);
      const required = model.nodes.filter((node) => node.field.required);
      const slots: [string, unknown[]][] = [...model.leaves.values()].map((leaf) => [
        pathOf(leaf),
        domain(definition, leaf),
      ]);
      for (const section of model.sections)
        if (section.section.repeat) slots.push([`${section.section.id}.${ENTRY}.entryAt`, [undefined, AT]]);
      const size = slots.reduce((n, [, values]) => n * values.length, 1);
      const exhaustive = size <= ALL_UP_TO;
      if (exhaustive) tally.exhaustive++;
      const answerSets = function* (): Generator<Answers> {
        for (let i = 0; i < Math.min(size, ALL_UP_TO); i++) {
          let rest = exhaustive ? i : Math.floor(r.next() * size);
          const answers: Record<string, unknown> = {};
          for (const [path, values] of slots) {
            const value = values[rest % values.length];
            rest = Math.floor(rest / values.length);
            if (value !== undefined) answers[path] = value;
          }
          yield answers;
        }
      };

      const shown = new Set<string>();
      for (const answers of answerSets()) {
        tally.answerSets++;
        const why = () => `${json}\nanswers ${JSON.stringify(answers)}`;
        const reading = new NoteReading(definition, answers);
        for (const node of required) {
          const rows = node.grid ? node.grid.rows : [null];
          const entries = node.section.section.repeat ? reading.entries(node.section) : [null];
          if (!rows.some((row) => entries.some((entry) => reading.fieldCounts(node, row, entry)))) continue;
          shown.add(node.at);
          // 1. The validator said this field never shows.
          expect(never.has(node.at), `${node.at} shows\n${why()}`).toBe(false);
        }

        // 3. What a reader sees counts by itself.
        for (const reader of READERS) {
          const seen = visibleAnswers(definition, answers, reader);
          if (seen)
            expect(effectiveAnswers(definition, seen), `${JSON.stringify(reader)}\n${why()}`).toEqual(seen);
        }

        // 4. One-tap Normal.
        const counted = effectiveAnswers(definition, answers);
        for (const section of model.sections) {
          if (!section.section.normal) continue;
          for (const entry of section.section.repeat ? reading.entries(section) : [undefined]) {
            const added = normalAnswers(definition, section.section.id, answers, entry);
            if (Object.keys(added).length === 0) continue;
            tally.normal++;
            const after = effectiveAnswers(definition, { ...answers, ...added });
            for (const [path, value] of Object.entries(added)) {
              expect(checkAnswer(definition, path, value), `${path}\n${why()}`).toBeNull();
              expect(after[path], `${path} does not count once written\n${why()}`).toEqual(value);
            }
            for (const [path, value] of Object.entries(counted))
              expect(after[path], `Normal in ${section.section.id} hides ${path}\n${why()}`).toEqual(value);
          }
        }
      }
      // 2. Every required field the validator lets through shows under some answer set.
      if (exhaustive)
        for (const node of required)
          if (!never.has(node.at)) expect(shown.has(node.at), `${node.at} never shows\n${json}`).toBe(true);
    }
    // Enough of each kind of case that the properties are not held by nothing.
    expect(tally.checked).toBe(DEFINITIONS);
    expect(tally.exhaustive).toBeGreaterThan(DEFINITIONS / 4);
    expect(tally.never).toBeGreaterThan(10);
    expect(tally.marked).toBeGreaterThan(DEFINITIONS / 2);
    expect(tally.normal).toBeGreaterThan(1000);
  }, 120_000);
});
