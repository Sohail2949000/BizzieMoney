import type { ColumnType } from 'kysely';

type Generated<T> = ColumnType<T, T | undefined, T>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;
type DateOnly = ColumnType<string, string, string>;
type NullableDateOnly = ColumnType<
  string | null,
  string | null | undefined,
  string | null
>;
type Numeric = ColumnType<string, string | number, string | number>;
type BigInteger = ColumnType<string, string | number, string | number>;
type JsonObject = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | undefined,
  Record<string, unknown>
>;

export interface AppMetaTable {
  id: Generated<number>;
  application_version: string;
  schema_version: number;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AppUserTable {
  id: string;
  owner_slot: Generated<number>;
  email: string;
  normalized_email: string;
  display_name: string;
  password_hash: string;
  password_changed_at: Timestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AppSettingTable {
  owner_id: string;
  default_currency: Generated<string>;
  date_format: Generated<string>;
  first_day_of_week: Generated<number>;
  number_format: Generated<string>;
  time_zone: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SessionTable {
  id: string;
  owner_id: string;
  token_hash: string;
  csrf_token_hash: string;
  user_agent: string;
  ip_hash: string;
  created_at: Timestamp;
  last_seen_at: Timestamp;
  expires_at: Timestamp;
  revoked_at: NullableTimestamp;
  revoke_reason: string | null;
}

export interface AuthRateLimitTable {
  key_hash: string;
  attempts: Generated<number>;
  window_started_at: Timestamp;
  blocked_until: NullableTimestamp;
  updated_at: Timestamp;
}

export interface AuditEventTable {
  id: string;
  owner_id: string | null;
  actor_session_id: string | null;
  event_type: string;
  metadata: JsonObject;
  created_at: GeneratedTimestamp;
}

export interface CategoryTable {
  id: string;
  owner_id: string;
  name: string;
  normalized_name: string;
  icon: string;
  color: string;
  is_archived: Generated<boolean>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface PaymentMethodTable {
  id: string;
  owner_id: string;
  name: string;
  normalized_name: string;
  icon: string;
  is_archived: Generated<boolean>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface TagTable {
  id: string;
  owner_id: string;
  name: string;
  normalized_name: string;
  created_at: GeneratedTimestamp;
}

export interface ExpenseTable {
  id: string;
  owner_id: string;
  expense_date: DateOnly;
  description: string;
  amount: Numeric;
  currency_code: string;
  category_id: string;
  payment_method_id: string;
  merchant: string | null;
  notes: string | null;
  search_vector: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: NullableTimestamp;
}

export interface ExpenseTagTable {
  owner_id: string;
  expense_id: string;
  tag_id: string;
  created_at: GeneratedTimestamp;
}

export interface ExpenseImportRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  imported_count: number;
  currency_counts: JsonObject;
  created_at: GeneratedTimestamp;
}

export interface ExpenseCreationRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  expense_id: string;
  created_at: GeneratedTimestamp;
}

export interface FinancialPurgeRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  result: JsonObject | null;
  completed_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}

export interface AttachmentTable {
  id: string;
  owner_id: string;
  storage_provider: 'local' | 's3';
  storage_root: string;
  object_key: string;
  original_file_name: string;
  display_name: string;
  mime_type: string;
  size_bytes: BigInteger;
  checksum_sha256: string;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: NullableTimestamp;
}

export interface EntityAttachmentTable {
  owner_id: string;
  attachment_id: string;
  entity_type: 'debt' | 'debt_payment' | 'expense' | 'subscription';
  entity_id: string;
  created_at: GeneratedTimestamp;
}

export interface AttachmentUploadRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  attachment_id: string;
  created_at: GeneratedTimestamp;
}

export interface AttachmentCleanupJobTable {
  id: string;
  owner_id: string;
  attachment_id: string | null;
  storage_provider: 'local' | 's3';
  storage_root: string;
  object_key: string;
  status: Generated<'pending' | 'processing' | 'completed' | 'failed'>;
  attempts: Generated<number>;
  scheduled_at: GeneratedTimestamp;
  locked_at: NullableTimestamp;
  completed_at: NullableTimestamp;
  last_error_code: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AttachmentStorageConfigTable {
  owner_id: string;
  active_provider: Generated<'local' | 's3'>;
  s3_bucket: string | null;
  s3_region: string | null;
  s3_endpoint: string | null;
  s3_prefix: string | null;
  s3_force_path_style: Generated<boolean>;
  s3_credentials_ciphertext: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface AttachmentStorageS3ProfileTable {
  owner_id: string;
  storage_root: string;
  bucket: string;
  region: string;
  endpoint: string | null;
  prefix: string;
  force_path_style: Generated<boolean>;
  credentials_ciphertext: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SubscriptionTable {
  id: string;
  owner_id: string;
  name: string;
  amount: Numeric;
  currency_code: string;
  billing_frequency:
    'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'custom';
  custom_interval_days: number | null;
  next_payment_date: DateOnly;
  category_id: string;
  auto_renew: Generated<boolean>;
  reminder_days: Generated<number>;
  status: Generated<'active' | 'paused' | 'cancelled' | 'ended'>;
  start_date: NullableDateOnly;
  end_date: NullableDateOnly;
  notes: string | null;
  search_vector: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: NullableTimestamp;
}

export interface SubscriptionPaymentTable {
  id: string;
  owner_id: string;
  subscription_id: string;
  scheduled_date: DateOnly;
  paid_date: DateOnly;
  amount: Numeric;
  currency_code: string;
  converted_expense_id: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface SubscriptionPaymentRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  payment_id: string;
  created_at: GeneratedTimestamp;
}

export interface SubscriptionConversionRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  payment_id: string;
  expense_id: string;
  created_at: GeneratedTimestamp;
}

export interface SubscriptionReminderTable {
  id: string;
  owner_id: string;
  subscription_id: string;
  payment_date: DateOnly;
  remind_on: DateOnly;
  status: Generated<'pending' | 'ready' | 'dismissed' | 'completed'>;
  ready_at: NullableTimestamp;
  dismissed_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface DebtTable {
  id: string;
  owner_id: string;
  direction: 'i_owe' | 'owed_to_me';
  name: string;
  original_amount: Numeric;
  currency_code: string;
  start_date: DateOnly;
  due_date: NullableDateOnly;
  installment_amount: Numeric | null;
  installment_frequency:
    | 'weekly'
    | 'monthly'
    | 'quarterly'
    | 'semiannual'
    | 'yearly'
    | 'custom'
    | null;
  custom_interval_days: number | null;
  next_payment_date: NullableDateOnly;
  interest_note: string | null;
  status: Generated<'active' | 'paid' | 'overdue' | 'paused' | 'cancelled'>;
  notes: string | null;
  completed_at: NullableTimestamp;
  search_vector: Generated<string>;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: NullableTimestamp;
}

export interface DebtPaymentTable {
  id: string;
  owner_id: string;
  debt_id: string;
  payment_date: DateOnly;
  amount: Numeric;
  notes: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  deleted_at: NullableTimestamp;
}

export interface DebtPaymentRequestTable {
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  payment_id: string;
  created_at: GeneratedTimestamp;
}

export interface BackupConfigTable {
  owner_id: string;
  enabled: Generated<boolean>;
  frequency: Generated<'daily' | 'weekly' | 'monthly'>;
  backup_time: Generated<string>;
  day_of_week: number | null;
  day_of_month: number | null;
  destination: Generated<'local' | 's3'>;
  local_subfolder: Generated<string>;
  s3_bucket: string | null;
  s3_region: string | null;
  s3_endpoint: string | null;
  s3_prefix: string | null;
  s3_force_path_style: Generated<boolean>;
  s3_credentials_ciphertext: string | null;
  retention_count: Generated<number>;
  include_attachments: Generated<boolean>;
  encryption_password_ciphertext: string | null;
  next_run_at: NullableTimestamp;
  last_scheduled_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface BackupJobTable {
  id: string;
  owner_id: string;
  kind: 'backup' | 'preview' | 'restore';
  trigger_type: 'manual' | 'scheduled' | 'safety';
  status: Generated<'queued' | 'processing' | 'succeeded' | 'failed'>;
  idempotency_key: string;
  source_artifact_id: string | null;
  preview_id: string | null;
  safety_artifact_id: string | null;
  scheduled_at: GeneratedTimestamp;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
  locked_at: NullableTimestamp;
  attempts: Generated<number>;
  progress_percent: Generated<number>;
  progress_stage: Generated<string>;
  error_code: string | null;
  error_message: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface BackupArtifactTable {
  id: string;
  owner_id: string;
  job_id: string;
  storage_provider: 'local' | 's3';
  storage_root: string;
  object_key: string;
  file_name: string;
  size_bytes: BigInteger;
  checksum_sha256: string;
  status: Generated<'verified' | 'invalid' | 'deleted'>;
  encrypted: Generated<boolean>;
  includes_attachments: Generated<boolean>;
  attachment_count: Generated<number>;
  application_version: string;
  schema_version: number;
  manifest_summary: JsonObject;
  backup_created_at: Timestamp;
  verified_at: NullableTimestamp;
  deleted_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface RestorePreviewTable {
  id: string;
  owner_id: string;
  artifact_id: string;
  job_id: string;
  status: Generated<'pending' | 'ready' | 'failed'>;
  summary: JsonObject;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface WorkerHeartbeatTable {
  worker_name: string;
  status: Generated<'degraded' | 'online'>;
  metadata: JsonObject;
  last_seen_at: Timestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface DatabaseSchema {
  app_meta: AppMetaTable;
  app_settings: AppSettingTable;
  app_users: AppUserTable;
  attachment_cleanup_jobs: AttachmentCleanupJobTable;
  attachment_storage_configs: AttachmentStorageConfigTable;
  attachment_storage_s3_profiles: AttachmentStorageS3ProfileTable;
  attachment_upload_requests: AttachmentUploadRequestTable;
  attachments: AttachmentTable;
  audit_events: AuditEventTable;
  auth_rate_limits: AuthRateLimitTable;
  backup_artifacts: BackupArtifactTable;
  backup_configs: BackupConfigTable;
  backup_jobs: BackupJobTable;
  categories: CategoryTable;
  debt_payment_requests: DebtPaymentRequestTable;
  debt_payments: DebtPaymentTable;
  debts: DebtTable;
  expense_creation_requests: ExpenseCreationRequestTable;
  expense_import_requests: ExpenseImportRequestTable;
  expense_tags: ExpenseTagTable;
  expenses: ExpenseTable;
  entity_attachments: EntityAttachmentTable;
  financial_purge_requests: FinancialPurgeRequestTable;
  payment_methods: PaymentMethodTable;
  restore_previews: RestorePreviewTable;
  sessions: SessionTable;
  subscription_conversion_requests: SubscriptionConversionRequestTable;
  subscription_payment_requests: SubscriptionPaymentRequestTable;
  subscription_payments: SubscriptionPaymentTable;
  subscription_reminders: SubscriptionReminderTable;
  subscriptions: SubscriptionTable;
  tags: TagTable;
  worker_heartbeats: WorkerHeartbeatTable;
}
