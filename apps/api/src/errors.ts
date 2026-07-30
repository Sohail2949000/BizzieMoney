export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterSeconds: number | undefined;

  constructor({
    code,
    message,
    retryAfterSeconds,
    statusCode,
  }: {
    code: string;
    message: string;
    retryAfterSeconds?: number;
    statusCode: number;
  }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
