import type { InputHTMLAttributes } from 'react';

export function FormField({
  error,
  hint,
  label,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & {
  error?: string | undefined;
  hint?: string | undefined;
  label: string;
}) {
  const errorId = error ? `${inputProps.id}-error` : undefined;
  const hintId = hint ? `${inputProps.id}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <label className="form-field" htmlFor={inputProps.id}>
      <span className="form-field__label">{label}</span>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className="form-field__input"
      />
      {hint ? (
        <span className="form-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="form-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
