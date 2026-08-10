import type { FastifyRequest } from 'fastify';

/**
 * Lấy userId từ request (sau authMiddleware).
 */
export function getUserId(req: FastifyRequest): string | null {
  return (req as any).user?.userId || null;
}

/**
 * Lấy IP client từ request.
 */
export function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  const ip = req.ip || '127.0.0.1';
  return ip === '::1' ? '127.0.0.1' : ip;
}

import { ShippingMethod } from '../models/ShippingMethod.ts';

export const FREE_SHIP_THRESHOLD = 500_000;
export const SHIPPING_FEE = 30_000;

/**
 * Tính phí vận chuyển dựa trên ShippingMethod từ DB.
 * Fallback về giá trị mặc định nếu không tìm thấy trong DB.
 */
export async function calculateShippingFee(totalAmount: number, shippingMethodCode?: string): Promise<{ fee: number; methodId: string | null }> {
  const code = shippingMethodCode || 'standard';

  // Tra cứu phương thức giao hàng từ DB
  const method = await ShippingMethod.findOne({ code, isActive: true }).lean();

  if (method) {
    // Nếu đơn hàng >= mức miễn phí ship của phương thức này
    const fee = (method.freeShipMinAmount > 0 && totalAmount >= method.freeShipMinAmount) ? 0 : method.fee;
    return { fee, methodId: method._id.toString() };
  }

  // Fallback nếu chưa có dữ liệu trong DB
  const fallbackFee = totalAmount >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
  return { fee: fallbackFee, methodId: null };
}
