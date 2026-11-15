import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../card-check-rules.mjs';
import {
  applyParts,
  budget,
  buildPrompt,
  leftOut,
  NEW_FILE_TOKENS,
  parseReply,
  partProblems,
  planCard,
  trouble,
} from '../card-run-rules.mjs';

const FILE = 'docs/plan/phase-9-demo/cards/D1-add.md';
const lines = (n, word = 'line') => Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join('\n') + '\n';
const F = '```';

function card(overrides = {}, header = 'Level: T. Window: 16,000. Needs: none.') {
  const body = {
    Goal: 'The sum exists.',
    'Read first': '- `src/guide.md` lines 3-5: how sums are written.\n- `src/math.ts`, all of it (8 lines).',
    Files:
      '- `src/sum.ts` (new): the sum\n- `src/math.ts` lines 2-3\n- The lockfile, which the commands rewrite.',
    Steps: '1. Write `sum`.\n2. Call it from `math.ts`.',
    Tests: 'On the branch already: `test/sum.test.ts`.',
    Run: `${F}sh\npnpm test\npnpm lint\n${F}\n\n- The test run prints passed.`,
    Audit: '- The auditor reads the diff. SECRET-AUDIT-LINE',
    ...overrides,
  };
  return [
    '# Card D1-add: the sum',
    '',
    header,
    '',
    ...SECTIONS.flatMap((s) => [`## ${s}`, '', body[s], '']),
  ].join('\n');
}

const FILES = { 'src/guide.md': lines(12, 'guide'), 'src/math.ts': lines(8, 'math') };
const repo = (files = FILES, blocked = {}) => ({
  exists: (p) => p in files,
  lineCount: (p) => files[p].replace(/\n$/, '').split('\n').length,
  read: (p) => files[p],
  unreadable: (p) => blocked[p] ?? (p in files ? null : 'does not exist'),
  unwritable: (p) => blocked[p] ?? (p in files ? 'is there already' : null),
});
const plan = (text = card(), r = repo()) => planCard(FILE, text, r);

describe('what a card needs before a model is asked', () => {
  it('is the lines to read, the parts to write with what is there now, and the commands', () => {
    const p = plan();
    expect(p.problems).toEqual([]);
    expect(p.window).toBe(16384);
    expect(p.reading).toEqual([
      {
        path: 'src/guide.md',
        from: 3,
        to: 5,
        whole: false,
        note: 'how sums are written.',
        lines: ['guide 3', 'guide 4', 'guide 5'],
      },
      {
        path: 'src/math.ts',
        from: 1,
        to: 8,
        whole: true,
        note: '',
        lines: lines(8, 'math').trimEnd().split('\n'),
      },
    ]);
    expect(p.targets).toEqual([
      { n: 1, kind: 'new', path: 'src/sum.ts', note: 'the sum', replace: false, present: null },
      {
        n: 2,
        kind: 'region',
        path: 'src/math.ts',
        from: 2,
        to: 3,
        note: '',
        replace: false,
        present: ['math 2', 'math 3'],
      },
    ]);
    expect(p.commands).toBe('pnpm test\npnpm lint');
  });

  it('is refused for a card the check refuses, with the check’s own words', () => {
    expect(plan(card({ Steps: '' })).problems).toEqual(['the section "Steps" is empty']);
  });

  it('is refused for a card the frontier model writes, and for one that is done', () => {
    expect(plan(card({}, 'Level: X. Window: 16,000. Needs: none.')).problems).toEqual([
      'a level X card is written by the frontier model, not by the small one',
    ]);
    expect(plan(card({}, 'Level: T. Window: 16,000. Needs: none. Done.')).problems).toEqual([
      'the card is marked Done',
    ]);
  });

  it('is refused when a file may not be sent to a model, or a new file may not go where the card says', () => {
    const ignored = repo(FILES, {
      'src/guide.md': 'is ignored by git; a card names only files of the repository',
    });
    expect(plan(card(), ignored).problems).toEqual([
      'Read first: src/guide.md is ignored by git; a card names only files of the repository',
    ]);
    const link = repo(FILES, { 'src/math.ts': 'is a link; a card names the file itself' });
    expect(plan(card(), link).problems).toEqual([
      'Read first: src/math.ts is a link; a card names the file itself',
      'Files: src/math.ts is a link; a card names the file itself',
    ]);
    const dangling = repo(FILES, {
      'src/sum.ts': 'is there already: take away what an earlier attempt left',
    });
    expect(plan(card(), dangling).problems).toEqual([
      'Files: src/sum.ts is there already: take away what an earlier attempt left',
    ]);
    const fenced = repo({
      ...FILES,
      'src/math.ts': `math 1\n${F}\nmath 3\nmath 4\nmath 5\nmath 6\nmath 7\nmath 8\n`,
    });
    expect(plan(card(), fenced).problems[0]).toMatch(/src\/math\.ts has a line that is only a code fence/);
  });

  it('checks a file an earlier card made as the card check could not: its length, and the lines named in it', () => {
    const made = card(
      { Files: '- `src/long.ts` (made by D1-types)', 'Read first': '- `src/guide.md` lines 3-5.' },
      'Level: T. Window: 16,000. Needs: D1-types.',
    );
    expect(plan(made).problems).toEqual(['Files: src/long.ts does not exist']);
    const long = plan(made, repo({ ...FILES, 'src/long.ts': lines(260) }));
    expect(long.problems).toEqual(['Files asks for 260 lines to be written again; the limit is 200']);
    expect(plan(made, repo({ ...FILES, 'src/long.ts': lines(120) })).problems).toEqual([]);
    const ranges = card(
      {
        Files: '- `src/made.ts` lines 8-12 (made by D1-types)',
        'Read first': '- `src/made.ts` lines 1-30 (made by D1-types).',
      },
      'Level: T. Window: 16,000. Needs: D1-types.',
    );
    expect(plan(ranges, repo({ ...FILES, 'src/made.ts': lines(10) })).problems).toEqual([
      'Read first: src/made.ts has 10 lines, not 30',
      'Files: src/made.ts has 10 lines, not 12',
    ]);
  });

  it('may have no part at all, when the card is its commands', () => {
    const only = plan(
      card(
        { Files: '- The contract files, which the commands write.', 'Read first': 'Nothing.' },
        'Level: S. Window: 16,000. Needs: none.',
      ),
    );
    expect(only.problems).toEqual([]);
    expect(only.targets).toEqual([]);
    expect(only.reading).toEqual([]);
    expect(only.commands).toBe('pnpm test\npnpm lint');
  });
});

describe('what the model is sent', () => {
  const prompt = buildPrompt('The rules.\n', plan());

  it('is the rules, then the reading with line numbers, the parts as they are, the card, and the reply to give', () => {
    expect(prompt.system).toBe('The rules.');
    const order = [
      '# What the card tells you to read',
      '# What you change',
      '# The card',
      '# Your reply',
    ].map((h) => prompt.user.indexOf(h));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBe(0);
    expect(prompt.user).toContain(
      '## src/guide.md, lines 3-5\nhow sums are written.\n\n3: guide 3\n4: guide 4\n5: guide 5',
    );
    expect(prompt.user).toContain('## src/math.ts, all 8 lines\n\n1: math 1');
    expect(prompt.user).toContain(
      '## part 1: src/sum.ts (a new file)\nthe sum\nNothing is there yet. Write the whole file.',
    );
    expect(prompt.user).toContain(
      `## part 2: src/math.ts, lines 2-3\nThese 2 lines, as they are now:\n\n${F}\nmath 2\nmath 3\n${F}\n\nWrite what goes in their place: these lines with the card's changes made, every line, changed or not.`,
    );
    expect(
      prompt.user.endsWith(
        'each as its heading and one code block. Write nothing else.\n\n### part 1\n### part 2',
      ),
    ).toBe(true);
  });

  it('holds the goal, the steps and the tests of the card, and nothing meant for the auditor', () => {
    expect(prompt.user).toContain('## Card D1-add: the sum\n\n### Goal\n\nThe sum exists.');
    expect(prompt.user).toContain('### Steps\n\n1. Write `sum`.');
    expect(prompt.user).toContain('### Tests\n\nOn the branch already');
    expect(prompt.user).not.toContain('SECRET-AUDIT-LINE');
    expect(prompt.user).not.toContain('pnpm lint');
    expect(prompt.user).not.toContain('lockfile');
  });

  it('shows a whole file whole, in a fence its own lines cannot close, and says when the card replaces lines', () => {
    const doc = `/** Sample:\n * ${F}ts\n * sum(1, 2)\n * ${F}\n */\nexport const a = 1;\n  ${F}${F}ts\n`;
    const user = buildPrompt(
      'r',
      plan(card({ Files: '- `src/doc.ts`: the sample' }), repo({ ...FILES, 'src/doc.ts': doc })),
    ).user;
    expect(user).toContain(
      `## part 1: src/doc.ts (the whole file)\nthe sample\nThe file, 7 lines, as it is now:`,
    );
    // Seven backticks: one more than the six that start the file's last line.
    expect(user).toContain(`\n${F}${F}\`\n/** Sample:\n * ${F}ts`);
    expect(user).toContain("Write the whole file with the card's changes made: every line, changed or not.");
    const replaced = buildPrompt(
      'r',
      plan(card({ Files: '- `src/math.ts` lines 2-3 (replace): the old sum' })),
    ).user;
    expect(replaced).toContain('The card puts other lines in their place: write those.');
    expect(plan(card({ Files: '- `src/math.ts` lines 2-3 (replace)' })).targets[0].replace).toBe(true);
  });

  it('on a second attempt says what went wrong, and shows the lines as they were beside what was written', () => {
    const p = plan();
    const reply = buildPrompt('r', p, { trouble: 'TROUBLE', written: null }).user;
    expect(reply).toContain('# What went wrong last time\n\nTROUBLE\n\n# Your reply');
    expect(reply).toContain('Nothing is there yet. Write the whole file.');
    expect(reply).not.toContain('before your first attempt');
    const written = new Map([
      [1, ['export const sum = 1;']],
      [2, ['math two']],
    ]);
    const commands = buildPrompt('r', p, { trouble: 'TROUBLE', written }).user;
    expect(commands).toContain(
      `## part 1: src/sum.ts (a new file)\nthe sum\nYour first attempt wrote this. Write the file again, whole, with the fault put right.\n\n${F}\nexport const sum = 1;\n${F}`,
    );
    // What the first attempt dropped can only come back if the lines that were there are shown again.
    expect(commands).toContain(
      `These 2 lines, as they were before your first attempt:\n\n${F}\nmath 2\nmath 3\n${F}\n\nYour first attempt wrote this in their place:\n\n${F}\nmath two\n${F}\n\nWrite the part again from the lines that were there, with the fault put right.`,
    );
    expect(commands).toContain('## src/math.ts, all 8 lines (as it was before your first attempt)');
    expect(commands).toContain('## src/guide.md, lines 3-5\n');
  });

  it('leaves the reply room in the window, and no more room than the parts can need', () => {
    const parts = plan().targets.map((t) => ({ lines: t.present }));
    const small = budget(prompt, 16384, parts);
    expect(small.problems).toEqual([]);
    expect(small.high).toBe(Math.ceil((prompt.system.length + prompt.user.length) / 3));
    // One new file and two lines to write again: a model that loops is stopped long before the window is full.
    expect(small.numPredict).toBe(2 * Math.ceil('math 2\nmath 3'.length / 3) + NEW_FILE_TOKENS + 1024);
    expect(budget(prompt, 16384, [{ lines: ['a'] }]).numPredict).toBe(2048);
    const big = { system: 'r', user: 'x'.repeat(30_000) };
    expect(budget(big, 16384, parts).problems[0]).toMatch(
      /come to about 10001 tokens; a window of 16384 takes 9830/,
    );
    expect(budget(big, 32768, parts).problems).toEqual([]);
    const heavy = [{ lines: Array.from({ length: 200 }, () => 'y'.repeat(100)) }];
    const tight = budget({ system: 'r', user: 'x'.repeat(28_000) }, 16384, heavy);
    expect(tight.problems[0]).toMatch(/tokens to be written again leave no room in a reply/);
    expect(budget({ system: 'r', user: 'x'.repeat(9_000) }, 16384, heavy).numPredict).toBe(16384 - 3001 - 64);
  });
});

describe('the parts of a reply', () => {
  const targets = plan().targets;
  const parts = (text, t = targets) => parseReply(text, t);
  const two = (first, second = `### part 2\n${F}\nb\n${F}`) => parts(`${first}\n${second}`);

  it('are each a heading and the code block under it; the rest is passed over', () => {
    const r = parts(
      `Here are the parts.\n\n### part 1\n${F}ts\nexport const sum = (a, b) => a + b;\n${F}\n\nAnd the second:\n\n### part 2\n${F}\nmath two\n\nmath three\n${F}\nDone.`,
    );
    expect(r.problems).toEqual([]);
    expect(r.stopped).toBeNull();
    expect([...r.parts]).toEqual([
      [1, ['export const sum = (a, b) => a + b;']],
      [2, ['math two', '', 'math three']],
    ]);
  });

  it('are found under the headings a small model writes', () => {
    const forms = [
      '### part 1',
      '## Part 1: src/sum.ts (a new file)',
      '**part 1**',
      '**Part 1:** src/sum.ts',
      'part 1:',
      'Part 1 - src/sum.ts',
      '#### Part 1 — src/sum.ts',
      '#part 1',
      '### part1',
      '### part 1/2',
      'Part 1 of 2',
      '### part 1 `src/sum.ts`',
      '### part 1, src/sum.ts',
      '### Part 1 ###',
      '### part 1.',
      '1. part 1',
      '    ### part 1',
    ];
    for (const h of forms) {
      const r = two(`${h}\n${F}\na\n${F}`, `### part 2\n~~~\nb\n~~~`);
      expect(r.problems, h).toEqual([]);
      expect([...r.parts], h).toEqual([
        [1, ['a']],
        [2, ['b']],
      ]);
    }
    // A sentence that starts with the words is not a heading.
    for (const said of ['Part 1 creates the file.', 'Part 1 of 2 is done.', 'Part 1. The file is new.'])
      expect(two(`### part 1\n${F}\na\n${F}`, `### part 2\n${F}\nb\n${F}\n${said}`).problems, said).toEqual(
        [],
      );
  });

  it('are found under a fence that carries more than a language, and whatever stands between heading and block', () => {
    for (const info of [
      'ts',
      'typescript',
      'ts title=src/a.ts',
      'dart:lib/a.dart',
      'tsx filename="a.tsx"',
      'ts {1,3}',
      'ts // src/a.ts',
      'src/a.ts',
      'c++',
      ' ts',
    ])
      expect([...two(`### part 1\n${F}${info}\na\n${F}`).parts], info).toEqual([
        [1, ['a']],
        [2, ['b']],
      ]);
    const between = two(`### part 1\nHere is the updated file:\n\nsrc/sum.ts\n${F}ts\na\n${F}`);
    expect(between.problems).toEqual([]);
    expect(between.parts.get(1)).toEqual(['a']);
    // The prompt's own list of headings, said back before the answer.
    const echoed = parts(`### part 1\n### part 2\n\n### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb\n${F}`);
    expect(echoed.problems).toEqual([]);
    expect(echoed.parts.size).toBe(2);
  });

  it('lose the indentation of an indented block, and no other', () => {
    const r = two(`### part 1\n  ${F}yaml\n  jobs:\n    api:\n  ${F}`);
    expect(r.parts.get(1)).toEqual(['jobs:', '  api:']);
    const example = two(`    ### part 1\n    ${F}\n    every line of the part\n      indented\n    ${F}`);
    expect(example.parts.get(1)).toEqual(['every line of the part', '  indented']);
  });

  it('are read from a reply that is wrapped whole in one fence', () => {
    const inner = `### part 1\n${F}ts\na\n${F}\n### part 2\n${F}\nb\n${F}`;
    for (const wrapped of [
      `${F}markdown\n${inner}\n${F}`,
      `${F}markdown\n${inner}`,
      `${F}\n${inner}\n${F}\n`,
    ]) {
      const r = parts(wrapped);
      expect(r.problems, wrapped).toEqual([]);
      expect([...r.parts], wrapped).toEqual([
        [1, ['a']],
        [2, ['b']],
      ]);
    }
  });

  it('may be one block with no heading only when that block is all there is', () => {
    const one = [targets[0]];
    expect([...parts(`${F}ts\na\n${F}`, one).parts]).toEqual([[1, ['a']]]);
    expect([
      ...parts(`Here is the file:\n\n${F}ts title="src/sum.ts"\na\n${F}\nThat is all.`, one).parts,
    ]).toEqual([[1, ['a']]]);
    // An explanation with its own block after the code: which block is the part is not for a program to guess.
    expect(parts(`${F}ts\na\n${F}\n\nTo check it, run:\n\n${F}sh\npnpm test\n${F}`, one).problems).toEqual([
      'each part goes under its heading, "### part 1"',
      'part 1 is missing',
    ]);
    expect(parts(`${F}\na\n${F}\n${F}\nb\n${F}`).problems).toEqual([
      'each part goes under its heading, "### part 1"',
      'part 1 is missing',
      'part 2 is missing',
    ]);
    // A block, and only then the heading: whether the block is that part is not for a program to guess.
    expect(parts(`${F}ts\na\n${F}\n\n### part 1\n`, one).problems).toEqual([
      'each part goes under its heading, "### part 1"',
      'part 1 has no code block under its heading',
    ]);
    // A heading with nothing under it, then a bare block: the model began a part and did not write it.
    expect(parts(`### part 1\n\nI could not.\n`, one).problems).toEqual([
      'part 1 has no code block under its heading',
    ]);
  });

  it('keep a shorter fence that is part of the content, and are refused when a part’s own fence is closed from inside', () => {
    const longer = parts(`### part 1\n${F}${F}\nbefore\n${F}\nafter\n${F}${F}\n### part 2\n${F}\nb\n${F}`);
    expect(longer.problems).toEqual([]);
    expect(longer.parts.get(1)).toEqual(['before', F, 'after']);
    // A markdown file with a code block in it, fenced by the model with three backticks like its own block.
    const cut = parts(
      `### part 1\n${F}md\n# How\n\nRun:\n\n${F}\npnpm test\n${F}\n\nThen read the output.\n${F}\n### part 2\n${F}\nb\n${F}`,
    );
    expect(cut.problems).toEqual([
      'there is a code block outside the parts; if a part itself holds a line of ```, put four backticks around that part',
    ]);
    // The same with a language on the inner fence: its end closes the part, and the part's own end is left over.
    const tagged = parts(`### part 1\n${F}md\n# How\n${F}sh\npnpm test\n${F}\nThen read.\n${F}`, [
      targets[0],
    ]);
    expect(tagged.problems).toEqual([
      'there is a code block outside the parts; if a part itself holds a line of ```, put four backticks around that part',
    ]);
  });

  it('must be the parts asked for, each once, each with its block', () => {
    expect(parts(`### part 1\n${F}\na\n${F}`).problems).toEqual(['part 2 is missing']);
    expect(
      parts(`### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb\n${F}\n### part 3\n${F}\nc\n${F}`).problems,
    ).toEqual(['part 3 is not one of the parts asked for']);
    expect(
      parts(`### part 1\n${F}\na\n${F}\n### part 1\n${F}\nb\n${F}\n### part 2\n${F}\nc\n${F}`).problems,
    ).toEqual(['part 1 is written twice']);
    expect(parts(`### part 1\nexport const a = 1;\n### part 2\n${F}\nb\n${F}`).problems).toEqual([
      'part 1 has no code block under its heading',
    ]);
    expect(parts(`### part 1\n${F}\na\n${F}\n### part 2`).problems).toEqual([
      'part 2 has no code block under its heading',
    ]);
  });

  it('are refused when the reply was cut off inside one', () => {
    expect(parts(`### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb`).problems).toEqual([
      'the reply ends inside part 2: it was cut off',
    ]);
    expect(parts(`${F}ts\nconst a = 1;`, [targets[0]]).problems).toEqual([
      'the reply ends inside a code block: it was cut off',
      'part 1 is missing',
    ]);
  });

  it('are none when the model says it cannot do the card, however it writes that', () => {
    const said = 'step 2 names a function that is not in the lines I was given.';
    for (const stop of [
      `STOP: ${said}`,
      `**STOP:** ${said}`,
      `\`STOP:\` ${said}`,
      `- STOP: ${said}`,
      `### STOP: ${said}`,
      `STOP - ${said}`,
      `Stop: ${said}`,
      `> STOP: ${said}`,
    ]) {
      const r = parts(stop);
      expect(r.stopped, stop).toBe(said);
      expect(r.parts.size, stop).toBe(0);
    }
    expect(parts('  STOP:').stopped).toBe('no reason given');
    // The model quoted the line it objects to, or put its STOP in a block: neither is a part.
    const one = [targets[0]];
    expect(
      parts(`STOP: line 3 is not as the card says. It is:\n\n${F}ts\nexport const n3 = 3;\n${F}`, one),
    ).toEqual({
      parts: new Map(),
      problems: [],
      stopped: 'line 3 is not as the card says. It is:',
    });
    expect(parts(`${F}\nSTOP: the step is unclear: which file?\n${F}`, one).stopped).toBe(
      'the step is unclear: which file?',
    );
    // A model that wrote the parts and then says it guessed has not done the card.
    const guessed = parts(
      `### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb\n${F}\n\nSTOP: I guessed at step 2.`,
    );
    expect(guessed.stopped).toBe('I guessed at step 2.');
    expect(guessed.parts.size).toBe(0);
    // Inside a part, the word is content.
    const inside = parts(
      `### part 1\n${F}\n// STOP: do not go on\nSTOP: a label\nconst a = 1;\n${F}\n### part 2\n${F}\nb\n${F}`,
    );
    expect(inside.stopped).toBeNull();
    expect(inside.parts.size).toBe(2);
  });

  it('are read after any thinking the model wrote first, with either line ending, and after a mark at the start', () => {
    const r = parts(
      `\uFEFF<think>\n### part 1\n${F}\nwrong\n${F}\n</think>\n### part 1\r\n${F}\r\na\r\n${F}\r\n### part 2\r\n${F}\r\nb\r\n${F}\r\n`,
    );
    expect(r.problems).toEqual([]);
    expect(r.parts.get(1)).toEqual(['a']);
  });
});

describe('a part that would damage the file', () => {
  const whole = Array.from({ length: 40 }, (_, i) => `const b${i} = ${i};`);
  const target = (over = {}) => ({
    n: 1,
    kind: 'new',
    path: 'src/a.ts',
    replace: false,
    present: null,
    ...over,
  });
  const problems = (content, t = target(), reading = []) =>
    partProblems({ reading, targets: [t] }, new Map([[t.n, content]]));

  it('is one that leaves lines out with a note in their place', () => {
    const lazy = [
      '// ... existing code ...',
      '  // ... rest of the file',
      '/* ... */',
      '# ... remaining cases',
      '  ...',
      '…',
      '  . . .',
      '[...]',
      '  ... existing code ...',
      '  ... (rest of file)',
      '/// ...',
      '<!-- ... -->',
      '-- ... more columns',
      'export function signoffEffect(note: Note): Effect { /* ... */ }',
      'export function signoffEffect(note: Note): Effect { ... }',
      'export function reopenEffect(note: Note): Effect { /* unchanged */ }',
      '      {/* ... */}',
      '      {/* existing fields */}',
      'const x = 1; // ... rest unchanged',
      '// ... the writes the card gives ...',
    ];
    for (const line of lazy)
      expect(problems(['const a = 1;', line]), line).toEqual([
        `part 1 leaves content out at its line 2 ("${line.trim().slice(0, 60)}"); write every line`,
      ]);
    // Where lines were given to write again, a short comment that stands for them is taken for what it is.
    const given = target({ kind: 'region', from: 5, to: 6, present: ['const a = 1;', 'const b = 2;'] });
    const words = [
      '// rest of the file unchanged',
      '// Other methods remain unchanged',
      '-- same as before',
      '// implementation goes here',
      '/* existing imports */',
      '# (other tests omitted)',
      '// Add remaining fields here',
      '// Same as above for the other cases',
      '// (the rest remains the same)',
      '// no changes below this line',
      '// existing logic',
      '-- (rest of the migration as above)',
      '// lines 12-40 as they were',
      '// truncated for brevity',
      '// Keep the existing checks',
      '}  // rest of the class unchanged',
    ];
    for (const line of words) {
      expect(problems(['const a = 1;', line], given), line).toHaveLength(1);
      expect(problems(['const a = 1;', line]), `${line} in a new file`).toEqual([]);
    }
  });

  it('is not one whose line is code or an honest comment, or was in the part’s own place already', () => {
    const fine = [
      'const { a, ...rest } = props;',
      '  ...rest,',
      '  ...defaults,',
      '      ..add(item)',
      '      ...?extra,',
      "    return '...';",
      'const unchanged = before === after;',
      'return [...existing, next];',
      "const label = 'the rest of the file';",
      '  // Rows the caller may not see are left unchanged.',
      '  // The other fields are copied as they are.',
      '  // A key that is omitted keeps its stored value.',
      '  // 409: the status code here means a newer version exists.',
      '  // Existing tests cover the happy path; this one covers the refusal.',
      '  // ...and the audit event is written in the same transaction.',
      '  // … so a rejected change is never dropped.',
      '  // Same as above, but for a note that is signed.',
      '-- Additive: existing rows are unchanged.',
      '# The rest of the file is read by ci-local.sh.',
      '  // REST handler for notes',
      'catch { /* ignore */ }',
    ];
    const given = target({ kind: 'region', from: 5, to: 6, present: ['const a = 1;', 'const b = 2;'] });
    for (const line of fine) expect(problems(['const a = 1;', line], given), line).toEqual([]);
    // A placeholder that was already in the lines to write again is the file's own; one copied from a recipe is not.
    const own = target({ kind: 'whole', present: ['const a = 1;', '  // ... kept on purpose'] });
    expect(problems(['const a = 2;', '  // ... kept on purpose'], own)).toEqual([]);
    const recipe = [
      {
        path: 'docs/plan/patterns/api-route.md',
        from: 61,
        lines: ['    // ... the writes the card gives ...'],
      },
    ];
    expect(
      problems(['const a = 1;', '    // ... the writes the card gives ...'], target(), recipe),
    ).toHaveLength(1);
    // In a document, a line of dots or a heading "Other fields" is writing.
    expect(problems(['# How', '...', '## Other fields'], target({ path: 'docs/how.md' }))).toEqual([]);
    expect(leftOut('// existing logic', false)).toBe(false);
    expect(leftOut('// existing logic', true)).toBe(true);
  });

  it('is one that brings back too few of the lines it was given, unless the card replaces them', () => {
    const file = target({ kind: 'whole', present: whole });
    expect(problems(['const b3 = 33;'], file)).toEqual([
      'part 1 brings back 0 of the 40 lines that were there; write every line of the part, changed or not',
    ]);
    expect(problems(whole.slice(0, 21), file)).toEqual([
      'part 1 brings back 21 of the 40 lines that were there; write every line of the part, changed or not',
    ]);
    // A real change: a few lines altered, the rest brought back.
    expect(
      problems(
        whole.map((l, i) => (i % 4 === 0 ? `${l} // changed` : l)),
        file,
      ),
    ).toEqual([]);
    expect(problems(['const b3 = 33;'], { ...file, replace: true })).toEqual([]);
    // A short range is the card's to change whole.
    expect(
      problems(['const z = 0;'], target({ kind: 'region', from: 1, to: 8, present: whole.slice(0, 8) })),
    ).toEqual([]);
  });

  it('is one that is a diff, or search-and-replace marks, in place of the lines', () => {
    const file = target({ kind: 'region', from: 3, to: 3, present: ['export const n3 = 3;'] });
    expect(problems(['-export const n3 = 3;', '+export const n3 = 33;'], file)).toEqual([
      'part 1 is a diff; write the lines themselves, every one',
    ]);
    expect(problems(['@@ -3,1 +3,1 @@', ' export const n2 = 2;'], file)).toHaveLength(1);
    expect(problems(['<<<<<<< SEARCH', 'a', '=======', 'b', '>>>>>>> REPLACE'], file)).toHaveLength(1);
    // Lists and comments that start with a dash are not one.
    expect(
      problems(['- name: api', '- name: portal', '  run: pnpm test'], target({ path: 'ci.yaml' })),
    ).toEqual([]);
    expect(problems(['-- a comment', '-- another', 'select 1;'], target({ path: 'a.sql' }))).toEqual([]);
  });

  it('is one that is empty, that carries line numbers, or that holds a part’s heading', () => {
    expect(problems(['', '  '])).toEqual(['part 1 is empty']);
    const numbers = 'part 1 has line numbers at the start of its lines; the numbers are not part of the file';
    for (const content of [
      ['12: const a = 1;', '13: const b = 2;', '14: const c = 3;'],
      ['3:a', '4:b', '5:c'],
      ['  3 | a', '  4 | b', '  5 | c'],
      ['    12\tconst a = 1;', '    13\tconst b = 2;'],
      ['3: a', '4: b', 'c', 'd', 'e'],
    ])
      expect(problems(content), content[0]).toEqual([numbers]);
    // One line of a range, with the range's own number in front.
    const range = target({ kind: 'region', from: 3, to: 3, present: ['export const three = 3;'] });
    expect(problems(['3: export const three = 3;'], range)).toEqual([numbers]);
    // A line copied from the reading with its number.
    const reading = [{ path: 'src/guide.md', from: 12, lines: ['const b = 2;'] }];
    expect(problems(['const a = 1;', '12: const b = 2;'], target(), reading)).toEqual([numbers]);
    // Keys of a map are not line numbers, even when they count up.
    expect(problems(['const m = {', '  1: "one",', '  2: "two",', '};'])).toEqual([]);
    expect(problems(["  400: 'Bad request',", "  404: 'Not found',", "  409: 'Conflict',"])).toEqual([]);
    expect(
      problems(['export const PAIN = {', "  0: 'none',", "  1: 'mild',", "  2: 'moderate',", '};']),
    ).toEqual([]);
    expect(problems(['const a = 1;', '### part 2', 'const b = 2;'])[0]).toMatch(
      /holds a line that is a part's heading/,
    );
  });
});

describe('writing the parts', () => {
  it('gives a new file and a whole file their part, with one newline at the end', () => {
    const targets = [
      { n: 1, kind: 'new', path: 'a.ts' },
      { n: 2, kind: 'whole', path: 'b.ts', from: 1, to: 3 },
    ];
    const out = applyParts(
      new Map([
        ['a.ts', null],
        ['b.ts', 'old 1\nold 2\nold 3\n'],
      ]),
      targets,
      new Map([
        [1, ['const a = 1;', '', '']],
        [2, ['', 'new 1', '  ']],
      ]),
    );
    expect([...out]).toEqual([
      ['a.ts', 'const a = 1;\n'],
      ['b.ts', '\nnew 1\n'],
    ]);
  });

  it('puts line ranges of one file in from the bottom up, and touches no other line', () => {
    const targets = [
      { n: 1, kind: 'region', path: 'c.ts', from: 2, to: 3 },
      { n: 2, kind: 'region', path: 'c.ts', from: 6, to: 6 },
    ];
    const out = applyParts(
      new Map([['c.ts', lines(8, 'c')]]),
      targets,
      new Map([
        [1, ['two', 'two and a half', 'three', 'three and a half']],
        [2, ['six', '']],
      ]),
    );
    expect(out.get('c.ts')).toBe(
      'c 1\ntwo\ntwo and a half\nthree\nthree and a half\nc 4\nc 5\nsix\nc 7\nc 8\n',
    );
  });

  it('leaves a file its line ending, its last newline or the lack of one, and the blank line a range ended with', () => {
    const one = (file, from, to, part) =>
      applyParts(
        new Map([['c', file]]),
        [{ n: 1, kind: 'region', path: 'c', from, to }],
        new Map([[1, part]]),
      ).get('c');
    expect(one('a\nb\n\nc\n', 1, 3, ['a', 'B'])).toBe('a\nB\n\nc\n');
    expect(one('a\r\nb\r\nc\r\n', 1, 1, ['A'])).toBe('A\r\nb\r\nc\r\n');
    expect(one('a\nb\nc', 1, 1, ['A'])).toBe('A\nb\nc');
    expect(one('a\nb\nc\n', 3, 3, ['C', 'D', ''])).toBe('a\nb\nC\nD\n');
  });
});

describe('what a second attempt is told', () => {
  it('is what was wrong with the reply, or the end of what the commands printed', () => {
    expect(trouble('reply', ['part 2 is missing', 'part 1 is empty'])).toBe(
      'Your last reply could not be used:\n- part 2 is missing\n- part 1 is empty\n\nReply again: each part under its heading, in one code block, with every line of the part.',
    );
    const t = trouble('commands', lines(200, 'out'));
    expect(t).toContain('They failed. The end of their output:');
    expect(t).toContain('out 141\n');
    expect(t).not.toContain('out 140\n');
    expect(t).toContain('out 200');
  });
});

describe('the rules the model is sent', () => {
  const read = (name) => readFileSync(new URL(`../../docs/plan/${name}`, import.meta.url), 'utf8');
  const work = (text) => /## The work\n([\s\S]*?)\n## /.exec(text)[1];

  it('say the same about the work whether a program or an agent tool drives the model', () => {
    expect(work(read('implementer-rules.md'))).toBe(work(read('implementer-rules-agent.md')));
  });

  it('are short, and show the reply and the stop as the parser reads them', () => {
    const rules = read('implementer-rules.md');
    expect(rules.split('\n').length).toBeLessThanOrEqual(45);
    const shown = rules.split('\n').filter((l) => l.startsWith('    '));
    const reply = parseReply(shown.filter((l) => !l.includes('STOP')).join('\n'), [{ n: 1 }]);
    expect(reply.problems).toEqual([]);
    expect(reply.parts.get(1)).toEqual(['every line of the part']);
    const stop = shown.find((l) => l.includes('STOP'));
    expect(parseReply(stop, [{ n: 1 }]).stopped).toMatch(/^step 2 names/);
  });
});
