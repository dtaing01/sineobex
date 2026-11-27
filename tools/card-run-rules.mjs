// How a card is run by a model that cannot call tools (docs/plan/README.md, "Running a card").
// The model is sent the standing rules, the card, the lines the card says to read and the present
// content of what it changes. It answers with the complete new content of each part. Nothing in
// this file touches the disk, git or the network (card-run.mjs does), so every rule here is tested
// without them.
//
// What a reply cannot do, by construction: name a file to write (parts are numbered, and their
// paths come from the card) or name a command to run (only the card's own are run). What it can
// do is write a part badly, so a part is refused when it leaves lines out, is a diff, carries line
// numbers, or drops most of the lines it was given.

import {
  checkCard,
  fileItem,
  items,
  MAX_REWRITE_LINES,
  parseCard,
  readItem,
  runScript,
  WINDOWS,
} from './card-check-rules.mjs';

/** The share of the window the prompt may fill. The rest is the reply's. */
export const PROMPT_SHARE = 0.6;
/** Lines of a failed command's output that the second attempt is shown. */
export const TROUBLE_LINES = 60;
/** A part of this many lines or more must bring back most of them, unless the card says "(replace)". */
export const KEPT_FROM = 12;
export const KEPT_SHARE = 0.6;
/** Tokens a reply may run to for each new file, over what it writes again: a model that loops stops there. */
export const NEW_FILE_TOKENS = 6000;

// An opening fence may carry anything after it ("ts title=a.ts"); a closing fence is bare.
const FENCE_OPEN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
// "### part 1", "**Part 1:** src/a.ts", "1. part 1", "Part 1 of 2". Not a sentence: "Part 1 creates the file."
const PART_HEADING =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:#{1,6}\s*)?[*_`]{0,3}\s*part\s*(\d+)\s*(?:\/\s*\d+|of\s+\d+)?\s*[*_`]{0,3}\s*(?:#+\s*$|\.?\s*$|[:(,\-–—`].*$)/i;
// "STOP: why", and the ways a model that thinks in markdown writes it: "**STOP:** why", "- STOP - why".
const STOP = /^\s*(?:[-*+>#]+\s*)?[*_`"']*(?:STOP|Stop)[*_`"']*\s*[:.\-–—]+\s*[*_`"']*\s*(.*)$/;

export const splitLines = (text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

/**
 * What a card needs before a model is asked: the lines to read, the parts to write with what is
 * there now, and the commands. `repo` answers for the checkout: exists and lineCount (for the card
 * check), read, unreadable(path), which says why a file that is there may not be sent (ignored by
 * git, a link, not a file), and unwritable(path), which says why a new file may not go there.
 */
export function planCard(file, text, repo) {
  const card = parseCard(text);
  const problems = checkCard(file, text, repo).map((p) => p.slice(file.length + 2));
  if (problems.length > 0) return { card, problems };
  const say = (m) => problems.push(m);
  if (card.level === 'X') say('a level X card is written by the frontier model, not by the small one');
  if (card.done) say('the card is marked Done');
  const body = Object.fromEntries(card.sections.map((s) => [s.name, s.body]));

  const reading = [];
  for (const item of items(body['Read first'])) {
    const asked = readItem(item);
    const why = repo.unreadable(asked.path);
    if (why) {
      say(`Read first: ${asked.path} ${why}`);
      continue;
    }
    const lines = splitLines(repo.read(asked.path));
    const to = asked.to ?? lines.length;
    if (to > lines.length) say(`Read first: ${asked.path} has ${lines.length} lines, not ${to}`);
    else
      reading.push({
        path: asked.path,
        from: asked.from,
        to,
        whole: asked.to === null,
        note: asked.note,
        lines: lines.slice(asked.from - 1, to),
      });
  }

  const targets = [];
  let rewritten = 0;
  for (const item of items(body.Files)) {
    const t = fileItem(item);
    if (t.kind === 'words') continue;
    const n = targets.length + 1;
    if (t.kind === 'new') {
      const why = repo.unwritable(t.path);
      if (why) say(`Files: ${t.path} ${why}`);
      targets.push({ n, kind: 'new', path: t.path, note: t.note, replace: false, present: null });
      continue;
    }
    const why = repo.unreadable(t.path);
    if (why) {
      say(`Files: ${t.path} ${why}`);
      continue;
    }
    const lines = splitLines(repo.read(t.path));
    const from = t.kind === 'region' ? t.from : 1;
    const to = t.kind === 'region' ? t.to : lines.length;
    if (to > lines.length) {
      say(`Files: ${t.path} has ${lines.length} lines, not ${to}`);
      continue;
    }
    const present = lines.slice(from - 1, to);
    // The reply carries each part in a code block; a bare fence inside a part would end it early.
    if (present.some((l) => FENCE_CLOSE.test(l)))
      say(
        `Files: ${t.path} has a line that is only a code fence, which a reply cannot carry; write this part by hand`,
      );
    rewritten += present.length;
    targets.push({ n, kind: t.kind, path: t.path, from, to, note: t.note, replace: t.replace, present });
  }
  // The card check counts only files that were there when it ran; a file an earlier card made is counted here.
  if (rewritten > MAX_REWRITE_LINES[card.window])
    say(
      `Files asks for ${rewritten} lines to be written again; the limit is ${MAX_REWRITE_LINES[card.window]}`,
    );

  const commands = runScript(body.Run);
  if (commands === null) say('Run has no code block of commands');

  return { card, body, problems, reading, targets, commands, window: WINDOWS[card.window] };
}

/** A fence no line of the content starts with. */
function fenceFor(lines) {
  const longest = Math.max(2, ...lines.map((l) => /^\s*(`+)/.exec(l)?.[1].length ?? 0));
  return '`'.repeat(longest + 1);
}

const block = (lines) => {
  const fence = fenceFor(lines);
  return [fence, ...lines, fence];
};

const partTitle = (t) =>
  t.kind === 'new'
    ? `part ${t.n}: ${t.path} (a new file)`
    : t.kind === 'whole'
      ? `part ${t.n}: ${t.path} (the whole file)`
      : `part ${t.n}: ${t.path}, lines ${t.from}-${t.to}`;

/** What a part's place holds, and what to write there. `written` is the first attempt's part, on a second. */
function partBody(t, written) {
  if (t.kind === 'new')
    return written
      ? [
          'Your first attempt wrote this. Write the file again, whole, with the fault put right.',
          '',
          ...block(written),
        ]
      : ['Nothing is there yet. Write the whole file.'];
  const what = t.kind === 'whole' ? `The file, ${t.present.length} lines` : `These ${t.present.length} lines`;
  const task = t.replace
    ? 'The card puts other lines in their place: write those.'
    : t.kind === 'whole'
      ? "Write the whole file with the card's changes made: every line, changed or not."
      : "Write what goes in their place: these lines with the card's changes made, every line, changed or not.";
  if (!written)
    return [
      `${what}, as ${t.kind === 'whole' ? 'it is' : 'they are'} now:`,
      '',
      ...block(t.present),
      '',
      task,
    ];
  return [
    `${what}, as ${t.kind === 'whole' ? 'it was' : 'they were'} before your first attempt:`,
    '',
    ...block(t.present),
    '',
    'Your first attempt wrote this in their place:',
    '',
    ...block(written),
    '',
    `Write the part again from the lines that were there, with the fault put right. ${task}`,
  ];
}

/**
 * The two messages a model is sent. `again` is set for a second attempt: `trouble` says what went
 * wrong, and `written` holds the first attempt's parts when they were written to the files.
 */
export function buildPrompt(rules, plan, again = null) {
  const out = [];
  const changed = new Set(again?.written ? plan.targets.map((t) => t.path) : []);
  if (plan.reading.length > 0) {
    out.push(
      '# What the card tells you to read',
      '',
      'Each line starts with its number in the file and a colon. The numbers are not part of the file.',
    );
    for (const r of plan.reading) {
      const before = changed.has(r.path) ? ' (as it was before your first attempt)' : '';
      out.push(
        '',
        `## ${r.path}, ${r.whole ? `all ${r.lines.length} lines` : `lines ${r.from}-${r.to}`}${before}`,
      );
      if (r.note) out.push(r.note);
      out.push('', ...r.lines.map((l, i) => `${r.from + i}: ${l}`));
    }
    out.push('');
  }

  out.push('# What you change');
  for (const t of plan.targets) {
    out.push('', `## ${partTitle(t)}`);
    if (t.note) out.push(t.note);
    out.push(...partBody(t, again?.written?.get(t.n) ?? null));
  }

  out.push('', '# The card', '', `## Card ${plan.card.id}: ${plan.card.title}`);
  for (const name of ['Goal', 'Steps', 'Tests']) out.push('', `### ${name}`, '', plan.body[name]);

  if (again) out.push('', '# What went wrong last time', '', again.trouble);

  const n = plan.targets.length;
  out.push(
    '',
    '# Your reply',
    '',
    n === 1
      ? 'Write this part as its heading and one code block. Write nothing else.'
      : `Write these ${n} parts, in this order, each as its heading and one code block. Write nothing else.`,
    '',
    ...plan.targets.map((t) => `### part ${t.n}`),
  );
  return { system: rules.trim(), user: out.join('\n') };
}

/** Tokens a text may come to. No tokenizer is at hand, so a range: code runs near 3 characters a token, prose near 4.5. */
export const estimate = (text) => ({ high: Math.ceil(text.length / 3), low: Math.floor(text.length / 5) });

/**
 * Whether a prompt leaves the reply room in the window, and how long the reply may run. `parts`
 * holds, for each part, the lines the reply must at least bring back (null for a new file).
 */
export function budget(prompt, window, parts) {
  const sent = estimate(prompt.system + prompt.user);
  const most = Math.floor(window * PROMPT_SHARE);
  const room = window - sent.high - 64;
  const again = estimate(parts.flatMap((p) => p.lines ?? []).join('\n')).high;
  const fresh = parts.filter((p) => p.lines === null).length;
  const numPredict = Math.max(0, Math.min(room, Math.max(2048, 2 * again + NEW_FILE_TOKENS * fresh + 1024)));
  const problems = [];
  if (sent.high > most)
    problems.push(
      `the rules, the card, its reading and what it changes come to about ${sent.high} tokens; a window of ${window} takes ${most}, so that the reply has room`,
    );
  else if (again * 1.25 > room)
    problems.push(`the ${again} tokens to be written again leave no room in a reply of ${room}`);
  return { ...sent, numPredict, problems };
}

const unindent = (line, indent) =>
  indent === ''
    ? line
    : line.startsWith(indent)
      ? line.slice(indent.length)
      : line.replace(new RegExp(`^\\s{0,${indent.length}}`), '');

/**
 * The parts of a reply. A part is its heading ("### part 2") and the first code block after it;
 * what stands between them, and around the parts, is passed over. A reply with one block and no
 * heading is taken for the one part of a card that has one. A line that starts with STOP, outside
 * the code blocks, is the model saying it cannot do the card: then no part counts.
 */
export function parseReply(text, targets) {
  let lines = splitLines(text.replace(/^\uFEFF/, '').replace(/^\s*<think>[\s\S]*?<\/think>/, ''));
  // A reply wrapped whole in one fence ("```markdown" above the first heading): the wrapper is not a part.
  const [first, second] = lines.flatMap((l, i) => (l.trim() === '' ? [] : [i])).slice(0, 2);
  const wrapped = second !== undefined && FENCE_OPEN.test(lines[first]) && PART_HEADING.test(lines[second]);
  if (wrapped) lines = lines.slice(first + 1);

  const blocks = [];
  const headings = new Set();
  let stopped = null;
  let heading = null;
  let open = null;
  for (const line of lines) {
    if (open) {
      const run = FENCE_CLOSE.exec(line)?.[1];
      if (run && run[0] === open.fence[0] && run.length >= open.fence.length) {
        blocks.push(open);
        open = null;
      } else open.lines.push(unindent(line, open.indent));
      continue;
    }
    const part = PART_HEADING.exec(line);
    const fence = FENCE_OPEN.exec(line);
    if (part) {
      heading = Number(part[1]);
      headings.add(heading);
    } else if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      open = { n: heading, fence: fence[2], indent: fence[1], lines: [] };
      heading = null;
    } else if (stopped === null) {
      const stop = STOP.exec(line);
      if (stop) stopped = stop[1].trim() || 'no reason given';
    }
  }
  const problems = [];
  const cut = open?.n ?? null;
  if (cut !== null) problems.push(`the reply ends inside part ${cut}: it was cut off`);
  // A fence left open with no heading: the closing fence of a wrapper is nothing; any other is a
  // fence that closed a part from inside it, or a block that was cut off.
  else if (open && !(wrapped && open.lines.every((l) => l.trim() === ''))) blocks.push(open);

  for (const b of blocks) {
    const real = b.lines.filter((l) => l.trim() !== '');
    if (stopped === null && real.length > 0 && real.every((l) => STOP.test(l)))
      stopped = STOP.exec(real[0])[1].trim() || 'no reason given';
  }
  if (stopped !== null) return { parts: new Map(), problems: [], stopped };

  let found = blocks.filter((b) => b.n !== null);
  const loose = blocks.filter((b) => b.n === null);
  if (
    found.length === 0 &&
    headings.size === 0 &&
    loose.length === 1 &&
    targets.length === 1 &&
    loose[0] !== open
  )
    found = [{ ...loose[0], n: targets[0].n }];
  else if (loose.length === 1 && loose[0] === open && found.length === 0)
    problems.push('the reply ends inside a code block: it was cut off');
  else if (loose.length > 0)
    problems.push(
      found.length > 0
        ? 'there is a code block outside the parts; if a part itself holds a line of ```, put four backticks around that part'
        : 'each part goes under its heading, "### part 1"',
    );

  const parts = new Map();
  for (const b of found) {
    if (!targets.some((t) => t.n === b.n)) problems.push(`part ${b.n} is not one of the parts asked for`);
    else if (parts.has(b.n)) problems.push(`part ${b.n} is written twice`);
    else parts.set(b.n, b.lines);
  }
  for (const t of targets) {
    if (found.some((b) => b.n === t.n) || t.n === cut) continue;
    problems.push(
      headings.has(t.n) ? `part ${t.n} has no code block under its heading` : `part ${t.n} is missing`,
    );
  }
  return { parts, problems, stopped: null };
}

const DOTS = String.raw`(?:\.{3,}|…|\.(?: \.){2,})`;
const MARK = String.raw`(?:\/\/+|#+|\/\*+|\*|--+|<!--)`;
const TAIL = String.raw`(?:\*\/|-->)?`;
// What a model writes where it tired of copying. Only what stands in place of lines: a comment
// that speaks of other fields being unchanged is a comment.
const WORDS = [
  /^(?:the\s+)?(?:rest|remainder)(?:\s+of\s+(?:the\s+|this\s+)?\w+)?(?:\s+(?:is|are|remains?|stays?))?(?:\s+(?:unchanged|the same|as before|as above|as is|omitted|here))?$/i,
  /^(?:all\s+)?(?:other|remaining|existing|previous)\s+\w+(?:\s+\w+)?(?:\s+(?:remain|remains|stay|stays|are|is|go|goes))?(?:\s+(?:unchanged|the same|omitted|here|as before|as is|as above))?$/i,
  /^(?:unchanged|omitted|no changes?(?:\s+(?:below|above|here)\b.*)?)$/i,
  /^same\s+as\s+(?:above|before)(?:\s+for\b.*)?$/i,
  /^as\s+(?:above|before)$/i,
  /^(?:add|put|insert|implement|write)\b.*\bhere$/i,
  /^.*\b(?:goes|go)\s+here$/i,
  /^(?:more|etc|snip|truncated\b.*|add\s+more\b.*)$/i,
  /^(?:original|previous|old)\s+(?:code|implementation|logic|content|imports?)$/i,
  /^(?:more|additional)\s+\w+(?:\s+(?:here|as needed|below))?$/i,
  /^lines?\s+\d+.*\bas\s+(?:they\s+were|before|is)$/i,
  /^(?:remaining|other)\s+\w+\s+as\s+in\b.*$/i,
  /^keep\s+(?:the\s+)?(?:existing|rest|remaining|other)\b.*$/i,
  /^(?:similar|same|likewise)\s+for\s+(?:the\s+)?(?:remaining|other|rest)\b.*$/i,
  /^implement\s+the\s+(?:remaining|rest|other)\b.*$/i,
];
const INNER = String.raw`(?:${DOTS}|unchanged|omitted|(?:existing|remaining|other|rest of)\b[^*]{0,40}|same as\b[^*]{0,40})`;
const LEFT_OUT = [
  // A line that is only an ellipsis, bare, in a comment or in brackets: "...", "// ...", "/* ... */", "[...]".
  new RegExp(String.raw`^\s*(?:${MARK}\s*)?[[({]?\s*${DOTS}\s*[\])}]?\s*${TAIL}\s*$`),
  // An ellipsis, a space, a few words ("... existing code", "// ... rest of the file"), or one at both ends.
  new RegExp(String.raw`^\s*(?:${MARK}\s*)?[[(]?\s*${DOTS}\s+(?:\S+\s*){1,6}${TAIL}\s*$`),
  new RegExp(String.raw`^\s*(?:${MARK}\s*)?${DOTS}.*${DOTS}\s*${TAIL}\s*$`),
  // A body or a child that is only a placeholder: "{ ... }", "{ /* ... */ }", "{/* existing fields */}".
  new RegExp(String.raw`\{\s*(?:${DOTS}|\/\*\s*${INNER}\s*\*\/)\s*\}`, 'i'),
  // Code, then a comment that starts with an ellipsis: "} // ... rest unchanged".
  new RegExp(String.raw`\S\s+\/\/\s*${DOTS}(?:\s|$)`),
];

/** Whether a line stands in place of lines that were left out. `words` also takes a short comment for one. */
export function leftOut(line, words) {
  if (LEFT_OUT.some((re) => re.test(line))) return true;
  if (!words) return false;
  const whole = new RegExp(String.raw`^\s*${MARK}\s*(.*?)\s*${TAIL}\s*$`).exec(line);
  const said = whole ? whole[1] : (/\s\/\/\s*(.*)$/.exec(line)?.[1] ?? null);
  if (said === null) return false;
  const bare = said.replace(/^[\s([]+|[\s)\].!:]+$/g, '');
  return bare.split(/\s+/).length <= 10 && WORDS.some((re) => re.test(bare));
}

/**
 * Whether a part carries line numbers: a line copied with its number from the reading, two
 * neighbouring lines numbered N and N+1, or a range whose first line starts with its own number.
 * "12: code" counts only from the start of the line: keys of a map are indented.
 */
function numbered(t, real, shown) {
  if (real.some((l) => shown.has(l.trimEnd()))) return true;
  const at = real
    .map((l) => /^(\d+): ?|^\s*(\d+)(?:\t|\s*\|\s?)/.exec(l))
    .map((m) => (m ? Number(m[1] ?? m[2]) : null));
  if (at.some((n, i) => i > 0 && n !== null && at[i - 1] !== null && n === at[i - 1] + 1)) return true;
  return t.kind === 'region' && at[0] === t.from && at.every((n) => n !== null);
}

/** A part given as a diff or as search-and-replace marks instead of the lines themselves. */
function isDiff(real) {
  if (real.some((l) => /^@@ .* @@/.test(l) || /^(?:<{7}|>{7})(?: |$)/.test(l))) return true;
  const plus = real.filter((l) => /^\+(?!\+)/.test(l)).length;
  const minus = real.filter((l) => /^-(?!-)/.test(l)).length;
  return plus > 0 && minus > 0 && plus + minus >= real.length / 2;
}

/**
 * What is wrong with the parts of a reply before they are written. A small model that tires of
 * copying writes only the lines it changed, or "// ... rest unchanged": written to the file, that
 * deletes the rest. A line that was already in the part's own place is never taken for a
 * placeholder; a line the model copied from a recipe or the card is.
 */
export function partProblems(plan, parts) {
  const shown = new Set(plan.reading.flatMap((r) => r.lines.map((l, i) => `${r.from + i}: ${l}`.trimEnd())));
  const problems = [];
  for (const t of plan.targets) {
    const lines = parts.get(t.n);
    if (!lines) continue;
    const real = lines.filter((l) => l.trim() !== '');
    if (real.length === 0) {
      problems.push(`part ${t.n} is empty`);
      continue;
    }
    if (lines.some((l) => /^\s*#/.test(l) && PART_HEADING.test(l)))
      problems.push(
        `part ${t.n} holds a line that is a part's heading: put each part's own lines, and nothing else, in its code block`,
      );
    if (numbered(t, real, shown))
      problems.push(
        `part ${t.n} has line numbers at the start of its lines; the numbers are not part of the file`,
      );
    if (isDiff(real)) problems.push(`part ${t.n} is a diff; write the lines themselves, every one`);
    // In a document a line of dots or a heading "Other fields" is writing; the lines brought back are counted below.
    const own = new Set((t.present ?? []).map((l) => l.trim()));
    const prose = /\.(md|txt)$/i.test(t.path);
    const at = prose ? -1 : lines.findIndex((l) => !own.has(l.trim()) && leftOut(l, t.present !== null));
    if (at >= 0)
      problems.push(
        `part ${t.n} leaves content out at its line ${at + 1} ("${lines[at].trim().slice(0, 60)}"); write every line`,
      );
    const had = (t.present ?? []).filter((l) => l.trim() !== '');
    if (!t.replace && had.length >= KEPT_FROM) {
      const now = new Set(lines.map((l) => l.trim()));
      const kept = had.filter((l) => now.has(l.trim())).length;
      if (kept < had.length * KEPT_SHARE)
        problems.push(
          `part ${t.n} brings back ${kept} of the ${had.length} lines that were there; write every line of the part, changed or not`,
        );
    }
  }
  return problems;
}

/**
 * The new content of each file. `files` holds what is there now (null for a new file). Line ranges
 * of one file are put in from the bottom up, so that the lines above keep their numbers.
 */
export function applyParts(files, targets, parts) {
  const out = new Map();
  const byPath = new Map();
  for (const t of targets) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]);
  for (const [path, list] of byPath) {
    if (list[0].kind !== 'region') {
      out.set(path, `${trimEnd(parts.get(list[0].n)).join('\n')}\n`);
      continue;
    }
    // Only the named lines are this card's to change: the file keeps its line ending, its last
    // newline or the lack of one, and the blank lines a range ended with.
    const was = files.get(path);
    const eol = was.includes('\r\n') ? '\r\n' : '\n';
    const lines = splitLines(was);
    for (const t of [...list].sort((a, b) => b.from - a.from)) {
      const range = lines.slice(t.from - 1, t.to);
      const blanks = Array(range.length - trimEnd(range).length).fill('');
      lines.splice(t.from - 1, t.to - t.from + 1, ...trimEnd(parts.get(t.n)), ...blanks);
    }
    out.set(path, `${lines.join(eol)}${was === '' || was.endsWith('\n') ? eol : ''}`);
  }
  return out;
}

function trimEnd(lines) {
  const out = [...lines];
  while (out.length > 0 && out.at(-1).trim() === '') out.pop();
  return out;
}

/** What a second attempt is told. */
export function trouble(kind, detail) {
  if (kind === 'reply')
    return [
      'Your last reply could not be used:',
      ...detail.map((p) => `- ${p}`),
      '',
      'Reply again: each part under its heading, in one code block, with every line of the part.',
    ].join('\n');
  const tail = splitLines(detail).slice(-TROUBLE_LINES);
  return [
    "Your first attempt was written to the files, and the card's commands were run. They failed. The end of their output:",
    '',
    ...block(tail),
    '',
    'Put the fault right and reply again, with every part whole.',
  ].join('\n');
}
