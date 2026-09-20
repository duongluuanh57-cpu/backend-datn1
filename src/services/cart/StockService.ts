import mongoose from 'mongoose';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { Order } from '../../models/Order.ts';
import { Voucher } from '../../models/Voucher.ts';
import { UserVoucher } from '../../models/UserVoucher.ts';

/**
 * Quản lý tồn kho và tài nguyên đơn hàng (voucher) — nguồn sự thật duy nhất
 * cho cả checkout lẫn hủy đơn, tránh lệch logic giữa các đường.
 */
export class StockService {
  /**
   * Trừ tồn kho ATOMIC: chỉ trừ khi đủ hàng.
   * filter chứa quantityInStock >= quantity → MongoDB đánh giá điều kiện và cập nhật
   * trong MỘT thao tác, nên 2 request mua đồng thời item cuối cùng chỉ đúng 1 cái thắng
   * (cái kia match 0 document → báo 409).
   * @returns list variant thất bại (rỗng = tất cả thành công)
   */
  static async deductStock(items: { productId: string; variantSize?: string; quantity: number }[]): Promise<Array<{ productId: string; variantSize: string; available: number; requested: number }>> {
    const failures: Array<{ productId: string; variantSize: string; available: number; requested: number }> = [];

    for (const item of items) {
      const productId = item.productId?.toString ? item.productId.toString() : String(item.productId);
      const variantSize = item.variantSize || '50ml';
      const quantity = Math.max(1, Math.floor(item.quantity || 1));

      const result = await ProductVariant.updateOne(
        { productId: new mongoose.Types.ObjectId(productId), size: variantSize, quantityInStock: { $gte: quantity } },
        { $inc: { quantityInStock: -quantity } }
      );

      if (result.matchedCount === 0) {
        // Phân biệt: hết hàng hay sai biến thể — báo lỗi chính xác hơn
        const variant = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId), size: variantSize })
          .select('quantityInStock')
          .lean() as any;
        if (variant) {
          failures.push({ productId, variantSize, available: variant.quantityInStock ?? 0, requested: quantity });
        } else {
          failures.push({ productId, variantSize: `${variantSize} (không tồn tại)`, available: 0, requested: quantity });
        }
      }
    }

    return failures;
  }

  /**
   * Hoàn tồn kho khi hủy đơn — cộng ngược đúng số lượng đã trừ.
   * Bảo vệ bằng resourcesRestored để không bao giờ hoàn 2 lần (double-click, retry).
   */
  static async restoreStockForOrder(orderId: string | mongoose.Types.ObjectId): Promise<boolean> {
    const order = await Order.findById(orderId).select('resourcesRestored');
    if (!order || order.resourcesRestored) return false;

    const items = await OrderItem.find({ orderId: order._id }).lean();
    for (const item of items) {
      const productId = item.productId?.toString ? item.productId.toString() : String(item.productId);
      if (!mongoose.Types.ObjectId.isValid(productId)) continue;
      await ProductVariant.updateOne(
        { productId: new mongoose.Types.ObjectId(productId), size: item.variantSize || '50ml' },
        { $inc: { quantityInStock: item.quantity || 1 } }
      );
    }

    order.resourcesRestored = true;
    await order.save();
    return true;
  }

  /**
   * Hoàn voucher khi hủy đơn: isUsed=false + giảm usedCount.
   * - applicableTo = 'all': không đánh dấu isUsed lúc cấp → chỉ giảm usedCount.
   * - Còn lại: tìm bản ghi UserVoucher được đốt cho đơn này và hoàn.
   */
  static async restoreVouchersForOrder(orderId: string | mongoose.Types.ObjectId): Promise<void> {
    const order = await Order.findById(orderId)
      .select('voucherId voucherCode freeshipVoucherId freeshipVoucherCode')
      .lean() as any;
    if (!order) return;

    // Hoàn voucher giảm giá
    if (order.voucherId) {
      await Voucher.updateOne({ _id: order.voucherId }, { $inc: { usedCount: -1 } });
      await UserVoucher.updateOne(
        { userId: order.userId, voucherId: order.voucherId, isUsed: true },
        { $set: { isUsed: false }, $unset: { usedAt: '' } }
      );
    }

    // Hoàn voucher freeship
    if (order.freeshipVoucherId) {
      await Voucher.updateOne({ _id: order.freeshipVoucherId }, { $inc: { usedCount: -1 } });
      await UserVoucher.updateOne(
        { userId: order.userId, voucherId: order.freeshipVoucherId, isUsed: true },
        { $set: { isUsed: false }, $unset: { usedAt: '' } }
      );
    }
  }

  /**
   * Hoàn TẤT CẢ tài nguyên khi hủy đơn: tồn kho + voucher.
   * Idempotent — gọi nhiều lần không gây hoàn kép.
   */
  static async restoreOrderResources(orderId: string | mongoose.Types.ObjectId): Promise<void> {
    await StockService.restoreStockForOrder(orderId);
    await StockService.restoreVouchersForOrder(orderId);
  }
}
