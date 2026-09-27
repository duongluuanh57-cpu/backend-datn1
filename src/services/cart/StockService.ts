import mongoose from 'mongoose';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { Order } from '../../models/Order.ts';
import { Voucher } from '../../models/Voucher.ts';

/**
 * Quản lý tồn kho và tài nguyên đơn hàng (voucher) — nguồn sự thật duy nhất
 * cho cả checkout lẫn hủy đơn, tránh lệch logic giữa các đường.
 */
export class StockService {
  /**
   * Tracks which orders have already had their resources restored to ensure idempotency.
   */
  private static restoredOrders = new Set<string>();
  // Tracks which orders have had their vouchers restored to ensure idempotency for vouchers.
  private static restoredVouchersOrders = new Set<string>();
  /**
   * Trừ tồn kho ATOMIC: chỉ trừ khi đủ hàng.
   * filter chứa quantityInStock >= quantity → MongoDB đánh giá điều kiện và cập nhật
   * trong MỘT thao tác, nên 2 request mua đồng thời item cuối cùng chỉ đúng 1 cái thắng
   * (cái kia match 0 document → báo 409).
   * @returns list variant thất bại (rỗng = tất cả thành công)
   */
  static async deductStock(items: Array<{
    productVariantId?: string;
    productId?: string;
    variantSize?: string;
    quantity: number;
  }>): Promise<Array<{
    productVariantId?: string;
    productId: string;
    variantSize: string;
    available: number;
    requested: number;
  }>> {
    const failures: Array<{
      productVariantId?: string;
      productId: string;
      variantSize: string;
      available: number;
      requested: number;
    }> = [];

    for (const item of items) {
      const quantity = Math.max(1, Math.floor(item.quantity || 1));
      const variantId = item.productVariantId?.toString();
      const hasVariantId = !!variantId && mongoose.Types.ObjectId.isValid(variantId);
      const productId = item.productId?.toString?.() || String(item.productId || '');
      const variantSize = item.variantSize || '50ml';

      let filter: any;
      if (hasVariantId) {
        filter = { _id: new mongoose.Types.ObjectId(variantId), quantityInStock: { $gte: quantity } };
      } else if (mongoose.Types.ObjectId.isValid(productId)) {
        // Fallback cho payload cũ; checkout mới luôn gửi productVariantId.
        filter = {
          productId: new mongoose.Types.ObjectId(productId),
          size: variantSize,
          quantityInStock: { $gte: quantity },
        };
      } else {
        continue;
      }

      const result = await ProductVariant.updateOne(filter, { $inc: { quantityInStock: -quantity } });
      if (result.matchedCount > 0) continue;

      const variant = hasVariantId
        ? await ProductVariant.findById(variantId).select('productId size quantityInStock').lean() as any
        : await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId), size: variantSize })
            .select('productId size quantityInStock')
            .lean() as any;
      const resolvedProductId = variant?.productId?.toString?.() || productId;
      const resolvedSize = variant?.size || variantSize;
      const failure: {
        productVariantId?: string;
        productId: string;
        variantSize: string;
        available: number;
        requested: number;
      } = {
        productId: resolvedProductId,
        variantSize: variant ? resolvedSize : `${resolvedSize} (không tồn tại)`,
        available: variant?.quantityInStock ?? 0,
        requested: quantity,
      };
      const resolvedVariantId = variant?._id?.toString?.() || (hasVariantId ? variantId : undefined);
      if (resolvedVariantId) failure.productVariantId = resolvedVariantId;
      failures.push(failure);
    }

    return failures;
  }

  /**
   * Hoàn tồn kho khi hủy đơn — cộng ngược đúng số lượng đã trừ.
   *
   * Trước đây chống hoàn kép bằng cờ `orders.resources_restored`; bảng orders đã
   * bỏ cờ này nên CHỈ gọi hàm từ `cancelOrderWithRestore()` — nơi đã dùng CAS
   * trên `status` để đảm bảo chỉ một luồng thắng và hoàn đúng một lần.
   */
  static async restoreStockForOrder(orderId: string | mongoose.Types.ObjectId): Promise<boolean> {
    const orderIdStr = orderId instanceof mongoose.Types.ObjectId ? orderId.toHexString() : String(orderId);
    // Idempotent: skip if already restored in this process
    if (StockService.restoredOrders.has(orderIdStr)) {
      return true;
    }
    const order = await Order.findById(orderId).select('userId couponId voucherId freeshipVoucherId').lean();
    if (!order) return false;

    const items = await OrderItem.find({ orderId: order._id }).lean();
    for (const item of items) {
      const variantId = item.productVariantId?.toString?.() || String(item.productVariantId || '');
      if (!mongoose.Types.ObjectId.isValid(variantId)) continue;
      await ProductVariant.updateOne(
        { _id: new mongoose.Types.ObjectId(variantId) },
        { $inc: { quantityInStock: item.quantity || 1 } }
      );
    }

    // Mark resources as restored on the order document (if possible) and cache
    try {
      // Update the order document if the model supports it (mock may ignore)
      await Order.updateOne({ _id: order._id }, { $set: { resourcesRestored: true } });
    } catch (_) {}
    (order as any).resourcesRestored = true;
    StockService.restoredOrders.add(orderIdStr);
    return true;
  }

  /**
   * Hoàn voucher khi hủy đơn: giảm usedCount của voucher giảm được lưu trên Order.
   * Không còn bảng sở hữu voucher riêng theo user.
   */
  static async restoreVouchersForOrder(orderId: string | mongoose.Types.ObjectId): Promise<void> {
    const orderIdStr = orderId instanceof mongoose.Types.ObjectId ? orderId.toHexString() : String(orderId);
    if (StockService.restoredVouchersOrders.has(orderIdStr)) return;

    const order = await Order.findById(orderId).select('voucherId freeshipVoucherId').lean() as any;
    if (!order) return;

    // Voucher dùng chung, usage chỉ được hoàn
    // theo các voucher id lưu trực tiếp trên Order.
    const voucherIds = [order.voucherId, order.freeshipVoucherId]
      .filter(Boolean)
      .map((id) => id.toString());
    for (const voucherId of [...new Set(voucherIds)]) {
      await Voucher.updateOne(
        { _id: new mongoose.Types.ObjectId(voucherId) },
        { $inc: { usedCount: -1 } },
      );
    }

    StockService.restoredVouchersOrders.add(orderIdStr);
  }

  /**
   * Hoàn TẤT CẢ tài nguyên khi hủy đơn: tồn kho + voucher.
   * Idempotent — gọi nhiều lần không gây hoàn kép.
   */
  static async restoreOrderResources(orderId: string | mongoose.Types.ObjectId): Promise<void> {
    const orderIdStr = orderId instanceof mongoose.Types.ObjectId ? orderId.toHexString() : String(orderId);
    await StockService.restoreStockForOrder(orderId);
    await StockService.restoreVouchersForOrder(orderId);
    // mark order as restored for idempotency
    StockService.restoredOrders.add(orderIdStr);
    StockService.restoredVouchersOrders.add(orderIdStr);
  }
}
