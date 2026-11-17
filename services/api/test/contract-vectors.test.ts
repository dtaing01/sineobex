import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ID_LINK_TOKEN_PATTERN,
  idLinkTokenHash,
  idLinkTokenRef,
  idLinkUrl,
  newIdLinkToken,
} from '../src/patients/id-links.ts';
import { RULES } from '../src/sync/entities/index.ts';
import { AuditAppend, CREATE_SCHEMAS, valueParents } from '../src/sync/entities/values.ts';
import { NOTE_LIFE_ENTITIES, REFERRAL_ENTITIES, type AnyRecordEntityName } from '../src/sync/schemas.ts';

// The vectors the API shares with the phone (packages/contract/test-vectors): sync values (phase 3
// design 2.1, 2.8; phase 4 lifecycle 4.6 to 4.8) and ID link tokens (10.1). The phone's tests read
// the same files. Each value is read by the entity registry's own schemas and rules, as a push is.

const vector = <T>(name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../packages/contract/test-vectors/${name}`, import.meta.url), 'utf8'),
  ) as T;

interface ValueCase {
  name: string;
  entity: string;
  op: 'create' | 'set' | 'append';
  field?: string;
  value: unknown;
  parents?: { entity: string; id: string }[];
  expect?: { paths?: string[]; problem?: string };
}

const sync = vector<{ today: string; valid: ValueCase[]; invalid: ValueCase[] }>('sync-values.json');

const rulesOf = (c: ValueCase) => RULES[c.entity as AnyRecordEntityName];

function schemaOf(c: ValueCase) {
  if (c.entity === 'audit') return AuditAppend;
  return c.op === 'create' ? rulesOf(c).create : rulesOf(c).fieldSchema(c.field!)!;
}

/** The rule a parsed value breaks on its own, as the push asks it (a patient's dates, a referral's). */
const problemOf = (c: ValueCase, value: unknown) =>
  c.entity === 'audit'
    ? null
    : (rulesOf(c).valueProblem?.(c.op as 'create' | 'set', c.field, value, sync.today) ?? null);

describe('sync-values.json', () => {
  it('covers every patient-side entity and phase 4’s records, valid and invalid, and the 50-patient audit limit', () => {
    for (const e of [...Object.keys(CREATE_SCHEMAS), ...NOTE_LIFE_ENTITIES, ...REFERRAL_ENTITIES]) {
      expect(sync.valid.some((c) => c.entity === e)).toBe(true);
      expect(sync.invalid.some((c) => c.entity === e)).toBe(true);
    }
    expect(sync.invalid.some((c) => c.expect?.problem === 'referral_in_future')).toBe(true);
    for (const action of ['ems_handoff.shown', 'notes_to_finish.viewed']) {
      expect(
        sync.valid.some((c) => c.entity === 'audit' && (c.value as { action: string }).action === action),
      ).toBe(true);
    }
    const ids = (c: ValueCase) => ((c.value as { patientIds?: string[] }).patientIds ?? []).length;
    expect(sync.valid.some((c) => c.entity === 'audit' && ids(c) === 50)).toBe(true);
    expect(sync.invalid.some((c) => c.entity === 'audit' && ids(c) === 51)).toBe(true);
    for (const s of [' Del', 'Del ', 'Del\n']) {
      expect(sync.invalid.some((c) => c.field === 'preferredName' && c.value === s)).toBe(true);
    }
  });

  for (const c of sync.valid) {
    it(`accepts ${c.name}, unchanged, with its parents`, () => {
      const parsed = schemaOf(c).safeParse(c.value);
      expect(parsed.success).toBe(true);
      // Validate, never transform: what is stored is exactly what was hashed on the phone.
      expect(parsed.data).toEqual(c.value);
      expect(problemOf(c, parsed.data)).toBeNull();
      if (c.op !== 'append') {
        // The registry's own, which a push checks, and the shared reading of them.
        const rules = rulesOf(c);
        expect(
          c.op === 'create' ? rules.parents(parsed.data) : rules.parentsOfSet(c.field!, parsed.data),
        ).toEqual(c.parents);
        expect(valueParents(c.entity as AnyRecordEntityName, c.op, c.field, c.value)).toEqual(c.parents);
      }
    });
  }

  for (const c of sync.invalid) {
    it(`refuses ${c.name}`, () => {
      const parsed = schemaOf(c).safeParse(c.value);
      if (c.expect!.paths) {
        expect(parsed.success).toBe(false);
        const paths = [...new Set(parsed.error!.issues.map((i) => i.path.join('.')))].sort();
        expect(paths).toEqual(c.expect!.paths);
      } else {
        expect(parsed.success).toBe(true);
        expect(problemOf(c, parsed.data)).toBe(c.expect!.problem);
      }
    });
  }
});

interface TokenVectors {
  pattern: string;
  tokenRefLength: number;
  tokens: { bytesHex: string; token: string; sha256: string; tokenRef: string }[];
  shapeOnly: { token: string; sha256: string; tokenRef: string }[];
  invalid: { token: string }[];
  urls: { baseUrl: string; token: string; url: string }[];
}

const tokens = vector<TokenVectors>('id-link-token.json');

describe('id-link-token.json', () => {
  it('uses the database’s token shape', () => {
    expect(ID_LINK_TOKEN_PATTERN.source).toBe(tokens.pattern);
    for (const t of [...tokens.tokens, ...tokens.shapeOnly])
      expect(ID_LINK_TOKEN_PATTERN.test(t.token)).toBe(true);
    for (const t of tokens.invalid) expect(ID_LINK_TOKEN_PATTERN.test(t.token), t.token).toBe(false);
  });

  it('hashes tokens and names them by the hash', async () => {
    for (const t of [...tokens.tokens, ...tokens.shapeOnly]) {
      expect(await idLinkTokenHash(t.token)).toBe(t.sha256);
      expect(await idLinkTokenRef(t.token)).toBe(t.tokenRef);
      expect(t.tokenRef).toHaveLength(tokens.tokenRefLength);
    }
  });

  it('encodes 16 bytes as 22 base64url characters', () => {
    for (const t of tokens.tokens) expect(Buffer.from(t.bytesHex, 'hex').toString('base64url')).toBe(t.token);
    const made = new Set(Array.from({ length: 200 }, () => newIdLinkToken()));
    expect(made.size).toBe(200);
    for (const t of made) expect(ID_LINK_TOKEN_PATTERN.test(t)).toBe(true);
  });

  it('puts the token in the URL fragment', () => {
    for (const u of tokens.urls) expect(idLinkUrl(u.baseUrl, u.token)).toBe(u.url);
  });
});
