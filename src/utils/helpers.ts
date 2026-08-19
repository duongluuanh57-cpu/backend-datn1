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

import mongoose from 'mongoose';
import { ShippingMethod } from '../models/ShippingMethod.ts';

export const FREE_SHIP_THRESHOLD = 500_000;
export const SHIPPING_FEE = 30_000;

/**
 * Tính phí vận chuyển dựa trên ShippingMethod từ DB.
 * Fallback về giá trị mặc định nếu không tìm thấy trong DB hoặc DB chưa kết nối.
 */
export async function calculateShippingFee(totalAmount: number, shippingMethodCode?: string): Promise<{ fee: number; methodId: string | null }> {
  const code = shippingMethodCode || 'standard';

  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const method = await ShippingMethod.findOne({ code, isActive: true }).lean();
      if (method) {
        if (code === 'express') {
          const fee = Math.round(totalAmount * 0.05);
          return { fee, methodId: method._id.toString() };
        }
        const fee = (method.freeShipMinAmount > 0 && totalAmount >= method.freeShipMinAmount) ? 0 : method.fee;
        return { fee, methodId: method._id.toString() };
      }
    }
  } catch (_) {}

  // Fallback nếu chưa có dữ liệu trong DB hoặc DB chưa kết nối
  if (code === 'express') {
    return { fee: Math.round(totalAmount * 0.05), methodId: null };
  }
  const fallbackFee = totalAmount >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE;
  return { fee: fallbackFee, methodId: null };
}
