/**
 * Xoá các sản phẩm status='draft' khỏi DB.
 * Mặc định DRY-RUN (chỉ thống kê). Thêm --yes để xoá thật.
 * Trước khi xoá luôn dump toàn bộ chứng từ liên quan ra .backups/ để phục hồi được.
 *
 * Chạy: npx tsx scripts/delete-draft-products.ts [--yes]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { ProductImage } from '../src/models/ProductImage.ts';
import { ProductTag } from '../src/models/ProductTag.ts';
import { Review } from '../src/models/Review.ts';
import { Favorite } from '../src/models/Favorite.ts';
import { OrderItem } from '../src/models/OrderItem.ts';
import { CartItem } from '../src/models/CartItem.ts';

const DELETE = process.argv.includes('--yes');

async function main() {
  await mongoose.connect(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 30000 });

  const drafts = await Product.find({ status: 'draft' }).select('name status createdAt').lean();
  const ids = drafts.map((d: any) => d._id);
  console.log(`Sản phẩm draft: ${drafts.length}`);
  drafts.forEach((d: any, i: number) => console.log(`  ${String(i + 1).padStart(2)}. ${String(d.name).slice(0, 70)}`));

  if (ids.length === 0) { console.log('Không có gì để xoá.'); return; }

  const [variants, images, tagLinks, reviews, favorites, orderItems, cartItems] = await Promise.all([
    ProductVariant.countDocuments({ productId: { $in: ids } }),
    ProductImage.countDocuments({ productId: { $in: ids } }),
    ProductTag.countDocuments({ productId: { $in: ids } }),
    Review.countDocuments({ productId: { $in: ids } }),
    Favorite.countDocuments({ productId: { $in: ids } }),
    OrderItem.countDocuments({ productId: { $in: ids } }),
    CartItem.countDocuments({ productId: { $in: ids } }),
  ]);

  console.log('\nChứng từ liên quan:');
  console.log(`  variants ${variants} | images ${images} | tagLinks ${tagLinks}`);
  console.log(`  reviews ${reviews} | favorites ${favorites} | ORDER_ITEMS ${orderItems} | cartItems ${cartItems}`);

  if (orderItems > 0) {
    console.log('\n⚠️ Có sản phẩm draft đã xuất hiện trong đơn hàng. Dừng ở đây, cần bạn quyết ( xoá sẽ làm lịch sử đơn hàng treo tham số productId ).');
    return;
  }

  const [variantDocs, imageDocs, tagLinkDocs] = await Promise.all([
    ProductVariant.find({ productId: { $in: ids } }).lean(),
    ProductImage.find({ productId: { $in: ids } }).lean(),
    ProductTag.find({ productId: { $in: ids } }).lean(),
  ]);

  const dir = path.resolve(process.cwd(), '.backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `draft-products-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ products: drafts, variants: variantDocs, images: imageDocs, tagLinks: tagLinkDocs }, null, 2), 'utf8');
  console.log(`\nBackup ghi tại: ${file}`);

  if (!DELETE) {
    console.log('DRY-RUN: chưa xoá gì. Chạy lại với --yes để xoá thật.');
    return;
  }

  await Promise.all([
    ProductVariant.deleteMany({ productId: { $in: ids } }),
    ProductImage.deleteMany({ productId: { $in: ids } }),
    ProductTag.deleteMany({ productId: { $in: ids } }),
    Review.deleteMany({ productId: { $in: ids } }),
    Favorite.deleteMany({ productId: { $in: ids } }),
    CartItem.deleteMany({ productId: { $in: ids } }),
  ]);
  const res = await Product.deleteMany({ _id: { $in: ids } });
  console.log(`ĐÃ XOÁ ${res.deletedCount} sản phẩm draft + chứng từ con.`);
}

main().finally(() => process.exit(0));
