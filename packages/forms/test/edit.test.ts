import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerSets } from '../scripts/golden.ts';
import { checkFile } from '../src/schema.ts';
import {
  applyNoteTypeEdits,
  canonicalJson,
  editNoteTypes,
  fieldAt,
  holdsProtected,
  isNoteTypeTitle,
  isProtected,
  NOTE_TYPE_EDIT_OPS,
  OPTION_EDIT_OPS,
  optionReach,
  PRESETS,
  PROTECTED_FIELD_KINDS,
  PROTECTED_OPTION_MARKS,
  protectedParts,
  validate,
  versionProblems,
  visibleAnswers,
  type NoteReader,
  type NoteTypeEdit,
  type NoteTypeEditCode,
  type NoteTypeEditContext,
  type Option,
  type ProtectedParts,
  type Rename,
  type ResolvedField,
  type ResolvedNoteType,
  type ResolvedSection,
} from '../src/index.ts';

// A team's edit of one of its note types (phase 5 design 5.4; BM-73, BM-75, BM-84, PL-17), written
// ahead of its code (card P4-tests): each case fails until the card that builds its part lands
// (P4-protected, P4-edit-basic, P4-edit-options, P4-edit-add, P4-fanout). The vectors
// (packages/contract/test-vectors/note-type-edit.json, whose note says what each field means) pin
// every operation, each refusal with its code, the renames each yields, one case per mark and the
// five rules; then every result is held to what the server checks before it stores one (phase 4's
// validate, versionProblems against every earlier version, and the JSON Schema check, which the API
// cannot run), and what visibleAnswers gives each reader of forms 7.1 is held the same before and
// after an operation that should change nothing they see. The same is then run over the released
// note types, whose edits no made-up definition foresees.
//
// The signatures these tests are written to, exported from the package index:
//
//   edit-protected.ts (P4-protected):
//     export type NoteTypePart = { section: string } | { path: string } | { path: string; code: string };
//     export type ProtectedParts = { sections: string[]; fields: string[]; options: { path: string; code: string }[] };
//     export const PROTECTED_FIELD_KINDS: readonly ['action', 'problem', 'photo', 'info'];
//     export const PROTECTED_OPTION_MARKS: readonly ['exclusive', 'normal', 'unable', 'other', 'suggests', 'sensitiveExam'];
//     export function isProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean;
//     export function holdsProtected(definition: ResolvedNoteType, part: NoteTypePart): boolean;
//     export function protectedParts(definition: ResolvedNoteType): ProtectedParts;
//   edit.ts (P4-edit-basic; the option operations P4-edit-options, adding and copying P4-edit-add):
//     export type NoteTypeEdit = { op: 'rename_type'; title } | { op: 'set_hidden'; path; hidden } | ...;
//     export type NoteTypeEditContext = { versions; team; platform; taken? };
//     export function applyNoteTypeEdit(definition, edit, context): NoteTypeEditStep;
//     export function applyNoteTypeEdits(edits, context):
//       { ok: true; definition: ResolvedNoteType; renames: Rename[] }
//       | { ok: false; opIndex: number; refusal: { code: NoteTypeEditCode; noteTypeKey?: string; problems?: FileProblem[] } };
//   edit-fanout.ts (P4-fanout):
//     export function optionReach(key: string, path: string, team: Record<string, ResolvedNoteType>): { key: string; path: string }[];
//     export function editNoteTypes(input: { key; edits; team: Record<string, ResolvedNoteType[]>; platform }):
//       { ok: true; published: { key; definition; renames }[] } | { ok: false; opIndex: number; refusal: NoteTypeEditRefusal };

type Refused = { opIndex: number; code: NoteTypeEditCode; noteTypeKey?: string };
type Published = { key: string; definition: ResolvedNoteType; renames: Rename[] };
type Case = {
  name: string;
  pins: string[];
  key: string;
  versions: string[];
  team: string[];
  platform: string[];
  ops: NoteTypeEdit[];
  expected: { definition: ResolvedNoteType; renames: Rename[] } | { refused: Refused };
};
type FanoutCase = {
  name: string;
  pins: string[];
  key: string;
  team: Record<string, string[]>;
  platform: string[];
  ops: NoteTypeEdit[];
  expected: { published: Published[] } | { refused: Refused };
};

const vectors = JSON.parse(
  readFileSync(new URL('../../contract/test-vectors/note-type-edit.json', import.meta.url), 'utf8'),
) as { definitions: Record<string, ResolvedNoteType>; cases: Case[]; fanout: FanoutCase[] };
const named = (ref: string): ResolvedNoteType => {
  const definition = vectors.definitions[ref];
  if (!definition) throw new Error(`the vectors name no definition ${ref}`);
  return structuredClone(definition);
};
const byKey = (refs: readonly string[]) =>
  Object.fromEntries(refs.map((ref) => [named(ref).key, named(ref)])) as Record<string, ResolvedNoteType>;
const contextOf = (c: Case): NoteTypeEditContext => ({
  versions: c.versions.map(named),
  team: byKey(c.team),
  platform: byKey(c.platform),
});

/** Every reader of forms 7.1: each of the six facts true or false, with sensitive codes F10 to F19. */
const READERS: NoteReader[] = Array.from({ length: 64 }, (_, n) => ({
  actsAsAuthor: (n & 1) !== 0,
  viewSensitive: (n & 2) !== 0,
  viewSensitiveExams: (n & 4) !== 0,
  readsMedical: (n & 8) !== 0,
  chartsMedical: (n & 16) !== 0,
  ordersMedications: (n & 32) !== 0,
  sensitiveCodes: [{ from: 'F10', to: 'F19' }],
}));
/**
 * One reader for each set of facts visibleAnswers can tell apart: the author, who sees every answer
 * that counts, and each of the sixteen others (ordersMedications changes nothing it gives).
 */
const SOME_READERS = READERS.filter((r) => !r.ordersMedications && (!r.actsAsAuthor || r.viewSensitive));

/**
 * A choose-many answer as a phone writes it on `definition`: its codes in the field's order of
 * options (forms 2.3), which checkAnswer holds a stored value to. A moved option changes the order a
 * new note stores, and a note is read on its own version (rule 4), so an answer is put in the order
 * of the version it is read on.
 */
function writtenOn(definition: ResolvedNoteType, answers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([path, value]) => {
      const holds = fieldAt(definition, path)?.holds;
      if (!Array.isArray(value) || holds?.type !== 'codes') return [path, value];
      const order = new Map(holds.options.map((o, i) => [o.code, i]));
      const place = (code: unknown) => order.get(code as string) ?? order.size;
      return [path, [...value].sort((a, b) => place(a) - place(b))];
    }),
  );
}

/**
 * What each reader sees of each answer set on `definition`, as JSON, the answers written as a phone
 * writes them on it, and the codes of a list in one order: who sees what, not the order a list is
 * drawn in.
 */
function seenBy(
  definition: ResolvedNoteType,
  sets: readonly { name: string; answers: Record<string, unknown> }[],
  readers: readonly NoteReader[],
  leaveOut: (path: string) => boolean = () => false,
): string[] {
  const seen: string[] = [];
  for (const { name, answers } of sets)
    for (const [i, reader] of readers.entries()) {
      const visible = visibleAnswers(definition, writtenOn(definition, answers), reader);
      const kept =
        visible === null
          ? null
          : Object.fromEntries(
              Object.entries(visible)
                .filter(([path]) => !leaveOut(path))
                .map(([path, v]) => [path, Array.isArray(v) ? [...v].sort() : v]),
            );
      seen.push(`${name} reader ${i}: ${canonicalJson(kept)}`);
    }
  return seen;
}

/** The operations after which a reader sees what they saw before, of every answer the old version held. */
const SEES_THE_SAME: ReadonlySet<string> = new Set(
  NOTE_TYPE_EDIT_OPS.filter((op) => op !== 'retire_option' && op !== 'set_hidden'),
);
const changesNothingSeen = (ops: readonly NoteTypeEdit[]) =>
  ops.every((e) => SEES_THE_SAME.has(e.op) || (e.op === 'set_hidden' && !e.hidden));

/** Phase 4's checks of a definition the server is about to store: each answers nothing. */
function expectStorable(
  definition: ResolvedNoteType,
  earlier: readonly ResolvedNoteType[],
  renames: readonly Rename[],
  lookup: (key: string) => ResolvedNoteType | undefined,
  name: string,
) {
  expect(validate(definition, { noteType: lookup }), `${name}: validate`).toEqual([]);
  expect(versionProblems(earlier, definition, { renames }), `${name}: versionProblems`).toEqual([]);
  expect(checkFile('noteType', fileShape(definition)), `${name}: checkFile`).toEqual([]);
}

// ------------------------------------------------------------------------------------------------
// A resolved definition in the file schema's shape
// ------------------------------------------------------------------------------------------------

// The resolver copies a region's sides and surface in as option lists (resolve.ts), where a file
// names the shared list: written back here, so the schema reads what it was written as. Nothing an
// edit makes is a region, so this undoes the resolver and nothing else.
const LISTS = new Map(
  readdirSync(new URL('../definitions/lists/', import.meta.url)).map((file) => {
    const list = JSON.parse(
      readFileSync(new URL(`../definitions/lists/${file}`, import.meta.url), 'utf8'),
    ) as {
      name: string;
      options: Option[];
    };
    return [canonicalJson(list.options), list.name] as const;
  }),
);
function fileShape(definition: ResolvedNoteType): unknown {
  const field = (f: ResolvedField): unknown => {
    if (f.kind === 'region') {
      const { side, surface, ...rest } = f;
      const list = side === undefined ? undefined : LISTS.get(canonicalJson(side));
      if (side !== undefined && list === undefined)
        throw new Error(`no shared list holds the sides of ${f.id}`);
      return {
        ...rest,
        ...(list === undefined ? {} : { side: list }),
        ...(surface ? { surface: true } : {}),
      };
    }
    if (f.kind === 'group') return { ...f, fields: f.fields.map(field) };
    if (f.kind === 'grid') return { ...f, cell: field(f.cell) };
    return f;
  };
  return { ...definition, sections: definition.sections.map((s) => ({ ...s, fields: s.fields.map(field) })) };
}

// ------------------------------------------------------------------------------------------------
// The vectors
// ------------------------------------------------------------------------------------------------

describe('note-type-edit.json', () => {
  it('holds one case for every operation, every refusal code, every mark and each of the five rules', () => {
    const pins = new Set([...vectors.cases, ...vectors.fanout].flatMap((c) => c.pins));
    for (const op of NOTE_TYPE_EDIT_OPS) expect(pins.has(op), op).toBe(true);
    const codes: NoteTypeEditCode[] = [
      'protected',
      'in_use',
      'not_found',
      'title_invalid',
      'label_invalid',
      'last_option',
      'last_field',
      'last_section',
      'too_many_fields',
      'too_many_sections',
      'not_copyable',
      'id_taken',
      'invalid',
    ];
    const refusedWith = new Set(
      [...vectors.cases, ...vectors.fanout].flatMap((c) =>
        'refused' in c.expected ? [c.expected.refused.code] : [],
      ),
    );
    for (const code of codes) expect(refusedWith.has(code), code).toBe(true);
    for (const mark of [
      'mark: sensitiveExam',
      'mark: treatmentRecord',
      'mark: needs',
      'mark: required',
      'mark: noNormal',
      'mark: showWhen',
      'mark: handoff',
      'mark: mapsTo',
      'mark: auto',
      'mark: sides',
      'mark: repeat',
      'mark: normal',
      ...PROTECTED_OPTION_MARKS.map((m) => `option mark: ${m}`),
      ...PROTECTED_FIELD_KINDS.map((k) => `kind: ${k}`),
      ...['kinds', 'group', 'sensitivity', 'quick', 'auto'].map((t) => `type: ${t}`),
      'rule 1',
      'rule 2',
      'rule 3',
      'rule 4',
      'rule 5',
    ])
      expect(pins.has(mark), mark).toBe(true);
  });

  it('holds results that phase 4 would store: each passes validate, versionProblems and the JSON Schema check', () => {
    for (const c of vectors.cases) {
      if (!('definition' in c.expected)) continue;
      const { definition, renames } = c.expected;
      const known = new Map(
        [...c.platform, ...c.team, ...c.versions].map((ref) => [named(ref).key, named(ref)]),
      );
      expectStorable(
        definition,
        c.versions.map(named),
        renames,
        (key) => (key === definition.key ? definition : known.get(key)),
        c.name,
      );
    }
    for (const c of vectors.fanout) {
      if (!('published' in c.expected)) continue;
      const published = new Map(c.expected.published.map((p) => [p.key, p.definition]));
      const known = new Map(
        [...c.platform, ...Object.values(c.team).flat()].map((ref) => [named(ref).key, named(ref)]),
      );
      for (const p of c.expected.published)
        expectStorable(
          p.definition,
          c.team[p.key]!.map(named),
          p.renames,
          (key) => published.get(key) ?? known.get(key),
          `${c.name} (${p.key})`,
        );
    }
  });

  it('names each result as its note type’s next version, and changes no kinds, group, sensitivity, quick or auto (rule 2)', () => {
    const fixed = (d: ResolvedNoteType) =>
      canonicalJson([d.key, d.kinds, d.group, d.sensitivity, d.quick, d.auto]);
    for (const c of vectors.cases) {
      if (!('definition' in c.expected)) continue;
      const newest = named(c.versions.at(-1)!);
      expect(c.expected.definition.version, c.name).toBe(newest.version + 1);
      expect(fixed(c.expected.definition), c.name).toBe(fixed(newest));
    }
  });

  it('gives every reader what they saw before, after an operation that should change nothing they see', () => {
    for (const c of vectors.cases) {
      if (!('definition' in c.expected) || !changesNothingSeen(c.ops)) continue;
      const before = named(c.versions.at(-1)!);
      const sets = answerSets(before);
      expect(seenBy(c.expected.definition, sets, READERS), c.name).toEqual(seenBy(before, sets, READERS));
    }
  });

  it('takes out of what each reader sees only what a hide leaves out', () => {
    for (const c of vectors.cases) {
      if (!('definition' in c.expected) || !c.ops.every((e) => e.op === 'set_hidden' && e.hidden)) continue;
      const before = named(c.versions.at(-1)!);
      const hidden = c.ops.map((e) => (e as { path: string }).path);
      const gone = (path: string) => {
        const key = fieldAt(before, path)?.key ?? path;
        return hidden.some((h) => key === h || key.startsWith(`${h}.`) || key.startsWith(`${h}_`));
      };
      const sets = answerSets(before);
      expect(seenBy(c.expected.definition, sets, READERS), c.name).toEqual(
        seenBy(before, sets, READERS, gone),
      );
    }
  });

  it('covers a field added to a marked section by the section’s mark (rule 1)', () => {
    const added = vectors.cases.filter(
      (c) => c.ops.length === 1 && c.ops[0]!.op === 'add_field' && 'definition' in c.expected,
    );
    const into = (sectionId: string) =>
      added.find((c) => (c.ops[0] as { sectionId: string }).sectionId === sectionId)!;
    const reader = (over: Partial<NoteReader>): NoteReader => ({
      actsAsAuthor: false,
      viewSensitive: true,
      viewSensitiveExams: true,
      readsMedical: true,
      chartsMedical: true,
      ordersMedications: false,
      sensitiveCodes: [],
      ...over,
    });
    for (const [sectionId, hiddenFrom] of [
      ['exam', reader({ viewSensitiveExams: false })],
      ['moud', reader({ viewSensitive: false })],
      ['moud', reader({ chartsMedical: false })],
    ] as const) {
      const c = into(sectionId);
      const after = (c.expected as { definition: ResolvedNoteType }).definition;
      const section = after.sections.find((s) => s.id === sectionId)!;
      const made = section.fields.at(-1)!;
      expect(Object.keys(made).sort(), c.name).toEqual(['id', 'kind', 'label', 'lines', 'maxLength']);
      const answers = { [`${sectionId}.${made.id}`]: 'Demo: added answer' };
      expect(visibleAnswers(after, answers, hiddenFrom), c.name).toEqual({});
      expect(visibleAnswers(after, answers, reader({})), c.name).toEqual(answers);
    }
  });

  describe('applyNoteTypeEdits answers each case', () => {
    for (const c of vectors.cases)
      it(c.name, () => {
        const outcome = applyNoteTypeEdits(c.ops, contextOf(c));
        if ('refused' in c.expected) {
          const { opIndex, ...refusal } = c.expected.refused;
          expect(outcome).toMatchObject({ ok: false, opIndex, refusal });
          if (!outcome.ok && refusal.noteTypeKey === undefined)
            expect(outcome.refusal.noteTypeKey, 'no other note type is named').toBeUndefined();
        } else expect(outcome).toEqual({ ok: true, ...c.expected });
      });
  });

  describe('editNoteTypes answers each case the same, reaching no other note type', () => {
    for (const c of vectors.cases)
      it(c.name, () => {
        const team = {
          ...Object.fromEntries(c.team.map((ref) => [named(ref).key, [named(ref)]])),
          [c.key]: c.versions.map(named),
        };
        const outcome = editNoteTypes({ key: c.key, edits: c.ops, team, platform: byKey(c.platform) });
        if ('refused' in c.expected) {
          const { opIndex, ...refusal } = c.expected.refused;
          expect(outcome).toMatchObject({ ok: false, opIndex, refusal });
        } else expect(outcome).toEqual({ ok: true, published: [{ key: c.key, ...c.expected }] });
      });
  });

  describe('editNoteTypes carries each option operation along mapsTo (rule 5)', () => {
    for (const c of vectors.fanout)
      it(c.name, () => {
        const team = Object.fromEntries(Object.entries(c.team).map(([key, refs]) => [key, refs.map(named)]));
        const outcome = editNoteTypes({ key: c.key, edits: c.ops, team, platform: byKey(c.platform) });
        if ('refused' in c.expected) {
          const { opIndex, ...refusal } = c.expected.refused;
          expect(outcome).toMatchObject({ ok: false, opIndex, refusal });
        } else expect(outcome).toEqual({ ok: true, ...c.expected });
      });
  });

  it('leaves what it is given as it was', () => {
    for (const c of [
      ...vectors.cases.slice(0, 20),
      ...vectors.cases.filter((x) => x.pins.includes('copy_section')),
    ]) {
      const context = contextOf(c);
      const before = canonicalJson(context);
      const ops = structuredClone(c.ops);
      applyNoteTypeEdits(ops, context);
      expect(canonicalJson(context), c.name).toBe(before);
      expect(ops, c.name).toEqual(c.ops);
    }
  });
});

describe('optionReach (rule 5)', () => {
  const team = byKey(['demo_quick@1', 'demo_full@1', 'demo_flags@1', 'demo_exam@1']);

  it('reaches the field a quick field maps to, and from the full field each quick field that maps to it', () => {
    expect(optionReach('demo_quick', 'quick.dressing', team)).toEqual([
      { key: 'demo_full', path: 'wound.dressing' },
    ]);
    expect(optionReach('demo_full', 'wound.dressing', team)).toEqual([
      { key: 'demo_quick', path: 'quick.dressing' },
    ]);
  });

  it('never reaches an auto note type, nor a note type the team does not offer', () => {
    expect(optionReach('demo_quick', 'quick.flag', team)).toEqual([]);
    const { demo_full: _gone, ...withoutFull } = team;
    expect(optionReach('demo_quick', 'quick.dressing', withoutFull)).toEqual([]);
  });

  it('reaches nothing from a field nothing maps to', () => {
    expect(optionReach('demo_exam', 'systems.seen', team)).toEqual([]);
  });

  it('is the operations on options alone that it carries', () => {
    expect([...OPTION_EDIT_OPS].sort()).toEqual([
      'add_option',
      'move_option',
      'rename_option',
      'retire_option',
    ]);
  });
});

// ------------------------------------------------------------------------------------------------
// The released note types
// ------------------------------------------------------------------------------------------------

/** The newest version of each released note type. */
const released = new Map<string, ResolvedNoteType>();
for (const preset of PRESETS)
  if ((released.get(preset.key)?.version ?? 0) < preset.version) released.set(preset.key, preset.definition);
const RELEASED = Object.fromEntries(released) as Record<string, ResolvedNoteType>;
const lookupReleased = (key: string) => released.get(key);

type Walked = { field: ResolvedField; path: string; section: ResolvedSection };

/** Every field outside a grid's cell, at every depth, with its path, in the order written. */
function fieldsOf(definition: ResolvedNoteType): Walked[] {
  const out: Walked[] = [];
  const walk = (fields: readonly ResolvedField[], prefix: string, section: ResolvedSection) => {
    for (const field of fields) {
      const path = `${prefix}.${field.id}`;
      out.push({ field, path, section });
      if (field.kind === 'group') walk(field.fields, path, section);
    }
  };
  for (const section of definition.sections) walk(section.fields, section.id, section);
  return out;
}

const KINDS: ReadonlySet<string> = new Set(['action', 'problem', 'photo', 'info']);
const OPTION_MARKS = ['exclusive', 'normal', 'unable', 'other', 'suggests', 'sensitiveExam'] as const;
const markedOption = (o: Option) => OPTION_MARKS.some((m) => o[m] !== undefined);
/** A field protected by its own marks or kind, or a grid whose cell is. */
const ownMarks = (f: ResolvedField): boolean =>
  f.required === true || f.noNormal === true || KINDS.has(f.kind) || (f.kind === 'grid' && ownMarks(f.cell));

/** 5.4's protected parts, read straight from the marks: what protectedParts must answer. */
function protectedByTheMarks(definition: ResolvedNoteType): ProtectedParts {
  const auto = definition.auto !== undefined;
  const sections = definition.sections.filter((s) => auto || s.needs !== undefined).map((s) => s.id);
  const fields: string[] = [];
  const options: { path: string; code: string }[] = [];
  for (const { field, path, section } of fieldsOf(definition)) {
    const whole = auto || section.needs !== undefined || ownMarks(field);
    if (whole) fields.push(path);
    if (field.kind === 'choice')
      for (const option of field.options)
        if (whole || markedOption(option)) options.push({ path, code: option.code });
  }
  return { sections, fields, options };
}

/** Each field or section holds a protected field: what a hide of it is refused for. */
function holdsProtectedByTheMarks(definition: ResolvedNoteType, path: string): boolean {
  const parts = protectedByTheMarks(definition);
  return parts.sections.includes(path) || parts.fields.some((p) => p === path || p.startsWith(`${path}.`));
}

/**
 * The codes a condition anywhere in the definition asks about, whichever field it reads: a retire
 * of one would leave the condition asking about a code that is no more, which the validator
 * refuses (`invalid`, at the publish). A condition written relative to an entry or a row names its
 * field by `./`, so the code alone is kept.
 */
function codesAskedAbout(definition: ResolvedNoteType): Set<string> {
  const asked = new Set<string>();
  const read = (condition: unknown): void => {
    if (condition === null || typeof condition !== 'object') return;
    const c = condition as { is?: string | string[]; all?: unknown[]; any?: unknown[]; not?: unknown };
    if (c.is !== undefined) for (const code of [c.is].flat()) asked.add(code);
    for (const inner of [...(c.all ?? []), ...(c.any ?? []), ...(c.not ? [c.not] : [])]) read(inner);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (key === 'showWhen') read(child);
        else walk(child);
      }
  };
  walk(definition);
  return asked;
}

const releasedContext = (definition: ResolvedNoteType): NoteTypeEditContext => ({
  versions: [definition],
  team: Object.fromEntries(Object.entries(RELEASED).filter(([key]) => key !== definition.key)),
  platform: RELEASED,
});

/** A publish's result, held to phase 4's checks and to what each reader sees. */
function expectPublished(
  definition: ResolvedNoteType,
  edits: NoteTypeEdit[],
  what: string,
  options: { sameForReaders?: boolean } = {},
) {
  const outcome = applyNoteTypeEdits(edits, releasedContext(definition));
  expect(outcome.ok, `${what}: ${JSON.stringify(outcome.ok ? null : outcome)}`).toBe(true);
  if (!outcome.ok) return undefined;
  const after = outcome.definition;
  expect([after.key, after.version], what).toEqual([definition.key, definition.version + 1]);
  expectStorable(
    after,
    [definition],
    outcome.renames,
    (key) => (key === after.key ? after : lookupReleased(key)),
    what,
  );
  if (options.sameForReaders !== false) {
    const sets = answerSets(definition).filter((s) => s.name === 'every' || s.name === 'systems');
    expect(seenBy(after, sets, SOME_READERS), what).toEqual(seenBy(definition, sets, SOME_READERS));
  }
  return outcome;
}

/**
 * A made-up note type with grids: one whose cell is a group holding a required field, and one in
 * a group whose cell is itself a consent (noNormal).
 */
function rounds(): ResolvedNoteType {
  const yesNo = [
    { code: 'yes', label: 'Demo: Yes' },
    { code: 'no', label: 'Demo: No' },
  ];
  return {
    key: 'demo_rounds',
    version: 1,
    title: 'Demo: Rounds',
    kinds: ['non_medical'],
    group: 'outreach',
    sensitivity: 'none',
    sections: [
      {
        id: 'rounds',
        title: 'Demo: Rounds',
        fields: [
          {
            id: 'checks',
            kind: 'grid',
            label: 'Demo: Checks',
            rows: [{ code: 'first', label: 'Demo: First' }],
            cell: {
              id: 'cell',
              kind: 'group',
              layout: 'stack',
              label: 'Demo: Cell',
              fields: [
                {
                  id: 'done',
                  kind: 'choice',
                  many: false,
                  label: 'Demo: Done?',
                  required: true,
                  options: yesNo,
                },
              ],
            },
          },
          {
            id: 'asked',
            kind: 'group',
            layout: 'row',
            label: 'Demo: Asked',
            fields: [
              {
                id: 'agreed',
                kind: 'grid',
                label: 'Demo: Agreed',
                rows: [{ code: 'first', label: 'Demo: First' }],
                cell: {
                  id: 'cell',
                  kind: 'choice',
                  many: false,
                  label: 'Demo: Agreed?',
                  noNormal: true,
                  options: yesNo,
                },
              },
            ],
          },
          { id: 'note', kind: 'text', lines: 'one', maxLength: 200, label: 'Demo: Note' },
        ],
      },
    ],
  };
}

describe('what an edit may not touch (edit-protected.ts)', () => {
  it('reads the protected parts of every definition the vectors name straight from the marks', () => {
    for (const [ref, definition] of Object.entries(vectors.definitions)) {
      expect(protectedParts(definition), ref).toEqual(protectedByTheMarks(definition));
      for (const { path } of fieldsOf(definition))
        expect(holdsProtected(definition, { path }), `${ref} ${path}`).toBe(
          holdsProtectedByTheMarks(definition, path),
        );
    }
  });

  it('answers each part by its own marks and its section’s, and a part the definition lacks as not protected', () => {
    const exam = named('demo_exam@1');
    expect(isProtected(exam, { section: 'meds' })).toBe(true);
    // A sensitive exam decides who reads the section, and protects none of it: its consent does.
    expect(isProtected(exam, { section: 'exam' })).toBe(false);
    expect(isProtected(exam, { path: 'exam.findings' })).toBe(false);
    expect(isProtected(exam, { path: 'exam.consent' })).toBe(true);
    expect(isProtected(exam, { path: 'exam.consent', code: 'yes' })).toBe(true);
    expect(isProtected(exam, { path: 'meds.ordered' })).toBe(true);
    expect(isProtected(exam, { path: 'systems.seen', code: 'feet' })).toBe(false);
    expect(isProtected(exam, { path: 'systems.seen', code: 'gu' })).toBe(true);
    for (const part of [
      { section: 'nowhere' },
      { path: 'exam.nowhere' },
      { path: 'exam' },
      { path: 'systems.seen', code: 'nowhere' },
      { path: 'general.concern', code: 'yes' },
    ])
      expect(isProtected(exam, part), JSON.stringify(part)).toBe(false);
    const flags = named('demo_flags@1');
    for (const part of [{ section: 'flags' }, { path: 'flags.notes' }, { path: 'flags.any', code: 'no' }])
      expect(isProtected(flags, part), JSON.stringify(part)).toBe(true);
    expect(isProtected(flags, { path: 'flags.nowhere' })).toBe(false);
  });

  it('counts what a grid’s cell holds as held by the grid, its section and a group around it', () => {
    const definition = rounds();
    // A cell has no path: the grid is named for it, protected when the cell is by its own marks.
    expect(isProtected(definition, { path: 'rounds.checks' })).toBe(false);
    expect(isProtected(definition, { path: 'rounds.asked.agreed' })).toBe(true);
    expect(isProtected(definition, { path: 'rounds.asked' })).toBe(false);
    for (const part of [{ path: 'rounds.checks' }, { path: 'rounds.asked' }, { section: 'rounds' }])
      expect(holdsProtected(definition, part), JSON.stringify(part)).toBe(true);
    expect(holdsProtected(definition, { path: 'rounds.note' })).toBe(false);
    expect(protectedParts(definition)).toEqual({
      sections: [],
      fields: ['rounds.asked.agreed'],
      options: [],
    });
  });
});

describe('hiding, showing and rewording (edit.ts)', () => {
  const contextOn = (versions: ResolvedNoteType[]): NoteTypeEditContext => ({
    versions,
    team: {},
    platform: {},
  });
  /** The version after `from`, as `change` makes it: what a platform version or an earlier edit left. */
  const nextOf = (from: ResolvedNoteType, change: (d: ResolvedNoteType) => void): ResolvedNoteType => {
    const next = structuredClone(from);
    next.version = from.version + 1;
    change(next);
    return next;
  };
  const refusedWith = (edits: NoteTypeEdit[], versions: ResolvedNoteType[]) => {
    const outcome = applyNoteTypeEdits(edits, contextOn(versions));
    return outcome.ok ? 'published' : outcome.refusal.code;
  };

  it('leaves a part the version already has as it is when it is shown', () => {
    const visit = named('demo_visit@1');
    const outcome = applyNoteTypeEdits(
      [
        { op: 'set_hidden', path: 'visit.kits', hidden: false },
        { op: 'set_hidden', path: 'stops', hidden: false },
      ],
      contextOn([visit]),
    );
    expect(outcome).toEqual({ ok: true, definition: { ...visit, version: 2 }, renames: [] });
  });

  it('shows a field back only into a group the version still has, and a group back whole', () => {
    const v1 = named('demo_visit@1');
    const v2 = nextOf(v1, (d) => {
      d.sections[1]!.fields = d.sections[1]!.fields.filter((f) => f.id !== 'pack');
    });
    expect(refusedWith([{ op: 'set_hidden', path: 'supplies.pack.bags', hidden: false }], [v1, v2])).toBe(
      'not_found',
    );
    const outcome = applyNoteTypeEdits(
      [{ op: 'set_hidden', path: 'supplies.pack', hidden: false }],
      contextOn([v1, v2]),
    );
    expect(outcome.ok && outcome.definition).toEqual({ ...v1, version: 3 });
  });

  it('shows nothing back that holds a protected field, nor into a protected section', () => {
    // As a platform version that dropped them would leave them: a team's edit never adds them back.
    const exam = named('demo_exam@1');
    const dropped = nextOf(exam, (d) => {
      d.sections = d.sections.filter((s) => s.id !== 'meds');
      d.sections[2]!.fields = d.sections[2]!.fields.filter((f) => f.id !== 'consent');
    });
    expect(refusedWith([{ op: 'set_hidden', path: 'meds', hidden: false }], [exam, dropped])).toBe(
      'protected',
    );
    expect(refusedWith([{ op: 'set_hidden', path: 'exam.consent', hidden: false }], [exam, dropped])).toBe(
      'protected',
    );
    // A field that was in no protected section then, shown back into one that is now.
    const open = nextOf(exam, (d) => {
      d.version = 1;
      delete d.sections[4]!.needs;
    });
    const closed = nextOf(open, (d) => {
      d.sections[4]!.needs = 'orderMedications';
      d.sections[4]!.fields = [
        { id: 'route', kind: 'text', lines: 'one', maxLength: 200, label: 'Demo: Route' },
      ];
    });
    expect(refusedWith([{ op: 'set_hidden', path: 'meds.ordered', hidden: false }], [open, closed])).toBe(
      'protected',
    );
  });

  it('refuses a hide that is neither true nor false, so a "false" sent as text hides nothing', () => {
    const edit = { op: 'set_hidden', path: 'visit.kits', hidden: 'false' } as unknown as NoteTypeEdit;
    expect(refusedWith([edit], [named('demo_visit@1')])).toBe('invalid');
  });

  it('refuses to hide a grid whose cell holds a protected field, or a group around such a grid', () => {
    for (const path of ['rounds.checks', 'rounds.asked', 'rounds'])
      expect(refusedWith([{ op: 'set_hidden', path, hidden: true }], [rounds()]), path).toBe('protected');
    expect(refusedWith([{ op: 'set_hidden', path: 'rounds.note', hidden: true }], [rounds()])).toBe(
      'published',
    );
  });

  it('writes only the words an operation names: a mark or a fixed field sent with it is never written (rules 1 and 2)', () => {
    const visit = named('demo_visit@1');
    const smuggled = [
      {
        op: 'rename_type',
        title: 'Demo: Evening outreach',
        kinds: ['medical'],
        group: 'clinical',
        sensitivity: 'sensitive',
        quick: true,
        auto: 'medical',
      },
      {
        op: 'rename_label',
        path: 'visit.kits',
        label: 'Demo: Kits out',
        required: true,
        noNormal: true,
        handoff: true,
      },
      {
        op: 'rename_label',
        path: 'stops',
        label: 'Demo: Places',
        sensitiveExam: true,
        treatmentRecord: true,
        needs: 'orderMedications',
      },
      {
        op: 'set_hidden',
        path: 'supplies.remark',
        hidden: false,
        showWhen: { field: 'visit.reason', is: 'other' },
      },
    ] as unknown as NoteTypeEdit[];
    const expected = structuredClone(visit);
    expected.version = 2;
    expected.title = 'Demo: Evening outreach';
    (expected.sections[0]!.fields[3] as { label: string }).label = 'Demo: Kits out';
    expected.sections[2]!.title = 'Demo: Places';
    expect(applyNoteTypeEdits(smuggled, contextOn([visit]))).toEqual({
      ok: true,
      definition: expected,
      renames: [{ path: 'visit.kits', from: 'Demo: Kits given', to: 'Demo: Kits out' }],
    });
  });

  it('declares a rename of a part shown back from the label it last had, and none when it is only shown back', () => {
    const v1 = named('demo_visit@1');
    const v2 = named('demo_visit@2');
    const reworded = applyNoteTypeEdits(
      [
        { op: 'set_hidden', path: 'visit.kits', hidden: false },
        { op: 'rename_label', path: 'visit.kits', label: 'Demo: Kits out' },
      ],
      contextOn([v1, v2]),
    );
    expect(reworded.ok && reworded.renames).toEqual([
      { path: 'visit.kits', from: 'Demo: Kits given', to: 'Demo: Kits out' },
    ]);
    const back = applyNoteTypeEdits(
      [
        { op: 'rename_label', path: 'visit.kits', label: 'Demo: Kits out' },
        { op: 'set_hidden', path: 'visit.kits', hidden: true },
        { op: 'set_hidden', path: 'visit.kits', hidden: false },
      ],
      contextOn([v1]),
    );
    expect(back).toEqual({ ok: true, definition: { ...v1, version: 2 }, renames: [] });
    if (reworded.ok)
      expectStorable(reworded.definition, [v1, v2], reworded.renames, () => undefined, 'reworded');
  });

  it('takes a title of 1 to 80 characters, counted as code points, that the schema takes', () => {
    expect(isNoteTypeTitle('Demo: 🩹'.padEnd(6 + 2 * 74, '🩹'))).toBe(true);
    expect(isNoteTypeTitle('Demo: '.padEnd(80, 'x'))).toBe(true);
    expect(isNoteTypeTitle('Demo: '.padEnd(81, 'x'))).toBe(false);
    for (const title of ['', '   ', 'Demo: a\ttab', 'Demo: a\u007fdelete', 'Demo: half \ud83e', 42])
      expect(isNoteTypeTitle(title), JSON.stringify(title)).toBe(false);
  });
});

describe('over the released note types', () => {
  it('reads the protected parts of each straight from phase 4’s marks', () => {
    for (const definition of released.values()) {
      expect(protectedParts(definition), definition.key).toEqual(protectedByTheMarks(definition));
      for (const { path } of fieldsOf(definition))
        expect(isProtected(definition, { path }), `${definition.key} ${path}`).toBe(
          protectedByTheMarks(definition).fields.includes(path),
        );
      for (const section of definition.sections)
        expect(holdsProtected(definition, { section: section.id }), `${definition.key} ${section.id}`).toBe(
          holdsProtectedByTheMarks(definition, section.id),
        );
    }
  });

  it('protects every part of the auto note type, Red flags and disposition, from every operation', () => {
    const red = released.get('red_flags_disposition')!;
    expect(red.auto).toBe('medical');
    const first = red.sections[0]!;
    const choice = fieldsOf(red).find((w) => w.field.kind === 'choice')!;
    const code = (choice.field as { options: Option[] }).options[0]!.code;
    const edits: NoteTypeEdit[] = [
      { op: 'rename_type', title: 'Demo: Warning signs' },
      { op: 'rename_label', path: first.id, label: 'Demo: First part' },
      { op: 'set_hidden', path: fieldsOf(red).at(-1)!.path, hidden: true },
      { op: 'add_option', path: choice.path, label: 'Demo: Another' },
      { op: 'rename_option', path: choice.path, code, label: 'Demo: Reworded' },
      { op: 'move_option', path: choice.path, code, before: null },
      { op: 'retire_option', path: choice.path, code },
      {
        op: 'add_field',
        sectionId: first.id,
        kind: 'text',
        label: 'Demo: More',
        lines: 'one',
        maxLength: 200,
      },
      {
        op: 'add_section',
        title: 'Demo: More',
        afterSectionId: first.id,
        fields: [{ kind: 'text', label: 'Demo: More', lines: 'one', maxLength: 200 }],
      },
    ];
    for (const edit of edits)
      expect(applyNoteTypeEdits([edit], releasedContext(red)), edit.op).toMatchObject({
        ok: false,
        opIndex: 0,
        refusal: { code: 'protected' },
      });
  });

  const editable = [...released.values()].filter((d) => d.auto === undefined);

  it('rewords every part an edit may touch, each title, label and option, in one publish of each type', () => {
    for (const definition of editable) {
      const parts = protectedByTheMarks(definition);
      const edits: NoteTypeEdit[] = [{ op: 'rename_type', title: `Demo: ${definition.title}`.slice(0, 80) }];
      for (const section of definition.sections)
        if (!parts.sections.includes(section.id))
          edits.push({ op: 'rename_label', path: section.id, label: `Demo: ${section.title}` });
      for (const { field, path } of fieldsOf(definition)) {
        if (parts.fields.includes(path)) continue;
        edits.push({ op: 'rename_label', path, label: `Demo: ${field.label}` });
        if (field.kind === 'choice')
          for (const option of field.options)
            if (!markedOption(option))
              edits.push({ op: 'rename_option', path, code: option.code, label: `Demo: ${option.label}` });
      }
      const outcome = expectPublished(definition, edits, `${definition.key}: every label reworded`);
      if (!outcome?.ok) continue;
      // Every rename names a path the version stores, and none was left undeclared (versionProblems).
      expect(outcome.renames.length, definition.key).toBeGreaterThan(0);
    }
  });

  it('adds an option to every choice, a field to every section and one section, in one publish of each type', () => {
    for (const definition of editable) {
      const parts = protectedByTheMarks(definition);
      const edits: NoteTypeEdit[] = [];
      for (const { field, path } of fieldsOf(definition))
        // A quick field's codes must all be the full field's (Expand): adding one to it alone is
        // what rule 5 carries along mapsTo, below.
        if (field.kind === 'choice' && !parts.fields.includes(path) && field.mapsTo === undefined)
          edits.push({ op: 'add_option', path, label: 'Demo: One more' });
      for (const section of definition.sections)
        if (!parts.sections.includes(section.id) && edits.filter((e) => e.op === 'add_field').length < 40)
          edits.push({
            op: 'add_field',
            sectionId: section.id,
            kind: 'text',
            label: 'Demo: A note of the team’s',
            lines: 'one',
            maxLength: 200,
          });
      edits.push({
        op: 'add_section',
        title: 'Demo: The team’s own',
        afterSectionId: definition.sections.at(-1)!.id,
        fields: [{ kind: 'choice', label: 'Demo: Asked?', many: false, options: ['Demo: Yes', 'Demo: No'] }],
      });
      const outcome = expectPublished(definition, edits, `${definition.key}: added to`);
      if (!outcome?.ok) continue;
      // Each id and code the server made is t_ and a number, none of them twice (rule 3).
      const made = JSON.stringify(outcome.definition).match(/"(?:id|code)":"t_\d+"/g) ?? [];
      expect(new Set(made).size, definition.key).toBe(made.length);
      expect(made.length, definition.key).toBeGreaterThan(edits.length);
      expect(outcome.renames, definition.key).toEqual([]);
    }
  });

  it('moves every option an edit may move, in one publish of each type, changing nothing a reader sees', () => {
    for (const definition of editable) {
      const parts = protectedByTheMarks(definition);
      const edits: NoteTypeEdit[] = [];
      for (const { field, path } of fieldsOf(definition))
        if (field.kind === 'choice' && !parts.fields.includes(path))
          for (const option of field.options)
            if (!markedOption(option))
              edits.push({ op: 'move_option', path, code: option.code, before: null });
      if (edits.length > 0) expectPublished(definition, edits, `${definition.key}: options moved`);
    }
  });

  it('retires one option of every choice an edit may change, where no condition asks about it', () => {
    for (const definition of editable) {
      const parts = protectedByTheMarks(definition);
      const asked = codesAskedAbout(definition);
      const edits: NoteTypeEdit[] = [];
      for (const { field, path } of fieldsOf(definition)) {
        if (field.kind !== 'choice' || parts.fields.includes(path) || field.mapsTo !== undefined) continue;
        const free = field.options.filter((o) => !markedOption(o) && !asked.has(o.code));
        const named = new Set((field.excludes ?? []).flat());
        const option = free.find((o) => !named.has(o.code));
        if (option && field.options.length > 1) edits.push({ op: 'retire_option', path, code: option.code });
      }
      if (edits.length > 0)
        expectPublished(definition, edits, `${definition.key}: options retired`, { sameForReaders: false });
    }
  });

  it('hides each section and field alone, or refuses it for what protects it or what names it', () => {
    for (const definition of editable) {
      const paths = [...definition.sections.map((s) => s.id), ...fieldsOf(definition).map((w) => w.path)];
      for (const path of paths) {
        const what = `${definition.key}: hide ${path}`;
        const outcome = applyNoteTypeEdits(
          [{ op: 'set_hidden', path, hidden: true }],
          releasedContext(definition),
        );
        if (!outcome.ok) {
          expect(['protected', 'in_use', 'last_field', 'last_section'], what).toContain(outcome.refusal.code);
          expect(outcome.refusal.code === 'protected', what).toBe(holdsProtectedByTheMarks(definition, path));
          continue;
        }
        expect(holdsProtectedByTheMarks(definition, path), what).toBe(false);
        // What is hidden changes what a reader sees of it, and through a flag's clears what counts
        // beside it: phase 4's checks hold the result, and notes stay on the version they have.
        expectPublished(definition, [{ op: 'set_hidden', path, hidden: true }], what, {
          sameForReaders: false,
        });
      }
    }
  });

  it('carries an option added to the quick encounter into the full note type it maps to, with one code', () => {
    const team = Object.fromEntries([...released].map(([key, d]) => [key, [d]]));
    const quick = released.get('quick_encounter')!;
    const mapped = fieldsOf(quick).filter(
      (w) =>
        w.field.kind === 'choice' &&
        w.field.mapsTo !== undefined &&
        !protectedByTheMarks(quick).fields.includes(w.path),
    );
    expect(mapped.length).toBeGreaterThan(0);
    for (const { field, path } of mapped) {
      const [fullKey, fullPath] = field.mapsTo!.split(':') as [string, string];
      expect(optionReach('quick_encounter', path, RELEASED), path).toEqual([
        { key: fullKey, path: fullPath },
      ]);
      expect(optionReach(fullKey, fullPath, RELEASED), fullPath).toEqual([{ key: 'quick_encounter', path }]);
      const outcome = editNoteTypes({
        key: 'quick_encounter',
        edits: [{ op: 'add_option', path, label: 'Demo: One more' }],
        team,
        platform: RELEASED,
      });
      expect(outcome.ok, `${path}: ${JSON.stringify(outcome)}`).toBe(true);
      if (!outcome.ok) continue;
      expect(
        outcome.published.map((p) => p.key),
        path,
      ).toEqual(['quick_encounter', fullKey]);
      const added = outcome.published.map((p) => {
        const f = fieldAt(p.definition, p.key === 'quick_encounter' ? path : fullPath)!.field as {
          options: Option[];
        };
        return f.options.at(-1);
      });
      expect(added[0], path).toEqual({ code: 't_1', label: 'Demo: One more' });
      expect(added[1], path).toEqual(added[0]);
      const published = new Map(outcome.published.map((p) => [p.key, p.definition]));
      for (const p of outcome.published)
        expectStorable(
          p.definition,
          [released.get(p.key)!],
          p.renames,
          (key) => published.get(key) ?? lookupReleased(key),
          `${path} (${p.key})`,
        );
    }
  });
});
