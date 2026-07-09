import type { FastifyRequest, FastifyReply } from 'fastify';
import Cart from '../models/Cart.ts';
import CartItem from '../models/CartItem.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { ProductImage } from '../models/ProductImage.ts';
import { Voucher } from '../models/Voucher.ts';
import { Order } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { redis } from '../config/redis.ts';
import mongoose from 'mongoose';

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
    };
  }

  static async applyVoucher(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) return reply.status(401).send({ success: false, message: 'Vui lòng đăng nhập' });

      const { code } = req.body as { code: string };
      if (!code) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập mã giảm giá' });
      }

      const voucher = await Voucher.findOne({
        code: code.toUpperCase(),
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      }).lean();

      if (!voucher) {
        return reply.send({ success: false, message: 'Mã giảm giá không hợp lệ hoặc đã hết hạn' });
      }

      if (voucher.maxUsage > 0 && voucher.usedCount >= voucher.maxUsage) {
        return reply.send({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng' });
      }

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
      }

      const items = await CartItem.find({ cartId: cart._id }).lean();
      if (items.length === 0) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
      }

      if (cart.totalAmount < voucher.minOrderAmount) {
        return reply.send({
          success: false,
          message: `Đơn hàng tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')}đ để áp dụng mã này`,
        });
      }

      let discountAmount = 0;
      if (voucher.type === 'percentage') {
        discountAmount = Math.round(cart.totalAmount * (voucher.value / 100));
        if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
          discountAmount = voucher.maxDiscount;
        }
      } else {
        discountAmount = voucher.value;
      }

      cart.voucherCode = voucher.code;
      cart.voucherDiscount = discountAmount;
      await cart.save();

      return reply.send({
        success: true,
        message: `Áp dụng mã ${voucher.code} thành công! Giảm ${discountAmount.toLocaleString('vi-VN')}đ`,
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

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.send({ success: false, message: 'Giỏ hàng trống' });
      }

      cart.voucherCode = null as any;
      cart.voucherDiscount = 0;
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
      if (!variantDoc) {
        variantDoc = await ProductVariant.findOne({ productId: new mongoose.Types.ObjectId(productId) }).sort({ sortOrder: 1 }).lean();
      }
      const variantPrice = variantDoc?.price || 0;
      const usedSize = variantDoc?.size || sizeToFind;

      const discountPct = product.discountPercentage || 0;
      let finalPrice = variantPrice;
      if (discountPct > 0) {
        const now = new Date();
        const startOk = !product.discountStartDate || new Date(product.discountStartDate) <= now;
        const endOk = !product.discountEndDate || new Date(product.discountEndDate) >= now;
        if (startOk && endOk) finalPrice = Math.round(variantPrice * (1 - discountPct / 100));
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

      const { customerName, customerEmail, customerPhone, customerAddress, paymentMethod } = req.body as {
        customerName: string;
        customerEmail?: string;
        customerPhone?: string;
        customerAddress?: string;
        paymentMethod?: string;
      };

      if (!customerName) {
        return reply.status(400).send({ success: false, message: 'Vui lòng nhập họ tên' });
      }

      const cart = await Cart.findOne({ userId: new mongoose.Types.ObjectId(userId) });
      if (!cart) {
        return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const items = await CartItem.find({ cartId: cart._id }).lean();
      if (items.length === 0) {
        return reply.status(400).send({ success: false, message: 'Giỏ hàng trống' });
      }

      const shippingFee = cart.totalAmount >= 500000 ? 0 : 30000;
      const finalAmount = cart.totalAmount + shippingFee - (cart.voucherDiscount || 0);

      const order = await Order.create({
        userId: new mongoose.Types.ObjectId(userId),
        customerName,
        customerEmail: customerEmail || '',
        customerPhone: customerPhone || '',
        customerAddress: customerAddress || '',
        totalAmount: Math.max(0, finalAmount),
        status: 'pending',
        paymentMethod: paymentMethod || 'cod',
        paymentStatus: 'unpaid',
      });

      await OrderItem.insertMany(
        items.map((item: any) => ({
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

      await CartItem.deleteMany({ cartId: cart._id });
      cart.totalAmount = 0;
      cart.voucherCode = null as any;
      cart.voucherDiscount = 0;
      await cart.save();

      return reply.send({
        success: true,
        data: {
          _id: order._id,
          items: items.map((i: any) => ({
            _id: i._id,
            productId: i.productId,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            variantSize: i.variantSize,
          })),
          totalAmount: order.totalAmount,
          totalItems: items.reduce((sum: number, i: any) => sum + i.quantity, 0),
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, message: err.message });
    }
  }
}
