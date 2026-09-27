import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../../models/User.ts';
import { Order } from '../../../models/Order.ts';
import { OrderItem } from '../../../models/OrderItem.ts';
import { PaymentMethod } from '../../../models/PaymentMethod.ts';
import { cancelOrderWithRestore, markOrderPaid, paidOrderCancelBlockMessage } from '../../../controllers/order/orderHelpers.ts';

const TEST_USER_ID = new mongoose.Types.ObjectId();
let paymentMethodId: mongoose.Types.ObjectId;

async function makeOrder(overrides: any = {}) {
  return Order.create({
    userId: TEST_USER_ID,
    receiveName: 'Cancel Guard',
    receivePhone: '0900000009',
    shippingInfo: { customerName: 'Cancel Guard', customerPhone: '0900000009', customerAddress: '9 Guard Street' },
    totalAmount: 250000,
    shippingFee: 30000,
    status: 'pending',
    paymentMethodId,
    paymentStatus: 'unpaid',
    ...overrides,
  });
}

// Lọc y hệt điều kiện mà orderController.cancelOrder / orderAdminController dùng,
// để test nói thật về hành vi của hai route đó.
const USER_CANCEL_FILTER = { status: 'pending', paymentStatus: { $ne: 'paid' } };

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);
  const codMethod = await PaymentMethod.findOne({ code: 'cod' }).lean();
  if (!codMethod) throw new Error('Test PaymentMethod cod is not configured');
  paymentMethodId = codMethod._id as mongoose.Types.ObjectId;
  await User.deleteMany({ email: 'cancel-guard-test@example.com' });
  await User.create({
    _id: TEST_USER_ID,
    username: `cancel-guard-${TEST_USER_ID.toString().slice(-6)}`,
    email: 'cancel-guard-test@example.com',
  });
});

afterEach(async () => {
  const orders = await Order.find({ userId: TEST_USER_ID });
  for (const o of orders) await OrderItem.deleteMany({ orderId: o._id });
  await Order.deleteMany({ userId: TEST_USER_ID });
});

afterAll(async () => {
  await Order.deleteMany({ userId: TEST_USER_ID });
  await User.deleteMany({ _id: TEST_USER_ID });
});

describe('paidOrderCancelBlockMessage', () => {
  it('chặn đơn đã thu tiền, mở đơn chưa thu', () => {
    expect(paidOrderCancelBlockMessage({ paymentStatus: 'paid' })).toContain('đã được thanh toán');
    expect(paidOrderCancelBlockMessage({ paymentStatus: 'unpaid' })).toBeNull();
    expect(paidOrderCancelBlockMessage(null)).toBeNull();
  });
});

describe('P2: CAS filter không cho hủy đơn đã trả tiền', () => {
  it('đơn paymentStatus=paid → cancelOrderWithRestore trả null, đơn giữ nguyên', async () => {
    const order = await makeOrder({ paymentStatus: 'paid', paidAt: new Date() });

    const cancelled = await cancelOrderWithRestore(order._id, { filter: USER_CANCEL_FILTER });

    expect(cancelled).toBeNull();
    const after = await Order.findById(order._id).lean() as any;
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('paid');
  });

  it('đơn pending chưa thu tiền → vẫn hủy bình thường', async () => {
    const order = await makeOrder();

    const cancelled = await cancelOrderWithRestore(order._id, { filter: USER_CANCEL_FILTER });

    expect(cancelled).toBeTruthy();
    expect((await Order.findById(order._id).lean() as any).status).toBe('cancelled');
  });

  it('hủy đơn đánh dấu phiên VNPay đang chờ hết hiệu lực', async () => {
    const { PendingPayment } = await import('../../../models/PendingPayment.ts');
    const order = await makeOrder();
    const pp = await PendingPayment.create({
      txnRef: `CANCELGUARD${String(Date.now()).slice(-6)}`,
      orderId: order._id,
      userId: TEST_USER_ID,
      cartSnapshot: { items: [], totalAmount: 220000, totalItems: 1 },
      shippingFee: 30000,
      finalAmount: 250000,
      status: 'pending',
      ipAddr: '127.0.0.1',
      clearsCart: false,
    });

    await cancelOrderWithRestore(order._id, { filter: USER_CANCEL_FILTER });
    // PendingPayment update được bắn fire-and-forget → chờ một nhịp trước khi đọc.
    await new Promise((r) => setTimeout(r, 200));

    expect((await PendingPayment.findById(pp._id).lean() as any).status).toBe('expired');
    await PendingPayment.deleteMany({ userId: TEST_USER_ID });
  });
});

describe('P3: markOrderPaid không chốt tiền cho đơn đã hủy', () => {
  it('đơn cancelled → false, vẫn unpaid, không có paidAt', async () => {
    const order = await makeOrder({ status: 'cancelled' });

    const marked = await markOrderPaid(order._id, { txnRef: 'LATEIPN001' });

    expect(marked).toBe(false);
    const after = await Order.findById(order._id).lean() as any;
    expect(after.paymentStatus).toBe('unpaid');
    expect(after.paidAt).toBeUndefined();
    // paymentTxnRef có default '' — quan trọng là nó KHÔNG bị ghi thành mã giao dịch.
    expect(after.paymentTxnRef || '').toBe('');
  });

  it('đơn pending unpaid → true và ghi lại paidAt + mã giao dịch (P4)', async () => {
    const order = await makeOrder();

    const marked = await markOrderPaid(order._id, { txnRef: 'PAIDOK001', transactionCode: '998877' });

    expect(marked).toBe(true);
    const after = await Order.findById(order._id).lean() as any;
    expect(after.paymentStatus).toBe('paid');
    expect(after.paidAt).toBeInstanceOf(Date);
    expect(after.paymentTxnRef).toBe('PAIDOK001');
    expect(after.paymentTransactionCode).toBe('998877');
  });
});
