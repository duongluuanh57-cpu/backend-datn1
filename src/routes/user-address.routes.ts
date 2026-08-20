import type { FastifyInstance } from 'fastify';
import { UserAddressController } from '../controllers/userAddress/userAddressController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function userAddressRoutes(app: FastifyInstance) {
  // Public proxy routes cho tỉnh/thành Việt Nam (tránh CORS và Open-API redirect errors trên deploy)
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

  // Protected routes cho user addresses
  app.get('/', { preHandler: authMiddleware }, UserAddressController.getMyAddresses);
  app.post('/', { preHandler: authMiddleware }, UserAddressController.createAddress);
  app.patch('/:id', { preHandler: authMiddleware }, UserAddressController.updateAddress);
  app.delete('/:id', { preHandler: authMiddleware }, UserAddressController.deleteAddress);
  app.patch('/:id/set-default', { preHandler: authMiddleware }, UserAddressController.setDefault);
}
