// Node entry point: local development, CI, and the ECS Fargate container in production.
import { serve } from '@hono/node-server';
import { bootstrap } from './bootstrap.ts';

const runtime = await bootstrap(process.env);
const server = serve({ fetch: runtime.app.fetch, port: runtime.config.PORT });
runtime.log.info('listening', {
  port: runtime.config.PORT,
  env: runtime.config.APP_ENV,
  release: runtime.config.RELEASE,
});

// ECS sends SIGTERM before stopping a task; finish in-flight requests, then close the pool.
const shutdown = (signal: string) => {
  runtime.log.info('shutting_down', { code: signal });
  server.close(() => {
    void runtime.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 20_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
