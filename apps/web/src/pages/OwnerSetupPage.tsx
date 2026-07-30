import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, authApi } from '../api/client';
import { authQueryKey } from '../auth/auth';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

const setupSchema = z
  .object({
    confirmPassword: z.string(),
    displayName: z
      .string()
      .trim()
      .min(2, 'Enter at least 2 characters.')
      .max(80),
    email: z.string().trim().email('Enter a valid email address.').max(254),
    password: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use no more than 128 characters.'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'The passwords do not match.',
    path: ['confirmPassword'],
  });

type SetupFormValues = z.infer<typeof setupSchema>;

export function OwnerSetupPage() {
  const queryClient = useQueryClient();
  const form = useForm<SetupFormValues>({
    defaultValues: {
      confirmPassword: '',
      displayName: '',
      email: '',
      password: '',
    },
    resolver: zodResolver(setupSchema),
  });
  const setupMutation = useMutation({
    mutationFn: authApi.setup,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });

  const mutationError =
    setupMutation.error instanceof ApiError
      ? setupMutation.error.message
      : null;

  return (
    <AuthLayout
      description="This account is the only way into BizzieMoney. There is no public sign-up and no default password."
      eyebrow="First-time setup"
      title="Create your private owner account."
    >
      <div className="auth-card__heading">
        <p>One secure step</p>
        <h2>Owner details</h2>
        <span>Use an email you will remember and a unique password.</span>
      </div>
      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(async (values) => {
            await setupMutation.mutateAsync({
              displayName: values.displayName,
              email: values.email,
              password: values.password,
            });
          })(event);
        }}
      >
        <FormField
          autoComplete="name"
          error={form.formState.errors.displayName?.message}
          id="setup-name"
          label="Your name"
          placeholder="How BizzieMoney should greet you"
          {...form.register('displayName')}
        />
        <FormField
          autoComplete="email"
          error={form.formState.errors.email?.message}
          id="setup-email"
          inputMode="email"
          label="Email"
          placeholder="you@example.com"
          type="email"
          {...form.register('email')}
        />
        <FormField
          autoComplete="new-password"
          error={form.formState.errors.password?.message}
          hint="At least 12 characters. A password manager is recommended."
          id="setup-password"
          label="Password"
          type="password"
          {...form.register('password')}
        />
        <FormField
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          id="setup-confirm-password"
          label="Confirm password"
          type="password"
          {...form.register('confirmPassword')}
        />
        {mutationError ? (
          <p className="form-message form-message--error" role="alert">
            {mutationError}
          </p>
        ) : null}
        <button
          className="button button--primary auth-form__submit"
          disabled={setupMutation.isPending}
          type="submit"
        >
          {setupMutation.isPending
            ? 'Creating your account…'
            : 'Create owner account'}
        </button>
      </form>
    </AuthLayout>
  );
}
