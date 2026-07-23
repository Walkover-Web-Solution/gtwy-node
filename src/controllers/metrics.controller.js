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
  const query = `SELECT ${factor}, created_at, SUM(cost_sum) as cost_sum, AVG(latency_sum/NULLIF(record_count, 0)) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count FROM ${table} ${whereClause} ORDER BY created_at ASC`;

  const today_whereClause = buildWhereClause(params, values, factor, range, false, start_date, end_date);
  const today_query = `SELECT ${factor}, created_at, SUM(cost_sum) as cost_sum, AVG(latency_sum/NULLIF(record_count, 0)) as latency_sum, SUM(success_count) as success_count, SUM(total_token_count) AS total_token_count FROM fifteen_minute_data ${today_whereClause} ORDER BY created_at ASC`;

  const data = await metrics_sevice.find(query, values);
  const today_data = await metrics_sevice.find(today_query, values);
  if (range > 5) {
    res.locals = {
      statusCode: 200,
      data: [...data, ...today_data],
      message: "Successfully get request data"
    };
  } else {
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

export default {
  getMetricsData,
  getBridgeMetrics
};
