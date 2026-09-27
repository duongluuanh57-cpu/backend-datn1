import * as crypto from 'crypto';
import { CartService } from './CartService.ts';
import CartItem from '../../models/CartItem.ts';
import { ShippingInfoService } from '../order/ShippingInfoService.ts';
import { PendingPayment } from '../../models/PendingPayment.ts';
import { PaymentMethod, type PaymentMethodCode } from '../../models/PaymentMethod.ts';
import { Brand } from '../../models/Brand.ts';
import { redis } from '../../config/redis.ts';
import { createPaymentUrl } from '../VNPayService.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { VoucherService } from '../VoucherService.ts';
import { FlashSaleService } from '../FlashSaleService.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { Order } from '../../models/Order.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { Voucher } from '../../models/Voucher.ts';
import { User } from '../../models/User.ts';
import mongoose from 'mongoose';
import { calculateShippingFee } from '../../utils/helpers.ts';
import { adjustTotalSold, enhanceItemsWithProductData } from '../../controllers/order/orderHelpers.ts';
import { StockService } from './StockService.ts';
import { RewardService } from '../RewardService.ts';
import { getEffectiveProductDiscount } from '../product/productFormatterService.ts';
import { bySizeAsc } from '../product/productHelpers.ts';

export interface CheckoutPayload {
  // --- Địa chỉ giao hàng: server luôn ưu tiên địa chỉ đã lưu trong UserAddress ---
  /** _id của UserAddress user chọn ở trang thanh toán */
  userAddressId?: string;
  /** Ghi chú đơn hàng → lưu vào shippingInfo.note */
  note?: string;
  // 3 field dưới chỉ là fallback khi user chưa lưu địa chỉ nào
  receiveName?: string;
  phone?: string;
  address?: string;
  // --- Đơn hàng ---
  paymentMethod?: PaymentMethodCode;
  shippingMethod?: 'standard' | 'express';
  items?: Array<{ productId: string; quantity?: number; variantSize?: string }>;
  isCartCheckout?: boolean;
  voucherCode?: string;
  freeshipVoucherCode?: string;
  /** Số xu muốn dùng; 1 xu = 1đ, server giới hạn theo số dư và tổng đơn. */
  rewardPoints?: number;
  // --- Chỉ dùng cho VNPay, do server điền (không phải client gửi) ---
  ipAddr?: string;
  origin?: string;
}

export class CheckoutService {
  /**
   * Resolve mua ngay: chuyển items [{productId, quantity, variantSize}] → items chuẩn
   * (kèm name, image, brand, price đã áp dụng giảm giá) + totalAmount.
   *
   * ponytail: loop gọi 4-5 query/item (N+1). Trần: "mua ngay" thực tế chỉ 1 item nên
   * đơn giản-vừa-đủ; nếu sau này cho mua-ngay nhiều item thì batch lại ($in + map).
   */
  static async resolveBuyNowItems(items: Array<{ productId: string; quantity?: number; variantSize?: string }>) {
    const resolvedItems: any[] = [];
    let totalAmount = 0;

    for (const entry of items) {
      if (!entry.productId || !mongoose.Types.ObjectId.isValid(entry.productId)) {
        const err: any = new Error('ID sản phẩm không hợp lệ');
        err.statusCode = 400;
        throw err;
      }
      const quantity = Math.max(1, Math.floor(entry.quantity || 1));

      const product = await Product.findById(entry.productId)
        .select('name brandId brand image discountPercentage')
        .populate('brandId', 'name logo')
        .lean() as any;
      if (!product) {
        const err: any = new Error('Sản phẩm không tồn tại');
        err.statusCode = 404;
        throw err;
      }
      const brandName = (product.brandId as any)?.name || product.brand || '';

      const sizeToFind = entry.variantSize || '50ml';
      let variantDoc: any = await ProductVariant.findOne({
        productId: new mongoose.Types.ObjectId(entry.productId),
        size: sizeToFind,
      }).lean();
      if (!variantDoc) {
        // Không còn cột sortOrder → chọn biến thể nhỏ nhất theo dung tích (bySizeAsc).
        const allVariants = await ProductVariant.find({ productId: new mongoose.Types.ObjectId(entry.productId) }).lean();
        variantDoc = allVariants.sort(bySizeAsc)[0] || null;
      }
      if (!variantDoc) {
        const err: any = new Error('Biến thể sản phẩm không tồn tại');
        err.statusCode = 400;
        throw err;
      }

      const variantPrice = variantDoc.price || 0;
      const usedSize = variantDoc.size || sizeToFind;

      const discountPct = await getEffectiveProductDiscount(entry.productId);
      let finalPrice = variantPrice;
      if (discountPct > 0) {
        finalPrice = Math.round(variantPrice * (1 - discountPct / 100));
      }

      const productImage = await ProductImage.findOne({ productId: new mongoose.Types.ObjectId(entry.productId) })
        .select('url')
        .sort({ _id: 1 })
        .lean() as any;
      const brandLogo = (product.brandId as any)?.logo;
      let imageUrl = productImage?.url || product.image || undefined;
      if (brandLogo && imageUrl === brandLogo) {
        imageUrl = productImage?.url || undefined;
      }

      resolvedItems.push({
        productId: product._id,
        productVariantId: variantDoc._id,
        name: product.name,
        image: imageUrl,
        brand: brandName,
        price: finalPrice,
        discount: discountPct,
        quantity,
        variantSize: usedSize,
      });
      totalAmount += finalPrice * quantity;
    }

    return { resolvedItems, totalAmount };
  }

  static async processCheckout(userId: string, payload: CheckoutPayload) {
    // ------------------------------------------------------------------
    // 1️⃣  Địa chỉ giao hàng — nguồn duy nhất là ShippingInfoService
    // ------------------------------------------------------------------
    // Áp dụng cho MỌI phương thức thanh toán: chọn theo userAddressId → isDefault
    // → địa chỉ đầu tiên; kèm ghi chú + toạ độ của địa chỉ đó.
    const shipping = await ShippingInfoService.resolve(userId, {
      userAddressId: payload.userAddressId,
      note: payload.note,
      receiveName: payload.receiveName,
      phone: payload.phone,
      address: payload.address,
    });

    const { paymentMethod, shippingMethod, items, isCartCheckout, voucherCode: payloadVoucherCode, freeshipVoucherCode: payloadFreeshipCode } = payload;
    const isVnpay = paymentMethod === 'vnpay';

    if (!shipping.receiveName) {
      const err: any = new Error('Vui lòng nhập họ tên');
      err.statusCode = 400;
      throw err;
    }

    let orderItems: any[];
    let totalAmount: number;
    let voucherDiscount = 0;
    let clearsCart = true;

    if (items && items.length > 0) {
      const resolved = await CheckoutService.resolveBuyNowItems(items);
      orderItems = resolved.resolvedItems;
      totalAmount = resolved.totalAmount;
      clearsCart = !!isCartCheckout;
    } else {
      // Giỏ hàng = collection cart_items của user (không còn document Cart).
      const cartItems = await CartService.loadCartItems(userId);
      if (cartItems.length === 0) {
        const err: any = new Error('Giỏ hàng trống');
        err.statusCode = 400;
        throw err;
      }
      orderItems = cartItems;
      totalAmount = cartItems.reduce((sum: number, item: any) => sum + item.price * (item.quantity || 1), 0);
    }

    // Xác định mã voucher được áp dụng cho đơn hàng này
    let appliedVoucherCode: string | null = null;
    let appliedFreeshipCode: string | null = null;

    // Voucher là state phía client (giỏ hàng chỉ còn cart_items) → luôn lấy từ payload.
    appliedVoucherCode = payloadVoucherCode || null;
    appliedFreeshipCode = payloadFreeshipCode || null;

    // Tính toán lại mức giảm giá của voucher dựa trên totalAmount thực tế của đơn hàng
    if (appliedVoucherCode) {
      const user = await User.findById(userId).select('memberTier').lean() as any;
      const userTier = user?.memberTier || 'MEMBER';
      const vResult = await VoucherService.validate(appliedVoucherCode, totalAmount, userTier, userId);
      if (vResult.valid) {
        voucherDiscount = vResult.discountAmount || 0;
      } else {
        appliedVoucherCode = null;
        voucherDiscount = 0;
      }
    }

    const requestedRewardPoints = Math.max(0, Math.floor(Number(payload.rewardPoints) || 0));
    if (requestedRewardPoints > 0) {
      const balance = await RewardService.getBalance(userId);
      if (requestedRewardPoints > balance) {
        const err: any = new Error(`Số dư xu không đủ. Bạn đang có ${balance.toLocaleString('vi-VN')} xu.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const paymentMethodCode = paymentMethod || 'cod';
    const paymentMethodDoc = (await PaymentMethod.findOne({ code: paymentMethodCode }).select('_id').lean()) as any;
    if (!paymentMethodDoc?._id) {
      const err: any = new Error('Phương thức thanh toán không tồn tại');
      err.statusCode = 400;
      throw err;
    }
// ── Trừ tồn kho ATOMIC trước khi tạo đơn — chặn bán vượt tồn ──
    // resolveBuyNowItems đã kiểm productId hợp lệ; variantSize chuẩn hóa '50ml' ở dưới.
    // Nếu thiếu hàng: các variant đã trừ được trừ trước đó sẽ được hoàn lại (bailing all-or-nothing).
    const itemsToDeduct = orderItems.map((item: any) => ({
      productVariantId: item.productVariantId?.toString?.() || String(item.productVariantId || ''),
      productId: item.productId?.toString ? item.productId.toString() : String(item.productId),
      variantSize: item.variantSize || '50ml',
      quantity: item.quantity || 1,
    }));
    const stockFailures = await StockService.deductStock(itemsToDeduct);
    if (stockFailures.length > 0) {
      // hoàn lại phần đã trừ của các item trước đó trong loop
      for (const ok of itemsToDeduct) {
        const failed = stockFailures.some((f) =>
          (f.productVariantId && f.productVariantId === ok.productVariantId) ||
          (!f.productVariantId && f.productId === ok.productId && ok.variantSize === f.variantSize)
        );
        if (!failed) {
          await ProductVariant.updateOne(
            ok.productVariantId
              ? { _id: new mongoose.Types.ObjectId(ok.productVariantId) }
              : { productId: new mongoose.Types.ObjectId(ok.productId), size: ok.variantSize },
            { $inc: { quantityInStock: ok.quantity } }
          );
        }
      }
      const first = stockFailures[0];
      const err: any = new Error(`Sản phẩm ${first.productId} (${first.variantSize}) chỉ còn ${first.available} — bạn đặt ${first.requested}`);
      err.statusCode = 409;
      throw err;
    }

    // Sau khi deductStock trả về [], toàn bộ dòng đã trừ thành công. Dùng
     // helper này để bù giỏ nếu các bước tạo đơn/insert item phía sau lỗi.
     const restoreAllDeductedStock = async () => {
       for (const item of itemsToDeduct) {
         await ProductVariant.updateOne(
           item.productVariantId
             ? { _id: new mongoose.Types.ObjectId(item.productVariantId) }
             : { productId: new mongoose.Types.ObjectId(item.productId), size: item.variantSize },
           { $inc: { quantityInStock: item.quantity || 1 } },
         );
       }
     };
     let shippingResult: any;
     try {
       shippingResult = await calculateShippingFee(totalAmount, shippingMethod || 'standard');
     } catch (error) {
       await restoreAllDeductedStock();
       throw error;
     }
     const shippingFee = shippingResult.fee;

    if (appliedVoucherCode && appliedVoucherCode.startsWith('FSEXPRESS')) {
      if (shippingMethod === 'express') {
        voucherDiscount = shippingFee;
      } else {
        voucherDiscount = 0;
      }
    }

    // Voucher freeship: bảng orders không có cột riêng (ERD), nhưng khoản giảm đã
    // được trừ thẳng vào total_amount nên số tiền cuối cùng vẫn đúng.
    let freeshipDiscount = 0;
    if (appliedFreeshipCode) {
      freeshipDiscount = shippingFee;
    }

    const amountBeforeReward = Math.max(0, totalAmount + shippingFee - voucherDiscount - freeshipDiscount);
    const rewardPointsUsed = Math.min(requestedRewardPoints, Math.floor(amountBeforeReward));
    const rewardPointsDiscount = rewardPointsUsed; // 1 xu = 1đ
    const finalAmount = Math.max(0, amountBeforeReward - rewardPointsDiscount);
    if (isVnpay && finalAmount <= 0) {
      const err: any = new Error('Số tiền thanh toán không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    // Chỉ TRA voucher ở đây. Việc "đốt" lượt dùng được làm SAU khi có order._id
    // để gắn `voucherId` — nhờ đó hủy đơn vẫn hoàn được cả voucher
    // freeship dù bảng orders chỉ còn 1 cột voucher_id.
    const discountVoucher = appliedVoucherCode
      ? (await Voucher.findOne({ code: appliedVoucherCode }).lean()) as any
      : null;

    // Đặt chỗ lượt dùng voucher NGUYÊN TỬ trước khi tạo đơn: hai đơn đồng tranh
    // lượt cuối thì chỉ một tryConsume thắng, đơn còn lại bị từ chối — chặn bán
    // vượt lượt. Voucher freeship không đếm usage nên bỏ qua.
    const voucherId = discountVoucher?._id;
    const reserveVoucherId =
      discountVoucher && discountVoucher.voucherCategory !== 'freeship'
        ? discountVoucher._id.toString()
        : null;
    let voucherConsumed = false;
    if (reserveVoucherId) {
      voucherConsumed = await VoucherService.tryConsume(reserveVoucherId);
      if (!voucherConsumed) {
        await restoreAllDeductedStock();
        const err: any = new Error('Mã giảm giá vừa hết lượt sử dụng, vui lòng thử lại');
        err.statusCode = 400;
        throw err;
      }
    }
    const releaseVoucherReservation = async () => {
      if (voucherConsumed && reserveVoucherId) {
        await VoucherService.releaseUsage(reserveVoucherId);
        voucherConsumed = false;
      }
    };

    let order: any;
     try {
       order = await Order.create({
      userId: new mongoose.Types.ObjectId(userId),
      // Địa chỉ là snapshot phẳng tại thời điểm đặt hàng (receive_name/phone/address/note).
      receiveName: shipping.receiveName,
      phone: shipping.phone,
      address: shipping.address,
      note: shipping.note,
      shippingInfo: {
        customerName: shipping.receiveName,
        customerEmail: shipping.email || '',
        customerPhone: shipping.phone,
        customerAddress: shipping.address,
      },
      totalAmount: Math.max(0, finalAmount),
      shippingFee,
      rewardPointsUsed,
      rewardPointsDiscount,
      status: 'pending',
      paymentMethodId: paymentMethodDoc._id,
      paymentStatus: 'unpaid',
      voucherId,
    });
  } catch (error) {
    await releaseVoucherReservation();
    await restoreAllDeductedStock();
    throw error;
  }

    try {
      await OrderItem.insertMany(
        orderItems.map((item: any) => ({
          orderId: order._id,
          productVariantId: item.productVariantId,
          price: item.price,
          discount: item.discount || 0,
          quantity: item.quantity,
        }))
      );
    } catch (error) {
      await Order.deleteOne({ _id: order._id });
      await releaseVoucherReservation();
      await restoreAllDeductedStock();
      throw error;
    }

    if (rewardPointsUsed > 0) {
      try {
        await RewardService.spendForOrder(userId, order._id, rewardPointsUsed);
      } catch (error) {
        await StockService.restoreStockForOrder(order._id);
        await OrderItem.deleteMany({ orderId: order._id });
        await Order.deleteOne({ _id: order._id });
        await releaseVoucherReservation();
        throw error;
      }
    }

    // Phễu theo brand: trước đây chỉ luồng VNPay đếm, đơn COD bị thiếu.
    await CheckoutService.trackBrandPurchases(orderItems, order._id);

    // Lượt dùng voucher đã được "đặt chỗ" nguyên tử ở tryConsume phía trên (gắn
    // voucherId vào đơn để hủy đơn hoàn lại qua restoreVouchersForOrder).

    // COD coi như chốt đơn ngay → set paidAt luôn.
    // VNPay thì chờ markOrderPaid() ở IPN/return (CAS unpaid → paid) mới cộng.
    if (!isVnpay) {
      try {
        await adjustTotalSold(orderItems, 1);
      } catch (e) {
        console.warn('⚠️ [CheckoutService] adjustTotalSold error:', e);
      }
    }

    const purchases = orderItems.map((item: any) => ({
      productId: item.productId?.toString ? item.productId.toString() : String(item.productId),
      quantity: item.quantity || 1,
    }));
    await FlashSaleService.recordFlashSalePurchases(purchases);

    if (clearsCart) {
      if (items && items.length > 0) {
        // Mua chọn lọc từ giỏ: chỉ xóa đúng các dòng cart_items vừa đặt.
        const productIds = [...new Set(items.map((item: any) => String(item.productId)))];
        const variants = await ProductVariant.find({
          productId: { $in: productIds.map((pid) => new mongoose.Types.ObjectId(pid)) },
        })
          .select('_id productId size')
          .lean();
        const variantIds = variants
          .filter((v: any) =>
            items.some(
              (item: any) =>
                String(item.productId) === String(v.productId) &&
                (item.variantSize || '50ml') === v.size
            )
          )
          .map((v: any) => v._id);

        if (variantIds.length > 0) {
          await CartItem.deleteMany({
            userId: new mongoose.Types.ObjectId(userId),
            productVariantId: { $in: variantIds },
          });
        }
      } else {
        await CartItem.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
      }
    }

    const result: any = {
      _id: order._id,
      items: orderItems.map((i: any) => ({
        _id: i._id,
        productId: i.productId,
        productVariantId: i.productVariantId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        variantSize: i.variantSize,
      })),
      totalAmount: order.totalAmount,
      rewardPointsUsed,
      rewardPointsDiscount,
      rewardPointsBalance: await RewardService.getBalance(userId),
      totalItems: orderItems.reduce((sum: number, i: any) => sum + i.quantity, 0),
      paymentMethodId: order.paymentMethodId,
      // Địa chỉ là các cột phẳng trên orders; giữ thêm object `shippingInfo`
      // trong response để client hiện có không phải viết lại.
      receiveName: order.receiveName,
      phone: order.phone,
      address: order.address,
      note: order.note,
      shippingInfo: {
        customerName: order.receiveName,
        customerPhone: order.phone,
        customerAddress: order.address,
        customerEmail: shipping.email || '',
        note: order.note,
      },
    };

    // VNPay: tạo Payment + PendingPayment + URL redirect (dùng chung với thanh toán lại).
    if (isVnpay) {
      result.payment = await CheckoutService.createVnpaySession(order, {
        ipAddr: payload.ipAddr,
        origin: payload.origin,
        shippingMethodCode: shippingMethod === 'express' ? 'express' : 'standard',
        cartSnapshot: {
          items: orderItems,
          totalAmount,
          totalItems: orderItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0),
          voucherCode: appliedVoucherCode || null,
          voucherDiscount: voucherDiscount || 0,
          freeshipVoucherCode: appliedFreeshipCode || null,
        },
      });
    }

    return result;
  }

  /** Đếm lượt mua của brand vào phễu Redis (dùng chung mọi phương thức thanh toán). */
  private static async trackBrandPurchases(orderItems: any[], orderId: any) {
    const brandNames = [...new Set(orderItems.filter((i: any) => i.brand).map((i: any) => i.brand))];
    if (brandNames.length === 0) return;
    const todayStr = new Date().toISOString().substring(0, 10);

    for (const brandName of brandNames) {
      const brand = await Brand.findOne({ name: brandName }).select('_id').lean() as any;
      if (!brand) continue;
      const bid = brand._id.toString();
      redis.incr(`funnel:total:${bid}:purchase`).catch(() => {});
      redis.sadd(`funnel:daily:${bid}:purchase:${todayStr}`, orderId.toString()).catch(() => {});
    }
  }

  /**
   * Tạo phiên thanh toán VNPay cho một Order đã tồn tại:
   * PendingPayment (giữ orderId) + ghi paymentTxnRef vào chính Order + paymentUrl.
   * Bảng `payments` đã bỏ nên mã giao dịch nằm ngay trên orders.payment_txn_ref.
   * Dùng chung cho cả checkout mới và thanh toán lại đơn cũ.
   */
  static async createVnpaySession(
    order: any,
    opts: {
      ipAddr?: string;
      origin?: string;
      shippingMethodCode?: string;
      cartSnapshot?: any;
      clearsCart?: boolean;
    } = {}
  ) {
    const txnRef = crypto.randomUUID().replace(/-/g, '').toUpperCase().substring(0, 30);

    // Lưu mã giao dịch hiện hành lên Order (thay cho bản ghi Payment trước đây).
    await Order.updateOne(
      { _id: order._id },
      { $set: { paymentTxnRef: txnRef } }
    ).catch(() => {});

    // PendingPayment không lưu địa chỉ khách hàng — Order là nguồn duy nhất.
    await PendingPayment.create({
      txnRef,
      orderId: order._id,
      userId: order.userId,
      cartSnapshot: opts.cartSnapshot ?? (await CheckoutService.snapshotFromOrder(order)),
      shippingMethodCode: opts.shippingMethodCode || 'standard',
      shippingFee: order.shippingFee || 0,
      finalAmount: order.totalAmount,
      status: 'pending',
      ipAddr: opts.ipAddr,
      clearsCart: opts.clearsCart ?? false,
    });

    const orderInfo = `Thanh toan don hang ${txnRef}`;
    const frontendOrigin = (opts.origin || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const returnUrl = frontendOrigin ? `${frontendOrigin}/payment/return` : undefined;
    const paymentUrl = createPaymentUrl(
      { txnRef, amount: order.totalAmount, orderInfo, ipAddr: opts.ipAddr || '127.0.0.1', locale: 'vn' },
      returnUrl
    );

    return { txnRef, paymentUrl, amount: order.totalAmount };
  }

  /** Snapshot tương thích cho PendingPayment khi thanh toán lại đơn đã có OrderItem. */
  private static async snapshotFromOrder(order: any) {
    const orderItems = await OrderItem.find({ orderId: order._id }).lean();
    await enhanceItemsWithProductData(orderItems);
    return {
      items: orderItems,
      totalAmount: order.totalAmount,
      totalItems: orderItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0),
      voucherCode: null,
      voucherDiscount: 0,
      freeshipVoucherCode: null,
    };
  }
}
