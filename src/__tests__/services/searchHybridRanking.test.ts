import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// Catalog thật: mọi soldCount = 0, nên sort theo "bán chạy" cho ra thứ tự ngẫu nhiên.
// Dataset này dựng đúng tình huống đó để đo thứ hạng trả về.
const CREED_DOCS = [
  'Creed Royal Princess Oud Millésime EDP',
  'Creed Queen Of Silk EDP',
  'Creed Aventus Absolu Limited Edition EDP',
  'Creed Carmina EDP',
  'Creed Spring Flower EDP',
  'Creed Green Irish Tweed EDP',
  'Creed Millésime Impérial EDP',
  'Creed Love In White EDP',
  'Creed Viking EDP',
  'Creed Eladaria EDP',
].map((name, i) => ({
  _id: `6a0d769c8b1bfc212bc797${String(i).padStart(2, '0')}`,
  name,
  brand: 'Creed',
  price: 8_000_000 + i,
  soldCount: 0,
  rating: 0,
  description: '',
  images: [],
  status: 'active',
}));

const chain = (docs: any[]) => ({
  select: () => chain(docs),
  sort: () => chain(docs),
  limit: () => chain(docs),
  populate: () => chain(docs),
  lean: async () => docs,
});

vi.mock('../../models/Product.ts', () => ({
  Product: {
    find: vi.fn((q: any) => chain(q?.$text ? [] : CREED_DOCS)),
    countDocuments: vi.fn(async () => CREED_DOCS.length),
  },
}));

vi.mock('../../models/Brand.ts', () => ({
  Brand: { find: vi.fn(() => chain([{ _id: 'brand-creed', name: 'Creed', origin: 'Anh' }])) },
}));

vi.mock('../../models/ProductVariant.ts', () => ({
  ProductVariant: {
    aggregate: vi.fn(async () => []),
    distinct: vi.fn(async () => CREED_DOCS.map((d) => d._id)),
  },
}));

vi.mock('../../services/VectorSearchService.ts', () => ({
  VectorSearchService: {
    searchProducts: vi.fn(async () => []),
    rrfMerge: vi.fn(() => []),
  },
}));

import { SearchService } from '../../services/SearchService.ts';

let mongooseCollectionAggregate: any;

beforeEach(() => {
  vi.clearAllMocks();
  mongooseCollectionAggregate = vi.fn((pipeline: any[]) => ({
    toArray: async () => {
      // Mô phỏng Mongo: khớp $or các regex name, không neo đầu chuỗi thì phải tìm thấy ở giữa tên.
      const conds = (pipeline[0]?.$match?.$or ?? []).map((c: any) => c.name.$regex as string);
      const hit = CREED_DOCS.filter((d) =>
        conds.some((src: string) => new RegExp(src, 'i').test(d.name))
      );
      return hit.map((d) => ({ ...d, brandData: { name: 'Creed' } }));
    },
  }));
  Object.defineProperty(mongoose.connection, 'db', {
    configurable: true,
    get: () => ({ collection: () => ({ aggregate: mongooseCollectionAggregate }) }),
  });
});

describe('hybridSearch — hạng theo mức khớp tên, không ngẫu nhiên', () => {
  it('khách gọi đích danh chai nằm cuối catalog vẫn phải về đầu kết quả', async () => {
    const { products } = await SearchService.hybridSearch('Cho tôi xem chai Creed Eladaria EDP', 4);

    expect(products[0].name).toBe('Creed Eladaria EDP');
  });

  it('cùng một câu hỏi hai lần ra cùng thứ tự (không xáo trộn nữa)', async () => {
    const a = await SearchService.hybridSearch('Liệt kê 3 chai nước hoa Creed đang có sẵn, kèm giá', 4);
    const b = await SearchService.hybridSearch('Liệt kê 3 chai nước hoa Creed đang có sẵn, kèm giá', 4);

    expect(a.products.map((p: any) => p.name)).toEqual(b.products.map((p: any) => p.name));
    expect(a.products.length).toBeGreaterThan(0);
  });

  it('từ khóa nằm giữa tên ("eladaria" trong "Creed Eladaria EDP") không bị neo ^ loại bỏ', async () => {
    await SearchService.hybridSearch('cho tôi chai eladaria', 4);

    const pipeline = mongooseCollectionAggregate.mock.calls.at(-1)[0];
    const nameSources = (pipeline[0].$match.$or ?? []).map((c: any) => String(c.name?.$regex ?? ''));
    expect(nameSources.some((src: string) => src.startsWith('^'))).toBe(false);
    expect(nameSources).toContain('eladaria');
  });

  it('khi câu chỉ toàn từ thừa thì quay về regex prefix, không quét vô hạn định', async () => {
    await SearchService.hybridSearch('hoa chai', 4);

    const pipeline = mongooseCollectionAggregate.mock.calls.at(-1)[0];
    const nameSources = (pipeline[0].$match.$or ?? []).map((c: any) => String(c.name?.$regex ?? ''));
    expect(nameSources.every((src: string) => src.startsWith('^'))).toBe(true);
  });
});
