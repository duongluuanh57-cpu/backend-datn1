import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { PendingPayment } from '../models/PendingPayment.ts';
import { Order } from '../models/Order.ts';
import { PaymentMethod } from '../models/PaymentMethod.ts';
import { CheckoutService, type CheckoutPayload } from '../services/cart/CheckoutService.ts';
import CartItem from '../models/CartItem.ts';
import { verifyIpnResponse, verifyReturnParams } from '../services/VNPayService.ts';
import { markOrderPaid, cancelOrderWithRestore } from './order/orderHelpers.ts';

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
 * VNPay chỉ là PHƯƠNG THỨC THANH TOÁN: preparePayment tạo Order qua đúng pipeline
 * dùng chung với COD (CheckoutService.processCheckout) rồi trả URL redirect;
 * IPN / return chỉ chốt trạng thái đã thanh toán, không dựng lại đơn hàng.
 */
export class VNPayController {
  /**
   * POST /api/payments/vnpay-prepare
   * Bước 1: User chọn VNPAY → CheckoutService tạo Order (địa chỉ, tồn kho, voucher)
   * → tạo PendingPayment + URL redirect (mã giao dịch ghi thẳng vào orders).
   */
  static async preparePayment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });
      }

      // Không tự dựng lại pipeline nữa: địa chỉ, giỏ hàng, voucher, tồn kho, phí ship
      // và Order đều đi qua CheckoutService.processCheckout() — giống hệt COD,
      // khác duy nhất ở paymentMethod = 'vnpay'.
      const body = req.body as Partial<CheckoutPayload>;

      const headerOrigin = req.headers.origin
        || (typeof req.headers['x-forwarded-host'] === 'string'
          ? `https://${req.headers['x-forwarded-host']}`
          : undefined);

      const data: any = await CheckoutService.processCheckout(userId, {
        ...body,
        paymentMethod: 'vnpay',
        ipAddr: getClientIp(req),
        origin: headerOrigin || undefined,
      });

      const payment = data?.payment;
      if (!payment?.paymentUrl) {
        return reply.status(500).send({ success: false, message: 'Không tạo được liên kết thanh toán VNPAY' });
      }

      return reply.send({
        success: true,
        data: {
          paymentUrl: payment.paymentUrl,
          txnRef: payment.txnRef,
          amount: payment.amount,
          orderId: data._id,
        },
      });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }
  /**
   * POST /api/payments/vnpay-ipn
   * Bước 2: VNPAY gọi callback (server-to-server) → chốt đơn đã thanh toán
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
        // Nếu đã xử lý rồi thì trả success để VNPAY không gửi lại.
        // Bảng payments đã bỏ → tra thẳng orders.payment_txn_ref.
        const paidOrder = await Order.findOne({ paymentTxnRef: txnRef, paymentStatus: 'paid' }).select('_id').lean();
        if (paidOrder) {
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

      // Kiểm tra số tiền. Thiếu vnp_Amount là bất thường → fail-closed, không coi "không có
      // số tiền" là "khớp số tiền".
      if (amount === null || Math.abs(amount - pendingPayment.finalAmount) > 100) {
        pendingPayment.status = 'failed';
        await pendingPayment.save();
        return reply.send({
          RspCode: '04',
          Message: 'Amount mismatch',
        });
      }

      // === Lấy Order đã được tạo ở bước prepare (cùng pipeline với COD) ===
      let order = pendingPayment.orderId ? await Order.findById(pendingPayment.orderId) : null;
      if (!order) {
        // Tương thích bản ghi cũ (tạo trước khi PendingPayment có orderId):
        // dựng Order từ customerInfo với các cột phẳng của ERD mới.
        const legacy = (pendingPayment as any).customerInfo;
        if (legacy?.fullName) {
          const vnpayMethod = await PaymentMethod.findOne({ code: 'vnpay' }).select('_id').lean();
          if (!vnpayMethod?._id) throw new Error('Không tìm thấy phương thức thanh toán VNPay');

          order = await Order.create({
            userId: pendingPayment.userId,
            receiveName: legacy.fullName,
            phone: legacy.phone || '',
            address: legacy.address || '',
            note: legacy.note || `VNPay TXN: ${txnRef}`,
            totalAmount: pendingPayment.finalAmount,
            shippingFee: pendingPayment.shippingFee || 0,
            paymentMethodId: vnpayMethod._id,
            paymentStatus: 'paid',
            paidAt: new Date(),
            status: 'processing',
          });
        }
      }

      if (!order) {
        pendingPayment.status = 'failed';
        await pendingPayment.save();
        return reply.send({ RspCode: '01', Message: 'Order not found' });
      }

      if (order.status === 'cancelled') {
        // Tiền về sau khi đơn đã bị hủy (khách bấm trả muộn / VNPay retry IPN).
        // Không tự chốt paid và không cộng lượt bán — admin phải hoàn tiền thủ công.
        pendingPayment.status = 'expired';
        await pendingPayment.save();
        return reply.send({
          RspCode: '09',
          Message: 'Order has been cancelled',
        });
      }

      // Chốt đã thanh toán + cộng lượt bán đúng 1 lần, và ghi mã giao dịch vào
      // chính bảng orders (bảng payments đã bỏ).
      await markOrderPaid(order._id, {
        txnRef: pendingPayment.txnRef,
        transactionCode: transactionNo || undefined,
        bankCode: (params['vnp_BankCode'] as string) || undefined,
      });

      // Clear giỏ hàng nếu pendingPayment được đánh dấu clearsCart (default true)
      if (pendingPayment.clearsCart !== false) {
        await CartItem.deleteMany({ userId: pendingPayment.userId });
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

      const { txnRef, responseCode, transactionNo, amount } = verification;

      if (!txnRef) {
        return reply.send({
          success: false,
          message: 'Thiếu mã giao dịch',
          data: { responseCode: '99', txnRef: null },
        });
      }

      // Tìm order đã được tạo: PendingPayment (còn) → orders.payment_txn_ref.
      const pending = await PendingPayment.findOne({ txnRef });
      const order = pending?.orderId
        ? await Order.findById(pending.orderId)
        : await Order.findOne({ paymentTxnRef: txnRef });

      if (responseCode === '00') {
        if (order) {
          // Return tới từ browser nên chỉ đáng tin sau checksum — vẫn phải khớp SỐ TIỀN của
          // giao dịch với đơn hàng, nếu không một giao dịch VNPay bất kỳ (giá khác) cũng
          // xác nhận được cho đơn này. IPN đã kiểm tra ở trên.
          if (amount === null || Math.abs(amount - order.totalAmount) > 100) {
            return reply.send({
              success: false,
              message: 'Số tiền thanh toán không khớp đơn hàng',
              data: { responseCode: '04', txnRef, orderId: order._id },
            });
          }

          // Đơn đã bị hủy trước khi tiền về: không tự chốt paid, admin hoàn tiền thủ công.
          if (order.status === 'cancelled') {
            return reply.send({
              success: false,
              message: 'Đơn hàng đã bị hủy, vui lòng liên hệ hỗ trợ để được hoàn tiền',
              data: { responseCode: '09', txnRef, orderId: order._id },
            });
          }

          if (order.paymentStatus !== 'paid') {
            // Chốt paid + cộng lượt bán + ghi mã giao dịch (idempotent theo CAS)
            await markOrderPaid(order._id, {
              txnRef,
              transactionCode: transactionNo || undefined,
              bankCode: (params['vnp_BankCode'] as string) || undefined,
            });

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
      }).populate('paymentMethodId', 'code');

      if (!order) {
        return reply.status(404).send({ success: false, message: 'Không tìm thấy đơn hàng của bạn' });
      }

      if ((order.paymentMethodId as any)?.code !== 'vnpay') {
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
        // Hủy qua CAS → hoàn kho + voucher đúng một lần (không cần cờ chống trùng)
        await cancelOrderWithRestore(order._id, { filter: { paymentStatus: { $ne: 'paid' } } });
        return reply.status(400).send({ success: false, message: 'Đơn hàng đã quá hạn 15 phút thanh toán và đã bị hủy' });
      }

      const headerOrigin = req.headers.origin
        || (typeof req.headers['x-forwarded-host'] === 'string' ? `https://${req.headers['x-forwarded-host']}` : undefined);

      // Dùng lại đúng phiên VNPay như lúc checkout: PendingPayment + URL,
      // gắn thẳng orderId nên không cần nhân bản địa chỉ khách hàng.
      const session = await CheckoutService.createVnpaySession(order, {
        ipAddr: getClientIp(req),
        origin: headerOrigin || undefined,
        clearsCart: false,
      });

      return reply.send({
        success: true,
        data: {
          paymentUrl: session.paymentUrl,
          txnRef: session.txnRef,
          amount: session.amount,
          orderId: order._id,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
