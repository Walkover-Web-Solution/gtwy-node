import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

async function removeStreamFromImageModels() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const models = db.collection("modelconfigurations");

    console.log("\n=== Removing stream from image models ===");

    const res = await models.updateMany({ "validationConfig.type": "image" }, { $unset: { "configuration.stream": "" } });

    console.log(`  ✓ Removed stream from ${res.modifiedCount} documents`);
  } catch (err) {
    console.error("Migration failed:", err);
    throw err;
  } finally {
    await client.close();
    console.log("Connection closed");
  }
}

export { removeStreamFromImageModels };
