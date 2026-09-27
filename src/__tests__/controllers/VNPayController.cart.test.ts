import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { VNPayController } from '../../controllers/VNPayController.ts';
import CartItem from '../../models/CartItem.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { PendingPayment } from '../../models/PendingPayment.ts';
import { User } from '../../models/User.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { UserAddress } from '../../models/UserAddress.ts';
import { PaymentMethod } from '../../models/PaymentMethod.ts';
import { verifyIpnResponse } from '../../services/VNPayService.ts';

// Payment model đã bị gỡ — thông tin giao dịch giờ nằm trên Order
// import { Payment } from '../../models/Payment.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_BRAND_ID = new mongoose.Types.ObjectId();
let testProductId: mongoose.Types.ObjectId;
let variant50Id: mongoose.Types.ObjectId;
let vnpayPaymentMethodId: mongoose.Types.ObjectId;

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
  // Create user only once; ensure clean slate
  await User.deleteMany({ email: 'vnpay-test@example.com' });
  await User.create({
    _id: TEST_USER_ID,
    username: `vnpay-test-${TEST_USER_ID.toString().slice(-6)}`,
    email: 'vnpay-test@example.com',
  });
  const vnpayMethod = await PaymentMethod.findOne({ code: 'vnpay' }).lean();
  if (!vnpayMethod) throw new Error('Test PaymentMethod vnpay is not configured');
  vnpayPaymentMethodId = vnpayMethod._id as mongoose.Types.ObjectId;
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
    categoryId: new mongoose.Types.ObjectId(),
    description: 'Test for VNPay',
  });
  testProductId = product._id as mongoose.Types.ObjectId;
  const variant = await ProductVariant.create({
    productId: testProductId,
    size: '50ml',
    price: 500000,
    quantityInStock: 10,
    isDefault: true,
  });
  variant50Id = variant._id as mongoose.Types.ObjectId;
  // Create user address for checkout
  await UserAddress.create({
    userId: TEST_USER_ID,
    fullName: 'Test User',
    phoneNumber: '0900000000',
    email: 'vnpay-test@example.com',
    address: '123 Test Street',
    ward: 'Ward',
    district: 'District',
    city: 'City',
    province: 'Province',
    isDefault: true,
  });
});

afterAll(async () => {
  try {
    await CartItem.deleteMany({ userId: TEST_USER_ID });
    await PendingPayment.deleteMany({ userId: TEST_USER_ID });
    await Order.deleteMany({ userId: TEST_USER_ID });
    await User.deleteMany({ _id: TEST_USER_ID });
    await Product.deleteMany({ _id: testProductId });
    await ProductVariant.deleteMany({ productId: testProductId });
    await mongoose.connection.db!.collection('brands').deleteMany({ _id: TEST_BRAND_ID });
  } catch (e) {
    // ignore cleanup errors
  }
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
}  describe('VNPayController — cart_items integration', () => {
  const mockMongooseError = new mongoose.MongooseError('buffering timed out');

  afterEach(async () => {
    await CartItem.deleteMany({ userId: TEST_USER_ID });
    await PendingPayment.deleteMany({ userId: TEST_USER_ID });
    const orders = await Order.find({ userId: TEST_USER_ID });
    for (const o of orders) {
      await OrderItem.deleteMany({ orderId: o._id });
    }
    await Order.deleteMany({ userId: TEST_USER_ID });
  });

  describe('preparePayment — dùng chung pipeline với COD', () => {
    it('tạo Order + PendingPayment gắn orderId, không nhân bản địa chỉ', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });

      const req = mockReq({
        body: {
          customerName: 'Test User',
          customerPhone: '0900000000',
          customerAddress: '123 Test Street',
          note: 'Giao buổi sáng',
          userAddressId: new mongoose.Types.ObjectId().toString(), // Provide required address ID
        },
      });
      const reply = mockReply();
      await VNPayController.preparePayment(req, reply);

      expect(reply._body.success).toBe(true);
      expect(reply._body.data.txnRef).toBeDefined();
      expect(reply._body.data.paymentUrl).toBeDefined();

      const pp = await PendingPayment.findOne({ userId: TEST_USER_ID, status: 'pending' });
      expect(pp).toBeDefined();
      // Địa chỉ chỉ tồn tại ở Order.shippingInfo, không lưu trên PendingPayment
      expect(pp?.customerInfo?.fullName).toBeUndefined();
      expect(pp?.cartSnapshot.items.length).toBe(1);
      expect(pp?.cartSnapshot.items[0].name).toBe('VNPay Test Product');
      expect(pp?.cartSnapshot.totalAmount).toBe(500000);
      expect(pp?.cartSnapshot.totalItems).toBe(1);

      const order = await Order.findById(pp?.orderId).lean() as any;
      expect(order).toBeTruthy();
      expect(order.shippingInfo.customerName).toBe('Test User');
      expect(order.shippingInfo.customerPhone).toBe('0900000000');
      expect(order.shippingInfo.customerAddress).toContain('123 Test Street');
      expect(order.note).toBe('Giao buổi sáng');
      expect(order.shippingInfo.customerEmail).toBe('vnpay-test@example.com');
      expect(order.paymentMethodId).toBeDefined();
      expect(order.paymentStatus).toBe('unpaid');
    });

    it('từ chối khi giỏ hàng trống', async () => {
      const req = mockReq({
        body: {
          customerName: 'Test User',
          customerPhone: '0900000000',
          customerAddress: '123 Test Street',
        },
      });
      const reply = mockReply();
      await VNPayController.preparePayment(req, reply);
      expect(reply._body.success).toBe(false);
      // Message changed to address requirement instead of "giỏ hàng trống"
      expect(reply._body.message).toContain('Giỏ hàng trống');
    });
  });

  describe('handleIpn — chốt đơn đã tạo sẵn', () => {
    it('đánh dấu Order đã trả tiền, xoá giỏ và không tạo Payment trùng', async () => {
      await CartItem.create({
        userId: TEST_USER_ID,
        productVariantId: variant50Id,
        price: 500000,
        quantity: 1,
      });

      const order = await Order.create({
        userId: TEST_USER_ID,
        receiveName: 'Test Receive Name',
        receivePhone: '0123456789',
        shippingInfo: {
          customerName: 'IPN User',
          customerPhone: '0900000000',
          customerAddress: '456 IPN Street',
        },
        totalAmount: 330000,
        shippingFee: 30000,
        status: 'pending',
        paymentMethodId: vnpayPaymentMethodId,
        paymentStatus: 'unpaid',
      });

      // Payment table removed — order.payment_txn_ref already set
      const pp = await PendingPayment.create({
        txnRef: 'TESTTXN123',
        orderId: order._id,
        userId: TEST_USER_ID,
        cartSnapshot: {
          items: [{ productId: testProductId, name: 'IPN Test Item', price: 500000, quantity: 1 }],
          totalAmount: 300000,
          totalItems: 1,
        },
        shippingFee: 30000,
        finalAmount: 330000,
        status: 'pending',
        ipAddr: '127.0.0.1',
        clearsCart: true,
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

      const updatedOrder = await Order.findById(order._id).lean() as any;
      expect(updatedOrder.paymentStatus).toBe('paid');

      // clearsCart = true → xoá sạch cart_items của user
      expect(await CartItem.countDocuments({ userId: TEST_USER_ID })).toBe(0);

      const updatedPp = await PendingPayment.findById(pp._id);
      expect(updatedPp?.status).toBe('completed');

      // P4: paidAt + 2 mã giao dịch phải thật sự nằm trong schema. Trước đây cả ba
      // đường này KHÔNG được khai báo trong Order schema → Mongoose strict mode âm
      // thầm vứt $set, đơn trả tiền rồi vẫn không có paidAt và findOne({paymentTxnRef})
      // không bao giờ khớp.
      expect(updatedOrder.paidAt).toBeInstanceOf(Date);
      expect(updatedOrder.paymentTxnRef).toBe('TESTTXN123');
      expect(updatedOrder.paymentTransactionCode).toBe('12345678');
      expect(updatedOrder.paymentMethodId).toBeDefined();
      expect(updatedOrder.paymentStatus).toBe('paid');
      expect(updatedOrder?.bank_code).toBeUndefined();
    });

    it('REGRESSION P3: IPN về muộn trên đơn đã hủy → không chốt paid, phiên chờ hết hiệu lực', async () => {
      const order = await Order.create({
        userId: TEST_USER_ID,
        receiveName: 'Test Receive Name',
        receivePhone: '0123456789',
        shippingInfo: {
          customerName: 'IPN User',
          customerPhone: '0900000000',
          customerAddress: '456 IPN Street',
        },
        totalAmount: 330000,
        shippingFee: 30000,
        status: 'cancelled',
        paymentMethodId: vnpayPaymentMethodId,
        paymentStatus: 'unpaid',
      });
      const pp = await PendingPayment.create({
        txnRef: 'LATECANCELLED01',
        orderId: order._id,
        userId: TEST_USER_ID,
        cartSnapshot: { items: [], totalAmount: 300000, totalItems: 1 },
        shippingFee: 30000,
        finalAmount: 330000,
        status: 'pending',
        ipAddr: '127.0.0.1',
        clearsCart: false,
      });

      vi.mocked(verifyIpnResponse).mockReturnValueOnce({
        isValid: true,
        txnRef: 'LATECANCELLED01',
        amount: 330000,
        transactionNo: '12345678',
        responseCode: '00',
      } as any);

      const req = mockReq({
        body: {
          vnp_TxnRef: 'LATECANCELLED01',
          vnp_Amount: '33000000',
          vnp_ResponseCode: '00',
          vnp_TransactionNo: '12345678',
          vnp_SecureHash: 'mock',
        },
      });
      const reply = mockReply();
      await VNPayController.handleIpn(req, reply);

      // Khách trả tiền lúc đơn đã auto-hủy: báo 09 để VNPay đối soát hoàn tiền,
      // tuyệt đối không biến đơn cancelled thành paid (không giao hàng nữa).
      expect(reply._body.RspCode).toBe('09');
      const after = await Order.findById(order._id).lean() as any;
      expect(after.status).toBe('cancelled');
      expect(after.paymentStatus).toBe('unpaid');
      expect(after.paidAt).toBeUndefined();
      expect((await PendingPayment.findById(pp._id).lean() as any).status).toBe('expired');
    });

    it('REGRESSION P5: số tiền VNPay báo về không khớp đơn → RspCode 04, không chốt paid', async () => {
      const order = await Order.create({
        userId: TEST_USER_ID,
        receiveName: 'Test Receive Name',
        receivePhone: '0123456789',
        shippingInfo: {
          customerName: 'IPN User',
          customerPhone: '0900000000',
          customerAddress: '456 IPN Street',
        },
        totalAmount: 330000,
        shippingFee: 30000,
        status: 'pending',
        paymentMethodId: vnpayPaymentMethodId,
        paymentStatus: 'unpaid',
      });
      await PendingPayment.create({
        txnRef: 'WRONGAMOUNT01',
        orderId: order._id,
        userId: TEST_USER_ID,
        cartSnapshot: { items: [], totalAmount: 300000, totalItems: 1 },
        shippingFee: 30000,
        finalAmount: 330000,
        status: 'pending',
        ipAddr: '127.0.0.1',
        clearsCart: false,
      });

      vi.mocked(verifyIpnResponse).mockReturnValueOnce({
        isValid: true,
        txnRef: 'WRONGAMOUNT01',
        amount: 1000, // chỉ 1.000đ thay vì 330.000đ
        transactionNo: '12345678',
        responseCode: '00',
      } as any);

      const req = mockReq({
        body: {
          vnp_TxnRef: 'WRONGAMOUNT01',
          vnp_Amount: '100000',
          vnp_ResponseCode: '00',
          vnp_TransactionNo: '12345678',
          vnp_SecureHash: 'mock',
        },
      });
      const reply = mockReply();
      await VNPayController.handleIpn(req, reply);

      expect(reply._body.RspCode).toBe('04');
      expect((await Order.findById(order._id).lean() as any).paymentStatus).toBe('unpaid');
    });
  });
});
