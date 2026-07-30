import { describe, expect, it } from 'vitest';

import { SecretBox } from './secrets';

describe('SecretBox', () => {
  it('seals secrets with authenticated encryption', () => {
    const box = new SecretBox('a'.repeat(64));
    const sealed = box.seal('private backup credential');

    expect(sealed).not.toContain('private backup credential');
    expect(box.open(sealed)).toBe('private backup credential');
    expect(() => new SecretBox('b'.repeat(64)).open(sealed)).toThrow(
      'BACKUP_SECRET_INVALID',
    );
  });
});
