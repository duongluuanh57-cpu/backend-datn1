import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// Ghi lại arg của .sort() để khẳng định getFavorites sort theo _id (F2).
let sortArg: any = null;
let favoriteRows: any[] = [];

vi.mock('../../models/Favorite.ts', () => ({
  Favorite: {
    find: vi.fn(() => ({
      populate: () => ({
        sort: (arg: any) => {
          sortArg = arg;
          return { lean: () => Promise.resolve(favoriteRows) };
        },
      }),
    })),
  },
}));

vi.mock('../../models/ProductVariant.ts', () => ({
  ProductVariant: { find: vi.fn(() => ({ lean: () => Promise.resolve([]) })) },
}));

vi.mock('../../models/ProductImage.ts', () => ({
  ProductImage: { find: vi.fn(() => ({ select: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) }) })) },
}));

vi.mock('../../models/Review.ts', () => ({
  Review: { aggregate: vi.fn(() => Promise.resolve([])) },
}));

import { FavoriteController } from '../../controllers/favoriteController.ts';

const UID = new mongoose.Types.ObjectId().toString();

function makeReq() {
  return { user: { userId: UID } } as any;
}
function makeReply() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  sortArg = null;
  favoriteRows = [];
});

describe('FavoriteController.getFavorites', () => {
  it('sort theo _id giảm dần (createdAt không tồn tại vì timestamps:false)', async () => {
    favoriteRows = [
      { _id: 'f1', productId: { _id: new mongoose.Types.ObjectId(), name: 'A', discountPercentage: 0 } },
    ];
    const reply = makeReply();
    await FavoriteController.getFavorites(makeReq(), reply);
    expect(sortArg).toEqual({ _id: -1 });
  });

  it('lọc bỏ favorite mồ côi (product đã bị xóa → productId null)', async () => {
    const validId = new mongoose.Types.ObjectId();
    favoriteRows = [
      { _id: 'f1', productId: { _id: validId, name: 'A', discountPercentage: 0 } },
      { _id: 'f2', productId: null },
    ];
    const reply = makeReply();
    await FavoriteController.getFavorites(makeReq(), reply);
    expect(reply.body.success).toBe(true);
    expect(reply.body.data).toHaveLength(1);
    expect(reply.body.data[0]._id).toBe('f1');
  });

  it('chưa đăng nhập → 401', async () => {
    const reply = makeReply();
    await FavoriteController.getFavorites({} as any, reply);
    expect(reply.statusCode).toBe(401);
  });
});
