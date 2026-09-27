import { PaymentMethod, type PaymentMethodCode } from '../models/PaymentMethod.ts';

/**
 * PaymentMethodService — danh mục phương thức thanh toán.
 *
 * Bảng `payments` đã bị xoá: thông tin giao dịch nằm trực tiếp trên `orders`
 * (payment_method_id, bank_code, payment_txn_ref, payment_transaction_code, paid_at).
 */

export class PaymentMethodService {
  static async getAll(onlyActive = false) {
    const filter: any = {};
    if (onlyActive) filter.status = 'active';
    // Thứ tự hiển thị cố định: COD trước VNPay.
    return PaymentMethod.find(filter).sort({ code: 1 }).lean();
  }

  static async getById(id: string) {
    return PaymentMethod.findOne({ _id: id }).lean();
  }

  static async create(data: {
    name: string;
    code: PaymentMethodCode;
    description?: string;
    icon?: string;
  }) {
    if (data.code !== 'cod' && data.code !== 'vnpay') {
      throw new Error('Chỉ hỗ trợ phương thức thanh toán COD hoặc VNPay');
    }

    return PaymentMethod.create({
      name: data.name,
      code: data.code,
      description: data.description || '',
      icon: data.icon || '',
    });
  }

  static async update(
    id: string,
    data: { name?: string; description?: string; icon?: string; status?: 'active' | 'inactive' }
  ) {
    return PaymentMethod.findOneAndUpdate(
      { _id: id },
      { $set: data },
      { new: true }
    ).lean();
  }

  static async delete(id: string) {
    const result = await PaymentMethod.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }
}
