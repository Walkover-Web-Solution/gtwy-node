import models from "../../models/index.js";
import { Op } from "sequelize";
import configurationService from "../db_services/configuration.service.js";

async function get_data_from_pg(org_ids) {
  const results = [];

  // Get the start and end of the previous month
  const now = new Date();
  const firstDayOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDayOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  // Prepare common date filters to avoid duplication
  const conversationDateFilter = {
    [Op.gte]: firstDayOfLastMonth,
    [Op.lte]: lastDayOfLastMonth
  };

  for (let org_id of org_ids) {
    org_id = org_id.toString();

    // Prepare the SQL queries for each organization separately
    const bridgeStatsQuery = `
      WITH bridge_stats AS (
        SELECT
          c.bridge_id,
          COUNT(c.id) AS hits,
          SUM(rd.input_tokens + rd.output_tokens) AS total_tokens_used,
          SUM(rd.expected_cost) AS total_cost
        FROM
          conversations c
        JOIN
          raw_data rd ON c.message_id = rd.message_id
        WHERE
          c.message_by = 'user' AND c.org_id = '${org_id}'
          AND c."createdAt" >= date_trunc('month', current_date) - interval '1 month'
          AND c."createdAt" < date_trunc('month', current_date)
        GROUP BY
          c.bridge_id
      )
      SELECT
        bs.bridge_id AS "bridge_id",
        bs.hits,
        bs.total_tokens_used AS "Tokens Used",
        bs.total_cost AS "Cost"
      FROM
        bridge_stats bs
      ORDER BY
        bs.hits DESC
      LIMIT 3;
    `;

    const activeBridgesQuery = `
      SELECT
        COUNT(DISTINCT c.bridge_id) AS active_bridges_count
      FROM
        conversations c
      WHERE
        c.bridge_id IS NOT NULL
        AND c.org_id = '${org_id}'
        AND c."createdAt" >= date_trunc('month', current_date) - interval '1 month'
        AND c."createdAt" < date_trunc('month', current_date);
    `;

    // Use Promise.all to fetch all required data in parallel
    const [conversations, rawData, bridgeStats, activeBridges] = await Promise.all([
      // Fetch conversations
      models.pg.conversations.findAll({
        where: {
          org_id,
          createdAt: conversationDateFilter
        },
        attributes: ["bridge_id", "message_by", "message", "tools_call_data", "createdAt", "message_id", "user_feedback"]
      }),

      // Fetch rawData
      models.pg.raw_data.findAll({
        where: {
          org_id,
          created_at: conversationDateFilter
        },
        attributes: ["service", "status", "input_tokens", "output_tokens", "expected_cost", "message_id", "error"]
      }),

      // Execute bridgeStats query
      models.pg.sequelize.query(bridgeStatsQuery, {
        type: models.pg.sequelize.QueryTypes.SELECT
      }),

      // Execute activeBridges query
      models.pg.sequelize.query(activeBridgesQuery, {
        type: models.pg.sequelize.QueryTypes.SELECT
      })
    ]);

    // Initialize variables to store totals
    let totalHits = 0;
    let totalTokensConsumed = 0;
    let totalCost = 0;
    let totalErrorCount = 0;
    let totalDislikes = 0;
    let totalPositiveFeedback = 0;
    let totalSuccessCount = 0;
    const topBridges = [];

    // totalHits is simply the length of rawData
    totalHits = rawData.length;

    // Build a map (message_id -> rawData row) for quick lookups
    const rawDataMap = new Map();
    for (const r of rawData) {
      rawDataMap.set(r.message_id, r);
    }

    // Resolve activeBridges count
    const activeBridges_count = parseInt(activeBridges[0].active_bridges_count, 10) || 0;

    // Resolve bridge names
    for (let i = 0; i < bridgeStats.length; i++) {
      const bId = bridgeStats[i].bridge_id;
      const bridgeName = await configurationService.getAgentNameById(bId, org_id);
      bridgeStats[i].BridgeName = bridgeName;
    }

    // Iterate through the conversations to accumulate usage data and feedback
    for (const conversation of conversations) {
      const { bridge_id, message_id, user_feedback } = conversation;

      // Pull tokens/cost from map
      const correspondingRawData = rawDataMap.get(message_id);
      if (correspondingRawData) {
        totalTokensConsumed += correspondingRawData.input_tokens + correspondingRawData.output_tokens;
        totalCost += correspondingRawData.expected_cost;
      }

      // Tools call => track usage in topBridges
      if (conversation.tools_call_data) {
        let bridgeData = topBridges.find((bridge) => bridge.BridgeName === bridge_id);
        if (!bridgeData) {
          bridgeData = { BridgeName: bridge_id, Hits: 0, TokensUsed: 0, Cost: 0 };
          topBridges.push(bridgeData);
        }
        bridgeData.Hits++;
        if (correspondingRawData) {
          bridgeData.TokensUsed += correspondingRawData.input_tokens + correspondingRawData.output_tokens;
          bridgeData.Cost += correspondingRawData.expected_cost;
        }
      }

      // Parse user_feedback from conversation directly
      if (user_feedback) {
        const feedbackJson = JSON.parse(user_feedback);
        if (feedbackJson.Dislikes) {
          totalDislikes += feedbackJson.Dislikes;
        }
        if (feedbackJson.PositiveFeedback) {
          totalPositiveFeedback += feedbackJson.PositiveFeedback;
        }
      }
    }

    // Calculate the total errors vs. successes from the rawData
    for (const r of rawData) {
      if (r.error && r.error.trim() !== "") {
        totalErrorCount++;
      } else {
        totalSuccessCount++;
      }
    }

    // Create the final JSON for this org_id
    const orgData = {
      [org_id]: {
        UsageOverview: {
          totalHits,
          totalTokensConsumed,
          totalCost,
          activeBridges: activeBridges_count
        },
        topBridgesTable: bridgeStats,
        NewBridgesCreated: topBridges.length, // same logic as before
        PerformanceMetrics: {
          totalSuccess: totalSuccessCount,
          totalError: totalErrorCount
        },
        ClientFeedback: {
          dislike: totalDislikes,
          positiveFeedback: totalPositiveFeedback
        }
      }
    };

    results.push(orgData);
  }

  return results;
}

async function get_data_for_daily_report(org_ids) {
  const results = [];

  // Get today's date and yesterday's date for daily report
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  // Set time to beginning and end of yesterday
  yesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  // Prepare date filter for yesterday
  const dateFilter = {
    [Op.gte]: yesterday,
    [Op.lte]: endOfYesterday
  };

  for (let org_id of org_ids) {
    org_id = org_id.toString();

    // Fetch conversations and raw data for yesterday
    const [conversations, rawData] = await Promise.all([
      // Fetch conversations
      models.pg.conversations.findAll({
        where: {
          org_id,
          createdAt: dateFilter
        },
        attributes: ["bridge_id", "message_id"]
      }),

      // Fetch rawData
      models.pg.raw_data.findAll({
        where: {
          org_id,
          created_at: dateFilter
        },
        attributes: ["message_id", "error"]
      })
    ]);

    // Create a map of message_id to raw_data for quick lookup
    const rawDataMap = new Map();
    for (const r of rawData) {
      rawDataMap.set(r.message_id, r);
    }

    // Create a map to track error counts by bridge_id
    const bridgeErrorCounts = new Map();

    // Process each conversation to count errors by bridge
    for (const conversation of conversations) {
      const { bridge_id, message_id } = conversation;

      if (!bridge_id) continue;

      // Initialize bridge in map if not exists
      if (!bridgeErrorCounts.has(bridge_id)) {
        bridgeErrorCounts.set(bridge_id, {
          errorCount: 0,
          totalCount: 0
        });
      }

      // Increment total count for this bridge
      const bridgeData = bridgeErrorCounts.get(bridge_id);
      bridgeData.totalCount++;

      // Check if there was an error for this message
      const rawDataEntry = rawDataMap.get(message_id);
      if (rawDataEntry && rawDataEntry.error && rawDataEntry.error.trim() !== "") {
        bridgeData.errorCount++;
      }
    }

    // Convert the map to an array of objects with bridge names
    const bridgeErrorReport = [];
    for (const [bridgeId, data] of bridgeErrorCounts.entries()) {
      // Get bridge name from MongoDB
      const bridgeName = await configurationService.getAgentNameById(bridgeId, org_id);

      bridgeErrorReport.push({
        bridge_id: bridgeId,
        bridge_name: bridgeName || "Unknown Bridge",
        error_count: data.errorCount,
        total_count: data.totalCount,
        error_rate: data.totalCount > 0 ? ((data.errorCount / data.totalCount) * 100).toFixed(2) + "%" : "0%"
      });
    }

    // Sort by error count in descending order
    bridgeErrorReport.sort((a, b) => b.error_count - a.error_count);

    // Create the final JSON for this org_id
    const orgData = {
      [org_id]: {
        date: yesterday.toISOString().split("T")[0],
        bridge_error_report: bridgeErrorReport
      }
    };

    results.push(orgData);
  }

  return results;
}

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

    // Fetch conversations and raw data with latency information
    const [conversations, rawData] = await Promise.all([
      models.pg.conversations.findAll({
        where: {
          org_id,
          createdAt: dateFilter
        },
        attributes: ["bridge_id", "message_id"]
      }),
      models.pg.raw_data.findAll({
        where: {
          org_id,
          created_at: dateFilter
        },
        attributes: ["message_id", "latency"]
      })
    ]);

    // Skip this org if no data is available
    if (conversations.length === 0 || rawData.length === 0) {
      continue;
    }

    // Create a map of message_id to latency (float) for quick lookup
    const rawDataMap = new Map();
    for (const r of rawData) {
      if (r.latency != null) {
        rawDataMap.set(r.message_id, r.latency);
      }
    }

    // Create a map to track latency sums and counts by bridge_id
    const bridgeLatencyStats = new Map();

    // Process each conversation to calculate average latency by bridge
    for (const conversation of conversations) {
      const { bridge_id, message_id } = conversation;

      if (!bridge_id) continue;

      const latency = rawDataMap.get(message_id);
      if (latency == null) continue;

      // Initialize or update bridge stats
      if (!bridgeLatencyStats.has(bridge_id)) {
        bridgeLatencyStats.set(bridge_id, {
          totalLatency: 0,
          count: 0
        });
      }

      const stats = bridgeLatencyStats.get(bridge_id);
      stats.totalLatency += latency;
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

export { get_data_for_daily_report, get_data_from_pg, get_latency_report_data };
