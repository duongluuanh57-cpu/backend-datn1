import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { connectDB } from '../config/database.ts';
import { Product } from '../models/Product.ts';

async function update() {
  await connectDB();

  const bossImgPath = 'C:/Users/duong/.gemini/antigravity-ide/brain/fcc675ea-a4ac-477d-9401-3336dba0fabb/boss_scent_magnetic_1788323471277.jpg';
  const ckImgPath = 'C:/Users/duong/.gemini/antigravity-ide/brain/fcc675ea-a4ac-477d-9401-3336dba0fabb/ck_eternity_men_1788323485071.jpg';

  const bossBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(bossImgPath).toString('base64');
  const ckBase64 = 'data:image/jpeg;base64,' + fs.readFileSync(ckImgPath).toString('base64');

  const res1 = await Product.updateOne(
    { _id: new mongoose.Types.ObjectId('6a827ec7a2f1dfc3a1180ab2') },
    { $set: { image: bossBase64 } }
  );
  console.log('Updated Boss The Scent Magnetic:', res1);

  const res2 = await Product.updateOne(
    { _id: new mongoose.Types.ObjectId('6a0d72328b1bfc212bc7966d') },
    { $set: { image: ckBase64 } }
  );
  console.log('Updated CK Eternity Amber Essence For Men:', res2);

  await mongoose.disconnect();
  console.log('Done updating images in MongoDB!');
  process.exit(0);
}

update().catch(err => {
  console.error(err);
  process.exit(1);
});
