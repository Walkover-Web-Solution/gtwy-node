import { MongoClient } from "mongodb";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;

async function migrateApikeyCredentials() {
  const client = new MongoClient(MONGODB_URI);
  const orgOwnerCache = {};

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const apikeys = db.collection("apikeycredentials");
    const configurations = db.collection("configurations");
    const versions = db.collection("configuration_versions");

    // -------------------------------------------------------
    // STEP 1: Remove deprecated/junk keys
    // -------------------------------------------------------
    console.log("\n--- Step 1: Removing deprecated keys ---");

    const step1 = await apikeys.updateMany(
      {},
      {
        $unset: {
          comment: "",
          // status: "",
          migrated_from_redis: "",
          apikey_quota: "",
          apikey_uses: ""
        }
      }
    );
    console.log(`  ✓ Removed deprecated keys from ${step1.modifiedCount} documents`);

    // -------------------------------------------------------
    // STEP 2: Set safe defaults for missing fields
    // -------------------------------------------------------
    console.log("\n--- Step 2: Setting safe defaults for missing fields ---");

    const defaults = [
      [{ folder_id: { $exists: false } }, { $set: { folder_id: "" } }],
      [{ status: { $exists: false } }, { $set: { status: null } }],
      [{ apikey_limit: { $exists: false } }, { $set: { apikey_limit: 0 } }],
      [{ apikey_usage: { $exists: false } }, { $set: { apikey_usage: 0 } }],
      [{ apikey_limit_reset_period: { $exists: false } }, { $set: { apikey_limit_reset_period: "monthly" } }],
      [{ apikey_limit_start_date: { $exists: false } }, { $set: { apikey_limit_start_date: new Date() } }],
      [{ last_used: { $exists: false } }, { $set: { last_used: null } }]
    ];

    for (const [filter, update] of defaults) {
      const r = await apikeys.updateMany(filter, update);
      if (r.modifiedCount > 0) console.log(`  ✓ ${JSON.stringify(update.$set)} → ${r.modifiedCount} docs`);
    }

    // -------------------------------------------------------
    // STEP 3: Backfill bridge_ids and version_ids from configurations/versions
    // -------------------------------------------------------
    console.log("\n--- Step 3: Backfilling bridge_ids and version_ids ---");

    const missingRefsCursor = apikeys.find(
      {
        $or: [{ bridge_ids: { $exists: false } }, { bridge_ids: { $size: 0 } }, { version_ids: { $exists: false } }, { version_ids: { $size: 0 } }]
      },
      { projection: { _id: 1, service: 1, bridge_ids: 1, version_ids: 1 } }
    );

    const bulkRefs = [];
    while (await missingRefsCursor.hasNext()) {
      const doc = await missingRefsCursor.next();
      const apikeyId = doc._id;
      const service = doc.service;
      const updateFields = {};

      if (!service) {
        console.log(`  - Skipping ${apikeyId}: no service field`);
        continue;
      }

      // Backfill bridge_ids — find configurations where apikey_object_id.{service} = this apikey _id
      const hasBridgeIds = doc.bridge_ids && doc.bridge_ids.length > 0;
      if (!hasBridgeIds) {
        const configs = await configurations.find({ [`apikey_object_id.${service}`]: apikeyId.toString() }, { projection: { _id: 1 } }).toArray();

        // Also try matching as ObjectId
        if (configs.length === 0) {
          const configsById = await configurations.find({ [`apikey_object_id.${service}`]: apikeyId }, { projection: { _id: 1 } }).toArray();
          if (configsById.length > 0) {
            updateFields.bridge_ids = configsById.map((c) => c._id.toString());
          }
        } else {
          updateFields.bridge_ids = configs.map((c) => c._id.toString());
        }
      }

      // Backfill version_ids — find configuration_versions where apikey_object_id.{service} = this apikey _id
      const hasVersionIds = doc.version_ids && doc.version_ids.length > 0;
      if (!hasVersionIds) {
        const versionDocs = await versions.find({ [`apikey_object_id.${service}`]: apikeyId.toString() }, { projection: { _id: 1 } }).toArray();

        if (versionDocs.length === 0) {
          const versionDocsById = await versions.find({ [`apikey_object_id.${service}`]: apikeyId }, { projection: { _id: 1 } }).toArray();
          if (versionDocsById.length > 0) {
            updateFields.version_ids = versionDocsById.map((v) => v._id.toString());
          }
        } else {
          updateFields.version_ids = versionDocs.map((v) => v._id.toString());
        }
      }

      if (Object.keys(updateFields).length > 0) {
        bulkRefs.push({
          updateOne: {
            filter: { _id: apikeyId },
            update: { $set: updateFields }
          }
        });
      }
    }

    if (bulkRefs.length > 0) {
      const r = await apikeys.bulkWrite(bulkRefs);
      console.log(`  ✓ Backfilled bridge_ids/version_ids for ${r.modifiedCount} documents`);
    } else {
      console.log(`  - No documents needed bridge_ids/version_ids backfill`);
    }

    // -------------------------------------------------------
    // STEP 5: Fix missing user_id from org owner
    // -------------------------------------------------------
    console.log("\n--- Step 5: Fixing missing user_id ---");

    let migratedCount = 0;
    let skippedCount = 0;

    const missingUserIdCursor = apikeys.find({
      user_id: { $exists: false }
    });

    while (await missingUserIdCursor.hasNext()) {
      const doc = await missingUserIdCursor.next();
      const orgId = doc.org_id;

      try {
        let userId = null;

        if (orgId) {
          if (!orgOwnerCache[orgId]) {
            try {
              const response = await axios.get(`https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?id=${orgId}`, {
                headers: { "Content-Type": "application/json", Authkey: process.env.ADMIN_API_KEY }
              });
              const orgData = response?.data?.data?.data?.[0];
              orgOwnerCache[orgId] = orgData?.created_by?.toString() || null;
            } catch (e) {
              console.log(`  Proxy call failed for org ${orgId}: ${e.message}`);
            }
          }
          userId = orgOwnerCache[orgId];
        }

        if (userId) {
          const result = await apikeys.updateOne({ _id: doc._id }, { $set: { user_id: userId } });
          if (result.modifiedCount > 0) migratedCount++;
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`  ✗ Error processing ${doc._id}:`, error.message);
      }
    }

    console.log(`  ✓ Fixed user_id for ${migratedCount} documents, skipped ${skippedCount}`);

    // -------------------------------------------------------
    // Summary
    // -------------------------------------------------------
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  user_id fixed:  ${migratedCount}`);
    console.log(`  Skipped:        ${skippedCount}`);
    console.log(`  Total docs:     ${await apikeys.countDocuments()}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nConnection closed");
  }
}

migrateApikeyCredentials()
  .then(() => {
    console.log("\n✓ Migration completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  });
