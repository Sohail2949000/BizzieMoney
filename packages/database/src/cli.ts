import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { runMigrations } from './migrations';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
});

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const migrationsDirectory = fileURLToPath(
    new URL('../migrations', import.meta.url),
  );
  const applied = await runMigrations({
    connectionString: env.DATABASE_URL,
    migrationsDirectory,
  });

  if (applied.length === 0) {
    console.info('Database schema is already current.');
    return;
  }

  console.info(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown migration error';
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
});
