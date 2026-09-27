import mongoose, { Document, Schema } from 'mongoose';
import { type MemberTier } from '../utils/memberTier.ts';

export interface IUser extends Document {
  username: string;
  email: string;
  passwordHash: string;
  role: 'USER' | 'ADMIN';
  memberTier: MemberTier;
  membershipRewardedTier: MemberTier;
  totalSpent: number;
  rewardPoints: number;
  status: 'active' | 'suspended';
  // Virtual populated field: danh sách địa chỉ của user (0..n).
  // Đây là virtual, vì vậy không được lưu trong collection, nhưng khi
  // `User.findById(...).populate('addresses')` sẽ được gán vào đây.
  addresses?: any[];
  fullName?: string;
  phoneNumber?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | '';
  dateOfBirth?: string;
  avatar?: string;
  oauthProvider?: 'google';
  oauthId?: string;
  createdAt: Date;
  // Virtual populated field: list of favorites for this user (0..n)
  favorites?: any[]; // using any to avoid circular import; can be typed as IFavorite[] if preferred
}

const UserSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, default: '' },
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
    memberTier: { type: String, enum: ['MEMBER', 'Bac', 'Vang', 'KimCuong'], default: 'MEMBER' },
    membershipRewardedTier: { type: String, enum: ['MEMBER', 'Bac', 'Vang', 'KimCuong'], default: 'MEMBER' },
    totalSpent: { type: Number, default: 0, min: 0 },
    rewardPoints: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'suspended'], default: 'active', index: true },
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', ''], default: '' },
    dateOfBirth: { type: String, default: '' },
    avatar: { type: String, default: '' },
    oauthProvider: { type: String, enum: ['google'], index: true },
    oauthId: { type: String, index: true },
  },

  {
    timestamps: true,
    collection: 'users',
  }
);

// ------------------------------------------------------------
// Quan hệ: User (1) -> UserAddress (0..n)
// Một User có thể không có địa chỉ nào hoặc có nhiều địa chỉ.
// Mỗi UserAddress chỉ thuộc về một User (trường userId là bắt buộc).
// Virtual này cho phép populate('addresses') trả về một mảng các địa chỉ.
UserSchema.virtual('addresses', {
  ref: 'UserAddress',
  localField: '_id',
  foreignField: 'userId',
  justOne: false, // 0..n
});

// ------------------------------------------------------------
// Relationship: User (1) -> Order (0..n)
// ------------------------------------------------------------
// A user may have zero, one, or many orders. Each Order stores a
// `userId` field that references the User. Adding this virtual
// enables `User.findById(id).populate('orders')` to retrieve all
// orders for a user without storing an array inside the user document.
UserSchema.virtual('orders', {
  ref: 'Order',
  localField: '_id',
  foreignField: 'userId',
  justOne: false,
});

   // ------------------------------------------------------------
   // Relationship: User (1) -> Favorite (0..n)
   // ------------------------------------------------------------
   // A user may have zero or many favorite entries. Each Favorite
   // references a single user via the `userId` field (see src/models/Favorite.ts).
   // Adding this virtual enables `populate('favorites')` from the User side
   // without storing an array directly in the User document.
   UserSchema.virtual('favorites', {
     ref: 'Favorite', // model name defined in Favorite.ts
     localField: '_id',
     foreignField: 'userId',
     justOne: false, // return an array of favorites
   });

UserSchema.set('toObject', { virtuals: true });
UserSchema.set('toJSON', { virtuals: true });

export const User = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
