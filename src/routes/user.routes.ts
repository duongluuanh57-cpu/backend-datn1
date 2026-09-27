import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UserController } from '../controllers/UserController.ts';
import { authMiddleware, requireRole } from '../middleware/authMiddleware.ts';
import { CreateAdminSchema, UpdateUserSchema } from '../types/user.types.ts';

export async function userRoutes(app: FastifyInstance) {
  // Toàn bộ /api/users là khu vực quản trị.
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('ADMIN'));

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get('/', UserController.getAllUsers);
  typedApp.post('/', { schema: { body: CreateAdminSchema } }, UserController.createUser);
  typedApp.get('/:id', UserController.getUserById);
  typedApp.patch('/:id', { schema: { body: UpdateUserSchema } }, UserController.updateUser);
}
