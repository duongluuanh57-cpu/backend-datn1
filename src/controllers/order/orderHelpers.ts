import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { Product } from '../../models/Product.ts';

/**
 * Require admin/subadmin role
 */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = (req as any).user;
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUBADMIN')) {
    reply.status(403).send({
      success: false,
      message: 'Bạn không có quyền thực hiện hành động này',
    });
    return false;
  }
  return true;
}

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