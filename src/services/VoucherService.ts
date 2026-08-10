import { Voucher, type VoucherType, type VoucherScope } from '../models/Voucher.ts';
import { MiniGameSession } from '../models/MiniGameSession.ts';
import { UserVoucher } from '../models/UserVoucher.ts';

// Thứ tự hạng từ thấp đến cao
const TIER_ORDER: Record<string, number> = {
  MEMBER: 0,
  Bac: 1,
  Vang: 2,
  KimCuong: 3,
};

export class VoucherService {
  /**
  /**
   * Đảm bảo luôn có đúng 5 voucher cố định cho Vòng Quay May Mắn (applicableTo = 'minigame')
   */
  static async ensureDefaultMinigameVouchers() {
    const minigameVouchers = await Voucher.find({ applicableTo: 'minigame' }).lean();
    if (minigameVouchers.length < 5) {
      const defaults = [
        { code: 'GAME-FS1', type: 'fixed' as const, value: 0, voucherCategory: 'freeship' as const, description: 'Freeship Hỏa Tốc từ Vòng quay may mắn', applicableTo: 'minigame' as const, status: 'active' as const, startDate: new Date('2025-01-01'), endDate: new Date('2030-12-31'), maxUsage: -1, minOrderAmount: 0 },
        { code: 'GAME-DISC5', type: 'percentage' as const, value: 5, voucherCategory: 'discount' as const, maxDiscount: 100000, description: 'Voucher Giảm 5% từ Vòng quay may mắn', applicableTo: 'minigame' as const, status: 'active' as const, startDate: new Date('2025-01-01'), endDate: new Date('2030-12-31'), maxUsage: -1, minOrderAmount: 0 },
        { code: 'GAME-FS2', type: 'fixed' as const, value: 0, voucherCategory: 'freeship' as const, description: 'Freeship Hỏa Tốc từ Vòng quay may mắn', applicableTo: 'minigame' as const, status: 'active' as const, startDate: new Date('2025-01-01'), endDate: new Date('2030-12-31'), maxUsage: -1, minOrderAmount: 0 },
        { code: 'GAME-FS3', type: 'fixed' as const, value: 0, voucherCategory: 'freeship' as const, description: 'Freeship Hỏa Tốc từ Vòng quay may mắn', applicableTo: 'minigame' as const, status: 'active' as const, startDate: new Date('2025-01-01'), endDate: new Date('2030-12-31'), maxUsage: -1, minOrderAmount: 0 },
        { code: 'GAME-DISC10', type: 'percentage' as const, value: 10, voucherCategory: 'discount' as const, maxDiscount: 100000, description: 'Voucher Giảm 10% từ Vòng quay may mắn', applicableTo: 'minigame' as const, status: 'active' as const, startDate: new Date('2025-01-01'), endDate: new Date('2030-12-31'), maxUsage: -1, minOrderAmount: 0 },
      ];

      for (let i = minigameVouchers.length; i < 5; i++) {
        const def = defaults[i];
        const exists = await Voucher.findOne({ code: def.code });
        if (!exists) {
          await Voucher.create(def);
        }
      }
    }
  }

  /**
   * Đồng bộ tự động trạng thái các voucher hết lượt hoặc có maxUsage = 0 về Ẩn (inactive)
   */
  static async syncVouchersState() {
    // Tự động gán voucherCategory = 'freeship' cho các voucher freeship cũ
    await Voucher.updateMany(
      {
        $or: [
          { code: /^FSEXPRESS/i },
          { type: 'fixed', value: 0 }
        ],
        voucherCategory: { $exists: false }
      },
      { $set: { voucherCategory: 'freeship' } }
    );

    // Tự động tạo 5 voucher mặc định cho Vòng quay may mắn nếu chưa có đủ 5
    await this.ensureDefaultMinigameVouchers();
  }

  /**
   * Lấy tất cả voucher của tenant
   */
  static async getAll() {
    await this.syncVouchersState();
    return Voucher.find({}).sort({ createdAt: -1 }).lean();
  }

  /**
   * Lấy voucher đang hoạt động (còn hạn, còn lượt) — lọc theo hạng và voucher trúng game của user
   * @param userTier Hạng của user (VD: 'MEMBER', 'Bac', 'Vang', 'KimCuong'), null/undefined = không lọc
   * @param userId ID của user hiện tại, dùng để hiển thị voucher trúng từ mini game & membership
   */
  static async getActive(userTier?: string | null, userId?: string | null) {
    await this.syncVouchersState();
    const now = new Date();

    // 1. Lấy tất cả voucher toàn sàn (applicableTo = 'all')
    const globalVouchers = await Voucher.find({
      status: 'active',
      applicableTo: 'all',
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ createdAt: -1 }).lean();

    // 2. Lấy tất cả voucher được cấp riêng cho user này (từ membership và minigame) qua UserVoucher
    let grantedVouchers: any[] = [];
    if (userId) {
      const uVouchers = await UserVoucher.find({
        userId,
        isUsed: false,
      }).populate('voucherId').lean();

      grantedVouchers = uVouchers
        .map((uv: any) => {
          const v = uv.voucherId;
          if (!v) return null;
          // Đảm bảo voucher vẫn active và trong thời hạn
          const isActive =
            v.status === 'active' &&
            new Date(v.startDate) <= now &&
            new Date(v.endDate) >= now;
          if (!isActive) return null;
          return {
            ...v,
            userVoucherId: uv._id, // Lưu ID của UserVoucher để tham chiếu nếu cần
          };
        })
        .filter(Boolean);
    }

    // Gộp cả 2 danh sách lại và loại bỏ trùng lặp nếu có trùng code
    const allActive = [...globalVouchers, ...grantedVouchers];
    const uniqueMap = new Map<string, any>();
    for (const v of allActive) {
      uniqueMap.set(v.code, v);
    }

    return Array.from(uniqueMap.values());
  }

  static async getById(id: string) {
    return Voucher.findOne({ _id: id }).lean();
  }

  static async create(data: {
    code: string;
    type: VoucherType;
    value: number;
    applicableTo?: VoucherScope;
    voucherCategory?: 'discount' | 'freeship';
    minTier?: string;
    minOrderAmount?: number;
    maxDiscount?: number;
    maxUsage?: number;
    startDate: string;
    endDate: string;
    status?: 'active' | 'inactive';
  }) {
    if (data.applicableTo === 'minigame') {
      const minigameCount = await Voucher.countDocuments({ applicableTo: 'minigame' });
      if (minigameCount >= 5) {
        throw new Error('Số lượng mã giảm giá Mini Game đã đạt tối đa 5 mã cố định cho Vòng Quay May Mắn.');
      }
    }
    const maxUsage = data.maxUsage ?? (data.applicableTo === 'minigame' ? -1 : 0);
    const status = data.status || 'active';
    return Voucher.create({
      ...data,
      maxUsage,
      code: data.code.toUpperCase(),
      status,
    });
  }

  static async update(id: string, data: Partial<{
    code: string;
    type: VoucherType;
    value: number;
    applicableTo: VoucherScope;
    voucherCategory: 'discount' | 'freeship';
    minTier: string;
    minOrderAmount: number;
    maxDiscount: number;
    maxUsage: number;
    startDate: string;
    endDate: string;
    status: 'active' | 'inactive';
  }>) {
    const existing = await Voucher.findById(id);
    if (existing) {
      if (data.applicableTo === 'minigame' && existing.applicableTo !== 'minigame') {
        const minigameCount = await Voucher.countDocuments({ applicableTo: 'minigame' });
        if (minigameCount >= 5) {
          throw new Error('Số lượng mã giảm giá Mini Game đã đạt tối đa 5 mã cố định.');
        }
      }
    }

    const updateData: any = {};
    if (data.code !== undefined) updateData.code = data.code.toUpperCase();
    if (data.type !== undefined) updateData.type = data.type;
    if (data.value !== undefined) updateData.value = data.value;
    if (data.applicableTo !== undefined) updateData.applicableTo = data.applicableTo;
    if (data.voucherCategory !== undefined) updateData.voucherCategory = data.voucherCategory;
    if (data.minTier !== undefined) updateData.minTier = data.minTier;
    if (data.minOrderAmount !== undefined) updateData.minOrderAmount = data.minOrderAmount;
    if (data.maxDiscount !== undefined) updateData.maxDiscount = data.maxDiscount;
    if (data.startDate !== undefined) updateData.startDate = data.startDate;
    if (data.endDate !== undefined) updateData.endDate = data.endDate;

    if (existing) {
      const maxUsage = data.maxUsage !== undefined ? data.maxUsage : existing.maxUsage;
      const status = data.status !== undefined ? data.status : existing.status;
      updateData.maxUsage = maxUsage;
      updateData.status = status;
    }

    return Voucher.findOneAndUpdate(
      { _id: id },
      { $set: updateData },
      { new: true }
    );
  }

  static async delete(id: string) {
    const existing = await Voucher.findById(id);
    if (existing && existing.applicableTo === 'minigame') {
      const minigameCount = await Voucher.countDocuments({ applicableTo: 'minigame' });
      if (minigameCount <= 5) {
        throw new Error('Vòng Quay May Mắn yêu cầu duy trì tối thiểu 5 mã Mini Game. Không thể xóa mã này.');
      }
    }
    const result = await Voucher.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /**
   * Validate voucher code: kiểm tra hạn, số lượt, min order, hạng user
   * Trả về { valid, message, voucher? }
   * @param userTier Hạng của user (VD: 'MEMBER', 'Bac', 'Vang', 'KimCuong'), null/undefined = bỏ qua kiểm tra hạng
   * @param userId ID của user hiện tại, dùng để kiểm tra quyền sở hữu đối với voucher game & membership
   */
  static async validate(code: string, orderAmount: number, userTier?: string | null, userId?: string | null) {
    const voucher = await Voucher.findOne({
      code: code.toUpperCase(),
    }).lean();

    if (!voucher) {
      return { valid: false, message: 'Mã giảm giá không tồn tại' };
    }

    if (voucher.status !== 'active') {
      return { valid: false, message: 'Mã giảm giá đã bị vô hiệu hoá' };
    }

    const now = new Date();
    if (voucher.startDate > now) {
      return { valid: false, message: 'Mã giảm giá chưa đến hạn sử dụng' };
    }
    if (voucher.endDate < now) {
      return { valid: false, message: 'Mã giảm giá đã hết hạn' };
    }

    // Nếu là voucher toàn sàn, kiểm tra maxUsage chung
    if (voucher.applicableTo === 'all') {
      if (voucher.maxUsage !== undefined && voucher.maxUsage !== null && voucher.usedCount >= voucher.maxUsage) {
        return { valid: false, message: 'Mã giảm giá đã hết lượt sử dụng' };
      }
    } else {
      // Đối với voucher membership hoặc minigame, bắt buộc user phải có record trong UserVoucher và chưa dùng
      if (!userId) {
        return { valid: false, message: 'Bạn cần đăng nhập để sử dụng mã này' };
      }
      const uv = await UserVoucher.findOne({
        userId,
        voucherId: voucher._id,
        isUsed: false,
      }).lean();

      if (!uv) {
        return { valid: false, message: 'Bạn không sở hữu mã giảm giá này hoặc đã sử dụng rồi' };
      }
    }

    // Kiểm tra hạng user nếu là voucher membership trực tiếp (để chắc chắn)
    if (voucher.applicableTo === 'membership' && voucher.minTier) {
      if (!userTier) {
        return { valid: false, message: 'Bạn cần đăng nhập để sử dụng mã này' };
      }
      const requiredLevel = TIER_ORDER[voucher.minTier] ?? 0;
      const userLevel = TIER_ORDER[userTier] ?? -1;
      if (userLevel < requiredLevel) {
        return {
          valid: false,
          message: `Mã giảm giá yêu cầu hạng ${voucher.minTier} trở lên`,
        };
      }
    }

    if (orderAmount < voucher.minOrderAmount) {
      return {
        valid: false,
        message: `Đơn hàng tối thiểu ${voucher.minOrderAmount.toLocaleString()}đ để áp dụng mã này`,
      };
    }

    // Tính discount
    let discountAmount = 0;
    if (voucher.type === 'percentage') {
      discountAmount = Math.round(orderAmount * (voucher.value / 100));
      if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
        discountAmount = voucher.maxDiscount;
      }
    } else {
      discountAmount = voucher.value;
    }

    return { valid: true, message: 'Áp dụng mã giảm giá thành công', voucher, discountAmount };
  }

  /**
   * Tự động cấp phát voucher của hạng thành viên mới khi thăng cấp
   * @param userId ID của user
   * @param newTier Hạng mới thăng cấp
   * @param oldTier Hạng cũ
   */
  static async grantMembershipVouchers(userId: string, newTier: string, oldTier: string) {
    const TIERS = ['MEMBER', 'Bac', 'Vang', 'KimCuong'];
    const oldIndex = TIERS.indexOf(oldTier);
    const newIndex = TIERS.indexOf(newTier);
    if (newIndex <= oldIndex) return;

    // Lấy danh sách hạng được thăng cấp lên (bỏ qua hạng đầu tiên MEMBER)
    const upgradedTiers = TIERS.slice(oldIndex + 1, newIndex + 1).filter(t => t !== 'MEMBER');
    if (upgradedTiers.length === 0) return;

    // Tìm tất cả voucher active của các hạng này
    const now = new Date();
    const vouchers = await Voucher.find({
      status: 'active',
      applicableTo: 'membership',
      minTier: { $in: upgradedTiers },
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    for (const v of vouchers) {
      // Đảm bảo không tạo bản ghi trùng lặp
      const existing = await UserVoucher.findOne({
        userId,
        voucherId: v._id,
      }).lean();

      if (!existing) {
        await UserVoucher.create({
          userId,
          voucherId: v._id,
          code: v.code,
          isUsed: false,
          grantedReason: 'membership',
        });
        console.log(`🎁 [Voucher Grant] Granted membership voucher ${v.code} to user ${userId}`);
      }
    }
  }

  /**
   * Tăng usedCount của voucher (gọi khi order thành công)
   */
  static async incrementUsage(id: string) {
    const voucher = await Voucher.findById(id);
    if (voucher) {
      voucher.usedCount = (voucher.usedCount || 0) + 1;
      await voucher.save();
    }
  }
}
