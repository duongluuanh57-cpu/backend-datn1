import type { FastifyRequest, FastifyReply } from 'fastify';
import { detectFrontendUrl } from '../../utils/viewHelpers.ts';

/**
 * Redirect /login ở backend về trang auth của frontend.
 * (Xác thực thật sự nằm ở AuthSessionController — file này chỉ redirect.)
 */
export class AuthPageController {
  static async getLoginPage(request: FastifyRequest, reply: FastifyReply) {
    const frontendUrl = detectFrontendUrl(request);
    return reply.redirect(`${frontendUrl.replace(/\/+$/, '')}/auth/login`);
  }
}
