import 'dotenv/config';
import mongoose from 'mongoose';
import { Order } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Payment } from '../models/Payment.ts';
import { PaymentMethod } from '../models/PaymentMethod.ts';
import { Voucher } from '../models/Voucher.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { User } from '../models/User.ts';
import { Brand } from '../models/Brand.ts';

// ─── Constants ─────────────────────────────────────────────
const STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as const;
const PAYMENT_METHODS = ['cod', 'credit_card', 'momo', 'zalopay', 'vnpay'] as const;
const CANCEL_REASONS = ['want_change_voucher', 'want_change_product', 'complicated_payment', 'found_cheaper', 'changed_mind'] as const;

const PROVINCES = [
  'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
  'Biên Hòa', 'Nha Trang', 'Huế', 'Đà Lạt', 'Vũng Tàu',
];
const DISTRICTS: Record<string, string[]> = {
  'Hồ Chí Minh': ['Quận 1', 'Quận 3', 'Quận 7', 'Tân Bình', 'Bình Thạnh', 'Gò Vấp', 'Thủ Đức'],
  'Hà Nội': ['Ba Đình', 'Hoàn Kiếm', 'Cầu Giấy', 'Thanh Xuân', 'Hoàng Mai', 'Long Biên'],
  'Đà Nẵng': ['Hải Châu', 'Thanh Khê', 'Sơn Trà', 'Ngũ Hành Sơn'],
  'Hải Phòng': ['Hồng Bàng', 'Lê Chân', 'Ngô Quyền', 'Kiến An'],
  'Cần Thơ': ['Ninh Kiều', 'Bình Thủy', 'Cái Răng', 'Ô Môn'],
  'Biên Hòa': ['TP. Biên Hòa', 'Long Thành', 'Nhơn Trạch'],
  'Nha Trang': ['TP. Nha Trang', 'Ninh Hòa', 'Diên Khánh'],
  'Huế': ['TP. Huế', 'Hương Thủy', 'Hương Trà'],
  'Đà Lạt': ['TP. Đà Lạt', 'Bảo Lộc', 'Đức Trọng'],
  'Vũng Tàu': ['TP. Vũng Tàu', 'Bà Rịa', 'Phú Mỹ'],
};
const STREETS = [
  'Nguyễn Huệ', 'Lê Lợi', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Phạm Ngũ Lão',
  'Nguyễn Trãi', 'Lý Tự Trọng', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Võ Văn Tần',
  'Nguyễn Đình Chiểu', 'Pasteur', 'Tôn Đức Thắng', 'Lê Duẩn', 'Nguyễn Thị Minh Khai',
  'Trường Chinh', 'Hoàng Văn Thụ', 'Xô Viết Nghệ Tĩnh', 'Nam Kỳ Khởi Nghĩa', 'Phan Đình Phùng',
];
const WARDS = [
  'Phường 1', 'Phường 2', 'Phường 3', 'Phường 4', 'Phường 5',
  'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10',
  'Phường Bến Nghé', 'Phường Bến Thành', 'Phường Đa Kao', 'Phường Tân Định', 'Phường Cầu Kho',
];

// ─── Helpers ───────────────────────────────────────────────
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomDate(daysBack: number) {
  const now = Date.now();
  const past = now - daysBack * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}
function randomPhone() {
  const prefixes = ['090','091','092','093','094','096','097','098','099','032','033','034','035','036','037','038','039','070','076','077','078','079','081','082','083','084','085','086','087','088','089'];
  return randomPick(prefixes) + String(randomInt(1000000, 9999999));
}
function generateTxnRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) result += chars[randomInt(0, chars.length - 1)];
  return result;
}

// ─── Main seed function ────────────────────────────────────
async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not defined');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log(`Connected: ${mongoose.connection.host}\n`);

  // ── 1. Fetch existing data ──
  const products = await Product.find({ status: 'active' }).lean();
  if (!products.length) {
    console.error('❌ No active products found. Seed products first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`📦 Found ${products.length} active products`);

  const brandIds = [...new Set(products.map(p => p.brandId.toString()))];
  const brandDocs = await Brand.find({ _id: { $in: brandIds } }).lean();
  const brandNameMap = new Map(brandDocs.map(b => [b._id.toString(), b.name]));

  const allVariants = await ProductVariant.find({ productId: { $in: products.map(p => p._id) } }).lean();
  const variantMap = new Map<string, typeof allVariants>();
  for (const v of allVariants) {
    const pid = v.productId.toString();
    if (!variantMap.has(pid)) variantMap.set(pid, []);
    variantMap.get(pid)!.push(v);
  }
  console.log(`📦 Found ${allVariants.length} variants`);

  const users = await User.find({}).lean();
  console.log(`👤 Found ${users.length} users`);

  const vouchers = await Voucher.find({ status: 'active' }).lean();
  console.log(`🎫 Found ${vouchers.length} active vouchers`);

  const paymentMethods = await PaymentMethod.find({ isActive: true }).lean();
  console.log(`💳 Found ${paymentMethods.length} payment methods`);

  // ── 2. Check existing data ──
  console.log('\n📊 Existing data before appending:');
  const oldCounts = {
    orders: await Order.countDocuments({}),
    items: await OrderItem.countDocuments({}),
    payments: await Payment.countDocuments({}),
  };
  console.log(`   ${JSON.stringify(oldCounts)}`);

  // ── 3. Append 100 new orders (keep existing) ──
  console.log('\n🚀 Appending 100 new realistic orders...\n');

  const ordersToInsert: any[] = [];
  const itemsToInsert: { orderIndex: number; items: any[] }[] = [];
  const paymentsToInsert: any[] = [];
  const productSales = new Map<string, number>();
  const variantStockChanges = new Map<string, number>();
  const voucherUsage = new Map<string, number>();

  let successCount = 0;
  let skipCount = 0;
  let orderIndex = 0; // actual index in the array (runs continuously)

  for (let i = 0; i < 100; i++) {
    // ── Pick a user ──
    const user = randomPick(users);
    const userId = user._id;

    // ── Pick 1-3 products with enough stock ──
    const itemCount = randomInt(1, 3);
    const selectedItems: { product: any; variant: any; quantity: number }[] = [];
    const usedProductIndices = new Set<number>();

    for (let j = 0; j < itemCount; j++) {
      // Try up to 20 times to find a product with available stock
      let found = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        let idx: number;
        do { idx = randomInt(0, products.length - 1); } while (usedProductIndices.has(idx));

        const prod = products[idx];
        const variants = variantMap.get(prod._id.toString()) || [];
        // Filter variants that have enough stock
        const availableVariants = variants.filter(v => {
          const alreadyUsed = variantStockChanges.get(v._id.toString()) || 0;
          return (v.quantityInStock - alreadyUsed) >= 1;
        });

        if (availableVariants.length > 0) {
          const variant = randomPick(availableVariants);
          const maxQty = Math.min(3, variant.quantityInStock - (variantStockChanges.get(variant._id.toString()) || 0));
          const quantity = randomInt(1, maxQty);

          usedProductIndices.add(idx);
          selectedItems.push({ product: prod, variant, quantity });
          found = true;
          break;
        }
      }
      if (!found) {
        // If we can't find enough items, just use what we have
        break;
      }
    }

    if (selectedItems.length === 0) {
      skipCount++;
      continue;
    }

    // ── Calculate total amount ──
    let totalAmount = 0;
    const orderItems: any[] = [];

    for (const { product: prod, variant, quantity } of selectedItems) {
      const price = variant.price;
      const lineTotal = price * quantity;
      totalAmount += lineTotal;
      const brandName = brandNameMap.get(prod.brandId.toString()) || '';

      orderItems.push({
        productId: prod._id,
        name: prod.name,
        brand: brandName,
        quantity,
        price,
        image: prod.image || '',
        variantSize: variant.size,
      });

      const pid = prod._id.toString();
      productSales.set(pid, (productSales.get(pid) || 0) + quantity);

      const vid = variant._id.toString();
      variantStockChanges.set(vid, (variantStockChanges.get(vid) || 0) + quantity);
    }

    // ── Apply voucher (30% chance, if eligible) ──
    let appliedVoucher: any = null;
    let discountAmount = 0;

    if (vouchers.length > 0 && Math.random() < 0.3) {
      // Find eligible vouchers
      const eligibleVouchers = vouchers.filter(v => {
        if (totalAmount < v.minOrderAmount) return false;
        if (v.maxUsage > 0 && (v.usedCount + (voucherUsage.get(v._id.toString()) || 0)) >= v.maxUsage) return false;
        // Check user tier if minTier is set
        if (v.minTier) {
          const tierOrder = ['MEMBER', 'Bac', 'Vang', 'KimCuong'];
          const userTier = (user as any).memberTier || 'MEMBER';
          if (tierOrder.indexOf(userTier) < tierOrder.indexOf(v.minTier)) return false;
        }
        return true;
      });

      if (eligibleVouchers.length > 0) {
        appliedVoucher = randomPick(eligibleVouchers);

        if (appliedVoucher.type === 'percentage') {
          discountAmount = Math.round(totalAmount * appliedVoucher.value / 100);
          if (appliedVoucher.maxDiscount && discountAmount > appliedVoucher.maxDiscount) {
            discountAmount = appliedVoucher.maxDiscount;
          }
        } else {
          discountAmount = appliedVoucher.value;
        }

        // Don't let discount exceed total
        if (discountAmount > totalAmount) discountAmount = totalAmount;

        const vid = appliedVoucher._id.toString();
        voucherUsage.set(vid, (voucherUsage.get(vid) || 0) + 1);
      }
    }

    const finalAmount = totalAmount - discountAmount;

    // ── Determine status ──
    const statusRoll = Math.random();
    let status: typeof STATUSES[number];
    if (statusRoll < 0.40) status = 'delivered';
    else if (statusRoll < 0.60) status = 'shipped';
    else if (statusRoll < 0.78) status = 'processing';
    else if (statusRoll < 0.90) status = 'pending';
    else status = 'cancelled';

    // ── Payment method & status ──
    const paymentMethod = randomPick(PAYMENT_METHODS);
    const paymentStatus = status === 'cancelled' ? 'refunded' : (Math.random() < 0.7 ? 'paid' : 'unpaid');

    // ── Cancel reason (if cancelled) ──
    const cancelReason = status === 'cancelled' ? randomPick(CANCEL_REASONS) : undefined;

    // ── Build address ──
    const province = randomPick(PROVINCES);
    const districtList = DISTRICTS[province] || ['Quận 1'];
    const district = randomPick(districtList);
    const ward = randomPick(WARDS);
    const street = randomPick(STREETS);
    const streetNo = randomInt(1, 500);
    const address = `${streetNo} ${street}, ${ward}, ${district}, ${province}`;

    const orderDate = randomDate(60);

    // ── Build order doc ──
    const userFullName = (user as any).fullName || '';
    const userPhone = (user as any).phoneNumber || '';
    const userEmail = (user as any).email || '';

    const order: any = {
      userId,
      customerName: userFullName,
      customerPhone: userPhone,
      customerAddress: address,
      customerEmail: userEmail,
      totalAmount: finalAmount,
      voucherId: appliedVoucher?._id || undefined,
      status,
      paymentMethod,
      paymentStatus,
      cancelRequested: status === 'cancelled',
      cancelReason,
      createdAt: orderDate,
      updatedAt: new Date(),
    };

    ordersToInsert.push(order);
    itemsToInsert.push({ orderIndex, items: orderItems });
    successCount++;

    // ── Build payment record ──
    const pmMethod = paymentMethods.length > 0 ? randomPick(paymentMethods) : null;
    let paymentStatus2: 'pending' | 'paid' | 'failed' | 'refunded' = 'pending';
    if (paymentStatus === 'paid') paymentStatus2 = 'paid';
    else if (paymentStatus === 'refunded') paymentStatus2 = 'refunded';
    else if (status === 'cancelled') paymentStatus2 = 'refunded';
    else if (Math.random() < 0.1) paymentStatus2 = 'failed';

    paymentsToInsert.push({
      orderIndex,
      payment: {
        orderId: null, // will be set after insert
        paymentMethodId: pmMethod?._id || null,
        method: paymentMethod,
        status: paymentStatus2,
        transactionCode: paymentStatus2 === 'paid' ? `TXN${generateTxnRef()}` : undefined,
        txnRef: paymentStatus2 === 'paid' ? generateTxnRef() : undefined,
        paidAt: paymentStatus2 === 'paid' ? orderDate : undefined,
        refundedAt: paymentStatus2 === 'refunded' ? new Date() : undefined,
        createdAt: orderDate,
        updatedAt: new Date(),
      },
    });

    orderIndex++;
  }

  // ── Insert orders ──
  const insertedOrders = await Order.insertMany(ordersToInsert);
  console.log(`✅ Created ${insertedOrders.length} orders (skipped ${skipCount} due to insufficient stock)`);

  // ── Insert order items ──
  const orderItemDocs: any[] = [];
  for (const entry of itemsToInsert) {
    const orderId = insertedOrders[entry.orderIndex]._id;
    const orderDate = insertedOrders[entry.orderIndex].createdAt;
    for (const item of entry.items) {
      orderItemDocs.push({
        orderId,
        productId: item.productId,
        name: item.name,
        brand: item.brand,
        quantity: item.quantity,
        price: item.price,
        image: item.image,
        variantSize: item.variantSize,
        createdAt: orderDate,
        updatedAt: new Date(),
      });
    }
  }
  const insertedItems = await OrderItem.insertMany(orderItemDocs);
  console.log(`✅ Created ${insertedItems.length} order items`);

  // ── Insert payments ──
  const paymentDocs: any[] = [];
  for (const entry of paymentsToInsert) {
    const orderId = insertedOrders[entry.orderIndex]._id;
    paymentDocs.push({
      ...entry.payment,
      orderId,
    });
  }
  const insertedPayments = await Payment.insertMany(paymentDocs);
  console.log(`✅ Created ${insertedPayments.length} payment records`);

  // ── 4. Update Product.soldCount ──
  console.log('\n📊 Updating product sold counts...');
  for (const [pid, sold] of productSales) {
    await Product.updateOne(
      { _id: new mongoose.Types.ObjectId(pid) },
      { $inc: { soldCount: sold } }
    );
  }
  console.log(`   ✅ Updated soldCount for ${productSales.size} products`);

  // ── 5. Decrease ProductVariant.quantityInStock ──
  console.log('📦 Decreasing variant stock...');
  let stockUpdated = 0;
  for (const [vid, qty] of variantStockChanges) {
    const variant = await ProductVariant.findById(vid);
    if (variant && variant.quantityInStock >= qty) {
      await ProductVariant.updateOne(
        { _id: vid },
        { $inc: { quantityInStock: -qty } }
      );
      stockUpdated++;
    } else if (variant && variant.quantityInStock > 0) {
      await ProductVariant.updateOne(
        { _id: vid },
        { $set: { quantityInStock: 0 } }
      );
      stockUpdated++;
    }
  }
  console.log(`   ✅ Decreased stock for ${stockUpdated} variants`);

  // ── 6. Update Voucher.usedCount ──
  console.log('🎫 Updating voucher usage...');
  for (const [vid, count] of voucherUsage) {
    await Voucher.updateOne(
      { _id: new mongoose.Types.ObjectId(vid) },
      { $inc: { usedCount: count } }
    );
  }
  console.log(`   ✅ Updated usedCount for ${voucherUsage.size} vouchers`);

  // ── 7. Update Product.reviewsCount (for delivered orders) ──
  console.log('⭐ Updating review counts for delivered products...');
  const deliveredOrders = await Order.find({ status: 'delivered' }).lean();
  const reviewedProductIds = new Set<string>();
  for (const o of deliveredOrders) {
    const items = await OrderItem.find({ orderId: o._id }).lean();
    for (const item of items) {
      reviewedProductIds.add(item.productId.toString());
    }
  }
  for (const pid of reviewedProductIds) {
    await Product.updateOne(
      { _id: new mongoose.Types.ObjectId(pid) },
      { $inc: { reviewsCount: randomInt(1, 3) } }
    );
  }
  console.log(`   ✅ Updated reviewsCount for ${reviewedProductIds.size} products`);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════');
  console.log('📋 SEED ORDERS - SUMMARY');
  console.log(`   Orders:          ${insertedOrders.length}`);
  console.log(`   Order Items:     ${insertedItems.length}`);
  console.log(`   Payments:        ${insertedPayments.length}`);
  console.log(`   Products sold:   ${productSales.size}`);
  console.log(`   Variants stock:  ${stockUpdated}`);
  console.log(`   Vouchers used:   ${voucherUsage.size}`);
  console.log(`   Skipped (stock): ${skipCount}`);
  console.log('═══════════════════════════════════════\n');

  // ── Sample output ──
  console.log('📌 Sample orders:');
  for (let i = 0; i < 5; i++) {
    const o = insertedOrders[i];
    const p = insertedPayments[i];
    console.log(`   [${i + 1}] ${o.customerName} - ${(o.totalAmount / 1000).toFixed(0)}k - ${o.status} - ${o.paymentMethod} - ${o.paymentStatus}`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Seed completed successfully!');
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});