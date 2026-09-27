import type { FastifyInstance } from 'fastify';
import { OAuthController } from '../controllers/OAuthController.ts';

/**
 * Google OAuth — login/register bằng tài khoản Google.
 *
 * Route PHẢI được đăng ký với prefix /api/auth (xem app.ts) vì frontend
 * (components/auth/google-button.tsx) trỏ thẳng tới /api/auth/google.
 */
export async function oauthRoutes(app: FastifyInstance) {
  // GET /api/auth/google — redirect sang Google, state chống CSRF lưu ở Redis
  app.get('/google', OAuthController.initiateGoogle);

  // GET /api/auth/google/callback — Google gọi lại, set httpOnly cookie rồi redirect về FE
  app.get('/google/callback', OAuthController.googleCallback);
}
