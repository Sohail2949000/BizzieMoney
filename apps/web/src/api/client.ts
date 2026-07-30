export interface PublicOwner {
  displayName: string;
  email: string;
  id: string;
}

export interface BootstrapState {
  authenticated: boolean;
  owner: PublicOwner | null;
  sessionExpiresAt: string | null;
  setupRequired: boolean;
}

export interface SessionSummary {
  createdAt: string;
  current: boolean;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  userAgent: string;
}

interface ApiErrorPayload {
  error?: {
    code?: string;
    fields?: Record<string, string>;
    message?: string;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(response: Response, payload: ApiErrorPayload) {
    super(
      payload.error?.message ??
        'BizzieMoney could not complete that request. Try again.',
    );
    this.name = 'ApiError';
    this.code = payload.error?.code ?? 'UNKNOWN_ERROR';
    this.fields = payload.error?.fields ?? {};
    this.requestId = payload.error?.requestId;
    this.status = response.status;
  }
}

const configuredApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const API_BASE_URL = configuredApiUrl?.replace(/\/$/, '') ?? '';

function readCookie(name: string): string | undefined {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export function csrfToken(): string | undefined {
  return readCookie('bm_csrf');
}

export async function apiRequest<T>(
  path: string,
  {
    body,
    headers: customHeaders,
    method = 'GET',
    responseType = 'json',
  }: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
    responseType?: 'blob' | 'json';
  } = {},
): Promise<T> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(customHeaders ?? {})) {
    headers.set(name, value);
  }
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  if (method !== 'GET') {
    const csrfToken = readCookie('bm_csrf');
    if (csrfToken) {
      headers.set('x-bm-csrf', csrfToken);
    }
  }

  const requestInit: RequestInit = {
    credentials: 'include',
    headers,
    method,
  };
  if (body !== undefined) {
    requestInit.body = JSON.stringify(body);
  }

  const response = await fetch(apiUrl(path), requestInit);

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => ({}))) as ApiErrorPayload;
    throw new ApiError(response, payload);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  if (responseType === 'blob') {
    return (await response.blob()) as T;
  }
  return (await response.json()) as T;
}

export const authApi = {
  bootstrap: () => apiRequest<BootstrapState>('/api/auth/bootstrap'),
  changePassword: (input: { currentPassword: string; newPassword: string }) =>
    apiRequest<{ message: string }>('/api/auth/change-password', {
      body: input,
      method: 'POST',
    }),
  listSessions: () =>
    apiRequest<{ sessions: SessionSummary[] }>('/api/auth/sessions'),
  login: (input: { email: string; password: string }) =>
    apiRequest<{ owner: PublicOwner; sessionExpiresAt: string }>(
      '/api/auth/login',
      { body: input, method: 'POST' },
    ),
  logout: () =>
    apiRequest<void>('/api/auth/logout', {
      method: 'POST',
    }),
  logoutAll: () =>
    apiRequest<void>('/api/auth/logout-all', {
      method: 'POST',
    }),
  logoutOthers: () =>
    apiRequest<{ revokedSessionCount: number }>('/api/auth/logout-others', {
      method: 'POST',
    }),
  setup: (input: { displayName: string; email: string; password: string }) =>
    apiRequest<{ owner: PublicOwner; sessionExpiresAt: string }>(
      '/api/auth/setup',
      { body: input, method: 'POST' },
    ),
  updateProfile: (input: {
    currentPassword: string;
    displayName: string;
    email: string;
  }) =>
    apiRequest<{ message: string; owner: PublicOwner }>('/api/auth/profile', {
      body: input,
      method: 'PATCH',
    }),
};
