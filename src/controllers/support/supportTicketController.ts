import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { SupportTicket, ISupportTicket, TicketStatus } from '../../models/SupportTicket.ts';
import { SupportTicketReply } from '../../models/SupportTicketReply.ts';
import { Order } from '../../models/Order.ts';
import { User } from '../../models/User.ts';
import { ImageService } from '../../services/ImageService.ts';

// Trạng thái chỉ đi tới: open -> in_progress -> closed (không quay lại)
const STATUS_RANK: Record<TicketStatus, number> = { open: 0, in_progress: 1, closed: 2 };

function isBackwardStatusMove(from: TicketStatus, to: TicketStatus) {
  return STATUS_RANK[to] < STATUS_RANK[from];
}

function applyStatus(ticket: ISupportTicket, status: TicketStatus) {
  ticket.status = status;
  ticket.closedAt = status === 'closed' ? new Date() : undefined;
}

/** Gắn replyCount + lastReply cho danh sách ticket bằng đúng 1 query */
// ponytail: tải toàn bộ replies của trang để đếm — đổi sang aggregate $facet nếu thread dài
async function attachReplyMeta<T extends { _id: mongoose.Types.ObjectId }>(tickets: T[]) {
  const replies = tickets.length
    ? await SupportTicketReply.find({ ticketId: { $in: tickets.map((t) => t._id) } })
        .sort({ createdAt: -1 })
        .populate('senderId', 'fullName username role avatar')
        .lean()
    : [];

  const meta = new Map<string, { replyCount: number; lastReply: any }>();
  for (const r of replies) {
    const key = String(r.ticketId);
    const entry = meta.get(key);
    if (entry) entry.replyCount++;
    else meta.set(key, { replyCount: 1, lastReply: r });
  }

  return tickets.map((t) => ({
    ...t,
    replyCount: meta.get(String(t._id))?.replyCount ?? 0,
    lastReply: meta.get(String(t._id))?.lastReply ?? null,
  }));
}

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

    const { orderId } = req.query as { orderId?: string };
    const query: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      query.orderId = new mongoose.Types.ObjectId(orderId);
    }

    const tickets = await SupportTicket.find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('orderId', 'totalAmount status')
      .lean();

    return reply.status(200).send({ success: true, data: await attachReplyMeta(tickets) });
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
      .populate('orderId', 'totalAmount status')
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

    return reply.status(200).send({ success: true, data: { ticket, replies } });
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

    const { orderId, ticketType, department, title, message, image } = req.body as {
      orderId?: string;
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

    return reply.status(201).send({
      success: true,
      message: 'Gửi yêu cầu hỗ trợ thành công! Đội ngũ tư vấn sẽ phản hồi bạn sớm nhất.',
      data: {
        ticket: newTicket,
        reply: await initialReply.populate('senderId', 'fullName username email avatar role'),
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi tạo yêu cầu hỗ trợ' });
  }
}

/**
 * POST /api/support-tickets/guest
 * Khách không đăng nhập gửi liên hệ từ trang Contact -> tạo ticket cho Admin
 */
export async function createGuestTicket(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { fullName, email, phone, subject, message } = req.body as {
      fullName?: string;
      email?: string;
      phone?: string;
      subject?: string;
      message?: string;
    };

    if (!fullName?.trim() || !email?.trim() || !message?.trim()) {
      return reply.status(400).send({ success: false, message: 'Vui lòng điền đầy đủ họ tên, email và nội dung' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return reply.status(400).send({ success: false, message: 'Email không hợp lệ' });
    }

    const newTicket = await SupportTicket.create({
      title: (subject?.trim() || 'Liên hệ từ trang Contact').slice(0, 200),
      ticketType: 'other',
      department: 'general',
      status: 'open',
    });

    await SupportTicketReply.create({
      ticketId: newTicket._id,
      senderId: null,
      message: `[Khách vãng lai] ${fullName.trim()} - ${email.trim()}${phone?.trim() ? ` - ${phone.trim()}` : ''}\n\n${message.trim()}`,
    });

    return reply.status(201).send({
      success: true,
      message: 'Gửi liên hệ thành công! Đội ngũ tư vấn sẽ phản hồi bạn sớm nhất.',
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi gửi yêu cầu hỗ trợ' });
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

    if (role !== 'ADMIN' && ticket.userId?.toString() !== userId) {
      return reply.status(403).send({ success: false, message: 'Bạn không có quyền gửi tin nhắn trong yêu cầu này' });
    }

    // Ticket đã đóng -> kết thúc hội thoại, muốn tiếp khách phải mở lại (1 lần) hoặc tạo ticket mới
    if (ticket.status === 'closed') {
      return reply.status(400).send({
        success: false,
        message: role === 'ADMIN'
          ? 'Yêu cầu đã kết thúc. Chuyển trạng thái nếu muốn tiếp tục.'
          : 'Yêu cầu đã kết thúc. Vui lòng mở lại yêu cầu để tiếp tục trao đổi.',
      });
    }

    const newReply = await SupportTicketReply.create({
      ticketId: ticket._id,
      senderId: new mongoose.Types.ObjectId(userId),
      message: message ? message.trim() : '',
      image: image || '',
    });

    // Admin phản hồi vào ticket 'open' -> chuyển 'in_progress'
    if (role === 'ADMIN' && ticket.status === 'open') {
      applyStatus(ticket, 'in_progress');
      await ticket.save();
    }

    return reply.status(201).send({
      success: true,
      message: 'Gửi tin nhắn thành công',
      data: {
        reply: await newReply.populate('senderId', 'fullName username email avatar role'),
        ticketStatus: ticket.status,
      },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi khi gửi phản hồi' });
  }
}

/**
 * PATCH /api/support-tickets/:id/status
 * Cập nhật trạng thái ticket (Khách hàng đóng/mở lại ticket hoặc Admin đổi trạng thái)
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

    const validStatuses: TicketStatus[] = ['open', 'in_progress', 'closed'];
    if (!validStatuses.includes(status)) {
      return reply.status(400).send({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    if (role !== 'ADMIN') {
      if (ticket.userId?.toString() !== userId) {
        return reply.status(403).send({ success: false, message: 'Không có quyền cập nhật yêu cầu này' });
      }
      if (ticket.status === 'closed') {
        // Ticket đã kết thúc -> khách chỉ được mở lại đúng 1 lần
        if (ticket.reopened || status !== 'in_progress') {
          return reply.status(400).send({
            success: false,
            message: ticket.reopened
              ? 'Yêu cầu chỉ được mở lại 1 lần. Vui lòng tạo yêu cầu mới.'
              : 'Khách hàng chỉ có thể mở lại yêu cầu hỗ trợ',
          });
        }
        ticket.reopened = true;
      } else if (status !== 'closed') {
        return reply.status(400).send({ success: false, message: 'Khách hàng chỉ có thể đóng yêu cầu hỗ trợ' });
      }
    } else if (isBackwardStatusMove(ticket.status, status)) {
      return reply.status(400).send({ success: false, message: 'Trạng thái chỉ chuyển theo chiều tiến, không quay lại' });
    }

    applyStatus(ticket, status);
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
    const { page = 1, limit = 20, status, department, search } = req.query as {
      page?: number | string;
      limit?: number | string;
      status?: string;
      department?: string;
      search?: string;
    };

    const p = Math.max(1, Number(page) || 1);
    const l = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (p - 1) * l;

    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (department && department !== 'all') filter.department = department;

    const trimmed = search?.trim();
    if (trimmed) {
      const searchRegex = new RegExp(trimmed, 'i');
      const matchedUsers = await User.find({
        $or: [
          { fullName: searchRegex },
          { username: searchRegex },
          { email: searchRegex },
          { phoneNumber: searchRegex },
        ],
      })
        .select('_id')
        .lean();

      filter.$or = [{ title: searchRegex }, { userId: { $in: matchedUsers.map((u) => u._id) } }];

      if (mongoose.Types.ObjectId.isValid(trimmed)) {
        filter.$or.push({ _id: new mongoose.Types.ObjectId(trimmed) }, { orderId: new mongoose.Types.ObjectId(trimmed) });
      }
    }

    const total = await SupportTicket.countDocuments(filter);
    const tickets = await SupportTicket.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(l)
      .populate('userId', 'fullName username email phoneNumber avatar role')
      .populate('orderId', 'totalAmount status')
      .lean();

    return reply.status(200).send({
      success: true,
      data: await attachReplyMeta(tickets),
      pagination: { page: p, limit: l, total, totalPages: Math.ceil(total / l) },
    });
  } catch (error: any) {
    return reply.status(500).send({ success: false, message: error.message || 'Lỗi lấy danh sách ticket admin' });
  }
}

/**
 * PATCH /api/support-tickets/admin/:id
 * Admin: Cập nhật trạng thái / phân công phòng ban ticket
 */
export async function adminUpdateTicket(req: FastifyRequest, reply: FastifyReply) {
  try {
    const { id } = req.params as { id: string };
    const { status, department } = req.body as { status?: TicketStatus; department?: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.status(400).send({ success: false, message: 'Mã ticket không hợp lệ' });
    }

    const ticket = await SupportTicket.findById(id);
    if (!ticket) {
      return reply.status(404).send({ success: false, message: 'Không tìm thấy yêu cầu hỗ trợ' });
    }

    if (status) {
      if (isBackwardStatusMove(ticket.status, status)) {
        return reply.status(400).send({ success: false, message: 'Trạng thái chỉ chuyển theo chiều tiến, không quay lại' });
      }
      applyStatus(ticket, status);
    }
    if (department) ticket.department = department;
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
