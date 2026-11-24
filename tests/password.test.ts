import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password.js';

describe('password hashing', () => {
  it('does not store plaintext and uses unique salts', async () => {
    const first = await hashPassword('A-safe-password-123!');
    const second = await hashPassword('A-safe-password-123!');
    expect(first).not.toContain('A-safe-password');
    expect(first).not.toBe(second);
    expect(await verifyPassword('A-safe-password-123!', first)).toBe(true);
    expect(await verifyPassword('A-wrong-password-123!', first)).toBe(false);
  });

  it('rejects invalid stored hashes', async () => {
    expect(await verifyPassword('anything', 'bad:hash')).toBe(false);
  });
});
