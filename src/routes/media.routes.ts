import type { FastifyInstance } from 'fastify';
import { MediaController } from '../controllers/MediaController.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';

export async function mediaRoutes(app: FastifyInstance) {
  // Protected by admin auth
  app.addHook('preHandler', adminAuthMiddleware);

  app.post('/upload-r2', MediaController.uploadImage);
  app.delete('/images', MediaController.deleteImage);
}
