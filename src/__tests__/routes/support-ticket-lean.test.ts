import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import mongoose from 'mongoose';
import { SupportTicket } from '../../models/SupportTicket.ts';
import { SupportTicketReply } from '../../models/SupportTicketReply.ts';
import { User } from '../../models/User.ts';
import { generateTokens } from '../../utils/auth.ts';
import { supportTicketRoutes } from '../../routes/supportTicket.routes.ts';

vi.mock('../../middleware/authMiddleware.ts', () => ({
  authMiddleware: (_req: any, reply: any, done: Function) => {
    (reply.request as any).user = (reply.request as any).user || { userId: (globalThis as any).__testUserId, role: 'USER' };
    done();
  },
  requireRole: () => (_req: any, _reply: any, done: Function) => done(),
}));

const MARK = `lean-support-test-${Date.now()}`;

let app: ReturnType<typeof Fastify>;
let userId: string;
let token: string;

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const created = await User.create({
    username: `leansupport${Date.now()}`,
    email: `${MARK}@test.local`,
    passwordHash: '',
    role: 'USER',
    status: 'active',
  });
  userId = (created._id as mongoose.Types.ObjectId).toString();
  (globalThis as any).__testUserId = userId;
  token = generateTokens(userId, 'USER').accessToken;

  app = Fastify();
  await app.register(supportTicketRoutes, { prefix: '/api/support-tickets' });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  const tickets = await SupportTicket.find({ title: new RegExp(MARK) }).select('_id').lean();
  await SupportTicketReply.deleteMany({ ticketId: { $in: tickets.map((t) => t._id) } });
  await SupportTicket.deleteMany({ _id: { $in: tickets.map((t) => t._id) } });
  await User.deleteOne({ _id: userId });
});

describe('POST /api/support-tickets/guest', () => {
  it('tạo ticket không cần đăng nhập, kèm reply chứa thông tin liên hệ', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/support-tickets/guest',
      payload: {
        fullName: 'Khach Test',
        email: 'khach@test.local',
        phone: '0900000000',
        subject: `${MARK} lien he`,
        message: 'Cho hỏi về đơn hàng',
      },
    });
    expect(res.statusCode).toBe(201);

    const ticket = await SupportTicket.findOne({ title: `${MARK} lien he` }).lean();
    expect(ticket).toBeTruthy();
    expect((ticket as any).userId).toBeFalsy();

    const reply = await SupportTicketReply.findOne({ ticketId: ticket!._id }).lean();
    expect((reply as any).message).toContain('Khach Test');
    expect((reply as any).message).toContain('Cho hỏi về đơn hàng');
    expect((reply as any).senderId).toBeFalsy();
  });

  it('chặn email thiếu / sai định dạng bằng 400', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/support-tickets/guest',
      payload: { fullName: 'A', email: '', message: 'x' },
    });
    expect(missing.statusCode).toBe(400);

    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/support-tickets/guest',
      payload: { fullName: 'A', email: 'not-an-email', message: 'x' },
    });
    expect(badEmail.statusCode).toBe(400);
  });
});

describe('getMyTickets dùng 1 query cho reply meta (không N+1)', () => {
  it('danh sách ticket có replyCount + lastReply chính xác', async () => {
    const t1 = await SupportTicket.create({ userId, title: `${MARK} t1`, status: 'open' });
    const t2 = await SupportTicket.create({ userId, title: `${MARK} t2`, status: 'open' });
    const base = Date.now();
    await SupportTicketReply.collection.insertMany([
      { ticketId: t1._id, senderId: new mongoose.Types.ObjectId(userId), message: 'r1 early', createdAt: new Date(base - 2000), updatedAt: new Date(base - 2000) },
      { ticketId: t1._id, senderId: new mongoose.Types.ObjectId(userId), message: 'r1 latest', createdAt: new Date(base - 1000), updatedAt: new Date(base - 1000) },
      { ticketId: t2._id, senderId: new mongoose.Types.ObjectId(userId), message: 'r2 only', createdAt: new Date(base), updatedAt: new Date(base) },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/support-tickets/my-tickets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data.filter((t: any) => t.title.startsWith(MARK));

    const found1 = data.find((t: any) => t.title === `${MARK} t1`);
    const found2 = data.find((t: any) => t.title === `${MARK} t2`);
    expect(found1.replyCount).toBe(2);
    expect(found1.lastReply.message).toBe('r1 latest');
    expect(found2.replyCount).toBe(1);
    expect(found2.lastReply.message).toBe('r2 only');
  });
});

describe('Khóa hội thoại & mở lại tối đa 1 lần', () => {
  it('reply vào ticket đã đóng -> 400', async () => {
    const ticket = await SupportTicket.create({ userId, title: `${MARK} locked`, status: 'closed' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/support-tickets/${ticket._id}/replies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'còn nhắn được không?' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('đã kết thúc');
  });

  it('mở lại lần 1 OK, đóng lại, mở lần 2 -> 400', async () => {
    const ticket = await SupportTicket.create({ userId, title: `${MARK} reopen`, status: 'closed' });

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/${ticket._id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'in_progress' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.reopened).toBe(true);
    expect(first.json().data.status).toBe('in_progress');

    const close = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/${ticket._id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'closed' },
    });
    expect(close.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/${ticket._id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'in_progress' },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toContain('1 lần');
  });

  it('khách không được tự đặt in_progress khi ticket đang mở, chỉ được đóng', async () => {
    const ticket = await SupportTicket.create({ userId, title: `${MARK} only-close`, status: 'open' });

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/${ticket._id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'in_progress' },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/${ticket._id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'closed' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('admin chỉ chuyển trạng thái theo chiều tiến, không quay lại', async () => {
    const ticket = await SupportTicket.create({ userId, title: `${MARK} forward-only`, status: 'in_progress' });

    const forward = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/admin/${ticket._id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'closed' },
    });
    expect(forward.statusCode).toBe(200);

    const backward = await app.inject({
      method: 'PATCH',
      url: `/api/support-tickets/admin/${ticket._id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'in_progress' },
    });
    expect(backward.statusCode).toBe(400);
    expect(backward.json().message).toContain('không quay lại');
  });
});
