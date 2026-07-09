import crypto from 'crypto';
import { UserRepository } from '../repositories/UserRepository.ts';
import { generateTokens } from '../utils/auth.ts';
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
    const { access_token } = await tokenRes.json() as any;

    // Bước 2: Dùng access_token lấy thông tin user từ Google
    const profileRes = await fetch(GOOGLE_CONFIG.userInfoUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = await profileRes.json() as any;
    // profile: { id, email, name, picture }

    return OAuthService.findOrCreateUser('google', {
      oauthId: profile.id,
      email: profile.email,
      username: profile.name?.replace(/\s+/g, '_').toLowerCase() || `user_${profile.id}`,
    });
  }


  /**
   * Tìm user trong DB theo oauthId. Nếu chưa có thì tạo mới.
   * Trả về bộ đôi JWT (accessToken + refreshToken)
   */
  private static async findOrCreateUser(
    provider: 'google',
    profile: { oauthId: string; email: string; username: string }
  ) {
    // Tìm theo oauthId trước
    let user = await UserRepository.findByOAuthId(provider, profile.oauthId);

    if (!user) {
      // Thử tìm theo email (user đã đăng ký bằng email trước đó)
      user = await UserRepository.findByEmail(profile.email);

      if (user) {
        // Gắn thêm OAuth vào tài khoản email cũ
        user = await UserRepository.update(user._id.toString(), {
          oauthProvider: provider,
          oauthId: profile.oauthId,
        } as any);
      } else {
        // Tạo user mới hoàn toàn
        user = await UserRepository.create({
          email: profile.email,
          username: profile.username,
          oauthProvider: provider,
          oauthId: profile.oauthId,
          role: 'USER',
        } as Partial<IUser>);
      }
    }

    const tokens = generateTokens(user!._id.toString(), user!.role, false);
    return {
      user: { id: user!._id, username: user!.username, email: user!.email },
      tokens,
    };
  }
}
