import type { FastifyRequest, FastifyReply } from 'fastify';
import { UserAddress } from '../../models/UserAddress.ts';
import { User } from '../../models/User.ts';
import mongoose from 'mongoose';

export class UserAddressController {
  /**
   * GET /api/user-addresses
   * Lấy tất cả địa chỉ của user đang đăng nhập
   */
  static async getMyAddresses(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const addresses = await UserAddress.find({ userId: new mongoose.Types.ObjectId(userId) })
        .sort({ isDefault: -1, createdAt: -1 })
        .lean();

      return reply.send({ success: true, data: addresses });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/user-addresses
   * Thêm địa chỉ mới cho user
   */
  static async createAddress(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const user = await User.findById(userId).lean();
      if (!user) return reply.status(404).send({ success: false, message: 'Người dùng không tồn tại' });

      const body = req.body as {
        addressType?: 'home' | 'office';
        fullName?: string;
        phoneNumber?: string;
        address?: string;
        province?: string;
        district?: string;
        ward?: string;
        latitude?: number;
        longitude?: number;
        isDefault?: boolean;
      };

      // Nếu đây là địa chỉ mặc định, bỏ mặc định của các địa chỉ cũ
      if (body.isDefault) {
        await UserAddress.updateMany(
          { userId: new mongoose.Types.ObjectId(userId) },
          { $set: { isDefault: false } }
        );
      }

      // Nếu chưa có địa chỉ nào, tự động set isDefault = true
      const existingCount = await UserAddress.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
      const isDefault = body.isDefault ?? existingCount === 0;

      const newAddress = await UserAddress.create({
        userId: new mongoose.Types.ObjectId(userId),
        addressType: body.addressType || 'home',
        fullName: body.fullName?.trim() || '',
        phoneNumber: body.phoneNumber?.trim() || '',
        address: body.address?.trim() || '',
        province: body.province?.trim() || '',
        district: body.district?.trim() || '',
        ward: body.ward?.trim() || '',
        latitude: body.latitude,
        longitude: body.longitude,
        isDefault,
      });

      return reply.status(201).send({ success: true, data: newAddress });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * PATCH /api/user-addresses/:id
   * Cập nhật một địa chỉ
   */
  static async updateAddress(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params as { id: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID địa chỉ không hợp lệ' });
      }

      const body = req.body as {
        addressType?: 'home' | 'office';
        fullName?: string;
        phoneNumber?: string;
        address?: string;
        province?: string;
        district?: string;
        ward?: string;
        latitude?: number;
        longitude?: number;
        isDefault?: boolean;
      };

      // Nếu set isDefault = true, bỏ mặc định của địa chỉ khác
      if (body.isDefault) {
        await UserAddress.updateMany(
          { userId: new mongoose.Types.ObjectId(userId), _id: { $ne: new mongoose.Types.ObjectId(id) } },
          { $set: { isDefault: false } }
        );
      }

      const updateData: any = {};
      if (body.addressType !== undefined) updateData.addressType = body.addressType;
      if (body.fullName !== undefined) updateData.fullName = body.fullName.trim();
      if (body.phoneNumber !== undefined) updateData.phoneNumber = body.phoneNumber.trim();
      if (body.address !== undefined) updateData.address = body.address.trim();
      if (body.province !== undefined) updateData.province = body.province.trim();
      if (body.district !== undefined) updateData.district = body.district.trim();
      if (body.ward !== undefined) updateData.ward = body.ward.trim();
      if (body.latitude !== undefined) updateData.latitude = body.latitude;
      if (body.longitude !== undefined) updateData.longitude = body.longitude;
      if (body.isDefault !== undefined) updateData.isDefault = body.isDefault;

      const updated = await UserAddress.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(id), userId: new mongoose.Types.ObjectId(userId) },
        { $set: updateData },
        { new: true }
      );

      if (!updated) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy địa chỉ' });
      }

      return reply.send({ success: true, data: updated });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * DELETE /api/user-addresses/:id
   * Xóa một địa chỉ
   */
  static async deleteAddress(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params as { id: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID địa chỉ không hợp lệ' });
      }

      const deleted = await UserAddress.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (!deleted) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy địa chỉ' });
      }

      // Nếu xóa địa chỉ mặc định, tự động set địa chỉ mới nhất làm mặc định
      if (deleted.isDefault) {
        const next = await UserAddress.findOne({ userId: new mongoose.Types.ObjectId(userId) }).sort({ createdAt: -1 });
        if (next) {
          await UserAddress.updateOne({ _id: next._id }, { $set: { isDefault: true } });
        }
      }

      return reply.send({ success: true, message: 'Đã xóa địa chỉ thành công' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * PATCH /api/user-addresses/:id/set-default
   * Đặt địa chỉ làm mặc định
   */
  static async setDefault(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { id } = req.params as { id: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return reply.status(400).send({ success: false, message: 'ID địa chỉ không hợp lệ' });
      }

      // Bỏ mặc định của tất cả địa chỉ khác
      await UserAddress.updateMany(
        { userId: new mongoose.Types.ObjectId(userId) },
        { $set: { isDefault: false } }
      );

      // Set địa chỉ này làm mặc định
      const updated = await UserAddress.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(id), userId: new mongoose.Types.ObjectId(userId) },
        { $set: { isDefault: true } },
        { new: true }
      );

      if (!updated) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy địa chỉ' });
      }

      return reply.send({ success: true, data: updated, message: 'Đã đặt làm địa chỉ mặc định' });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}