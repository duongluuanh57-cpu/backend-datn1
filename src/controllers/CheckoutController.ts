import type { FastifyRequest, FastifyReply } from 'fastify';
import { CheckoutService, type CheckoutPayload } from '../services/cart/CheckoutService.ts';

export class CheckoutController {
  static async checkout(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const payload = req.body as CheckoutPayload;
      const data = await CheckoutService.processCheckout(userId, payload);

      return reply.send({
        success: true,
        data,
      });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }
}
