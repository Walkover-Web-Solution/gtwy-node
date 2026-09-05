export function selectTable(range) {
  // const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  // const startDate = new Date(Date.UTC(new Date(startTime).getUTCFullYear(), new Date(startTime).getUTCMonth(), new Date(startTime).getUTCDate(), new Date(startTime).getUTCHours(), new Date(startTime).getUTCMinutes(), new Date(startTime).getUTCSeconds()));
  // const endDate = new Date(Date.UTC(new Date(endTime).getUTCFullYear(), new Date(endTime).getUTCMonth(), new Date(endTime).getUTCDate(), new Date(endTime).getUTCHours(), new Date(endTime).getUTCMinutes(), new Date(endTime).getUTCSeconds()));

  if (range === 1 || range === 2 || range === 3 || range === 4 || range === 5) {
    return "fifteen_minute_data";
  } else {
    return "daily_data";
  }
}

function escapeSqlValue(value) {
  return String(value).replace(/'/g, "''");
}

function addFilterCondition(conditions, column, value) {
  if (value === null || value === undefined) return;
  const values = Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== "") : [value];
  if (values.length === 0) return;
  if (values.length === 1) {
    conditions.push(`${column} = '${escapeSqlValue(values[0])}'`);
    return;
  }
  conditions.push(`${column} IN ('${values.map(escapeSqlValue).join("','")}')`);
}

function toSqlDate(value) {
  if (value == null) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * Build a user-metrics query over metrics_raw_data for an explicit date range.
 * Reads raw rows so user_id is available as soon as hits are flushed.
 */
export function buildUserMetricsQuery({ org_id, user_id, start_date, end_date }) {
  const conditions = [];
  addFilterCondition(conditions, "org_id", org_id);
  addFilterCondition(conditions, "user_id", user_id);
  conditions.push(`created_at BETWEEN '${toSqlDate(start_date)}' AND '${toSqlDate(end_date)}'`);

  const where = `WHERE ${conditions.join(" AND ")}`;
  const diffMs = new Date(end_date).getTime() - new Date(start_date).getTime();
  const bucket = Number.isFinite(diffMs) && diffMs <= 2 * 24 * 60 * 60 * 1000 ? "15 minutes" : "1 day";

  return `
    SELECT
      user_id,
      time_bucket('${bucket}', created_at) AS created_at,
      SUM(cost) AS cost_sum,
      AVG(latency) AS latency_sum,
      COUNT(*) FILTER (WHERE success = true) AS success_count,
      SUM(total_tokens) AS total_token_count
    FROM metrics_raw_data
    ${where}
    GROUP BY user_id, time_bucket('${bucket}', created_at)
    ORDER BY created_at ASC
  `;
}

export function buildWhereClause(params, values, factor, range, flag = true, start_date = null, end_date = null) {
  const conditions = [];

  addFilterCondition(conditions, "org_id", params.org_id);
  addFilterCondition(conditions, "bridge_id", params.bridge_id);
  addFilterCondition(conditions, "version_id", params.version_id);
  addFilterCondition(conditions, "apikey_id", params.apikey_id);
  addFilterCondition(conditions, "thread_id", params.thread_id);
  addFilterCondition(conditions, "service", params.service);
  addFilterCondition(conditions, "model", params.model);

  let query = conditions.length ? "WHERE " + conditions.join(" AND ") : "WHERE 1=1";
  if (range && flag) {
    if (range == 1) {
      query += ` AND created_at >= NOW() - INTERVAL '1 hour'`;
    } else if (range == 2) {
      query += ` AND created_at >= NOW() - INTERVAL '3 hours'`;
    } else if (range == 3) {
      query += ` AND created_at >= NOW() - INTERVAL '6 hours'`;
    } else if (range == 4) {
      query += ` AND created_at >= NOW() - INTERVAL '12 hours'`;
    } else if (range == 5) {
      query += ` AND created_at >= NOW() - INTERVAL '1 day'`;
    } else if (range == 6) {
      query += ` AND created_at >= NOW() - INTERVAL '2 days'`;
    } else if (range == 7) {
      query += ` AND created_at >= NOW() - INTERVAL '7 days'`;
    } else if (range == 8) {
      query += ` AND created_at >= NOW() - INTERVAL '14 days'`;
    } else if (range == 9) {
      query += ` AND created_at >= NOW() - INTERVAL '30 days'`;
    } else if (range == 10) {
      const toSqlDate = (value) => {
        if (value == null) return value;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
      };
      query += ` AND created_at BETWEEN '${toSqlDate(start_date)}' AND '${toSqlDate(end_date)}'`;
    }
  }
  if (!flag) {
    query += ` AND created_at >= NOW() - INTERVAL '2 days'`;
  }
  if (factor) {
    query += ` GROUP BY ${factor}, created_at, cost_sum, total_token_count, success_count`;
  }
  return query;
}
