import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ID_LINK_TOKEN_PATTERN,
  idLinkTokenHash,
  idLinkTokenRef,
  idLinkUrl,
  newIdLinkToken,
} from '../src/patients/id-links.ts';
import {
  AuditAppend,
  CREATE_SCHEMAS,
  patientFieldSchema,
  valueParents,
  valueProblem,
} from '../src/sync/entities/values.ts';
import { EncounterCreate, fieldSchema } from '../src/sync/records.ts';
import type { AnyRecordEntityName, PatientEntityName } from '../src/sync/schemas.ts';

// The phase 3 vectors the API shares with the phone (packages/contract/test-vectors): sync values
// (design 2.1, 2.8) and ID link tokens (10.1). The phone's tests read the same files.

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

function schemaOf(c: ValueCase) {
  if (c.entity === 'audit') return AuditAppend;
  if (c.entity === 'encounter')
    return c.op === 'create' ? EncounterCreate : fieldSchema('encounter', c.field!)!;
  const entity = c.entity as PatientEntityName;
  return c.op === 'create' ? CREATE_SCHEMAS[entity] : patientFieldSchema(entity, c.field!)!;
}

const isPatientSide = (c: ValueCase) => c.entity !== 'audit' && c.entity !== 'encounter';

describe('sync-values.json', () => {
  it('covers every patient-side entity, valid and invalid, and the 50-patient audit limit', () => {
    for (const e of Object.keys(CREATE_SCHEMAS)) {
      expect(sync.valid.some((c) => c.entity === e)).toBe(true);
      expect(sync.invalid.some((c) => c.entity === e)).toBe(true);
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
      if (isPatientSide(c)) {
        expect(
          valueProblem(
            c.entity as PatientEntityName,
            c.op as 'create' | 'set',
            c.field,
            parsed.data,
            sync.today,
          ),
        ).toBeNull();
      }
      if (c.op !== 'append') {
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
        expect(
          valueProblem(
            c.entity as PatientEntityName,
            c.op as 'create' | 'set',
            c.field,
            parsed.data,
            sync.today,
          ),
        ).toBe(c.expect!.problem);
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
