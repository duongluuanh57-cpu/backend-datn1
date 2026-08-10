import type { FastifyInstance } from 'fastify';
import { UserAddressController } from '../controllers/userAddress/userAddressController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';

export async function userAddressRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/user-addresses — Lấy tất cả địa chỉ
  app.get('/', UserAddressController.getMyAddresses);

  // POST /api/user-addresses — Thêm địa chỉ mới
  app.post('/', UserAddressController.createAddress);

  // PATCH /api/user-addresses/:id — Cập nhật địa chỉ
  app.patch('/:id', UserAddressController.updateAddress);

  // DELETE /api/user-addresses/:id — Xóa địa chỉ
  app.delete('/:id', UserAddressController.deleteAddress);

  // PATCH /api/user-addresses/:id/set-default — Đặt làm mặc định
  app.patch('/:id/set-default', UserAddressController.setDefault);
}
