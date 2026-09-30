/**
 * Migration: Build a correct `connected_tools` array on every agent and version, in both
 * `configurations` and `configuration_versions`.
 *
 * Replaces the conversion done by 20260706120000-migrate-to-connected-tools, which:
 * - spread pre_tool `args` onto the entry (an arg named `type`, `id`, `url`, ... overwrote that field)
 * - gave pre_tools a random id instead of the linked function's id
 * - skipped `connected_agents` (an object keyed by bridge_id, not an array) and then unset it
 * - stored object doc_ids as "[object Object]"
 * - never converted `post_tool`
 *
 * Runs the same way on every environment, over the full collections. It works from whatever
 * state a document is in (legacy fields, the broken conversion, or already correct) and is
 * safe to re-run:
 * 1. Repairs entries already in connected_tools (the broken shapes above).
 * 2. Converts whatever legacy fields are still present and unsets them.
 * 3. Dedupes, keeping the existing connected_tools entry over a legacy one.
 * 4. Fills empty tool/agent `variable_path` and pre/post tool `args` from `variables_path`,
 *    which is keyed by the function's script_id (looked up in apicalls) or the agent's bridge_id.
 * 5. Fills `url` on custom_function pre_tools and post_tools from the linked apicalls document.
 *
 * `variables_path` is left in place: it is still read outside connected_tools.
 * Set CONNECTED_TOOLS_DRY_RUN=true to log the counts without writing anything.
 */

import { ObjectId } from "mongodb";

const COLLECTIONS = ["configurations", "configuration_versions"];

const BATCH_SIZE = 500;

const LEGACY_FIELDS = [
  "function_ids",
  "built_in_tools",
  "connected_agents",
  "doc_ids",
  "pre_tools",
  "post_tool",
  "web_search_filters",
  "gtwy_web_search_filters"
];

const CONNECTED_TOOL_TYPES = new Set(["tools", "agent", "docs", "pre_tool", "post_tool", "built_in_tools"]);

// Fields a pre_tool entry legitimately carries; anything else is a spread arg.
const PRE_TOOL_KEYS = new Set([
  "_id",
  "type",
  "pre_tool_type",
  "id",
  "variable_path",
  "prompt",
  "formats",
  "url",
  "resource_id",
  "collection_id",
  "args",
  "name",
  "description"
]);

// The original migration generated ids as Date.now().toString() + Math.random().
const GENERATED_ID = /^\d{13}0\.\d+$/;

const BROKEN_DOC_ID = "[object Object]";

const toId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    if (typeof value.$oid === "string") return value.$oid;
  }
  const id = String(value);
  return id === BROKEN_DOC_ID ? null : id;
};

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

// Key-order-insensitive comparison, so a re-run does not rewrite already-correct documents.
const stableStringify = (value) => {
  if (value instanceof ObjectId) return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const isPreTool = (tool) => tool.type === "pre_tool" || (tool.pre_tool_type && !CONNECTED_TOOL_TYPES.has(tool.type));

const needsUrl = (tool) =>
  (tool.type === "post_tool" || (tool.type === "pre_tool" && tool.pre_tool_type === "custom_function")) && tool.id && !tool.url;

// ---------- repair entries already in connected_tools ----------

const repairPreTool = (tool, stats) => {
  const fixed = { type: "pre_tool", pre_tool_type: tool.pre_tool_type };
  const args = {};
  for (const [key, value] of Object.entries(tool)) {
    if (!PRE_TOOL_KEYS.has(key)) args[key] = value;
  }
  // An arg named "type" overwrote "pre_tool"; its value belongs to the args.
  if (tool.type !== "pre_tool") args.type = tool.type;
  if (Object.keys(args).length > 0) stats.pre_tool_args_repaired += 1;
  Object.assign(args, tool.args || {});

  const functionId = toId(tool.variable_path?.function_id);
  const id = toId(tool.id);
  if (fixed.pre_tool_type === "custom_function" && functionId && (!id || GENERATED_ID.test(id))) {
    fixed.id = functionId;
    stats.pre_tool_ids_repaired += 1;
  } else if (id && !GENERATED_ID.test(id)) {
    fixed.id = id;
  }

  for (const key of ["variable_path", "prompt", "formats", "url", "resource_id", "collection_id", "name", "description"]) {
    if (tool[key] !== undefined) fixed[key] = tool[key];
  }
  if (Object.keys(args).length > 0) fixed.args = args;
  return fixed;
};

const repairEntry = (tool, stats) => {
  if (!tool || typeof tool !== "object") return null;
  if (isPreTool(tool)) return repairPreTool(tool, stats);

  switch (tool.type) {
    case "tools":
    case "agent":
    case "post_tool": {
      const id = toId(tool.id);
      return id ? { ...tool, id } : null;
    }
    case "docs": {
      const id = toId(tool.id ?? tool.resource_id);
      if (!id || id === BROKEN_DOC_ID) {
        stats.broken_docs_removed += 1;
        return null;
      }
      return { ...tool, id };
    }
    default:
      return tool;
  }
};

// ---------- convert legacy fields ----------

const legacyTools = (doc) => {
  const variables_path = doc.variables_path || {};
  const ids = Array.isArray(doc.function_ids)
    ? doc.function_ids
    : doc.function_ids && typeof doc.function_ids === "object"
      ? Object.values(doc.function_ids)
      : [];
  return ids
    .map(toId)
    .filter(Boolean)
    .map((id) => ({ type: "tools", id, variable_path: variables_path[id] || {} }));
};

const legacyAgents = (doc) => {
  const variables_path = doc.variables_path || {};
  const agents = doc.connected_agents;
  if (!agents || typeof agents !== "object") return [];
  const pairs = Array.isArray(agents) ? agents.map((info) => [null, info]) : Object.entries(agents);

  const entries = [];
  for (const [key, info] of pairs) {
    const id = toId(typeof info === "object" ? (info?.bridge_id ?? info?.id ?? info?._id ?? key) : (info ?? key));
    if (!id) continue;
    const entry = { type: "agent", id, variable_path: info?.variable_path || variables_path[id] || {} };
    entry.thread_id = info?.thread_id !== undefined ? info.thread_id : true;
    if (info?.version_id) entry.version_id = toId(info.version_id);
    entries.push(entry);
  }
  return entries;
};

const legacyDocs = (doc) =>
  (Array.isArray(doc.doc_ids) ? doc.doc_ids : [])
    .map((item) => {
      if (item && typeof item === "object" && !(item instanceof ObjectId)) {
        const id = toId(item.resource_id ?? item.id ?? item._id);
        if (!id) return null;
        const entry = { ...item, type: "docs", id };
        delete entry._id;
        return entry;
      }
      const id = toId(item);
      return id && id !== BROKEN_DOC_ID ? { type: "docs", id } : null;
    })
    .filter(Boolean);

const legacyPreTools = (doc) =>
  (Array.isArray(doc.pre_tools) ? doc.pre_tools : [])
    .filter((pre) => pre && (pre.type || pre.pre_tool_type))
    .map((pre) => {
      const pre_tool_type = pre.type || pre.pre_tool_type;
      const entry = { type: "pre_tool", pre_tool_type };
      const id = toId(pre.config?.function_id) || toId(pre.id);
      if (id && !GENERATED_ID.test(id)) entry.id = id;
      if (pre.config) entry.variable_path = pre.config;
      for (const key of ["prompt", "formats", "url", "resource_id", "collection_id", "name", "description"]) {
        if (pre[key] !== undefined) entry[key] = pre[key];
      }
      if (hasValue(pre.args)) entry.args = pre.args;
      return entry;
    });

const legacyPostTool = (doc) => {
  const post = doc.post_tool;
  const id = toId(post?.id);
  if (!id) return [];
  const entry = { type: "post_tool", id };
  if (post.url) entry.url = post.url;
  if (post.script_id) entry.script_id = post.script_id;
  if (hasValue(post.args)) entry.args = post.args;
  return [entry];
};

const legacyBuiltIn = (doc) => {
  const built_in_tools = (Array.isArray(doc.built_in_tools) ? doc.built_in_tools : []).map(toId).filter(Boolean);
  const entry = { type: "built_in_tools", built_in_tools };
  if (hasValue(doc.web_search_filters)) entry.web_search_filters = doc.web_search_filters;
  if (hasValue(doc.gtwy_web_search_filters)) entry.gtwy_web_search_filters = doc.gtwy_web_search_filters;
  return built_in_tools.length > 0 || entry.web_search_filters || entry.gtwy_web_search_filters ? entry : null;
};

// ---------- merge ----------

const entryKey = (tool) => {
  if (tool.type === "pre_tool") return `pre_tool:${tool.pre_tool_type}:${tool.id || ""}`;
  if (tool.type === "post_tool") return "post_tool"; // only one post_tool per agent
  if (tool.id) return `${tool.type}:${tool.id}`;
  return null;
};

const mergeBuiltIn = (target, source) => {
  target.built_in_tools = [...new Set([...(target.built_in_tools || []), ...(source.built_in_tools || [])])];
  if (!hasValue(target.web_search_filters) && source.web_search_filters) target.web_search_filters = source.web_search_filters;
  if (!hasValue(target.gtwy_web_search_filters) && source.gtwy_web_search_filters) target.gtwy_web_search_filters = source.gtwy_web_search_filters;
};

const buildConnectedTools = (doc, stats) => {
  const result = [];
  const seen = new Set();
  let builtIn = null;

  const add = (tool, fromLegacy) => {
    if (!tool) return;
    if (tool.type === "built_in_tools") {
      if (builtIn) mergeBuiltIn(builtIn, tool);
      else {
        builtIn = { ...tool, built_in_tools: [...(tool.built_in_tools || [])] };
        result.push(builtIn);
      }
      return;
    }
    const key = entryKey(tool);
    if (key && seen.has(key)) {
      if (!fromLegacy) stats.duplicates_removed += 1;
      return;
    }
    if (key) seen.add(key);
    if (fromLegacy) stats.legacy_converted += 1;
    result.push(tool);
  };

  for (const tool of Array.isArray(doc.connected_tools) ? doc.connected_tools : []) add(repairEntry(tool, stats), false);

  for (const tool of [
    ...legacyTools(doc),
    ...legacyAgents(doc),
    ...legacyDocs(doc),
    ...legacyPreTools(doc),
    ...legacyPostTool(doc),
    legacyBuiltIn(doc)
  ]) {
    add(tool, true);
  }

  return result;
};

// ---------- apicalls lookup (script_id + url) ----------

const FUNCTION_TYPES = new Set(["tools", "pre_tool", "post_tool"]);

const createApiCallLookup = (db) => {
  const apicalls = db.collection("apicalls");
  const cache = new Map();

  const load = async (tools) => {
    const ids = [...new Set(tools.filter((t) => FUNCTION_TYPES.has(t.type) && t.id).map((t) => t.id))];
    const missing = ids.filter((id) => !cache.has(id) && ObjectId.isValid(id));
    if (missing.length === 0) return;
    const found = await apicalls.find({ _id: { $in: missing.map((id) => new ObjectId(id)) } }, { projection: { url: 1, script_id: 1 } }).toArray();
    for (const id of missing) cache.set(id, null);
    for (const call of found) cache.set(call._id.toString(), { url: call.url || null, script_id: call.script_id || null });
  };

  return { load, get: (id) => cache.get(id) || null };
};

const scriptIdOf = (tool, lookup) => tool.variable_path?.script_id || tool.script_id || lookup.get(tool.id)?.script_id || null;

// Legacy variables_path is keyed by the function's script_id (older data: its _id) and by the
// connected agent's bridge_id; custom_function pre/post tools kept their args there too.
const fillVariables = (tools, doc, lookup) => {
  const variables_path = doc.variables_path || {};
  const pick = (...keys) => keys.map((key) => key && variables_path[key]).find(hasValue);
  let filled = 0;

  for (const tool of tools) {
    let value;
    if (tool.type === "tools" && !hasValue(tool.variable_path)) {
      value = pick(scriptIdOf(tool, lookup), tool.id);
      if (value) tool.variable_path = value;
    } else if (tool.type === "agent" && !hasValue(tool.variable_path)) {
      value = pick(tool.id, tool.version_id);
      if (value) tool.variable_path = value;
    } else if ((tool.type === "post_tool" || (tool.type === "pre_tool" && tool.pre_tool_type === "custom_function")) && !hasValue(tool.args)) {
      value = pick(scriptIdOf(tool, lookup), tool.id);
      if (value) tool.args = value;
    }
    if (value) filled += 1;
  }
  return filled;
};

const fillUrls = (tools, lookup) => {
  let filled = 0;
  for (const tool of tools) {
    if (!needsUrl(tool)) continue;
    const scriptId = scriptIdOf(tool, lookup);
    const url = lookup.get(tool.id)?.url || (scriptId ? `https://flow.sokt.io/func/${scriptId}` : null);
    if (url) {
      tool.url = url;
      filled += 1;
    }
  }
  return filled;
};

export const up = async (db) => {
  const dryRun = String(process.env.CONNECTED_TOOLS_DRY_RUN || "").toLowerCase() === "true";
  console.log(`=== fix_connected_tools${dryRun ? " (DRY RUN — no writes)" : ""} ===`);

  const lookup = createApiCallLookup(db);

  for (const name of COLLECTIONS) {
    const coll = db.collection(name);
    const stats = {
      processed: 0,
      modified: 0,
      legacy_converted: 0,
      pre_tool_args_repaired: 0,
      pre_tool_ids_repaired: 0,
      broken_docs_removed: 0,
      duplicates_removed: 0,
      variables_filled: 0,
      urls_filled: 0,
      urls_missing: 0
    };
    let ops = [];

    const flush = async () => {
      if (ops.length === 0) return;
      if (!dryRun) await coll.bulkWrite(ops, { ordered: false });
      ops = [];
    };

    const cursor = coll.find({
      $or: [{ "connected_tools.0": { $exists: true } }, ...LEGACY_FIELDS.map((field) => ({ [field]: { $exists: true } }))]
    });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      stats.processed += 1;

      const connected_tools = buildConnectedTools(doc, stats);
      await lookup.load(connected_tools);
      stats.variables_filled += fillVariables(connected_tools, doc, lookup);
      stats.urls_filled += fillUrls(connected_tools, lookup);
      stats.urls_missing += connected_tools.filter(needsUrl).length;

      const $unset = {};
      for (const field of LEGACY_FIELDS) {
        if (hasValue(doc[field])) $unset[field] = "";
      }

      const toolsChanged = stableStringify(connected_tools) !== stableStringify(doc.connected_tools || []);
      if (!toolsChanged && Object.keys($unset).length === 0) continue;

      const update = { $set: { connected_tools } };
      if (Object.keys($unset).length > 0) update.$unset = $unset;
      ops.push({ updateOne: { filter: { _id: doc._id }, update } });
      stats.modified += 1;

      if (ops.length >= BATCH_SIZE) await flush();
      if (stats.processed % 1000 === 0) console.log(`[${name}] processed ${stats.processed}, modified ${stats.modified}...`);
    }
    await flush();

    console.log(`[${name}] ${JSON.stringify(stats)}`);
  }

  console.log("=== fix_connected_tools completed ===");
};

export const down = async () => {
  // No-op: this repairs connected_tools in place; the broken and legacy shapes are not worth restoring.
};
