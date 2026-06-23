import isEqual from "lodash/isEqual.js";

const EXCLUDED_KEYS = new Set([
  "system_prompt_version_id",
  "variables_state",
  "functionData",
  "built_in_tools_data",
  "agents",
  "version_description",
  "updatedAt",
  "createdAt",
  "is_drafted"
]);

const CONFIG_EXCLUDED = new Set(["system_prompt_version_id"]);
const MODEL_GROUP_CONFIG_KEYS = new Set(["model", "type"]);

const TYPE_MAP = {
  function_ids: "functionData",
  connected_agents: "agents"
};

export const PUBLISH_COMPARE_KEYS = [
  "configuration",
  "service",
  "cache_on",
  "apikey_object_id",
  "gpt_memory",
  "function_ids",
  "pre_tools",
  "settings",
  "IsstarterQuestionEnable",
  "connected_agents",
  "user_reference",
  "doc_ids",
  "gpt_memory_context"
];

function historyType(key) {
  return TYPE_MAP[key] || key;
}

function isModeValue(val) {
  return typeof val === "object" && val !== null && !Array.isArray(val) && "mode" in val;
}

/** Treat "default" and { mode: "default" } as the same so we don't flag untouched params */
function normalizeCompareValue(val) {
  if (val === undefined || val === null || val === "default") return null;
  if (isModeValue(val)) {
    if (val.mode === "default") return null;
    if (val.mode === "min") return "__min__";
    if (val.mode === "max") return "__max__";
    if (val.mode === "custom") return normalizeCompareValue(val.value);
    return val;
  }
  return val;
}

function historyValuesEqual(before, after) {
  return isEqual(normalizeCompareValue(before), normalizeCompareValue(after));
}

function historyEntry(base, type, previousVal, currentVal) {
  return {
    ...base,
    type,
    previous_value: previousVal ?? null,
    current_value: currentVal ?? null
  };
}

/** service + model + type in one request → single history row */
function buildModelGroupEntry(base, body, version) {
  const config = version?.configuration || {};
  const configBody = body.configuration || {};
  const hasService = body.service !== undefined;
  const hasModel = configBody.model !== undefined;
  const hasType = configBody.type !== undefined;

  if (!hasService && !hasModel && !hasType) return null;

  const before = {
    service: version?.service ?? null,
    model: config.model ?? null,
    type: config.type ?? null
  };
  const after = {
    service: hasService ? body.service : before.service,
    model: hasModel ? configBody.model : before.model,
    type: hasType ? configBody.type : before.type
  };

  if (isEqual(before, after)) return null;
  return historyEntry(base, "model", before, after);
}

function normalizeForPublishCompare(agent = {}) {
  if (!agent || typeof agent !== "object") return {};

  const normalized = {
    ...agent,
    connected_agents:
      agent.connected_agents || agent.page_config?.connected_agents || agent.configuration?.connected_agents || {}
  };

  if (agent.configuration && typeof agent.configuration === "object") {
    for (const [k, v] of Object.entries(agent.configuration)) {
      if (!CONFIG_EXCLUDED.has(k)) normalized[k] = v;
    }
  }

  return normalized;
}

/** Used by publish modal diff only — not for history snapshot */
export function getPublishChangedKeys(publishedAgent = {}, versionAgent = {}) {
  const oldData = normalizeForPublishCompare(publishedAgent);
  const newData = normalizeForPublishCompare(versionAgent);
  const changed = new Set();

  for (const topKey of PUBLISH_COMPARE_KEYS) {
    const oldVal = oldData[topKey];
    const newVal = newData[topKey];

    if (topKey === "configuration") {
      const oldConfig = oldVal && typeof oldVal === "object" ? oldVal : {};
      const newConfig = newVal && typeof newVal === "object" ? newVal : {};
      for (const k of new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)])) {
        if (CONFIG_EXCLUDED.has(k)) continue;
        if (!historyValuesEqual(oldConfig[k], newConfig[k])) changed.add(historyType(k));
      }
      continue;
    }

    if (!isEqual(oldVal, newVal)) changed.add(historyType(topKey));
  }

  return [...changed];
}

export function buildVersionUpdateHistoryEntries({ user_id, org_id, bridge_id, version_id, body, version }) {
  if (!body || typeof body !== "object") return [];

  const entries = [];
  const base = { user_id, org_id, bridge_id, version_id, time: new Date() };
  const config = version?.configuration || {};
  const skipConfigKeys = new Set();

  const modelGroup = buildModelGroupEntry(base, body, version);
  if (modelGroup) {
    entries.push(modelGroup);
    MODEL_GROUP_CONFIG_KEYS.forEach((k) => skipConfigKeys.add(k));
  }

  for (const key of Object.keys(body)) {
    if (key === "service") continue;

    if (key === "agents" && body.agents?.connected_agents) {
      const before =
        version?.connected_agents || version?.page_config?.connected_agents || version?.configuration?.connected_agents || null;
      const after = body.agents.connected_agents ?? null;
      if (!isEqual(before, after)) entries.push(historyEntry(base, "agents", before, after));
      continue;
    }

    if (EXCLUDED_KEYS.has(key)) continue;

    if (key === "configuration" && body.configuration && typeof body.configuration === "object") {
      for (const configKey of Object.keys(body.configuration)) {
        if (EXCLUDED_KEYS.has(configKey) || CONFIG_EXCLUDED.has(configKey) || skipConfigKeys.has(configKey)) continue;
        const before = config[configKey] ?? null;
        const after = body.configuration[configKey] ?? null;
        if (!isEqual(before, after)) entries.push(historyEntry(base, historyType(configKey), before, after));
      }
      continue;
    }

    const before = version?.[key] ?? null;
    const after = body[key] ?? null;
    if (!isEqual(before, after)) entries.push(historyEntry(base, historyType(key), before, after));
  }

  return entries;
}

export function buildAgentUpdateHistoryEntries({ user_id, org_id, bridge_id, versionIds, body, agent }) {
  if (!body || !Array.isArray(versionIds) || versionIds.length === 0) return [];

  const rows = buildVersionUpdateHistoryEntries({
    user_id,
    org_id,
    bridge_id,
    version_id: versionIds[0],
    body,
    version: agent
  });

  if (versionIds.length === 1) return rows;
  return versionIds.flatMap((vid) => rows.map((row) => ({ ...row, version_id: String(vid) })));
}

/** Snapshot from user history rows that represent a real edit */
export function buildPublishAttributionSnapshot(historyRows = []) {
  const snapshot = {};

  for (const row of historyRows) {
    if (!row?.type) continue;
    if (row.type === "configuration" || row.type === "agent_update") continue;
    if (historyValuesEqual(row.previous_value, row.current_value)) continue;

    snapshot[row.type] = {
      history_id: row.id,
      user_id: row.user_id,
      time: row.time,
      previous_value: row.previous_value ?? null,
      current_value: row.current_value ?? null
    };
  }

  return snapshot;
}

export function buildPublishHistoryEntry({
  user_id,
  org_id,
  bridge_id,
  version_id,
  previousPublishedVersionId,
  publishedVersionId,
  snapshot
}) {
  const changedKeys = Object.keys(snapshot || {});

  return {
    user_id,
    org_id,
    bridge_id,
    version_id,
    type: "Version published",
    time: new Date(),
    previous_value: {
      version_id: previousPublishedVersionId ? String(previousPublishedVersionId) : null,
      changed_keys: changedKeys
    },
    current_value: {
      version_id: String(publishedVersionId),
      snapshot
    }
  };
}
