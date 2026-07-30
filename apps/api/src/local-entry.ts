import { verifyDatabaseConnection } from '@bizziemoney/database';

import { apiRuntime } from './index.js';

async function main(): Promise<void> {
  await verifyDatabaseConnection(apiRuntime.database);
  apiRuntime.server.log.info('PostgreSQL connection verified');

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    apiRuntime.server.log.info({ signal }, 'Shutting down');
    await apiRuntime.server.close();
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await apiRuntime.server.listen({
    host: apiRuntime.config.API_HOST,
    port: apiRuntime.config.API_PORT,
  });
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`API startup failed: ${message}`);
  process.exitCode = 1;
});
