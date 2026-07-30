import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe2, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  DATE_FORMATS,
  NUMBER_FORMATS,
  supportedCurrencyCodes,
  supportedTimeZones,
  type OwnerPreferences,
} from '@bizziemoney/shared';

import { ApiError } from '../api/client';
import { FormField } from '../components/FormField';
import { SettingsDisclosure } from '../components/SettingsDisclosure';
import { preferenceApi, preferenceQueryKey } from './api';
import { usePreferences } from './context';
import { formatDateOnly } from './format';

const formSchema = z.object({
  dateFormat: z.enum(DATE_FORMATS),
  defaultCurrency: z.string().trim().length(3),
  firstDayOfWeek: z.number().int().min(0).max(6),
  numberFormat: z.enum(NUMBER_FORMATS),
  timeZone: z.string().trim().min(1),
});

type FormValues = z.infer<typeof formSchema>;

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function formValues(preferences: OwnerPreferences): FormValues {
  return {
    dateFormat: preferences.dateFormat,
    defaultCurrency: preferences.defaultCurrency,
    firstDayOfWeek: preferences.firstDayOfWeek,
    numberFormat: preferences.numberFormat,
    timeZone: preferences.timeZone,
  };
}

export function RegionalPreferences() {
  const queryClient = useQueryClient();
  const { formatDateTime, preferences } = usePreferences();
  const [editing, setEditing] = useState(false);
  const form = useForm<FormValues>({
    defaultValues: formValues(preferences),
    resolver: zodResolver(formSchema),
  });
  const watched = useWatch({ control: form.control });
  const preview = useMemo(() => {
    const numberFormat = watched.numberFormat ?? preferences.numberFormat;
    const dateFormat = watched.dateFormat ?? preferences.dateFormat;
    const currency =
      watched.defaultCurrency?.toLocaleUpperCase('en-US') ||
      preferences.defaultCurrency;
    const locale =
      numberFormat === '1.234,56'
        ? 'de-DE'
        : numberFormat === '1 234,56'
          ? 'fr-FR'
          : 'en-US';
    const money = (() => {
      try {
        return new Intl.NumberFormat(locale, {
          currency,
          style: 'currency',
        }).format(1234.56);
      } catch {
        return 'Choose a currency';
      }
    })();
    return {
      date: formatDateOnly('2026-07-28', dateFormat),
      money,
    };
  }, [
    preferences.dateFormat,
    preferences.defaultCurrency,
    preferences.numberFormat,
    watched.dateFormat,
    watched.defaultCurrency,
    watched.numberFormat,
  ]);
  const currencyCodes = useMemo(() => supportedCurrencyCodes(), []);
  const timeZones = useMemo(() => supportedTimeZones(), []);
  const orderedWeekdays = useMemo(
    () =>
      weekdays.map((_, offset) => {
        const value =
          ((watched.firstDayOfWeek ?? preferences.firstDayOfWeek) + offset) %
          weekdays.length;
        return { label: weekdays[value], value };
      }),
    [preferences.firstDayOfWeek, watched.firstDayOfWeek],
  );

  const mutation = useMutation({
    mutationFn: preferenceApi.update,
    onSuccess: async (saved) => {
      queryClient.setQueryData(preferenceQueryKey, saved);
      form.reset(formValues(saved));
      setEditing(false);
      await Promise.all(
        [
          ['expense-summary'],
          ['debt-summary'],
          ['subscription-upcoming'],
          ['debt-upcoming'],
          ['backup-status'],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  const closeEditor = () => {
    form.reset(formValues(preferences));
    mutation.reset();
    setEditing(false);
  };
  const error =
    mutation.error instanceof ApiError ? mutation.error.message : null;

  return (
    <SettingsDisclosure
      action={
        <button
          aria-controls="regional-preferences-editor"
          aria-expanded={editing}
          className="button button--secondary settings-section__heading-action"
          onClick={() => {
            if (editing) {
              closeEditor();
              return;
            }
            form.reset(formValues(preferences));
            mutation.reset();
            setEditing(true);
          }}
          type="button"
        >
          <Pencil aria-hidden="true" size={15} />
          {editing ? 'Cancel' : 'Edit'}
        </button>
      }
      eyebrow="General"
      icon={<Globe2 size={19} />}
      id="regional-preferences"
      title="Regional preferences"
    >
      {editing ? (
        <form
          className="settings-form regional-preferences-form"
          id="regional-preferences-editor"
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit((values) =>
              mutation.mutateAsync({
                ...values,
                defaultCurrency:
                  values.defaultCurrency.toLocaleUpperCase('en-US'),
              }),
            )(event);
          }}
        >
          <div className="settings-form__columns">
            <FormField
              autoComplete="off"
              error={form.formState.errors.defaultCurrency?.message}
              id="default-currency"
              label="Default currency"
              list="currency-code-options"
              {...form.register('defaultCurrency')}
            />
            <FormField
              autoComplete="off"
              error={form.formState.errors.timeZone?.message}
              id="time-zone"
              label="Time zone"
              list="time-zone-options"
              {...form.register('timeZone')}
            />
          </div>
          <datalist id="currency-code-options">
            {currencyCodes.map((currency) => (
              <option key={currency} value={currency} />
            ))}
          </datalist>
          <datalist id="time-zone-options">
            {timeZones.map((timeZone) => (
              <option key={timeZone} value={timeZone} />
            ))}
          </datalist>
          <div className="settings-form__columns settings-form__columns--three">
            <label className="form-field" htmlFor="number-format">
              <span>Number format</span>
              <select id="number-format" {...form.register('numberFormat')}>
                {NUMBER_FORMATS.map((numberFormat) => (
                  <option key={numberFormat} value={numberFormat}>
                    {numberFormat}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field" htmlFor="date-format">
              <span>Date format</span>
              <select id="date-format" {...form.register('dateFormat')}>
                {DATE_FORMATS.map((dateFormat) => (
                  <option key={dateFormat} value={dateFormat}>
                    {dateFormat}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field" htmlFor="first-day-of-week">
              <span>First day of week</span>
              <select
                id="first-day-of-week"
                {...form.register('firstDayOfWeek', { valueAsNumber: true })}
              >
                {orderedWeekdays.map((weekday) => (
                  <option key={weekday.value} value={weekday.value}>
                    {weekday.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="preference-preview" aria-live="polite">
            <span>Preview</span>
            <strong data-testid="number-format-preview">{preview.money}</strong>
            <strong data-testid="date-format-preview">{preview.date}</strong>
          </div>
          {error ? (
            <p className="form-message form-message--error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="settings-actions">
            <button
              className="button button--primary"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? 'Saving…' : 'Save preferences'}
            </button>
            <button
              className="button button--secondary"
              disabled={mutation.isPending}
              onClick={closeEditor}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="settings-details">
          <div>
            <dt>Default currency</dt>
            <dd>{preferences.defaultCurrency}</dd>
          </div>
          <div>
            <dt>Number and date</dt>
            <dd>
              {preferences.numberFormat} · {preferences.dateFormat}
            </dd>
          </div>
          <div>
            <dt>Week starts</dt>
            <dd>{weekdays[preferences.firstDayOfWeek]}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{preferences.timeZone}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDateTime(preferences.updatedAt)}</dd>
          </div>
        </dl>
      )}
      {mutation.isSuccess && !editing ? (
        <p className="form-message form-message--success" role="status">
          Regional preferences updated.
        </p>
      ) : null}
    </SettingsDisclosure>
  );
}
