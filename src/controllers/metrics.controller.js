import metrics_sevice from "../db_services/metrics.service.js";
import { buildWhereClause, selectTable } from "../utils/metrics.utils.js";

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
  const whereClause = buildWhereClause(params, values, factor, range, true, start_date, end_date);
  // const table = selectTable(startTime, endTime, range);
  const table = selectTable(range);
  const query = `SELECT ${factor}, created_at, SUM(cost_sum) as cost_sum, SUM(latency_sum) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count, SUM(record_count) as record_count FROM ${table} ${whereClause} ORDER BY created_at ASC`;

  const today_whereClause = buildWhereClause(params, values, factor, range, false, start_date, end_date);
  const today_query = `SELECT ${factor}, created_at, SUM(cost_sum) as cost_sum, SUM(latency_sum) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count, SUM(record_count) as record_count FROM fifteen_minute_data ${today_whereClause} ORDER BY created_at ASC`;

  const rawWhereClause = buildWhereClause(params, [], null, range, true, start_date, end_date);
  const latencySummaryQuery = `
    SELECT
      COALESCE(COUNT(*), 0) AS total_requests,
      COALESCE(SUM(CASE WHEN success = true THEN 1 ELSE 0 END), 0) AS success_requests,
      COALESCE(AVG(latency), 0) AS avg_latency_ms,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency), 0) AS p95_latency_ms
    FROM metrics_raw_data
    ${rawWhereClause}
  `;

  const data = await metrics_sevice.find(query, values);
  const today_data = await metrics_sevice.find(today_query, values);
  const [latencySummaryRow] = await metrics_sevice.find(latencySummaryQuery, []);
  const totalRequests = Number(latencySummaryRow?.total_requests) || 0;
  const successRequests = Number(latencySummaryRow?.success_requests) || 0;
  const latency_summary = {
    totalRequests,
    successRequests,
    successRate: totalRequests > 0 ? (successRequests / totalRequests) * 100 : 0,
    avgLatency: Number(latencySummaryRow?.avg_latency_ms) || 0,
    p95Latency: Number(latencySummaryRow?.p95_latency_ms) || 0
  };

  if (range > 5) {
    res.locals = {
      statusCode: 200,
      data: [...data, ...today_data],
      latency_summary,
      message: "Successfully get request data"
    };
  } else {
    res.locals = {
      statusCode: 200,
      data,
      latency_summary,
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

export default {
  getMetricsData,
  getBridgeMetrics
};
