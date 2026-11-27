// Counts cards by level from the card tables of docs/design/phase-{5..12}-*.md section 13.
// Usage: node count-cards.mjs <repo>
import { readFileSync, readdirSync } from 'node:fs';
const repo = process.argv[2] ?? '.';
const files = readdirSync(`${repo}/docs/design`).filter((f) => /^phase-(5|6|7|8|9|10|12)-.*\.md$/.test(f));
for (const f of files.sort((a, b) => parseInt(a.slice(6)) - parseInt(b.slice(6)))) {
  const text = readFileSync(`${repo}/docs/design/${f}`, 'utf8');
  const s13 = text.slice(text.search(/^## 13/m));
  const n = { S: 0, T: 0, R: 0, X: 0 };
  const rows = [];
  for (const line of s13.split('\n')) {
    const m = /^\| ([A-Z][0-9]?-[^|]+?) \| ([STRX]) \|(.*)$/.exec(line);
    if (!m) continue;
    // "U0-rules-chunks, U0-rules-steps" is two cards in one row
    const ids = m[1].split(/,\s*/);
    for (const id of ids) {
      n[m[2]]++;
      rows.push({ id, level: m[2], files: m[3] });
    }
  }
  const stated = /\*\*Count: (\d+) cards\.\*?\*? ?S (\d+), T (\d+), R (\d+), X (\d+)/.exec(s13);
  const total = n.S + n.T + n.R + n.X;
  console.log(
    `${f}\tparsed S${n.S} T${n.T} R${n.R} X${n.X} = ${total}\tlocal ${n.S + n.T + n.R}\tstated ${stated ? stated.slice(1).join('/') : '?'}`,
  );
  if (process.env.ROWS) for (const r of rows) console.log(`  ${r.level} ${r.id}\t${r.files.slice(0, 140)}`);
}
