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
      agent_id,
      knowledgebase_id,
      user_feedback,
      error,
      review_failed,
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
      agent_id: toFilterArray(agent_id),
      knowledgebase_id: toFilterArray(knowledgebase_id),
      user_feedback: feedbackMap[user_feedback],
      error: error || undefined,
      review_failed: review_failed || undefined,
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

    // Analytics aggregations (summary + 2 charts over RT) run ONLY when explicitly
    // requested via `analytics=true`, and only on page 1. Orthogonal to the
    // response format below. Uses the same filters so the RT payload reflects them.
    const runAnalytics = req.query.analytics === true || req.query.analytics === "true";

    // The new threads-search response shape ({ data, total_user_feedback_count })
    // is used whenever ANY facet/search filter is present. The time window
    // (range/start/end/interval) does NOT count. With no filters we keep the
    // current { threads, pagination, ... } shape.
    const hasMessageId = typeof message_id === "string" && message_id.trim().length > 0;
    const hasAnyFilter = Boolean(
      filters.tool_id ||
      filters.model ||
      filters.service ||
      filters.agent_id ||
      filters.knowledgebase_id ||
      filters.user_feedback != null ||
      filters.error === "true" ||
      filters.review_failed === "true" ||
      filters.version_id ||
      filters.testcase_id ||
      filters.keyword ||
      hasMessageId ||
      (filters.filter_by && Object.keys(filters.filter_by).length > 0)
    );

    if (runAnalytics && page === 1) {
      analyticsService
        .runAndPush({ bridge_id, org_id, channel, window, filters })
        .catch((err) => logger.error(`analytics runAndPush failed for ${bridge_id}: ${err.message}`));
    }

    if (hasAnyFilter) {
      // NEW format via findRecentThreadsByBridgeId. message_id is matched via
      // filter_by (scoped to the message_id column). tool_id/model/service are
      // honored by findRecentThreadsByBridgeId through the shared filter builder.
      const baseFilterBy = filters.filter_by ? { ...filters.filter_by } : undefined;
      const mergedFilterBy = hasMessageId ? { ...(baseFilterBy || {}), message_id: message_id.trim() } : baseFilterBy;
      const searchFilters = {
        keyword: filters.keyword,
        filter_by: mergedFilterBy,
        time_range: start_date || end_date ? { start: start_date, end: end_date } : undefined,
        tool_id: filters.tool_id,
        model: filters.model,
        service: filters.service,
        agent_id: filters.agent_id,
        knowledgebase_id: filters.knowledgebase_id,
        review_failed: filters.review_failed
      };
      // findRecentThreadsByBridgeId expects the raw int (1/2) or "all".
      const ufForSearch = filters.user_feedback || "all";

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
        ? {
            success: true,
            data: result.data,
            total_user_feedback_count: result.total_user_feedback_count,
            ...(runAnalytics ? { channel } : {}) // channel only when analytics is pushing
          }
        : { success: false, message: result.message };
      req.statusCode = result.success ? 200 : 500;
      return next();
    }

    // CURRENT format (no filters).
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
      // First page only: compute the total count for pagination metadata.
      const total = await conversationDbService.getBridgeSubThreadsCount(org_id, bridge_id, filters);
      pagination.total = total;
      pagination.total_pages = Math.ceil(total / page_size);
      message = runAnalytics ? "Threads returned; analytics will be pushed over the RT layer" : "Threads returned";
    }

    // Return this page of threads; on page 1 the analytics (if requested) arrive on `channel`.
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
