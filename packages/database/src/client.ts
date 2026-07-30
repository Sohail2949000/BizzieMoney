import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';

import type { DatabaseSchema } from './types';

const { Pool, types } = pg;
const POSTGRES_DATE_OID = 1082;

types.setTypeParser(POSTGRES_DATE_OID, (value) => value);

export interface DatabaseOptions {
  applicationName: string;
  connectionTimeoutMs?: number;
  connectionString: string;
  maxConnections?: number;
  queryTimeoutMs?: number;
}

export type BizzieMoneyDatabase = Kysely<DatabaseSchema>;

export function createDatabase({
  applicationName,
  connectionTimeoutMs = 15_000,
  connectionString,
  maxConnections = 10,
  queryTimeoutMs = 15_000,
}: DatabaseOptions): BizzieMoneyDatabase {
  const pool = new Pool({
    application_name: applicationName,
    connectionString,
    connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    max: maxConnections,
    statement_timeout: queryTimeoutMs,
  });

  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
}

export async function verifyDatabaseConnection(
  database: BizzieMoneyDatabase,
): Promise<void> {
  await sql`select 1`.execute(database);
}
