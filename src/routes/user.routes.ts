import type { FastifyInstance } from 'fastify';
import { UserController } from '../controllers/UserController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';

export async function userRoutes(app: FastifyInstance) {
  // Tất cả các route trong đây đều yêu cầu đăng nhập và là ADMIN
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/', UserController.getAllUsers);
  app.post('/', UserController.createUser);
  app.get('/:id', UserController.getUserById);
  app.patch('/:id', UserController.updateUser);
  app.patch('/:id/role', UserController.updateUserRole);
  app.delete('/:id', UserController.deleteUser);
}
