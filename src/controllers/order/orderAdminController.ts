import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { Payment } from '../../models/Payment.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { enhanceItemsWithProductData, populateOrderTotals, autoCancelExpiredVNPayOrders, markSoldCounted, unmarkSoldCounted } from './orderHelpers.ts';

/**
 * GET /api/orders/admin/all
 * Dùng aggregation pipeline thay vì N+1 queries để tối ưu tốc độ
 */
export async function getAllOrdersForAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    await autoCancelExpiredVNPayOrders();

    const query = req.query as {
      page?: string;
      limit?: string;
      status?: string;
      paymentStatus?: string;
      search?: string;
    };

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '25', 10)));
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    } else {
      // Mặc định ẩn đơn đã hủy — chỉ hiện khi lọc theo trạng thái 'cancelled'
      filter.status = { $ne: 'cancelled' };
    }

    if (query.paymentStatus && query.paymentStatus !== 'all') {
      filter.paymentStatus = query.paymentStatus;
    }

    if (query.search) {
      const searchStr = query.search.replace(/^#/, '').trim();
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      if (mongoose.Types.ObjectId.isValid(searchStr)) {
        filter._id = new mongoose.Types.ObjectId(searchStr);
      } else {
        filter.$expr = {
          $regexMatch: {
            input: { $toString: '$_id' },
            regex: esc(searchStr),
            options: 'i'
          }
        };
      }
    }

    // ── 1 Aggregation query thay cho N+1 ──
    const aggPipeline: any[] = [
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'order_items',
          localField: '_id',
          foreignField: 'orderId',
          as: 'items',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          pipeline: [{ $project: { username: 1, email: 1 } }],
          as: 'user',
        },
      },
      {
        $addFields: {
          userId: { $arrayElemAt: ['$user', 0] },
        },
      },
      { $project: { user: 0 } },
    ];

    const [orders, total] = await Promise.all([
      Order.aggregate(aggPipeline),
      Order.countDocuments(filter),
    ]);

    // ── Enhance items with product data (1 batch query, không N+1) ──
    const allItems = orders.flatMap((o: any) => o.items || []);
    if (allItems.length > 0) {
      await enhanceItemsWithProductData(allItems);
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
    await autoCancelExpiredVNPayOrders();

    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
    }

    const order = await Order.findOne({
      _id: new mongoose.Types.ObjectId(id),
    })
      .populate('userId', 'username email phoneNumber fullName gender avatar')
      .populate('voucherId')
      .populate('shippingMethodId')
      .lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    const items = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(items);
    populateOrderTotals(order, items);
    order.items = items;

    return reply.status(200).send({ success: true, data: order });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}

/**
 * PATCH /api/orders/admin/:id/status
 * Admin chỉ chuyển đơn tiến theo tuần tự pending → processing → shipped → delivered.
 * Hủy đơn qua PATCH /:id/cancel — backend tự set cancelled.
 */
export async function updateOrderStatus(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };

    const orderId = new mongoose.Types.ObjectId(id);
    const existing = await Order.findById(orderId).lean();

    if (!existing) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    // Nếu trạng thái hiện tại là final (delivered hoặc cancelled), không cho phép thay đổi nữa
    if (existing.status === 'delivered' || existing.status === 'cancelled') {
      return reply.status(400).send({ success: false, message: 'Đơn hàng đã hoàn thành hoặc đã hủy, không thể thay đổi trạng thái' });
    }

    // Kiểm tra tính hợp lệ của việc chuyển đổi trạng thái (chỉ tiến không lùi)
    const statusSequence = ['pending', 'processing', 'shipped', 'delivered'];
    const currentIndex = statusSequence.indexOf(existing.status);
    const targetIndex = statusSequence.indexOf(status);

    if (currentIndex === -1 || targetIndex === -1 || targetIndex !== currentIndex + 1) {
      return reply.status(400).send({
        success: false,
        message: `Trạng thái chuyển đổi không hợp lệ. Chỉ có thể chuyển tiếp từ "${statusSequence[currentIndex]}" sang "${statusSequence[currentIndex + 1]}"`
      });
    }

    // Khi giao hàng thành công (delivered): tự động đánh dấu đã thanh toán
    const updateData: any = { status };
    if (status === 'delivered') {
      updateData.paymentStatus = 'paid';
      updateData.deliveredAt = new Date();
      await Payment.updateMany(
        { orderId: orderId },
        { $set: { status: 'paid', paidAt: new Date() } }
      );
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    ).lean();

    // Khi admin xác nhận đơn (pending → processing): cộng lượt bán
    if (status === 'processing') {
      await markSoldCounted(orderId);
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
 * PATCH /api/orders/admin/:id/cancel
 * Admin hủy đơn hàng đang chờ xác nhận
 */
export async function cancelOrderByAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const orderId = new mongoose.Types.ObjectId(id);

    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { new: true }
    ).lean();

    if (!order) {
      return reply.status(400).send({ success: false, message: 'Chỉ có thể hủy đơn hàng ở trạng thái Chờ xác nhận' });
    }

    await unmarkSoldCounted(orderId);

    // Hoàn kho + hoàn voucher (idempotent)
    const { StockService } = await import('../../services/cart/StockService.ts');
    await StockService.restoreOrderResources(orderId);

    return reply.status(200).send({ success: true, data: order, message: 'Đã hủy đơn hàng' });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}
