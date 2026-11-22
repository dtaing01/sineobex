import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

/** The check names the workflow's jobs report: a matrix job's once for each of its values. */
function ciCheckNames(yaml) {
  const jobs = yaml.slice(yaml.indexOf('\njobs:\n'));
  return jobs
    .split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)
    .slice(1)
    .flatMap((block) => {
      const name = /^ {4}name: (.+)$/m.exec(block)?.[1];
      if (!name) throw new Error(`job ${block.split('\n')[0].trim()} has no name`);
      const matrix = /\$\{\{ matrix\.(\w+) \}\}/.exec(name);
      if (!matrix) return [name];
      const values = new RegExp(`^ +${matrix[1]}: \\[(.+)\\]$`, 'm').exec(block)?.[1];
      if (!values) throw new Error(`job ${name} has no ${matrix[1]} list`);
      return values.split(',').map((v) => name.replace(matrix[0], v.trim().replace(/^'|'$/g, '')));
    });
}

/** The checks the setup page says branch protection requires. */
function requiredChecks(setup) {
  const bullet = setup.split('\n').find((line) => line.startsWith('- **Branch protection on `main`:**'));
  const list = /as a CI check \((.+?)\); a name here/.exec(bullet ?? '')?.[1];
  if (!list) throw new Error('docs/setup.md has no list of required checks');
  return [...list.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

describe('the setup page', () => {
  // A required check no job reports holds every pull request open, waiting for it; a job left off
  // the list is one a red run doesn't stop from merging.
  it('requires exactly the checks CI reports', () => {
    const jobs = ciCheckNames(read('.github/workflows/ci.yml'));
    const listed = requiredChecks(read('docs/setup.md'));
    expect(jobs).toContain('Migrations and API tests (Postgres 17)');
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...jobs].sort());
  });
});
