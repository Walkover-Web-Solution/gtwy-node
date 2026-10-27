import Sequelize from "sequelize";
import models from "../../models/index.js";
import { ResponseSender } from "../services/utils/customResponse.utils.js";
import { buildConversationFilterSql } from "./conversationFilters.util.js";
import logger from "../logger.js";
import configurationModel from "../mongoModel/Configuration.model.js";
import versionModel from "../mongoModel/BridgeVersion.model.js";
import apiCallModel from "../mongoModel/ApiCall.model.js";

const responseSender = new ResponseSender();

// Resolve the time window + bucket size from either a `range` (days) or a custom
// start_date/end_date pair. Short windows are bucketed hourly, longer ones daily.
function computeWindow({ range, start_date, end_date, interval }) {
  const end = end_date ? new Date(end_date) : new Date();
  let start;
  let durationInHours = 0;

  if (start_date && end_date) {
    start = new Date(start_date);
    durationInHours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);
  } else {
    const r = range || "7d";
    const isHours = r.toString().endsWith("h");
    const val = Number(r.toString().replace(/[^0-9.]/g, "")) || 7;

    if (isHours) {
      durationInHours = val;
    } else {
      durationInHours = val * 24;
    }
    start = new Date(end.getTime() - durationInHours * 3600000);
  }

  // Choose bucket size based on total duration to provide a nice chart curve
  let bucket = "day";
  if (durationInHours <= 72) {
    bucket = "hour";
  }
  if (interval) {
    bucket = interval;
  }

  return { start, end, bucket };
}

function getBucketExpressionAndParams(bucketStr, params) {
  let bucketSql = "date_trunc(:bucket, created_at)";
  let finalParams = { ...params, bucket: bucketStr };

  if (bucketStr && bucketStr.match(/^([0-9]+)h$/)) {
    const hours = parseInt(bucketStr.match(/^([0-9]+)h$/)[1], 10);
    if (hours === 24) {
      finalParams.bucket = "day";
    } else if (hours === 1) {
      finalParams.bucket = "hour";
    } else {
      const seconds = hours * 3600;
      bucketSql = `to_timestamp(floor(extract(epoch from created_at) / ${seconds}) * ${seconds}) AT TIME ZONE 'UTC'`;
      delete finalParams.bucket;
    }
  }

  return { bucketSql, finalParams };
}

const pgSelect = (query, replacements) => models.pg.sequelize.query(query, { type: Sequelize.QueryTypes.SELECT, replacements });

// Build the optional ` AND (<expr>)` clause from the shared filter builder.
// Values are inline-escaped, so no extra bind params are needed.
function filterClause(filters) {
  const expr = buildConversationFilterSql(filters);
  return expr ? ` AND (${expr})` : "";
}

// Single-row aggregate for the dashboard cards. latency/tokens are JSONB so we
// extract the numeric keys. Tokens store input_tokens/output_tokens/expected_cost
// (total_tokens may be absent, so fall back to input + output). Cost comes from
// the tokens.expected_cost key — entirely from conversation_logs, no Timescale.
async function getSummary({ bridge_id, org_id, start, end, filters }) {
  const query = `
    SELECT
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE status = true)::int  AS success_count,
      COUNT(*) FILTER (WHERE status = false)::int AS failed_runs,
      COALESCE(AVG((latency->>'over_all_time')::float) FILTER (WHERE status = true), 0) AS avg_response,
      COALESCE(SUM(
        COALESCE((tokens->>'total_tokens')::float,
                 COALESCE((tokens->>'input_tokens')::float, 0) + COALESCE((tokens->>'output_tokens')::float, 0))
      ), 0) AS total_tokens,
      COALESCE(SUM((tokens->>'expected_cost')::float), 0) AS est_cost,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int AS positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int AS negative_feedback
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end ${filterClause(filters)}`;
  const rows = await pgSelect(query, { bridge_id, org_id, start, end });
  return rows[0] || {};
}

// Time-series for the "Requests Over Time" chart: success vs failed per bucket.
async function getRequestsOverTime({ bridge_id, org_id, start, end, bucket, filters }) {
  const { bucketSql, finalParams } = getBucketExpressionAndParams(bucket, { bridge_id, org_id, start, end });
  const query = `
    SELECT
      ${bucketSql} AS t,
      COUNT(*) FILTER (WHERE status = true)::int  AS success,
      COUNT(*) FILTER (WHERE status = false)::int AS failed
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end ${filterClause(filters)}
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query, finalParams);
}

// Time-series for the "Response Time" chart: p50 (typical) / p95 (slow) / p99 (worst)
// of over_all_time per bucket.
async function getResponseTime({ bridge_id, org_id, start, end, bucket, filters }) {
  const { bucketSql, finalParams } = getBucketExpressionAndParams(bucket, { bridge_id, org_id, start, end });
  const query = `
    SELECT
      ${bucketSql} AS t,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS typical,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS slow,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS worst
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end ${filterClause(filters)}
      AND (latency->>'over_all_time') IS NOT NULL
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query, finalParams);
}

// Time-series for the "Cost" chart: sum of tokens.expected_cost per bucket
// (same source as summary.est_cost).
async function getCostOverTime({ bridge_id, org_id, start, end, bucket, filters }) {
  const { bucketSql, finalParams } = getBucketExpressionAndParams(bucket, { bridge_id, org_id, start, end });
  const query = `
    SELECT
      ${bucketSql} AS t,
      COALESCE(SUM((tokens->>'expected_cost')::float), 0) AS cost
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end ${filterClause(filters)}
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query, finalParams);
}

async function pushAnalytics(channel, data) {
  await responseSender.sendResponse({
    rtlLayer: true,
    data,
    reqBody: { rtlOptions: { channel, ttl: 30, apikey: process.env.RTLAYER_AUTH } },
    headers: {}
  });
}

// Background worker: runs the dashboard sections concurrently and pushes each over the
// RT layer the moment it is ready (progressive render). Each section fails
// independently — a broken section pushes an error message instead of poisoning
// the rest.
async function runAndPush({ bridge_id, org_id, channel, window, filters }) {
  const ctx = { bridge_id, org_id, ...window, filters };
  const base = { bridge_id, range_start: window.start, range_end: window.end };

  const summaryTask = (async () => {
    try {
      const row = await getSummary(ctx);
      const total = row.total_requests || 0;
      const summary = {
        total_requests: total,
        success_rate: total ? Number(((row.success_count / total) * 100).toFixed(1)) : 0,
        avg_response: Math.round(row.avg_response || 0),
        failed_runs: row.failed_runs || 0,
        total_tokens: Math.round(row.total_tokens || 0),
        est_cost: Number(Number(row.est_cost || 0).toFixed(4)),
        positive_feedback: row.positive_feedback || 0,
        negative_feedback: row.negative_feedback || 0
      };
      await pushAnalytics(channel, { type: "summary", success: true, ...base, summary });
    } catch (error) {
      logger.error(`analytics summary failed for ${bridge_id}: ${error.message}`);
      await pushAnalytics(channel, { type: "summary", success: false, ...base, error: error.message });
    }
  })();

  const requestsTask = (async () => {
    try {
      const requests_over_time = await getRequestsOverTime(ctx);
      await pushAnalytics(channel, { type: "requests_over_time", success: true, ...base, requests_over_time });
    } catch (error) {
      logger.error(`analytics requests_over_time failed for ${bridge_id}: ${error.message}`);
      await pushAnalytics(channel, { type: "requests_over_time", success: false, ...base, error: error.message });
    }
  })();

  const responseTimeTask = (async () => {
    try {
      const response_time = await getResponseTime(ctx);
      await pushAnalytics(channel, { type: "response_time", success: true, ...base, response_time });
    } catch (error) {
      logger.error(`analytics response_time failed for ${bridge_id}: ${error.message}`);
      await pushAnalytics(channel, { type: "response_time", success: false, ...base, error: error.message });
    }
  })();

  const costTask = (async () => {
    try {
      const cost_over_time = await getCostOverTime(ctx);
      await pushAnalytics(channel, { type: "cost_over_time", success: true, ...base, cost_over_time });
    } catch (error) {
      logger.error(`analytics cost_over_time failed for ${bridge_id}: ${error.message}`);
      await pushAnalytics(channel, { type: "cost_over_time", success: false, ...base, error: error.message });
    }
  })();

  await Promise.allSettled([summaryTask, requestsTask, responseTimeTask, costTask]);
}

const CONFIG_FIELDS = {
  function_ids: 1,
  pre_tools: 1,
  post_tool: 1,
  connected_agents: 1,
  doc_ids: 1,
  service: 1,
  "configuration.model": 1,
  "settings.fall_back": 1
};

// Stored tool ids can be malformed, which would make the whole $in query throw.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const toId = (value) => (value === undefined || value === null || value === "" ? undefined : String(value));

// The agent's tools, pre/post tool, connected agents and docs as one list of { type, id, ... } entries.
// connected_agents is keyed by bridge_id (older agents: by agent name).
const toolEntries = (config) => [
  ...(config?.function_ids || []).map((id) => ({ type: "tools", id: toId(id) })),
  ...(config?.pre_tools || []).map((pre) => ({
    type: "pre_tool",
    pre_tool_type: pre?.type,
    id: toId(pre?.config?.function_id),
    variable_path: pre?.config
  })),
  ...(config?.post_tool?.id ? [{ ...config.post_tool, type: "post_tool", id: toId(config.post_tool.id) }] : []),
  ...Object.entries(config?.connected_agents || {}).map(([key, agent]) => ({
    type: "agent",
    id: toId(agent?.bridge_id),
    name: agent?.name || key
  })),
  ...(config?.doc_ids || []).map((doc) =>
    doc && typeof doc === "object" && !OBJECT_ID.test(String(doc))
      ? { ...doc, type: "docs", id: toId(doc.resource_id ?? doc.id) }
      : { type: "docs", id: toId(doc) }
  )
];

// Pre/post tools resolve their script_id the way gtwy-ai does when it logs the call.
const isApiCallTool = (tool) =>
  tool?.type === "tools" || tool?.type === "post_tool" || (tool?.type === "pre_tool" && tool?.pre_tool_type === "custom_function");

// Keeps both entries when two labels collide.
function addOption(map, label, value) {
  const key = map[label] === undefined || map[label] === value ? label : `${label} (${value})`;
  map[key] = value;
}

// Builds the dropdown options from agent/version configs. Values match the ids the
// log filter (conversationFilters.util.js) matches: tools -> script_id, agents ->
// bridge id, docs -> resource_id. MCP tools and built-in pre-tools are skipped.
function buildFilterOptions(configs, { apiCallsById = {}, agentNamesById = {} } = {}) {
  const tools_data = {};
  const knowledgebase_data = {};
  const agent_data = {};
  const unique_model = {};

  const addModel = (service, model) => {
    if (!model) return;
    const key = service;
    if (!unique_model[key]) unique_model[key] = [];
    if (!unique_model[key].includes(model)) unique_model[key].push(model);
  };

  for (const config of configs) {
    for (const tool of toolEntries(config)) {
      const id = String(tool?.id || "");
      if (isApiCallTool(tool)) {
        const apiCall = apiCallsById[id];
        const scriptId = tool.type === "tools" ? apiCall?.script_id : tool.variable_path?.script_id || tool.script_id || apiCall?.script_id;
        if (scriptId) addOption(tools_data, tool.title || apiCall?.title || scriptId, scriptId);
      } else if (tool?.type === "agent" && id) {
        addOption(agent_data, agentNamesById[id] || tool.name || id, id);
      } else if (tool?.type === "docs" && (tool.resource_id || id)) {
        const resourceId = String(tool.resource_id || id);
        addOption(knowledgebase_data, tool.name || resourceId, resourceId);
      }
    }

    addModel(config?.service, config?.configuration?.model);
    // A disabled fallback never runs.
    const fallBack = config?.settings?.fall_back;
    if (fallBack?.is_enable) addModel(fallBack.service || config?.service, fallBack.model);
  }

  return { tools_data, knowledgebase_data, agent_data, unique_model };
}

// Filter options for one agent, from its config and all its versions (or one version).
async function getFilterOptions({ bridge_id, org_id, version_id }) {
  const empty = { tools_data: {}, knowledgebase_data: {}, agent_data: {}, unique_model: {} };

  const agent = await configurationModel
    .findOne({ _id: bridge_id, org_id })
    .select({ ...CONFIG_FIELDS, versions: 1 })
    .lean();
  if (!agent) return empty;

  // A requested version must belong to this agent; agent.versions already does.
  const versionQuery = version_id ? { _id: version_id, parent_id: bridge_id, org_id } : { _id: { $in: agent.versions || [] }, org_id };
  const versions = await versionModel.find(versionQuery).select(CONFIG_FIELDS).lean();
  const configs = version_id ? versions : [agent, ...versions];

  const tools = configs.flatMap(toolEntries);
  const apiCallIds = [...new Set(tools.filter(isApiCallTool).map((t) => t.id))].filter((id) => OBJECT_ID.test(id));
  const agentIds = [...new Set(tools.filter((t) => t?.type === "agent").map((t) => t.id))].filter((id) => OBJECT_ID.test(id));

  const [apiCalls, agents] = await Promise.all([
    apiCallIds.length
      ? apiCallModel
          .find({ _id: { $in: apiCallIds }, org_id })
          .select({ script_id: 1, title: 1 })
          .lean()
      : [],
    agentIds.length
      ? configurationModel
          .find({ _id: { $in: agentIds }, org_id })
          .select({ name: 1 })
          .lean()
      : []
  ]);

  return buildFilterOptions(configs, {
    apiCallsById: Object.fromEntries(apiCalls.map((a) => [a._id, a])),
    agentNamesById: Object.fromEntries(agents.map((a) => [a._id, a.name]))
  });
}

export default {
  computeWindow,
  runAndPush,
  getFilterOptions
};
