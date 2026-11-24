import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { HttpError } from '../src/lib/errors.js';
import { cancelOrder, createOrder } from '../src/services/orders.js';

const USER_ID = '82fa8c44-62a8-478a-b291-8439f5b83554';
const OTHER_USER = '8bfd05e6-f3a6-4a4d-b5ca-e1be3fdf8c51';
const PRODUCT_ID = 'b503e6ca-4d56-4786-aa5e-f1cbab4b8bea';
const ORDER_ID = '470c978d-a6e0-4b48-afc8-c80c0f7d2fc7';

function mockTransaction(options: { stock?: number; orderStatus?: string; owner?: string; updateCount?: number } = {}) {
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM products')) return [[{
        id: PRODUCT_ID, active: 1, priceCents: 500, stock: options.stock ?? 10,
      }], []];
      return [[], []];
    }),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes('FROM orders')) return [[{
        id: ORDER_ID, userId: options.owner ?? USER_ID, status: options.orderStatus ?? 'PLACED',
      }], []];
      if (sql.includes('FROM order_items')) return [[{ productId: PRODUCT_ID, quantity: 2 }], []];
      if (sql.startsWith('UPDATE products')) return [{ affectedRows: options.updateCount ?? 1 }, []];
      return [{ affectedRows: 1 }, []];
    }),
  };
  const pool = { getConnection: vi.fn(async () => connection as unknown as PoolConnection) } as unknown as Pool;
  return { connection, pool };
}

describe('transactional order workflows', () => {
  it('atomically inserts an order, reserves inventory and commits', async () => {
    const { connection, pool } = mockTransaction();
    const result = await createOrder(pool, USER_ID, [{ productId: PRODUCT_ID, quantity: 2 }]);
    expect(result.totalCents).toBe(1000);
    expect(result.items[0]?.unitPriceCents).toBe(500);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE products'))).toBe(true);
  });

  it('rolls back without inserts when stock is insufficient', async () => {
    const { connection, pool } = mockTransaction({ stock: 1 });
    await expect(createOrder(pool, USER_ID, [{ productId: PRODUCT_ID, quantity: 2 }]))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('rolls back when a conditional stock update fails', async () => {
    const { connection, pool } = mockTransaction({ updateCount: 0 });
    await expect(createOrder(pool, USER_ID, [{ productId: PRODUCT_ID, quantity: 2 }]))
      .rejects.toBeInstanceOf(HttpError);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('restocks exactly once when cancelling a placed order', async () => {
    const { connection, pool } = mockTransaction();
    const cancelled = await cancelOrder(pool, ORDER_ID, USER_ID, false);
    expect(cancelled).toEqual({ id: ORDER_ID, status: 'CANCELLED' });
    expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE products'))).toHaveLength(1);
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it('does not restock an already cancelled order', async () => {
    const { connection, pool } = mockTransaction({ orderStatus: 'CANCELLED' });
    await expect(cancelOrder(pool, ORDER_ID, USER_ID, false)).rejects.toMatchObject({ code: 'ALREADY_CANCELLED' });
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE products'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it('hides other customers orders and cannot modify their stock', async () => {
    const { connection, pool } = mockTransaction({ owner: OTHER_USER });
    await expect(cancelOrder(pool, ORDER_ID, USER_ID, false)).rejects.toMatchObject({ status: 404 });
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE products'))).toBe(false);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
