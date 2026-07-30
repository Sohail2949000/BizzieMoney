import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  FolderCog,
  Plus,
  Save,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { useState } from 'react';

import { expenseApi, type MoneyOption } from '../api/expenses';
import { ApiError } from '../api/client';
import { SettingsDisclosure } from '../components/SettingsDisclosure';
import { CategoryDeletionDialog } from './CategoryDeletionDialog';
import { expenseIconNames } from './iconNames';
import { ExpenseOptionIcon } from './icons';

function iconLabel(name: string): string {
  return name
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function OptionRow({
  kind,
  onDelete,
  onSave,
  option,
}: {
  kind: 'category' | 'payment';
  onDelete?: (option: MoneyOption) => void;
  onSave: (
    optionId: string,
    input: Partial<{
      archived: boolean;
      color: string;
      icon: string;
      name: string;
    }>,
  ) => Promise<unknown>;
  option: MoneyOption;
}) {
  const [name, setName] = useState(option.name);
  const [icon, setIcon] = useState(option.icon);
  const [color, setColor] = useState(option.color ?? '#71717A');
  const [saving, setSaving] = useState(false);

  const save = async (
    override: Partial<{
      archived: boolean;
      color: string;
      icon: string;
      name: string;
    }> = {},
  ) => {
    setSaving(true);
    try {
      await onSave(option.id, {
        ...(kind === 'category' ? { color } : {}),
        icon,
        name,
        ...override,
      });
    } catch {
      // The React Query mutation exposes the user-facing error below.
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`money-option${option.archived ? ' is-archived' : ''}`}>
      <span
        aria-hidden="true"
        className="money-option__icon"
        style={kind === 'category' ? { color } : undefined}
      >
        <ExpenseOptionIcon name={icon} />
      </span>
      <div className="money-option__fields">
        <label>
          <span className="sr-only">{option.name} name</span>
          <input
            aria-label={`${option.name} name`}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          <span className="sr-only">{option.name} icon</span>
          <select
            aria-label={`${option.name} icon`}
            onChange={(event) => setIcon(event.target.value)}
            value={icon}
          >
            {expenseIconNames.map((iconName) => (
              <option key={iconName} value={iconName}>
                {iconLabel(iconName)}
              </option>
            ))}
          </select>
        </label>
        {kind === 'category' ? (
          <label className="money-option__color">
            <span className="sr-only">{option.name} color</span>
            <input
              aria-label={`${option.name} color`}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
              type="color"
              value={color}
            />
          </label>
        ) : null}
      </div>
      <div className="money-option__actions">
        <button
          aria-label={`Save ${option.name}`}
          disabled={saving || !name.trim()}
          onClick={() => void save()}
          title="Save changes"
          type="button"
        >
          <Save aria-hidden="true" size={16} />
        </button>
        <button
          aria-label={
            option.archived
              ? `Restore ${option.name}`
              : `Archive ${option.name}`
          }
          disabled={saving}
          onClick={() => void save({ archived: !option.archived })}
          title={option.archived ? 'Restore' : 'Archive'}
          type="button"
        >
          <Archive aria-hidden="true" size={16} />
        </button>
        {kind === 'category' && onDelete ? (
          <button
            aria-label={`Delete ${option.name}`}
            disabled={saving}
            onClick={() => onDelete(option)}
            title="Delete and reassign"
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function NewOptionForm({
  kind,
  onCreate,
}: {
  kind: 'category' | 'payment';
  onCreate: (input: {
    color: string;
    icon: string;
    name: string;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(
    kind === 'category' ? 'circle-ellipsis' : 'wallet-cards',
  );
  const [color, setColor] = useState('#635BFF');
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="new-money-option"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        void onCreate({ color, icon, name: name.trim() })
          .then(() => setName(''))
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }}
    >
      <label>
        <span className="sr-only">New {kind} name</span>
        <input
          aria-label={`New ${kind} name`}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={kind === 'category' ? 'New category' : 'New method'}
          value={name}
        />
      </label>
      <label>
        <span className="sr-only">New {kind} icon</span>
        <select
          aria-label={`New ${kind} icon`}
          onChange={(event) => setIcon(event.target.value)}
          value={icon}
        >
          {expenseIconNames.map((iconName) => (
            <option key={iconName} value={iconName}>
              {iconLabel(iconName)}
            </option>
          ))}
        </select>
      </label>
      {kind === 'category' ? (
        <label className="money-option__color">
          <span className="sr-only">New category color</span>
          <input
            aria-label="New category color"
            onChange={(event) => setColor(event.target.value.toUpperCase())}
            type="color"
            value={color}
          />
        </label>
      ) : null}
      <button
        className="button button--secondary"
        disabled={saving || !name.trim()}
        type="submit"
      >
        <Plus aria-hidden="true" size={16} />
        Add
      </button>
    </form>
  );
}

export function MoneySettings() {
  const queryClient = useQueryClient();
  const [categoryToDelete, setCategoryToDelete] = useState<MoneyOption | null>(
    null,
  );
  const [categoryDeletionMessage, setCategoryDeletionMessage] = useState<
    string | null
  >(null);
  const optionsQuery = useQuery({
    queryFn: () => expenseApi.getOptions(true),
    queryKey: ['expense-options', 'all'],
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['expense-options'] });
  const categoryCreate = useMutation({
    mutationFn: expenseApi.createCategory,
    onSuccess: refresh,
  });
  const categoryUpdate = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof expenseApi.updateCategory>[1];
    }) => expenseApi.updateCategory(id, input),
    onSuccess: refresh,
  });
  const paymentCreate = useMutation({
    mutationFn: ({ icon, name }: { icon: string; name: string }) =>
      expenseApi.createPaymentMethod({ icon, name }),
    onSuccess: refresh,
  });
  const paymentUpdate = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Parameters<typeof expenseApi.updatePaymentMethod>[1];
    }) => expenseApi.updatePaymentMethod(id, input),
    onSuccess: refresh,
  });
  const error =
    [
      categoryCreate.error,
      categoryUpdate.error,
      paymentCreate.error,
      paymentUpdate.error,
    ].find((value) => value instanceof ApiError) ?? null;

  if (optionsQuery.isPending) {
    return (
      <p className="settings-muted" role="status">
        Loading spending preferences…
      </p>
    );
  }
  if (optionsQuery.isError) {
    return (
      <p className="form-message form-message--error" role="alert">
        Categories and payment methods could not be loaded.
      </p>
    );
  }

  return (
    <>
      <SettingsDisclosure
        eyebrow="Expenses"
        icon={<FolderCog size={19} />}
        id="categories"
        title="Categories"
      >
        <p className="settings-muted">
          Archived categories stay on existing expenses but cannot be selected
          for new ones. Deleting a category requires moving every expense and
          subscription to an active replacement.
        </p>
        {categoryDeletionMessage ? (
          <p className="form-message form-message--success" role="status">
            {categoryDeletionMessage}
          </p>
        ) : null}
        <div className="money-option-list">
          {optionsQuery.data.categories.map((option) => (
            <OptionRow
              kind="category"
              key={option.id}
              onDelete={(selected) => {
                setCategoryDeletionMessage(null);
                setCategoryToDelete(selected);
              }}
              onSave={(id, input) => categoryUpdate.mutateAsync({ id, input })}
              option={option}
            />
          ))}
        </div>
        <NewOptionForm
          kind="category"
          onCreate={(input) => categoryCreate.mutateAsync(input)}
        />
      </SettingsDisclosure>

      <SettingsDisclosure
        eyebrow="Expenses"
        icon={<WalletCards size={19} />}
        id="payment-methods"
        title="Payment methods"
      >
        <div className="money-option-list">
          {optionsQuery.data.paymentMethods.map((option) => (
            <OptionRow
              kind="payment"
              key={option.id}
              onSave={(id, input) => paymentUpdate.mutateAsync({ id, input })}
              option={option}
            />
          ))}
        </div>
        <NewOptionForm
          kind="payment"
          onCreate={(input) => paymentCreate.mutateAsync(input)}
        />
      </SettingsDisclosure>

      {error instanceof ApiError ? (
        <p className="form-message form-message--error" role="alert">
          {error.message}
        </p>
      ) : null}
      <CategoryDeletionDialog
        category={categoryToDelete}
        onClose={() => setCategoryToDelete(null)}
        onDeleted={(result) => {
          setCategoryDeletionMessage(
            `${categoryToDelete?.name ?? 'Category'} deleted. ${result.expenseCount} expense${result.expenseCount === 1 ? '' : 's'} and ${result.subscriptionCount} subscription${result.subscriptionCount === 1 ? '' : 's'} moved to ${result.replacement.name}.`,
          );
          setCategoryToDelete(null);
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['expense-options'] }),
            queryClient.invalidateQueries({ queryKey: ['expenses'] }),
            queryClient.invalidateQueries({ queryKey: ['expense-summary'] }),
            queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
            queryClient.invalidateQueries({
              queryKey: ['subscription-upcoming'],
            }),
            queryClient.invalidateQueries({
              queryKey: ['subscription-reminders'],
            }),
          ]);
        }}
      />
    </>
  );
}
