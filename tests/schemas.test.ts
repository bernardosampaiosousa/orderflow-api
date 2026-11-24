import { describe, expect, it } from 'vitest';
import { newOrder, newProduct, pagination, productUpdate, registration } from '../src/lib/schemas.js';

const ID = 'c62cf147-1959-4233-a8ef-6b860c46428f';

describe('input validation', () => {
  it('normalizes email case on registration', () => {
    const parsed = registration.parse({ name: 'Bernardo', email: 'BERNARDO@example.com', password: 'A-strong-password-123!' });
    expect(parsed.email).toBe('bernardo@example.com');
  });

  it('rejects weak passwords and unexpected fields', () => {
    expect(registration.safeParse({ name: 'B', email: 'b@example.com', password: 'weak' }).success).toBe(false);
    expect(registration.safeParse({ name: 'Bernardo', email: 'b@example.com', password: 'A-strong-password-123!', role: 'ADMIN' }).success).toBe(false);
  });

  it('rejects duplicate products in one order', () => {
    expect(newOrder.safeParse({ items: [{ productId: ID, quantity: 1 }, { productId: ID, quantity: 2 }] }).success).toBe(false);
  });

  it('rejects invalid stock and price', () => {
    expect(newProduct.safeParse({ sku: 'A1', name: 'Product', priceCents: -3, stock: 0 }).success).toBe(false);
    expect(newProduct.safeParse({ sku: 'A1', name: 'Product', priceCents: 300, stock: -5 }).success).toBe(false);
  });

  it('prevents empty product updates', () => {
    expect(productUpdate.safeParse({}).success).toBe(false);
  });

  it('limits pagination size', () => {
    expect(pagination.parse({})).toEqual({ page: 1, limit: 20 });
    expect(pagination.safeParse({ page: 1, limit: 1000 }).success).toBe(false);
  });
});
