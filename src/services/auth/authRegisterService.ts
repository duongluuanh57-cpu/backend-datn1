import { UserRepository } from '../../repositories/UserRepository.ts';
import type { RegisterInput } from '../../types/user.types.ts';
import { hashPassword, generateTokens, toPublicUser } from '../../utils/auth.ts';
import { ValidationError } from '../../utils/errors.ts';
import { normalizeEmail } from '../../utils/email.ts';

export class AuthRegisterService {
  static async register(data: RegisterInput) {
    // Chuẩn hóa: email và username lưu lowercase + trim — chặn trùng lặp kiểu John/john
    const email = normalizeEmail(data.email);
    const username = data.username.trim().toLowerCase();

    const existingEmail = await UserRepository.findByEmail(email);
    if (existingEmail) {
      // Tài khoản chỉ có Google (chưa từng đặt mật khẩu): câu "Email đã được sử dụng" chung
      // chung khiến người dùng đi tìm email khác, trong khi việc cần làm là bấm nút Google.
      const googleOnly = existingEmail.oauthProvider === 'google' && !existingEmail.passwordHash;
      throw new ValidationError(
        googleOnly
          ? 'Email này đã đăng ký bằng Google — hãy đăng nhập bằng Google thay vì tạo tài khoản mới'
          : 'Email đã được sử dụng',
      );
    }

    const existingUsername = await UserRepository.findByUsername(username);
    if (existingUsername) throw new ValidationError('Username đã được sử dụng');

    const passwordHash = await hashPassword(data.password);

    const newUser = await UserRepository.create({
      username,
      email,
      passwordHash,
      role: 'USER',
      memberTier: 'MEMBER',
    });

    const tokens = generateTokens(newUser._id.toString(), newUser.role);

    return {
      user: toPublicUser(newUser),
      tokens
    };
  }
}
