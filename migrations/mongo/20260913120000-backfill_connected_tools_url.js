import { ObjectId } from "mongodb";

/**
 * Migration: Backfill the `url` field on `connected_tools` entries of type
 * "pre_tool" (pre_tool_type "custom_function") and "post_tool" in both the
 * `configurations` (agents/bridges) and `configuration_versions` (versions)
 * collections.
 *
 * These entries reference a function via `id` (the linked `apicalls` document's
 * _id). Previously the execution URL was rebuilt at runtime from that function's
 * script_id; we now store the full URL directly on the connected_tools entry, so
 * existing entries need a one-time backfill from the linked apicalls document.
 */

const TARGET_TYPES = ["pre_tool", "post_tool"];

const needsUrl = (tool) => {
  if (!tool || !TARGET_TYPES.includes(tool.type)) return false;
  if (tool.type === "pre_tool" && tool.pre_tool_type !== "custom_function") return false;
  if (tool.url) return false;
  return Boolean(tool.id);
};

export const up = async (db) => {
  console.log("=== Starting backfill_connected_tools_url migration ===");

  const apicalls = db.collection("apicalls");
  const collections = ["configurations", "configuration_versions"];

  for (const collName of collections) {
    console.log(`\n[${collName}] Processing...`);
    const coll = db.collection(collName);

    const cursor = coll.find({
      connected_tools: {
        $elemMatch: {
          type: { $in: TARGET_TYPES },
          $or: [{ url: { $exists: false } }, { url: "" }, { url: null }]
        }
      }
    });

    let processed = 0;
    let modified = 0;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      processed += 1;

      const tools = Array.isArray(doc.connected_tools) ? doc.connected_tools : [];
      let changed = false;

      for (const tool of tools) {
        if (!needsUrl(tool)) continue;

        let apiCallId;
        try {
          apiCallId = ObjectId.isValid(tool.id) ? new ObjectId(tool.id) : null;
        } catch {
          apiCallId = null;
        }
        if (!apiCallId) continue;

        const apiDoc = await apicalls.findOne({ _id: apiCallId }, { projection: { url: 1, script_id: 1 } });
        if (!apiDoc) continue;

        const url = apiDoc.url || (apiDoc.script_id ? `https://flow.sokt.io/func/${apiDoc.script_id}` : null);
        if (!url) continue;

        tool.url = url;
        changed = true;
      }

      if (changed) {
        await coll.updateOne({ _id: doc._id }, { $set: { connected_tools: tools } });
        modified += 1;
      }

      if (processed % 500 === 0) {
        console.log(`[${collName}] Processed ${processed} docs so far, modified ${modified}...`);
      }
    }

    console.log(`[${collName}] Done. Processed ${processed} docs, modified ${modified}.`);
  }

  console.log("\n=== Migration completed successfully ===");
};

export const down = async (db) => {
  const collections = ["configurations", "configuration_versions"];

  for (const collName of collections) {
    const coll = db.collection(collName);
    const cursor = coll.find({
      connected_tools: { $elemMatch: { type: { $in: TARGET_TYPES }, url: { $exists: true } } }
    });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const tools = Array.isArray(doc.connected_tools) ? doc.connected_tools : [];
      let changed = false;
      for (const tool of tools) {
        if (tool && TARGET_TYPES.includes(tool.type) && tool.url) {
          delete tool.url;
          changed = true;
        }
      }
      if (changed) {
        await coll.updateOne({ _id: doc._id }, { $set: { connected_tools: tools } });
      }
    }
    console.log(`[${collName}] Reverted: removed \`url\` from pre_tool/post_tool connected_tools entries.`);
  }
};
