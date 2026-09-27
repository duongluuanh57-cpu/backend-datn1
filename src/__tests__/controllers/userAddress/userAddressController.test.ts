import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// Mock 2 model mà controller chạm tới. Giữ trạng thái trong biến để mỗi test set lại.
let countResult = 0;
let deletedDoc: any = null;
let nextDefaultDoc: any = null;
let updatedDoc: any = null;

const updateMany = vi.fn((_f: any, _u: any) => Promise.resolve({ acknowledged: true }));
const updateOne = vi.fn((_f: any, _u: any) => Promise.resolve({ acknowledged: true }));
const create = vi.fn((doc: any) => Promise.resolve({ _id: new mongoose.Types.ObjectId(), ...doc }));
const findOneAndUpdate = vi.fn((_f: any, _u: any, _o?: any) => Promise.resolve(updatedDoc));
const findOneAndDelete = vi.fn((_f: any) => Promise.resolve(deletedDoc));

vi.mock('../../../models/User.ts', () => ({
  User: { findById: vi.fn(() => ({ lean: () => Promise.resolve({ _id: 'u' }) })) },
}));

vi.mock('../../../models/UserAddress.ts', () => ({
  UserAddress: {
    find: vi.fn(() => ({ sort: () => ({ lean: () => Promise.resolve([]) }) })),
    countDocuments: vi.fn(() => Promise.resolve(countResult)),
    create: (doc: any) => create(doc),
    updateMany: (f: any, u: any) => updateMany(f, u),
    updateOne: (f: any, u: any) => updateOne(f, u),
    findOneAndUpdate: (f: any, u: any, o: any) => findOneAndUpdate(f, u, o),
    findOneAndDelete: (f: any) => findOneAndDelete(f),
    findOne: vi.fn(() => ({ sort: () => Promise.resolve(nextDefaultDoc) })),
  },
}));

import { UserAddressController } from '../../../controllers/userAddress/userAddressController.ts';

const UID = new mongoose.Types.ObjectId().toString();
const AID = new mongoose.Types.ObjectId().toString();

function makeReq(over: any = {}) {
  return { user: { userId: UID }, params: { id: AID }, body: {}, ...over } as any;
}
function makeReply() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  countResult = 0;
  deletedDoc = null;
  nextDefaultDoc = null;
  updatedDoc = { _id: AID, isDefault: true };
});

describe('UserAddressController — default logic', () => {
  it('địa chỉ đầu tiên tự thành isDefault', async () => {
    countResult = 0;
    const reply = makeReply();
    await UserAddressController.createAddress(makeReq({ body: { fullName: 'A' } }), reply);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    expect(reply.statusCode).toBe(201);
  });

  it('địa chỉ thứ hai không tự default', async () => {
    countResult = 1;
    const reply = makeReply();
    await UserAddressController.createAddress(makeReq({ body: { fullName: 'B' } }), reply);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false }));
  });

  it('create với isDefault=true thì unset các default cũ', async () => {
    countResult = 3;
    const reply = makeReply();
    await UserAddressController.createAddress(makeReq({ body: { isDefault: true } }), reply);

    expect(updateMany).toHaveBeenCalledWith(expect.anything(), { $set: { isDefault: false } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
  });

  it('set-default unset tất cả rồi set đích', async () => {
    const reply = makeReply();
    await UserAddressController.setDefault(makeReq(), reply);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userId: expect.any(mongoose.Types.ObjectId) }),
      { $set: { isDefault: false } }
    );
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { isDefault: true } },
      { new: true }
    );
    expect(reply.body.success).toBe(true);
  });

  it('xóa địa chỉ default thì chuyển default sang bản ghi mới nhất', async () => {
    deletedDoc = { _id: AID, isDefault: true };
    nextDefaultDoc = { _id: new mongoose.Types.ObjectId() };
    const reply = makeReply();
    await UserAddressController.deleteAddress(makeReq(), reply);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: nextDefaultDoc._id },
      { $set: { isDefault: true } }
    );
  });

  it('xóa địa chỉ KHÔNG default thì không reassign', async () => {
    deletedDoc = { _id: AID, isDefault: false };
    const reply = makeReply();
    await UserAddressController.deleteAddress(makeReq(), reply);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('id không hợp lệ → 400', async () => {
    const reply = makeReply();
    await UserAddressController.setDefault(makeReq({ params: { id: 'not-an-id' } }), reply);
    expect(reply.statusCode).toBe(400);
  });
});
