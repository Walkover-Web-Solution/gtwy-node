import isEqual from "lodash/isEqual.js";

/** Keys excluded from per-field history tracking */
const EXCLUDED_HISTORY_KEYS = new Set([
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

/** Top-level agent keys compared on publish (mirrors frontend KEYS_TO_COMPARE) */
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

const CONFIGURATION_EXCLUDED_KEYS = new Set(["system_prompt_version_id"]);

/** Map request/body keys to history `type` values used by the frontend filter */
const HISTORY_TYPE_MAP = {
  function_ids: "functionData",
  connected_agents: "agents",
  configuration: "configuration"
};

const SYSTEM_HISTORY_TYPES = new Set(["Version published", "Version created", "Agent created"]);

/**
 * Resolve the history type label for a changed field.
 */
export function resolveHistoryType(key) {
  return HISTORY_TYPE_MAP[key] || key;
}

/**
 * Normalize agent data for publish comparison (flatten configuration, normalize connected_agents).
 */
export function normalizeAgentForPublishCompare(agent = {}) {
  if (!agent || typeof agent !== "object") return {};

  const connected_agents = agent.connected_agents || agent.page_config?.connected_agents || agent.configuration?.connected_agents || {};

  const normalized = { ...agent, connected_agents };

  if (agent.configuration && typeof agent.configuration === "object") {
    for (const [configKey, configValue] of Object.entries(agent.configuration)) {
      if (!CONFIGURATION_EXCLUDED_KEYS.has(configKey)) {
        normalized[configKey] = configValue;
      }
    }
  }

  return normalized;
}

/**
 * Compare published bridge data vs version being published; return changed field keys only.
 */
export function getPublishChangedKeys(publishedAgent = {}, versionAgent = {}) {
  const oldData = normalizeAgentForPublishCompare(publishedAgent);
  const newData = normalizeAgentForPublishCompare(versionAgent);
  const changedKeys = new Set();

  for (const topKey of PUBLISH_COMPARE_KEYS) {
    const oldVal = oldData[topKey];
    const newVal = newData[topKey];

    if (topKey === "configuration") {
      const oldConfig = oldVal && typeof oldVal === "object" ? oldVal : {};
      const newConfig = newVal && typeof newVal === "object" ? newVal : {};
      const configKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

      for (const configKey of configKeys) {
        if (CONFIGURATION_EXCLUDED_KEYS.has(configKey)) continue;
        if (!isEqual(oldConfig[configKey], newConfig[configKey])) {
          changedKeys.add(resolveHistoryType(configKey));
        }
      }
      continue;
    }

    if (!isEqual(oldVal, newVal)) {
      changedKeys.add(resolveHistoryType(topKey));
    }
  }

  return [...changedKeys];
}

/**
 * Build per-key history rows for a version update request body.
 */
export function buildVersionUpdateHistoryEntries({ user_id, org_id, bridge_id, version_id, body, version }) {
  if (!body || typeof body !== "object") return [];

  const entries = [];
  const time = new Date();
  const base = { user_id, org_id, bridge_id, version_id, time };
  const current_configuration = version?.configuration || {};

  for (const key of Object.keys(body)) {
    if (key === "agents" && body.agents?.connected_agents) {
      const previousVal = version?.connected_agents || version?.page_config?.connected_agents || version?.configuration?.connected_agents || null;
      const currentVal = body.agents.connected_agents ?? null;
      if (!isEqual(previousVal, currentVal)) {
        entries.push({
          ...base,
          type: "agents",
          previous_value: { connected_agents: previousVal },
          current_value: { connected_agents: currentVal }
        });
      }
      continue;
    }

    if (EXCLUDED_HISTORY_KEYS.has(key)) continue;

    if (key === "configuration" && body.configuration && typeof body.configuration === "object") {
      for (const configKey of Object.keys(body.configuration)) {
        if (EXCLUDED_HISTORY_KEYS.has(configKey) || CONFIGURATION_EXCLUDED_KEYS.has(configKey)) continue;

        const previousVal = current_configuration[configKey] ?? null;
        const currentVal = body.configuration[configKey] ?? null;
        if (isEqual(previousVal, currentVal)) continue;

        entries.push({
          ...base,
          type: resolveHistoryType(configKey),
          previous_value: { [configKey]: previousVal },
          current_value: { [configKey]: currentVal }
        });
      }
      continue;
    }

    const previousVal = version?.[key] ?? null;
    const currentVal = body[key] ?? null;
    if (isEqual(previousVal, currentVal)) continue;

    entries.push({
      ...base,
      type: resolveHistoryType(key),
      previous_value: { [key]: previousVal },
      current_value: { [key]: currentVal }
    });
  }

  return entries;
}

/**
 * Build per-key history rows for agent-level updates (replicated across all versions).
 */
export function buildAgentUpdateHistoryEntries({ user_id, org_id, bridge_id, versionIds, body, agent }) {
  if (!body || typeof body !== "object" || !Array.isArray(versionIds) || versionIds.length === 0) return [];

  const perVersionEntries = buildVersionUpdateHistoryEntries({
    user_id,
    org_id,
    bridge_id,
    version_id: versionIds[0],
    body,
    version: agent
  });

  if (versionIds.length === 1) return perVersionEntries;

  const replicated = [];
  for (const version_id of versionIds) {
    for (const entry of perVersionEntries) {
      replicated.push({ ...entry, version_id: String(version_id) });
    }
  }
  return replicated;
}

/**
 * Build attribution snapshot for a publish event from latest per-key history rows.
 */
export function buildPublishAttributionSnapshot(changedKeys, latestHistoryRows = []) {
  const snapshot = {};

  for (const key of changedKeys) {
    const row = latestHistoryRows.find((entry) => entry.type === key);
    if (!row) {
      snapshot[key] = null;
      continue;
    }

    snapshot[key] = {
      history_id: row.id,
      user_id: row.user_id,
      time: row.time,
      previous_value: row.previous_value ?? null,
      current_value: row.current_value ?? null
    };
  }

  return snapshot;
}

/**
 * Build the publish history row including changed-key attribution snapshot.
 */
export function buildPublishHistoryEntry({
  user_id,
  org_id,
  bridge_id,
  version_id,
  previousPublishedVersionId,
  publishedVersionId,
  changedKeys,
  snapshot
}) {
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

export function isFieldHistoryType(type) {
  return type && !SYSTEM_HISTORY_TYPES.has(type) && type !== "agent_update" && type !== "configuration";
}
