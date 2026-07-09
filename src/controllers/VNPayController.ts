import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import * as crypto from 'crypto';
import { PendingPayment } from '../models/PendingPayment.ts';
import { Payment } from '../models/Payment.ts';
import { PaymentMethod } from '../models/PaymentMethod.ts';
import { Order } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Brand } from '../models/Brand.ts';
import Cart from '../models/Cart.ts';
import CartItem from '../models/CartItem.ts';
import { redis } from '../config/redis.ts';
import { createPaymentUrl, verifyIpnResponse, verifyReturnParams } from '../services/VNPayService.ts';

function getUserId(req: FastifyRequest): string | null {
  return (req as any).user?.userId || null;
}

function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
  }
  return req.ip || '127.0.0.1';
}

/**
 * VNPAY Controller
 *
 * Luồng B: Redirect VNPAY trước → IPN tạo đơn sau
 */
export class VNPayController {
  /**
   * POST /api/payments/vnpay-prepare
   * Bước 1: User chọn VNPAY → tạo PendingPayment + build URL → redirect
   */
  static async preparePayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
      }

      const ipAddr = getClientIp(req);

      const { fullName, email, phone, address, note } = req.body as {
        fullName: string;
        email?: string;
        phone: string;
        address: string;
        note?: string;
      };

      if (!fullName || !phone || !address) {
        return reply.status(400).send({
          success: false,
          message: 'Vui lòng điền đầy đủ thông tin giao hàng (họ tên, số điện thoại, địa chỉ)',
        });
      }

      // Lấy giỏ hàng
      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const cartItems = await CartItem.find({ cartId: cart._id }).lean();
      if (cartItems.length === 0) {
        return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
      }

      // Tính phí ship
      const shippingFee = cart.totalAmount >= 500000 ? 0 : 30000;
      const voucherDiscount = cart.voucherDiscount || 0;
      const finalAmount = cart.totalAmount + shippingFee - voucherDiscount;

      if (finalAmount <= 0) {
        return reply.status(400).send({ success: false, message: 'Số tiền thanh toán không hợp lệ' });
      }

      // Tạo mã giao dịch duy nhất
      const txnRef = crypto.randomUUID().replace(/-/g, '').toUpperCase().substring(0, 30);

      // Lưu PendingPayment
      const pendingPayment = await PendingPayment.create({
        txnRef,
        userId: new mongoose.Types.ObjectId(userId),
        cartSnapshot: {
          items: cartItems,
          totalAmount: cart.totalAmount,
          totalItems: cartItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
          voucherCode: cart.voucherCode || null,
          voucherDiscount: cart.voucherDiscount || 0,
        },
        shippingFee,
        finalAmount,
        customerInfo: {
          fullName,
          email: email || '',
          phone,
          address: note
            ? `${address} — Ghi chú: ${note}`
            : address,
          note: note || '',
        },
        status: 'pending',
        ipAddr,
      });

      // Build VNPAY URL — encodeURIComponent trong VNPayService xử lý encoding
      const orderInfo = `Thanh toan don hang ${txnRef}`;
      // Xác định return URL từ Origin header để động theo môi trường
      const originUrl = req.headers.origin
        || (typeof req.headers['x-forwarded-host'] === 'string' ? `https://${req.headers['x-forwarded-host']}` : undefined);
      const frontendOrigin = originUrl || process.env.FRONTEND_URL || undefined;
      const returnUrl = frontendOrigin ? `${frontendOrigin.replace(/\/+$/, '')}/payment/return` : undefined;
      const paymentUrl = createPaymentUrl({
        txnRef,
        amount: finalAmount,
        orderInfo,
        ipAddr,
        locale: 'vn',
      }, returnUrl);

      return reply.send({
        success: true,
        data: {
          paymentUrl,
          txnRef,
          amount: finalAmount,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  /**
   * POST /api/payments/vnpay-ipn
   * Bước 2: VNPAY gọi callback (server-to-server) → tạo Order + Payment
   * Public endpoint — không cần auth
   */
  static async handleIpn(req: FastifyRequest, reply: FastifyReply) {
    try {
      const params = req.body as Record<string, string> || req.query as Record<string, string>;

      // Verify checksum
      const verification = verifyIpnResponse(params);

      if (!verification.isValid) {
        // Trả về VNPAY theo format yêu cầu
        return reply.send({
          RspCode: '97',
          Message: 'Invalid checksum',
        });
      }

      const { txnRef, amount, transactionNo, responseCode } = verification;

      if (!txnRef) {
        return reply.send({
          RspCode: '99',
          Message: 'Missing txnRef',
        });
      }

      // Tìm PendingPayment
      const pendingPayment = await PendingPayment.findOne({ txnRef, status: 'pending' });
      if (!pendingPayment) {
        // Nếu đã xử lý rồi (completed) thì trả success để VNPAY không gửi lại
        const existingOrder = await Order.findOne({ 'paymentInfo.txnRef': txnRef });
        if (existingOrder) {
          return reply.send({
            RspCode: '00',
            Message: 'Order already processed',
          });
        }
        return reply.send({
          RspCode: '01',
          Message: 'Transaction not found or expired',
        });
      }

      // Kiểm tra response code
      if (responseCode !== '00') {
        // Thanh toán thất bại
        pendingPayment.status = 'failed';
        await pendingPayment.save();
        return reply.send({
          RspCode: '00',
          Message: 'Payment failed',
        });
      }

      // Kiểm tra số tiền
      if (amount !== null && Math.abs(amount - pendingPayment.finalAmount) > 100) {
        pendingPayment.status = 'failed';
        await pendingPayment.save();
        return reply.send({
          RspCode: '04',
          Message: 'Amount mismatch',
        });
      }

      // === Tạo Order ===
      const order = await Order.create({
        userId: pendingPayment.userId,
        customerName: pendingPayment.customerInfo.fullName,
        customerPhone: pendingPayment.customerInfo.phone,
        customerAddress: pendingPayment.customerInfo.address,
        totalAmount: pendingPayment.finalAmount,
        status: 'pending',
        paymentMethod: 'vnpay',
        paymentStatus: 'paid',
        paymentInfo: {
          txnRef: pendingPayment.txnRef,
          transactionNo: transactionNo || '',
          payDate: params['vnp_PayDate'] || '',
          bankCode: params['vnp_BankCode'] || '',
        },
      });

      // Tạo OrderItems từ cart snapshot
      const orderItems = pendingPayment.cartSnapshot.items.map((item: any) => ({
        orderId: order._id,
        productId: item.productId,
        name: item.name,
        image: item.image || '',
        price: item.price,
        quantity: item.quantity,
        variantSize: item.variantSize || '50ml',
        brand: item.brand || '',
      }));
      await OrderItem.insertMany(orderItems);

      // Auto-track purchase funnel per brand
      const brandNames = [...new Set(orderItems.filter((i: any) => i.brand).map((i: any) => i.brand))];
      for (const brandName of brandNames) {
        const brand = await Brand.findOne({ name: brandName }).select('_id').lean();
        if (brand) {
          const bid = brand._id.toString();
          const stage = 'purchase';
          const totalKey = `funnel:total:${bid}:${stage}`;
          const todayKey = `funnel:daily:${bid}:${stage}:${new Date().toISOString().split('T')[0]}`;
          redis.incr(totalKey).catch(() => {});
          redis.incr(todayKey).catch(() => {});
          redis.expire(todayKey, 172800).catch(() => {});
          const hr = String(new Date().getHours());
          const ds = new Date().toISOString().split('T')[0];
          const hourKey = `funnel:hourly:${bid}:${stage}:${ds}:${hr}`;
          redis.incr(hourKey).catch(() => {});
          redis.expire(hourKey, 259200).catch(() => {});
        }
      }

      // Resolve paymentMethodId for 'vnpay'
      const vnpayMethod = await PaymentMethod.findOne({ code: 'vnpay' }).lean();

      // Tạo Payment record
      await Payment.create({
        orderId: order._id,
        paymentMethodId: vnpayMethod?._id || undefined,
        method: 'vnpay',
        status: 'paid',
        transactionCode: transactionNo || undefined,
        txnRef: pendingPayment.txnRef,
        paidAt: new Date(),
      });

      // Xóa giỏ hàng
      const userCart = await Cart.findOne({ userId: pendingPayment.userId });
      if (userCart) {
        await CartItem.deleteMany({ cartId: userCart._id });
        userCart.totalAmount = 0;
        userCart.voucherCode = null as any;
        userCart.voucherDiscount = 0;
        await userCart.save();
      }

      // Đánh dấu PendingPayment hoàn thành
      pendingPayment.status = 'completed';
      await pendingPayment.save();

      return reply.send({
        RspCode: '00',
        Message: 'Confirm Success',
      });
    } catch (err: any) {
      return reply.send({
        RspCode: '99',
        Message: err.message,
      });
    }
  }

  /**
   * POST /api/payments/vnpay-verify
   * Bước 3: Frontend gọi sau khi VNPAY redirect về return page
   * Public endpoint — không cần auth
   */
  static async verifyReturn(req: FastifyRequest, reply: FastifyReply) {
    try {
      const params = req.body as Record<string, string>;

      // Verify checksum
      const verification = verifyReturnParams(params);

      if (!verification.isValid) {
        return reply.send({
          success: false,
          message: 'Xác thực chữ ký thất bại',
          data: {
            responseCode: params['vnp_ResponseCode'] || '97',
            txnRef: params['vnp_TxnRef'] || null,
          },
        });
      }

      const { txnRef, responseCode, transactionNo } = verification;

      if (!txnRef) {
        return reply.send({
          success: false,
          message: 'Thiếu mã giao dịch',
          data: { responseCode: '99', txnRef: null },
        });
      }

      // Tìm order đã được tạo bởi IPN
      const order = await Order.findOne({ 'paymentInfo.txnRef': txnRef }).lean();

      if (responseCode === '00') {
        if (order) {
          return reply.send({
            success: true,
            message: 'Thanh toán thành công!',
            data: {
              responseCode: '00',
              txnRef,
              transactionNo,
              orderId: order._id,
              amount: order.totalAmount,
            },
          });
        } else {
          // IPN chưa kịp xử lý — frontend sẽ poll
          return reply.send({
            success: true,
            message: 'Đang xử lý giao dịch...',
            data: {
              responseCode: '00',
              txnRef,
              transactionNo,
              orderId: null,
              pending: true,
            },
          });
        }
      } else {
        // Thanh toán thất bại
        // Cập nhật PendingPayment nếu còn
        await PendingPayment.findOneAndUpdate(
          { txnRef, status: 'pending' },
          { status: 'failed' }
        );

        return reply.send({
          success: false,
          message: verification.message || 'Thanh toán thất bại',
          data: {
            responseCode,
            txnRef,
            transactionNo,
          },
        });
      }
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}