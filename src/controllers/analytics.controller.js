import analyticsService from "../db_services/analytics.service.js";
import conversationDbService from "../db_services/conversation.service.js";
import { findRecentThreadsByBridgeId } from "../db_services/history.service.js";
import logger from "../logger.js";

// GET /api/analytics/agent/:bridge_id?range=7
// Returns the agent's sub-threads (from Postgres conversation_logs) in the
// response, and fires the heavy PG analytics aggregation in the background —
// that result (summary + two charts) is pushed over the RT layer to `channel`.
const getAgentAnalytics = async (req, res, next) => {
  try {
    const { bridge_id } = req.params;
    const org_id = req.profile?.org?.id;
    const {
      range,
      start_date,
      end_date,
      interval,
      tool_id,
      model,
      service,
      user_feedback,
      error,
      version_id,
      testcase_id,
      keyword,
      message_id,
      filter_by
    } = req.query;
    // RT channel is always org_id + "_" + bridge_id.
    const channel = `${org_id}_${bridge_id}`;

    const window = analyticsService.computeWindow({ range, start_date, end_date, interval });

    // Normalize a multi-value query param to an array. Supports both comma-separated
    // (tool_id=a,b) and array brackets (tool_id[]=a&tool_id[]=b). Empty -> undefined.
    const toFilterArray = (v) => {
      if (v == null) return undefined;
      const arr = (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
      return arr.length ? arr : undefined;
    };

    // Optional filters: when omitted the API behaves exactly as before. Mirrors
    // the full threads-API filter set so the dashboard can slice the same way.
    // tool_id / model / service are multi-select (match ANY).
    // user_feedback: good->1 (thumbs up), bad->2 (thumbs down), all/undefined-> no filter.
    const feedbackMap = { good: 1, bad: 2 };
    const filters = {
      tool_id: toFilterArray(tool_id),
      model: toFilterArray(model),
      service: toFilterArray(service),
      user_feedback: feedbackMap[user_feedback],
      error: error || undefined,
      version_id: version_id || undefined,
      testcase_id: testcase_id || undefined,
      keyword: keyword || undefined,
      filter_by: filter_by && typeof filter_by === "object" ? filter_by : undefined
    };

    // Pagination: page 1 runs the full analytics + total count; page 2+ returns
    // only that page of threads (cheap navigation — no RT push, no count query).
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const page_size = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || 20));
    const offset = (page - 1) * page_size;

    // Search mode: a non-empty keyword OR message_id switches the endpoint to the
    // threads-search response shape ({ data, total_user_feedback_count }). Analytics
    // are skipped. message_id is matched via filter_by (scoped to the message_id column).
    const hasKeyword = typeof keyword === "string" && keyword.trim().length > 0;
    const hasMessageId = typeof message_id === "string" && message_id.trim().length > 0;
    if (hasKeyword || hasMessageId) {
      const baseFilterBy = filter_by && typeof filter_by === "object" ? { ...filter_by } : undefined;
      const mergedFilterBy = hasMessageId ? { ...(baseFilterBy || {}), message_id: message_id.trim() } : baseFilterBy;
      const searchFilters = {
        keyword: hasKeyword ? keyword : undefined,
        filter_by: mergedFilterBy,
        time_range: start_date || end_date ? { start: start_date, end: end_date } : undefined
      };
      // findRecentThreadsByBridgeId expects the raw int (1/2) or "all".
      const ufForSearch = feedbackMap[user_feedback] || "all";

      const result = await findRecentThreadsByBridgeId(
        org_id,
        bridge_id,
        searchFilters,
        ufForSearch,
        error || "false",
        page,
        page_size,
        version_id || null,
        testcase_id || null
      );

      res.locals = result.success
        ? { data: result.data, total_user_feedback_count: result.total_user_feedback_count, success: true }
        : { success: false, message: result.message };
      req.statusCode = result.success ? 200 : 500;
      return next();
    }

    // 1) Distinct sub-threads for the bridge, ordered by latest activity
    //    (MAX(created_at) per sub-thread). Fetch one extra row to derive has_more.
    const rows = await conversationDbService.getBridgeSubThreadsWithActivity(org_id, bridge_id, filters, {
      limit: page_size + 1,
      offset
    });
    const has_more = rows.length > page_size;
    const threads = has_more ? rows.slice(0, page_size) : rows;

    const pagination = { page, page_size, has_more };
    let message = "Threads page returned";

    if (page === 1) {
      // 2) First page only: fire-and-forget PG analytics (delivered over the RT
      //    layer) and compute the total count for pagination metadata.
      analyticsService
        .runAndPush({ bridge_id, org_id, channel, window, filters })
        .catch((error) => logger.error(`analytics runAndPush failed for ${bridge_id}: ${error.message}`));

      const total = await conversationDbService.getBridgeSubThreadsCount(org_id, bridge_id, filters);
      pagination.total = total;
      pagination.total_pages = Math.ceil(total / page_size);
      message = "Threads returned; analytics will be pushed over the RT layer";
    }

    // 3) Return this page of threads; on page 1 the analytics arrive on `channel`.
    res.locals = {
      success: true,
      message,
      bridge_id,
      channel,
      range_start: window.start,
      range_end: window.end,
      count: threads.length,
      threads,
      pagination
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

    const { tools_data, knowledgebase_data, agent_data, unique_model } = await analyticsService.getFilterOptions({ bridge_id, org_id });

    res.locals = {
      success: true,
      bridge_id,
      tools_data,
      knowledgebase_data,
      agent_data,
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
