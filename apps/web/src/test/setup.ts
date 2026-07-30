import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
    globalThis.localStorage?.clear();
    document.documentElement.dataset.theme = 'system';
  }
});
