import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { HttpError } from '../lib/errors.js';
import { priceOrder, type RequestedItem, type AvailableProduct, type PricedItem } from './orderPolicy.js';

type CreatedOrder = {
  id: string;
  userId: string;
  status: 'PLACED';
  totalCents: number;
  items: PricedItem[];
};

// Ignore item order when comparing retries, but reject a changed quantity or product.
function requestHash(items: RequestedItem[]): string {
  const normalized = [...items].sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

// Shared transaction wrapper: no half-created order when a query fails.
async function transaction<T>(db: Pool, action: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await action(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// Lock stock before checkout; two requests may race for the last item.
export async function createOrder(db: Pool, userId: string, items: RequestedItem[], idempotencyKey?: string): Promise<CreatedOrder> {
  return transaction(db, async conn => {
    if (idempotencyKey) {
      const fingerprint = requestHash(items);
      try {
        // Claim the key before locking stock. Concurrent retries wait on this unique row.
        await conn.execute(
          'INSERT INTO checkout_requests (user_id, idempotency_key, request_hash) VALUES (?, ?, ?)',
          [userId, idempotencyKey, fingerprint],
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const [existing] = await conn.execute<RowDataPacket[]>(
          `SELECT request_hash AS requestHash, CAST(response_json AS CHAR) AS responseJson
           FROM checkout_requests WHERE user_id = ? AND idempotency_key = ? FOR UPDATE`,
          [userId, idempotencyKey],
        );
        if (!existing[0]) throw error;
        if (existing[0].requestHash !== fingerprint) {
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different order');
        }
        if (typeof existing[0].responseJson !== 'string') {
          throw new HttpError(409, 'IDEMPOTENCY_INCOMPLETE', 'Previous checkout is not ready to replay');
        }
        return JSON.parse(existing[0].responseJson) as CreatedOrder;
      }
    }

    const sortedIds = items.map(item => item.productId).sort();
    const placeholders = sortedIds.map(() => '?').join(', ');
    const [products] = await conn.query<RowDataPacket[]>(
      `SELECT id, active, price_cents AS priceCents, stock FROM products
       WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, sortedIds,
    );
    const { lines, totalCents } = priceOrder(items, products as AvailableProduct[]);
    const id = randomUUID();
    await conn.execute(
      'INSERT INTO orders (id, user_id, status, total_cents) VALUES (?, ?, ?, ?)',
      [id, userId, 'PLACED', totalCents],
    );
    for (const line of lines) {
      const [updated] = await conn.execute<ResultSetHeader>(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [line.quantity, line.productId, line.quantity],
      );
      if (updated.affectedRows !== 1) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK', 'Stock changed while placing the order');
      }
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
        [id, line.productId, line.quantity, line.unitPriceCents],
      );
    }
    const order: CreatedOrder = { id, userId, status: 'PLACED', totalCents, items: lines };
    if (idempotencyKey) {
      const [saved] = await conn.execute<ResultSetHeader>(
        'UPDATE checkout_requests SET response_json = ? WHERE user_id = ? AND idempotency_key = ?',
        [JSON.stringify(order), userId, idempotencyKey],
      );
      if (saved.affectedRows !== 1) throw new Error('Unable to save checkout replay response');
    }
    return order;
  });
}

// Paginates orders and limits customers to their own history.
export async function listOrders(db: Pool, userId: string, isAdmin: boolean, page: number, limit: number) {
  const where = isAdmin ? '' : 'WHERE user_id = ?';
  const args = isAdmin ? [] : [userId];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, user_id AS userId, status, total_cents AS totalCents, created_at AS createdAt
     FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...args, limit, (page - 1) * limit],
  );
  const [counts] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM orders ${where}`, args);
  return { data: rows, meta: { page, limit, total: Number(counts[0]?.total ?? 0) } };
}

// Loads an order with its saved prices, checking ownership before returning details.
export async function getOrder(db: Pool, id: string, userId: string, isAdmin: boolean) {
  const [orders] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id AS userId, status, total_cents AS totalCents, created_at AS createdAt
     FROM orders WHERE id = ? ${isAdmin ? '' : 'AND user_id = ?'}`,
    isAdmin ? [id] : [id, userId],
  );
  if (!orders[0]) throw new HttpError(404, 'NOT_FOUND', 'Order not found');
  const [items] = await db.execute<RowDataPacket[]>(
    `SELECT product_id AS productId, quantity, unit_price_cents AS unitPriceCents
     FROM order_items WHERE order_id = ? ORDER BY product_id`, [id],
  );
  return { ...orders[0], items };
}

// A second cancellation must not add stock again.
export async function cancelOrder(db: Pool, id: string, userId: string, isAdmin: boolean) {
  return transaction(db, async conn => {
    const [orders] = await conn.execute<RowDataPacket[]>(
      'SELECT id, user_id AS userId, status FROM orders WHERE id = ? FOR UPDATE', [id],
    );
    const order = orders[0];
    if (!order || (!isAdmin && order.userId !== userId)) {
      throw new HttpError(404, 'NOT_FOUND', 'Order not found');
    }
    if (order.status !== 'PLACED') throw new HttpError(409, 'ALREADY_CANCELLED', 'Order is already cancelled');
    const [items] = await conn.execute<RowDataPacket[]>(
      'SELECT product_id AS productId, quantity FROM order_items WHERE order_id = ? ORDER BY product_id', [id],
    );
    for (const item of items) {
      const [updated] = await conn.execute<ResultSetHeader>(
        'UPDATE products SET stock = stock + ? WHERE id = ? AND stock <= 1000000 - ?',
        [item.quantity, item.productId, item.quantity],
      );
      if (updated.affectedRows !== 1) {
        throw new HttpError(409, 'STOCK_CAPACITY', 'Cannot restore stock beyond the product limit');
      }
    }
    await conn.execute('UPDATE orders SET status = ? WHERE id = ?', ['CANCELLED', id]);
    return { id, status: 'CANCELLED' };
  });
}
