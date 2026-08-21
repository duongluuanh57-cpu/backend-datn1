import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/database.ts';
import { User } from '../models/User.ts';
import { UserAddress } from '../models/UserAddress.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { Order, type IShippingInfo } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Payment } from '../models/Payment.ts';
import { ShippingMethod } from '../models/ShippingMethod.ts';
import { Review, type IReviewAspect } from '../models/Review.ts';
import { DailySummaryReport } from '../models/DailySummaryReport.ts';
import { redis } from '../config/redis.ts';

const SAMPLE_ADDRESSES = [
  { province: 'Hồ Chí Minh', district: 'Quận 1', ward: 'Phường Bến Nghé', address: '12 Lê Duẩn', lat: 10.7812, lng: 106.6991 },
  { province: 'Hồ Chí Minh', district: 'Quận 3', ward: 'Phường Võ Thị Sáu', address: '234 Nam Kỳ Khởi Nghĩa', lat: 10.7891, lng: 106.6872 },
  { province: 'Hồ Chí Minh', district: 'Quận 7', ward: 'Phường Tân Phong', address: '101 Tôn Dật Tiên', lat: 10.7291, lng: 106.7218 },
  { province: 'Hà Nội', district: 'Quận Hoàn Kiếm', ward: 'Phường Hàng Bạc', address: '45 Đinh Tiên Hoàng', lat: 21.0313, lng: 105.8524 },
  { province: 'Hà Nội', district: 'Quận Cầu Giấy', ward: 'Phường Dịch Vọng Hậu', address: '88 Duy Tân', lat: 21.0318, lng: 105.7831 },
  { province: 'Đà Nẵng', district: 'Quận Hải Châu', ward: 'Phường Thạch Thang', address: '15 Trần Phú', lat: 16.0748, lng: 108.2235 },
  { province: 'Cần Thơ', district: 'Quận Ninh Kiều', ward: 'Phường Tân An', address: '30 Hai Bà Trưng', lat: 10.0334, lng: 105.7871 },
  { province: 'Hải Phòng', district: 'Quận Hồng Bàng', ward: 'Phường Minh Khai', address: '50 Điện Biên Phủ', lat: 20.8621, lng: 106.6823 },
  { province: 'Bình Dương', district: 'TP. Thủ Dầu Một', ward: 'Phường Phú Hòa', address: '68 Đại Lộ Bình Dương', lat: 10.9804, lng: 106.6743 },
  { province: 'Đồng Nai', district: 'TP. Biên Hòa', ward: 'Phường Quyết Thắng', address: '12 Cách Mạng Tháng Tám', lat: 10.9492, lng: 106.8219 },
];

const REVIEW_COMMENTS = [
  // 5 sao - Hợp lệ
  {
    overall: 'Mùi hương rất sang trọng và quyến rũ, đóng gói cẩn thận 10/10!',
    quality: 'Chất lượng tuyệt vời, chai xịt đều và sương mịn.',
    longevity: 'Lưu hương được khoảng 7-8 tiếng trên da, trên áo thì cả ngày.',
    scent: 'Tông mùi thanh mát lúc đầu, sau đó trầm ấm rất cuốn hút.',
    packaging: 'Hộp cứng cáp, seal đầy đủ nguyên vẹn.',
    value: 'Xứng đáng với giá tiền bỏ ra.',
    rating: 5,
    isAppropriate: true,
  },
  {
    overall: 'Giao hàng nhanh, mùi hương chuẩn chính hãng. Sẽ tiếp tục ủng hộ shop.',
    quality: 'Nước hoa chính hãng, đúng mô tả.',
    longevity: 'Độ bám tỏa khá tốt trong phòng máy lạnh.',
    scent: 'Mùi hương tinh tế, không bị nồng gắt.',
    packaging: 'Bọc bóng khí nhiều lớp, chống sốc tốt.',
    value: 'Giá mềm hơn so với mua tại store trực tiếp.',
    rating: 5,
    isAppropriate: true,
  },
  // 4 sao - Hợp lệ
  {
    overall: 'Sản phẩm dùng khá ổn, mùi dịu nhẹ phù hợp dùng hàng ngày đi làm.',
    quality: 'Hàng tốt, vòi xịt êm.',
    longevity: 'Bám mùi tầm 5-6 tiếng.',
    scent: 'Mùi nịnh mũi, thơm nhẹ nhàng.',
    packaging: 'Đóng gói đẹp mắt, có kèm thư cảm ơn.',
    value: 'Mức giá hợp lý cho dòng sản phẩm này.',
    rating: 4,
    isAppropriate: true,
  },
  {
    overall: 'Tạm ổn, mùi hương hơi ngọt so với sở thích của mình một chút.',
    quality: 'Chất lượng đảm bảo, không gây kích ứng.',
    longevity: 'Lưu hương vừa phải tầm 4 tiếng.',
    scent: 'Hơi ngọt ở nốt giữa, hậu vị êm.',
    packaging: 'Hộp hơi móp nhẹ góc do vận chuyển nhưng chai bên trong an toàn.',
    value: 'Giá cả chấp nhận được.',
    rating: 4,
    isAppropriate: true,
  },
  // 3 sao - Hợp lệ
  {
    overall: 'Mùi hương bình thường, không quá đặc sắc như quảng cáo, độ tỏa hương hơi yếu.',
    quality: 'Chất lượng ở mức trung bình.',
    longevity: 'Chỉ lưu hương được tầm 2-3 tiếng là bay hết.',
    scent: 'Mùi không giống kỳ vọng ban đầu.',
    packaging: 'Đóng gói đơn giản, không có quà tặng kèm.',
    value: 'Hơi đắt so với trải nghiệm thực tế.',
    rating: 3,
    isAppropriate: true,
  },
  // 2 sao - Hợp lệ (phàn nàn dịch vụ/hàng)
  {
    overall: 'Giao hàng quá chậm, vòi xịt bị rỉ nước hoa ra ngoài nắp chai.',
    quality: 'Vòi xịt bị lỏng, rò rỉ dung dịch.',
    longevity: 'Mùi bay rất nhanh, chỉ 1-2 tiếng.',
    scent: 'Mùi hương bị nồng cồn lúc đầu.',
    packaging: 'Hộp bị ướt một góc do rò rỉ nước hoa.',
    value: 'Chưa hài lòng với số tiền bỏ ra.',
    rating: 2,
    isAppropriate: true,
  },
  // 1 sao - Hợp lệ (thất vọng)
  {
    overall: 'Rất thất vọng, mùi nồng gắt gây nhức đầu và giữ mùi cực kỳ kém.',
    quality: 'Chất lượng kém, không đạt chuẩn.',
    longevity: 'Bay mùi sau 30 phút.',
    scent: 'Mùi hắc nồng mùi cồn công nghiệp.',
    packaging: 'Hộp rách, móp méo.',
    value: 'Quá phí tiền.',
    rating: 1,
    isAppropriate: true,
  },
  // Đánh giá 1 sao - BỊ AI TỪ CHỐI / ẨN (Nghi vấn lừa đảo / Xúc phạm người bán, không quá tục)
  {
    overall: 'Shop làm ăn như lừa đảo, bán hàng fake dỏm mà dám bảo chính hãng, tẩy chay shop này đi mọi người ơi!',
    quality: 'Hàng fake giả nhái trắng trợn.',
    longevity: 'Toàn mùi cồn rửa tay, 5 phút là hết.',
    scent: 'Mùi hóa chất độc hại.',
    packaging: 'Vỏ chai in mờ căm dỏm tệ hại.',
    value: 'Lừa tiền khách hàng, quá thất đức.',
    rating: 1,
    isAppropriate: false,
    reason: 'Đánh giá mang tính quy chụp, công kích người bán và vu khống hàng giả chưa kiểm chứng.',
    category: 'offensive' as const,
  },
  // Đánh giá 2 sao - BỊ AI TỪ CHỐI / ẨN (Spam quảng cáo link ngoài)
  {
    overall: 'Nước hoa này mua bên shop khác rẻ hơn nhiều, ghé qua shop Zalo 0988xxx để lấy giá sỉ giảm 50% nhé.',
    quality: 'Bình thường.',
    longevity: 'Tạm được.',
    scent: 'Không có gì mới.',
    packaging: 'Ổn.',
    value: 'Bên ngoài bán rẻ hơn gấp đôi.',
    rating: 2,
    isAppropriate: false,
    reason: 'Bình luận chứa nội dung quảng cáo rác, lôi kéo khách hàng sang kênh khác.',
    category: 'spam' as const,
  },
  // Đánh giá 3 sao - BỊ AI TỪ CHỐI / ẨN (Ngôn từ cay cú, miệt thị dịch vụ)
  {
    overall: 'Nhân viên tư vấn thái độ lồi lõm, coi thường khách hàng, làm ăn vô học vừa thôi!',
    quality: 'Hàng tạm được nhưng thái độ phục vụ như rác rưởi.',
    longevity: '3 tiếng.',
    scent: 'Ổn.',
    packaging: 'Bình thường.',
    value: 'Mất tiền mua bực vào người.',
    rating: 3,
    isAppropriate: false,
    reason: 'Chứa ngôn từ xúc phạm cá nhân và miệt thị nhân viên.',
    category: 'offensive' as const,
  },
  // Đánh giá 5 sao - BỊ AI TỪ CHỐI / ẨN (Spam seeding lộ liễu / link cờ bạc cá cược)
  {
    overall: 'Nước hoa thơm xịt đi chơi bài thắng lớn, anh em vào link nhacai88.vip kiếm tiền triệu mỗi ngày nhé!',
    quality: 'Tốt.',
    longevity: 'Lâu.',
    scent: 'Thơm.',
    packaging: 'Đẹp.',
    value: 'Tuyệt.',
    rating: 5,
    isAppropriate: false,
    reason: 'Bình luận spam quảng cáo cờ bạc, nội dung không liên quan đến trải nghiệm sản phẩm.',
    category: 'spam' as const,
  },
];

function getRandomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getMemberTier(spent: number): 'MEMBER' | 'Bac' | 'Vang' | 'KimCuong' {
  if (spent >= 10000000) return 'KimCuong';
  if (spent >= 5000000) return 'Vang';
  if (spent >= 2000000) return 'Bac';
  return 'MEMBER';
}

async function runSeed() {
  console.log('🚀 Bắt đầu quá trình seed 100 đơn hàng...');
  await connectDB();

  // 1. Lấy danh sách Users (loại trừ ADMIN)
  const users = await User.find({ role: { $ne: 'ADMIN' }, status: 'active' });
  if (!users || users.length === 0) {
    throw new Error('❌ Không tìm thấy user nào khả dụng (role !== ADMIN) để tạo đơn hàng!');
  }
  console.log(`👤 Tìm thấy ${users.length} người dùng khả dụng.`);

  // 2. Lấy sản phẩm và biến thể
  const products = await Product.find({ status: 'active' }).populate('brandId');
  if (!products || products.length === 0) {
    throw new Error('❌ Không tìm thấy sản phẩm active nào!');
  }
  const variants = await ProductVariant.find({});
  if (!variants || variants.length === 0) {
    throw new Error('❌ Không tìm thấy biến thể sản phẩm (ProductVariant) nào!');
  }

  // Gom variants theo productId
  const variantsByProductId = new Map<string, typeof variants>();
  for (const v of variants) {
    const pid = v.productId.toString();
    if (!variantsByProductId.has(pid)) {
      variantsByProductId.set(pid, []);
    }
    variantsByProductId.get(pid)!.push(v);
  }

  // 3. Lấy phương thức vận chuyển
  const shippingMethods = await ShippingMethod.find({ isActive: true });
  const defaultShippingMethod = shippingMethods.length > 0 ? shippingMethods[0] : null;

  // 4. Lấy địa chỉ của các User
  const userAddresses = await UserAddress.find({});
  const addressByUserId = new Map<string, typeof userAddresses[0]>();
  for (const addr of userAddresses) {
    if (addr.isDefault || !addressByUserId.has(addr.userId.toString())) {
      addressByUserId.set(addr.userId.toString(), addr);
    }
  }

  // 5. Chuẩn bị phân bổ 100 trạng thái đơn
  // 65 delivered, 15 shipped, 10 processing, 5 pending, 5 cancelled
  const statuses: ('delivered' | 'shipped' | 'processing' | 'pending' | 'cancelled')[] = [
    ...Array(65).fill('delivered'),
    ...Array(15).fill('shipped'),
    ...Array(10).fill('processing'),
    ...Array(5).fill('pending'),
    ...Array(5).fill('cancelled'),
  ];
  // Xáo trộn ngẫu nhiên thứ tự tạo
  statuses.sort(() => Math.random() - 0.5);

  const paymentMethods: ('cod' | 'vnpay' | 'momo' | 'banking')[] = ['cod', 'vnpay', 'momo', 'banking'];
  const cancelReasons: ('changed_mind' | 'found_cheaper' | 'want_change_voucher' | 'want_change_product' | 'complicated_payment')[] = [
    'changed_mind', 'found_cheaper', 'want_change_voucher', 'want_change_product', 'complicated_payment'
  ];

  // Theo dõi cập nhật tồn kho, lượt bán, chi tiêu user
  const variantStockDelta = new Map<string, number>(); // variantId -> số lượng trừ
  const productSoldDelta = new Map<string, number>();  // productId -> số lượng cộng
  const userSpentDelta = new Map<string, number>();    // userId -> số tiền cộng

  // Danh sách review cần tạo
  const existingReviews = await Review.find({}, 'userId productId').lean();
  const reviewedSet = new Set<string>();
  for (const r of existingReviews) {
    reviewedSet.add(`${r.userId.toString()}_${r.productId.toString()}`);
  }

  const newReviewsToInsert: any[] = [];
  const createdOrders: any[] = [];

  const now = new Date();

  console.log('📦 Đang khởi tạo 100 đơn hàng...');

  for (let i = 0; i < 100; i++) {
    const status = statuses[i];
    const user = getRandomItem(users);
    const userIdStr = user._id.toString();

    // Phân bổ thời gian: 15 đơn hôm nay (0), 10 đơn hôm qua (1), 75 đơn rải rác 2-30 ngày trước
    let daysAgo = 0;
    if (i < 15) {
      daysAgo = 0; // Hôm nay
    } else if (i < 25) {
      daysAgo = 1; // Hôm qua
    } else {
      daysAgo = getRandomInt(2, 30); // 2 - 30 ngày trước
    }

    const createdAt = daysAgo === 0
      ? new Date(now.getTime() - getRandomInt(1, 10) * 3600 * 1000) // Vài tiếng trước trong ngày hôm nay
      : new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - getRandomInt(0, 86400) * 1000);
    
    let deliveredAt: Date | undefined = undefined;
    let cancelledAt: Date | undefined = undefined;
    let paymentStatus: 'unpaid' | 'paid' | 'refunded' = 'unpaid';
    const payMethod = getRandomItem(paymentMethods);

    if (status === 'delivered') {
      paymentStatus = 'paid';
      deliveredAt = new Date(createdAt.getTime() + getRandomInt(2, 4) * 24 * 60 * 60 * 1000);
      if (deliveredAt > now) deliveredAt = new Date(now.getTime() - 1000 * 60 * 60);
    } else if (status === 'shipped') {
      paymentStatus = payMethod === 'cod' ? 'unpaid' : 'paid';
    } else if (status === 'processing') {
      paymentStatus = payMethod === 'cod' ? 'unpaid' : 'paid';
    } else if (status === 'pending') {
      paymentStatus = 'unpaid';
    } else if (status === 'cancelled') {
      paymentStatus = payMethod === 'cod' ? 'unpaid' : 'refunded';
      cancelledAt = new Date(createdAt.getTime() + getRandomInt(2, 24) * 60 * 60 * 1000);
    }

    // Địa chỉ giao hàng
    const userAddr = addressByUserId.get(userIdStr);
    const fallbackAddr = getRandomItem(SAMPLE_ADDRESSES);
    const shippingInfo: IShippingInfo = {
      customerName: userAddr?.fullName || user.fullName || user.username,
      customerPhone: userAddr?.phoneNumber || user.phoneNumber || `09${getRandomInt(10000000, 99999999)}`,
      customerAddress: userAddr ? `${userAddr.address}, ${userAddr.ward}, ${userAddr.district}, ${userAddr.province}` : `${fallbackAddr.address}, ${fallbackAddr.ward}, ${fallbackAddr.district}, ${fallbackAddr.province}`,
      customerEmail: user.email,
      latitude: userAddr?.latitude || fallbackAddr.lat,
      longitude: userAddr?.longitude || fallbackAddr.lng,
      note: status === 'cancelled' ? 'Hủy đơn do đổi ý' : (Math.random() > 0.6 ? 'Giao giờ hành chính giúp em ạ' : ''),
    };

    // Chọn từ 1 - 3 sản phẩm cho mỗi đơn hàng
    const numItems = getRandomInt(1, 3);
    const selectedProducts: typeof products = [];
    for (let k = 0; k < numItems; k++) {
      const p = getRandomItem(products);
      if (!selectedProducts.some((sp) => sp._id.toString() === p._id.toString())) {
        selectedProducts.push(p);
      }
    }

    let itemsSubtotal = 0;
    const orderItemsData: any[] = [];
    const isSold = status !== 'cancelled';

    for (const prod of selectedProducts) {
      const pidStr = prod._id.toString();
      const pVariants = variantsByProductId.get(pidStr) || [];
      const chosenVariant = pVariants.length > 0 ? getRandomItem(pVariants) : null;
      
      const qty = getRandomInt(1, 2);
      const price = chosenVariant ? chosenVariant.price : 1500000;
      const discount = prod.discountPercentage || 0;
      const finalPrice = Math.round(price * (1 - discount / 100));

      itemsSubtotal += finalPrice * qty;

      orderItemsData.push({
        productId: prod._id,
        name: prod.name,
        brand: (prod.brandId as any)?.name || 'L\'Essence',
        quantity: qty,
        price: finalPrice,
        discount: discount,
        image: prod.image || '',
        variantSize: chosenVariant ? chosenVariant.size : '50ml',
        chosenVariantId: chosenVariant?._id.toString(),
      });

      if (isSold && chosenVariant) {
        const vid = chosenVariant._id.toString();
        variantStockDelta.set(vid, (variantStockDelta.get(vid) || 0) + qty);
        productSoldDelta.set(pidStr, (productSoldDelta.get(pidStr) || 0) + qty);
      }
    }

    const shippingFee = itemsSubtotal > 1500000 ? 0 : 30000;
    const voucherDiscount = Math.random() > 0.7 ? 50000 : 0;
    const totalAmount = Math.max(0, itemsSubtotal + shippingFee - voucherDiscount);

    // Tạo Order Record
    const orderDoc = new Order({
      userId: user._id,
      shippingInfo,
      itemsSubtotal,
      totalAmount,
      shippingMethodId: defaultShippingMethod?._id,
      shippingFee,
      voucherDiscount,
      voucherCode: voucherDiscount > 0 ? 'SUMMER50K' : null,
      trackingNumber: ['shipped', 'delivered'].includes(status) ? `VNPOST${getRandomInt(10000000, 99999999)}` : '',
      status,
      paymentMethod: payMethod,
      paymentStatus,
      soldCounted: isSold,
      cancelRequested: status === 'cancelled',
      cancelReason: status === 'cancelled' ? getRandomItem(cancelReasons) : undefined,
      deliveredAt,
      cancelledAt,
      createdAt,
      updatedAt: deliveredAt || cancelledAt || createdAt,
    });

    await orderDoc.save();
    createdOrders.push(orderDoc);

    // Tạo Order Items
    for (const itemData of orderItemsData) {
      const orderItemDoc = await OrderItem.create({
        orderId: orderDoc._id,
        productId: itemData.productId,
        name: itemData.name,
        brand: itemData.brand,
        quantity: itemData.quantity,
        price: itemData.price,
        discount: itemData.discount,
        image: itemData.image,
        variantSize: itemData.variantSize,
        createdAt,
        updatedAt: createdAt,
      });

      // Tạo Review nếu đơn delivered và chưa review
      if (status === 'delivered') {
        const pairKey = `${userIdStr}_${itemData.productId.toString()}`;
        if (!reviewedSet.has(pairKey) && Math.random() < 0.45) {
          reviewedSet.add(pairKey);
          const sampleRev = getRandomItem(REVIEW_COMMENTS);
          const aspects: IReviewAspect[] = [
            { name: 'quality', rating: sampleRev.rating, comment: sampleRev.quality },
            { name: 'longevity', rating: sampleRev.rating, comment: sampleRev.longevity },
            { name: 'scent', rating: sampleRev.rating, comment: sampleRev.scent },
            { name: 'packaging', rating: sampleRev.rating, comment: sampleRev.packaging },
            { name: 'value', rating: sampleRev.rating, comment: sampleRev.value },
          ];

          const reviewDate = new Date(deliveredAt!.getTime() + getRandomInt(1, 3) * 24 * 60 * 60 * 1000);

          const isAppropriate = sampleRev.isAppropriate ?? true;
          const reviewStatus = isAppropriate ? 'visible' : 'rejected';
          const rejectionReason = !isAppropriate ? (sampleRev as any).reason : '';
          const category = !isAppropriate ? (sampleRev as any).category : 'none';
          const aiRejected = ['profanity', 'offensive', 'hate'].includes(category);

          newReviewsToInsert.push({
            userId: user._id,
            productId: itemData.productId,
            orderItemId: orderItemDoc._id,
            rating: sampleRev.rating,
            comment: sampleRev.overall,
            aspects,
            images: [],
            isAnonymous: Math.random() > 0.8,
            status: reviewStatus,
            rejectionReason,
            aiRejected,
            moderatedBy: 'AI',
            moderatedByType: 'ai',
            createdAt: reviewDate > now ? now : reviewDate,
            updatedAt: reviewDate > now ? now : reviewDate,
          });
        }
      }
    }

    // Tạo Payment record tương ứng
    await Payment.create({
      orderId: orderDoc._id,
      method: payMethod,
      status: paymentStatus === 'paid' ? 'paid' : (paymentStatus === 'refunded' ? 'refunded' : 'pending'),
      transactionCode: `TXN${getRandomInt(100000000, 999999999)}`,
      txnRef: `ORDER_${orderDoc._id}`,
      paidAt: paymentStatus === 'paid' ? (deliveredAt || createdAt) : undefined,
      refundedAt: paymentStatus === 'refunded' ? cancelledAt : undefined,
      createdAt,
      updatedAt: deliveredAt || cancelledAt || createdAt,
    });

    // Cộng dồn tổng chi tiêu user nếu delivered
    if (status === 'delivered') {
      userSpentDelta.set(userIdStr, (userSpentDelta.get(userIdStr) || 0) + totalAmount);
    }
  }

  console.log(`✅ Đã tạo thành công 100 đơn hàng.`);

  // 6. Chèn Reviews
  if (newReviewsToInsert.length > 0) {
    console.log(`⭐ Đang thêm ${newReviewsToInsert.length} đánh giá (Reviews)...`);
    await Review.insertMany(newReviewsToInsert);
  }

  // 7. Cập nhật số lượng tồn kho (ProductVariant) & soldCount (Product)
  console.log('🔄 Đang đồng bộ số lượng tồn kho và lượt bán sản phẩm...');
  for (const [variantId, qty] of variantStockDelta.entries()) {
    const v = await ProductVariant.findById(variantId);
    if (v) {
      const newStock = Math.max(10, v.quantityInStock - qty); // Đảm bảo không âm kho, tối thiểu còn 10
      await ProductVariant.findByIdAndUpdate(variantId, { $set: { quantityInStock: newStock } });
    }
  }

  for (const [productId, qty] of productSoldDelta.entries()) {
    await Product.findByIdAndUpdate(productId, { $inc: { soldCount: qty } });
  }

  // 8. Cập nhật Rating & ReviewsCount trên Product
  console.log('⭐ Đang tính toán lại avgRating & reviewsCount cho sản phẩm...');
  const allProductIds = products.map((p) => p._id);
  for (const pid of allProductIds) {
    const revs = await Review.find({ productId: pid, status: 'visible' }).lean();
    if (revs.length > 0) {
      let totalRating = 0;
      let count = 0;
      for (const r of revs) {
        if (r.aspects && r.aspects.length > 0) {
          for (const a of r.aspects) {
            totalRating += a.rating;
            count++;
          }
        } else {
          totalRating += r.rating;
          count++;
        }
      }
      const avg = count > 0 ? Math.round((totalRating / count) * 10) / 10 : 5;
      await Product.findByIdAndUpdate(pid, {
        $set: { reviewsCount: revs.length, avgRating: avg }
      });
    }
  }

  // 9. Cập nhật chi tiêu & MemberTier cho Users
  console.log('👥 Đang cập nhật totalSpent & rank cho người dùng...');
  for (const user of users) {
    const uidStr = user._id.toString();
    const spentToAdd = userSpentDelta.get(uidStr) || 0;
    if (spentToAdd > 0) {
      const newTotalSpent = (user.totalSpent || 0) + spentToAdd;
      const newTier = getMemberTier(newTotalSpent);
      await User.findByIdAndUpdate(user._id, {
        $set: { totalSpent: newTotalSpent, memberTier: newTier }
      });
    }
  }

  // 10. Tổng hợp báo cáo doanh thu theo ngày (DailySummaryReport)
  console.log('📊 Đang cập nhật DailySummaryReport...');
  const allOrders = await Order.find({});
  const reportMap = new Map<string, { totalRevenue: number; totalOrders: number; completedOrders: number; cancelledOrders: number; cancelledRevenue: number; date: Date }>();

  for (const o of allOrders) {
    const d = new Date(o.createdAt);
    d.setHours(0, 0, 0, 0);
    const dKey = d.toISOString();

    if (!reportMap.has(dKey)) {
      reportMap.set(dKey, {
        date: d,
        totalRevenue: 0,
        totalOrders: 0,
        completedOrders: 0,
        cancelledOrders: 0,
        cancelledRevenue: 0,
      });
    }

    const rep = reportMap.get(dKey)!;
    rep.totalOrders++;
    if (o.status === 'delivered') {
      rep.completedOrders++;
      rep.totalRevenue += o.totalAmount;
    } else if (o.status === 'cancelled') {
      rep.cancelledOrders++;
      rep.cancelledRevenue += o.totalAmount;
    }
  }

  // 11. Cập nhật lượt truy cập hôm nay vào Redis (visitsToday) và dọn cache
  console.log('🌐 Đang cập nhật lượt truy cập hôm nay (visitsToday) vào Redis...');
  const dateStr = now.toISOString().split('T')[0];
  const sampleVisits = getRandomInt(1250, 2480);
  await redis.set(`visits:${dateStr}:default`, sampleVisits.toString());
  
  // Dọn dẹp cache dashboard & daily summary
  const summaryKeys = await redis.keys('*summary*');
  if (summaryKeys.length > 0) await redis.del(...summaryKeys);
  const kpiKeys = await redis.keys('*dashboard*');
  if (kpiKeys.length > 0) await redis.del(...kpiKeys);
  console.log(`🌐 Đã cập nhật ${sampleVisits} lượt xem hôm nay và xóa cache.`);

  console.log('🎉 TOÀN BỘ QUÁ TRÌNH SEED ĐÃ HOÀN TẤT THÀNH CÔNG VÀ TOÀN VẸN!');
  await redis.quit();
  process.exit(0);
}

runSeed().catch((err) => {
  console.error('❌ Lỗi trong quá trình seed:', err);
  process.exit(1);
});
