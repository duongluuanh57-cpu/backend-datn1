import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: 'USER' | 'ADMIN';
  memberTier: 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong';
  status: 'active' | 'inactive' | 'suspended';
  fullName?: string;
  phoneNumber?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | '';
  dateOfBirth?: string;
  avatar?: string;
  oauthProvider?: 'google';
  oauthId?: string;
  failedLoginAttempts?: number;
  lockUntil?: Date | null;
  passwordChangedAt?: Date | null;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, default: '' },
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
    memberTier: { type: String, enum: ['MEMBER', 'Bac', 'Vang', 'KimCuong'], default: 'MEMBER' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active', index: true },
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', ''], default: '' },
    dateOfBirth: { type: String, default: '' },
    avatar: { type: String, default: '' },
    oauthProvider: { type: String, enum: ['google'], index: true },
    oauthId: { type: String, index: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null, select: false },
  },

  {
    timestamps: true,
    collection: 'users',
  }
);

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);