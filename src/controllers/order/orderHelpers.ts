import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { ProductImage } from '../../models/ProductImage.ts';

/**
 * Bổ sung ảnh thương hiệu còn thiếu vào snapshot item của đơn hàng.
 */
export async function enhanceItemsWithProductData(items: any[]): Promise<void> {
  if (!items || items.length === 0) return;

  const rawIds = items.map((i: any) => i.productId?.toString()).filter(Boolean);
  const productIds = [...new Set(rawIds)].map((id) => new mongoose.Types.ObjectId(id as string));

  if (productIds.length === 0) return;

  const [productData, productImages] = await Promise.all([
    Product.find(
      { _id: { $in: productIds } },
      { _id: 1, image: 1, brandId: 1 }
    ).populate('brandId', 'name logo').lean(),
    ProductImage.find({ productId: { $in: productIds } }).select('url productId').sort({ createdAt: 1 }).lean(),
  ]);

  const imgMap = new Map<string, string>();
  for (const pi of productImages) {
    const pid = pi.productId.toString();
    if (!imgMap.has(pid)) imgMap.set(pid, pi.url);
  }

  for (const item of items) {
    const pid = item.productId?.toString();
    const prod = productData.find((p: any) => p._id.toString() === pid);
    const brandLogo = (prod?.brandId as any)?.logo;
    const resolvedProdImage = imgMap.get(pid || '') || prod?.image || null;
    let finalImg = item.image || resolvedProdImage;
    if (brandLogo && finalImg === brandLogo) {
      finalImg = imgMap.get(pid || '') || null;
    }
    item.productImage = finalImg;
  }
}

/**
 * Ensures order.itemsSubtotal and order.totalAmount correctly account for vouchers and discounts.
 */
export function populateOrderTotals(order: any, items: any[]): void {
  const calculatedSubtotal = items.reduce((sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
  order.itemsSubtotal = order.itemsSubtotal || calculatedSubtotal;

  let vDiscount = order.voucherDiscount || 0;
  if (!vDiscount && order.voucherId && typeof order.voucherId === 'object') {
    const v = order.voucherId;
    if (v.type === 'percentage') {
      vDiscount = Math.min(calculatedSubtotal * ((v.value || 0) / 100), v.maxDiscount || Infinity);
    } else if (v.type === 'fixed') {
      vDiscount = v.value || 0;
    }
    order.voucherDiscount = vDiscount;
  }
  if (!order.voucherCode && order.voucherId && typeof order.voucherId === 'object' && order.voucherId.code) {
    order.voucherCode = order.voucherId.code;
  }

  const sFee = order.shippingFee || 0;
  const fsDiscount = order.freeshipDiscount || 0;

  if (order.totalAmount === undefined || order.totalAmount === null || (order.totalAmount === calculatedSubtotal && (vDiscount > 0 || fsDiscount > 0))) {
    order.totalAmount = Math.max(0, calculatedSubtotal + sFee - vDiscount - fsDiscount);
  }
}

/**
 * Tự động hủy các đơn hàng VNPay chưa thanh toán quá 15 phút
 */
export async function autoCancelExpiredVNPayOrders(userId?: string): Promise<void> {
  const { Order } = await import('../../models/Order.ts');
  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
  const query: any = {
    paymentMethod: 'vnpay',
    paymentStatus: 'unpaid',
    status: 'pending',
    createdAt: { $lt: fifteenMinsAgo },
  };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  }
  // Lấy id các đơn bị hủy để hoàn kho + voucher (updateMany không trả ids)
  const expired = await Order.find(query).select('_id').lean();
  await Order.updateMany(query, { $set: { status: 'cancelled' } });

  if (expired.length > 0) {
    const { StockService } = await import('../../services/cart/StockService.ts');
    for (const o of expired) {
      await StockService.restoreOrderResources(o._id);
    }
  }
}

/**
 * Tăng/giảm soldCount của sản phẩm theo các item của đơn hàng.
 * delta = 1 khi đơn được xác nhận/thanh toán, delta = -1 khi đơn bị hủy.
 */
export async function adjustTotalSold(items: any[], delta: number): Promise<void> {
  if (!items || items.length === 0) return;
  await Promise.all(
    items.map((i: any) => {
      const productId = i.productId?.toString ? i.productId.toString() : String(i.productId);
      if (!mongoose.Types.ObjectId.isValid(productId)) return Promise.resolve();
      return Product.updateOne(
        { _id: new mongoose.Types.ObjectId(productId) },
        { $inc: { soldCount: delta * (i.quantity || 1) } }
      );
    })
  );

  // Xóa cache Redis của Top Trending và Homepage để cập nhật bảng xếp hạng tức thì (Real-time)
  try {
    const { redis } = await import('../../config/redis.ts');
    const trendingKeys = await redis.keys('products:trending:*');
    const homepageKeys = await redis.keys('homepage:*');
    const allKeys = [...trendingKeys, ...homepageKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  } catch {
    /* Redis optional */
  }
}

/**
 * Đánh dấu đơn hàng đã được cộng soldCount (chỉ cộng đúng 1 lần).
 * Gọi khi đơn được xác nhận (status → processing) hoặc thanh toán thành công.
 */
export async function markSoldCounted(orderId: any): Promise<boolean> {
  const { Order } = await import('../../models/Order.ts');
  const { OrderItem } = await import('../../models/OrderItem.ts');
  const order = await Order.findById(orderId);
  if (!order || order.soldCounted) return false;
  const items = await OrderItem.find({ orderId: order._id }).lean();
  await adjustTotalSold(items, 1);
  order.soldCounted = true;
  await order.save();
  return true;
}

/**
 * Trả lại soldCount khi đơn bị hủy (chỉ trừ nếu đã từng được cộng).
 */
export async function unmarkSoldCounted(orderId: any): Promise<boolean> {
  const { Order } = await import('../../models/Order.ts');
  const { OrderItem } = await import('../../models/OrderItem.ts');
  const order = await Order.findById(orderId);
  if (!order || !order.soldCounted) return false;
  const items = await OrderItem.find({ orderId: order._id }).lean();
  await adjustTotalSold(items, -1);
  order.soldCounted = false;
  await order.save();
  return true;
}
