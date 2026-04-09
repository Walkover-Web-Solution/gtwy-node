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
    const collectionsToMigrate = ["configurations", "configuration_versions"];

    for (const collectionName of collectionsToMigrate) {
      const collection = db.collection(collectionName);
      console.log(`\nStarting migration for ${collectionName}...`);

      const cursor = collection.find({});
      const batch = [];
      let processed = 0;

      for await (const doc of cursor) {
        processed++;

        // Skip if ai_updates already exists
        if (doc.ai_updates) {
          console.log(`Skipping document ${doc._id} in ${collectionName} - ai_updates already exists`);
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

        batch.push({
          updateOne: {
            filter: { _id: doc._id },
            update: updateOp
          }
        });

        // Process batch every 100 documents
        if (batch.length >= 100) {
          await collection.bulkWrite(batch);
          console.log(`Processed batch of ${batch.length} documents in ${collectionName} (total: ${processed})`);
          batch.length = 0; // Clear batch
        }
      }

      // Process remaining documents
      if (batch.length > 0) {
        await collection.bulkWrite(batch);
        console.log(`Processed final batch of ${batch.length} documents in ${collectionName} (total: ${processed})`);
      }

      console.log(`Migration for ${collectionName} completed. Processed ${processed} documents.`);

      // Verification - count documents with ai_updates
      const count = await collection.countDocuments({ ai_updates: { $exists: true } });

      console.log(`\n=== Migration Summary for ${collectionName} ===`);
      console.log(`Documents with ai_updates: ${count}`);

      // Verify old fields are removed
      const oldCount = await collection.countDocuments({
        $or: [{ prompt_enhancer_percentage: { $exists: true } }, { criteria_check: { $exists: true } }]
      });

      console.log(`Documents with old fields remaining: ${oldCount}`);

      if (oldCount === 0) {
        console.log(`✅ Migration for ${collectionName} completed successfully!`);
      } else {
        console.log(`⚠️  Some old fields remain in ${collectionName} - manual cleanup may be required`);
      }
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
