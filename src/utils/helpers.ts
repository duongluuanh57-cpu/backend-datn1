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

export const FREE_SHIP_THRESHOLD = 500_000;
export const SHIPPING_FEE = 30_000;
export const EXPRESS_SHIPPING_FEE = 30_000;

/**
 * Tính phí vận chuyển. Phí là hằng số của hệ thống (không còn bảng shipping_methods),
 * frontend chỉ hiển thị lại đúng các con số này.
 */
export async function calculateShippingFee(totalAmount: number, shippingMethodCode?: string): Promise<{ fee: number }> {
  if (shippingMethodCode === 'express') {
    return { fee: EXPRESS_SHIPPING_FEE };
  }
  return { fee: totalAmount >= FREE_SHIP_THRESHOLD ? 0 : SHIPPING_FEE };
}
