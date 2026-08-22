import metrics_sevice from "../db_services/metrics.service.js";
import { buildWhereClause, selectTable } from "../utils/metrics.utils.js";
import analyticsService from "../db_services/analytics.service.js";
import configurationService from "../db_services/configuration.service.js";

const getMetricsData = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const { startTime, endTime } = req.query;
  const { apikey_id, service, model, thread_id, bridge_id, version_id, range, factor } = req.body;
  const values = [];
  const params = {
    org_id,
    bridge_id,
    version_id,
    apikey_id,
    thread_id,
    service,
    model,
    startTime,
    endTime
  };
  let start_date = new Date();
  let end_date = new Date();
  if (range === 10) {
    start_date = req.body.start_date;
    end_date = req.body.end_date;
  }
  // When grouping by agent, also carry `model` on every row - it lets the
  // frontend build each agent's "which models does it use" summary from data
  // it's already fetching for the main chart, instead of a separate N+1 call
  // per agent. Harmless to the agent-level totals: convertApiData already
  // sums multiple rows sharing the same (bucket, bridge_id) together, so
  // splitting one row into several (one per model) changes nothing about
  // the aggregated agent totals.
  const extraDimension = factor === "bridge_id" ? ", model" : "";
  // Embed agents have real usage in the same Timescale rollups as everyone
  // else, but they aren't part of the org's real Agents list and must not
  // show up on the Metrics dashboard at all - not even unnamed as
  // "Bridge <hex>". Excluded at the query level so it's consistently left out
  // of every number downstream (chart bars, legend, table, totals), not just
  // hidden by name-resolution failing.
  const embedBridgeIds = await configurationService.getEmbedBridgeIds(org_id);
  const whereClause = buildWhereClause(params, values, factor, range, true, start_date, end_date, extraDimension, embedBridgeIds);
  // const table = selectTable(startTime, endTime, range);
  const table = selectTable(range);
  const query = `SELECT ${factor}${extraDimension}, created_at, SUM(cost_sum) as cost_sum, AVG(latency_sum/NULLIF(record_count, 0)) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count FROM ${table} ${whereClause} ORDER BY created_at ASC`;

  // The daily/15-min continuous aggregates lag behind real-time by design, so
  // for ranges backed by daily_data we also pull the last-2-days rollup from
  // fifteen_minute_data to fill in today. Only do this when the requested
  // window actually reaches into "now" - a custom range entirely in the past
  // (e.g. the prior-period half of a delta comparison) must not have today's
  // numbers spliced in.
  const windowIncludesToday = range !== 10 || !end_date || new Date(end_date).getTime() >= Date.now() - 2 * 24 * 60 * 60 * 1000;

  if (range > 5 && windowIncludesToday) {
    const today_whereClause = buildWhereClause(params, values, factor, range, false, start_date, end_date, extraDimension, embedBridgeIds);
    const today_query = `SELECT ${factor}${extraDimension}, created_at, SUM(cost_sum) as cost_sum, AVG(latency_sum/NULLIF(record_count, 0)) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count FROM fifteen_minute_data ${today_whereClause} ORDER BY created_at ASC`;
    const data = await metrics_sevice.find(query, values);
    const today_data = await metrics_sevice.find(today_query, values);
    res.locals = {
      statusCode: 200,
      data: [...data, ...today_data],
      message: "Successfully get request data"
    };
  } else {
    const data = await metrics_sevice.find(query, values);
    res.locals = {
      statusCode: 200,
      data,
      message: "Successfully get request data"
    };
  }
  req.statusCode = 200;
  return next();
};

const getBridgeMetrics = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const { start_date, end_date } = req.body;

  let table = "daily_data";
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  if (!start_date || !end_date || new Date(start_date).getTime() > oneDayAgo) {
    table = "fifteen_minute_data";
  }

  let query = `SELECT bridge_id, 
                      SUM(total_token_count) as total_tokens,
                      SUM(cost_sum) as total_cost,
                      MAX(created_at) as last_used_time
                   FROM ${table} 
                   WHERE org_id = :org_id`;

  const replacements = { org_id };

  if (start_date && end_date) {
    query += ` AND created_at BETWEEN :start_date AND :end_date`;
    replacements.start_date = start_date;
    replacements.end_date = end_date;
  } else {
    query += ` AND created_at >= NOW() - INTERVAL '24 hours'`;
  }

  query += ` GROUP BY bridge_id`;

  const data = await metrics_sevice.find(query, replacements);

  res.locals = {
    statusCode: 200,
    data,
    message: "Successfully retrieved bridge metrics"
  };
  req.statusCode = 200;
  return next();
};

// POST /api/metrics/requests-activity
// Real success vs failed request counts per time bucket, for the Metrics
// dashboard's Request Activity card. Sourced from conversation_logs (the same
// table the Agent Analytics page uses) rather than the Timescale rollups,
// which never track failures. Requires an explicit start/end window from the
// caller (the frontend already knows the boundaries of the selected preset or
// custom range) rather than re-deriving it from a range code here, so both
// halves of a delta-vs-previous-period comparison line up exactly.
const getRequestsActivity = async (req, res, next) => {
  const org_id = req.profile?.org?.id;
  const { bridge_id, model, service, start_date, end_date } = req.body;

  const end = end_date ? new Date(end_date) : new Date();
  const start = start_date ? new Date(start_date) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const durationHours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);
  const bucket = durationHours <= 72 ? "hour" : "day";

  // by_agent runs alongside the time-bucketed series: real per-agent
  // input/output token totals for the Models table, from the same
  // conversation_logs source (with the same dual-shape token handling), not
  // a second guess at the numbers already shown from the Timescale pipeline.
  // Same embed exclusion as getMetricsData - conversation_logs has embed
  // agents' real rows too, and they must not show up here either.
  const embedBridgeIds = await configurationService.getEmbedBridgeIds(org_id);
  const [data, by_agent] = await Promise.all([
    analyticsService.getOrgRequestsOverTime({ org_id, bridge_id, model, service, start, end, bucket, excludeBridgeIds: embedBridgeIds }),
    analyticsService.getAgentTokenBreakdown({ org_id, bridge_id, model, service, start, end, excludeBridgeIds: embedBridgeIds })
  ]);

  res.locals = {
    statusCode: 200,
    data,
    by_agent,
    message: "Successfully get request activity data"
  };
  req.statusCode = 200;
  return next();
};

export default {
  getMetricsData,
  getBridgeMetrics,
  getRequestsActivity
};
