import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { cancelOrder, createOrder } from '../../src/services/orders.js';

let db: Pool;
let userId: string;
let productId: string;

describe('checkout with MySQL', () => {
  beforeAll(async () => {
    const rawUrl = process.env.TEST_MYSQL_URL;
    if (!rawUrl) throw new Error('Set TEST_MYSQL_URL to a disposable MySQL test database');

    const url = new URL(rawUrl);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!database.endsWith('_test')) {
      throw new Error('Integration tests only run against a database ending in _test');
    }

    db = createPool({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      multipleStatements: true,
      connectionLimit: 5,
    });
    const schema = await readFile(new URL('../../database/001_init.sql', import.meta.url), 'utf8');
    await db.query(schema);
  }, 30_000);

  beforeEach(async () => {
    await db.query('DELETE FROM checkout_requests');
    await db.query('DELETE FROM order_items');
    await db.query('DELETE FROM orders');
    await db.query('DELETE FROM products');
    await db.query('DELETE FROM users');

    userId = randomUUID();
    productId = randomUUID();
    await db.execute(
      'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
      [userId, 'Test customer', 'test@example.com', 'not-used-by-this-test'],
    );
    await db.execute(
      'INSERT INTO products (id, sku, name, price_cents, stock) VALUES (?, ?, ?, ?, ?)',
      [productId, 'LAST-ONE', 'Test item', 4999, 1],
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it('does not sell the last item twice under concurrent checkout', async () => {
    const outcomes = await Promise.allSettled([
      createOrder(db, userId, [{ productId, quantity: 1 }]),
      createOrder(db, userId, [{ productId, quantity: 1 }]),
    ]);

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const [stock] = await db.execute<RowDataPacket[]>('SELECT stock FROM products WHERE id = ?', [productId]);
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    expect(stock[0]!.stock).toBe(0);
    expect(orders[0]!.count).toBe(1);
  });

  it('returns one order when the same checkout is retried concurrently', async () => {
    const items = [{ productId, quantity: 1 }];
    const [first, replay] = await Promise.all([
      createOrder(db, userId, items, 'checkout-retry-001'),
      createOrder(db, userId, items, 'checkout-retry-001'),
    ]);

    expect(replay).toEqual(first);
    const [stock] = await db.execute<RowDataPacket[]>('SELECT stock FROM products WHERE id = ?', [productId]);
    const [orders] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM orders');
    const [requests] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM checkout_requests');
    expect(stock[0]!.stock).toBe(0);
    expect(orders[0]!.count).toBe(1);
    expect(requests[0]!.count).toBe(1);
  });

  it('rejects a reused key for a different payload', async () => {
    await createOrder(db, userId, [{ productId, quantity: 1 }], 'checkout-retry-002');
    await expect(createOrder(db, userId, [{ productId, quantity: 2 }], 'checkout-retry-002'))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('releases an idempotency key when the checkout is rolled back', async () => {
    await expect(createOrder(db, userId, [{ productId, quantity: 2 }], 'checkout-retry-003'))
      .rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_STOCK' });
    const order = await createOrder(db, userId, [{ productId, quantity: 1 }], 'checkout-retry-003');
    expect(order.totalCents).toBe(4999);
  });

  it('restores stock on cancellation and never restores it twice', async () => {
    const placed = await createOrder(db, userId, [{ productId, quantity: 1 }]);
    expect(placed.totalCents).toBe(4999);

    await cancelOrder(db, placed.id, userId, false);
    await expect(cancelOrder(db, placed.id, userId, false)).rejects.toMatchObject({
      status: 409,
    });

    const [products] = await db.execute<RowDataPacket[]>('SELECT stock FROM products WHERE id = ?', [productId]);
    const [orders] = await db.execute<RowDataPacket[]>('SELECT status FROM orders WHERE id = ?', [placed.id]);
    expect(products[0]!.stock).toBe(1);
    expect(orders[0]!.status).toBe('CANCELLED');
  });
});
