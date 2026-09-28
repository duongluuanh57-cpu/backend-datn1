/**
 * Xoá tài khoản theo email khỏi collection `users`.
 * Mặc định DRY-RUN (chỉ liệt kê). Thêm --yes để xoá thật; trước khi xoá luôn dump doc user
 * ra .backups/ để còn phục hồi.
 *
 * CHỈ xoá doc trong `users`. Chứng từ liên quan (đơn, địa chỉ, favorite, ticket, lượt quay…)
 * không bị đụng tới — script chỉ đếm và in ra để biết cái gì sẽ thành mồ côi.
 *
 * Chạy:
 *   npx tsx scripts/delete-users.ts <email...>          # DRY-RUN
 *   npx tsx scripts/delete-users.ts <email...> --yes    # xoá thật
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { User } from '../src/models/User.ts';
import { normalizeEmail } from '../src/utils/email.ts';

const DELETE = process.argv.includes('--yes');
const emails = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith('--'))
  .map(normalizeEmail)
  .filter(Boolean);

/** Collection tham chiếu tới user qua `userId` — chỉ để đếm, không xoá. */
const RELATED_COLLECTIONS = [
  'orders',
  'reviews',
  'user_addresses',
  'cartitems',
  'favorites',
  'reward_transactions',
  'support_tickets',
  'daily_spins',
  'mini_game_sessions',
];

async function main() {
  if (emails.length === 0) {
    console.error('Thiếu email. Chạy: npx tsx scripts/delete-users.ts <email...> [--yes]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI!, { serverSelectionTimeoutMS: 30000 });

  const users = (await User.find({ email: { $in: emails } }).lean()) as any[];
  console.log(`Tìm thấy ${users.length}/${emails.length} tài khoản:`);
  for (const u of users) {
    console.log(`  ${u.email} | ${u.username} | ${u.role} | ${u.oauthProvider ?? 'mật khẩu'} | ${u.status}`);
  }
  for (const email of emails.filter((e) => !users.some((u) => u.email === e))) {
    console.log(`  (không có) ${email}`);
  }

  if (users.length === 0) {
    console.log('Không có gì để xoá.');
    return;
  }

  const ids = users.map((u) => u._id);
  const related = await Promise.all(
    RELATED_COLLECTIONS.map(async (name) => ({
      name,
      count: await mongoose.connection.db!.collection(name).countDocuments({ userId: { $in: ids } }),
    })),
  );
  const orphans = related.filter((r) => r.count > 0);

  console.log('\nChứng từ liên quan (KHÔNG bị xoá, sẽ thành mồ côi):');
  console.log(orphans.length ? `  ${orphans.map((o) => `${o.name} ${o.count}`).join(' | ')}` : '  (không có)');

  if (!DELETE) {
    console.log('\nDRY-RUN: chưa xoá gì. Chạy lại với --yes để xoá thật.');
    return;
  }

  const dir = path.resolve(process.cwd(), '.backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `users-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ users }, null, 2), 'utf8');
  console.log(`\nBackup ghi tại: ${file}`);

  const res = await User.deleteMany({ _id: { $in: ids } });
  console.log(`ĐÃ XOÁ ${res.deletedCount} tài khoản.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
