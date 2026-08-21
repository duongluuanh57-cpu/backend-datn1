import 'dotenv/config';
import { connectDB } from '../config/database.ts';
import { Product } from '../models/Product.ts';
import { Brand } from '../models/Brand.ts';
import { redis } from '../config/redis.ts';

async function seedViewsAndFunnel() {
  console.log('🔄 Đang kết nối database & Redis để cập nhật lượt xem sản phẩm và phễu hành vi...');
  await connectDB();
  await redis.connect();

  const products = await Product.find({});
  console.log(`📦 Tìm thấy ${products.length} sản phẩm cần cập nhật viewCount.`);

  // 1. Cập nhật viewCount trên từng sản phẩm (Tỷ lệ thực tế: Lượt xem thường gấp 15 - 30 lần lượt bán)
  for (const p of products) {
    const sold = p.soldCount || 0;
    // Mỗi sản phẩm có từ 250 - 1500 lượt xem tùy lượt bán
    const randomExtra = Math.floor(Math.random() * 200) + 150;
    const views = Math.max(randomExtra, sold * 18 + Math.floor(Math.random() * 100));

    await Product.findByIdAndUpdate(p._id, {
      $set: { viewCount: views }
    });
  }
  console.log('✅ Đã cập nhật viewCount hợp lý cho toàn bộ sản phẩm!');

  // 2. Cập nhật bộ đếm phễu (Add to Cart, Checkout) trên Redis cho từng Thương hiệu (Brand)
  const brands = await Brand.find({});
  for (const b of brands) {
    const prods = await Product.find({ brandId: b._id });
    const totalSold = prods.reduce((sum, item) => sum + (item.soldCount || 0), 0);
    const totalViews = prods.reduce((sum, item) => sum + (item.viewCount || 0), 0);

    // Phễu chuẩn E-commerce:
    // Views (100%) -> Add to Cart (~20% - 30% Views) -> Checkout (~40% - 60% Add to Cart) -> Purchases (Sold)
    const addToCart = Math.max(totalSold * 3, Math.floor(totalViews * 0.25) + Math.floor(Math.random() * 20));
    const reachCheckout = Math.max(Math.floor(totalSold * 1.6), Math.floor(addToCart * 0.55) + Math.floor(Math.random() * 10));

    const bid = b._id.toString();
    await redis.set(`funnel:total:${bid}:add_to_cart`, addToCart.toString());
    await redis.set(`funnel:total:${bid}:reach_checkout`, reachCheckout.toString());
  }
  console.log('✅ Đã cập nhật metrics phễu (add_to_cart, reach_checkout) cho các thương hiệu trên Redis!');

  // 3. Xóa cache phễu để dashboard lấy ngay số liệu mới
  const funnelCaches = await redis.keys('funnel:data*');
  if (funnelCaches.length > 0) {
    await redis.del(...funnelCaches);
    console.log(`🧹 Đã xóa ${funnelCaches.length} keys cache phễu.`);
  }

  // 4. Xóa cache dashboard chung
  const dashboardCaches = await redis.keys('*dashboard*');
  if (dashboardCaches.length > 0) {
    await redis.del(...dashboardCaches);
  }

  console.log('🎉 Hoàn tất cập nhật lượt xem và phễu hành vi khách hàng!');
  await redis.quit();
  process.exit(0);
}

seedViewsAndFunnel().catch((err) => {
  console.error('❌ Lỗi:', err);
  process.exit(1);
});
