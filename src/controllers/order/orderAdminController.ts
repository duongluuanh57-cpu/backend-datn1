import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { requireAdmin, enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter } from './orderHelpers.ts';

/**
 * GET /api/orders/admin/all
 */
export async function getAllOrdersForAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const query = req.query as {
      page?: string;
      limit?: string;
      status?: string;
      paymentStatus?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '25', 10)));
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    }

    if (query.paymentStatus && query.paymentStatus !== 'all') {
      filter.paymentStatus = query.paymentStatus;
    }

    if (query.search) {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { customerName: { $regex: '^' + esc(query.search), $options: 'i' } },
        { customerEmail: { $regex: '^' + esc(query.search), $options: 'i' } },
        { customerPhone: { $regex: '^' + esc(query.search), $options: 'i' } },
      ];
    }

    const dateFilter = buildDateFilter(query.startDate, query.endDate);
    if (dateFilter) filter.createdAt = dateFilter;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate('userId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    for (const order of orders) {
      const items = await OrderItem.find({ orderId: order._id }).lean();
      if (items.length > 0) {
        await enhanceItemsWithProductData(items);
        order.totalAmount = recalculateTotalAmount(items);
      }
      order.items = items;
    }

    return reply.status(200).send({
      success: true,
      data: {
        orders,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * GET /api/orders/admin/:id
 */
export async function getOrderByIdForAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
    })
      .populate('userId', 'username email phoneNumber fullName')
      .lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
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

/**
 * PATCH /api/orders/admin/:id/status
 */
export async function updateOrderStatus(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };

    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const order = await Order.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id) },
      { status },
      { new: true }
    ).lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    return reply.status(200).send({
      success: true,
      data: order,
      message: 'Cập nhật trạng thái đơn hàng thành công',
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * PATCH /api/orders/admin/:id/payment-status
 */
export async function updatePaymentStatus(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };
    const { paymentStatus } = req.body as { paymentStatus: string };

    const validPaymentStatuses = ['unpaid', 'paid', 'refunded'];
    if (!validPaymentStatuses.includes(paymentStatus)) {
      return reply.status(400).send({ success: false, message: 'Trạng thái thanh toán không hợp lệ' });
    }

    const order = await Order.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id) },
      { paymentStatus },
      { new: true }
    ).lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    return reply.status(200).send({
      success: true,
      data: order,
      message: 'Cập nhật trạng thái thanh toán thành công',
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * DELETE /api/orders/admin/:id
 */
export async function deleteOrder(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };

    await OrderItem.deleteMany({ orderId: new mongoose.Types.ObjectId(id) });

    const order = await Order.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(id),
    });

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    return reply.status(200).send({ success: true, message: 'Xóa đơn hàng thành công' });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}