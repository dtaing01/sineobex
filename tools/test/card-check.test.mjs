import { describe, expect, it } from 'vitest';
import { checkCard, linesAsked, parseCard, SECTIONS } from '../card-check-rules.mjs';

const FILE = 'docs/plan/phase-4-encounters/cards/F6-psychological.md';

/** A card that passes, with any section replaced. */
function card(overrides = {}, title = '# Card F6-psychological: the Behavioral health note type') {
  const body = {
    Goal: 'The note type exists.',
    Level: 'S',
    'Depends on': '- F0-export (the export runs).\n- F6-spec-pieces (the lines are saved).',
    'Read first':
      '- `docs/plan/patterns/form-definition.md`, all of it (124 lines).\n' +
      '- `packages/forms/definitions/spec/psychological.txt`, all of it (22 lines) (made by F6-spec-pieces).\n' +
      '- `services/api/src/auth/permissions.ts` lines 56-73.',
    Pattern: 'Recipe: `docs/plan/patterns/form-definition.md`.',
    'Files to change':
      '- `packages/forms/definitions/note-types/psychological/v1.json` (new)\n' +
      '- The generated files the export rewrites.',
    Steps: '1. Create the file.',
    Tests: 'None to write.',
    Run: '```sh\npnpm forms:export\n```',
    'Check before you report': '1. Did the export end with `0 problems`?',
    Never: '- Never edit a generated file by hand.',
    'If stuck': 'Stop and report.',
    Context: 'A 16,000-token window is enough.',
    Report: '(The implementer fills this in.)',
    ...overrides,
  };
  return [title, '', ...SECTIONS.flatMap((s) => [`## ${s}`, '', body[s], ''])].join('\n');
}

const repo = (
  lines = { 'docs/plan/patterns/form-definition.md': 124, 'services/api/src/auth/permissions.ts': 200 },
) => ({
  exists: (p) => p in lines,
  lineCount: (p) => lines[p],
});

const check = (text, r = repo(), file = FILE) => checkCard(file, text, r);

describe('a task card', () => {
  it('passes when it has every section, a level, a short reading list and real paths', () => {
    expect(check(card())).toEqual([]);
  });

  it('must be named after its file', () => {
    expect(check(card({}, '# Card F6-other: something'))).toEqual([
      `${FILE}: the card is called F6-other but its file is F6-psychological.md`,
    ]);
    expect(check(card({}, '# The Behavioral health note type'))[0]).toMatch(/first line must be/);
  });

  it('must have exactly the fourteen sections, in order', () => {
    const missing = card().replace('## Never\n\n- Never edit a generated file by hand.\n\n', '');
    expect(check(missing)[0]).toMatch(/sections must be exactly, in order/);
    const swapped = card()
      .replace('## Goal', '## Level2')
      .replace('## Level\n', '## Goal\n')
      .replace('## Level2', '## Level');
    expect(check(swapped)[0]).toMatch(/sections must be exactly, in order/);
    expect(check(card({ Steps: '' }))[0]).toMatch(/section "Steps" is empty/);
  });

  it('must have a level', () => {
    expect(check(card({ Level: 'Easy' }))[0]).toMatch(/Level must start with S, T, R or X/);
    expect(check(card({ Level: 'T. The planner wrote the tests first.' }))).toEqual([]);
  });

  it('changes at most three source files; tests and documents are not counted', () => {
    const four = card({
      'Files to change':
        '- `packages/forms/src/a.ts`\n- `packages/forms/src/b.ts`\n- `packages/forms/src/c.ts`\n- `packages/forms/src/d.ts`',
    });
    expect(check(four)[0]).toMatch(/changes 4 source files/);
    const withTests = card({
      'Files to change':
        '- `packages/forms/src/a.ts`\n- `packages/forms/src/b.ts`\n- `packages/forms/src/c.ts`\n' +
        '- `packages/forms/test/a.test.ts`\n- `apps/mobile/test/forms/a_test.dart`\n- `docs/design/phase-4/forms.md`',
    });
    expect(check(withTests)).toEqual([]);
    expect(check(card({ 'Files to change': 'The definition.' }))[0]).toMatch(/names no file/);
  });

  it('may touch an always-X path only at level X', () => {
    for (const path of [
      'services/api/src/sync/apply.ts',
      'services/api/src/auth/permissions.ts',
      'apps/mobile/lib/sync/local_store.dart',
      'apps/mobile/test/sync/fake_server.dart',
      '.github/workflows/ci.yml',
      'tools/ci-local.sh',
    ]) {
      const c = (level) => card({ Level: level, 'Files to change': `- \`${path}\`` });
      expect(check(c('T'))[0], path).toMatch(/always-X path but the card is level T/);
      expect(check(c('X')), path).toEqual([]);
    }
  });

  it('may change a migration only at level X or R', () => {
    const c = (level) =>
      card({ Level: level, 'Files to change': '- `db/migrations/0018_encounter_lifecycle.sql` (new)' });
    expect(check(c('S'))[0]).toMatch(/is a migration/);
    expect(check(c('R'))).toEqual([]);
    expect(check(c('X'))).toEqual([]);
  });

  it('reads only files that exist, or that a card it depends on makes', () => {
    const gone = card({ 'Read first': '- `docs/plan/patterns/no-such-recipe.md`, all of it (100 lines).' });
    expect(check(gone)[0]).toMatch(/no-such-recipe.md does not exist/);
    const stranger = card({
      'Read first': '- `packages/forms/src/types.ts`, all of it (80 lines) (made by F0-types).',
    });
    expect(check(stranger)[0]).toMatch(/made by F0-types, which is not in Depends on/);
  });

  it('says how much of each file to read, and the file is that long', () => {
    expect(check(card({ 'Read first': '- `docs/plan/patterns/form-definition.md`.' }))[0]).toMatch(
      /must say how many lines/,
    );
    const past = card({ 'Read first': '- `services/api/src/auth/permissions.ts` lines 150-260.' });
    expect(check(past)[0]).toMatch(/has 200 lines, not 260/);
    const stale = card({ 'Read first': '- `docs/plan/patterns/form-definition.md`, all of it (60 lines).' });
    expect(check(stale)[0]).toMatch(/has 124 lines, the card says 60/);
    expect(check(card({ 'Read first': 'The recipe.\n- Everything in the package (40 lines).' }))[0]).toMatch(
      /must start with a path in backticks/,
    );
  });

  it('asks for at most 300 lines of reading', () => {
    const long = card({
      'Read first':
        '- `docs/plan/patterns/form-definition.md`, all of it (124 lines).\n' +
        '- `services/api/src/auth/permissions.ts` lines 1-200.',
    });
    expect(check(long)[0]).toMatch(/Read first asks for 324 lines; the limit is 300/);
  });

  it('names the window it needs, and no model', () => {
    expect(check(card({ Context: 'A normal window is enough.' }))[0]).toMatch(/16,000 or 32,000/);
    expect(check(card({ Context: 'A 32,000-token window.' }))).toEqual([]);
    expect(check(card({ Goal: 'Written for Qwen.' }))[0]).toMatch(/names a model/);
    expect(check(card({ Goal: 'The rules of `CLAUDE.md` apply.' }))).toEqual([]);
  });
});

describe('reading a card', () => {
  it('finds the ID, the title and the sections', () => {
    const c = parseCard(card());
    expect(c.id).toBe('F6-psychological');
    expect(c.title).toBe('the Behavioral health note type');
    expect(c.sections.map((s) => s.name)).toEqual(SECTIONS);
  });

  it('reads a line count or a line range', () => {
    expect(linesAsked('`a.md`, all of it (124 lines).')).toEqual({ count: 124, last: null });
    expect(linesAsked('`a.md`, section 3 (about 115 lines).')).toEqual({ count: 115, last: null });
    expect(linesAsked('`a.ts` lines 56-73: the rules.')).toEqual({ count: 18, last: 73 });
    expect(linesAsked('`a.ts`')).toBeNull();
  });
});
