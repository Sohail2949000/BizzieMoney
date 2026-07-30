import { apiRequest } from './client';

export interface FinancialPurgeResult {
  attachmentFilesQueued: number;
  attachments: number;
  completedAt: string;
  debtPayments: number;
  debts: number;
  expenses: number;
  replayed: boolean;
  subscriptionPayments: number;
  subscriptions: number;
  tags: number;
}

export const financialDataApi = {
  exportPortable: () =>
    apiRequest<Blob>('/api/data/export', { responseType: 'blob' }),
  purge: (
    input: { confirmation: string; currentPassword: string },
    idempotencyKey: string,
  ) =>
    apiRequest<FinancialPurgeResult>('/api/data/purge', {
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      method: 'POST',
    }),
};
