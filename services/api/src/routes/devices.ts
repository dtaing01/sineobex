import { createRoute, z } from '@hono/zod-openapi';
import { teamScope } from '../auth/context.ts';
import {
  confirmWiped,
  deviceStatus,
  listDevices,
  registerDevice,
  requestWipe,
  uploadQuarantine,
} from '../sync/devices.ts';
import { decideQuarantine, listQuarantine } from '../sync/review.ts';
import {
  DecideQuarantine,
  Device,
  DeviceStatusResult,
  QuarantinePage,
  QuarantineQuery,
  QuarantineReceipt,
  RegisterDevice,
  SignedQuarantine,
  SignedStatus,
  SignedWiped,
  TeamDevice,
  WipeDevice,
} from '../sync/schemas.ts';
import type { App } from '../app.ts';
import type { Deps } from '../types.ts';
import { errors, Ok, Uuid } from './schemas.ts';

const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const deviceParam = z.object({ deviceId: Uuid });

const registerRoute = createRoute({
  method: 'post',
  path: '/v1/devices',
  operationId: 'registerDevice',
  tags: ['devices'],
  summary: 'Register this phone’s key for the current team',
  security: [{ bearer: [] }],
  request: { body: { required: true, ...json(RegisterDevice) } },
  responses: {
    200: { description: 'Already registered with this key', ...json(Device) },
    201: { description: 'Registered', ...json(Device) },
    ...errors(401, 403, 409, 422),
  },
});

const signedNote =
  'Signed with the device key instead of a sign-in, so it works after the user was removed. ' +
  'The signature covers the canonical JSON of `payload`.';

const statusRoute = createRoute({
  method: 'post',
  path: '/v1/devices/{deviceId}/status',
  operationId: 'deviceStatus',
  tags: ['devices'],
  summary: 'Whether this phone must wipe, and whether its user still has access',
  description: signedNote,
  security: [],
  request: { params: deviceParam, body: { required: true, ...json(SignedStatus) } },
  responses: { 200: { description: 'Status', ...json(DeviceStatusResult) }, ...errors(401, 422) },
});

const quarantineUploadRoute = createRoute({
  method: 'post',
  path: '/v1/devices/{deviceId}/quarantine',
  operationId: 'uploadQuarantine',
  tags: ['devices'],
  summary: 'Hand over unsynced changes after the user lost access; a Program Admin reviews them',
  description: signedNote,
  security: [],
  request: { params: deviceParam, body: { required: true, ...json(SignedQuarantine) } },
  responses: { 200: { description: 'Receipts', ...json(QuarantineReceipt) }, ...errors(401, 409, 422) },
});

const wipedRoute = createRoute({
  method: 'post',
  path: '/v1/devices/{deviceId}/wiped',
  operationId: 'confirmWiped',
  tags: ['devices'],
  summary: 'Report that this phone deleted its data and key for the team',
  description: signedNote,
  security: [],
  request: { params: deviceParam, body: { required: true, ...json(SignedWiped) } },
  responses: { 200: { description: 'Recorded', ...json(Ok) }, ...errors(401, 422) },
});

const listDevicesRoute = createRoute({
  method: 'get',
  path: '/v1/team/devices',
  operationId: 'listDevices',
  tags: ['devices'],
  summary: 'Every phone on the team, with sync status, clock flag and unsynced counts',
  security: [{ bearer: [] }],
  responses: { 200: { description: 'Devices', ...json(z.array(TeamDevice)) }, ...errors(401, 403) },
});

const wipeRoute = createRoute({
  method: 'post',
  path: '/v1/team/devices/{deviceId}/wipe',
  operationId: 'wipeDevice',
  tags: ['devices'],
  summary: 'Remotely wipe a lost or stolen phone; its unsynced data is lost',
  security: [{ bearer: [] }],
  request: { params: deviceParam, body: { required: true, ...json(WipeDevice) } },
  responses: { 200: { description: 'Wipe requested', ...json(Ok) }, ...errors(401, 403, 404, 409, 422) },
});

const listQuarantineRoute = createRoute({
  method: 'get',
  path: '/v1/team/quarantine',
  operationId: 'listQuarantine',
  tags: ['devices'],
  summary: 'Changes from phones whose user lost access, waiting for review, a page at a time',
  security: [{ bearer: [] }],
  request: { query: QuarantineQuery },
  responses: { 200: { description: 'A page of items', ...json(QuarantinePage) }, ...errors(401, 403, 422) },
});

const decideQuarantineRoute = createRoute({
  method: 'post',
  path: '/v1/team/quarantine/{itemId}/decision',
  operationId: 'decideQuarantine',
  tags: ['devices'],
  summary: 'Accept a quarantined change onto the chart, or reject it with a reason',
  security: [{ bearer: [] }],
  request: { params: z.object({ itemId: Uuid }), body: { required: true, ...json(DecideQuarantine) } },
  responses: { 200: { description: 'Decided', ...json(Ok) }, ...errors(401, 403, 404, 409, 422) },
});

export function registerDeviceRoutes(app: App, deps: Deps) {
  app.openapi(registerRoute, async (c) => {
    const scope = await teamScope(c, deps);
    const { created, device } = await registerDevice(scope, c.req.valid('json'));
    return created ? c.json(device, 201) : c.json(device, 200);
  });

  app.openapi(statusRoute, async (c) =>
    c.json(await deviceStatus(c, deps, c.req.valid('param').deviceId), 200),
  );

  app.openapi(quarantineUploadRoute, async (c) => {
    const { payload } = c.req.valid('json');
    return c.json(await uploadQuarantine(c, deps, c.req.valid('param').deviceId, payload.changes), 200);
  });

  app.openapi(wipedRoute, async (c) => {
    const { payload } = c.req.valid('json');
    return c.json(await confirmWiped(c, deps, c.req.valid('param').deviceId, payload.wipedAt), 200);
  });

  app.openapi(listDevicesRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['devices.manage'] });
    return c.json(await listDevices(scope), 200);
  });

  app.openapi(wipeRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['devices.manage'], recentAuth: true });
    return c.json(await requestWipe(scope, c.req.valid('param').deviceId, c.req.valid('json').reason), 200);
  });

  app.openapi(listQuarantineRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['quarantine.review'] });
    return c.json(await listQuarantine(scope, c.req.valid('query')), 200);
  });

  app.openapi(decideQuarantineRoute, async (c) => {
    const scope = await teamScope(c, deps, { permissions: ['quarantine.review'], recentAuth: true });
    const body = c.req.valid('json');
    return c.json(
      await decideQuarantine(scope, c.req.valid('param').itemId, body.decision, body.reason),
      200,
    );
  });
}
