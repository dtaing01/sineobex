// The decisions document check: each problem it reports, shown on a small fixture and not on the
// same fixture fixed; how markers are read in each comment syntax the repository uses; and the
// check run on the repository itself, as CI runs it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkDecisions,
  globMatch,
  markersIn,
  NOT_MARKERS,
  pathsIn,
  readRows,
  wordsOf,
} from '../decisions-check.mjs';

const DOC = 'docs/decisions-for-review.md';
const RULES_FILE = 'tools/decisions-check-rules.mjs';
const HEADER = [
  '| # | Decision | Default built | Recommendation | If changed later | Where | Phase |',
  '|---|---|---|---|---|---|---|',
];
const row = (id, where, decision = 'A question?') =>
  `| ${id} | ${decision} | The default | Keep it | Little | ${where} | 4 |`;

/** A document whose rows hold every marker of SOURCES, as the real one does. */
const BASE = [
  '# Decisions for review',
  '',
  '## The project lead',
  '',
  ...HEADER,
  row('PL-1', '`services/api/src/services/memberships.ts`; plan section 6'),
  row('PL-3', 'Plan risk 10; no marker'),
  '',
  '## Brooke and Mercy',
  '',
  ...HEADER,
  row('BM-12', '`apps/mobile/lib/encounters/note_actions.dart`; lifecycle 12.1 #9'),
  '',
  '## Counsel',
  '',
  ...HEADER,
  row('CO-5', '`apps/mobile/lib/encounters/note_actions.dart`; lifecycle 12.1 #10'),
  '',
  '## The team',
  '',
  ...HEADER,
  row('TM-6', '`apps/mobile/lib/encounters/close_sweep.dart`; lifecycle 12.1 #4'),
  '',
  '## Before the first real patient',
  '',
  '| # | What | Who, or which account | Where |',
  '|---|---|---|---|',
  '| BF-1 | AWS accounts | The project lead | `apps/portal/src/lib/auth/index.ts` |',
  '| BF-2 | The preview project | The project lead | `docs/setup.md` |',
  '',
].join('\n');

const SOURCES = {
  'services/api/src/services/memberships.ts':
    '// PLAN-OPEN (PL-1): who may change a credential after appointment? No route is meant for it.\n' +
    'export const a = 1;\n',
  'apps/mobile/lib/encounters/note_actions.dart':
    '/// PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1 #9)? By an addendum.\n' +
    '/// PLAN-OPEN: what does an amendment request need (lifecycle 12.1 #10)? The request.\n' +
    'void act() {}\n',
  'apps/mobile/lib/encounters/close_sweep.dart':
    '/// PLAN-OPEN (TM-6): how long does an untouched draft stay (lifecycle 12.1 #4)? 7 days.\n' +
    'const untouchedDraftLifetime = Duration(days: 7);\n',
  'apps/portal/src/lib/auth/index.ts':
    '    // PLAN-OPEN (phase 12): Cognito hosted UI with authorization code + PKCE.\n',
};
const NOTE_ACTIONS = 'apps/mobile/lib/encounters/note_actions.dart';
const AUTH = 'apps/portal/src/lib/auth/index.ts';
// Each older marker's words, as the check cuts them.
const BM12 = 'PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1';
const CO5 = 'PLAN-OPEN: what does an amendment request need (lifecycle';
const BF1 = 'PLAN-OPEN (phase 12): Cognito hosted UI with authorization';
const RULES = {
  [NOTE_ACTIONS]: [
    ['BM-12', BM12],
    ['CO-5', CO5],
  ],
  [AUTH]: [['BF-1', BF1]],
};
const FILES = [...Object.keys(SOURCES), 'docs/setup.md'];

function run({ doc = BASE, sources = SOURCES, rules = RULES, files = FILES } = {}) {
  const markers = Object.entries(sources).flatMap(([file, text]) => markersIn(file, text));
  const known = new Set(files);
  const exists = (p) => (p.includes('*') ? files.some((f) => globMatch(p, f)) : known.has(p));
  return checkDecisions({ doc, markers, rules, exists });
}
const check = (fixture) => run(fixture).problems;
/** The document with one piece of it written otherwise. */
const edit = (from, to) => {
  expect(BASE).toContain(from);
  return BASE.replace(from, to);
};
const lineOf = (text, part) => text.split('\n').findIndex((l) => l.includes(part)) + 1;

describe('the decisions document check', () => {
  it('passes when every marker is in one row and every row says where its markers are', () => {
    const { problems, assigned } = run();
    expect(problems).toEqual([]);
    expect(assigned.map((a) => `${a.file}:${a.line} ${a.row}`)).toEqual([
      'services/api/src/services/memberships.ts:1 PL-1',
      `${NOTE_ACTIONS}:1 BM-12`,
      `${NOTE_ACTIONS}:2 CO-5`,
      'apps/mobile/lib/encounters/close_sweep.dart:1 TM-6',
      `${AUTH}:1 BF-1`,
    ]);
  });

  it('finds each row once', () => {
    const twice = edit(
      row('PL-3', 'Plan risk 10; no marker'),
      [row('PL-3', 'Plan risk 10; no marker'), row('PL-3', 'Plan risk 7; no marker')].join('\n'),
    );
    expect(check({ doc: twice })).toEqual([
      `${DOC}:${lineOf(twice, 'Plan risk 7')}: row PL-3 is there twice (first at line ${lineOf(twice, 'Plan risk 10')})`,
    ]);
    const fixed = twice.replace(row('PL-3', 'Plan risk 7; no marker'), row('PL-4', 'Plan risk 7; no marker'));
    expect(check({ doc: fixed })).toEqual([]);
  });

  it('reads a row\'s Where from its own cell: a "|" inside a cell is escaped', () => {
    const where = '`services/api/src/services/memberships.ts`; plan section 6';
    const cut = edit(row('PL-1', where), row('PL-1', where, 'Who may change it | and when?'));
    expect(check({ doc: cut })).toEqual([
      `${DOC}:${lineOf(cut, 'PL-1')}: row PL-1 has 8 cells and its table 7: a "|" inside a cell is written "\\|"`,
    ]);
    expect(
      check({ doc: edit(row('PL-1', where), row('PL-1', where, 'Who may change it \\| and when?')) }),
    ).toEqual([]);
  });

  it('reads the Where column of each table: the sixth for a decider, the fourth before the first patient', () => {
    const { rows, problems } = readRows(BASE);
    expect(problems).toEqual([]);
    expect(rows.get('TM-6').where).toBe('`apps/mobile/lib/encounters/close_sweep.dart`; lifecycle 12.1 #4');
    expect(rows.get('BF-1').where).toBe('`apps/portal/src/lib/auth/index.ts`');
    expect(rows.get('BF-1').paths).toEqual([AUTH]);
    const noWhere = edit(
      '| # | What | Who, or which account | Where |',
      '| # | What | Who, or which account | Files |',
    );
    expect(check({ doc: noWhere })).toEqual([
      `${DOC}:${lineOf(noWhere, 'BF-1')}: row BF-1's table has no Where column`,
      `${DOC}:${lineOf(noWhere, 'BF-2')}: row BF-2's table has no Where column`,
    ]);
  });

  it('starts every row with its id', () => {
    const slip = edit('| PL-3 |', '| PL3 |');
    expect(check({ doc: slip })).toEqual([
      `${DOC}:${lineOf(slip, 'PL3')}: a row starts with its id, as "TM-6", not "PL3"`,
    ]);
    // Only a table headed "#" lists decisions.
    const other = `${BASE}\n| Phase | Units |\n|---|---|\n| 5 | P0 to P6 |\n`;
    expect(check({ doc: other })).toEqual([]);
  });

  it('names in a Where only paths that exist, braces and "*" included', () => {
    const gone = edit('plan section 6', 'plan section 6; `services/api/src/gone.ts`');
    expect(check({ doc: gone })).toEqual([
      `${DOC}:${lineOf(gone, 'PL-1')}: row PL-1 names services/api/src/gone.ts, which does not exist`,
    ]);
    const braces = edit(
      '`apps/mobile/lib/encounters/close_sweep.dart`',
      '`apps/mobile/lib/encounters/{close_sweep,gone}.dart`',
    );
    expect(check({ doc: braces })).toEqual([
      `${DOC}:${lineOf(braces, 'TM-6')}: row TM-6 names apps/mobile/lib/encounters/gone.dart, which does not exist`,
    ]);
    const glob = edit('Plan risk 10; no marker', '`packages/forms/definitions/spec/*.diff.json`; no marker');
    expect(check({ doc: glob })[0]).toMatch(
      /row PL-3 names packages\/forms\/definitions\/spec\/\*\.diff\.json, which does not exist/,
    );
    expect(
      check({ doc: glob, files: [...FILES, 'packages/forms/definitions/spec/wound.diff.json'] }),
    ).toEqual([]);
    const root = edit('Plan risk 10; no marker', '`CLAUDE.md` ("How a phase is run"); no marker');
    expect(check({ doc: root })[0]).toMatch(/row PL-3 names CLAUDE\.md, which does not exist/);
    expect(check({ doc: root, files: [...FILES, 'CLAUDE.md'] })).toEqual([]);
    expect(check({ doc: gone, files: [...FILES, 'services/api/src/gone.ts'] })).toEqual([]);
  });

  it('has a row with no marker say so, except before the first real patient', () => {
    const silent = edit('Plan risk 10; no marker', 'Plan risk 10');
    expect(check({ doc: silent })).toEqual([
      `${DOC}:${lineOf(silent, 'PL-3')}: row PL-3 has no marker in the code and its Where doesn't say "no marker"`,
    ]);
    expect(
      check({ doc: edit('Plan risk 10; no marker', 'Plan risk 10; not built, so no marker yet') }),
    ).toEqual([]);
    // BF-2 holds no marker and says nothing of one: its rows need a person, not a decision in code.
    expect(BASE).toContain('| BF-2 | The preview project | The project lead | `docs/setup.md` |');
  });

  it('has a row with markers not say "no marker"', () => {
    const says = edit('lifecycle 12.1 #4', 'lifecycle 12.1 #4; no marker');
    expect(check({ doc: says })).toEqual([
      `${DOC}:${lineOf(says, 'TM-6')}: row TM-6's Where says "no marker", but 1 marker belongs to it (apps/mobile/lib/encounters/close_sweep.dart:1)`,
    ]);
  });

  it("names no file whose markers are all other rows'", () => {
    const stray = edit('lifecycle 12.1 #4', `lifecycle 12.1 #4; \`${NOTE_ACTIONS}\``);
    expect(check({ doc: stray })).toEqual([
      `${DOC}:${lineOf(stray, 'TM-6')}: row TM-6 names ${NOTE_ACTIONS}, whose markers are all other rows' (BM-12, CO-5)`,
    ]);
    // A row with no marker may name such a file for what it says there.
    expect(
      check({ doc: edit('Plan risk 10; no marker', `Plan risk 10, \`${NOTE_ACTIONS}\`; no marker`) }),
    ).toEqual([]);
  });

  it('takes a marker that names its row only when the row exists', () => {
    const sources = {
      ...SOURCES,
      'apps/mobile/lib/encounters/close_sweep.dart':
        '/// PLAN-OPEN (TM-60): how long does a draft stay? 7 days.\n',
    };
    expect(check({ sources })).toEqual([
      `apps/mobile/lib/encounters/close_sweep.dart:1: names row TM-60, which is not in ${DOC}`,
      `${DOC}:${lineOf(BASE, 'TM-6')}: row TM-6 has no marker in the code and its Where doesn't say "no marker"`,
    ]);
  });

  it("takes a marker that names its row only from a file its row's Where names", () => {
    const moved = edit(
      '`apps/mobile/lib/encounters/close_sweep.dart`',
      '`apps/mobile/lib/encounters/close.dart`',
    );
    const files = [...FILES, 'apps/mobile/lib/encounters/close.dart'];
    expect(check({ doc: moved, files })).toEqual([
      "apps/mobile/lib/encounters/close_sweep.dart:1: row TM-6's Where does not name apps/mobile/lib/encounters/close_sweep.dart",
    ]);
    expect(
      check({
        doc: edit('`apps/mobile/lib/encounters/close_sweep.dart`', '`apps/mobile/lib/encounters/*.dart`'),
      }),
    ).toEqual([]);
  });

  it('knows a row id only as "PLAN-OPEN (XX-n)", XX one of PL, BM, CO and TM', () => {
    const file = 'apps/mobile/lib/encounters/close_sweep.dart';
    for (const written of [
      'PLAN-OPEN (BF-1):',
      'PLAN-OPEN (tm-6):',
      'PLAN-OPEN(TM-6):',
      'PLAN-OPEN (TM-6, TM-7):',
    ]) {
      const problems = check({
        sources: { ...SOURCES, [file]: `/// ${written} how long does a draft stay? 7 days.\n` },
      });
      expect(problems[0], written).toBe(
        `${file}:1: "${written.slice(0, -1)}" is not a row id: write it as in "PLAN-OPEN (BM-12): …", with PL, BM, CO or TM (a row of "Before the first real patient" needs no decision, so no marker names one)`,
      );
    }
    expect(
      check({
        sources: { ...SOURCES, [file]: '/// PLAN-OPEN (TM-6): how long does a draft stay? 7 days.\n' },
      }),
    ).toEqual([]);
  });

  it('sends a marker with no row id and no rule to name its row', () => {
    const sources = {
      ...SOURCES,
      'apps/mobile/lib/encounters/close_sweep.dart':
        SOURCES['apps/mobile/lib/encounters/close_sweep.dart'] + '/// PLAN-OPEN: when is it released?\n',
    };
    expect(check({ sources })).toEqual([
      `apps/mobile/lib/encounters/close_sweep.dart:3: this marker has no row: name its row, as in "PLAN-OPEN (BM-12): …", and add that row to ${DOC} under its decider if it isn't there ("PLAN-OPEN: when is it released?")`,
    ]);
    sources['apps/mobile/lib/encounters/close_sweep.dart'] = sources[
      'apps/mobile/lib/encounters/close_sweep.dart'
    ].replace('PLAN-OPEN: when', 'PLAN-OPEN (TM-6): when');
    expect(check({ sources })).toEqual([]);
  });

  it('gives a marker with no row id to one rule only', () => {
    const rules = { ...RULES, [NOTE_ACTIONS]: [...RULES[NOTE_ACTIONS], ['TM-6', BM12]] };
    expect(check({ rules })).toEqual(
      expect.arrayContaining([
        `${NOTE_ACTIONS}:1: the rules for BM-12, TM-6 all hold its words, and it belongs to one row: name it, as in "PLAN-OPEN (BM-12): …" ("PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1 #9)? By an addendum.")`,
      ]),
    );
    const other = 'PLAN-OPEN: how long does an untouched draft stay';
    expect(check({ rules: { ...RULES, [NOTE_ACTIONS]: [...RULES[NOTE_ACTIONS], ['TM-6', other]] } })).toEqual(
      [
        `${RULES_FILE}: the rule for TM-6 in ${NOTE_ACTIONS} ("${other}") takes no marker any more: delete it`,
      ],
    );
  });

  it("takes a rule's marker only from a file its row's Where names", () => {
    const rules = { ...RULES, [AUTH]: [['TM-6', BF1]] };
    expect(check({ rules })).toEqual([`${AUTH}:1: row TM-6's Where does not name ${AUTH}`]);
  });

  it('has every rule name a row of the document', () => {
    const rules = { ...RULES, [AUTH]: [['CO-99', BF1]] };
    expect(check({ rules })).toEqual([
      `${RULES_FILE}: the rule for CO-99 in ${AUTH} ("${BF1}") names a row that is not in ${DOC}`,
    ]);
  });

  it('deletes a rule that takes no marker, as when its marker names its row', () => {
    const gradle = 'apps/mobile/android/app/build.gradle.kts';
    const words = 'PLAN-OPEN: the public app name is not decided';
    expect(check({ rules: { ...RULES, [gradle]: [['TM-6', words]] } })).toEqual([
      `${RULES_FILE}: the rule for TM-6 in ${gradle} ("${words}") takes no marker any more: delete it`,
    ]);
    const sources = {
      ...SOURCES,
      [NOTE_ACTIONS]: SOURCES[NOTE_ACTIONS].replace('PLAN-OPEN: how', 'PLAN-OPEN (BM-12): how'),
    };
    expect(check({ sources })).toEqual([
      `${RULES_FILE}: the rule for BM-12 in ${NOTE_ACTIONS} ("${BM12}") takes no marker any more: delete it`,
    ]);
    expect(check({ sources, rules: { ...RULES, [NOTE_ACTIONS]: [['CO-5', CO5]] } })).toEqual([]);
  });

  it('holds a rule to its count, so that a marker added later saying the same names its row', () => {
    const added = `${SOURCES[NOTE_ACTIONS]}/// PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1 #9)? Offline too.\n`;
    expect(check({ sources: { ...SOURCES, [NOTE_ACTIONS]: added } })).toEqual([
      `${RULES_FILE}: the rule for BM-12 in ${NOTE_ACTIONS} ("${BM12}") takes 2 markers, not 1: a new marker names its row, as in "PLAN-OPEN (BM-12): …" (${NOTE_ACTIONS}:1, ${NOTE_ACTIONS}:4)`,
    ]);
    const named = added.replace(
      'PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1 #9)? Offline',
      'PLAN-OPEN (BM-12): how is a wrong assessment fixed (lifecycle 12.1 #9)? Offline',
    );
    expect(check({ sources: { ...SOURCES, [NOTE_ACTIONS]: named } })).toEqual([]);
    // Markers saying the same are one rule with their count, which goes down as each names its row.
    const two = {
      ...RULES,
      [NOTE_ACTIONS]: [
        ['BM-12', BM12, 2],
        ['CO-5', CO5],
      ],
    };
    expect(check({ sources: { ...SOURCES, [NOTE_ACTIONS]: added }, rules: two })).toEqual([]);
    expect(check({ sources: { ...SOURCES, [NOTE_ACTIONS]: named }, rules: two })).toEqual([
      `${RULES_FILE}: the rule for BM-12 in ${NOTE_ACTIONS} ("${BM12}") takes 1 marker, not 2: write 1, as a rule only shrinks`,
    ]);
  });

  it("gives a new marker no older marker's place: once that one names its row, the new one names its own", () => {
    const sources = {
      ...SOURCES,
      [NOTE_ACTIONS]: `${SOURCES[NOTE_ACTIONS].replace('PLAN-OPEN: how', 'PLAN-OPEN (BM-12): how')}/// PLAN-OPEN: may a draft's plan be fixed the same way (lifecycle 12.1 #9)?\n`,
    };
    expect(check({ sources })).toEqual([
      `${NOTE_ACTIONS}:4: this marker has no row: name its row, as in "PLAN-OPEN (BM-12): …", and add that row to ${DOC} under its decider if it isn't there ("PLAN-OPEN: may a draft's plan be fixed the same way (lifecycle 12.1 #9)?")`,
      `${RULES_FILE}: the rule for BM-12 in ${NOTE_ACTIONS} ("PLAN-OPEN: how is a wrong assessment fixed (lifecycle 12.1") takes no marker any more: delete it`,
    ]);
  });

  it('takes a marker by its rule only while it says what it said, so a reworded one names its row', () => {
    const sources = { ...SOURCES, [AUTH]: '    // PLAN-OPEN: which page the portal signs in on.\n' };
    expect(check({ sources })).toEqual([
      `${AUTH}:1: this marker has no row: name its row, as in "PLAN-OPEN (BM-12): …", and add that row to ${DOC} under its decider if it isn't there ("PLAN-OPEN: which page the portal signs in on.")`,
      `${RULES_FILE}: the rule for BF-1 in ${AUTH} ("PLAN-OPEN (phase 12): Cognito hosted UI with authorization") takes no marker any more: delete it`,
    ]);
  });

  it("reads a rule only as [row, words] or [row, words, count], with the words as the check cuts a marker's", () => {
    for (const bad of [
      ['BF-1'],
      ['BF1', BF1],
      ['BF-1', /Cognito/],
      ['BF-1', 'Cognito hosted UI with authorization'],
      ['BF-1', `${BF1} code + PKCE.`],
      ['BF-1', BF1.replace(' ', '  ')],
      ['BF-1', BF1, 0],
      ['BF-1', BF1, 1, 'more'],
    ]) {
      expect(check({ rules: { ...RULES, [AUTH]: [bad] } }), String(bad)).toContain(
        `${RULES_FILE}: rule 1 for ${AUTH} is not [row, words] or [row, words, count], with the words as the check cuts them`,
      );
    }
    expect(check({ rules: { ...RULES, [AUTH]: [['BF-1', BF1, 1]] } })).toEqual([]);
    expect(check({ rules: Object.values(RULES).flat() })).toContain(
      `${RULES_FILE}: RULES is not the files, each with its rules`,
    );
  });

  it('reports a marker it cannot read, with where it is', () => {
    const sources = { ...SOURCES, 'apps/mobile/ios/Runner/Info.plist': '<!-- PLAN-OPEN: the app name -->\n' };
    expect(check({ sources })).toEqual([
      "apps/mobile/ios/Runner/Info.plist:1: can't read a marker in this kind of file: teach KINDS in tools/decisions-check.mjs its comments",
    ]);
  });
});

/** What each marker of a file is read as: [line, row id, question], or [line, the problem]. */
const read = (file, text) =>
  markersIn(file, text).map((m) => (m.problem ? [m.line, m.problem] : [m.line, m.id, m.question]));

describe('reading markers', () => {
  it('reads // and /// comments a paragraph at a time, each marker up to the next', () => {
    const dart = [
      '/// The draft lifetime.',
      '///',
      '/// PLAN-OPEN: can a note be written for someone not registered (lifecycle 12.1',
      '/// #11)? No. PLAN-OPEN: is the position stored (lifecycle 12.1 #15)? Only on the tap.',
      '/// PLAN-OPEN (TM-6): how long (lifecycle 12.1 #4)? 7 days.',
      '///',
      '/// The rest.',
      'void start() {}',
      '  // Brief call note is PLAN-OPEN 12.1 #14.',
    ].join('\n');
    expect(read('apps/mobile/lib/x.dart', dart)).toEqual([
      [3, null, 'PLAN-OPEN: can a note be written for someone not registered (lifecycle 12.1 #11)? No.'],
      [4, null, 'PLAN-OPEN: is the position stored (lifecycle 12.1 #15)? Only on the tap.'],
      [5, 'TM-6', 'PLAN-OPEN (TM-6): how long (lifecycle 12.1 #4)? 7 days.'],
      [9, null, 'Brief call note is PLAN-OPEN 12.1 #14.'],
    ]);
  });

  it('reads /* */ and /** */ comments, with or without a star on each line', () => {
    const ts = [
      '/**',
      ' * Opens the review.',
      ' *',
      ' * PLAN-OPEN (TM-28): who decides a field review (phase 3',
      ' * design 14.1 #13)? patients.edit.',
      ' */',
      '/** Resident: signs and needs attestation (PLAN-OPEN 12.1 #6). */',
      '/* PLAN-OPEN: what the header carries',
      '   (forms 10.1 #6)? The preferred name. */',
    ].join('\n');
    expect(read('services/api/src/x.ts', ts)).toEqual([
      [4, 'TM-28', 'PLAN-OPEN (TM-28): who decides a field review (phase 3 design 14.1 #13)? patients.edit.'],
      [7, null, 'Resident: signs and needs attestation (PLAN-OPEN 12.1 #6).'],
      [8, null, 'PLAN-OPEN: what the header carries (forms 10.1 #6)? The preferred name.'],
    ]);
  });

  it('reads a row id that wraps onto the next line of its comment', () => {
    expect(
      read('services/api/src/x.ts', '// The rule. PLAN-OPEN\n// (TM-20): who is told? The author.\n'),
    ).toEqual([[1, 'TM-20', 'PLAN-OPEN (TM-20): who is told? The author.']]);
  });

  it('reads {/* */} in TSX, on its own lines or after the code it is about', () => {
    const tsx = [
      '<ul>',
      '  {/* PLAN-OPEN: cards at undo (design 14.1, #16): a card made while merged stays with the',
      '      survivor. */}',
      "  <li>Don't undo it</li> {/* PLAN-OPEN: undo limits (design 14.1, #15) */}",
      '  {/*',
      "    The team's PLAN-OPEN: merge survivor default (design 14.1, #26)",
      '  */}',
      '</ul>',
    ].join('\n');
    expect(read('apps/portal/src/app/(app)/x/Undo.tsx', tsx)).toEqual([
      [
        2,
        null,
        'PLAN-OPEN: cards at undo (design 14.1, #16): a card made while merged stays with the survivor.',
      ],
      [4, null, "PLAN-OPEN: undo limits (design 14.1, #15) [on: <li>Don't undo it</li>]"],
      [6, null, "The team's PLAN-OPEN: merge survivor default (design 14.1, #26)"],
    ]);
  });

  it('reads // at the end of a line of code with the code it is about', () => {
    const dart = 'const searchMin = 0.50; // PLAN-OPEN: tune on pilot data (module 2)\n';
    expect(read('apps/mobile/lib/patients/match_constants.dart', dart)).toEqual([
      [1, null, 'PLAN-OPEN: tune on pilot data (module 2) [on: const searchMin = 0.50;]'],
    ]);
    const url = "const host = 'https://example.com/a'; // PLAN-OPEN (TM-1): the host\n";
    expect(read('services/api/src/config.ts', url)).toEqual([
      [1, 'TM-1', "PLAN-OPEN (TM-1): the host [on: const host = 'https://example.com/a';]"],
    ]);
  });

  it('reads // in Gradle Kotlin', () => {
    const kts =
      'defaultConfig {\n    // PLAN-OPEN (TM-2): the public app name is not decided.\n    applicationId = "com.x" // PLAN-OPEN: the ID\n}\n';
    expect(read('apps/mobile/android/app/build.gradle.kts', kts)).toEqual([
      [2, 'TM-2', 'PLAN-OPEN (TM-2): the public app name is not decided.'],
      [3, null, 'PLAN-OPEN: the ID [on: applicationId = "com.x"]'],
    ]);
  });

  it('reads # in YAML and shell, and only where a word starts', () => {
    const yaml = [
      '  # Use my location.',
      '  # PLAN-OPEN: may Use my location ask Google (IMPLEMENTATION_PLAN.md section 6)?',
      '  geolocator: 14.1.2 # PLAN-OPEN (CO-9): the provider',
      "  note: Don't # PLAN-OPEN: after an apostrophe",
      '  run: echo "#1" # PLAN-OPEN: after a quoted "#"',
    ].join('\n');
    expect(read('apps/mobile/pubspec.yaml', yaml)).toEqual([
      [2, null, 'PLAN-OPEN: may Use my location ask Google (IMPLEMENTATION_PLAN.md section 6)?'],
      [3, 'CO-9', 'PLAN-OPEN (CO-9): the provider [on: geolocator: 14.1.2]'],
      [4, null, "PLAN-OPEN: after an apostrophe [on: note: Don't]"],
      [5, null, 'PLAN-OPEN: after a quoted "#" [on: run: echo "#1"]'],
    ]);
    const sh =
      '#!/usr/bin/env bash\n# PLAN-OPEN: which host?\n[ $# -gt 0 ] && echo "${#a}" # PLAN-OPEN: the count\n';
    expect(read('tools/x.sh', sh)).toEqual([
      [2, null, 'PLAN-OPEN: which host?'],
      [3, null, 'PLAN-OPEN: the count [on: [ $# -gt 0 ] && echo "${#a}"]'],
    ]);
  });

  it('reads -- and /* */ in SQL, where a quote in a string is written twice', () => {
    const sql = [
      '-- The table of reviews.',
      '-- PLAN-OPEN: which index (design 2.1)?',
      'create table a (',
      '  b int -- PLAN-OPEN (TM-6): how long? Seven days.',
      ');',
      '/* PLAN-OPEN: a block',
      '   over two lines. */',
      "select 'it''s -- PLAN-OPEN in a string';",
    ].join('\n');
    expect(read('db/migrations/0099_x.sql', sql)).toEqual([
      [2, null, 'PLAN-OPEN: which index (design 2.1)?'],
      [4, 'TM-6', 'PLAN-OPEN (TM-6): how long? Seven days. [on: b int]'],
      [6, null, 'PLAN-OPEN: a block over two lines.'],
      [8, null, "it's -- PLAN-OPEN in a string"],
    ]);
  });

  it("reads a forms diff file's JSON strings, several markers on one line, each its own", () => {
    const json =
      '{ "why": "PRD main 415; PLAN-OPEN (forms 10.1 #1): the team\\u2019s \\"units\\", to confirm; forms 10.1 #6; ' +
      'PLAN-OPEN (BM-42): a warning on a diastolic above the systolic", "id": "a" }';
    expect(read('packages/forms/definitions/spec/general-1.diff.json', json)).toEqual([
      [1, null, 'PLAN-OPEN (forms 10.1 #1): the team\u2019s "units", to confirm; forms 10.1 #6'],
      [1, 'BM-42', 'PLAN-OPEN (BM-42): a warning on a diastolic above the systolic'],
    ]);
  });

  it('reads a marker in a string of code as the string', () => {
    const ts = [
      "    it('the assignee then acts as the author (PLAN-OPEN 12.1 #7)', async () => {",
      "    'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the upstream list.',",
      "const s = 'it\\'s PLAN-OPEN: escaped';",
    ].join('\n');
    expect(read('services/api/test/x.test.ts', ts)).toEqual([
      [1, null, 'the assignee then acts as the author (PLAN-OPEN 12.1 #7)'],
      [2, null, 'PLAN-OPEN: nickname data (phase 3 design 14.1, #3): the upstream list.'],
      [3, null, "it's PLAN-OPEN: escaped"],
    ]);
  });

  it('reads a marker mid-sentence with its sentence, unless it starts a clause', () => {
    expect(
      read('services/api/src/x.ts', '// GET /v1/a (lifecycle 5.7; PLAN-OPEN 12.1 #12): the PDF.\n'),
    ).toEqual([[1, null, 'GET /v1/a (lifecycle 5.7; PLAN-OPEN 12.1 #12): the PDF.']]);
    expect(read('services/api/src/x.ts', '// One. Two; PLAN-OPEN: three.\n')).toEqual([
      [1, null, 'PLAN-OPEN: three.'],
    ]);
  });

  it('holds of a marker what it says up to the next marker, cut at a word within 60 characters', () => {
    const words = (file, text) => markersIn(file, text).map((m) => m.words);
    expect(
      words('apps/mobile/lib/x.dart', 'const searchMin = 0.50; // PLAN-OPEN: tune on pilot data\n'),
    ).toEqual(['PLAN-OPEN: tune on pilot data']);
    // Across the lines of its comment, as one text, and each marker up to the next.
    expect(
      words(
        'services/api/src/x.ts',
        "// The rule. PLAN-OPEN: who is told when someone keeps the\n//   server's value in a conflict? The author. PLAN-OPEN: b\n",
      ),
    ).toEqual(["PLAN-OPEN: who is told when someone keeps the server's value", 'PLAN-OPEN: b']);
    expect(words('services/api/src/x.ts', '// PLAN-OPEN: a? Yes. PLAN-OPEN: b? No.\n')).toEqual([
      'PLAN-OPEN: a? Yes.',
      'PLAN-OPEN: b? No.',
    ]);
    expect(
      words(
        'packages/forms/definitions/spec/x.diff.json',
        '{ "why": "PRD 1; PLAN-OPEN (forms 10.1 #1): the team\\u2019s \\"units\\", to confirm; PLAN-OPEN (BM-42): x" }',
      ),
    ).toEqual(['PLAN-OPEN (forms 10.1 #1): the team’s "units", to confirm;', 'PLAN-OPEN (BM-42): x']);
    // A long word near the start is cut through, so the words keep more than the marker.
    expect(words('services/api/src/x.ts', `// PLAN-OPEN: ${'a'.repeat(70)} b\n`)).toEqual([
      `PLAN-OPEN: ${'a'.repeat(49)}`,
    ]);
    for (const w of [
      ...Object.values(RULES)
        .flat()
        .map((r) => r[1]),
    ])
      expect(wordsOf(w)).toBe(w);
  });

  it('refuses a marker it cannot place in a comment or a string, rather than guess', () => {
    expect(read('services/api/src/x.ts', 'const t = `multi\nline PLAN-OPEN: in a template\n`;\n')).toEqual([
      [2, "can't tell which comment or string holds this marker: write it in a comment"],
    ]);
    expect(read('apps/mobile/ios/Runner/Info.plist', '<!-- PLAN-OPEN: the name -->')).toEqual([
      [1, "can't read a marker in this kind of file: teach KINDS in tools/decisions-check.mjs its comments"],
    ]);
  });

  it('reads the paths of a Where cell: backticked, with a "/" or at the root, braces expanded', () => {
    expect(
      pathsIn(
        '`apps/mobile/lib/features/forms/{text_field,number_field}.dart`; forms 10.1 #42; `CLAUDE.md`; `tasksFromNote`; `secureCopyLifetime`',
      ),
    ).toEqual([
      'apps/mobile/lib/features/forms/text_field.dart',
      'apps/mobile/lib/features/forms/number_field.dart',
      'CLAUDE.md',
    ]);
    expect(
      globMatch(
        'apps/portal/src/app/(app)/team/duplicates/[pairId]/DecisionForm.tsx',
        'apps/portal/src/app/(app)/team/duplicates/[pairId]/DecisionForm.tsx',
      ),
    ).toBe(true);
    expect(
      globMatch(
        'packages/forms/definitions/spec/*.diff.json',
        'packages/forms/definitions/spec/wound.diff.json',
      ),
    ).toBe(true);
    expect(
      globMatch(
        'packages/forms/definitions/spec/*.diff.json',
        'packages/forms/definitions/spec/old/wound.diff.json',
      ),
    ).toBe(false);
  });
});

describe('the command', () => {
  const CLI = fileURLToPath(new URL('../decisions-check.mjs', import.meta.url));

  it('reads the tracked files outside Markdown and its own, and fails with each problem', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-check-repo-'));
    const put = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    try {
      put('tools/decisions-check.mjs', readFileSync(CLI, 'utf8'));
      put(RULES_FILE, `export const RULES = ${JSON.stringify(RULES, null, 2)};\n`);
      put(DOC, BASE);
      for (const [file, text] of Object.entries(SOURCES)) put(file, text);
      // None of these is a marker: Markdown is prose, and the checker's tests are its fixtures.
      put('docs/setup.md', 'A PLAN-OPEN marker in code names its row.\n');
      put('tools/test/decisions-check.test.mjs', "// 'PLAN-OPEN: a fixture'\n");
      execFileSync('git', ['-C', dir, 'init', '-q']);
      execFileSync('git', ['-C', dir, 'add', '.']);
      // Nor is a file git doesn't track.
      put('services/api/src/draft.ts', '// PLAN-OPEN: not in the repository yet\n');
      const cli = () =>
        spawnSync(process.execPath, [join(dir, 'tools/decisions-check.mjs')], { encoding: 'utf8' });
      let r = cli();
      expect(r.stderr).toBe('');
      expect(r.stdout).toBe('Decisions document check: 5 markers clean, 2 naming their row and 3 by rule\n');
      expect(r.status).toBe(0);
      put(
        'apps/mobile/lib/encounters/close_sweep.dart',
        `${SOURCES['apps/mobile/lib/encounters/close_sweep.dart']}/// PLAN-OPEN: when is it released?\n`,
      );
      r = cli();
      expect(r.stderr).toBe(
        'Decisions document check found 1 problem(s):\n' +
          `  apps/mobile/lib/encounters/close_sweep.dart:3: this marker has no row: name its row, as in "PLAN-OPEN (BM-12): …", and add that row to ${DOC} under its decider if it isn't there ("PLAN-OPEN: when is it released?")\n`,
      );
      expect(r.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves out only its own files, which hold the word in their rules, messages and fixtures', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    for (const file of NOT_MARKERS)
      expect(readFileSync(join(root, file), 'utf8'), file).toContain('PLAN-OPEN');
  });

  it('passes on this repository, and lists every marker with its row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-check-'));
    try {
      const list = join(dir, 'markers.txt');
      const r = spawnSync(process.execPath, [CLI, '--list', list], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const [, count] = /^Decisions document check: (\d+) markers clean/.exec(r.stdout);
      const lines = readFileSync(list, 'utf8').split('\n');
      expect(lines).toContain('# problems: 0');
      const markers = lines.filter((l) => l !== '' && !l.startsWith('#'));
      expect(markers).toHaveLength(Number(count));
      for (const l of markers) expect(l, l).toMatch(/^[^\t]+:\d+\t(PL|BM|CO|TM|BF)-\d+\t\S/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an argument it does not know', () => {
    const r = spawnSync(process.execPath, [CLI, '--lsit', 'x'], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^Usage: node tools\/decisions-check\.mjs \[--list <file>\]/);
  });
});
