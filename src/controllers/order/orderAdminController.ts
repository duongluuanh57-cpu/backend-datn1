import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { UserAddress } from '../../models/UserAddress.ts';
import { Voucher } from '../../models/Voucher.ts';
import { requireAdmin, enhanceItemsWithProductData, recalculateTotalAmount, buildDateFilter, autoCancelExpiredVNPayOrders } from './orderHelpers.ts';

/**
 * GET /api/orders/admin/all
 * Dùng aggregation pipeline thay vì N+1 queries để tối ưu tốc độ
 */
export async function getAllOrdersForAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    await autoCancelExpiredVNPayOrders();

    const query = req.query as {
      page?: string;
      limit?: string;
      status?: string;
      paymentStatus?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      cancelRequested?: string;
      sortBy?: string;
    };

    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '25', 10)));
    const skip = (page - 1) * limit;

    const filter: any = {};

    if (query.status && query.status !== 'all') {
      filter.status = query.status;
      if (query.status === 'pending') {
        filter.cancelRequested = { $ne: true };
      }
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

    const dateFilter = buildDateFilter(query.startDate, query.endDate);
    if (dateFilter) filter.createdAt = dateFilter;

    // ── Filter cancelRequested ──
    if (query.cancelRequested === 'true') {
      filter.cancelRequested = true;
    }

    // ── Sort ──
    let sortObj: any = { createdAt: -1 };
    if (query.sortBy === 'oldest') sortObj = { createdAt: 1 };
    else if (query.sortBy === 'totalAsc') sortObj = { totalAmount: 1 };
    else if (query.sortBy === 'totalDesc') sortObj = { totalAmount: -1 };

    // ── 1 Aggregation query thay cho N+1 ──
    const aggPipeline: any[] = [
      { $match: filter },
      { $sort: sortObj },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'orderitems',
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
    if (!requireAdmin(req, reply)) return;

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
      .lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    const items = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(items);
    order.totalAmount = recalculateTotalAmount(items);
    order.items = items;

    // ── Lấy địa chỉ đầy đủ từ UserAddress ──
    if (order.userId) {
      const userAddress = await UserAddress.findOne({
        userId: (order.userId as any)._id || order.userId,
        isDefault: true,
      }).lean();
      (order as any).userAddress = userAddress || null;
    }

    // ── Lấy thông tin voucher ──
    if (order.voucherId) {
      const voucher = await Voucher.findById(order.voucherId).lean();
      (order as any).voucher = voucher || null;
    }

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

    const orderId = new mongoose.Types.ObjectId(id);
    const existing = await Order.findById(orderId).lean();

    if (!existing) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (existing.cancelRequested) {
      return reply.status(400).send({ success: false, message: 'Đơn hàng đang có yêu cầu hủy — không thể thay đổi trạng thái' });
    }

    // Trạng thái 'cancelled' chỉ có thể được thiết lập thông qua xác nhận yêu cầu hủy, không thể chọn trực tiếp
    if (status === 'cancelled') {
      return reply.status(400).send({ success: false, message: 'Không thể chuyển trực tiếp sang trạng thái hủy' });
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

    const order = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    ).lean();

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
 * PATCH /api/orders/admin/:id/approve-cancel
 * Xác nhận yêu cầu hủy đơn hàng từ user → đơn chuyển sang trạng thái Đã hủy
 */
export async function approveCancelRequest(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };

    const orderId = new mongoose.Types.ObjectId(id);
    const existing = await Order.findById(orderId).lean();

    if (!existing) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (!existing.cancelRequested) {
      return reply.status(400).send({ success: false, message: 'Không có yêu cầu hủy nào' });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      { status: 'cancelled', cancelRequested: false, $unset: { cancelReason: '' } },
      { new: true }
    ).lean();

    return reply.status(200).send({
      success: true,
      data: order,
      message: 'Đã xác nhận hủy đơn hàng',
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
 * PATCH /api/orders/admin/:id/reject-cancel
 * Từ chối yêu cầu hủy đơn hàng từ user
 */
export async function rejectCancelRequest(req: FastifyRequest, reply: FastifyReply) {
  try {
    if (!requireAdmin(req, reply)) return;

    const { id } = req.params as { id: string };

    const orderId = new mongoose.Types.ObjectId(id);
    const existing = await Order.findById(orderId).lean();

    if (!existing) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    if (!existing.cancelRequested) {
      return reply.status(400).send({ success: false, message: 'Không có yêu cầu hủy nào' });
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      { status: 'processing', cancelRequested: false, $unset: { cancelReason: '' } },
      { new: true }
    ).lean();

    if (!order) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng' });
    }

    return reply.status(200).send({
      success: true,
      data: order,
      message: 'Đã từ chối yêu cầu hủy đơn hàng',
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