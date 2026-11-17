import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/canonical.ts';
import { lockOf, lockText } from '../src/lock.ts';
import { resolve } from '../src/resolve.ts';
import { readPieces } from '../src/spec-check.ts';
import { exportDefinitions, main, PRESETS_FILE } from '../scripts/export.ts';
import { lockShrinks, main as lockGrows } from '../scripts/lock-grows.ts';
import { definitionFiles, specTexts } from './fixtures/load.ts';

// The export reads definitions/ from disk, runs every check of forms 4.2 and writes the presets.
// Each case runs it over a scratch copy of the fixture trees with one change: the real tree is
// never written by a test.

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'forms-export-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const CHECKS = 'note-types/checks_demo/v1.json';
const FULL = 'note-types/full_demo/v1.json';
const EXAMPLE = 'note-types/harm_reduction_example/v1.json';
const EXAM = 'modules/demo_exam/v1.json';

type Json = Record<string, unknown>;

/** A package folder holding definitions/ copied from the fixture trees named, and a phone asset beside it. */
function tree(...from: string[]) {
  const root = mkdtempSync(join(scratch, 'tree-'));
  const definitions = join(root, 'definitions');
  for (const name of from) cpSync(join(FIXTURES, name), definitions, { recursive: true });
  const at = (path: string) => join(definitions, path);
  const t = {
    root,
    phoneAsset: join(root, 'phone', 'assets', 'forms', 'presets.json'),
    presets: join(root, PRESETS_FILE),
    lock: join(root, 'definitions.lock.json'),
    read: (path: string): Json => JSON.parse(readFileSync(at(path), 'utf8')),
    write(path: string, content: unknown) {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    },
    edit(path: string, change: (file: Json) => void) {
      const file = t.read(path);
      change(file);
      t.write(path, file);
    },
    remove: (path: string) => rmSync(at(path)),
    run: (release = false) => exportDefinitions({ root, phoneAsset: t.phoneAsset, release }),
  };
  return t;
}

const GOOD = ['definitions', 'example'] as const;
const found = (problems: { file: string; path: string; rule: string }[]) =>
  problems.map((p) => `${p.file}  ${p.path}  ${p.rule}`).sort();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a fixture file, changed in ways its type forbids
const fields = (file: Json, section = 0): any[] => (file.sections as any[])[section].fields;

/** A copy of a note type file under another key: the same sections, so it includes what the first includes. */
function copyAs(t: ReturnType<typeof tree>, from: string, key: string, version = 1) {
  const file = t.read(from);
  t.write(`note-types/${key}/v${version}.json`, { ...file, key, version });
}

/**
 * A piece whose definition is not written yet (its shape file is for a file that does not exist,
 * so the shape check does not look for it), and a list nothing names.
 */
function addSpares(t: ReturnType<typeof tree>) {
  for (const end of ['txt', 'diff.json', 'shape.json']) {
    const text = readFileSync(join(FIXTURES, `example/spec/harm-reduction-2.${end}`), 'utf8');
    t.write(`spec/spare-piece.${end}`, text.replaceAll('"harm-reduction-2"', '"spare-piece"'));
  }
  t.edit('spec/spare-piece.shape.json', (shape) => {
    shape.file = 'note-types/later_demo/v1.json';
  });
  t.write('lists/spare_list.json', { name: 'spare_list', options: [{ code: 'one', label: 'One' }] });
}

/** The fixture trees without the one file no note type uses, which the release mode refuses. */
function releasable() {
  const t = tree(...GOOD);
  t.remove('modules/demo_exam/v2.json');
  return t;
}

describe('a tree that passes', () => {
  it('writes every note type version, resolved, in a fixed order with its hash, and the phone copy byte for byte', async () => {
    const t = tree(...GOOD);
    const result = await t.run();
    expect(result.problems).toEqual([]);

    const files = definitionFiles('definitions');
    Object.assign(files.noteTypes, definitionFiles('example').noteTypes);
    const expected = [];
    for (const file of [CHECKS, FULL, EXAMPLE]) {
      const resolved = resolve(file, files);
      if (!resolved.ok) throw new Error(`${file} did not resolve`);
      const { definition } = resolved;
      const hash = await sha256Hex(canonicalJson(definition));
      expected.push({ key: definition.key, version: definition.version, hash, definition });
    }
    const written = readFileSync(t.presets, 'utf8');
    expect(JSON.parse(written)).toEqual(expected);
    expect(result.presets).toEqual(expected);
    // A resolved definition has no include and no list reference left.
    expect(written).not.toContain('"include"');
    expect(written).not.toContain('"list"');
    expect(readFileSync(t.phoneAsset, 'utf8')).toBe(written);
    expect(written.endsWith(']\n')).toBe(true);
  });

  it('writes the same bytes on a second run', async () => {
    const t = tree(...GOOD);
    await t.run();
    const first = readFileSync(t.presets, 'utf8');
    await t.run();
    expect(readFileSync(t.presets, 'utf8')).toBe(first);
  });

  it('writes the same bytes for a file with its keys in another order, as the lock and the hash do', async () => {
    const t = tree(...GOOD);
    await t.run();
    const first = readFileSync(t.presets, 'utf8');
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([k, v]) => [k, reversed(v)]),
            )
          : value;
    for (const file of [CHECKS, EXAM, 'lists/demo_scale.json']) t.write(file, reversed(t.read(file)));
    expect((await t.run()).problems).toEqual([]);
    expect(readFileSync(t.presets, 'utf8')).toBe(first);
    expect(readFileSync(t.phoneAsset, 'utf8')).toBe(first);
  });

  it('orders versions by number, not by their text', async () => {
    const t = tree('definitions');
    for (const version of [2, 10]) copyAs(t, FULL, 'full_demo', version);
    const result = await t.run();
    expect(result.problems).toEqual([]);
    expect(result.presets.map((p) => `${p.key} ${p.version}`)).toEqual([
      'checks_demo 1',
      'full_demo 1',
      'full_demo 2',
      'full_demo 10',
    ]);
  });

  it('writes an empty list when there is no note type', async () => {
    const t = tree();
    mkdirSync(join(t.root, 'definitions', 'lists'), { recursive: true });
    t.write('lists/side.json', definitionFiles().lists['lists/side.json']);
    const result = await t.run();
    expect(result.problems).toEqual([]);
    expect(readFileSync(t.presets, 'utf8')).toBe('[]\n');
    expect(readFileSync(t.phoneAsset, 'utf8')).toBe('[]\n');
  });

  it('never writes the lock without --release', async () => {
    const t = tree(...GOOD);
    await t.run();
    expect(existsSync(t.lock)).toBe(false);
  });

  it('notes, and fails nothing for, what nothing uses yet: a piece, a module, a list', async () => {
    const t = tree(...GOOD);
    addSpares(t);
    const result = await t.run();
    expect(result.problems).toEqual([]);
    const notes = result.notes.map((n) => `${n.file}  ${n.message}`);
    expect(notes).toContainEqual(expect.stringMatching(/^spec\/spare-piece\.txt {2}.*no definition/));
    expect(notes).toContainEqual(expect.stringMatching(/^modules\/demo_exam\/v2\.json {2}.*no note type/));
    expect(notes).toContainEqual(expect.stringMatching(/^lists\/spare_list\.json {2}.*no note type/));
    // What is used is not noted.
    expect(notes.filter((n) => /harm-reduction-2|demo_exam\/v1|lists\/side/.test(n))).toEqual([]);
  });
});

describe('the most answers a note can hold', () => {
  it('counts every path, each repeating section at its repeat.max with its entry’s own two answers', async () => {
    const t = tree();
    t.write('note-types/count_demo/v1.json', {
      key: 'count_demo',
      version: 1,
      title: 'Count (test)',
      kinds: ['medical'],
      group: 'clinical',
      sensitivity: 'none',
      sections: [
        {
          id: 'once',
          title: 'Once',
          fields: [
            // right and left: 2
            { id: 'size', kind: 'number', label: 'Size', min: 0, max: 10, decimals: 0, sides: true },
            // the code and the text of its Other: 2
            {
              id: 'kind',
              kind: 'choice',
              many: false,
              label: 'Kind',
              options: [
                { code: 'cut', label: 'Cut' },
                { code: 'other', label: 'Other', other: true },
              ],
            },
            { id: 'about', kind: 'info', label: 'Demo: nothing stored' },
          ],
        },
        {
          id: 'items',
          title: 'Items',
          repeat: { max: 3, itemTitle: 'Item {n}' },
          // one answer, entryAt and entryRemoved: 3 an entry, 3 entries
          fields: [{ id: 'note', kind: 'text', label: 'Note', lines: 'one', maxLength: 100 }],
        },
      ],
    });
    const result = await t.run();
    expect(result.problems).toEqual([]);
    expect(result.answers).toEqual({ 'note-types/count_demo/v1.json': 2 + 2 + 3 * 3 });
    expect(result.notes).toContainEqual({
      file: 'note-types/count_demo/v1.json',
      message: 'a note on it can hold at most 13 answers',
    });
  });

  it('refuses nothing for it', async () => {
    const t = tree(...GOOD);
    const result = await t.run();
    expect(result.problems).toEqual([]);
    // Wound care's 20 wounds, each with its region, side and surface, its type and its Other text.
    expect(result.answers[FULL]).toBe(1 + 2 + 2 + 20 * (3 + 2 + 2));
  });
});

describe('a tree that fails', () => {
  it('stops after schema problems: no later check reads a file that did not pass', async () => {
    const t = tree(...GOOD);
    t.edit(CHECKS, (file) => {
      file.titel = file.title;
    });
    // The resolver would find this, if it ran.
    t.edit(FULL, (file) => {
      (file.sections as unknown[]).push({ include: 'no_such_module', version: 1 });
    });
    const result = await t.run();
    expect(found(result.problems)).toEqual([`${CHECKS}  $.titel  schema.unknown_key`]);
    expect(existsSync(t.presets)).toBe(false);
    expect(existsSync(t.phoneAsset)).toBe(false);
  });

  it('refuses a file that does not parse, and a file in no place a definition file lives', async () => {
    const t = tree(...GOOD);
    t.write(FULL, '{ "key": ');
    t.write('note-types/full_demo/v1.jsn', '{}');
    t.write('notes.json', '{}');
    t.write('spec/README', 'Demo: not a piece');
    const result = await t.run();
    expect(found(result.problems)).toEqual([
      'note-types/full_demo/v1.jsn  $  export.unknown_file',
      `${FULL}  $  export.bad_json`,
      'notes.json  $  export.unknown_file',
      'spec/README  $  spec.unknown_file',
    ]);
    expect(existsSync(t.presets)).toBe(false);
  });

  it('reports the resolver’s problems', async () => {
    const t = tree(...GOOD);
    t.edit(CHECKS, (file) => {
      (file.sections as Json[]).find((s) => 'include' in s)!.include = 'no_such_module';
    });
    const result = await t.run();
    expect(found(result.problems)).toEqual([`${CHECKS}  $.sections[1].include  resolve.unknown_module`]);
    expect(existsSync(t.presets)).toBe(false);
  });

  it('reports a module’s fault once, however many note types include it', async () => {
    const t = tree(...GOOD);
    copyAs(t, CHECKS, 'other_demo');
    t.edit(EXAM, (file) => {
      fields(file, 1)[0].options[1].code = 'intact';
    });
    const result = await t.run();
    expect(found(result.problems)).toEqual([
      `${EXAM}  $.sections[1].fields[0].options[1].code  validate.duplicate_code`,
    ]);
    expect(result.problems).toHaveLength(1);
  });

  it('gives the validator the other note types', async () => {
    const t = tree(...GOOD);
    t.remove(FULL);
    const result = await t.run();
    const rules = new Set(result.problems.map((p) => `${p.file} ${p.rule}`));
    expect(rules).toContain(`${CHECKS} validate.unknown_note_type`);
  });

  it('checks a quick version’s mapsTo against the full form only when it is the newest', async () => {
    const t = tree(...GOOD);
    const brokenMap = (file: Json) => {
      fields(file)[1].mapsTo = 'full_demo:history.nothing';
    };
    t.edit(CHECKS, brokenMap);
    expect(found((await t.run()).problems)).toEqual([
      `${CHECKS}  $.sections[0].fields[1].mapsTo  validate.maps_to_unknown_field`,
    ]);
    // A newer quick version that maps correctly: the old one is released and no longer edited.
    const good = tree(...GOOD);
    copyAs(good, CHECKS, 'checks_demo', 2);
    good.edit(CHECKS, brokenMap);
    expect((await good.run()).problems).toEqual([]);
  });

  it('runs the lock check', async () => {
    const t = tree(...GOOD);
    writeFileSync(t.lock, JSON.stringify({ 'lists/demo_scale.json': '0'.repeat(64) }));
    expect(found((await t.run()).problems)).toEqual(['lists/demo_scale.json  $  lock.changed']);
    writeFileSync(t.lock, '{ not json');
    expect(found((await t.run()).problems)).toEqual(['definitions.lock.json  $  lock.bad_file']);
  });

  it('runs the version rules', async () => {
    const t = tree(...GOOD);
    copyAs(t, FULL, 'full_demo', 2);
    t.edit('note-types/full_demo/v2.json', (file) => {
      fields(file, 1)[1].options[0].label = 'Demo: a cut';
    });
    expect(found((await t.run()).problems)).toEqual([
      'note-types/full_demo/v2.json  $.sections[1].fields[1].options[0].label  versions.label_changed',
    ]);
  });

  it('runs the spec check', async () => {
    const t = tree(...GOOD);
    t.edit(EXAMPLE, (file) => {
      fields(file)[0].options[2] = { code: 'refused', label: 'Refused' };
    });
    const rules = new Set((await t.run()).problems.map((p) => p.rule));
    expect(rules).toContain('spec.not_in_piece');
    expect(rules).toContain('spec.not_in_definition');
  });

  it('runs the shape check', async () => {
    const t = tree(...GOOD);
    t.edit(EXAMPLE, (file) => {
      fields(file)[0].many = true;
    });
    expect(found((await t.run()).problems)).toEqual([
      `${EXAMPLE}  $.sections[0].fields[0].many  shape.field_differs`,
    ]);
  });
});

describe('the release mode', () => {
  it('refuses a piece no definition names and a list or module no note type uses, and writes nothing', async () => {
    const t = tree(...GOOD);
    addSpares(t);
    const result = await t.run(true);
    expect(found(result.problems)).toEqual([
      'lists/spare_list.json  $  export.unused_file',
      'modules/demo_exam/v2.json  $  export.unused_file',
      'spec/spare-piece.txt  $  export.unused_file',
    ]);
    expect(existsSync(t.lock)).toBe(false);
    expect(existsSync(t.presets)).toBe(false);
    // Without --release the same tree passes: unused files are only noted.
    expect((await t.run()).problems).toEqual([]);
  });

  it('writes the lock over every file present, its pieces and each version’s resolved hash', async () => {
    const t = releasable();
    const result = await t.run(true);
    expect(result.problems).toEqual([]);
    const files = definitionFiles('definitions');
    Object.assign(files.noteTypes, definitionFiles('example').noteTypes);
    delete files.modules['modules/demo_exam/v2.json'];
    const { pieces } = readPieces(specTexts('example'));
    const lock = await lockOf(files, pieces);
    expect(readFileSync(t.lock, 'utf8')).toBe(lockText(lock));
    expect(Object.keys(lock)).toContain(`${EXAMPLE}#resolved`);
    expect(Object.keys(lock)).toContain('spec/harm-reduction-2.shape.json');
    expect(existsSync(t.presets)).toBe(true);

    // Released: the next run passes against the lock, and a released file can no longer change.
    expect((await t.run()).problems).toEqual([]);
    t.edit('lists/demo_scale.json', (file) => {
      (file.options as Json[])[0]!.label = 'Demo: changed';
    });
    expect(found((await t.run()).problems)).toContainEqual('lists/demo_scale.json  $  lock.changed');
  });

  it('does not write the lock when any check fails', async () => {
    const t = releasable();
    t.edit(EXAMPLE, (file) => {
      fields(file)[0].many = true;
    });
    expect(existsSync(t.lock)).toBe(false);
  });
});

describe('the command', () => {
  it('prints each problem once with its file, place and rule, and exits non-zero', async () => {
    const t = tree(...GOOD);
    copyAs(t, CHECKS, 'other_demo');
    t.edit(EXAM, (file) => {
      fields(file, 1)[0].options[1].code = 'intact';
    });
    const lines: string[] = [];
    const code = await main([], { root: t.root, phoneAsset: t.phoneAsset, print: (l) => lines.push(l) });
    expect(code).toBe(1);
    const problems = lines.filter((l) => l.includes('validate.duplicate_code'));
    expect(problems).toHaveLength(1);
    expect(
      problems[0]!.startsWith(`${EXAM}  $.sections[1].fields[0].options[1].code  validate.duplicate_code  `),
    ).toBe(true);
    expect(existsSync(t.presets)).toBe(false);
  });

  it('exits zero on a tree that passes, and takes --release', async () => {
    const t = releasable();
    const print = () => {};
    expect(await main([], { root: t.root, phoneAsset: t.phoneAsset, print })).toBe(0);
    expect(existsSync(t.lock)).toBe(false);
    expect(await main(['--release'], { root: t.root, phoneAsset: t.phoneAsset, print })).toBe(0);
    expect(existsSync(t.lock)).toBe(true);
    await expect(main(['--relase'], { root: t.root, phoneAsset: t.phoneAsset, print })).rejects.toThrow(
      /--relase/,
    );
  });
});

describe('the lock only grows', () => {
  // The export holds the tree to whatever lock it finds, so a lock deleted or emptied would release
  // nothing with every check green (review EXP-2). The drift step compares it with the base's.
  const git = (root: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...args], {
      cwd: root,
      stdio: 'pipe',
    });
  const released = async () => {
    const t = releasable();
    expect((await t.run(true)).problems).toEqual([]);
    git(t.root, 'init', '-q');
    git(t.root, 'add', '-A');
    git(t.root, 'commit', '-qm', 'Demo: release');
    return t;
  };
  const run = (t: { root: string }, base = 'HEAD') => {
    const lines: string[] = [];
    const code = lockGrows([base], { root: t.root, print: (l) => lines.push(l) });
    return { code, lines };
  };

  it('refuses a lock deleted or emptied, which the export alone lets through', async () => {
    const t = await released();
    const lock = readFileSync(t.lock, 'utf8');
    const lines = Object.keys(JSON.parse(lock) as Json).length;
    rmSync(t.lock);
    expect((await t.run()).problems).toEqual([]);
    expect(run(t).code).toBe(1);
    expect(lockShrinks(lock, null)).toHaveLength(lines);
    writeFileSync(t.lock, '{}\n');
    expect((await t.run()).problems).toEqual([]);
    const { code, lines: printed } = run(t);
    expect(code).toBe(1);
    expect(printed.filter((l) => l.includes('lock.removed'))).toHaveLength(lines);
  });

  it('refuses a line dropped or rehashed, and takes a line added', async () => {
    const t = await released();
    const lock = JSON.parse(readFileSync(t.lock, 'utf8')) as Record<string, string>;
    const head = (change: (l: Record<string, string>) => void) => {
      const next = { ...lock };
      change(next);
      return JSON.stringify(next);
    };
    const base = JSON.stringify(lock);
    expect(
      found(
        lockShrinks(
          base,
          head((l) => delete l['lists/demo_scale.json']),
        ),
      ),
    ).toEqual(['definitions.lock.json  $["lists/demo_scale.json"]  lock.removed']);
    expect(
      found(
        lockShrinks(
          base,
          head((l) => (l[`${EXAMPLE}#resolved`] = '0'.repeat(64))),
        ),
      ),
    ).toEqual([`definitions.lock.json  $["${EXAMPLE}#resolved"]  lock.rehashed`]);
    writeFileSync(
      t.lock,
      head((l) => (l['lists/demo_new.json'] = '0'.repeat(64))),
    );
    expect(run(t).code).toBe(0);
  });

  it('takes any lock when the base has none, and refuses a base it cannot read', async () => {
    const t = tree(...GOOD);
    git(t.root, 'init', '-q');
    git(t.root, 'add', '-A');
    git(t.root, 'commit', '-qm', 'Demo: drafts');
    expect(run(t).code).toBe(0);
    expect(() => run(t, 'no-such-commit')).toThrow();
    expect(() => lockGrows([], { root: t.root, print: () => {} })).toThrow(/base commit/);
  });
});
