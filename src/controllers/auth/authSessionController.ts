import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  verifyTurnstile,
  verifyRefreshToken,
  refreshTokenBlacklistKey,
  generateTokens,
  isSessionRevoked,
  toPublicUser,
  REFRESH_COOKIE,
} from '../../utils/auth.ts';
import {
  setSessionCookies,
  setAdminCookie,
  clearSessionCookies,
  REFRESH_COOKIE_MAX_AGE,
} from '../../utils/sessionCookies.ts';
import { UnauthorizedError } from '../../utils/errors.ts';
import { redis } from '../../config/redis.ts';
import { UserRepository } from '../../repositories/UserRepository.ts';
import { AuthRegisterService } from '../../services/auth/authRegisterService.ts';
import { AuthSessionService } from '../../services/auth/authSessionService.ts';
import type { RegisterInput, LoginInput } from '../../types/user.types.ts';

export class AuthSessionController {
  static async register(request: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) {
    const data = request.body;

    await verifyTurnstile(data.turnstileToken, request.ip);

    const { user, tokens } = await AuthRegisterService.register(data);

    // Đăng ký xong = đăng nhập luôn: cấp luôn session cookie
    setSessionCookies(reply, tokens);

    return reply.status(201).send({
      success: true,
      message: 'Đăng ký thành công',
      // KHÔNG trả token trong body: session chỉ nằm ở httpOnly cookie ở trên.
      data: {
        user,
      },
    });
  }

  static async login(request: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) {
    const data = request.body;

    await verifyTurnstile(data.turnstileToken, request.ip);

    const { user, tokens } = await AuthSessionService.login(data);

    // ADMIN cũng phải nhận access+refresh cookie. FE chỉ có một đường khôi phục phiên
    // sau F5 là /auth/refresh (SessionManager → restoreSession); thiếu refresh cookie
    // thì mở /admin trực tiếp hoặc reload đều bị đá về trang đăng nhập.
    // admin_token và access_token vốn là CÙNG một accessToken nên set cả hai
    // không nới thêm quyền hạn nào của phiên.
    setSessionCookies(reply, tokens);
    if (user.role === 'ADMIN') {
      setAdminCookie(reply, tokens.accessToken);
    }

    return reply.send({
      success: true,
      message: 'Đăng nhập thành công',
      // Session chỉ nằm trong httpOnly cookie vừa set — body không mang token (XSS không
      // đọc được refresh token 7 ngày nữa).
      data: {
        user,
      },
    });
  }

  static async refresh(request: FastifyRequest, reply: FastifyReply) {
    // Nhận refresh token từ cookie (ưu tiên) hoặc body (tương thích ngược)
    const body = (request.body || {}) as { refreshToken?: string };
    const cookies = (request as any).cookies || {};
    const refreshToken = cookies[REFRESH_COOKIE] || body.refreshToken;
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    const isBlacklisted = await redis.get(refreshTokenBlacklistKey(refreshToken, undefined));
    if (isBlacklisted) throw new UnauthorizedError('Token đã bị thu hồi');

    const { userId, jti, iat } = verifyRefreshToken(refreshToken);

    // Kiểm tra blacklist theo jti (token generation mới)
    if (jti) {
      const jtiBlacklisted = await redis.get(refreshTokenBlacklistKey(refreshToken, jti));
      if (jtiBlacklisted) throw new UnauthorizedError('Token đã bị thu hồi');
    }

    // Refresh cấp trước lần đổi mật khẩu gần nhất → không nối lại phiên được nữa.
    if (await isSessionRevoked(userId, iat)) {
      throw new UnauthorizedError('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    }

    const user = await UserRepository.findByIdWithSecurity(userId);
    if (!user) throw new UnauthorizedError('Người dùng không tồn tại');

    // Chặn refresh cho tài khoản không active — admin khóa tài khoản phải có tác dụng ngay,
    // không cho session cũ tự gia hạn vô hạn.
    if (user.status !== 'active') {
      throw new UnauthorizedError(
        user.status === 'suspended'
          ? 'Tài khoản của bạn đã bị khóa.'
          : 'Tài khoản của bạn không khả dụng.',
      );
    }

    // ── Rotation: token cũ chết ngay khi token mới được cấp ──
    const tokens = generateTokens(userId, user.role);
    if (jti) {
      await redis.set(
        refreshTokenBlacklistKey(refreshToken, jti),
        '1',
        'EX',
        REFRESH_COOKIE_MAX_AGE
      );
    }

    setSessionCookies(reply, tokens);
    // admin_token hết hạn sau 12 giờ — phải set lại ở đây, nếu không phiên user vẫn
    // tự nối dài còn /admin chết 401 đúng giữa lúc đang làm việc.
    if (user.role === 'ADMIN') setAdminCookie(reply, tokens.accessToken);

    // Trả kèm user public — frontend dùng để khôi phục session sau F5 mà không cần gọi thêm /me.
    // Token mới chỉ nằm trong cookie vừa set ở trên.
    return reply.send({
      success: true,
      message: 'Cấp lại token thành công',
      data: {
        user: toPublicUser(user),
      },
    });
  }

  static async logout(request: FastifyRequest, reply: FastifyReply) {
    const body = (request.body || {}) as { refreshToken?: string };
    const cookies = (request as any).cookies || {};
    const refreshToken = cookies[REFRESH_COOKIE] || body.refreshToken;
    if (!refreshToken) throw new UnauthorizedError('Refresh token là bắt buộc');

    // Service tự verify token + blacklist theo jti (xác minh quyền sở hữu).
    // Cookie admin_token là access token stateless — logout chỉ xóa được khỏi máy client;
    // muốn cắt ngay token admin đang sống thì dùng đổi mật khẩu (revokeUserSessions).
    await AuthSessionService.logout(refreshToken);

    clearSessionCookies(reply);

    return reply.send({
      success: true,
      message: 'Đăng xuất thành công',
    });
  }
}
