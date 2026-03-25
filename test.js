import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

async function migrateAuths() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const auths = db.collection("auths");

    // STEP 1: Remove entries missing required 'name' field
    console.log("\n--- Step 1: Removing entries missing 'name' ---");
    const result = await auths.deleteMany({
      $or: [{ name: { $exists: false } }, { name: "" }, { name: null }]
    });
    console.log(`  ✓ Removed ${result.deletedCount} invalid documents`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Removed:    ${result.deletedCount}`);
    console.log(`  Total docs: ${await auths.countDocuments()}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nConnection closed");
  }
}

migrateAuths()
  .then(() => {
    console.log("\n✓ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });
