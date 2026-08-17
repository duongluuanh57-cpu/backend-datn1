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
import { UserVoucher } from '../../models/UserVoucher.ts';
import mongoose from 'mongoose';
import { calculateShippingFee } from '../../utils/helpers.ts';
import { emitNewOrder } from '../../utils/adminSseEmitter.ts';

export interface CheckoutPayload {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentMethod?: string;
  shippingMethod?: 'standard' | 'express';
  items?: Array<{ productId: string; quantity?: number; variantSize?: string }>;
  isCartCheckout?: boolean;
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
        .populate('brandId', 'name')
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

      let discountPct = product.discountPercentage || 0;
      const activeFS = await FlashSale.findOne({
        status: { $in: ['active', 'scheduled'] },
        'items.productId': new mongoose.Types.ObjectId(entry.productId),
      }).lean();

      if (activeFS) {
        const fsItem = (activeFS.items || []).find((it: any) => it.productId?.toString() === entry.productId.toString());
        if (fsItem) {
          const isFSExhausted = fsItem.stockLimit > 0 && (fsItem.soldCount || 0) >= fsItem.stockLimit;
          if (!isFSExhausted) {
            discountPct = Math.min(100, discountPct + (fsItem.extraDiscountPercentage || 0));
          }
        }
      }

      let finalPrice = variantPrice;
      if (discountPct > 0) {
        finalPrice = Math.round(variantPrice * (1 - discountPct / 100));
      }

      let imageUrl = product.image || undefined;
      if (!imageUrl) {
        const productImage = await ProductImage.findOne({ productId: new mongoose.Types.ObjectId(entry.productId) })
          .select('url')
          .sort({ createdAt: 1 })
          .lean() as any;
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
    const { customerName, customerEmail, customerPhone, customerAddress, paymentMethod, shippingMethod, items, isCartCheckout } = payload;

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

    if (items && items.length > 0) {
      const resolved = await CheckoutService.resolveBuyNowItems(items);
      orderItems = resolved.resolvedItems;
      totalAmount = resolved.totalAmount;
      clearsCart = !!isCartCheckout;
      cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      voucherDiscount = cart?.voucherDiscount || 0;
    } else {
      cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
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
      voucherDiscount = cart.voucherDiscount || 0;
    }

    const shippingResult = await calculateShippingFee(totalAmount, shippingMethod || 'standard');
    const shippingFee = shippingResult.fee;

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

    let voucherId = undefined;
    if (cart && cart.voucherCode) {
      const voucher = await Voucher.findOne({ code: cart.voucherCode }).lean();
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
    if (cart && cart.freeshipVoucherCode) {
      const voucher = await Voucher.findOne({ code: cart.freeshipVoucherCode }).lean();
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
      voucherCode: (cart && cart.voucherCode) || undefined,
      voucherDiscount: voucherDiscount || 0,
      freeshipVoucherId,
      freeshipVoucherCode: (cart && cart.freeshipVoucherCode) || undefined,
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

    if (clearsCart) {
      const cartToClean = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (cartToClean) {
        if (items && items.length > 0) {
          for (const item of items) {
            await CartItem.deleteOne({
              cartId: cartToClean._id,
              productId: new mongoose.Types.ObjectId(item.productId),
              variantSize: item.variantSize || '50ml',
            });
          }
          const remainingItems = await CartItem.find({ cartId: cartToClean._id }).lean();
          cartToClean.totalAmount = remainingItems.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);
          cartToClean.voucherCode = null as any;
          cartToClean.voucherDiscount = 0;
          cartToClean.freeshipVoucherCode = null as any;
          await cartToClean.save();
        } else {
          await CartItem.deleteMany({ cartId: cartToClean._id });
          cartToClean.totalAmount = 0;
          cartToClean.voucherCode = null as any;
          cartToClean.voucherDiscount = 0;
          cartToClean.freeshipVoucherCode = null as any;
          await cartToClean.save();
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
