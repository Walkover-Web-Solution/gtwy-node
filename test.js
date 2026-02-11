import { MongoClient } from "mongodb";

const MONGODB_URI = "mongodb+srv://admin:Uc0sjm9jpLMsSGn5@cluster0.awdsppv.mongodb.net/AI_Middleware-test";

/**
 * Migration: Add validationConfig.inbuilt_tools.Gtwy_Web_Search to model configurations
 * This migration adds the Gtwy_Web_Search inbuilt tool to all model configurations that have tools enabled
 */

async function addInbuiltToolsToModelConfig() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("AI_Middleware-test");
    const modelConfigs = db.collection("modelconfigurations");

    // Find all documents that need migration
    // Check for: validationConfig.tools is true and inbuilt_tools.Gtwy_Web_Search doesn't exist
    const cursor = modelConfigs.find({
      "validationConfig.tools": true,
      "validationConfig.inbuilt_tools.Gtwy_Web_Search": { $exists: false }
    });

    let migratedCount = 0;
    let skippedCount = 0;

    while (await cursor.hasNext()) {
      const modelConfig = await cursor.next();
      const modelConfigId = modelConfig._id;

      console.log(`\nProcessing Model Config: ${modelConfigId} (${modelConfig.service}/${modelConfig.model_name})`);

      try {
        // Prepare the update object
        const updateDoc = {
          $set: {
            "validationConfig.inbuilt_tools.Gtwy_Web_Search": true
          }
        };

        // Perform the update
        const result = await modelConfigs.updateOne({ _id: modelConfigId }, updateDoc);

        if (result.modifiedCount > 0) {
          migratedCount++;
          console.log(`  ✓ Successfully added Gtwy_Web_Search inbuilt tool`);
        } else {
          skippedCount++;
          console.log(`  - No changes needed`);
        }
      } catch (error) {
        console.error(`  ✗ Error migrating Model Config ${modelConfigId}:`, error.message);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Total migrated: ${migratedCount}`);
    console.log(`  Total skipped: ${skippedCount}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed");
  }
}

// Run the migration
addInbuiltToolsToModelConfig()
  .then(() => {
    console.log("\n✓ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });
