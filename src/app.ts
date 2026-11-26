import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'mysql2/promise';
import { errorHandler } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { productRoutes } from './routes/products.js';
import { orderRoutes } from './routes/orders.js';

// No listen() here; Supertest can exercise the routes directly.
export function createApp(db: Pool, jwtSecret: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  // A running process isn't healthy if MySQL is down.
  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes(db, jwtSecret));
  app.use('/api/products', productRoutes(db, jwtSecret));
  app.use('/api/orders', orderRoutes(db, jwtSecret));

  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}
