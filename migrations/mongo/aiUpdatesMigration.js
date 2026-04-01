import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();
/**
 * Migration script for ai_updates field reorganization
 * Moves prompt_enhancer_percentage and criteria_check into ai_updates object for configurations only
 */

const MONGODB_CONNECTION_URI = process.env.MONGODB_CONNECTION_URI;

async function migrateAiUpdatesField() {
  const client = new MongoClient(MONGODB_CONNECTION_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const configurationsCollection = db.collection("configurations");

    // Migration for configurations
    console.log("Starting migration for configurations...");
    const configCursor = configurationsCollection.find({});
    const configBatch = [];
    let configProcessed = 0;

    for await (const doc of configCursor) {
      configProcessed++;

      // Skip if ai_updates already exists
      if (doc.ai_updates) {
        console.log(`Skipping configuration ${doc._id} - ai_updates already exists`);
        continue;
      }

      // Create ai_updates object from existing fields
      const ai_updates = {
        prompt_enhancer_percentage: doc.prompt_enhancer_percentage || 0,
        criteria_check: doc.criteria_check || {}
      };

      const updateOp = {
        $set: { ai_updates: ai_updates },
        $unset: {
          prompt_enhancer_percentage: 1,
          criteria_check: 1
        }
      };

      configBatch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: updateOp
        }
      });

      // Process batch every 100 documents
      if (configBatch.length >= 100) {
        await configurationsCollection.bulkWrite(configBatch);
        console.log(`Processed batch of ${configBatch.length} configurations (total: ${configProcessed})`);
        configBatch.length = 0; // Clear batch
      }
    }

    // Process remaining configurations
    if (configBatch.length > 0) {
      await configurationsCollection.bulkWrite(configBatch);
      console.log(`Processed final batch of ${configBatch.length} configurations (total: ${configProcessed})`);
    }

    console.log(`Configuration migration completed. Processed ${configProcessed} documents.`);

    // Verification - count documents with ai_updates
    const configCount = await configurationsCollection.countDocuments({ ai_updates: { $exists: true } });

    console.log("\n=== Migration Summary ===");
    console.log(`Configurations with ai_updates: ${configCount}`);

    // Verify old fields are removed
    const oldConfigCount = await configurationsCollection.countDocuments({
      $or: [{ prompt_enhancer_percentage: { $exists: true } }, { criteria_check: { $exists: true } }]
    });

    console.log(`Configurations with old fields remaining: ${oldConfigCount}`);

    if (oldConfigCount === 0) {
      console.log("✅ Migration completed successfully!");
    } else {
      console.log("⚠️  Some old fields remain - manual cleanup may be required");
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateAiUpdatesField()
    .then(() => {
      console.log("Migration completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}

module.exports = { migrateAiUpdatesField };
