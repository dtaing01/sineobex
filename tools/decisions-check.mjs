#!/usr/bin/env node
// Decisions document check: every PLAN-OPEN marker outside Markdown belongs to exactly one row of
// docs/decisions-for-review.md, and each row's Where names the files its markers are in. The
// project lead's rule (Nov 21) is that a choice needing a person is built as a default, marked in
// the code and listed in that document, which is reviewed once the MVP is built: a marker with no
// row is a default nobody will be asked about. A marker names its row ("PLAN-OPEN (TM-6): …"); an
// older one without a row id is matched to its row by decisions-check-rules.mjs, which holds its
// words and only shrinks.
//
//   node tools/decisions-check.mjs [--list <file>]
//
// --list writes every marker to the file with its row and its question. Exit: 0 clean, 1 problems
// found, 2 not run (an argument it doesn't know).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './decisions-check-rules.mjs';

export const DOC = 'docs/decisions-for-review.md';
const RULES_FILE = 'tools/decisions-check-rules.mjs';
/** The checker's own files hold the word in their rules, messages and fixtures, never as a marker. */
export const NOT_MARKERS = [
  'tools/decisions-check.mjs',
  'tools/decisions-check-rules.mjs',
  'tools/test/decisions-check.test.mjs',
];

const MARK = 'PLAN-OPEN';
const ROW_ID = /^PLAN-OPEN \(((?:PL|BM|CO|TM)-\d+)\)/;
// Meant as a row id but not one: another prefix or case, no space, or more inside the brackets.
const LIKE_ROW_ID = /^PLAN-OPEN\s*\(\s*([A-Za-z]{2}\s*-\s*\d+[^)]*)\)/;
const EXAMPLE = 'PLAN-OPEN (BM-12): …';

const unescape = (s) => s.replace(/\\(.)/g, '$1');
// How each kind of file writes its comments and strings. A marker in a kind not listed is
// reported rather than guessed at, so that no marker is read as something it isn't.
const KINDS = [
  {
    files: /\.([cm]?[jt]sx?|dart|kts?|gradle|java|swift)$/,
    line: '//',
    block: true,
    quotes: '\'"`',
    unescape,
  },
  { files: /\.(ya?ml|sh|bash|toml|py)$/, line: '#', quotes: '\'"', unescape },
  // SQL writes a quote inside a string twice ('it''s'), and a backslash is only a backslash.
  {
    files: /\.sql$/,
    line: '--',
    block: true,
    quotes: '\'"',
    doubled: true,
    unescape: (s) => s.replace(/('|")\1/g, '$1'),
  },
  { files: /\.json$/, quotes: '"', json: true, unescape: (s) => JSON.parse(`"${s}"`) },
];
/** The code, comments and strings of one line, each with where it starts and ends. */
function partsOf(line, kind) {
  const parts = [];
  let from = 0;
  const code = (end) => {
    if (end > from) parts.push({ kind: 'code', start: from, end });
  };
  for (let i = 0; i < line.length;) {
    // A "#" starts a comment only at the start of a word: "$#" and "${#a}" are shell, not comments.
    if (kind.line && line.startsWith(kind.line, i) && (kind.line !== '#' || !/\S/.test(line[i - 1] ?? ' '))) {
      code(i);
      parts.push({ kind: 'comment', start: i, end: line.length });
      return parts;
    }
    if (kind.block && line.startsWith('/*', i)) {
      code(i);
      const close = line.indexOf('*/', i + 2);
      const end = close < 0 ? line.length : close + 2;
      parts.push({ kind: 'block', start: i, end, open: close < 0 });
      i = from = end;
      continue;
    }
    // A quote straight after a letter is an apostrophe in text (JSX, a YAML value), not a string.
    if (kind.quotes.includes(line[i]) && !/\w/.test(line[i - 1] ?? '')) {
      code(i);
      let j = i + 1;
      for (; j < line.length; j++) {
        if (kind.doubled ? line[j] === line[i] && line[j + 1] === line[i] : line[j] === '\\') j++;
        else if (line[j] === line[i]) break;
      }
      const end = Math.min(j + 1, line.length);
      parts.push({ kind: 'string', start: i, end, open: j >= line.length });
      i = from = end;
      continue;
    }
    i += line[i] === '\\' ? 2 : 1;
  }
  code(line.length);
  return parts;
}

/** A line that is only a line comment: where its text starts, and the text. */
function lineComment(line, kind) {
  const t = line.trimStart();
  // A script's "#!" line says what runs it; the comment under it is not its continuation.
  if (!kind.line || !t.startsWith(kind.line) || t.startsWith('#!')) return null;
  let col = line.length - t.length;
  while (line[col] === kind.line[0]) col++;
  if (line[col] === ' ') col++;
  return { col, text: line.slice(col).trimEnd() };
}

/** A block comment's lines from its "/*" at column col of line n to its close, each with where its text starts. */
function blockAt(lines, n, col) {
  const out = [];
  for (let k = n; k < lines.length; k++) {
    const line = lines[k];
    let start = k === n ? col + 2 : /^\s*(\*(?!\/))?/.exec(line)[0].length;
    if (k === n) while (line[start] === '*' && line[start + 1] !== '/') start++;
    const close = line.indexOf('*/', k === n ? col + 2 : start);
    const raw = line.slice(start, close < 0 ? line.length : Math.max(start, close));
    out.push({ n: k, col: start + raw.length - raw.trimStart().length, text: raw.trim() });
    if (close >= 0) return { lines: out, close: { n: k, col: close + 2 } };
  }
  return { lines: out, close: null };
}

/** The opening "/*" of a block comment that line n is inside, or null. */
function openerAbove(lines, n, kind) {
  for (let k = n - 1; k >= 0; k--) {
    if (lines[k].includes('*/')) return null;
    const last = partsOf(lines[k], kind).at(-1);
    if (last?.kind === 'block' && last.open) return { n: k, col: last.start };
  }
  return null;
}

const inside = (block, n, p) =>
  block.close === null || n < block.close.n || (n === block.close.n && p < block.close.col - 2);

/** The run of non-empty lines around line n as one text, and where column p of line n is in it. */
function paragraph(entries, n, p) {
  let a = entries.findIndex((e) => e.n === n);
  let b = a;
  while (a > 0 && entries[a - 1].text !== '') a--;
  while (b + 1 < entries.length && entries[b + 1].text !== '') b++;
  let text = '';
  let at = 0;
  for (const e of entries.slice(a, b + 1)) {
    if (text !== '') text += ' ';
    if (e.n === n) at = text.length + p - e.col;
    text += e.text;
  }
  return { text, at };
}

const marksIn = (text) => [...text.matchAll(/PLAN-OPEN/g)].map((m) => m.index);

const WORDS = 60;
/**
 * What a rule holds of an older marker: what it says from "PLAN-OPEN" up to the next marker, cut at
 * a word within WORDS characters. That tells it from every other marker of its file, so a marker
 * written later, or one reworded, is not taken for it.
 */
export function wordsOf(own) {
  const text = own
    .slice(0, marksIn(own).find((m) => m > 0) ?? own.length)
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= WORDS) return text;
  const cut = text.lastIndexOf(' ', WORDS);
  // A long word near the start (a path, a link) is cut through, not dropped with all after it.
  return text.slice(0, cut > WORDS / 2 ? cut : WORDS);
}

/** A string's text, and where in it the marker at column p of the source sits. */
function inString(line, part, p, unescape) {
  const inner = line.slice(part.start + 1, part.open ? line.length : part.end - 1);
  let text;
  try {
    text = unescape(inner);
  } catch {
    text = inner;
  }
  // The k-th marker of the source is the k-th of the text: escapes before it move it.
  const at = marksIn(text)[marksIn(inner.slice(0, p - part.start - 1)).length];
  return at === undefined ? { text: inner, at: p - part.start - 1 } : { text, at };
}

/** Where the marker at column p of line n sits: the text it is read from, and where in it it starts. */
function holderOf(lines, n, p, kind) {
  const line = lines[n];
  if (!kind.json) {
    const own = lineComment(line, kind);
    if (own) {
      const entries = [];
      let a = n;
      let b = n;
      while (a > 0 && lineComment(lines[a - 1], kind)?.text) a--;
      while (b + 1 < lines.length && lineComment(lines[b + 1], kind)?.text) b++;
      for (let k = a; k <= b; k++) entries.push({ n: k, ...lineComment(lines[k], kind) });
      return paragraph(entries, n, p);
    }
    // A line of a block comment that opened above, with a "*" in front or none.
    const opener = kind.block ? openerAbove(lines, n, kind) : null;
    if (opener) {
      const block = blockAt(lines, opener.n, opener.col);
      if (inside(block, n, p)) return paragraph(block.lines, n, p);
    }
  }
  const part = partsOf(line, kind).find((pt) => pt.start <= p && p < pt.end);
  // A comment after code is about that code; "{" is how JSX opens one ("{/* … */}").
  const on = line
    .slice(0, part?.start ?? 0)
    .trim()
    .replace(/\{$/, '')
    .trim();
  if (part?.kind === 'comment' && !kind.json) {
    let col = part.start + kind.line.length;
    while (line[col] === kind.line[0]) col++;
    if (line[col] === ' ') col++;
    return { text: line.slice(col).trimEnd(), at: p - col, on };
  }
  if (part?.kind === 'block') {
    const block = blockAt(lines, n, part.start);
    return { ...paragraph(block.lines, n, p), on };
  }
  if (part?.kind === 'string') return inString(line, part, p, kind.unescape);
  return { problem: "can't tell which comment or string holds this marker: write it in a comment" };
}

/** The question a marker asks: its sentence, from where the marker stands up to the next marker. */
function questionAt(text, at) {
  const next = marksIn(text).find((m) => m > at) ?? text.length;
  const lead = text.slice(0, at).trimEnd();
  const end = Math.max(lead.lastIndexOf('. '), lead.lastIndexOf('): '));
  const sentence = lead.slice(end + 1);
  const open = (sentence.match(/\(/g)?.length ?? 0) > (sentence.match(/\)/g)?.length ?? 0);
  // A marker in the middle of a sentence ("is PLAN-OPEN 12.1 #14", "(9.8; PLAN-OPEN 12.1 #12)") is
  // read with all of it; one that starts a sentence or a clause is read from where it stands.
  const from = lead === '' || (/[.;:?!]$/.test(lead) && !open) ? at : end < 0 ? 0 : end + 2;
  return text.slice(from, next).replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
}

/**
 * Every marker in one file: its line, the row it names (or null), its words and its question, and a
 * problem when it cannot be read as a marker. A line may hold several (a forms diff file's "why");
 * each is its own. A comment's markers are read across its lines, so a row id may wrap.
 */
export function markersIn(file, text) {
  const lines = text.split(/\r?\n/);
  const kind = KINDS.find((k) => k.files.test(file));
  const found = [];
  lines.forEach((line, n) => {
    for (let p = line.indexOf(MARK); p >= 0; p = line.indexOf(MARK, p + MARK.length)) {
      const at = { file, line: n + 1 };
      const where = kind
        ? holderOf(lines, n, p, kind)
        : {
            problem:
              "can't read a marker in this kind of file: teach KINDS in tools/decisions-check.mjs its comments",
          };
      if (where.problem) {
        found.push({ ...at, id: null, question: line.trim(), problem: where.problem });
        continue;
      }
      const own = where.text.slice(where.at);
      const id = ROW_ID.exec(own)?.[1] ?? null;
      const like = id ? null : LIKE_ROW_ID.exec(own);
      found.push({
        ...at,
        id,
        words: wordsOf(own),
        question: questionAt(where.text, where.at) + (where.on ? ` [on: ${where.on}]` : ''),
        problem: like
          ? `"${like[0]}" is not a row id: write it as in "${EXAMPLE}", with PL, BM, CO or TM (a row of "Before the first real patient" needs no decision, so no marker names one)`
          : null,
      });
    }
  });
  return found;
}

const ROW = /^(?:PL|BM|CO|TM|BF)-\d+$/;
// A path in a Where cell: a backticked token with a "/" in it, or a file at the root ("CLAUDE.md").
const ROOT_FILE = /^[\w.-]+\.(md|mjs|js|ts|tsx|dart|json|ya?ml|sql|kts|sh|txt)$/;

/** a/{b,c}.ts is a/b.ts and a/c.ts. */
function expand(p) {
  const b = /\{([^{}]*)\}/.exec(p);
  if (!b) return [p];
  return b[1].split(',').flatMap((alt) => expand(p.slice(0, b.index) + alt + p.slice(b.index + b[0].length)));
}

/** The paths a Where cell names, braces expanded. */
export const pathsIn = (cell) =>
  [...cell.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((t) => (t.includes('/') && !/\s/.test(t)) || ROOT_FILE.test(t))
    .flatMap(expand);

/** Whether a path a Where names is the file, "*" standing for any part of one name. */
export const globMatch = (pattern, file) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(file);

// GitHub cuts a table row at every "|" not written "\|".
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/**
 * The document's rows by id, each with its line, its Where cell and the paths that names, and what
 * is wrong with the tables. A table whose header starts "#" lists decisions; its Where column is
 * the sixth for a decider and the fourth for "Before the first real patient".
 */
export function readRows(doc) {
  const rows = new Map();
  const problems = [];
  let header = null;
  let fence = null;
  let comment = false;
  doc
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line, i) => {
      const at = `${DOC}:${i + 1}`;
      // A row the page doesn't show lists nothing: one in a fenced block (``` or ~~~), an HTML
      // comment or a block indented as code is an example or a row put away, as Markdown reads it.
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      const shown = fence === null && !comment && !open && !/^ {0,3}<!--/.test(line);
      if (comment) comment = !line.includes('-->');
      else if (fence !== null) {
        if (open?.[0] === fence[0] && open.length >= fence.length && line.trim() === open) fence = null;
      } else if (open) fence = open;
      else if (!shown) comment = !line.includes('-->');
      if (!shown || !/^ {0,3}\|/.test(line)) {
        header = null;
        return;
      }
      const cells = cellsOf(line);
      if (header === null) {
        header = cells;
        return;
      }
      if (header[0] !== '#' || cells.every((c) => /^:?-+:?$/.test(c))) return;
      const id = cells[0];
      if (!ROW.test(id)) {
        problems.push(`${at}: a row starts with its id, as "TM-6", not "${id}"`);
        return;
      }
      if (rows.has(id)) {
        problems.push(`${at}: row ${id} is there twice (first at line ${rows.get(id).line})`);
        return;
      }
      const w = header.indexOf('Where');
      // A row that can't be read is reported once; what it would say is not checked.
      const broken = w < 0 || cells.length !== header.length;
      if (w < 0) problems.push(`${at}: row ${id}'s table has no Where column`);
      else if (broken)
        problems.push(
          `${at}: row ${id} has ${cells.length} cells and its table ${header.length}: a "|" inside a cell is written "\\|"`,
        );
      const where = broken ? '' : cells[w];
      rows.set(id, { id, line: i + 1, where, paths: pathsIn(where), broken });
    });
  return { rows, problems };
}

const nMarkers = (n) => `${n} marker${n === 1 ? '' : 's'}`;

// A rule is [row, words] or [row, words, count], its words as wordsOf cuts them.
const isRule = (r) =>
  Array.isArray(r) &&
  (r.length === 2 || r.length === 3) &&
  typeof r[0] === 'string' &&
  ROW.test(r[0]) &&
  typeof r[1] === 'string' &&
  r[1].startsWith(MARK) &&
  wordsOf(r[1]) === r[1] &&
  (r.length === 2 || (Number.isInteger(r[2]) && r[2] > 0));

/** The rules of decisions-check-rules.mjs as one list, each with its file; one it can't read is a problem. */
function ruleList(rules, problems) {
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
    problems.push(`${RULES_FILE}: RULES is not the files, each with its rules`);
    return [];
  }
  return Object.entries(rules).flatMap(([file, list]) =>
    (Array.isArray(list) ? list : [list]).flatMap((r, i) => {
      if (isRule(r)) return [{ row: r[0], file, words: r[1], count: r[2] ?? 1 }];
      problems.push(
        `${RULES_FILE}: rule ${i + 1} for ${file} is not [row, words] or [row, words, count], with the words as the check cuts them`,
      );
      return [];
    }),
  );
}

/**
 * The check. `markers` as markersIn gives them, `rules` as decisions-check-rules.mjs holds them,
 * `exists(path)` whether a path a Where names is in the repository ("*" in it standing for any part
 * of one name). Returns the problems, every marker with the row it belongs to (null when none),
 * and the rows.
 */
export function checkDecisions({ doc, markers, rules, exists }) {
  const { rows, problems } = readRows(doc);
  const list = ruleList(rules, problems);
  const nameOf = (r) => `the rule for ${r.row} in ${r.file} ("${r.words}")`;
  const takes = list.map(() => []);
  const assigned = [];
  for (const mk of markers) {
    const loc = `${mk.file}:${mk.line}`;
    let row = null;
    if (mk.problem) problems.push(`${loc}: ${mk.problem}`);
    else if (mk.id) row = mk.id;
    else {
      const hits = list.flatMap((r, i) => (r.file === mk.file && r.words === mk.words ? [i] : []));
      const q = mk.question.length > 100 ? `${mk.question.slice(0, 100)}…` : mk.question;
      if (hits.length === 1) {
        row = list[hits[0]].row;
        takes[hits[0]].push(mk);
      } else if (hits.length === 0)
        problems.push(
          `${loc}: this marker has no row: name its row, as in "${EXAMPLE}", and add that row to ${DOC} under its decider if it isn't there ("${q}")`,
        );
      else
        problems.push(
          `${loc}: the rules for ${hits.map((i) => list[i].row).join(', ')} all hold its words, and it belongs to one row: name it, as in "${EXAMPLE}" ("${q}")`,
        );
    }
    assigned.push({ ...mk, row });
    const r = row && rows.get(row);
    if (mk.id && !r) problems.push(`${loc}: names row ${row}, which is not in ${DOC}`);
    else if (r && !r.broken && !r.paths.some((p) => globMatch(p, mk.file)))
      problems.push(`${loc}: row ${row}'s Where does not name ${mk.file}`);
  }

  list.forEach((r, i) => {
    const { row, count } = r;
    const name = nameOf(r);
    if (!rows.has(row)) problems.push(`${RULES_FILE}: ${name} names a row that is not in ${DOC}`);
    const n = takes[i].length;
    // A rule takes the markers it was written for and no more, so a new marker names its row.
    if (n === 0) problems.push(`${RULES_FILE}: ${name} takes no marker any more: delete it`);
    else if (n > count)
      problems.push(
        `${RULES_FILE}: ${name} takes ${nMarkers(n)}, not ${count}: a new marker names its row, as in "PLAN-OPEN (${row}): …" (${takes[i].map((m) => `${m.file}:${m.line}`).join(', ')})`,
      );
    else if (n < count)
      problems.push(
        `${RULES_FILE}: ${name} takes ${nMarkers(n)}, not ${count}: write ${n}, as a rule only shrinks`,
      );
  });

  const byRow = new Map();
  const rowsIn = new Map();
  for (const a of assigned) {
    if (!a.row) continue;
    byRow.set(a.row, [...(byRow.get(a.row) ?? []), a]);
    rowsIn.set(a.file, (rowsIn.get(a.file) ?? new Set()).add(a.row));
  }
  for (const r of rows.values()) {
    if (r.broken) continue;
    const at = `${DOC}:${r.line}`;
    for (const p of r.paths)
      if (!exists(p)) problems.push(`${at}: row ${r.id} names ${p}, which does not exist`);
    const held = byRow.get(r.id) ?? [];
    // "Before the first real patient" asks for a person or an account, not a decision in code.
    if (!r.id.startsWith('BF-')) {
      const says = /no marker/.test(r.where);
      if (held.length === 0 && !says)
        problems.push(`${at}: row ${r.id} has no marker in the code and its Where doesn't say "no marker"`);
      if (held.length > 0 && says)
        problems.push(
          `${at}: row ${r.id}'s Where says "no marker", but ${nMarkers(held.length)} ${held.length === 1 ? 'belongs' : 'belong'} to it (${held[0].file}:${held[0].line})`,
        );
    }
    if (held.length === 0) continue;
    for (const p of r.paths) {
      const there = p.includes('*') ? null : rowsIn.get(p);
      if (there && !there.has(r.id))
        problems.push(
          `${at}: row ${r.id} names ${p}, whose markers are all other rows' (${[...there].join(', ')})`,
        );
    }
  }
  return { problems, assigned, rows };
}

/** The per-marker list: a summary, then one line per marker (file:line, row, question). */
export function listing({ problems, assigned, rows }, head = 'HEAD') {
  const counts = {};
  for (const id of rows.keys()) counts[id.slice(0, 2)] = (counts[id.slice(0, 2)] ?? 0) + 1;
  const held = new Set(assigned.map((a) => a.row).filter(Boolean));
  const without = [...rows.keys()].filter((id) => !held.has(id) && !id.startsWith('BF-'));
  const named = assigned.filter((a) => a.id).length;
  return [
    `# ${assigned.length} PLAN-OPEN markers at ${head}, each with the row it belongs to`,
    `# rows: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
    `# rows with markers: ${held.size}; decider rows with no marker in code: ${without.length} (${without.join(', ')})`,
    `# markers that name their row: ${named}; taken by a rule: ${assigned.filter((a) => a.row && !a.id).length}`,
    `# problems: ${problems.length}`,
    ...problems.map((p) => `# PROBLEM ${p}`),
    ...assigned.map((a) => `${a.file}:${a.line}\t${a.row ?? '-'}\t${a.question}`),
    '',
  ].join('\n');
}

function main(args) {
  const USAGE = 'Usage: node tools/decisions-check.mjs [--list <file>]';
  let list = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list' && args[i + 1]) list = args[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }
  const root = fileURLToPath(new URL('..', import.meta.url));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
  let found = '';
  try {
    found = git('grep', '-l', '-z', '-I', '-F', '-e', MARK, '--', '.', ':(exclude)*.md');
  } catch (e) {
    // git grep exits 1 when nothing matches.
    if (e.status !== 1) throw e;
  }
  const files = found.split('\0').filter((f) => f !== '' && !NOT_MARKERS.includes(f));
  const markers = files.flatMap((f) => markersIn(f, readFileSync(join(root, f), 'utf8')));
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const known = new Set(tracked);
  const exists = (p) =>
    p.includes('*')
      ? tracked.some((f) => globMatch(p, f))
      : (known.has(p) && existsSync(join(root, p))) ||
        tracked.some((f) => f.startsWith(`${p.replace(/\/$/, '')}/`));
  const result = checkDecisions({
    doc: readFileSync(join(root, DOC), 'utf8'),
    markers,
    rules: RULES,
    exists,
  });
  if (list) {
    let head = 'HEAD';
    try {
      head = git('rev-parse', '--short', 'HEAD').trim();
    } catch {
      // A repository with no commit yet.
    }
    writeFileSync(list, listing(result, head));
  }
  const { problems, assigned } = result;
  if (problems.length > 0) {
    console.error(`Decisions document check found ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  const named = assigned.filter((a) => a.id).length;
  console.log(
    `Decisions document check: ${assigned.length} markers clean, ${named} naming their row and ${assigned.length - named} by rule`,
  );
  return 0;
}

// Run as a command; the tests import it.
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(self))
  process.exit(main(process.argv.slice(2)));
