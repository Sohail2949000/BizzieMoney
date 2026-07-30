import { randomUUID } from 'node:crypto';
import { stdin, stdout } from 'node:process';

import { createDatabase, sql } from '@bizziemoney/database';

import { hashOwnerPassword } from './auth/service.js';

const CONFIRMATION = 'RESET_OWNER_PASSWORD';

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('The recovery password must contain 12 to 128 characters.');
  }
}

function readHiddenLine(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) {
    throw new Error('Interactive recovery requires a TTY.');
  }
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const restore = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (data: Buffer) => {
      for (const character of data.toString('utf8')) {
        if (character === '\u0003') {
          restore();
          reject(new Error('Recovery cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          restore();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (!/\p{Cc}/u.test(character)) value += character;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function readRecoveryPassword(): Promise<string> {
  if (stdin.isTTY) {
    const password = await readHiddenLine('New owner password: ');
    const confirmation = await readHiddenLine('Confirm owner password: ');
    if (password !== confirmation) {
      throw new Error('The password confirmation did not match.');
    }
    return password;
  }

  stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of stdin) input += chunk;
  const [password = '', confirmation = ''] = input
    .split(/\r?\n/u)
    .map((line) => line.trimEnd());
  if (!password || password !== confirmation) {
    throw new Error(
      'Non-interactive recovery requires two matching password lines on stdin.',
    );
  }
  return password;
}

async function main(): Promise<void> {
  if (process.env.BIZZIEMONEY_RECOVERY_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set BIZZIEMONEY_RECOVERY_CONFIRM=${CONFIRMATION} after taking the API and worker offline.`,
    );
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  const database = createDatabase({
    applicationName: 'bizziemoney-owner-recovery',
    connectionString,
    maxConnections: 1,
  });
  try {
    const activeServices = await sql<{ count: string }>`
      select count(*)::text as count
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and application_name in ('bizziemoney-api', 'bizziemoney-worker')
    `.execute(database);
    if (Number(activeServices.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'BizzieMoney API or worker connections are active. Stop both services before recovery.',
      );
    }

    const owner = await database
      .selectFrom('app_users')
      .select(['id'])
      .where('owner_slot', '=', 1)
      .executeTakeFirst();
    if (!owner) throw new Error('No BizzieMoney owner account exists.');

    const password = await readRecoveryPassword();
    validatePassword(password);
    const passwordHash = await hashOwnerPassword(password);
    const now = new Date();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable('app_users')
        .set({
          password_changed_at: now,
          password_hash: passwordHash,
          updated_at: now,
        })
        .where('id', '=', owner.id)
        .executeTakeFirstOrThrow();
      const sessions = await transaction
        .updateTable('sessions')
        .set({
          revoke_reason: 'password_changed',
          revoked_at: now,
        })
        .where('owner_id', '=', owner.id)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      await transaction
        .insertInto('audit_events')
        .values({
          actor_session_id: null,
          event_type: 'auth.password_recovery',
          id: randomUUID(),
          metadata: {
            method: 'offline_admin',
            revokedSessionCount: Number(sessions.numUpdatedRows),
          },
          owner_id: owner.id,
        })
        .executeTakeFirstOrThrow();
    });
    stdout.write(
      'Owner password recovered. All existing sessions were revoked. Restart BizzieMoney and sign in with the new password.\n',
    );
  } finally {
    await database.destroy();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Recovery failed.';
  console.error(`Owner recovery failed: ${message}`);
  process.exitCode = 1;
});
