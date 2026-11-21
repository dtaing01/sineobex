import { describe, expect, it } from 'vitest';
import {
  checkCard,
  fileItem,
  namedModel,
  parseCard,
  readItem,
  runScript,
  SECTIONS,
} from '../card-check-rules.mjs';

const FILE = 'docs/plan/phase-4-encounters/cards/F6-psychological.md';
const HEADER = 'Level: S. Window: 16,000. Needs: F0-export, F6-spec-pieces.';
const F = '```';

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
    Run: `${F}sh\npnpm forms:export\n${F}`,
    Audit: '- The export ended with `0 problems`.',
    ...overrides,
  };
  return [title, '', header ?? HEADER, '', ...SECTIONS.flatMap((s) => [`## ${s}`, '', body[s], ''])].join(
    '\n',
  );
}

const LINES = { 'docs/plan/patterns/form-definition.md': 124, 'services/api/src/auth/permissions.ts': 200 };
const repo = (lines = LINES) => ({
  exists: (p) => p in lines,
  lineCount: (p) => lines[p],
});

const check = (text, r = repo(), file = FILE) => checkCard(file, text, r);

describe('a task card', () => {
  it('passes when it has its header, every section, a short reading list and real paths', () => {
    expect(check(card())).toEqual([]);
  });

  it('must be named after its file, by a unit and a short name', () => {
    expect(check(card({}, { title: '# Card F6-other: something' }))).toEqual([
      `${FILE}: the card is called F6-other but its file is F6-psychological.md`,
    ]);
    expect(check(card({}, { title: '# The Behavioral health note type' }))[0]).toMatch(/first line must be/);
    for (const id of ['f6-psych', 'F6_psych', 'F6-Psych', 'F6-']) {
      const named = card({}, { title: `# Card ${id}: a title` });
      expect(check(named, repo(), `docs/plan/p/cards/${id}.md`)[0], id).toMatch(
        /must look like F6-psychological/,
      );
    }
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

  it('is the same card with the other line ending, with a mark at its start, or with a heading inside a code block', () => {
    expect(check(card().replaceAll('\n', '\r\n'))).toEqual([]);
    expect(check(`\uFEFF${card()}`)).toEqual([]);
    const sample = card({ Steps: `1. Write this file:\n\n   ${F}md\n## A heading of the file\n   ${F}` });
    expect(check(sample)).toEqual([]);
    expect(parseCard(sample).sections.map((s) => s.name)).toEqual(SECTIONS);
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
        '- `packages/forms/src/a.ts` (new)\n- `packages/forms/src/b.ts` (new)\n- `packages/forms/src/c.ts` (new)\n- `packages/forms/src/d.ts` (new)',
    });
    expect(check(four)[0]).toMatch(/changes 4 source files/);
    const withTests = card({
      Files:
        '- `packages/forms/src/a.ts` (new)\n- `packages/forms/src/b.ts` (new)\n- `packages/forms/src/c.ts` (new)\n' +
        '- `packages/forms/test/a.test.ts` (new)\n- `apps/mobile/test/forms/a_test.dart` (new)\n- `docs/design/phase-4/notes.md` (new)',
    });
    expect(check(withTests)).toEqual([]);
  });

  it('may leave everything to its commands only at level S, where a machine checks all of it', () => {
    const words = { Files: '- The contract files, which `pnpm contract:generate` rewrites.' };
    expect(check(card(words))).toEqual([]);
    expect(
      check(card(words, { header: 'Level: T. Window: 16,000. Needs: F0-export, F6-spec-pieces.' }))[0],
    ).toMatch(/Files names no file \(only a level S card leaves everything to its commands\)/);
  });

  it('never has a generated file written by hand', () => {
    const r = repo({
      ...LINES,
      'apps/mobile/lib/api/generated/client.dart': 50,
      'packages/contract/openapi.json': 50,
    });
    for (const path of [
      'apps/mobile/lib/api/generated/client.dart',
      'packages/contract/openapi.json',
      'packages/forms/generated/presets.json',
    ]) {
      const generated = card({ Files: `- \`${path}\`${path.endsWith('presets.json') ? ' (new)' : ''}` });
      expect(check(generated, r)[0], path).toMatch(/is written by a command, never by hand/);
      const x = card(
        { Files: `- \`${path}\` (new)` },
        { header: 'Level: X. Window: 16,000. Needs: F0-export, F6-spec-pieces.' },
      );
      expect(check(x)[0], path).toMatch(/is written by a command, never by hand/);
    }
  });

  it('counts a file once, however many of its line ranges the card names', () => {
    const r = repo({ ...LINES, 'services/api/src/app.ts': 120 });
    const twice = card({
      Files:
        '- `services/api/src/app.ts` lines 7-17: the imports\n- `services/api/src/app.ts` lines 99-109\n' +
        '- `packages/forms/src/a.ts` (new)\n- `packages/forms/src/b.ts` (new)',
    });
    expect(check(twice, r)).toEqual([]);
  });

  it('may touch an always-X path only at level X, however the path is spelled', () => {
    const paths = [
      'services/api/src/sync/apply.ts',
      'services/api/src/auth/permissions.ts',
      'apps/mobile/lib/sync/local_store.dart',
      'apps/mobile/test/sync/fake_server.dart',
      '.github/workflows/ci.yml',
      'tools/ci-local.sh',
      'Tools/ci-local.sh',
      'services/API/src/Sync/apply.ts',
    ];
    const r = repo({ ...LINES, ...Object.fromEntries(paths.map((p) => [p, 50])) });
    for (const path of paths) {
      const c = (l) =>
        card(
          { Files: `- \`${path}\``, 'Read first': '- `docs/plan/patterns/form-definition.md` lines 30-77.' },
          {
            header: `Level: ${l}. Window: 16,000. Needs: none.`,
          },
        );
      expect(check(c('T'), r)[0], path).toMatch(/always-X path but the card is level T/);
      expect(check(c('X'), r), path).toEqual([]);
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

  it('names what it writes as a new file, a whole file or a line range of a file that is there', () => {
    const r = repo({ ...LINES, 'services/api/src/app.ts': 120 });
    const files = (Files) => check(card({ Files }), r);
    expect(files('- `services/api/src/app.ts`: the registrations')).toEqual([]);
    expect(files('- `services/api/src/app.ts` lines 99-109')).toEqual([]);
    expect(files('- `services/api/src/app.ts` lines 99-109 (replace): the old handler')).toEqual([]);
    expect(files('- `services/api/src/app.ts` lines 99-130')[0]).toMatch(/app\.ts has 120 lines, not 130/);
    expect(files('- `services/api/src/app.ts` lines 20-10')[0]).toMatch(/lines 20-10 is not a range/);
    expect(
      files('- `services/api/src/app.ts` lines 5-20\n- `services/api/src/app.ts` lines 15-30')[0],
    ).toMatch(/lines 5-20 and 15-30 overlap/);
    // Two ranges may touch; they may not share a line.
    expect(
      files('- `services/api/src/app.ts` lines 5-10\n- `services/api/src/app.ts` lines 10-12')[0],
    ).toMatch(/lines 5-10 and 10-12 overlap/);
    expect(files('- `services/api/src/app.ts` lines 5-10\n- `services/api/src/app.ts` lines 11-12')).toEqual(
      [],
    );
    expect(files('- `services/api/src/app.ts`\n- `services/api/src/app.ts` lines 15-30')[0]).toMatch(
      /listed more than once/,
    );
    expect(files('- `services/api/src/gone.ts`')[0]).toMatch(/gone\.ts does not exist \(say "\(new\)"/);
    expect(files('- `packages/forms/src/types.ts` (made by F0-types)')[0]).toMatch(
      /made by F0-types, which is not under Needs/,
    );
    expect(files('- `packages/forms/src/types.ts` (made by F0-export)')).toEqual([]);
  });

  it('refuses the slips that would be read as "write the whole file again"', () => {
    const r = repo({ ...LINES, 'services/api/src/app.ts': 120 });
    const slips = [
      '- `services/api/src/app.ts` (made by F0-export) lines 5-9',
      '- `services/api/src/app.ts`, lines 5-9',
      '- `services/api/src/app.ts` line 7',
      '- `services/api/src/app.ts`: the registrations (new)',
      '- `services/api/src/app.ts`: the old handler (replace)',
    ];
    for (const Files of slips)
      expect(check(card({ Files }), r)[0], Files).toMatch(
        /"lines 56-73", "\(new\)" and "\(replace\)" go straight after the path/,
      );
    // A list a program would read as empty: the wrong bullet, a number, a sentence.
    for (const Files of [
      '* `packages/forms/src/a.ts` (new)',
      '1. `packages/forms/src/a.ts` (new)',
      'The definition.',
    ])
      expect(check(card({ Files }))[0], Files).toMatch(/Files: every line is an item that starts with "- "/);
    for (const read of ['* `docs/plan/patterns/form-definition.md` lines 30-77.', 'The recipe, all of it.'])
      expect(check(card({ 'Read first': read }))[0], read).toMatch(
        /Read first: every line is an item that starts with "- ", or the section says "Nothing\."/,
      );
    expect(check(card({ 'Read first': 'Nothing.' }))).toEqual([]);
  });

  it('asks the small model to write again at most 200 lines that are already there', () => {
    const r = repo({ ...LINES, 'packages/forms/src/long.ts': 320, 'packages/forms/src/short.ts': 90 });
    const whole = { Files: '- `packages/forms/src/long.ts`' };
    expect(check(card(whole), r)[0]).toMatch(/asks for 320 lines to be written again; the limit is 200/);
    expect(check(card({ Files: '- `packages/forms/src/long.ts` lines 100-180' }), r)).toEqual([]);
    const both = { Files: '- `packages/forms/src/long.ts` lines 100-220\n- `packages/forms/src/short.ts`' };
    expect(check(card(both), r)[0]).toMatch(/asks for 211 lines to be written again/);
    // A wider window holds twice as much, and the frontier model has no such limit.
    const needs = 'Needs: F0-export, F6-spec-pieces.';
    expect(check(card(whole, { header: `Level: T. Window: 32,000. ${needs}` }), r)).toEqual([]);
    expect(check(card(whole, { header: `Level: X. Window: 16,000. ${needs}` }), r)).toEqual([]);
  });

  it('reads only files that exist, or that a card it needs makes', () => {
    const gone = card({ 'Read first': '- `docs/plan/patterns/no-such-recipe.md`, all of it (100 lines).' });
    expect(check(gone)[0]).toMatch(/no-such-recipe.md does not exist/);
    const stranger = card({
      'Read first': '- `packages/forms/src/types.ts`, all of it (80 lines) (made by F0-types).',
    });
    expect(check(stranger)[0]).toMatch(/made by F0-types, which is not under Needs/);
  });

  it('says which lines of each file to read, in a form a program can follow', () => {
    const read = (item) => check(card({ 'Read first': item }));
    expect(read('- `docs/plan/patterns/form-definition.md`.')[0]).toMatch(/must say which lines/);
    // A small model cannot find a section in a long file, and a program cannot either.
    expect(read('- `docs/plan/patterns/form-definition.md`, section 3 (about 60 lines).')[0]).toMatch(
      /must say which lines: "lines 56-73" or ", all of it \(124 lines\)"/,
    );
    expect(read('- `services/api/src/auth/permissions.ts` lines 150-260.')[0]).toMatch(
      /has 200 lines, not 260/,
    );
    expect(read('- `services/api/src/auth/permissions.ts` lines 60-50.')[0]).toMatch(/is not a range/);
    expect(read('- `docs/plan/patterns/form-definition.md`, all of it (60 lines).')[0]).toMatch(
      /has 124 lines, the card says 60/,
    );
    expect(read('- Everything in the package (40 lines).')[0]).toMatch(/must start with a path in backticks/);
  });

  it('asks for at most 200 lines of reading, or 400 in the wider window', () => {
    const long = {
      'Read first':
        '- `docs/plan/patterns/form-definition.md`, all of it (124 lines).\n' +
        '- `services/api/src/auth/permissions.ts` lines 1-100.',
    };
    expect(check(card(long))[0]).toMatch(/Read first asks for 224 lines; the limit is 200/);
    expect(check(card(long, { header: 'Level: T. Window: 32,000. Needs: none.' }))).toEqual([]);
  });

  it('gives its commands in exactly one code block, which is what gets run', () => {
    const run = (Run) => check(card({ Run }));
    expect(run(`${F}\npnpm test\n${F}\n\n- The test run prints passed.`)).toEqual([]);
    expect(run(`${F}bash\npnpm test\n${F}`)).toEqual([]);
    const wrong = [
      'Run the tests and see.',
      `${F}sh\npnpm lint\n${F}\n\n${F}sh\npnpm test\n${F}`,
      `It prints:\n\n${F}\n0 problems\n${F}\n\n${F}sh\npnpm test\n${F}`,
      `1. Run:\n\n   ${F}sh\n   pnpm test\n   ${F}`,
      `${F}Shell\npnpm test\n${F}`,
      `${F}console\npnpm test\n${F}`,
    ];
    for (const Run of wrong) expect(run(Run)[0], Run).toMatch(/Run must hold exactly one code block/);
    expect(runScript(`${F}sh\r\nexport A=1\r\n(cd x && pnpm test)\r\n${F}\r\n\r\n- Prints passed.`)).toBe(
      'export A=1\n(cd x && pnpm test)',
    );
    expect(runScript('- Prints passed.')).toBeNull();
  });

  it('is checked for its shape only once it is marked Done', () => {
    const header = `${HEADER} Done.`;
    const moved = {
      'Read first': '- `docs/plan/patterns/form-definition.md` lines 100-260.',
      Files: '- `services/api/src/gone.ts`',
    };
    expect(check(card(moved))).toHaveLength(2);
    expect(check(card(moved, { header }))).toEqual([]);
    expect(check(card({ Steps: '' }, { header }))[0]).toMatch(/section "Steps" is empty/);
    // The commit that lands a card's work marks the card, or this check fails the build.
    const landed = repo({ ...LINES, 'packages/forms/definitions/note-types/psychological/v1.json': 150 });
    expect(check(card(), landed)[0]).toMatch(
      /v1\.json is there already: mark the card Done if its work has landed/,
    );
    expect(check(card({}, { header }), landed)).toEqual([]);
  });

  it('names only files of the repository, each by its one plain path', () => {
    const outside = [
      '../other/a.ts',
      '/etc/passwd',
      '~/notes.md',
      'docs/../../a.ts',
      'C:\\a.ts',
      'src\\a.ts',
      './tools/x.mjs',
      'services/api//src/sync/push.ts',
      'services/./api/src/sync/push.ts',
      'src/newdir/',
      '.git/config',
      '.git/hooks/pre-commit',
      'sub/.GIT/info/attributes',
    ];
    for (const path of outside) {
      expect(check(card({ Files: `- \`${path}\` (new)` })).join('\n'), path).toMatch(
        /must be a plain path inside the repository/,
      );
      expect(check(card({ 'Read first': `- \`${path}\` lines 1-5.` })).join('\n'), path).toMatch(
        /must be a plain path inside the repository/,
      );
    }
    for (const path of [
      'packages/forms/src/a..b.ts',
      '.gitignore',
      '.github-notes/a.md',
      'apps/portal/src/app/(app)/page.tsx',
    ])
      expect(check(card({ Files: `- \`${path}\` (new)` })), path).toEqual([]);
  });

  it('names no model, whatever follows the name', () => {
    expect(check(card({ Goal: 'Written for Qwen.' }))[0]).toMatch(/names a model/);
    for (const name of [
      'qwen2.5-coder:14b',
      'qwen3.6:35b-a3b',
      'gpt-4o',
      'llama3.1',
      'codellama',
      'mistral7b',
      'gemma3',
      'phi4',
    ])
      expect(namedModel(`A thing for ${name}.`), name).not.toBeNull();
    for (const text of [
      'The rules of `CLAUDE.md` apply.',
      'the .claude/worktrees folder',
      'branch claude/modest-feynman-1bz6ws',
      'Ollama, and `ollama ps`',
    ])
      expect(namedModel(text), text).toBeNull();
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
    expect(c.done).toBe(false);
    expect(c.sections.map((s) => s.name)).toEqual(SECTIONS);
    expect(parseCard(card({}, { header: 'Level: X. Window: 32,000. Needs: none.' })).needs).toEqual([]);
    const done = parseCard(card({}, { header: 'Level: X. Window: 32,000. Needs: none. Done.' }));
    expect(done.needs).toEqual([]);
    expect(done.done).toBe(true);
  });

  it('reads what to read: a line range or a whole file, who makes it, and why', () => {
    expect(readItem('`a.ts` lines 56-73: the rules.')).toEqual({
      path: 'a.ts',
      from: 56,
      to: 73,
      count: 18,
      madeBy: null,
      note: 'the rules.',
    });
    expect(readItem('`a.md` lines 837-965 (section 3.12): every signature.')).toMatchObject({
      from: 837,
      to: 965,
      count: 129,
      note: '(section 3.12): every signature.',
    });
    expect(readItem('`a.md`, all of it (124 lines).')).toEqual({
      path: 'a.md',
      from: 1,
      to: null,
      count: 124,
      madeBy: null,
      note: '',
    });
    expect(readItem('`a.ts`, all of it (about 60 lines) (made by L0-vectors): how they are called.')).toEqual(
      {
        path: 'a.ts',
        from: 1,
        to: null,
        count: 60,
        madeBy: 'L0-vectors',
        note: 'how they are called.',
      },
    );
    expect(readItem('`a.ts`').problem).toMatch(/must say which lines/);
    expect(readItem('The recipe.').problem).toMatch(/must start with a path/);
  });

  it('reads what to write: a new file, a whole file, a line range, or words about what commands write', () => {
    expect(fileItem('`a.ts` (new)')).toEqual({ kind: 'new', path: 'a.ts', madeBy: null, note: '' });
    expect(fileItem('`a.ts`: the registrations')).toEqual({
      kind: 'whole',
      path: 'a.ts',
      replace: false,
      madeBy: null,
      note: 'the registrations',
    });
    expect(fileItem('`a.ts` (made by F0-types)')).toMatchObject({
      kind: 'whole',
      madeBy: 'F0-types',
      note: '',
    });
    expect(fileItem('`a.ts` lines 99-109: the registrations')).toEqual({
      kind: 'region',
      path: 'a.ts',
      from: 99,
      to: 109,
      replace: false,
      madeBy: null,
      note: 'the registrations',
    });
    expect(fileItem('`a.ts` lines 99-109 (replace) (made by F0-types): the old handler')).toEqual({
      kind: 'region',
      path: 'a.ts',
      from: 99,
      to: 109,
      replace: true,
      madeBy: 'F0-types',
      note: 'the old handler',
    });
    expect(fileItem('`a.ts` (replace)')).toMatchObject({ kind: 'whole', replace: true });
    expect(fileItem('The generated files the export rewrites.')).toEqual({ kind: 'words' });
  });
});
