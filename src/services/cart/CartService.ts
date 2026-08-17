import Cart from '../../models/Cart.ts';
import CartItem from '../../models/CartItem.ts';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { VoucherService } from '../VoucherService.ts';
import { FlashSale } from '../../models/FlashSale.ts';
import { User } from '../../models/User.ts';
import { redis } from '../../config/redis.ts';
import mongoose from 'mongoose';

export class CartService {
  static async enrichItemsWithVariants(items: any[]) {
    if (!items || items.length === 0) return [];
    const productIds = items.map(item => item.productId).filter(Boolean);
    const allVariants = await ProductVariant.find({ productId: { $in: productIds } })
      .select('productId size price quantityInStock isDefault sortOrder')
      .sort({ sortOrder: 1 })
      .lean();

    const variantMap: Record<string, any[]> = {};
    allVariants.forEach((v: any) => {
      const pid = String(v.productId);
      if (!variantMap[pid]) variantMap[pid] = [];
      variantMap[pid].push(v);
    });

    return items.map(item => {
      const variants = variantMap[String(item.productId)] || [];
      return {
        ...item,
        availableVariants: variants.map((v: any) => ({
          size: v.size,
          price: v.price,
          inStock: v.quantityInStock > 0,
          isDefault: v.isDefault,
        })),
      };
    });
  }

  static async formatCart(cart: any, items: any[]) {
    const enrichedItems = await CartService.enrichItemsWithVariants(items);
    return {
      _id: cart._id,
      items: enrichedItems,
      totalAmount: cart.totalAmount,
      totalItems: items.reduce((sum: number, item: any) => sum + item.quantity, 0),
      voucherCode: cart.voucherCode || null,
      voucherDiscount: cart.voucherDiscount || 0,
      freeshipVoucherCode: cart.freeshipVoucherCode || null,
    };
  }

  static async getCart(userId: string) {
    let cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    if (!cart) {
      cart = await Cart.create({
        userId: new mongoose.Types.ObjectId(userId),
        totalAmount: 0,
      });
      return await CartService.formatCart(cart, []);
    }
    const items = await CartItem.find({ cartId: cart._id }).lean();
    return await CartService.formatCart(cart, items);
  }

  static async addToCart(userId: string, productId: string, quantity: number = 1, variantSize?: string) {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('ID sản phẩm không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const product = await Product.findById(productId)
      .select('name brandId brand image discountPercentage discountStartDate discountEndDate')
      .populate('brandId', 'name')
      .lean() as any;
    if (!product) {
      const err: any = new Error('Sản phẩm không tồn tại');
      err.statusCode = 404;
      throw err;
    }
    const brandName = (product.brandId as any)?.name || product.brand || '';

    const sizeToFind = variantSize || '50ml';
    let variantDoc: any = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId), size: sizeToFind }).lean();

    if (variantDoc && variantDoc.quantityInStock !== undefined && variantDoc.quantityInStock <= 0) {
      const inStockVariant = await ProductVariant.findOne({
        productId: new mongoose.Types.ObjectId(productId),
        quantityInStock: { $gt: 0 },
      }).sort({ sortOrder: 1 }).lean();
      if (inStockVariant) variantDoc = inStockVariant;
    }

    if (!variantDoc) {
      variantDoc = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId) }).sort({ sortOrder: 1 }).lean();
    }

    if (variantDoc && variantDoc.quantityInStock !== undefined && variantDoc.quantityInStock <= 0) {
      const err: any = new Error(`Dung tích ${variantDoc.size} đã hết hàng`);
      err.statusCode = 400;
      throw err;
    }

    const variantPrice = variantDoc?.price || 0;
    const usedSize = variantDoc?.size || sizeToFind;

    let discountPct = product.discountPercentage || 0;
    const activeFS = await FlashSale.findOne({
      status: { $in: ['active', 'scheduled'] },
      'items.productId': new mongoose.Types.ObjectId(productId),
    }).lean();

    if (activeFS) {
      const fsItem = (activeFS.items || []).find((it: any) => it.productId?.toString() === productId.toString());
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
      const productImage = await ProductImage.findOne({ productId: new mongoose.Types.ObjectId(productId) })
        .select('url')
        .sort({ createdAt: 1 })
        .lean() as any;
      imageUrl = productImage?.url || undefined;
    }

    let cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      cart = await Cart.create({
        userId: new mongoose.Types.ObjectId(userId),
        totalAmount: 0,
      });
    }

    const existingItem = await CartItem.findOne({
      cartId: cart._id,
      productId: new mongoose.Types.ObjectId(productId),
      variantSize: usedSize,
    });

    if (existingItem) {
      existingItem.quantity += quantity;
      await existingItem.save();
    } else {
      await CartItem.create({
        cartId: cart._id,
        userId: new mongoose.Types.ObjectId(userId),
        productId: new mongoose.Types.ObjectId(productId),
        name: product.name,
        image: imageUrl,
        brand: brandName,
        price: finalPrice,
        discount: discountPct,
        quantity,
        variantSize: usedSize,
      });
    }

    const items = await CartItem.find({ cartId: cart._id }).lean();
    cart.totalAmount = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    await cart.save();

    if (product.brandId) {
      const bid = product.brandId.toString();
      const stage = 'add_to_cart';
      const now = new Date();
      const ds = now.toISOString().split('T')[0];
      const hr = String(now.getHours());
      const totalKey = `funnel:total:${bid}:${stage}`;
      const todayKey = `funnel:daily:${bid}:${stage}:${ds}`;
      const hourKey = `funnel:hourly:${bid}:${stage}:${ds}:${hr}`;
      redis.incr(totalKey).catch(() => {});
      redis.incr(todayKey).catch(() => {});
      redis.expire(todayKey, 172800).catch(() => {});
      redis.incr(hourKey).catch(() => {});
      redis.expire(hourKey, 259200).catch(() => {});
    }

    return await CartService.formatCart(cart, items);
  }

  static async updateCartItem(userId: string, productId: string, quantity: number, variantSize?: string) {
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('ID sản phẩm không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    if (quantity < 0) {
      const err: any = new Error('Số lượng không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      const err: any = new Error('Giỏ hàng trống');
      err.statusCode = 404;
      throw err;
    }

    const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
    if (variantSize) filter.variantSize = variantSize;

    const item = await CartItem.findOne(filter);
    if (!item) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    if (quantity === 0) {
      await CartItem.deleteOne({ _id: item._id });
    } else {
      if (!item.userId) item.userId = new mongoose.Types.ObjectId(userId);
      item.quantity = quantity;
      await item.save();
    }

    const items = await CartItem.find({ cartId: cart._id }).lean();
    cart.totalAmount = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    await cart.save();

    return await CartService.formatCart(cart, items);
  }

  static async updateCartItemVariant(userId: string, productId: string, newVariantSize: string, currentVariantSize?: string) {
    if (!productId || !newVariantSize || !mongoose.Types.ObjectId.isValid(productId)) {
      const err: any = new Error('Dữ liệu không hợp lệ');
      err.statusCode = 400;
      throw err;
    }

    const variantDoc = await ProductVariant.findOne({
      productId: new mongoose.Types.ObjectId(productId),
      size: newVariantSize,
    }).lean();
    if (!variantDoc) {
      const err: any = new Error('Biến thể không tồn tại');
      err.statusCode = 404;
      throw err;
    }

    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      const err: any = new Error('Giỏ hàng trống');
      err.statusCode = 404;
      throw err;
    }

    const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
    if (currentVariantSize) filter.variantSize = currentVariantSize;

    const item = await CartItem.findOne(filter);
    if (!item) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    const existingWithNewVariant = await CartItem.findOne({
      cartId: cart._id,
      productId: new mongoose.Types.ObjectId(productId),
      variantSize: newVariantSize,
      _id: { $ne: item._id },
    });

    const product = await Product.findById(productId).select('discountPercentage discountStartDate discountEndDate').lean() as any;
    let finalPrice = variantDoc.price;
    if (product?.discountPercentage) {
      const now = new Date();
      const startOk = !product.discountStartDate || new Date(product.discountStartDate) <= now;
      const endOk = !product.discountEndDate || new Date(product.discountEndDate) >= now;
      if (startOk && endOk) finalPrice = Math.round(variantDoc.price * (1 - product.discountPercentage / 100));
    }

    if (existingWithNewVariant) {
      if (!existingWithNewVariant.userId) existingWithNewVariant.userId = new mongoose.Types.ObjectId(userId);
      existingWithNewVariant.quantity += item.quantity;
      existingWithNewVariant.price = finalPrice;
      await existingWithNewVariant.save();
      await CartItem.deleteOne({ _id: item._id });
    } else {
      if (!item.userId) item.userId = new mongoose.Types.ObjectId(userId);
      item.variantSize = newVariantSize;
      item.price = finalPrice;
      await item.save();
    }

    const items = await CartItem.find({ cartId: cart._id }).lean();
    cart.totalAmount = items.reduce((sum: number, i: any) => sum + i.price * i.quantity, 0);
    cart.voucherCode = null as any;
    cart.voucherDiscount = 0;
    await cart.save();

    return await CartService.formatCart(cart, items);
  }

  static async removeCartItem(userId: string, productId: string, variantSize?: string) {
    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      const err: any = new Error('Giỏ hàng trống');
      err.statusCode = 404;
      throw err;
    }

    const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
    if (variantSize) filter.variantSize = variantSize;

    const result = await CartItem.deleteOne(filter);
    if (result.deletedCount === 0) {
      const err: any = new Error('Sản phẩm không có trong giỏ');
      err.statusCode = 404;
      throw err;
    }

    const items = await CartItem.find({ cartId: cart._id }).lean();
    cart.totalAmount = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
    await cart.save();

    return await CartService.formatCart(cart, items);
  }

  static async clearCart(userId: string) {
    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (cart) {
      await CartItem.deleteMany({ cartId: cart._id });
      cart.totalAmount = 0;
      await cart.save();
    }
    return { items: [], totalAmount: 0, totalItems: 0 };
  }

  static async listAvailableVouchers(userId: string) {
    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    const totalAmount = cart?.totalAmount || 0;

    const user = await User.findById(userId).select('memberTier totalSpent').lean() as any;
    const userTier = user?.memberTier || 'MEMBER';

    const vouchers = await VoucherService.getActive(userTier, userId);

    return vouchers
      .filter((v: any) => {
        if (totalAmount < v.minOrderAmount) return false;
        return true;
      })
      .map((v: any) => {
        let discountAmount = 0;
        if (v.type === 'percentage') {
          discountAmount = Math.round(totalAmount * (v.value / 100));
          if (v.maxDiscount && discountAmount > v.maxDiscount) {
            discountAmount = v.maxDiscount;
          }
        } else {
          discountAmount = v.value;
        }
        const remaining = Math.max(0, (v.maxUsage ?? 0) - (v.usedCount || 0));
        return {
          code: v.code,
          type: v.type,
          value: v.value,
          maxDiscount: v.maxDiscount || null,
          minOrderAmount: v.minOrderAmount,
          minTier: v.minTier || null,
          discountAmount,
          endDate: v.endDate,
          remaining,
          maxUsage: v.maxUsage,
          usedCount: v.usedCount,
        };
      });
  }

  static async applyVoucher(userId: string, code: string) {
    if (!code) {
      const err: any = new Error('Vui lòng nhập mã giảm giá');
      err.statusCode = 400;
      throw err;
    }

    const user = await User.findById(userId).select('memberTier totalSpent').lean() as any;
    const userTier = user?.memberTier || 'MEMBER';

    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      return { success: false, message: 'Giỏ hàng trống' };
    }

    const items = await CartItem.find({ cartId: cart._id }).lean();
    if (items.length === 0) {
      return { success: false, message: 'Giỏ hàng trống' };
    }

    const result = await VoucherService.validate(code, cart.totalAmount, userTier, userId);
    if (!result.valid) {
      return { success: false, message: result.message };
    }

    const voucher = result.voucher!;
    const discountAmount = result.discountAmount!;

    const isFreeship = voucher.voucherCategory === 'freeship' || voucher.code.startsWith('FSEXPRESS') || (voucher.type === 'fixed' && voucher.value === 0);

    if (isFreeship) {
      cart.freeshipVoucherCode = voucher.code;
    } else {
      cart.voucherCode = voucher.code;
      cart.voucherDiscount = discountAmount;
    }
    await cart.save();

    return {
      success: true,
      message: `Áp dụng mã ${voucher.code} thành công!`,
      data: await CartService.formatCart(cart, items),
    };
  }

  static async removeVoucher(userId: string, code?: string, type?: 'discount' | 'freeship') {
    const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
    if (!cart) {
      return { success: false, message: 'Giỏ hàng trống' };
    }

    if (code) {
      if (cart.voucherCode === code) {
        cart.voucherCode = null as any;
        cart.voucherDiscount = 0;
      } else if (cart.freeshipVoucherCode === code) {
        cart.freeshipVoucherCode = null as any;
      }
    } else if (type === 'discount') {
      cart.voucherCode = null as any;
      cart.voucherDiscount = 0;
    } else if (type === 'freeship') {
      cart.freeshipVoucherCode = null as any;
    } else {
      cart.voucherCode = null as any;
      cart.voucherDiscount = 0;
      cart.freeshipVoucherCode = null as any;
    }
    await cart.save();

    const items = await CartItem.find({ cartId: cart._id }).lean();

    return {
      success: true,
      message: 'Đã hủy mã giảm giá',
      data: await CartService.formatCart(cart, items),
    };
  }
}
