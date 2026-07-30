import { describe, expect, it } from 'vitest';

import { cx } from './index';

describe('cx', () => {
  it('joins only usable class names', () => {
    expect(cx('panel', false, undefined, 'panel--active')).toBe(
      'panel panel--active',
    );
  });
});
