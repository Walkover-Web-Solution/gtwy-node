import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

async function streamAdddIModelConfig() {
  const client = new MongoClient(MONGODB_URI);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const modelConfigurations = db.collection("modelconfigurations");

    // Fetch documents
    const docs = await modelConfigurations.find({}).toArray();
    console.log(`Found ${docs.length} docs in modelconfigurations`);

    for (const doc of docs) {
      try {
        const updateFields = {};

        if (doc?.validationConfig?.type !== "image") {
          updateFields["configuration.stream"] = {
            field: "boolean",
            default: false,
            level: 1,
            typeOf: "boolean"
          };
        } else {
          console.log(`  ℹ️ Skipping stream for doc ${doc.model_name || doc._id} — image type`);
        }

        if (doc?.configuration?.parallel_tool_calls) {
          updateFields["configuration.parallel_tool_calls.default"] = false;
        }

        if (doc?.configuration?.tools) {
          updateFields["configuration.tools.level"] = 0;
        }

        if (Object.keys(updateFields).length > 0) {
          await modelConfigurations.updateOne({ _id: doc._id }, { $set: updateFields });
          console.log(`  ✓ Migrated doc ${doc.model_name || doc._id}`);
          migrated++;
        } else {
          console.log(`  ⏭ No updates needed for doc ${doc.model_name || doc._id}`);
          skipped++;
        }
      } catch (err) {
        console.error(`  ✗ Failed doc ${doc.model_name || doc._id}: ${err.message}`);
        failed++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Total docs:  ${docs.length}`);
    console.log(`  Migrated:    ${migrated}`);
    console.log(`  Skipped:     ${skipped}`);
    console.log(`  Failed:      ${failed}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nMongoDB connection closed");
  }
}

export { streamAdddIModelConfig };
