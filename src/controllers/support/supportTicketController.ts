import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { SupportTicket, TicketStatus } from '../../models/SupportTicket.ts';
import { SupportTicketReply } from '../../models/SupportTicketReply.ts';
import { Order } from '../../models/Order.ts';
import { User } from '../../models/User.ts';
import { ImageService } from '../../services/ImageService.ts';

/**
 * GET /api/support-tickets/my-tickets
 * Lấy danh sách ticket hỗ trợ của người dùng hiện tại
 */
export async function getMyTickets(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
    }

    const { status, orderId } = req.query as { status?: string; orderId?: string };
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (status && status !== 'all' && status !== 'undefined' && status !== 'null') {
      query.status = status;
    }

    if (orderId && mongoose.Types.ObjectId.isValid(orderId) && orderId !== 'undefined' && orderId !== 'null') {
      query.orderId = new mongoose.Types.ObjectId(orderId);
    }

    const tickets = await SupportTicket.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('orderId', 'totalAmount status shippingInfo createdAt')
      .lean();

    // Đính kèm số lượng phản hồi và phản hồi mới nhất cho mỗi ticket
    const enhancedTickets = await Promise.all(
      tickets.map(async (ticket: any) => {
        const replyCount = await SupportTicketReply.countDocuments({ ticketId: ticket._id });
        const lastReply = await SupportTicketReply.findOne({ ticketId: ticket._id })
          .sort({ createdAt: -1 })
          .populate('senderId', 'fullName username role avatar')
          .lean();

        return {
          ...ticket,
          replyCount,
          lastReply,
        };
      })
    );

    return reply.status(200).send({ success: true, data: enhancedTickets });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi lấy danh sách ticket' });
  }
}

/**
 * GET /api/support-tickets/:id
 * Lấy chi tiết 1 ticket kèm toàn bộ các tin nhắn phản hồi
 */
export async function getTicketDetail(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã ticket không hợp lệ' });
    }

    const ticket = await SupportTicket.findById(id)
      .populate('userId', 'fullName username email phoneNumber avatar role')
      .populate('orderId', 'totalAmount status shippingInfo trackingNumber paymentMethod paymentStatus itemsSubtotal shippingFee createdAt')
      .lean();

    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    // Kiểm tra quyền truy cập: Chỉ chủ ticket hoặc Admin mới được xem
    if (role !== 'ADMIN' && (ticket.userId as any)?._id?.toString() !== userId) {
      return reply.status(403).send({ success: false, message: 'Bạn không có quyền xem yêu cầu hỗ trợ này' });
    }

    const replies = await SupportTicketReply.find({ ticketId: ticket._id })
      .sort({ createdAt: 1 })
      .populate('senderId', 'fullName username email avatar role')
      .lean();

    return reply.status(200).send({
      success: true,
      data: {
        ticket,
        replies,
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi lấy thông tin ticket' });
  }
}

/**
 * POST /api/support-tickets
 * Tạo yêu cầu hỗ trợ mới (Support Ticket) cho đơn hàng hoặc chung
 */
export async function createTicket(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
    }

    const { orderId, returnId, ticketType, department, title, message, image } = req.body as {
      orderId?: string;
      returnId?: string;
      ticketType?: string;
      department?: string;
      title: string;
      message: string;
      image?: string;
    };

    if (!title || !title.trim()) {
      return reply.status(400).send({ success: false, message: 'Vui lòng nhập tiêu đề yêu cầu hỗ trợ' });
    }

    if (!message || !message.trim()) {
      return reply.status(400).send({ success: false, message: 'Vui lòng nhập nội dung chi tiết cần hỗ trợ' });
    }

    let validOrderId: mongoose.Types.ObjectId | undefined = undefined;
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      const order = await Order.findById(orderId).lean();
      if (!order) {
        return reply.status(404).send({ success: false, message: 'Đơn hàng không tồn tại' });
      }
      if (req.user?.role !== 'ADMIN' && order.userId.toString() !== userId) {
        return reply.status(403).send({ success: false, message: 'Bạn không có quyền tạo hỗ trợ cho đơn hàng này' });
      }
      validOrderId = new mongoose.Types.ObjectId(orderId);
    }

    const newTicket = await SupportTicket.create({
      userId: new mongoose.Types.ObjectId(userId),
      orderId: validOrderId,
      returnId: returnId && mongoose.Types.ObjectId.isValid(returnId) ? new mongoose.Types.ObjectId(returnId) : undefined,
      ticketType: ticketType || 'order_inquiry',
      department: department || 'cskh',
      title: title.trim(),
      status: 'open',
    });

    const initialReply = await SupportTicketReply.create({
      ticketId: newTicket._id,
      senderId: new mongoose.Types.ObjectId(userId),
      message: message.trim(),
      image: image || '',
    });

    const populatedReply = await SupportTicketReply.findById(initialReply._id)
      .populate('senderId', 'fullName username email avatar role')
      .lean();

    return reply.status(201).send({
      success: true,
      message: 'Gửi yêu cầu hỗ trợ thành công! Đội ngũ tư vấn sẽ phản hồi bạn sớm nhất.',
      data: {
        ticket: newTicket,
        reply: populatedReply,
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi tạo yêu cầu hỗ trợ' });
  }
}

/**
 * POST /api/support-tickets/:id/replies
 * Gửi phản hồi mới vào một ticket hỗ trợ
 */
export async function replyTicket(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user?.userId;
    const role = req.user?.role;
    const { message, image } = req.body as { message?: string; image?: string };

    if (!userId) {
      return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã ticket không hợp lệ' });
    }

    if ((!message || !message.trim()) && !image) {
      return reply.status(400).send({ success: false, message: 'Vui lòng nhập nội dung tin nhắn hoặc đính kèm ảnh' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    if (role !== 'ADMIN' && ticket.userId.toString() !== userId) {
      return reply.status(403).send({ success: false, message: 'Bạn không có quyền gửi tin nhắn trong yêu cầu này' });
    }

    const newReply = await SupportTicketReply.create({
      ticketId: ticket._id,
      senderId: new mongoose.Types.ObjectId(userId),
      message: message ? message.trim() : '',
      image: image || '',
    });

    // Nếu khách hàng phản hồi và ticket đang đóng hoặc đã giải quyết -> mở lại ticket
    if (role !== 'ADMIN') {
      if (ticket.status === 'closed' || ticket.status === 'resolved') {
        ticket.status = 'in_progress';
        ticket.closedAt = undefined;
      }
    } else {
      // Nếu Admin phản hồi và ticket đang là 'open' -> chuyển sang 'in_progress'
      if (ticket.status === 'open') {
        ticket.status = 'in_progress';
      }
    }
    await ticket.save();

    const populatedReply = await SupportTicketReply.findById(newReply._id)
      .populate('senderId', 'fullName username email avatar role')
      .lean();

    return reply.status(201).send({
      success: true,
      message: 'Gửi tin nhắn thành công',
      data: {
        reply: populatedReply,
        ticketStatus: ticket.status,
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi gửi phản hồi' });
  }
}

/**
 * PATCH /api/support-tickets/:id/status
 * Cập nhật trạng thái ticket (Khách hàng đóng ticket hoặc Admin đổi trạng thái)
 */
export async function updateTicketStatus(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user?.userId;
    const role = req.user?.role;
    const { status } = req.body as { status: TicketStatus };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã ticket không hợp lệ' });
    }

    const validStatuses: TicketStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    if (role !== 'ADMIN') {
      if (ticket.userId.toString() !== userId) {
        return reply.status(403).send({ success: false, message: 'Không có quyền cập nhật yêu cầu này' });
      }
      // Khách hàng chỉ được phép đóng hoặc đánh dấu giải quyết
      if (status !== 'closed' && status !== 'resolved') {
        return reply.status(400).send({ success: false, message: 'Khách hàng chỉ có thể đóng yêu cầu hỗ trợ' });
      }
    }

    ticket.status = status;
    if (status === 'closed' || status === 'resolved') {
      ticket.closedAt = new Date();
    } else {
      ticket.closedAt = undefined;
    }

    await ticket.save();

    return reply.status(200).send({
      success: true,
      message: 'Cập nhật trạng thái yêu cầu thành công',
      data: ticket,
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi cập nhật trạng thái' });
  }
}

/**
 * GET /api/support-tickets/admin
 * Admin: Lấy danh sách tất cả các ticket hỗ trợ kèm bộ lọc & phân trang
 */
export async function getAllTicketsAdmin(req: FastifyRequest, reply: FastifyReply) {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      department,
      ticketType,
      search,
    } = req.query as {
      page?: number | string;
      limit?: number | string;
      status?: string;
      department?: string;
      ticketType?: string;
      search?: string;
    };

    const p = Math.max(1, Number(page) || 1);
    const l = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (p - 1) * l;

    const filter: any = {};

    if (status && status !== 'all' && status !== 'undefined' && status !== 'null') {
      filter.status = status;
    }

    if (department && department !== 'all' && department !== 'undefined' && department !== 'null') {
      filter.department = department;
    }

    if (ticketType && ticketType !== 'all' && ticketType !== 'undefined' && ticketType !== 'null') {
      filter.ticketType = ticketType;
    }

    if (search && search.trim() && search.trim() !== 'undefined' && search.trim() !== 'null') {
      const searchRegex = new RegExp(search.trim(), 'i');
      // Tìm user theo username/fullName/email
      const matchedUsers = await User.find({
        $or: [
          { fullName: searchRegex },
          { username: searchRegex },
          { email: searchRegex },
          { phoneNumber: searchRegex },
        ],
      }).select('_id').lean();

      const matchedUserIds = matchedUsers.map((u) => u._id);

      filter.$or = [
        { title: searchRegex },
        { userId: { $in: matchedUserIds } },
      ];

      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        filter.$or.push({ _id: new mongoose.Types.ObjectId(search.trim()) });
        filter.$or.push({ orderId: new mongoose.Types.ObjectId(search.trim()) });
      }
    }

    const total = await SupportTicket.countDocuments(filter);
    const tickets = await SupportTicket.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(l)
      .populate('userId', 'fullName username email phoneNumber avatar role')
      .populate('orderId', 'totalAmount status shippingInfo createdAt')
      .lean();

    const enhancedTickets = await Promise.all(
      tickets.map(async (t: any) => {
        const replyCount = await SupportTicketReply.countDocuments({ ticketId: t._id });
        const lastReply = await SupportTicketReply.findOne({ ticketId: t._id })
          .sort({ createdAt: -1 })
          .populate('senderId', 'fullName username role avatar')
          .lean();

        return {
          ...t,
          replyCount,
          lastReply,
        };
      })
    );

    return reply.status(200).send({
      success: true,
      data: enhancedTickets,
      pagination: {
        page: p,
        limit: l,
        total,
        totalPages: Math.ceil(total / l),
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi lấy danh sách ticket admin' });
  }
}

/**
 * PATCH /api/support-tickets/admin/:id
 * Admin: Cập nhật thông tin / phân công phòng ban / trạng thái ticket
 */
export async function adminUpdateTicket(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const { status, department, ticketType } = req.body as {
      status?: TicketStatus;
      department?: string;
      ticketType?: string;
    };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã ticket không hợp lệ' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    if (status) {
      ticket.status = status;
      if (status === 'closed' || status === 'resolved') {
        ticket.closedAt = new Date();
      } else {
        ticket.closedAt = undefined;
      }
    }

    if (department) ticket.department = department;
    if (ticketType) ticket.ticketType = ticketType;

    await ticket.save();

    return reply.status(200).send({
      success: true,
      message: 'Cập nhật thông tin yêu cầu hỗ trợ thành công',
      data: ticket,
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi cập nhật ticket' });
  }
}

/**
 * POST /api/support-tickets/upload-image
 * Upload hình ảnh đính kèm cho yêu cầu hỗ trợ / tin nhắn
 */
export async function uploadTicketImage(req: FastifyRequest, reply: FastifyReply) {
  try {
    const file = await req.file();
    if (!file) {
      return reply.status(400).send({ success: false, message: 'Không tìm thấy file ảnh' });
    }

    const buffer = await file.toBuffer();
    const result = await ImageService.compressAndUpload(buffer, {
      folder: 'support',
      maxWidth: 1200,
      quality: 85,
    });

    return reply.status(200).send({ success: true, data: { url: result.url } });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi upload ảnh' });
  }
}

