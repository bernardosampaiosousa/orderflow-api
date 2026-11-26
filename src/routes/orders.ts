import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { newOrder, pagination, uuid } from '../lib/schemas.js';
import { authenticate, getUser } from '../middleware/auth.js';
import { cancelOrder, createOrder, getOrder, listOrders } from '../services/orders.js';

// Protects every order endpoint and passes account ownership to the service layer.
export function orderRoutes(db: Pool, secret: string): Router {
  const router = Router();
  router.use(authenticate(db, secret));

  // Creates an order from product IDs and quantities; prices come from MySQL.
  router.post('/', async (req, res) => {
    const { items } = newOrder.parse(req.body);
    const order = await createOrder(db, getUser(res.locals).id, items);
    res.status(201).json({ data: order });
  });
  // Customers get their own history, while admins can inspect all orders.
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const user = getUser(res.locals);
    res.json(await listOrders(db, user.id, user.role === 'ADMIN', page, limit));
  });
  // Checks order ownership before returning its line items.
  router.get('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const user = getUser(res.locals);
    res.json({ data: await getOrder(db, id, user.id, user.role === 'ADMIN') });
  });
  // Reverses a placed order through the transactional restock service.
  router.post('/:id/cancel', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const user = getUser(res.locals);
    res.json({ data: await cancelOrder(db, id, user.id, user.role === 'ADMIN') });
  });
  return router;
}
