import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import CartItemModel from '../../models/CartItem.ts';

const TEST_CART_ID = new mongoose.Types.ObjectId();
const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_PRODUCT_ID = new mongoose.Types.ObjectId();

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  await CartItemModel.deleteMany({ cartId: TEST_CART_ID });
});

afterAll(async () => {
  await CartItemModel.deleteMany({ cartId: TEST_CART_ID });
});

describe('CartItem Model', () => {
  it('should create a CartItem with required fields', async () => {
    const item = await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: TEST_PRODUCT_ID,
      name: 'Nước hoa Test',
      price: 500000,
      quantity: 2,
      variantSize: '50ml',
    });
    expect(item._id).toBeDefined();
    expect(item.cartId.toString()).toBe(TEST_CART_ID.toString());
    expect(item.quantity).toBe(2);
    expect(item.variantSize).toBe('50ml');
  });

  it('should default quantity to 1 when not provided', async () => {
    const item = await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: new mongoose.Types.ObjectId(),
      name: 'Test Default Qty',
      price: 100000,
    });
    expect(item.quantity).toBe(1);
  });

  it('should reject duplicate cartId + productId + variantSize', async () => {
    const dupProductId = new mongoose.Types.ObjectId();
    await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: dupProductId,
      name: 'Unique Test',
      price: 200000,
      variantSize: '100ml',
    });
    await expect(
      CartItemModel.create({
        cartId: TEST_CART_ID,
        userId: TEST_USER_ID,
        productId: dupProductId,
        name: 'Unique Test Dupe',
        price: 200000,
        variantSize: '100ml',
      })
    ).rejects.toThrow();
  });

  it('should allow same productId with different variantSize', async () => {
    const sameProductId = new mongoose.Types.ObjectId();
    const a = await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: sameProductId,
      name: 'Multi Variant',
      price: 300000,
      variantSize: '50ml',
    });
    const b = await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: sameProductId,
      name: 'Multi Variant',
      price: 400000,
      variantSize: '100ml',
    });
    expect(a._id).not.toBe(b._id);
  });

  it('should have timestamps', async () => {
    const item = await CartItemModel.create({
      cartId: TEST_CART_ID,
      userId: TEST_USER_ID,
      productId: new mongoose.Types.ObjectId(),
      name: 'Timestamp Test',
      price: 150000,
    });
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it('should reject quantity less than 1', async () => {
    await expect(
      CartItemModel.create({
        cartId: TEST_CART_ID,
        userId: TEST_USER_ID,
        productId: new mongoose.Types.ObjectId(),
        name: 'Bad Qty',
        price: 100000,
        quantity: 0,
      })
    ).rejects.toThrow();
  });

  it('should be findable by cartId', async () => {
    const items = await CartItemModel.find({ cartId: TEST_CART_ID });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('should be findable by userId', async () => {
    const items = await CartItemModel.find({ userId: TEST_USER_ID });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});
