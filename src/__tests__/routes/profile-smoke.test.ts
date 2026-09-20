import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import mongoose from 'mongoose';
import { authRoutes } from '../../routes/auth.routes.ts';
import { User } from '../../models/User.ts';
import { generateTokens } from '../../utils/auth.ts';

// Chạy trên MONGO_URI (đã có trong .env qua setup.ts) — user tạm, dọn ở afterAll.
const TEST_EMAIL = `profile-smoke-${Date.now()}@test.local`;
const TEST_USERNAME = `profilesmoke${Date.now()}`;

let app: ReturnType<typeof Fastify>;
let userId: string;
let token: string;

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set — cannot run DB tests');
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri);

  const created = await User.create({
    username: TEST_USERNAME,
    email: TEST_EMAIL,
    passwordHash: '',
    role: 'USER',
    status: 'active',
  });
  userId = (created._id as mongoose.Types.ObjectId).toString();
  token = generateTokens(userId, 'USER').accessToken;

  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  if (userId) await User.deleteOne({ _id: new mongoose.Types.ObjectId(userId) });
});

describe('PATCH /api/auth/update-profile (luồng trang profile)', () => {
  it('lưu được dateOfBirth — key này từng bị zod schema cắt âm thầm', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/update-profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { fullName: 'Nguyễn Văn Test', dateOfBirth: '1995-01-01' },
    });
    expect(res.statusCode).toBe(200);

    const saved = await User.findById(userId).lean();
    expect((saved as any).dateOfBirth).toBe('1995-01-01');
    expect((saved as any).fullName).toBe('Nguyễn Văn Test');
  });

  it('lưu gender hợp lệ, chặn gender sai enum bằng 400', async () => {
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/auth/update-profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: 'FEMALE' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await User.findById(userId).lean() as any).gender).toBe('FEMALE');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/auth/update-profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { gender: 'NOT_A_GENDER' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('trả về message backend tiếng Việt khi email trùng user khác', async () => {
    const dup = await User.create({
      username: `${TEST_USERNAME}b`,
      email: `profile-smoke-dup-${Date.now()}@test.local`,
      passwordHash: '',
    });
    try {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/auth/update-profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { email: (dup as any).email },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('đã được sử dụng');
    } finally {
      await User.deleteOne({ _id: dup._id });
    }
  });

  it('không có token → 401 kèm message (FE toast dựa vào message này)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/auth/update-profile',
      payload: { fullName: 'X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBeTruthy();
  });
});
