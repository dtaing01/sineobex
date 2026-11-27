#!/usr/bin/env node
// The card driver: runs one task card with a small local model that cannot call tools
// (docs/plan/README.md, "Running a card"). It sends the model the rules, the card, the lines the
// card says to read and the present content of what the card changes; writes the parts of the
// reply to the files the card names, and to no other; runs the card's commands, and no other; and
// gives the model one more try with what went wrong. It commits nothing unless asked, and then only
// on a work branch: what it leaves is for the audit.
//
//   CARD_MODEL=<the runner's name for the model> node tools/card-run.mjs <card.md>
//
// Exit: 0 the commands passed; 1 they did not, or the reply could not be used; 2 the card was not
// run (the card, the checkout or the window is not fit for it); 3 the model said it could not do
// the card; 4 the runner did not answer as asked; 5 the driver itself failed; 130 interrupted.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  applyParts,
  budget,
  buildPrompt,
  parseReply,
  partProblems,
  planCard,
  splitLines,
  trouble,
} from './card-run-rules.mjs';

const RULES = 'docs/plan/implementer-rules.md';
const RECORDS = '.card-runs';
// The first runner release that can be told to refuse a prompt longer than the window ("truncate",
// "shift") and that says which window it loaded (/api/ps). An older one cuts the prompt and says nothing.
const RUNNER_FROM = [0, 12, 6];
const USAGE = `Usage: node tools/card-run.mjs <card.md> [options]

  --model <name>          the runner's name for the model (or CARD_MODEL)
  --url <url>             the runner (or CARD_RUNNER_URL, OLLAMA_HOST; default http://127.0.0.1:11434)
  --window <tokens>       the window to ask for, in place of the card's
  --attempts <n>          how many times the model is asked (default 2)
  --temperature <t>       default 0.2
  --seed <n>              default 1; a second attempt uses the next
  --think                 let a thinking model think (default: asked not to)
  --keep-alive <time>     how long the runner keeps the model loaded (default 10m; 0 frees memory for the commands)
  --runner-timeout <m>    minutes the runner may send nothing before the run gives up (default 30)
  --command-timeout <m>   minutes the card's commands may take (default 30)
  --dry-run               build the prompt, say what it comes to, ask nothing
  --no-first-run          level T: do not run the commands first to see them fail
  --ranges-checked        the planner checked the card's line ranges after the files changed
  --commit                commit what the run leaves, on a work/ branch only
  --allow-remote          the model runs on another machine: send it the card, its reading and,
                          on a second attempt, the end of what the commands printed`;

class Refused extends Error {}
class RunnerError extends Error {}

function parseArgs(argv) {
  const args = {
    attempts: 2,
    temperature: 0.2,
    seed: 1,
    keepAlive: '10m',
    commandTimeout: 30,
    runnerTimeout: 30,
  };
  const flags = {
    '--think': 'think',
    '--dry-run': 'dryRun',
    '--no-first-run': 'noFirstRun',
    '--ranges-checked': 'rangesChecked',
    '--commit': 'commit',
    '--allow-remote': 'allowRemote',
    '--help': 'help',
  };
  const values = { '--model': 'model', '--url': 'url', '--keep-alive': 'keepAlive' };
  const whole = { '--window': 'window', '--attempts': 'attempts', '--seed': 'seed' };
  const numbers = {
    '--temperature': 'temperature',
    '--command-timeout': 'commandTimeout',
    '--runner-timeout': 'runnerTimeout',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in flags) args[flags[a]] = true;
    else if (a in values || a in whole || a in numbers) {
      const v = argv[++i];
      if (v === undefined) throw new Refused(`${a} needs a value`);
      if (a in whole && !/^\d+$/.test(v)) throw new Refused(`${a} needs a whole number`);
      if (a in numbers && !(Number(v) >= 0)) throw new Refused(`${a} needs a number`);
      args[values[a] ?? whole[a] ?? numbers[a]] = a in values ? v : Number(v);
    } else if (a.startsWith('--')) throw new Refused(`unknown option ${a}`);
    else if (args.card) throw new Refused('one card at a time');
    else args.card = a;
  }
  if (args.attempts < 1) throw new Refused('--attempts needs 1 or more');
  if (args.window !== undefined && args.window < 1024) throw new Refused('--window needs 1024 or more');
  if (args.commandTimeout <= 0 || args.runnerTimeout <= 0)
    throw new Refused('a timeout needs more than 0 minutes');
  // The runner reads a bare number as seconds and a string as a time with its unit ("10m").
  if (/^-?\d+$/.test(args.keepAlive)) args.keepAlive = Number(args.keepAlive);
  else if (!/^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(args.keepAlive))
    throw new Refused('--keep-alive needs seconds (300) or a time (10m)');
  return args;
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const gitStatus = (args) => spawnSync('git', args, { stdio: 'ignore' }).status;

/** The runner's address, as the runner's own tools read it: no scheme means http, no port means 11434. */
function runnerUrl(args) {
  const given =
    args.url || process.env.CARD_RUNNER_URL || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(given) ? given : `http://${given.replace(/^:/, '127.0.0.1:')}`);
  } catch {
    throw new Refused(`"${given}" is not the address of a runner`);
  }
  if (!/^https?:\/\//i.test(given) && url.port === '') url.port = '11434';
  // The address a runner is told to listen on everywhere is, for one that calls it, this machine.
  if (['0.0.0.0', '[::]'].includes(url.hostname)) url.hostname = '127.0.0.1';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !args.allowRemote)
    throw new Refused(
      `the runner at ${url.host} is not on this machine: the card, the repository lines it names and, on a second attempt, the end of what the commands printed would be sent there. Pass --allow-remote if that is meant.`,
    );
  return url;
}

/** A request to the runner. It goes straight there: never through a proxy named in the environment. */
function ask(url, path, { method = 'GET', body = null, minutes = 0.25 } = {}, onLine = null) {
  return new Promise((done, fail) => {
    const target = new URL(path, url);
    const lib = target.protocol === 'https:' ? https : http;
    const payload = body === null ? null : JSON.stringify(body);
    const headers =
      payload === null
        ? {}
        : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
    const req = lib.request(target, { method, headers, agent: new lib.Agent() }, (res) => {
      let pending = '';
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (!onLine) return void (text += chunk);
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) onLine(line, req);
      });
      res.on('error', (e) =>
        fail(
          e instanceof RunnerError
            ? e
            : new RunnerError(`the answer from the runner broke off (${e.message})`),
        ),
      );
      res.on('end', () => {
        if (onLine && pending.trim() !== '') onLine(pending, req);
        done({ status: res.statusCode, location: res.headers.location ?? null, text });
      });
    });
    req.setTimeout(minutes * 60_000, () =>
      req.destroy(new RunnerError(`the runner at ${target.origin} sent nothing for ${minutes} minutes`)),
    );
    req.on('error', (e) =>
      fail(
        e instanceof RunnerError
          ? e
          : new RunnerError(
              `no answer from the model runner at ${target.origin} (${e.code ?? e.message}). Is it running?`,
            ),
      ),
    );
    req.end(payload ?? undefined);
  });
}

const object = (text) => {
  try {
    const o = JSON.parse(text);
    return o !== null && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
};
const errorText = (o) =>
  typeof o.error === 'string' ? o.error : (o.error?.message ?? JSON.stringify(o.error));

/** Refuses a runner that would cut a prompt without a word, or that would pass the prompt on to another machine. */
async function checkRunner(url, model, allowRemote) {
  const version = object((await ask(url, 'api/version')).text)?.version;
  const parts = /^(\d+)\.(\d+)\.(\d+)/
    .exec(version ?? '')
    ?.slice(1)
    .map(Number);
  const differs = parts?.findIndex((n, i) => n !== RUNNER_FROM[i]) ?? -1;
  if (!parts || (differs >= 0 && parts[differs] < RUNNER_FROM[differs]))
    throw new RunnerError(
      `the runner says it is version ${version ?? 'unknown'}; the driver needs ${RUNNER_FROM.join('.')} or later, which refuses a prompt longer than the window instead of cutting it`,
    );
  if (allowRemote) return;
  const shown = object((await ask(url, 'api/show', { method: 'POST', body: { model } })).text);
  if (/(?::|-)cloud$/i.test(model) || shown?.remote_host || shown?.remote_model)
    throw new Refused(
      `the model ${model} does not run on this machine: the runner would pass the card and the repository lines it names on to ${shown?.remote_host || 'its cloud'}. Pass --allow-remote if that is meant.`,
    );
}

/** The window the runner loaded the model with (GET /api/ps), or null when it does not list the model. */
async function loadedWindow(url, model) {
  const plain = (name) =>
    String(name ?? '')
      .toLowerCase()
      .replace(/^registry\.ollama\.ai\//, '')
      .replace(/^library\//, '')
      .replace(/:latest$/, '');
  const models = object((await ask(url, 'api/ps')).text)?.models;
  const loaded = (Array.isArray(models) ? models : []).find((m) =>
    [m?.name, m?.model].some((n) => plain(n) === plain(model)),
  );
  return typeof loaded?.context_length === 'number' ? loaded.context_length : null;
}

/** One request to the model, read as it arrives, so that a slow model is never taken for a dead one. */
async function chat(url, body, window, minutes, onText) {
  const started = Date.now();
  let content = '';
  let thinking = '';
  let last = null;
  let error = null;
  let checked = null;
  const res = await ask(url, 'api/chat', { method: 'POST', body, minutes }, (line, req) => {
    if (line.trim() === '') return;
    const obj = object(line);
    if (!obj) return void (error ??= line.trim().slice(0, 300));
    if (obj.error) return void (error ??= errorText(obj));
    content += obj.message?.content ?? '';
    thinking += obj.message?.thinking ?? '';
    if (obj.done) last = obj;
    onText(content.length + thinking.length);
    // The model is loaded now, whatever is done with it afterwards: this is when the runner can say with which window.
    checked ??= loadedWindow(url, body.model)
      .catch(() => null)
      .then((loaded) => {
        if (loaded !== null && loaded >= window) return null;
        const unfit = new RunnerError(
          loaded === null
            ? `the runner did not say which window it loaded ${body.model} with, so a cut prompt cannot be ruled out; name the model as "ollama ps" shows it`
            : `the runner loaded the model with a window of ${loaded} tokens, not the ${window} asked for, so it would cut the prompt (docs/plan/README.md, "The runner")`,
        );
        // No use in letting the model write a reply that cannot be trusted.
        req.destroy(unfit);
        return unfit;
      });
  });
  if (error || res.status !== 200)
    throw new RunnerError(
      `the runner refused the request (HTTP ${res.status}${res.location ? `, sent on to ${res.location}` : ''}): ${error ?? (res.text.trim().slice(0, 300) || 'no reason given')}`,
    );
  const unfit = await checked;
  if (unfit) throw unfit;
  if (!last) throw new RunnerError('the answer from the runner ended before it was finished');
  return {
    content,
    thinking,
    doneReason: last.done_reason ?? '',
    promptTokens: last.prompt_eval_count ?? null,
    replyTokens: last.eval_count ?? null,
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

let running = null;
const killCommands = () => {
  if (!running) return;
  try {
    // The whole group: a card's commands start others (a test runner, a database), which outlive the shell.
    process.kill(-running.pid, 'SIGKILL');
  } catch {
    running.kill('SIGKILL');
  }
};

/** The card's commands, as one script that stops at the first that fails. */
function runCommands(script, minutes) {
  return new Promise((done, fail) => {
    const child = spawn('bash', ['-euo', 'pipefail', '-c', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    running = child;
    let output = '';
    let late = false;
    const take = (chunk) => {
      process.stdout.write(chunk);
      output = (output + chunk).slice(-400_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      late = true;
      take(`\n(stopped after ${minutes} minutes)\n`);
      killCommands();
    }, minutes * 60_000);
    const end = (code) => {
      clearTimeout(timer);
      running = null;
      done({ code: late ? 124 : code, output });
    };
    child.on('error', (e) => {
      clearTimeout(timer);
      running = null;
      fail(new Error(`the card's commands could not be started: ${e.message}`));
    });
    child.on('close', (code) => end(code ?? 137));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.card) {
    console.log(USAGE);
    return args.help ? 0 : 2;
  }
  const say = (m) => console.log(m);
  const cardAt = resolve(args.card);
  if (!existsSync(cardAt)) throw new Refused(`${args.card} does not exist`);
  let root;
  try {
    root = realpathSync(git(['rev-parse', '--show-toplevel'], { cwd: dirname(cardAt) }).trim());
  } catch {
    throw new Refused(`${args.card} is not in a git repository`);
  }
  process.chdir(root);
  const cardPath = relative(root, realpathSync(cardAt)).split(sep).join('/');
  const cardText = readFileSync(cardPath, 'utf8');

  const at = (p) => {
    try {
      return lstatSync(p);
    } catch {
      return null;
    }
  };
  // The path as written must be the file itself: no link at its end or along the way.
  const straight = (p) => realpathSync(resolve(root, p)) === resolve(root, p);
  // Only "not ignored" lets a file through: an answer git could not give is not a no.
  const ignored = (p) => {
    const status = gitStatus(['check-ignore', '-q', '--', p]);
    return status === 0
      ? 'is ignored by git; a card names only files of the repository'
      : status === 1
        ? null
        : 'could not be checked against .gitignore';
  };
  const repo = {
    exists: (p) => at(p) !== null,
    lineCount: (p) => {
      try {
        return readFileSync(p, 'utf8').replace(/\n$/, '').split('\n').length;
      } catch {
        return 0;
      }
    },
    read: (p) => readFileSync(p, 'utf8'),
    unreadable: (p) => {
      const st = at(p);
      if (!st) return 'does not exist';
      if (st.isSymbolicLink()) return 'is a link; a card names the file itself';
      if (!st.isFile()) return 'is not a file';
      if (!straight(p)) return 'is reached through a link; a card names the file itself';
      return ignored(p);
    },
    unwritable: (p) => {
      // A link whose target is missing counts as something there: writing to it would create the target.
      if (at(p))
        return 'is there already: take away what an earlier attempt left, or mark the card Done if its work has landed';
      let dir = dirname(p);
      while (!at(dir)) dir = dirname(dir);
      if (!at(dir).isDirectory() || !straight(dir))
        return 'would be written through a link, or into something that is not a folder';
      const why = ignored(p);
      return why && `${why.replace(/^is /, 'would be ')}: what is written there would not show in the audit`;
    },
  };

  const rulesBlocked = repo.unreadable(RULES);
  if (rulesBlocked) throw new Refused(`${RULES} ${rulesBlocked}: it holds the rules every card is sent with`);
  const clean = () => git(['status', '--porcelain', '--untracked-files=all']).trim() === '';
  if (!args.dryRun && !clean())
    throw new Refused(
      'the working tree has changes. Commit or stash them first, so that what this card changes can be told apart.',
    );

  const plan = planCard(cardPath, cardText, repo);
  if (plan.problems.length > 0)
    throw new Refused(`${cardPath} cannot be run:\n${plan.problems.map((p) => `  ${p}`).join('\n')}`);
  const window = args.window ?? plan.window;
  const rules = readFileSync(RULES, 'utf8');
  const paths = [...new Set(plan.targets.map((t) => t.path))];
  const originals = new Map(paths.map((p) => [p, at(p) ? readFileSync(p, 'utf8') : null]));
  const sizes = (again) => plan.targets.map((t) => ({ lines: again?.written?.get(t.n) ?? t.present }));
  // A card with no part leaves everything to its commands (a generator, say): no model is asked.
  const asks = plan.targets.length > 0;
  const first = asks ? budget(buildPrompt(rules, plan), window, sizes(null)) : null;

  if (args.dryRun) {
    say(`${plan.card.id}: ${plan.targets.length} part(s), ${plan.reading.length} thing(s) to read.`);
    if (!asks) {
      say('No part to write: the card is its commands, and no model is asked.');
      return 0;
    }
    const prompt = buildPrompt(rules, plan);
    say(
      `The prompt comes to between ${first.low} and ${first.high} tokens; the reply may run to ${first.numPredict} in a window of ${window}.`,
    );
    for (const p of first.problems) say(`  ${p}`);
    say('\n--- the rules ---\n');
    say(prompt.system);
    say('\n--- the task ---\n');
    say(prompt.user);
    return first.problems.length > 0 ? 2 : 0;
  }
  if (first?.problems.length > 0)
    throw new Refused(
      `${cardPath} does not fit its window:\n${first.problems.map((p) => `  ${p}`).join('\n')}`,
    );

  if (spawnSync('bash', ['-c', 'true'], { stdio: 'ignore' }).status !== 0)
    throw new Refused(
      "the card's commands are run with bash, which did not start here. On Windows that is Git Bash or WSL, with the repository's tools in that same shell.",
    );
  const model = args.model || process.env.CARD_MODEL;
  if (asks && !model) throw new Refused('name the model: --model <name>, or CARD_MODEL in the environment');
  const url = asks ? runnerUrl(args) : null;
  if (asks) await checkRunner(url, model, args.allowRemote);
  if (gitStatus(['check-ignore', '-q', '--', `${RECORDS}/x`]) !== 0)
    throw new Refused(`add "${RECORDS}/" to .gitignore: the driver keeps its record of each run there`);
  // Empty when HEAD is on no branch.
  const branchNow = () =>
    (spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8' }).stdout ?? '').trim();
  const branch = branchNow();
  const head = git(['rev-parse', 'HEAD']).trim();
  if (args.commit && !/^work\/./.test(branch))
    throw new Refused(
      `--commit is for a work branch (work/<unit>), and this is ${branch || 'no branch'}: what the small model wrote is not audited yet`,
    );
  // What git ignored when the run began. If a reply or a command changes that, a commit would take it in.
  const ignoredAtStart = git(['status', '--porcelain', '--ignored', '--untracked-files=all'])
    .split('\n')
    .filter((l) => l.startsWith('!! '))
    .map((l) => l.slice(3));

  // A line range is right only while those lines are what they were when the card named them. The
  // commit to compare with is the one in which the card first said "`path` lines a-b" in so many
  // words: rewording the rest of the card later does not make an old count new.
  if (!args.rangesChecked) {
    const ranged = [
      ...plan.reading
        .filter((r) => !r.whole)
        .map((r) => ({ path: r.path, from: r.from, to: r.to, now: r.lines })),
      ...plan.targets
        .filter((t) => t.kind === 'region')
        .map((t) => ({ path: t.path, from: t.from, to: t.to, now: t.present })),
    ];
    for (const r of ranged) {
      const words = [`\`${r.path}\` lines ${r.from}-${r.to}`, `\`${r.path}\` lines ${r.from}–${r.to}`].find(
        (w) => cardText.includes(w),
      );
      const named =
        (words && git(['log', '-1', '--format=%H', `-S${words}`, '--', cardPath]).trim()) ||
        git(['log', '-1', '--format=%H', '--', cardPath]).trim();
      if (!named) continue;
      let then;
      try {
        then = git(['show', `${named}:${r.path}`]);
      } catch {
        continue; // The file was not there yet: a card this one needs made it since.
      }
      if (
        splitLines(then)
          .slice(r.from - 1, r.to)
          .join('\n') !== r.now.join('\n')
      )
        throw new Refused(
          `${r.path} lines ${r.from}-${r.to} are not the lines they were when the card named them (${named.slice(0, 7)}): the planner counts them again and corrects the card. If the numbers still hold, pass --ranges-checked.`,
        );
    }
  }

  // One run at a time in a checkout: two would write over each other and each take the other's changes for its own.
  mkdirSync(RECORDS, { recursive: true });
  const lock = join(RECORDS, 'lock');
  const holder = at(lock) ? Number(readFileSync(lock, 'utf8')) : null;
  const alive = (pid) => {
    try {
      return process.kill(pid, 0);
    } catch (e) {
      return e.code === 'EPERM';
    }
  };
  if (holder && alive(holder))
    throw new Refused(`another run is at work in this checkout (process ${holder})`);
  writeFileSync(lock, String(process.pid));
  process.on('exit', () => rmSync(lock, { force: true }));

  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  mkdirSync(join(RECORDS, plan.card.id), { recursive: true });
  let record = join(RECORDS, plan.card.id, stamp);
  for (let n = 2; at(record); n++) record = join(RECORDS, plan.card.id, `${stamp}-${n}`);
  mkdirSync(record);
  const keep = (name, text) => writeFileSync(join(record, name), text);
  const result = { card: cardPath, model: model ?? null, window, attempts: [], wrote: [], outcome: null };
  const finish = (outcome, code) => {
    result.outcome = outcome;
    keep('result.json', `${JSON.stringify(result, null, 2)}\n`);
    say(`\nThe record of this run is in ${record}/`);
    return code;
  };
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])
    process.on(signal, () => {
      killCommands();
      say(
        `\nInterrupted.${result.wrote.length > 0 ? ` Left in the working tree: ${result.wrote.join(', ')}. To set it aside: git stash -u` : ''}`,
      );
      process.exit(finish('interrupted', code));
    });

  if (plan.card.level === 'T' && !args.noFirstRun) {
    say(`== ${plan.card.id}: the commands, before any code is written (they must fail)\n`);
    const before = await runCommands(plan.commands, args.commandTimeout);
    keep('before-commands.log', before.output);
    if (before.code === 0) {
      say(
        "\nThe card's commands pass before any code is written: its tests do not test this card's work. Back to the planner.",
      );
      return finish('the commands passed before any code was written', 2);
    }
    if (!clean()) {
      say(
        '\nThe commands changed files before they failed. Put the tests first under Run, or pass --no-first-run. (To undo: git stash -u)',
      );
      return finish('the first run of the commands changed files', 2);
    }
    // Any failure counts here, a database that is down as much as a missing function: the planner reads why.
    say(
      `\n(They failed, exit ${before.code}, as they must before the code is there. Why is in before-commands.log.)`,
    );
  }

  /** Writes one file, having looked again at what is there: minutes, and the card's commands, lie between the plan and this. */
  const created = new Set();
  const write = (path, content) => {
    const st = at(path);
    if (originals.get(path) === null && !created.has(path)) {
      mkdirSync(dirname(path), { recursive: true });
      if (!straight(dirname(path))) throw new Error(`${path} would be written through a link`);
      writeFileSync(path, content, { flag: 'wx' });
      created.add(path);
    } else {
      if (!st?.isFile() || !straight(path)) throw new Error(`${path} is no longer a plain file`);
      writeFileSync(path, content);
    }
    if (!result.wrote.includes(path)) result.wrote.push(path);
  };

  let again = null;
  let outcome = 'no attempt was made';
  let code = 1;
  // What the planner needs when the card comes back: the last reply's faults, or the end of what the commands printed.
  let why = [];
  let afterCommands = null;
  for (let attempt = 1; attempt <= (asks ? args.attempts : 1); attempt++) {
    let parts = null;
    const entry = { outcome: null };
    result.attempts.push(entry);
    if (asks) {
      const prompt = buildPrompt(rules, plan, again);
      const b = budget(prompt, window, sizes(again));
      keep(`attempt-${attempt}-prompt.md`, `${prompt.system}\n\n---\n\n${prompt.user}\n`);
      if (b.problems.length > 0) {
        say(
          `\n${plan.card.id}, attempt ${attempt}: not sent.\n${b.problems.map((p) => `  ${p}`).join('\n')}`,
        );
        entry.outcome = 'not sent: it did not fit the window';
        outcome = 'the second attempt did not fit the window';
        break;
      }
      say(
        `\n== ${plan.card.id}, attempt ${attempt}: asking ${model} (about ${b.high} tokens sent, up to ${b.numPredict} back)`,
      );
      let shown = 0;
      let reply;
      try {
        reply = await chat(
          url,
          {
            model,
            stream: true,
            think: Boolean(args.think),
            keep_alive: args.keepAlive,
            // Left alone, the runner makes room for a prompt longer than the window by cutting its middle out,
            // and for a reply that fills the window by dropping what came first. With these two it refuses.
            truncate: false,
            shift: false,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            options: {
              num_ctx: window,
              num_predict: b.numPredict,
              temperature: args.temperature,
              seed: args.seed + attempt - 1,
            },
          },
          window,
          args.runnerTimeout,
          (chars) => {
            if (process.stderr.isTTY && chars - shown >= 400)
              process.stderr.write(`\r  ${(shown = chars)} characters so far`);
          },
        );
      } catch (e) {
        if (!(e instanceof RunnerError)) throw e;
        if (process.stderr.isTTY && shown > 0) process.stderr.write('\n');
        entry.outcome = `the runner failed: ${e.message}`;
        say(`\nStopped: ${e.message}`);
        outcome = 'the runner did not answer as asked';
        why = [e.message];
        code = 4;
        break;
      }
      if (process.stderr.isTTY && shown > 0) process.stderr.write('\n');
      keep(
        `attempt-${attempt}-reply.md`,
        `${reply.thinking ? `<thinking>\n${reply.thinking}\n</thinking>\n\n` : ''}${reply.content}\n`,
      );
      Object.assign(entry, {
        promptTokens: reply.promptTokens,
        replyTokens: reply.replyTokens,
        seconds: reply.seconds,
      });
      say(
        `  ${reply.promptTokens ?? '?'} tokens read, ${reply.replyTokens ?? '?'} written, ${reply.seconds} s`,
      );
      if (reply.thinking && !args.think)
        say('  (the model thought first although asked not to; its thinking counts against the window)');

      const parsed = parseReply(reply.content, plan.targets);
      if (parsed.stopped !== null) {
        entry.outcome = `the model stopped: ${parsed.stopped}`;
        say(
          `\nThe model stopped: ${parsed.stopped}\nBack to the planner. Nothing was written from this reply.`,
        );
        outcome = `the model stopped: ${parsed.stopped}`;
        why = [`The model wrote STOP: ${parsed.stopped}`];
        code = 3;
        break;
      }
      const faults = parsed.problems.length > 0 ? [...parsed.problems] : partProblems(plan, parsed.parts);
      if (reply.doneReason === 'length')
        faults.unshift(`the reply stopped at its limit of ${b.numPredict} tokens before it was finished`);
      if (faults.length > 0) {
        entry.outcome = 'the reply could not be used';
        entry.faults = faults;
        say(`  The reply could not be used:\n${faults.map((p) => `    ${p}`).join('\n')}`);
        if (faults.some((f) => f.includes('brings back')))
          say(
            '  (If the card means these lines to go, its Files item says "(replace)" after the path or the lines.)',
          );
        // What is on disk is the first attempt if one was written, and what its commands said still stands.
        again = {
          trouble: afterCommands
            ? `${afterCommands}\n\n${trouble('reply', faults)}`
            : trouble('reply', faults),
          written: again?.written ?? null,
        };
        outcome = 'the reply could not be used';
        why = faults;
        continue;
      }
      try {
        for (const [path, content] of applyParts(originals, plan.targets, parsed.parts)) write(path, content);
      } catch (e) {
        entry.outcome = `writing failed: ${e.message}`;
        say(`\nStopped while writing: ${e.message}`);
        outcome = 'the parts could not all be written';
        why = [e.message];
        code = 5;
        break;
      }
      parts = parsed.parts;
      say(`  Wrote ${paths.join(', ')}`);
    }
    say(`\n== ${plan.card.id}${asks ? `, attempt ${attempt}` : ''}: the card's commands\n`);
    const run = await runCommands(plan.commands, args.commandTimeout);
    keep(`attempt-${attempt}-commands.log`, run.output);
    if (run.code === 0) {
      entry.outcome = 'the commands passed';
      outcome = 'passed';
      code = 0;
      break;
    }
    entry.outcome = `the commands failed (exit ${run.code})`;
    outcome = 'the commands failed';
    why = splitLines(run.output).slice(-20);
    afterCommands = trouble('commands', run.output);
    again = { trouble: afterCommands, written: parts };
  }

  const passed = code === 0;
  const changed = git(['status', '--short', '--untracked-files=all']).trimEnd();
  const tries = asks ? ` after ${result.attempts.length} attempt(s)` : '';
  say(`\n== ${plan.card.id}: ${passed ? `the commands passed${tries}` : `not done (${outcome})`}`);
  if (changed) say(`\n${changed}`);
  if (passed) say('\nNext: the audit (docs/plan/README.md). Nothing here has been read by the auditor.');
  else if (changed && !args.commit)
    say('\nWhat the run wrote is left in the working tree for the planner. To set it aside: git stash -u');

  if (args.commit && changed) {
    // Minutes have passed, and the card's commands ran: the branch, and what git ignores, may not be what they were.
    const untracked = git(['status', '--porcelain', '--untracked-files=all'])
      .split('\n')
      .filter((l) => l.startsWith('?? '))
      .map((l) => l.slice(3));
    const exposed = untracked.filter((u) =>
      ignoredAtStart.some((i) => u === i || (i.endsWith('/') && u.startsWith(i))),
    );
    let stop = null;
    if (branchNow() !== branch || git(['rev-parse', 'HEAD']).trim() !== head)
      stop = `the checkout moved from ${branch} during the run`;
    else if (exposed.length > 0)
      stop = `git no longer ignores ${exposed.slice(0, 3).join(', ')}, which it did when the run began`;
    else if (gitStatus(['check-ignore', '-q', '--', `${RECORDS}/x`]) !== 0)
      stop = `git no longer ignores ${RECORDS}/, where the record of this run is`;
    if (stop) {
      say(`\nNot committed: ${stop}. Look at the working tree before anything is committed.`);
      return finish(`${outcome}; not committed: ${stop}`, passed ? 1 : code);
    }
    const subject = passed
      ? `Card ${plan.card.id}: the implementer's attempt, not audited`
      : `Card ${plan.card.id}: a failed attempt, back to the planner`;
    // The record of the run stays on this machine; the auditor, on another, has only what the commit says.
    const body = [
      `Written by the small model from ${cardPath}, through tools/card-run.mjs.`,
      passed ? `The card's commands passed${tries}.` : `Not done: ${outcome}${tries}.`,
      'The auditor has not read this change.',
      '',
      ...result.attempts.map(
        (a, i) =>
          `Attempt ${i + 1}: ${a.outcome}${a.seconds === undefined ? '' : ` (${a.seconds} s, ${a.promptTokens ?? '?'} tokens read, ${a.replyTokens ?? '?'} written)`}`,
      ),
      ...(passed || why.length === 0 ? [] : ['', 'How it ended:', ...why.slice(-20).map((l) => `  ${l}`)]),
    ].join('\n');
    try {
      git(['add', '-A']);
      git(['commit', '-q', '-m', subject, '-m', body]);
      const sha = git(['rev-parse', '--short', 'HEAD']).trim();
      if (passed) say(`\nCommitted on ${branch} as ${sha}: ${subject}`);
      else {
        // The attempt is kept for the planner to read, and taken out again so that the card can be run once more.
        git(['revert', '--no-commit', 'HEAD']);
        git([
          'commit',
          '-q',
          '-m',
          `Card ${plan.card.id}: the failed attempt taken out again`,
          '-m',
          `It stays in the history as ${sha}: git show ${sha}`,
        ]);
        say(
          `\nCommitted on ${branch} as ${sha}, and taken out again by the commit after it. To read the attempt: git show ${sha}`,
        );
      }
    } catch (e) {
      say(
        `\nNot committed: git refused (${String(e.stderr || e.message)
          .trim()
          .split('\n')
          .at(-1)}). Look at the working tree: changes may be staged.`,
      );
      return finish(`${outcome}; not committed: git refused`, passed ? 1 : code);
    }
  }
  return finish(outcome, code);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    if (e instanceof Refused) {
      console.error(`Not run: ${e.message}`);
      process.exit(2);
    }
    if (e instanceof RunnerError) {
      console.error(`\nStopped: ${e.message}`);
      process.exit(4);
    }
    console.error(`\nThe driver itself failed: ${e.stack ?? e}`);
    process.exit(5);
  },
);
