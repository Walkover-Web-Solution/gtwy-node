/**
 * Migration: move agents and versions back from `connected_tools` to the legacy tool fields.
 *
 *   The tools new format was reverted. 20260706120000-migrate-to-connected-tools had moved
 *   function_ids, connected_agents, doc_ids, pre_tools, post_tool, built_in_tools and the web
 *   search filters into one `connected_tools` array and unset them. This rebuilds them from
 *   that array, in both `configurations` and `configuration_versions`:
 *     tools          -> function_ids (string ids), variables_path[script_id]
 *     agent          -> connected_agents[bridge_id] = { bridge_id, thread_id, ... }, variables_path[bridge_id]
 *     docs           -> doc_ids
 *     pre_tool       -> pre_tools = [{ type, config, args, ... }] (config.function_id for custom_function)
 *     post_tool      -> post_tool = { id, script_id, url, args }
 *     built_in_tools -> built_in_tools, web_search_filters, gtwy_web_search_filters, gtwy_browser_settings
 *
 *   A legacy field that already has a value is left alone. `connected_tools` is not deleted:
 *   it is renamed to `connected_tools_reverted`, so nothing is lost, and the forward migration
 *   would not prefer it over newer legacy data if the format is brought back.
 *   Safe to re-run. Set CONNECTED_TOOLS_DRY_RUN=true to log the counts without writing anything.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */

import { ObjectId } from "mongodb";

const COLLECTIONS = ["configurations", "configuration_versions"];

const BATCH_SIZE = 500;

const BACKUP_FIELD = "connected_tools_reverted";

const OBJECT_ID = /^[0-9a-f]{24}$/i;

const toId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (typeof value.$oid === "string") return value.$oid;
  }
  return String(value);
};

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([key]) => !keys.includes(key)));

// script_id of each apicalls document, cached across documents.
const createScriptIdLookup = (db) => {
  const apicalls = db.collection("apicalls");
  const cache = new Map();
  return {
    async load(ids) {
      const missing = [...new Set(ids)].filter((id) => OBJECT_ID.test(id) && !cache.has(id));
      if (missing.length === 0) return;
      const docs = await apicalls.find({ _id: { $in: missing.map((id) => new ObjectId(id)) } }, { projection: { script_id: 1 } }).toArray();
      for (const id of missing) cache.set(id, null);
      for (const doc of docs) cache.set(doc._id.toHexString(), doc.script_id || null);
    },
    get: (id) => cache.get(id) || null
  };
};

const toLegacyPreTool = (tool) => {
  const pre = { type: tool.pre_tool_type };
  const config = { ...(tool.variable_path || {}) };
  const id = toId(tool.id);
  if (tool.pre_tool_type === "custom_function" && id && !config.function_id) config.function_id = id;
  if (hasValue(config)) pre.config = config;
  for (const key of ["prompt", "formats", "url", "resource_id", "collection_id", "name", "description"]) {
    if (tool[key] !== undefined) pre[key] = tool[key];
  }
  if (hasValue(tool.args)) pre.args = tool.args;
  return pre;
};

// The legacy fields to $set on one document, built from its connected_tools.
const buildLegacyFields = (doc, lookup) => {
  const tools = Array.isArray(doc.connected_tools) ? doc.connected_tools.filter((t) => t && typeof t === "object") : [];
  const variables_path = { ...(doc.variables_path || {}) };
  const legacy = {
    function_ids: [],
    connected_agents: {},
    doc_ids: [],
    pre_tools: [],
    post_tool: null,
    built_in_tools: []
  };
  let builtIn = null;

  for (const tool of tools) {
    const id = toId(tool.id);
    switch (tool.type) {
      case "tools": {
        if (!id || legacy.function_ids.includes(id)) break;
        legacy.function_ids.push(id);
        const scriptId = lookup.get(id) || id;
        if (hasValue(tool.variable_path) && !hasValue(variables_path[scriptId])) variables_path[scriptId] = tool.variable_path;
        break;
      }
      case "agent": {
        if (!id) break;
        legacy.connected_agents[id] = { ...omit(tool, ["type", "id", "variable_path"]), bridge_id: id };
        if (legacy.connected_agents[id].thread_id === undefined) legacy.connected_agents[id].thread_id = true;
        if (hasValue(tool.variable_path) && !hasValue(variables_path[id])) variables_path[id] = tool.variable_path;
        break;
      }
      case "docs": {
        if (!id) break;
        legacy.doc_ids.push({ ...omit(tool, ["type", "id"]), resource_id: tool.resource_id || id });
        break;
      }
      case "pre_tool":
        if (tool.pre_tool_type) legacy.pre_tools.push(toLegacyPreTool(tool));
        break;
      case "post_tool":
        if (id) legacy.post_tool = { ...omit(tool, ["type"]), id };
        break;
      case "built_in_tools":
        builtIn = tool;
        legacy.built_in_tools = (Array.isArray(tool.built_in_tools) ? tool.built_in_tools : []).map(toId).filter(Boolean);
        break;
      default:
        break;
    }
  }

  if (builtIn) {
    for (const key of ["web_search_filters", "gtwy_web_search_filters", "gtwy_browser_settings"]) {
      if (hasValue(builtIn[key])) legacy[key] = builtIn[key];
    }
  }

  // Only fill fields that are empty, so nothing saved in the legacy format is overwritten.
  const $set = {};
  for (const [field, value] of Object.entries(legacy)) {
    if (hasValue(value) && !hasValue(doc[field])) $set[field] = value;
  }
  if (JSON.stringify(variables_path) !== JSON.stringify(doc.variables_path || {})) $set.variables_path = variables_path;
  return $set;
};

export const up = async (db) => {
  const dryRun = process.env.CONNECTED_TOOLS_DRY_RUN === "true";
  console.log(`=== restore_legacy_tool_fields started${dryRun ? " (dry run)" : ""} ===`);
  const lookup = createScriptIdLookup(db);

  for (const name of COLLECTIONS) {
    const coll = db.collection(name);
    const stats = { processed: 0, modified: 0, fields_restored: 0 };
    let ops = [];

    const flush = async () => {
      if (ops.length === 0) return;
      if (!dryRun) await coll.bulkWrite(ops, { ordered: false });
      ops = [];
    };

    const cursor = coll.find({ connected_tools: { $exists: true } });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      stats.processed += 1;

      const tools = Array.isArray(doc.connected_tools) ? doc.connected_tools : [];
      await lookup.load(tools.filter((t) => t?.type === "tools").map((t) => toId(t.id)));
      const $set = buildLegacyFields(doc, lookup);
      stats.fields_restored += Object.keys($set).length;

      // A document that already has a backup keeps connected_tools as it is.
      const update = doc[BACKUP_FIELD] === undefined ? { $rename: { connected_tools: BACKUP_FIELD } } : {};
      if (Object.keys($set).length > 0) update.$set = $set;
      if (Object.keys(update).length === 0) continue;
      ops.push({ updateOne: { filter: { _id: doc._id }, update } });
      stats.modified += 1;

      if (ops.length >= BATCH_SIZE) await flush();
      if (stats.processed % 1000 === 0) console.log(`[${name}] processed ${stats.processed}, modified ${stats.modified}...`);
    }
    await flush();

    console.log(`[${name}] ${JSON.stringify(stats)}`);
  }

  console.log("=== restore_legacy_tool_fields completed ===");
};

export const down = async (db) => {
  // Puts connected_tools back from the backup; the restored legacy fields are left in place.
  for (const name of COLLECTIONS) {
    await db
      .collection(name)
      .updateMany({ [BACKUP_FIELD]: { $exists: true }, connected_tools: { $exists: false } }, { $rename: { [BACKUP_FIELD]: "connected_tools" } });
  }
};
