import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';

/**
 * The one sign-in interface (Build plan): any OIDC provider whose tokens we can verify against a
 * JWKS. Supabase Auth in the preview, Amazon Cognito in production. Nothing else in the API knows
 * which provider issued a token.
 */
export interface VerifiedToken {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** Authenticator assurance level when the provider reports it (Supabase: aal1 | aal2). */
  aal: string | null;
  /** Session identifier, used to revoke a session. */
  sessionId: string | null;
  expiresAt: Date;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

function toVerified(payload: JWTPayload, issuer: string): VerifiedToken {
  if (!payload.sub) throw new TokenError('token has no subject');
  if (!payload.exp) throw new TokenError('token has no expiry');
  const claims = payload as JWTPayload & {
    email?: unknown;
    email_verified?: unknown;
    aal?: unknown;
    session_id?: unknown;
    origin_jti?: unknown;
  };
  return {
    issuer,
    subject: payload.sub,
    email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    aal: typeof claims.aal === 'string' ? claims.aal : null,
    sessionId:
      typeof claims.session_id === 'string'
        ? claims.session_id
        : typeof claims.origin_jti === 'string'
          ? claims.origin_jti
          : null,
    expiresAt: new Date(payload.exp * 1000),
  };
}

export function createOidcVerifier(options: {
  issuer: string;
  audience: string;
  jwksUrl: string;
  clockToleranceSeconds?: number;
}): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['RS256', 'ES256'],
          clockTolerance: options.clockToleranceSeconds ?? 30,
        });
        return toVerified(payload, options.issuer);
      } catch (err) {
        if (err instanceof TokenError) throw err;
        throw new TokenError('token verification failed');
      }
    },
  };
}

/** For tests and local development: verifies against an in-memory key set. */
export function createLocalVerifier(options: { issuer: string; audience: string; jwks: JSONWebKeySet }): TokenVerifier {
  const keys = createLocalJWKSet(options.jwks);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ['ES256'],
        });
        return toVerified(payload, options.issuer);
      } catch (err) {
        if (err instanceof TokenError) throw err;
        throw new TokenError('token verification failed');
      }
    },
  };
}
