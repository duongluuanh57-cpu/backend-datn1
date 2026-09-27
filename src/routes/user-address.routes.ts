import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UserAddressController } from '../controllers/userAddress/userAddressController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import { CreateAddressSchema, UpdateAddressSchema } from '../types/address.types.ts';

export async function userAddressRoutes(app: FastifyInstance) {
  // Public proxy cho tỉnh/huyện/xã VN — FE gọi qua backend để tránh CORS và redirect lỗi
  // của provinces.open-api.vn trên deploy. Mất 3 route này là bộ chọn địa chỉ ở checkout chết.
  app.get('/provinces', async (_req, reply) => {
    try {
      const res = await fetch('https://provinces.open-api.vn/api/p/');
      const data = await res.json();
      return reply.send({ success: true, data: data || [] });
    } catch {
      return reply.send({ success: true, data: [] });
    }
  });

  app.get('/districts/:provinceCode', async (req, reply) => {
    try {
      const { provinceCode } = req.params as { provinceCode: string };
      const res = await fetch(`https://provinces.open-api.vn/api/p/${provinceCode}?depth=2`);
      const data = await res.json();
      return reply.send({ success: true, data: data?.districts || [] });
    } catch {
      return reply.send({ success: true, data: [] });
    }
  });

  app.get('/wards/:districtCode', async (req, reply) => {
    try {
      const { districtCode } = req.params as { districtCode: string };
      const res = await fetch(`https://provinces.open-api.vn/api/d/${districtCode}?depth=2`);
      const data = await res.json();
      return reply.send({ success: true, data: data?.wards || [] });
    } catch {
      return reply.send({ success: true, data: [] });
    }
  });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.get('/', { preHandler: authMiddleware }, UserAddressController.getMyAddresses);
  typedApp.post('/', { preHandler: authMiddleware, schema: { body: CreateAddressSchema } }, UserAddressController.createAddress);
  typedApp.patch('/:id', { preHandler: authMiddleware, schema: { body: UpdateAddressSchema } }, UserAddressController.updateAddress);
  typedApp.delete('/:id', { preHandler: authMiddleware }, UserAddressController.deleteAddress);
  typedApp.patch('/:id/set-default', { preHandler: authMiddleware }, UserAddressController.setDefault);
}
