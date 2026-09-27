import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import rateLimit from '@fastify/rate-limit';
import { AuthSessionController } from '../controllers/auth/authSessionController.ts';
import { AuthProfileController } from '../controllers/auth/authProfileController.ts';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import { RegisterSchema, LoginSchema, ChangePasswordSchema } from '../types/user.types.ts';

export async function authRoutes(app: FastifyInstance) {
  // Rate limit các endpoint nhạy cảm — 50 req/phút mỗi IP.
  // verify-password/change-password cũng phải nằm trong đây: mỗi lượt thử là một lần
  // so sánh bcrypt, nếu để lọt thì chỉ còn quota chung 600/phút của role.
  // request.url luôn là full path (/api/auth/login) kể cả trong plugin có prefix,
  // nên bắt bằng suffix thay vì so sánh tuyệt đối.
  await app.register(rateLimit, {
    max: 50,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.ip;
    },
    allowList: (request: any) => {
      if (request.method !== 'POST') return true;
      return !/\/(login|register|verify-password|change-password)$/.test(request.url || '');
    },
    errorResponseBuilder: () => ({
      statusCode: 429, // @fastify/rate-limit v10 throw giá trị này — thiếu statusCode sẽ bị map thành 500
      success: false,
      message: 'Vượt quá giới hạn yêu cầu, vui lòng thử lại sau',
    }),
  });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // ── API Routes ──
  typedApp.post('/register', {
    schema: { body: RegisterSchema },
  }, AuthSessionController.register);

  typedApp.post('/login', {
    schema: { body: LoginSchema },
  }, AuthSessionController.login);

  // Cấp lại Access Token bằng Refresh Token
  // refreshToken đến từ httpOnly cookie là chính; controller chỉ đọc body khi có.
  // Schema bắt buộc từng khai ở đây chặn request hợp lệ ngay từ validation (400) — để optional.
  typedApp.post('/refresh', {
    schema: {
      body: z.object({ refreshToken: z.string().optional() })
    }
  }, AuthSessionController.refresh);

  // Đăng xuất — đưa Refresh Token vào Blacklist
  typedApp.post('/logout', {
    schema: {
      body: z.object({ refreshToken: z.string().optional() })
    }
  }, AuthSessionController.logout);

  // Xác minh mật khẩu trước khi cho sửa thông tin nhạy cảm — chỉ so sánh, không ghi gì
  typedApp.post('/verify-password', {
    preHandler: authMiddleware,
    schema: {
      body: z.object({ password: z.string().min(1, 'Vui lòng nhập mật khẩu') })
    }
  }, AuthProfileController.verifyPassword);

  // Đổi mật khẩu cho user đang đăng nhập
  typedApp.post('/change-password', {
    preHandler: authMiddleware,
    schema: {
      body: ChangePasswordSchema
    }
  }, AuthProfileController.changePassword);

  // Lấy thông tin người dùng đang đăng nhập
  typedApp.get('/me', {
    preHandler: authMiddleware
  }, AuthProfileController.getMe);

  // Cập nhật thông tin cá nhân
  typedApp.patch('/update-profile', {
    preHandler: authMiddleware,
    schema: {
      body: z.object({
        username: z.string().min(3, 'Tên người dùng phải có ít nhất 3 ký tự').max(50).optional(),
        email: z.string().email('Email không đúng định dạng').optional(),
        fullName: z.string().max(100).optional(),
        phoneNumber: z.string().max(20).optional(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER', '']).optional(),
        dateOfBirth: z.string().max(10).optional(),
        // Chỉ bắt buộc khi đổi email — server kiểm ở authProfileController.updateProfile.
        currentPassword: z.string().optional(),
      })
    }
  }, AuthProfileController.updateProfile);

  // Upload avatar
  typedApp.post('/upload-avatar', {
    preHandler: authMiddleware,
  }, AuthProfileController.uploadAvatar);
}