import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_ACTS, queueLinks } from './credentials';

// The portal's copy of the credential table's sign and attest columns, which no vector carries: this
// reads the API's own source (services/api/src/auth/permissions.ts, CAPABILITIES) and fails when they
// part, as the phone's credentials_test.dart does.
function serverTable(): Record<string, Record<string, boolean>> {
  const source = readFileSync(
    new URL('../../../../services/api/src/auth/permissions.ts', import.meta.url),
    'utf8',
  );
  const block = /export const CAPABILITIES[^=]*= \{([\s\S]*?)\n\};/.exec(source)![1]!;
  return Object.fromEntries(
    [...block.matchAll(/(\w+): \{([^}]*)\}/g)].map(([, credential, body]) => [
      credential!,
      Object.fromEntries([...body!.matchAll(/(\w+): (true|false)/g)].map(([, k, v]) => [k!, v === 'true'])),
    ]),
  );
}

describe('which credential signs and which attests', () => {
  it('is the API’s credential table, column for column', () => {
    const server = serverTable();
    expect(Object.keys(server).sort()).toEqual(Object.keys(CREDENTIAL_ACTS).sort());
    for (const [credential, acts] of Object.entries(CREDENTIAL_ACTS)) {
      expect({ sign: acts.sign, attest: acts.attest }, credential).toEqual({
        sign: server[credential]!.sign,
        attest: server[credential]!.attest,
      });
    }
  });
});

describe('the queue links a person is shown', () => {
  const team = (credential: string, permissions: string[]) =>
    ({ credential, permissions }) as Parameters<typeof queueLinks>[0];

  it('shows each queue to a role that charts, with a credential that does its act', () => {
    expect(queueLinks(team('attending', ['encounters.chart']))).toEqual({ cosign: true, attest: true });
    expect(queueLinks(team('resident', ['encounters.chart']))).toEqual({ cosign: true, attest: false });
    expect(queueLinks(team('np', ['encounters.chart']))).toEqual({ cosign: true, attest: false });
    expect(queueLinks(team('student', ['encounters.chart']))).toEqual({ cosign: false, attest: false });
  });

  it('shows neither to a role that doesn’t chart, whatever its credential', () => {
    expect(queueLinks(team('attending', ['patients.view', 'billing.view_codes']))).toEqual({
      cosign: false,
      attest: false,
    });
    expect(queueLinks(null)).toEqual({ cosign: false, attest: false });
  });

  it('shows neither for a credential the portal doesn’t know', () => {
    expect(queueLinks(team('nurse', ['encounters.chart']))).toEqual({ cosign: false, attest: false });
    expect(queueLinks(team('toString', ['encounters.chart']))).toEqual({ cosign: false, attest: false });
  });
});
