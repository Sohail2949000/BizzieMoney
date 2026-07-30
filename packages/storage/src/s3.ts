import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import type { S3StorageConfig } from './config';
import type { AttachmentStorage, PutFileInput, StoredObject } from './types';

export class S3AttachmentStorage implements AttachmentStorage {
  readonly provider = 's3' as const;
  readonly rootIdentifier: string;
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.rootIdentifier = config.prefix
      ? `${config.bucket}/${config.prefix}`
      : config.bucket;
    const clientConfig = {
      forcePathStyle: config.forcePathStyle,
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    } satisfies S3ClientConfig;
    this.client = new S3Client(clientConfig);
  }

  async putFile(input: PutFileInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: createReadStream(input.filePath),
        Bucket: this.config.bucket,
        ContentType: input.mimeType,
        Key: this.fullKey(input.objectKey),
        Metadata: { 'bizziemoney-sha256': input.checksumSha256 },
      }),
    );
  }

  async openObject(objectKey: string): Promise<StoredObject> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.fullKey(objectKey),
      }),
    );
    if (!response.Body) throw new Error('STORAGE_OBJECT_UNAVAILABLE');
    return {
      body:
        response.Body instanceof Readable
          ? response.Body
          : Readable.fromWeb(
              response.Body.transformToWebStream() as unknown as NodeReadableStream,
            ),
      contentLength: response.ContentLength,
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.fullKey(objectKey),
      }),
    );
  }

  async testConnection(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.bucket }),
    );
  }

  private fullKey(objectKey: string): string {
    return this.config.prefix
      ? `${this.config.prefix}/${objectKey}`
      : objectKey;
  }
}
