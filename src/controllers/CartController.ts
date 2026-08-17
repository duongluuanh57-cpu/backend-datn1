import type { FastifyRequest, FastifyReply } from 'fastify';
import { CartService } from '../services/cart/CartService.ts';
import { CheckoutService, type CheckoutPayload } from '../services/cart/CheckoutService.ts';

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
      return reply.send({ success: true, data });
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

      const { code } = req.body as { code: string };
      const res = await CartService.applyVoucher(userId, code);

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

      const { code, type } = (req.body || req.query || {}) as { code?: string; type?: 'discount' | 'freeship' };
      const res = await CartService.removeVoucher(userId, code, type);

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
