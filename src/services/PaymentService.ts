import { Payment, type PaymentStatus } from '../models/Payment.ts';
import { PaymentMethod } from '../models/PaymentMethod.ts';

// ─── Payment Method CRUD ───

export class PaymentMethodService {
  static async getAll(onlyActive = false) {
    const filter: any = {};
    if (onlyActive) filter.isActive = true;
    return PaymentMethod.find(filter).sort({ sortOrder: 1 }).lean();
  }

  static async getById(id: string) {
    return PaymentMethod.findOne({ _id: id }).lean();
  }

  static async create(data: { name: string; code: string; icon?: string; sortOrder?: number }) {
    return PaymentMethod.create({
      name: data.name,
      code: data.code,
      icon: data.icon || '',
      sortOrder: data.sortOrder ?? 0,
    });
  }

  static async update(id: string, data: { name?: string; icon?: string; isActive?: boolean; sortOrder?: number }) {
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

// ─── Payment Transaction CRUD ───

export class PaymentService {
  static async getAll() {
    return Payment.find({})
      .populate({ path: 'orderId', select: 'customerName totalAmount status' })
      .sort({ createdAt: -1 })
      .lean();
  }

  static async getById(id: string) {
    return Payment.findOne({ _id: id })
      .populate({ path: 'orderId', select: 'customerName customerPhone totalAmount status' })
      .lean();
  }

  static async getByOrder(orderId: string) {
    return Payment.find({ orderId })
      .sort({ createdAt: -1 })
      .lean();
  }

  static async create(data: { orderId: string; method: string }) {
    // Resolve method code to PaymentMethod ObjectId
    const paymentMethod = await PaymentMethod.findOne({ code: data.method }).lean();
    return Payment.create({
      orderId: data.orderId,
      paymentMethodId: paymentMethod?._id || undefined,
      method: data.method,
    });
  }

  static async markPaid(id: string, transactionCode: string | undefined) {
    return Payment.findOneAndUpdate(
      { _id: id },
      { $set: { status: 'paid' as PaymentStatus, transactionCode: transactionCode || undefined, paidAt: new Date() } },
      { new: true }
    );
  }

  static async markFailed(id: string) {
    return Payment.findOneAndUpdate(
      { _id: id },
      { $set: { status: 'failed' as PaymentStatus } },
      { new: true }
    );
  }

  static async markRefunded(id: string) {
    return Payment.findOneAndUpdate(
      { _id: id },
      { $set: { status: 'refunded' as PaymentStatus, refundedAt: new Date() } },
      { new: true }
    );
  }

  static async delete(id: string) {
    const result = await Payment.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }
}