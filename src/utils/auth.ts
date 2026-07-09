import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-dev-only';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super-refresh-secret-key';

// Chuẩn hoá issuer và audience — dùng để validate claim khi verify
const JWT_ISSUER = process.env.JWT_ISSUER || 'saas-core-backend';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'saas-core-client';

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
 */
export const generateTokens = (userId: string, role: string, rememberMe: boolean = false) => {
  const isAdmin = role === 'ADMIN' || role === 'SUBADMIN';
  const accessExpiresIn = isAdmin ? '365d' : (rememberMe ? '7d' : '15m');
  const refreshExpiresIn = isAdmin ? '365d' : '7d';

  const accessToken = jwt.sign(
    {
      sub: userId,       // subject — chuẩn RFC 7519
      userId,
      role,
      type: 'access',
    },
    JWT_SECRET,
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
      userId,
      type: 'refresh',   // Chỉ dùng để lấy access token mới, không dùng vào việc khác
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: refreshExpiresIn,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
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
export const verifyAccessToken = (token: string): { userId: string; role: string } => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],     // Chỉ chấp nhận HS256, chặn 'none' và các alg khác
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as any;

  if (decoded.type !== 'access') {
    throw new Error('Invalid token type — refresh token không được dùng ở đây');
  }

  return { userId: decoded.userId, role: decoded.role };
};

/**
 * Xác minh Refresh Token
 */
export const verifyRefreshToken = (token: string): { userId: string } => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
  }) as any;

  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return { userId: decoded.userId };
};
