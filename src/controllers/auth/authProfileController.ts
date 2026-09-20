import type { FastifyRequest, FastifyReply } from 'fastify';
import { hashPassword, comparePassword } from '../../utils/auth.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { User } from '../../models/User.ts';
import { UserAddress } from '../../models/UserAddress.ts';
import { Order } from '../../models/Order.ts';
import { AuditLog } from '../../models/AuditLog.ts';
import { ImageService } from '../../services/ImageService.ts';
import { computeMemberTier } from '../../utils/memberTier.ts';
import mongoose from 'mongoose';

/**
 * Tổng chi tiêu của user (chỉ tính đơn đã giao) — khớp logic hạng trong
 * UserRepository.findPaginated (admin) để mọi nơi cùng một cách tính.
 */
async function getTotalSpent(userId: mongoose.Types.ObjectId): Promise<number> {
  const [agg] = await Order.aggregate([
    { $match: { userId, status: 'delivered' } },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);
  return agg?.total || 0;
}

/** Ep kieu ObjectId an toan cho audit log */
function safeObjectId(id?: string): mongoose.Types.ObjectId | undefined {
  return id && mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

export class AuthProfileController {
  /**
   * POST /api/auth/change-password
   * Body: { currentPassword?, newPassword }
   * - Nếu user có passwordHash: bắt buộc currentPassword để xác thực
   * - Nếu user chưa có passwordHash (OAuth): không cần currentPassword, set mật khẩu mới
   * - Đổi thành công → ghi passwordChangedAt → mọi refresh token cũ bị vô hiệu
   * Yêu cầu: Đã xác thực
   */
  static async changePassword(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { currentPassword?: string; newPassword: string };
    const userId = (request as any).user?.userId;
    if (!userId) throw new UnauthorizedError('Vui lòng đăng nhập');

    const user = await UserRepository.findById(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    // Nếu user đã có mật khẩu → kiểm tra mật khẩu hiện tại
    if (user.passwordHash) {
      if (!body.currentPassword) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập mật khẩu hiện tại' });
      }
      const isMatch = await comparePassword(body.currentPassword, user.passwordHash);
      if (!isMatch) {
        return reply.status(400).send({ success: false, message: 'Mật khẩu hiện tại không đúng' });
      }
    }

    const newHash = await hashPassword(body.newPassword);
    await UserRepository.update(userId, {
      passwordHash: newHash,
      passwordChangedAt: new Date(),
    } as any);

    await AuditLog.create({
      userId: safeObjectId(userId),
      action: 'PASSWORD_CHANGE',
      resource: 'User',
      metadata: { via: 'profile' },
      status: 'SUCCESS',
    });

    return reply.send({ success: true, message: 'Đổi mật khẩu thành công' });
  }

  /**
   * POST /api/auth/verify-password
   * Body: { password }
   * Chi dung de xac minh mat khau truoc khi cho sua thong tin nham — KHONG ghi gi ca.
   * Khac voi change-password: khong re-hash, khong ghi passwordChangedAt (khong dang xuat thiet bi khac).
   * Yeu cau: Da xac thuc
   */
  static async verifyPassword(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as { password?: string };
    const userId = (request as any).user?.userId;
    if (!userId) throw new UnauthorizedError('Vui lòng đăng nhập');

    const user = await UserRepository.findById(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    // User OAuth chua co mat khau: khong co gi de verify — tu choi ro rang
    if (!user.passwordHash) {
      return reply.status(400).send({ success: false, message: 'Tài khoản chưa thiết lập mật khẩu' });
    }
    if (!body.password) {
      return reply.status(400).send({ success: false, message: 'Vui lòng nhập mật khẩu' });
    }

    const isMatch = await comparePassword(body.password, user.passwordHash);
    if (!isMatch) {
      return reply.status(401).send({ success: false, message: 'Mật khẩu không đúng' });
    }

    return reply.send({ success: true, message: 'Xác minh mật khẩu thành công' });
  }

  /**
   * PATCH /api/auth/update-profile
   * Body: { username?, email?, fullName?, phoneNumber?, gender?, dateOfBirth? }
   * Yêu cầu: Đã xác thực
   */
  static async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as {
      username?: string;
      email?: string;
      fullName?: string;
      phoneNumber?: string;
      gender?: string;
      dateOfBirth?: string;
    };
    const userId = (request as any).user?.userId;
    if (!userId) throw new UnauthorizedError('Vui lòng đăng nhập');

    const updateData: any = {};

    if (body.username !== undefined) {
      // Normalize như khi đăng ký: trim + lowercase (username luôn lưu lowercase)
      const username = (body.username || '').trim().toLowerCase();
      if (username.length < 3) {
        return reply.status(400).send({ success: false, message: 'Tên người dùng phải có ít nhất 3 ký tự' });
      }
      if (!/^[a-z0-9._-]+$/.test(username)) {
        return reply.status(400).send({ success: false, message: 'Tên người dùng chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang' });
      }
      const existingUsername = await UserRepository.findByUsername(username);
      if (existingUsername && existingUsername._id.toString() !== userId) {
        return reply.status(400).send({ success: false, message: 'Tên người dùng này đã được sử dụng bởi tài khoản khác' });
      }
      updateData.username = username;
    }

    if (body.email !== undefined) {
      const trimmedEmail = body.email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        return reply.status(400).send({ success: false, message: 'Email không đúng định dạng' });
      }

      // Check nếu email đã tồn tại cho user khác — lowercase để bắt cả variant John@X.com / john@x.com
      const existingUser = await UserRepository.findByEmail(trimmedEmail);
      if (existingUser && existingUser._id.toString() !== userId) {
        return reply.status(400).send({ success: false, message: 'Email này đã được sử dụng bởi tài khoản khác' });
      }
      updateData.email = trimmedEmail;
    }

    if (body.fullName !== undefined) updateData.fullName = body.fullName.trim();
    if (body.phoneNumber !== undefined) updateData.phoneNumber = body.phoneNumber.trim();
    if (body.gender !== undefined) updateData.gender = body.gender;
    if (body.dateOfBirth !== undefined) updateData.dateOfBirth = body.dateOfBirth;

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ success: false, message: 'Không có thông tin nào để cập nhật' });
    }

    const user = await UserRepository.findById(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    const updatedUser = await UserRepository.update(userId, updateData as any);
    if (!updatedUser) {
      return reply.status(404).send({ success: false, message: 'Không thể cập nhật thông tin' });
    }

    await AuditLog.create({
      userId: safeObjectId(userId),
      action: 'PROFILE_UPDATE',
      resource: 'User',
      metadata: { fields: Object.keys(updateData) },
      status: 'SUCCESS',
    }).catch(() => {});

    const { passwordHash, ...safeUser } = updatedUser as any;

    return reply.send({
      success: true,
      message: 'Cập nhật thông tin cá nhân thành công',
      data: safeUser,
    });
  }

  /**
   * POST /api/auth/upload-avatar
   * Upload avatar lên R2, cập nhật user.avatar
   * Yêu cầu: multipart/form-data với field "avatar"
   */
  static async uploadAvatar(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user?.userId;
    if (!userId) throw new UnauthorizedError('Vui lòng đăng nhập');

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, message: 'Không tìm thấy file ảnh' });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      return reply.status(400).send({ success: false, message: 'Chỉ chấp nhận file ảnh (JPEG, PNG, WebP, GIF)' });
    }

    const buffer = await file.toBuffer();

    // Upload lên R2 folder avatars/
    const result = await ImageService.compressAndUpload(buffer, {
      folder: 'avatars',
      maxWidth: 512,
      quality: 85,
      name: `avatar-${userId}`,
    });

    // Xóa avatar cũ trên R2 nếu có
    const user = await User.findById(userId).lean();
    if (user && (user as any).avatar) {
      ImageService.deleteFromR2((user as any).avatar).catch(() => {});
    }

    // Cập nhật user.avatar trong DB
    await User.findByIdAndUpdate(userId, { avatar: result.url });

    return reply.send({
      success: true,
      message: 'Cập nhật avatar thành công',
      data: { avatar: result.url },
    });
  }

  /**
   * GET /api/auth/me
   * Yêu cầu: Đã xác thực
   *
   * Hạng thành viên được tính REAL-TIME từ tổng chi tiêu đơn đã giao — không đọc
   * và cũng không ghi đè memberTier trong DB (trước đây mỗi lần mở profile từng
   * reset hạng của user về MEMBER).
   */
  static async getMe(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user?.userId;
    if (!userId) throw new UnauthorizedError('Vui lòng đăng nhập');

    const user = await User.findById(userId).lean();
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    const userObjId = new mongoose.Types.ObjectId(userId);
    const totalSpent = await getTotalSpent(userObjId);
    const memberTier = computeMemberTier(totalSpent);

    // Lấy địa chỉ mặc định của user
    const defaultAddress = await UserAddress.findOne({ userId: userObjId, isDefault: true }).lean();

    const { passwordHash, ...safeUser } = user as any;

    return reply.send({
      success: true,
      data: {
        ...safeUser,
        memberTier,
        totalSpent,
        hasPassword: !!passwordHash,
        defaultAddress: defaultAddress || null,
      },
    });
  }
}
