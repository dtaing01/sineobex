// Rules for task cards (docs/plan/README.md, "What a card looks like"). A card is followed step by
// step by a small model that can't tell a missing section or a stale path from a correct one, and
// that loses the end of a long page, so the shape and the length are checked here instead. The
// card driver (card-run.mjs) reads a card with these same functions: a card that passes here is one
// a program can run.

/** The sections of a card, in order. */
export const SECTIONS = ['Goal', 'Read first', 'Files', 'Steps', 'Tests', 'Run', 'Audit'];

export const LEVELS = ['S', 'T', 'R', 'X'];

/** Paths only the frontier model may change (docs/plan/README.md, "These paths are always level X"). */
export const ALWAYS_X = [
  /^services\/api\/src\/(sync|auth|db)\//,
  /^apps\/mobile\/lib\/(sync|security|auth)\//,
  /^apps\/mobile\/test\/sync\/fake_server\.dart$/,
  /^\.github\//,
  /^tools\//,
];

/** A migration is level X when it has a policy, a trigger or an audit table; never below R. */
const MIGRATION = /^db\/migrations\//;

/** The windows a card may ask for, and the tokens the runner is asked to hold for each. */
export const WINDOWS = { '16,000': 16384, '32,000': 32768 };
/** Most lines a card may ask its reader to read, by window. */
export const MAX_READ_LINES = { '16,000': 200, '32,000': 400 };
/**
 * Most lines that are already there which a card may ask the small model to write again (whole
 * files and line ranges together), by window. The model sends back every line of what it changes,
 * so these lines are paid for twice: once to read, once to write.
 */
export const MAX_REWRITE_LINES = { '16,000': 200, '32,000': 400 };
export const MAX_SOURCE_FILES = 3;
/** Most lines a card may have. A level X card is read by the frontier model and may run longer. */
export const MAX_CARD_LINES = { S: 90, T: 90, R: 90, X: 120 };

// A unit (a letter, and a digit when the letter has several units) and a short name: F6-psychological, E-presets.
const CARD_REF = '[A-Z][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*';
const CARD_ID = new RegExp(`^${CARD_REF}$`);
const MADE_BY = new RegExp(`\\(made by (${CARD_REF})\\)`);
// "Done." is added when the card's work is audited and on the branch (docs/plan/README.md, "The loop").
const HEADER = /^Level: ([A-Z])\. Window: ([0-9,]+)\. Needs: (.+?)\.(?: (Done)\.)?$/;
const TEST_PATH = /(^|\/)(test|e2e)\/|_test\.dart$|\.(test|spec)\.[a-z]+$/;
// Naming a model in a document is against the repository's rules; the project file is not a model.
const MODEL_NAME = /\b(qwen|claude|gpt-?\d|llama|gemini|mistral|deepseek)\b/i;

/** The card's ID, title, header line and sections as written. */
export function parseCard(text) {
  const lines = text.split('\n');
  const head = /^# Card ([^:]+): (.+)$/.exec(lines[0] ?? '');
  const sections = [];
  let header = null;
  for (const line of lines.slice(1)) {
    const h = /^## (.+)$/.exec(line);
    if (h) sections.push({ name: h[1].trim(), body: [] });
    else if (sections.length > 0) sections.at(-1).body.push(line);
    else if (header === null && line.trim() !== '') header = line.trim();
  }
  const m = HEADER.exec(header ?? '');
  return {
    id: head ? head[1].trim() : null,
    title: head ? head[2].trim() : null,
    level: m ? m[1] : null,
    window: m ? m[2] : null,
    needs: m ? (m[3] === 'none' ? [] : m[3].split(', ')) : null,
    done: Boolean(m?.[4]),
    sections: sections.map((s) => ({ name: s.name, body: s.body.join('\n').trim() })),
  };
}

/** Top-level list items of a section, each with its continuation lines joined. */
export function items(body) {
  const out = [];
  for (const line of body.split('\n')) {
    if (/^- /.test(line)) out.push(line.slice(2));
    else if (out.length > 0 && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

const firstPath = (item) => /^`([^`]+)`/.exec(item)?.[1] ?? null;

/** A card names files of the repository only: the driver reads and writes what a card names. */
const outside = (path) => /^[/~]|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$)/.test(path);

/** What an item says after its path, lines and maker: the words that tell the reader why. */
const caption = (rest) =>
  rest
    .replace(MADE_BY, '')
    .replace(/^[\s:,.]+/, '')
    .trim();

/** A line range written after a path: " lines 56-73". */
function rangeAfterPath(rest) {
  const m = /^ lines (\d+)[-–](\d+)/.exec(rest);
  return m ? { from: Number(m[1]), to: Number(m[2]), length: m[0].length } : null;
}

/**
 * One item of "Read first". Two forms, so that a program can fetch the lines and a small model is
 * never left to find a section in a long file:
 *   `path` lines 56-73: why
 *   `path`, all of it (124 lines): why
 * "(made by <card>)" marks a file that an earlier card creates; "(about 60 lines)" is for those.
 */
export function readItem(item) {
  const path = firstPath(item);
  if (!path) return { problem: `an item must start with a path in backticks ("${item.slice(0, 40)}…")` };
  const rest = item.slice(path.length + 2);
  const madeBy = MADE_BY.exec(rest)?.[1] ?? null;
  const range = rangeAfterPath(rest);
  if (range) {
    if (range.from < 1 || range.to < range.from)
      return { path, problem: `${path}: lines ${range.from}-${range.to} is not a range` };
    const count = range.to - range.from + 1;
    return { path, from: range.from, to: range.to, count, madeBy, note: caption(rest.slice(range.length)) };
  }
  const all = /^, all of it \((?:about )?(\d+) lines\)/.exec(rest);
  if (all)
    return {
      path,
      from: 1,
      to: null,
      count: Number(all[1]),
      madeBy,
      note: caption(rest.slice(all[0].length)),
    };
  return { path, problem: `${path} must say which lines: "lines 56-73" or ", all of it (124 lines)"` };
}

/**
 * One item of "Files". An item that starts with a path is something the card's reader writes:
 *   `path` (new)          a file that is not there yet
 *   `path`                a file that is there, written again whole
 *   `path` lines 56-73    those lines of a file that is there, written again
 * Anything else is words about files the card's commands write (a lockfile, generated code).
 */
export function fileItem(item) {
  const path = firstPath(item);
  if (!path) return { kind: 'words' };
  const rest = item.slice(path.length + 2);
  const madeBy = MADE_BY.exec(rest)?.[1] ?? null;
  const range = rangeAfterPath(rest);
  if (range) {
    if (range.from < 1 || range.to < range.from)
      return { kind: 'region', path, problem: `${path}: lines ${range.from}-${range.to} is not a range` };
    return {
      kind: 'region',
      path,
      from: range.from,
      to: range.to,
      madeBy,
      note: caption(rest.slice(range.length)),
    };
  }
  if (/^ \(new\)/.test(rest)) return { kind: 'new', path, madeBy: null, note: caption(rest.slice(6)) };
  return { kind: 'whole', path, madeBy, note: caption(rest) };
}

/** What is wrong with the files a card writes, as a list of sentences. */
function fileProblems(targets) {
  const problems = [];
  const byPath = new Map();
  for (const t of targets) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]);
  for (const [path, list] of byPath) {
    const regions = list.filter((t) => t.kind === 'region' && !t.problem).sort((a, b) => a.from - b.from);
    if (list.length > 1 && regions.length < list.length)
      problems.push(`Files: ${path} is listed more than once; only line ranges of one file may be`);
    for (let i = 1; i < regions.length; i++) {
      if (regions[i].from <= regions[i - 1].to)
        problems.push(
          `Files: ${path} lines ${regions[i - 1].from}-${regions[i - 1].to} and ${regions[i].from}-${regions[i].to} overlap`,
        );
    }
  }
  return problems;
}

/**
 * The problems of one card. `repo.exists(path)` and `repo.lineCount(path)` answer for the checkout,
 * so the rules can be tested without one. A card marked Done is checked for its shape only: the
 * files it names have moved on since it was written.
 */
export function checkCard(file, text, repo) {
  const problems = [];
  const say = (m) => problems.push(`${file}: ${m}`);
  const card = parseCard(text);
  const stem = file.split('/').at(-1).replace(/\.md$/, '');

  if (!card.id) say('the first line must be "# Card <ID>: <title>"');
  else if (card.id !== stem) say(`the card is called ${card.id} but its file is ${stem}.md`);
  else if (!CARD_ID.test(card.id)) say(`the ID ${card.id} must look like F6-psychological`);

  if (card.needs === null) {
    say(
      'the line under the title must be "Level: <S, T, R or X>. Window: <16,000 or 32,000>. Needs: <card IDs, or none>."',
    );
    return problems;
  }
  if (!LEVELS.includes(card.level)) say('Level must be S, T, R or X');
  if (!(card.window in WINDOWS)) say('Window must be 16,000 or 32,000');
  const strangers = card.needs.filter((n) => !CARD_ID.test(n));
  if (strangers.length > 0)
    say(`Needs must be card IDs separated by ", ", or none (found: ${strangers.join(', ')})`);

  const names = card.sections.map((s) => s.name);
  if (names.join('|') !== SECTIONS.join('|')) {
    say(`sections must be exactly, in order: ${SECTIONS.join(', ')} (found: ${names.join(', ') || 'none'})`);
    return problems;
  }
  const body = Object.fromEntries(card.sections.map((s) => [s.name, s.body]));
  for (const name of SECTIONS) if (!body[name]) say(`the section "${name}" is empty`);

  const length = text.replace(/\n+$/, '').split('\n').length;
  const limit = MAX_CARD_LINES[card.level] ?? MAX_CARD_LINES.S;
  if (length > limit) say(`has ${length} lines; a level ${card.level} card has at most ${limit}`);

  const window = card.window in WINDOWS ? card.window : '16,000';
  const small = card.level !== 'X';

  const targets = items(body.Files)
    .map(fileItem)
    .filter((t) => t.kind !== 'words');
  const paths = [...new Set(targets.map((t) => t.path))];
  const source = paths.filter((p) => !TEST_PATH.test(p) && !p.startsWith('docs/'));
  if (paths.length === 0) say('Files names no file');
  if (source.length > MAX_SOURCE_FILES) {
    say(`changes ${source.length} source files; a card changes at most ${MAX_SOURCE_FILES}`);
  }
  for (const p of paths) {
    if (ALWAYS_X.some((re) => re.test(p)) && card.level !== 'X')
      say(`${p} is an always-X path but the card is level ${card.level}`);
    if (MIGRATION.test(p) && card.level !== 'X' && card.level !== 'R')
      say(`${p} is a migration: level X, or R with no policy or trigger`);
  }
  for (const p of paths) if (outside(p)) say(`Files: ${p} must be a path inside the repository`);
  for (const p of fileProblems(targets)) say(p);
  let rewritten = 0;
  for (const t of targets) {
    if (t.problem) say(`Files: ${t.problem}`);
    if (t.problem || card.done) continue;
    if (t.kind === 'new') {
      // Keeps finished cards from rotting: the commit that lands a card's work marks the card.
      if (repo.exists(t.path))
        say(
          `Files: ${t.path} is there already; mark the card Done once its work has landed ("Needs: …. Done.")`,
        );
      continue;
    }
    if (t.madeBy) {
      if (!card.needs.includes(t.madeBy))
        say(`Files: ${t.path} is made by ${t.madeBy}, which is not under Needs`);
    } else if (!repo.exists(t.path)) {
      say(
        `Files: ${t.path} does not exist (say "(new)" if this card creates it, "(made by <card>)" if an earlier one does)`,
      );
    } else {
      const actual = repo.lineCount(t.path);
      if (t.kind === 'region' && t.to > actual) say(`Files: ${t.path} has ${actual} lines, not ${t.to}`);
      rewritten += t.kind === 'region' ? t.to - t.from + 1 : actual;
    }
  }
  if (small && rewritten > MAX_REWRITE_LINES[window]) {
    say(
      `Files asks for ${rewritten} lines to be written again; the limit is ${MAX_REWRITE_LINES[window]} (name line ranges, or split the card)`,
    );
  }

  let total = 0;
  for (const item of items(body['Read first'])) {
    const asked = readItem(item);
    if (asked.problem) {
      say(`Read first: ${asked.problem}`);
      continue;
    }
    total += asked.count;
    if (outside(asked.path)) say(`Read first: ${asked.path} must be a path inside the repository`);
    if (card.done) continue;
    if (asked.madeBy) {
      if (!card.needs.includes(asked.madeBy))
        say(`Read first: ${asked.path} is made by ${asked.madeBy}, which is not under Needs`);
    } else if (!repo.exists(asked.path)) {
      say(`Read first: ${asked.path} does not exist (say "(made by <card>)" if an earlier card creates it)`);
    } else {
      const actual = repo.lineCount(asked.path);
      if (asked.to !== null && asked.to > actual)
        say(`Read first: ${asked.path} has ${actual} lines, not ${asked.to}`);
      if (asked.to === null && Math.abs(asked.count - actual) > Math.max(5, actual * 0.1))
        say(`Read first: ${asked.path} has ${actual} lines, the card says ${asked.count}`);
    }
  }
  if (total > MAX_READ_LINES[window])
    say(`Read first asks for ${total} lines; the limit is ${MAX_READ_LINES[window]}`);

  const named = MODEL_NAME.exec(text.replaceAll('CLAUDE.md', ''));
  if (named) say(`names a model ("${named[0]}"); documents name none`);

  return problems;
}
