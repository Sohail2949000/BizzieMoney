import type { FastifyRequest } from 'fastify';

export function requestUsesSecureCookies(
  request: FastifyRequest,
  allowedOrigins: readonly string[],
  defaultSecure: boolean,
): boolean {
  const requestOrigin = request.headers.origin;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return new URL(requestOrigin).protocol === 'https:';
  }

  const forwardedProtocolHeader = request.headers['x-forwarded-proto'];
  const forwardedProtocol = (
    Array.isArray(forwardedProtocolHeader)
      ? forwardedProtocolHeader[0]
      : forwardedProtocolHeader
  )
    ?.split(',')[0]
    ?.trim()
    .toLocaleLowerCase('en-US');

  if (forwardedProtocol === 'https') {
    return true;
  }
  if (forwardedProtocol === 'http') {
    return false;
  }

  return defaultSecure;
}
