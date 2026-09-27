import type { FastifyRequest, FastifyReply } from 'fastify';
import { CartService } from '../services/cart/CartService.ts';
import { CheckoutService, type CheckoutPayload } from '../services/cart/CheckoutService.ts';
import { User } from '../models/User.ts';

export class CartController {
  /**
   * Delegate method for backward compatibility
   */
  static async resolveBuyNowItems(items: Array<{ productId: string; quantity?: number; variantSize?: string }>) {
    return await CheckoutService.resolveBuyNowItems(items);
  }

  static async getCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const data = await CartService.getCart(userId);
      const user = await User.findById(userId).select('rewardPoints').lean() as any;
      return reply.send({
        success: true,
        data: {
          ...data,
          rewardPoints: user?.rewardPoints || 0,
        },
      });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async addToCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, quantity = 1, variantSize } = req.body as { productId: string; quantity?: number; variantSize?: string };
      const data = await CartService.addToCart(userId, productId, quantity, variantSize);

      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async updateCartItem(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, quantity, variantSize } = req.body as { productId: string; quantity: number; variantSize?: string };
      const data = await CartService.updateCartItem(userId, productId, quantity, variantSize);

      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async updateCartItemVariant(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, currentVariantSize, newVariantSize } = req.body as { productId: string; currentVariantSize?: string; newVariantSize: string };
      const data = await CartService.updateCartItemVariant(userId, productId, newVariantSize, currentVariantSize);

      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async removeCartItem(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { productId } = req.params as { productId: string };
      const { variantSize } = req.query as { variantSize?: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const data = await CartService.removeCartItem(userId, productId, variantSize);
      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async clearCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const data = await CartService.clearCart(userId);
      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async listAvailableVouchers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const data = await CartService.listAvailableVouchers(userId);
      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async applyVoucher(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      // Voucher là state phía client (giỏ hàng chỉ có cart_items), nên client gửi
      // kèm các mã đang áp dụng để server validate + trả lại đầy đủ trạng thái.
      const { code, voucherCode, voucherDiscount, freeshipVoucherCode } = req.body as {
        code: string;
        voucherCode?: string | null;
        voucherDiscount?: number;
        freeshipVoucherCode?: string | null;
      };
      const res = await CartService.applyVoucher(userId, code, { voucherCode, voucherDiscount, freeshipVoucherCode });

      return reply.send(res);
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async removeVoucher(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { code, type, voucherCode, voucherDiscount, freeshipVoucherCode } = (req.body || req.query || {}) as {
        code?: string;
        type?: 'discount' | 'freeship';
        voucherCode?: string | null;
        voucherDiscount?: number;
        freeshipVoucherCode?: string | null;
      };
      const res = await CartService.removeVoucher(userId, code, type, {
        voucherCode,
        voucherDiscount,
        freeshipVoucherCode,
      });

      return reply.send(res);
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }

  static async checkout(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const payload = req.body as CheckoutPayload;
      const data = await CheckoutService.processCheckout(userId, payload);

      return reply.send({ success: true, data });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }
}
