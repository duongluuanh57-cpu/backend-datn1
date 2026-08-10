import 'dotenv/config';
import mongoose from 'mongoose';
import { Order } from '../models/Order.ts';

async function cancelRequestedOrders() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is not defined');
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB.');

  console.log('Finding orders with cancelRequested = true...');
  const result = await Order.updateMany(
    { cancelRequested: true },
    { $set: { status: 'cancelled', cancelRequested: false } }
  );

  console.log(`Successfully cancelled ${result.modifiedCount} orders (matched ${result.matchedCount}).`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB.');
}

cancelRequestedOrders().catch(err => {
  console.error('Error running script:', err);
  process.exit(1);
});
