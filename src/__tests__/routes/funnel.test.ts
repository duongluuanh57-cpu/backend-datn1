import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import mongoose from 'mongoose';
import { funnelRoutes } from '../../routes/funnel.routes.ts';
import { Brand } from '../../models/Brand.ts';
import { Category } from '../../models/Category.ts';
import { Product } from '../../models/Product.ts';
import { OrderItem } from '../../models/OrderItem.ts';
import { redis } from '../../config/redis.ts';

// Mock adminAuthMiddleware to pass through
vi.mock('../../middleware/adminAuthMiddleware.ts', () => ({
  adminAuthMiddleware: (_req: any, _reply: any, done: Function) => done(),
}));

const TEST_TENANT = 'default';
let testBrandId: mongoose.Types.ObjectId;
let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  // Clear stale funnel cache
  await redis.del('funnel:data:all');

  // Create test brand
  const brand = await Brand.create({
    name: 'Funnel Test Brand',
    tenantId: TEST_TENANT,
  });
  testBrandId = brand._id as mongoose.Types.ObjectId;

  // Create test product with views
  await Product.create({
    name: 'Funnel Product 1',
    brandId: testBrandId,
    brand: 'Funnel Test Brand',
    tenantId: TEST_TENANT,
    description: 'Test',
    viewCount: 100,
  });
  await Product.create({
    name: 'Funnel Product 2',
    brandId: testBrandId,
    brand: 'Funnel Test Brand',
    tenantId: TEST_TENANT,
    description: 'Test',
    viewCount: 50,
  });

  // Create test OrderItem for purchase aggregation
  const orderId = new mongoose.Types.ObjectId();
  await OrderItem.create({
    tenantId: TEST_TENANT,
    orderId,
    productId: new mongoose.Types.ObjectId(),
    name: 'Sold Item',
    price: 200000,
    quantity: 3,
    brand: 'Funnel Test Brand',
    createdAt: new Date(),
  });

  // Setup Fastify
  app = Fastify();
  await app.register(funnelRoutes, { prefix: '/api/funnel' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await Product.deleteMany({ brandId: testBrandId });
  await Brand.deleteMany({ _id: testBrandId });
  await OrderItem.deleteMany({ brand: 'Funnel Test Brand' });
});

describe('Funnel Routes — /api/funnel/data', () => {
  it('should return brand data with view counts from products', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/funnel/data',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const brandData = body.data.find((d: any) => d.brandName === 'Funnel Test Brand');
    expect(brandData).toBeDefined();
    expect(brandData.stages.views).toBe(150); // 100 + 50
    expect(brandData.stages.purchases).toBe(3); // quantity sum from OrderItem
  });

  it('should filter by brandId when provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/funnel/data?brandId=${testBrandId.toString()}`,
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].brandId).toBe(testBrandId.toString());
  });

  it('should return sorted by views descending', async () => {
    // Create a second brand with fewer views
    const brand2 = await Brand.create({ name: 'Low View Brand', tenantId: TEST_TENANT });
    await Product.create({
      name: 'Low View Product',
      brandId: brand2._id,
      brand: 'Low View Brand',
      tenantId: TEST_TENANT,
      description: 'Test',
      viewCount: 5,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/funnel/data',
    });
    const body = JSON.parse(res.body);
    const views = body.data.map((d: any) => d.stages.views);
    expect(views).toEqual([...views].sort((a: number, b: number) => b - a));
    await Brand.deleteMany({ _id: brand2._id });
    await Product.deleteMany({ brandId: brand2._id });
  });
});

describe('Funnel Routes — /api/funnel/brand-timeseries', () => {
  it('should return system-wide data when brandId is omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/funnel/brand-timeseries',
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.brandName).toBe('Tất cả thương hiệu');
  });

  it('should return time series for a valid brand', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/funnel/brand-timeseries?brandId=${testBrandId.toString()}&metric=purchase&days=3`,
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.current).toHaveLength(3);
    expect(body.data.benchmark).toHaveLength(3);
    expect(body.data.brandName).toBe('Funnel Test Brand');
  });
});

describe('Funnel Routes — /api/funnel/brand-heatmap', () => {
  it('should return system-wide data when brandId is omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/funnel/brand-heatmap',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.brandName).toBe('Tất cả thương hiệu');
  });

  it('should return heatmap matrix for purchase metric', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/funnel/brand-heatmap?brandId=${testBrandId.toString()}&metric=purchase&days=7`,
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.matrix).toHaveLength(24);
    expect(body.data.matrix[0]).toHaveLength(7);
    expect(body.data.max).toBeGreaterThanOrEqual(1);
  });
});

describe('Funnel Routes — /api/funnel/brand-retention', () => {
  it('should return retention data', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/funnel/brand-retention',
    });
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
