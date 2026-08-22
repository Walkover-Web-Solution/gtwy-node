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

const escapeSqlLiteral = (value) => String(value).replace(/'/g, "''");

// A filter value can be a single id (legacy single-select) or an array of ids
// (multi-select) - either way it renders to `col = 'x'` or `col IN ('x','y')`.
function pushCondition(conditions, values, column, value) {
  if (value === null || value === undefined) return;
  const list = Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined && v !== "") : [value];
  if (list.length === 0) return;
  values.push(...list);
  if (list.length === 1) {
    conditions.push(`${column} = '${escapeSqlLiteral(list[0])}'`);
  } else {
    conditions.push(`${column} IN (${list.map((v) => `'${escapeSqlLiteral(v)}'`).join(", ")})`);
  }
}

// Excludes embed agents' bridge_ids from the Timescale query entirely - their
// usage is real and lives in the same rollup tables as everyone else's, but
// embed agents aren't part of the org's real Agents list and shouldn't
// contribute to the Metrics dashboard's numbers at all (not shown unnamed,
// not folded into totals).
function pushExcludeCondition(conditions, column, excludeList) {
  const list = Array.isArray(excludeList) ? excludeList.filter((v) => v !== null && v !== undefined && v !== "") : [];
  if (list.length === 0) return;
  conditions.push(`${column} NOT IN (${list.map((v) => `'${escapeSqlLiteral(v)}'`).join(", ")})`);
}

export function buildWhereClause(
  params,
  values,
  factor,
  range,
  flag = true,
  start_date = null,
  end_date = null,
  groupExtra = "",
  excludeBridgeIds = null
) {
  const conditions = [];

  pushCondition(conditions, values, "org_id", params.org_id);
  pushCondition(conditions, values, "bridge_id", params.bridge_id);
  pushCondition(conditions, values, "version_id", params.version_id);
  pushCondition(conditions, values, "apikey_id", params.apikey_id);
  pushCondition(conditions, values, "thread_id", params.thread_id);
  pushCondition(conditions, values, "service", params.service);
  pushCondition(conditions, values, "model", params.model);
  pushExcludeCondition(conditions, "bridge_id", excludeBridgeIds);

  let query = "WHERE " + conditions.join(" AND ");
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
  if (factor) {
    query += ` GROUP BY ${factor}${groupExtra}, created_at, cost_sum, total_token_count, success_count`;
  }
  return query;
}
