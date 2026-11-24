import { HttpError } from '../lib/errors.js';

export type RequestedItem = { productId: string; quantity: number };
export type AvailableProduct = { id: string; active: number | boolean; priceCents: number; stock: number };
export type PricedItem = { productId: string; quantity: number; unitPriceCents: number; subtotalCents: number };

export function priceOrder(items: RequestedItem[], products: AvailableProduct[]): {
  lines: PricedItem[]; totalCents: number;
} {
  const byId = new Map(products.map(product => [product.id, product]));
  const lines: PricedItem[] = items.map(item => {
    const product = byId.get(item.productId);
    if (!product || !product.active) {
      throw new HttpError(404, 'PRODUCT_UNAVAILABLE', `Product ${item.productId} is not available`);
    }
    if (product.stock < item.quantity) {
      throw new HttpError(409, 'INSUFFICIENT_STOCK', `Insufficient stock for product ${item.productId}`);
    }
    return {
      productId: item.productId, quantity: item.quantity,
      unitPriceCents: product.priceCents,
      subtotalCents: product.priceCents * item.quantity,
    };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, 'TOTAL_TOO_LARGE', 'Order total exceeds safe limits');
  return { lines, totalCents };
}
