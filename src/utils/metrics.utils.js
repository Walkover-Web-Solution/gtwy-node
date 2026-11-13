export function selectTable(range) {
  if (range === 1 || range === 2 || range === 3 || range === 4 || range === 5) {
    return "fifteen_minute_data";
  }
  return "daily_data";
}

/**
 * @param {object} params - filter fields
 * @param {array} values - Sequelize replacements collector (kept for API compat)
 * @param {string} factor - GROUP BY dimension
 * @param {number} range - preset range id (1–10)
 * @param {boolean} flag - when true apply range window; when false force last N recent days
 * @param {string|Date|null} start_date - custom range start (range === 10)
 * @param {string|Date|null} end_date - custom range end (range === 10)
 * @param {{ excludeRecentDays?: number }} [options]
 */
export function buildWhereClause(params, values, factor, range, flag = true, start_date = null, end_date = null, options = {}) {
  const conditions = [];

  if (params.org_id !== null && params.org_id !== undefined) {
    values.push(params.org_id);
    conditions.push(`org_id = '${params.org_id}'`);
  }
  if (params.bridge_id !== null && params.bridge_id !== undefined) {
    values.push(params.bridge_id);
    conditions.push(`bridge_id = '${params.bridge_id}'`);
  }
  if (params.version_id !== null && params.version_id !== undefined) {
    values.push(params.version_id);
    conditions.push(`version_id = '${params.version_id}'`);
  }
  if (params.apikey_id !== null && params.apikey_id !== undefined) {
    values.push(params.apikey_id);
    conditions.push(`apikey_id = '${params.apikey_id}'`);
  }
  if (params.thread_id !== null && params.thread_id !== undefined) {
    values.push(params.thread_id);
    conditions.push(`thread_id = '${params.thread_id}'`);
  }
  if (params.service !== null && params.service !== undefined) {
    values.push(params.service);
    conditions.push(`service = '${params.service}'`);
  }
  if (params.model !== null && params.model !== undefined) {
    values.push(params.model);
    conditions.push(`model = '${params.model}'`);
  }

  let query = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "WHERE 1=1";

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
      query += ` AND created_at BETWEEN '${start_date}' AND '${end_date}'`;
    }
  }

  if (!flag) {
    query += ` AND created_at >= NOW() - INTERVAL '2 days'`;
  }

  // When merging daily + 15-min buckets, drop the recent window from daily so it isn't counted twice.
  if (options.excludeRecentDays) {
    query += ` AND created_at < NOW() - INTERVAL '${Number(options.excludeRecentDays)} days'`;
  }

  // Only group by dimensions — never by the measures being aggregated.
  if (factor) {
    query += ` GROUP BY ${factor}, created_at`;
  }
  return query;
}
