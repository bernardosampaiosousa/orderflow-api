import type { RequestHandler } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { HttpError } from '../lib/errors.js';
import { readToken, type Identity } from '../lib/token.js';

export type AuthenticatedUser = Identity & { name: string; email: string };

// Retrieves the account attached by the auth middleware for protected routes.
export function getUser(locals: Record<string, unknown>): AuthenticatedUser {
  const user = locals.user as AuthenticatedUser | undefined;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
  return user;
}

// JWT roles can go stale, so reload the account on every protected request.
export function authenticate(db: Pool, secret: string): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.header('authorization') ?? '');
    if (!match?.[1]) throw new HttpError(401, 'UNAUTHORIZED', 'Bearer token required');
    const identity = await readToken(match[1], secret);
    const [rows] = await db.execute<RowDataPacket[]>(
      'SELECT id, name, email, role FROM users WHERE id = ?', [identity.id],
    );
    if (!rows[0]) throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
    res.locals.user = rows[0] as AuthenticatedUser;
    next();
  };
}

// Customers can browse, but only admins should change stock or prices.
export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (getUser(res.locals).role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Administrator access required');
  }
  next();
};
