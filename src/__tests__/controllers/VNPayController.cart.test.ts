import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { VNPayController } from '../../controllers/VNPayController.ts';
import Cart from '../../models/Cart.ts';
import CartItem from '../../models/CartItem.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { PendingPayment } from '../../models/PendingPayment.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { Payment } from '../../models/Payment.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_BRAND_ID = new mongoose.Types.ObjectId();
let testProductId: mongoose.Types.ObjectId;
let testCartId: mongoose.Types.ObjectId;

// Mock VNPAY service to avoid real signature verification
vi.mock('../../services/VNPayService.ts', () => ({
  createPaymentUrl: vi.fn(() => 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?mock=1'),
  verifyIpnResponse: vi.fn(() => ({
    isValid: true,
    txnRef: 'TESTTXN123',
    amount: 330000, // must match PendingPayment finalAmount
    transactionNo: '12345678',
    responseCode: '00',
  })),
  verifyReturnParams: vi.fn(() => ({ isValid: true })),
}));

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  // Create test brand
  await mongoose.connection.db!.collection('brands').insertOne({
    _id: TEST_BRAND_ID,
    name: 'VNPay Test Brand',
  });
  // Create test product
  const product = await Product.create({
    name: 'VNPay Test Product',
    brandId: TEST_BRAND_ID,
    brand: 'VNPay Test Brand',
    description: 'Test for VNPay',
  });
  testProductId = product._id as mongoose.Types.ObjectId;
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
    headers: { 'x-forwarded-for': '127.0.0.1' },
    ip: '127.0.0.1',
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

describe('VNPayController — CartItem integration', () => {
  afterEach(async () => {
    await CartItem.deleteMany({ cartId: testCartId });
    await PendingPayment.deleteMany({ userId: TEST_USER_ID });
    const orders = await Order.find({ userId: TEST_USER_ID });
    for (const o of orders) {
      await OrderItem.deleteMany({ orderId: o._id });
      await Payment.deleteMany({ orderId: o._id });
    }
    await Order.deleteMany({ userId: TEST_USER_ID });
    await Cart.updateOne({ _id: testCartId }, { totalAmount: 0 });
  });

  describe('preparePayment', () => {
    it('should create PendingPayment with cartSnapshot from CartItem', async () => {
      // Add items to cart
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'VNPay Item',
        price: 200000,
        quantity: 2,
        variantSize: '50ml',
      });
      await Cart.updateOne({ _id: testCartId }, { totalAmount: 400000 });

      const req = mockReq({
        body: {
          fullName: 'Test User',
          phone: '0900000000',
          address: '123 Test Street',
          email: 'test@test.com',
        },
      });
      const reply = mockReply();
      await VNPayController.preparePayment(req, reply);
      expect(reply._body.success).toBe(true);
      expect(reply._body.data.paymentUrl).toContain('mock=1');
      // Verify PendingPayment was created with cart items from CartItem
      const pp = await PendingPayment.findOne({
        userId: TEST_USER_ID,
        status: 'pending',
      }).lean();
      expect(pp).toBeDefined();
      expect(pp!.cartSnapshot.items.length).toBe(1);
      expect(pp!.cartSnapshot.items[0].name).toBe('VNPay Item');
      expect(pp!.cartSnapshot.totalAmount).toBe(400000);
      expect(pp!.cartSnapshot.totalItems).toBe(2);
      expect(pp!.customerInfo.fullName).toBe('Test User');
    });

    it('should reject empty cart', async () => {
      const req = mockReq({
        body: {
          fullName: 'Test User',
          phone: '0900000000',
          address: '123 Test Street',
        },
      });
      const reply = mockReply();
      await VNPayController.preparePayment(req, reply);
      expect(reply._body.success).toBe(false);
      expect(reply._body.message).toContain('Giỏ hàng trống');
    });
  });

  describe('handleIpn — cart clearing', () => {
    it('should clear CartItem and reset Cart totalAmount after successful IPN', async () => {
      // Add items to cart
      await CartItem.create({
        cartId: testCartId,
        userId: TEST_USER_ID,
        productId: testProductId,
        name: 'IPN Test Item',
        price: 300000,
        quantity: 1,
        variantSize: '50ml',
      });
      await Cart.updateOne({ _id: testCartId }, { totalAmount: 300000 });

      // Create PendingPayment with cart snapshot
      const pp = await PendingPayment.create({
        txnRef: 'TESTTXN123',
        userId: TEST_USER_ID,
        cartSnapshot: {
          items: [{
            productId: testProductId,
            name: 'IPN Test Item',
            price: 300000,
            quantity: 1,
            variantSize: '50ml',
          }],
          totalAmount: 300000,
          totalItems: 1,
        },
        shippingFee: 30000,
        finalAmount: 330000,
        customerInfo: {
          fullName: 'IPN User',
          email: '',
          phone: '0900000000',
          address: '456 IPN Street',
          note: '',
        },
        status: 'pending',
        ipAddr: '127.0.0.1',
      });

      const req = mockReq({
        body: {
          vnp_TxnRef: 'TESTTXN123',
          vnp_Amount: '33000000',
          vnp_ResponseCode: '00',
          vnp_TransactionNo: '12345678',
          vnp_SecureHash: 'mock',
        },
      });
      const reply = mockReply();
      await VNPayController.handleIpn(req, reply);
      expect(reply._body.RspCode).toBe('00');

      // Verify CartItems are cleared
      const remainingItems = await CartItem.countDocuments({ cartId: testCartId });
      expect(remainingItems).toBe(0);

      // Verify Cart totalAmount is reset
      const cart = await Cart.findById(testCartId);
      expect(cart?.totalAmount).toBe(0);
      expect(cart?.voucherCode).toBeNull();
      expect(cart?.voucherDiscount).toBe(0);

      // Verify PendingPayment is marked completed
      const updated = await PendingPayment.findById(pp._id);
      expect(updated?.status).toBe('completed');
    });
  });
});
