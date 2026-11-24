import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import { issueToken, readToken } from '../src/lib/token.js';

const SECRET = 'a-very-long-fake-secret-for-unit-tests-only';
const ID = 'c62cf147-1959-4233-a8ef-6b860c46428f';

describe('authentication tokens', () => {
  it('round trips a signed identity', async () => {
    const token = await issueToken({ id: ID, role: 'CUSTOMER' }, SECRET);
    expect(await readToken(token, SECRET)).toEqual({ id: ID, role: 'CUSTOMER' });
  });

  it('rejects tampered tokens and the wrong secret', async () => {
    const token = await issueToken({ id: ID, role: 'ADMIN' }, SECRET);
    await expect(readToken(token, 'a-different-secret-that-is-also-long')).rejects.toBeInstanceOf(HttpError);
    const parts = token.split('.');
    parts[1] = parts[1]!.slice(0, -2) + 'xx';
    await expect(readToken(parts.join('.'), SECRET)).rejects.toBeInstanceOf(HttpError);
  });
});
