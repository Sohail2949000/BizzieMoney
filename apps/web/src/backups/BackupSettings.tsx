import { zodResolver } from '@hookform/resolvers/zod';
import { APP_SCHEMA_VERSION } from '@bizziemoney/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  CheckCircle2,
  Cloud,
  DatabaseBackup,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  backupApi,
  type BackupArtifact,
  type BackupConfig,
  type BackupConfigInput,
  type BackupJob,
  type RestorePreview,
} from '../api/backups';
import { ApiError } from '../api/client';
import { FormField } from '../components/FormField';
import { SettingsDisclosure } from '../components/SettingsDisclosure';
import { usePreferences } from '../preferences/context';

const formSchema = z
  .object({
    accessKeyId: z.string().max(512),
    backupTime: z.string().min(1, 'Choose a backup time.'),
    bucket: z.string().max(255),
    dayOfMonth: z.string(),
    dayOfWeek: z.string(),
    destination: z.enum(['local', 's3']),
    enabled: z.boolean(),
    encryptionPassword: z.string().max(128),
    endpoint: z.string().max(2048),
    forcePathStyle: z.boolean(),
    frequency: z.enum(['daily', 'weekly', 'monthly']),
    includeAttachments: z.boolean(),
    localSubfolder: z
      .string()
      .trim()
      .min(1, 'Choose a backup folder name.')
      .max(80)
      .regex(
        /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
        'Use letters, numbers, dashes, and underscores.',
      ),
    prefix: z.string().max(400),
    region: z.string().max(100),
    removeEncryption: z.boolean(),
    retentionCount: z
      .string()
      .regex(/^\d+$/, 'Use a whole number from 1 to 100.'),
    secretAccessKey: z.string().max(512),
  })
  .superRefine((value, context) => {
    const retention = Number(value.retentionCount);
    if (retention < 1 || retention > 100) {
      context.addIssue({
        code: 'custom',
        message: 'Keep between 1 and 100 backups.',
        path: ['retentionCount'],
      });
    }
    if (value.encryptionPassword && value.encryptionPassword.length < 12) {
      context.addIssue({
        code: 'custom',
        message: 'Use at least 12 characters.',
        path: ['encryptionPassword'],
      });
    }
    if (value.frequency === 'weekly' && !value.dayOfWeek) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a weekday.',
        path: ['dayOfWeek'],
      });
    }
    if (value.frequency === 'monthly' && !value.dayOfMonth) {
      context.addIssue({
        code: 'custom',
        message: 'Choose a day.',
        path: ['dayOfMonth'],
      });
    }
    if (value.destination === 's3') {
      for (const [field, message] of [
        ['bucket', 'Enter the bucket name.'],
        ['prefix', 'Enter a backup prefix.'],
        ['region', 'Enter the bucket region.'],
      ] as const) {
        if (!value[field].trim()) {
          context.addIssue({ code: 'custom', message, path: [field] });
        }
      }
      if (Boolean(value.accessKeyId) !== Boolean(value.secretAccessKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Enter both credentials or leave both blank.',
          path: ['accessKeyId'],
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

const savedCredentialMask = '**********************';

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function defaultValues(config: BackupConfig | null): FormValues {
  return {
    accessKeyId: '',
    backupTime: config?.backupTime ?? '02:00',
    bucket: config?.s3?.bucket ?? '',
    dayOfMonth: String(config?.dayOfMonth ?? 1),
    dayOfWeek: String(config?.dayOfWeek ?? 0),
    destination: config?.destination ?? 'local',
    enabled: config?.enabled ?? false,
    encryptionPassword: '',
    endpoint: config?.s3?.endpoint ?? '',
    forcePathStyle: config?.s3?.forcePathStyle ?? false,
    frequency: config?.frequency ?? 'daily',
    includeAttachments: config?.includeAttachments ?? true,
    localSubfolder: config?.localSubfolder ?? 'automatic',
    prefix: config?.s3?.prefix ?? 'bizziemoney/backups',
    region: config?.s3?.region ?? 'auto',
    removeEncryption: false,
    retentionCount: String(config?.retentionCount ?? 7),
    secretAccessKey: '',
  };
}

function toInput(
  values: FormValues,
  hasEncryptionPassword: boolean,
): BackupConfigInput {
  const encryptionPassword = values.removeEncryption
    ? null
    : values.encryptionPassword
      ? values.encryptionPassword
      : undefined;
  const credentials =
    values.accessKeyId && values.secretAccessKey
      ? {
          accessKeyId: values.accessKeyId,
          secretAccessKey: values.secretAccessKey,
        }
      : {};
  return {
    backupTime: values.backupTime,
    dayOfMonth:
      values.frequency === 'monthly' ? Number(values.dayOfMonth) : null,
    dayOfWeek: values.frequency === 'weekly' ? Number(values.dayOfWeek) : null,
    destination: values.destination,
    enabled: values.enabled,
    ...(encryptionPassword !== undefined || !hasEncryptionPassword
      ? { encryptionPassword }
      : {}),
    frequency: values.frequency,
    includeAttachments: values.includeAttachments,
    localSubfolder: values.localSubfolder,
    retentionCount: Number(values.retentionCount),
    s3:
      values.destination === 's3'
        ? {
            bucket: values.bucket,
            endpoint: values.endpoint || null,
            forcePathStyle: values.forcePathStyle,
            prefix: values.prefix,
            region: values.region,
            ...credentials,
          }
        : null,
  };
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

function mutationMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message;
  return error ? 'The backup service could not be reached.' : null;
}

function RestoreDialog({
  onClose,
  preview,
}: {
  onClose: () => void;
  preview: RestorePreview;
}) {
  const { formatDateTime: formatDate } = usePreferences();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const restoreMutation = useMutation({
    mutationFn: () =>
      backupApi.restore({ currentPassword, previewId: preview.id }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-history'] }),
      ]);
      onClose();
    },
  });
  const summary = preview.summary;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-labelledby="restore-dialog-title"
      className="backup-restore-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="dialog-heading">
        <div>
          <p>Safety check</p>
          <h2 id="restore-dialog-title">Restore preview</h2>
        </div>
        <button
          aria-label="Close restore preview"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={19} />
        </button>
      </div>

      {preview.status === 'pending' ? (
        <div className="backup-preview-wait" role="status">
          <LoaderCircle aria-hidden="true" className="spin" size={20} />
          <div>
            <strong>{preview.job.progressStage}</strong>
            <span>Verifying the archive and its checksums…</span>
          </div>
        </div>
      ) : preview.status === 'failed' || !summary ? (
        <p className="form-message form-message--error" role="alert">
          {preview.job.errorMessage ??
            'This backup could not be verified for restore.'}
        </p>
      ) : (
        <>
          <dl className="backup-preview-details">
            <div>
              <dt>Backup created</dt>
              <dd>{formatDate(summary.backupCreatedAt)}</dd>
            </div>
            <div>
              <dt>Application / schema</dt>
              <dd>
                v{summary.applicationVersion} · schema {summary.schemaVersion}
              </dd>
            </div>
            <div>
              <dt>Financial records</dt>
              <dd>
                {(summary.tables.expenses ?? 0) +
                  (summary.tables.subscriptions ?? 0) +
                  (summary.tables.debts ?? 0)}
              </dd>
            </div>
            <div>
              <dt>Attachment files</dt>
              <dd>
                {summary.includesAttachments
                  ? `${summary.attachmentCount} included`
                  : 'Metadata only'}
              </dd>
            </div>
          </dl>
          {summary.warnings.length > 0 ? (
            <div className="backup-warning" role="alert">
              <TriangleAlert aria-hidden="true" size={18} />
              <div>
                {summary.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </div>
          ) : null}
          <p className="backup-restore-note">
            BizzieMoney will create and verify a new safety backup before
            changing any data.
          </p>
          <FormField
            autoComplete="current-password"
            id="backup-restore-password"
            label="Current account password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            value={currentPassword}
          />
          <label className="toggle-field">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>I reviewed this preview</strong>
              <small>
                Replace the current financial records with this verified backup.
              </small>
            </span>
          </label>
        </>
      )}

      {mutationMessage(restoreMutation.error) ? (
        <p className="form-message form-message--error" role="alert">
          {mutationMessage(restoreMutation.error)}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button
          className="button button--secondary"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button button--danger"
          disabled={
            preview.status !== 'ready' ||
            !summary ||
            summary.schemaVersion > APP_SCHEMA_VERSION ||
            !confirmed ||
            !currentPassword ||
            restoreMutation.isPending
          }
          onClick={() => restoreMutation.mutate()}
          type="button"
        >
          <ArchiveRestore aria-hidden="true" size={16} />
          {restoreMutation.isPending ? 'Starting restore…' : 'Restore backup'}
        </button>
      </div>
    </dialog>
  );
}

function BackupHistory({
  artifacts,
  jobs,
}: {
  artifacts: BackupArtifact[];
  jobs: BackupJob[];
}) {
  const { formatDateTime: formatDate } = usePreferences();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const previewMutation = useMutation({
    mutationFn: backupApi.createPreview,
    onSuccess: (preview) => {
      queryClient.setQueryData(['backup-preview', preview.id], preview);
      setPreviewId(preview.id);
    },
  });
  const previewQuery = useQuery({
    enabled: Boolean(previewId),
    queryFn: () => backupApi.getPreview(previewId ?? ''),
    queryKey: ['backup-preview', previewId],
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' ? 1_500 : false,
  });

  return (
    <div className="backup-history">
      <div className="backup-history__column">
        <div className="backup-subheading">
          <div>
            <strong>Verified backups</strong>
            <span>
              Only completed, checksum-verified artifacts appear here.
            </span>
          </div>
        </div>
        {artifacts.length === 0 ? (
          <p className="settings-muted">No verified backups yet.</p>
        ) : (
          <div className="backup-artifact-list">
            {artifacts.map((artifact) => (
              <article className="backup-artifact" key={artifact.id}>
                <span aria-hidden="true" className="backup-artifact__icon">
                  <CheckCircle2 size={18} />
                </span>
                <div>
                  <strong>{artifact.fileName}</strong>
                  <span>
                    {formatDate(artifact.backupCreatedAt)} ·{' '}
                    {formatBytes(artifact.sizeBytes)}
                  </span>
                  <small>
                    {artifact.storageProvider === 'local'
                      ? 'Local host folder'
                      : 'S3-compatible storage'}{' '}
                    · {artifact.encrypted ? 'Encrypted' : 'Not encrypted'} ·{' '}
                    {artifact.includesAttachments
                      ? `${artifact.attachmentCount} file(s)`
                      : 'Metadata only'}
                  </small>
                </div>
                <button
                  className="button button--secondary button--compact"
                  disabled={previewMutation.isPending}
                  onClick={() => previewMutation.mutate(artifact.id)}
                  type="button"
                >
                  Preview restore
                </button>
              </article>
            ))}
          </div>
        )}
        {mutationMessage(previewMutation.error) ? (
          <p className="form-message form-message--error" role="alert">
            {mutationMessage(previewMutation.error)}
          </p>
        ) : null}
      </div>

      <div className="backup-history__column">
        <div className="backup-subheading">
          <div>
            <strong>Recent activity</strong>
            <span>Manual, scheduled, preview, and restore jobs.</span>
          </div>
        </div>
        {jobs.length === 0 ? (
          <p className="settings-muted">No backup activity yet.</p>
        ) : (
          <div className="backup-job-list">
            {jobs.slice(0, 10).map((job) => (
              <article className="backup-job" key={job.id}>
                <span
                  aria-hidden="true"
                  className={`backup-job__status backup-job__status--${job.status}`}
                />
                <div>
                  <strong>
                    {job.kind === 'backup'
                      ? 'Backup'
                      : job.kind === 'preview'
                        ? 'Restore preview'
                        : 'Restore'}
                  </strong>
                  <span>
                    {job.progressStage} · {formatDate(job.createdAt)}
                  </span>
                  {job.errorMessage ? <small>{job.errorMessage}</small> : null}
                </div>
                <span className="backup-job__progress">
                  {job.status === 'processing'
                    ? `${job.progressPercent}%`
                    : job.status}
                </span>
              </article>
            ))}
          </div>
        )}
      </div>

      {previewId && previewQuery.data ? (
        <RestoreDialog
          onClose={() => setPreviewId(null)}
          preview={previewQuery.data}
        />
      ) : null}
    </div>
  );
}

function BackupConfigurationForm({ config }: { config: BackupConfig | null }) {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const hasSavedS3Credentials = Boolean(config?.s3?.hasCredentials);
  const [editingS3, setEditingS3] = useState(!hasSavedS3Credentials);
  const form = useForm<FormValues>({
    defaultValues: defaultValues(config),
    resolver: zodResolver(formSchema),
  });
  const destination = useWatch({
    control: form.control,
    name: 'destination',
  });
  const frequency = useWatch({
    control: form.control,
    name: 'frequency',
  });
  const s3Locked = hasSavedS3Credentials && !editingS3;
  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      backupApi.saveConfig(
        toInput(values, Boolean(config?.hasEncryptionPassword)),
      ),
    onSuccess: async () => {
      setEditingS3(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['backup-config'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-history'] }),
      ]);
    },
  });
  const testMutation = useMutation({
    mutationFn: (values: FormValues) =>
      backupApi.testDestination(
        toInput(values, Boolean(config?.hasEncryptionPassword)),
      ),
  });
  const cancelS3Editing = () => {
    const saved = defaultValues(config);
    form.setValue('accessKeyId', saved.accessKeyId);
    form.setValue('bucket', saved.bucket);
    form.setValue('endpoint', saved.endpoint);
    form.setValue('forcePathStyle', saved.forcePathStyle);
    form.setValue('prefix', saved.prefix);
    form.setValue('region', saved.region);
    form.setValue('secretAccessKey', saved.secretAccessKey);
    form.clearErrors([
      'accessKeyId',
      'bucket',
      'endpoint',
      'prefix',
      'region',
      'secretAccessKey',
    ]);
    setEditingS3(false);
  };

  return (
    <form
      className="backup-config-form"
      noValidate
      onSubmit={(event) => {
        void form.handleSubmit((values) => saveMutation.mutate(values))(event);
      }}
    >
      <label className="toggle-field backup-master-toggle">
        <input type="checkbox" {...form.register('enabled')} />
        <span>
          <strong>Automatic backups</strong>
          <small>
            The worker creates the next backup at the schedule below.
          </small>
        </span>
      </label>

      <div className="backup-form-grid">
        <label className="form-field" htmlFor="backup-frequency">
          <span className="form-field__label">Frequency</span>
          <select
            className="form-field__input"
            id="backup-frequency"
            {...form.register('frequency')}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {frequency === 'weekly' ? (
          <label className="form-field" htmlFor="backup-weekday">
            <span className="form-field__label">Weekday</span>
            <select
              className="form-field__input"
              id="backup-weekday"
              {...form.register('dayOfWeek')}
            >
              {weekdays.map((_, offset) => {
                const index =
                  (preferences.firstDayOfWeek + offset) % weekdays.length;
                return (
                  <option key={weekdays[index]} value={index}>
                    {weekdays[index]}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        {frequency === 'monthly' ? (
          <FormField
            error={form.formState.errors.dayOfMonth?.message}
            id="backup-month-day"
            label="Day of month"
            max={28}
            min={1}
            type="number"
            {...form.register('dayOfMonth')}
          />
        ) : null}
        <FormField
          error={form.formState.errors.backupTime?.message}
          id="backup-time"
          label="Backup time"
          type="time"
          {...form.register('backupTime')}
        />
        <FormField
          error={form.formState.errors.retentionCount?.message}
          id="backup-retention"
          label="Backups to keep"
          max={100}
          min={1}
          type="number"
          {...form.register('retentionCount')}
        />
      </div>

      <fieldset className="backup-destination">
        <legend>Destination</legend>
        <div className="backup-destination__choices">
          <label
            className={`backup-choice${destination === 'local' ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              value="local"
              {...form.register('destination')}
            />
            <HardDrive aria-hidden="true" size={19} />
            <span>
              <strong>Local host folder</strong>
              <small>Stored outside the Docker volume.</small>
            </span>
            {destination === 'local' ? (
              <CheckCircle2
                aria-hidden="true"
                className="backup-choice__check"
                size={19}
              />
            ) : null}
          </label>
          <label
            className={`backup-choice${destination === 's3' ? ' is-selected' : ''}`}
          >
            <input type="radio" value="s3" {...form.register('destination')} />
            <Cloud aria-hidden="true" size={19} />
            <span>
              <strong>S3 / Cloudflare R2</strong>
              <small>Any S3-compatible bucket.</small>
            </span>
            {destination === 's3' ? (
              <CheckCircle2
                aria-hidden="true"
                className="backup-choice__check"
                size={19}
              />
            ) : null}
          </label>
        </div>
      </fieldset>

      {destination === 'local' ? (
        <FormField
          error={form.formState.errors.localSubfolder?.message}
          hint="Inside the host-mounted backup directory."
          id="backup-local-folder"
          label="Folder name"
          {...form.register('localSubfolder')}
        />
      ) : (
        <div className="backup-s3-fields">
          <div className="s3-configuration-header">
            <div>
              <strong>S3 backup configuration</strong>
              <span>
                {s3Locked
                  ? 'Saved credentials are protected from accidental changes.'
                  : hasSavedS3Credentials
                    ? 'Enter both keys only when replacing the saved credentials.'
                    : 'Configure the private bucket used for backup archives.'}
              </span>
            </div>
            {hasSavedS3Credentials ? (
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
            id="backup-s3-bucket"
            label="Bucket"
            readOnly={s3Locked}
            {...form.register('bucket')}
          />
          <FormField
            error={form.formState.errors.region?.message}
            id="backup-s3-region"
            label="Region"
            readOnly={s3Locked}
            {...form.register('region')}
          />
          <FormField
            error={form.formState.errors.endpoint?.message}
            hint="Required for R2, MinIO, and other compatible providers."
            id="backup-s3-endpoint"
            label="Endpoint (optional for AWS)"
            placeholder="https://account-id.r2.cloudflarestorage.com"
            readOnly={s3Locked}
            {...form.register('endpoint')}
          />
          <FormField
            error={form.formState.errors.prefix?.message}
            id="backup-s3-prefix"
            label="Object prefix"
            readOnly={s3Locked}
            {...form.register('prefix')}
          />
          {s3Locked ? (
            <>
              <FormField
                autoComplete="off"
                hint="Saved securely. Choose Edit configuration to replace it."
                id="backup-s3-access-key"
                key="backup-access-key-locked"
                label="Access key ID"
                readOnly
                value={savedCredentialMask}
              />
              <FormField
                autoComplete="off"
                hint="Saved securely. Choose Edit configuration to replace it."
                id="backup-s3-secret-key"
                key="backup-secret-key-locked"
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
                  hasSavedS3Credentials
                    ? 'Enter both keys to replace the saved credentials.'
                    : 'Optional when the server already has an AWS role.'
                }
                id="backup-s3-access-key"
                key="backup-access-key-editable"
                label="Access key ID"
                {...form.register('accessKeyId')}
              />
              <FormField
                autoComplete="new-password"
                error={form.formState.errors.secretAccessKey?.message}
                hint={
                  hasSavedS3Credentials
                    ? 'Enter both keys to replace the saved credentials.'
                    : 'Optional when the server already has an AWS role.'
                }
                id="backup-s3-secret-key"
                key="backup-secret-key-editable"
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
        </div>
      )}

      <div className="backup-options">
        <label className="toggle-field">
          <input type="checkbox" {...form.register('includeAttachments')} />
          <span>
            <strong>Include attachment files</strong>
            <small>
              Otherwise the archive contains their metadata and manifest only.
            </small>
          </span>
        </label>
        <div className="backup-encryption">
          <KeyRound aria-hidden="true" size={18} />
          <FormField
            autoComplete="new-password"
            error={form.formState.errors.encryptionPassword?.message}
            hint={
              config?.hasEncryptionPassword
                ? 'Leave blank to keep the saved password.'
                : 'Optional. At least 12 characters.'
            }
            id="backup-encryption-password"
            label="Backup encryption password"
            type="password"
            {...form.register('encryptionPassword')}
          />
        </div>
        {config?.hasEncryptionPassword ? (
          <label className="toggle-field">
            <input type="checkbox" {...form.register('removeEncryption')} />
            <span>
              <strong>Stop encrypting new backups</strong>
              <small>Existing encrypted backups remain encrypted.</small>
            </span>
          </label>
        ) : null}
      </div>

      {mutationMessage(saveMutation.error) ? (
        <p className="form-message form-message--error" role="alert">
          {mutationMessage(saveMutation.error)}
        </p>
      ) : null}
      {saveMutation.isSuccess ? (
        <p className="form-message form-message--success" role="status">
          Backup settings saved.
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
          disabled={testMutation.isPending}
          onClick={() => {
            void form.handleSubmit((values) => testMutation.mutate(values))();
          }}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={16} />
          {testMutation.isPending ? 'Testing…' : 'Test destination'}
        </button>
        <button
          className="button button--primary"
          disabled={saveMutation.isPending}
          type="submit"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save backup settings'}
        </button>
      </div>
    </form>
  );
}

export function BackupSettings({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  const { formatDateTime: formatDate } = usePreferences();
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryFn: backupApi.getConfig,
    queryKey: ['backup-config'],
  });
  const statusQuery = useQuery({
    queryFn: backupApi.getStatus,
    queryKey: ['backup-status'],
    refetchInterval: 3_000,
  });
  const historyQuery = useQuery({
    queryFn: backupApi.getHistory,
    queryKey: ['backup-history'],
    refetchInterval: (query) =>
      statusQuery.data?.activeJob ||
      query.state.data?.jobs.some(
        (job) => job.status === 'queued' || job.status === 'processing',
      )
        ? 3_000
        : false,
  });
  const runMutation = useMutation({
    mutationFn: backupApi.runNow,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
        queryClient.invalidateQueries({ queryKey: ['backup-history'] }),
      ]);
    },
  });

  const config = configQuery.data?.config ?? null;
  const status = statusQuery.data;
  return (
    <SettingsDisclosure
      className="backup-settings"
      defaultOpen={defaultOpen}
      eyebrow="Data safety"
      icon={<DatabaseBackup size={19} />}
      id="backups"
      title="Automatic backups"
    >
      {configQuery.isPending || statusQuery.isPending ? (
        <p className="settings-muted" role="status">
          Checking backup safety…
        </p>
      ) : configQuery.isError || statusQuery.isError ? (
        <p className="form-message form-message--error" role="alert">
          Backup settings could not be loaded.
        </p>
      ) : (
        <>
          <div className="backup-status-grid">
            <article>
              <span
                className={`status-dot status-dot--${
                  status?.lastSuccessfulBackup ? 'success' : 'warning'
                }`}
              />
              <div>
                <span>Last verified backup</span>
                <strong>
                  {status?.lastSuccessfulBackup
                    ? formatDate(status.lastSuccessfulBackup.backupCreatedAt)
                    : 'Not created yet'}
                </strong>
              </div>
            </article>
            <article>
              <span
                className={`status-dot status-dot--${
                  config?.enabled ? 'success' : 'warning'
                }`}
              />
              <div>
                <span>Next scheduled backup</span>
                <strong>{formatDate(config?.nextRunAt ?? null)}</strong>
              </div>
            </article>
            <article>
              <span
                className={`status-dot status-dot--${
                  status?.worker.status === 'online' ? 'success' : 'danger'
                }`}
              />
              <div>
                <span>Backup worker</span>
                <strong>
                  {status?.worker.status === 'online'
                    ? 'Online'
                    : status?.worker.status === 'offline'
                      ? 'Offline'
                      : 'Waiting for first heartbeat'}
                </strong>
              </div>
            </article>
          </div>

          {status?.activeJob ? (
            <div className="backup-active-job" role="status">
              <LoaderCircle aria-hidden="true" className="spin" size={19} />
              <div>
                <strong>{status.activeJob.progressStage}</strong>
                <span>
                  {status.activeJob.kind === 'restore' ? 'Restore' : 'Backup'} ·{' '}
                  {status.activeJob.progressPercent}%
                </span>
              </div>
              <progress max={100} value={status.activeJob.progressPercent} />
            </div>
          ) : null}

          <BackupConfigurationForm
            config={config}
            key={config?.updatedAt ?? 'new-backup-config'}
          />

          <div className="backup-run-now">
            <div>
              <strong>Need a fresh copy now?</strong>
              <span>
                A manual backup uses the saved destination and safety options.
              </span>
            </div>
            <button
              className="button button--secondary"
              disabled={
                !config || Boolean(status?.activeJob) || runMutation.isPending
              }
              onClick={() => runMutation.mutate()}
              type="button"
            >
              <DatabaseBackup aria-hidden="true" size={16} />
              {runMutation.isPending ? 'Queuing…' : 'Back up now'}
            </button>
          </div>
          {mutationMessage(runMutation.error) ? (
            <p className="form-message form-message--error" role="alert">
              {mutationMessage(runMutation.error)}
            </p>
          ) : null}

          {historyQuery.isPending ? (
            <p className="settings-muted" role="status">
              Loading backup history…
            </p>
          ) : historyQuery.isError ? (
            <p className="form-message form-message--error" role="alert">
              Backup history could not be loaded.
            </p>
          ) : (
            <BackupHistory
              artifacts={historyQuery.data.artifacts}
              jobs={historyQuery.data.jobs}
            />
          )}
        </>
      )}
    </SettingsDisclosure>
  );
}
