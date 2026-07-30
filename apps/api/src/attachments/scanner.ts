import { createReadStream } from 'node:fs';
import { createConnection, type Socket } from 'node:net';

import type { MalwareScannerAdapter, MalwareScanResult } from './types';

const MAX_RESPONSE_BYTES = 8_192;
const STREAM_CHUNK_BYTES = 64 * 1_024;

function writeToSocket(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off('drain', onDrain);
      reject(error);
    };
    const onDrain = () => {
      socket.off('error', onError);
      resolve();
    };
    socket.once('error', onError);
    if (socket.write(data)) {
      socket.off('error', onError);
      resolve();
      return;
    }
    socket.once('drain', onDrain);
  });
}

export class DeferredMalwareScanner implements MalwareScannerAdapter {
  readonly status = 'not-configured' as const;

  scan(): Promise<MalwareScanResult> {
    return Promise.resolve({ verdict: 'not-configured' });
  }
}

export class ClamAvMalwareScanner implements MalwareScannerAdapter {
  readonly status = 'ready' as const;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  scan(filePath: string): Promise<MalwareScanResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let settled = false;
      let response = Buffer.alloc(0);

      const finish = (
        error: Error | null,
        result?: MalwareScanResult,
      ): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) {
          reject(error);
          return;
        }
        resolve(result ?? { verdict: 'clean' });
      };

      socket.setTimeout(this.timeoutMs);
      socket.once('timeout', () => {
        finish(new Error('ClamAV scan timed out.'));
      });
      socket.once('error', (error) => {
        finish(error);
      });
      socket.on('data', (chunk: Buffer) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > MAX_RESPONSE_BYTES) {
          finish(new Error('ClamAV returned an invalid oversized response.'));
          return;
        }
        const terminator = response.indexOf(0);
        if (terminator === -1) return;

        const message = response
          .subarray(0, terminator)
          .toString('utf8')
          .trim();
        if (message.endsWith(' OK')) {
          finish(null, { verdict: 'clean' });
          return;
        }
        if (message.endsWith(' FOUND')) {
          finish(null, { verdict: 'blocked' });
          return;
        }
        finish(new Error('ClamAV could not scan the uploaded file.'));
      });
      socket.once('connect', () => {
        void (async () => {
          await writeToSocket(socket, Buffer.from('zINSTREAM\0', 'ascii'));
          const stream = createReadStream(filePath, {
            highWaterMark: STREAM_CHUNK_BYTES,
          });
          for await (const bytes of stream as AsyncIterable<Buffer>) {
            const length = Buffer.allocUnsafe(4);
            length.writeUInt32BE(bytes.length);
            await writeToSocket(socket, length);
            await writeToSocket(socket, bytes);
          }
          await writeToSocket(socket, Buffer.alloc(4));
        })().catch((error: unknown) => {
          finish(
            error instanceof Error
              ? error
              : new Error('ClamAV scan failed unexpectedly.'),
          );
        });
      });
    });
  }
}

export function createMalwareScanner(config: {
  host: string;
  mode: 'clamav' | 'disabled';
  port: number;
  timeoutMs: number;
}): MalwareScannerAdapter {
  return config.mode === 'clamav'
    ? new ClamAvMalwareScanner(config.host, config.port, config.timeoutMs)
    : new DeferredMalwareScanner();
}
