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

// ---------------- Timescale rollups: daily_data (whole UTC days) + fifteen_minute_data ----------------

const timescaleSelect = (query, replacements) => models.timescale.sequelize.query(query, { type: Sequelize.QueryTypes.SELECT, replacements });

const isTrue = (v) => v === true || v === "true";
const hasValues = (v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");
const num = (v) => Number(v) || 0;
const minDate = (a, b) => (a < b ? a : b);
const maxDate = (a, b) => (a > b ? a : b);

function canUseTimescale(filters = {}) {
  return !(
    hasValues(filters.tool_id) ||
    hasValues(filters.agent_id) ||
    hasValues(filters.knowledgebase_id) ||
    filters.user_feedback != null ||
    isTrue(filters.error) ||
    isTrue(filters.review_failed) ||
    hasValues(filters.testcase_id) ||
    hasValues(filters.keyword) ||
    (filters.filter_by && Object.keys(filters.filter_by).length > 0)
  );
}

function isDayOrCoarser(bucket) {
  if (bucket === "day") return true;
  const match = /^([0-9]+)h$/.exec(bucket || "");
  return Boolean(match) && parseInt(match[1], 10) >= 24;
}

// null -> Postgres: a table is empty or the two rollups leave a gap.
async function getCutoffs() {
  try {
    const [row] = await timescaleSelect(
      `SELECT (SELECT MAX(created_at) + INTERVAL '1 day' FROM daily_data) AS daily_cutoff,
              (SELECT MIN(created_at) FROM fifteen_minute_data) AS fifteen_start,
              (SELECT MAX(created_at) + INTERVAL '15 minutes' FROM fifteen_minute_data) AS fifteen_cutoff`,
      {}
    );
    if (!row?.daily_cutoff || !row.fifteen_start || row.daily_cutoff < row.fifteen_start) return null;
    return { daily_cutoff: new Date(row.daily_cutoff), fifteen_start: new Date(row.fifteen_start), fifteen_cutoff: new Date(row.fifteen_cutoff) };
  } catch (error) {
    logger.warn(`analytics cutoff lookup failed, using PG: ${error.message}`);
    return null;
  }
}

// Half-open segment bounds; the daily one is whole UTC days. null when the rollups cannot serve the window.
function segments({ start, end, cutoffs }, wholeDays) {
  const to = minDate(end, cutoffs.fifteen_cutoff);
  if (start >= to || (!wholeDays && start < cutoffs.fifteen_start)) return null;
  const dayStart = new Date(start);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dailyTo = minDate(cutoffs.daily_cutoff, to);
  const fifteenFrom = wholeDays ? maxDate(start, cutoffs.daily_cutoff) : start;
  return {
    range_end: to,
    daily: wholeDays && dayStart < dailyTo ? { from: dayStart, to: dailyTo } : null,
    fifteen: fifteenFrom < to ? { from: fifteenFrom, to } : null
  };
}

function rollupWhere(table, { bridge_id, org_id, filters = {} }, { from, to }) {
  const replacements = { bridge_id, org_id: String(org_id), from, to };
  let where = "org_id = :org_id AND bridge_id = :bridge_id AND created_at >= :from AND created_at < :to";
  // daily_data is built from the Asia/Kolkata 15-minute rows only, so match that.
  if (table === "fifteen_minute_data") where += " AND time_zone = 'Asia/Kolkata'";
  if (filters.version_id) {
    where += " AND version_id = :version_id";
    replacements.version_id = filters.version_id;
  }
  if (hasValues(filters.model)) {
    where += " AND model IN (:models)";
    replacements.models = filters.model;
  }
  if (hasValues(filters.service)) {
    where += " AND service IN (:services)";
    replacements.services = filters.service;
  }
  return { where, replacements };
}

async function rollupTotals(table, ctx, segment) {
  if (!segment) return {};
  const { where, replacements } = rollupWhere(table, ctx, segment);
  const query = `
    SELECT
      COALESCE(SUM(record_count), 0) AS total_requests,
      COALESCE(SUM(success_count), 0) AS success_count,
      COALESCE(SUM(latency_sum), 0) AS latency_sum,
      COALESCE(SUM(total_token_count), 0) AS total_tokens,
      COALESCE(SUM(cost_sum), 0) AS est_cost
    FROM ${table}
    WHERE ${where}`;
  const rows = await timescaleSelect(query, replacements);
  return rows[0] || {};
}

async function rollupBuckets(table, ctx, segment) {
  if (!segment) return [];
  const { where, replacements } = rollupWhere(table, ctx, segment);
  const { bucketSql, finalParams } = getBucketExpressionAndParams(ctx.bucket, replacements);
  const query = `
    SELECT
      ${bucketSql} AS t,
      SUM(success_count)::int AS success,
      SUM(record_count - success_count)::int AS failed
    FROM ${table}
    WHERE ${where}
    GROUP BY 1 ORDER BY 1 ASC`;
  return timescaleSelect(query, finalParams);
}

// Same keys as getSummary minus feedback, which the rollups do not carry.
async function getSummaryFromTimescale(ctx) {
  const seg = segments(ctx, true);
  if (!seg) return null;
  const [daily, fifteen] = await Promise.all([rollupTotals("daily_data", ctx, seg.daily), rollupTotals("fifteen_minute_data", ctx, seg.fifteen)]);
  const total = num(daily.total_requests) + num(fifteen.total_requests);
  const success = num(daily.success_count) + num(fifteen.success_count);
  const latency = num(daily.latency_sum) + num(fifteen.latency_sum);
  return {
    range_end: seg.range_end,
    data: {
      total_requests: total,
      success_count: success,
      failed_runs: total - success,
      // latency_sum includes failed calls, unlike getSummary's success-only average.
      avg_response: total ? latency / total : 0,
      total_tokens: num(daily.total_tokens) + num(fifteen.total_tokens),
      est_cost: num(daily.est_cost) + num(fifteen.est_cost)
    }
  };
}

// Day-or-coarser buckets use both segments, finer buckets only 15-minute rows.
async function getRequestsOverTimeFromTimescale(ctx) {
  const seg = segments(ctx, isDayOrCoarser(ctx.bucket));
  if (!seg) return null;
  const [daily, fifteen] = await Promise.all([rollupBuckets("daily_data", ctx, seg.daily), rollupBuckets("fifteen_minute_data", ctx, seg.fifteen)]);
  const byBucket = new Map();
  for (const row of [...daily, ...fifteen]) {
    const key = new Date(row.t).getTime();
    const acc = byBucket.get(key) || { t: row.t, success: 0, failed: 0 };
    acc.success += num(row.success);
    acc.failed += num(row.failed);
    byBucket.set(key, acc);
  }
  return { range_end: seg.range_end, data: [...byBucket.values()].sort((a, b) => new Date(a.t) - new Date(b.t)) };
}

// timescaleFn returns null when the rollups cannot serve the window; then pgFn runs.
async function withTimescale(section, ctx, timescaleFn, pgFn) {
  const startedAt = Date.now();
  const cutoffs = await ctx.cutoffs;
  let result = null;
  if (cutoffs) {
    try {
      result = await timescaleFn({ ...ctx, cutoffs });
    } catch (error) {
      logger.warn(`analytics ${section} from timescale failed for ${ctx.bridge_id}, using PG: ${error.message}`);
    }
  }
  const source = result ? "timescale" : "postgres";
  if (!result) result = { range_end: ctx.end, data: await pgFn(ctx) };
  ctx.served.push(`${section}=${source} ${Date.now() - startedAt}ms`);
  return result;
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
  const ctx = { bridge_id, org_id, ...window, filters, served: [] };
  // One cutoff lookup shared by the summary and the requests chart.
  ctx.cutoffs = canUseTimescale(filters) ? getCutoffs() : Promise.resolve(null);
  const base = { bridge_id, range_start: window.start, range_end: window.end };

  const summaryTask = (async () => {
    try {
      const { data: row, range_end } = await withTimescale("summary", ctx, getSummaryFromTimescale, getSummary);
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
      await pushAnalytics(channel, { type: "summary", success: true, ...base, range_end, summary });
    } catch (error) {
      logger.error(`analytics summary failed for ${bridge_id}: ${error.message}`);
      await pushAnalytics(channel, { type: "summary", success: false, ...base, error: error.message });
    }
  })();

  const requestsTask = (async () => {
    try {
      const { data: requests_over_time, range_end } = await withTimescale(
        "requests_over_time",
        ctx,
        getRequestsOverTimeFromTimescale,
        getRequestsOverTime
      );
      await pushAnalytics(channel, { type: "requests_over_time", success: true, ...base, range_end, requests_over_time });
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
  logger.info(`analytics ${bridge_id}: ${ctx.served.join(" ")}`);
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
