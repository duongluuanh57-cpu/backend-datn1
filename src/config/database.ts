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

    // Migrate nhẹ: gỡ unique index (userId, productId) cũ của Review — từ giờ 1 lượt mua = 1 review,
    // mua lại được review tiếp, không còn bị chặn bởi index unique thời single-review.
    try {
      await (mongoose.connection.db as any).dropIndex('reviews', 'userId_1_productId_1');
      console.log('✅ Dropped legacy unique index reviews.userId_1_productId_1');
    } catch (_) {
      // Index chưa từng tồn tại hoặc đã gỡ — bỏ qua
    }
  } catch (error) {
    console.error('Kết nối với MongoDB thất bại', error);
    console.warn('⚠️ [MongoDB] Server vẫn khởi động, DB sẽ được theo dõi qua /health');
  }
}
