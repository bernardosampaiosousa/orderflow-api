import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { login, registration } from '../lib/schemas.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { issueToken } from '../lib/token.js';
import { HttpError } from '../lib/errors.js';
import { authenticate, getUser } from '../middleware/auth.js';

// Keeps registration, login, and current-user endpoints in one router.
export function authRoutes(db: Pool, secret: string): Router {
  const router = Router();

  // New accounts always start as customers; role escalation stays outside registration.
  router.post('/register', async (req, res) => {
    const input = registration.parse(req.body);
    const id = randomUUID();
    const hash = await hashPassword(input.password);
    await db.execute(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [id, input.name, input.email, hash, 'CUSTOMER'],
    );
    const token = await issueToken({ id, role: 'CUSTOMER' }, secret);
    res.status(201).json({ data: { id, name: input.name, email: input.email, role: 'CUSTOMER' }, token });
  });

  // Signs a fresh token only after the saved password hash matches.
  router.post('/login', async (req, res) => {
    const input = login.parse(req.body);
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = ?', [input.email],
    );
    const user = rows[0];
    if (!user || !(await verifyPassword(input.password, user.password_hash as string))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    const token = await issueToken({ id: user.id as string, role: user.role as 'ADMIN' | 'CUSTOMER' }, secret);
    res.json({ data: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
  });

  // Reads the account already checked by the middleware, not unchecked token data.
  router.get('/me', authenticate(db, secret), (_req, res) => {
    res.json({ data: getUser(res.locals) });
  });
  return router;
}
