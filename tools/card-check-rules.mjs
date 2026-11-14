// Rules for task cards (docs/plan/README.md, "What a card looks like"). A card is followed step by
// step by a small model that can't tell a missing section or a stale path from a correct one, and
// that loses the end of a long page, so the shape and the length are checked here instead.

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

/** Most lines a card may ask its reader to read (the budget of a 16,000-token window). */
export const MAX_READ_LINES = 200;
export const MAX_SOURCE_FILES = 3;
/** Most lines a card may have. A level X card is read by the frontier model and may run longer. */
export const MAX_CARD_LINES = { S: 90, T: 90, R: 90, X: 120 };

// A unit (a letter, and a digit when the letter has several units) and a short name: F6-psychological, E-presets.
const CARD_ID = /^[A-Z][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEADER = /^Level: ([A-Z])\. Window: ([0-9,]+)\. Needs: (.+)\.$/;
const WINDOWS = ['16,000', '32,000'];
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
    sections: sections.map((s) => ({ name: s.name, body: s.body.join('\n').trim() })),
  };
}

/** Top-level list items of a section, each with its continuation lines joined. */
function items(body) {
  const out = [];
  for (const line of body.split('\n')) {
    if (/^- /.test(line)) out.push(line.slice(2));
    else if (out.length > 0 && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

const firstPath = (item) => /^`([^`]+)`/.exec(item)?.[1] ?? null;

/** Lines an item of "Read first" asks for: "(124 lines)", "(about 60 lines)", or "lines 56-73". */
export function linesAsked(item) {
  const range = /\blines (\d+)[-–](\d+)/.exec(item);
  if (range) return { count: Number(range[2]) - Number(range[1]) + 1, last: Number(range[2]) };
  const count = /\((?:about )?(\d+) lines\)/.exec(item);
  return count ? { count: Number(count[1]), last: null } : null;
}

/**
 * The problems of one card. `repo.exists(path)` and `repo.lineCount(path)` answer for the checkout,
 * so the rules can be tested without one.
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
  if (!WINDOWS.includes(card.window)) say('Window must be 16,000 or 32,000');
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

  const changed = items(body.Files).map(firstPath).filter(Boolean);
  const source = changed.filter((p) => !TEST_PATH.test(p) && !p.startsWith('docs/'));
  if (changed.length === 0) say('Files names no file');
  if (source.length > MAX_SOURCE_FILES) {
    say(`changes ${source.length} source files; a card changes at most ${MAX_SOURCE_FILES}`);
  }
  for (const p of changed) {
    if (ALWAYS_X.some((re) => re.test(p)) && card.level !== 'X')
      say(`${p} is an always-X path but the card is level ${card.level}`);
    if (MIGRATION.test(p) && card.level !== 'X' && card.level !== 'R')
      say(`${p} is a migration: level X, or R with no policy or trigger`);
  }

  let total = 0;
  for (const item of items(body['Read first'])) {
    const path = firstPath(item);
    if (!path) {
      say(`Read first: an item must start with a path in backticks ("${item.slice(0, 40)}…")`);
      continue;
    }
    const asked = linesAsked(item);
    if (!asked) say(`Read first: ${path} must say how many lines ("all of it (124 lines)" or "lines 56-73")`);
    else total += asked.count;
    const madeBy = /\(made by ([A-Z][0-9]*-[a-z0-9-]+)\)/.exec(item)?.[1];
    if (madeBy) {
      if (!card.needs.includes(madeBy))
        say(`Read first: ${path} is made by ${madeBy}, which is not under Needs`);
    } else if (!repo.exists(path)) {
      say(`Read first: ${path} does not exist (say "(made by <card>)" if an earlier card creates it)`);
    } else if (asked) {
      const actual = repo.lineCount(path);
      if (asked.last !== null && asked.last > actual)
        say(`Read first: ${path} has ${actual} lines, not ${asked.last}`);
      if (
        asked.last === null &&
        Math.abs(asked.count - actual) > Math.max(5, actual * 0.1) &&
        /all of it/.test(item)
      ) {
        say(`Read first: ${path} has ${actual} lines, the card says ${asked.count}`);
      }
    }
  }
  if (total > MAX_READ_LINES) say(`Read first asks for ${total} lines; the limit is ${MAX_READ_LINES}`);

  const named = MODEL_NAME.exec(text.replaceAll('CLAUDE.md', ''));
  if (named) say(`names a model ("${named[0]}"); documents name none`);

  return problems;
}
