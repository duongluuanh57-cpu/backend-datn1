import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { UserRepository } from '../repositories/UserRepository.ts';
import { Order } from '../models/Order.ts';
import { computeMemberTier } from './auth/authProfileController.ts';
import { getEffectiveStatus } from '../utils/accountStatus.ts';
import { hashPassword } from '../utils/auth.ts';

export class UserController {
  /**
   * Tính tổng tiền đã chi tiêu (các đơn đã delivered) cho từng user trong list,
   * tự động cập nhật hạng thành viên và trạng thái (Không hoạt động nếu lâu không đăng nhập).
   */
  private static async attachTotalSpent<
    T extends { _id: unknown; totalSpent?: number; memberTier?: string; status?: string }
  >(users: T[]): Promise<T[]> {
    if (users.length === 0) return users;
    const ids = users.map((u) => new mongoose.Types.ObjectId(String(u._id)));
    const result = await Order.aggregate([
      { $match: { userId: { $in: ids }, status: 'delivered' } },
      { $group: { _id: '$userId', total: { $sum: '$totalAmount' } } },
    ]);
    const totals = new Map(result.map((r: any) => [String(r._id), r.total as number]));
    return users.map((u) => {
      const totalSpent = totals.get(String(u._id)) || 0;
      return {
        ...u,
        totalSpent,
        memberTier: computeMemberTier(totalSpent),
        status: getEffectiveStatus(u as any),
      };
    });
  }

  /**
   * GET /api/users
   * Lấy danh sách người dùng (Admin only)
   * Query params: page, limit, search, role
   */
  static async getAllUsers(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = request.query as { page?: string; limit?: string; search?: string; role?: string; status?: string; memberTier?: string; sortBy?: string };

      // Nếu không có page, trả full list có lọc theo query (backward compatible)
      if (!query.page) {
        const filter: any = {};
        if (query.role && query.role !== 'ALL') {
          const roles = query.role.split(',').filter(Boolean);
          if (roles.length > 0) {
            filter.role = roles.length > 1 ? { $in: roles } : roles[0];
          }
        }
        if (query.search) {
          const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          filter.$or = [
            { username: { $regex: '^' + escaped, $options: 'i' } },
            { email: { $regex: '^' + escaped, $options: 'i' } },
          ];
        }

        const users = await (await import('../models/User.ts')).User.find(filter).sort({ createdAt: -1 }).lean();
        const safeUsers = users.map(u => {
          const { passwordHash, ...rest } = u as any;
          return rest;
        });
        const enriched = await UserController.attachTotalSpent(safeUsers);
        return reply.send({ success: true, data: enriched });
      }

      const result = await UserRepository.findPaginated({
        page: parseInt(query.page, 10),
        limit: query.limit ? parseInt(query.limit, 10) : 10,
        search: query.search,
        role: query.role,
        status: query.status,
        memberTier: query.memberTier,
        sortBy: query.sortBy,
      });

      const items = await UserController.attachTotalSpent(result.items);

      return reply.send({ success: true, data: { ...result, items } });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * POST /api/users
   * Tạo tài khoản quản trị viên (Admin only)
   */
  static async createUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as { username?: string; email?: string; password?: string; fullName?: string };

      const username = (body.username || '').trim();
      const email = (body.email || '').trim();
      const password = body.password || '';
      const fullName = (body.fullName || '').trim();

      if (!username || !email || !password) {
        return reply.status(400).send({
          success: false,
          message: 'Vui lòng nhập đầy đủ tên đăng nhập, email và mật khẩu',
        });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.status(400).send({ success: false, message: 'Email không hợp lệ' });
      }
      if (password.length < 6) {
        return reply.status(400).send({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự' });
      }

      const existingEmail = await UserRepository.findByEmail(email);
      if (existingEmail) {
        return reply.status(400).send({ success: false, message: 'Email đã được sử dụng' });
      }
      const existingUsername = await UserRepository.findByUsername(username);
      if (existingUsername) {
        return reply.status(400).send({ success: false, message: 'Tên đăng nhập đã được sử dụng' });
      }

      const passwordHash = await hashPassword(password);
      const newUser = await UserRepository.create({
        username,
        email,
        passwordHash,
        fullName,
        role: 'ADMIN',
        memberTier: 'MEMBER',
        status: 'active',
      } as any);

      const { passwordHash: _removed, ...safeUser } = newUser as any;
      return reply.send({
        success: true,
        message: 'Đã tạo quản trị viên thành công',
        data: safeUser,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * GET /api/users/:id
   * Lấy thông tin chi tiết người dùng
   */
  static async getUserById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };

      const user = await UserRepository.findById(id);
      if (!user) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng',
        });
      }

      // Fetch user's orders summary and recent orders
      const userObjId = new mongoose.Types.ObjectId(id);
      const orders = await Order.find({ userId: userObjId }).sort({ createdAt: -1 }).limit(10).lean();
      
      // Calculate total delivered spending
      const spendingAgg = await Order.aggregate([
        { $match: { userId: userObjId, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      ]);
      const totalSpent = spendingAgg.length > 0 ? (spendingAgg[0].total as number) : 0;
      const deliveredOrdersCount = spendingAgg.length > 0 ? (spendingAgg[0].count as number) : 0;
      const totalOrdersCount = await Order.countDocuments({ userId: userObjId });

      const { passwordHash, ...safeUser } = user as any;
      const enrichedUser = {
        ...safeUser,
        totalSpent,
        deliveredOrdersCount,
        totalOrdersCount,
        memberTier: computeMemberTier(totalSpent),
        status: getEffectiveStatus(user as any),
        recentOrders: orders,
      };

      return reply.send({ success: true, data: enrichedUser });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * PATCH /api/users/:id
   * Cập nhật thông tin người dùng
   */
  static async updateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const currentUserId = (request as any).user?.userId;
      const targetUser = await UserRepository.findById(id);

      if (!targetUser) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng',
        });
      }

      // Bảo vệ tài khoản Quản trị viên:
      // Admin A không thể chỉnh sửa của Admin B. Chỉ Admin B mới có thể chỉnh sửa tài khoản của mình.
      if (targetUser.role === 'ADMIN' && currentUserId !== id) {
        return reply.status(403).send({
          success: false,
          message: 'Bạn không thể chỉnh sửa thông tin của quản trị viên khác. Mỗi quản trị viên chỉ có thể tự cập nhật tài khoản của mình.',
        });
      }

      const body = request.body as any;

      // Không cho phép khóa tài khoản ADMIN hoặc hạ quyền ADMIN qua updateUser
      if (targetUser.role === 'ADMIN' && (body.status === 'suspended' || (body.role && body.role !== 'ADMIN'))) {
        return reply.status(403).send({
          success: false,
          message: 'Không thể khóa hoặc thay đổi vai trò của quản trị viên.',
        });
      }

      // Chỉ cho phép cập nhật các field an toàn
      const allowedFields = [
        'username', 'email', 'fullName', 'phoneNumber', 'gender',
        'address', 'province', 'district',
        'role', 'memberTier', 'status',
      ];
      const data: Record<string, any> = {};
      for (const field of allowedFields) {
        if (body[field] !== undefined) {
          data[field] = body[field];
        }
      }

      if (Object.keys(data).length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'Không có trường nào được gửi để cập nhật',
        });
      }

      const user = await UserRepository.update(id, data);
      if (!user) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng',
        });
      }

      const { passwordHash, ...safeUser } = user as any;
      return reply.send({
        success: true,
        message: 'Cập nhật thành công',
        data: safeUser,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * PATCH /api/users/:id/role
   * Cập nhật vai trò người dùng
   */
  static async updateUserRole(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const targetUser = await UserRepository.findById(id);
      if (!targetUser) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng',
        });
      }

      // Không cho phép hạ quyền hay thay đổi vai trò của Quản trị viên
      if (targetUser.role === 'ADMIN') {
        return reply.status(403).send({
          success: false,
          message: 'Không thể thay đổi vai trò của quản trị viên.',
        });
      }

      const { role } = request.body as { role: 'USER' | 'ADMIN' };
      if (!role || !['USER', 'ADMIN'].includes(role)) {
        return reply.status(400).send({
          success: false,
          message: 'Vai trò không hợp lệ',
        });
      }
      
      const user = await UserRepository.update(id, { role });
      if (!user) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng',
        });
      }

      return reply.send({
        success: true,
        message: 'Cập nhật vai trò thành công',
        data: user,
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }

  /**
   * DELETE /api/users/:id
   * Xóa người dùng
   */
  static async deleteUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const targetUser = await UserRepository.findById(id);
      if (!targetUser) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng để xóa',
        });
      }

      // Các quản trị viên không thể xóa tài khoản của nhau
      if (targetUser.role === 'ADMIN') {
        return reply.status(403).send({
          success: false,
          message: 'Không thể xóa tài khoản của quản trị viên.',
        });
      }
      
      const success = await UserRepository.delete(id);
      if (!success) {
        return reply.status(404).send({
          success: false,
          message: 'Không tìm thấy người dùng để xóa',
        });
      }

      return reply.send({
        success: true,
        message: 'Đã xóa người dùng thành công',
      });
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: error.message,
      });
    }
  }
}
