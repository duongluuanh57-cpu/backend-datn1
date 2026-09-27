import mongoose from 'mongoose';
import { Product } from '../../models/Product.ts';
import { ProductVariant } from '../../models/ProductVariant.ts';
import { ProductImage } from '../../models/ProductImage.ts';
import { PaymentMethod } from '../../models/PaymentMethod.ts';

/**
 * Hydrate OrderItem từ ProductVariant → Product → Brand/ProductImage.
 * DB không lưu name/brand/image/variantSize; các field này chỉ có trong response
 * để frontend/order history hiển thị.
 */
export async function enhanceItemsWithProductData(items: any[]): Promise<void> {
  if (!items || items.length === 0) return;

  const variantIds = [...new Set(
    items
      .map((item) => {
        const value = item?.productVariantId;
        return value && typeof value === 'object' ? value._id : value;
      })
      .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)))
  )];

  const variants = await ProductVariant.find({ _id: { $in: variantIds } })
    .select('_id productId size price')
    .populate({
      path: 'productId',
      select: 'name image brandId',
      populate: { path: 'brandId', select: 'name logo' },
    })
    .lean() as any[];

  const variantMap = new Map(variants.map((variant) => [variant._id.toString(), variant]));
  const productIds = [...new Set(
    variants
      .map((variant) => variant.productId?._id?.toString())
      .filter(Boolean)
  )].map((id) => new mongoose.Types.ObjectId(id as string));

  const productImages = productIds.length > 0
    ? await ProductImage.find({ productId: { $in: productIds } })
        .select('url productId')
        .sort({ _id: 1 })
        .lean()
    : [];
  const imageMap = new Map<string, string>();
  for (const image of productImages as any[]) {
    const productId = image.productId.toString();
    if (!imageMap.has(productId)) imageMap.set(productId, image.url);
  }

  for (const item of items) {
    const rawVariantId = item?.productVariantId;
    const variantId = rawVariantId && typeof rawVariantId === 'object'
      ? rawVariantId._id?.toString()
      : rawVariantId?.toString?.() || String(rawVariantId || '');
    const variant = variantMap.get(variantId);
    const product = variant?.productId && typeof variant.productId === 'object'
      ? variant.productId
      : null;
    const brand = product?.brandId && typeof product.brandId === 'object'
      ? product.brandId
      : null;
    const productId = product?._id?.toString() || item.productId?.toString?.() || item.productId || null;
    let productImage = productId
      ? imageMap.get(productId.toString()) || product?.image || item.image || null
      : item.image || null;
    if (brand?.logo && productImage === brand.logo) {
      productImage = imageMap.get(productId?.toString() || '') || null;
    }

    // Các field dưới đây là dữ liệu response, không được lưu vào order_items.
    // Fallback cũ chỉ phục vụ các order_items lịch sử chưa migrate được; sau khi
    // migration, mọi dòng hợp lệ đều đi qua ProductVariant → Product.
    item.productVariantId = variant || rawVariantId;
    item.productId = productId;
    item.name = product?.name || item.name || '';
    item.brand = brand?.name || item.brand || '';
    item.image = productImage;
    item.productImage = productImage;
    item.variantSize = variant?.size || item.variantSize || '';
  }
}

/**
 * Chuẩn hoá các giá trị DẪN XUẤT khi đọc đơn hàng.
 *
 * Bảng `orders` chỉ còn 18 cột theo ERD nên `items_subtotal`, `voucher_code` và
 * `voucher_discount` KHÔNG được lưu trong DB — chúng được tính lại ở đây và chỉ
 * tồn tại trong response trả cho client.
 */
export function populateOrderTotals(order: any, items: any[]): void {
  const calculatedSubtotal = items.reduce((sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
  order.itemsSubtotal = calculatedSubtotal;

  let voucherDiscount = 0;
  if (order.voucherId && typeof order.voucherId === 'object') {
    const v = order.voucherId;
    if (v.type === 'percentage') {
      voucherDiscount = Math.min(calculatedSubtotal * ((v.value || 0) / 100), v.maxDiscount || Infinity);
    } else if (v.type === 'fixed') {
      voucherDiscount = v.value || 0;
    }
    if (!order.voucherCode && v.code) order.voucherCode = v.code;
  }
  order.voucherDiscount = voucherDiscount;

  // total_amount là số tiền server đã chốt lúc tạo đơn (đã trừ cả voucher freeship)
  // → chỉ suy diễn khi thiếu, không tính đè lên giá trị đã lưu.
  if (order.totalAmount === undefined || order.totalAmount === null) {
    order.totalAmount = Math.max(0, calculatedSubtotal + (order.shippingFee || 0) - voucherDiscount);
  }
}

/**
 * Giữ tương thích response cũ: bảng orders lưu địa chỉ phẳng (receive_name,
 * phone, address, note) nhưng client hiện có đọc `order.shippingInfo`.
 * Chỉ sinh object khi serialize — DB vẫn đúng 18 cột theo ERD.
 */
export function attachShippingInfo(order: any): void {
  if (!order) return;
  order.shippingInfo = {
    customerName: order.receiveName || '',
    customerPhone: order.phone || '',
    customerAddress: order.address || '',
    note: order.note || '',
  };
}

/**
 * Lấy mã phương thức thanh toán từ relation đã populate.
 * Order không còn lưu mã phương thức dạng string; nguồn chuẩn là paymentMethodId.
 */
export function getOrderPaymentMethodCode(order: any): string {
  const method = order?.paymentMethodId;
  return method && typeof method === 'object' && typeof method.code === 'string'
    ? method.code
    : '';
}

export async function getPaymentMethodIdByCode(code: string): Promise<any | undefined> {
  const method = await PaymentMethod.findOne({ code }).select('_id').lean();
  return method?._id;
}

/**
 * Đơn này đã từng được tính vào soldCount chưa?
 *
 * - COD: cộng ngay lúc tạo đơn.
 * - Online (VNPay): cộng khi `payment_status` chuyển unpaid → paid.
 * - Đơn đã được admin xác nhận (processing/shipped/delivered) cũng coi là đã bán.
 *
 * Dùng ĐỐI XỨNG cho cả lúc cộng và lúc trừ nên hai chiều không thể lệch nhau.
 */
export function isSoldCountEligible(order: any): boolean {
  if (!order) return false;
  return getOrderPaymentMethodCode(order) === 'cod'
    || order.paymentStatus === 'paid'
    || ['processing', 'shipped', 'delivered'].includes(order.status);
}

/**
 * Tăng/giảm soldCount của sản phẩm theo các item của đơn hàng.
 * delta = 1 khi đơn được tính là đã bán, delta = -1 khi đơn bị hủy.
 */
export async function adjustTotalSold(items: any[], delta: number): Promise<void> {
  if (!items || items.length === 0) return;
  await Promise.all(
    items.map((i: any) => {
      const variant = i.productVariantId;
      const productFromVariant = variant && typeof variant === 'object'
        ? variant.productId
        : null;
      const productValue = i.productId || (productFromVariant && typeof productFromVariant === 'object'
        ? productFromVariant._id
        : productFromVariant);
      const productId = productValue?.toString ? productValue.toString() : String(productValue || '');
      if (!mongoose.Types.ObjectId.isValid(productId)) return Promise.resolve();
      return Product.updateOne(
        { _id: new mongoose.Types.ObjectId(productId) },
        { $inc: { soldCount: delta * (i.quantity || 1) } }
      );
    })
  );

  // Xóa cache Redis của Top Trending và Homepage để cập nhật bảng xếp hạng tức thì (Real-time)
  try {
    const { redis } = await import('../../config/redis.ts');
    const trendingKeys = await redis.keys('products:trending:*');
    const homepageKeys = await redis.keys('homepage:*');
    const allKeys = [...trendingKeys, ...homepageKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
  } catch {
    /* Redis optional */
  }
}

async function addSoldForOrder(orderId: any): Promise<void> {
  const { OrderItem } = await import('../../models/OrderItem.ts');
  const items = await OrderItem.find({ orderId })
    .populate('productVariantId', 'productId')
    .lean();
  await adjustTotalSold(items, 1);
}

async function subtractSoldForOrder(orderId: any): Promise<void> {
  const { OrderItem } = await import('../../models/OrderItem.ts');
  const items = await OrderItem.find({ orderId })
    .populate('productVariantId', 'productId')
    .lean();
  await adjustTotalSold(items, -1);
}

/**
 * Đơn đã trả tiền thật thì KHÔNG được phép hủy bằng nút hủy thông thường: hệ thống chưa
 * có luồng hoàn tiền (paymentStatus 'refunded' không nơi nào ghi), nên hủy = khách mất
 * tiền mà không còn dấu vết nào trong DB để đối soát. Chỉ xảy ra với VNPay — đơn COD tạo
 * ra ở 'unpaid' và chỉ 'paid' lúc delivered (lúc đó đã không hủy được nữa).
 */
export function paidOrderCancelBlockMessage(order: any): string | null {
  if (!order || order.paymentStatus !== 'paid') return null;
  return 'Đơn hàng đã được thanh toán, không thể tự hủy. Vui lòng liên hệ hỗ trợ để được hoàn tiền.';
}

/**
 * Chốt đơn đã thanh toán + cộng lượt bán, đúng MỘT lần.
 *
 * CAS `payment_status: unpaid → paid` (findOneAndUpdate có điều kiện) nên IPN,
 * return và thanh toán lại dù chạy song song cũng chỉ một luồng thắng; luồng thua
 * không cộng thêm soldCount. Trước đây việc này dựa vào cột `orders.sold_counted`,
 * cột đó đã bị bỏ theo ERD mới.
 */
export async function markOrderPaid(
  orderId: any,
  payment: { txnRef?: string; transactionCode?: string; bankCode?: string } = {}
): Promise<boolean> {
  const { Order } = await import('../../models/Order.ts');
  const pre = await Order.findById(orderId)
    .populate('paymentMethodId', 'code')
    .select('paymentMethodId paymentStatus status')
    .lean();
  if (!pre) return false;

  const $set: any = { paymentStatus: 'paid', paidAt: new Date() };
  if (payment.txnRef) $set.paymentTxnRef = payment.txnRef;
  if (payment.transactionCode) $set.paymentTransactionCode = payment.transactionCode;
  if (payment.bankCode) $set.bankCode = payment.bankCode;

  const order = await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: { $ne: 'paid' }, status: { $ne: 'cancelled' } },
    { $set },
    { new: true }
  );

  if (!order) {
    // Đơn đã bị hủy trước khi tiền về (IPN trễ / khách thanh toán sau khi đơn auto-hủy):
    // KHÔNG chốt paid, KHÔNG cộng lượt bán — tiền phải xử lý hoàn bằng tay bởi admin.
    if (pre.status === 'cancelled') return false;

    // Đã paid từ trước: chỉ bù các mã giao dịch còn thiếu, KHÔNG cộng lượt bán lần hai.
    const fill: any = {};
    if (payment.transactionCode) fill.paymentTransactionCode = payment.transactionCode;
    if (payment.bankCode) fill.bankCode = payment.bankCode;
    if (Object.keys(fill).length > 0) {
      await Order.updateOne({ _id: orderId }, { $set: fill });
    }
    return false;
  }

  if (!isSoldCountEligible(pre)) {
    await addSoldForOrder(orderId);
  }
  return true;
}

/**
 * Admin xác nhận đơn (pending → processing): cộng lượt bán nếu đơn CHƯA được tính
 * trước đó — đơn COD đã cộng lúc tạo, đơn online đã cộng lúc thanh toán.
 * `preOrder` là đơn đọc TRƯỚC khi đổi trạng thái (xem updateOrderStatus).
 */
export async function countSoldOnConfirm(orderId: any, preOrder: any): Promise<boolean> {
  if (isSoldCountEligible(preOrder)) return false;
  await addSoldForOrder(orderId);
  return true;
}

/**
 * Hủy đơn theo CAS + hoàn tài nguyên đúng MỘT lần.
 *
 * Trước đây chống hoàn kép bằng 2 cờ trên orders (`sold_counted`,
 * `resources_restored`); ERD mới không có 2 cột đó nên dùng CAS
 * `status → cancelled`: chỉ luồng khớp điều kiện update mới hoàn kho, hoàn voucher
 * và trừ lượt bán. Request thứ hai (double-click, retry, cron trùng) nhận `null`.
 *
 * @param options.filter điều kiện bổ sung cho CAS (ví dụ `{ status: 'pending' }`).
 * @returns đơn sau khi hủy, hoặc `null` nếu đơn không tồn tại / đã bị hủy trước đó.
 */
export async function cancelOrderWithRestore(
  orderId: any,
  options: { filter?: any } = {}
): Promise<any | null> {
  const { Order } = await import('../../models/Order.ts');
  const pre = await Order.findById(orderId)
    .populate('paymentMethodId', 'code')
    .lean();
  if (!pre) return null;
  if (pre.status === 'cancelled') {
    // Cho phép retry việc hoàn xu nếu lần hủy trước đã lỗi sau khi đã đổi status.
    const { RewardService } = await import('../../services/RewardService.ts');
    await RewardService.refundForOrder(pre._id);
    return pre;
  }

  const order = await Order.findOneAndUpdate(
    { _id: pre._id, status: { $ne: 'cancelled' }, ...(options.filter || {}) },
    { $set: { status: 'cancelled' } },
    { new: true }
  ).lean();
  if (!order) return null;

  // Phiên VNPay còn chờ của đơn này không còn nghĩa gì: đánh dấu expired để IPN trễ
  // không còn đường chốt tiền cho đơn đã hủy. markOrderPaid đã tự chặn cancelled,
  // nên bước này chỉ để dữ liệu đúng nghĩa — hỏng cũng không được làm hỏng việc hủy đơn.
  void import('../../models/PendingPayment.ts')
    .then(({ PendingPayment }) =>
      PendingPayment.updateMany({ orderId: pre._id, status: 'pending' }, { $set: { status: 'expired' } })
    )
    .catch(() => {});

  const restoreTasks: Promise<unknown>[] = [];
  if (isSoldCountEligible(pre)) restoreTasks.push(subtractSoldForOrder(pre._id));

  const { StockService } = await import('../../services/cart/StockService.ts');
  const { RewardService } = await import('../../services/RewardService.ts');
  restoreTasks.push(StockService.restoreOrderResources(pre._id));
  restoreTasks.push(RewardService.refundForOrder(pre._id));

  // Các nguồn hoàn độc lập: cố gắng hoàn tất cả ba, rồi mới báo lỗi nếu có.
  // Nhờ vậy lỗi voucher/flash-sale không làm mất xu hoặc tồn kho.
  const restoreResults = await Promise.allSettled(restoreTasks);
  const restoreError = restoreResults.find((result) => result.status === 'rejected');
  if (restoreError && restoreError.status === 'rejected') throw restoreError.reason;

  return order;
}

/**
 * Tự động hủy các đơn hàng VNPay chưa thanh toán quá 15 phút.
 * Hoàn kho/voucher đi qua cancelOrderWithRestore nên chạy song song cũng không hoàn kép.
 */
export async function autoCancelExpiredVNPayOrders(userId?: string): Promise<void> {
  const { Order } = await import('../../models/Order.ts');
  const vnpayMethodId = await getPaymentMethodIdByCode('vnpay');
  if (!vnpayMethodId) return;

  const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
  const query: any = {
    paymentMethodId: vnpayMethodId,
    paymentStatus: 'unpaid',
    status: 'pending',
    createdAt: { $lt: fifteenMinsAgo },
  };
  if (userId) {
    query.userId = new mongoose.Types.ObjectId(userId);
  }

  const expired = await Order.find(query).select('_id').lean();
  for (const o of expired) {
    await cancelOrderWithRestore(o._id, {
      filter: { paymentMethodId: vnpayMethodId, paymentStatus: 'unpaid', status: 'pending' },
    });
  }
}
