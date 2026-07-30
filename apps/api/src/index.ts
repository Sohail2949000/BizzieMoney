import Fastify from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createApiRuntime } from './runtime.js';

const apiRuntime = createApiRuntime(Fastify);

let readyPromise: Promise<void> | undefined;

async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  readyPromise ??= Promise.resolve(apiRuntime.server.ready()).then(
    () => undefined,
  );
  await readyPromise;

  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
    apiRuntime.server.server.emit('request', request, response);
  });
}

export { apiRuntime };
export default handler;
