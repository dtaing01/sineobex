import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '../card-check-rules.mjs';
import {
  applyParts,
  budget,
  buildPrompt,
  parseReply,
  partProblems,
  planCard,
  runScript,
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
      { n: 1, kind: 'new', path: 'src/sum.ts', note: 'the sum', present: null },
      { n: 2, kind: 'region', path: 'src/math.ts', from: 2, to: 3, note: '', present: ['math 2', 'math 3'] },
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

  it('is refused when a file may not be sent to a model, or is not as the card says', () => {
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
    const fenced = repo({
      ...FILES,
      'src/math.ts': `math 1\n${F}\nmath 3\nmath 4\nmath 5\nmath 6\nmath 7\nmath 8\n`,
    });
    expect(plan(card(), fenced).problems[0]).toMatch(/src\/math\.ts has a line that is only a code fence/);
    expect(plan(card({ Run: 'Run the tests.' })).problems).toEqual(['Run has no code block of commands']);
  });

  it('counts a file an earlier card made toward what is written again, which the check could not', () => {
    const made = card(
      { Files: '- `src/long.ts` (made by D1-types)', 'Read first': '- `src/guide.md` lines 3-5.' },
      'Level: T. Window: 16,000. Needs: D1-types.',
    );
    const missing = plan(made);
    expect(missing.problems).toEqual(['Files: src/long.ts does not exist']);
    const long = plan(made, repo({ ...FILES, 'src/long.ts': lines(260) }));
    expect(long.problems).toEqual(['Files asks for 260 lines to be written again; the limit is 200']);
    expect(plan(made, repo({ ...FILES, 'src/long.ts': lines(120) })).problems).toEqual([]);
  });

  it('takes the commands from the first code block under Run', () => {
    expect(
      runScript(`${F}sh\nexport A=1\n(cd x && pnpm test)\n${F}\n\n- Prints passed.\n\n${F}\nrm -rf /\n${F}`),
    ).toBe('export A=1\n(cd x && pnpm test)');
    expect(runScript('- Prints passed.')).toBeNull();
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
    expect(prompt.user).toContain(`## part 2: src/math.ts, lines 2-3\nThese 2 lines are there now.`);
    expect(prompt.user).toContain(`${F}\nmath 2\nmath 3\n${F}`);
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

  it('shows a whole file whole, in a fence its own lines cannot close', () => {
    const files = {
      ...FILES,
      'src/doc.ts': `/** Sample:\n * ${F}ts\n * sum(1, 2)\n * ${F}\n */\nexport const a = 1;\n  ${F}${F}\n`,
    };
    const whole = plan(card({ Files: '- `src/doc.ts`: the sample' }), repo(files));
    expect(whole.problems[0]).toMatch(/only a code fence/);
    const safe = {
      ...FILES,
      'src/doc.ts': `/** Sample:\n * ${F}ts\n * sum(1, 2)\n * ${F}\n */\nexport const a = 1;\n`,
    };
    const user = buildPrompt('r', plan(card({ Files: '- `src/doc.ts`: the sample' }), repo(safe))).user;
    expect(user).toContain(
      `## part 1: src/doc.ts (the whole file)\nthe sample\nThe file is there now, 6 lines.`,
    );
    expect(user).toContain(`${F}\n/** Sample:\n * ${F}ts`);
  });

  it('says what went wrong on a second attempt, and shows the first attempt where it was written', () => {
    const p = plan();
    const reply = buildPrompt('r', p, { trouble: 'TROUBLE', written: null }).user;
    expect(reply).toContain('# What went wrong last time\n\nTROUBLE\n\n# Your reply');
    expect(reply).toContain('Nothing is there yet. Write the whole file.');
    const written = new Map([
      [1, ['export const sum = 1;']],
      [2, ['math two', 'math three']],
    ]);
    const commands = buildPrompt('r', p, { trouble: 'TROUBLE', written }).user;
    expect(commands).toContain(
      `## part 1: src/sum.ts (a new file)\nthe sum\nYour first attempt wrote this. Write the part again, whole, with the fault put right.\n\n${F}\nexport const sum = 1;\n${F}`,
    );
    expect(commands).toContain(`${F}\nmath two\nmath three\n${F}`);
    expect(commands).not.toContain(`${F}\nmath 2\nmath 3\n${F}`);
  });

  it('leaves the reply room in the window', () => {
    const p = plan();
    const small = budget(prompt, 16384, p.targets);
    expect(small.problems).toEqual([]);
    expect(small.high).toBe(Math.ceil((prompt.system.length + prompt.user.length) / 3));
    expect(small.numPredict).toBe(16384 - small.high - 64);
    const big = { system: 'r', user: 'x'.repeat(30_000) };
    expect(budget(big, 16384, p.targets).problems[0]).toMatch(
      /come to about 10001 tokens; a window of 16384 takes 9830/,
    );
    expect(budget(big, 32768, p.targets).problems).toEqual([]);
    const heavy = [{ present: Array.from({ length: 200 }, () => 'y'.repeat(100)) }];
    expect(budget({ system: 'r', user: 'x'.repeat(28_000) }, 16384, heavy).problems[0]).toMatch(
      /tokens to be written again leave no room in a reply/,
    );
  });
});

describe('the parts of a reply', () => {
  const targets = plan().targets;
  const parts = (text, t = targets) => parseReply(text, t);

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
      'part 1:',
      'Part 1 - src/sum.ts',
      '#part 1',
    ];
    for (const h of forms) {
      const r = parts(`${h}\n${F}\na\n${F}\n### part 2\n~~~\nb\n~~~`);
      expect(r.problems, h).toEqual([]);
      expect([...r.parts], h).toEqual([
        [1, ['a']],
        [2, ['b']],
      ]);
    }
    // A sentence that starts with the words is not a heading.
    expect(
      parts(`### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb\n${F}\nPart 1 creates the file.`).problems,
    ).toEqual([]);
  });

  it('may be one block with no heading when the card has one part', () => {
    const one = [targets[0]];
    expect([...parts(`${F}ts\na\n${F}`, one).parts]).toEqual([[1, ['a']]]);
    expect(parts(`${F}\na\n${F}\n${F}\nb\n${F}`).problems).toEqual([
      'part 1 is missing',
      'part 2 is missing',
      'each part goes under its heading, "### part 1"',
    ]);
  });

  it('keep a shorter fence that is part of the content', () => {
    const r = parts(`### part 1\n${F}${F}\nbefore\n${F}\nafter\n${F}${F}\n### part 2\n${F}\nb\n${F}`);
    expect(r.problems).toEqual([]);
    expect(r.parts.get(1)).toEqual(['before', F, 'after']);
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
      'part 1 has no code block',
      'part 1 is missing',
    ]);
    expect(parts(`### part 1\n${F}\na\n${F}\n### part 2`).problems).toEqual([
      'part 2 has no code block',
      'part 2 is missing',
    ]);
  });

  it('are refused when the reply was cut off inside one', () => {
    expect(parts(`### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb`).problems).toEqual([
      'the reply ends inside part 2: it was cut off',
      'part 2 is missing',
    ]);
  });

  it('are none when the model says it cannot do the card', () => {
    const r = parts('STOP: step 2 names a function that is not in the lines I was given.');
    expect(r.stopped).toBe('step 2 names a function that is not in the lines I was given.');
    expect(r.parts.size).toBe(0);
    expect(parts('  STOP:').stopped).toBe('no reason given');
    // A part wins over a STOP: the model did the work.
    const both = parts(`STOP: unsure\n### part 1\n${F}\na\n${F}\n### part 2\n${F}\nb\n${F}`);
    expect(both.stopped).toBeNull();
    expect(both.parts.size).toBe(2);
  });

  it('are read after any thinking the model wrote first, and with either line ending', () => {
    const r = parts(
      `<think>\n### part 1\n${F}\nwrong\n${F}\n</think>\n### part 1\r\n${F}\r\na\r\n${F}\r\n### part 2\r\n${F}\r\nb\r\n${F}\r\n`,
    );
    expect(r.problems).toEqual([]);
    expect(r.parts.get(1)).toEqual(['a']);
  });
});

describe('a part that would damage the file', () => {
  const targets = [
    { n: 1, kind: 'new', path: 'a.ts', present: null },
    { n: 2, kind: 'whole', path: 'b.ts', present: Array.from({ length: 40 }, (_, i) => `b ${i}`) },
  ];
  const given = '1: // ... kept from the recipe\nb 0\n  // the row is unchanged when the answer is the same';
  const problems = (one, two = targets[1].present) =>
    partProblems(
      targets,
      new Map([
        [1, one],
        [2, two],
      ]),
      given,
    );

  it('is one that leaves lines out with a note in their place', () => {
    const lazy = [
      '// ... existing code ...',
      '  // ... rest of the file',
      '// rest of the file unchanged',
      '/* ... */',
      '# ... remaining cases',
      '  ...',
      '…',
      '// Other methods remain unchanged',
      '-- same as before',
      '// implementation goes here',
      '<!-- existing content -->',
    ];
    for (const line of lazy) {
      expect(problems(['const a = 1;', line]).problems, line).toEqual([
        `part 1 leaves content out at its line 2 ("${line.trim()}"); write every line`,
      ]);
    }
  });

  it('is not one whose line is code, or was given to the model', () => {
    const fine = [
      'const { a, ...rest } = props;',
      '  ...rest,',
      '  ...defaults,',
      'const unchanged = before === after;',
      'return [...existing, next];',
      '// ... kept from the recipe',
      '// the row is unchanged when the answer is the same',
      "const label = 'the rest of the file';",
    ];
    for (const line of fine) expect(problems(['const a = 1;', line]).problems, line).toEqual([]);
  });

  it('is one that is empty, or that carries the line numbers of what was read', () => {
    expect(problems(['', '  ']).problems).toEqual(['part 1 is empty']);
    expect(problems(['12: const a = 1;', '13: const b = 2;', '14: const c = 3;']).problems).toEqual([
      'part 1 has line numbers at the start of its lines; the numbers are not part of the file',
    ]);
    expect(
      problems(['const m = {', '  1: "one",', '  2: "two",', '};', 'export default m;']).problems,
    ).toEqual([]);
  });

  it('is pointed out, not refused, when a file comes back at less than half its length', () => {
    const r = problems(['const a = 1;'], targets[1].present.slice(0, 12));
    expect(r.problems).toEqual([]);
    expect(r.warnings).toEqual(['part 2 (b.ts) went from 40 lines to 12: check that nothing was dropped']);
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
});

describe('what a second attempt is told', () => {
  it('is what was wrong with the reply, or the end of what the commands printed', () => {
    expect(trouble('reply', ['part 2 is missing', 'part 1 is empty'])).toBe(
      'Your last reply could not be used:\n- part 2 is missing\n- part 1 is empty\n\nReply again, with every part whole.',
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

  it('are short, and show the reply the parser reads', () => {
    const rules = read('implementer-rules.md');
    expect(rules.split('\n').length).toBeLessThanOrEqual(40);
    const example = rules
      .split('\n')
      .filter((l) => l.startsWith('    '))
      .map((l) => l.slice(4))
      .join('\n');
    expect(parseReply(example, [{ n: 1 }]).parts.get(1)).toEqual(['every line of the part']);
    expect(parseReply('STOP: the step is unclear', [{ n: 1 }]).stopped).toBe('the step is unclear');
  });
});
