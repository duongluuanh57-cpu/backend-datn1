import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UnauthorizedError } from './errors.ts';
import { safeRedisGet, safeRedisSet } from '../config/redis.ts';
import type { IUser } from '../models/User.ts';

export const toPublicUser = (user: IUser) => ({
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role,
  memberTier: user.memberTier || 'MEMBER',
  membershipRewardedTier: user.membershipRewardedTier || 'MEMBER',
  totalSpent: user.totalSpent || 0,
  rewardPoints: user.rewardPoints || 0,
  status: user.status || 'active',
  fullName: user.fullName || '',
  phoneNumber: user.phoneNumber || '',
  gender: user.gender || '',
  avatar: user.avatar || '',
  hasPassword: !!user.passwordHash,
  createdAt: user.createdAt,
});

// Đọc secret lúc gọi hàm (lazy) thay vì lúc import module — vì dotenv.config()
// trong app.ts chạy SAU khi toàn bộ import tree đã evaluate (ESM hoisting).
// Thiếu secret → throw ngay lần đầu dùng, không bao giờ ký token bằng key công khai.
function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} là bắt buộc — kiểm tra file .env`);
  return value;
}

// Chuẩn hoá issuer và audience — dùng để validate claim khi verify
const JWT_ISSUER = process.env.JWT_ISSUER || 'saas-core-backend';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'saas-core-client';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LOCAL_IPS = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];

// Tên cookie session (đặt 1 nơi, middleware + controller cùng dùng)
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
// Cookie rieng cho admin panel (access token cua admin khong co cookie user counterpart)
export const ADMIN_COOKIE = 'admin_token';

// TTL chuẩn hoá: user thường 15 phút / 7 ngày — admin 12 giờ / 14 ngày (trước đây admin là 365 ngày)
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;   // 7 ngày (giây) — blacklist/cookie refresh user

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Tạo bộ đôi JWT theo JWT Best Practices:
 * - Thêm `type` claim để phân biệt access vs refresh token
 * - Thêm `iss` (issuer) và `aud` (audience) để validate nguồn gốc
 * - Whitelist algorithm: HS256
 * - Refresh token có `jti` (JWT ID) duy nhất — phục vụ rotation: khi cấp token mới,
 *   token cũ bị blacklist theo jti thay vì theo giá trị token (ngắn gọn, an toàn hơn).
 */
export const generateTokens = (userId: string, role: string) => {
  const isAdmin = role === 'ADMIN';
  const accessExpiresIn = isAdmin ? '12h' : '15m';
  const refreshExpiresIn = isAdmin ? '14d' : '7d';
  const refreshJti = crypto.randomUUID();

  const accessToken = jwt.sign(
    {
      sub: userId,       // subject (RFC 7519) — đọc ra ở verify, không trùng claim phụ
      role,
      type: 'access',
    },
    requiredSecret('JWT_SECRET'),
    {
      expiresIn: accessExpiresIn,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );

  const refreshToken = jwt.sign(
    {
      sub: userId,
      type: 'refresh',   // Chỉ dùng để lấy access token mới, không dùng vào việc khác
    },
    requiredSecret('JWT_REFRESH_SECRET'),
    {
      expiresIn: refreshExpiresIn,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: refreshJti,
    }
  );

  return { accessToken, refreshToken };
};

/**
 * Xác minh Access Token với đầy đủ kiểm tra bảo mật:
 * - Whitelist algorithm HS256 (chống Algorithm Confusion Attack)
 * - Validate issuer và audience
 * - Validate type claim (chống dùng refresh token thay access token)
 */
export const verifyAccessToken = (token: string): { userId: string; role: string; iat?: number } => {
  const decoded = jwt.verify(token, requiredSecret('JWT_SECRET'), {
    algorithms: ['HS256'],     // Chỉ chấp nhận HS256, chặn 'none' và các alg khác
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'access') {
    throw new Error('Invalid token type — refresh token không được dùng ở đây');
  }

  return { userId: decoded.sub, role: decoded.role, iat: decoded.iat };
};

/**
 * Thu hồi phiên theo user.
 *
 * Access/refresh token là JWT stateless nên đổi mật khẩu một mình không vô hiệu hóa được
 * token đang sống: kẻ chiếm tài khoản vẫn dùng tiếp tới hết hạn (user 15 phút, admin 12 giờ,
 * refresh 7 ngày). Lưu mốc thu hồi trong Redis rồi từ chối mọi token ký TRƯỚC mốc đó.
 *
 * Redis không sẵn dụng → `safeRedisGet` trả null tức fail-open: phiên cũ sống nốt TTL
 * (ngắn) thay vì cả site sập theo Redis.
 */
const SESSIONS_REVOKED_TTL_SECONDS = 14 * 24 * 60 * 60; // bằng TTL refresh token dài nhất

export const revokeUserSessions = async (userId: string): Promise<void> => {
  await safeRedisSet(
    sessionsRevokedBeforeKey(userId),
    new Date().toISOString(),
    'EX',
    SESSIONS_REVOKED_TTL_SECONDS
  );
};

export const isSessionRevoked = async (userId: string, iat?: number): Promise<boolean> => {
  if (!userId || !iat) return false;
  const revokedAt = await safeRedisGet(sessionsRevokedBeforeKey(userId));
  if (!revokedAt) return false;
  return iat * 1000 < new Date(revokedAt).getTime();
};

/**
 * Xác minh Refresh Token — trả về kèm jti để rotation blacklist token cũ
 */
export const verifyRefreshToken = (token: string): { userId: string; jti?: string; iat?: number } => {
  const decoded = jwt.verify(token, requiredSecret('JWT_REFRESH_SECRET'), {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return { userId: decoded.sub, jti: decoded.jti, iat: decoded.iat };
};

/** Key blacklist theo jti (rotation) hoặc theo token (legacy) */
export const refreshTokenBlacklistKey = (token: string, jti?: string): string =>
  jti ? `blacklist:jti:${jti}` : `blacklist:${token}`;

/** Mốc "mọi token ký trước thời điểm này đều chết" của một user (đổi mật khẩu). */
const sessionsRevokedBeforeKey = (userId: string): string => `auth:sessions-revoked:${userId}`;

/**
 * Xác minh Cloudflare Turnstile server-side.
 * - Token bắt buộc và phải hợp lệ. Không còn bypass khi thiếu secret:
 *   nếu TURNSTILE_SECRET_KEY chưa cấu hình, app fail-fast khi đăng ký/đăng nhập
 *   để lộ lỗi cấu hình ngay lập tức thay vì mở cửa cho bot.
 */
export const verifyTurnstile = async (token: string | undefined, ip: string): Promise<void> => {
  const secret = process.env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET;
  if (!secret) {
    throw new UnauthorizedError('Server chưa cấu hình TURNSTILE_SECRET_KEY — kiểm tra file .env');
  }
  if (!token) throw new UnauthorizedError('Vui lòng hoàn tất xác minh bảo mật.');
  try {
    const formData = new URLSearchParams();
    formData.append('secret', secret);
    formData.append('response', token);
    if (ip && !LOCAL_IPS.includes(ip)) {
      formData.append('remoteip', ip);
    }
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: formData,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const outcome = await res.json() as any;
    if (outcome.success !== true) throw new UnauthorizedError('Xác minh bảo mật thất bại.');
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Xác minh bảo mật thất bại.');
  }
};
