import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

// Stores a salted password hash; the original password never goes into MySQL.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

// Recomputes the login hash and compares it in constant time.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [method, salt, hex] = stored.split(':');
  if (method !== 'scrypt' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return timingSafeEqual(actual, expected);
}
