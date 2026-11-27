import { z } from 'zod';

export const uuid = z.uuid();
export const idempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/, {
  message: 'Use 8-128 letters, numbers, hyphens or underscores',
});
export const registration = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: z.email().transform(value => value.toLowerCase()),
  password: z.string().min(12).max(128),
});
export const login = z.strictObject({
  email: z.email().transform(value => value.toLowerCase()),
  password: z.string().min(1),
});
export const newProduct = z.strictObject({
  sku: z.string().trim().min(2).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1000).nullable().default(null),
  priceCents: z.number().int().min(1).max(1_000_000),
  stock: z.number().int().min(0).max(1_000_000),
});
export const productUpdate = z.strictObject({
  sku: newProduct.shape.sku.optional(),
  name: newProduct.shape.name.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceCents: newProduct.shape.priceCents.optional(),
  stock: newProduct.shape.stock.optional(),
  active: z.boolean().optional(),
}).refine(input => Object.keys(input).length > 0, 'Provide at least one field');
export const newOrder = z.strictObject({
  items: z.array(z.strictObject({
    productId: uuid,
    quantity: z.number().int().min(1).max(100),
  })).min(1).max(20),
}).refine(value => new Set(value.items.map(item => item.productId)).size === value.items.length, {
  message: 'Each product may appear only once', path: ['items'],
});
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
