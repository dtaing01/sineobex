import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { expectAccessible, MFA_CODE, PASSWORD, signIn } from './helpers';

// Phase 2 admin screens with real data: phones register and sync against the API the portal
// uses, as the seeded demo staff (made-up people).
const API = 'http://localhost:8787';
const IDP = 'http://localhost:8790';
const TEAM = '0d3e6f00-0000-4000-8000-000000000001';

test.describe.configure({ mode: 'serial' });

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

async function staffToken(email: string): Promise<string> {
  const post = (path: string, body: unknown) =>
    fetch(`${IDP}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const first = await json(await post('/token', { grant_type: 'password', email, password: PASSWORD }));
  const verified = await json(
    await post('/mfa/verify', { access_token: first.access_token, code: MFA_CODE }),
  );
  return verified.access_token as string;
}

function apiPost(token: string, path: string, body: unknown) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-team-id': TEAM, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A new encounter as a phone sends it. A one-key object's JSON is already canonical. */
function createEncounter(kind: 'medical' | 'non_medical') {
  const value = { kind };
  return {
    changeId: randomUUID(),
    seq: 1,
    entity: 'encounter',
    recordId: randomUUID(),
    op: 'create',
    value,
    valueHash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    baseVersion: 0,
    deviceTime: new Date().toISOString(),
    clockVerified: true,
  };
}

/** Registers a phone for [email] and syncs it once. */
async function phoneSync(
  email: string,
  options: { minutesBehind?: number; counts?: Record<string, number>; changes?: unknown[] } = {},
) {
  const token = await staffToken(email);
  const keys = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey('raw', keys.publicKey)).toString(
    'base64url',
  );
  const deviceId = randomUUID();
  const registered = await apiPost(token, '/v1/devices', {
    deviceId,
    platform: 'android',
    appVersion: '0.2.0',
    publicKey,
  });
  expect(registered.status).toBe(201);
  const deviceTime = new Date(Date.now() - (options.minutesBehind ?? 0) * 60_000).toISOString();
  const pushed = await apiPost(token, '/v1/sync/push', {
    deviceId,
    clock: { deviceTime },
    unsynced: { counts: options.counts ?? {} },
    changes: options.changes ?? [],
  });
  expect(pushed.status).toBe(200);
  return { token, deviceId, body: await json(pushed) };
}

test('a Program Admin sees what each phone holds and wipes a lost one', async ({ page }) => {
  // Jordan's phone runs 7 minutes behind and still holds 3 encounters and 2 notes.
  const jordan = await phoneSync('clinician@example.com', {
    minutesBehind: 7,
    counts: { encounters: 3, notes: 2 },
  });
  expect(jordan.body.clock).toEqual({ offsetMs: expect.any(Number), flagged: true });

  await signIn(page, 'admin@example.com');
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Phones' }).click();
  await expect(page).toHaveURL(/\/team\/devices$/);
  const row = page.getByRole('row').filter({ hasText: 'Jordan Lee (demo)' }).first();
  await expect(row).toContainText('3 encounters, 2 notes');
  await expect(row).toContainText('7 minutes behind, charting paused');
  await expect(page.getByRole('status')).toContainText('holding unsynced work');
  await expectAccessible(page, '/team/devices');

  const section = page.getByRole('region', { name: 'Wipe Jordan Lee (demo)’s phone' }).first();
  const wipe = section.getByRole('form');
  await expect(section).toContainText('including work that never reached the server: 3 encounters, 2 notes');
  await wipe.getByRole('button', { name: 'Wipe this phone' }).click();
  await expect(wipe.getByRole('alert')).toContainText('Give a reason');
  await expectAccessible(page, '/team/devices (reason missing)', { inPlace: true });
  await wipe.getByLabel('Reason').fill('Reported stolen on the route');
  await wipe.getByRole('button', { name: 'Wipe this phone' }).click();
  // The section now says so from the page's own state, not just the form's answer.
  await expect(section.getByRole('status')).toContainText('Wipe requested');
  await expect(page.getByRole('row').filter({ hasText: 'Jordan Lee (demo)' }).first()).toContainText(
    'Wipe requested',
  );
  await expectAccessible(page, '/team/devices (wipe requested)', { inPlace: true });

  // The phone's next sync is told to wipe, and nothing more it sends is applied.
  const next = await apiPost(jordan.token, '/v1/sync/push', {
    deviceId: jordan.deviceId,
    clock: { deviceTime: new Date().toISOString() },
    unsynced: { counts: {} },
    changes: [createEncounter('medical')],
  });
  expect(await json(next)).toMatchObject({ results: [], device: { status: 'wipe_requested' } });
});

test('a record from someone whose role no longer allows it is reviewed and accepted onto the chart', async ({
  page,
}) => {
  // Billing staff can't chart; what their phone sends goes to quarantine, not the chart.
  const change = createEncounter('non_medical');
  const riley = await phoneSync('billing@example.com', { changes: [change] });
  expect((riley.body.results as unknown[])[0]).toMatchObject({
    status: 'rejected',
    reason: 'permission',
    quarantined: true,
  });

  await signIn(page, 'admin@example.com');
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Quarantine' }).click();
  await expect(page).toHaveURL(/\/team\/quarantine$/);
  const item = page.getByRole('region', { name: 'New encounter from Riley Chen (demo)' }).first();
  await expect(item).toContainText('The person’s role no longer allows it');
  await expect(item).toContainText('"kind": "non_medical"');
  await expectAccessible(page, '/team/quarantine');

  const decide = item.getByRole('form');
  await decide.getByLabel('Reason').fill('Confirmed with Riley: a supply drop-off');
  await decide.getByRole('button', { name: 'Accept onto the chart' }).click();
  await expect(page).toHaveURL(/\/team\/quarantine\?decided=accepted$/);
  await expect(page.getByRole('status')).toContainText('Accepted. The change is on the chart');
  await expectAccessible(page, '/team/quarantine (accepted)', { inPlace: true });

  await page
    .getByRole('navigation', { name: 'Quarantine status' })
    .getByRole('link', { name: 'Accepted' })
    .click();
  await expect(page).toHaveURL(/status=accepted$/);
  await expect(
    page.getByRole('region', { name: 'New encounter from Riley Chen (demo)' }).first(),
  ).toContainText('Accepted by Alex Rivera (demo)');

  // The phone's retry now gets an accepted receipt with the same hash: the chart has it.
  const retry = await apiPost(riley.token, '/v1/sync/push', {
    deviceId: riley.deviceId,
    clock: { deviceTime: new Date().toISOString() },
    unsynced: { counts: {} },
    changes: [change],
  });
  expect(((await json(retry)).results as unknown[])[0]).toMatchObject({
    status: 'accepted',
    hash: change.valueHash,
  });
});

test('staff without the permissions never see these screens, and typed URLs are refused', async ({
  page,
}) => {
  await signIn(page, 'clinician@example.com');
  const nav = page.getByRole('navigation', { name: 'Portal' });
  await expect(nav.getByRole('link', { name: 'Phones' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Quarantine' })).toHaveCount(0);
  for (const path of ['/team/devices', '/team/quarantine']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/home\?denied=1$/);
  }
});
