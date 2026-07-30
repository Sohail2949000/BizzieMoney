import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Cloud,
  Database,
  HardDrive,
  Pencil,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  attachmentApi,
  type AttachmentStorageConfig,
  type AttachmentStorageConfigInput,
} from '../api/attachments';
import { ApiError } from '../api/client';
import { FormField } from '../components/FormField';
import { SettingsDisclosure } from '../components/SettingsDisclosure';

const storageFormSchema = z
  .object({
    accessKeyId: z.string().max(512),
    bucket: z.string().max(255),
    endpoint: z.string().max(2048),
    forcePathStyle: z.boolean(),
    prefix: z.string().max(400),
    provider: z.enum(['local', 's3']),
    region: z.string().max(100),
    removeCredentials: z.boolean(),
    secretAccessKey: z.string().max(512),
  })
  .superRefine((value, context) => {
    if (value.provider === 's3') {
      for (const [field, message] of [
        ['bucket', 'Enter the bucket name.'],
        ['prefix', 'Enter an object prefix.'],
        ['region', 'Enter the bucket region.'],
      ] as const) {
        if (!value[field].trim()) {
          context.addIssue({ code: 'custom', message, path: [field] });
        }
      }
      if (value.endpoint.trim()) {
        try {
          const endpoint = new URL(value.endpoint.trim());
          if (
            !['http:', 'https:'].includes(endpoint.protocol) ||
            endpoint.username ||
            endpoint.password ||
            endpoint.search ||
            endpoint.hash ||
            (endpoint.pathname !== '' && endpoint.pathname !== '/')
          ) {
            throw new Error('invalid');
          }
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'Enter an HTTP or HTTPS endpoint without a path.',
            path: ['endpoint'],
          });
        }
      }
      if (
        Boolean(value.accessKeyId.trim()) !== Boolean(value.secretAccessKey)
      ) {
        const missingField = value.accessKeyId.trim()
          ? 'secretAccessKey'
          : 'accessKeyId';
        context.addIssue({
          code: 'custom',
          message: 'Enter both credentials.',
          path: [missingField],
        });
      }
      if (
        value.removeCredentials &&
        (value.accessKeyId.trim() || value.secretAccessKey)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Clear the replacement keys or turn this option off.',
          path: ['removeCredentials'],
        });
      }
    }
  });

type StorageFormValues = z.infer<typeof storageFormSchema>;

const savedCredentialMask = '**********************';

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function defaultValues(
  configuration: AttachmentStorageConfig,
): StorageFormValues {
  return {
    accessKeyId: '',
    bucket: configuration.s3?.bucket ?? '',
    endpoint: configuration.s3?.endpoint ?? '',
    forcePathStyle: configuration.s3?.forcePathStyle ?? false,
    prefix: configuration.s3?.prefix ?? 'bizziemoney',
    provider: configuration.provider,
    region: configuration.s3?.region ?? 'auto',
    removeCredentials: false,
    secretAccessKey: '',
  };
}

function toInput(values: StorageFormValues): AttachmentStorageConfigInput {
  const hasS3Details = Boolean(
    values.bucket.trim() || values.endpoint.trim() || values.prefix.trim(),
  );
  return {
    provider: values.provider,
    s3:
      values.provider === 's3' || hasS3Details
        ? {
            ...(values.accessKeyId.trim()
              ? { accessKeyId: values.accessKeyId.trim() }
              : {}),
            bucket: values.bucket.trim(),
            endpoint: values.endpoint.trim() || null,
            forcePathStyle: values.forcePathStyle,
            prefix: values.prefix.trim(),
            region: values.region.trim(),
            ...(values.removeCredentials ? { removeCredentials: true } : {}),
            ...(values.secretAccessKey
              ? { secretAccessKey: values.secretAccessKey }
              : {}),
          }
        : null,
  };
}

function mutationMessage(error: unknown): string | null {
  return error instanceof ApiError
    ? error.message
    : error
      ? 'The storage settings could not be updated.'
      : null;
}

function StorageConfigurationForm({
  configuration,
}: {
  configuration: AttachmentStorageConfig;
}) {
  const queryClient = useQueryClient();
  const hasSavedCredentials = Boolean(configuration.s3?.hasCredentials);
  const [editingS3, setEditingS3] = useState(!hasSavedCredentials);
  const form = useForm<StorageFormValues>({
    defaultValues: defaultValues(configuration),
    resolver: zodResolver(storageFormSchema),
  });
  const provider = useWatch({ control: form.control, name: 'provider' });
  const s3Locked = hasSavedCredentials && !editingS3;
  const saveMutation = useMutation({
    mutationFn: (values: StorageFormValues) =>
      attachmentApi.saveStorage(toInput(values)),
    onSuccess: async (data) => {
      form.reset(defaultValues(data.configuration));
      setEditingS3(!data.configuration.s3?.hasCredentials);
      await queryClient.invalidateQueries({
        queryKey: ['attachment-storage'],
      });
    },
  });
  const testMutation = useMutation({
    mutationFn: (values: StorageFormValues) =>
      attachmentApi.testStorage(toInput(values)),
  });
  const cancelS3Editing = () => {
    form.reset(defaultValues(configuration));
    setEditingS3(false);
  };

  return (
    <form
      className="storage-config-form"
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit((values) => saveMutation.mutate(values))(event);
      }}
    >
      <fieldset className="backup-destination">
        <legend>Storage provider for new uploads</legend>
        <div className="backup-destination__choices">
          <label
            className={`backup-choice${provider === 'local' ? ' is-selected' : ''}`}
          >
            <input type="radio" value="local" {...form.register('provider')} />
            <HardDrive aria-hidden="true" size={19} />
            <span>
              <strong>Local host folder</strong>
              <small>Uses the deployment-managed attachment mount.</small>
            </span>
            {provider === 'local' ? (
              <CheckCircle2
                aria-hidden="true"
                className="backup-choice__check"
                size={19}
              />
            ) : null}
          </label>
          <label
            className={`backup-choice${provider === 's3' ? ' is-selected' : ''}`}
          >
            <input type="radio" value="s3" {...form.register('provider')} />
            <Cloud aria-hidden="true" size={19} />
            <span>
              <strong>S3 / Cloudflare R2</strong>
              <small>Stores new files in a private compatible bucket.</small>
            </span>
            {provider === 's3' ? (
              <CheckCircle2
                aria-hidden="true"
                className="backup-choice__check"
                size={19}
              />
            ) : null}
          </label>
        </div>
      </fieldset>

      <p className="storage-provider-note">
        Changing provider affects new uploads only. Existing files continue to
        open from their original location.
      </p>

      {provider === 's3' ? (
        <div className="storage-s3-fields">
          <div className="s3-configuration-header">
            <div>
              <strong>S3 configuration</strong>
              <span>
                {s3Locked
                  ? 'Saved credentials are protected from accidental changes.'
                  : hasSavedCredentials
                    ? 'Enter both keys only when replacing the saved credentials.'
                    : 'Configure the private bucket used for new uploads.'}
              </span>
            </div>
            {hasSavedCredentials ? (
              <button
                className="button button--secondary"
                onClick={() => {
                  if (editingS3) {
                    cancelS3Editing();
                  } else {
                    saveMutation.reset();
                    testMutation.reset();
                    setEditingS3(true);
                  }
                }}
                type="button"
              >
                <Pencil aria-hidden="true" size={15} />
                {editingS3 ? 'Cancel editing' : 'Edit configuration'}
              </button>
            ) : null}
          </div>
          <FormField
            error={form.formState.errors.bucket?.message}
            id="attachment-s3-bucket"
            label="Bucket"
            readOnly={s3Locked}
            {...form.register('bucket')}
          />
          <FormField
            error={form.formState.errors.region?.message}
            id="attachment-s3-region"
            label="Region"
            readOnly={s3Locked}
            {...form.register('region')}
          />
          <FormField
            error={form.formState.errors.endpoint?.message}
            hint="Required for Cloudflare R2, MinIO, and other compatible providers."
            id="attachment-s3-endpoint"
            label="Endpoint (optional for AWS)"
            placeholder="https://account-id.r2.cloudflarestorage.com"
            readOnly={s3Locked}
            {...form.register('endpoint')}
          />
          <FormField
            error={form.formState.errors.prefix?.message}
            hint="Use a dedicated prefix so BizzieMoney objects stay together."
            id="attachment-s3-prefix"
            label="Object prefix"
            readOnly={s3Locked}
            {...form.register('prefix')}
          />
          {s3Locked ? (
            <>
              <FormField
                autoComplete="off"
                hint="Saved securely. Choose Edit configuration to replace it."
                id="attachment-s3-access-key"
                key="attachment-access-key-locked"
                label="Access key ID"
                readOnly
                value={savedCredentialMask}
              />
              <FormField
                autoComplete="off"
                hint="Saved securely. Choose Edit configuration to replace it."
                id="attachment-s3-secret-key"
                key="attachment-secret-key-locked"
                label="Secret access key"
                readOnly
                value={savedCredentialMask}
              />
            </>
          ) : (
            <>
              <FormField
                autoComplete="off"
                error={form.formState.errors.accessKeyId?.message}
                hint={
                  hasSavedCredentials
                    ? 'Enter both keys to replace the saved credentials.'
                    : 'Optional when the server already has an AWS role.'
                }
                id="attachment-s3-access-key"
                key="attachment-access-key-editable"
                label="Access key ID"
                {...form.register('accessKeyId')}
              />
              <FormField
                autoComplete="new-password"
                error={form.formState.errors.secretAccessKey?.message}
                hint={
                  hasSavedCredentials
                    ? 'Enter both keys to replace the saved credentials.'
                    : 'Optional when the server already has an AWS role.'
                }
                id="attachment-s3-secret-key"
                key="attachment-secret-key-editable"
                label="Secret access key"
                type="password"
                {...form.register('secretAccessKey')}
              />
            </>
          )}
          <label className="toggle-field">
            <input
              disabled={s3Locked}
              type="checkbox"
              {...form.register('forcePathStyle')}
            />
            <span>
              <strong>Use path-style requests</strong>
              <small>Useful for MinIO and some compatible providers.</small>
            </span>
          </label>
          {hasSavedCredentials && editingS3 ? (
            <label className="toggle-field">
              <input type="checkbox" {...form.register('removeCredentials')} />
              <span>
                <strong>Remove saved credentials</strong>
                <small>Use only if the server provides an AWS role.</small>
              </span>
            </label>
          ) : null}
        </div>
      ) : (
        <div className="storage-local-callout">
          <HardDrive aria-hidden="true" size={18} />
          <div>
            <strong>Host-mounted storage</strong>
            <span>
              The local folder is controlled by the server configuration and is
              never exposed to the browser.
            </span>
          </div>
        </div>
      )}

      {mutationMessage(saveMutation.error) ? (
        <p className="form-message form-message--error" role="alert">
          {mutationMessage(saveMutation.error)}
        </p>
      ) : null}
      {saveMutation.isSuccess ? (
        <p className="form-message form-message--success" role="status">
          Attachment storage settings saved. New uploads will use{' '}
          {saveMutation.data.configuration.provider === 'local'
            ? 'the local folder'
            : 'S3-compatible storage'}
          .
        </p>
      ) : null}
      {testMutation.isSuccess ? (
        <p className="form-message form-message--success" role="status">
          {testMutation.data.message}
        </p>
      ) : null}
      {mutationMessage(testMutation.error) ? (
        <p className="form-message form-message--error" role="alert">
          {mutationMessage(testMutation.error)}
        </p>
      ) : null}

      <div className="settings-actions">
        <button
          className="button button--secondary"
          disabled={testMutation.isPending || saveMutation.isPending}
          onClick={() => {
            void form.handleSubmit((values) => testMutation.mutate(values))();
          }}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={16} />
          {testMutation.isPending ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="button button--primary"
          disabled={
            saveMutation.isPending ||
            testMutation.isPending ||
            (provider === configuration.provider && s3Locked)
          }
          type="submit"
        >
          <Save aria-hidden="true" size={16} />
          {saveMutation.isPending ? 'Saving…' : 'Save storage settings'}
        </button>
      </div>
    </form>
  );
}

export function StorageSettings() {
  const statusQuery = useQuery({
    queryFn: attachmentApi.getStatus,
    queryKey: ['attachment-storage'],
  });
  const configuration = statusQuery.data?.configuration ?? {
    provider: statusQuery.data?.provider ?? ('local' as const),
    s3: null,
    source: 'environment' as const,
    updatedAt: null,
  };

  return (
    <SettingsDisclosure
      eyebrow="Attachments"
      icon={<Database size={19} />}
      id="file-storage"
      title="File storage"
    >
      {statusQuery.isPending ? (
        <p className="settings-muted" role="status">
          Checking attachment storage…
        </p>
      ) : statusQuery.isError ? (
        <p className="form-message form-message--error" role="alert">
          Attachment storage settings could not be loaded.
        </p>
      ) : (
        <>
          <dl className="settings-details storage-details">
            <div>
              <dt>Active provider</dt>
              <dd>{statusQuery.data.providerLabel}</dd>
            </div>
            <div>
              <dt>Stored files</dt>
              <dd>
                {statusQuery.data.fileCount} ·{' '}
                {formatBytes(statusQuery.data.totalSizeBytes)}
              </dd>
            </div>
            <div>
              <dt>Maximum file size</dt>
              <dd>{formatBytes(statusQuery.data.maxUploadSizeBytes)}</dd>
            </div>
            <div>
              <dt>Configuration source</dt>
              <dd>
                {configuration.source === 'settings'
                  ? 'Saved in BizzieMoney'
                  : 'Server environment defaults'}
              </dd>
            </div>
            <div>
              <dt>Malware scanner</dt>
              <dd>
                {statusQuery.data.malwareScanner === 'not-configured'
                  ? 'Adapter ready · scanner not configured'
                  : 'ClamAV enabled · uploads scanned'}
              </dd>
            </div>
          </dl>
          <div className="storage-types">
            <strong>Allowed content</strong>
            <span>
              {statusQuery.data.allowedMimeTypes
                .map((mime) =>
                  mime.replace('application/', '').replace('image/', ''),
                )
                .join(' · ')}
            </span>
          </div>
          <StorageConfigurationForm
            configuration={configuration}
            key={configuration.updatedAt ?? configuration.provider}
          />
        </>
      )}
    </SettingsDisclosure>
  );
}
