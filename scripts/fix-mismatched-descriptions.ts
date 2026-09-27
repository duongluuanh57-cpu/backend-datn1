/**
 * Tìm (và tùy chọn dọn) mô tả sản phẩm viết về chai khác.
 *
 * Nguồn gốc: dữ liệu import hàng loạt, mô tả bị gắn lệch sang sản phẩm khác —
 * kiểm bằng từ định danh của chính tên sản phẩm (logic dùng chung với guard lúc
 * AI generate trong src/services/product/nameConsistency.ts).
 *
 * Chạy:
 *   npx tsx scripts/fix-mismatched-descriptions.ts              # bao cao, khong ghi
 *   npx tsx scripts/fix-mismatched-descriptions.ts --apply <id> # xoa mo ta cua dung id truyen vao
 *
 * Script không tự ghi hàng loạt: mô tả hợp lệ vẫn có thể không lặp lại tên chai,
 * nên quyết định là việc của người đọc báo cáo.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/config/database.ts';
import { redis } from '../src/config/redis.ts';
import { Product } from '../src/models/Product.ts';
import { descriptionMatchesName, distinctiveNameWords, foldNameText } from '../src/services/product/nameConsistency.ts';

/** Tên chai khác mà chính mô tả này nêu đủ — bằng chứng nó thuộc về sản phẩm nào. */
function namedProducts(description: string, rows: any[], selfId: string): string[] {
  const folded = foldNameText(description);
  return rows.filter(r => {
    if (String(r._id) === selfId) return false;
    const sig = distinctiveNameWords(r.name, r.brandId?.name);
    return sig.length > 0 && sig.every(w => folded.includes(w));
  }).map(r => r.name);
}

async function main() {
  const applyFrom = process.argv.indexOf('--apply');
  const targets = applyFrom === -1 ? [] : process.argv.slice(applyFrom + 1).filter(a => !a.startsWith('--'));

  await connectDB();
  const rows = await Product.find({})
    .select('name brandId description status')
    .populate('brandId', 'name')
    .lean();

  const withDesc = rows.filter(r => (r.description || '').trim().length > 0);
  const suspects: { row: any; sig: string[]; hit: string[] }[] = [];
  for (const row of withDesc) {
    const sig = distinctiveNameWords(row.name, row.brandId?.name);
    if (sig.length === 0) continue;
    const folded = foldNameText(row.description);
    const hit = sig.filter(w => folded.includes(w));
    if (!descriptionMatchesName(row.description, sig)) suspects.push({ row, sig, hit });
  }

  console.log(`\nSản phẩm có mô tả: ${withDesc.length}/${rows.length}. Đáng ngờ: ${suspects.length}\n`);
  for (const { row, sig, hit } of suspects) {
    const preview = String(row.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const other = namedProducts(String(row.description), rows, String(row._id));
    console.log(`? ${row._id}  ${row.name}  [${row.status}]`);
    console.log(`   tu dinh dang: ${sig.join(', ')} | co trong mo ta: ${hit.join(', ') || '(khong co)'}`);
    console.log(`   trung ten chai khac trong catalog: ${other.join(' | ') || '(khong co)'}`);
    console.log(`   mo ta bat dau: "${preview}"\n`);
  }

  if (!targets.length) {
    console.log('Dry-run. Muốn dọn: npx tsx scripts/fix-mismatched-descriptions.ts --apply <_id> [...]\n');
  } else {
    const suspectIds = new Set(suspects.map(s => String(s.row._id)));
    for (const id of targets) {
      if (!suspectIds.has(id)) {
        console.log(`BO QUA ${id}: không nằm trong danh sách đáng ngờ — kiểm lại trước khi ghi.`);
        continue;
      }
      const before = await Product.findById(id).select('name description').lean();
      if (!before) { console.log(`BO QUA ${id}: không tồn tại.`); continue; }
      await Product.updateOne({ _id: id }, { $set: { description: '' } });
      console.log(`\n=== ${id} — ${before.name} ===`);
      console.log('ĐÃ XÓA mô tả lệch, nội dung cũ để admin đối chiếu:');
      console.log(String(before.description).slice(0, 600));
      console.log('--- hết ---\n');
    }
    let cleared = 0;
    // scanStream phát theo lô, không phải từng key — del(...) mà nhận mảng rỗng là redis mắng.
    for await (const batch of redis.scanStream({ match: 'graphql:*', count: 200 }) as AsyncIterable<string | string[]>) {
      const keys = (Array.isArray(batch) ? batch : [batch]).filter(Boolean);
      if (keys.length) cleared += await redis.del(...keys);
    }
    console.log(`Đã xóa ${cleared} khóa graphql:* khỏi redis (productDetail cache TTL 120s).`);
  }

  await mongoose.disconnect();
  await redis.quit();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
