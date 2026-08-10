import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { CartController } from '../../controllers/CartController.ts';
import Cart from '../../models/Cart.ts';
import CartItem from '../../models/CartItem.ts';
import { Brand } from '../../models/Brand.ts';
import { Category } from '../../models/Category.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_BRAND_ID = new mongoose.Types.ObjectId();
let testProductId: mongoose.Types.ObjectId;
let testCartId: mongoose.Types.ObjectId;

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  // Create test brand
  await mongoose.connection.db!.collection('brands').insertOne({
    _id: TEST_BRAND_ID,
    name: 'Test Brand',
  });
  // Create test product
  const product = await Product.create({
    name: 'Nước hoa Test Product',
    brandId: TEST_BRAND_ID,
    brand: 'Test Brand',
    description: 'Test description',
  });
  testProductId = product._id as mongoose.Types.ObjectId;
  // Create test variant
  await ProductVariant.create({
    productId: testProductId,
    size: '50ml',
    price: 500000,
    quantityInStock: 10,
    isDefault: true,
    sortOrder: 0,
  });
  // Create test cart
  const cart = await Cart.create({
    userId: TEST_USER_ID,
    totalAmount: 0,
  });
  testCartId = cart._id as mongoose.Types.ObjectId;
});

afterAll(async () => {
  await CartItem.deleteMany({ cartId: testCartId });
  await Cart.deleteMany({ userId: TEST_USER_ID });
  await Product.deleteMany({ _id: testProductId });
  await ProductVariant.deleteMany({ productId: testProductId });
  await mongoose.connection.db!.collection('brands').deleteMany({ _id: TEST_BRAND_ID });
});

function mockReq(overrides: any = {}): any {
  return {
    user: { userId: TEST_USER_ID.toString() },
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function mockReply(): any {
  const r: any = {};
  r.status = (code: number) => {
    r._status = code;
    return { send: (b: any) => { r._body = b; } };
  };
  r.send = (b: any) => { r._body = b; };
  return r;
}

describe('CartController', () => {
  beforeEach(async () => {
    // Ensure clean state for each test
    await CartItem.deleteMany({ cartId: testCartId });
    await Cart.updateOne({ _id: testCartId }, { totalAmount: 0 });
  });

  describe('getCart', () => {
    it('should return empty items for existing cart', async () => {
      const req = mockReq();
      const reply = mockReply();
      await CartController.getCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items).toEqual([]);
      expect(reply._body.data.totalAmount).toBe(0);
    });

    it('should return items when cart has items', async () => {
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'Test Item',
        price: 100000,
        quantity: 2,
      });
      const req = mockReq();
      const reply = mockReply();
      await CartController.getCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(1);
      expect(reply._body.data.items[0].name).toBe('Test Item');
      expect(reply._body.data.totalItems).toBe(2);
    });
  });

  describe('addToCart', () => {
    it('should add a new item to cart', async () => {
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 2, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.addToCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(1);
      expect(reply._body.data.items[0].quantity).toBe(2);
      expect(reply._body.data.items[0].variantSize).toBe('50ml');
    });

    it('should increment quantity when same product+variant exists', async () => {
      // Add first time
      const req1 = mockReq({
        body: { productId: testProductId.toString(), quantity: 1, variantSize: '50ml' },
      });
      await CartController.addToCart(req1, mockReply());
      // Add second time
      const req2 = mockReq({
        body: { productId: testProductId.toString(), quantity: 3, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.addToCart(req2, reply);
      expect(reply._body.success).toBe(true);
      const item = reply._body.data.items.find((i: any) => i.productId.toString() === testProductId.toString());
      expect(item.quantity).toBe(4);
    });

    it('should create separate items for different variantSize', async () => {
      // Need a variant for 100ml
      const existing = await ProductVariant.findOne({ productId: testProductId, size: '100ml' });
      if (!existing) {
        await ProductVariant.create({
          productId: testProductId,
          size: '100ml',
          price: 700000,
          quantityInStock: 5,
    isDefault: false,
    sortOrder: 1,
        });
      }
      const req1 = mockReq({
        body: { productId: testProductId.toString(), quantity: 1, variantSize: '50ml' },
      });
      await CartController.addToCart(req1, mockReply());
      const req2 = mockReq({
        body: { productId: testProductId.toString(), quantity: 2, variantSize: '100ml' },
      });
      const reply = mockReply();
      await CartController.addToCart(req2, reply);
      expect(reply._body.data.items.length).toBe(2);
      const sizes = reply._body.data.items.map((i: any) => i.variantSize).sort();
      expect(sizes).toEqual(['100ml', '50ml']);
    });

    it('should reject invalid productId', async () => {
      const req = mockReq({
        body: { productId: 'not-a-valid-id', quantity: 1 },
      });
      const reply = mockReply();
      await CartController.addToCart(req, reply);
      expect(reply._status).toBe(400);
    });
  });

  describe('updateCartItem', () => {
    it('should update item quantity', async () => {
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'Update Test',
        price: 200000,
        quantity: 1,
        variantSize: '50ml',
      });
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 5, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._body.success).toBe(true);
      const item = reply._body.data.items.find((i: any) => i.productId.toString() === testProductId.toString());
      expect(item.quantity).toBe(5);
    });

    it('should remove item when quantity is 0', async () => {
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'Remove Test',
        price: 200000,
        quantity: 1,
        variantSize: '50ml',
      });
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 0, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._body.data.items.length).toBe(0);
    });

    it('should return 404 for non-existent item', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const req = mockReq({
        body: { productId: fakeId, quantity: 1 },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._status).toBe(404);
    });
  });

  describe('removeCartItem', () => {
    it('should remove item from cart', async () => {
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'Delete Test',
        price: 150000,
        quantity: 1,
        variantSize: '50ml',
      });
      const req = mockReq({
        params: { productId: testProductId.toString() },
        query: { variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.removeCartItem(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(0);
    });

    it('should return 404 for non-existent item', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const req = mockReq({
        params: { productId: fakeId },
        query: { variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.removeCartItem(req, reply);
      expect(reply._status).toBe(404);
    });
  });

  describe('clearCart', () => {
    it('should remove all items and reset totalAmount', async () => {
      await CartItem.insertMany([
        {
          cartId: testCartId, userId: TEST_USER_ID,
          productId: testProductId, name: 'Item 1', price: 100000, quantity: 1, variantSize: '50ml',
        },
        {
          cartId: testCartId, userId: TEST_USER_ID,
          productId: testProductId, name: 'Item 2', price: 200000, quantity: 2, variantSize: '100ml',
        },
      ]);
      await Cart.updateOne({ _id: testCartId }, { totalAmount: 500000 });
      const req = mockReq();
      const reply = mockReply();
      await CartController.clearCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items).toEqual([]);
      expect(reply._body.data.totalAmount).toBe(0);
      // Verify DB is also cleared
      const count = await CartItem.countDocuments({ cartId: testCartId });
      expect(count).toBe(0);
      const cart = await Cart.findById(testCartId);
      expect(cart?.totalAmount).toBe(0);
    });
  });

  describe('removeVoucher', () => {
    it('should clear voucher from cart', async () => {
      await Cart.updateOne({ _id: testCartId }, { voucherCode: 'TEST10', voucherDiscount: 50000 });
      const req = mockReq();
      const reply = mockReply();
      await CartController.removeVoucher(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.voucherCode).toBeNull();
      expect(reply._body.data.voucherDiscount).toBe(0);
    });
  });
});
