import Sequelize from "sequelize";
import models from "../../models/index.js";
import { ResponseSender } from "../services/utils/customResponse.utils.js";
import { buildConversationFilterSql } from "./conversationFilters.util.js";
import logger from "../logger.js";

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

// Single bucketed scan that feeds every section of the dashboard. The old code
// ran four full scans (summary + requests + response_time + cost) in parallel,
// all with the same WHERE clause on conversation_logs. Doing one scan and
// deriving the summary from the buckets in Node cuts Postgres CPU for an
// analytics request to roughly a quarter of what it was (one scan, one filter
// evaluation, one JSONB extract pass) without changing the push payloads. Each
// bucket row carries every component the four old queries used to compute:
//   n                           — rows in bucket
//   success / failed            — requests-over-time chart
//   positive/negative_feedback  — summary totals
//   latency_sum / latency_count — summary avg_response (status=true only, so
//                                 SUM/COUNT across buckets equals the old
//                                 whole-window AVG)
//   total_tokens / cost         — summary totals + cost-over-time chart
//   typical / slow / worst      — response_time percentiles across ALL
//                                 statuses, matching the pre-refactor behavior
async function getBucketedRollup({ bridge_id, org_id, start, end, bucket, filters }) {
  const { bucketSql, finalParams } = getBucketExpressionAndParams(bucket, { bridge_id, org_id, start, end });
  const query = `
    SELECT
      ${bucketSql} AS t,
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE status = true)::int  AS success,
      COUNT(*) FILTER (WHERE status = false)::int AS failed,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int AS positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int AS negative_feedback,
      COALESCE(SUM((latency->>'over_all_time')::float)
               FILTER (WHERE status = true AND (latency->>'over_all_time') IS NOT NULL), 0) AS latency_sum,
      COUNT(*) FILTER (WHERE status = true AND (latency->>'over_all_time') IS NOT NULL)::int AS latency_count,
      COALESCE(SUM(
        COALESCE((tokens->>'total_tokens')::float,
                 COALESCE((tokens->>'input_tokens')::float, 0) + COALESCE((tokens->>'output_tokens')::float, 0))
      ), 0) AS total_tokens,
      COALESCE(SUM((tokens->>'expected_cost')::float), 0) AS cost,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float)
        FILTER (WHERE (latency->>'over_all_time') IS NOT NULL) AS typical,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float)
        FILTER (WHERE (latency->>'over_all_time') IS NOT NULL) AS slow,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float)
        FILTER (WHERE (latency->>'over_all_time') IS NOT NULL) AS worst
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

// Background worker: one DB roundtrip feeds every dashboard section. We still
// push four messages (summary, requests_over_time, response_time, cost_over_time)
// so the frontend's progressive-render path keeps working unchanged — only the
// number of scans against conversation_logs changed (four → one), which is the
// CPU win. If the scan fails we push a single error per section so no card is
// left spinning forever.
async function runAndPush({ bridge_id, org_id, channel, window, filters }) {
  const ctx = { bridge_id, org_id, ...window, filters };
  const base = { bridge_id, range_start: window.start, range_end: window.end };

  let rows;
  try {
    rows = await getBucketedRollup(ctx);
  } catch (error) {
    logger.error(`analytics bucketed rollup failed for ${bridge_id}: ${error.message}`);
    const errPayload = { success: false, ...base, error: error.message };
    await Promise.allSettled([
      pushAnalytics(channel, { type: "summary", ...errPayload }),
      pushAnalytics(channel, { type: "requests_over_time", ...errPayload }),
      pushAnalytics(channel, { type: "response_time", ...errPayload }),
      pushAnalytics(channel, { type: "cost_over_time", ...errPayload })
    ]);
    return;
  }

  // ---- Derive summary totals by summing buckets. Equivalent to the old
  // whole-window aggregate because every per-bucket component is additive
  // (avg_response uses SUM(latency)/COUNT(latency) across all buckets, which
  // equals AVG over the whole window). ----
  let total = 0;
  let success = 0;
  let failed = 0;
  let positive_feedback = 0;
  let negative_feedback = 0;
  let latency_sum = 0;
  let latency_count = 0;
  let total_tokens = 0;
  let est_cost = 0;
  for (const r of rows) {
    total += r.n || 0;
    success += r.success || 0;
    failed += r.failed || 0;
    positive_feedback += r.positive_feedback || 0;
    negative_feedback += r.negative_feedback || 0;
    latency_sum += Number(r.latency_sum) || 0;
    latency_count += r.latency_count || 0;
    total_tokens += Number(r.total_tokens) || 0;
    est_cost += Number(r.cost) || 0;
  }

  const summary = {
    total_requests: total,
    success_rate: total ? Number(((success / total) * 100).toFixed(1)) : 0,
    avg_response: Math.round(latency_count ? latency_sum / latency_count : 0),
    failed_runs: failed,
    total_tokens: Math.round(total_tokens),
    est_cost: Number(est_cost.toFixed(4)),
    positive_feedback,
    negative_feedback
  };

  const requests_over_time = rows.map((r) => ({ t: r.t, success: r.success || 0, failed: r.failed || 0 }));
  const cost_over_time = rows.map((r) => ({ t: r.t, cost: Number(r.cost) || 0 }));
  // Response-time chart keeps the old shape: only buckets that had at least one
  // latency sample contribute percentiles (otherwise typical/slow/worst are NULL).
  const response_time = rows
    .filter((r) => r.typical !== null && r.typical !== undefined)
    .map((r) => ({ t: r.t, typical: r.typical, slow: r.slow, worst: r.worst }));

  await Promise.allSettled([
    pushAnalytics(channel, { type: "summary", success: true, ...base, summary }),
    pushAnalytics(channel, { type: "requests_over_time", success: true, ...base, requests_over_time }),
    pushAnalytics(channel, { type: "response_time", success: true, ...base, response_time }),
    pushAnalytics(channel, { type: "cost_over_time", success: true, ...base, cost_over_time })
  ]);
}

// Distinct filter options for a bridge, used by the frontend to build the
// dropdowns. Scans the whole bridge (no time window). Returns:
//   tools_data:        { "<display tool name>": "<tool id>" }  (function/MCP calls)
//   knowledgebase_data:{ "<resource_id>": "<resource_id>" }    (RAG calls)
//   agent_data:        { "<agent name>": "<id>" }              (agent calls)
//   unique_model:      { "<service>": ["<model>", ...] }
async function getFilterOptions({ bridge_id, org_id }) {
  // Calls: unnest the JSONB array, then each `{ "fc_..": {entry} }` object, and
  // pull the type discriminator (data.metadata.type), display name + id. Filter to
  // array rows first so jsonb_array_elements never runs on a non-array value.
  // One row per (type, id). Some records carry no display_tool_name/name
  // (queued/in-progress or older rows), so we aggregate across all records and
  // prefer a real name — only falling back to the id when no record ever stored a
  // name (or only stored the id as the name).
  const toolsQuery = `
    SELECT
      call_type,
      call_id,
      COALESCE(
        MAX(call_name) FILTER (WHERE call_name IS NOT NULL AND call_name <> call_id),
        call_id
      ) AS call_name
    FROM (
      SELECT
        COALESCE(kv.value->'data'->'metadata'->>'type', 'function') AS call_type,
        -- The usable identifier depends on the call type: functions/MCP have a
        -- top-level id; RAG (knowledgebase) has a null id and lives in
        -- args.resource_id; agent calls have a null id and live in
        -- data.metadata.agent_id (the called agent's bridge id). Resolve in order.
        COALESCE(
          kv.value->>'id',
          kv.value->'args'->>'resource_id',
          kv.value->'data'->'metadata'->>'agent_id',
          kv.value->>'bridge_id'
        ) AS call_id,
        COALESCE(kv.value->>'display_tool_name', kv.value->>'name') AS call_name
      FROM (
        SELECT tools_call_data
        FROM conversation_logs
        WHERE bridge_id = :bridge_id AND org_id = :org_id
          AND jsonb_typeof(tools_call_data) = 'array'
          AND tools_call_data <> '[]'::jsonb
      ) cl
      CROSS JOIN LATERAL jsonb_array_elements(cl.tools_call_data) AS elem
      CROSS JOIN LATERAL jsonb_each(elem) AS kv
      WHERE COALESCE(
        kv.value->>'id',
        kv.value->'args'->>'resource_id',
        kv.value->'data'->'metadata'->>'agent_id',
        kv.value->>'bridge_id'
      ) IS NOT NULL
    ) t
    GROUP BY call_type, call_id`;

  const modelsQuery = `
    SELECT DISTINCT service, model
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND model IS NOT NULL AND model <> ''`;

  const [toolRows, modelRows] = await Promise.all([pgSelect(toolsQuery, { bridge_id, org_id }), pgSelect(modelsQuery, { bridge_id, org_id })]);

  // Bucket each call by its type: agent -> agent_data, RAG -> knowledgebase_data,
  // everything else (function / mcp / unknown) -> tools_data.
  const tools_data = {};
  const knowledgebase_data = {};
  const agent_data = {};
  for (const row of toolRows) {
    const name = row.call_name || row.call_id;
    if (!name) continue;
    const type = (row.call_type || "function").toLowerCase();
    if (type === "agent") agent_data[name] = row.call_id;
    // KB calls share a generic display name ("get_knowledge_base_data"), so key by
    // the resource_id to keep each distinct knowledgebase as its own entry.
    else if (type === "rag") knowledgebase_data[row.call_id] = row.call_id;
    else tools_data[name] = row.call_id;
  }

  const unique_model = {};
  for (const row of modelRows) {
    const service = row.service || "other";
    if (!unique_model[service]) unique_model[service] = [];
    if (!unique_model[service].includes(row.model)) unique_model[service].push(row.model);
  }

  return { tools_data, knowledgebase_data, agent_data, unique_model };
}

export default {
  computeWindow,
  runAndPush,
  getFilterOptions
};
