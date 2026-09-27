import mongoose, { Document, Schema } from 'mongoose';
export interface IUserAddress extends Document {
  userId: mongoose.Types.ObjectId;
  addressType: 'home' | 'office'; // Loại địa chỉ: Nhà riêng hoặc Văn phòng
  fullName?: string;       // Họ và tên người nhận
  phoneNumber?: string;    // Số điện thoại người nhận
  address?: string;        // Số nhà, tên đường
  province?: string;       // Tỉnh / Thành phố
  district?: string;       // Quận / Huyện
  ward?: string;           // Phường / Xã
  latitude?: number;       // Vĩ độ từ Google Maps
  longitude?: number;      // Kinh độ từ Google Maps
  isDefault: boolean;      // Địa chỉ mặc định
  createdAt: Date;
  updatedAt: Date;
}

const UserAddressSchema = new Schema<IUserAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    addressType: { type: String, enum: ['home', 'office'], default: 'home' },
    fullName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    province: { type: String, default: '' },
    district: { type: String, default: '' },
    ward: { type: String, default: '' },
    latitude: { type: Number },
    longitude: { type: Number },
    isDefault: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'user_addresses',
  }
);

// Invariant "mỗi user tối đa 1 địa chỉ mặc định" do DB đảm bảo, không chỉ ở app layer.
// Index partial: chỉ các doc có isDefault=true mới bị ràng buộc unique theo userId,
// nên 2 request set-default đồng thời sẽ có 1 request dính E11000 thay vì tạo ra 2 default.
// ponytail: app-layer vẫn "unset-all rồi set-one" (2 query, không transaction). Index này
// chặn dữ liệu hỏng chứ không làm thao tác atomic. Upgrade path nếu cần: bọc
// unset+set trong 1 transaction, hoặc findOneAndUpdate default cũ và mới theo cặp.
UserAddressSchema.index(
  { userId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export const UserAddress =
  mongoose.models.UserAddress ||
  mongoose.model<IUserAddress>('UserAddress', UserAddressSchema);