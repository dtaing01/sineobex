import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { TokenError } from './auth/verifier.ts';
import { ApiError, type ErrorBody } from './lib/errors.ts';
import { registerAuditRoutes } from './routes/audit-log.ts';
import { registerDeviceRoutes } from './routes/devices.ts';
import { registerDuplicateRoutes } from './routes/duplicates.ts';
import { registerMeRoutes } from './routes/me.ts';
import { registerMemberRoutes } from './routes/members.ts';
import { registerOwnerRoutes } from './routes/owner.ts';
import { registerPatientRoutes } from './routes/patients.ts';
import { registerProblemRoutes } from './routes/problems.ts';
import { registerRoleRoutes } from './routes/roles.ts';
import { registerSyncRoutes } from './routes/sync.ts';
import { registerSystemRoutes } from './routes/system.ts';
import type { AppEnv, Deps } from './types.ts';

export const API_TITLE = 'Sineobex API';
export const API_VERSION = '0.1.0';

export type App = OpenAPIHono<AppEnv>;

export function createApp(deps: Deps): App {
  const app = new OpenAPIHono<AppEnv>({
    // Validation failures report which fields failed and why, never the submitted values.
    defaultHook: (result, c) => {
      if (!result.success) {
        const body: ErrorBody = {
          error: {
            code: 'validation_failed',
            message: 'Some fields are missing or invalid.',
            details: {
              fields: result.error.issues.map((i) => ({ path: i.path.join('.'), problem: i.code })),
            },
          },
        };
        return c.json(body, 422);
      }
    },
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'An access token from the configured OIDC provider (Supabase Auth or Amazon Cognito).',
  });

  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    c.set('requestId', requestId);
    const started = performance.now();
    await next();
    c.header('x-request-id', requestId);
    deps.log.info('request', {
      requestId,
      method: c.req.method,
      // The matched pattern (/v1/patients/:id), never the concrete URL or its query string.
      route: c.req.routePath,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  });

  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: 'same-origin',
    }),
  );

  // Patient data must never sit in a browser, proxy or CDN cache (module 9, desktop column).
  app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('Pragma', 'no-cache');
  });

  if (deps.config.CORS_ORIGINS.length > 0) {
    app.use(
      '*',
      cors({
        origin: deps.config.CORS_ORIGINS,
        allowHeaders: ['Authorization', 'Content-Type', 'X-Team-Id', 'X-Device-Id', 'X-Request-Id'],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        maxAge: 600,
      }),
    );
  }

  app.use('/v1/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json(tooLarge, 413) }));

  registerSystemRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerOwnerRoutes(app, deps);
  registerMemberRoutes(app, deps);
  registerRoleRoutes(app, deps);
  registerAuditRoutes(app, deps);
  registerSyncRoutes(app, deps);
  registerPatientRoutes(app, deps);
  registerProblemRoutes(app, deps);
  registerDuplicateRoutes(app, deps);
  registerDeviceRoutes(app, deps);

  if (deps.config.APP_ENV !== 'production') {
    app.doc31('/openapi.json', openApiInfo);
  }

  app.notFound((c) => c.json<ErrorBody>({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404));

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err.details) body.error.details = err.details;
      return c.json(body, err.status);
    }
    if (err instanceof TokenError) {
      return c.json<ErrorBody>(
        { error: { code: 'unauthorized', message: 'Sign in again to continue.' } },
        401,
      );
    }
    // Unexpected: log the error's class and the request ID only. Messages from database drivers can
    // quote values from the query, so they are never logged or returned.
    deps.log.error('unhandled_error', { requestId: c.get('requestId'), errorName: err.name });
    return c.json<ErrorBody>(
      { error: { code: 'internal', message: 'Something went wrong. Your data is safe; try again.' } },
      500,
    );
  });

  return app;
}

const tooLarge: ErrorBody = { error: { code: 'payload_too_large', message: 'That request is too large.' } };

export const openApiInfo = {
  openapi: '3.1.0',
  info: {
    title: API_TITLE,
    version: API_VERSION,
    description:
      'The only API the Sineobex field app and portal use. Every call is permission-checked on the server and audit-logged.',
  },
} as const;

export function buildOpenApiDocument(app: App) {
  return app.getOpenAPI31Document(openApiInfo);
}
