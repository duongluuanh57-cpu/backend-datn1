import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { CartController } from '../../controllers/CartController.ts';
import CartItem from '../../models/CartItem.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_BRAND_ID = new mongoose.Types.ObjectId();
let testProductId: mongoose.Types.ObjectId;
let variant50Id: mongoose.Types.ObjectId;
let variant100Id: mongoose.Types.ObjectId;

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
    categoryId: new mongoose.Types.ObjectId(),
    description: 'Test description',
  });
  testProductId = product._id as mongoose.Types.ObjectId;
  // Create test variants
  const v50 = await ProductVariant.create({
    productId: testProductId,
    size: '50ml',
    price: 500000,
    quantityInStock: 10,
    isDefault: true,
  });
  const v100 = await ProductVariant.create({
    productId: testProductId,
    size: '100ml',
    price: 700000,
    quantityInStock: 5,
    isDefault: false,
  });
  variant50Id = v50._id as mongoose.Types.ObjectId;
  variant100Id = v100._id as mongoose.Types.ObjectId;
});

afterAll(async () => {
  await CartItem.deleteMany({ userId: TEST_USER_ID });
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

describe('CartController (cart_items only)', () => {
  beforeEach(async () => {
    await CartItem.deleteMany({ userId: TEST_USER_ID });
  });

  describe('getCart', () => {
    it('should return empty items for an empty cart', async () => {
      const req = mockReq();
      const reply = mockReply();
      await CartController.getCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items).toEqual([]);
      expect(reply._body.data.totalAmount).toBe(0);
      expect(reply._body.data.totalItems).toBe(0);
    });

    it('should return items populated from the product', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 2,
      });
      const req = mockReq();
      const reply = mockReply();
      await CartController.getCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(1);
      expect(reply._body.data.items[0].name).toBe('Nước hoa Test Product');
      expect(reply._body.data.items[0].brand).toBe('Test Brand');
      expect(reply._body.data.items[0].variantSize).toBe('50ml');
      expect(reply._body.data.items[0].productId).toBe(testProductId.toString());
      expect(reply._body.data.totalItems).toBe(2);
      expect(reply._body.data.totalAmount).toBe(1000000);
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

    it('should increment quantity when same variant exists', async () => {
      const req1 = mockReq({
        body: { productId: testProductId.toString(), quantity: 1, variantSize: '50ml' },
      });
      await CartController.addToCart(req1, mockReply());
      const req2 = mockReq({
        body: { productId: testProductId.toString(), quantity: 3, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.addToCart(req2, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(1);
      const item = reply._body.data.items.find((i: any) => i.productId === testProductId.toString());
      expect(item.quantity).toBe(4);
    });

    it('should create separate items for different variantSize', async () => {
      await CartController.addToCart(
        mockReq({ body: { productId: testProductId.toString(), quantity: 1, variantSize: '50ml' } }),
        mockReply()
      );
      const reply = mockReply();
      await CartController.addToCart(
        mockReq({ body: { productId: testProductId.toString(), quantity: 2, variantSize: '100ml' } }),
        reply
      );
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
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 5, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._body.success).toBe(true);
      const item = reply._body.data.items.find((i: any) => i.productId === testProductId.toString());
      expect(item.quantity).toBe(5);
    });

    it('should remove item when quantity is 0', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 0, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._body.data.items.length).toBe(0);
    });

    it('should reject quantity over stock', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });
      const req = mockReq({
        body: { productId: testProductId.toString(), quantity: 999, variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.updateCartItem(req, reply);
      expect(reply._status).toBe(400);
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

  describe('updateCartItemVariant', () => {
    it('should switch the item to another variant', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 2,
      });
      const req = mockReq({
        body: {
          productId: testProductId.toString(),
          currentVariantSize: '50ml',
          newVariantSize: '100ml',
        },
      });
      const reply = mockReply();
      await CartController.updateCartItemVariant(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(1);
      expect(reply._body.data.items[0].variantSize).toBe('100ml');
      expect(reply._body.data.items[0].price).toBe(700000);
    });
  });

  describe('removeCartItem', () => {
    it('should remove item from cart', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
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

    it('without variantSize removes ALL size lines of the product (I3)', async () => {
      await CartItem.insertMany([
        { userId: TEST_USER_ID, productVariantId: variant50Id, price: 500000, quantity: 1 },
        { userId: TEST_USER_ID, productVariantId: variant100Id, price: 700000, quantity: 2 },
      ]);
      const req = mockReq({
        params: { productId: testProductId.toString() },
        query: {}, // không variantSize
      });
      const reply = mockReply();
      await CartController.removeCartItem(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items.length).toBe(0);
      const count = await CartItem.countDocuments({ userId: TEST_USER_ID });
      expect(count).toBe(0);
    });

    it('with variantSize removes ONLY that size line (I3)', async () => {
      await CartItem.insertMany([
        { userId: TEST_USER_ID, productVariantId: variant50Id, price: 500000, quantity: 1 },
        { userId: TEST_USER_ID, productVariantId: variant100Id, price: 700000, quantity: 2 },
      ]);
      const req = mockReq({
        params: { productId: testProductId.toString() },
        query: { variantSize: '50ml' },
      });
      const reply = mockReply();
      await CartController.removeCartItem(req, reply);
      expect(reply._body.data.items.length).toBe(1);
      expect(reply._body.data.items[0].variantSize).toBe('100ml');
    });
  });

  describe('clearCart', () => {
    it('should remove all cart_items of the user', async () => {
      await CartItem.insertMany([
        { userId: TEST_USER_ID, productVariantId: variant50Id, price: 500000, quantity: 1 },
        { userId: TEST_USER_ID, productVariantId: variant100Id, price: 700000, quantity: 2 },
      ]);
      const req = mockReq();
      const reply = mockReply();
      await CartController.clearCart(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.items).toEqual([]);
      expect(reply._body.data.totalAmount).toBe(0);
      const count = await CartItem.countDocuments({ userId: TEST_USER_ID });
      expect(count).toBe(0);
    });
  });

  describe('vouchers (stateless)', () => {
    it('should remove the discount voucher echoed back by the client', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });
      const req = mockReq({
        body: { code: 'TEST10', voucherCode: 'TEST10', voucherDiscount: 50000 },
      });
      const reply = mockReply();
      await CartController.removeVoucher(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.voucherCode).toBeNull();
      expect(reply._body.data.voucherDiscount).toBe(0);
      expect(reply._body.data.items.length).toBe(1);
    });

    it('should keep the discount voucher when removing a freeship voucher', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });
      const req = mockReq({
        body: {
          code: 'FREESHIP10',
          voucherCode: 'TEST10',
          voucherDiscount: 50000,
          freeshipVoucherCode: 'FREESHIP10',
        },
      });
      const reply = mockReply();
      await CartController.removeVoucher(req, reply);
      expect(reply._body.data.voucherCode).toBe('TEST10');
      expect(reply._body.data.voucherDiscount).toBe(50000);
      expect(reply._body.data.freeshipVoucherCode).toBeNull();
    });
  });
});
