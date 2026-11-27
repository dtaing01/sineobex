import { z } from '@hono/zod-openapi';
import { CREDENTIALS, PERMISSION_KEYS } from '../auth/permissions.ts';

export const Uuid = z.string().uuid();

/** A reason staff type for a change that is logged (role changes, corrections, removals). */
export const Reason = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .openapi({ description: 'Why, in a few words. Logged.' });

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .openapi('ErrorResponse');

const errorDescriptions: Record<number, string> = {
  400: 'Bad request',
  401: 'Not signed in, or the session expired',
  403: 'Not allowed; the refusal is logged',
  404: 'Not found',
  409: 'Conflicts with the current state',
  422: 'Validation failed',
};

export function errors(...codes: (400 | 401 | 403 | 404 | 409 | 422)[]) {
  return Object.fromEntries(
    codes.map((code) => [
      code,
      { description: errorDescriptions[code]!, content: { 'application/json': { schema: ErrorResponse } } },
    ]),
  ) as Record<
    number,
    { description: string; content: { 'application/json': { schema: typeof ErrorResponse } } }
  >;
}

export const Credential = z.enum(CREDENTIALS).openapi('Credential');
export const PermissionKey = z.enum(PERMISSION_KEYS as [string, ...string[]]).openapi('Permission');

export const CredentialFields = z
  .object({
    school: z.string().trim().max(200).optional(),
    supervisingPhysician: z.string().trim().max(200).optional(),
    npi: z.string().trim().max(20).optional(),
    program: z.string().trim().max(200).optional(),
    supervisingAttending: z.string().trim().max(200).optional(),
    licenseNumber: z.string().trim().max(60).optional(),
    licenseState: z.string().trim().max(2).optional(),
  })
  .openapi('CredentialFields');

export const RoleSummary = z
  .object({ id: Uuid, key: z.string(), name: z.string(), isStandard: z.boolean() })
  .openapi('RoleSummary');

export const Ok = z.object({ ok: z.literal(true) }).openapi('Ok');
