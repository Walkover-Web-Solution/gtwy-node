import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;
if (!MONGODB_URI) {
  console.error("Error: MONGODB_CONNECTION_URI environment variable is not set.");
  process.exit(1);
}

async function migrateAlerts() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const alerts = db.collection("alerts");

    // STEP 1: Remove deprecated fields (user_url)
    console.log("\n--- Step 1: Removing deprecated fields ---");
    const result = await alerts.updateMany({}, { $unset: { "webhookConfiguration.user_url": "" } });
    console.log(`  ✓ Modified ${result.modifiedCount} / ${result.matchedCount} documents`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Matched:  ${result.matchedCount}`);
    console.log(`  Modified: ${result.modifiedCount}`);
    console.log(`  Total docs: ${await alerts.countDocuments()}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed");
  }
}

export { migrateAlerts };
