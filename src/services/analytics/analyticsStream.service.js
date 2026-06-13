import { ResponseSender } from "../utils/customResponse.utils.js";
import { getSubThreadList, getKpis, getRequestsOverTime, getResponseTime } from "../../db_services/analytics.service.js";
import logger from "../../logger.js";

const responseSender = new ResponseSender();
const THREAD_BATCH = 50;
const RTL_TTL = 60;

/**
 * Resolve a named/custom time range into { start, end, bucket }.
 * bucket = 'hour' for <= 2 days of data, otherwise 'day'.
 */
function resolveTimeWindow({ time_range, start_date, end_date }) {
  const now = new Date();
  let start;
  let end = now;

  switch (time_range) {
    case "last_7d":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "last_30d":
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "custom":
      start = start_date ? new Date(start_date) : new Date(now.getTime() - 24 * 60 * 60 * 1000);
      end = end_date ? new Date(end_date) : now;
      break;
    case "last_24h":
    default:
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
  }

  const spanMs = end.getTime() - start.getTime();
  const bucket = spanMs > 2 * 24 * 60 * 60 * 1000 ? "day" : "hour";
  return { start, end, bucket };
}

/**
 * Push one JSON chunk to the RTLayer channel. Never throws — a failed push is logged
 * so the rest of the stream still goes out.
 */
async function pushChunk(channel, type, data, { seq, done = false } = {}) {
  try {
    await responseSender.sendResponse({
      rtlLayer: true,
      data: { type, seq, done, data },
      reqBody: { rtlOptions: { channel, ttl: RTL_TTL, apikey: process.env.RTLAYER_AUTH } }
    });
  } catch (err) {
    logger.error(`Analytics chunk push failed (channel=${channel}, type=${type}): ${err.message}`);
  }
}

/**
 * Fire-and-forget: compute the dashboard data and stream it to the client in
 * small chunks over RTLayer. Order: threads (batched) -> kpis ->
 * requests_over_time -> response_time -> done.
 */
async function startAnalyticsStream({ org_id, agent_id, channel, filters = {} }) {
  let seq = 0;
  const { start, end, bucket } = resolveTimeWindow(filters);
  const queryFilters = {
    org_id,
    agent_id,
    start,
    end,
    tools: filters.tools,
    latency: filters.latency,
    model: filters.model,
    service: filters.service,
    variables: filters.variables,
    reviewer_failures: filters.reviewer_failures,
    error_history: filters.error_history,
    keyword: filters.keyword
  };

  try {
    // 1. Sub-thread list, streamed in batches (newest first)
    let offset = 0;
    for (;;) {
      const batch = await getSubThreadList(queryFilters, { limit: THREAD_BATCH, offset });
      if (batch.length === 0 && offset > 0) break;
      await pushChunk(channel, "threads", batch, { seq: seq++ });
      if (batch.length < THREAD_BATCH) break;
      offset += THREAD_BATCH;
    }

    // 2. KPI cards (with deltas vs previous window)
    const kpis = await getKpis(queryFilters);
    await pushChunk(channel, "kpis", kpis, { seq: seq++ });

    // 3. Requests over time
    const requests = await getRequestsOverTime(queryFilters, bucket);
    await pushChunk(channel, "requests_over_time", requests, { seq: seq++ });

    // 4. Response time percentiles
    const responseTime = await getResponseTime(queryFilters, bucket);
    await pushChunk(channel, "response_time", responseTime, { seq: seq++ });

    await pushChunk(channel, "done", null, { seq: seq++, done: true });
  } catch (err) {
    logger.error(`Analytics stream failed (channel=${channel}, agent=${agent_id}): ${err.message}`);
    await pushChunk(channel, "error", { message: "Failed to generate analytics" }, { seq: seq++, done: true });
  }
}

export { startAnalyticsStream, resolveTimeWindow };
