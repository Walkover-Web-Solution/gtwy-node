import { MongoClient } from "mongodb";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_URI;
const PUBLIC_REFERENCEID = process.env.PUBLIC_REFERENCEID;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

async function getOrgFromProxy(orgId) {
  const response = await axios.get(`https://routes.msg91.com/api/${PUBLIC_REFERENCEID}/getCompanies?id=${orgId}`, {
    headers: { "Content-Type": "application/json", Authkey: ADMIN_API_KEY }
  });
  return response?.data?.data?.data?.[0];
}

async function updateOrgMeta(orgId, meta) {
  const response = await axios.put(
    `https://routes.msg91.com/api/${PUBLIC_REFERENCEID}/updateDetails`,
    { company_id: orgId, company: { meta } },
    { headers: { "Content-Type": "application/json", Authkey: ADMIN_API_KEY } }
  );
  return response?.data;
}

async function migrateResponseTypes() {
  const client = new MongoClient(MONGODB_URI);
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const responseTypes = db.collection("responsetypes");

    const docs = await responseTypes.find({ orgAcessToken: { $exists: true, $ne: null } }).toArray();
    console.log(`Found ${docs.length} docs with orgAcessToken`);

    for (const doc of docs) {
      const orgId = doc.orgId;
      const token = doc.orgAcessToken;

      if (!orgId || !token) {
        console.log(`  ⏭ Skipping doc ${doc._id} — missing orgId or token`);
        skipped++;
        continue;
      }

      try {
        const org = await getOrgFromProxy(orgId);
        if (!org) {
          console.log(`  ⏭ Org ${orgId} not found in Proxy — skipping`);
          skipped++;
          continue;
        }

        if (org?.meta?.orgAccessToken) {
          console.log(`  ⏭ Org ${orgId} already has orgAccessToken in meta — skipping`);
          skipped++;
          continue;
        }

        await updateOrgMeta(orgId, { ...org?.meta, orgAccessToken: token });
        console.log(`  ✓ Migrated org ${orgId}`);
        migrated++;
      } catch (err) {
        console.error(`  ✗ Failed org ${orgId}: ${err.message}`);
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

export { migrateResponseTypes };
