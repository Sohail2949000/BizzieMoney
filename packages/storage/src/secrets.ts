import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) throw new Error('BACKUP_SECRETS_KEY_TOO_SHORT');
  return createHash('sha256').update(secret).digest();
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = keyFromSecret(secret);
  }

  seal(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  open(value: string): string {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
      value.split('.');
    if (
      version !== VERSION ||
      !encodedIv ||
      !encodedTag ||
      !encodedCiphertext ||
      extra
    ) {
      throw new Error('BACKUP_SECRET_INVALID');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(encodedIv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('BACKUP_SECRET_INVALID');
    }
  }
}
