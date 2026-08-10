import type { FastifyRequest, FastifyReply } from 'fastify';
import Cart from '../models/Cart.ts';
import CartItem from '../models/CartItem.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { ProductImage } from '../models/ProductImage.ts';
import { VoucherService } from '../services/VoucherService.ts';
import { FlashSaleService } from '../services/FlashSaleService.ts';
import { FlashSale } from '../models/FlashSale.ts';
import { Order } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Voucher } from '../models/Voucher.ts';
import { UserVoucher } from '../models/UserVoucher.ts';
import { redis } from '../config/redis.ts';
import mongoose from 'mongoose';
import { calculateShippingFee } from '../utils/helpers.ts';

export class CartController {
  private static async enrichItemsWithVariants(items: any[]) {
    const enriched = await Promise.all(items.map(async (item) => {
      const variants = await ProductVariant.find({ productId: item.productId })
        .select('size price quantityInStock isDefault')
        .sort({ sortOrder: 1 })
        .lean();
      return {
        ...item,
        availableVariants: variants.map((v: any) => ({
          size: v.size,
          price: v.price,
          inStock: v.quantityInStock > 0,
          isDefault: v.isDefault,
        })),
      };
    }));
    return enriched;
  }

  private static async formatCart(cart: any, items: any[]) {
    const enrichedItems = await CartController.enrichItemsWithVariants(items);
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

  /**
   * Resolve mua ngay: chuyển items [{productId, quantity, variantSize}] → items chuẩn
   * (kèm name, image, brand, price đã áp dụng giảm giá) + totalAmount.
   * Không ghi vào giỏ hàng.
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
        .lean() as any;
      if (!product) {
        const err: any = new Error('Sản phẩm không tồn tại');
        err.statusCode = 404;
        throw err;
      }

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
        brand: product.brand,
        price: finalPrice,
        discount: discountPct,
        quantity,
        variantSize: usedSize,
      });
      totalAmount += finalPrice * quantity;
    }

    return { resolvedItems, totalAmount };
  }

  static async listAvailableVouchers(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
      const totalAmount = cart?.totalAmount || 0;

      // Lấy hạng user
      const user = await (await import('../models/User.ts')).User.findById(userId).select('memberTier totalSpent').lean() as any;
      const userTier = user?.memberTier || 'MEMBER';

      const vouchers = await VoucherService.getActive(userTier, userId);

      const result = vouchers
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

      return reply.send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async applyVoucher(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { code } = req.body as { code: string };
      if (!code) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập mã giảm giá' });
      }

      // Lấy hạng user
      const user = await (await import('../models/User.ts')).User.findById(userId).select('memberTier totalSpent').lean() as any;
      const userTier = user?.memberTier || 'MEMBER';

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
      }

      const items = await CartItem.find({ cartId: cart._id }).lean();
      if (items.length === 0) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
      }

      const result = await VoucherService.validate(code, cart.totalAmount, userTier, userId);
      if (!result.valid) {
        return reply.send({ success: false, message: result.message });
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

      return reply.send({
        success: true,
        message: `Áp dụng mã ${voucher.code} thành công!`,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async removeVoucher(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { code, type } = (req.body || req.query || {}) as { code?: string; type?: 'discount' | 'freeship' };

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
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

      return reply.send({
        success: true,
        message: 'Đã hủy mã giảm giá',
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async getCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      let cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();

      if (!cart) {
        cart = await Cart.create({
          userId: new mongoose.Types.ObjectId(userId),
          totalAmount: 0,
        });
        return reply.send({
          success: true,
          data: await CartController.formatCart(cart, []),
        });
      }

      const items = await CartItem.find({ cartId: cart._id }).lean();

      return reply.send({
        success: true,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async addToCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, quantity = 1, variantSize } = req.body as { productId: string; quantity?: number; variantSize?: string };

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      const product = await Product.findById(productId).select('name brandId brand image discountPercentage discountStartDate discountEndDate').lean() as any;
      if (!product) {
        return reply.status(404).send({ success: false, message: 'Sản phẩm không tồn tại' });
      }

      const sizeToFind = variantSize || '50ml';
      let variantDoc: any = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId), size: sizeToFind }).lean();

      // Nếu biến thể được yêu cầu hết hàng (quantityInStock = 0), thử tìm biến thể còn hàng
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

      // Kiểm tra tồn kho
      if (variantDoc && variantDoc.quantityInStock !== undefined && variantDoc.quantityInStock <= 0) {
        return reply.status(400).send({ success: false, message: `Dung tích ${variantDoc.size} đã hết hàng` });
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
          brand: product.brand,
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

      return reply.send({
        success: true,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async updateCartItem(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, quantity, variantSize } = req.body as { productId: string; quantity: number; variantSize?: string };

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'ID sản phẩm không hợp lệ' });
      }

      if (quantity < 0) {
        return reply.status(400).send({ success: false, message: 'Số lượng không hợp lệ' });
      }

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.status(404).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
      if (variantSize) filter.variantSize = variantSize;

      const item = await CartItem.findOne(filter);
      if (!item) {
        return reply.status(404).send({ success: false, message: 'Sản phẩm không có trong giỏ' });
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

      return reply.send({
        success: true,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async updateCartItemVariant(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { productId, currentVariantSize, newVariantSize } = req.body as { productId: string; currentVariantSize?: string; newVariantSize: string };

      if (!productId || !newVariantSize || !mongoose.Types.ObjectId.isValid(productId)) {
        return reply.status(400).send({ success: false, message: 'Dữ liệu không hợp lệ' });
      }

      const variantDoc = await ProductVariant.findOne({
        productId: new mongoose.Types.ObjectId(productId),
        size: newVariantSize,
      }).lean();
      if (!variantDoc) {
        return reply.status(404).send({ success: false, message: 'Biến thể không tồn tại' });
      }

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.status(404).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
      if (currentVariantSize) filter.variantSize = currentVariantSize;

      const item = await CartItem.findOne(filter);
      if (!item) {
        return reply.status(404).send({ success: false, message: 'Sản phẩm không có trong giỏ' });
      }

      // Kiểm tra xem đã có item với variant mới chưa (tránh trùng)
      const existingWithNewVariant = await CartItem.findOne({
        cartId: cart._id,
        productId: new mongoose.Types.ObjectId(productId),
        variantSize: newVariantSize,
        _id: { $ne: item._id },
      });

      // Tính giá mới
      const product = await Product.findById(productId).select('discountPercentage discountStartDate discountEndDate').lean() as any;
      let finalPrice = variantDoc.price;
      if (product?.discountPercentage) {
        const now = new Date();
        const startOk = !product.discountStartDate || new Date(product.discountStartDate) <= now;
        const endOk = !product.discountEndDate || new Date(product.discountEndDate) >= now;
        if (startOk && endOk) finalPrice = Math.round(variantDoc.price * (1 - product.discountPercentage / 100));
      }

      if (existingWithNewVariant) {
        // Gộp quantity vào item variant mới, xóa item cũ
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

      return reply.send({
        success: true,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async removeCartItem(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      const { productId } = req.params as { productId: string };
      const { variantSize } = req.query as { variantSize?: string };
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.status(404).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const filter: any = { cartId: cart._id, productId: new mongoose.Types.ObjectId(productId) };
      if (variantSize) filter.variantSize = variantSize;

      const result = await CartItem.deleteOne(filter);
      if (result.deletedCount === 0) {
        return reply.status(404).send({ success: false, message: 'Sản phẩm không có trong giỏ' });
      }

      const items = await CartItem.find({ cartId: cart._id }).lean();
      cart.totalAmount = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
      await cart.save();

      return reply.send({
        success: true,
        data: await CartController.formatCart(cart, items),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async clearCart(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (cart) {
        await CartItem.deleteMany({ cartId: cart._id });
        cart.totalAmount = 0;
        await cart.save();
      }

      return reply.send({
        success: true,
        data: { items: [], totalAmount: 0, totalItems: 0 },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }

  static async checkout(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { customerName, customerEmail, customerPhone, customerAddress, paymentMethod, shippingMethod, items, isCartCheckout } = req.body as {
        customerName: string;
        customerEmail?: string;
        customerPhone?: string;
        customerAddress?: string;
        paymentMethod?: string;
        shippingMethod?: 'standard' | 'express';
        items?: Array<{ productId: string; quantity?: number; variantSize?: string }>;
        isCartCheckout?: boolean;
      };

      if (!customerName) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập họ tên' });
      }

      let orderItems: any[];
      let totalAmount: number;
      let voucherDiscount = 0;
      let clearsCart = true;
      let cart: any = null;

      if (items && items.length > 0) {
        // Mua ngay hoặc mua chọn lọc từ giỏ hàng
        const resolved = await CartController.resolveBuyNowItems(items);
        orderItems = resolved.resolvedItems;
        totalAmount = resolved.totalAmount;
        clearsCart = !!isCartCheckout;
        // Lấy voucherDiscount từ giỏ hàng nếu có
        cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
        voucherDiscount = cart?.voucherDiscount || 0;
      } else {
        cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
        if (!cart) {
          return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
        }

        orderItems = await CartItem.find({ cartId: cart._id }).lean();
        if (orderItems.length === 0) {
          return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
        }

        totalAmount = cart.totalAmount;
        voucherDiscount = cart.voucherDiscount || 0;
      }

      const shippingResult = await calculateShippingFee(totalAmount, shippingMethod || 'standard');
      const shippingFee = shippingResult.fee;

      // Hỗ trợ Voucher Freeship Hỏa Tốc (phát sinh từ voucher cũ)
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
        freeshipVoucherId,
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

      // Tự động cộng soldCount cho sản phẩm trong đợt Flash Sale đang diễn ra
      const purchases = orderItems.map((item: any) => ({
        productId: item.productId?.toString ? item.productId.toString() : String(item.productId),
        quantity: item.quantity || 1,
      }));
      await FlashSaleService.recordFlashSalePurchases(purchases);

      if (clearsCart) {
        const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
        if (cart) {
          if (items && items.length > 0) {
            // Xóa các item đã mua khỏi giỏ hàng
            for (const item of items) {
              await CartItem.deleteOne({
                cartId: cart._id,
                productId: new mongoose.Types.ObjectId(item.productId),
                variantSize: item.variantSize || '50ml',
              });
            }
            // Cập nhật lại tổng tiền giỏ hàng
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
      }

      return reply.send({
        success: true,
        data: {
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
        },
      });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
      return reply.status(status).send({ success: false, message: err.message });
    }
  }
}
