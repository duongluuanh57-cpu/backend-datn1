import mongoose, { Document, Schema } from 'mongoose';

export interface IFlashSaleItem {
  productId: mongoose.Types.ObjectId; // Reference to Product (populate đầy đủ thông tin Product)
  extraDiscountPercentage: number;     // Số % giảm giá CỘNG THÊM trong đợt Flash Sale (Tổng % Giảm = % Giảm thường + extraDiscountPercentage)
  stockLimit: number;                  // Giới hạn số lượng bán trong đợt Flash Sale (0 = không giới hạn)
  soldCount: number;                   // Số lượng đã bán được trong đợt Flash Sale này
}

export interface IFlashSale extends Document {
  name: string;                // Tên sự kiện Flash Sale (VD: "Flash Sale 8/8 Khung Giờ Vàng")
  startDate: Date;             // Ngày & giờ bắt đầu Flash Sale
  endDate: Date;               // Ngày & giờ kết thúc Flash Sale
  status: 'scheduled' | 'active' | 'ended' | 'inactive'; // Trạng thái đợt Flash Sale
  items: IFlashSaleItem[];     // Danh sách sản phẩm tham gia Flash Sale
  createdAt: Date;
  updatedAt: Date;
}

const FlashSaleItemSchema = new Schema<IFlashSaleItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    extraDiscountPercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
    stockLimit: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const FlashSaleSchema = new Schema<IFlashSale>(
  {
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['scheduled', 'active', 'ended', 'inactive'],
      default: 'scheduled',
      index: true,
    },
    items: {
      type: [FlashSaleItemSchema],
      default: [],
      validate: [
        (val: IFlashSaleItem[]) => !val || val.length <= 20,
        'Mỗi đợt Flash Sale chỉ được chọn tối đa 20 sản phẩm',
      ],
    },
  },
  {
    timestamps: true,
    collection: 'flash_sales',
  }
);

FlashSaleSchema.index({ status: 1, startDate: 1, endDate: 1 });

export const FlashSale =
  mongoose.models.FlashSale || mongoose.model<IFlashSale>('FlashSale', FlashSaleSchema);
