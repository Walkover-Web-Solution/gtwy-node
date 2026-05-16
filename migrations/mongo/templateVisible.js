import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

async function migrateTemplateVisible() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const templates = db.collection("templates");

    // Set visible: false for all templates that either don't have the visible key or already have any value
    const result = await templates.updateMany({}, { $set: { visible: false } });

    console.log(`Updated ${result.modifiedCount} templates — set visible to false`);
    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("MongoDB connection closed");
  }
}

migrateTemplateVisible();
