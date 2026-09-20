import 'dotenv/config';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI || '');

async function removeFields() {
  console.log('MONGO_URI presente:', !!process.env.MONGO_URI);

  await client.connect();
  const db = client.db('backend-api');
  const result = await db.users.updateMany({}, {
    $unset: {
      spinTurns: '',
      spentTurnsGranted: '',
      rankTurnsGranted: ''
    }
  });
  console.log(`Deleted old fields from ${result.modifiedCount} users`);
  await client.close();
}

removeFields().catch(err => {
  console.error(err);
  process.exit(1);
});
