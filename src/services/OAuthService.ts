import crypto from 'crypto';
import { UserRepository } from '../repositories/UserRepository.ts';
import { generateTokens, toPublicUser } from '../utils/auth.ts';
import { UnauthorizedError } from '../utils/errors.ts';
import type { IUser } from '../models/User.ts';

// Cấu hình cho từng OAuth Provider
const GOOGLE_CONFIG = {
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  scopes: 'openid email profile',
};


export class OAuthService {
  /**
   * Tạo State ngẫu nhiên để chống CSRF Attack
   */
  static generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Trả về URL để redirect user sang trang đăng nhập của Google
   */
  static getGoogleAuthUrl(state: string): string {
    const url = new URL(GOOGLE_CONFIG.authUrl);
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID || '');
    url.searchParams.set('redirect_uri', process.env.GOOGLE_REDIRECT_URI || '');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_CONFIG.scopes);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('state', state);
    return url.toString();
  }


  /**
   * Xử lý callback từ Google — đổi "code" lấy thông tin user rồi tạo JWT
   */
  static async handleGoogleCallback(code: string) {
    // Bước 1: Đổi code lấy access_token
    const tokenRes = await fetch(GOOGLE_CONFIG.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokenBody = (await tokenRes.json().catch(() => null)) as any;
    const access_token = tokenBody?.access_token;
    if (!tokenRes.ok || !access_token) {
      throw new UnauthorizedError('Google không cấp access_token cho mã ủy quyền này');
    }

    // Bước 2: Dùng access_token lấy thông tin user từ Google
    const profileRes = await fetch(GOOGLE_CONFIG.userInfoUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = (await profileRes.json().catch(() => null)) as any;
    // profile: { id, email, verified_email, name, picture }
    if (!profileRes.ok || !profile?.id || !profile?.email) {
      throw new UnauthorizedError('Không đọc được hồ sơ tài khoản Google');
    }

    return OAuthService.findOrCreateUser('google', {
      oauthId: profile.id,
      email: profile.email,
      emailVerified: profile.verified_email === true,
      username: profile.name?.replace(/\s+/g, '_').toLowerCase() || `user_${profile.id}`,
      avatar: profile.picture,
    });
  }

  /**
   * Sinh username duy nhất bằng cách thêm hậu tố tăng dần
   * khi username gốc đã tồn tại trong DB.
   */
  private static async generateUniqueUsername(base: string): Promise<string> {
    let username = base;
    let counter = 1;
    while (await UserRepository.findByUsername(username)) {
      username = `${base}_${counter}`;
      counter++;
    }
    return username;
  }


  /**
   * Tìm user trong DB theo oauthId. Nếu chưa có thì tạo mới.
   * Trả về bộ đôi JWT (accessToken + refreshToken)
   */
  private static async findOrCreateUser(
    provider: 'google',
    profile: { oauthId: string; email: string; emailVerified: boolean; username: string; avatar?: string }
  ) {
    // Fail-closed: email Google phải được Google xác minh. Nếu không thì
    // KHÔNG được liên kết (link) vào tài khoản email sẵn có trong DB — ai đó
    // đăng ký Google account với email tùy ý sẽ thừa hưởng được tài khoản thật.
    if (!profile.emailVerified) {
      throw new UnauthorizedError('Email tài khoản Google chưa được xác minh — không thể đăng nhập');
    }

    // Tìm theo oauthId trước
    let user = await UserRepository.findByOAuthId(provider, profile.oauthId);

    if (!user) {
      // Thử tìm theo email (user đã đăng ký bằng email trước đó)
      user = await UserRepository.findByEmail(profile.email);

      if (user) {
        // Gắn thêm OAuth vào tài khoản email cũ + cập nhật avatar từ Google
        user = await UserRepository.update(user._id.toString(), {
          oauthProvider: provider,
          oauthId: profile.oauthId,
          avatar: profile.avatar,
        } as any);
      } else {
        // Tạo user mới hoàn toàn — đảm bảo username không trùng user cũ
        const baseUsername = profile.username;
        let username = await OAuthService.generateUniqueUsername(baseUsername);

        // Retry phòng race-condition: 2 request đồng thời cùng tạo username giống nhau
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            user = await UserRepository.create({
              email: profile.email,
              username,
              oauthProvider: provider,
              oauthId: profile.oauthId,
              avatar: profile.avatar,
              role: 'USER',
            } as Partial<IUser>);
            break;
          } catch (err: any) {
            if (err?.code !== 11000) throw err;
            username = await OAuthService.generateUniqueUsername(baseUsername);
          }
        }
      }
    }

    const tokens = generateTokens(user!._id.toString(), user!.role);
    return {
      user: toPublicUser(user!),
      tokens,
    };
  }
}
