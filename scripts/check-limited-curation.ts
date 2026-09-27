import 'dotenv/config';
import mongoose from 'mongoose';
import { ProductTag } from '../src/models/ProductTag.ts';
import { Tag } from '../src/models/Tag.ts';
import { Product } from '../src/models/Product.ts';
import { ProductVariant } from '../src/models/ProductVariant.ts';
import { findLimitedProductIds, LIMITED_TAG_QUERY, TAG_RULES } from '../src/services/product/tagRules.ts';

async function main() {
  await mongoose.connect(process.env.MONGO_URI!);

  const limitedTag = await Tag.findOne(LIMITED_TAG_QUERY).lean();
  if (!limitedTag) { console.log('KHONG CO Tag Limited'); return; }
  console.log(`Tag Limited: ${limitedTag.slug} (${limitedTag._id})`);

  const links = await ProductTag.find({ tagId: limitedTag._id }).select('productId source').lean();
  const bySource: Record<string, number> = {};
  for (const l of links) bySource[String((l as any).source)] = (bySource[String((l as any).source)] || 0) + 1;
  console.log(`So link Limited theo source: ${JSON.stringify(bySource)}`);

  const ids = links.map(l => l.productId);
  const stockRows = await ProductVariant.aggregate([
    { $match: { productId: { $in: ids } } },
    { $group: { _id: '$productId', total: { $sum: '$quantityInStock' } } },
  ]);
  const stockOf = new Map(stockRows.map(r => [String(r._id), Number(r.total) || 0]));

  const qualifying = new Set((await findLimitedProductIds()).map(String));
  const manual = links.filter(l => (l as any).source === 'manual');
  const autoOutsideRule = links.filter(l => (l as any).source !== 'manual' && !qualifying.has(String(l.productId)));
  console.log(`Dat luat ton kho <= ${TAG_RULES.limitedMaxTotalStock}: ${qualifying.size}`);
  console.log(`Link manual: ${manual.length}`);
  console.log(`Link auto NGOAI luat (se bi sync go): ${autoOutsideRule.length}`);

  const sample = ids.slice(0, 12).map(id => {
    const s = stockOf.get(String(id)) ?? 0;
    return `${String(id).slice(-6)} stock=${s} source=${(links.find(l => String(l.productId) === String(id)) as any)?.source ?? 'null'}`;
  });
  console.log('Mau:\n  ' + sample.join('\n  '));

  const draft = await Product.countDocuments({ status: 'draft' });
  const active = await Product.countDocuments({ status: 'active' });
  console.log(`Product active=${active} draft=${draft}`);
  await mongoose.disconnect();
}
main();
