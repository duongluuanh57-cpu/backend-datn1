import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { User } from '../../models/User.ts';
import { enhanceItemsWithProductData, populateOrderTotals, attachShippingInfo, autoCancelExpiredVNPayOrders, cancelOrderWithRestore, paidOrderCancelBlockMessage } from './orderHelpers.ts';
import { StockService } from '../../services/cart/StockService.ts';

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

    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('voucherId')
      .populate('paymentMethodId', 'name code icon')
      .lean();

    for (const order of orders) {
      const items = await OrderItem.find({ orderId: order._id }).lean();
      if (items.length > 0) {
        await enhanceItemsWithProductData(items);
        populateOrderTotals(order, items);
      }
      attachShippingInfo(order);
      order.items = items;
    }

    return reply.status(200).send({ success: true, data: orders });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * PATCH /api/orders/:id/cancel
 * User tự hủy đơn hàng — chỉ cho phép khi đơn đang pending, kèm lý do (tùy chọn)
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

    const blocked = paidOrderCancelBlockMessage(order);
    if (blocked) {
      return reply.status(400).send({ success: false, message: blocked });
    }

    // Hủy theo CAS status → cancelled: hoàn kho + hoàn voucher + trừ lượt bán
    // chỉ chạy ở luồng thắng, nên bấm hủy 2 lần không thể hoàn kép.
    const cancelled = await cancelOrderWithRestore(order._id, {
      filter: { status: 'pending', paymentStatus: { $ne: 'paid' }, userId: new mongoose.Types.ObjectId(userId) },
    });

    if (!cancelled) {
      return reply.status(400).send({
        success: false,
        message: 'Chỉ có thể hủy đơn hàng ở trạng thái Chờ xác nhận',
      });
    }

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
    })
      .populate('voucherId')
      .populate('paymentMethodId', 'name code icon')
      .lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Khong tim thay don hang cua ban' });
    }

    const items = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(items);
    populateOrderTotals(order, items);
    attachShippingInfo(order);
    order.items = items;

    return reply.status(200).send({ success: true, data: order });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}
