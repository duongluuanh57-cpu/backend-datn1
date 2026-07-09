import mongoose, { Document, Schema } from 'mongoose';
import { multiTenancyPlugin } from '../utils/multiTenancyPlugin.ts';

export interface IUserAddress extends Document {
  userId: mongoose.Types.ObjectId;
  label?: string;          // VD: "Nhà riêng", "Công ty", "Ký túc xá"
  address?: string;        // Số nhà, tên đường
  province?: string;       // Tỉnh / Thành phố
  district?: string;       // Quận / Huyện
  isDefault: boolean;      // Địa chỉ mặc định
  createdAt: Date;
  updatedAt: Date;
}

const UserAddressSchema = new Schema<IUserAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, default: 'Địa chỉ của tôi' },
    address: { type: String, default: '' },
    province: { type: String, default: '' },
    district: { type: String, default: '' },
    isDefault: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'user_addresses',
  }
);

UserAddressSchema.plugin(multiTenancyPlugin);

export const UserAddress =
  mongoose.models.UserAddress ||
  mongoose.model<IUserAddress>('UserAddress', UserAddressSchema);
