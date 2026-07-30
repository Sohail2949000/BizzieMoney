import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, authApi } from '../api/client';
import { authQueryKey } from '../auth/auth';
import { AuthLayout } from '../components/AuthLayout';
import { FormField } from '../components/FormField';

const loginSchema = z.object({
  email: z.string().trim().email('Enter your owner email.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const queryClient = useQueryClient();
  const form = useForm<LoginFormValues>({
    defaultValues: { email: '', password: '' },
    resolver: zodResolver(loginSchema),
  });
  const loginMutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authQueryKey });
    },
  });
  const mutationError =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : null;

  return (
    <AuthLayout
      description="Your financial data stays behind one owner account and an expiring secure session."
      eyebrow="Welcome back"
      title="Your money is ready when you are."
    >
      <div className="auth-card__heading">
        <p>Owner sign in</p>
        <h2>Open BizzieMoney</h2>
        <span>There is no public registration or password sharing.</span>
      </div>
      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(async (values) => {
            await loginMutation.mutateAsync(values);
          })(event);
        }}
      >
        <FormField
          autoComplete="email"
          error={form.formState.errors.email?.message}
          id="login-email"
          inputMode="email"
          label="Email"
          type="email"
          {...form.register('email')}
        />
        <FormField
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          id="login-password"
          label="Password"
          type="password"
          {...form.register('password')}
        />
        {mutationError ? (
          <p className="form-message form-message--error" role="alert">
            {mutationError}
          </p>
        ) : null}
        <button
          className="button button--primary auth-form__submit"
          disabled={loginMutation.isPending}
          type="submit"
        >
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
