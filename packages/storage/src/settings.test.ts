import { describe, expect, it } from 'vitest';

import { SecretBox } from './secrets';
import {
  attachmentStorageConfigFromPersisted,
  sealAttachmentStorageCredentials,
} from './settings';

describe('saved attachment storage settings', () => {
  it('opens encrypted credentials without exposing them in persisted fields', () => {
    const secretBox = new SecretBox('s'.repeat(32));
    const ciphertext = sealAttachmentStorageCredentials(secretBox, {
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    });
    const config = attachmentStorageConfigFromPersisted(
      {
        activeProvider: 'local',
        localPath: '/data/attachments',
        s3: null,
      },
      {
        activeProvider: 's3',
        s3Bucket: 'private-receipts',
        s3CredentialsCiphertext: ciphertext,
        s3Endpoint: 'https://account.r2.cloudflarestorage.com',
        s3ForcePathStyle: false,
        s3Prefix: 'bizziemoney',
        s3Region: 'auto',
      },
      secretBox,
    );

    expect(ciphertext).not.toContain('secret-key');
    expect(config?.s3).toMatchObject({
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
    });
  });

  it('rejects credentials that cannot be authenticated', () => {
    expect(() =>
      attachmentStorageConfigFromPersisted(
        {
          activeProvider: 'local',
          localPath: '/data/attachments',
          s3: null,
        },
        {
          activeProvider: 's3',
          s3Bucket: 'private-receipts',
          s3CredentialsCiphertext: 'v1.invalid.value',
          s3Endpoint: null,
          s3ForcePathStyle: false,
          s3Prefix: 'bizziemoney',
          s3Region: 'auto',
        },
        new SecretBox('s'.repeat(32)),
      ),
    ).toThrow('ATTACHMENT_STORAGE_CREDENTIALS_INVALID');
  });
});
