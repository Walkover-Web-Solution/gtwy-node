import models from "../../models/index.js";
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
  // Weekly and monthly reports both use daily rollups to avoid retention gaps
  // from fifteen_minute_data (which is configured for short retention).
  const tableName = "daily_data";

  for (let org_id of org_ids) {
    org_id = org_id.toString();

    // Pull weekly/monthly latency from the rollup table that matches the report type.
    const bridgeStats = await models.timescale.sequelize.query(
      `
      SELECT
        bridge_id,
        SUM(COALESCE(system_latency_sum, 0)) / NULLIF(SUM(COALESCE(record_count, 0)), 0) AS avg_latency,
        SUM(COALESCE(record_count, 0))::int AS total_requests
      FROM ${tableName}
      WHERE
        org_id = :org_id
        AND created_at BETWEEN :startDate AND :endDate
        AND bridge_id IS NOT NULL
      GROUP BY bridge_id
      `,
      {
        type: models.timescale.Sequelize.QueryTypes.SELECT,
        replacements: {
          org_id,
          startDate,
          endDate
        }
      }
    );

    if (!Array.isArray(bridgeStats) || bridgeStats.length === 0) {
      continue;
    }

    // Convert the map to an array of objects with bridge names and average latency
    const bridgeLatencyReport = [];
    for (const stats of bridgeStats) {
      const bridgeId = stats.bridge_id;
      if (!bridgeId) continue;

      // Get bridge name from service
      const bridgeName = await configurationService.getAgentNameById(bridgeId, org_id);

      bridgeLatencyReport.push({
        bridge_id: bridgeId,
        bridge_name: bridgeName || "Unknown Bridge",
        avg_latency: Number(stats.avg_latency || 0).toFixed(2),
        total_requests: Number(stats.total_requests || 0)
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
