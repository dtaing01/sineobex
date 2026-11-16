import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readShape } from '../src/shape-check.ts';
import { LEFT_OUT, readDiff, readPieces, specWords } from '../src/spec-check.ts';

// The files of packages/forms/definitions are well formed before any definition names them: each
// piece of the field specification is read without a problem and is the inventories' range, and
// each shared list, shape file and diff file passes the checks of its form. The export checks
// definitions against these files; a fault here would pass that check in silence or fail it far
// from its cause.

const root = fileURLToPath(new URL('../definitions/', import.meta.url));
const filesIn = (folder: string): string[] => readdirSync(`${root}${folder}`).sort();
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');

/**
 * The 37 pieces and the lines of the field specification each one holds: forms-inventory.md
 * section 8 for the note types, forms-inventory-focused-exam.md section 7, in its order, for the
 * exam. A piece of two ranges holds the first, then the second.
 */
const PIECES: Record<string, [number, number][]> = {
  'general-1': [[5, 28]],
  'general-2': [
    [29, 35],
    [61, 62],
  ],
  'red-flags': [[36, 60]],
  'wound-1': [[63, 103]],
  'wound-2': [[104, 119]],
  'harm-reduction': [[120, 148]],
  psychological: [[150, 171]],
  'sexrepro-1': [[173, 203]],
  'sexrepro-2': [[204, 243]],
  'sexrepro-3': [[244, 251]],
  'social-needs': [[252, 267]],
  outreach: [[268, 282]],
  'quick-1': [[283, 307]],
  'quick-2': [[308, 332]],
  'exam-general-appearance': [[336, 386]],
  'exam-heent-eyes': [[388, 462]],
  'exam-heent-ears': [[464, 522]],
  'exam-heent-nose': [[524, 552]],
  'exam-heent-mouth': [[554, 608]],
  'exam-cv-rhythm': [[610, 668]],
  'exam-cv-perfusion': [[670, 732]],
  'exam-pulmonary': [[734, 820]],
  'exam-abdominal': [[822, 910]],
  'exam-msk-1': [[912, 994]],
  'exam-msk-2': [[996, 1068]],
  'exam-neuro-1': [[1070, 1150]],
  'exam-neuro-2': [[1152, 1222]],
  'exam-skin': [[1224, 1330]],
  'exam-gu': [[1332, 1396]],
  'exam-lymphatic': [[1398, 1434]],
  'exam-peripheral-vascular': [[1436, 1508]],
  'exam-breast': [[1510, 1564]],
  'exam-rectal': [[1566, 1596]],
  'exam-psychiatric': [[1598, 1662]],
  'exam-foot': [[1664, 1742]],
  'exam-neck': [[1744, 1778]],
  'exam-picker': [
    [1780, 1836],
    [2032, 2036],
  ],
};

/** The lines that name a real organization (SPEC 263 to 265, inventory A51) are never copied. */
const LEFT_OUT_AT: Record<string, number[]> = { 'social-needs': [12, 13, 14] };

const specTexts = (): Record<string, string> =>
  Object.fromEntries(filesIn('spec').map((name) => [`spec/${name}`, read(`spec/${name}`)]));

describe('the pieces of the field specification', () => {
  const { pieces, problems } = readPieces(specTexts());

  it('are read with no problem, and are exactly the 37 of the inventories', () => {
    expect(problems).toEqual([]);
    expect(Object.keys(pieces).sort()).toEqual(Object.keys(PIECES).sort());
    for (const [name, piece] of Object.entries(pieces)) expect(piece.text, name).toBeDefined();
  });

  it.each(Object.entries(PIECES))('%s holds the lines of its range, every bracket closed', (name, ranges) => {
    const text = pieces[name]?.text ?? '';
    const { lines, unclosed } = specWords(text);
    expect(lines).toBe(ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0));
    expect(unclosed).toEqual([]);
    const marked = text.split('\n').flatMap((line, index) => (line.includes(LEFT_OUT) ? [index + 1] : []));
    expect(marked).toEqual(LEFT_OUT_AT[name] ?? []);
    for (const line of marked) expect(text.split('\n')[line - 1]).toBe(LEFT_OUT);
  });
});

describe('the shape and diff files', () => {
  const { pieces } = readPieces(specTexts());

  it.each(Object.keys(PIECES))('of %s pass the form rules of their checks', (name) => {
    const { text = '', diff, shape } = pieces[name] ?? {};
    const faults = (read: unknown) => (Array.isArray(read) ? read : []);
    if (diff !== undefined) expect(faults(readDiff(name, diff, specWords(text).lines))).toEqual([]);
    if (shape !== undefined) expect(faults(readShape(name, shape))).toEqual([]);
  });
});
