import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.ts';
import { UserAddress } from '../models/UserAddress.ts';
import { Favorite } from '../models/Favorite.ts';
import { Order } from '../models/Order.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { Review } from '../models/Review.ts';
import { AuditLog } from '../models/AuditLog.ts';
import { Product } from '../models/Product.ts';
import { ProductVariant } from '../models/ProductVariant.ts';
import { Brand } from '../models/Brand.ts';

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

// ─── 100 Vietnamese names ──────────────────────────────────
const FULL_NAMES_MALE = [
  'Nguyễn Văn Anh', 'Trần Văn Bình', 'Lê Văn Cường', 'Phạm Văn Dũng', 'Hoàng Văn Hải',
  'Huỳnh Văn Hùng', 'Phan Văn Khanh', 'Vũ Văn Long', 'Đặng Văn Minh', 'Bùi Văn Nam',
  'Đỗ Văn Quân', 'Hồ Văn Sơn', 'Ngô Văn Thắng', 'Dương Văn Thành', 'Lý Văn Việt',
  'Mai Văn Tâm', 'Đinh Văn Phúc', 'Trịnh Văn Đức', 'Lương Văn Tài', 'Cao Văn Lộc',
  'Nguyễn Văn Phương', 'Trần Văn Trung', 'Lê Văn Kiên', 'Phạm Văn Huy', 'Hoàng Văn Đạt',
  'Huỳnh Văn Tiến', 'Phan Văn Bảo', 'Vũ Văn Khang', 'Đặng Văn Phát', 'Bùi Văn Nhân',
  'Đỗ Văn Trọng', 'Hồ Văn Hiếu', 'Ngô Văn Tùng', 'Dương Văn Lâm', 'Lý Văn Hoàng',
  'Mai Văn Duy', 'Đinh Văn Khôi', 'Trịnh Văn Vũ', 'Lương Văn Hòa', 'Cao Văn Nghĩa',
  'Nguyễn Văn Tú', 'Trần Văn Quyết', 'Lê Văn Chí', 'Phạm Văn Hào', 'Hoàng Văn Lợi',
  'Huỳnh Văn Sang', 'Phan Văn Thuận', 'Vũ Văn Công', 'Đặng Văn Thịnh', 'Bùi Văn Đông',
];

const FULL_NAMES_FEMALE = [
  'Nguyễn Thị An', 'Trần Thị Bích', 'Lê Thị Cẩm', 'Phạm Thị Dung', 'Hoàng Thị Hà',
  'Huỳnh Thị Hương', 'Phan Thị Khanh', 'Vũ Thị Lan', 'Đặng Thị Linh', 'Bùi Thị Mai',
  'Đỗ Thị Ngọc', 'Hồ Thị Nhung', 'Ngô Thị Phương', 'Dương Thị Quỳnh', 'Lý Thị Trang',
  'Mai Thị Thảo', 'Đinh Thị Tuyết', 'Trịnh Thị Vân', 'Lương Thị Yến', 'Cao Thị Hồng',
  'Nguyễn Thị Ánh', 'Trần Thị Diễm', 'Lê Thị Giang', 'Phạm Thị Hạnh', 'Hoàng Thị Kim',
  'Huỳnh Thị Liên', 'Phan Thị Mỹ', 'Vũ Thị Nga', 'Đặng Thị Oanh', 'Bùi Thị Phượng',
  'Đỗ Thị Sương', 'Hồ Thị Thanh', 'Ngô Thị Thúy', 'Dương Thị Trúc', 'Lý Thị Tú',
  'Mai Thị Uyên', 'Đinh Thị Vy', 'Trịnh Thị Xuân', 'Lương Thị Đào', 'Cao Thị Hoa',
  'Nguyễn Thị Hải', 'Trần Thị Hậu', 'Lê Thị Huế', 'Phạm Thị Hợp', 'Hoàng Thị Lệ',
  'Huỳnh Thị Nhi', 'Phan Thị Phi', 'Vũ Thị Tâm', 'Đặng Thị Tiên', 'Bùi Thị Trinh',
];

const PROVINCES = [
  'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ',
  'Biên Hòa', 'Nha Trang', 'Huế', 'Đà Lạt', 'Vũng Tàu',
  'Quy Nhơn', 'Phan Thiết', 'Rạch Giá', 'Long Xuyên', 'Buôn Ma Thuột',
  'Thái Nguyên', 'Nam Định', 'Vinh', 'Hạ Long', 'Thanh Hóa',
];

const DISTRICTS: Record<string, string[]> = {
  'Hồ Chí Minh': ['Quận 1', 'Quận 3', 'Quận 5', 'Quận 7', 'Quận 10', 'Tân Bình', 'Bình Thạnh', 'Gò Vấp', 'Thủ Đức', 'Phú Nhuận'],
  'Hà Nội': ['Ba Đình', 'Hoàn Kiếm', 'Hai Bà Trưng', 'Đống Đa', 'Cầu Giấy', 'Thanh Xuân', 'Hoàng Mai', 'Long Biên', 'Tây Hồ', 'Nam Từ Liêm'],
  'Đà Nẵng': ['Hải Châu', 'Thanh Khê', 'Sơn Trà', 'Ngũ Hành Sơn', 'Liên Chiểu', 'Cẩm Lệ', 'Hòa Vang'],
  'Hải Phòng': ['Hồng Bàng', 'Lê Chân', 'Ngô Quyền', 'Kiến An', 'Hải An', 'Đồ Sơn', 'Dương Kinh'],
  'Cần Thơ': ['Ninh Kiều', 'Bình Thủy', 'Cái Răng', 'Ô Môn', 'Thốt Nốt', 'Phong Điền'],
  'Biên Hòa': ['TP. Biên Hòa', 'Long Thành', 'Nhơn Trạch', 'Trảng Bom', 'Vĩnh Cửu'],
  'Nha Trang': ['TP. Nha Trang', 'Ninh Hòa', 'Diên Khánh', 'Cam Lâm', 'Vạn Ninh'],
  'Huế': ['TP. Huế', 'Hương Thủy', 'Hương Trà', 'Phong Điền', 'Quảng Điền'],
  'Đà Lạt': ['TP. Đà Lạt', 'Bảo Lộc', 'Đức Trọng', 'Lạc Dương', 'Đơn Dương'],
  'Vũng Tàu': ['TP. Vũng Tàu', 'Bà Rịa', 'Phú Mỹ', 'Long Điền', 'Đất Đỏ'],
  'Quy Nhơn': ['TP. Quy Nhơn', 'An Nhơn', 'Hoài Nhơn', 'Tuy Phước', 'Phù Cát'],
  'Phan Thiết': ['TP. Phan Thiết', 'La Gi', 'Tuy Phong', 'Hàm Thuận Bắc', 'Hàm Thuận Nam'],
  'Rạch Giá': ['TP. Rạch Giá', 'Hà Tiên', 'Phú Quốc', 'Châu Thành', 'Giồng Riềng'],
  'Long Xuyên': ['TP. Long Xuyên', 'Châu Đốc', 'Châu Phú', 'Thoại Sơn', 'Chợ Mới'],
  'Buôn Ma Thuột': ['TP. Buôn Ma Thuột', 'Buôn Hồ', 'Krông Pắc', 'Ea Kar', "M'Đrắk"],
  'Thái Nguyên': ['TP. Thái Nguyên', 'Sông Công', 'Phổ Yên', 'Đại Từ', 'Đồng Hỷ'],
  'Nam Định': ['TP. Nam Định', 'Mỹ Lộc', 'Vụ Bản', 'Ý Yên', 'Nghĩa Hưng'],
  'Vinh': ['TP. Vinh', 'Cửa Lò', 'Thái Hòa', 'Diễn Châu', 'Nghi Lộc'],
  'Hạ Long': ['TP. Hạ Long', 'Cẩm Phả', 'Uông Bí', 'Móng Cái', 'Quảng Yên'],
  'Thanh Hóa': ['TP. Thanh Hóa', 'Sầm Sơn', 'Bỉm Sơn', 'Nghi Sơn', 'Hoằng Hóa'],
};

const STREETS = [
  'Nguyễn Huệ', 'Lê Lợi', 'Trần Hưng Đạo', 'Hai Bà Trưng', 'Phạm Ngũ Lão',
  'Nguyễn Trãi', 'Lý Tự Trọng', 'Điện Biên Phủ', 'Cách Mạng Tháng 8', 'Võ Văn Tần',
  'Nguyễn Đình Chiểu', 'Pasteur', 'Calmette', 'Hàm Nghi', 'Tôn Đức Thắng',
  'Lê Duẩn', 'Nguyễn Thị Minh Khai', 'Bùi Thị Xuân', 'Trường Chinh', 'Hoàng Văn Thụ',
  'Xô Viết Nghệ Tĩnh', 'Nam Kỳ Khởi Nghĩa', 'Lý Chính Thắng', 'Nguyễn Văn Trỗi', 'Phan Đình Phùng',
];

const WARDS = [
  'Phường 1', 'Phường 2', 'Phường 3', 'Phường 4', 'Phường 5',
  'Phường 6', 'Phường 7', 'Phường 8', 'Phường 9', 'Phường 10',
  'Phường 11', 'Phường 12', 'Phường 13', 'Phường 14', 'Phường 15',
  'Phường Bến Nghé', 'Phường Bến Thành', 'Phường Đa Kao', 'Phường Tân Định', 'Phường Cầu Kho',
];

const REVIEW_COMMENTS = [
  'Mùi hương rất dễ chịu, lưu hương tốt. Sẽ mua lại!',
  'Sản phẩm chính hãng, đóng gói cẩn thận. Rất hài lòng.',
  'Hương thơm nhẹ nhàng, nữ tính. Phù hợp đi làm hàng ngày.',
  'Mùi khá giống với mô tả. Giao hàng nhanh.',
  'Chai đẹp, mùi thơm sang trọng. Đáng tiền!',
  'Lưu hương khoảng 6-7 tiếng, khá ổn. Sẽ ủng hộ shop tiếp.',
  'Mùi hương mạnh mẽ, nam tính. Rất thích!',
  'Sản phẩm tốt, giá cả hợp lý. Shop nhiệt tình.',
  'Hương thơm tinh tế, không bị gắt. Phù hợp mọi lứa tuổi.',
  'Mua tặng vợ, vợ rất thích. Cảm ơn shop!',
  'Mùi thơm quyến rũ, lưu hương cả ngày. Recommend!',
  'Đã mua nhiều lần, chất lượng luôn ổn định.',
  'Hàng thật, mùi giống y chang bản gốc. 5 sao!',
  'Giao hàng siêu nhanh, đóng gói kỹ. Sẽ ủng hộ dài dài.',
  'Mùi hương thanh lịch, nhẹ nhàng. Rất phù hợp cho mùa hè.',
  'Chất lượng sản phẩm tốt, shop tư vấn nhiệt tình.',
  'Lần đầu mua, khá ưng ý. Hương thơm đúng gu.',
  'Mùi thơm bền, đi làm cả ngày vẫn còn. Tuyệt vời!',
  'Sản phẩm đẹp hơn mong đợi. Giá tốt.',
  'Rất thích mùi này, đã mua chai thứ 2 rồi.',
];

const ASPECT_NAMES = ['quality', 'longevity', 'scent', 'value', 'packaging'] as const;

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

  const brands = await Brand.find({}).lean();
  const brandNameMap = new Map(brands.map(b => [b._id.toString(), b.name]));

  const allVariants = await ProductVariant.find({}).lean();
  const variantMap = new Map<string, typeof allVariants>();
  for (const v of allVariants) {
    const pid = v.productId.toString();
    if (!variantMap.has(pid)) variantMap.set(pid, []);
    variantMap.get(pid)!.push(v);
  }
  console.log(`📦 Found ${allVariants.length} variants`);

  // ── 2. Clear old seed data ──
  console.log('\n🗑️  Clearing old customer seed data...');
  const counts = {
    users: await User.countDocuments({}),
    addresses: await UserAddress.countDocuments({}),
    favorites: await Favorite.countDocuments({}),
    orders: await Order.countDocuments({}),
    orderItems: await OrderItem.countDocuments({}),
    reviews: await Review.countDocuments({}),
    auditLogs: await AuditLog.countDocuments({}),
  };
  console.log(`   Existing: ${JSON.stringify(counts)}`);

  await AuditLog.deleteMany({});
  await Review.deleteMany({});
  await OrderItem.deleteMany({});
  await Order.deleteMany({});
  await Favorite.deleteMany({});
  await UserAddress.deleteMany({});
  await User.deleteMany({});
  console.log('   ✅ Cleared all related collections');

  // ── 3. Create 100 users ──
  console.log('\n👤 Creating 100 users...');
  const passwordHash = await bcrypt.hash('customer123', 10);
  const allNames = [...FULL_NAMES_MALE, ...FULL_NAMES_FEMALE];
  const userDocs: any[] = [];
  const userMap = new Map<string, { _id: mongoose.Types.ObjectId; fullName: string; phone: string; email: string; gender: string }>();

  for (let i = 0; i < 100; i++) {
    const fullName = allNames[i];
    const isMale = FULL_NAMES_MALE.includes(fullName);
    const gender = isMale ? 'MALE' : 'FEMALE';
    const username = `customer${i + 1}`;
    const email = `customer${i + 1}@perfume.com`;
    const phone = randomPhone();
    const dobYear = randomInt(1975, 2002);
    const dobMonth = String(randomInt(1, 12)).padStart(2, '0');
    const dobDay = String(randomInt(1, 28)).padStart(2, '0');
    const tierRoll = Math.random();
    let memberTier: string;
    if (tierRoll < 0.55) memberTier = 'MEMBER';
    else if (tierRoll < 0.80) memberTier = 'Bac';
    else if (tierRoll < 0.95) memberTier = 'Vang';
    else memberTier = 'KimCuong';

    const statusRoll = Math.random();
    const status = statusRoll < 0.92 ? 'active' : (statusRoll < 0.98 ? 'inactive' : 'suspended');

    userDocs.push({
      username,
      email,
      passwordHash,
      role: 'USER',
      memberTier,
      status,
      fullName,
      phoneNumber: phone,
      gender,
      dateOfBirth: `${dobYear}-${dobMonth}-${dobDay}`,
      createdAt: randomDate(180),
      updatedAt: new Date(),
    });
  }

  const insertedUsers = await User.insertMany(userDocs);
  for (const u of insertedUsers) {
    userMap.set(u._id.toString(), {
      _id: u._id,
      fullName: u.fullName || '',
      phone: u.phoneNumber || '',
      email: u.email,
      gender: u.gender || '',
    });
  }
  console.log(`   ✅ Created ${insertedUsers.length} users`);

  // ── 4. Create UserAddresses ──
  console.log('\n📍 Creating user addresses...');
  const addressDocs: any[] = [];
  for (const [userId, user] of userMap) {
    const province = randomPick(PROVINCES);
    const districtList = DISTRICTS[province] || ['Quận 1', 'Quận 2'];
    const district = randomPick(districtList);
    const ward = randomPick(WARDS);
    const street = randomPick(STREETS);
    const streetNo = randomInt(1, 500);

    addressDocs.push({
      userId: new mongoose.Types.ObjectId(userId),
      addressType: 'home',
      fullName: user.fullName,
      phoneNumber: user.phone,
      address: `${streetNo} ${street}`,
      province,
      district,
      ward,
      isDefault: true,
      createdAt: randomDate(150),
      updatedAt: new Date(),
    });

    if (Math.random() < 0.4) {
      const province2 = randomPick(PROVINCES);
      const districtList2 = DISTRICTS[province2] || ['Quận 1'];
      addressDocs.push({
        userId: new mongoose.Types.ObjectId(userId),
        addressType: 'office',
        fullName: user.fullName,
        phoneNumber: user.phone,
        address: `${randomInt(1, 300)} ${randomPick(STREETS)}`,
        province: province2,
        district: randomPick(districtList2),
        ward: randomPick(WARDS),
        isDefault: false,
        createdAt: randomDate(100),
        updatedAt: new Date(),
      });
    }
  }
  const insertedAddresses = await UserAddress.insertMany(addressDocs);
  console.log(`   ✅ Created ${insertedAddresses.length} addresses`);

  // ── 5. Create Favorites ──
  console.log('\n❤️  Creating favorites...');
  const favoriteDocs: any[] = [];
  for (const [userId] of userMap) {
    const favCount = randomInt(2, 5);
    const usedProductIds = new Set<string>();
    for (let j = 0; j < favCount; j++) {
      let product: any;
      let pid: string;
      do {
        product = randomPick(products);
        pid = product._id.toString();
      } while (usedProductIds.has(pid));
      usedProductIds.add(pid);

      favoriteDocs.push({
        userId: new mongoose.Types.ObjectId(userId),
        productId: product._id,
        createdAt: randomDate(90),
        updatedAt: new Date(),
      });
    }
  }
  const insertedFavorites = await Favorite.insertMany(favoriteDocs);
  console.log(`   ✅ Created ${insertedFavorites.length} favorites`);

  // ── 6. Create Orders + OrderItems ──
  console.log('\n📦 Creating orders...');
  const orderDocs: any[] = [];
  const productSales = new Map<string, number>();
  const variantStock = new Map<string, number>();
  // Store items alongside orders for later use
  const orderItemsBuffer: { orderIndex: number; items: any[] }[] = [];

  let orderIndex = 0;
  for (const [userId, user] of userMap) {
    const orderCount = randomInt(1, 4);
    for (let o = 0; o < orderCount; o++) {
      const itemCount = randomInt(1, 3);
      const selectedProducts: any[] = [];
      const usedIndices = new Set<number>();

      for (let j = 0; j < itemCount; j++) {
        let idx: number;
        do { idx = randomInt(0, products.length - 1); } while (usedIndices.has(idx));
        usedIndices.add(idx);
        selectedProducts.push(products[idx]);
      }

      let totalAmount = 0;
      const orderItems: any[] = [];

      for (const prod of selectedProducts) {
        const variants = variantMap.get(prod._id.toString()) || [];
        const variant = variants.length > 0 ? randomPick(variants) : null;
        const price = variant ? variant.price : randomInt(200000, 2000000);
        const quantity = randomInt(1, 3);
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
          variantSize: variant?.size || '',
        });

        const pid = prod._id.toString();
        productSales.set(pid, (productSales.get(pid) || 0) + quantity);
        if (variant) {
          const vid = variant._id.toString();
          variantStock.set(vid, (variantStock.get(vid) || 0) + quantity);
        }
      }

      const statusRoll = Math.random();
      let status: string;
      if (statusRoll < 0.40) status = 'delivered';
      else if (statusRoll < 0.60) status = 'shipped';
      else if (statusRoll < 0.78) status = 'processing';
      else if (statusRoll < 0.90) status = 'pending';
      else status = 'cancelled';

      const paymentMethod = randomPick(['cod', 'credit_card', 'momo', 'zalopay', 'vnpay'] as const);
      const paymentStatus = status === 'cancelled' ? 'refunded' : (Math.random() < 0.7 ? 'paid' : 'unpaid');

      const province = randomPick(PROVINCES);
      const districtList = DISTRICTS[province] || ['Quận 1'];
      const orderDate = randomDate(120);

      orderDocs.push({
        userId: new mongoose.Types.ObjectId(userId),
        customerName: user.fullName,
        customerPhone: user.phone,
        customerAddress: `${randomInt(1, 500)} ${randomPick(STREETS)}, ${randomPick(WARDS)}, ${randomPick(districtList)}, ${province}`,
        customerEmail: user.email,
        totalAmount,
        status,
        paymentMethod,
        paymentStatus,
        createdAt: orderDate,
        updatedAt: new Date(),
      });

      orderItemsBuffer.push({ orderIndex, items: orderItems });
      orderIndex++;
    }
  }

  const insertedOrders = await Order.insertMany(orderDocs);
  console.log(`   ✅ Created ${insertedOrders.length} orders`);

  // Create order items from buffer
  const finalOrderItems: any[] = [];
  for (const entry of orderItemsBuffer) {
    const orderId = insertedOrders[entry.orderIndex]._id;
    const orderDate = insertedOrders[entry.orderIndex].createdAt;
    for (const item of entry.items) {
      finalOrderItems.push({
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

  const insertedOrderItems = await OrderItem.insertMany(finalOrderItems);
  console.log(`   ✅ Created ${insertedOrderItems.length} order items`);

  // ── 7. Update Product.soldCount ──
  console.log('\n📊 Updating product sold counts...');
  for (const [pid, sold] of productSales) {
    await Product.updateOne(
      { _id: new mongoose.Types.ObjectId(pid) },
      { $inc: { soldCount: sold } }
    );
  }
  console.log(`   ✅ Updated soldCount for ${productSales.size} products`);

  // ── 8. Update ProductVariant stock ──
  for (const [vid, qty] of variantStock) {
    const variant = await ProductVariant.findById(vid);
    if (variant && variant.quantityInStock >= qty) {
      await ProductVariant.updateOne({ _id: vid }, { $inc: { quantityInStock: -qty } });
    } else if (variant && variant.quantityInStock > 0) {
      await ProductVariant.updateOne({ _id: vid }, { $set: { quantityInStock: 0 } });
    }
  }
  console.log(`   ✅ Updated stock for ${variantStock.size} variants`);

  // ── 9. Create Reviews (for delivered orders) ──
  console.log('\n⭐ Creating reviews...');
  const deliveredOrders = await Order.find({ status: 'delivered' }).lean();
  const reviewDocs: any[] = [];
  const reviewedProductSet = new Set<string>();

  for (const order of deliveredOrders) {
    const items = await OrderItem.find({ orderId: order._id }).lean();
    for (const item of items) {
      if (Math.random() < 0.7) {
        const rating = randomInt(3, 5);
        const aspectCount = randomInt(1, 3);
        const aspects: any[] = [];
        const usedAspects = new Set<string>();
        for (let a = 0; a < aspectCount; a++) {
          let aspect: string;
          do { aspect = randomPick(ASPECT_NAMES); } while (usedAspects.has(aspect));
          usedAspects.add(aspect);
          aspects.push({
            name: aspect,
            rating: randomInt(3, 5),
            comment: randomPick(REVIEW_COMMENTS).substring(0, 50),
          });
        }

        reviewDocs.push({
          userId: order.userId,
          productId: item.productId,
          orderItemId: item._id,
          rating,
          comment: randomPick(REVIEW_COMMENTS),
          overallComment: randomPick(REVIEW_COMMENTS),
          aspects,
          images: [],
          isAnonymous: Math.random() < 0.15,
          status: 'visible',
          createdAt: randomDate(30),
          updatedAt: new Date(),
        });

        reviewedProductSet.add(item.productId.toString());
      }
    }
  }

  if (reviewDocs.length > 0) {
    // Deduplicate reviews by userId+productId to avoid unique index conflicts
    const seen = new Set<string>();
    const uniqueReviews = reviewDocs.filter(r => {
      const key = r.userId.toString() + ':' + r.productId.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const insertedReviews = await Review.insertMany(uniqueReviews, { ordered: false });
    console.log(`   ✅ Created ${insertedReviews.length} reviews`);

    for (const pid of reviewedProductSet) {
      const count = await Review.countDocuments({ productId: new mongoose.Types.ObjectId(pid), status: 'visible' });
      await Product.updateOne(
        { _id: new mongoose.Types.ObjectId(pid) },
        { $set: { reviewsCount: count, avgRating: 4.5 } }
      );
    }
    console.log(`   ✅ Updated reviewsCount for ${reviewedProductSet.size} products`);
  } else {
    console.log('   ⏭ No reviews to create (no delivered orders)');
  }

  // ── 10. Create AuditLogs ──
  console.log('\n📋 Creating audit logs...');
  const auditActions = [
    { action: 'LOGIN', resource: 'User', status: 'SUCCESS' },
    { action: 'VIEW_PRODUCT', resource: 'Product', status: 'SUCCESS' },
    { action: 'UPDATE_PROFILE', resource: 'User', status: 'SUCCESS' },
    { action: 'VIEW_ORDER', resource: 'Order', status: 'SUCCESS' },
    { action: 'ADD_TO_CART', resource: 'Cart', status: 'SUCCESS' },
    { action: 'LOGOUT', resource: 'User', status: 'SUCCESS' },
    { action: 'LOGIN_FAILED', resource: 'User', status: 'FAILURE' },
    { action: 'SEARCH_PRODUCT', resource: 'Product', status: 'SUCCESS' },
    { action: 'ADD_FAVORITE', resource: 'Favorite', status: 'SUCCESS' },
    { action: 'SUBMIT_REVIEW', resource: 'Review', status: 'SUCCESS' },
  ];
  const auditDocs: any[] = [];
  for (const [userId] of userMap) {
    const logCount = randomInt(5, 12);
    for (let l = 0; l < logCount; l++) {
      const action = randomPick(auditActions);
      auditDocs.push({
        userId: new mongoose.Types.ObjectId(userId),
        action: action.action,
        resource: action.resource,
        metadata: {
          ip: `192.168.${randomInt(1, 255)}.${randomInt(1, 255)}`,
          browser: randomPick(['Chrome 120', 'Firefox 121', 'Safari 17', 'Edge 120', 'Chrome Mobile 120']),
          timestamp: new Date().toISOString(),
        },
        status: action.status,
        createdAt: randomDate(90),
      });
    }
  }
  const insertedAuditLogs = await AuditLog.insertMany(auditDocs);
  console.log(`   ✅ Created ${insertedAuditLogs.length} audit logs`);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════');
  console.log('📋 SEED CUSTOMERS - SUMMARY');
  console.log(`   Users:          ${insertedUsers.length}`);
  console.log(`   Addresses:      ${insertedAddresses.length}`);
  console.log(`   Favorites:      ${insertedFavorites.length}`);
  console.log(`   Orders:         ${insertedOrders.length}`);
  console.log(`   Order Items:    ${insertedOrderItems.length}`);
  console.log(`   Reviews:        ${reviewDocs.length}`);
  console.log(`   Audit Logs:     ${insertedAuditLogs.length}`);
  console.log('═══════════════════════════════════════\n');

  console.log('📌 Sample users:');
  for (let i = 0; i < 5; i++) {
    const u = insertedUsers[i];
    console.log(`   [${i + 1}] ${u.fullName} (${u.email}) - ${u.memberTier} - ${u.status}`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Seed completed successfully!');
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});