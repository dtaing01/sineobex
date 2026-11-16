/**
 * The spec check (docs/design/phase-4/forms.md, 4.1 and 4.2). A definition is typed by hand from a
 * piece of the field specification, saved beside it as definitions/spec/<piece>.txt. This check
 * reads the option words of the piece and the option labels of the sections that name it, and
 * fails on a word that is in one and not in the other, unless <piece>.diff.json declares it.
 *
 * It checks the words, nothing else: which field an option belongs to, how many a field has and
 * every decision the specification does not make are the shape check's (src/shape-check.ts).
 *
 * Pure: the export reads the files of definitions/spec and hands their text over.
 */
import { listFile, SURFACE_LIST } from './resolve.ts';
import type { DefinitionFiles, FileProblem } from './resolve.ts';
import type { Field, ListRef, Module, NoteType, Option, Section } from './types.ts';

/** A line of the specification that must not be copied is replaced by this. The line is skipped. */
export const LEFT_OUT = '[left out]';

/** The three files of a piece, by the piece's name. The two JSON files are parsed and not yet trusted. */
export type Piece = { text?: string; diff?: unknown; shape?: unknown };
export type Pieces = Readonly<Record<string, Piece>>;

export const pieceText = (piece: string): string => `spec/${piece}.txt`;
export const pieceDiff = (piece: string): string => `spec/${piece}.diff.json`;
export const pieceShape = (piece: string): string => `spec/${piece}.shape.json`;

// A section's `spec` (the schema's specPiece), then one of the three endings.
const PIECE_FILE = /^spec\/([a-z0-9][a-z0-9-]{0,60})\.(txt|diff\.json|shape\.json)$/;

/**
 * The pieces among the files of definitions/spec: `texts` is each file's content by its path under
 * definitions/. `spec.unknown_file`: a file that is none of a piece's three. `spec.bad_json`: a
 * diff or shape file that does not parse.
 */
export function readPieces(texts: Readonly<Record<string, string>>): {
  pieces: Record<string, Piece>;
  problems: FileProblem[];
} {
  const pieces: Record<string, Piece> = {};
  const problems: FileProblem[] = [];
  for (const [file, text] of Object.entries(texts)) {
    const [, name, ending] = PIECE_FILE.exec(file) ?? [];
    if (!name) {
      problems.push({
        file,
        path: '$',
        rule: 'spec.unknown_file',
        message: 'is not a piece’s <piece>.txt, <piece>.diff.json or <piece>.shape.json',
      });
      continue;
    }
    const piece = (pieces[name] ??= {});
    if (ending === 'txt') {
      piece.text = text;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problems.push({ file, path: '$', rule: 'spec.bad_json', message: 'is not JSON: it does not parse' });
      continue;
    }
    if (ending === 'diff.json') piece.diff = parsed;
    else piece.shape = parsed;
  }
  return { pieces, problems };
}

/** The pieces no section names yet: nothing is checked against them. The export decides what that means. */
export function unnamedPieces(pieces: Pieces, files: DefinitionFiles): string[] {
  const named = new Set<string>();
  for (const { file } of definitionsOf(files))
    for (const section of file.sections) if ('spec' in section && section.spec) named.add(section.spec);
  return Object.keys(pieces)
    .filter((piece) => !named.has(piece))
    .sort();
}

/** Every note type version and module version: the files that hold sections. */
export function definitionsOf(files: DefinitionFiles): { name: string; file: NoteType | Module }[] {
  return [...Object.entries(files.noteTypes), ...Object.entries(files.modules)].map(([name, file]) => ({
    name,
    file,
  }));
}

/** The sections of a file that name each piece, with each one's place in the file. */
export function sectionsByPiece(file: NoteType | Module): Map<string, { section: Section; at: string }[]> {
  const byPiece = new Map<string, { section: Section; at: string }[]>();
  file.sections.forEach((section, index) => {
    if ('include' in section || !section.spec) return;
    byPiece.set(section.spec, [
      ...(byPiece.get(section.spec) ?? []),
      { section, at: `$.sections[${index}]` },
    ]);
  });
  return byPiece;
}

// ---------------------------------------------------------------------------------------------
// The words of a piece.

/** One option word of a piece: where it is, and how the specification wrote it. */
export type SpecWord = { text: string; line: number; from: 'bracket' | 'bullet' | 'line' };

/**
 * The option words of a piece's lines (lines count from 1), in three ways of writing them:
 *  - `bracket`: every bracketed word, `[ New concern ]`, wherever it is
 *  - `bullet`: a bullet line (`•` or `◦`) that holds no bracket
 *  - `line`: a numbered line with nothing nested under it and no bracket in it, or in the lines
 *    that continue it: an option of a list written without brackets
 * Not every one of them is an option (a text box, a button that does something, an example value):
 * those the diff file lists under `notOptions`. A line that holds `[left out]` is skipped.
 *
 * The export's noise is undone first: `&#91;` and `&#32;`, a backslash before a bracket or any
 * other punctuation, a backslash that ends a line, the no-break space. A word's spaces are trimmed
 * and runs of them made one. `unclosed` lists the lines with a bracket that has no partner: a word
 * there could be missed in silence.
 */
export function specWords(text: string): { words: SpecWord[]; lines: number; unclosed: number[] } {
  const raw = text.split('\n');
  if (raw.at(-1) === '') raw.pop();
  const words: SpecWord[] = [];
  const unclosed: number[] = [];
  /** The numbered line that the lines without a marker continue; null after a bullet. */
  let open: { indent: number; text: string; line: number; plain: boolean } | null = null;
  /** Numbered lines that are options unless something is nested under them. */
  const settle = (nextIndent: number | null) => {
    if (open && open.plain && open.text !== '' && (nextIndent === null || nextIndent <= open.indent))
      words.push({ text: open.text, line: open.line, from: 'line' });
    open = null;
  };

  raw.forEach((rawLine, index) => {
    const line = index + 1;
    if (rawLine.includes(LEFT_OUT)) return;
    // Entities first: the export writes a leading space and a line's first bracket as one.
    const decoded = rawLine
      .replace(/\r$/, '')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replaceAll('\u00a0', ' ');
    // Before the backslashes are undone: `1\. Eyes` is a heading, `1. Eyes` a list line.
    const numbered = /^( *)\d+[.)](?: +(.*))?$/.exec(decoded);
    const bullet = /^( *)[•◦](.*)$/.exec(decoded);
    const rest = clean((numbered ? numbered[2] : bullet ? bullet[2] : decoded) ?? '');

    const inBrackets = [...rest.matchAll(/\[([^[\]]*)\]/g)];
    for (const match of inBrackets) {
      const word = tidy(match[1]!);
      if (word !== '') words.push({ text: word, line, from: 'bracket' });
    }
    if (/[[\]]/.test(rest.replace(/\[[^[\]]*\]/g, ''))) unclosed.push(line);
    const bracketed = /[[\]]/.test(rest);

    if (numbered) {
      settle(numbered[1]!.length);
      open = { indent: numbered[1]!.length, text: tidy(rest), line, plain: !bracketed };
    } else if (bullet) {
      settle(bullet[1]!.length);
      if (!bracketed && tidy(rest) !== '') words.push({ text: tidy(rest), line, from: 'bullet' });
    } else if (open && bracketed) open.plain = false;
  });
  settle(null);
  // Numbered options are found a line late; the words read in the order of the lines.
  words.sort((a, b) => a.line - b.line);
  return { words, lines: raw.length, unclosed };
}

// A backslash before punctuation is that character; one that ends a line is a line break inside a list item.
const clean = (text: string): string => text.replace(/\\([!-/:-@[-`{-~])/g, '$1').replace(/\\$/, '');
const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// The diff file.

/** <piece>.diff.json: every place a definition differs from the piece on purpose (4.1, step 3). */
export type Diff = {
  piece: string;
  /** Words of the piece (as `specWords` reads them) that are not options. */
  notOptions: string[];
  /** Option labels of the definition that are not words of the piece. */
  added: string[];
  /** What else differs, for a person: the line of the piece, what was done, and where the decision comes from. */
  differences: { line: number; what: string; why: string }[];
};

const DIFF_KEYS = ['piece', 'notOptions', 'added', 'differences'];

/** The diff file's form (`spec.bad_diff`). `lines` is the number of lines of the piece's text. */
export function readDiff(piece: string, diff: unknown, lines: number): Diff | FileProblem[] {
  const file = pieceDiff(piece);
  const problems: FileProblem[] = [];
  const bad = (path: string, message: string) =>
    problems.push({ file, path, rule: 'spec.bad_diff', message });
  if (!isObject(diff)) {
    bad('$', 'must be an object with the keys piece, notOptions, added and differences');
    return problems;
  }
  for (const key of Object.keys(diff))
    if (!DIFF_KEYS.includes(key)) bad(`$.${key}`, 'is no key of a diff file');
  for (const key of DIFF_KEYS)
    if (!(key in diff)) bad('$', `has no "${key}"; an empty list says there is none`);
  if ('piece' in diff && diff.piece !== piece) bad('$.piece', `must be "${piece}", the name of the file`);

  for (const key of ['notOptions', 'added'] as const) {
    if (!(key in diff)) continue;
    const list = diff[key];
    if (!Array.isArray(list)) {
      bad(`$.${key}`, 'must be a list of words');
      continue;
    }
    list.forEach((word: unknown, index) => {
      const at = `$.${key}[${index}]`;
      if (typeof word !== 'string' || word === '') bad(at, 'must be a word');
      // Written as the check reads a word, or it can never be equal to one.
      else if (word !== tidy(word))
        bad(at, 'has spaces at its ends or two together; a word is compared without them');
      else if (list.indexOf(word) !== index) bad(at, `"${word}" is listed twice`);
    });
  }
  if ('differences' in diff) {
    if (!Array.isArray(diff.differences)) bad('$.differences', 'must be a list');
    else
      diff.differences.forEach((entry: unknown, index) => {
        const at = `$.differences[${index}]`;
        if (!isObject(entry)) return bad(at, 'must be an object with line, what and why');
        for (const key of Object.keys(entry))
          if (!['line', 'what', 'why'].includes(key)) bad(`${at}.${key}`, 'is no key of a difference');
        const { line, what, why } = entry;
        if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > lines)
          bad(`${at}.line`, `must be a line of the piece, 1 to ${lines}, counted from its first line`);
        if (typeof what !== 'string' || what.trim() === '') bad(`${at}.what`, 'must say what differs');
        if (typeof why !== 'string' || why.trim() === '')
          bad(`${at}.why`, 'must say where the decision comes from');
      });
  }
  return problems.length > 0 ? problems : (diff as Diff);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// The check.

/**
 * Every piece that a section names, against each file whose sections name it. The rules:
 *  - `spec.missing_text`, `spec.missing_diff`: a section names a piece that lacks the file
 *  - `spec.bad_diff`: the diff file's form
 *  - `spec.unclosed_bracket`: a line of the piece with a bracket that has no partner
 *  - `spec.not_in_definition`: a word of the piece that is no option of the sections naming it
 *    and is not declared in `notOptions`
 *  - `spec.not_in_piece`: an option label that is no word of the piece and is not declared in `added`
 *  - `spec.not_option_unused`: a `notOptions` word that is no word of the piece
 *  - `spec.not_option_is_option`: a `notOptions` word that is an option label all the same
 *  - `spec.added_unused`: an `added` label that no option has
 *  - `spec.added_in_piece`: an `added` label that is a word of the piece after all
 * A file is checked on its own: every file whose sections name a piece has all of its words. A
 * version that departs from the piece in another way names a piece of its own.
 *
 * The definition files must have passed the schema check (checkFile): a file without sections, a
 * section without fields or a choice without options is reported there, and this check reads them
 * without looking. The export stops after schema problems.
 */
export function checkSpec(pieces: Pieces, files: DefinitionFiles): FileProblem[] {
  const problems: FileProblem[] = [];
  /** The faults of a piece's own files, found once however many files name it. */
  const read = new Map<string, { words: SpecWord[]; diff: Diff } | null>();
  const readPiece = (name: string, namedAt: { file: string; path: string }) => {
    if (read.has(name)) return read.get(name)!;
    const piece = pieces[name] ?? {};
    const missing = (file: string, rule: string) =>
      problems.push({
        ...namedAt,
        rule,
        message: `names the piece "${name}", and ${file} is not among the files`,
      });
    let result: { words: SpecWord[]; diff: Diff } | null = null;
    if (piece.text === undefined) missing(pieceText(name), 'spec.missing_text');
    else {
      const { words, lines, unclosed } = specWords(piece.text);
      for (const line of unclosed)
        problems.push({
          file: pieceText(name),
          path: `line ${line}`,
          rule: 'spec.unclosed_bracket',
          message: 'has a bracket with no partner: a word there would not be read',
        });
      if (piece.diff === undefined) missing(pieceDiff(name), 'spec.missing_diff');
      else {
        const diff = readDiff(name, piece.diff, lines);
        if (Array.isArray(diff)) problems.push(...diff);
        else if (unclosed.length === 0) result = { words, diff };
      }
    }
    read.set(name, result);
    return result;
  };

  for (const { name: file, file: content } of definitionsOf(files))
    for (const [name, sections] of sectionsByPiece(content)) {
      const piece = readPiece(name, { file, path: `${sections[0]!.at}.spec` });
      if (!piece) continue;
      const labels = sections.flatMap(({ section, at }) => labelsOf(section, at, files));
      problems.push(...compare(name, piece.words, piece.diff, file, labels));
    }
  return problems;
}

function compare(name: string, words: SpecWord[], diff: Diff, file: string, labels: Label[]): FileProblem[] {
  const problems: FileProblem[] = [];
  const inPiece = new Map<string, SpecWord>();
  for (const word of words) if (!inPiece.has(word.text)) inPiece.set(word.text, word);
  const inDefinition = new Set(labels.map((label) => label.text));
  const notOptions = new Set(diff.notOptions);
  const added = new Set(diff.added);
  const diffFile = pieceDiff(name);

  for (const word of inPiece.values())
    if (!inDefinition.has(word.text) && !notOptions.has(word.text))
      problems.push({
        file: pieceText(name),
        path: `line ${word.line}`,
        rule: 'spec.not_in_definition',
        message: `"${word.text}" is no option in the sections of ${file} that name this piece; type it there, or list it under notOptions in ${diffFile}`,
      });
  for (const label of labels) {
    if (inPiece.has(label.text) || added.has(label.text)) continue;
    problems.push({
      file,
      path: label.path,
      rule: 'spec.not_in_piece',
      message: `the option "${label.text}" is not in the lines of ${pieceText(name)}; type it as the lines write it, or list it under added in ${diffFile}`,
    });
  }
  diff.notOptions.forEach((word, index) => {
    const path = `$.notOptions[${index}]`;
    if (!inPiece.has(word))
      problems.push({
        file: diffFile,
        path,
        rule: 'spec.not_option_unused',
        message: `"${word}" is no word of the piece; a word is listed as the lines write it, without its brackets`,
      });
    else if (inDefinition.has(word))
      problems.push({
        file: diffFile,
        path,
        rule: 'spec.not_option_is_option',
        message: `"${word}" is an option in ${file}; it is listed here as not being one`,
      });
  });
  diff.added.forEach((label, index) => {
    const path = `$.added[${index}]`;
    if (!inDefinition.has(label))
      problems.push({
        file: diffFile,
        path,
        rule: 'spec.added_unused',
        message: `"${label}" is no option in the sections of ${file} that name this piece`,
      });
    else if (inPiece.has(label))
      problems.push({
        file: diffFile,
        path,
        rule: 'spec.added_in_piece',
        message: `"${label}" is in the lines of the piece (line ${inPiece.get(label)!.line}); it was not added`,
      });
  });
  return problems;
}

/** An option label of a section, and where the file writes it: the label itself, or the list it comes from. */
type Label = { text: string; path: string };

function labelsOf(section: Section, at: string, files: DefinitionFiles): Label[] {
  const labels: Label[] = [];
  const from = (options: Option[] | ListRef | { pickedIn: string }, path: string) => {
    if (Array.isArray(options))
      options.forEach((option, i) => labels.push({ text: option.label, path: `${path}[${i}].label` }));
    else if ('list' in options) named(options.list, `${path}.list`);
    // Picked rows are another field's options, read there.
  };
  // A list that is not among the files gives no labels; the resolver reports it.
  const named = (list: string, path: string) =>
    (files.lists[listFile(list)]?.options ?? []).forEach((option) =>
      labels.push({ text: option.label, path }),
    );
  const walk = (field: Field, path: string) => {
    switch (field.kind) {
      case 'choice':
        return from(field.options, `${path}.options`);
      case 'region':
        from(field.options, `${path}.options`);
        if (field.side) named(field.side, `${path}.side`);
        if (field.surface) named(SURFACE_LIST, `${path}.surface`);
        return;
      case 'group':
        return field.fields.forEach((child, i) => walk(child, `${path}.fields[${i}]`));
      case 'grid':
        from(field.rows, `${path}.rows`);
        return walk(field.cell, `${path}.cell`);
      default:
    }
  };
  section.fields.forEach((field, i) => walk(field, `${at}.fields[${i}]`));
  return labels;
}
