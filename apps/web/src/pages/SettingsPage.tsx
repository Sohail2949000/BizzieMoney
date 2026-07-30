import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DatabaseBackup,
  KeyRound,
  Laptop2,
  LogOut,
  Palette,
  Pencil,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';

import {
  ApiError,
  authApi,
  type BootstrapState,
  type PublicOwner,
} from '../api/client';
import { authQueryKey, useAuth } from '../auth/auth';
import { FormField } from '../components/FormField';
import { SettingsDisclosure } from '../components/SettingsDisclosure';
import { ThemeSelect } from '../components/ThemeSelect';
import { MoneySettings } from '../expenses/MoneySettings';
import { RegionalPreferences } from '../preferences/RegionalPreferences';
import { usePreferences } from '../preferences/context';

const BackupSettings = lazy(() =>
  import('../backups/BackupSettings').then((module) => ({
    default: module.BackupSettings,
  })),
);

const StorageSettings = lazy(() =>
  import('../attachments/StorageSettings').then((module) => ({
    default: module.StorageSettings,
  })),
);

const DataManagement = lazy(() =>
  import('../data/DataManagement').then((module) => ({
    default: module.DataManagement,
  })),
);

const passwordSchema = z
  .object({
    confirmPassword: z.string(),
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use no more than 128 characters.'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'The new passwords do not match.',
    path: ['confirmPassword'],
  });

type PasswordFormValues = z.infer<typeof passwordSchema>;

const profileSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  displayName: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters.')
    .max(80, 'Use no more than 80 characters.'),
  email: z.string().trim().email('Enter a valid email address.').max(254),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

function describeDevice(userAgent: string): string {
  if (userAgent === 'Unknown device') {
    return userAgent;
  }
  const browser = userAgent.includes('Firefox')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Microsoft Edge'
      : userAgent.includes('Chrome')
        ? 'Chrome'
        : userAgent.includes('Safari')
          ? 'Safari'
          : 'Web browser';
  const platform = userAgent.includes('Windows')
    ? 'Windows'
    : userAgent.includes('Mac OS')
      ? 'macOS'
      : userAgent.includes('Linux')
        ? 'Linux'
        : '';
  return platform ? `${browser} on ${platform}` : browser;
}

export function SettingsPage() {
  const { owner, sessionExpiresAt } = useAuth();
  const { formatDateTime } = usePreferences();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editingProfile, setEditingProfile] = useState(false);
  const sessionsQuery = useQuery({
    queryFn: authApi.listSessions,
    queryKey: ['auth', 'sessions'],
  });
  const profileForm = useForm<ProfileFormValues>({
    defaultValues: {
      currentPassword: '',
      displayName: owner.displayName,
      email: owner.email,
    },
    resolver: zodResolver(profileSchema),
  });
  const profileMutation = useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: ({ owner: updatedOwner }) => {
      queryClient.setQueryData<BootstrapState>(authQueryKey, (currentState) =>
        currentState
          ? {
              ...currentState,
              owner: updatedOwner,
            }
          : currentState,
      );
      profileForm.reset({
        currentPassword: '',
        displayName: updatedOwner.displayName,
        email: updatedOwner.email,
      });
      setEditingProfile(false);
    },
  });
  const form = useForm<PasswordFormValues>({
    defaultValues: {
      confirmPassword: '',
      currentPassword: '',
      newPassword: '',
    },
    resolver: zodResolver(passwordSchema),
  });
  const passwordMutation = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
  const logoutOthersMutation = useMutation({
    mutationFn: authApi.logoutOthers,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
  const logoutAllMutation = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });

  const passwordError =
    passwordMutation.error instanceof ApiError
      ? passwordMutation.error.message
      : null;
  const profileError =
    profileMutation.error instanceof ApiError
      ? profileMutation.error.message
      : null;

  const closeProfileEditor = (currentOwner: PublicOwner) => {
    profileForm.reset({
      currentPassword: '',
      displayName: currentOwner.displayName,
      email: currentOwner.email,
    });
    profileMutation.reset();
    setEditingProfile(false);
  };

  return (
    <div className="settings-page">
      <div className="page-heading">
        <div>
          <p className="page-heading__context">Owner preferences</p>
          <h1>Settings</h1>
          <p className="page-heading__description">
            Keep your account, data safety, appearance, and sign-ins under
            control.
          </p>
        </div>
      </div>

      <div className="settings-sections">
        <SettingsDisclosure
          action={
            <button
              aria-controls="owner-profile-editor"
              aria-expanded={editingProfile}
              className="button button--secondary settings-section__heading-action"
              onClick={() => {
                if (editingProfile) {
                  closeProfileEditor(owner);
                  return;
                }
                profileMutation.reset();
                profileForm.reset({
                  currentPassword: '',
                  displayName: owner.displayName,
                  email: owner.email,
                });
                setEditingProfile(true);
              }}
              type="button"
            >
              <Pencil aria-hidden="true" size={15} />
              {editingProfile ? 'Cancel' : 'Edit'}
            </button>
          }
          eyebrow="General"
          icon={<UserRound size={19} />}
          id="owner-account"
          title="Owner account"
        >
          {editingProfile ? (
            <form
              className="settings-form owner-profile-form"
              id="owner-profile-editor"
              noValidate
              onSubmit={(event) => {
                void profileForm.handleSubmit((values) =>
                  profileMutation.mutateAsync(values),
                )(event);
              }}
            >
              <div className="settings-form__columns">
                <FormField
                  autoComplete="name"
                  autoFocus
                  error={profileForm.formState.errors.displayName?.message}
                  id="owner-display-name"
                  label="Name"
                  {...profileForm.register('displayName')}
                />
                <FormField
                  autoComplete="email"
                  error={profileForm.formState.errors.email?.message}
                  id="owner-email"
                  label="Email"
                  type="email"
                  {...profileForm.register('email')}
                />
              </div>
              <FormField
                autoComplete="current-password"
                error={profileForm.formState.errors.currentPassword?.message}
                hint="Confirm account changes with your current password."
                id="owner-current-password"
                label="Current password"
                type="password"
                {...profileForm.register('currentPassword')}
              />
              {profileError ? (
                <p className="form-message form-message--error" role="alert">
                  {profileError}
                </p>
              ) : null}
              <div className="settings-actions">
                <button
                  className="button button--primary"
                  disabled={profileMutation.isPending}
                  type="submit"
                >
                  {profileMutation.isPending ? 'Saving…' : 'Save details'}
                </button>
                <button
                  className="button button--secondary"
                  disabled={profileMutation.isPending}
                  onClick={() => closeProfileEditor(owner)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <dl className="settings-details">
              <div>
                <dt>Name</dt>
                <dd>{owner.displayName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{owner.email}</dd>
              </div>
              <div>
                <dt>Current session expires</dt>
                <dd>{formatDateTime(sessionExpiresAt)}</dd>
              </div>
            </dl>
          )}
          {profileMutation.isSuccess && !editingProfile ? (
            <p className="form-message form-message--success" role="status">
              {profileMutation.data.message}
            </p>
          ) : null}
        </SettingsDisclosure>

        <RegionalPreferences />

        <SettingsDisclosure
          eyebrow="Appearance"
          icon={<Palette size={19} />}
          id="appearance"
          title="Choose what feels comfortable"
        >
          <div className="setting-row">
            <div>
              <strong>Theme</strong>
              <span>Use light, dark, or follow this device.</span>
            </div>
            <ThemeSelect />
          </div>
        </SettingsDisclosure>

        <MoneySettings />
        <Suspense
          fallback={
            <SettingsDisclosure
              eyebrow="Attachments"
              icon={<DatabaseBackup size={19} />}
              id="file-storage"
              title="File storage"
            >
              <p className="settings-muted" role="status">
                Loading storage controls…
              </p>
            </SettingsDisclosure>
          }
        >
          <StorageSettings />
        </Suspense>
        <Suspense
          fallback={
            <SettingsDisclosure
              defaultOpen={location.hash === '#backups'}
              eyebrow="Data safety"
              icon={<DatabaseBackup size={19} />}
              id="backups"
              title="Automatic backups"
            >
              <p className="settings-muted" role="status">
                Loading backup controls…
              </p>
            </SettingsDisclosure>
          }
        >
          <BackupSettings
            defaultOpen={location.hash === '#backups'}
            key={
              location.hash === '#backups' ? 'backups-open' : 'backups-closed'
            }
          />
        </Suspense>

        <Suspense
          fallback={
            <SettingsDisclosure
              eyebrow="Data"
              icon={<DatabaseBackup size={19} />}
              id="data-management"
              title="Export or delete financial data"
            >
              <p className="settings-muted" role="status">
                Loading data controls…
              </p>
            </SettingsDisclosure>
          }
        >
          <DataManagement />
        </Suspense>

        <SettingsDisclosure
          eyebrow="Security"
          icon={<KeyRound size={19} />}
          id="change-password"
          title="Change password"
        >
          <form
            className="settings-form"
            noValidate
            onSubmit={(event) => {
              void form.handleSubmit(async (values) => {
                await passwordMutation.mutateAsync({
                  currentPassword: values.currentPassword,
                  newPassword: values.newPassword,
                });
              })(event);
            }}
          >
            <FormField
              autoComplete="current-password"
              error={form.formState.errors.currentPassword?.message}
              id="current-password"
              label="Current password"
              type="password"
              {...form.register('currentPassword')}
            />
            <div className="settings-form__columns">
              <FormField
                autoComplete="new-password"
                error={form.formState.errors.newPassword?.message}
                hint="Use at least 12 characters."
                id="new-password"
                label="New password"
                type="password"
                {...form.register('newPassword')}
              />
              <FormField
                autoComplete="new-password"
                error={form.formState.errors.confirmPassword?.message}
                id="confirm-new-password"
                label="Confirm new password"
                type="password"
                {...form.register('confirmPassword')}
              />
            </div>
            {passwordError ? (
              <p className="form-message form-message--error" role="alert">
                {passwordError}
              </p>
            ) : null}
            {passwordMutation.isSuccess ? (
              <p className="form-message form-message--success" role="status">
                {passwordMutation.data.message}
              </p>
            ) : null}
            <button
              className="button button--primary"
              disabled={passwordMutation.isPending}
              type="submit"
            >
              {passwordMutation.isPending ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </SettingsDisclosure>

        <SettingsDisclosure
          eyebrow="Security"
          icon={<ShieldCheck size={19} />}
          id="active-sessions"
          title="Active sessions"
        >
          {sessionsQuery.isPending ? (
            <p className="settings-muted" role="status">
              Checking active sessions…
            </p>
          ) : sessionsQuery.isError ? (
            <p className="form-message form-message--error" role="alert">
              Active sessions could not be loaded.
            </p>
          ) : (
            <div className="session-list">
              {sessionsQuery.data.sessions.map((session) => (
                <article className="session-item" key={session.id}>
                  <span aria-hidden="true" className="session-item__icon">
                    <Laptop2 size={18} />
                  </span>
                  <div>
                    <strong>
                      {describeDevice(session.userAgent)}
                      {session.current ? (
                        <span className="current-badge">This device</span>
                      ) : null}
                    </strong>
                    <span>
                      Last active {formatDateTime(session.lastSeenAt)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
          {logoutOthersMutation.isSuccess ? (
            <p className="form-message form-message--success" role="status">
              {logoutOthersMutation.data.revokedSessionCount === 0
                ? 'There were no other sessions to sign out.'
                : `${logoutOthersMutation.data.revokedSessionCount} other session(s) signed out.`}
            </p>
          ) : null}
          <div className="settings-actions">
            <button
              className="button button--secondary"
              disabled={logoutOthersMutation.isPending}
              onClick={() => {
                logoutOthersMutation.mutate();
              }}
              type="button"
            >
              Sign out other sessions
            </button>
            <button
              className="button button--danger"
              disabled={logoutAllMutation.isPending}
              onClick={() => {
                if (
                  globalThis.confirm(
                    'Sign out every active session, including this device?',
                  )
                ) {
                  logoutAllMutation.mutate();
                }
              }}
              type="button"
            >
              <LogOut aria-hidden="true" size={16} />
              Sign out everywhere
            </button>
          </div>
        </SettingsDisclosure>
      </div>
    </div>
  );
}
