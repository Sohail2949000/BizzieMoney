import Fastify from 'fastify';

import { createApiRuntime } from './runtime.js';

const apiRuntime = createApiRuntime(Fastify);

apiRuntime.server
  .listen({
    host: apiRuntime.config.API_HOST,
    port: apiRuntime.config.API_PORT,
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown startup error';
    apiRuntime.server.log.error({ error }, `API startup failed: ${message}`);
  });

export { apiRuntime };
