import { MongoClient } from "mongodb";

const MONGODB_URI = "mongodb+srv://admin:Uc0sjm9jpLMsSGn5@cluster0.awdsppv.mongodb.net/AI_Middleware-test";

// A valid bridge_id is a 24-char hex ObjectId string
const isObjectId = (str) => typeof str === "string" && /^[a-f\d]{24}$/i.test(str);

function remapConnectedAgents(connected_agents) {
  if (!connected_agents || typeof connected_agents !== "object") return null;
  const entries = Object.entries(connected_agents);
  if (entries.length === 0) return null;

  let changed = false;
  const remapped = {};

  for (const [key, agent_info] of entries) {
    const bridgeId = agent_info?.bridge_id?.toString() ?? agent_info?.bridge_id;

    if (isObjectId(key)) {
      // Already keyed by bridge_id — keep as-is
      remapped[key] = agent_info;
    } else if (bridgeId) {
      // Keyed by agent name — remap to bridge_id
      remapped[bridgeId] = agent_info;
      changed = true;
    }
    // No bridge_id — drop orphaned entry
  }

  return changed ? remapped : null;
}

async function migrateConnectedAgents() {
  const client = new MongoClient(MONGODB_URI);
  const sequelize = new Sequelize(process.env.POSTGRES_URI, {
    dialect: "postgres",
    logging: false
  });

  let migratedCount = 0;
  let deletedCount = 0;
  let softDeletedCount = 0;
  let skippedCount = 0;
  const orgOwnerCache = {};

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("AI_Middleware-test");
    const configurations = db.collection("configurations");
    const bridgeversions = db.collection("configuration_versions");

    let totalConfigs = 0,
      updatedConfigs = 0;
    let totalVersions = 0,
      updatedVersions = 0;

    // --- Migrate configurations ---
    console.log("\nMigrating configurations...");
    const configs = await configurations
      .find({ connected_agents: { $exists: true, $ne: {} } }, { projection: { _id: 1, connected_agents: 1 } })
      .toArray();
    totalConfigs = configs.length;

    const configOps = [];
    for (const doc of configs) {
      const remapped = remapConnectedAgents(doc.connected_agents);
      if (remapped) {
        configOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { connected_agents: remapped } } } });
        updatedConfigs++;
        console.log(`  Config ${doc._id}: remapped keys [${Object.keys(doc.connected_agents).join(", ")}] → [${Object.keys(remapped).join(", ")}]`);
      }
    }
    if (configOps.length) await configurations.bulkWrite(configOps);

    // --- Migrate bridge versions ---
    console.log("\nMigrating bridge versions...");
    const versions = await bridgeversions
      .find({ connected_agents: { $exists: true, $ne: {} } }, { projection: { _id: 1, connected_agents: 1 } })
      .toArray();
    totalVersions = versions.length;

    const versionOps = [];
    for (const doc of versions) {
      const remapped = remapConnectedAgents(doc.connected_agents);
      if (remapped) {
        versionOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { connected_agents: remapped } } } });
        updatedVersions++;
        console.log(`  Version ${doc._id}: remapped keys [${Object.keys(doc.connected_agents).join(", ")}] → [${Object.keys(remapped).join(", ")}]`);
      }
    }
    if (versionOps.length) await bridgeversions.bulkWrite(versionOps);

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
    await sequelize.close();
    console.log("\nConnections closed");
  }
}

// Run the migration
migrateConnectedAgents()
  .then(() => {
    console.log("\n✓ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });
