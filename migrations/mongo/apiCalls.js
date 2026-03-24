import { MongoClient, ObjectId } from "mongodb";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;
const orgOwnerCache = {};

async function getOrgOwner(orgId) {
  if (!orgId) return null;
  if (orgOwnerCache[orgId] !== undefined) return orgOwnerCache[orgId];
  try {
    const response = await axios.get(`https://routes.msg91.com/api/${process.env.PUBLIC_REFERENCEID}/getCompanies?id=${orgId}`, {
      headers: { "Content-Type": "application/json", Authkey: process.env.ADMIN_API_KEY }
    });
    const orgData = response?.data?.data?.data?.[0];
    orgOwnerCache[orgId] = orgData?.created_by?.toString() || null;
  } catch (e) {
    console.log(`  Proxy call failed for org ${orgId}: ${e.message}`);
    orgOwnerCache[orgId] = null;
  }
  return orgOwnerCache[orgId];
}

async function removeDeprecatedKeys(apicalls) {
  const r = await apicalls.updateMany(
    {},
    {
      $unset: {
        bridge_id: "",
        activated: "",
        status: "",
        parameters: "",
        axios: "",
        required_fields: "",
        new0: "",
        new1: "",
        endpoint: "",
        optional_fields: "",
        function_name: "",
        short_description: ""
      }
    }
  );
  console.log(`  ✓ Step 1: Removed deprecated keys from ${r.modifiedCount} docs`);
  return r;
}

async function setDefaults(apicalls) {
  const defaults = [
    [{ folder_id: { $exists: false } }, { $set: { folder_id: "" } }],
    [{ description: { $exists: false } }, { $set: { description: "" } }],
    [{ title: { $exists: false } }, { $set: { title: "" } }],
    [{ required_params: { $exists: false } }, { $set: { required_params: [] } }],
    [{ fields: { $exists: false } }, { $set: { fields: {} } }]
  ];
  const results = await Promise.all(defaults.map(([filter, update]) => apicalls.updateMany(filter, update)));
  results.forEach((r, i) => {
    if (r.modifiedCount > 0) console.log(`  ✓ Step 2: ${JSON.stringify(defaults[i][1].$set)} → ${r.modifiedCount} docs`);
  });
  return results;
}

async function backfillOldFields(apicalls) {
  const cursor = apicalls.find({ old_fields: { $exists: false } }, { projection: { _id: 1, fields: 1 } });
  const bulk = [];
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    bulk.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { old_fields: doc.fields || {} } } } });
  }
  if (bulk.length > 0) {
    const r = await apicalls.bulkWrite(bulk);
    console.log(`  ✓ Step 3: Backfilled old_fields for ${r.modifiedCount} docs`);
  } else {
    console.log(`  - Step 3: No documents missing old_fields`);
  }
}

async function fixMissingUserIds(apicalls) {
  let migrated = 0;
  let skipped = 0;
  const cursor = apicalls.find({ $or: [{ user_id: { $exists: false } }, { user_id: "" }] });
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const userId = await getOrgOwner(doc.org_id);
    if (userId) {
      const r = await apicalls.updateOne({ _id: doc._id }, { $set: { user_id: userId } });
      if (r.modifiedCount > 0) migrated++;
      else skipped++;
    } else {
      skipped++;
    }
  }
  console.log(`  ✓ Step 6: user_id fixed: ${migrated}, skipped: ${skipped}`);
  return { migrated, skipped };
}

async function renameTimestamps(apicalls) {
  const r = await apicalls.updateMany({ created_at: { $exists: true } }, { $rename: { created_at: "createdAt", updated_at: "updatedAt" } });
  console.log(`  ✓ Step 7: Renamed timestamps in ${r.modifiedCount} docs`);
  return r;
}

async function convertObjectIds(apicalls, field) {
  const cursor = apicalls.find({ [`${field}.0`]: { $exists: true } }, { projection: { _id: 1, [field]: 1 } });
  const bulk = [];
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (doc[field].some((id) => typeof id !== "string")) {
      bulk.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: { [field]: doc[field].map((id) => id.toString()) } } }
      });
    }
  }
  if (bulk.length > 0) {
    const r = await apicalls.bulkWrite(bulk);
    console.log(`  ✓ Converted ${field} for ${r.modifiedCount} docs`);
  } else {
    console.log(`  - No ObjectId ${field} found`);
  }
}

async function migrateApiCalls() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const apicalls = db.collection("apicalls");
    const configurations = db.collection("configurations");
    const versions = db.collection("configuration_versions");

    // =============================================================
    // Phase 1: Independent operations (parallel)
    // =============================================================
    console.log("\n=== Phase 1: Independent operations (parallel) ===");

    const step1 = removeDeprecatedKeys(apicalls);
    const step2 = setDefaults(apicalls);
    const step3 = backfillOldFields(apicalls);
    const step6 = fixMissingUserIds(apicalls);
    const step7 = renameTimestamps(apicalls);

    await Promise.all([step1, step2, step3, step6, step7]);

    // =============================================================
    // Phase 2: Sync bridge_ids/version_ids + cleanup stale refs
    // =============================================================
    console.log("\n=== Phase 2: Sync bridge_ids/version_ids ===");

    const allApicallIds = new Set((await apicalls.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id.toString()));

    const [allConfigs, allVersions] = await Promise.all([
      configurations.find({ "function_ids.0": { $exists: true } }, { projection: { _id: 1, function_ids: 1 } }).toArray(),
      versions.find({ "function_ids.0": { $exists: true } }, { projection: { _id: 1, function_ids: 1 } }).toArray()
    ]);

    const apicallToBridges = {};
    const apicallToVersions = {};
    const staleConfigRefs = {};
    const staleVersionRefs = {};

    for (const config of allConfigs) {
      for (const funcId of config.function_ids) {
        const funcIdStr = funcId.toString();
        if (allApicallIds.has(funcIdStr)) {
          if (!apicallToBridges[funcIdStr]) apicallToBridges[funcIdStr] = new Set();
          apicallToBridges[funcIdStr].add(config._id.toString());
        } else {
          if (!staleConfigRefs[config._id.toString()]) staleConfigRefs[config._id.toString()] = [];
          staleConfigRefs[config._id.toString()].push(funcId);
        }
      }
    }

    for (const ver of allVersions) {
      for (const funcId of ver.function_ids) {
        const funcIdStr = funcId.toString();
        if (allApicallIds.has(funcIdStr)) {
          if (!apicallToVersions[funcIdStr]) apicallToVersions[funcIdStr] = new Set();
          apicallToVersions[funcIdStr].add(ver._id.toString());
        } else {
          if (!staleVersionRefs[ver._id.toString()]) staleVersionRefs[ver._id.toString()] = [];
          staleVersionRefs[ver._id.toString()].push(funcId);
        }
      }
    }

    const bulkApicallUpdates = [];
    for (const [apicallId, bridgeIds] of Object.entries(apicallToBridges)) {
      bulkApicallUpdates.push({
        updateOne: {
          filter: { _id: new ObjectId(apicallId) },
          update: { $addToSet: { bridge_ids: { $each: [...bridgeIds] } } }
        }
      });
    }
    for (const [apicallId, versionIds] of Object.entries(apicallToVersions)) {
      bulkApicallUpdates.push({
        updateOne: {
          filter: { _id: new ObjectId(apicallId) },
          update: { $addToSet: { version_ids: { $each: [...versionIds] } } }
        }
      });
    }

    const bulkConfigCleanup = [];
    for (const [configId, staleFuncIds] of Object.entries(staleConfigRefs)) {
      bulkConfigCleanup.push({
        updateOne: {
          filter: { _id: new ObjectId(configId) },
          update: { $pull: { function_ids: { $in: staleFuncIds } } }
        }
      });
    }

    const bulkVersionCleanup = [];
    for (const [versionId, staleFuncIds] of Object.entries(staleVersionRefs)) {
      bulkVersionCleanup.push({
        updateOne: {
          filter: { _id: new ObjectId(versionId) },
          update: { $pull: { function_ids: { $in: staleFuncIds } } }
        }
      });
    }

    const phase2Ops = [];
    if (bulkApicallUpdates.length > 0)
      phase2Ops.push(
        apicalls.bulkWrite(bulkApicallUpdates).then((r) => console.log(`  ✓ Added bridge_ids/version_ids to ${r.modifiedCount} apicalls`))
      );
    else console.log(`  - No apicalls needed bridge_ids/version_ids update`);
    if (bulkConfigCleanup.length > 0)
      phase2Ops.push(
        configurations.bulkWrite(bulkConfigCleanup).then((r) => console.log(`  ✓ Removed stale function_ids from ${r.modifiedCount} configurations`))
      );
    else console.log(`  - No stale function_ids in configurations`);
    if (bulkVersionCleanup.length > 0)
      phase2Ops.push(
        versions.bulkWrite(bulkVersionCleanup).then((r) => console.log(`  ✓ Removed stale function_ids from ${r.modifiedCount} versions`))
      );
    else console.log(`  - No stale function_ids in versions`);

    if (phase2Ops.length > 0) await Promise.all(phase2Ops);

    // =============================================================
    // Phase 3: Convert ObjectId → String (parallel)
    // =============================================================
    console.log("\n=== Phase 3: Convert ObjectId → String ===");

    const bridgeConvert = convertObjectIds(apicalls, "bridge_ids");
    const versionConvert = convertObjectIds(apicalls, "version_ids");
    await Promise.all([bridgeConvert, versionConvert]);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Stale config refs cleaned:  ${Object.values(staleConfigRefs).flat().length}`);
    console.log(`  Stale version refs cleaned: ${Object.values(staleVersionRefs).flat().length}`);
    console.log(`  Total apicall docs:         ${await apicalls.countDocuments()}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nConnection closed");
  }
}

export { migrateApiCalls };
