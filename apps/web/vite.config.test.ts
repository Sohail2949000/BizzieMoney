import { describe, expect, it } from 'vitest';

import { parseAllowedHosts } from './vite.config';

describe('Vite allowed hosts', () => {
  it('normalizes and deduplicates exact hostnames', () => {
    expect(
      parseAllowedHosts(
        'money.example.com, MONEY.EXAMPLE.COM,preview.example.com',
      ),
    ).toEqual(['money.example.com', 'preview.example.com']);
  });

  it.each([
    '*',
    '.example.com',
    'https://money.example.com',
    'money.example.com/path',
    'money.example.com:5173',
  ])('rejects a non-exact host value %s', (host) => {
    expect(() => parseAllowedHosts(host)).toThrow();
  });
});
