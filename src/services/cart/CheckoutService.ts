import Cart from '../../models/Cart.ts';
import CartItem from '../../models/CartItem.ts';
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
import { UserVoucher } from '../../models/UserVoucher.ts';
import mongoose from 'mongoose';
import { calculateShippingFee } from '../../utils/helpers.ts';
import { emitNewOrder } from '../../utils/adminSseEmitter.ts';
import { markSoldCounted } from '../../controllers/order/orderHelpers.ts';
import { getEffectiveProductDiscount } from '../product/productFormatterService.ts';

export interface CheckoutPayload {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentMethod?: string;
  shippingMethod?: 'standard' | 'express';
  items?: Array<{ productId: string; quantity?: number; variantSize?: string }>;
  isCartCheckout?: boolean;
  voucherCode?: string;
  freeshipVoucherCode?: string;
}

export class CheckoutService {
  /**
   * Resolve mua ngay: chuyển items [{productId, quantity, variantSize}] → items chuẩn
   * (kèm name, image, brand, price đã áp dụng giảm giá) + totalAmount.
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
        .select('name brandId brand image discountPercentage discountStartDate discountEndDate')
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
        variantDoc = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(entry.productId) })
          .sort({ sortOrder: 1 })
          .lean();
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
        .sort({ createdAt: 1 })
        .lean() as any;
      const brandLogo = (product.brandId as any)?.logo;
      let imageUrl = productImage?.url || product.image || undefined;
      if (brandLogo && imageUrl === brandLogo) {
        imageUrl = productImage?.url || undefined;
      }

      resolvedItems.push({
        productId: product._id,
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
    const { customerName, customerEmail, customerPhone, customerAddress, paymentMethod, shippingMethod, items, isCartCheckout, voucherCode: payloadVoucherCode, freeshipVoucherCode: payloadFreeshipCode } = payload;

    if (!customerName) {
      const err: any = new Error('Vui lòng nhập họ tên');
      err.statusCode = 400;
      throw err;
    }

    let orderItems: any[];
    let totalAmount: number;
    let voucherDiscount = 0;
    let clearsCart = true;
    let cart: any = null;

    cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });

    if (items && items.length > 0) {
      const resolved = await CheckoutService.resolveBuyNowItems(items);
      orderItems = resolved.resolvedItems;
      totalAmount = resolved.totalAmount;
      clearsCart = !!isCartCheckout;
    } else {
      if (!cart) {
        const err: any = new Error('Giỏ hàng trống');
        err.statusCode = 400;
        throw err;
      }

      const rawCartItems = await CartItem.find({ cartId: cart._id })
        .populate({ path: 'productId', select: 'brandId', populate: { path: 'brandId', select: 'name' } })
        .lean();
      if (rawCartItems.length === 0) {
        const err: any = new Error('Giỏ hàng trống');
        err.statusCode = 400;
        throw err;
      }
      orderItems = rawCartItems.map((ci: any) => ({
        ...ci,
        brand: ci.brand || (ci.productId as any)?.brandId?.name || '',
      }));

      totalAmount = cart.totalAmount;
    }

    // Xác định mã voucher được áp dụng cho đơn hàng này
    let appliedVoucherCode: string | null = null;
    let appliedFreeshipCode: string | null = null;

    if (items && items.length > 0 && !isCartCheckout) {
      // Mua ngay: Chỉ áp dụng nếu client gửi voucherCode lên
      appliedVoucherCode = payloadVoucherCode || null;
      appliedFreeshipCode = payloadFreeshipCode || null;
    } else {
      // Mua từ giỏ hàng: Lấy từ payload hoặc từ giỏ hàng hiện tại
      appliedVoucherCode = payloadVoucherCode !== undefined ? (payloadVoucherCode || null) : (cart?.voucherCode || null);
      appliedFreeshipCode = payloadFreeshipCode !== undefined ? (payloadFreeshipCode || null) : (cart?.freeshipVoucherCode || null);
    }

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

    const shippingResult = await calculateShippingFee(totalAmount, shippingMethod || 'standard');
    const shippingFee = shippingResult.fee;

    if (appliedVoucherCode && appliedVoucherCode.startsWith('FSEXPRESS')) {
      if (shippingMethod === 'express') {
        voucherDiscount = shippingFee;
      } else {
        voucherDiscount = 0;
      }
    }

    let freeshipDiscount = 0;
    if (appliedFreeshipCode) {
      freeshipDiscount = shippingFee;
    }

    const finalAmount = totalAmount + shippingFee - voucherDiscount - freeshipDiscount;

    let voucherId = undefined;
    if (appliedVoucherCode) {
      const voucher = await Voucher.findOne({ code: appliedVoucherCode }).lean();
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
    if (appliedFreeshipCode) {
      const voucher = await Voucher.findOne({ code: appliedFreeshipCode }).lean();
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

    const order = await Order.create({
      userId: new mongoose.Types.ObjectId(userId),
      shippingInfo: {
        customerName,
        customerEmail: customerEmail || '',
        customerPhone: customerPhone || '',
        customerAddress: customerAddress || '',
      },
      itemsSubtotal: totalAmount,
      totalAmount: Math.max(0, finalAmount),
      shippingMethodId: shippingResult.methodId ? new mongoose.Types.ObjectId(shippingResult.methodId) : undefined,
      shippingFee,
      status: 'pending',
      paymentMethod: paymentMethod || 'cod',
      paymentStatus: 'unpaid',
      voucherId,
      voucherCode: appliedVoucherCode || undefined,
      voucherDiscount: voucherDiscount || 0,
      freeshipVoucherId,
      freeshipVoucherCode: appliedFreeshipCode || undefined,
      freeshipDiscount: freeshipDiscount || 0,
    });

    await OrderItem.insertMany(
      orderItems.map((item: any) => ({
        orderId: order._id,
        productId: item.productId,
        name: item.name,
        image: item.image || '',
        price: item.price,
        quantity: item.quantity,
        variantSize: item.variantSize || '50ml',
        brand: item.brand || '',
      }))
    );

    // Tăng soldCount ngay lập tức khi user mua hàng thành công và kích hoạt leo top thời gian thực
    try {
      await markSoldCounted(order._id);
    } catch (e) {
      console.warn('⚠️ [CheckoutService] markSoldCounted error:', e);
    }

    const purchases = orderItems.map((item: any) => ({
      productId: item.productId?.toString ? item.productId.toString() : String(item.productId),
      quantity: item.quantity || 1,
    }));
    await FlashSaleService.recordFlashSalePurchases(purchases);

    try {
      emitNewOrder({
        orderId: order._id.toString(),
        username: customerName,
        amount: order.totalAmount,
      });
    } catch { /* silent */ }

    if (cart) {
      if (clearsCart) {
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
      } else {
        // Mua ngay: nếu có dùng voucher, xóa voucher khỏi cart để không lưu dính sang các lần mua sau
        if (appliedVoucherCode || appliedFreeshipCode) {
          cart.voucherCode = null as any;
          cart.voucherDiscount = 0;
          cart.freeshipVoucherCode = null as any;
          await cart.save();
        }
      }
    }

    return {
      _id: order._id,
      items: orderItems.map((i: any) => ({
        _id: i._id,
        productId: i.productId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        variantSize: i.variantSize,
      })),
      totalAmount: order.totalAmount,
      totalItems: orderItems.reduce((sum: number, i: any) => sum + i.quantity, 0),
    };
  }
}
