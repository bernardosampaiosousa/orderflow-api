import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/lib/errors.js';
import { priceOrder } from '../src/services/orderPolicy.js';

const PRODUCT = 'c62cf147-1959-4233-a8ef-6b860c46428f';

describe('order business rules', () => {
  it('calculates integer-cent totals from locked product prices', () => {
    expect(priceOrder([{ productId: PRODUCT, quantity: 3 }], [
      { id: PRODUCT, active: 1, stock: 3, priceCents: 1999 },
    ])).toEqual({
      totalCents: 5997,
      lines: [{ productId: PRODUCT, quantity: 3, unitPriceCents: 1999, subtotalCents: 5997 }],
    });
  });

  it('rejects an out-of-stock purchase', () => {
    expect(() => priceOrder([{ productId: PRODUCT, quantity: 2 }], [
      { id: PRODUCT, active: true, stock: 1, priceCents: 50 },
    ])).toThrowError(new HttpError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for product ${PRODUCT}`));
  });

  it('rejects missing and inactive products', () => {
    expect(() => priceOrder([{ productId: PRODUCT, quantity: 1 }], [])).toThrow(HttpError);
    expect(() => priceOrder([{ productId: PRODUCT, quantity: 1 }], [
      { id: PRODUCT, active: 0, stock: 10, priceCents: 50 },
    ])).toThrow(HttpError);
  });
});
