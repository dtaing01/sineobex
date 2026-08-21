import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export const json = (
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  },
  body: JSON.stringify(body),
});

export const ok = (body: unknown) => json(200, body);
export const badRequest = (message: string) => json(400, { message });
export const unauthorized = () => json(401, { message: 'Unauthorized' });
export const forbidden = () => json(403, { message: 'Forbidden' });
export const notFound = () => json(404, { message: 'Not found' });

/**
 * Error responses never echo the caught error.
 *
 * A Postgres error message can quote the offending row — which, here, is a
 * patient record. Detail goes to CloudWatch keyed by request id; the client
 * gets a request id it can quote to support.
 */
export const serverError = (
  requestId: string,
  error: unknown,
): APIGatewayProxyResultV2 => {
  console.error('Unhandled error', {
    requestId,
    name: error instanceof Error ? error.name : 'unknown',
    stack: error instanceof Error ? error.stack : undefined,
  });
  return json(500, { message: 'Internal error', requestId });
};

export interface Caller {
  sub: string;
  email?: string;
  groups: string[];
}

/**
 * Reads the Cognito claims API Gateway attached to the request.
 *
 * These claims are only present because the JWT authorizer already verified
 * the token's signature, issuer, audience, and expiry. They are trustworthy
 * for exactly that reason — never parse a bearer token here by hand.
 */
export function callerFrom(event: {
  requestContext: {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
}): Caller | null {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (!claims || typeof claims.sub !== 'string') return null;

  const rawGroups = claims['cognito:groups'];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.map(String)
    : typeof rawGroups === 'string'
      ? rawGroups.split(/[\s,]+/).filter(Boolean)
      : [];

  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    groups,
  };
}

export const canEdit = (caller: Caller) =>
  caller.groups.includes('full-admin') || caller.groups.includes('standard');

export const canAdminister = (caller: Caller) =>
  caller.groups.includes('full-admin');
