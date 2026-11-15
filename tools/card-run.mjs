#!/usr/bin/env node
// The card driver: runs one task card with a small local model that cannot call tools
// (docs/plan/README.md, "The card driver"). It sends the model the rules, the card, the lines the
// card says to read and the present content of what the card changes; writes the parts of the
// reply to the files the card names, and to no other; runs the card's commands, and no other; and
// gives the model one more try with what went wrong. It commits nothing unless asked, and then only
// on a work branch: what it leaves is for the audit.
//
//   CARD_MODEL=<the runner's name for the model> node tools/card-run.mjs <card.md>
//
// Exit: 0 the commands passed; 1 they did not, or the reply could not be used; 2 the card was not
// run (the card, the checkout or the window is not fit for it); 3 the model said it could not do
// the card; 4 the runner did not answer as asked.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  trouble,
} from './card-run-rules.mjs';

const RULES = 'docs/plan/implementer-rules.md';
const RECORDS = '.card-runs';
const USAGE = `Usage: node tools/card-run.mjs <card.md> [options]

  --model <name>          the runner's name for the model (or CARD_MODEL)
  --url <url>             the runner (or CARD_RUNNER_URL, OLLAMA_HOST; default http://127.0.0.1:11434)
  --window <tokens>       the window to ask for, in place of the card's
  --attempts <n>          how many times the model is asked (default 2)
  --temperature <t>       default 0.2
  --seed <n>              default 1; a second attempt uses the next
  --think                 let a thinking model think (default: asked not to)
  --keep-alive <time>     how long the runner keeps the model loaded (default 10m; 0 frees memory for the commands)
  --command-timeout <m>   minutes the card's commands may take (default 30)
  --dry-run               build the prompt, say what it comes to, ask nothing
  --no-first-run          level T: do not run the commands first to see them fail
  --ranges-checked        the planner checked the card's line ranges after the files changed
  --commit                commit what the run leaves, on a work/ branch only
  --allow-remote          the runner is on another machine; send the card and its reading there`;

class Refused extends Error {}
class RunnerError extends Error {}

function parseArgs(argv) {
  const args = { attempts: 2, temperature: 0.2, seed: 1, keepAlive: '10m', commandTimeout: 30 };
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
  const numbers = {
    '--window': 'window',
    '--attempts': 'attempts',
    '--temperature': 'temperature',
    '--seed': 'seed',
    '--command-timeout': 'commandTimeout',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in flags) args[flags[a]] = true;
    else if (a in values || a in numbers) {
      const v = argv[++i];
      if (v === undefined) throw new Refused(`${a} needs a value`);
      if (a in numbers && !Number.isFinite(Number(v))) throw new Refused(`${a} needs a number`);
      args[values[a] ?? numbers[a]] = a in numbers ? Number(v) : v;
    } else if (a.startsWith('--')) throw new Refused(`unknown option ${a}`);
    else if (args.card) throw new Refused('one card at a time');
    else args.card = a;
  }
  return args;
}

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const gitOk = (args) => spawnSync('git', args, { stdio: 'ignore' }).status === 0;

function runnerUrl(args) {
  const given =
    args.url ?? process.env.CARD_RUNNER_URL ?? process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  const url = new URL(/^https?:\/\//.test(given) ? given : `http://${given}`);
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (!local && !args.allowRemote)
    throw new Refused(
      `the runner at ${url.host} is not on this machine: the card and the repository lines it names would be sent there. Pass --allow-remote if that is meant.`,
    );
  return url;
}

/** One request to the runner, read as it arrives so that a slow model is never mistaken for a dead one. */
function chat(url, body, onText) {
  return new Promise((done, fail) => {
    const target = new URL('/api/chat', url);
    const payload = JSON.stringify(body);
    const started = Date.now();
    const req = (target.protocol === 'https:' ? https : http).request(
      target,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      },
      (res) => {
        let pending = '';
        let content = '';
        let thinking = '';
        let last = null;
        let error = null;
        const take = (line) => {
          if (line.trim() === '') return;
          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            error ??= line.slice(0, 300);
            return;
          }
          if (obj.error) error ??= String(obj.error);
          content += obj.message?.content ?? '';
          thinking += obj.message?.thinking ?? '';
          if (obj.done) last = obj;
          onText(content.length + thinking.length);
        };
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          pending += chunk;
          const lines = pending.split('\n');
          pending = lines.pop();
          lines.forEach(take);
        });
        res.on('error', (e) => fail(new RunnerError(`the answer from the runner broke off (${e.message})`)));
        res.on('end', () => {
          take(pending);
          if (error || res.statusCode >= 400)
            return fail(
              new RunnerError(
                `the runner refused the request (HTTP ${res.statusCode}): ${error ?? 'no reason given'}`,
              ),
            );
          if (!last) return fail(new RunnerError('the answer from the runner ended before it was finished'));
          done({
            content,
            thinking,
            doneReason: last.done_reason ?? '',
            promptTokens: last.prompt_eval_count ?? null,
            replyTokens: last.eval_count ?? null,
            seconds: Math.round((Date.now() - started) / 1000),
          });
        });
      },
    );
    req.on('error', (e) =>
      fail(
        new RunnerError(
          `no answer from the model runner at ${target.origin} (${e.code ?? e.message}). Is it running?`,
        ),
      ),
    );
    req.end(payload);
  });
}

/** The window the runner loaded the model with, when it says (GET /api/ps). Null when it does not. */
function loadedWindow(url, model) {
  return new Promise((done) => {
    const target = new URL('/api/ps', url);
    const req = (target.protocol === 'https:' ? https : http).get(target, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (text += chunk));
      res.on('end', () => {
        try {
          const loaded = (JSON.parse(text).models ?? []).find((m) =>
            [m.name, m.model].some((n) => n === model || n === `${model}:latest`),
          );
          done(typeof loaded?.context_length === 'number' ? loaded.context_length : null);
        } catch {
          done(null);
        }
      });
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    req.setTimeout(5000, () => req.destroy());
  });
}

/** The card's commands, as one script that stops at the first that fails. */
function runCommands(script, minutes) {
  return new Promise((done) => {
    const child = spawn('bash', ['-euo', 'pipefail', '-c', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const take = (chunk) => {
      process.stdout.write(chunk);
      output = (output + chunk).slice(-400_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      take(`\n(stopped after ${minutes} minutes)\n`);
      child.kill('SIGKILL');
    }, minutes * 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      done({ code: 127, output: `${output}\n${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code: code ?? 124, output });
    });
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
  const root = realpathSync(git(['rev-parse', '--show-toplevel'], { cwd: dirname(cardAt) }).trim());
  process.chdir(root);
  const cardPath = relative(root, realpathSync(cardAt)).split(sep).join('/');
  if (!existsSync(RULES)) throw new Refused(`${RULES} is missing: the rules every card is sent with`);

  const inside = (p) => {
    const real = realpathSync(resolve(root, p));
    return real === root || real.startsWith(root + sep);
  };
  const repo = {
    exists: (p) => existsSync(p),
    lineCount: (p) => readFileSync(p, 'utf8').replace(/\n$/, '').split('\n').length,
    read: (p) => readFileSync(p, 'utf8'),
    unreadable: (p) => {
      if (!existsSync(p)) return 'does not exist';
      if (lstatSync(p).isSymbolicLink()) return 'is a link; a card names the file itself';
      if (!lstatSync(p).isFile()) return 'is not a file';
      if (!inside(p)) return 'is outside the repository';
      if (gitOk(['check-ignore', '-q', '--', p]))
        return 'is ignored by git; a card names only files of the repository';
      return null;
    },
  };

  const plan = planCard(cardPath, readFileSync(cardPath, 'utf8'), repo);
  if (plan.problems.length > 0)
    throw new Refused(`${cardPath} cannot be run:\n${plan.problems.map((p) => `  ${p}`).join('\n')}`);
  for (const t of plan.targets) {
    // A new file's folder may not exist yet; the nearest folder that does must be the repository's own.
    let dir = dirname(resolve(root, t.path));
    while (!existsSync(dir)) dir = dirname(dir);
    if (!inside(dir)) throw new Refused(`${t.path} would be written outside the repository`);
  }
  const window = args.window ?? plan.window;
  const rules = readFileSync(RULES, 'utf8');
  const paths = [...new Set(plan.targets.map((t) => t.path))];
  const originals = new Map(paths.map((p) => [p, existsSync(p) ? readFileSync(p, 'utf8') : null]));
  const present = (again) => plan.targets.map((t) => ({ present: again?.written?.get(t.n) ?? t.present }));

  if (args.dryRun) {
    const prompt = buildPrompt(rules, plan);
    const b = budget(prompt, window, present(null));
    say(`${plan.card.id}: ${plan.targets.length} part(s), ${plan.reading.length} thing(s) to read.`);
    say(
      `The prompt comes to between ${b.low} and ${b.high} tokens; the reply may run to ${b.numPredict} in a window of ${window}.`,
    );
    for (const p of b.problems) say(`  ${p}`);
    say('\n--- the rules ---\n');
    say(prompt.system);
    say('\n--- the task ---\n');
    say(prompt.user);
    return b.problems.length > 0 ? 2 : 0;
  }

  const model = args.model ?? process.env.CARD_MODEL;
  if (!model) throw new Refused('name the model: --model <name>, or CARD_MODEL in the environment');
  const url = runnerUrl(args);
  if (git(['status', '--porcelain']).trim() !== '')
    throw new Refused(
      'the working tree has changes. Commit or stash them first, so that what this card changes can be told apart.',
    );
  if (!gitOk(['check-ignore', '-q', '--', `${RECORDS}/x`]))
    throw new Refused(`add "${RECORDS}/" to .gitignore: the driver keeps its record of each run there`);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (args.commit && !branch.startsWith('work/'))
    throw new Refused(
      `--commit is for a work branch (work/<unit>), and this is ${branch}: what the small model wrote is not audited yet`,
    );

  // A line range is only right for the file as it was when the card was written.
  const written = git(['log', '-1', '--format=%H', '--', cardPath]).trim();
  if (written && !args.rangesChecked) {
    const ranged = [
      ...plan.reading.filter((r) => !r.whole),
      ...plan.targets.filter((t) => t.kind === 'region'),
    ].map((x) => x.path);
    for (const p of new Set(ranged)) {
      const since = git(['log', '--format=%h', `${written}..HEAD`, '--', p])
        .trim()
        .split('\n')[0];
      if (since)
        throw new Refused(
          `${p} changed (${since}) after this card was last written: its line ranges may point at other lines now. The planner checks the card, then passes --ranges-checked.`,
        );
    }
  }

  const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const record = join(RECORDS, plan.card.id, stamp);
  mkdirSync(record, { recursive: true });
  const keep = (name, text) => writeFileSync(join(record, name), text);
  const result = { card: cardPath, model, window, attempts: [], outcome: null };
  const finish = (outcome, code) => {
    result.outcome = outcome;
    keep('result.json', `${JSON.stringify(result, null, 2)}\n`);
    say(`\nThe record of this run is in ${record}/`);
    return code;
  };

  if (plan.card.level === 'T' && !args.noFirstRun) {
    say(`== ${plan.card.id}: the commands, before any code is written (they must fail)\n`);
    const first = await runCommands(plan.commands, args.commandTimeout);
    keep('before-commands.log', first.output);
    if (first.code === 0) {
      say(
        "\nThe card's commands pass before any code is written: its tests do not test this card's work. Back to the planner.",
      );
      return finish('the commands passed before any code was written', 2);
    }
    if (git(['status', '--porcelain']).trim() !== '') {
      say(
        '\nThe commands changed files before they failed. Put the tests first under Run, or pass --no-first-run. (To undo: git stash -u)',
      );
      return finish('the first run of the commands changed files', 2);
    }
  }

  let again = null;
  let outcome = 'no attempt was made';
  for (let attempt = 1; attempt <= args.attempts; attempt++) {
    const prompt = buildPrompt(rules, plan, again);
    const b = budget(prompt, window, present(again));
    keep(`attempt-${attempt}-prompt.md`, `${prompt.system}\n\n---\n\n${prompt.user}\n`);
    if (b.problems.length > 0) {
      say(`\n${plan.card.id}, attempt ${attempt}: not sent.\n${b.problems.map((p) => `  ${p}`).join('\n')}`);
      if (attempt === 1) return finish('the prompt does not fit the window', 2);
      outcome = 'the second attempt did not fit the window';
      break;
    }
    say(
      `\n== ${plan.card.id}, attempt ${attempt}: asking ${model} (about ${b.high} tokens sent, up to ${b.numPredict} back)`,
    );
    let shown = 0;
    const reply = await chat(
      url,
      {
        model,
        stream: true,
        think: Boolean(args.think),
        keep_alive: args.keepAlive,
        // Without this the runner makes room by dropping what came first, and says nothing.
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
      (chars) => {
        if (process.stderr.isTTY && chars - shown >= 400)
          process.stderr.write(`\r  ${(shown = chars)} characters so far`);
      },
    );
    if (process.stderr.isTTY && shown > 0) process.stderr.write('\n');
    keep(
      `attempt-${attempt}-reply.md`,
      `${reply.thinking ? `<thinking>\n${reply.thinking}\n</thinking>\n\n` : ''}${reply.content}\n`,
    );
    const entry = {
      promptTokens: reply.promptTokens,
      replyTokens: reply.replyTokens,
      seconds: reply.seconds,
      outcome: null,
    };
    result.attempts.push(entry);
    say(
      `  ${reply.promptTokens ?? '?'} tokens read, ${reply.replyTokens ?? '?'} written, ${reply.seconds} s`,
    );
    if (reply.thinking && !args.think)
      say('  (the model thought first although asked not to; its thinking counts against the window)');
    // A runner with a smaller window than was asked for cuts the start of the prompt and says nothing.
    const loaded = await loadedWindow(url, model);
    if (loaded !== null && loaded < window)
      throw new RunnerError(
        `the runner loaded the model with a window of ${loaded} tokens, not the ${window} asked for, so it may have cut the prompt (docs/plan/README.md, "Setting up the small model").`,
      );
    const fewest = Math.floor((prompt.system.length + prompt.user.length) / 6);
    if (loaded === null && reply.promptTokens !== null && reply.promptTokens < fewest)
      say(
        `  Check: the runner counted ${reply.promptTokens} tokens of a prompt expected to come to ${fewest} or more. If the reply misses the start of the task, the runner's window is too small.`,
      );

    const parsed = parseReply(reply.content, plan.targets);
    if (parsed.stopped !== null) {
      entry.outcome = 'the model stopped';
      say(`\nThe model stopped: ${parsed.stopped}\nBack to the planner. Nothing was written.`);
      return finish(`the model stopped: ${parsed.stopped}`, 3);
    }
    const checked =
      parsed.problems.length > 0
        ? { problems: [], warnings: [] }
        : partProblems(plan.targets, parsed.parts, prompt.user);
    const faults = [...parsed.problems, ...checked.problems];
    if (reply.doneReason === 'length')
      faults.unshift(`the reply stopped at its limit of ${b.numPredict} tokens before it was finished`);
    if (faults.length > 0) {
      entry.outcome = 'the reply could not be used';
      entry.faults = faults;
      say(`  The reply could not be used:\n${faults.map((p) => `    ${p}`).join('\n')}`);
      // What is on disk is the first attempt if one was written, and the next prompt must say so.
      again = { trouble: trouble('reply', faults), written: again?.written ?? null };
      outcome = 'the reply could not be used';
      continue;
    }
    for (const w of checked.warnings) say(`  Check: ${w}`);

    for (const [path, content] of applyParts(originals, plan.targets, parsed.parts)) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    say(`  Wrote ${paths.join(', ')}\n\n== ${plan.card.id}, attempt ${attempt}: the card's commands\n`);
    const run = await runCommands(plan.commands, args.commandTimeout);
    keep(`attempt-${attempt}-commands.log`, run.output);
    if (run.code === 0) {
      entry.outcome = 'the commands passed';
      outcome = 'passed';
      break;
    }
    entry.outcome = `the commands failed (exit ${run.code})`;
    outcome = 'the commands failed';
    again = { trouble: trouble('commands', run.output), written: parsed.parts };
  }

  const passed = outcome === 'passed';
  const changed = git(['status', '--short']).trimEnd();
  say(
    `\n== ${plan.card.id}: ${passed ? `the commands passed after ${result.attempts.length} attempt(s)` : `not done (${outcome})`}`,
  );
  if (changed) say(`\n${changed}`);
  if (passed) say('\nNext: the audit (docs/plan/README.md). Nothing here has been read by the auditor.');
  else if (changed)
    say('\nThe last attempt is left in the working tree for the planner. To set it aside: git stash -u');
  if (args.commit && changed) {
    git(['add', '-A']);
    const subject = passed
      ? `Card ${plan.card.id}: the implementer's attempt, not audited`
      : `Card ${plan.card.id}: a failed attempt, back to the planner`;
    const body = `Written by the small model from ${cardPath}, through tools/card-run.mjs.\n${
      passed
        ? `The card's commands passed after ${result.attempts.length} attempt(s).`
        : `Not done: ${outcome}, after ${result.attempts.length} attempt(s).`
    }\nThe auditor has not read this change.`;
    git(['commit', '-q', '-m', subject, '-m', body]);
    say(`\nCommitted on ${branch}: ${subject}`);
  }
  return finish(outcome, passed ? 0 : 1);
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
    throw e;
  },
);
