import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.ts';

async function seedAdmin() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined in env variables');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB successfully.');

  const email = 'phuctdps38985s1@gmail.com';
  const plainPassword = '123456';
  const role = 'ADMIN';

  console.log(`Checking if user with email ${email} exists...`);
  let user = await User.findOne({ email });

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  if (user) {
    console.log('User exists. Updating role and password...');
    user.role = role;
    user.passwordHash = passwordHash;
    user.status = 'active';
    await user.save();
    console.log('User updated successfully.');
  } else {
    console.log('User does not exist. Creating new admin user...');
    user = new User({
      username: 'phucadmin',
      email: email,
      passwordHash: passwordHash,
      role: role,
      memberTier: 'MEMBER',
      status: 'active',
      fullName: 'Admin Phúc',
      phoneNumber: '0901234567',
      gender: 'MALE',
      dateOfBirth: '1995-01-01',
    });
    await user.save();
    console.log('Admin user created successfully.');
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

seedAdmin().catch(err => {
  console.error('Error seeding admin:', err);
  process.exit(1);
});
