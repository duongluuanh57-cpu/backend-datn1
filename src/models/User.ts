import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

// Định nghĩa Interface (TypeScript) cho User
export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: 'USER' | 'ADMIN' | 'SUBADMIN';
  memberTier: 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong';
  status: 'active' | 'inactive' | 'suspended'; // Trạng thái tài khoản
  fullName?: string;
  phoneNumber?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | '';
  // OAuth fields
  oauthProvider?: 'google' | 'github';  // Provider đăng nhập OAuth
  oauthId?: string;                      // ID từ provider
  createdAt: Date;
}

// Định nghĩa Schema (Mongoose) dựa trên Interface
const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String },          // Optional với OAuth users (không có mật khẩu)
    role: { type: String, enum: ['USER', 'ADMIN', 'SUBADMIN'], default: 'USER' },
    memberTier: { type: String, enum: ['MEMBER', 'Bac', 'Vang', 'KimCuong'], default: 'MEMBER' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', index: true }, // Trạng thái tài khoản
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', ''], default: '' },
    oauthProvider: { type: String, enum: ['google', 'github'], index: true },
    oauthId: { type: String, index: true },
  },

  {
    timestamps: true, // Tự động quản lý createdAt và updatedAt
    collection: 'users' // Ép trùng tên với collection 'users' trên DB của bạn
  }
);

// Áp dụng Plugin Multi-tenancy
UserSchema.plugin(multiTenancyPlugin);

// Tránh lỗi overwrite model nếu file bị gọi lại nhiều lần
export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
