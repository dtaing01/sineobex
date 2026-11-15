// Rules for task cards (docs/plan/README.md, "What a card looks like"). A card is followed step by
// step by a small model that can't tell a missing section or a stale path from a correct one, and
// that loses the end of a long page, so the shape and the length are checked here instead. The
// card driver (card-run.mjs) reads a card with these same functions: a card that passes here is one
// a program can run.

/** The sections of a card, in order. */
export const SECTIONS = ['Goal', 'Read first', 'Files', 'Steps', 'Tests', 'Run', 'Audit'];

export const LEVELS = ['S', 'T', 'R', 'X'];

/** Paths only the frontier model may change (docs/plan/README.md, "These paths are always level X"). */
// Whatever the case of its letters: on some disks Tools/ and tools/ are one folder.
export const ALWAYS_X = [
  /^services\/api\/src\/(sync|auth|db)\//i,
  /^apps\/mobile\/lib\/(sync|security|auth)\//i,
  /^apps\/mobile\/test\/sync\/fake_server\.dart$/i,
  /^\.github\//i,
  /^tools\//i,
];

/** A migration is level X when it has a policy, a trigger or an audit table; never below R. */
const MIGRATION = /^db\/migrations\//i;

/** Files a command writes. No card has them written by hand (CLAUDE.md, "Conventions"). */
const GENERATED = [/^packages\/contract\/openapi\.json$/i, /(^|\/)generated\//i];

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
// Naming a model in a document is against the repository's rules. A name is taken with whatever
// follows it ("-coder", a version), so it is matched from its start; the project's own file and
// folder of that name are not models.
const MODEL_NAME =
  /(?<![a-z0-9])(qwen|claude|gpt-?\d|llama|codellama|gemini|gemma|mistral|codestral|deepseek|phi-?\d)/i;
const NOT_A_MODEL = /CLAUDE\.md|\.claude\/|claude\/[a-z0-9-]+/g;

/** The model a text names, or null. */
export const namedModel = (text) => MODEL_NAME.exec(text.replace(NOT_A_MODEL, ''))?.[0] ?? null;

/** The commands of a card: the one code block under Run. */
export function runScript(runBody) {
  const m = /^```(?:sh|bash|shell)?\n([\s\S]*?)\n```\s*$/m.exec(runBody.replace(/\r\n/g, '\n'));
  return m ? m[1] : null;
}

/** The card's ID, title, header line and sections as written. */
export function parseCard(text) {
  // A checkout with the other line ending, or a mark at its start, is the same card.
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const head = /^# Card ([^:]+): (.+)$/.exec(lines[0] ?? '');
  const sections = [];
  let header = null;
  let fence = null;
  for (const line of lines.slice(1)) {
    // "## Heading" inside a code block is something the card gives to write, not a section of the card.
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark && fence === null) fence = mark;
    else if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
    const h = fence === null && !mark ? /^## (.+)$/.exec(line) : null;
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

/** Lines of a list that are no item of it: "* x", "1. x", a sentence. A program would pass them over without a word. */
function strays(body) {
  const out = [];
  let inItem = false;
  for (const line of body.split('\n')) {
    if (/^- /.test(line)) inItem = true;
    else if (line.trim() === '') continue;
    else if (!(inItem && /^\s+\S/.test(line))) out.push(line.trim());
  }
  return out;
}

const firstPath = (item) => /^`([^`]+)`/.exec(item)?.[1] ?? null;

/**
 * A card names files of the repository, each by its one plain path. The driver reads and writes
 * what a card names, and the rules here match on the path as written: "./tools/x" or "tools//x"
 * would slip past them, ".." would reach outside, and a file under .git is git's own (a line of
 * its config can name a command to run).
 */
const outside = (path) =>
  /^[/~]|^[A-Za-z]:|\\|\/$/.test(path) ||
  path.split('/').some((part) => part === '' || part === '.' || part === '..' || /^\.git$/i.test(part));
const PLAIN = 'must be a plain path inside the repository (no "..", ".", ".git", "//" or "/" at its end)';

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
 * "(replace)" after the path or the lines says that the card puts other lines in their place, so
 * most of what is there need not come back. Anything else is words about files the card's
 * commands write (a lockfile, generated code).
 */
export function fileItem(item) {
  const path = firstPath(item);
  if (!path) return { kind: 'words' };
  let rest = item.slice(path.length + 2);
  const madeBy = MADE_BY.exec(rest)?.[1] ?? null;
  const range = rangeAfterPath(rest);
  if (range) rest = rest.slice(range.length);
  if (range && (range.from < 1 || range.to < range.from))
    return { kind: 'region', path, problem: `${path}: lines ${range.from}-${range.to} is not a range` };
  const fresh = !range && /^ \(new\)/.test(rest);
  const replace = !fresh && /^ \(replace\)/.test(rest);
  const note = caption(fresh ? rest.slice(6) : replace ? rest.slice(10) : rest);
  // Written anywhere else in the item, these words would be read as a note and the whole file sent to be written again.
  if (/\blines? \d|\(new\)|\(replace\)/.test(note))
    return {
      kind: 'whole',
      path,
      problem: `${path}: "lines 56-73", "(new)" and "(replace)" go straight after the path, before anything else`,
    };
  if (fresh) return { kind: 'new', path, madeBy: null, note };
  return range
    ? { kind: 'region', path, from: range.from, to: range.to, replace, madeBy, note }
    : { kind: 'whole', path, replace, madeBy, note };
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
  // A card may leave everything to its commands (a generator), which a machine then checks: level S only.
  if (paths.length === 0 && card.level !== 'S')
    say('Files names no file (only a level S card leaves everything to its commands)');
  for (const stray of strays(body.Files))
    say(`Files: every line is an item that starts with "- " ("${stray.slice(0, 40)}")`);
  if (source.length > MAX_SOURCE_FILES) {
    say(`changes ${source.length} source files; a card changes at most ${MAX_SOURCE_FILES}`);
  }
  for (const p of paths) {
    if (ALWAYS_X.some((re) => re.test(p)) && card.level !== 'X')
      say(`${p} is an always-X path but the card is level ${card.level}`);
    if (MIGRATION.test(p) && card.level !== 'X' && card.level !== 'R')
      say(`${p} is a migration: level X, or R with no policy or trigger`);
    if (GENERATED.some((re) => re.test(p)))
      say(
        `Files: ${p} is written by a command, never by hand; say so in words, with no path at the start of the item`,
      );
  }
  for (const p of paths) if (outside(p)) say(`Files: ${p} ${PLAIN}`);
  for (const p of fileProblems(targets)) say(p);
  let rewritten = 0;
  for (const t of targets) {
    if (t.problem) say(`Files: ${t.problem}`);
    if (t.problem || card.done) continue;
    if (t.kind === 'new') {
      // Keeps finished cards from rotting: the commit that lands a card's work marks the card.
      if (repo.exists(t.path))
        say(
          `Files: ${t.path} is there already: mark the card Done if its work has landed ("Needs: …. Done."), or take away what an earlier attempt left`,
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
  if (body['Read first'] !== 'Nothing.')
    for (const stray of strays(body['Read first']))
      say(
        `Read first: every line is an item that starts with "- ", or the section says "Nothing." ("${stray.slice(0, 40)}")`,
      );
  for (const item of items(body['Read first'])) {
    const asked = readItem(item);
    if (asked.problem) {
      say(`Read first: ${asked.problem}`);
      continue;
    }
    total += asked.count;
    if (outside(asked.path)) say(`Read first: ${asked.path} ${PLAIN}`);
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

  // The driver runs the first block and passes or fails the card on how it ends; words around it are for the auditor.
  const fences = body.Run.split('\n').filter((l) => /^\s*(`{3,}|~{3,})/.test(l)).length;
  if (body.Run && (fences !== 2 || runScript(body.Run) === null))
    say(
      'Run must hold exactly one code block: the commands that are run, which fail when the card is not done',
    );

  const named = namedModel(text);
  if (named) say(`names a model ("${named}"); documents name none`);

  return problems;
}
