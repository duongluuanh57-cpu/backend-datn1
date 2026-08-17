import type { FastifyInstance } from 'fastify';
import { redis } from '../config/redis.ts';
import { Product } from '../models/Product.ts';
import { Brand } from '../models/Brand.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';

async function safeRedisGet(key: string): Promise<string | null> {
  try {
    if (redis.status !== 'ready') return null;
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function safeRedisSet(key: string, value: string, mode: string, duration: number): Promise<void> {
  try {
    if (redis.status !== 'ready') return;
    await redis.set(key, value, mode as any, duration);
  } catch {
    // Ignore Redis error
  }
}

export async function funnelRoutes(fastify: FastifyInstance) {
  const VALID_METRICS = ['add_to_cart', 'reach_checkout', 'purchase'];

  function fmtDate(d: Date): string {
    return d.toISOString().split('T')[0];
  }

  fastify.post('/track', async (request, _reply) => {
    try {
      const { brandId, stage } = request.body as { brandId: string; stage: string };
      if (!brandId || !stage) return { success: false, message: 'Missing brandId or stage' };
      if (!VALID_METRICS.includes(stage)) return { success: false, message: 'Invalid stage' };

      const now = new Date();
      const ds = fmtDate(now);
      const hr = String(now.getHours());

      const totalKey = `funnel:total:${brandId}:${stage}`;
      const todayKey = `funnel:daily:${brandId}:${stage}:${ds}`;
      const hourKey  = `funnel:hourly:${brandId}:${stage}:${ds}:${hr}`;

      const pipe = redis.pipeline();
      pipe.incr(totalKey);
      pipe.incr(todayKey);
      pipe.expire(todayKey, 172800); // 2 days
      pipe.incr(hourKey);
      pipe.expire(hourKey, 259200); // 3 days
      await pipe.exec();

      // Do NOT invalidate funnel cache synchronously on every click to prevent cache thrashing
      return { success: true };
    } catch (error) {
      console.error('Funnel track error:', error);
      return { success: false };
    }
  });

  fastify.get('/data', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { brandId } = request.query as { brandId?: string };

      const cacheKey = brandId ? `funnel:data:${brandId}` : 'funnel:data:all';
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const brands = await Brand.find().select('_id name').lean() as any[];
      if (!brands.length) return { success: true, data: [] };

      const brandIds = brands.map(b => b._id);

      const viewAgg = await Product.aggregate([
        { $match: { brandId: { $in: brandIds } } },
        { $group: { _id: '$brandId', totalViews: { $sum: '$viewCount' } } },
      ]);
      const viewsByBrand = new Map<string, number>();
      for (const v of viewAgg) viewsByBrand.set(v._id.toString(), v.totalViews);

      const purchaseAgg = await OrderItem.aggregate([
        { $match: { brand: { $ne: '', $exists: true } } },
        { $group: { _id: '$brand', totalQty: { $sum: '$quantity' }, totalOrders: { $addToSet: '$orderId' } } },
      ]);
      const purchaseByName = new Map<string, { purchases: number; orders: number; items: number }>();
      for (const p of purchaseAgg) {
        purchaseByName.set(p._id, {
          purchases: p.totalQty,
          orders: (p.totalOrders || []).length,
          items: p.totalQty,
        });
      }

      // Redis pipeline: batch all funnel:total GETs in one round trip
      const pipe = redis.pipeline();
      for (const brand of brands) {
        pipe.get(`funnel:total:${brand._id.toString()}:add_to_cart`);
        pipe.get(`funnel:total:${brand._id.toString()}:reach_checkout`);
      }
      const pipeResults = (await pipe.exec()) || [];

      const data = [];
      const allBrands = [];
      for (let i = 0; i < brands.length; i++) {
        const brand = brands[i];
        const bid = brand._id.toString();
        const bname = brand.name;
        let addToCart = parseInt((pipeResults[i * 2]?.[1] as string) || '0', 10);
        let checkout = parseInt((pipeResults[i * 2 + 1]?.[1] as string) || '0', 10);
        const purchases = purchaseByName.get(bname)?.purchases || 0;
        let views = viewsByBrand.get(bid) || 0;

        // Backfill: if Redis counters are 0 but actual purchases exist, use OrderItem data
        const orderMeta = purchaseByName.get(bname);
        if (addToCart === 0 && orderMeta && orderMeta.items > 0) addToCart = orderMeta.items;
        if (checkout === 0 && orderMeta && orderMeta.orders > 0) checkout = orderMeta.orders;
        // Backfill views: if purchases exist but no viewCount, estimate from purchases
        if (views === 0 && purchases > 0) views = purchases * 5;

        data.push({
          brandId: bid,
          brandName: bname,
          stages: { views, addToCart, checkout, purchases },
        });
        allBrands.push({ brandId: bid, brandName: bname });
      }

      data.sort((a, b) => b.stages.views - a.stages.views);

      const resultData = brandId ? data.filter(d => d.brandId === brandId) : data;
      const result = { success: true, data: resultData, brands: allBrands };
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
      await safeRedisSet(cacheKey, JSON.stringify(result), 'EX', 600);
      return result;
    } catch (error: any) {
      console.error('Funnel data error:', error);
      return { success: true, data: [], brands: [] };
    }
  });

  fastify.get('/brand-timeseries', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { brandId, metric, days: daysStr, startDate: startStr, endDate: endStr } = request.query as { brandId?: string; metric?: string; days?: string; startDate?: string; endDate?: string };

      const m = metric && VALID_METRICS.includes(metric) ? metric : 'add_to_cart';
      const isAllBrands = !brandId || brandId === 'all';

      let now = new Date();
      let days = 7;
      let cacheKey = '';

      if (startStr && endStr) {
        const start = new Date(startStr);
        const end = new Date(endStr);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return { success: false, message: 'Ngày bắt đầu hoặc ngày kết thúc không hợp lệ' };
        }
        now = end;
        now.setHours(23, 59, 59, 999);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        days = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        cacheKey = `funnel:trend:v3:${isAllBrands ? 'all' : brandId}:${m}:range:${startStr}:${endStr}`;
      } else {
        days = Math.min(Math.max(parseInt(daysStr || '7', 10) || 7, 1), 90);
        cacheKey = `funnel:trend:v3:${isAllBrands ? 'all' : brandId}:${m}:${days}`;
      }

      const cached = await safeRedisGet(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached), cached: true };
      }

      let brandNameStr = 'Tất cả thương hiệu';
      let productIdsOfBrand: any[] = [];
      let targetBrandName = '';

      if (!isAllBrands) {
        const brand = await Brand.findById(brandId).select('name').lean() as any;
        if (!brand) return { success: false, message: 'Brand not found' };
        brandNameStr = brand.name;
        targetBrandName = brand.name;
        const productsOfBrand = await Product.find({ brandId: brand._id }).select('_id').lean();
        productIdsOfBrand = productsOfBrand.map(p => p._id);
      }

      const sinceCurrent = new Date(now);
      sinceCurrent.setDate(sinceCurrent.getDate() - days);
      sinceCurrent.setHours(0, 0, 0, 0);

      const sinceBenchmark = new Date(now);
      sinceBenchmark.setDate(sinceBenchmark.getDate() - days * 2);
      sinceBenchmark.setHours(0, 0, 0, 0);

      const orderItemMatch: any = { createdAt: { $gte: sinceBenchmark } };
      if (!isAllBrands) {
        orderItemMatch.$or = [
          { brand: targetBrandName },
          { productId: { $in: productIdsOfBrand } }
        ];
      }

      const currentMap = new Map<string, number>();
      const benchmarkMap = new Map<string, number>();
      const brandBreakdownByDate: Record<string, Array<{ brandName: string; count: number }>> = {};
      const overallBrandMap = new Map<string, number>();

      const orderItemAgg = await OrderItem.aggregate([
        { $match: orderItemMatch },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'brands', localField: 'product.brandId', foreignField: '_id', as: 'brandDoc' } },
        { $unwind: { path: '$brandDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            brandName: { $ifNull: ['$brand', '$brandDoc.name'] },
            quantity: '$quantity',
            createdAt: '$createdAt',
          }
        },
        { $match: { brandName: { $ne: '', $exists: true } } },
      ]);

      for (const item of orderItemAgg) {
        const date = item.date;
        const qty = item.quantity || 1;
        const bName = item.brandName || 'Khác';
        const itemCreated = new Date(item.createdAt);

        overallBrandMap.set(bName, (overallBrandMap.get(bName) || 0) + qty);

        if (itemCreated >= sinceCurrent) {
          currentMap.set(date, (currentMap.get(date) || 0) + qty);

          if (!brandBreakdownByDate[date]) brandBreakdownByDate[date] = [];
          const existing = brandBreakdownByDate[date].find(b => b.brandName === bName);
          if (existing) existing.count += qty;
          else brandBreakdownByDate[date].push({ brandName: bName, count: qty });
        } else {
          benchmarkMap.set(date, (benchmarkMap.get(date) || 0) + qty);

          const curTime = itemCreated.getTime() + (days * 86400000);
          const curDateKey = fmtDate(new Date(curTime));

          if (!brandBreakdownByDate[curDateKey]) brandBreakdownByDate[curDateKey] = [];
          const existingCur = brandBreakdownByDate[curDateKey].find(b => b.brandName === bName);
          if (existingCur) existingCur.count += qty;
          else brandBreakdownByDate[curDateKey].push({ brandName: bName, count: qty });

          if (!brandBreakdownByDate[date]) brandBreakdownByDate[date] = [];
          const existingBmk = brandBreakdownByDate[date].find(b => b.brandName === bName);
          if (existingBmk) existingBmk.count += qty;
          else brandBreakdownByDate[date].push({ brandName: bName, count: qty });
        }
      }

      const current: { date: string; value: number }[] = [];
      const benchmark: { date: string; value: number }[] = [];

      for (let i = days - 1; i >= 0; i--) {
        const dCur = new Date(now);
        dCur.setDate(dCur.getDate() - i);
        const ds = fmtDate(dCur);
        current.push({ date: ds, value: currentMap.get(ds) || 0 });

        const dBmk = new Date(now);
        dBmk.setDate(dBmk.getDate() - i - days);
        const bs = fmtDate(dBmk);
        benchmark.push({ date: bs, value: benchmarkMap.get(bs) || 0 });
      }

      for (const date in brandBreakdownByDate) {
        brandBreakdownByDate[date].sort((a, b) => b.count - a.count);
      }

      const overallBreakdown = Array.from(overallBrandMap.entries())
        .map(([brandName, count]) => ({ brandName, count }))
        .sort((a, b) => b.count - a.count);

      const data = {
        brandName: brandNameStr,
        metric: m,
        current,
        benchmark,
        brandBreakdown: {
          overall: overallBreakdown,
          byDate: brandBreakdownByDate,
        }
      };

      await safeRedisSet(cacheKey, JSON.stringify(data), 'EX', 300);
      return { success: true, data, cached: false };
    } catch (error: any) {
      console.error('Funnel timeseries error:', error);
      return { success: false, message: error.message };
    }
  });

  fastify.get('/brand-heatmap', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { brandId, metric, days: daysStr, startDate: startStr, endDate: endStr } = request.query as { brandId?: string; metric?: string; days?: string; startDate?: string; endDate?: string };

      const m = metric && VALID_METRICS.includes(metric) ? metric : 'purchase';
      const isAllBrands = !brandId || brandId === 'all';

      let now = new Date();
      let days = 7;
      let heatmapCacheKey = '';

      if (startStr && endStr) {
        const start = new Date(startStr);
        const end = new Date(endStr);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return { success: false, message: 'Ngày bắt đầu hoặc ngày kết thúc không hợp lệ' };
        }
        now = end;
        now.setHours(23, 59, 59, 999);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        days = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        heatmapCacheKey = `funnel:heatmap:v3:${isAllBrands ? 'all' : brandId}:${m}:range:${startStr}:${endStr}`;
      } else {
        days = Math.min(Math.max(parseInt(daysStr || '7', 10) || 7, 7), 90);
        heatmapCacheKey = `funnel:heatmap:v3:${isAllBrands ? 'all' : brandId}:${m}:${days}`;
      }

      const heatmapCached = await safeRedisGet(heatmapCacheKey);
      if (heatmapCached) return JSON.parse(heatmapCached);

      let brandNameStr = 'Tất cả thương hiệu';
      let productIdsOfBrand: any[] = [];
      let targetBrandName = '';

      if (!isAllBrands) {
        const brand = await Brand.findById(brandId).select('name').lean() as any;
        if (!brand) return { success: false, message: 'Brand not found' };
        brandNameStr = brand.name;
        targetBrandName = brand.name;
        const productsOfBrand = await Product.find({ brandId: brand._id }).select('_id').lean();
        productIdsOfBrand = productsOfBrand.map(p => p._id);
      }

      const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      const hours: number[] = [];
      for (let i = 0; i < 24; i++) hours.push(i);
      const matrix: number[][] = hours.map(() => Array(7).fill(0));
      let maxVal = 0;

      const since = new Date(now);
      since.setDate(since.getDate() - days);
      since.setHours(0, 0, 0, 0);

      const orderItemMatch: any = { createdAt: { $gte: since, $lte: now } };
      if (!isAllBrands) {
        orderItemMatch.$or = [
          { brand: targetBrandName },
          { productId: { $in: productIdsOfBrand } }
        ];
      }

      const brandBreakdownByHour: Record<number, Array<{ brandName: string; count: number }>> = {};
      const brandBreakdownByDay: Record<number, Array<{ brandName: string; count: number }>> = {};
      const heatmapOverallMap = new Map<string, number>();

      const itemsAgg = await OrderItem.aggregate([
        { $match: orderItemMatch },
        { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'brands', localField: 'product.brandId', foreignField: '_id', as: 'brandDoc' } },
        { $unwind: { path: '$brandDoc', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            dow: { $dayOfWeek: '$createdAt' },
            hour: { $hour: '$createdAt' },
            brandName: { $ifNull: ['$brand', '$brandDoc.name'] },
            quantity: '$quantity',
          }
        },
        { $match: { brandName: { $ne: '', $exists: true } } },
      ]);

      for (const item of itemsAgg) {
        let d = item.dow - 2;
        if (d < 0) d = 6; // 0=Mon..6=Sun
        const h = item.hour;
        const qty = item.quantity || 1;
        const bName = item.brandName || 'Khác';

        if (h >= 0 && h < 24 && d >= 0 && d < 7) {
          matrix[h][d] += qty;
          if (matrix[h][d] > maxVal) maxVal = matrix[h][d];

          if (!brandBreakdownByHour[h]) brandBreakdownByHour[h] = [];
          const existingH = brandBreakdownByHour[h].find(b => b.brandName === bName);
          if (existingH) existingH.count += qty;
          else brandBreakdownByHour[h].push({ brandName: bName, count: qty });

          if (!brandBreakdownByDay[d]) brandBreakdownByDay[d] = [];
          const existingD = brandBreakdownByDay[d].find(b => b.brandName === bName);
          if (existingD) existingD.count += qty;
          else brandBreakdownByDay[d].push({ brandName: bName, count: qty });

          heatmapOverallMap.set(bName, (heatmapOverallMap.get(bName) || 0) + qty);
        }
      }

      for (const h in brandBreakdownByHour) brandBreakdownByHour[h].sort((a, b) => b.count - a.count);
      for (const d in brandBreakdownByDay) brandBreakdownByDay[d].sort((a, b) => b.count - a.count);

      const overallBreakdown = Array.from(heatmapOverallMap.entries())
        .map(([brandName, count]) => ({ brandName, count }))
        .sort((a, b) => b.count - a.count);

      const result = {
        success: true,
        data: {
          brandName: brandNameStr,
          metric: m,
          days: dayLabels,
          hours,
          matrix,
          max: maxVal || 1,
          brandBreakdown: {
            overall: overallBreakdown,
            byHour: brandBreakdownByHour,
            byDay: brandBreakdownByDay,
          }
        },
      };

      await safeRedisSet(heatmapCacheKey, JSON.stringify(result), 'EX', 600);
      return result;
    } catch (error: any) {
      console.error('Funnel heatmap error:', error);
      return { success: false, message: error.message };
    }
  });

  fastify.get('/brand-retention', { preHandler: adminAuthMiddleware }, async (_request, _reply) => {
    try {
      const cacheKey = 'funnel:retention:90d';
      const cached = await safeRedisGet(cacheKey);
      if (cached) return { success: true, data: JSON.parse(cached), cached: true };

      const since = new Date();
      since.setDate(since.getDate() - 90);
      const items = await OrderItem.aggregate([
        { $match: { brand: { $ne: '', $exists: true }, createdAt: { $gte: since } } },
        { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', pipeline: [{ $project: { userId: 1, 'shippingInfo.customerName': 1 } }], as: 'order' } },
        { $unwind: '$order' },
        { $match: { 'order.userId': { $exists: true } } },
        { $project: {
          brand: 1,
          userId: { $ifNull: ['$order.userId', { $concat: ['guest:', '$order.shippingInfo.customerName'] }] },
          revenue: { $multiply: [{ $toDouble: '$price' }, { $toDouble: '$quantity' }] },
          createdAt: 1,
        }},
      ]);

      // Find first purchase date per (userId, brand)
      const firstPurchase = new Map<string, Date>();
      for (const item of items) {
        const key = item.userId.toString() + ':' + item.brand;
        if (!firstPurchase.has(key) || item.createdAt < firstPurchase.get(key)!) {
          firstPurchase.set(key, item.createdAt);
        }
      }

      // Aggregate revenue by brand + segment
      const brandMap = new Map<string, { new: number; returning: number }>();
      for (const item of items) {
        const key = item.userId.toString() + ':' + item.brand;
        const isNew = item.createdAt.getTime() === firstPurchase.get(key)!.getTime();
        if (!brandMap.has(item.brand)) brandMap.set(item.brand, { new: 0, returning: 0 });
        const entry = brandMap.get(item.brand)!;
        if (isNew) entry.new += item.revenue;
        else entry.returning += item.revenue;
      }

      const data = Array.from(brandMap.entries())
        .map(([brandName, rev]) => ({ brandName, new: Math.round(rev.new), returning: Math.round(rev.returning) }))
        .sort((a, b) => (b.new + b.returning) - (a.new + a.returning))
        .slice(0, 15);

      await redis.set(cacheKey, JSON.stringify(data), 'EX', 300);

      return { success: true, data, cached: false };
    } catch (error: any) {
      console.error('Funnel retention error:', error);
      return { success: true, data: [] };
    }
  });
}
