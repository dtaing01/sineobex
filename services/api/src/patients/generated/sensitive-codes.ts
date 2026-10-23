// GENERATED FILE. Do not edit by hand.
// Source: packages/contract/data/sensitive-code-ranges.csv.
// Regenerate with `pnpm contract:generate`; a contract test fails if this file is out of date.

/**
 * Problem codes sensitive by default: a code is in a range when its first `from.length` characters
 * sort between `from` and `to`.
 * PLAN-OPEN: which codes are sensitive (phase 3 design 14.1, #6), with counsel; 42 CFR Part 2 may widen it.
 */
export const SENSITIVE_CODE_RANGES: readonly { from: string; to: string }[] = [
  { from: 'F01', to: 'F99' },
  { from: 'O00', to: 'O9A' },
  { from: 'Z30', to: 'Z39' },
  { from: 'B20', to: 'B20' },
  { from: 'Z21', to: 'Z21' },
  { from: 'A50', to: 'A64' },
  { from: 'Z71.4', to: 'Z71.4' },
];
