import { UserRepository } from '../../repositories/UserRepository.ts';
import type { RegisterInput } from '../../types/user.types.ts';
import { hashPassword, generateTokens } from '../../utils/auth.ts';
import { ValidationError } from '../../utils/errors.ts';
import { AuditLog } from '../../models/AuditLog.ts';

export class AuthRegisterService {
  static async register(data: RegisterInput) {
    // 1. Kiểm tra email/username đã tồn tại chưa
    const existingEmail = await UserRepository.findByEmail(data.email);
    if (existingEmail) throw new ValidationError('Email đã được sử dụng');

    const existingUsername = await UserRepository.findByUsername(data.username);
    if (existingUsername) throw new ValidationError('Username đã được sử dụng');

    // 2. Mã hóa mật khẩu
    const passwordHash = await hashPassword(data.password);

    // 3. Tạo User mới trong DB
    const newUser = await UserRepository.create({
      username: data.username,
      email: data.email,
      passwordHash,
      role: 'USER',
      memberTier: 'MEMBER',
    });

    // 4. Audit Logging
    await AuditLog.create({
      userId: newUser._id,
      action: 'REGISTER',
      resource: 'User',
      metadata: { email: newUser.email },
      status: 'SUCCESS'
    });

    // 5. Sinh bộ đôi JWT Token
    const tokens = generateTokens(newUser._id.toString(), newUser.role, false);

    return {
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        memberTier: newUser.memberTier,
        status: newUser.status,
        fullName: newUser.fullName || '',
        phoneNumber: newUser.phoneNumber || '',
        gender: newUser.gender || '',
        createdAt: newUser.createdAt
      },
      tokens
    };
  }
}