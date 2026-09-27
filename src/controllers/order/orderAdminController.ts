import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { enhanceItemsWithProductData, populateOrderTotals, attachShippingInfo, autoCancelExpiredVNPayOrders, countSoldOnConfirm, cancelOrderWithRestore, paidOrderCancelBlockMessage } from './orderHelpers.ts';
import { RewardService } from '../../services/RewardService.ts';

/**
 * GET /api/orders/admin/orders
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
        $lookup: {
          from: 'payment_methods',
          localField: 'paymentMethodId',
          foreignField: '_id',
          as: 'paymentMethodData',
        },
      },
      {
        $addFields: {
          userId: { $arrayElemAt: ['$user', 0] },
          paymentMethodId: {
            $ifNull: [{ $arrayElemAt: ['$paymentMethodData', 0] }, '$paymentMethodId'],
          },
        },
      },
      { $project: { user: 0, paymentMethodData: 0 } },
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
    orders.forEach((o: any) => attachShippingInfo(o));

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
      .populate('paymentMethodId', 'name code icon')
      .lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
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

/**
 * PATCH /api/orders/admin/:id/status
 * Admin chỉ chuyển đơn tiến theo tuần tự pending → processing → shipped → delivered.
 * Hủy đơn qua PATCH /:id/cancel — backend tự set cancelled.
 */
export async function updateOrderStatus(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
    }

    const orderId = new mongoose.Types.ObjectId(id);
    const existing = await Order.findById(orderId)
      .populate('paymentMethodId', 'code')
      .lean();

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

    // Khi giao hàng thành công (delivered): tự động đánh dấu đã thanh toán.
    // Mốc thời gian giao hàng lấy từ `paid_at` (bảng orders không còn delivered_at).
    const updateData: any = { status };
    if (status === 'delivered' && existing.paymentStatus !== 'paid') {
      updateData.paymentStatus = 'paid';
      updateData.paidAt = new Date();
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      updateData,
      { new: true }
    ).lean();

    // Khi admin xác nhận đơn (pending → processing): cộng lượt bán nếu đơn chưa
    // từng được tính (COD cộng lúc tạo, online cộng lúc thanh toán).
    // Lưu ý: paidAt chỉ được set khi status chuyển sang delivered, không phải đang paid.
    if (status === 'delivered' && order?.userId) {
      try {
        await RewardService.syncMembershipTier(String(order.userId));
      } catch (error) {
        console.warn('Không đồng bộ được lượt quay thành viên:', error);
      }
    }

    if (status === 'processing') {
      await countSoldOnConfirm(orderId, existing);
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
    }

    const orderId = new mongoose.Types.ObjectId(id);

    // Đơn VNPay đã trả tiền vẫn ở status 'pending' cho tới khi admin xác nhận → phải chặn
    // ở đây, nếu không admin hủy đơn đã thu tiền mà hệ thống không có luồng hoàn tiền.
    const target = await Order.findById(orderId).select('paymentStatus').lean();
    const blocked = paidOrderCancelBlockMessage(target);
    if (blocked) {
      return reply.status(400).send({ success: false, message: blocked });
    }

    // CAS status → cancelled trong cancelOrderWithRestore: chỉ luồng thắng mới
    // hoàn kho, hoàn voucher và trừ lượt bán → không thể hoàn kép.
    const order = await cancelOrderWithRestore(orderId, {
      filter: { status: 'pending', paymentStatus: { $ne: 'paid' } },
    });

    if (!order) {
      return reply.status(400).send({ success: false, message: 'Chỉ có thể hủy đơn hàng ở trạng thái Chờ xác nhận' });
    }

    return reply.status(200).send({ success: true, data: order, message: 'Đã hủy đơn hàng' });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message });
  }
}
