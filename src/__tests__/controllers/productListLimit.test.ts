import { describe, it, expect, vi, beforeEach } from 'vitest';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ _id: `p${i}`, name: `Product ${i}` }));

vi.mock('../../services/ProductService.ts', () => ({
  ProductService: {
    getLimitedProducts: vi.fn(async () => items(7)),
    getSaleProducts: vi.fn(async () => items(120)),
  },
}));
vi.mock('../../models/Product.ts', () => ({ Product: {} }));
vi.mock('../../models/Brand.ts', () => ({ Brand: {} }));
vi.mock('../../models/ProductImage.ts', () => ({ ProductImage: {} }));

import { ProductController } from '../../controllers/product/productController.ts';
import { ProductService } from '../../services/ProductService.ts';

function fakeReply() {
  const reply: any = {
    payload: null,
    status(code: number) { reply.code = code; return reply; },
    send(body: any) { reply.payload = body; return reply; },
  };
  return reply;
}

async function call(handler: 'getLimitedProducts' | 'getSaleProducts', query: any) {
  const reply = fakeReply();
  await (ProductController as any)[handler]({ query } as any, reply);
  return reply.payload.data;
}

beforeEach(() => vi.clearAllMocks());

describe('/api/products/limited và /sale — query limit phải được tôn trọng', () => {
  it('không truyền limit thì trả nguyên danh sách (homepage cần đủ)', async () => {
    expect(await call('getLimitedProducts', {})).toHaveLength(7);
  });

  it('limit=3 chỉ còn 3 chai', async () => {
    expect(await call('getLimitedProducts', { limit: '3' })).toHaveLength(3);
  });

  it('limit rác hoặc <=0 bị coi như không truyền', async () => {
    expect(await call('getLimitedProducts', { limit: 'abc' })).toHaveLength(7);
    expect(await call('getLimitedProducts', { limit: '0' })).toHaveLength(7);
    expect(await call('getLimitedProducts', { limit: '-5' })).toHaveLength(7);
  });

  it('limit quá trần bị chặn ở 100, không cho kéo cả DB', async () => {
    expect(await call('getSaleProducts', { limit: '100000' })).toHaveLength(100);
  });
});
