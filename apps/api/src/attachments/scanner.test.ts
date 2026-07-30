import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { ClamAvMalwareScanner, createMalwareScanner } from './scanner';

const servers: Server[] = [];
const temporaryDirectories: string[] = [];

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bizziemoney-clamav-test-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'attachment.txt');
  await writeFile(filePath, 'safe attachment fixture');
  return filePath;
}

async function startFakeClamd(
  response: 'stream: Eicar-Test-Signature FOUND\0' | 'stream: OK\0',
): Promise<number> {
  const server = createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      request = Buffer.concat([request, chunk]);
      const commandBytes = Buffer.byteLength('zINSTREAM\0');
      if (request.length < commandBytes + 4) return;
      let offset = commandBytes;
      while (request.length >= offset + 4) {
        const length = request.readUInt32BE(offset);
        if (length === 0) {
          socket.write(response);
          return;
        }
        if (request.length < offset + 4 + length) return;
        offset += 4 + length;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fake ClamAV server did not expose a TCP port.');
  }
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('ClamAV attachment scanner', () => {
  it('streams a staged file and accepts a clean response', async () => {
    const [filePath, port] = await Promise.all([
      createFixture(),
      startFakeClamd('stream: OK\0'),
    ]);
    const scanner = new ClamAvMalwareScanner('127.0.0.1', port, 2_000);

    await expect(scanner.scan(filePath)).resolves.toEqual({ verdict: 'clean' });
  });

  it('blocks a file when ClamAV reports a signature', async () => {
    const [filePath, port] = await Promise.all([
      createFixture(),
      startFakeClamd('stream: Eicar-Test-Signature FOUND\0'),
    ]);
    const scanner = new ClamAvMalwareScanner('127.0.0.1', port, 2_000);

    await expect(scanner.scan(filePath)).resolves.toEqual({
      verdict: 'blocked',
    });
  });

  it('keeps scanner status explicit when scanning is disabled', async () => {
    const scanner = createMalwareScanner({
      host: 'clamav',
      mode: 'disabled',
      port: 3310,
      timeoutMs: 30_000,
    });

    expect(scanner.status).toBe('not-configured');
    await expect(scanner.scan('unused')).resolves.toEqual({
      verdict: 'not-configured',
    });
  });
});
