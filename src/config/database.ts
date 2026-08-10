import mongoose from 'mongoose';

export async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) throw new Error('❌ MONGO_URI is not defined in environment variables');
    console.log('⏳ Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000,
    });
    console.log(`🍃 MongoDB: Connection established successfully (pool: ${mongoose.connections[0]?.getClient()?.options?.maxPoolSize || 50})`);
  } catch (error) {
    console.error('Kết nối với MongoDB thất bại', error);
    console.warn('⚠️ [MongoDB] Server vẫn khởi động, DB sẽ được theo dõi qua /health');
  }
}
