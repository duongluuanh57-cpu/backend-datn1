import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import CartItemModel from '../../models/CartItem.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  // Đảm bảo unique index (userId + productVariantId) đã tồn tại trước khi test trùng lặp.
  await CartItemModel.ensureIndexes();
  await CartItemModel.deleteMany({ userId: { $in: [TEST_USER_ID, OTHER_USER_ID] } });
});

afterAll(async () => {
  await CartItemModel.deleteMany({ userId: { $in: [TEST_USER_ID, OTHER_USER_ID] } });
});

describe('CartItem Model (cart_items)', () => {
  it('should use the cart_items collection', () => {
    expect(CartItemModel.collection.name).toBe('cart_items');
  });

  it('should expose only the ERD fields (no cartId/productId/variantSize)', () => {
    expect(CartItemModel.schema.path('userId')).toBeDefined();
    expect(CartItemModel.schema.path('productVariantId')).toBeDefined();
    expect(CartItemModel.schema.path('quantity')).toBeDefined();
    expect(CartItemModel.schema.path('price')).toBeDefined();
    expect(CartItemModel.schema.path('cartId')).toBeUndefined();
    expect(CartItemModel.schema.path('productId')).toBeUndefined();
    expect(CartItemModel.schema.path('variantSize')).toBeUndefined();
  });

  it('should create a CartItem with required fields', async () => {
    const variantId = new mongoose.Types.ObjectId();
    const item = await CartItemModel.create({
      userId: TEST_USER_ID,
      productVariantId: variantId,
      price: 500000,
      quantity: 2,
    });
    expect(item._id).toBeDefined();
    expect(item.userId.toString()).toBe(TEST_USER_ID.toString());
    expect(item.productVariantId.toString()).toBe(variantId.toString());
    expect(item.quantity).toBe(2);
    expect(item.price).toBe(500000);
  });

  it('should default quantity to 1 when not provided', async () => {
    const item = await CartItemModel.create({
      userId: TEST_USER_ID,
      productVariantId: new mongoose.Types.ObjectId(),
      price: 100000,
    });
    expect(item.quantity).toBe(1);
  });

  it('should reject quantity less than 1', async () => {
    await expect(
      CartItemModel.create({
        userId: TEST_USER_ID,
        productVariantId: new mongoose.Types.ObjectId(),
        price: 100000,
        quantity: 0,
      })
    ).rejects.toThrow();
  });

  it('should require price', async () => {
    await expect(
      CartItemModel.create({
        userId: TEST_USER_ID,
        productVariantId: new mongoose.Types.ObjectId(),
      } as any)
    ).rejects.toThrow();
  });

  it('should reject duplicate userId + productVariantId', async () => {
    const variantId = new mongoose.Types.ObjectId();
    await CartItemModel.create({
      userId: TEST_USER_ID,
      productVariantId: variantId,
      price: 200000,
      quantity: 1,
    });
    await expect(
      CartItemModel.create({
        userId: TEST_USER_ID,
        productVariantId: variantId,
        price: 200000,
        quantity: 1,
      })
    ).rejects.toThrow();
  });

  it('should allow the same variant for a different user', async () => {
    const variantId = new mongoose.Types.ObjectId();
    const a = await CartItemModel.create({
      userId: TEST_USER_ID,
      productVariantId: variantId,
      price: 300000,
    });
    const b = await CartItemModel.create({
      userId: OTHER_USER_ID,
      productVariantId: variantId,
      price: 300000,
    });
    expect(a._id).not.toBe(b._id);
  });

  it('should be findable by userId', async () => {
    const items = await CartItemModel.find({ userId: TEST_USER_ID });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
