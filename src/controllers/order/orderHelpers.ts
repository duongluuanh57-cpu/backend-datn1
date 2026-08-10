import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Product } from '../../models/Product.ts';
import { requireAdmin } from '../../utils/adminAuth.ts';

export { requireAdmin } from '../../utils/adminAuth.ts';

/**
 */
export async function enhanceItemsWithProductData(items: any[]): Promise<void> {
  if (!items || items.length === 0) return;

  const rawIds = items.map((i: any) => i.productId?.toString()).filter(Boolean);
  const productIds = [...new Set(rawIds)].map((id) => new mongoose.Types.ObjectId(id as string));

  if (productIds.length === 0) return;

  const [variants, productData] = await Promise.all([
    ProductVariant.find({ productId: { $in: productIds } }).lean(),
    Product.find(
      { _id: { $in: productIds } },
      { _id: 1, reviewsCount: 1, image: 1 }
    ).lean(),
  ]);

  for (const item of items) {
    const pid = item.productId?.toString();
    item.variants = variants.filter((v: any) => v.productId?.toString() === pid);
    const prod = productData.find((p: any) => p._id.toString() === pid);
    item.productReviewsCount = prod?.reviewsCount || 0;
    item.productImage = prod?.image || null;
  }
}

/**
 * Recalculate totalAmount from items
 */
export function recalculateTotalAmount(items: any[]): number {
  return items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
}

/**
 * Build date filter from query params
 */
export function buildDateFilter(startDate?: string, endDate?: string): Record<string, Date> | undefined {
  if (!startDate && !endDate) return undefined;
  const dateQuery: any = {};
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    dateQuery.$gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    dateQuery.$lte = end;
  }
  return dateQuery;
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
  await Order.updateMany(query, { $set: { status: 'cancelled' } });
}