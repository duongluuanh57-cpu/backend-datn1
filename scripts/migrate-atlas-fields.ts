import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function updateAtlasFields() {
  const uri = process.env.MONGO_URI || process.env.MONGO_URL;
  if (!uri) {
    throw new Error('MONGO_URI is not defined in environment variables');
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = client.db('backend-api');
    const result = await db.users.updateMany({}, {
      $unset: {
        spinTurns: '',
        spentTurnsGranted: '',
        rankTurnsGranted: ''
      }
    });

    console.log(`Deleted old fields from ${result.modifiedCount} users`);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

updateAtlasFields();
