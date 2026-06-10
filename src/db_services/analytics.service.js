import Sequelize from "sequelize";
import models from "../../models/index.js";
import { ResponseSender } from "../services/utils/customResponse.utils.js";
import logger from "../logger.js";

const responseSender = new ResponseSender();

// Resolve the time window + bucket size from either a `range` (days) or a custom
// start_date/end_date pair. Short windows are bucketed hourly, longer ones daily.
function computeWindow({ range, start_date, end_date }) {
  const end = end_date ? new Date(end_date) : new Date();
  let start;
  let days;
  if (start_date && end_date) {
    start = new Date(start_date);
    days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  } else {
    days = Number(range) || 7;
    start = new Date(end.getTime() - days * 86400000);
  }
  const bucket = days <= 2 ? "hour" : "day";
  return { start, end, bucket };
}

const pgSelect = (query, replacements) => models.pg.sequelize.query(query, { type: Sequelize.QueryTypes.SELECT, replacements });

// Single-row aggregate for the dashboard cards. latency/tokens are JSONB so we
// extract the numeric keys. Tokens store input_tokens/output_tokens/expected_cost
// (total_tokens may be absent, so fall back to input + output). Cost comes from
// the tokens.expected_cost key — entirely from conversation_logs, no Timescale.
async function getSummary({ bridge_id, org_id, start, end }) {
  const query = `
    SELECT
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE status = true)::int  AS success_count,
      COUNT(*) FILTER (WHERE status = false)::int AS failed_runs,
      COALESCE(AVG((latency->>'over_all_time')::float), 0) AS avg_response,
      COALESCE(SUM(
        COALESCE((tokens->>'total_tokens')::float,
                 COALESCE((tokens->>'input_tokens')::float, 0) + COALESCE((tokens->>'output_tokens')::float, 0))
      ), 0) AS total_tokens,
      COALESCE(SUM((tokens->>'expected_cost')::float), 0) AS est_cost,
      COUNT(*) FILTER (WHERE user_feedback = 1)::int AS positive_feedback,
      COUNT(*) FILTER (WHERE user_feedback = 2)::int AS negative_feedback
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end`;
  const rows = await pgSelect(query, { bridge_id, org_id, start, end });
  return rows[0] || {};
}

// Time-series for the "Requests Over Time" chart: success vs failed per bucket.
async function getRequestsOverTime({ bridge_id, org_id, start, end, bucket }) {
  const query = `
    SELECT
      date_trunc(:bucket, created_at) AS t,
      COUNT(*) FILTER (WHERE status = true)::int  AS success,
      COUNT(*) FILTER (WHERE status = false)::int AS failed
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query, { bridge_id, org_id, start, end, bucket });
}

// Time-series for the "Response Time" chart: p50 (typical) / p95 (slow) / p99 (worst)
// of over_all_time per bucket.
async function getResponseTime({ bridge_id, org_id, start, end, bucket }) {
  const query = `
    SELECT
      date_trunc(:bucket, created_at) AS t,
      percentile_cont(0.5)  WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS typical,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS slow,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY (latency->>'over_all_time')::float) AS worst
    FROM conversation_logs
    WHERE bridge_id = :bridge_id AND org_id = :org_id
      AND created_at BETWEEN :start AND :end
      AND (latency->>'over_all_time') IS NOT NULL
    GROUP BY 1 ORDER BY 1 ASC`;
  return pgSelect(query, { bridge_id, org_id, start, end, bucket });
}

async function pushAnalytics(channel, data) {
  await responseSender.sendResponse({
    rtlLayer: true,
    data,
    reqBody: { rtlOptions: { channel, ttl: 30, apikey: process.env.RTLAYER_AUTH } },
    headers: {}
  });
}

// Background worker: runs the three sections concurrently and pushes each over the
// RT layer the moment it is ready (progressive render). Each section fails
// independently — a broken section pushes an error message instead of poisoning
// the rest.
async function runAndPush({ bridge_id, org_id, channel, window }) {
  const ctx = { bridge_id, org_id, ...window };
  const base = { bridge_id, range_start: window.start, range_end: window.end };

  const summaryTask = (async () => {
    try {
      const row = await getSummary(ctx);
      const total = row.total_requests || 0;
      const summary = {
        total_requests: total,
        success_rate: total ? Number(((row.success_count / total) * 100).toFixed(1)) : 0,
        avg_response_ms: Math.round(row.avg_response || 0),
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

  await Promise.allSettled([summaryTask, requestsTask, responseTimeTask]);
}

export default {
  computeWindow,
  runAndPush
};
