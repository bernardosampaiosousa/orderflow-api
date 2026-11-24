import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const BASE = {
  DB_HOST: '127.0.0.1', DB_USER: 'example', DB_PASSWORD: 'safe-local-password',
  DB_NAME: 'orderflow', JWT_SECRET: 'a-random-example-value-over-32-characters',
};

describe('configuration safety', () => {
  it('uses safe defaults for ordinary development settings', () => {
    const config = loadConfig(BASE);
    expect(config.PORT).toBe(3000);
    expect(config.DB_PORT).toBe(3306);
  });

  it('rejects the sample JWT secret', () => {
    expect(() => loadConfig({ ...BASE, JWT_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow();
  });

  it('rejects the sample database password in production', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production', DB_PASSWORD: 'change-me-locally' })).toThrow();
  });
});
