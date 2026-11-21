#!/usr/bin/env node
// PHI guard (module 10: "Run a PHI guard and secret scan in CI on the fresh repo from its first commit").
//  1. Fixtures and seed data must be obviously fictional: no SSN-shaped numbers, real-range phone
//     numbers, emails at real domains, or Medicare-ID-shaped strings.
//  2. Architecture rules that keep patient data on known paths (see phi-guard-rules.mjs).
// Scans files tracked by git. A line can opt out with a trailing `phi-guard: allow` comment and a reason.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FIXTURE_GLOBS, scanFixture, scanSource } from './phi-guard-rules.mjs';

const TEXT = /\.(ts|tsx|mjs|js|json|sql|dart|yaml|yml|csv|md|txt)$/;
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && TEXT.test(f) && !f.startsWith('apps/website/') && f !== 'pnpm-lock.yaml');

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (FIXTURE_GLOBS.some((g) => g.test(file))) findings.push(...scanFixture(file, text));
  findings.push(...scanSource(file, text));
}

if (findings.length > 0) {
  console.error(`PHI guard found ${findings.length} problem(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`PHI guard: ${files.length} files clean`);
