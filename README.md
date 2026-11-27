# OrderFlow API

[![CI](https://github.com/bernardosampaiosousa/orderflow-api/actions/workflows/ci.yml/badge.svg)](https://github.com/bernardosampaiosousa/orderflow-api/actions/workflows/ci.yml)

I built OrderFlow to work through a common checkout problem: what happens when two customers try to buy the last item at the same time?

It's a small REST API for products and orders. The interesting part is the MySQL transaction that checks inventory, saves a snapshot of the product price, and updates stock together. There's no payment processing or frontend.

## Built with

- TypeScript, Node.js 24, Express 5
- MySQL (using `mysql2`, without an ORM)
- Zod for request validation, JWT for authentication, `scrypt` for password hashing
- Vitest, Supertest, Docker Compose

## Run locally

You need Docker and Docker Compose.

```bash
git clone https://github.com/bernardosampaiosousa/orderflow-api.git
cd orderflow-api
cp .env.example .env
```

Set `DB_PASSWORD` and `MYSQL_ROOT_PASSWORD` to different, strong passwords. Generate a random `JWT_SECRET` with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then start the stack:

```bash
docker compose up --build -d
curl http://localhost:3000/health
```

The health endpoint checks MySQL and returns `{"status":"ok"}` when the database is ready.
Compose also runs the additive schema migration before starting the API, including when an existing MySQL volume is reused.

**Existing Docker volumes:** MySQL only uses the initial password when the volume is created. If you change the password in `.env` later, update the user inside MySQL too; don't delete the volume just to fix credentials.

For a local Node.js setup, use Node 22+ and an existing MySQL database:

```bash
npm ci
cp .env.example .env
npm run db:migrate
npm run dev
```

## API routes

| Method | Route | Who can use it |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Anyone |
| `POST` | `/api/auth/login` | Anyone |
| `GET` | `/api/auth/me` | Signed-in users |
| `GET` | `/api/products` | Anyone |
| `GET` | `/api/products/:id` | Anyone |
| `POST` | `/api/products` | Admins |
| `PATCH` | `/api/products/:id` | Admins |
| `POST` | `/api/orders` | Signed-in users |
| `GET` | `/api/orders` | Owner (or admin) |
| `GET` | `/api/orders/:id` | Owner (or admin) |
| `POST` | `/api/orders/:id/cancel` | Owner (or admin) |

All requests and responses use JSON. Authenticated routes expect `Authorization: Bearer <token>`.
`POST /api/orders` also **requires** an `Idempotency-Key` header (8–128 letters, numbers, hyphens or underscores).
Generate a new key for each intended purchase and reuse that key with the **same items and quantities** if the request times out. Retrying returns the original order (HTTP 201); using the same key with different items returns HTTP 409.

A typical flow is:

1. Register with `POST /api/auth/register`.
2. Sign in and use the returned JWT.
3. Browse products with `GET /api/products`.
4. Send `POST /api/orders` with product IDs and quantities.

Example order body:

```json
{
  "items": [
    { "productId": "YOUR-PRODUCT-UUID", "quantity": 2 }
  ]
}
```

New accounts are customers. To test admin-only routes on your own database, register a test user and update its role using an administrative MySQL session:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'your-test-email@example.com';
```

Log in again after the role change. There is deliberately no public admin registration route.

With a product ID from the catalog, a checkout request looks like this:

```bash
curl -X POST http://localhost:3000/api/orders \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Idempotency-Key: checkout-attempt-10001' \
  -d '{"items":[{"productId":"YOUR-PRODUCT-UUID","quantity":1}]}'
```

## Why checkout uses a transaction

The API locks the requested product rows with `SELECT ... FOR UPDATE`. It then checks stock, inserts the order and its items, and decrements inventory. If any step fails, MySQL rolls back the entire checkout. Product prices are saved in cents on each order item, so a later price change doesn't rewrite old orders.

Cancellation locks the order, restores stock once, and changes its status to `CANCELLED`. Repeating a cancellation returns a conflict instead of incrementing inventory again.

Idempotency keys are stored with a hash of the requested items and the original response in the same transaction. Two simultaneous requests with the same key cannot both create an order: the second waits for the first transaction and receives its saved result. Failed transactions release their keys so a subsequent retry can proceed.

The code for this lives in [`src/services/orders.ts`](src/services/orders.ts), with the rules for line prices in [`src/services/orderPolicy.ts`](src/services/orderPolicy.ts).

### Checkout flow

```mermaid
flowchart TD
    A["POST /api/orders"] --> B["Validate items"]
    B --> C["Begin MySQL transaction"]
    C --> D["Lock product rows"]
    D --> E{"Products active and enough stock?"}
    E -->|No| F["Roll back and return an error"]
    E -->|Yes| G["Save order, items and decrement stock"]
    G --> H["Commit"]
```

The [MySQL integration test](tests/integration/mysql.test.ts) sends two simultaneous checkouts for the final unit of a product. It verifies that only one succeeds and that stock never becomes negative.

## Tests

```bash
npm run check
```

This runs TypeScript checks, unit/API tests, and a production build. The test suite uses fake database responses for most route tests. A separate integration suite exercises the checkout rules against a temporary MySQL test database:

```bash
TEST_MYSQL_URL=mysql://orderflow:your-password@127.0.0.1:3306/orderflow_test npm run test:integration
```

Only run the integration suite against a disposable database whose name ends in `_test`; it clears test tables.

## Current limits

This is a portfolio API, not an e-commerce system you should deploy as-is. It has no payment flow, inventory reservations, versioned database migration tracking, or distributed rate limiting. My next priorities would be structured request logging and versioned migrations.

Licensed under MIT.
