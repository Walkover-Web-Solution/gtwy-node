import isEqual from "lodash/isEqual.js";

export function appendVersionUpdateHistory(entries, { base, body, version, update_fields, cur, reverted_from_id }) {
  const cfg = body.configuration;

  // Core logging function: compares before/after and records change if different
  const log = (type, before, after) => {
    if (isEqual(before, after)) return;
    entries.push({
      ...base,
      type,
      previous_value: before ?? null,
      current_value: reverted_from_id != null ? { value: after ?? null, reverted_from_id } : (after ?? null)
    });
  };

  // Helper to log multiple keys from nested objects (e.g., settings, agent_info)
  const logKeys = (keys, a, b) => {
    for (const k of keys) log(k, a?.[k], b?.[k]);
  };

  // Special handling for model/service/type: they can come from both body.service and body.configuration
  // We group them into a single "model" history entry to avoid three separate entries
  let modelLogged = false;
  const logModel = () => {
    // Skip if already logged or if none of the model-related fields changed
    if (modelLogged || (body.service === undefined && cfg?.model === undefined && cfg?.type === undefined)) return;
    modelLogged = true;
    const b = { service: version.service ?? null, model: cur.model ?? null, type: cur.type ?? null };
    log("model", b, { service: body.service ?? b.service, model: cfg?.model ?? b.model, type: cfg?.type ?? b.type });
  };
  const handlers = {
    service: logModel,
    configuration: () => {
      if (!cfg) return;
      logModel();
      for (const k in cfg || {}) {
        if (k === "model" || k === "type") continue;
        log(k === "prompt" ? "prompt" : k, cur[k], cfg[k]);
      }
    },
    settings: () => {
      if (!body.settings) return;
      logKeys(Object.keys(body.settings), version.settings, update_fields.settings);
    },
    agent_info: () => {
      if (!body.agent_info) return;
      logKeys(Object.keys(body.agent_info), version.agent_info, update_fields.agent_info);
    },
    functionData: () => {
      if (!update_fields.function_ids) return;
      log("functionData", (version.function_ids || []).map(String), update_fields.function_ids.map(String));
    },
    agents: () => {
      if (!body.agents?.connected_agents) return;
      const after = { ...(version.connected_agents || {}) };
      for (const [k, info] of Object.entries(body.agents.connected_agents)) {
        const id = info.bridge_id?.toString() ?? k;
        if (!id) continue;
        if (body.agents.agent_status === "1") after[id] = { ...info, bridge_id: info.bridge_id ?? id };
        else delete after[id];
      }
      log("agents", version.connected_agents || {}, after);
    },
    built_in_tools_data: () => {
      const { built_in_tools: tool, built_in_tools_operation: op } = body.built_in_tools_data || {};
      if (!tool) return;
      const before = version.built_in_tools || [];
      log("built_in_tools_data", before, op === "1" ? (before.includes(tool) ? before : [...before, tool]) : before.filter((t) => t !== tool));
    }
  };
  for (const key in body) {
    if (handlers[key]) handlers[key]();
    else log(key === "function_ids" ? "functionData" : key, version[key], update_fields[key] ?? body[key]);
  }
}
