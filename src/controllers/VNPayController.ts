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
import { Voucher } from '../models/Voucher.ts';
import { UserVoucher } from '../models/UserVoucher.ts';
import { VoucherService } from '../services/VoucherService.ts';
import { redis } from '../config/redis.ts';
import { createPaymentUrl, verifyIpnResponse, verifyReturnParams } from '../services/VNPayService.ts';
import { calculateShippingFee } from '../utils/helpers.ts';
import { markSoldCounted } from './order/orderHelpers.ts';

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

      const { fullName, email, phone, address, note, items, isCartCheckout, shippingMethod } = req.body as {
        fullName: string;
        email?: string;
        phone: string;
        address: string;
        note?: string;
        items?: Array<{ productId: string; quantity?: number; variantSize?: string }>;
        isCartCheckout?: boolean;
        shippingMethod?: 'standard' | 'express';
      };

      if (!fullName || !phone || !address) {
        return reply.status(400).send({
          success: false,
          message: 'Vui lòng điền đầy đủ thông tin giao hàng (họ tên, số điện thoại, địa chỉ)',
        });
      }

      let cartItems: any[];
      let totalAmount: number;
      let voucherDiscount = 0;
      let clearsCart = true;

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });

      if (items && items.length > 0) {
        // Mua ngay hoặc mua chọn lọc từ giỏ hàng
        const resolved = await (await import('../services/cart/CheckoutService.ts')).CheckoutService.resolveBuyNowItems(items);
        cartItems = resolved.resolvedItems;
        totalAmount = resolved.totalAmount;
        clearsCart = !!isCartCheckout;
        voucherDiscount = cart?.voucherDiscount || 0;
      } else {
        if (!cart) {
          return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
        }
        const rawCartItems = await CartItem.find({ cartId: cart._id })
          .populate({ path: 'productId', select: 'brandId', populate: { path: 'brandId', select: 'name' } })
          .lean();
        if (rawCartItems.length === 0) {
          return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
        }
        cartItems = rawCartItems.map((ci: any) => ({
          ...ci,
          brand: ci.brand || (ci.productId as any)?.brandId?.name || '',
        }));
        totalAmount = cart.totalAmount;
        voucherDiscount = cart.voucherDiscount || 0;
      }

      // Tính phí ship
      const shippingResult = await calculateShippingFee(totalAmount, shippingMethod || 'standard');
      const shippingFee = shippingResult.fee;

      // Hỗ trợ Voucher Freeship Hỏa Tốc
      if (cart && cart.voucherCode && cart.voucherCode.startsWith('FSEXPRESS')) {
        if (shippingMethod === 'express') {
          voucherDiscount = shippingFee;
        } else {
          voucherDiscount = 0;
        }
      }

      let freeshipDiscount = 0;
      if (cart && cart.freeshipVoucherCode) {
        freeshipDiscount = shippingFee;
      }

      const finalAmount = totalAmount + shippingFee - voucherDiscount - freeshipDiscount;

      if (finalAmount <= 0) {
        return reply.status(400).send({ success: false, message: 'Số tiền thanh toán không hợp lệ' });
      }

      // Tạo mã giao dịch duy nhất
      const txnRef = crypto.randomUUID().replace(/-/g, '').toUpperCase().substring(0, 30);

      // === Kiểm tra và áp dụng Voucher ===
      let voucherId = undefined;
      const vCode = cart?.voucherCode;
      if (vCode) {
        const voucher = await Voucher.findOne({ code: vCode }).lean();
        if (voucher) {
          voucherId = voucher._id;
          if (voucher.applicableTo !== 'all') {
            await UserVoucher.updateOne(
              { userId: new mongoose.Types.ObjectId(userId), voucherId: voucher._id, isUsed: false },
              { $set: { isUsed: true, usedAt: new Date() } }
            );
          }
          await VoucherService.incrementUsage(voucher._id.toString());
        }
      }

      let freeshipVoucherId = undefined;
      const fsCode = cart?.freeshipVoucherCode;
      if (fsCode) {
        const voucher = await Voucher.findOne({ code: fsCode }).lean();
        if (voucher) {
          freeshipVoucherId = voucher._id;
          if (voucher.applicableTo !== 'all') {
            await UserVoucher.updateOne(
              { userId: new mongoose.Types.ObjectId(userId), voucherId: voucher._id, isUsed: false },
              { $set: { isUsed: true, usedAt: new Date() } }
            );
          }
          await VoucherService.incrementUsage(voucher._id.toString());
        }
      }

      const fullAddress = note ? `${address} — Ghi chú: ${note}` : address;

      // === Tạo Order trực tiếp trong DB ===
      const order = await Order.create({
        userId: new mongoose.Types.ObjectId(userId),
        shippingInfo: {
          customerName: fullName,
          customerPhone: phone,
          customerAddress: fullAddress,
        },
        totalAmount: Math.max(0, finalAmount),
        shippingMethodId: shippingResult.methodId ? new mongoose.Types.ObjectId(shippingResult.methodId) : undefined,
        shippingFee,
        status: 'pending',
        paymentMethod: 'vnpay',
        paymentStatus: 'unpaid',
        voucherId,
        freeshipVoucherId,
      });

      const vnpayMethodDoc = await PaymentMethod.findOne({ code: 'vnpay' }).lean();
      await Payment.create({
        orderId: order._id,
        paymentMethodId: vnpayMethodDoc?._id || undefined,
        method: 'vnpay',
        status: 'pending',
        txnRef,
      });

      // Tạo OrderItems
      const orderItems = cartItems.map((item: any) => ({
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
          await redis.incr(`funnel:total:${bid}:purchase`);
          const todayStr = new Date().toISOString().substring(0, 10);
          await redis.sadd(`funnel:daily:${bid}:purchase:${todayStr}`, order._id.toString());
        }
      }

      // === Xóa Giỏ Hàng ===
      if (clearsCart && cart) {
        if (items && items.length > 0) {
          for (const item of items) {
            await CartItem.deleteOne({
              cartId: cart._id,
              productId: new mongoose.Types.ObjectId(item.productId),
              variantSize: item.variantSize || '50ml',
            });
          }
          const remainingItems = await CartItem.find({ cartId: cart._id }).lean();
          cart.totalAmount = remainingItems.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);
          cart.voucherCode = null as any;
          cart.voucherDiscount = 0;
          cart.freeshipVoucherCode = null as any;
          await cart.save();
        } else {
          await CartItem.deleteMany({ cartId: cart._id });
          cart.totalAmount = 0;
          cart.voucherCode = null as any;
          cart.voucherDiscount = 0;
          cart.freeshipVoucherCode = null as any;
          await cart.save();
        }
      }

      // Lưu PendingPayment để đồng bộ tương thích
      const pendingPayment = await PendingPayment.create({
        txnRef,
        userId: new mongoose.Types.ObjectId(userId),
        cartSnapshot: {
          items: cartItems,
          totalAmount: totalAmount,
          totalItems: cartItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
          voucherCode: cart?.voucherCode || null,
          voucherDiscount: voucherDiscount,
          freeshipVoucherCode: cart?.freeshipVoucherCode || null,
        },
        shippingFee,
        finalAmount,
        customerInfo: {
          fullName,
          email: email || '',
          phone,
          address: fullAddress,
          note: note || '',
        },
        status: 'pending',
        ipAddr,
        clearsCart: false,
      });

      // Build VNPAY URL
      const orderInfo = `Thanh toan don hang ${txnRef}`;
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
          orderId: order._id,
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
        const existingPayment = await Payment.findOne({ txnRef, status: 'paid' });
        if (existingPayment) {
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
        await Payment.updateOne({ txnRef }, { $set: { status: 'failed' } });
        return reply.send({
          RspCode: '00',
          Message: 'Payment failed',
        });
      }

      // Kiểm tra số tiền
      if (amount !== null && Math.abs(amount - pendingPayment.finalAmount) > 100) {
        pendingPayment.status = 'failed';
        await pendingPayment.save();
        await Payment.updateOne({ txnRef }, { $set: { status: 'failed' } });
        return reply.send({
          RspCode: '04',
          Message: 'Amount mismatch',
        });
      }

      // === Tìm và cập nhật Order & Payment ===
      const paymentRecord = await Payment.findOne({ txnRef });
      let order = paymentRecord ? await Order.findById(paymentRecord.orderId) : null;
      if (!order) {
        order = await Order.findOne({ note: { $regex: txnRef } });
      }

      if (!order) {
        // Tự động tạo Order từ pendingPayment nếu chưa tồn tại Order record
        order = await Order.create({
          userId: pendingPayment.userId,
          shippingInfo: {
            customerName: pendingPayment.customerInfo.fullName,
            customerPhone: pendingPayment.customerInfo.phone,
            customerAddress: pendingPayment.customerInfo.address,
            customerEmail: pendingPayment.customerInfo.email || '',
            note: `VNPay TXN: ${txnRef}`,
          },
          totalAmount: pendingPayment.finalAmount,
          shippingFee: pendingPayment.shippingFee || 0,
          paymentMethod: 'vnpay',
          paymentStatus: 'paid',
          status: 'processing',
        });
      } else {
        order.paymentStatus = 'paid';
        await order.save();
      }

      // Thanh toán thành công → cộng lượt bán (idempotent, chỉ 1 lần/đơn)
      await markSoldCounted(order._id);

      // Resolve paymentMethodId for 'vnpay'
      let vnpayMethod: any = null;
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        try {
          vnpayMethod = await PaymentMethod.findOne({ code: 'vnpay' }).lean();
        } catch (_) {}
      }

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

      // Clear giỏ hàng nếu pendingPayment được đánh dấu clearsCart (default true)
      if (pendingPayment.clearsCart !== false) {
        const cart = await Cart.findOne({ userId: pendingPayment.userId });
        if (cart) {
          await CartItem.deleteMany({ cartId: cart._id });
          cart.totalAmount = 0;
          cart.voucherCode = null as any;
          cart.voucherDiscount = 0;
          cart.freeshipVoucherCode = null as any;
          await cart.save();
        }
      }

      // Đánh dấu PendingPayment hoàn thành
      pendingPayment.status = 'completed';
      await pendingPayment.save();

      return reply.send({
        RspCode: '00',
        Message: 'Confirm Success',
      });
    } catch (err: any) {
      console.error('[VNPay handleIpn Error]:', err);
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

      // Tìm order đã được tạo
      const paymentRecord = await Payment.findOne({ txnRef });
      const order = paymentRecord ? await Order.findById(paymentRecord.orderId) : null;

      if (responseCode === '00') {
        if (order) {
          if (order.paymentStatus !== 'paid') {
            order.paymentStatus = 'paid';
            await order.save();

            // Thanh toán thành công → cộng lượt bán
            await markSoldCounted(order._id);

            const vnpayMethod = await PaymentMethod.findOne({ code: 'vnpay' }).lean();
            await Payment.findOneAndUpdate(
              { txnRef },
              {
                orderId: order._id,
                paymentMethodId: vnpayMethod?._id || undefined,
                method: 'vnpay',
                status: 'paid',
                transactionCode: transactionNo || undefined,
                txnRef,
                paidAt: new Date(),
              },
              { upsert: true }
            );

            await PendingPayment.findOneAndUpdate({ txnRef }, { status: 'completed' });
          }

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

  /**
   * POST /api/payments/vnpay-repay
   * Cho phép thanh toán lại đơn hàng VNPay chưa thanh toán (countdown < 15p)
   */
  static async repayPayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
      }

      const { orderId } = req.body as { orderId: string };
      if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
        return reply.status(400).send({ success: false, message: 'Mã đơn hàng không hợp lệ' });
      }

      const order = await Order.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (!order) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng của bạn' });
      }

      if (order.paymentMethod !== 'vnpay') {
        return reply.status(400).send({ success: false, message: 'Phương thức thanh toán của đơn hàng không phải VNPay' });
      }

      if (order.paymentStatus === 'paid') {
        return reply.status(400).send({ success: false, message: 'Đơn hàng đã được thanh toán' });
      }

      if (order.status === 'cancelled') {
        return reply.status(400).send({ success: false, message: 'Đơn hàng đã bị hủy, không thể thanh toán lại' });
      }

      // Kiểm tra xem đơn hàng đã quá 15 phút chưa
      const elapsed = Date.now() - new Date(order.createdAt).getTime();
      if (elapsed > 15 * 60 * 1000) {
        order.status = 'cancelled';
        await order.save();
        return reply.status(400).send({ success: false, message: 'Đơn hàng đã quá hạn 15 phút thanh toán và đã bị hủy' });
      }

      const ipAddr = getClientIp(req);
      const txnRef = crypto.randomUUID().replace(/-/g, '').toUpperCase().substring(0, 30);

      // Tạo bản ghi Payment mới với txnRef mới
      const vnpayMethodDocRepay = await PaymentMethod.findOne({ code: 'vnpay' }).lean();
      await Payment.create({
        orderId: order._id,
        paymentMethodId: vnpayMethodDocRepay?._id || undefined,
        method: 'vnpay',
        status: 'pending',
        txnRef,
      });

      // Lấy danh sách sản phẩm để lưu snapshot tương thích
      const orderItems = await OrderItem.find({ orderId: order._id }).lean();

      // Lưu PendingPayment mới tương thích
      await PendingPayment.create({
        txnRef,
        userId: new mongoose.Types.ObjectId(userId),
        cartSnapshot: {
          items: orderItems,
          totalAmount: order.totalAmount,
          totalItems: orderItems.reduce((sum: number, item: any) => sum + item.quantity, 0),
          voucherCode: null,
          voucherDiscount: 0,
          freeshipVoucherCode: null,
        },
        shippingFee: order.shippingFee || 0,
        finalAmount: order.totalAmount,
        customerInfo: {
          fullName: order.shippingInfo?.customerName || '',
          email: order.shippingInfo?.customerEmail || '',
          phone: order.shippingInfo?.customerPhone || '',
          address: order.shippingInfo?.customerAddress || '',
          note: order.shippingInfo?.note || '',
        },
        status: 'pending',
        ipAddr,
        clearsCart: false,
      });

      // Build VNPAY URL
      const orderInfo = `Thanh toan don hang ${txnRef}`;
      const originUrl = req.headers.origin
        || (typeof req.headers['x-forwarded-host'] === 'string' ? `https://${req.headers['x-forwarded-host']}` : undefined);
      const frontendOrigin = originUrl || process.env.FRONTEND_URL || undefined;
      const returnUrl = frontendOrigin ? `${frontendOrigin.replace(/\/+$/, '')}/payment/return` : undefined;
      const paymentUrl = createPaymentUrl({
        txnRef,
        amount: order.totalAmount,
        orderInfo,
        ipAddr,
        locale: 'vn',
      }, returnUrl);

      return reply.send({
        success: true,
        data: {
          paymentUrl,
          txnRef,
          amount: order.totalAmount,
          orderId: order._id,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}