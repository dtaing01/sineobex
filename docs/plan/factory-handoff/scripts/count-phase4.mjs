// Counts phase 4's cards by level from docs/plan/phase-4-encounters/README.md.
// The index mixes three forms; each is expanded by the rule the index itself states.
import { readFileSync } from 'node:fs';
const text = readFileSync(`${process.argv[2] ?? '.'}/docs/plan/phase-4-encounters/README.md`, 'utf8');
const body = text.slice(text.indexOf('## The cards'), text.indexOf('## Counts by unit'));
const cards = new Map();
const add = (id, level) => {
  if (cards.has(id)) throw new Error(`twice: ${id}`);
  cards.set(id, level);
};
// Unit-wide levels the index states in prose: "Every card is level X" (L1, L3), "Every card is level R" (F5, L5 except L5-labels)
const unitLevel = { L1: 'X', L3: 'X', F5: 'R', L5: 'R' };
let unit = null;
for (const line of body.split('\n')) {
  const h = /^### ([A-Z][0-9]?) /.exec(line);
  if (h) {
    unit = h[1];
    continue;
  }
  let m = /^\| ([A-Z][0-9]?-[A-Za-z0-9-]+) \| ([STRX]) \|/.exec(line);
  if (m) {
    add(m[1], m[2]);
    continue;
  }
  // a table without a level column: | ID(s) | files | needs |
  m = /^\| ((?:[A-Z][0-9]?-[A-Za-z0-9-]+)(?:, [A-Z][0-9]?-[A-Za-z0-9-]+)*)(?: \(level ([STRX])\))? \|/.exec(
    line,
  );
  if (m && unitLevel[unit]) {
    for (const id of m[1].split(', ')) add(id, m[2] ?? unitLevel[unit]);
    continue;
  }
}
// F2's fourteen, named in prose (lines 126-130), each level T
for (const n of [
  'field-at',
  'check-values',
  'check-structure',
  'conditions',
  'effective',
  'finish',
  'normal',
  'recap',
  'read-sections',
  'read-corrections',
  'visible',
  'handoff',
  'suggestions',
  'expand',
])
  add(`F2-${n}`, 'T');
// F6's transcription table rows (level S): IDs with ranges written in short form
const f6 = [
  'general-1',
  'general-2',
  'wound-1',
  'wound-2',
  'harm-reduction',
  'psychological',
  'sexrepro-1',
  'sexrepro-2',
  'sexrepro-3',
  'social-needs',
  'outreach',
  'quick-1',
  'quick-2',
  'exam-picker',
];
for (let i = 1; i <= 22; i++) f6.push(`exam-${String(i).padStart(2, '0')}`);
for (const n of f6) add(`F6-${n}`, 'S');
const n = { S: 0, T: 0, R: 0, X: 0 };
for (const l of cards.values()) n[l]++;
console.log(`phase 4\tparsed S${n.S} T${n.T} R${n.R} X${n.X} = ${cards.size}\tlocal ${n.S + n.T + n.R}`);
if (process.env.ROWS) for (const [id, l] of cards) console.log(`  ${l} ${id}`);
