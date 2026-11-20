import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Loading a patient page logs a view, so a prefetch would log one nobody made: every Link to a
// patient page turns prefetching off. So does every Link to a visit page, whose read logs each
// record it shows (phase 4 design, lifecycle 9.11).
const APP = join(__dirname, '..', 'app');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

function offenders(page: 'patients' | 'encounters'): string[] {
  const found: string[] = [];
  const link = new RegExp(`<Link\\b[^>]*?href=\\{\`\\/${page}\\/[^>]*>`, 'gs');
  for (const file of sources(APP)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(link)) {
      if (!match[0].includes('prefetch={false}')) found.push(`${file}: ${match[0].slice(0, 80)}`);
    }
  }
  return found;
}

describe('links to patient pages', () => {
  it('never prefetch', () => {
    expect(offenders('patients')).toEqual([]);
  });
});

describe('links to visit pages', () => {
  it('never prefetch', () => {
    expect(offenders('encounters')).toEqual([]);
  });
});
