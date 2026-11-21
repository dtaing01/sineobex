#!/usr/bin/env node
// Task card check: every card under docs/plan/<phase>/cards/ has the sections, level, file limits
// and reading list that docs/plan/README.md asks for, and names only files that exist or that an
// earlier card makes. Run from the repository root. Pass card paths to check only those.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { checkCard, namedModel } from './card-check-rules.mjs';

const CARD = /^docs\/plan\/[^/]+\/cards\/[^/]+\.md$/;
const given = process.argv.slice(2);
const files =
  given.length > 0
    ? given
    : execFileSync('git', ['ls-files', 'docs/plan'], { encoding: 'utf8' })
        .split('\n')
        .filter((f) => CARD.test(f));

const repo = {
  exists: (path) => existsSync(path),
  lineCount: (path) => readFileSync(path, 'utf8').replace(/\n$/, '').split('\n').length,
};

const problems = files.flatMap((file) => checkCard(file, readFileSync(file, 'utf8'), repo));

// The documents the small model is sent, and those that say how it is run, name no model either.
if (given.length === 0) {
  for (const file of execFileSync('git', ['ls-files', 'docs/plan'], { encoding: 'utf8' }).split('\n')) {
    if (!file.endsWith('.md') || CARD.test(file)) continue;
    const named = namedModel(readFileSync(file, 'utf8'));
    if (named) problems.push(`${file}: names a model ("${named}"); documents name none`);
  }
}

if (problems.length > 0) {
  console.error(`Task card check found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`Task card check: ${files.length} cards clean`);
