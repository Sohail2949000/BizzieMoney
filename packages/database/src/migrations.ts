import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import pg from 'pg';

const { Pool } = pg;
const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_NAMESPACE = 4_249_210;
const LOCK_KEY = 1;

export interface MigrationFile {
  checksum: string;
  name: string;
  sql: string;
  version: string;
}

export async function readMigrationFiles(
  migrationsDirectory: string,
): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const fileNames = entries
    .filter(
      (entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    fileNames.map(async (fileName) => {
      const match = MIGRATION_FILE_PATTERN.exec(fileName);
      if (!match?.[1]) {
        throw new Error(`Invalid migration file name: ${fileName}`);
      }

      const sql = await readFile(
        path.join(migrationsDirectory, fileName),
        'utf8',
      );

      return {
        checksum: createHash('sha256').update(sql).digest('hex'),
        name: fileName,
        sql,
        version: match[1],
      };
    }),
  );
}

export interface RunMigrationsOptions {
  connectionString: string;
  migrationsDirectory: string;
}

export async function runMigrations({
  connectionString,
  migrationsDirectory,
}: RunMigrationsOptions): Promise<string[]> {
  const pool = new Pool({
    application_name: 'bizziemoney-migrations',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await client.query(`
      create table if not exists schema_migrations (
        version text primary key,
        name text not null unique,
        checksum char(64) not null,
        applied_at timestamptz not null default now()
      )
    `);
    await client.query('select pg_advisory_lock($1, $2)', [
      LOCK_NAMESPACE,
      LOCK_KEY,
    ]);

    const migrations = await readMigrationFiles(migrationsDirectory);
    const appliedResult = await client.query<{
      checksum: string;
      version: string;
    }>('select version, checksum from schema_migrations order by version');
    const applied = new Map(
      appliedResult.rows.map((row) => [row.version, row.checksum.trim()]),
    );

    for (const migration of migrations) {
      const knownChecksum = applied.get(migration.version);
      if (knownChecksum && knownChecksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} changed after it was applied.`,
        );
      }
      if (knownChecksum) {
        continue;
      }

      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into schema_migrations (version, name, checksum)
           values ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('commit');
        appliedNow.push(migration.name);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }

    return appliedNow;
  } finally {
    await client
      .query('select pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, LOCK_KEY])
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}
