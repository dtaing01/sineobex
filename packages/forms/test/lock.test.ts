import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical.ts';
import { checkLock, LOCK_FILE, lockOf, lockText } from '../src/lock.ts';
import { definitionFiles, type LooseFiles } from './fixtures/load.ts';

// A released version never changes (design 4.2, and the rule each test holds in section 9). The
// fixture tree is released as it stands; each test then makes one change to the tree or to the lock.

const CHECKS = 'note-types/checks_demo/v1.json';
const FULL = 'note-types/full_demo/v1.json';
const EXAM = 'modules/demo_exam/v1.json';
const YES_NO = 'lists/demo_yes_no.json';

type Expected = [file: string, path: string, rule: string];
const sorted = (found: Expected[]) => found.map((p) => p.join('  ')).sort();

async function found(lock: unknown, files: LooseFiles): Promise<string[]> {
  const problems = await checkLock(lock, files);
  for (const p of problems) expect(p.message.length, p.rule).toBeGreaterThan(10);
  return sorted(problems.map((p): Expected => [p.file, p.path, p.rule]));
}

/** The fixture tree released, then one change to the tree, and exactly the problems it should give. */
function broken(name: string, change: (files: LooseFiles) => void, ...expected: Expected[]) {
  it(name, async () => {
    const files = definitionFiles();
    const lock = await lockOf(files);
    change(files);
    expect(await found(lock, files)).toEqual(sorted(expected));
  });
}
function fits(name: string, change: (files: LooseFiles) => void) {
  broken(name, change);
}
/** The fixture tree, and a lock with one change. */
function badLock(name: string, change: (lock: Record<string, unknown>) => void, ...expected: Expected[]) {
  it(name, async () => {
    const files = definitionFiles();
    const lock: Record<string, unknown> = await lockOf(files);
    change(lock);
    expect(await found(lock, files)).toEqual(sorted(expected));
  });
}

describe('the lock of a tree', () => {
  it('holds one hash for every note type version, module version and list', async () => {
    const files = definitionFiles();
    const lock = await lockOf(files);
    expect(Object.keys(lock).sort()).toEqual(
      [...Object.keys(files.noteTypes), ...Object.keys(files.modules), ...Object.keys(files.lists)].sort(),
    );
    // The hash of the content in canonical form, worked out here by another route.
    const expected = createHash('sha256').update(canonicalJson(files.noteTypes[CHECKS])).digest('hex');
    expect(lock[CHECKS]).toBe(expected);
  });

  it('is written with its files in order, one to a line, so a release reads as added lines', async () => {
    const lock = await lockOf(definitionFiles());
    const text = lockText(Object.fromEntries(Object.entries(lock).reverse()));
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(lock);
    const keys = [...text.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual(Object.keys(lock).sort());
    expect(keys.length).toBe(Object.keys(lock).length);
  });

  it('passes the tree it was made from', async () => {
    const files = definitionFiles();
    expect(await found(await lockOf(files), files)).toEqual([]);
  });

  it('passes a tree with nothing released', async () => {
    expect(await found({}, definitionFiles())).toEqual([]);
  });
});

describe('a released file', () => {
  broken('a note type version that changed', (f) => (f.noteTypes[CHECKS].title = 'Checks, reworded'), [
    CHECKS,
    '$',
    'lock.changed',
  ]);
  broken('a module version that changed', (f) => (f.modules[EXAM].sections[1].title = 'Both ears'), [
    EXAM,
    '$',
    'lock.changed',
  ]);
  broken('a list that changed', (f) => f.lists[YES_NO].options.push({ code: 'unsure', label: 'Unsure' }), [
    YES_NO,
    '$',
    'lock.changed',
  ]);
  broken('a note type version that disappeared', (f) => delete f.noteTypes[FULL], [
    FULL,
    '$',
    'lock.missing',
  ]);
  broken('a module version that disappeared', (f) => delete f.modules['modules/demo_exam/v2.json'], [
    'modules/demo_exam/v2.json',
    '$',
    'lock.missing',
  ]);
  broken('a list that disappeared', (f) => delete f.lists['lists/demo_sites.json'], [
    'lists/demo_sites.json',
    '$',
    'lock.missing',
  ]);

  fits('written again with its keys in another order is the same content', (f) => {
    const file = f.noteTypes[CHECKS];
    f.noteTypes[CHECKS] = Object.fromEntries(Object.entries(file).reverse());
    const first = file.sections[0].fields[0];
    file.sections[0].fields[0] = Object.fromEntries(Object.entries(first).reverse());
  });
});

describe('a file that is not released', () => {
  fits('a new version of a note type passes, and so do a new module and a new list', (f) => {
    f.noteTypes['note-types/checks_demo/v2.json'] = { ...f.noteTypes[CHECKS], version: 2, title: 'Second' };
    f.modules['modules/demo_exam/v3.json'] = { ...f.modules[EXAM], version: 3 };
    f.lists['lists/demo_new.json'] = { name: 'demo_new', options: [{ code: 'a', label: 'A' }] };
  });

  it('may change freely until it is released', async () => {
    const files = definitionFiles();
    const lock: Record<string, string> = await lockOf(files);
    delete lock['modules/demo_exam/v2.json'];
    files.modules['modules/demo_exam/v2.json'].sections[0].title = 'Still a draft';
    expect(await found(lock, files)).toEqual([]);
  });
});

describe('what a released file is made of', () => {
  // The server stores the hash of the resolved definition, so a released note type is only fixed
  // when every module and list copied into it is fixed too.
  badLock('a released note type that includes a module version that is not', (lock) => delete lock[EXAM], [
    CHECKS,
    '$.sections[1]',
    'lock.unreleased_part',
  ]);
  badLock(
    'a released note type that names a list that is not',
    (lock) => delete lock[YES_NO],
    [CHECKS, '$.sections[0].fields[1].options.list', 'lock.unreleased_part'],
    [CHECKS, '$.sections[3].fields[0].cell.fields[0].options.list', 'lock.unreleased_part'],
  );
  badLock(
    'a released module that names a list that is not, and the rows of a grid',
    (lock) => {
      delete lock['lists/demo_scale.json'];
      delete lock['lists/demo_sites.json'];
    },
    [EXAM, '$.sections[0].fields[0].options.list', 'lock.unreleased_part'],
    [CHECKS, '$.sections[2].fields[4].rows.list', 'lock.unreleased_part'],
    [CHECKS, '$.sections[2].fields[4].cell.options.list', 'lock.unreleased_part'],
    [CHECKS, '$.sections[3].fields[1].cell.options.list', 'lock.unreleased_part'],
  );
  badLock(
    'the list a region takes its sides from, and the list of its regions',
    (lock) => {
      delete lock['lists/side.json'];
      delete lock['lists/demo_regions.json'];
    },
    [FULL, '$.sections[1].fields[0].side', 'lock.unreleased_part'],
    [FULL, '$.sections[1].fields[0].options.list', 'lock.unreleased_part'],
    [CHECKS, '$.sections[2].fields[0].options.list', 'lock.unreleased_part'],
  );

  badLock(
    'the list a region takes its surface from',
    (lock) => delete lock['lists/surface.json'],
    [FULL, '$.sections[1].fields[0].surface', 'lock.unreleased_part'],
    [CHECKS, '$.sections[2].fields[0].surface', 'lock.unreleased_part'],
  );

  it('a draft may include a draft', async () => {
    const files = definitionFiles();
    const lock: Record<string, string> = await lockOf(files);
    delete lock[CHECKS];
    delete lock[EXAM];
    expect(await found(lock, files)).toEqual([]);
  });
});

describe('the lock file itself', () => {
  for (const [name, lock] of [
    ['a list', []],
    ['nothing', null],
    ['a text', 'released'],
  ] as const)
    it(`is refused when it is ${name}`, async () => {
      expect(await found(lock, definitionFiles())).toEqual(sorted([[LOCK_FILE, '$', 'lock.bad_file']]));
    });

  badLock('an entry that is not a hash', (lock) => (lock[CHECKS] = 'changed'), [
    LOCK_FILE,
    `$["${CHECKS}"]`,
    'lock.bad_entry',
  ]);
  badLock('an entry whose hash is in capitals', (lock) => (lock[FULL] = String(lock[FULL]).toUpperCase()), [
    LOCK_FILE,
    `$["${FULL}"]`,
    'lock.bad_entry',
  ]);
  badLock('an entry that holds its hash inside a list', (lock) => (lock[FULL] = [lock[FULL]]), [
    LOCK_FILE,
    `$["${FULL}"]`,
    'lock.bad_entry',
  ]);
  for (const path of [
    'spec/demo.txt',
    'old/note-types/checks_demo/v1.json',
    'note-types/checks_demo/v1.json.bak',
    'note-types/checks_demo/v1',
    'note-types/checks_demo/v01.json',
    'lists/demo/v1.json',
    '../outside.json',
  ])
    badLock(
      `an entry for ${path}, which is no released kind of file`,
      (lock) => (lock[path] = lock[CHECKS]),
      [LOCK_FILE, `$["${path}"]`, 'lock.bad_entry'],
    );
});
