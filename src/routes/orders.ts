import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { newOrder, pagination, uuid } from '../lib/schemas.js';
import { authenticate, getUser } from '../middleware/auth.js';
import { cancelOrder, createOrder, getOrder, listOrders } from '../services/orders.js';

export function orderRoutes(db: Pool, secret: string): Router {
  const router = Router();
  router.use(authenticate(db, secret));

  router.post('/', async (req, res) => {
    const { items } = newOrder.parse(req.body);
    const order = await createOrder(db, getUser(res.locals).id, items);
    res.status(201).json({ data: order });
  });
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const user = getUser(res.locals);
    res.json(await listOrders(db, user.id, user.role === 'ADMIN', page, limit));
  });
  router.get('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const user = getUser(res.locals);
    res.json({ data: await getOrder(db, id, user.id, user.role === 'ADMIN') });
  });
  router.post('/:id/cancel', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const user = getUser(res.locals);
    res.json({ data: await cancelOrder(db, id, user.id, user.role === 'ADMIN') });
  });
  return router;
}
