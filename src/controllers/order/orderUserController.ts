import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { User } from '../../models/User.ts';
import { enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter } from './orderHelpers.ts';

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
