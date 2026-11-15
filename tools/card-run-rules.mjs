// How a card is run by a model that cannot call tools (docs/plan/README.md, "The card driver").
// The model is sent the standing rules, the card, the lines the card says to read and the present
// content of what it changes. It answers with the complete new content of each part. Nothing in
// this file touches the disk, git or the network (card-run.mjs does), so every rule here is tested
// without them.
//
// What the model's reply can never do, by construction: name a file to write (parts are numbered,
// and their paths come from the card), have a command run (only the card's own are), or keep a
// line of a part by not mentioning it (a part is written whole).

import {
  checkCard,
  fileItem,
  items,
  MAX_REWRITE_LINES,
  parseCard,
  readItem,
  WINDOWS,
} from './card-check-rules.mjs';

/** The share of the window the prompt may fill. The rest is the reply's. */
export const PROMPT_SHARE = 0.6;
/** Lines of a failed command's output that the second attempt is shown. */
export const TROUBLE_LINES = 60;

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*[A-Za-z0-9_+.#-]*\s*$/;
const PART_HEADING = /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*|__)?\s*part\s+(\d+)(?:\*\*|__)?\s*(?:[:(\-–—].*)?$/i;

export const splitLines = (text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

/** The commands of a card: its first code block under Run. */
export function runScript(runBody) {
  const m = /^```[a-z]*\n([\s\S]*?)\n```\s*$/m.exec(runBody);
  return m ? m[1] : null;
}

/**
 * What a card needs before a model is asked: the lines to read, the parts to write with what is
 * there now, and the commands. `repo` answers for the checkout: exists, lineCount, read, and
 * unreadable(path), which says why a file may not be sent (missing, ignored by git, a link).
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
      if (repo.exists(t.path)) say(`Files: ${t.path} is there already`);
      targets.push({ n, kind: 'new', path: t.path, note: t.note, present: null });
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
    // The reply carries each part in a code block; a fence inside a part would end it early.
    if (present.some((l) => FENCE_OPEN.test(l)))
      say(
        `Files: ${t.path} has a line that is only a code fence, which a reply cannot carry; write this part by hand`,
      );
    rewritten += present.length;
    targets.push({ n, kind: t.kind, path: t.path, from, to, note: t.note, present });
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

/**
 * The two messages a model is sent. `again` is set for a second attempt: `trouble` says what went
 * wrong, and `written` holds the first attempt's parts when they were written to the files.
 */
export function buildPrompt(rules, plan, again = null) {
  const out = [];
  if (plan.reading.length > 0) {
    out.push(
      '# What the card tells you to read',
      '',
      'Each line starts with its number in the file and a colon. The numbers are not part of the file.',
    );
    for (const r of plan.reading) {
      out.push('', `## ${r.path}, ${r.whole ? `all ${r.lines.length} lines` : `lines ${r.from}-${r.to}`}`);
      if (r.note) out.push(r.note);
      out.push('', ...r.lines.map((l, i) => `${r.from + i}: ${l}`));
    }
    out.push('');
  }

  out.push('# What you change');
  for (const t of plan.targets) {
    const written = again?.written?.get(t.n) ?? null;
    out.push('', `## ${partTitle(t)}`);
    if (t.note) out.push(t.note);
    if (written) {
      out.push(
        'Your first attempt wrote this. Write the part again, whole, with the fault put right.',
        '',
        ...block(written),
      );
    } else if (t.kind === 'new') {
      out.push('Nothing is there yet. Write the whole file.');
    } else if (t.kind === 'whole') {
      out.push(
        `The file is there now, ${t.present.length} lines. Write the whole file with the card's changes made.`,
        '',
        ...block(t.present),
      );
    } else {
      out.push(
        `These ${t.present.length} lines are there now. Write what goes in their place: these lines with the card's changes made.`,
        '',
        ...block(t.present),
      );
    }
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

/** Whether a prompt leaves the reply room in the window, and how long the reply may run. */
export function budget(prompt, window, targets) {
  const sent = estimate(prompt.system + prompt.user);
  const most = Math.floor(window * PROMPT_SHARE);
  const numPredict = window - sent.high - 64;
  const again = estimate(targets.flatMap((t) => t.present ?? []).join('\n')).high;
  const problems = [];
  if (sent.high > most)
    problems.push(
      `the rules, the card, its reading and what it changes come to about ${sent.high} tokens; a window of ${window} takes ${most}, so that the reply has room`,
    );
  else if (again * 1.25 > numPredict)
    problems.push(`the ${again} tokens to be written again leave no room in a reply of ${numPredict}`);
  return { ...sent, numPredict, problems };
}

/**
 * The parts of a reply. A part is its heading ("### part 2") and the code block under it; anything
 * else in the reply is passed over. A reply with one block and no heading is taken for the one part
 * of a card that has one. "STOP:" with no part is the model saying it cannot do the card.
 */
export function parseReply(text, targets) {
  const lines = splitLines(text.replace(/^\s*<think>[\s\S]*?<\/think>/, ''));
  const found = [];
  const loose = [];
  const problems = [];
  let stopped = null;
  let heading = null;
  let open = null;
  for (const line of lines) {
    if (open) {
      const run = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (run && run[0] === open.fence[0] && run.length >= open.fence.length) {
        if (open.n === null) loose.push(open.lines);
        else found.push({ n: open.n, lines: open.lines });
        open = null;
      } else open.lines.push(line);
      continue;
    }
    const part = PART_HEADING.exec(line);
    const fence = FENCE_OPEN.exec(line)?.[1];
    if (part) {
      if (heading !== null) problems.push(`part ${heading} has no code block`);
      heading = Number(part[1]);
    } else if (fence) {
      open = { n: heading, fence, lines: [] };
      heading = null;
    } else if (stopped === null && /^\s*STOP:/.test(line)) {
      stopped = line.replace(/^\s*STOP:\s*/, '').trim() || 'no reason given';
    } else if (heading !== null && line.trim() !== '') {
      problems.push(`part ${heading} has no code block`);
      heading = null;
    }
  }
  if (open)
    problems.push(
      `the reply ends inside ${open.n === null ? 'a code block' : `part ${open.n}`}: it was cut off`,
    );
  if (heading !== null) problems.push(`part ${heading} has no code block`);

  if (found.length === 0 && loose.length === 1 && targets.length === 1 && problems.length === 0)
    found.push({ n: targets[0].n, lines: loose[0] });
  if (found.length === 0 && stopped !== null) return { parts: new Map(), problems: [], stopped };

  const parts = new Map();
  for (const { n, lines: content } of found) {
    if (!targets.some((t) => t.n === n)) problems.push(`part ${n} is not one of the parts asked for`);
    else if (parts.has(n)) problems.push(`part ${n} is written twice`);
    else parts.set(n, content);
  }
  for (const t of targets)
    if (!parts.has(t.n) && !found.some((f) => f.n === t.n)) problems.push(`part ${t.n} is missing`);
  if (found.length === 0 && loose.length > 0) problems.push('each part goes under its heading, "### part 1"');
  return { parts, problems, stopped: null };
}

const COMMENT = String.raw`(?:\/\/|#|\/\*+|\*|--|<!--)`;
const LEFT_OUT = [
  /^\s*(?:\.{3}|…)\s*$/,
  new RegExp(String.raw`^\s*${COMMENT}\s*(?:\.{3}|…)`),
  new RegExp(
    String.raw`^\s*${COMMENT}.*\b(?:rest of (?:the |this )?(?:file|code|function|class|method|implementation|content)|(?:existing|remaining|previous|other) (?:code|content|lines|functions|methods|cases|fields|imports|tests)|unchanged|same as (?:before|above)|omitted|as before|(?:implementation|code) (?:goes )?here)\b`,
    'i',
  ),
];

/**
 * What is wrong with the parts of a reply before they are written. A small model that tires of
 * copying writes "// ... rest unchanged"; written to the file, that line would delete the rest. A
 * line the model was itself given (in the card, its reading or the present content) is never
 * taken for one.
 */
export function partProblems(targets, parts, given) {
  const known = new Set(splitLines(given).map((l) => l.replace(/^\d+: /, '').trim()));
  const problems = [];
  const warnings = [];
  for (const t of targets) {
    const lines = parts.get(t.n);
    if (!lines) continue;
    const real = lines.filter((l) => l.trim() !== '');
    if (real.length === 0) {
      problems.push(`part ${t.n} is empty`);
      continue;
    }
    if (real.length >= 3 && real.filter((l) => /^\s*\d+[:|]\s/.test(l)).length >= real.length * 0.6)
      problems.push(
        `part ${t.n} has line numbers at the start of its lines; the numbers are not part of the file`,
      );
    const at = lines.findIndex((l) => LEFT_OUT.some((re) => re.test(l)) && !known.has(l.trim()));
    if (at >= 0)
      problems.push(
        `part ${t.n} leaves content out at its line ${at + 1} ("${lines[at].trim().slice(0, 60)}"); write every line`,
      );
    if (t.present && t.present.length >= 20 && lines.length < t.present.length / 2)
      warnings.push(
        `part ${t.n} (${t.path}) went from ${t.present.length} lines to ${lines.length}: check that nothing was dropped`,
      );
  }
  return { problems, warnings };
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
    const lines = splitLines(files.get(path));
    for (const t of [...list].sort((a, b) => b.from - a.from))
      lines.splice(t.from - 1, t.to - t.from + 1, ...trimEnd(parts.get(t.n)));
    out.set(path, `${lines.join('\n')}\n`);
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
      'Reply again, with every part whole.',
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
