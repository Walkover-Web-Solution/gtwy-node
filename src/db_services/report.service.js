import models from "../../models/index.js";
import { Op } from "sequelize";
import configurationService from "../db_services/configuration.service.js";

/**
 * Get date range for report based on type
 * @param {string} reportType - 'monthly' or 'weekly'
 * @returns {Object} Object with startDate and endDate
 */
function getReportDateRange(reportType) {
  const now = new Date();

  if (reportType === "monthly") {
    const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      startDate: firstDayOfLastMonth,
      endDate: lastDayOfLastMonth
    };
  } else if (reportType === "weekly") {
    const day = now.getDay() || 7; // Convert Sunday (0) to 7 for easier calculation
    const prevMonday = new Date(now);
    prevMonday.setDate(now.getDate() - (day + 6)); // Go back to previous Monday
    prevMonday.setHours(0, 0, 0, 0);

    const prevSunday = new Date(prevMonday);
    prevSunday.setDate(prevMonday.getDate() + 6); // Sunday is 6 days after Monday
    prevSunday.setHours(23, 59, 59, 999);

    return {
      startDate: prevMonday,
      endDate: prevSunday
    };
  }

  throw new Error(`Invalid report type: ${reportType}`);
}

/**
 * Unified function to get latency report data for specified period
 * @param {Array} org_ids - Array of organization IDs
 * @param {string} reportType - 'monthly' or 'weekly'
 * @returns {Array} Report results
 */
async function get_latency_report_data(org_ids, reportType) {
  const results = [];
  const { startDate, endDate } = getReportDateRange(reportType);

  // Prepare date filter
  const dateFilter = {
    [Op.gte]: startDate,
    [Op.lte]: endDate
  };

  for (let org_id of org_ids) {
    org_id = org_id.toString();

    // conversation_logs has bridge_id + latency (JSONB) directly on each row
    const logs = await models.pg.conversation_logs.findAll({
      where: {
        org_id,
        created_at: dateFilter
      },
      attributes: ["bridge_id", "latency"]
    });

    // Skip this org if no data is available
    if (logs.length === 0) {
      continue;
    }

    // Accumulate latency sums and counts by bridge_id
    const bridgeLatencyStats = new Map();

    for (const r of logs) {
      const { bridge_id, latency } = r;

      if (!bridge_id || latency == null) continue;

      // latency is JSONB: { over_all_time, model_execution_time, function_time_logs: [{time_taken}] }
      let functionTimeTotal = 0;
      if (Array.isArray(latency.function_time_logs)) {
        functionTimeTotal = latency.function_time_logs.reduce((sum, log) => sum + (log.time_taken || 0), 0);
      }
      const actualLatency = (latency.over_all_time || 0) - (latency.model_execution_time || 0) - functionTimeTotal;

      if (!bridgeLatencyStats.has(bridge_id)) {
        bridgeLatencyStats.set(bridge_id, { totalLatency: 0, count: 0 });
      }

      const stats = bridgeLatencyStats.get(bridge_id);
      stats.totalLatency += actualLatency;
      stats.count++;
    }

    // Skip this org if no valid latency data was found
    if (bridgeLatencyStats.size === 0) {
      continue;
    }

    // Convert the map to an array of objects with bridge names and average latency
    const bridgeLatencyReport = [];
    for (const [bridgeId, stats] of bridgeLatencyStats.entries()) {
      // Get bridge name from service
      const bridgeName = await configurationService.getAgentNameById(bridgeId, org_id);

      bridgeLatencyReport.push({
        bridge_id: bridgeId,
        bridge_name: bridgeName || "Unknown Bridge",
        avg_latency: stats.count > 0 ? (stats.totalLatency / stats.count).toFixed(2) : 0,
        total_requests: stats.count
      });
    }

    // Sort by average latency in descending order
    bridgeLatencyReport.sort((a, b) => b.avg_latency - a.avg_latency);

    // Create the final JSON for this org_id
    const orgData = {
      [org_id]: {
        report_period: {
          start_date: startDate.toISOString().split("T")[0],
          end_date: endDate.toISOString().split("T")[0]
        },
        bridge_latency_report: bridgeLatencyReport
      }
    };

    results.push(orgData);
  }

  // Send data to external service
  const data = {
    results: results,
    time: reportType
  };

  const url = "https://flow.sokt.io/func/scri4zMzbGiR";
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  return results;
}

/**
 * Get all data from conversations and raw_data tables by message_id
 * Only returns conversation records that have matching raw_data entries
 * @param {string} message_id - The message ID to search for
 * @returns {Object} Combined data from both tables
 */

export { get_latency_report_data };
