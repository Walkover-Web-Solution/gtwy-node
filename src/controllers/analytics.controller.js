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
    const { range, start_date, end_date, interval, tool_id, model, user_feedback, error, version_id, testcase_id, keyword, filter_by } = req.query;
    // RT channel is always org_id + "_" + bridge_id.
    const channel = `${org_id}_${bridge_id}`;

    const window = analyticsService.computeWindow({ range, start_date, end_date, interval });

    // Optional filters: when omitted the API behaves exactly as before. Mirrors
    // the full threads-API filter set so the dashboard can slice the same way.
    // user_feedback: good->1 (thumbs up), bad->2 (thumbs down), all/undefined-> no filter.
    const feedbackMap = { good: 1, bad: 2 };
    const filters = {
      tool_id: tool_id || undefined,
      model: model || undefined,
      user_feedback: feedbackMap[user_feedback],
      error: error || undefined,
      version_id: version_id || undefined,
      testcase_id: testcase_id || undefined,
      keyword: keyword || undefined,
      filter_by: filter_by && typeof filter_by === "object" ? filter_by : undefined
    };

    // 1) Single PG query: distinct sub-threads for the bridge, ordered by latest
    //    activity (MAX(created_at) per sub-thread) so most-recently-updated are on top.
    const sortedThreads = await conversationDbService.getBridgeSubThreadsWithActivity(org_id, bridge_id, filters);

    // 2) Fire-and-forget PG analytics: do not await — delivered over the RT layer.
    analyticsService
      .runAndPush({ bridge_id, org_id, channel, window, filters })
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

// GET /api/analytics/agent/:bridge_id/filters
// Returns the distinct tools (name -> id) and models (grouped by service) ever
// used by the bridge, so the frontend can populate the filter dropdowns.
const getAgentAnalyticsFilters = async (req, res, next) => {
  try {
    const { bridge_id } = req.params;
    const org_id = req.profile?.org?.id;

    const { tools_data, unique_model } = await analyticsService.getFilterOptions({ bridge_id, org_id });

    res.locals = {
      success: true,
      bridge_id,
      tools_data,
      unique_model
    };
    req.statusCode = 200;
    return next();
  } catch (error) {
    logger.error(`Error fetching agent analytics filters: ${error.message}`);
    res.locals = { success: false, error: error.message };
    req.statusCode = 500;
    return next();
  }
};

export default {
  getAgentAnalytics,
  getAgentAnalyticsFilters
};
