import { describe, expect, it } from 'vitest';
import { checkCard, linesAsked, parseCard, SECTIONS } from '../card-check-rules.mjs';

const FILE = 'docs/plan/phase-4-encounters/cards/F6-psychological.md';

/** A card that passes, with its header line or any section replaced. */
function card(
  overrides = {},
  { title = '# Card F6-psychological: the Behavioral health note type', header } = {},
) {
  const body = {
    Goal: 'The note type exists.',
    'Read first':
      '- `docs/plan/patterns/form-definition.md` lines 30-77.\n' +
      '- `packages/forms/definitions/spec/psychological.txt`, all of it (22 lines) (made by F6-spec-pieces).\n' +
      '- `services/api/src/auth/permissions.ts` lines 56-73.',
    Files:
      '- `packages/forms/definitions/note-types/psychological/v1.json` (new)\n' +
      '- The generated files the export rewrites.',
    Steps: '1. Create the file.',
    Tests: 'None to write.',
    Run: '```sh\npnpm forms:export\n```',
    Audit: '- The export ended with `0 problems`.',
    ...overrides,
  };
  return [
    title,
    '',
    header ?? 'Level: S. Window: 16,000. Needs: F0-export, F6-spec-pieces.',
    '',
    ...SECTIONS.flatMap((s) => [`## ${s}`, '', body[s], '']),
  ].join('\n');
}

const repo = (
  lines = { 'docs/plan/patterns/form-definition.md': 124, 'services/api/src/auth/permissions.ts': 200 },
) => ({
  exists: (p) => p in lines,
  lineCount: (p) => lines[p],
});

const check = (text, r = repo(), file = FILE) => checkCard(file, text, r);

describe('a task card', () => {
  it('passes when it has its header, every section, a short reading list and real paths', () => {
    expect(check(card())).toEqual([]);
  });

  it('must be named after its file', () => {
    expect(check(card({}, { title: '# Card F6-other: something' }))).toEqual([
      `${FILE}: the card is called F6-other but its file is F6-psychological.md`,
    ]);
    expect(check(card({}, { title: '# The Behavioral health note type' }))[0]).toMatch(/first line must be/);
  });

  it('must say its level, its window and what it needs on the line under the title', () => {
    expect(check(card({}, { header: 'An easy one.' }))[0]).toMatch(/line under the title must be/);
    expect(check(card({}, { header: 'Level: E. Window: 16,000. Needs: none.' }))[0]).toMatch(
      /Level must be S, T, R or X/,
    );
    expect(check(card({}, { header: 'Level: S. Window: 8,000. Needs: none.' }))[0]).toMatch(
      /Window must be 16,000 or 32,000/,
    );
    expect(check(card({}, { header: 'Level: S. Window: 16,000. Needs: the export.' }))[0]).toMatch(
      /Needs must be card IDs/,
    );
    expect(
      check(card({}, { header: 'Level: S. Window: 16,000. Needs: E-presets, F6-spec-pieces.' })),
    ).toEqual([]);
    const alone = card(
      { 'Read first': '- `docs/plan/patterns/form-definition.md` lines 30-77.' },
      {
        header: 'Level: T. Window: 32,000. Needs: none.',
      },
    );
    expect(check(alone)).toEqual([]);
  });

  it('must have exactly the seven sections, in order', () => {
    const missing = card().replace('## Audit\n\n- The export ended with `0 problems`.\n', '');
    expect(check(missing)[0]).toMatch(/sections must be exactly, in order/);
    const extra = card().replace('## Steps', '## Never\n\nEdit a test.\n\n## Steps');
    expect(check(extra)[0]).toMatch(/sections must be exactly, in order/);
    expect(check(card({ Steps: '' }))[0]).toMatch(/section "Steps" is empty/);
  });

  it('is short: 90 lines, or 120 at level X', () => {
    const steps = (n) => Array.from({ length: n }, (_, i) => `${i + 1}. Step.`).join('\n');
    expect(check(card({ Steps: steps(80) }))[0]).toMatch(/has \d+ lines; a level S card has at most 90/);
    const x = (n) =>
      card({ Steps: steps(n) }, { header: 'Level: X. Window: 32,000. Needs: F0-export, F6-spec-pieces.' });
    expect(check(x(80))).toEqual([]);
    expect(check(x(110))[0]).toMatch(/a level X card has at most 120/);
  });

  it('changes at most three source files; tests and documents are not counted', () => {
    const four = card({
      Files:
        '- `packages/forms/src/a.ts`\n- `packages/forms/src/b.ts`\n- `packages/forms/src/c.ts`\n- `packages/forms/src/d.ts`',
    });
    expect(check(four)[0]).toMatch(/changes 4 source files/);
    const withTests = card({
      Files:
        '- `packages/forms/src/a.ts`\n- `packages/forms/src/b.ts`\n- `packages/forms/src/c.ts`\n' +
        '- `packages/forms/test/a.test.ts`\n- `apps/mobile/test/forms/a_test.dart`\n- `docs/design/phase-4/forms.md`',
    });
    expect(check(withTests)).toEqual([]);
    expect(check(card({ Files: 'The definition.' }))[0]).toMatch(/names no file/);
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
      const c = (l) =>
        card(
          { Files: `- \`${path}\``, 'Read first': '- `docs/plan/patterns/form-definition.md` lines 30-77.' },
          {
            header: `Level: ${l}. Window: 16,000. Needs: none.`,
          },
        );
      expect(check(c('T'))[0], path).toMatch(/always-X path but the card is level T/);
      expect(check(c('X')), path).toEqual([]);
    }
  });

  it('may change a migration only at level X or R', () => {
    const c = (l) =>
      card(
        {
          Files: '- `db/migrations/0018_encounter_lifecycle.sql` (new)',
          'Read first': '- `docs/plan/patterns/form-definition.md` lines 30-77.',
        },
        { header: `Level: ${l}. Window: 16,000. Needs: none.` },
      );
    expect(check(c('S'))[0]).toMatch(/is a migration/);
    expect(check(c('R'))).toEqual([]);
    expect(check(c('X'))).toEqual([]);
  });

  it('reads only files that exist, or that a card it needs makes', () => {
    const gone = card({ 'Read first': '- `docs/plan/patterns/no-such-recipe.md`, all of it (100 lines).' });
    expect(check(gone)[0]).toMatch(/no-such-recipe.md does not exist/);
    const stranger = card({
      'Read first': '- `packages/forms/src/types.ts`, all of it (80 lines) (made by F0-types).',
    });
    expect(check(stranger)[0]).toMatch(/made by F0-types, which is not under Needs/);
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

  it('asks for at most 200 lines of reading', () => {
    const long = card({
      'Read first':
        '- `docs/plan/patterns/form-definition.md`, all of it (124 lines).\n' +
        '- `services/api/src/auth/permissions.ts` lines 1-100.',
    });
    expect(check(long)[0]).toMatch(/Read first asks for 224 lines; the limit is 200/);
  });

  it('names no model', () => {
    expect(check(card({ Goal: 'Written for Qwen.' }))[0]).toMatch(/names a model/);
    expect(check(card({ Goal: 'The rules of `CLAUDE.md` apply.' }))).toEqual([]);
  });
});

describe('reading a card', () => {
  it('finds the ID, the title, the header and the sections', () => {
    const c = parseCard(card());
    expect(c.id).toBe('F6-psychological');
    expect(c.title).toBe('the Behavioral health note type');
    expect(c.level).toBe('S');
    expect(c.window).toBe('16,000');
    expect(c.needs).toEqual(['F0-export', 'F6-spec-pieces']);
    expect(c.sections.map((s) => s.name)).toEqual(SECTIONS);
    expect(parseCard(card({}, { header: 'Level: X. Window: 32,000. Needs: none.' })).needs).toEqual([]);
  });

  it('reads a line count or a line range', () => {
    expect(linesAsked('`a.md`, all of it (124 lines).')).toEqual({ count: 124, last: null });
    expect(linesAsked('`a.md`, section 3 (about 115 lines).')).toEqual({ count: 115, last: null });
    expect(linesAsked('`a.ts` lines 56-73: the rules.')).toEqual({ count: 18, last: 73 });
    expect(linesAsked('`a.ts`')).toBeNull();
  });
});
