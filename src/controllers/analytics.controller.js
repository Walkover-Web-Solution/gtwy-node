import analyticsService from "../db_services/analytics.service.js";
import conversationDbService from "../db_services/conversation.service.js";
import logger from "../logger.js";

// GET /api/analytics/agent/:bridge_id?range=7
// Returns the agent's sub-threads (from Postgres conversation_logs) in the
// response, and fires the heavy PG analytics aggregation in the background —
// that result (summary + two charts) is pushed over the RT layer to `channel`.
const getAgentAnalytics = async (req, res, next) => {
  try {
    const { bridge_id } = req.params;
    const org_id = req.profile?.org?.id;
    const { range, start_date, end_date, interval } = req.query;
    // RT channel is always org_id + "_" + bridge_id.
    const channel = `${org_id}_${bridge_id}`;

    const window = analyticsService.computeWindow({ range, start_date, end_date, interval });

    // 1) Single PG query: distinct sub-threads for the bridge, ordered by latest
    //    activity (MAX(created_at) per sub-thread) so most-recently-updated are on top.
    const sortedThreads = await conversationDbService.getBridgeSubThreadsWithActivity(org_id, bridge_id);

    // 2) Fire-and-forget PG analytics: do not await — delivered over the RT layer.
    analyticsService
      .runAndPush({ bridge_id, org_id, channel, window })
      .catch((error) => logger.error(`analytics runAndPush failed for ${bridge_id}: ${error.message}`));

    // 3) Return threads now; the analytics numbers arrive on `channel` shortly.
    res.locals = {
      success: true,
      message: "Threads returned; analytics will be pushed over the RT layer",
      bridge_id,
      channel,
      range_start: window.start,
      range_end: window.end,
      count: sortedThreads.length,
      threads: sortedThreads
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error starting agent analytics: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

export default {
  getAgentAnalytics
};
