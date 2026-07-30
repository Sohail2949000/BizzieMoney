// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentUploadError } from '../api/attachments';
import type * as AttachmentApiModule from '../api/attachments';
import type {
  Expense,
  ExpenseOptions,
  ExpenseWriteInput,
} from '../api/expenses';
import { ExpenseFormDialog } from './ExpenseFormDialog';

const apiMocks = vi.hoisted(() => ({
  create: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
}));
const preferenceMocks = vi.hoisted(() => ({
  todayDate: () => '2026-07-29',
}));

vi.mock('../api/expenses', () => ({
  expenseApi: {
    create: apiMocks.create,
    delete: apiMocks.delete,
    update: apiMocks.update,
  },
}));

vi.mock('../api/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof AttachmentApiModule>();
  return {
    ...actual,
    uploadExpenseAttachment: apiMocks.upload,
  };
});

vi.mock('../preferences/context', () => ({
  usePreferences: () => ({
    todayDate: preferenceMocks.todayDate,
  }),
}));

vi.mock('./AttachmentPanel', () => {
  return {
    AttachmentPanel: ({
      onQueueChange,
      queued,
    }: {
      onQueueChange: (
        queued: Array<{
          error: string | null;
          file: File;
          id: string;
          idempotencyKey: string;
          progress: number;
          status: 'queued';
        }>,
      ) => void;
      queued: Array<{ id: string }>;
    }) => (
      <div>
        <button
          onClick={() =>
            onQueueChange([
              {
                error: null,
                file: new File(['not-an-image'], 'receipt.png', {
                  type: 'image/png',
                }),
                id: 'queued-attachment',
                idempotencyKey: 'attachment-key',
                progress: 0,
                status: 'queued',
              },
            ])
          }
          type="button"
        >
          Queue test attachment
        </button>
        <span>Queued attachments: {queued.length}</span>
      </div>
    ),
  };
});

const options: ExpenseOptions = {
  categories: [
    {
      archived: false,
      color: '#777777',
      icon: 'Receipt',
      id: 'category-id',
      name: 'Other',
    },
  ],
  paymentMethods: [
    {
      archived: false,
      icon: 'Circle Ellipsis',
      id: 'payment-method-id',
      name: 'Other',
    },
  ],
};

function expense(id: string): Expense {
  return {
    amount: '0.01',
    attachmentCount: 0,
    category: options.categories[0]!,
    createdAt: '2026-07-29T12:00:00.000Z',
    currencyCode: 'SAR',
    date: '2026-07-29',
    description: 'R2 upload test',
    id,
    merchant: null,
    notes: null,
    paymentMethod: options.paymentMethods[0]!,
    tags: [],
    updatedAt: '2026-07-29T12:00:00.000Z',
  };
}

function renderDialog(onClose = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ExpenseFormDialog
        expense={null}
        mode="create"
        onClose={onClose}
        open
        options={options}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

async function submitExpense() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Queue test attachment' }),
  );
  await screen.findByText('Queued attachments: 1');
  const amount = screen.getByLabelText<HTMLInputElement>('Amount');
  const description = screen.getByLabelText<HTMLInputElement>('Description');
  const date = screen.getByLabelText<HTMLInputElement>('Date');
  fireEvent.change(amount, {
    target: { value: '0.01' },
  });
  fireEvent.change(description, {
    target: { value: 'R2 upload test' },
  });
  fireEvent.change(date, {
    target: { value: '2026-07-29' },
  });
  expect(amount.value).toBe('0.01');
  expect(description.value).toBe('R2 upload test');
  const submit = screen.getByRole('button', { name: 'Save expense' });
  fireEvent.submit(submit.closest('form')!);
}

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

describe('ExpenseFormDialog', () => {
  it('rolls back a newly created expense when its attachment upload fails', async () => {
    apiMocks.create.mockResolvedValue(expense('expense-1'));
    apiMocks.delete.mockResolvedValue(undefined);
    apiMocks.upload.mockRejectedValue(
      new AttachmentUploadError(
        'The file extension does not match its contents.',
        'ATTACHMENT_TYPE_MISMATCH',
      ),
    );
    const { onClose } = renderDialog();

    await submitExpense();

    await waitFor(() => expect(apiMocks.create).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(apiMocks.delete).toHaveBeenCalledWith('expense-1'),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/The file extension does not match its contents/),
    ).toBeInTheDocument();
  });

  it('uses a new create idempotency key when retrying after rollback', async () => {
    apiMocks.create
      .mockResolvedValueOnce(expense('expense-1'))
      .mockResolvedValueOnce(expense('expense-2'));
    apiMocks.delete.mockResolvedValue(undefined);
    apiMocks.upload
      .mockRejectedValueOnce(
        new AttachmentUploadError(
          'The file extension does not match its contents.',
          'ATTACHMENT_TYPE_MISMATCH',
        ),
      )
      .mockResolvedValueOnce({
        checksumSha256: 'checksum',
        createdAt: '2026-07-29T12:00:00.000Z',
        displayName: 'receipt.png',
        id: 'attachment-1',
        mimeType: 'image/png',
        previewSupported: true,
        sizeBytes: 12,
        thumbnailAvailable: true,
        updatedAt: '2026-07-29T12:00:00.000Z',
      });
    const { onClose } = renderDialog();

    await submitExpense();
    await waitFor(() => expect(apiMocks.create).toHaveBeenCalledOnce());
    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(apiMocks.create).toHaveBeenCalledTimes(2);
    const firstInput = apiMocks.create.mock.calls[0] as [
      ExpenseWriteInput,
      string,
    ];
    const secondInput = apiMocks.create.mock.calls[1] as [
      ExpenseWriteInput,
      string,
    ];
    expect(secondInput[1]).not.toBe(firstInput[1]);
    expect(apiMocks.upload).toHaveBeenCalledTimes(2);
  });
});
