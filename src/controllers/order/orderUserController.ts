import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { Payment } from '../../models/Payment.ts';
import { User } from '../../models/User.ts';
import { enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter, autoCancelExpiredVNPayOrders } from './orderHelpers.ts';

/**
 * GET /api/orders/my-orders
 * Lay lich su mua sam cua user dang dang nhap
 */
export async function getMyOrders(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) {
      return reply.status(401).send({
        success: false,
        message: 'Vui long dang nhap de tiep tuc',
      });
    }

    await autoCancelExpiredVNPayOrders(userId);

    const user = await User.findById(userId).lean();
    if (!user) {
      return reply.status(404).send({
        success: false,
        message: 'Nguoi dung khong ton tai',
      });
    }

    const { startDate, endDate, status } = req.query as { startDate?: string; endDate?: string; status?: string };
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    const dateFilter = buildDateFilter(startDate, endDate);
    if (dateFilter) query.createdAt = dateFilter;

    if (status && status !== 'all') {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .lean();

    for (const order of orders) {
const items = await OrderItem.find({ orderId: order._id }).lean();
      if (items.length > 0) {
        await enhanceItemsWithProductData(items);
        order.totalAmount = recalculateTotalAmount(items);
      }
      order.items = items;
    }

    return reply.status(200).send({ success: true, data: orders });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * GET /api/orders/:id
 */
/**
 * GET /api/orders/by-txn-ref/:txnRef
 * Tra cứu đơn hàng theo mã giao dịch VNPAY (txnRef)
 * Public endpoint — txnRef là random unique ID, không cần auth
 */
export async function getOrderByTxnRef(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { txnRef } = req.params as { txnRef: string };

    if (!txnRef) {
      return reply.status(400).send({ success: false, message: 'Thiếu mã giao dịch' });
    }

    const paymentRecord = await Payment.findOne({ txnRef }).lean();
    const order = paymentRecord
      ? await Order.findById(paymentRecord.orderId).lean()
      : await Order.findOne({ _id: mongoose.Types.ObjectId.isValid(txnRef) ? txnRef : null }).lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng', data: { found: false } });
    }

    const items = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(items);
    order.totalAmount = recalculateTotalAmount(items);
    (order as any).items = items;

    return reply.status(200).send({ success: true, data: order });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * PATCH /api/orders/:id/cancel
 * User gửi yêu cầu hủy đơn hàng — chỉ cho phép khi đơn đang pending
 * Không hủy luôn, chỉ đánh dấu cancelRequested để admin xử lý
 */
export async function cancelOrder(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params as { id: string };

    if (!userId) {
      return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng của bạn' });
    }

    if (order.status !== 'pending') {
      return reply.status(400).send({
        success: false,
        message: 'Chỉ có thể hủy đơn hàng ở trạng thái Chờ xác nhận',
      });
    }

    if (order.cancelRequested) {
      return reply.status(400).send({
        success: false,
        message: 'Đơn hàng đang chờ xử lý hủy',
      });
    }

    const { cancelReason } = (req.body || {}) as { cancelReason?: string };
    const validReasons = ['want_change_voucher', 'want_change_product', 'complicated_payment', 'found_cheaper', 'changed_mind'];

    if (cancelReason && validReasons.includes(cancelReason)) {
      order.cancelReason = cancelReason as any;
    }

    order.status = 'cancelled';
    order.cancelRequested = false;
    await order.save();

    return reply.status(200).send({ success: true, message: 'Hủy đơn hàng thành công' });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

export async function getOrderById(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = (req as any).user?.userId;
    const { id } = req.params as { id: string };

    if (!userId) {
      return reply.status(401).send({
        success: false,
        message: 'Vui long dang nhap de tiep tuc',
      });
    }

    await autoCancelExpiredVNPayOrders(userId);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Ma don hang khong hop le' });
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(userId),
    }).lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Khong tim thay don hang cua ban' });
    }

    const items = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(items);
    order.totalAmount = recalculateTotalAmount(items);
    order.items = items;

    return reply.status(200).send({ success: true, data: order });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}
