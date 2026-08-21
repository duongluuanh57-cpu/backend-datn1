import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/database.ts';
import { User } from '../models/User.ts';
import { hashPassword } from '../utils/auth.ts';

const ACCOUNTS_TO_SEED = [
  {
    role: 'USER' as const,
    email: 'user123@gmail.com',
    username: 'user123',
    fullName: 'Khách Hàng User 123',
    passwordRaw: '123123123',
    memberTier: 'MEMBER' as const,
  },
  {
    role: 'ADMIN' as const,
    email: 'admin123@gmail.com',
    username: 'admin123',
    fullName: 'Quản Trị Viên Admin 123',
    passwordRaw: '123123123',
    memberTier: 'KimCuong' as const,
  },
  {
    role: 'ADMIN' as const,
    email: 'admin321@gmail.com',
    username: 'admin321',
    fullName: 'Quản Trị Viên Admin 321',
    passwordRaw: '321321321',
    memberTier: 'KimCuong' as const,
  },
];

async function seedAccounts() {
  try {
    console.log('📡 Connecting to MongoDB...');
    await connectDB();
    console.log('✅ Connected to MongoDB successfully.');

    for (const acc of ACCOUNTS_TO_SEED) {
      const passwordHash = await hashPassword(acc.passwordRaw);
      
      const updatedUser = await User.findOneAndUpdate(
        { email: acc.email },
        {
          $set: {
            username: acc.username,
            email: acc.email,
            passwordHash,
            role: acc.role,
            memberTier: acc.memberTier,
            fullName: acc.fullName,
            status: 'active',
            failedLoginAttempts: 0,
            lockUntil: null,
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      console.log(`✨ [${acc.role}] Email: ${acc.email} | Mật khẩu: ${acc.passwordRaw} => ID: ${updatedUser._id}`);
    }

    console.log('\n🎉 Đã hoàn tất seed 3 tài khoản thành công!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding accounts:', error);
    process.exit(1);
  }
}

seedAccounts();
