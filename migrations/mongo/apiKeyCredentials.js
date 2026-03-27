import { MongoClient } from "mongodb";
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
    orgOwnerCache[orgId] = response?.data?.data?.data?.[0]?.created_by?.toString() || null;
  } catch (e) {
    console.log(`  Proxy call failed for org ${orgId}: ${e.message}`);
    orgOwnerCache[orgId] = null;
  }
  return orgOwnerCache[orgId];
}

async function removeDeprecatedKeys(apikeys) {
  const r = await apikeys.updateMany({}, { $unset: { comment: "", migrated_from_redis: "", apikey_quota: "", apikey_uses: "" } });
  console.log(`  ✓ Step 1: Removed deprecated keys from ${r.modifiedCount} docs`);
  return r;
}

async function setDefaults(apikeys) {
  const defaults = [
    [{ folder_id: { $exists: false } }, { $set: { folder_id: "" } }],
    [{ status: { $exists: false } }, { $set: { status: null } }],
    [{ apikey_limit: { $exists: false } }, { $set: { apikey_limit: 0 } }],
    [{ apikey_usage: { $exists: false } }, { $set: { apikey_usage: 0 } }],
    [{ apikey_limit_reset_period: { $exists: false } }, { $set: { apikey_limit_reset_period: "monthly" } }],
    [{ apikey_limit_start_date: { $exists: false } }, { $set: { apikey_limit_start_date: new Date() } }],
    [{ last_used: { $exists: false } }, { $set: { last_used: null } }]
  ];
  const results = await Promise.all(defaults.map(([filter, update]) => apikeys.updateMany(filter, update)));
  results.forEach((r, i) => {
    if (r.modifiedCount > 0) console.log(`  ✓ Step 2: ${JSON.stringify(defaults[i][1].$set)} → ${r.modifiedCount} docs`);
  });
  return results;
}

async function fixMissingUserIds(apikeys) {
  let migrated = 0;
  let skipped = 0;
  const cursor = apikeys.find({ user_id: { $exists: false } });
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const userId = await getOrgOwner(doc.org_id);
    if (userId) {
      const r = await apikeys.updateOne({ _id: doc._id }, { $set: { user_id: userId } });
      if (r.modifiedCount > 0) migrated++;
      else skipped++;
    } else {
      skipped++;
    }
  }
  console.log(`  ✓ Step 5: user_id fixed: ${migrated}, skipped: ${skipped}`);
  return { migrated, skipped };
}

async function convertObjectIds(apikeys, field) {
  const cursor = apikeys.find({ [`${field}.0`]: { $exists: true } }, { projection: { _id: 1, [field]: 1 } });
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
    const r = await apikeys.bulkWrite(bulk);
    console.log(`  ✓ Converted ${field} for ${r.modifiedCount} docs`);
  } else {
    console.log(`  - No ObjectId ${field} found`);
  }
}

async function migrateApikeyCredentials() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const apikeys = db.collection("apikeycredentials");
    const configurations = db.collection("configurations");
    const versions = db.collection("configuration_versions");

    // =============================================================
    // Phase 1: Independent operations (parallel)
    // =============================================================
    console.log("\n=== Phase 1: Independent operations (parallel) ===");

    const step1 = removeDeprecatedKeys(apikeys);
    const step2 = setDefaults(apikeys);
    const step5 = fixMissingUserIds(apikeys);

    await Promise.all([step1, step2, step5]);

    // =============================================================
    // Phase 2: Sync bridge_ids/version_ids + cleanup stale refs
    // =============================================================
    console.log("\n=== Phase 2: Sync bridge_ids/version_ids ===");

    const allApikeyIds = new Set((await apikeys.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id.toString()));

    const [allConfigs, allVersions] = await Promise.all([
      configurations.find({ apikey_object_id: { $exists: true } }, { projection: { _id: 1, apikey_object_id: 1 } }).toArray(),
      versions.find({ apikey_object_id: { $exists: true } }, { projection: { _id: 1, apikey_object_id: 1 } }).toArray()
    ]);

    const apikeyToBridges = {};
    const apikeyToVersions = {};
    const staleConfigRefs = {}; // configId → [service keys to $unset]
    const staleVersionRefs = {}; // versionId → [service keys to $unset]

    for (const config of allConfigs) {
      for (const [service, apikeyId] of Object.entries(config.apikey_object_id || {})) {
        const apikeyIdStr = apikeyId?.toString();
        if (apikeyIdStr && allApikeyIds.has(apikeyIdStr)) {
          if (!apikeyToBridges[apikeyIdStr]) apikeyToBridges[apikeyIdStr] = new Set();
          apikeyToBridges[apikeyIdStr].add(config._id.toString());
        } else if (apikeyIdStr) {
          if (!staleConfigRefs[config._id.toString()]) staleConfigRefs[config._id.toString()] = [];
          staleConfigRefs[config._id.toString()].push(service);
        }
      }
    }

    for (const ver of allVersions) {
      for (const [service, apikeyId] of Object.entries(ver.apikey_object_id || {})) {
        const apikeyIdStr = apikeyId?.toString();
        if (apikeyIdStr && allApikeyIds.has(apikeyIdStr)) {
          if (!apikeyToVersions[apikeyIdStr]) apikeyToVersions[apikeyIdStr] = new Set();
          apikeyToVersions[apikeyIdStr].add(ver._id.toString());
        } else if (apikeyIdStr) {
          if (!staleVersionRefs[ver._id.toString()]) staleVersionRefs[ver._id.toString()] = [];
          staleVersionRefs[ver._id.toString()].push(service);
        }
      }
    }

    const bulkApikeyUpdates = [];
    for (const [apikeyId, bridgeIds] of Object.entries(apikeyToBridges)) {
      bulkApikeyUpdates.push({
        updateOne: {
          filter: { _id: apikeyId },
          update: { $addToSet: { bridge_ids: { $each: [...bridgeIds] } } }
        }
      });
    }
    for (const [apikeyId, versionIds] of Object.entries(apikeyToVersions)) {
      bulkApikeyUpdates.push({
        updateOne: {
          filter: { _id: apikeyId },
          update: { $addToSet: { version_ids: { $each: [...versionIds] } } }
        }
      });
    }

    // Stale cleanup: $unset specific service keys from apikey_object_id map
    const bulkConfigCleanup = [];
    for (const [configId, staleServices] of Object.entries(staleConfigRefs)) {
      const unsetObj = {};
      staleServices.forEach((s) => (unsetObj[`apikey_object_id.${s}`] = ""));
      bulkConfigCleanup.push({
        updateOne: { filter: { _id: configId }, update: { $unset: unsetObj } }
      });
    }

    const bulkVersionCleanup = [];
    for (const [versionId, staleServices] of Object.entries(staleVersionRefs)) {
      const unsetObj = {};
      staleServices.forEach((s) => (unsetObj[`apikey_object_id.${s}`] = ""));
      bulkVersionCleanup.push({
        updateOne: { filter: { _id: versionId }, update: { $unset: unsetObj } }
      });
    }

    const phase2Ops = [];
    if (bulkApikeyUpdates.length > 0)
      phase2Ops.push(apikeys.bulkWrite(bulkApikeyUpdates).then((r) => console.log(`  ✓ Added bridge_ids/version_ids to ${r.modifiedCount} apikeys`)));
    else console.log(`  - No apikeys needed bridge_ids/version_ids update`);
    if (bulkConfigCleanup.length > 0)
      phase2Ops.push(
        configurations
          .bulkWrite(bulkConfigCleanup)
          .then((r) => console.log(`  ✓ Removed stale apikey_object_id keys from ${r.modifiedCount} configurations`))
      );
    else console.log(`  - No stale apikey refs in configurations`);
    if (bulkVersionCleanup.length > 0)
      phase2Ops.push(
        versions.bulkWrite(bulkVersionCleanup).then((r) => console.log(`  ✓ Removed stale apikey_object_id keys from ${r.modifiedCount} versions`))
      );
    else console.log(`  - No stale apikey refs in versions`);

    if (phase2Ops.length > 0) await Promise.all(phase2Ops);

    // =============================================================
    // Phase 3: Convert ObjectId → String (parallel)
    // =============================================================
    console.log("\n=== Phase 3: Convert ObjectId → String ===");

    const bridgeConvert = convertObjectIds(apikeys, "bridge_ids");
    const versionConvert = convertObjectIds(apikeys, "version_ids");
    await Promise.all([bridgeConvert, versionConvert]);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary:");
    console.log(`  Stale config refs cleaned:  ${Object.values(staleConfigRefs).flat().length}`);
    console.log(`  Stale version refs cleaned: ${Object.values(staleVersionRefs).flat().length}`);
    console.log(`  Total apikey docs:          ${await apikeys.countDocuments()}`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await client.close();
    console.log("\nConnection closed");
  }
}

export { migrateApikeyCredentials };
