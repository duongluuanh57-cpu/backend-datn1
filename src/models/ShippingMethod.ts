import mongoose, { Document, Schema } from 'mongoose';

export interface IShippingMethod extends Document {
  name: string;            // Tên hiển thị (VD: "Giao hàng tiêu chuẩn")
  code: string;            // Mã định danh (VD: "standard", "express")
  fee: number;             // Phí giao hàng mặc định (VNĐ)
  freeShipMinAmount: number; // Đơn tối thiểu miễn phí ship (VNĐ), 0 = không miễn
  estimatedDays: string;   // Thời gian giao dự kiến (VD: "3-5 ngày")
  isActive: boolean;       // Bật/tắt phương thức giao hàng
  sortOrder: number;       // Thứ tự hiển thị trong trang Checkout
  createdAt: Date;
  updatedAt: Date;
}

const ShippingMethodSchema = new Schema<IShippingMethod>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fee: { type: Number, default: 0, min: 0 },
    freeShipMinAmount: { type: Number, default: 0, min: 0 },
    estimatedDays: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'shipping_methods',
  }
);

export const ShippingMethod =
  mongoose.models.ShippingMethod || mongoose.model<IShippingMethod>('ShippingMethod', ShippingMethodSchema);
