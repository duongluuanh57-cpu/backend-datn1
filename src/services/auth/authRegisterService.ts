import { UserRepository } from '../../repositories/UserRepository.ts';
import type { RegisterInput } from '../../types/user.types.ts';
import { hashPassword, generateTokens, toPublicUser } from '../../utils/auth.ts';
import { ValidationError } from '../../utils/errors.ts';

export class AuthRegisterService {
  static async register(data: RegisterInput) {
    // Chuẩn hóa: email và username lưu lowercase + trim — chặn trùng lặp kiểu John/john
    const email = data.email.trim().toLowerCase();
    const username = data.username.trim().toLowerCase();

    const existingEmail = await UserRepository.findByEmail(email);
    if (existingEmail) throw new ValidationError('Email đã được sử dụng');

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
