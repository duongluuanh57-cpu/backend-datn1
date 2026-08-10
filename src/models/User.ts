import mongoose, { Document, Schema } from 'mongoose';
// Định nghĩa Interface (TypeScript) cho User
export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: 'USER' | 'ADMIN' | 'SUBADMIN';
  memberTier: 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong';
  totalSpent?: number;
  status: 'active' | 'inactive' | 'suspended'; // Trạng thái tài khoản
  fullName?: string;
  phoneNumber?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | '';
  dateOfBirth?: string; // Ngày sinh (YYYY-MM-DD)
  avatar?: string; // URL avatar từ R2
  // OAuth fields
  oauthProvider?: 'google';  // Provider đăng nhập OAuth
  oauthId?: string;                      // ID từ provider
  createdAt: Date;
  spinTurns?: number;
  lastDailySpinGrantedAt?: Date;
  spentTurnsGranted?: number;
  rankTurnsGranted?: number;
  lastLoginAt?: Date;
  failedLoginAttempts?: number;
  lockUntil?: Date;
}

// Định nghĩa Schema (Mongoose) dựa trên Interface
const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, default: '' },   // Optional với OAuth users (không có mật khẩu)
    role: { type: String, enum: ['USER', 'ADMIN', 'SUBADMIN'], default: 'USER' },
    memberTier: { type: String, enum: ['MEMBER', 'Bac', 'Vang', 'KimCuong'], default: 'MEMBER' },
    totalSpent: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', index: true }, // Trạng thái tài khoản
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', ''], default: '' },
    dateOfBirth: { type: String, default: '' },
    avatar: { type: String, default: '' },
    oauthProvider: { type: String, enum: ['google'], index: true },
    oauthId: { type: String, index: true },
    spinTurns: { type: Number, default: 0 },
    lastDailySpinGrantedAt: { type: Date },
    spentTurnsGranted: { type: Number, default: 0 },
    rankTurnsGranted: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
  },

  {
    timestamps: true, // Tự động quản lý createdAt và updatedAt
    collection: 'users' // Ép trùng tên với collection 'users' trên DB của bạn
  }
);

// Tránh lỗi overwrite model nếu file bị gọi lại nhiều lần
export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);