import combinedModels from "./../../models/index.js";
const timescale = combinedModels.timescale;
import Sequelize from "sequelize";
async function find(query, values) {
  try {
    const queryOptions = {
      type: Sequelize.QueryTypes.SELECT,
      replacements: values
    };
    const results = await timescale.sequelize.query(query, queryOptions);
    return results;
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
}

// Sum history + today rows for the same bridge_id into one row per agent.
function mergeUsageRows(rows) {
  const merged = {};
  for (const row of rows) {
    const key = String(row.bridge_id);
    if (!merged[key]) {
      merged[key] = {
        bridge_id: row.bridge_id,
        total_tokens: 0,
        total_cost: 0,
        success_count: 0,
        total_requests: 0,
        last_used_time: null
      };
    }
    const m = merged[key];
    m.total_tokens += Number(row.total_tokens) || 0;
    m.total_cost += Number(row.total_cost) || 0;
    m.success_count += Number(row.success_count) || 0;
    m.total_requests += Number(row.total_requests) || 0;
    if (row.last_used_time && (!m.last_used_time || new Date(row.last_used_time) > new Date(m.last_used_time))) {
      m.last_used_time = row.last_used_time;
    }
  }
  return Object.values(merged);
}

// Get cost/usage per agent, split at today, since daily_data isn't updated live
async function getUsageByBridgeIds({ org_id, bridge_ids, start_date, end_date }) {
  if (!bridge_ids?.length) return [];

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const start = start_date ? new Date(start_date) : startOfToday;
  const end = end_date ? new Date(end_date) : new Date();

  const rangeIncludesToday = end >= startOfToday;
  const rangeHasHistory = start < startOfToday;

  const replacements = { org_id: String(org_id), bridge_ids };
  const usageQuery = `
    SELECT
      bridge_id,
      SUM(total_token_count) AS total_tokens,
      SUM(cost_sum) AS total_cost,
      SUM(success_count) AS success_count,
      SUM(record_count) AS total_requests,
      MAX(created_at) AS last_used_time
    FROM :table:
    WHERE org_id = :org_id
      AND bridge_id IN (:bridge_ids)
      AND created_at BETWEEN :start_date AND :end_date
    GROUP BY bridge_id`;
  const queries = [];

  // For history usage
  if (rangeHasHistory) {
    const historyEnd = rangeIncludesToday ? new Date(startOfToday.getTime() - 1) : end;
    queries.push(
      find(usageQuery.replace(":table:", "daily_data"), { ...replacements, start_date: start, end_date: historyEnd })
    );
  }

  // For Today usage
  if (rangeIncludesToday) {
    const todayStart = start > startOfToday ? start : startOfToday;
    queries.push(
      find(usageQuery.replace(":table:", "fifteen_minute_data"), { ...replacements, start_date: todayStart, end_date: end })
    );
  }

  const rows = (await Promise.all(queries)).flat();
  return mergeUsageRows(rows);
}

export default {
  find,
  getUsageByBridgeIds
};
