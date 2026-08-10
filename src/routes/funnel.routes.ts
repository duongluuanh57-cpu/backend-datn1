import type { FastifyInstance } from 'fastify';
import { redis } from '../config/redis.ts';
import { Product } from '../models/Product.ts';
import { Brand } from '../models/Brand.ts';
import { OrderItem } from '../models/OrderItem.ts';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.ts';

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

      const totalKey = `funnel:total:${brandId}:${stage}`;
      const todayKey = `funnel:daily:${brandId}:${stage}:${fmtDate(new Date())}`;

      await redis.incr(totalKey);
      await redis.incr(todayKey);
      await redis.expire(todayKey, 172800);

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
      return result;
    } catch (error: any) {
      console.error('Funnel data error:', error);
      return { success: true, data: [], brands: [] };
    }
  });

  fastify.get('/brand-timeseries', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { brandId, metric, days: daysStr } = request.query as { brandId?: string; metric?: string; days?: string };
      if (!brandId) return { success: false, message: 'Missing brandId' };

      const m = metric && VALID_METRICS.includes(metric) ? metric : 'add_to_cart';
      const days = Math.min(Math.max(parseInt(daysStr || '7', 10) || 7, 1), 60);

      // Check server cache
      const cacheKey = `funnel:trend:cache:${brandId}:${m}:${days}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return { success: true, data: JSON.parse(cached), cached: true };
      }

      const brand = await Brand.findById(brandId).select('name').lean() as any;
      if (!brand) return { success: false, message: 'Brand not found' };

      const now = new Date();
      const current: { date: string; value: number }[] = [];
      const benchmark: { date: string; value: number }[] = [];

      if (m === 'purchase') {
        // MongoDB aggregation for purchase (reliable, complete history)
        const since = new Date(now);
        since.setDate(since.getDate() - days * 2);
        since.setHours(0, 0, 0, 0);
        const orders = await OrderItem.aggregate([
          { $match: { brand: brand.name, createdAt: { $gte: since } } },
          { $project: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, qty: '$quantity' } },
          { $group: { _id: '$date', total: { $sum: '$qty' } } },
        ]);
        const dayMap = new Map<string, number>();
        for (const o of orders) dayMap.set(o._id, o.total);

        for (let i = days - 1; i >= 0; i--) {
          const dCur = new Date(now);
          dCur.setDate(dCur.getDate() - i);
          const ds = fmtDate(dCur);
          current.push({ date: ds, value: dayMap.get(ds) || 0 });

          const dBmk = new Date(now);
          dBmk.setDate(dBmk.getDate() - i - days);
          const bs = fmtDate(dBmk);
          benchmark.push({ date: bs, value: dayMap.get(bs) || 0 });
        }
      } else {
        // Redis pipeline for add_to_cart / reach_checkout
        const pipe = redis.pipeline();
        for (let i = days - 1; i >= 0; i--) {
          const dCur = new Date(now);
          dCur.setDate(dCur.getDate() - i);
          pipe.get(`funnel:daily:${brandId}:${m}:${fmtDate(dCur)}`);

          const dBmk = new Date(now);
          dBmk.setDate(dBmk.getDate() - i - days);
          pipe.get(`funnel:daily:${brandId}:${m}:${fmtDate(dBmk)}`);
        }
        const results = (await pipe.exec()) || [];

        // Check if Redis has any data; if all zero, backfill from OrderItem
        let allZero = true;
        for (let i = 0; i < days; i++) {
          const curVal = parseInt((results[i * 2]?.[1] as string) || '0', 10);
          const bmkVal = parseInt((results[i * 2 + 1]?.[1] as string) || '0', 10);
          if (curVal > 0 || bmkVal > 0) { allZero = false; break; }
        }

        if (allZero) {
          // Backfill from OrderItem
          const since = new Date(now);
          since.setDate(since.getDate() - days * 2);
          since.setHours(0, 0, 0, 0);

          if (m === 'add_to_cart') {
            // add_to_cart: sum quantity per day
            const agg = await OrderItem.aggregate([
              { $match: { brand: brand.name, createdAt: { $gte: since } } },
              { $project: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, qty: '$quantity' } },
              { $group: { _id: '$date', total: { $sum: '$qty' } } },
            ]);
            const dayMap = new Map<string, number>();
            for (const o of agg) dayMap.set(o._id, o.total);
            for (let i = days - 1; i >= 0; i--) {
              const dCur = new Date(now);
              dCur.setDate(dCur.getDate() - i);
              const ds = fmtDate(dCur);
              current.push({ date: ds, value: dayMap.get(ds) || 0 });
              const dBmk = new Date(now);
              dBmk.setDate(dBmk.getDate() - i - days);
              const bs = fmtDate(dBmk);
              benchmark.push({ date: bs, value: dayMap.get(bs) || 0 });
            }
          } else {
            // reach_checkout: count distinct orders per day
            const agg = await OrderItem.aggregate([
              { $match: { brand: brand.name, createdAt: { $gte: since } } },
              { $project: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orderId: 1 } },
              { $group: { _id: { date: '$date', orderId: '$orderId' } } },
              { $group: { _id: '$_id.date', total: { $sum: 1 } } },
            ]);
            const dayMap = new Map<string, number>();
            for (const o of agg) dayMap.set(o._id, o.total);
            for (let i = days - 1; i >= 0; i--) {
              const dCur = new Date(now);
              dCur.setDate(dCur.getDate() - i);
              const ds = fmtDate(dCur);
              current.push({ date: ds, value: dayMap.get(ds) || 0 });
              const dBmk = new Date(now);
              dBmk.setDate(dBmk.getDate() - i - days);
              const bs = fmtDate(dBmk);
              benchmark.push({ date: bs, value: dayMap.get(bs) || 0 });
            }
          }
        } else {
          for (let i = 0; i < days; i++) {
            const curVal = parseInt((results[i * 2]?.[1] as string) || '0', 10);
            const dCur = new Date(now);
            dCur.setDate(dCur.getDate() - (days - 1 - i));
            current.push({ date: fmtDate(dCur), value: curVal });

            const bmkVal = parseInt((results[i * 2 + 1]?.[1] as string) || '0', 10);
            const dBmk = new Date(now);
            dBmk.setDate(dBmk.getDate() - (days - 1 - i) - days);
            benchmark.push({ date: fmtDate(dBmk), value: bmkVal });
          }
        }
      }

      const data = { brandName: brand.name, metric: m, current, benchmark };

      // Cache result for 30 min
      await redis.set(cacheKey, JSON.stringify(data), 'EX', 300);

      return { success: true, data, cached: false };
    } catch (error: any) {
      console.error('Funnel timeseries error:', error);
      return { success: false, message: error.message };
    }
  });

  fastify.get('/brand-heatmap', { preHandler: adminAuthMiddleware }, async (request, _reply) => {
    try {
      const { brandId, metric, days: daysStr } = request.query as { brandId?: string; metric?: string; days?: string };
      if (!brandId) return { success: false, message: 'Missing brandId' };

      const m = metric && VALID_METRICS.includes(metric) ? metric : 'purchase';
      const days = Math.min(Math.max(parseInt(daysStr || '28', 10) || 28, 7), 90);

      const heatmapCacheKey = `funnel:heatmap:${brandId}:${m}:${days}`;
      const heatmapCached = await redis.get(heatmapCacheKey);
      if (heatmapCached) return JSON.parse(heatmapCached);

      const brand = await Brand.findById(brandId).select('name').lean() as any;
      if (!brand) return { success: false, message: 'Brand not found' };

      const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      const hours: number[] = [];
      for (let i = 0; i < 24; i++) hours.push(i);
      const matrix: number[][] = hours.map(() => Array(7).fill(0));
      let maxVal = 0;

      const now = new Date();
      // Build from OrderItem aggregation for purchase
      if (m === 'purchase') {
        const since = new Date(now);
        since.setDate(since.getDate() - days);
        const orders = await OrderItem.aggregate([
          { $match: { brand: brand.name, createdAt: { $gte: since } } },
          { $project: { dow: { $dayOfWeek: '$createdAt' }, hour: { $hour: '$createdAt' }, qty: '$quantity' } },
          { $group: { _id: { dow: '$dow', hour: '$hour' }, total: { $sum: '$qty' } } },
        ]);
        for (const o of orders) {
          // $dayOfWeek: 1=Sun..7=Sat → map to 0=Mon..6=Sun
          let d = o._id.dow - 2;
          if (d < 0) d = 6;
          const h = o._id.hour;
          if (h >= 0 && h < 24) {
            matrix[h][d] += o.total;
            if (matrix[h][d] > maxVal) maxVal = matrix[h][d];
          }
        }
      }

      // Redis pipeline: batch all hourly keys in one round trip
      if (m !== 'purchase') {
        const pipe = redis.pipeline();
        for (let i = 0; i < days; i++) {
          const d = new Date(now);
          d.setDate(d.getDate() - (days - 1 - i));
          const ds = fmtDate(d);
          for (let h = 0; h < 24; h++) {
            pipe.get(`funnel:hourly:${brandId}:${m}:${ds}:${h}`);
          }
        }
        const results = (await pipe.exec()) || [];

        // Check if Redis has any data; if all zero, backfill from OrderItem
        let allZero = true;
        for (let r = 0; r < results.length; r++) {
          const val = parseInt((results[r]?.[1] as string) || '0', 10);
          if (val > 0) { allZero = false; break; }
        }

        if (allZero) {
          // Backfill from OrderItem aggregation by hour+day
          const since = new Date(now);
          since.setDate(since.getDate() - days);
          const agg = await OrderItem.aggregate([
            { $match: { brand: brand.name, createdAt: { $gte: since } } },
            { $project: { dow: { $dayOfWeek: '$createdAt' }, hour: { $hour: '$createdAt' }, qty: '$quantity' } },
            { $group: { _id: { dow: '$dow', hour: '$hour' }, total: { $sum: '$qty' } } },
          ]);
          for (const o of agg) {
            let d = o._id.dow - 2;
            if (d < 0) d = 6;
            const h = o._id.hour;
            if (h >= 0 && h < 24) {
              matrix[h][d] += o.total;
              if (matrix[h][d] > maxVal) maxVal = matrix[h][d];
            }
          }
        } else {
          for (let i = 0; i < days; i++) {
            const d = new Date(now);
            d.setDate(d.getDate() - (days - 1 - i));
            const dow = d.getDay();
            let col = dow - 1;
            if (col < 0) col = 6;
            for (let h = 0; h < 24; h++) {
              const val = parseInt((results[i * 24 + h]?.[1] as string) || '0', 10);
              if (val > 0) {
                matrix[h][col] += val;
                if (matrix[h][col] > maxVal) maxVal = matrix[h][col];
              }
            }
          }
        }
      }

      const result = {
        success: true,
        data: { brandName: brand.name, metric: m, days: dayLabels, hours, matrix, max: maxVal || 1 },
      };
      await redis.set(heatmapCacheKey, JSON.stringify(result), 'EX', 600);
      return result;
    } catch (error: any) {
      console.error('Funnel heatmap error:', error);
      return { success: false, message: error.message };
    }
  });

  fastify.get('/brand-retention', { preHandler: adminAuthMiddleware }, async (_request, _reply) => {
    try {
      const cacheKey = 'funnel:retention:90d';
      const cached = await redis.get(cacheKey);
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
