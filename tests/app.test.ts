import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Pool } from 'mysql2/promise';
import { createApp } from '../src/app.js';
import { issueToken } from '../src/lib/token.js';

const SECRET = 'another-very-long-test-secret-with-no-real-value';
const ID = 'c62cf147-1959-4233-a8ef-6b860c46428f';

function fakeDatabase(): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return [[{ total: 0 }], []];
      if (sql.includes('FROM products')) return [[], []];
      return [[], []];
    }),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes('FROM users')) {
        return [[{ id: ID, name: 'Bernardo', email: 'bernardo@example.com', role: 'CUSTOMER' }], []];
      }
      return [[], []];
    }),
  } as unknown as Pool;
}

describe('HTTP API', () => {
  it('returns an operational health response', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a paginated public product list', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET)).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], meta: { page: 1, limit: 20, total: 0 } });
  });

  it('validates pagination at the HTTP boundary', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET)).get('/api/products?limit=1000');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication to place orders', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET)).post('/api/orders').send({ items: [] });
    expect(res.status).toBe(401);
  });

  it('prevents regular users from managing products', async () => {
    const token = await issueToken({ id: ID, role: 'CUSTOMER' }, SECRET);
    const res = await request(createApp(fakeDatabase(), SECRET))
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ sku: 'SKU-1', name: 'Product', stock: 10, priceCents: 500 });
    expect(res.status).toBe(403);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET)).get('/not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns a safe 400 for malformed JSON', async () => {
    const res = await request(createApp(fakeDatabase(), SECRET))
      .post('/api/auth/register')
      .set('Content-Type', 'application/json')
      .send('{ not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
