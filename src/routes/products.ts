import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { HttpError } from '../lib/errors.js';
import { newProduct, pagination, productUpdate, uuid } from '../lib/schemas.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const FIELDS = `id, sku, name, description, price_cents AS priceCents,
  stock, active, created_at AS createdAt, updated_at AS updatedAt`;

function present(row: RowDataPacket): Record<string, unknown> {
  return { ...row, active: Boolean(row.active) };
}

export function productRoutes(db: Pool, secret: string): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const offset = (page - 1) * limit;
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT ${FIELDS} FROM products WHERE active = 1 ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [limit, offset],
    );
    const [counts] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM products WHERE active = 1');
    res.json({ data: rows.map(present), meta: { page, limit, total: Number(counts[0]?.total ?? 0) } });
  });

  router.get('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${FIELDS} FROM products WHERE id = ? AND active = 1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    res.json({ data: present(rows[0]) });
  });

  router.post('/', authenticate(db, secret), requireAdmin, async (req, res) => {
    const item = newProduct.parse(req.body);
    const id = randomUUID();
    await db.execute(
      'INSERT INTO products (id, sku, name, description, price_cents, stock) VALUES (?, ?, ?, ?, ?, ?)',
      [id, item.sku, item.name, item.description, item.priceCents, item.stock],
    );
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${FIELDS} FROM products WHERE id = ?`, [id]);
    res.status(201).json({ data: present(rows[0]!) });
  });

  router.patch('/:id', authenticate(db, secret), requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = productUpdate.parse(req.body);
    const columns = {
      sku: 'sku', name: 'name', description: 'description',
      priceCents: 'price_cents', stock: 'stock', active: 'active',
    } as const;
    const pairs = Object.entries(input) as Array<[keyof typeof columns, unknown]>;
    // Only SQL identifiers from this fixed allowlist are interpolated.
    const assignments = pairs.map(([key]) => `${columns[key]} = ?`).join(', ');
    const values = pairs.map(([key, value]) => key === 'active' ? Number(value) : value) as Array<string | number | null>;
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE products SET ${assignments} WHERE id = ?`, [...values, id],
    );
    if (result.affectedRows === 0) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT ${FIELDS} FROM products WHERE id = ?`, [id]);
    res.json({ data: present(rows[0]!) });
  });
  return router;
}
