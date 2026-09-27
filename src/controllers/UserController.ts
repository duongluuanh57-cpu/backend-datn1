import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { UserRepository } from '../repositories/UserRepository.ts';
import { Order } from '../models/Order.ts';
import CartItem from '../models/CartItem.ts';
import { computeMemberTier } from '../utils/memberTier.ts';
import type { CreateAdminInput, UpdateUserInput } from '../types/user.types.ts';
import { hashPassword } from '../utils/auth.ts';
import { AppError, ValidationError } from '../utils/errors.ts';

/** Tong chi tieu don da giao — chung cach tinh voi getMe va findPaginated */
async function getTotalSpent(userId: mongoose.Types.ObjectId): Promise<number> {
  const [agg] = await Order.aggregate([
    { $match: { userId, status: 'delivered' } },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);
  return agg?.total || 0;
}

export class UserController {
  static async getAllUsers(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as { page?: string; limit?: string; search?: string; role?: string; status?: string; memberTier?: string; sortBy?: string };

    const result = await UserRepository.findPaginated({
      page: parseInt(query.page || '1', 10),
      limit: query.limit ? parseInt(query.limit, 10) : 10,
      search: query.search,
      role: query.role,
      status: query.status,
      memberTier: query.memberTier,
      sortBy: query.sortBy,
    });

    return reply.send({ success: true, data: result });
  }

  static async createUser(request: FastifyRequest<{ Body: CreateAdminInput }>, reply: FastifyReply) {
    const { username, email, password, fullName } = request.body;

    // Normalize như đăng ký public: chặn trùng lặp kiểu John@X.com / john@x.com
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();

    if (await UserRepository.findByEmail(normalizedEmail)) {
      throw new ValidationError('Email đã được sử dụng');
    }
    if (await UserRepository.findByUsername(normalizedUsername)) {
      throw new ValidationError('Tên đăng nhập đã được sử dụng');
    }

    const passwordHash = await hashPassword(password);
    const newUser = await UserRepository.create({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      fullName,
      role: 'ADMIN',
    } as any);

    const { passwordHash: _removed, ...safeUser } = newUser.toObject();
    return reply.send({
      success: true,
      message: 'Đã tạo quản trị viên thành công',
      data: safeUser,
    });
  }

  static async getUserById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Không tìm thấy người dùng', 404);

    const user = await UserRepository.findById(id);
    if (!user) throw new AppError('Không tìm thấy người dùng', 404);

    const userObjId = new mongoose.Types.ObjectId(id);
    const orders = await Order.find({ userId: userObjId }).sort({ createdAt: -1 }).limit(10).lean();

    // Chi so that thay vi hardcode: hang tinh tu tong chi tieu don da giao
    const [deliveredOrdersCount, totalSpent] = await Promise.all([
      Order.countDocuments({ userId: userObjId, status: 'delivered' }),
      getTotalSpent(userObjId),
    ]);

    const { passwordHash, ...safeUser } = user as any;
    const enrichedUser = {
      ...safeUser,
      deliveredOrdersCount,
      totalOrdersCount: await Order.countDocuments({ userId: userObjId }),
      memberTier: computeMemberTier(totalSpent),
      totalSpent,
      recentOrders: orders,
    };

    return reply.send({ success: true, data: enrichedUser });
  }

  static async updateUser(request: FastifyRequest<{ Body: UpdateUserInput }>, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const currentUserId = (request as any).user?.userId;
    const data = request.body;

    if (!mongoose.Types.ObjectId.isValid(id)) throw new AppError('Không tìm thấy người dùng', 404);

    const targetUser = await UserRepository.findById(id);
    if (!targetUser) throw new AppError('Không tìm thấy người dùng', 404);

    if (targetUser.role === 'ADMIN' && currentUserId !== id) {
      throw new AppError(
        'Bạn không thể chỉnh sửa thông tin của quản trị viên khác. Mỗi quản trị viên chỉ có thể tự cập nhật tài khoản của mình.',
        403,
      );
    }

    if (targetUser.role === 'ADMIN' && (data.status === 'suspended' || (data.role && data.role !== 'ADMIN'))) {
      throw new AppError('Không thể khóa hoặc thay đổi vai trò của quản trị viên.', 403);
    }

    const user = await UserRepository.update(id, data);
    if (!user) throw new AppError('Không tìm thấy người dùng', 404);

    // Chuyển tài khoản sang suspended thì dọn luôn giỏ hàng.
    // ponytail: đây là hành vi phá hủy, KHÔNG hoàn tác được khi mở khóa lại —
    // chấp nhận theo yêu cầu nghiệp vụ. Chỉ chạy ở bước chuyển VÀO suspended để
    // không xóa giỏ oan ở các lần update khác.
    if (data.status === 'suspended' && targetUser.status !== 'suspended') {
      await CartItem.deleteMany({ userId: user._id }).catch(() => {});
    }

    const { passwordHash, ...safeUser } = user.toObject();
    return reply.send({
      success: true,
      message: 'Cập nhật thành công',
      data: safeUser,
    });
  }

}
