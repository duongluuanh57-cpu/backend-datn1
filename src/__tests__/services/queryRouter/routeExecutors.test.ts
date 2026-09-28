import { describe, it, expect, vi } from 'vitest';

const holder = vi.hoisted(() => ({ prompt: '' }));

const mocks = vi.hoisted(() => {
  const A = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // đã gợi ý ở turn trước
  const B = 'bbbbbbbbbbbbbbbbbbbbbbbb'; // còn hàng, 1.2M
  const C = 'cccccccccccccccccccccccc'; // còn hàng, 5M (vượt khoảng giá)
  const D = 'dddddddddddddddddddddddd'; // hết hàng
  const FAKE_DOCS = [
    { _id: A, name: 'Chai A', brandName: 'Burberry', price: 1_500_000 },
    { _id: B, name: 'Chai B', brandName: 'Burberry', price: 1_200_000 },
    { _id: C, name: 'Chai C', brandName: 'Dior', price: 5_000_000 },
    { _id: D, name: 'Chai D', brandName: 'Chanel', price: 1_800_000 },
  ];
  function chain(result: any) {
    const q: any = {
      populate: () => q,
      select: () => q,
      sort: () => q,
      limit: () => q,
      lean: () => Promise.resolve(result),
    };
    return q;
  }
  let findCalls = 0;
  const findImpl = (filter: any) => {
    findCalls++;
    const nin = ((filter?._id?.$nin || []) as any[]).map(String);
    const inList = filter?._id?.$in as any[] | undefined;
    let docs = FAKE_DOCS;
    if (nin.length) docs = docs.filter((d) => !nin.includes(String(d._id)));
    if (inList) docs = docs.filter((d) => inList.map(String).includes(String(d._id)));
    return chain(docs);
  };
  return { A, B, C, D, chain, findImpl, getFindCalls: () => findCalls, resetFindCalls: () => { findCalls = 0; } };
});

// Search rỗng có chủ đích — mô phỏng câu follow-up chung chung không khớp gì trong DB
vi.mock('../../../services/SearchService.ts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/SearchService.ts')>();
  return {
    ...mod,
    SearchService: { hybridSearch: vi.fn().mockResolvedValue({ products: [], mode: 'general' }) },
  };
});

vi.mock('../../../services/AIService.ts', () => ({
  AIService: {
    createChatStream: vi.fn(async (_msgs: any, prompt: string) => {
      holder.prompt = prompt;
      return {} as any;
    }),
  },
}));

vi.mock('../../../models/Product.ts', () => ({
  Product: { find: mocks.findImpl, countDocuments: () => Promise.resolve(4) },
}));
vi.mock('../../../models/ProductVariant.ts', () => ({
  // D hết hàng
  ProductVariant: { distinct: () => Promise.resolve([mocks.B, mocks.C]) },
}));
vi.mock('../../../models/Brand.ts', () => ({
  Brand: { find: () => mocks.chain([{ name: 'Burberry', origin: 'Anh' }]) },
}));
vi.mock('../../../models/Tag.ts', () => ({
  Tag: { find: () => mocks.chain([]) },
}));
vi.mock('../../../services/product/productFormatterService.ts', () => ({
  formatMultipleProducts: vi.fn(async (docs: any[]) =>
    docs.map((d) => ({ _id: d._id, name: d.name, brand: d.brandName, price: d.price }))
  ),
}));

import { executeVectorSearch } from '../../../services/queryRouter/routeExecutors.ts';

const A = mocks.A;
const B = mocks.B;
const historyWithCards = [
  { role: 'user', content: 'tư vấn nước hoa dưới 2 triệu' },
  { role: 'assistant', content: `Bạn xem thử **Chai A** nhé :3 [CARD:${A}]` },
];

describe('routeExecutors — follow-up xin thêm không được bịa sản phẩm', () => {
  it('"Còn sản phẩm khác không" → trả hàng thật: trừ chai đã hiện, còn hàng, giữ khoảng giá cũ', async () => {
    const { products } = await executeVectorSearch('Còn sản phẩm khác không', historyWithCards as any, undefined);
    const ids = products.map((p: any) => String(p._id));
    expect(ids).toEqual([B]); // A bị trừ, D hết hàng, C vượt 2M
    expect(holder.prompt).toContain(`[CARD:${B}]`); // prompt có id thật để model chép
  });

  it('câu thường không phải follow-up + search rỗng → không chạm DB, prompt cấm bịa từ tên hãng', async () => {
    mocks.resetFindCalls();
    const { products } = await executeVectorSearch('tư vấn mùi hương mùa hè đi', [], undefined);
    expect(products).toEqual([]);
    expect(mocks.getFindCalls()).toBe(0);
    expect(holder.prompt).toContain('CẤM tự đặt tên chai');
  });
});
